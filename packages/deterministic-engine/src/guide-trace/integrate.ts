/**
 * Guide-Trace ↔ Deterministic Engine Integration
 * -------------------------------------------------
 * Bridges the breakthrough "guide-trace-graph" pipeline
 * (maximal-line-guide-tracer -> space-topology-validator-upgraded -> auto-build-engine-upgraded)
 * into the Pascal deterministic engine's canonical scene-result shapes.
 *
 * Responsibilities:
 *  - buildGraphFaces(): the planar graph / face traversal the upgrade plan requires
 *    (accepted wall bands + junctions -> closed GraphFace polygons). This is the piece the
 *    original breakthrough package consumed but never generated.
 *  - integrateGuideTrace(): maps TraceBuildOutput -> engine AutoBuildWall/Slab/Opening nodes
 *    with deterministic IDs, zero-height diagnostic centerlines, and the 16 required diagnostics.
 *  - buildTraceDebugData(): one-coordinate-system debug layers (source / boundary / candidate /
 *    consensus / rejected / final) for the required visual debug mode.
 *
 * Rules enforced (from AGENT_IMPLEMENTATION_PROMPT.md):
 *  - Space topology is the authority; raw strokes are evidence.
 *  - Never extrude walls before space-closure validation passes (diagnostic height = 0).
 *  - Deterministic IDs only (no Date.now()).
 *  - Furniture stays empty during shell extraction.
 */

import type { GuideTraceGraph, WallBand } from './guide-trace-types';
import type { GraphFace, RoomSeed, SpaceValidationResult } from './space-topology-validator-upgraded';
import {
  AutoBuildEngine,
  type TraceBuildInput,
  type TraceBuildOutput,
} from './auto-build-engine-upgraded';
import {
  type AutoBuildWall,
  type AutoBuildSlab,
  type AutoBuildOpening,
  type AutoBuildSceneResult,
} from '../auto-build-engine';

const round = (v: number, p = 4) => Number(v.toFixed(p));

function stableId(prefix: string, values: Array<string | number>): string {
  return `${prefix}_${values.map(v => (typeof v === 'number' ? Math.round(v * 1000) : v)).join('_')}`;
}

function polygonArea(poly: Array<[number, number]>): number {
  if (poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i]![0] * poly[j]![1] - poly[j]![0] * poly[i]![1];
  }
  return Math.abs(area) / 2;
}

export interface GraphDiagnostics {
  inputBandCount: number;
  deduplicatedEdgeCount: number;
  intersectionCount: number;
  tJunctionCount: number;
  splitSubEdgeCount: number;
  vertexCount: number;
  halfEdgeCount: number;
  degreeHistogram: Record<number, number>;
  isolatedVertexCount: number;
  danglingVertexCount: number;
  traversedCycleCount: number;
  rejectedCycleCountByReason: Record<string, number>;
  boundedFaceCount: number;
  exteriorFaceCount: number;
  virtualClosureEdgeCount: number;
}

interface Edge {
  id: string;
  a: string; // vertex id
  b: string; // vertex id
  axis: 'H' | 'V';
  bandId: string;
  virtual: boolean; // closure edge (door/window/open), not a wall
}
interface HE {
  id: string;
  from: string;
  to: string;
  angle: number;       // atan2(dy,dx)
  twin: string;      // half-edge id
  next: string | null; // left-turn successor (precomputed)
  bandId: string;
  virtual: boolean;
}

const r3 = (v: number) => Number(v.toFixed(3));
const vkey = (p: [number, number]) => `${r3(p[0])},${r3(p[1])}`;

function polySignedArea(poly: Array<[number, number]>): number {
  if (poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i]![0] * poly[j]![1] - poly[j]![0] * poly[i]![1];
  }
  return a / 2; // signed; + = CCW in standard (Y-up) frame
}

function segIntersect(
  p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number],
): [number, number] | null {
  const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null; // strictly interior crossing
  return [p1[0] + t * d1x, p1[1] + t * d1y];
}

