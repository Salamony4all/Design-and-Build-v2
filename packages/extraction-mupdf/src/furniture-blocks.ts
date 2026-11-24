/**
 * Loose furniture, fittings and fixtures read from the drawing's own linework
 * (no raster, no AI). CAD exports keep the drawing layers, and furniture sits on
 * layers named for it (FURNITURE, Aménagement, A57 Furniture, F_C-FURNITURE…).
 *
 *  1. Strokes on furniture-type layers inside the building are taken.
 *  2. Big closed outlines (rugs, zone circles, area outlines) are set aside: every
 *     piece standing on them would otherwise join into one.
 *  3. Strokes that touch (within 3 cm) on the same layer form one piece.
 *  4. A piece holding a round table top that only joins the rest through that top
 *     (chairs pulled up to a table) is split into the table and the chairs.
 *  5. Each piece's footprint is traced (strokes rasterised at 2 cm, small holes
 *     filled, outer edge followed) and its kind guessed from its layer, nearby
 *     text, size, shape and how densely it is drawn.
 *  6. Each piece that has a front is turned the way the drawing shows it facing
 *     (furniture-facing.ts): seats to their table, desks to their chair, backs to
 *     walls, seats and bowls drawn to one side.
 *
 * Identical pieces (same kind and size) form a type with a count: the drawing's
 * own furniture schedule, used to check a BOQ and to match products.
 *
 * Coordinates are MuPDF page points (y down).
 */
import type { Bounds, MuVector, Vec2 } from './vector-device';
import { fitCircle } from './curved-walls';
import { pieceFacings, type FacingCue, type FacingWall } from './furniture-facing';

export type FurnitureFamily = 'furniture' | 'plant' | 'sanitary' | 'equipment' | 'joinery' | 'fixture';
export type FurnitureKind =
  | 'seat'
  | 'sofa'
  | 'table'
  | 'side-table'
  | 'desk'
  | 'bed'
  | 'storage'
  | 'plant'
  | 'screen'
  | 'sanitary'
  | 'equipment'
  | 'joinery'
  | 'unknown';
export type FurnitureShape = 'round' | 'rect' | 'curved' | 'l-shape' | 'free';

export interface FurnitureText { text: string; x: number; y: number; w: number; h: number }

/** Lines of text from MuPDF structured text JSON (page.toStructuredText().asJSON()). */
export function furnitureTextsFromStructuredText(json: string): FurnitureText[] {
  const out: FurnitureText[] = [];
  try {
    const sj = JSON.parse(json) as { blocks?: { lines?: { text?: string; bbox?: { x: number; y: number; w: number; h: number } }[] }[] };
    for (const b of sj.blocks ?? []) {
      for (const l of b.lines ?? []) {
        const t = l.text?.trim();
        if (t && l.bbox) out.push({ text: t, x: l.bbox.x, y: l.bbox.y, w: l.bbox.w, h: l.bbox.h });
      }
    }
  } catch {
    // no text layer: pieces simply get no labels
  }
  return out;
}

export interface FurniturePiece {
  id: string;
  typeId: string;
  layer: string;
  family: FurnitureFamily;
  kind: FurnitureKind;
  shape: FurnitureShape;
  /** Traced footprint, page points, closed (first point not repeated). */
  outline: Vec2[];
  /** Centre of the footprint, page points. */
  center: Vec2;
  /** Long and short side of the smallest box around the footprint, metres. */
  widthM: number;
  depthM: number;
  /** Direction of the long side in page space, radians. */
  angle: number;
  areaM2: number;
  /** Suggested height for a 3D stand-in, metres. */
  heightM: number;
  /** Text written on or next to the piece (for example "TV 65\""). */
  label?: string;
  /**
   * Which way the piece faces, page-space radians (y down), from its back to its front:
   * the open side of a seat or sofa, the user's side of a desk, the foot of a bed, the
   * open side of a cabinet, basin or WC. Absent for pieces without a front (tables,
   * plants) and where the drawing does not tell.
   */
  facing?: number;
  /** What told the front (see furniture-facing.ts). */
  facingBy?: FacingCue;
  vectorIds: string[];
  /** Shape measures behind the guess (ink per outline length, box fill, solidity, band thickness in m). */
  metrics: { busy: number; fill: number; solidity: number; circularity: number; corners: number; bandM: number };
}

export interface FurnitureType {
  id: string;
  family: FurnitureFamily;
  kind: FurnitureKind;
  shape: FurnitureShape;
  layer: string;
  widthM: number;
  depthM: number;
  count: number;
  pieceIds: string[];
}

export interface FurnitureResult {
  pieces: FurniturePiece[];
  types: FurnitureType[];
  /** Furniture-type layers found in the drawing. */
  layers: string[];
  diagnostics: { strokes: number; zones: number; tableTops: number; splitSets: number; dropped: number; ms: number };
}

