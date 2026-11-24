/**
 * Which way each piece of furniture faces, read from the drawing itself (no AI).
 * The front is the open side of a seat or sofa, the user's side of a desk or counter,
 * the foot of a bed and the open side of a cabinet, basin or WC. Cues, strongest first:
 *
 *  - table: a seat pulled up to a table or desk turns to it;
 *  - chair: a desk faces the chair drawn at it (a desk with chairs on both sides is a
 *    meeting table or a bench: no front);
 *  - shape: a piece drawn with its seat, cushions, bowl or bed covers to one side faces
 *    that way (the backrest, cistern or pillows are behind);
 *  - curve: curved and L-shaped sofas and counters face into their curve;
 *  - wall: pieces stand with their back to a wall, never facing one up close;
 *  - room: otherwise the side with the most open floor in front of it.
 *
 * Angles are page-space radians (MuPDF points, y down), from the piece's back to its front.
 */
import type { Vec2 } from './vector-device';

export type FacingCue = 'table' | 'chair' | 'shape' | 'curve' | 'wall' | 'room';

export interface FacingPiece {
  kind: string;
  shape: string;
  /** Traced footprint, page points. */
  outline: Vec2[];
  center: Vec2;
  /** Direction of the long side, radians. */
  angle: number;
  widthM: number;
  depthM: number;
  /** The piece's own strokes, flattened to polylines (page points). */
  lines: Vec2[][];
}

/** A straight wall: centreline in page points and its thickness in points (when known). */
export interface FacingWall {
  a: Vec2;
  b: Vec2;
  t?: number;
}

export interface Facing {
  /** Page-space radians, back to front. */
  angle: number;
  by: FacingCue;
}

/** Which sides can be a front: a long side, a short side (beds), or any side. */
const FRONTS: Record<string, 'normal' | 'length' | 'all'> = {
  seat: 'all',
  sofa: 'normal',
  desk: 'normal',
  bed: 'length',
  storage: 'normal',
  joinery: 'normal',
  screen: 'normal',
  sanitary: 'all',
  equipment: 'all',
};

const TABLE_KINDS = new Set(['table', 'desk']);

/** The one of a drawn direction and its perpendicular that is nearer `ref` (both modulo π). */
function nearestAxis(axis: number, ref: number): number {
  return Math.abs(wrap(2 * (axis - ref))) <= Math.PI / 2 ? axis : axis + Math.PI / 2;
}

const unit = (a: number): Vec2 => ({ x: Math.cos(a), y: Math.sin(a) });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: Vec2) => Math.hypot(a.x, a.y);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrap = (a: number) => {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
};

function segDist2(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  let t = l > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = a.x + t * dx - p.x, y = a.y + t * dy - p.y;
  return x * x + y * y;
}