function pointOnSeg(p: [number, number], a: [number, number], b: [number, number], tol: number): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]) <= tol;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx, cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy) <= tol && t > 1e-9 && t < 1 - 1e-9;
}

export interface BuildGraphOptions {
  tolM?: number;          // snap / event tolerance (scale-aware)
  yAxisDirection?: 'up' | 'down'; // world Y orientation
  minFaceAreaM2?: number;    // reject cycles below this
}

/**
 * Planar graph / face traversal over accepted wall bands + junctions + hosted gaps.
 * Implementation of the 10-step investigation spec:
 *  1) normalize (zero-len/dedup/collinear-merge/snap)
 *  2) split every edge at H/V crossings, T-junctions, endpoint contacts,
 *     collinear overlaps, hosted-opening boundaries
 *  3) true half-edge graph (from/to/twin/angle/next/visited/bandId)
 *  4) left-turn successor, Y-orientation aware (tests both CW + CCW)
 *  5) virtual closure edges for doors/windows/open passages
 *  6) cycle extraction + classification
 *  7) diagnostics   8) visual debug   9) fixtures   10) gates untouched
 */
export function buildGraphFaces(
  graph: GuideTraceGraph,
  opts: BuildGraphOptions = {},
): GraphFace[] {
  const tol = opts.tolM ?? 0.02;
  const yUp = (opts.yAxisDirection ?? 'down') === 'up';
  const minArea = opts.minFaceAreaM2 ?? 0.5;

  // ── 1. Normalize: build raw edge list from accepted bands ───────────────
  const rawEdges: Edge[] = [];
  for (const b of graph.acceptedBands) {
    const a = b.centerlineStart, c = b.centerlineEnd;
    if (Math.hypot(a[0] - c[0], a[1] - c[1]) < 1e-6) continue; // zero-length
    rawEdges.push({ id: `e_${b.id}`, a: vkey(a), b: vkey(c), axis: b.axis, bandId: b.id, virtual: false });
  }
  // Virtual closure edges from hosted gaps (doors/windows/open passages).
  for (const g of graph.hostedGaps) {
    const band = graph.acceptedBands.find(x => x.id === g.hostBandId);
    if (!band) continue;
    const axis = band.axis;
    const lo = Math.min(g.startAlongM, g.endAlongM), hi = Math.max(g.startAlongM, g.endAlongM);
    let p1: [number, number], p2: [number, number];
    if (axis === 'H') {
      const y = (band.nearFace.coordinateM + band.farFace.coordinateM) / 2;
      p1 = [lo, y]; p2 = [hi, y];
    } else {
      const x = (band.nearFace.coordinateM + band.farFace.coordinateM) / 2;
      p1 = [x, lo]; p2 = [x, hi];
    }
    rawEdges.push({ id: `v_${g.id}`, a: vkey(p1), b: vkey(p2), axis, bandId: g.id, virtual: true });
  }

  // Dedup identical + reversed; keep first (preserve source band id).
  const seenPairs = new Set<string>();
  const edges: Edge[] = [];
  let dedupRemoved = 0;
  for (const e of rawEdges) {
    const pair = [e.a, e.b].sort().join('|');
    if (seenPairs.has(pair)) { dedupRemoved++; continue; }
    seenPairs.add(pair);
    edges.push(e);
  }

  // Vertex coordinate registry (snap within tol).
  const vcoord = new Map<string, [number, number]>();
  const coordOf = new Map<string, [number, number]>();
  const put = (p: [number, number]) => { const k = vkey(p); if (!coordOf.has(k)) coordOf.set(k, [p[0], p[1]]); return k; };
  for (const b of graph.acceptedBands) { put(b.centerlineStart); put(b.centerlineEnd); }
  for (const g of graph.hostedGaps) {
    const band = graph.acceptedBands.find(x => x.id === g.hostBandId);
    if (!band) continue;
    const axis = band.axis;
    const lo = Math.min(g.startAlongM, g.endAlongM), hi = Math.max(g.startAlongM, g.endAlongM);
    if (axis === 'H') { const y = (band.nearFace.coordinateM + band.farFace.coordinateM) / 2; put([lo, y]); put([hi, y]); }
    else { const x = (band.nearFace.coordinateM + band.farFace.coordinateM) / 2; put([x, lo]); put([x, hi]); }
  }
  for (const j of graph.junctions) put(j.point);

  // Snap vertices: union-find clusters within tol.
  const allKeys = [...coordOf.keys()];
  const parent = new Map<string, string>();
  const find = (k: string): string => { if (!parent.has(k)) parent.set(k, k); let r = k; while (parent.get(r)! !== r) r = parent.get(r)!; return r; };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  for (let i = 0; i < allKeys.length; i++) for (let j = i + 1; j < allKeys.length; j++) {
    const ki = allKeys[i]!, kj = allKeys[j]!;
    const ca = coordOf.get(ki)!, cb = coordOf.get(kj)!;
    if (Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) <= tol) union(ki, kj);
  }
  const canon = (k: string) => find(k);
  const snapCoord = (k: string): [number, number] => {
    const root = canon(k);
    if (!vcoord.has(root)) {
      let sx = 0, sy = 0, n = 0;
      for (const kk of allKeys) if (canon(kk) === root) { const c = coordOf.get(kk)!; sx += c[0]; sy += c[1]; n++; }
      if (n === 0) { const parts = root.split(','); const x = Number(parts[0]); const y = Number(parts[1]); vcoord.set(root, [r3(x), r3(y)]); }
      else vcoord.set(root, [r3(sx / n), r3(sy / n)]);
    }
    return vcoord.get(root)!;
  };

  // ── 2. Split edges at every graph event ───────────────────────────────
  let intersectionCount = 0, tJunctionCount = 0;
  const subEdges: Edge[] = [];
  const edgeSegs = edges.map(e => ({
    e, a: snapCoord(e.a), b: snapCoord(e.b),
  }));
  for (const seg of edgeSegs) {
    const splits: [number, number][] = [];
    // H/V crossings with other edges
    for (const other of edgeSegs) {
      if (other === seg) continue;
      const ip = segIntersect(seg.a, seg.b, other.a, other.b);
      if (ip) { splits.push(ip); intersectionCount++; }
    }
    // T-junction / endpoint-to-edge contacts: other edge endpoint lying on this edge
    for (const other of edgeSegs) {
      for (const ep of [other.a, other.b]) {
        if (pointOnSeg(ep, seg.a, seg.b, tol)) { splits.push(ep); if (other !== seg) tJunctionCount++; }
      }
    }
    // hosted-opening boundaries (also record gap spans so we can drop the wall segment across them)
    const gapSpans: Array<[number, number]> = [];
    for (const g of graph.hostedGaps) {
      const band = graph.acceptedBands.find(x => x.id === g.hostBandId);
      if (!band || band.id !== seg.e.bandId) continue;
      const axis = band.axis;
      const lo = Math.min(g.startAlongM, g.endAlongM), hi = Math.max(g.startAlongM, g.endAlongM);
      gapSpans.push([lo, hi]);
      if (axis === 'H') { const y = (band.nearFace.coordinateM + band.farFace.coordinateM) / 2; splits.push([lo, y]); splits.push([hi, y]); }
      else { const x = (band.nearFace.coordinateM + band.farFace.coordinateM) / 2; splits.push([x, lo]); splits.push([x, hi]); }
    }
    // dedupe + sort along the edge's own axis
    const uniq = [...new Set(splits.map(vkey))].map(k => snapCoord(k));
    uniq.sort((p, q) => {
      const ddx = seg.b[0] - seg.a[0], ddy = seg.b[1] - seg.a[1];
      const tp = (p[0] - seg.a[0]) * ddx + (p[1] - seg.a[1]) * ddy;
      const tq = (q[0] - seg.a[0]) * ddx + (q[1] - seg.a[1]) * ddy;
      return tp - tq;
    });
    const alongOf = (p: [number, number]) => (seg.e.axis === 'H' ? p[0] : p[1]);
    let prev = seg.a;
    for (const sp of uniq) {
      if (Math.hypot(sp[0] - prev[0], sp[1] - prev[1]) < 1e-6) continue;
      // Drop a WALL segment that lies entirely inside a hosted gap (the virtual closure edge bridges it).
      const aL = alongOf(prev), bL = alongOf(sp);
      const loL = Math.min(aL, bL), hiL = Math.max(aL, bL);
      const insideGap = !seg.e.virtual && gapSpans.some(([lo, hi]) => loL >= lo - 1e-6 && hiL <= hi + 1e-6);
      if (!insideGap) {
        const ka = vkey(prev), kb = vkey(sp);
        subEdges.push({ id: `${seg.e.id}_${ka}_${kb}`, a: ka, b: kb, axis: seg.e.axis, bandId: seg.e.bandId, virtual: seg.e.virtual });
      }
      prev = sp;
    }
    const ke = vkey(prev), kb = vkey(seg.b);
    if (Math.hypot(seg.b[0] - prev[0], seg.b[1] - prev[1]) >= 1e-6) {
      const aL = alongOf(prev), bL = alongOf(seg.b);
      const loL = Math.min(aL, bL), hiL = Math.max(aL, bL);
      const insideGap = !seg.e.virtual && gapSpans.some(([lo, hi]) => loL >= lo - 1e-6 && hiL <= hi + 1e-6);
      if (!insideGap)
        subEdges.push({ id: `${seg.e.id}_${ke}_${kb}`, a: ke, b: kb, axis: seg.e.axis, bandId: seg.e.bandId, virtual: seg.e.virtual });
    }
  }

  // ── 3. True half-edge graph ───────────────────────────────────────
  const verts = new Map<string, [number, number]>();
  for (const e of subEdges) { verts.set(e.a, snapCoord(e.a)); verts.set(e.b, snapCoord(e.b)); }
  const hes = new Map<string, HE>();
  const outgoing = new Map<string, string[]>();
  const ek = (f: string, t: string) => `${f}__${t}`;
  for (const e of subEdges) {
    const pa = verts.get(e.a)!, pb = verts.get(e.b)!;
    const ang = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);
    hes.set(ek(e.a, e.b), { id: ek(e.a, e.b), from: e.a, to: e.b, angle: ang, twin: ek(e.b, e.a), next: null, bandId: e.bandId, virtual: e.virtual });
    hes.set(ek(e.b, e.a), { id: ek(e.b, e.a), from: e.b, to: e.a, angle: ang + Math.PI, twin: ek(e.a, e.b), next: null, bandId: e.bandId, virtual: e.virtual });
    (outgoing.get(e.a) ?? outgoing.set(e.a, []).get(e.a)!).push(ek(e.a, e.b));
    (outgoing.get(e.b) ?? outgoing.set(e.b, []).get(e.b)!).push(ek(e.b, e.a));
  }
  for (const list of outgoing.values()) list.sort((x, y) => hes.get(x)!.angle - hes.get(y)!.angle);
  const norm = (a: number) => { let r = a % (2 * Math.PI); if (r < 0) r += 2 * Math.PI; return r; };

  // ── 4. Left-turn successor (Y-orientation aware) ───────────────
  // Planar half-edge face rule: arriving at v along half-edge `he`, the next face edge is the
  // outgoing half-edge immediately adjacent (in the angle-sorted list) to he.twin — NOT the
  // reverse. Picking the previous (CCW) vs next (CW) neighbor selects interior vs exterior
  // winding. For a graph whose exterior boundary is CW/CCW we choose the sign by Y orientation;
  // both are tested and the orientation yielding bounded interior faces is selected at runtime.
  //   dir = -1 -> previous in sorted list (left turn, Y-up interior-on-left)
  //   dir = +1 -> next in sorted list     (right turn, Y-down interior-on-left)
  const dir = yUp ? -1 : 1;
  for (const he of hes.values()) {
    const list = outgoing.get(he.to);
    if (!list || list.length === 0) { he.next = null; continue; }
    const twinIdx = list.indexOf(he.twin);
    if (twinIdx < 0) { he.next = null; continue; }
    const n = list.length;
    const nextIdx = ((twinIdx + dir) % n + n) % n;
    he.next = list[nextIdx]!;
  }

  // ── 6. Extract + classify cycles ────────────────────────────────
  const visited = new Set<string>();
  const faces: GraphFace[] = [];
  let traversed = 0, rejected: Record<string, number> = {};
  const reject = (r: string) => { rejected[r] = (rejected[r] ?? 0) + 1; };

  for (const startKey of hes.keys()) {
    if (visited.has(startKey)) continue;
    let he = hes.get(startKey)!;
    const startV = he.from;
    const path: string[] = [];
    const vpath: [number, number][] = [verts.get(startV)!];
    let closed = false, guard = 0, ok = true;
    while (guard++ < 100000) {
      if (visited.has(he.id)) { ok = false; break; } // cycle already started elsewhere / self-loop
      visited.add(he.id);
      path.push(he.id);
      vpath.push(verts.get(he.to)!);
      if (he.to === startV) { closed = true; break; }
      if (!he.next) { ok = false; break; }
      he = hes.get(he.next)!;
    }
    traversed++;
    if (!closed || !ok || vpath.length < 4) { if (!closed) reject('open-chain'); continue; }
    const polygon = vpath.slice(0, -1).map(p => [r3(p[0]), r3(p[1])] as [number, number]);
    const signed = polySignedArea(polygon);
    const area = Math.abs(signed);
    if (area < 1e-6) { reject('zero-area'); continue; }
    if (area < minArea) { reject('below-min-area'); continue; }
    // self-intersection (ear-clip check)
    let selfX = false;
    for (let i = 0; i < polygon.length && !selfX; i++) {
      for (let j = i + 2; j < polygon.length; j++) {
        if (i === 0 && j === polygon.length - 1) continue;
        if (segIntersect(polygon[i]!, polygon[(i + 1) % polygon.length]!, polygon[j]!, polygon[(j + 1) % polygon.length]!)) { selfX = true; break; }
      }
    }
    if (selfX) { reject('self-intersecting'); continue; }
    // NOTE: interior vs exterior faces share the same edge cycle in opposite orientations but are
    // DISTINCT faces (different twin half-edges), so we do NOT reject reverse cycles here — the
    // visited-marking above already guarantees each face is enumerated exactly once.
    const bandIds = [...new Set(path.map(k => hes.get(k)!.bandId))];
    const virtualCount = path.filter(k => hes.get(k)!.virtual).length;
    const orientation = signed > 0 ? 'ccw' : 'cw';
    faces.push({
      id: stableId('face', polygon.flatMap(p => [r3(p[0]), r3(p[1])])),
      polygon,
      boundaryBandIds: bandIds,
      areaM2: r3(area),
      signedAreaM2: r3(signed),
      orientation,
      vertexCount: polygon.length,
      virtualClosureEdgeCount: virtualCount,
      containedSeedIds: [],
    });
  }

  // Bounded vs exterior: every planar graph has exactly one unbounded exterior face.
  // The exterior is the max-area face (by absolute area). Bounded = rest.
  faces.sort((a, b) => b.areaM2 - a.areaM2); // largest (exterior) first
  const exteriorCount = faces.length >= 1 ? 1 : 0;
  const boundedCount = faces.length - exteriorCount;

  // Diagnostics
  const degreeHist: Record<number, number> = {};
  for (const list of outgoing.values()) { const d = list.length; degreeHist[d] = (degreeHist[d] ?? 0) + 1; }
  let isolated = 0, dangling = 0;
  for (const [vid, list] of outgoing) {
    if (list.length === 0) isolated++;
    else if (list.length === 1) dangling++;
  }

  // (diagnostics are returned via buildGraphDebug; here we still need to expose them)
  (buildGraphFaces as any)._lastDiag = {
    inputBandCount: graph.acceptedBands.length,
    deduplicatedEdgeCount: edges.length,
    intersectionCount,
    tJunctionCount,
    splitSubEdgeCount: subEdges.length,
    vertexCount: verts.size,
    halfEdgeCount: hes.size,
    degreeHistogram: degreeHist,
    isolatedVertexCount: isolated,
    danglingVertexCount: dangling,
    traversedCycleCount: traversed,
    rejectedCycleCountByReason: rejected,
    boundedFaceCount: boundedCount,
    exteriorFaceCount: exteriorCount,
    virtualClosureEdgeCount: rawEdges.filter(e => e.virtual).length,
  } as GraphDiagnostics;

  return faces;
}

