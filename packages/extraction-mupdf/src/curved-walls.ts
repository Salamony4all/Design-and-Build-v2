/**
 * Curved walls, curved glass partitions and round pods, read from the drawing's own
 * curve geometry (no raster, no AI).
 *
 * Faces come from cubic Béziers (how CAD exports arcs, ellipses and splines) and from
 * arcs flattened into many short straight lines. Circular faces: pieces on one circle
 * are merged into rings, and two concentric rings a wall thickness apart over the same
 * angles make a curved wall. Other curves (ovals, free-form): two faces at a constant
 * 3–40 cm offset along a curved run make a wall, whose centreline Pascal builds as a
 * chain of circular arcs. Two thin faces a few centimetres apart are glass. Wall pieces
 * on one circle that close most of it are a pod, and single lines drawn on a pod's ring
 * close it (thin = glass, heavy = solid), leaving the door gap open.
 *
 * Coordinates are MuPDF page points (y down). Angles are radians in that frame.
 */
import type { MuVector, Vec2 } from './vector-device';

export type CurvedWallKind = 'solid' | 'glass';
export type CurvedFaceStyle = 'heavy' | 'thin';
/** faces: two concentric faces; single-line: one line closing a pod's ring; free-form: two parallel non-circular faces */
export type CurvedWallSource = 'faces' | 'single-line' | 'free-form';

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
  /** an arc flattened into straight lines: at least this many segments, each turning at most this much */
  polyMinSegments: number;
  polyMaxTurnDeg: number;
  /** free-form walls: minimum length, total turn, and radius of curvature along most of the wall */
  freeMinLengthM: number;
  freeMinTurnDeg: number;
  freeMinRadiusM: number;
  /** shortest single line kept on a pod's ring (closes small gaps between its walls) */
  singleLineMinM: number;
  /** wall thickness given to a single line on a pod's ring when the pod has no such wall to copy */
  defaultGlassThicknessM: number;
  defaultSolidThicknessM: number;
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
  polyMinSegments: 4,
  polyMaxTurnDeg: 12,
  freeMinLengthM: 1.0,
  freeMinTurnDeg: 15,
  freeMinRadiusM: 0.5,
  singleLineMinM: 0.1,
  defaultGlassThicknessM: 0.05,
  defaultSolidThicknessM: 0.1,
};

/** One curved wall: the band between two faces over the angles [a0, a1] of its circle. */
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
  source: CurvedWallSource;
  /** free-form walls: the centreline (page points); centre, radius and angles are then its best-fit circle */
  centreline?: Vec2[];
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
    polylineArcs: number;
    chains: number;
    rings: number;
    freeRuns: number;
    facePairs: number;
    freeFormWalls: number;
    singleLineWalls: number;
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
  source: CurvedWallSource;
}

/** A smooth non-circular face: Bézier ovals and splines, or a flattened curve. */
interface FreeRun {
  pts: Vec2[];
  style: CurvedFaceStyle;
  op: string;
}

interface FreeBand {
  line: Vec2[];
  t: number;
  kind: CurvedWallKind;
  styles: [CurvedFaceStyle, CurvedFaceStyle];
  ops: string[];
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const BEZIER_SAMPLES = 10;

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const wrapPi = (a: number) => {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x <= -Math.PI) x += TAU;
  return x;
};
const mod = (a: number, m: number) => ((a % m) + m) % m;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
};

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

/** The parts of `iv` not covered by `cut` (angles, either may wrap). */
function subtract(iv: Interval[], cut: Interval[]): Interval[] {
  let rest: Interval[] = iv.map(([a, b]) => [a, b]);
  for (const [c0, c1] of cut) {
    for (const s of [0, TAU, -TAU, 2 * TAU]) {
      const lo = c0 + s, hi = c1 + s;
      const next: Interval[] = [];
      for (const [a, b] of rest) {
        if (hi <= a || lo >= b) { next.push([a, b]); continue; }
        if (lo > a) next.push([a, lo]);
        if (hi < b) next.push([hi, b]);
      }
      rest = next;
    }
  }
  return rest.filter(([a, b]) => b - a > 1e-3);
}

/** Angle interval covered by points on a circle, unwrapped in drawing order. */
function sweepOf(pts: Vec2[], c: Vec2): Interval {
  let prev = Math.atan2(pts[0]!.y - c.y, pts[0]!.x - c.x);
  let acc = prev, lo = prev, hi = prev;
  for (let i = 1; i < pts.length; i++) {
    const a = Math.atan2(pts[i]!.y - c.y, pts[i]!.x - c.x);
    acc += wrapPi(a - prev);
    prev = a;
    lo = Math.min(lo, acc);
    hi = Math.max(hi, acc);
  }
  return [lo, hi];
}