export interface FurnitureConfig {
  touchM: number;
  rasterM: number;
  minPieceM: number;
  maxPieceM: number;
  zoneCircleM: number;
  zoneLoopM2: number;
  tableMinM: number;
  tableMaxM: number;
  holeMaxM2: number;
  labelM: number;
}

export const FURNITURE_DEFAULTS: FurnitureConfig = {
  touchM: 0.03,
  rasterM: 0.02,
  minPieceM: 0.2,
  maxPieceM: 8,
  zoneCircleM: 1.7,
  zoneLoopM2: 2.5,
  tableMinM: 0.4,
  tableMaxM: 1.7,
  holeMaxM2: 3,
  labelM: 0.6,
};

/** Layers that hold furniture, fittings or fixtures. */
export const FURNITURE_LAYER_RE = /furn|mobil|am[eé]nag|seat|chair|sofa|ff&?e|planter|plant|verdure|v[eé]g[eé]t|eq(ui)?p|eqmp|appliance|casework|millwork|joinery|sanit|plumb|toilet|fixture|fixt/i;
/** Layers that are something else even when their name mentions furniture. */
export const NOT_FURNITURE_LAYER_RE = /menuis|door|porte|window|fen[eê]tre|glaz|vitr|\bwall|mur\b|dim|cotat|text|txt|anno|axe|axis|grid|hatch|hach|ceil|plafond|floor|\bsol\b|stair|escalier|tblock|title|cartouche/i;

export function furnitureFamily(layer: string): FurnitureFamily {
  if (/sanit|plumb|toilet|wc\b/i.test(layer)) return 'sanitary';
  if (/plant|verdure|v[eé]g[eé]t|tree|arbre|landscap/i.test(layer)) return 'plant';
  if (/eq(ui)?p|eqmp|appliance/i.test(layer)) return 'equipment';
  if (/joinery|casework|millwork|kitch|cuisine/i.test(layer)) return 'joinery';
  if (/fixt/i.test(layer) && !/furn|mobil|am[eé]nag/i.test(layer)) return 'fixture';
  return 'furniture';
}

export function isFurnitureLayer(layer: string | undefined): boolean {
  return !!layer && FURNITURE_LAYER_RE.test(layer) && !NOT_FURNITURE_LAYER_RE.test(layer);
}

// ── geometry helpers ────────────────────────────────────────────────────────

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const r2 = (v: number) => Math.round(v * 100) / 100;

function bez(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function segDist2(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  let t = l > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = a.x + t * dx - p.x, y = a.y + t * dy - p.y;
  return x * x + y * y;
}

function segsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Closest distance between two segments, squared. */
function segSeg2(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segsIntersect(a, b, c, d)) return 0;
  return Math.min(segDist2(a, c, d), segDist2(b, c, d), segDist2(c, a, b), segDist2(d, a, b));
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function polygonArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return Math.abs(s) / 2;
}