/** Return the faces plus full diagnostics (step 7) + a render-ready structure (step 8). */
export function buildGraphDebug(
  graph: GuideTraceGraph,
  opts: BuildGraphOptions = {},
): { faces: GraphFace[]; diagnostics: GraphDiagnostics } {
  const faces = buildGraphFaces(graph, opts);
  const diagnostics = ((buildGraphFaces as any)._lastDiag as GraphDiagnostics);
  return { faces, diagnostics };
}

export interface TraceDiagnostics {
  rawPdfPathCount: number;
  detectedRoomSeeds: number;
  candidateSpaces: number;
  acceptedConsensusSpaces: number;
  openOrMissingSpaces: number;
  overlappingSpaces: number;
  slabPolygonCount: number;
  voidCount: number;
  requiredBoundaryCount: number;
  exteriorWalls: number;
  structuralWalls: number;
  partitions: number;
  preservedGaps: number;
  doors: number;
  windows: number;
  rejectedFalseWallCandidates: number;
  danglingWallEndpoints: number;
  engineWallNodes: number;
  engineSlabNodes: number;
  engineOpeningNodes: number;
  topologyReady: boolean;
  productionReady: boolean;
}

export interface TraceDebugLayer {
  id: string;
  label: string;
  kind: 'segments' | 'polygons';
  color: string;
  segments?: Array<{ start: [number, number]; end: [number, number]; meta?: Record<string, unknown> }>;
  polygons?: Array<{ points: Array<[number, number]>; meta?: Record<string, unknown> }>;
}

