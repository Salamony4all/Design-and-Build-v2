/**
 * Curved walls, curved glass partitions and circular pods, read from the drawing's
 * own curve geometry (no raster, no AI).
 *
 * CAD exports every arc as cubic Béziers. Each Bézier that is a circular arc is
 * fitted with a circle, consecutive pieces of one path are chained, chains on the
 * same circle are merged into rings, and two concentric rings a wall thickness apart
 * over the same angles make a curved wall. Thin faces a few centimetres apart are a
 * glass partition. Wall pieces on one circle that enclose most of it are a pod.
 *
 * Coordinates are MuPDF page points (y down). Angles are radians in that frame.
 */
import type { MuVector, Vec2 } from './vector-device';

export type CurvedWallKind = 'solid' | 'glass';
export type CurvedFaceStyle = 'heavy' | 'thin';

export interface CurvedWallConfig {
  /** a stroke at or above this drawn width (points) is a heavy line */
  heavyStrokePt: number;
  /** lines whose brightest colour channel is above this are grey / coloured: furniture, finishes, hatches */
  maxLineShade: number;
  minThicknessM: number;
  maxThicknessM: number;
  /** the gap between the faces may vary this much along the arc (tapered walls, CAD offsets) */
  maxThicknessSpreadM: number;
  minArcLengthM: number;
  minRadiusM: number;
  maxRadiusM: number;
  /** two thin faces no further apart than this are glass */
  maxGlassThicknessM: number;
  podMinRadiusM: number;
  podMaxRadiusM: number;
  /** wall pieces on one circle enclosing at least this much of it make a pod */
  podMinCoverDeg: number;
  /** ...or all the dark lines in that wall band together close this much of the circle */
  podBandCoverDeg: number;
}

export const CURVED_WALL_DEFAULTS: CurvedWallConfig = {
  heavyStrokePt: 0.9,
  maxLineShade: 0.2,
  minThicknessM: 0.03,
  maxThicknessM: 0.4,
  maxThicknessSpreadM: 0.15,
  minArcLengthM: 0.4,
  minRadiusM: 0.5,
  maxRadiusM: 60,
  maxGlassThicknessM: 0.12,
  podMinRadiusM: 1.0,
  podMaxRadiusM: 6.0,
  podMinCoverDeg: 220,
  podBandCoverDeg: 240,
};

/** One curved wall: the band between two concentric faces over the angles [a0, a1]. */
export interface CurvedWallSegment {
  id: string;
  center: Vec2;
  /** centreline radius, points */
  radiusPt: number;
  thicknessPt: number;
  /** start and end angle (radians, page frame, a0 < a1; a1 may exceed 2π) */
  a0: number;
  a1: number;
  kind: CurvedWallKind;
  faceStyles: [CurvedFaceStyle, CurvedFaceStyle];
  sourceOperationIds: string[];
  podId?: string;
  radiusM: number;
  thicknessM: number;
  lengthM: number;
}

export interface CurvedPod {
  id: string;
  center: Vec2;
  radiusM: number;
  /** how much of the circle the walls close, degrees (the rest is the door / opening) */
  enclosedDeg: number;
  segmentIds: string[];
}

export interface CurvedWallResult {
  segments: CurvedWallSegment[];
  pods: CurvedPod[];
  diagnostics: {
    circularPieces: number;
    chains: number;
    rings: number;
    facePairs: number;
    segments: number;
    pods: number;
  };
}

/** A curved wall cut into Pascal walls: start/end on the plan plus the arc's sagitta. */
export interface CurvedWallPiece {
  id: string;
  segmentId: string;
  podId?: string;
  kind: CurvedWallKind;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Pascal WallNode.curveOffset: signed sagitta of the arc, metres */
  curveOffset: number;
  thicknessM: number;
  lengthM: number;
  sourceOperationIds: string[];
}

type Interval = [number, number];

