// Geometry normalisation + topology utilities for column extraction.
//
// IMPORTANT INVARIANTS
//  * No oracle/audit JSON is imported here. Nothing in this module knows how many
//    columns the drawing contains, nor where they are.
//  * No coordinate is hardcoded. Every threshold is a physical dimension (metres /
//    radians / dimensionless ratio) supplied by the caller through ColumnOptions.
//  * The only structural assumption is the fixture's *documented* id scheme, and
//    even that is used purely as a de-duplication hint (see `canonicalEdges`).
//
// WHY DE-DUPLICATION IS REQUIRED
//  The shared capture fixture emits every polyline edge up to three times:
//    `${op}:seg:${i}` and `${op}:L${i}`   -> identical endpoint pairs (aliases)
//    `${op}:s${k}`                        -> subpath chord (first -> last point)
//  and additionally re-emits sub-vectors (`v123:s0:seg:0`) that repeat the parent
//  vector's geometry. Without a geometric de-duplication pass every vertex has
//  degree >= 4 and no closed ring can ever be traced.

import type { Point, Segment, CubicCurve } from './contracts';

export interface CanonicalEdge {
  a: Point;
  b: Point;
  /** every fixture segment id that resolves to this one physical edge */
  ids: string[];
  /** every source operation id that produced this physical edge */
  ops: string[];
  lengthUnits: number;
}

export interface Ring {
  /** ordered vertices (closed implicitly: last connects back to first) */
  vertices: Point[];
  /** true when the traced component was an explicit cycle, false when the ring
   *  was closed implicitly (filled path drawn without a closing edge) */
  explicitClose: boolean;
  edgeIds: string[];
  opIds: string[];
  edgeCount: number;
}

export interface BranchComponent {
  edgeIds: string[];
  opIds: string[];
  points: Point[];
  edgeCount: number;
}

export interface ComponentSet {
  rings: Ring[];
  branched: BranchComponent[];
  /** components rejected before ring tracing (too many edges) */
  oversized: number;
  edgeCount: number;
}

const EPS = 1e-9;

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const len = (a: Point): number => Math.hypot(a.x, a.y);
export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Signed polygon area x2 (shoelace). */
export function shoelace2(pts: Point[]): number {
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    acc += p.x * q.y - q.x * p.y;
  }
  return acc;
}

export const polygonArea = (pts: Point[]): number => Math.abs(shoelace2(pts)) / 2;

export function polygonPerimeter(pts: Point[]): number {
  let acc = 0;
  for (let i = 0; i < pts.length; i++) acc += distance(pts[i], pts[(i + 1) % pts.length]);
  return acc;
}