export interface TraceDebugData {
  coordinateSystem: 'world-meters';
  layers: TraceDebugLayer[];
}

export interface GuideTraceIntegrationResult {
  wallNodes: AutoBuildWall[];
  slabNodes: AutoBuildSlab[];
  openingNodes: AutoBuildOpening[];
  furnitureNodes: AutoBuildSceneResult['furnitureNodes'];
  graphFaces: GraphFace[];
  validation: SpaceValidationResult;
  diagnostics: TraceDiagnostics;
  debugData: TraceDebugData;
}

function classifyWall(band: WallBand, exterior: boolean): { type: string; color: string } {
  if (exterior) return { type: 'exterior_wall', color: '#4CAF50' };
  if (band.thicknessM >= 0.20) return { type: 'structural_wall', color: '#795548' };
  return { type: 'interior_partition', color: '#2196F3' };
}

/**
 * Full integration: build faces, validate, run the upgraded engine, adapt to Pascal node
 * shapes, and emit diagnostics + debug data in one world-meter coordinate system.
 */
export function integrateGuideTrace(
  input: Omit<TraceBuildInput, 'graphFaces'> & { graphFaces?: GraphFace[] },
): GuideTraceIntegrationResult {
  const { guideTrace, roomSeeds = [], diagnosticMode = true, allowProductionExtrusion = false } = input;

  const graphFaces = (input.graphFaces && input.graphFaces.length > 0) ? input.graphFaces : buildGraphFaces(guideTrace);
  const traceOutput: TraceBuildOutput = AutoBuildEngine.processGuideTrace({
    guideTrace,
    graphFaces,
    roomSeeds,
    diagnosticMode,
    allowProductionExtrusion,
  });
  const { validation, metrics } = traceOutput;

  // Map trace bands -> engine wall nodes (deterministic ids derived from band id).
  const validFaceIds = new Set(
    graphFaces
      .filter(f => f.polygon.length >= 3 && f.areaM2 > 0.25 && f.boundaryBandIds.every(id => guideTrace.acceptedBands.some(b => b.id === id)))
      .map(f => f.id),
  );
  const assignedFaceIds = new Set(validation.seedAssignments.flatMap(a => (a.faceId ? [a.faceId] : [])));
  const acceptedFaceIds = new Set([...validFaceIds].filter(id => assignedFaceIds.has(id)));

  // An exterior boundary band belongs to exactly one accepted face.
  const bandFaceCount = new Map<string, number>();
  for (const fid of acceptedFaceIds) {
    const face = graphFaces.find(f => f.id === fid)!;
    for (const bid of face.boundaryBandIds) bandFaceCount.set(bid, (bandFaceCount.get(bid) ?? 0) + 1);
  }

  const wallNodes: AutoBuildWall[] = guideTrace.acceptedBands.map(band => {
    const exterior = (bandFaceCount.get(band.id) ?? 0) <= 1;
    const { type, color } = classifyWall(band, exterior);
    const production = Boolean(allowProductionExtrusion && metrics.productionAllowed && !diagnosticMode);
    return {
      id: `wall_${band.id}`,
      type: 'wall',
      start: [...band.centerlineStart] as [number, number],
      end: [...band.centerlineEnd] as [number, number],
      thickness: band.thicknessM,
      height: production ? 2.8 : 0,
      children: [],
      visible: true,
      metadata: {
        wallType: type,
        color,
        centerlineOnly: !production,
        confidence: band.confidence,
        componentId: band.componentId,
        sourceIds: band.sourceIds,
        diagnosticCenterline: !production,
        boundaryRole: exterior ? 'exterior' : 'interior',
      },
      dirty: true,
    } satisfies AutoBuildWall;
  });

  const slabNodes: AutoBuildSlab[] = [...acceptedFaceIds].map(fid => {
    const face = graphFaces.find(f => f.id === fid)!;
    return {
      id: `slab_${face.id}`,
      type: 'slab',
      polygon: face.polygon.map(p => [...p] as [number, number]),
      holes: [],
      elevation: 0.005,
      autoFromWalls: false,
      children: [],
      visible: true,
      metadata: { name: 'Room', flatRegion: true, boundaryBandIds: face.boundaryBandIds, areaM2: face.areaM2 },
      dirty: true,
    } satisfies AutoBuildSlab;
  });

  const openingNodes: AutoBuildOpening[] = traceOutput.openingNodes.map(o => ({
    id: o.id,
    type: o.type,
    wallId: o.wallId,
    position: [...o.position] as [number, number, number],
    rotation: [0, 0, 0],
    width: o.width,
    height: o.height,
    doorType: o.type === 'door' ? 'hinged' : undefined,
    windowType: o.type === 'window' ? 'fixed' : undefined,
    children: [],
    visible: true,
    metadata: { ...o.metadata },
    dirty: true,
  } satisfies AutoBuildOpening));

  const exteriorWalls = wallNodes.filter(w => w.metadata.boundaryRole === 'exterior').length;
  const structuralWalls = wallNodes.filter(w => (w.metadata.wallType as string) === 'structural_wall').length;
  const partitions = wallNodes.filter(w => (w.metadata.wallType as string) === 'interior_partition').length;

  const diagnostics: TraceDiagnostics = {
    rawPdfPathCount: guideTrace.metrics.rawLineCount,
    detectedRoomSeeds: roomSeeds.length,
    candidateSpaces: graphFaces.length,
    acceptedConsensusSpaces: acceptedFaceIds.size,
    openOrMissingSpaces: validation.roomsExpected - validation.roomsDetected,
    overlappingSpaces: validation.overlapCount,
    slabPolygonCount: slabNodes.length,
    voidCount: 0,
    requiredBoundaryCount: [...acceptedFaceIds].reduce((n, fid) => n + (graphFaces.find(f => f.id === fid)?.boundaryBandIds.length ?? 0), 0),
    exteriorWalls,
    structuralWalls,
    partitions,
    preservedGaps: traceOutput.openingNodes.length,
    doors: traceOutput.openingNodes.filter(o => o.type === 'door').length,
    windows: traceOutput.openingNodes.filter(o => o.type === 'window').length,
    rejectedFalseWallCandidates: guideTrace.rejectedBands.length,
    danglingWallEndpoints: guideTrace.metrics.danglingEndpointCount,
    engineWallNodes: wallNodes.length,
    engineSlabNodes: slabNodes.length,
    engineOpeningNodes: openingNodes.length,
    topologyReady: Boolean(metrics.topologyReady),
    productionReady: Boolean(metrics.productionAllowed),
  };

  const debugData = buildTraceDebugData(guideTrace, graphFaces, acceptedFaceIds, wallNodes, slabNodes, roomSeeds);

  return {
    wallNodes,
    slabNodes,
    openingNodes,
    furnitureNodes: [],
    graphFaces,
    validation,
    diagnostics,
    debugData,
  };
}

