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
import {
  acceptBroadCandidate,
  classifySymbol,
  clusterSymbols,
  collectBroadCandidateVectors,
  computeSymbolFingerprint,
  extractSymbolSubParts,
  findRectTableTops,
  inferRoomContext,
  type FurnitureSubtype,
  type PieceSubPart,
  type RoomContext,
} from './furniture-symbols';

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
  /** Subtype inferred from internal symbol grammar & room context. */
  subtype?: FurnitureSubtype;
  /** Room label context near this piece (e.g. 'wc', 'lounge', 'office'). */
  room?: string;
  /** Whether the piece was read from an explicit CAD furniture layer or layerless broad detection. */
  sourceMode?: 'layer' | 'broad';
  /** Classification confidence (0..1). */
  confidence?: number;
  /** Number of recurring instances sharing this CAD block fingerprint on the sheet. */
  clusterCount?: number;
  /** True when bespoke geometry / sub-parts warrant a custom procedural 3D model. */
  customModel?: boolean;
  /** Internal geometric sub-parts (overhead cabinets, sink/bowl cutouts, cistern, pillows, cushions, X-brace). */
  subParts?: PieceSubPart[];
  vectorIds: string[];
  /** Shape measures behind the guess (ink per outline length, box fill, solidity, band thickness in m). */
  metrics: { busy: number; fill: number; solidity: number; circularity: number; corners: number; bandM: number };
}

export interface FurnitureType {
  id: string;
  family: FurnitureFamily;
  kind: FurnitureKind;
  subtype?: FurnitureSubtype;
  room?: string;
  sourceMode?: 'layer' | 'broad';
  customModel?: boolean;
  shape: FurnitureShape;
  layer: string;
  widthM: number;
  depthM: number;
  count: number;
  pieceIds: string[];
}

export interface ArchitecturalZone {
  id: string;
  kind: 'rotunda-canopy' | 'ceiling-bulkhead' | 'feature-zone';
  shape: 'round' | 'oval' | 'polygon';
  center: Vec2;
  widthM: number;
  depthM: number;
  radiusM?: number;
  innerRadiiM?: number[];
  outline: Vec2[];
  label?: string;
  roomContext?: RoomContext;
  layer?: string;
}