/**
 * Split a polyline into runs that look like a flattened curve: at least `minSegs`
 * segments of even length, each turning a little, all the same way. Polygons with
 * big facets (octagons, chamfers) and straight runs are not runs.
 */
function smoothRuns(poly: Vec2[], cfg: CurvedWallConfig): Vec2[][] {
  const out: Vec2[][] = [];
  const maxTurn = cfg.polyMaxTurnDeg * DEG, minTurn = 0.2 * DEG;
  let run: Vec2[] = [];
  let sign = 0;
  const flush = () => {
    if (run.length >= cfg.polyMinSegments + 1) out.push(run);
    run = [];
    sign = 0;
  };
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!, b = poly[i]!;
    const len = dist(a, b);
    if (len < 1e-6) continue;
    if (run.length < 2) {
      if (run.length === 0) run = [a, b];
      else run.push(b);
      continue;
    }
    const p = run[run.length - 2]!, q = run[run.length - 1]!;
    const prevLen = dist(p, q);
    const turn = wrapPi(Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(q.y - p.y, q.x - p.x));
    const s = Math.sign(turn);
    const even = len <= prevLen * 2 && len >= prevLen / 2;
    if (Math.abs(turn) >= minTurn && Math.abs(turn) <= maxTurn && even && (sign === 0 || s === sign) && dist(q, a) < 1e-6) {
      sign = s;
      run.push(b);
    } else {
      flush();
      run = [a, b];
    }
  }
  flush();
  return out;
}

