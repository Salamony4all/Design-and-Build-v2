import type { Vec2 } from './types';
import type { RoomMask } from './ffeTypes';
import type { CircularArc, PdfFfeStagingPayload, PdfVectorPrimitive, RecurrenceCluster, DnaProfile } from './pdfFfeTypes';
import { calibrateFromDoorArcs, transformPrimitive } from './pdfScale';
import { convexHull, minimumAreaObb } from './ffeObb';
import { topologicalDna } from './pdfFfeDna';
import { pointInRing } from './ffeFiltering';
import RBush from 'rbush';

const STRUCTURAL_ID = /(WALL|JOINERY|MILLWORK|CABINET|DOOR|WINDOW|OPENING|HATCH|LEADER|TITLE|MARGIN|TEXT|STAIR|SHAFT)/i;

const matrix4x4ColumnMajorMm = (x: number, y: number, theta: number): number[] => {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const n = (v: number) => (Object.is(v, -0) ? 0 : v);
  // Column-major 4x4 matrix in millimetres
  return [n(c), n(s), 0, 0, n(-s), n(c), 0, 0, 0, 0, 1, 0, x, y, 0, 1];
};

const segDist = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): number => {
  const ps = (p: Vec2, x: Vec2, y: Vec2) => {
    const vx = y.x - x.x;
    const vy = y.y - x.y;
    const l = vx * vx + vy * vy;
    const t = l ? Math.max(0, Math.min(1, ((p.x - x.x) * vx + (p.y - x.y) * vy) / l)) : 0;
    return Math.hypot(p.x - (x.x + t * vx), p.y - (y.y + t * vy));
  };
  return Math.min(ps(a, c, d), ps(b, c, d), ps(c, a, b), ps(d, a, b));
};

interface PrimitiveBboxEntry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  index: number;
}

export function clusterDbscanRtree(
  prims: readonly PdfVectorPrimitive[],
  eps = 100
): { clusters: PdfVectorPrimitive[][]; rejectedBridges: number } {
  const n = prims.length;
  if (n === 0) return { clusters: [], rejectedBridges: 0 };

  const rtree = new RBush<PrimitiveBboxEntry>();
  const items: PrimitiveBboxEntry[] = prims.map((p, i) => {
    const xs = p.points.map((pt) => pt.x);
    const ys = p.points.map((pt) => pt.y);
    return {
      minX: Math.min(...xs) - eps,
      minY: Math.min(...ys) - eps,
      maxX: Math.max(...xs) + eps,
      maxY: Math.max(...ys) + eps,
      index: i,
    };
  });
  rtree.load(items);

  const labels = new Int32Array(n).fill(-1);
  let cid = 0;
  let rejectedBridges = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i]! >= 0) continue;

    const p = prims[i]!;
    const a = p.points[0]!;
    const b = p.points.at(-1)!;

    const candidateEntries = rtree.search({
      minX: Math.min(a.x, b.x) - eps,
      minY: Math.min(a.y, b.y) - eps,
      maxX: Math.max(a.x, b.x) + eps,
      maxY: Math.max(a.y, b.y) + eps,
    });

    const neighbors: number[] = [];
    for (const entry of candidateEntries) {
      const j = entry.index;
      const qPt = prims[j]!;
      const c = qPt.points[0]!;
      const d = qPt.points.at(-1)!;
      const dist = segDist(a, b, c, d);
      if (dist <= eps) {
        neighbors.push(j);
      }
    }

    labels[i] = cid;
    const queue = [...neighbors];

    for (let k = 0; k < queue.length; k++) {
      const idx = queue[k]!;
      if (labels[idx]! < 0) {
        labels[idx] = cid;

        const pCurrent = prims[idx]!;
        const c1 = pCurrent.points[0]!;
        const c2 = pCurrent.points.at(-1)!;

        const subEntries = rtree.search({
          minX: Math.min(c1.x, c2.x) - eps,
          minY: Math.min(c1.y, c2.y) - eps,
          maxX: Math.max(c1.x, c2.x) + eps,
          maxY: Math.max(c1.y, c2.y) + eps,
        });

        for (const subEntry of subEntries) {
          const j = subEntry.index;
          if (labels[j]! < 0) {
            const qPt = prims[j]!;
            const d1 = qPt.points[0]!;
            const d2 = qPt.points.at(-1)!;
            const dist = segDist(c1, c2, d1, d2);
            if (dist <= eps) {
              // Anti-bridging check: single point touch across long sparse span is flagged as articulation bridge
              const isSparseBridge = pCurrent.points.length === 2 && Math.hypot(c2.x - c1.x, c2.y - c1.y) > 400;
              if (isSparseBridge) {
                rejectedBridges++;
              } else {
                labels[j] = cid;
                queue.push(j);
              }
            }
          }
        }
      }
    }
    cid++;
  }

  const clusters = Array.from({ length: cid }, (_, c) => prims.filter((_, i) => labels[i] === c)).filter(
    (c) => c.length > 0
  );
  return { clusters, rejectedBridges };
}