function polygonCentroid(pts: Vec2[]): Vec2 {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    a += f;
    cx += (pts[j].x + pts[i].x) * f;
    cy += (pts[j].y + pts[i].y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = pts.length || 1;
    return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Smallest-area box around a convex hull: long side, short side, long-side angle. */
export function minAreaRect(hull: Vec2[]): { w: number; d: number; angle: number } {
  if (hull.length < 2) return { w: 0, d: 0, angle: 0 };
  let best = { area: Infinity, w: 0, d: 0, angle: 0 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(ang), s = Math.sin(ang);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * c + p.y * s, v = -p.x * s + p.y * c;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU, d = maxV - minV;
    if (w * d < best.area) best = w >= d ? { area: w * d, w, d, angle: ang } : { area: w * d, w: d, d: w, angle: ang + Math.PI / 2 };
  }
  let angle = best.angle % Math.PI;
  if (angle < 0) angle += Math.PI;
  return { w: best.w, d: best.d, angle };
}

function simplify(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1, wd = 0;
    for (let k = i + 1; k < j; k++) {
      const d2 = segDist2(pts[k], pts[i], pts[j]);
      if (d2 > wd) { wd = d2; worst = k; }
    }
    if (worst > 0 && wd > t2) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

// ── strokes ────────────────────────────────────────────────────────────────

interface Stroke {
  v: MuVector;
  layer: string;
  family: FurnitureFamily;
  lines: Vec2[][];
  bb: Bounds;
  len: number;
}

interface Arc { s: number; c: Vec2; r: number; from: number; sweep: number }

function flatten(v: MuVector, curveSteps = 8): { lines: Vec2[][]; curves: { p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2 }[]; closed: Vec2[][] } {
  const lines: Vec2[][] = [];
  const curves: { p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2 }[] = [];
  const closed: Vec2[][] = [];
  let cur: Vec2[] = [];
  let first: Vec2 | null = null;
  let last: Vec2 | null = null;
  for (const c of v.commands as Array<Record<string, any>>) {
    if (c.op === 'M') {
      if (cur.length > 1) lines.push(cur);
      first = last = { x: c.x, y: c.y };
      cur = [first];
    } else if (c.op === 'L') {
      last = { x: c.x, y: c.y };
      cur.push(last);
    } else if (c.op === 'C' && last) {
      const p0 = last;
      curves.push({ p0, p1: c.p1, p2: c.p2, p3: c.p3 });
      for (let k = 1; k <= curveSteps; k++) cur.push(bez(p0, c.p1, c.p2, c.p3, k / curveSteps));
      last = c.p3;
    } else if (c.op === 'Z') {
      if (first && last && dist(first, last) > 1e-6) cur.push(first);
      if (cur.length > 2) closed.push(cur);
      if (cur.length > 1) lines.push(cur);
      cur = first ? [first] : [];
      last = first;
    }
  }
  if (cur.length > 1) lines.push(cur);
  return { lines, curves, closed };
}

class UnionFind {
  p: Int32Array;
  constructor(n: number) {
    this.p = new Int32Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  find(i: number): number {
    const p = this.p;
    while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; }
    return i;
  }
  union(a: number, b: number): boolean {
    const x = this.find(a), y = this.find(b);
    if (x === y) return false;
    this.p[x] = y;
    return true;
  }
}

/** Angular union of arcs on one circle, radians covered. */
function arcCoverage(arcs: Arc[]): number {
  const iv: [number, number][] = [];
  for (const a of arcs) {
    let s = a.from % (2 * Math.PI);
    if (s < 0) s += 2 * Math.PI;
    const e = s + a.sweep;
    if (e > 2 * Math.PI) { iv.push([s, 2 * Math.PI], [0, e - 2 * Math.PI]); } else iv.push([s, e]);
  }
  iv.sort((p, q) => p[0] - q[0]);
  let total = 0, cs = -1, ce = -1;
  for (const [s, e] of iv) {
    if (s > ce) { if (ce > cs) total += ce - cs; cs = s; ce = e; } else if (e > ce) ce = e;
  }
  if (ce > cs) total += ce - cs;
  return total;
}

// ── footprint tracing ───────────────────────────────────────────────────────

interface Footprint { outline: Vec2[]; areaPt2: number }

/**
 * Rasterise the strokes, fill holes smaller than `holeMaxPt2`, and follow the
 * outer edge of the largest solid. Returns the outline in page points.
 */
function traceFootprint(strokes: Stroke[], res: number, holeMaxPt2: number): Footprint | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    x0 = Math.min(x0, s.bb[0]); y0 = Math.min(y0, s.bb[1]);
    x1 = Math.max(x1, s.bb[2]); y1 = Math.max(y1, s.bb[3]);
  }
  const pad = 3;
  const W = Math.ceil((x1 - x0) / res) + 2 * pad + 1;
  const H = Math.ceil((y1 - y0) / res) + 2 * pad + 1;
  if (W * H > 4_000_000) return null;
  const grid = new Uint8Array(W * H); // 1 = ink/solid, 2 = outside
  const gx = (x: number) => Math.floor((x - x0) / res) + pad;
  const gy = (y: number) => Math.floor((y - y0) / res) + pad;
  const mark = (cx: number, cy: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = cx + dx, Y = cy + dy;
      if (X >= 0 && Y >= 0 && X < W && Y < H) grid[Y * W + X] = 1;
    }
  };
  for (const s of strokes) {
    for (const line of s.lines) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        const n = Math.max(1, Math.ceil(dist(a, b) / (res * 0.5)));
        for (let k = 0; k <= n; k++) mark(gx(a.x + ((b.x - a.x) * k) / n), gy(a.y + ((b.y - a.y) * k) / n));
      }
    }
  }
  // Outside: flood from the border through empty cells.
  const q = new Int32Array(W * H);
  let qh = 0, qt = 0;
  for (let x = 0; x < W; x++) { q[qt++] = x; q[qt++] = (H - 1) * W + x; }
  for (let y = 0; y < H; y++) { q[qt++] = y * W; q[qt++] = y * W + W - 1; }
  for (let i = 0; i < qt; i++) grid[q[i]] = grid[q[i]] === 0 ? 2 : grid[q[i]];
  qt = 0;
  for (let i = 0; i < W * H; i++) if (grid[i] === 2) q[qt++] = i;
  while (qh < qt) {
    const i = q[qh++];
    const x = i % W, y = (i / W) | 0;
    if (x > 0 && grid[i - 1] === 0) { grid[i - 1] = 2; q[qt++] = i - 1; }
    if (x < W - 1 && grid[i + 1] === 0) { grid[i + 1] = 2; q[qt++] = i + 1; }
    if (y > 0 && grid[i - W] === 0) { grid[i - W] = 2; q[qt++] = i - W; }
    if (y < H - 1 && grid[i + W] === 0) { grid[i + W] = 2; q[qt++] = i + W; }
  }
  // Holes: small ones become solid; large ones (rings drawn around nothing) stay open.
  const holeMaxCells = holeMaxPt2 / (res * res);
  for (let i = 0; i < W * H; i++) {
    if (grid[i] !== 0) continue;
    qh = 0; qt = 0;
    q[qt++] = i;
    grid[i] = 3;
    while (qh < qt) {
      const j = q[qh++];
      const x = j % W, y = (j / W) | 0;
      if (x > 0 && grid[j - 1] === 0) { grid[j - 1] = 3; q[qt++] = j - 1; }
      if (x < W - 1 && grid[j + 1] === 0) { grid[j + 1] = 3; q[qt++] = j + 1; }
      if (y > 0 && grid[j - W] === 0) { grid[j - W] = 3; q[qt++] = j - W; }
      if (y < H - 1 && grid[j + W] === 0) { grid[j + W] = 3; q[qt++] = j + W; }
    }
    const fill = qt <= holeMaxCells ? 1 : 4;
    for (let k = 0; k < qt; k++) grid[q[k]] = fill;
  }
  // Largest solid component (4-connected over 1s).
  const comp = new Int32Array(W * H).fill(-1);
  let bestId = -1, bestSize = 0, id = 0, solidCells = 0;
  for (let i = 0; i < W * H; i++) {
    if (grid[i] !== 1 || comp[i] >= 0) continue;
    qh = 0; qt = 0;
    q[qt++] = i;
    comp[i] = id;
    while (qh < qt) {
      const j = q[qh++];
      const x = j % W, y = (j / W) | 0;
      const nb = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1];
      for (const k of nb) if (k >= 0 && grid[k] === 1 && comp[k] < 0) { comp[k] = id; q[qt++] = k; }
    }
    solidCells += qt;
    if (qt > bestSize) { bestSize = qt; bestId = id; }
    id++;
  }
  if (bestId < 0) return null;
  // Follow the outer edge of the best component (Moore neighbourhood, clockwise).
  let start = -1;
  for (let i = 0; i < W * H; i++) if (comp[i] === bestId) { start = i; break; }
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && comp[y * W + x] === bestId;
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const sx = start % W, sy = (start / W) | 0;
  const path: Vec2[] = [];
  let cx = sx, cy = sy, dir = 7;
  for (let steps = 0; steps < 4 * (W + H) * 8; steps++) {
    path.push({ x: x0 + (cx - pad + 0.5) * res, y: y0 + (cy - pad + 0.5) * res });
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8; // start looking back-left of the last move
      const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      if (inside(nx, ny)) { cx = nx; cy = ny; dir = d; found = true; break; }
    }
    if (!found || (cx === sx && cy === sy)) break;
  }
  if (path.length < 3) return null;
  const outline = simplify([...path, path[0]], res * 0.75).slice(0, -1);
  if (outline.length < 3) return null;
  return { outline, areaPt2: solidCells * res * res };
}