/** Faces: circular chains (Bézier arcs and flattened arcs) and free-form runs. */
function findFaces(vectors: MuVector[], cfg: CurvedWallConfig, mPerPt: number) {
  const chains: Chain[] = [];
  const runs: FreeRun[] = [];
  let pieces = 0, polylineArcs = 0;
  const maxR = cfg.maxRadiusM / mPerPt;
  const pushCircle = (pts: Vec2[], errFactor: number, style: CurvedFaceStyle, op: string) => {
    const f = fitCircle(pts);
    if (!f || f.r <= 1 || f.r >= maxR || f.err > Math.max(0.25, errFactor * f.r)) return false;
    chains.push({ c: f.c, r: f.r, iv: mergeIntervals([sweepOf(pts, f.c)]), style, op });
    return true;
  };
  for (const v of vectors) {
    const cmds = v.commands as Array<Record<string, any>> | undefined;
    if (!cmds || cmds.length < 2) continue;
    let nC = 0, nL = 0;
    for (const c of cmds) {
      if (c.op === 'C') nC++;
      else if (c.op === 'L') nL++;
    }
    if (nC === 0 && nL < cfg.polyMinSegments) continue;
    const style = faceStyle(v, cfg);
    if (!style) continue;
    const op = v.sourceRootId ?? v.id;
    let circ: { c: Vec2; r: number; pts: Vec2[] } | null = null;
    // every run of Béziers is also a free-form candidate: an oval or spline can be
    // locally circular piece by piece, and only the whole run shows what it is
    let free: Vec2[] | null = null;
    let poly: Vec2[] | null = null;
    let last: Vec2 | null = null;
    let subStart: Vec2 | null = null;
    const closeCirc = () => {
      if (circ) pushCircle(circ.pts, 0.004, style, op);
      circ = null;
    };
    const closeFree = () => {
      if (free && free.length >= 3) runs.push({ pts: free, style, op });
      free = null;
    };
    const closePoly = () => {
      if (poly && poly.length > cfg.polyMinSegments) {
        for (const run of smoothRuns(poly, cfg)) {
          // vertices and chord midpoints: a coarse polygon fails, a fine flattening passes
          const dense: Vec2[] = [run[0]!];
          for (let i = 1; i < run.length; i++) {
            dense.push({ x: (run[i - 1]!.x + run[i]!.x) / 2, y: (run[i - 1]!.y + run[i]!.y) / 2 }, run[i]!);
          }
          if (pushCircle(dense, 0.006, style, op)) polylineArcs++;
          runs.push({ pts: run, style, op });
        }
      }
      poly = null;
    };
    const lineTo = (p: Vec2) => {
      closeCirc();
      closeFree();
      if (!poly) poly = last ? [last] : [];
      poly.push(p);
      last = p;
    };
    for (const c of cmds) {
      if (c.op === 'M') {
        closeCirc(); closeFree(); closePoly();
        last = { x: c.x, y: c.y };
        subStart = last;
      } else if (c.op === 'L') {
        lineTo({ x: c.x, y: c.y });
      } else if (c.op === 'Z') {
        if (last && subStart && dist(last, subStart) > 1e-6 && poly) lineTo(subStart);
        closeCirc(); closeFree(); closePoly();
        last = subStart;
      } else if (c.op === 'C') {
        closePoly();
        const p1 = c.p1 as Vec2, p2 = c.p2 as Vec2, p3 = c.p3 as Vec2;
        if (!last) { last = p3; continue; }
        const pts = bezierPoints(last, p1, p2, p3);
        last = p3;
        const f = dist(pts[0]!, pts[pts.length - 1]!) >= 0.5 ? fitCircle(pts) : null;
        const ok = !!f && f.r > 1 && f.r < maxR && f.err <= Math.max(0.15, 0.004 * f.r);
        if (!free) free = [];
        free.push(...(free.length ? pts.slice(1) : pts));
        if (ok) {
          pieces++;
          if (circ) {
            const k: { c: Vec2; r: number; pts: Vec2[] } = circ;
            if (dist(f!.c, k.c) < Math.max(2, 0.02 * f!.r) && Math.abs(f!.r - k.r) < Math.max(0.8, 0.01 * f!.r)) {
              k.pts.push(...pts);
              continue;
            }
          }
          closeCirc();
          circ = { c: f!.c, r: f!.r, pts };
        } else {
          closeCirc();
        }
      }
    }
    closeCirc(); closeFree(); closePoly();
  }
  return { chains, runs, pieces, polylineArcs };
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
  // faces of one wall differ in radius by at most the wall thickness: only nearby radii are compared
  const byR = [...rings].sort((a, b) => a.r - b.r);
  const maxDr = (cfg.maxThicknessM + 0.05) / mPerPt;
  for (let i = 0; i < byR.length; i++) {
    for (let j = i + 1; j < byR.length && byR[j]!.r - byR[i]!.r <= maxDr; j++) {
      const inner = byR[i]!, outer = byR[j]!;
      const a = inner, b = outer;
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
          source: 'faces',
        });
      }
    }
  }
  // A face pair can match twice (a three-line glass wall, a finish line): the widest band
  // keeps the span, and a narrower one keeps only the angles the wider one does not cover.
  bands.sort((x, y) => (y.rOut - y.rIn) - (x.rOut - x.rIn) || x.c.y - y.c.y || x.c.x - y.c.x || x.a0 - y.a0);
  const kept: Band[] = [];
  for (const s of bands) {
    let rest: Interval[] = [[s.a0, s.a1]];
    for (const k of kept) {
      if (Math.abs(k.c.x - s.c.x) >= 4 || Math.abs(k.c.y - s.c.y) >= 4) continue;
      if (!(k.rIn - 1 <= s.rIn && s.rOut <= k.rOut + 1)) continue;
      rest = subtract(rest, [[k.a0, k.a1]]);
      if (rest.length === 0) break;
    }
    const rm = (s.rIn + s.rOut) / 2;
    for (const [lo, hi] of rest) {
      if (M(rm * (hi - lo)) >= cfg.minArcLengthM) kept.push({ ...s, a0: lo, a1: hi });
    }
  }
  return { bands: kept, pairs };
}