interface Chain {
  c: Vec2;
  r: number;
  iv: Interval[];
  style: CurvedFaceStyle;
  op: string;
}

interface Ring {
  c: Vec2;
  r: number;
  style: CurvedFaceStyle;
  iv: Interval[];
  ops: Set<string>;
}

interface Band {
  c: Vec2;
  rIn: number;
  rOut: number;
  a0: number;
  a1: number;
  kind: CurvedWallKind;
  styles: [CurvedFaceStyle, CurvedFaceStyle];
  ops: string[];
}

const TAU = Math.PI * 2;
const BEZIER_SAMPLES = 10;

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const wrapPi = (a: number) => {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x <= -Math.PI) x += TAU;
  return x;
};
const mod = (a: number, m: number) => ((a % m) + m) % m;

function bezierPoints(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, n = BEZIER_SAMPLES): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

/** Algebraic least-squares circle (centred for stability); err is the worst radial miss. */
export function fitCircle(pts: Vec2[]): { c: Vec2; r: number; err: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  sx /= n; sy /= n;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p.x - sx, v = p.y - sy;
    suu += u * u; suv += u * v; svv += v * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  const scale = suu + svv;
  if (!(scale > 0) || Math.abs(det) < 1e-12 * scale * scale) return null;
  const uc = (0.5 * (suuu + suvv) * svv - 0.5 * (svvv + svuu) * suv) / det;
  const vc = (0.5 * (svvv + svuu) * suu - 0.5 * (suuu + suvv) * suv) / det;
  const c = { x: uc + sx, y: vc + sy };
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  if (!Number.isFinite(r)) return null;
  let err = 0;
  for (const p of pts) err = Math.max(err, Math.abs(dist(p, c) - r));
  return { c, r, err };
}

/** Brightest channel of a MuPDF colour (gray, RGB or CMYK); 0 = black. */
export function colourShade(color?: number[]): number {
  if (!color || color.length === 0) return 0;
  if (color.length === 1) return color[0]!;
  if (color.length === 4) {
    const [c, m, y, k] = color as [number, number, number, number];
    return Math.max((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
  }
  return Math.max(color[0]!, color[1]!, color[2]!);
}

function faceStyle(v: MuVector, cfg: CurvedWallConfig): CurvedFaceStyle | null {
  if (colourShade(v.color) > cfg.maxLineShade) return null;
  if (v.alpha !== undefined && v.alpha < 0.5) return null;
  if (v.operation === 'fill-path') return 'heavy';
  const w = v.strokeWidthPt ?? v.strokeWidth ?? 0;
  return w >= cfg.heavyStrokePt ? 'heavy' : 'thin';
}

/** Angular intervals (radians, any range) merged inside [0, 2π); a run crossing 0 stays one interval. */
export function mergeIntervals(iv: Interval[]): Interval[] {
  const segs: Interval[] = [];
  for (const [a0, a1] of iv) {
    const lo = Math.min(a0, a1), len = Math.abs(a1 - a0);
    if (len >= TAU - 1e-3) return [[0, TAU]];
    const s = mod(lo, TAU), e = s + len;
    if (e > TAU) segs.push([s, TAU], [0, e - TAU]);
    else segs.push([s, e]);
  }
  segs.sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [lo, hi] of segs) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 0.02) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  if (out.length === 1 && out[0]![1] - out[0]![0] >= TAU - 0.02) return [[0, TAU]];
  if (out.length >= 2 && out[0]![0] <= 0.02 && out[out.length - 1]![1] >= TAU - 0.02) {
    const first = out.shift()!;
    out[out.length - 1]![1] = TAU + first[1];
  }
  return out;
}

export const coverage = (iv: Interval[]) => iv.reduce((s, [lo, hi]) => s + (hi - lo), 0);