// ── kinds ──────────────────────────────────────────────────────────────────

const SCREEN_LABEL = /\btv\b|screen|[eé]cran|monitor|display|advert|signage/i;

/**
 * What a piece most likely is, from its layer family, label, size and drawing.
 * `busy` is ink per outline length: about 1–2 for a plain outline (tables,
 * counters), more where cushions, arms and seams are drawn (chairs, sofas).
 * Returns null for marks that are not furniture (lines, thin arcs).
 */
export function classifyPiece(
  p: { family: FurnitureFamily; shape: FurnitureShape; widthM: number; depthM: number; busy: number; circularity: number; bandM: number; fill: number; solidity?: number; label?: string },
  cfg: FurnitureConfig = FURNITURE_DEFAULTS,
): FurnitureKind | null {
  const { family, shape, widthM: w, depthM: d, busy, circularity, bandM, fill, label } = p;
  const solidity = p.solidity ?? 1;
  const thin = d < 0.15 || bandM < 0.12;
  if (family === 'plant') return 'plant';
  if (family === 'sanitary') return thin && d < 0.06 ? null : 'sanitary';
  if (family === 'equipment') return 'equipment';
  if (family === 'joinery') return thin ? null : 'joinery';
  if (family === 'fixture') return null;
  if (label && SCREEN_LABEL.test(label)) return 'screen';
  if (thin) return null; // single lines and thin arcs: floor marks, barriers, outlines
  if (shape === 'round') {
    if (busy > 3 || circularity < 0.95) return w <= 1.2 ? 'seat' : 'sofa';
    if (w < 0.6) return 'side-table';
    return w <= cfg.tableMaxM ? 'table' : null;
  }
  if (w <= 1.1) return busy >= 2.2 ? 'seat' : w <= 0.7 ? 'side-table' : 'table';
  if (shape === 'free' && solidity >= 0.92 && busy < 2.2) return w <= 1.8 ? 'table' : 'desk'; // overlapping round tops, rounded tables
  if (shape === 'curved' || shape === 'l-shape' || (shape === 'free' && fill < 0.78)) {
    // Long bands and L shapes: sofas and benches, unless drawn as a bare outline wider than a seat.
    if (busy >= 1.2 && bandM >= 0.35 && bandM <= 1.2) return 'sofa';
    return bandM <= 0.9 ? 'desk' : 'table';
  }
  // Beds wider than a sofa is deep; at sofa depth (up to 1.05 m) a cushioned piece reads as a sofa.
  if (w >= 1.85 && w <= 2.3 && d > 1.05 && d <= 2.1 && busy >= 1.6 && fill >= 0.75) return 'bed';
  if (d >= 0.6 && d <= 1.25 && busy >= 2.2) return 'sofa';
  if (w > 4.2) return d >= 0.4 && d <= 1.2 && w <= 8 ? 'desk' : null;
  return d <= 0.9 ? 'desk' : 'table';
}