/** Area centroid of a simple polygon; falls back to the vertex mean if degenerate. */
export function polygonCentroid(pts: Point[]): Point {
  const a2 = shoelace2(pts);
  if (Math.abs(a2) < EPS) {
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const cr = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

export function bounds(pts: Point[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Collapse the fixture's aliased/duplicated segment records into one record per
 * physical edge. Zero-length records (closed-subpath chords) are dropped.
 * `quantUnits` is the geometric equality tolerance in drawing units.
 */
export function canonicalEdges(segments: Segment[], quantUnits: number): CanonicalEdge[] {
  const q = (v: number) => Math.round(v / quantUnits);
  const map = new Map<string, CanonicalEdge>();
  for (const s of segments) {
    if (s.claimedBy) continue;
    const l = distance(s.a, s.b);
    if (l < quantUnits) continue; // degenerate / below equality tolerance
    const ka = `${q(s.a.x)},${q(s.a.y)}`;
    const kb = `${q(s.b.x)},${q(s.b.y)}`;
    const key = ka <= kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const hit = map.get(key);
    if (hit) {
      hit.ids.push(s.id);
      if (s.sourceOperationId && !hit.ops.includes(s.sourceOperationId)) hit.ops.push(s.sourceOperationId);
    } else {
      map.set(key, {
        a: s.a,
        b: s.b,
        ids: [s.id],
        ops: s.sourceOperationId ? [s.sourceOperationId] : [],
        lengthUnits: l,
      });
    }
  }
  const out = [...map.values()];
  for (const e of out) {
    e.ids.sort();
    e.ops.sort();
  }
  // deterministic ordering independent of Map insertion order
  out.sort((p, r) => (p.ids[0] < r.ids[0] ? -1 : p.ids[0] > r.ids[0] ? 1 : 0));
  return out;
}

class DisjointSet {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(a: number): number {
    let x = a;
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/**
 * Group canonical edges into connected components (endpoint snapping at
 * `snapUnits`), then attempt to trace each component as a single ring.
 *
 * A component becomes a Ring when it is either
 *   (a) a simple cycle  — every vertex has degree 2 and |V| == |E|, or
 *   (b) a simple open path — exactly two degree-1 endpoints and no branching,
 *       which is how a *filled* polygon is emitted (the closing edge is implicit).
 * Anything else is a BranchComponent (hatch, overlapping symbols, furniture...).
 */
export function buildComponents(
  edges: CanonicalEdge[],
  snapUnits: number,
  maxComponentEdges: number,
): ComponentSet {
  const key = (p: Point) => `${Math.round(p.x / snapUnits)},${Math.round(p.y / snapUnits)}`;
  const ds = new DisjointSet(edges.length);
  const byVertex = new Map<string, number[]>();
  edges.forEach((e, i) => {
    for (const p of [e.a, e.b]) {
      const k = key(p);
      const arr = byVertex.get(k);
      if (arr) arr.push(i);
      else byVertex.set(k, [i]);
    }
  });
  for (const arr of byVertex.values()) for (let j = 1; j < arr.length; j++) ds.union(arr[0], arr[j]);

  const groups = new Map<number, number[]>();
  edges.forEach((_, i) => {
    const r = ds.find(i);
    const arr = groups.get(r);
    if (arr) arr.push(i);
    else groups.set(r, [i]);
  });

  const rings: Ring[] = [];
  const branched: BranchComponent[] = [];
  let oversized = 0;

  for (const idxs of groups.values()) {
    if (idxs.length > maxComponentEdges) {
      oversized++;
      continue;
    }
    const traced = traceRing(idxs, edges, key);
    if (traced) rings.push(traced);
    else {
      const pts: Point[] = [];
      for (const i of idxs) pts.push(edges[i].a, edges[i].b);
      branched.push({
        edgeIds: idxs.flatMap((i) => edges[i].ids).sort(),
        opIds: [...new Set(idxs.flatMap((i) => edges[i].ops))].sort(),
        points: pts,
        edgeCount: idxs.length,
      });
    }
  }
  // deterministic ordering
  rings.sort(ringOrder);
  branched.sort((a, b) => (a.edgeIds[0] < b.edgeIds[0] ? -1 : a.edgeIds[0] > b.edgeIds[0] ? 1 : 0));
  return { rings, branched, oversized, edgeCount: edges.length };
}

function ringOrder(a: Ring, b: Ring): number {
  return a.edgeIds[0] < b.edgeIds[0] ? -1 : a.edgeIds[0] > b.edgeIds[0] ? 1 : 0;
}

function traceRing(
  idxs: number[],
  edges: CanonicalEdge[],
  key: (p: Point) => string,
): Ring | null {
  if (idxs.length < 3) return null;
  const adj = new Map<string, Array<{ to: string; edge: number }>>();
  const pos = new Map<string, Point>();
  for (const i of idxs) {
    const e = edges[i];
    const ka = key(e.a);
    const kb = key(e.b);
    if (ka === kb) return null;
    pos.set(ka, e.a);
    pos.set(kb, e.b);
    (adj.get(ka) ?? adj.set(ka, []).get(ka)!).push({ to: kb, edge: i });
    (adj.get(kb) ?? adj.set(kb, []).get(kb)!).push({ to: ka, edge: i });
  }
  const ends: string[] = [];
  for (const [k, v] of adj) {
    if (v.length > 2) return null; // branching -> not a ring
    if (v.length === 1) ends.push(k);
  }
  let start: string;
  let explicitClose: boolean;
  if (ends.length === 0) {
    if (adj.size !== idxs.length) return null; // multi-cycle
    start = [...adj.keys()].sort()[0];
    explicitClose = true;
  } else if (ends.length === 2) {
    start = ends.sort()[0];
    explicitClose = false;
  } else {
    return null;
  }

  const used = new Set<number>();
  const order: string[] = [start];
  let cur = start;
  for (;;) {
    const next = (adj.get(cur) ?? []).find((n) => !used.has(n.edge));
    if (!next) break;
    used.add(next.edge);
    cur = next.to;
    if (cur === start) break;
    order.push(cur);
  }
  if (used.size !== idxs.length) return null; // did not consume the component
  if (order.length < 3) return null;

  return {
    vertices: order.map((k) => pos.get(k)!),
    explicitClose,
    edgeIds: idxs.flatMap((i) => edges[i].ids).sort(),
    opIds: [...new Set(idxs.flatMap((i) => edges[i].ops))].sort(),
    edgeCount: idxs.length,
  };
}

/** Drop vertices that lie on a straight run (flattened-arc noise, split edges). */
export function mergeCollinear(ring: Point[], angleToleranceRad: number): Point[] {
  const n = ring.length;
  if (n < 4) return ring.slice();
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i - 1 + n) % n];
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    const a1 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) > angleToleranceRad) out.push(p1);
  }
  return out.length >= 3 ? out : ring.slice();
}

/** Isoperimetric compactness: 1.0 for a perfect circle, ~0.785 for a square. */
export function circularity(pts: Point[]): number {
  const p = polygonPerimeter(pts);
  if (p <= EPS) return 0;
  return (4 * Math.PI * polygonArea(pts)) / (p * p);
}

/** Least-squares-ish circle fit (algebraic Kasa fit) over the ring vertices. */
export function fitCircle(pts: Point[]): { centre: Point; radius: number; maxRelDev: number } {
  const n = pts.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  for (const p of pts) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    syy += p.y * p.y;
    sxy += p.x * p.y;
    sxz += p.x * z;
    syz += p.y * z;
    sz += z;
  }
  const c11 = 2 * (sxx - (sx * sx) / n);
  const c12 = 2 * (sxy - (sx * sy) / n);
  const c22 = 2 * (syy - (sy * sy) / n);
  const r1 = sxz - (sx * sz) / n;
  const r2 = syz - (sy * sz) / n;
  const det = c11 * c22 - c12 * c12;
  let cx: number;
  let cy: number;
  if (Math.abs(det) < EPS) {
    cx = sx / n;
    cy = sy / n;
  } else {
    cx = (r1 * c22 - r2 * c12) / det;
    cy = (c11 * r2 - c12 * r1) / det;
  }
  const rs = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const radius = rs.reduce((a, b) => a + b, 0) / n;
  const maxRelDev = radius > EPS ? Math.max(...rs.map((r) => Math.abs(r - radius))) / radius : 9;
  return { centre: { x: cx, y: cy }, radius, maxRelDev };
}