function intersect(iv1: Interval[], iv2: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [a0, a1] of iv1) {
    for (const [b0, b1] of iv2) {
      for (const s of [0, TAU, -TAU]) {
        const lo = Math.max(a0, b0 + s), hi = Math.min(a1, b1 + s);
        if (hi > lo + 1e-3) out.push([lo, hi]);
      }
    }
  }
  return mergeIntervals(out);
}

/** Runs of consecutive circular Bézier pieces in one path, refitted as one arc. */
function findChains(vectors: MuVector[], cfg: CurvedWallConfig, mPerPt: number) {
  const chains: Chain[] = [];
  let pieces = 0;
  const maxR = cfg.maxRadiusM / mPerPt;
  for (const v of vectors) {
    const cmds = v.commands as Array<Record<string, any>> | undefined;
    if (!cmds || !cmds.some((c) => c.op === 'C')) continue;
    const style = faceStyle(v, cfg);
    if (!style) continue;
    let cur: { c: Vec2; r: number; pts: Vec2[] } | null = null;
    let last: Vec2 | null = null;
    let subStart: Vec2 | null = null;
    const close = () => {
      if (cur) {
        const f = fitCircle(cur.pts);
        if (f && f.err <= Math.max(0.25, 0.004 * f.r)) {
          let prev = Math.atan2(cur.pts[0]!.y - f.c.y, cur.pts[0]!.x - f.c.x);
          let acc = prev, lo = prev, hi = prev;
          for (let i = 1; i < cur.pts.length; i++) {
            const a = Math.atan2(cur.pts[i]!.y - f.c.y, cur.pts[i]!.x - f.c.x);
            acc += wrapPi(a - prev);
            prev = a;
            lo = Math.min(lo, acc); hi = Math.max(hi, acc);
          }
          chains.push({ c: f.c, r: f.r, iv: mergeIntervals([[lo, hi]]), style, op: v.sourceRootId ?? v.id });
        }
      }
      cur = null;
    };
    for (const c of cmds) {
      if (c.op === 'M') { close(); last = { x: c.x, y: c.y }; subStart = last; }
      else if (c.op === 'L') { close(); last = { x: c.x, y: c.y }; }
      else if (c.op === 'Z') { close(); last = subStart; }
      else if (c.op === 'C') {
        const p1 = c.p1 as Vec2, p2 = c.p2 as Vec2, p3 = c.p3 as Vec2;
        if (!last) { last = p3; continue; }
        const pts = bezierPoints(last, p1, p2, p3);
        last = p3;
        const f = dist(pts[0]!, pts[pts.length - 1]!) >= 0.5 ? fitCircle(pts) : null;
        const ok = !!f && f.r > 1 && f.r < maxR && f.err <= Math.max(0.15, 0.004 * f.r);
        if (ok) pieces++;
        if (ok && cur) {
          const k: { c: Vec2; r: number; pts: Vec2[] } = cur;
          if (dist(f!.c, k.c) < Math.max(2, 0.02 * f!.r) && Math.abs(f!.r - k.r) < Math.max(0.8, 0.01 * f!.r)) {
            k.pts.push(...pts);
            continue;
          }
        }
        close();
        cur = ok ? { c: f!.c, r: f!.r, pts } : null;
      }
    }
    close();
  }
  return { chains, pieces };
}

/** Chains of one style on one circle -> a ring with merged angular coverage. */
function findRings(chains: Chain[], minGapPt: number): Ring[] {
  const rings: Ring[] = [];
  for (const ch of [...chains].sort((a, b) => b.r - a.r)) {
    const tolR = Math.min(Math.max(0.8, 0.004 * ch.r), 0.45 * minGapPt);
    const g = rings.find((g) => g.style === ch.style && Math.abs(g.r - ch.r) < tolR && dist(g.c, ch.c) < Math.max(2.5, 0.025 * ch.r));
    if (g) {
      g.iv.push(...ch.iv);
      g.ops.add(ch.op);
    } else {
      rings.push({ c: ch.c, r: ch.r, style: ch.style, iv: [...ch.iv], ops: new Set([ch.op]) });
    }
  }
  for (const g of rings) g.iv = mergeIntervals(g.iv);
  return rings;
}