function closestOnOutline(p: Vec2, poly: Vec2[]): Vec2 {
  let best = poly[0];
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = dx * dx + dy * dy;
    let t = l > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Gap between two outlines (0 when they touch or overlap), page points. */
function outlineGap(a: Vec2[], b: Vec2[]): number {
  if (pointInPolygon(a[0], b) || pointInPolygon(b[0], a)) return 0;
  let best = Infinity;
  for (const p of a) for (let i = 0; i < b.length; i++) best = Math.min(best, segDist2(p, b[i], b[(i + 1) % b.length]));
  for (const p of b) for (let i = 0; i < a.length; i++) best = Math.min(best, segDist2(p, a[i], a[(i + 1) % a.length]));
  return Math.sqrt(best);
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
  if (Math.abs(a) < 1e-9) return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
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

interface Cue {
  dir: Vec2;
  strength: number;
}

/**
 * The direction the piece is drawn square to: the commonest stroke direction (modulo
 * 90°, by length). A symbol's own straight edges are more reliable than the box around
 * its footprint, which a stray line (a wall face drawn with a WC) can turn.
 */
export function strokeAxis(lines: readonly Vec2[][]): number | null {
  const bins = new Float64Array(45); // 2° bins over 0–90°
  let total = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const dx = line[i].x - line[i - 1].x, dy = line[i].y - line[i - 1].y;
      const l = Math.hypot(dx, dy);
      if (l <= 0) continue;
      let a = Math.atan2(dy, dx) % (Math.PI / 2);
      if (a < 0) a += Math.PI / 2;
      bins[Math.min(44, Math.floor((a / (Math.PI / 2)) * 45))] += l;
      total += l;
    }
  }
  if (total <= 0) return null;
  let best = 0, bw = -1;
  for (let k = 0; k < 45; k++) {
    const w = bins[(k + 44) % 45] * 0.5 + bins[k] + bins[(k + 1) % 45] * 0.5;
    if (w > bw) { bw = w; best = k; }
  }
  if (bw / total < 0.35) return null;
  // refine inside the peak
  let sx = 0, sy = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const dx = line[i].x - line[i - 1].x, dy = line[i].y - line[i - 1].y;
      const l = Math.hypot(dx, dy);
      if (l <= 0) continue;
      let a = Math.atan2(dy, dx) % (Math.PI / 2);
      if (a < 0) a += Math.PI / 2;
      const k = Math.min(44, Math.floor((a / (Math.PI / 2)) * 45));
      if (Math.min(Math.abs(k - best), 45 - Math.abs(k - best)) > 1) continue;
      sx += Math.cos(a * 4) * l;
      sy += Math.sin(a * 4) * l;
    }
  }
  let a = Math.atan2(sy, sx) / 4;
  if (a < 0) a += Math.PI / 2;
  return a;
}

/**
 * Where the open faces of the drawing lie: the strokes are rasterised (1 cm), and the
 * large faces they enclose (a seat, the cushions, a basin or WC bowl, the bed covers)
 * are compared with the whole footprint. A backrest, arms, a cistern or pillows are
 * drawn as narrow bands or small faces, so the large faces sit towards the front.
 */