export interface RectFit {
  isRect: boolean;
  /** rotation of the longer edge, normalised to [0, PI/2) */
  rotationRad: number;
  /** long side length in drawing units */
  longUnits: number;
  /** short side length in drawing units */
  shortUnits: number;
  /** polygon area / oriented-bbox area (1.0 == perfect rectangle) */
  rectangularity: number;
  maxCornerDevRad: number;
  sideRatioDev: number;
}

/**
 * Test a 4-vertex ring for rectangularity from first principles: corner angles
 * near 90 degrees, opposite sides of equal length, and polygon area matching the
 * oriented bounding box. Works for rotated rectangles.
 */
export function fitRectangle(v: Point[]): RectFit {
  const fail: RectFit = {
    isRect: false,
    rotationRad: 0,
    longUnits: 0,
    shortUnits: 0,
    rectangularity: 0,
    maxCornerDevRad: Math.PI,
    sideRatioDev: 1,
  };
  if (v.length !== 4) return fail;
  const sides = v.map((p, i) => sub(v[(i + 1) % 4], p));
  const lens = sides.map(len);
  if (lens.some((l) => l < EPS)) return fail;
  let maxCornerDev = 0;
  for (let i = 0; i < 4; i++) {
    const a = sides[i];
    const b = sides[(i + 1) % 4];
    const cosang = (a.x * b.x + a.y * b.y) / (lens[i] * lens[(i + 1) % 4]);
    const dev = Math.abs(Math.acos(Math.max(-1, Math.min(1, cosang))) - Math.PI / 2);
    if (dev > maxCornerDev) maxCornerDev = dev;
  }
  const p0 = (lens[0] + lens[2]) / 2;
  const p1 = (lens[1] + lens[3]) / 2;
  const sideRatioDev = Math.max(
    Math.abs(lens[0] - lens[2]) / Math.max(p0, EPS),
    Math.abs(lens[1] - lens[3]) / Math.max(p1, EPS),
  );
  const area = polygonArea(v);
  const rectangularity = p0 * p1 > EPS ? area / (p0 * p1) : 0;
  const longIdx = p0 >= p1 ? 0 : 1;
  const longSide = sides[longIdx];
  let rot = Math.atan2(longSide.y, longSide.x) % Math.PI;
  if (rot < 0) rot += Math.PI;
  if (rot >= Math.PI / 2) rot -= Math.PI / 2;
  return {
    isRect: true,
    rotationRad: rot,
    longUnits: Math.max(p0, p1),
    shortUnits: Math.min(p0, p1),
    rectangularity,
    maxCornerDevRad: maxCornerDev,
    sideRatioDev,
  };
}

/** Monotone-chain convex hull. */
export function convexHull(pts: Point[]): Point[] {
  const uniq = new Map<string, Point>();
  for (const p of pts) uniq.set(`${p.x.toFixed(6)},${p.y.toFixed(6)}`, p);
  const s = [...uniq.values()].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (s.length < 3) return s;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Flatten a cubic bezier into a polyline of `steps` segments. */
export function flattenCubic(c: CubicCurve, steps: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * c.p0.x + 3 * u * u * t * c.p1.x + 3 * u * t * t * c.p2.x + t * t * t * c.p3.x,
      y: u * u * u * c.p0.y + 3 * u * u * t * c.p1.y + 3 * u * t * t * c.p2.y + t * t * t * c.p3.y,
    });
  }
  return out;
}