export interface FurnitureResult {
  pieces: FurniturePiece[];
  types: FurnitureType[];
  /** Extracted overhead canopies, rotunda rings & feature ceiling/floor zones. */
  zones?: ArchitecturalZone[];
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
export const FURNITURE_LAYER_RE = /furn|mobil|am[eé]nag|seat|chair|sofa|ff&?e|\bffe\b|planter|plant|verdure|v[eé]g[eé]t|eq(ui)?p|eqmp|appliance|casework|millwork|joinery|sanit|plumb|toilet|lavatory|sink|shower|bath\b|kitch|cuisine|wardrobe|cabinet|cupboard|workstation|loose|fixture|fixt/i;
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
  sourceMode: 'layer' | 'broad';
  lines: Vec2[][];
  closed: Vec2[][];
  curves: { p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2 }[];
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
 * Rasterise the strokes, fill holes smaller than `holeMaxPt2` (allowing up to 1.85×
 * for compact rectangular furniture spans <= `compactShortSpanPt` such as kitchen
 * islands or dining booths while keeping circular rotunda rings hollow), and follow
 * the outer edge of the largest solid. Returns the outline in page points.
 */
function traceFootprint(strokes: Stroke[], res: number, holeMaxPt2: number, compactShortSpanPt = 0): Footprint | null {
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
    let hxMin = i % W;
    let hxMax = hxMin;
    let hyMin = (i / W) | 0;
    let hyMax = hyMin;
    while (qh < qt) {
      const j = q[qh++];
      const x = j % W, y = (j / W) | 0;
      if (x < hxMin) hxMin = x;
      if (x > hxMax) hxMax = x;
      if (y < hyMin) hyMin = y;
      if (y > hyMax) hyMax = y;
      if (x > 0 && grid[j - 1] === 0) { grid[j - 1] = 3; q[qt++] = j - 1; }
      if (x < W - 1 && grid[j + 1] === 0) { grid[j + 1] = 3; q[qt++] = j + 1; }
      if (y > 0 && grid[j - W] === 0) { grid[j - W] = 3; q[qt++] = j - W; }
      if (y < H - 1 && grid[j + W] === 0) { grid[j + W] = 3; q[qt++] = j + W; }
    }
    const shortSpanPt = Math.min(hxMax - hxMin + 1, hyMax - hyMin + 1) * res;
    const effectiveMaxCells =
      compactShortSpanPt > 0 && shortSpanPt <= compactShortSpanPt ? holeMaxCells * 1.85 : holeMaxCells;
    const fill = qt <= effectiveMaxCells ? 1 : 4;
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
  input: {
    vectors: MuVector[];
    scaleMmPerPt: number;
    within?: Bounds | null;
    texts?: FurnitureText[];
    walls?: FacingWall[];
    claimedVectorIds?: ReadonlySet<string> | readonly string[];
    mode?: 'auto' | 'layered' | 'broad';
  },
  cfg: FurnitureConfig = FURNITURE_DEFAULTS,
): FurnitureResult {
  const t0 = Date.now();
  const mPerPt = input.scaleMmPerPt / 1000;
  const pt = (m: number) => m / mPerPt;
  const within = input.within ?? null;
  const layers = new Set<string>();
  const mode = input.mode ?? 'auto';
  const claimedSet = input.claimedVectorIds
    ? input.claimedVectorIds instanceof Set
      ? input.claimedVectorIds
      : new Set(input.claimedVectorIds)
    : undefined;

  // Precompute structural wall centerlines for wall-crossing / multi-stall isolation guards.
  const rawWalls = (input.walls ?? []).filter((w) => dist(w.a, w.b) >= pt(0.35));
  const segMid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const segCrossesWall = (a: Vec2, b: Vec2): boolean => {
    const clearPt = pt(0.08);
    for (const w of rawWalls) {
      if (!segsIntersect(a, b, w.a, w.b)) continue;
      if (segDist2(a, w.a, w.b) > clearPt * clearPt && segDist2(b, w.a, w.b) > clearPt * clearPt) {
        return true;
      }
    }
    return false;
  };
  const distinctWallsCrossed = (loops: Vec2[][]): number => {
    const clearPt = pt(0.08);
    let count = 0;
    for (const w of rawWalls) {
      let sidePos = false;
      let sideNeg = false;
      let crosses = false;
      for (const l of loops) {
        for (let i = 1; i < l.length; i++) {
          const p = l[i - 1], q = l[i];
          if (segsIntersect(p, q, w.a, w.b)) crosses = true;
          const cross = (w.b.x - w.a.x) * (p.y - w.a.y) - (w.b.y - w.a.y) * (p.x - w.a.x);
          const d2 = segDist2(p, w.a, w.b);
          if (d2 > clearPt * clearPt) {
            if (cross > 0) sidePos = true;
            else if (cross < 0) sideNeg = true;
          }
        }
      }
      if (crosses && sidePos && sideNeg) {
        count++;
        if (count >= 2) return count;
      }
    }
    return count;
  };

  // 1. Strokes on furniture layers (unless forced to broad-only).
  const strokes: Stroke[] = [];
  const arcs: Arc[] = [];
  const zoneStrokes = new Set<number>();
  const ingestVector = (v: MuVector, layer: string, family: FurnitureFamily, sourceMode: 'layer' | 'broad') => {
    const b = v.bounds;
    if (within && (b[2] < within[0] || b[0] > within[2] || b[3] < within[1] || b[1] > within[3])) return;
    const spanPt = Math.max(b[2] - b[0], b[3] - b[1]);
    if (spanPt > pt(cfg.maxPieceM)) return;
    // Sanitary / plumbing single vectors larger than a full bathtub are shared piping runs, never one fixture.
    if (family === 'sanitary' && spanPt > pt(2.2)) return;
    const f = flatten(v);
    if (!f.lines.length) return;
    if (v.layer) layers.add(v.layer);
    let len = 0;
    for (const l of f.lines) for (let i = 1; i < l.length; i++) len += dist(l[i - 1], l[i]);
    const s = strokes.length;
    strokes.push({ v, layer, family, sourceMode, lines: f.lines, closed: f.closed, curves: f.curves, bb: b, len });
    if (rawWalls.length && distinctWallsCrossed(f.lines) >= 2) {
      zoneStrokes.add(s);
    }
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
    // big closed outlines with few corners: rugs and zone outlines (never drop beds or conference tables)
    for (const loop of f.closed) {
      if (loop.length <= 25 && f.lines.length === 1) {
        const areaM2 = polygonArea(loop) * mPerPt * mPerPt;
        if (areaM2 >= cfg.zoneLoopM2) {
          const box = minAreaRect(convexHull(loop));
          const wM = box.w * mPerPt;
          const dM = box.d * mPerPt;
          const isBedSized = wM <= 2.35 && dM <= 2.25;
          const isTableSized = dM <= 2.15 && wM <= 6.0;
          if (areaM2 >= 6.0 || (!isBedSized && !isTableSized)) zoneStrokes.add(s);
        }
      }
    }
  };

  if (mode !== 'broad') {
    for (const v of input.vectors) {
      if (v.sourceRootId || !isFurnitureLayer(v.layer)) continue;
      const layer = v.layer as string;
      ingestVector(v, layer, furnitureFamily(layer), 'layer');
    }
  }

  // 1b. Broad layerless fallback when no CAD furniture layers exist (or mode === 'broad').
  if (mode === 'broad' || (mode !== 'layered' && strokes.length === 0)) {
    const broadVectors = collectBroadCandidateVectors({
      vectors: input.vectors,
      scaleMmPerPt: input.scaleMmPerPt,
      within,
      walls: input.walls,
      claimedVectorIds: claimedSet,
      maxPieceM: cfg.maxPieceM,
      excludedLayerRe: NOT_FURNITURE_LAYER_RE,
    });
    for (const v of broadVectors) {
      ingestVector(v, v.layer ?? '__broad__', 'furniture', 'broad');
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
        if (segSeg2(p.a, p.b, o.a, o.b) <= touch2 && !segCrossesWall(segMid(p.a, p.b), segMid(o.a, o.b))) {
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

  // 4. Split chairs from round or rectangular table tops they are pulled up to.
  let splitSets = 0;
  const pieces: number[][] = [];
  const splitTopSet = new Set<number[]>();
  const splitChairSet = new Set<number[]>();
  const topsByStroke = new Map<number, number>();
  tableTops.forEach((t, i) => t.strokes.forEach((s) => topsByStroke.set(s, i)));
  for (const g of groups.values()) {
    const tops = [...new Set(g.map((s) => topsByStroke.get(s)).filter((t): t is number => t !== undefined))];
    if (!tops.length || g.length < 3) {
      const rectSplit = findRectTableTops(g, strokes, edges, n, mPerPt);
      if (rectSplit) {
        splitSets++;
        splitTopSet.add(rectSplit.tableParts);
        for (const ch of rectSplit.chairParts) splitChairSet.add(ch);
        pieces.push(rectSplit.tableParts, ...rectSplit.chairParts);
      } else {
        pieces.push(g);
      }
      continue;
    }
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
      splitTopSet.add(tableParts);
      for (const ch of big) splitChairSet.add(ch);
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

  // 5. Footprints, sub-parts, kinds and types.
  const res = pt(cfg.rasterM);
  const holeMax = pt(1) * pt(1) * cfg.holeMaxM2;
  const texts = input.texts ?? [];
  const wallFaces = (input.walls ?? []).map((w) => ({ a: w.a, b: w.b, half: (w.t && w.t > 0 ? w.t : pt(0.15)) / 2 }));
  const nearWall = (c: Vec2, wM: number, dM: number) => {
    const tol = pt(Math.max(wM, dM) / 2 + 0.35);
    return wallFaces.some((w) => segDist2(c, w.a, w.b) <= (w.half + tol) ** 2);
  };
  let dropped = 0;
  interface Measured {
    ids: number[];
    layer: string;
    family: FurnitureFamily;
    sourceMode: 'layer' | 'broad';
    outline: Vec2[];
    isTop: boolean;
    hasSplitChairs: boolean;
    wasSplitChair: boolean;
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
      : traceFootprint(ss, res, holeMax, pt(2.15));
    if (!fp) { dropped++; continue; }
    let perim = 0;
    for (let i = 0; i < fp.outline.length; i++) perim += dist(fp.outline[i], fp.outline[(i + 1) % fp.outline.length]);
    measured.push({
      ids,
      layer: ss[0].layer,
      family: ss[0].family,
      sourceMode: ss[0].sourceMode,
      outline: fp.outline,
      isTop: !!top || splitTopSet.has(ids),
      hasSplitChairs: splitTopSet.has(ids),
      wasSplitChair: splitChairSet.has(ids),
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

  const rawOut: FurniturePiece[] = [];
  const rawLines: Vec2[][][] = [];
  const fingerprints: ReturnType<typeof computeSymbolFingerprint>[] = [];
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
    const memberStrokes = m.ids.map((s) => strokes[s]);
    const subParts = extractSymbolSubParts({
      strokes: memberStrokes,
      outline: ol,
      center,
      widthM,
      depthM,
      angle: box.angle,
      mPerPt,
    });
    const room = inferRoomContext(center, texts, mPerPt);
    // Reject merged blobs whose footprint spans across multiple walls (e.g. adjoining toilet stalls).
    if (widthM > 1.4 && distinctWallsCrossed([[...ol, ol[0]]]) >= 2) {
      dropped++;
      continue;
    }
    const baseKind = m.isTop && family === 'furniture'
      ? (widthM < 0.6 ? 'side-table' : 'table')
      : classifyPiece({ family, shape, widthM, depthM, busy, circularity, bandM, fill, solidity, label }, cfg);
    const segmentCount = memberStrokes.reduce(
      (sum, st) => sum + st.lines.reduce((acc, ln) => acc + Math.max(0, ln.length - 1), 0),
      0,
    );
    const cls = classifySymbol({
      family,
      shape,
      widthM,
      depthM,
      busy,
      circularity,
      bandM,
      fill,
      solidity,
      corners,
      label,
      room,
      subParts,
      baseKind,
      hasWallBehind: wallFaces.length > 0 && nearWall(center, widthM, depthM),
      wasSplitFromTable: m.wasSplitChair,
      isTableTop: m.isTop,
      hasSplitChairs: m.hasSplitChairs,
      segmentCount,
    });
    if (!cls) { dropped++; continue; }
    const memberLines = memberStrokes.flatMap((st) => st.lines);
    const hasArcs = memberStrokes.some((st) => st.curves.length > 0);
    fingerprints.push(computeSymbolFingerprint({ lines: memberLines, center, widthM, depthM, shape, hasArcs, mPerPt }));
    rawOut.push({
      id: '',
      typeId: '',
      layer: m.layer,
      family,
      kind: cls.kind,
      subtype: cls.subtype,
      ...(room ? { room } : {}),
      sourceMode: m.sourceMode,
      confidence: Math.round(cls.confidence * 100) / 100,
      customModel: cls.customModel,
      ...(subParts.length ? { subParts } : {}),
      shape,
      outline: ol,
      center,
      widthM: Math.round(widthM * 1000) / 1000,
      depthM: Math.round(depthM * 1000) / 1000,
      angle: box.angle,
      areaM2: Math.round(areaM2 * 1000) / 1000,
      heightM: cls.heightM,
      ...(label ? { label } : {}),
      vectorIds: memberStrokes.map((st) => st.v.id),
      metrics: { busy: r2(busy), fill: r2(fill), solidity: r2(solidity), circularity: r2(circularity), corners, bandM: r2(bandM) },
    });
    rawLines.push(memberLines);
  }

  // Cluster recurring CAD blocks, propagate strong labels/subtypes, and filter broad noise.
  const clusters = clusterSymbols(fingerprints);
  const clusterBest = new Map<string, FurniturePiece>();
  rawOut.forEach((p, i) => {
    p.clusterCount = clusters[i].clusterCount;
    const cid = clusters[i].clusterId;
    const prev = clusterBest.get(cid);
    if (!prev || (p.confidence ?? 0) > (prev.confidence ?? 0) || (!prev.label && p.label)) {
      clusterBest.set(cid, p);
    }
  });

  const out: FurniturePiece[] = [];
  const outLines: Vec2[][][] = [];
  rawOut.forEach((p, i) => {
    const cid = clusters[i].clusterId;
    const best = clusterBest.get(cid);
    if (best && best !== p && (best.confidence ?? 0) >= 0.8 && (p.confidence ?? 0) < (best.confidence ?? 0)) {
      p.kind = best.kind;
      p.subtype = best.subtype;
      p.heightM = best.heightM;
      p.confidence = best.confidence;
      p.customModel = best.customModel;
    }
    if (p.sourceMode === 'broad' && !acceptBroadCandidate({ confidence: p.confidence ?? 0, clusterCount: p.clusterCount ?? 1, label: p.label })) {
      dropped++;
      return;
    }
    p.id = `fp_${out.length + 1}`;
    out.push(p);
    outLines.push(rawLines[i]);
  });

  // A piece drawn exactly like a labelled screen (same layer and size) is a screen too.
  for (const p of out) {
    if (p.kind === 'screen' || p.family !== 'furniture') continue;
    if (out.some((q) => q.kind === 'screen' && q.label && q.layer === p.layer && Math.abs(q.widthM - p.widthM) <= 0.03 && Math.abs(q.depthM - p.depthM) <= 0.03)) {
      p.kind = 'screen';
      p.subtype = 'screen';
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

  // Types: same family, kind, subtype and shape, sizes within 6 cm.
  const types: FurnitureType[] = [];
  const sorted = [...out].sort((p, q) => p.family.localeCompare(q.family) || p.kind.localeCompare(q.kind) || (p.subtype ?? '').localeCompare(q.subtype ?? '') || p.shape.localeCompare(q.shape) || p.widthM - q.widthM || p.depthM - q.depthM);
  for (const p of sorted) {
    const t = types.find((ty) => ty.family === p.family && ty.kind === p.kind && ty.subtype === p.subtype && ty.shape === p.shape && Math.abs(ty.widthM - p.widthM) <= 0.06 && Math.abs(ty.depthM - p.depthM) <= 0.06);
    if (t) {
      t.pieceIds.push(p.id);
      t.count++;
      p.typeId = t.id;
    } else {
      const id = `ft_${types.length + 1}`;
      types.push({
        id,
        family: p.family,
        kind: p.kind,
        ...(p.subtype ? { subtype: p.subtype } : {}),
        ...(p.room ? { room: p.room } : {}),
        ...(p.sourceMode ? { sourceMode: p.sourceMode } : {}),
        ...(p.customModel ? { customModel: true } : {}),
        shape: p.shape,
        layer: p.layer,
        widthM: p.widthM,
        depthM: p.depthM,
        count: 1,
        pieceIds: [p.id],
      });
      p.typeId = id;
    }
  }

  // 6. Architectural overhead / rotunda / ceiling zone rings & canopies
  const CEILING_LAYER_RE = /(ceil|rcp|soffit|bulkhead|canopy|plafond|cove)/i;
  const buildingW = within ? (within[2] - within[0]) * mPerPt : Infinity;
  const buildingD = within ? (within[3] - within[1]) * mPerPt : Infinity;
  const rawZones: {
    shape: 'round' | 'oval' | 'polygon';
    center: Vec2;
    widthM: number;
    depthM: number;
    radiusM?: number;
    outline: Vec2[];
    layer?: string;
    fromCeilingLayer: boolean;
  }[] = [];

  const pushCandidateLoop = (loop: Vec2[], layer: string | undefined, fromCeilingLayer: boolean) => {
    if (loop.length < 4) return;
    const areaM2 = polygonArea(loop) * mPerPt * mPerPt;
    if (areaM2 < 3.8 || areaM2 > 250) return;
    const hull = convexHull(loop);
    const box = minAreaRect(hull);
    const wM = box.w * mPerPt;
    const dM = box.d * mPerPt;
    if (wM < 2.2 || dM < 2.2 || wM > 18.0 || dM > 18.0) return;
    if (Number.isFinite(buildingW) && wM > buildingW * 0.75 && dM > buildingD * 0.75) return;
    const center = polygonCentroid(loop);
    if (within && (center.x < within[0] || center.x > within[2] || center.y < within[1] || center.y > within[3])) return;
    let perim = 0;
    for (let i = 0; i < loop.length; i++) perim += dist(loop[i], loop[(i + 1) % loop.length]);
    const perimM = perim * mPerPt;
    const circularity = (4 * Math.PI * areaM2) / Math.max(1e-6, perimM * perimM);
    const shape: 'round' | 'oval' | 'polygon' =
      circularity >= 0.78 && wM / Math.max(dM, 1e-6) <= 1.2
        ? 'round'
        : circularity >= 0.68
          ? 'oval'
          : 'polygon';
    rawZones.push({
      shape,
      center,
      widthM: r2(wM),
      depthM: r2(dM),
      ...(shape === 'round' ? { radiusM: r2((wM + dM) / 4) } : {}),
      outline: simplify([...loop, loop[0]], pt(0.08)).slice(0, -1),
      layer,
      fromCeilingLayer,
    });
  };

  for (const s of zoneStrokes) {
    const st = strokes[s];
    for (const loop of st.closed) pushCandidateLoop(loop, st.layer, CEILING_LAYER_RE.test(st.layer));
  }
  for (const c of circles) {
    const dM = 2 * c.r * mPerPt;
    if (dM < Math.max(2.2, cfg.zoneCircleM) || dM > 18.0) continue;
    if (arcCoverage(c.arcs) < (290 * Math.PI) / 180) continue;
    if (within && (c.c.x < within[0] || c.c.x > within[2] || c.c.y < within[1] || c.c.y > within[3])) continue;
    const outline = Array.from({ length: 36 }, (_, k) => ({
      x: c.c.x + c.r * Math.cos((k / 36) * 2 * Math.PI),
      y: c.c.y + c.r * Math.sin((k / 36) * 2 * Math.PI),
    }));
    const firstLayer = c.arcs.length ? strokes[c.arcs[0].s]?.layer : undefined;
    rawZones.push({
      shape: 'round',
      center: c.c,
      widthM: r2(dM),
      depthM: r2(dM),
      radiusM: r2(c.r * mPerPt),
      outline,
      layer: firstLayer,
      fromCeilingLayer: !!firstLayer && CEILING_LAYER_RE.test(firstLayer),
    });
  }
  for (const v of input.vectors) {
    if (v.sourceRootId || !v.layer || !CEILING_LAYER_RE.test(v.layer)) continue;
    const f = flatten(v);
    for (const loop of f.closed) pushCandidateLoop(loop, v.layer, true);
  }

  // Cluster concentric rings into unified rotunda / bulkhead zones
  const zoneClusters: typeof rawZones[] = [];
  const mergeDistPt = pt(0.8);
  for (const z of rawZones) {
    const hit = zoneClusters.find((cl) => dist(cl[0].center, z.center) <= mergeDistPt);
    if (hit) hit.push(z);
    else zoneClusters.push([z]);
  }
  const zones: ArchitecturalZone[] = [];
  for (const cl of zoneClusters) {
    cl.sort((a, b) => b.widthM * b.depthM - a.widthM * a.depthM);
    const outer = cl[0];
    const innerRadii = cl
      .slice(1)
      .map((z) => z.radiusM ?? r2((z.widthM + z.depthM) / 4))
      .filter((rad) => rad > 0.3 && rad < (outer.radiusM ?? outer.widthM / 2) - 0.15);
    const insideJoinery = out.filter(
      (p) =>
        (p.kind === 'joinery' || p.shape === 'curved') &&
        dist(p.center, outer.center) * mPerPt <= Math.max(outer.widthM, outer.depthM) * 0.65,
    );
    const roomCtx = inferRoomContext(outer.center, texts, mPerPt);
    const nearLabel = texts
      .filter((t) => dist({ x: t.x + t.w / 2, y: t.y + t.h / 2 }, outer.center) * mPerPt <= Math.max(outer.widthM, outer.depthM) * 0.6)
      .sort((a, b) => dist({ x: a.x, y: a.y }, outer.center) - dist({ x: b.x, y: b.y }, outer.center))[0]?.text;
    const kind: ArchitecturalZone['kind'] =
      (outer.shape === 'round' || outer.shape === 'oval') &&
      (roomCtx === 'retail' || insideJoinery.length >= 2 || outer.fromCeilingLayer || cl.length >= 2)
        ? 'rotunda-canopy'
        : outer.fromCeilingLayer
          ? 'ceiling-bulkhead'
          : 'feature-zone';
    zones.push({
      id: `az_${zones.length + 1}`,
      kind,
      shape: outer.shape,
      center: outer.center,
      widthM: outer.widthM,
      depthM: outer.depthM,
      ...(outer.radiusM ? { radiusM: outer.radiusM } : {}),
      ...(innerRadii.length ? { innerRadiiM: [...new Set(innerRadii)].sort((a, b) => a - b) } : {}),
      outline: outer.outline,
      ...(nearLabel ? { label: nearLabel } : {}),
      ...(roomCtx ? { roomContext: roomCtx } : {}),
      ...(outer.layer ? { layer: outer.layer } : {}),
    });
  }

  // Kiosk-ring fallback: if >= 3 curved kiosks/counters ring a hub with no canopy zone yet, synthesize one
  const kioskRingPieces = out.filter(
    (p) => (p.subtype === 'retail-kiosk' || p.subtype === 'reception-counter') && (p.shape === 'curved' || p.shape === 'free'),
  );
  if (kioskRingPieces.length >= 3) {
    const hub = {
      x: kioskRingPieces.reduce((s, p) => s + p.center.x, 0) / kioskRingPieces.length,
      y: kioskRingPieces.reduce((s, p) => s + p.center.y, 0) / kioskRingPieces.length,
    };
    const maxEdgeM = Math.max(
      ...kioskRingPieces.flatMap((p) => p.outline.map((pt0) => dist(pt0, hub) * mPerPt)),
    );
    const alreadyCovered = zones.some(
      (z) => z.kind === 'rotunda-canopy' && dist(z.center, hub) * mPerPt <= 2.5,
    );
    if (!alreadyCovered && maxEdgeM >= 1.8 && maxEdgeM <= 8.5) {
      const rM = r2(maxEdgeM + 0.35);
      const rPt = pt(rM);
      zones.push({
        id: `az_${zones.length + 1}`,
        kind: 'rotunda-canopy',
        shape: 'round',
        center: hub,
        widthM: r2(rM * 2),
        depthM: r2(rM * 2),
        radiusM: rM,
        outline: Array.from({ length: 36 }, (_, k) => ({
          x: hub.x + rPt * Math.cos((k / 36) * 2 * Math.PI),
          y: hub.y + rPt * Math.sin((k / 36) * 2 * Math.PI),
        })),
        label: kioskRingPieces.find((p) => p.label)?.label ?? 'Rotunda Canopy',
        roomContext: 'retail',
      });
    }
  }

  return {
    pieces: out,
    types,
    ...(zones.length ? { zones } : {}),
    layers: [...layers],
    diagnostics: { strokes: n, zones: Math.max(zoneStrokes.size, zones.length), tableTops: tableTops.length, splitSets, dropped, ms: Date.now() - t0 },
  };
}