/** Two concentric faces a wall thickness apart over the same angles = a curved wall. */
function pairFaces(rings: Ring[], cfg: CurvedWallConfig, mPerPt: number): { bands: Band[]; pairs: number } {
  const M = (pt: number) => pt * mPerPt;
  const bands: Band[] = [];
  let pairs = 0;
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const a = rings[i]!, b = rings[j]!;
      const [inner, outer] = a.r < b.r ? [a, b] : [b, a];
      if (M(outer.r - inner.r) > cfg.maxThicknessM + 0.05) continue;
      // Faces need not share a centre exactly (CAD offsets, tapered walls): the real gap is measured below.
      if (dist(a.c, b.c) > Math.max(3, 0.05 * outer.r)) continue;
      const rm = (inner.r + outer.r) / 2;
      for (const [lo, hi] of intersect(inner.iv, outer.iv)) {
        if (M(rm * (hi - lo)) < cfg.minArcLengthM) continue;
        const gaps: number[] = [];
        for (let k = 0; k < 9; k++) {
          const t = lo + ((hi - lo) * k) / 8;
          const p = { x: inner.c.x + inner.r * Math.cos(t), y: inner.c.y + inner.r * Math.sin(t) };
          gaps.push(M(Math.abs(dist(p, outer.c) - outer.r)));
        }
        gaps.sort((x, y) => x - y);
        const med = gaps[4]!;
        if (med < cfg.minThicknessM || med > cfg.maxThicknessM) continue;
        if (gaps[8]! - gaps[0]! > cfg.maxThicknessSpreadM) continue;
        pairs++;
        const t = med / mPerPt;
        const kind: CurvedWallKind = inner.style === 'thin' && outer.style === 'thin' && med <= cfg.maxGlassThicknessM ? 'glass' : 'solid';
        bands.push({
          c: { x: (inner.c.x + outer.c.x) / 2, y: (inner.c.y + outer.c.y) / 2 },
          rIn: rm - t / 2,
          rOut: rm + t / 2,
          a0: lo,
          a1: hi,
          kind,
          styles: [inner.style, outer.style],
          ops: [...new Set([...inner.ops, ...outer.ops])].sort(),
        });
      }
    }
  }
  // A face pair can match twice (a three-line glass wall, a finish line): keep the widest band per span.
  bands.sort((x, y) => (y.rOut - y.rIn) - (x.rOut - x.rIn) || x.c.y - y.c.y || x.c.x - y.c.x || x.a0 - y.a0);
  const kept: Band[] = [];
  for (const s of bands) {
    const dup = kept.some((k) => Math.abs(k.c.x - s.c.x) < 4 && Math.abs(k.c.y - s.c.y) < 4
      && k.rIn - 1 <= s.rIn && s.rOut <= k.rOut + 1
      && intersect([[s.a0, s.a1]], [[k.a0, k.a1]]).length > 0);
    if (!dup) kept.push(s);
  }
  return { bands: kept, pairs };
}