/** Resample a polyline at a fixed spacing. */
function resample(pts: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [pts[0]!];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const len = dist(a, b);
    if (len < 1e-9) continue;
    let t = step - carry;
    while (t <= len) {
      out.push({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
      t += step;
    }
    carry = len - (t - step);
  }
  const last = pts[pts.length - 1]!;
  if (dist(out[out.length - 1]!, last) > step * 0.3) out.push(last);
  return out;
}

const dirAt = (p: Vec2[], i: number) => {
  const a = p[Math.max(0, i - 1)]!, b = p[Math.min(p.length - 1, i + 1)]!;
  const l = dist(a, b) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};

function totalTurn(p: Vec2[]): number {
  let turn = 0;
  for (let i = 2; i < p.length; i++) {
    const a = Math.atan2(p[i - 1]!.y - p[i - 2]!.y, p[i - 1]!.x - p[i - 2]!.x);
    const b = Math.atan2(p[i]!.y - p[i - 1]!.y, p[i]!.x - p[i - 1]!.x);
    turn += Math.abs(wrapPi(b - a));
  }
  return turn;
}

/** Share of points whose local radius of curvature (over ±w samples) is below rMin. */
function tightShare(p: Vec2[], w: number, rMin: number): number {
  if (p.length < 2 * w + 1) return 1;
  let tight = 0, n = 0;
  for (let i = w; i < p.length - w; i++) {
    const a = p[i - w]!, b = p[i]!, c = p[i + w]!;
    const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    const r = area2 < 1e-9 ? Infinity : (dist(a, b) * dist(b, c) * dist(a, c)) / (2 * area2);
    n++;
    if (r < rMin) tight++;
  }
  return n ? tight / n : 1;
}

/**
 * Two non-circular faces that stay a wall thickness apart along a curved run = a
 * free-form wall (ovals, splines). Returns centrelines in page points.
 */
function pairFreeRuns(runs: FreeRun[], cfg: CurvedWallConfig, mPerPt: number): FreeBand[] {
  const step = Math.max(0.5, 0.05 / mPerPt);
  const minT = cfg.minThicknessM / mPerPt, maxT = cfg.maxThicknessM / mPerPt;
  const minLen = cfg.freeMinLengthM / mPerPt;
  const prepared = runs
    .map((r) => ({ ...r, s: resample(r.pts, step) }))
    .filter((r) => r.s.length >= 3 && (r.s.length - 1) * step >= minLen * 0.9 && totalTurn(r.s) >= cfg.freeMinTurnDeg * DEG * 0.9);
  if (prepared.length < 2) return [];
  const cell = maxT + 0.05 / mPerPt;
  const grid = new Map<string, Array<{ r: number; i: number }>>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  prepared.forEach((r, ri) => r.s.forEach((p, i) => {
    const k = key(p.x, p.y);
    const list = grid.get(k);
    if (list) list.push({ r: ri, i });
    else grid.set(k, [{ r: ri, i }]);
  }));
  const cosPar = Math.cos(12 * DEG);
  const out: FreeBand[] = [];
  for (let ra = 0; ra < prepared.length; ra++) {
    const A = prepared[ra]!;
    // nearest sample of every other run, for each sample of A
    const near = new Map<number, Array<{ i: number; j: number; d: number } | null>>();
    for (let i = 0; i < A.s.length; i++) {
      const p = A.s[i]!;
      const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
      const best = new Map<number, { j: number; d: number }>();
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (const e of grid.get(`${gx},${gy}`) ?? []) {
            if (e.r <= ra) continue;
            const d = dist(p, prepared[e.r]!.s[e.i]!);
            const b = best.get(e.r);
            if (!b || d < b.d) best.set(e.r, { j: e.i, d });
          }
        }
      }
      for (const [rb, b] of best) {
        let arr = near.get(rb);
        if (!arr) { arr = new Array(A.s.length).fill(null); near.set(rb, arr); }
        arr[i] = { i, j: b.j, d: b.d };
      }
    }
    for (const [rb, arr] of near) {
      const B = prepared[rb]!;
      // project onto B's polyline for the true offset, keep parallel samples in range
      const ok = arr.map((e) => {
        if (!e) return null;
        const p = A.s[e.i]!;
        let bestD = e.d, q = B.s[e.j]!;
        for (const k of [e.j - 1, e.j]) {
          if (k < 0 || k + 1 >= B.s.length) continue;
          const a = B.s[k]!, b = B.s[k + 1]!;
          const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
          if (l2 < 1e-12) continue;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
          const qq = { x: a.x + vx * t, y: a.y + vy * t };
          const dd = dist(p, qq);
          if (dd < bestD) { bestD = dd; q = qq; }
        }
        if (bestD < minT || bestD > maxT) return null;
        const da = dirAt(A.s, e.i), db = dirAt(B.s, e.j);
        if (Math.abs(da.x * db.x + da.y * db.y) < cosPar) return null;
        return { i: e.i, j: e.j, d: bestD, q };
      });
      let i = 0;
      while (i < ok.length) {
        if (!ok[i]) { i++; continue; }
        const run: Array<{ i: number; j: number; d: number; q: Vec2 }> = [];
        let dirJ = 0;
        while (i < ok.length && ok[i]) {
          const e = ok[i]!;
          const prev = run[run.length - 1];
          if (prev) {
            const dj = e.j - prev.j;
            if (Math.abs(dj) > 3 || (dirJ !== 0 && dj !== 0 && Math.sign(dj) !== dirJ)) break;
            if (dj !== 0) dirJ = Math.sign(dj);
          }
          run.push(e);
          i++;
        }
        if (run.length < 3 || (run.length - 1) * step < minLen) continue;
        const ds = run.map((e) => e.d);
        if ((Math.max(...ds) - Math.min(...ds)) * mPerPt > cfg.maxThicknessSpreadM) continue;
        const line = run.map((e) => ({ x: (A.s[e.i]!.x + e.q.x) / 2, y: (A.s[e.i]!.y + e.q.y) / 2 }));
        if (totalTurn(line) < cfg.freeMinTurnDeg * DEG) continue;
        const w = Math.max(2, Math.round(0.25 / mPerPt / step));
        if (tightShare(line, w, cfg.freeMinRadiusM / mPerPt) > 0.1) continue;
        const t = median(ds);
        const thin = A.style === 'thin' && B.style === 'thin';
        const glass = thin && t * mPerPt <= cfg.maxGlassThicknessM;
        // two thin lines further apart than glass are as often furniture as wall: not read here
        if (thin && !glass) continue;
        out.push({ line, t, kind: glass ? 'glass' : 'solid', styles: [A.style, B.style], ops: [...new Set([A.op, B.op])].sort() });
      }
    }
  }
  // finish lines and three-line glass: the widest band keeps the stretch it covers
  out.sort((a, b) => b.t - a.t);
  const kept: FreeBand[] = [];
  const distToLine = (p: Vec2, line: Vec2[]) => {
    let best = Infinity;
    for (let k = 1; k < line.length; k++) {
      const a = line[k - 1]!, b = line[k]!;
      const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
      const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
      best = Math.min(best, Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t));
    }
    return best;
  };
  for (const b of out) {
    const covered = b.line.map((p) => kept.some((k) => distToLine(p, k.line) <= k.t / 2 + 1));
    let start = -1;
    for (let k = 0; k <= b.line.length; k++) {
      const free = k < b.line.length && !covered[k];
      if (free && start < 0) start = k;
      if (!free && start >= 0) {
        const part = b.line.slice(start, k);
        if ((part.length - 1) * step >= minLen) kept.push({ ...b, line: part });
        start = -1;
      }
    }
  }
  return kept;
}