export function shapeCue(p: FacingPiece, mPerPt: number): Cue | null {
  const segs: [Vec2, Vec2][] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const line of p.lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      segs.push([a, b]);
      x0 = Math.min(x0, a.x, b.x); y0 = Math.min(y0, a.y, b.y);
      x1 = Math.max(x1, a.x, b.x); y1 = Math.max(y1, a.y, b.y);
    }
  }
  if (!segs.length) return null;
  const extent = Math.max(x1 - x0, y1 - y0);
  const res = Math.max(0.01 / mPerPt, extent / 500);
  const pad = 2;
  const W = Math.ceil((x1 - x0) / res) + 2 * pad + 1;
  const H = Math.ceil((y1 - y0) / res) + 2 * pad + 1;
  if (W * H > 600_000) return null;
  const grid = new Uint8Array(W * H); // 1 ink, 2 outside, then face ids from 3
  for (const [a, b] of segs) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (res * 0.5)));
    for (let k = 0; k <= n; k++) {
      const X = Math.floor((a.x + ((b.x - a.x) * k) / n - x0) / res) + pad;
      const Y = Math.floor((a.y + ((b.y - a.y) * k) / n - y0) / res) + pad;
      grid[Y * W + X] = 1;
    }
  }
  const q = new Int32Array(W * H);
  let qh = 0, qt = 0;
  const seed = (i: number, v: number) => { if (grid[i] === 0) { grid[i] = v; q[qt++] = i; } };
  for (let x = 0; x < W; x++) { seed(x, 2); seed((H - 1) * W + x, 2); }
  for (let y = 0; y < H; y++) { seed(y * W, 2); seed(y * W + W - 1, 2); }
  const flood = (v: number) => {
    while (qh < qt) {
      const i = q[qh++];
      const x = i % W;
      if (x > 0 && grid[i - 1] === 0) { grid[i - 1] = v; q[qt++] = i - 1; }
      if (x < W - 1 && grid[i + 1] === 0) { grid[i + 1] = v; q[qt++] = i + 1; }
      if (i >= W && grid[i - W] === 0) { grid[i - W] = v; q[qt++] = i - W; }
      if (i < W * (H - 1) && grid[i + W] === 0) { grid[i + W] = v; q[qt++] = i + W; }
    }
  };
  flood(2);
  // Footprint: everything not outside. Faces: empty regions inside.
  let fx = 0, fy = 0, fn = 0;
  const faces: { n: number; sx: number; sy: number }[] = [];
  for (let i = 0; i < W * H; i++) {
    if (grid[i] === 2) continue;
    fx += i % W; fy += (i / W) | 0; fn++;
    if (grid[i] !== 0) continue;
    qh = 0; qt = 0;
    const id = 3 + (faces.length % 250);
    grid[i] = id; q[qt++] = i;
    flood(id);
    let sx = 0, sy = 0;
    for (let k = 0; k < qt; k++) { sx += q[k] % W; sy += (q[k] / W) | 0; }
    faces.push({ n: qt, sx, sy });
  }
  if (!fn || !faces.length) return null;
  const cellM2 = (res * mPerPt) ** 2;
  const minCells = 0.01 / cellM2;
  const big = faces.filter((f) => f.n >= minCells);
  if (!big.length) return null;
  // The largest face is the seat, the bowl or the bed covers; faces drawn alike with it
  // (the cushions of a sofa, both halves of a duvet) count with it.
  const largest = Math.max(...big.map((f) => f.n));
  // One face filling almost all of the footprint is a plain outline: nothing to read.
  if (largest >= fn * 0.85) return null;
  const seat = big.filter((f) => f.n >= largest * 0.92);
  const sn = seat.reduce((s, f) => s + f.n, 0);
  const cx = seat.reduce((s, f) => s + f.sx, 0) / sn;
  const cy = seat.reduce((s, f) => s + f.sy, 0) / sn;
  const off = { x: (cx - fx / fn) * res, y: (cy - fy / fn) * res };
  const offM = len(off) * mPerPt;
  const ref = Math.max(0.1, Math.min(p.widthM, p.depthM));
  const strength = clamp01((offM / ref - 0.03) / 0.08);
  if (strength <= 0) return null;
  return { dir: { x: off.x / len(off), y: off.y / len(off) }, strength };
}

/** Curved and L-shaped pieces face into their curve: towards what their outline leaves out of its hull. */
export function curveCue(p: FacingPiece): Cue | null {
  if (p.outline.length < 4) return null;
  const hull = convexHull(p.outline);
  const ha = polygonArea(hull), fa = polygonArea(p.outline);
  if (ha <= 0 || fa / ha > 0.92) return null;
  const hc = polygonCentroid(hull), fc = polygonCentroid(p.outline);
  const dc = { x: (ha * hc.x - fa * fc.x) / (ha - fa), y: (ha * hc.y - fa * fc.y) / (ha - fa) };
  const d = sub(dc, fc);
  const l = len(d);
  if (l < 1e-6) return null;
  return { dir: { x: d.x / l, y: d.y / l }, strength: clamp01((1 - fa / ha - 0.08) / 0.25) };
}

interface WallFace {
  a: Vec2;
  b: Vec2;
  dir: Vec2;
  half: number;
}

/**
 * How firmly a wall stands behind the piece (back), and how close one stands in front of
 * it. Walls broken into pieces (at openings, or a curved wall as chords) add up along
 * the piece's side.
 */