// ── main ────────────────────────────────────────────────────────────────────

const KIND_HEIGHT: Record<FurnitureKind, number> = {
  seat: 0.45,
  sofa: 0.45,
  table: 0.74,
  'side-table': 0.5,
  desk: 0.75,
  bed: 0.5,
  storage: 1.2,
  plant: 1.2,
  screen: 0.7,
  sanitary: 0.45,
  equipment: 1.2,
  joinery: 0.9,
  unknown: 0.6,
};

export function detectFurniture(
  input: { vectors: MuVector[]; scaleMmPerPt: number; within?: Bounds | null; texts?: FurnitureText[]; walls?: FacingWall[] },
  cfg: FurnitureConfig = FURNITURE_DEFAULTS,
): FurnitureResult {
  const t0 = Date.now();
  const mPerPt = input.scaleMmPerPt / 1000;
  const pt = (m: number) => m / mPerPt;
  const within = input.within ?? null;
  const layers = new Set<string>();

  // 1. Strokes on furniture layers.
  const strokes: Stroke[] = [];
  const arcs: Arc[] = [];
  const zoneStrokes = new Set<number>();
  for (const v of input.vectors) {
    if (v.sourceRootId || !isFurnitureLayer(v.layer)) continue;
    const b = v.bounds;
    if (within && (b[2] < within[0] || b[0] > within[2] || b[3] < within[1] || b[1] > within[3])) continue;
    if (Math.max(b[2] - b[0], b[3] - b[1]) > pt(cfg.maxPieceM)) continue;
    const f = flatten(v);
    if (!f.lines.length) continue;
    const layer = v.layer as string;
    layers.add(layer);
    let len = 0;
    for (const l of f.lines) for (let i = 1; i < l.length; i++) len += dist(l[i - 1], l[i]);
    const s = strokes.length;
    strokes.push({ v, layer, family: furnitureFamily(layer), lines: f.lines, bb: b, len });
    // circle arcs (table tops, rugs and zone circles)
    for (const c of f.curves) {
      const samples = [0, 0.25, 0.5, 0.75, 1].map((t) => bez(c.p0, c.p1, c.p2, c.p3, t));
      const fit = fitCircle(samples);
      if (!fit || fit.r < pt(0.15) || fit.r > pt(4) || fit.err > fit.r * 0.02 + pt(0.003)) continue;
      const a0 = Math.atan2(c.p0.y - fit.c.y, c.p0.x - fit.c.x);
      const a1 = Math.atan2(c.p3.y - fit.c.y, c.p3.x - fit.c.x);
      const am = Math.atan2(samples[2].y - fit.c.y, samples[2].x - fit.c.x);
      const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      let sweep = norm(a1 - a0);
      const mid = norm(am - a0);
      let from = a0;
      if (mid > sweep) { from = a1; sweep = norm(a0 - a1); }
      if (sweep > 1e-3) arcs.push({ s, c: fit.c, r: fit.r, from, sweep });
    }
    // big closed outlines with few corners: rugs and zone outlines
    for (const loop of f.closed) {
      if (loop.length <= 25 && polygonArea(loop) * mPerPt * mPerPt >= cfg.zoneLoopM2 && f.lines.length === 1) zoneStrokes.add(s);
    }
  }

  // 2. Circles from arcs: zones (rugs, platforms) are set aside; table tops are kept for step 4.
  const tolC = pt(0.03), tolR = pt(0.02);
  const circles: { c: Vec2; r: number; arcs: Arc[] }[] = [];
  const cellKey = (p: Vec2) => `${Math.round(p.x / tolC)},${Math.round(p.y / tolC)}`;
  const byCell = new Map<string, number[]>();
  for (const a of [...arcs].sort((p, q) => p.r - q.r)) {
    const kx = Math.round(a.c.x / tolC), ky = Math.round(a.c.y / tolC);
    let hit = -1;
    for (let dx = -1; dx <= 1 && hit < 0; dx++) for (let dy = -1; dy <= 1 && hit < 0; dy++) {
      for (const ci of byCell.get(`${kx + dx},${ky + dy}`) ?? []) {
        const c = circles[ci];
        if (Math.abs(c.r - a.r) <= tolR && dist(c.c, a.c) <= tolC) { hit = ci; break; }
      }
    }
    if (hit < 0) {
      hit = circles.length;
      circles.push({ c: a.c, r: a.r, arcs: [] });
      const k = cellKey(a.c);
      byCell.set(k, [...(byCell.get(k) ?? []), hit]);
    }
    circles[hit].arcs.push(a);
  }
  const strokeOnlyArcsOf = (c: { arcs: Arc[] }) => {
    const ids = new Set(c.arcs.map((a) => a.s));
    // a stroke counts as part of the circle only when all its curves lie on it
    return [...ids].filter((s) => arcs.filter((a) => a.s === s).every((a) => c.arcs.includes(a)));
  };
  const tableTops: { c: Vec2; r: number; strokes: number[] }[] = [];
  for (const c of circles) {
    const cover = arcCoverage(c.arcs);
    const d = 2 * c.r * mPerPt;
    const own = strokeOnlyArcsOf(c);
    // Zones must be (nearly) whole circles; a table top may be trimmed where chairs are drawn over it.
    if (d >= cfg.zoneCircleM && cover >= (300 * Math.PI) / 180) own.forEach((s) => zoneStrokes.add(s));
    else if (d >= cfg.tableMinM && d <= cfg.tableMaxM && cover >= (240 * Math.PI) / 180) tableTops.push({ c: c.c, r: c.r, strokes: own });
  }

  // 3. Touching strokes on the same layer form pieces.
  const n = strokes.length;
  const uf = new UnionFind(n);
  const touch = pt(cfg.touchM), touch2 = touch * touch;
  const cell = Math.max(pt(0.12), touch * 3);
  const segIndex = new Map<string, { s: number; a: Vec2; b: Vec2 }[]>();
  for (let s = 0; s < n; s++) {
    if (zoneStrokes.has(s)) continue;
    for (const line of strokes[s].lines) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        const xa = Math.floor((Math.min(a.x, b.x) - touch) / cell), xb = Math.floor((Math.max(a.x, b.x) + touch) / cell);
        const ya = Math.floor((Math.min(a.y, b.y) - touch) / cell), yb = Math.floor((Math.max(a.y, b.y) + touch) / cell);
        if ((xb - xa + 1) * (yb - ya + 1) > 400) continue;
        for (let x = xa; x <= xb; x++) for (let y = ya; y <= yb; y++) {
          const k = `${x},${y}`;
          let arr = segIndex.get(k);
          if (!arr) segIndex.set(k, (arr = []));
          arr.push({ s, a, b });
        }
      }
    }
  }
  const edges = new Set<number>();
  for (const arr of segIndex.values()) {
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      for (let j = i + 1; j < arr.length; j++) {
        const o = arr[j];
        if (o.s === p.s || strokes[o.s].layer !== strokes[p.s].layer) continue;
        const key = p.s < o.s ? p.s * n + o.s : o.s * n + p.s;
        if (edges.has(key)) continue;
        if (segSeg2(p.a, p.b, o.a, o.b) <= touch2) {
          edges.add(key);
          uf.union(p.s, o.s);
        }
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let s = 0; s < n; s++) {
    if (zoneStrokes.has(s)) continue;
    const r = uf.find(s);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(s);
  }

  // 4. Split chairs from the table top they are pulled up to.
  let splitSets = 0;
  const pieces: number[][] = [];
  const topsByStroke = new Map<number, number>();
  tableTops.forEach((t, i) => t.strokes.forEach((s) => topsByStroke.set(s, i)));
  for (const g of groups.values()) {
    const tops = [...new Set(g.map((s) => topsByStroke.get(s)).filter((t): t is number => t !== undefined))];
    if (!tops.length || g.length < 3) { pieces.push(g); continue; }
    const topStrokes = new Set(tops.flatMap((t) => tableTops[t].strokes));
    const rest = g.filter((s) => !topStrokes.has(s));
    const local = new UnionFind(n);
    const inRest = new Set(rest);
    for (const key of edges) {
      const a = Math.floor(key / n), b = key % n;
      if (inRest.has(a) && inRest.has(b)) local.union(a, b);
    }
    const parts = new Map<number, number[]>();
    for (const s of rest) {
      const r = local.find(s);
      let arr = parts.get(r);
      if (!arr) parts.set(r, (arr = []));
      arr.push(s);
    }
    const extentM = (ids: number[]) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of ids) { const b = strokes[s].bb; x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
      return { m: Math.max(x1 - x0, y1 - y0) * mPerPt, c: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } };
    };
    const big: number[][] = [];
    const tableParts: number[] = [...topStrokes];
    for (const ids of parts.values()) {
      const e = extentM(ids);
      const insideTop = tops.some((t) => dist(e.c, tableTops[t].c) < tableTops[t].r * 0.8);
      if (insideTop || e.m < cfg.minPieceM) tableParts.push(...ids); // centrepieces and marks stay with the table
      else big.push(ids);
    }
    if (big.length >= 1) {
      splitSets++;
      pieces.push(tableParts, ...big);
    } else pieces.push(g);
  }

  // Pieces lying inside a table top (an inner ring, a centrepiece) belong to that table.
  const pieceBox = (ids: number[]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of ids) { const b = strokes[s].bb; x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
    return { c: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, size: Math.max(x1 - x0, y1 - y0) };
  };
  for (const top of tableTops) {
    const host = pieces.findIndex((ids) => ids.includes(top.strokes[0]));
    if (host < 0) continue;
    for (let i = pieces.length - 1; i >= 0; i--) {
      if (i === host || !pieces[i].length) continue;
      const b = pieceBox(pieces[i]);
      if (dist(b.c, top.c) < top.r * 0.8 && b.size < top.r * 1.8) {
        pieces[host].push(...pieces[i]);
        pieces[i] = [];
      }
    }
  }

  // 5. Footprints, kinds and types.
  const res = pt(cfg.rasterM);
  const holeMax = pt(1) * pt(1) * cfg.holeMaxM2;
  const texts = input.texts ?? [];
  let dropped = 0;
  interface Measured {
    ids: number[];
    layer: string;
    family: FurnitureFamily;
    outline: Vec2[];
    isTop: boolean;
    areaM2: number;
    perimM: number;
    inkM: number;
  }
  const measured: Measured[] = [];
  for (const ids of pieces) {
    if (!ids.length) continue;
    const ss = ids.map((s) => strokes[s]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of ss) { x0 = Math.min(x0, s.bb[0]); y0 = Math.min(y0, s.bb[1]); x1 = Math.max(x1, s.bb[2]); y1 = Math.max(y1, s.bb[3]); }
    const extent = Math.max(x1 - x0, y1 - y0) * mPerPt;
    if (extent < cfg.minPieceM || extent > cfg.maxPieceM) { dropped++; continue; }
    // A table top (often trimmed where chairs are drawn over it) is its own circle.
    const idSet = new Set(ids);
    const top = tableTops.find((t) => t.strokes.length && t.strokes.every((s) => idSet.has(s)) && Math.max(x1 - x0, y1 - y0) <= t.r * 2 * 1.15);
    const fp = top
      ? { outline: Array.from({ length: 40 }, (_, k) => ({ x: top.c.x + top.r * Math.cos((k / 40) * 2 * Math.PI), y: top.c.y + top.r * Math.sin((k / 40) * 2 * Math.PI) })), areaPt2: Math.PI * top.r * top.r }
      : traceFootprint(ss, res, holeMax);
    if (!fp) { dropped++; continue; }
    let perim = 0;
    for (let i = 0; i < fp.outline.length; i++) perim += dist(fp.outline[i], fp.outline[(i + 1) % fp.outline.length]);
    measured.push({
      ids,
      layer: ss[0].layer,
      family: ss[0].family,
      outline: fp.outline,
      isTop: !!top,
      areaM2: fp.areaPt2 * mPerPt * mPerPt,
      perimM: perim * mPerPt,
      inkM: ss.reduce((sum, st) => sum + st.len, 0) * mPerPt,
    });
  }

  // A piece drawn wholly inside another (loose cushions inside a sofa outline, a
  // drawer front inside a cabinet) is part of it.
  for (let i = measured.length - 1; i >= 0; i--) {
    const a = measured[i];
    const host = measured.find((b) => b !== a && b.layer === a.layer && b.areaM2 > a.areaM2 && a.outline.every((q) => pointInPolygon(q, b.outline)));
    if (!host) continue;
    host.ids.push(...a.ids);
    host.inkM += a.inkM;
    measured.splice(i, 1);
  }

  const out: FurniturePiece[] = [];
  const outLines: Vec2[][][] = [];
  for (const m of measured) {
    const hull = convexHull(m.outline);
    const box = minAreaRect(hull);
    const widthM = box.w * mPerPt, depthM = box.d * mPerPt;
    const { areaM2, perimM, inkM, family } = m;
    if (widthM < cfg.minPieceM || areaM2 < 0.02) { dropped++; continue; }
    const hullArea = polygonArea(hull) * mPerPt * mPerPt;
    const fill = areaM2 / Math.max(1e-6, widthM * depthM);
    const solidity = areaM2 / Math.max(1e-6, hullArea);
    const circularity = (4 * Math.PI * areaM2) / Math.max(1e-6, perimM * perimM);
    let corners = 0;
    const ol = m.outline;
    for (let i = 0; i < ol.length; i++) {
      const a = ol[(i + ol.length - 1) % ol.length], b = ol[i], c = ol[(i + 1) % ol.length];
      const t = Math.abs(Math.atan2((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)));
      if (t > (50 * Math.PI) / 180 && dist(a, b) * mPerPt > 0.08 && dist(b, c) * mPerPt > 0.08) corners++;
    }
    const shape: FurnitureShape =
      circularity >= 0.8 && widthM / Math.max(depthM, 1e-6) <= 1.2 ? 'round'
        : fill >= 0.82 ? 'rect'
          : solidity < 0.75 && corners >= 5 ? 'l-shape'
            : solidity < 0.75 ? 'curved'
              : 'free';
    const center = polygonCentroid(ol);
    const label = texts
      .filter((t) => dist({ x: t.x + t.w / 2, y: t.y + t.h / 2 }, center) * mPerPt <= Math.max(cfg.labelM, widthM / 2 + 0.3))
      .sort((p, q) => dist({ x: p.x + p.w / 2, y: p.y + p.h / 2 }, center) - dist({ x: q.x + q.w / 2, y: q.y + q.h / 2 }, center))[0]?.text;
    const busy = inkM / Math.max(perimM, 1e-6); // outline only ≈ 1–2; cushions, arms, seams > 2
    const bandM = (2 * areaM2) / Math.max(perimM, 1e-6); // thickness of a long band (curved sofas)
    // A round top is a table only on a furniture layer (a planter or a basin can be round too).
    const kind = m.isTop && family === 'furniture' ? (widthM < 0.6 ? 'side-table' : 'table') : classifyPiece({ family, shape, widthM, depthM, busy, circularity, bandM, fill, solidity, label }, cfg);
    if (!kind) { dropped++; continue; }
    out.push({
      id: `fp_${out.length + 1}`,
      typeId: '',
      layer: m.layer,
      family,
      kind,
      shape,
      outline: ol,
      center,
      widthM: Math.round(widthM * 1000) / 1000,
      depthM: Math.round(depthM * 1000) / 1000,
      angle: box.angle,
      areaM2: Math.round(areaM2 * 1000) / 1000,
      heightM: KIND_HEIGHT[kind],
      ...(label ? { label } : {}),
      vectorIds: m.ids.map((s) => strokes[s].v.id),
      metrics: { busy: r2(busy), fill: r2(fill), solidity: r2(solidity), circularity: r2(circularity), corners, bandM: r2(bandM) },
    });
    outLines.push(m.ids.flatMap((s) => strokes[s].lines));
  }

  // A piece drawn exactly like a labelled screen (same layer and size) is a screen too.
  for (const p of out) {
    if (p.kind === 'screen' || p.family !== 'furniture') continue;
    if (out.some((q) => q.kind === 'screen' && q.label && q.layer === p.layer && Math.abs(q.widthM - p.widthM) <= 0.03 && Math.abs(q.depthM - p.depthM) <= 0.03)) {
      p.kind = 'screen';
      p.heightM = KIND_HEIGHT.screen;
    }
  }

  // Which way each piece faces (seats to their table, desks to their chair, backs to walls…).
  const facings = pieceFacings(
    out.map((p, i) => ({ kind: p.kind, shape: p.shape, outline: p.outline, center: p.center, angle: p.angle, widthM: p.widthM, depthM: p.depthM, lines: outLines[i] })),
    input.walls ?? [],
    mPerPt,
  );
  out.forEach((p, i) => {
    const f = facings[i];
    if (f) {
      p.facing = Math.round(f.angle * 1000) / 1000;
      p.facingBy = f.by;
    }
  });

  // Types: same family, kind and shape, sizes within 6 cm.
  const types: FurnitureType[] = [];
  const sorted = [...out].sort((p, q) => p.family.localeCompare(q.family) || p.kind.localeCompare(q.kind) || p.shape.localeCompare(q.shape) || p.widthM - q.widthM || p.depthM - q.depthM);
  for (const p of sorted) {
    const t = types.find((ty) => ty.family === p.family && ty.kind === p.kind && ty.shape === p.shape && Math.abs(ty.widthM - p.widthM) <= 0.06 && Math.abs(ty.depthM - p.depthM) <= 0.06);
    if (t) {
      t.pieceIds.push(p.id);
      t.count++;
      p.typeId = t.id;
    } else {
      const id = `ft_${types.length + 1}`;
      types.push({ id, family: p.family, kind: p.kind, shape: p.shape, layer: p.layer, widthM: p.widthM, depthM: p.depthM, count: 1, pieceIds: [p.id] });
      p.typeId = id;
    }
  }

  return {
    pieces: out,
    types,
    layers: [...layers],
    diagnostics: { strokes: n, zones: zoneStrokes.size, tableTops: tableTops.length, splitSets, dropped, ms: Date.now() - t0 },
  };
}