/** Find curved walls, glass partitions and pods in the captured page vectors. */
export function detectCurvedWalls(
  input: {
    vectors: MuVector[];
    scaleMmPerPt: number;
    /** keep only walls whose middle lies in this page box [x0, y0, x1, y1] (the building's extent): not title blocks, logos, legends */
    within?: [number, number, number, number];
  },
  config: Partial<CurvedWallConfig> = {},
): CurvedWallResult {
  const cfg = { ...CURVED_WALL_DEFAULTS, ...config };
  const mPerPt = input.scaleMmPerPt / 1000;
  const empty: CurvedWallResult = {
    segments: [],
    pods: [],
    diagnostics: { circularPieces: 0, polylineArcs: 0, chains: 0, rings: 0, freeRuns: 0, facePairs: 0, freeFormWalls: 0, singleLineWalls: 0, segments: 0, pods: 0 },
  };
  if (!(mPerPt > 0) || !Number.isFinite(mPerPt)) return empty;
  const M = (pt: number) => pt * mPerPt;

  const { chains, runs, pieces, polylineArcs } = findFaces(input.vectors, cfg, mPerPt);
  const rings = findRings(chains, cfg.minThicknessM / mPerPt);
  const { bands: all, pairs } = pairFaces(rings, cfg, mPerPt);
  const inside = (p: Vec2) => !input.within || (p.x >= input.within[0] && p.x <= input.within[2] && p.y >= input.within[1] && p.y <= input.within[3]);
  const bandMid = (b: Band) => {
    const am = (b.a0 + b.a1) / 2, rm = (b.rIn + b.rOut) / 2;
    return { x: b.c.x + rm * Math.cos(am), y: b.c.y + rm * Math.sin(am) };
  };
  const bands = all.filter((b) => M((b.rIn + b.rOut) / 2) >= cfg.minRadiusM && inside(bandMid(b)));

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
    if (cov >= cfg.podMinCoverDeg * DEG && inPodRange(g.r)) {
      podGroups.push(g);
      for (const s of g.members) podOf.set(s, g);
    }
  }
  // ...or whose wall band (every dark ring near that radius) closes most of the circle.
  for (const g of groups) {
    if (podGroups.includes(g) || !inPodRange(g.r)) continue;
    const band = rings.filter((x) => dist(x.c, g.c) < Math.max(4, 0.03 * g.r) && Math.abs(x.r - g.r) < Math.max(6, 0.04 * g.r));
    const cov = coverage(mergeIntervals(band.flatMap((x) => x.iv)));
    if (cov < cfg.podBandCoverDeg * DEG) continue;
    const host = podGroups.find((p) => dist(p.c, g.c) < Math.max(4, 0.03 * g.r));
    if (host) host.members.push(...g.members);
    else podGroups.push(g);
    for (const s of g.members) podOf.set(s, host ?? g);
  }

  // Single lines on a pod's ring close it: thin = glass, heavy = solid. Heavy lines are
  // placed first; a door gap has no line on the ring and stays open.
  let singleLine = 0;
  for (const g of podGroups) {
    const rIn = Math.min(...g.members.map((s) => s.rIn));
    const rOut = Math.max(...g.members.map((s) => s.rOut));
    const glassT = g.members.filter((s) => s.kind === 'glass').map((s) => s.rOut - s.rIn);
    const solidT = g.members.filter((s) => s.kind === 'solid').map((s) => s.rOut - s.rIn);
    const tol = Math.max(1, 0.02 / mPerPt);
    let covered = mergeIntervals(g.members.map((s) => [s.a0, s.a1] as Interval));
    for (const style of ['heavy', 'thin'] as const) {
      const lines = chains.filter((ch) => ch.style === style && dist(ch.c, g.c) < Math.max(4, 0.03 * g.r) && ch.r >= rIn - tol && ch.r <= rOut + tol);
      for (const ch of lines) {
        for (const [lo, hi] of subtract(ch.iv, covered)) {
          if (M(ch.r * (hi - lo)) < cfg.singleLineMinM) continue;
          const kind: CurvedWallKind = style === 'thin' ? 'glass' : 'solid';
          const t = kind === 'glass'
            ? (glassT.length ? median(glassT) : cfg.defaultGlassThicknessM / mPerPt)
            : (solidT.length ? median(solidT) : cfg.defaultSolidThicknessM / mPerPt);
          // the line is a face: the wall lies on the side of the ring's other faces
          const outward = Math.abs(ch.r - rIn) <= Math.abs(ch.r - rOut);
          const rm = outward ? ch.r + t / 2 : ch.r - t / 2;
          const band: Band = {
            c: ch.c, rIn: rm - t / 2, rOut: rm + t / 2, a0: lo, a1: hi, kind,
            styles: [style, style], ops: [ch.op], source: 'single-line',
          };
          bands.push(band);
          g.members.push(band);
          podOf.set(band, g);
          covered = mergeIntervals([...covered, [lo, hi]]);
          singleLine++;
        }
      }
    }
  }

  // Free-form walls. A circular one that a concentric-face wall already covers is left to
  // it; a non-circular one replaces the short circular pieces read along it.
  const insideBand = (p: Vec2, b: Band, tolPt: number) => {
    const d = dist(p, b.c);
    if (d < b.rIn - tolPt || d > b.rOut + tolPt) return false;
    const a = Math.atan2(p.y - b.c.y, p.x - b.c.x);
    return [0, TAU, -TAU, 2 * TAU].some((sh) => a + sh >= b.a0 - 0.01 && a + sh <= b.a1 + 0.01);
  };
  const tolPt = Math.max(1, 0.02 / mPerPt);
  const free = pairFreeRuns(runs, cfg, mPerPt).filter((f) => inside(f.line[f.line.length >> 1]!)).filter((f) => {
    const fit = fitCircle(f.line);
    const circular = !!fit && fit.err <= Math.max(tolPt, 0.01 * fit.r);
    const covered = f.line.filter((p) => bands.some((b) => insideBand(p, b, tolPt))).length / f.line.length;
    if (circular) return covered < 0.5;
    for (let k = bands.length - 1; k >= 0; k--) {
      const b = bands[k]!;
      if (podOf.has(b)) continue;
      if (distToPolyline(bandMid(b), f.line) <= f.t / 2 + tolPt) bands.splice(k, 1);
    }
    return true;
  });

  const order = (a: Vec2, b: Vec2) => (Math.round(a.y) - Math.round(b.y)) || (Math.round(a.x) - Math.round(b.x));
  podGroups.sort((a, b) => order(a.c, b.c));
  const podIds = new Map<Group, string>(podGroups.map((g, i) => [g, `pod_${i + 1}`]));
  const sorted = [...bands].sort((a, b) => order(a.c, b.c) || a.rIn - b.rIn || a.a0 - b.a0);
  const segments: CurvedWallSegment[] = sorted.map((s) => {
    const rm = (s.rIn + s.rOut) / 2;
    const pod = podOf.get(s);
    return {
      id: '',
      center: { x: s.c.x, y: s.c.y },
      radiusPt: rm,
      thicknessPt: s.rOut - s.rIn,
      a0: s.a0,
      a1: s.a1,
      kind: s.kind,
      faceStyles: s.styles,
      sourceOperationIds: s.ops,
      source: s.source,
      ...(pod ? { podId: podIds.get(pod)! } : {}),
      radiusM: M(rm),
      thicknessM: M(s.rOut - s.rIn),
      lengthM: M(rm * (s.a1 - s.a0)),
    };
  });
  for (const f of free.sort((a, b) => order(a.line[0]!, b.line[0]!))) {
    const fit = fitCircle(f.line);
    const c = fit?.c ?? f.line[0]!;
    const r = fit?.r ?? 0;
    const [a0, a1] = fit ? sweepOf(f.line, c) : [0, 0];
    let len = 0;
    for (let k = 1; k < f.line.length; k++) len += dist(f.line[k - 1]!, f.line[k]!);
    segments.push({
      id: '',
      center: c,
      radiusPt: r,
      thicknessPt: f.t,
      a0: Math.min(a0, a1),
      a1: Math.max(a0, a1),
      kind: f.kind,
      faceStyles: f.styles,
      sourceOperationIds: f.ops,
      source: 'free-form',
      centreline: f.line,
      radiusM: M(r),
      thicknessM: M(f.t),
      lengthM: M(len),
    });
  }
  segments.forEach((s, i) => { s.id = `cw_${i + 1}`; });

  const pods: CurvedPod[] = podGroups.map((g) => {
    const id = podIds.get(g)!;
    const mine = segments.filter((s) => s.podId === id);
    const cov = coverage(mergeIntervals(mine.map((s) => [s.a0, s.a1] as Interval)));
    return {
      id,
      center: { x: g.c.x, y: g.c.y },
      radiusM: M(g.r),
      enclosedDeg: cov / DEG,
      segmentIds: mine.map((s) => s.id),
    };
  });
  return {
    segments,
    pods,
    diagnostics: {
      circularPieces: pieces,
      polylineArcs,
      chains: chains.length,
      rings: rings.length,
      freeRuns: runs.length,
      facePairs: pairs,
      freeFormWalls: free.length,
      singleLineWalls: singleLine,
      segments: segments.length,
      pods: pods.length,
    },
  };
}