function wallFit(p: FacingPiece, f: Vec2, walls: WallFace[], mPerPt: number): { back: number; front: number } {
  const pt = (m: number) => m / mPerPt;
  const g = { x: -f.y, y: f.x };
  let eF = -Infinity, eB = Infinity, g0 = Infinity, g1 = -Infinity;
  for (const q of p.outline) {
    const s = dot(sub(q, p.center), f), t = dot(sub(q, p.center), g);
    if (s > eF) eF = s;
    if (s < eB) eB = s;
    if (t < g0) g0 = t;
    if (t > g1) g1 = t;
  }
  const need = Math.min((g1 - g0) * 0.5, pt(0.6));
  let backRun = 0, backGap = Infinity, frontRun = 0, frontGap = Infinity;
  for (const w of walls) {
    if (Math.abs(dot(w.dir, f)) > 0.34) continue; // the wall must run across the facing direction (within 20°)
    const ga = dot(sub(w.a, p.center), g), gb = dot(sub(w.b, p.center), g);
    const overlap = Math.min(g1, Math.max(ga, gb)) - Math.max(g0, Math.min(ga, gb));
    if (overlap <= 0) continue;
    const sw = (dot(sub(w.a, p.center), f) + dot(sub(w.b, p.center), f)) / 2;
    // Wall thicknesses are read from the drawing and can run wide: a piece may overlap the face a little.
    if (sw + w.half < 0) {
      const gap = eB - (sw + w.half);
      if (gap >= -pt(0.2) && gap <= pt(0.35)) { backRun += overlap; backGap = Math.min(backGap, Math.max(0, gap)); }
    } else if (sw - w.half > 0) {
      const gap = sw - w.half - eF;
      if (gap >= -pt(0.2) && gap <= pt(0.3)) { frontRun += overlap; frontGap = Math.min(frontGap, Math.max(0, gap)); }
    }
  }
  return {
    back: backRun >= need ? 1 - (0.6 * backGap) / pt(0.35) : 0,
    front: frontRun >= need ? 1 - (0.6 * frontGap) / pt(0.3) : 0,
  };
}

/**
 * Curved walls as straight chords (at most 10° each) for the wall cue: an arc by its
 * centre, centreline radius and angles, or a free-form wall by its centreline.
 */
export function arcWalls(segments: readonly { center: Vec2; radiusPt: number; thicknessPt: number; a0: number; a1: number; centreline?: Vec2[] }[]): FacingWall[] {
  const out: FacingWall[] = [];
  for (const s of segments) {
    let pts = s.centreline;
    if (!pts || pts.length < 2) {
      const n = Math.max(1, Math.ceil((s.a1 - s.a0) / ((10 * Math.PI) / 180)));
      pts = Array.from({ length: n + 1 }, (_, k) => {
        const a = s.a0 + ((s.a1 - s.a0) * k) / n;
        return { x: s.center.x + s.radiusPt * Math.cos(a), y: s.center.y + s.radiusPt * Math.sin(a) };
      });
    }
    for (let i = 1; i < pts.length; i++) out.push({ a: pts[i - 1], b: pts[i], t: s.thicknessPt });
  }
  return out;
}

/** Open floor in front of the piece (0–1 over 3 m): walls and other pieces stop it. */
function openFloor(p: FacingPiece, f: Vec2, walls: WallFace[], others: FacingPiece[], mPerPt: number): number {
  const pt = (m: number) => m / mPerPt;
  const L = pt(3);
  const g = { x: -f.y, y: f.x };
  let eF = -Infinity, g0 = Infinity, g1 = -Infinity;
  for (const q of p.outline) {
    const s = dot(sub(q, p.center), f), t = dot(sub(q, p.center), g);
    if (s > eF) eF = s;
    if (t < g0) g0 = t;
    if (t > g1) g1 = t;
  }
  let total = 0;
  const offsets = [g0 + (g1 - g0) * 0.2, (g0 + g1) / 2, g0 + (g1 - g0) * 0.8];
  for (const o of offsets) {
    const s0 = { x: p.center.x + f.x * (eF + pt(0.02)) + g.x * o, y: p.center.y + f.y * (eF + pt(0.02)) + g.y * o };
    let hit = L;
    const cast = (a: Vec2, b: Vec2) => {
      // ray s0 + f·t against segment a–b
      const e = sub(b, a);
      const den = f.x * e.y - f.y * e.x;
      if (Math.abs(den) < 1e-9) return;
      const w = sub(a, s0);
      const t = (w.x * e.y - w.y * e.x) / den;
      const u = (w.x * f.y - w.y * f.x) / den;
      if (t > 0 && t < hit && u >= 0 && u <= 1) hit = t;
    };
    for (const w of walls) {
      const n = { x: -w.dir.y * w.half, y: w.dir.x * w.half };
      cast({ x: w.a.x + n.x, y: w.a.y + n.y }, { x: w.b.x + n.x, y: w.b.y + n.y });
      cast({ x: w.a.x - n.x, y: w.a.y - n.y }, { x: w.b.x - n.x, y: w.b.y - n.y });
    }
    for (const q of others) {
      if (Math.abs(q.center.x - s0.x) > L + pt(4) || Math.abs(q.center.y - s0.y) > L + pt(4)) continue;
      for (let i = 0; i < q.outline.length; i++) cast(q.outline[i], q.outline[(i + 1) % q.outline.length]);
    }
    total += hit / L;
  }
  return total / offsets.length;
}