/** Find curved walls, glass partitions and pods in the captured page vectors. */
export function detectCurvedWalls(
  input: { vectors: MuVector[]; scaleMmPerPt: number },
  config: Partial<CurvedWallConfig> = {},
): CurvedWallResult {
  const cfg = { ...CURVED_WALL_DEFAULTS, ...config };
  const mPerPt = input.scaleMmPerPt / 1000;
  const empty: CurvedWallResult = { segments: [], pods: [], diagnostics: { circularPieces: 0, chains: 0, rings: 0, facePairs: 0, segments: 0, pods: 0 } };
  if (!(mPerPt > 0) || !Number.isFinite(mPerPt)) return empty;
  const M = (pt: number) => pt * mPerPt;

  const { chains, pieces } = findChains(input.vectors, cfg, mPerPt);
  const rings = findRings(chains, cfg.minThicknessM / mPerPt);
  const { bands: all, pairs } = pairFaces(rings, cfg, mPerPt);
  const bands = all.filter((b) => M((b.rIn + b.rOut) / 2) >= cfg.minRadiusM);

  // Pods: pieces on one circle that close most of it.
  interface Group { c: Vec2; r: number; members: Band[] }
  const groups: Group[] = [];
  for (const s of bands) {
    const rm = (s.rIn + s.rOut) / 2;
    const g = groups.find((g) => dist(g.c, s.c) < Math.max(4, 0.03 * rm) && Math.abs(g.r - rm) < 0.08 * rm);
    if (g) g.members.push(s);
    else groups.push({ c: s.c, r: rm, members: [s] });
  }
  const podOf = new Map<Band, Group>();
  const podGroups: Group[] = [];
  const inPodRange = (rPt: number) => M(rPt) >= cfg.podMinRadiusM && M(rPt) <= cfg.podMaxRadiusM;
  for (const g of groups) {
    const cov = coverage(mergeIntervals(g.members.map((s) => [s.a0, s.a1] as Interval)));
    if (cov >= (cfg.podMinCoverDeg * Math.PI) / 180 && inPodRange(g.r)) {
      podGroups.push(g);
      for (const s of g.members) podOf.set(s, g);
    }
  }
  // ...or whose wall band (every dark ring near that radius) closes most of the circle.
  for (const g of groups) {
    if (podGroups.includes(g) || !inPodRange(g.r)) continue;
    const band = rings.filter((x) => dist(x.c, g.c) < Math.max(4, 0.03 * g.r) && Math.abs(x.r - g.r) < Math.max(6, 0.04 * g.r));
    const cov = coverage(mergeIntervals(band.flatMap((x) => x.iv)));
    if (cov < (cfg.podBandCoverDeg * Math.PI) / 180) continue;
    const host = podGroups.find((p) => dist(p.c, g.c) < Math.max(4, 0.03 * g.r));
    if (host) host.members.push(...g.members);
    else podGroups.push(g);
    for (const s of g.members) podOf.set(s, host ?? g);
  }

  const order = (a: Vec2, b: Vec2) => (Math.round(a.y) - Math.round(b.y)) || (Math.round(a.x) - Math.round(b.x));
  podGroups.sort((a, b) => order(a.c, b.c));
  const podIds = new Map<Group, string>(podGroups.map((g, i) => [g, `pod_${i + 1}`]));
  const sorted = [...bands].sort((a, b) => order(a.c, b.c) || a.rIn - b.rIn || a.a0 - b.a0);
  const segments: CurvedWallSegment[] = sorted.map((s, i) => {
    const rm = (s.rIn + s.rOut) / 2;
    const pod = podOf.get(s);
    return {
      id: `cw_${i + 1}`,
      center: { x: s.c.x, y: s.c.y },
      radiusPt: rm,
      thicknessPt: s.rOut - s.rIn,
      a0: s.a0,
      a1: s.a1,
      kind: s.kind,
      faceStyles: s.styles,
      sourceOperationIds: s.ops,
      ...(pod ? { podId: podIds.get(pod)! } : {}),
      radiusM: M(rm),
      thicknessM: M(s.rOut - s.rIn),
      lengthM: M(rm * (s.a1 - s.a0)),
    };
  });
  const pods: CurvedPod[] = podGroups.map((g) => {
    const id = podIds.get(g)!;
    const mine = segments.filter((s) => s.podId === id);
    const cov = coverage(mergeIntervals(mine.map((s) => [s.a0, s.a1] as Interval)));
    return {
      id,
      center: { x: g.c.x, y: g.c.y },
      radiusM: M(g.r),
      enclosedDeg: (cov * 180) / Math.PI,
      segmentIds: mine.map((s) => s.id),
    };
  });
  return {
    segments,
    pods,
    diagnostics: { circularPieces: pieces, chains: chains.length, rings: rings.length, facePairs: pairs, segments: segments.length, pods: pods.length },
  };
}