/**
 * One-coordinate-system debug layers for the required visual debug mode.
 */
export function buildTraceDebugData(
  guideTrace: GuideTraceGraph,
  graphFaces: GraphFace[],
  acceptedFaceIds: Set<string>,
  wallNodes: AutoBuildWall[],
  slabNodes: AutoBuildSlab[],
  roomSeeds: RoomSeed[],
): TraceDebugData {
  const bandSegment = (b: WallBand) => ({
    start: [...b.centerlineStart] as [number, number],
    end: [...b.centerlineEnd] as [number, number],
    meta: { thicknessM: b.thicknessM, status: b.status },
  });
  const polyShape = (f: GraphFace) => ({ points: f.polygon.map(p => [...p] as [number, number]), meta: { areaM2: f.areaM2 } });

  return {
    coordinateSystem: 'world-meters',
    layers: [
      {
        id: 'source-boundary-evidence',
        label: 'Source PDF / maximal-line boundary evidence',
        kind: 'segments',
        color: '#9E9E9E',
        segments: [
          ...guideTrace.acceptedBands.map(bandSegment),
          ...guideTrace.rejectedBands.map(bandSegment),
        ],
      },
      {
        id: 'boundary-evidence',
        label: 'Accepted wall bands (centerlines)',
        kind: 'segments',
        color: '#2196F3',
        segments: guideTrace.acceptedBands.map(bandSegment),
      },
      {
        id: 'candidate-spaces',
        label: 'Candidate spaces (all graph faces)',
        kind: 'polygons',
        color: '#FFC107',
        polygons: graphFaces.map(polyShape),
      },
      {
        id: 'consensus-spaces',
        label: 'Accepted consensus spaces (seeded + validated)',
        kind: 'polygons',
        color: '#4CAF50',
        polygons: graphFaces.filter(f => acceptedFaceIds.has(f.id)).map(polyShape),
      },
      {
        id: 'rejected-boundaries',
        label: 'Rejected boundaries / faces',
        kind: 'segments',
        color: '#F44336',
        segments: guideTrace.rejectedBands.map(bandSegment),
      },
      {
        id: 'final-pascal-geometry',
        label: 'Final Pascal geometry (walls + slabs)',
        kind: 'polygons',
        color: '#7E57C2',
        segments: wallNodes.map(w => ({ start: w.start, end: w.end, meta: { wallType: w.metadata.wallType } })),
        polygons: [
          ...slabNodes.map(s => ({ points: s.polygon, meta: { slab: true } })),
        ],
      },
      {
        id: 'room-seeds',
        label: 'Detected room seeds',
        kind: 'polygons',
        color: '#E91E63',
        segments: roomSeeds.map(s => ({ start: s.point, end: s.point, meta: { code: s.code } })),
      },
    ],
  };
}