/** The front of every piece that has one; null where it has none or the drawing does not tell. */
export function pieceFacings(pieces: readonly FacingPiece[], walls: readonly FacingWall[], mPerPt: number): (Facing | null)[] {
  const pt = (m: number) => m / mPerPt;
  const faces: WallFace[] = [];
  for (const w of walls) {
    const d = sub(w.b, w.a);
    const l = len(d);
    if (l < pt(0.05)) continue;
    faces.push({ a: w.a, b: w.b, dir: { x: d.x / l, y: d.y / l }, half: (w.t && w.t > 0 ? w.t : pt(0.1)) / 2 });
  }
  const near = (p: FacingPiece, q: FacingPiece, m: number) =>
    Math.abs(p.center.x - q.center.x) <= pt(m) + pt(Math.max(p.widthM, q.widthM)) && Math.abs(p.center.y - q.center.y) <= pt(m) + pt(Math.max(p.widthM, q.widthM));

  return pieces.map((p) => {
    const fronts = FRONTS[p.kind];
    if (!fronts || p.outline.length < 3) return null;
    const cues: { cue: FacingCue; c: Cue; w: number; sharp?: boolean }[] = [];
    // The sides the piece is drawn square to; `long` is the one along its long side.
    const axis = strokeAxis(p.lines);
    const long = axis !== null ? nearestAxis(axis, p.angle) : p.angle;

    // A desk's chairs, and a seat's table.
    if (p.kind === 'desk') {
      const v = unit(long + Math.PI / 2);
      let plus = 0, minus = 0;
      for (const q of pieces) {
        if (q === p || q.kind !== 'seat' || !near(p, q, 1)) continue;
        const gap = outlineGap(p.outline, q.outline) * mPerPt;
        if (gap > 0.5) continue;
        const s = dot(sub(q.center, p.center), v);
        if (s > 0) plus++;
        else minus++;
      }
      if (plus && minus) return null; // chairs on both sides: a meeting table or a bench, no front
      if (plus || minus) cues.push({ cue: 'chair', c: { dir: plus ? v : { x: -v.x, y: -v.y }, strength: 1 }, w: 3 });
    }
    if (p.kind === 'seat' || p.kind === 'sofa') {
      const reach = p.kind === 'seat' ? 0.8 : 1.1;
      let nearest: { gap: number; to: Vec2 } | null = null;
      for (const q of pieces) {
        if (q === p || !TABLE_KINDS.has(q.kind) || !near(p, q, reach + 0.5)) continue;
        const gap = outlineGap(p.outline, q.outline) * mPerPt;
        if (gap > reach || (nearest && gap >= nearest.gap)) continue;
        const target = q.shape === 'round' ? q.center : closestOnOutline(p.center, q.outline);
        nearest = { gap, to: sub(target, p.center) };
      }
      if (nearest && len(nearest.to) > 1e-6) {
        const dir = { x: nearest.to.x / len(nearest.to), y: nearest.to.y / len(nearest.to) };
        // A sofa faces a coffee table in front of it, never one at its end.
        const along = Math.abs(dot(dir, unit(long)));
        if (p.kind === 'seat' || along < 0.6) cues.push({ cue: 'table', c: { dir, strength: 1 - 0.5 * clamp01((nearest.gap - 0.15) / reach) }, w: p.kind === 'seat' ? 3 : 1.5, sharp: true });
      }
    }
    const shape = shapeCue(p, mPerPt);
    if (shape) cues.push({ cue: 'shape', c: shape, w: p.kind === 'desk' ? 1 : 2 });
    if (p.kind === 'sofa' || p.kind === 'desk') {
      const curve = curveCue(p);
      if (curve) cues.push({ cue: 'curve', c: curve, w: p.kind === 'desk' ? 1.5 : 2 });
    }

    // Candidate fronts: the sides the piece is drawn square to, plus the exact way a cue points.
    const ratio = p.widthM / Math.max(p.depthM, 1e-6);
    const base: number[] = [];
    if (p.shape === 'round') for (let k = 0; k < 8; k++) base.push(long + (k * Math.PI) / 4);
    else if (fronts === 'length') base.push(long, long + Math.PI);
    else if (fronts === 'normal' && ratio >= 1.15) base.push(long + Math.PI / 2, long - Math.PI / 2);
    else for (let k = 0; k < 4; k++) base.push(long + (k * Math.PI) / 2);
    const candidates = [...base];
    for (const c of cues) if (c.sharp || p.shape === 'round') candidates.push(Math.atan2(c.c.dir.y, c.c.dir.x));

    const wallW = p.kind === 'seat' ? 1 : p.kind === 'sofa' || p.kind === 'desk' || p.kind === 'bed' ? 1.5 : 2.5;
    const roomW = p.kind === 'desk' ? 0 : 0.5;
    const others = roomW > 0 ? pieces.filter((q) => q !== p && near(p, q, 3)) : [];
    let best: { a: number; score: number; by: FacingCue; parts: Record<string, number> } | null = null;
    const scored: { a: number; score: number }[] = [];
    for (const a of candidates) {
      const f = unit(a);
      const parts: Record<string, number> = {};
      let score = 0;
      for (const c of cues) {
        const cos = dot(f, c.c.dir);
        if (cos <= 0) continue;
        const v = c.w * c.c.strength * (c.sharp ? cos ** 4 : cos * cos);
        parts[c.cue] = (parts[c.cue] ?? 0) + v;
        score += v;
      }
      const wf = wallFit(p, f, faces, mPerPt);
      if (wf.back) { parts.wall = wallW * wf.back; score += parts.wall; }
      if (wf.front) score -= 1.5 * wf.front;
      if (roomW) {
        const open = openFloor(p, f, faces, others, mPerPt);
        parts.room = roomW * open;
        score += parts.room;
      }
      scored.push({ a, score });
      if (!best || score > best.score + 1e-9) {
        const by = (Object.entries(parts).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'room') as FacingCue;
        best = { a, score, by, parts };
      }
    }
    if (!best || best.score < 0.35) return null;
    // The opposite side must clearly lose: otherwise the drawing does not tell.
    const opposite = scored.filter((s) => Math.abs(wrap(s.a - best!.a - Math.PI)) < Math.PI / 4).reduce((m, s) => Math.max(m, s.score), -Infinity);
    if (Number.isFinite(opposite) && best.score - opposite < 0.2) return null;
    // A desk needs a real cue (a chair, a wall, its own shape): open floor alone is no front.
    if (p.kind === 'desk' && !cues.length && !best.parts.wall) return null;
    // A seat that ends up facing the table it is pulled up to is turned to that table,
    // whatever told it most (so renders can say "each turned to face its table").
    let by = best.by;
    const table = cues.find((c) => c.cue === 'table');
    if (table && dot(unit(best.a), table.c.dir) > Math.cos((35 * Math.PI) / 180)) by = 'table';
    // Snap to the piece's own sides when within 20°.
    let angle = best.a;
    for (let k = 0; k < 4; k++) {
      const side = long + (k * Math.PI) / 2;
      if (Math.abs(wrap(angle - side)) < (20 * Math.PI) / 180) { angle = side; break; }
    }
    return { angle: wrap(angle), by };
  });
}