/**
 * Cut curved walls into Pascal walls (each at most `maxSweepDeg` of arc). `toPascal`
 * maps page points to plan metres; it must be similarity (uniform scale, optional flip),
 * which keeps circles circular. Pascal's sagitta is positive when the arc bulges to the
 * right of start→end, i.e. the arc midpoint is midpoint(start, end) − normal × offset
 * with normal = (−dy, dx) / length.
 */
export function curvedWallPieces(
  segments: CurvedWallSegment[],
  toPascal: (xPt: number, yPt: number) => [number, number],
  maxSweepDeg = 90,
): CurvedWallPiece[] {
  const pieces: CurvedWallPiece[] = [];
  const maxSweep = (Math.max(10, Math.min(170, maxSweepDeg)) * Math.PI) / 180;
  for (const s of segments) {
    const sweep = s.a1 - s.a0;
    if (!(sweep > 0)) continue;
    const n = Math.max(1, Math.ceil(sweep / maxSweep - 1e-9));
    const at = (t: number) => {
      const [x, y] = toPascal(s.center.x + s.radiusPt * Math.cos(t), s.center.y + s.radiusPt * Math.sin(t));
      return { x, y };
    };
    for (let k = 0; k < n; k++) {
      const b0 = s.a0 + (sweep * k) / n, b1 = s.a0 + (sweep * (k + 1)) / n;
      const start = at(b0), end = at(b1), mid = at((b0 + b1) / 2);
      const dx = end.x - start.x, dy = end.y - start.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const nx = -dy / len, ny = dx / len;
      const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
      const raw = -((mid.x - mx) * nx + (mid.y - my) * ny);
      const curveOffset = Math.max(-len / 2, Math.min(len / 2, raw));
      pieces.push({
        id: n === 1 ? s.id : `${s.id}_${k + 1}`,
        segmentId: s.id,
        ...(s.podId ? { podId: s.podId } : {}),
        kind: s.kind,
        start,
        end,
        curveOffset,
        thicknessM: s.thicknessM,
        lengthM: s.lengthM / n,
        sourceOperationIds: s.sourceOperationIds,
      });
    }
  }
  return pieces;
}

const inArc = (s: CurvedWallSegment, angle: number, slack: number) => {
  for (const shift of [0, TAU, -TAU, 2 * TAU]) {
    const a = angle + shift;
    if (a >= s.a0 - slack && a <= s.a1 + slack) return true;
  }
  return false;
};

/**
 * The curved wall a straight wall (page points) runs along, if any. Straight walls
 * read from the same curves (chords, Bézier control polygons) duplicate the curved
 * wall and are dropped in its favour.
 */
export function curvedBandUnder(a: Vec2, b: Vec2, segments: CurvedWallSegment[], tolPt: number): CurvedWallSegment | null {
  for (const s of segments) {
    const rIn = s.radiusPt - s.thicknessPt / 2 - tolPt;
    const rOut = s.radiusPt + s.thicknessPt / 2 + tolPt;
    // a chord sags inside its arc by r(1 − cos(θ/2)); allow that much below the band
    const chordAngle = 2 * Math.asin(Math.min(1, dist(a, b) / (2 * Math.max(s.radiusPt, 1e-6))));
    const sag = s.radiusPt * (1 - Math.cos(chordAngle / 2));
    const slack = Math.min(0.3, (tolPt / Math.max(s.radiusPt, 1e-6)) * 2);
    let inside = 0;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const d = dist(p, s.center);
      if (d < rIn - sag || d > rOut) continue;
      if (!inArc(s, Math.atan2(p.y - s.center.y, p.x - s.center.x), slack)) continue;
      inside++;
    }
    if (inside === 5) return s;
  }
  return null;
}