export function discoverPdfFfe(
  raw: readonly PdfVectorPrimitive[],
  doorArcs: readonly CircularArc[],
  roomsPdf: readonly RoomMask[]
): PdfFfeStagingPayload {
  const cal = calibrateFromDoorArcs(doorArcs);
  const rooms = roomsPdf.map((r) => ({
    ...r,
    polygon: r.polygon.map((p) => ({ x: p.x * cal.mmPerPdfUnit, y: p.y * cal.mmPerPdfUnit })),
    holes: r.holes?.map((h) => h.map((p) => ({ x: p.x * cal.mmPerPdfUnit, y: p.y * cal.mmPerPdfUnit }))),
  }));

  const inputPrimitiveCount = raw.length;
  let excludedPrimitiveCount = 0;

  const transformedPrims = raw
    .filter((x) => {
      const isStructural = STRUCTURAL_ID.test(`${x.id} ${x.sourceObjectId ?? ''}`);
      if (isStructural) excludedPrimitiveCount++;
      return !isStructural;
    })
    .map((x) => transformPrimitive(x, cal.transform));

  const observations: {
    id: string;
    roomId: string;
    hash: string;
    center: Vec2;
    L: number;
    W: number;
    theta: number;
    dna: DnaProfile;
  }[] = [];

  let roomAssignedPrimitiveCount = 0;
  let totalRejectedBridges = 0;

  for (const room of [...rooms].sort((a, b) => a.id.localeCompare(b.id))) {
    const inside = transformedPrims.filter(
      (x) =>
        x.points.every((pt) => pointInRing(pt, room.polygon)) &&
        !(room.holes ?? []).some((h) => pointInRing(pt, h))
    );

    roomAssignedPrimitiveCount += inside.length;

    const { clusters, rejectedBridges } = clusterDbscanRtree(inside, 100);
    totalRejectedBridges += rejectedBridges;

    for (const [i, c] of clusters.entries()) {
      const pts = c.flatMap((x) => x.points);
      const h = convexHull(pts);
      if (h.length < 3) continue;

      const obb = minimumAreaObb(h);
      const closed = c.filter((x) => x.closed).map((x) => x.points);
      const per = closed.sort((a, b) => Math.abs(b.length) - Math.abs(a.length))[0] ?? h;
      const dna = topologicalDna(per, h, obb.length, obb.width, closed.slice(1));

      observations.push({
        id: `${room.id}:ffe:${i}`,
        roomId: room.id,
        hash: dna.hash,
        center: obb.center,
        L: obb.length,
        W: obb.width,
        theta: obb.theta,
        dna,
      });
    }
  }

  // Physical dimension tolerance grouping (+/-25 mm)
  const groupMap = new Map<string, typeof observations>();
  for (const o of observations) {
    let matchedGroupKey: string | null = null;

    for (const key of groupMap.keys()) {
      const [hashKey, lStr, wStr] = key.split('::');
      if (hashKey === o.hash && lStr && wStr) {
        const refL = parseFloat(lStr);
        const refW = parseFloat(wStr);

        const directMatch = Math.abs(o.L - refL) <= 25 && Math.abs(o.W - refW) <= 25;
        const swappedMatch = Math.abs(o.L - refW) <= 25 && Math.abs(o.W - refL) <= 25;

        if (directMatch || swappedMatch) {
          matchedGroupKey = key;
          break;
        }
      }
    }

    if (!matchedGroupKey) {
      matchedGroupKey = `${o.hash}::${o.L.toFixed(1)}::${o.W.toFixed(1)}`;
    }

    const arr = groupMap.get(matchedGroupKey) ?? [];
    arr.push(o);
    groupMap.set(matchedGroupKey, arr);
  }

  const recurrence: RecurrenceCluster[] = [...groupMap]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([groupKey, arr], i) => ({
      clusterId: `pattern_${String(i + 1).padStart(3, '0')}`,
      topologicalHash: arr[0]!.hash,
      frequency: arr.length,
      instanceIds: arr.map((x) => x.id),
      representative: {
        widthMm: arr[0]!.W,
        lengthMm: arr[0]!.L,
        dna: arr[0]!.dna,
      },
    }));

  const instanceToClusterId = new Map<string, string>();
  for (const r of recurrence) {
    for (const instId of r.instanceIds) {
      instanceToClusterId.set(instId, r.clusterId);
    }
  }

  return {
    schema: 'pascal.pdf-ffe-staging/1',
    scale: {
      mmPerPdfUnit: cal.mmPerPdfUnit,
      doorAnchorCount: doorArcs.length,
      averageArcRadiusPdf: cal.averageArcRadiusPdf,
    },
    instances: observations.map((o) => ({
      instanceId: o.id,
      roomId: o.roomId,
      clusterId: instanceToClusterId.get(o.id)!,
      hash: o.hash,
      frequency: recurrence.find((r) => r.clusterId === instanceToClusterId.get(o.id))?.frequency ?? 1,
      centerMm: o.center,
      intrinsicWidthMm: o.W,
      intrinsicLengthMm: o.L,
      theta: o.theta,
      matrix: matrix4x4ColumnMajorMm(o.center.x, o.center.y, o.theta),
      dna: o.dna,
    })),
    recurrence,
    unresolved: observations.map((o) => o.id),
  };
}