/** Circle through three points, or null when they are (nearly) in a line. */
function circle3(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

/** Pascal's sagitta for an arc through start, mid and end (plan metres). */
function sagitta(start: { x: number; y: number }, mid: { x: number; y: number }, end: { x: number; y: number }) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const nx = -dy / len, ny = dx / len;
  const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
  const raw = -((mid.x - mx) * nx + (mid.y - my) * ny);
  return { len, curveOffset: Math.max(-len / 2, Math.min(len / 2, raw)) };
}

/**
 * Cut curved walls into Pascal walls (each at most `maxSweepDeg` of arc). `toPascal`
 * maps page points to plan metres; it must be similarity (uniform scale, optional flip),
 * which keeps circles circular. Pascal's sagitta is positive when the arc bulges to the
 * right of start→end, i.e. the arc midpoint is midpoint(start, end) − normal × offset
 * with normal = (−dy, dx) / length. Free-form centrelines are followed by a chain of
 * arcs, each within `tolM` of the drawn line.
 */
export function curvedWallPieces(
  segments: CurvedWallSegment[],
  toPascal: (xPt: number, yPt: number) => [number, number],
  maxSweepDeg = 90,
  tolM = 0.015,
): CurvedWallPiece[] {
  const pieces: CurvedWallPiece[] = [];
  const maxSweep = Math.max(10, Math.min(170, maxSweepDeg)) * DEG;
  const P = (p: Vec2) => {
    const [x, y] = toPascal(p.x, p.y);
    return { x, y };
  };
  for (const s of segments) {
    const base = {
      segmentId: s.id,
      ...(s.podId ? { podId: s.podId } : {}),
      kind: s.kind,
      thicknessM: s.thicknessM,
      sourceOperationIds: s.sourceOperationIds,
    };
    if (s.centreline && s.centreline.length >= 2) {
      const pts = s.centreline.map(P);
      const cut: number[] = [0];
      let i = 0;
      while (i < pts.length - 1) {
        let best = Math.min(i + 1, pts.length - 1);
        for (let j = i + 2; j < pts.length; j++) {
          const m = (i + j) >> 1;
          const c = circle3(pts[i]!, pts[m]!, pts[j]!);
          let fits = true;
          if (c) {
            const a0 = Math.atan2(pts[i]!.y - c.y, pts[i]!.x - c.x), a1 = Math.atan2(pts[j]!.y - c.y, pts[j]!.x - c.x);
            const am = Math.atan2(pts[m]!.y - c.y, pts[m]!.x - c.x);
            const sweep = Math.abs(wrapPi(am - a0)) + Math.abs(wrapPi(a1 - am));
            if (sweep > maxSweep) fits = false;
            for (let k = i + 1; fits && k < j; k++) if (Math.abs(Math.hypot(pts[k]!.x - c.x, pts[k]!.y - c.y) - c.r) > tolM) fits = false;
          } else {
            const a = pts[i]!, b = pts[j]!, l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            for (let k = i + 1; fits && k < j; k++) {
              if (Math.abs((b.x - a.x) * (pts[k]!.y - a.y) - (b.y - a.y) * (pts[k]!.x - a.x)) / l > tolM) fits = false;
            }
          }
          if (!fits) break;
          best = j;
        }
        cut.push(best);
        i = best;
      }
      for (let k = 1; k < cut.length; k++) {
        const i0 = cut[k - 1]!, i1 = cut[k]!;
        const start = pts[i0]!, end = pts[i1]!;
        // Pascal needs the arc's own midpoint (on the chord's perpendicular), not just any
        // point on it: take it from the circle through start, middle sample and end.
        const c = i1 - i0 >= 2 ? circle3(start, pts[(i0 + i1) >> 1]!, end) : null;
        const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
        const toMid = c ? Math.hypot(mx - c.x, my - c.y) : 0;
        const mid = c && toMid > 1e-9 ? { x: c.x + ((mx - c.x) * c.r) / toMid, y: c.y + ((my - c.y) * c.r) / toMid } : { x: mx, y: my };
        const sg = sagitta(start, mid, end);
        if (!sg) continue;
        let len = 0;
        for (let q = i0 + 1; q <= i1; q++) len += Math.hypot(pts[q]!.x - pts[q - 1]!.x, pts[q]!.y - pts[q - 1]!.y);
        pieces.push({ id: cut.length === 2 ? s.id : `${s.id}_${k}`, ...base, start, end, curveOffset: sg.curveOffset, lengthM: len });
      }
      continue;
    }
    const sweep = s.a1 - s.a0;
    if (!(sweep > 0)) continue;
    const n = Math.max(1, Math.ceil(sweep / maxSweep - 1e-9));
    const at = (t: number) => P({ x: s.center.x + s.radiusPt * Math.cos(t), y: s.center.y + s.radiusPt * Math.sin(t) });
    for (let k = 0; k < n; k++) {
      const b0 = s.a0 + (sweep * k) / n, b1 = s.a0 + (sweep * (k + 1)) / n;
      const start = at(b0), end = at(b1), mid = at((b0 + b1) / 2);
      const sg = sagitta(start, mid, end);
      if (!sg) continue;
      pieces.push({ id: n === 1 ? s.id : `${s.id}_${k + 1}`, ...base, start, end, curveOffset: sg.curveOffset, lengthM: s.lengthM / n });
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

function distToPolyline(p: Vec2, line: Vec2[]): number {
  let best = Infinity;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!, b = line[k]!;
    const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
    best = Math.min(best, Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t));
  }
  return best;
}

/**
 * The curved wall a straight wall (page points) runs along, if any. Straight walls
 * read from the same curves (chords, Bézier control polygons, flattened arcs) duplicate
 * the curved wall and are dropped in its favour.
 */
export function curvedBandUnder(a: Vec2, b: Vec2, segments: CurvedWallSegment[], tolPt: number): CurvedWallSegment | null {
  const samples = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
  for (const s of segments) {
    if (s.centreline) {
      if (samples.every((p) => distToPolyline(p, s.centreline!) <= s.thicknessPt / 2 + tolPt)) return s;
      continue;
    }
    const rIn = s.radiusPt - s.thicknessPt / 2 - tolPt;
    const rOut = s.radiusPt + s.thicknessPt / 2 + tolPt;
    // a chord sags inside its arc by r(1 − cos(θ/2)); allow that much below the band
    const chordAngle = 2 * Math.asin(Math.min(1, dist(a, b) / (2 * Math.max(s.radiusPt, 1e-6))));
    const sag = s.radiusPt * (1 - Math.cos(chordAngle / 2));
    const slack = Math.min(0.3, (tolPt / Math.max(s.radiusPt, 1e-6)) * 2);
    let inside = 0;
    for (const p of samples) {
      const d = dist(p, s.center);
      if (d < rIn - sag || d > rOut) continue;
      if (!inArc(s, Math.atan2(p.y - s.center.y, p.x - s.center.x), slack)) continue;
      inside++;
    }
    if (inside === 5) return s;
  }
  return null;
}
