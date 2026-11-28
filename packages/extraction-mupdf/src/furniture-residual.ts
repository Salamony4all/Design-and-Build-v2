/**
 * The linework left for furniture once everything else a drawing shows is set aside
 * (step 1 of reading furniture from drawings that keep no furniture layers).
 *
 * A drawing without CAD layers still draws its furniture, as symbols among walls,
 * doors, dimensions, text and hatching. Here the strokes the rest of the pipeline
 * already explains are removed, at the level of single subpaths:
 *
 *  - vectors another stage claimed (walls, doors, windows, columns) and vectors on
 *    CAD layers that hold something else (when the drawing has such layers);
 *  - wall faces, wall hatching and window lines: strokes lying inside wall bands;
 *  - long straight lines (dimensions, grids, room and finish outlines);
 *  - arcs swung about a door hinge;
 *  - text drawn with lines (CAD fonts exported as paths);
 *  - dashed lines (hidden and overhead edges), kept aside for overhead sub-parts.
 *
 * What remains is returned one stroke per subpath, with the stroke's pen (colour and
 * weight) as its layer, so that pieces form from touching strokes of one pen exactly
 * as they do from touching strokes of one furniture layer (furniture-blocks.ts).
 * The scene also keeps what the measures in furniture-symbol-reader.ts need: what
 * each pen draws elsewhere, the long lines, the text boxes and the wall faces.
 *
 * Nothing here is tuned to a drawing: every length is in metres through the drawing's
 * own scale, or in millimetres on paper for text.
 *
 * Coordinates are MuPDF page points (y down).
 */
import type { Bounds, MuVector, Vec2 } from './vector-device';
import type { FacingWall } from './furniture-facing';

export interface ResidualText { text: string; x: number; y: number; w: number; h: number }

export interface ResidualInput {
  vectors: MuVector[];
  scaleMmPerPt: number;
  /** The building's extent; strokes outside it are ignored. */
  within?: Bounds | null;
  texts?: ResidualText[];
  /** Straight walls (centre line, thickness in points), curved walls as chords, pod doors. */
  walls?: FacingWall[];
  /** Root ids of vectors other stages already explain (walls, doors, windows, columns). */
  claimedVectorIds?: ReadonlySet<string>;
  /** Doors, where known: arcs swung about a hinge at about a leaf's length are set aside. */
  doors?: { hinge?: Vec2; leafPt?: number }[];
  /** True for CAD layers that hold something else (walls, doors, text, dimensions…). */
  skipLayer?: (layer: string) => boolean;
}

export interface ResidualConfig {
  /** A straight line longer than this is not part of a furniture symbol (metres). */
  longLineM: number;
  /** Extra width either side of a wall band (metres). */
  wallTolM: number;
  /** Share of a stroke inside wall bands for it to count as wall linework. */
  wallShare: number;
  /** Largest piece (metres); longer strokes are not furniture. */
  maxPieceM: number;
}

export const RESIDUAL_DEFAULTS: ResidualConfig = { longLineM: 4.5, wallTolM: 0.03, wallShare: 0.9, maxPieceM: 8 };

/** A residual stroke: one subpath of a page vector, with its pen as its layer. */
export interface ResidualVector extends MuVector {
  /** Id of the page vector it is a subpath of. */
  sourceVectorId: string;
  /** The CAD layer of that vector, when the drawing has layers. */
  sourceLayer?: string;
}

export interface ResidualScene {
  /** Strokes left for furniture symbols. */
  strokes: ResidualVector[];
  /** Dashed strokes that passed the same filters (overhead cabinets, canopies). */
  dashed: ResidualVector[];
  /** Straight lines set aside as too long for furniture (grids, dimensions, outlines), page points. */
  longLines: { a: Vec2; b: Vec2 }[];
  /** Per pen: all its ink inside the building and the part that is structure (points). */
  pens: Map<string, { ink: number; wallInk: number }>;
  /** Median stroke weight of the residual linework (points). */
  medianLinePt: number;
  scaleMmPerPt: number;
  /** Text from the PDF's text layer. */
  texts: ResidualText[];
  /** Boxes of text drawn with lines (set aside from the strokes). */
  drawnTexts: ResidualText[];
  /** Both faces of every wall, page points. */
  wallFaces: { a: Vec2; b: Vec2 }[];
  /** Gap from a point to the nearest wall face, metres (0 inside a wall, 3 at most). */
  wallGapM: (p: Vec2) => number;
  /** True inside a wall's body (between its faces). */
  inWall: (p: Vec2) => boolean;
  /** What was set aside, by reason (strokes). */
  setAside: { claimed: number; layer: number; long: number; wall: number; swing: number; text: number; dashed: number };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function bez(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Pen of a stroke: grey or colour, and weight on paper. */
export function penKey(v: Pick<MuVector, 'color' | 'strokeWidth' | 'strokeWidthPt'>): string {
  const c = (v.color ?? [0, 0, 0]).map((x) => Math.round(x * 20) / 20);
  const w = Math.round((v.strokeWidthPt ?? v.strokeWidth ?? 0) * 20) / 20;
  return `pen ${c.join(',')} ${w}`;
}

/** Both faces of every wall (centre line offset by half its thickness), page points. */
export function wallFaceLines(walls: readonly FacingWall[]): { a: Vec2; b: Vec2 }[] {
  const out: { a: Vec2; b: Vec2 }[] = [];
  for (const w of walls) {
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, l = Math.hypot(dx, dy);
    if (l <= 0) continue;
    const h = (w.t ?? 0) / 2, nx = (-dy / l) * h, ny = (dx / l) * h;
    out.push({ a: { x: w.a.x + nx, y: w.a.y + ny }, b: { x: w.b.x + nx, y: w.b.y + ny } });
    if (h > 0) out.push({ a: { x: w.a.x - nx, y: w.a.y - ny }, b: { x: w.b.x - nx, y: w.b.y - ny } });
  }
  return out;
}

// ── wall bands ────────────────────────────────────────────────────────────────

const GRID_OFFSET = 4096, GRID_SPAN = 8192;
const cellKey = (gx: number, gy: number) => (gx + GRID_OFFSET) * GRID_SPAN + (gy + GRID_OFFSET);

interface WallBand { ax: number; ay: number; dx: number; dy: number; l2: number; len: number; half: number; x0: number; y0: number; x1: number; y1: number }

/** Walls as bands `extra` wider than drawn, on a grid of `cell` points. */
function wallBands(walls: readonly FacingWall[], extra: number, cell: number) {
  const bands: WallBand[] = [];
  const grid = new Map<number, number[]>();
  for (const w of walls) {
    const half = (w.t ?? 0) / 2 + extra;
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
    const band: WallBand = {
      ax: w.a.x, ay: w.a.y, dx, dy, l2: dx * dx + dy * dy, len: Math.hypot(dx, dy), half,
      x0: Math.min(w.a.x, w.b.x) - half, y0: Math.min(w.a.y, w.b.y) - half, x1: Math.max(w.a.x, w.b.x) + half, y1: Math.max(w.a.y, w.b.y) + half,
    };
    const i = bands.length;
    bands.push(band);
    const gx0 = Math.floor(band.x0 / cell), gx1 = Math.floor(band.x1 / cell), gy0 = Math.floor(band.y0 / cell), gy1 = Math.floor(band.y1 / cell);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const k = cellKey(gx, gy);
        const arr = grid.get(k);
        if (arr) arr.push(i); else grid.set(k, [i]);
      }
    }
  }
  /** Distance from p to the band's centre line, less its half width (negative inside). */
  const gap = (w: WallBand, px: number, py: number, pastEnds: boolean) => {
    let t = w.l2 > 0 ? ((px - w.ax) * w.dx + (py - w.ay) * w.dy) / w.l2 : 0;
    if (pastEnds) {
      // a little past either end too (wall ends, corners)
      const over = w.len > 0 ? w.half / w.len : 0;
      if (t < -over || t > 1 + over) return Infinity;
    }
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(w.ax + t * w.dx - px, w.ay + t * w.dy - py) - w.half;
  };
  const inBand = (p: Vec2) => {
    const arr = grid.get(cellKey(Math.floor(p.x / cell), Math.floor(p.y / cell)));
    if (!arr) return false;
    for (const i of arr) if (gap(bands[i], p.x, p.y, true) <= 0) return true;
    return false;
  };
  /** True when the box comes near any band (cheap test before sampling a stroke). */
  const near = (bb: Bounds) => {
    const gx0 = Math.floor(bb[0] / cell), gx1 = Math.floor(bb[2] / cell), gy0 = Math.floor(bb[1] / cell), gy1 = Math.floor(bb[3] / cell);
    if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > 64) return true;
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        for (const i of grid.get(cellKey(gx, gy)) ?? []) {
          const w = bands[i];
          if (w.x1 >= bb[0] && w.x0 <= bb[2] && w.y1 >= bb[1] && w.y0 <= bb[3]) return true;
        }
      }
    }
    return false;
  };
  /** Gap to the nearest band, points, `maxPt` at most (0 inside one). */
  const nearest = (p: Vec2, maxPt: number) => {
    let best = maxPt;
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    const rings = Math.ceil(maxPt / cell);
    const seen = new Set<number>();
    for (let ring = 0; ring <= rings; ring++) {
      for (let gx = cx - ring; gx <= cx + ring; gx++) {
        const edgeX = gx === cx - ring || gx === cx + ring;
        for (let gy = cy - ring; gy <= cy + ring; gy += edgeX ? 1 : 2 * ring || 1) {
          for (const i of grid.get(cellKey(gx, gy)) ?? []) {
            if (seen.has(i)) continue;
            seen.add(i);
            const d = gap(bands[i], p.x, p.y, false);
            if (d < best) best = d < 0 ? 0 : d;
          }
        }
      }
      // nothing in a farther ring can be nearer than the rings already searched
      if (best <= ring * cell) break;
    }
    return best;
  };
  return { inBand, near, nearest };
}

// ── text drawn with lines ─────────────────────────────────────────────────────

const MM_PER_PT = 25.4 / 72;

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  let t = l > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

/**
 * Text drawn with lines (CAD fonts exported as paths). A letter is a small cluster of
 * touching strokes standing on its own, a few millimetres high on paper; a word is a
 * row of such letters of one height and different shapes. Strokes of furniture touch
 * the rest of their piece, and rows of identical small shapes (chairs at a small
 * scale) are not words. Returns the ids of the strokes that are text, and a box per word.
 */
export function drawnText(strokes: readonly MuVector[]): { ids: Set<string>; boxes: ResidualText[] } {
  const ids = new Set<string>();
  const boxes: ResidualText[] = [];
  const glyphMax = 6 / MM_PER_PT; // 6 mm on paper
  const small: number[] = [];
  const big: number[] = [];
  strokes.forEach((v, i) => {
    const b = v.bounds;
    (Math.max(b[2] - b[0], b[3] - b[1]) <= glyphMax ? small : big).push(i);
  });
  if (small.length < 3) return { ids, boxes };
  const tol = 0.1 / MM_PER_PT; // strokes touch within a tenth of a millimetre on paper
  const cell = glyphMax;
  const key = (gx: number, gy: number) => (gx + 32768) * 65536 + (gy + 32768);
  // a small stroke that touches a larger one is part of that piece, not a letter
  const bigSegs = new Map<number, number[]>(); // cell → flat [ax, ay, bx, by]
  for (const i of big) {
    const pts = strokes[i].points;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      const gx0 = Math.floor((Math.min(a.x, b.x) - tol) / cell), gx1 = Math.floor((Math.max(a.x, b.x) + tol) / cell);
      const gy0 = Math.floor((Math.min(a.y, b.y) - tol) / cell), gy1 = Math.floor((Math.max(a.y, b.y) + tol) / cell);
      if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > 256) continue;
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const kk = key(gx, gy);
          const arr = bigSegs.get(kk);
          if (arr) arr.push(a.x, a.y, b.x, b.y); else bigSegs.set(kk, [a.x, a.y, b.x, b.y]);
        }
      }
    }
  }
  const touchesBig = (v: MuVector) => {
    for (const p of v.points) {
      const arr = bigSegs.get(key(Math.floor(p.x / cell), Math.floor(p.y / cell)));
      if (!arr) continue;
      for (let k = 0; k < arr.length; k += 4) {
        if (segDist(p, { x: arr[k], y: arr[k + 1] }, { x: arr[k + 2], y: arr[k + 3] }) <= tol) return true;
      }
    }
    return false;
  };
  const free = small.filter((i) => !touchesBig(strokes[i]));
  if (free.length < 3) return { ids, boxes };
  // letters: free small strokes that touch each other
  const index = new Map<number, number[]>();
  free.forEach((i, k) => {
    const b = strokes[i].bounds;
    for (let gx = Math.floor((b[0] - tol) / cell); gx <= Math.floor((b[2] + tol) / cell); gx++) {
      for (let gy = Math.floor((b[1] - tol) / cell); gy <= Math.floor((b[3] + tol) / cell); gy++) {
        const kk = key(gx, gy);
        const arr = index.get(kk);
        if (arr) arr.push(k); else index.set(kk, [k]);
      }
    }
  });
  const parent = free.map((_, k) => k);
  const find = (k: number): number => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  const touch = (a: MuVector, b: MuVector) => {
    if (a.bounds[0] > b.bounds[2] + tol || b.bounds[0] > a.bounds[2] + tol || a.bounds[1] > b.bounds[3] + tol || b.bounds[1] > a.bounds[3] + tol) return false;
    const pa = a.points, pb = b.points;
    for (let i = 1; i < pa.length; i++) {
      for (let j = 1; j < pb.length; j++) {
        if (Math.min(segDist(pa[i - 1], pb[j - 1], pb[j]), segDist(pa[i], pb[j - 1], pb[j]), segDist(pb[j - 1], pa[i - 1], pa[i]), segDist(pb[j], pa[i - 1], pa[i])) <= tol) return true;
      }
    }
    return false;
  };
  for (const members of index.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i], b = members[j];
        if (find(a) !== find(b) && touch(strokes[free[a]], strokes[free[b]])) parent[find(a)] = find(b);
      }
    }
  }
  const clusters = new Map<number, number[]>();
  free.forEach((_, k) => { const r = find(k); const arr = clusters.get(r); if (arr) arr.push(k); else clusters.set(r, [k]); });
  interface Letter { members: number[]; x0: number; y0: number; x1: number; y1: number; sig: string }
  const letters: Letter[] = [];
  for (const members of clusters.values()) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    for (const k of members) { const v = strokes[free[k]]; const b = v.bounds; x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); n += v.commands.length; }
    if (Math.max(x1 - x0, y1 - y0) > glyphMax) continue;
    letters.push({ members, x0, y0, x1, y1, sig: `${Math.round((x1 - x0) * MM_PER_PT * 4)}|${Math.round((y1 - y0) * MM_PER_PT * 4)}|${n}` });
  }
  const used = new Set<Letter>();
  for (const vertical of [false, true]) {
    const g = letters.filter((l) => !used.has(l)).map((l) => (vertical ? { l, x0: l.y0, x1: l.y1, y0: l.x0, y1: l.x1 } : { l, x0: l.x0, x1: l.x1, y0: l.y0, y1: l.y1 }));
    g.sort((a, b) => a.x0 - b.x0);
    const par = g.map((_, k) => k);
    const f2 = (k: number): number => { while (par[k] !== k) { par[k] = par[par[k]]; k = par[k]; } return k; };
    for (let a = 0; a < g.length; a++) {
      const A = g[a];
      const ha = Math.max(A.y1 - A.y0, 1e-6);
      for (let b = a + 1; b < g.length; b++) {
        const B = g[b];
        const hb = Math.max(B.y1 - B.y0, 1e-6);
        const h = Math.max(ha, hb);
        if (B.x0 - A.x1 > h * 0.9) { if (B.x0 - A.x0 > h * 10) break; continue; }
        // on one line: their heights overlap
        if (Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) < Math.min(ha, hb) * 0.6) continue;
        par[f2(a)] = f2(b);
      }
    }
    const rows = new Map<number, number[]>();
    g.forEach((_, k) => { const r = f2(k); const arr = rows.get(r); if (arr) arr.push(k); else rows.set(r, [k]); });
    for (const members of rows.values()) {
      if (members.length < 3) continue;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const k of members) { x0 = Math.min(x0, g[k].x0); x1 = Math.max(x1, g[k].x1); y0 = Math.min(y0, g[k].y0); y1 = Math.max(y1, g[k].y1); }
      const h = (y1 - y0) * MM_PER_PT, w = (x1 - x0) * MM_PER_PT;
      if (h < 0.8 || h > 7 || w < h * 1.5) continue;
      // letters share one height (capitals), and differ in shape
      const hs = members.map((k) => g[k].y1 - g[k].y0).sort((a, b) => a - b);
      const top = hs[hs.length - 1];
      if (hs.filter((x) => x >= top * 0.85).length < members.length * 0.5) continue;
      const sig = new Set(members.map((k) => g[k].l.sig));
      if (sig.size < 3 || sig.size < members.length * 0.35) continue;
      for (const k of members) { used.add(g[k].l); for (const m of g[k].l.members) ids.add(strokes[free[m]].id); }
      boxes.push(vertical ? { text: '', x: y0, y: x0, w: y1 - y0, h: x1 - x0 } : { text: '', x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }
  return { ids, boxes };
}

// ── the scene ─────────────────────────────────────────────────────────────────

export function residualScene(input: ResidualInput, cfg: ResidualConfig = RESIDUAL_DEFAULTS): ResidualScene {
  const mPerPt = input.scaleMmPerPt / 1000;
  const pt = (m: number) => m / mPerPt;
  const within = input.within ?? null;
  const longLine = pt(cfg.longLineM), maxPiece = pt(cfg.maxPieceM);
  const walls = input.walls ?? [];
  const band = wallBands(walls, pt(cfg.wallTolM), pt(1)); // wall linework: a little wider than the wall
  const body = wallBands(walls, 0, pt(1)); // the wall itself: gaps and overlaps
  const claimed = input.claimedVectorIds;
  const hinges = (input.doors ?? []).filter((d) => d.hinge && d.leafPt).map((d) => ({ c: d.hinge as Vec2, r: d.leafPt as number }));
  const step = pt(0.25);
  const strokes: ResidualVector[] = [];
  const dashedOut: ResidualVector[] = [];
  const longLines: { a: Vec2; b: Vec2 }[] = [];
  const pens = new Map<string, { ink: number; wallInk: number }>();
  const weights: number[] = [];
  const setAside = { claimed: 0, layer: 0, long: 0, wall: 0, swing: 0, text: 0, dashed: 0 };

  for (const v of input.vectors) {
    if (v.sourceRootId || v.operation !== 'stroke-path') continue;
    const b = v.bounds;
    if (within && (b[2] < within[0] || b[0] > within[2] || b[3] < within[1] || b[1] > within[3])) continue;
    const pen = penKey(v);
    let ps = pens.get(pen);
    if (!ps) pens.set(pen, (ps = { ink: 0, wallInk: 0 }));
    const isClaimed = !!claimed && claimed.has(v.id);
    const otherLayer = !isClaimed && !!v.layer && !!input.skipLayer && input.skipLayer(v.layer);
    const dashed = !!(v.dashes && v.dashes.length >= 1 && v.dashes.some((d) => d > 0));
    const sample = !isClaimed && !otherLayer; // only strokes that may be kept are tested against the walls

    // subpaths
    const cmds = v.commands as Array<Record<string, any>>;
    let from = 0, sub = 0;
    for (let i = 1; i <= cmds.length; i++) {
      if (i < cmds.length && cmds[i].op !== 'M') continue;
      const part = cmds.slice(from, i);
      from = i;
      const k = sub++;
      const pts: Vec2[] = [];
      const samples: Vec2[] = [];
      let last: Vec2 | null = null, first: Vec2 | null = null;
      let long = false, curved = false, ink = 0;
      const straight = (a: Vec2, p: Vec2) => {
        const l = dist(a, p);
        ink += l;
        if (l > longLine) { long = true; longLines.push({ a, b: p }); }
        if (!sample) return;
        const n = Math.max(1, Math.min(16, Math.ceil(l / step)));
        for (let s = 1; s <= n; s++) samples.push({ x: a.x + ((p.x - a.x) * s) / n, y: a.y + ((p.y - a.y) * s) / n });
      };
      for (const c of part) {
        if (c.op === 'M') { last = first = { x: c.x, y: c.y }; pts.push(last); if (sample) samples.push(last); }
        else if (c.op === 'L' && last) { const p = { x: c.x, y: c.y }; straight(last, p); pts.push(p); last = p; }
        else if (c.op === 'C' && last) {
          curved = true;
          let q = last;
          for (let s = 1; s <= 8; s++) { const r = bez(last, c.p1, c.p2, c.p3, s / 8); ink += dist(q, r); if (sample) samples.push(r); q = r; }
          pts.push(c.p1, c.p2, c.p3);
          last = c.p3;
        } else if (c.op === 'Z' && first && last) {
          if (dist(last, first) > 1e-6) straight(last, first);
          last = first;
        }
      }
      ps.ink += ink;
      if (isClaimed) { ps.wallInk += ink; setAside.claimed++; continue; }
      if (otherLayer) { setAside.layer++; continue; }
      if (pts.length < 2) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
      const bb: Bounds = [x0, y0, x1, y1];
      // wall faces, hatches and window lines inside wall bands
      let share = 0;
      if (samples.length && band.near(bb)) {
        let inWall = 0;
        for (const p of samples) if (band.inBand(p)) inWall++;
        share = inWall / samples.length;
      }
      ps.wallInk += ink * share;
      if (long || Math.max(x1 - x0, y1 - y0) > maxPiece) { setAside.long++; continue; }
      if (share >= cfg.wallShare) { setAside.wall++; continue; }
      // swing arcs of doors (an arc about a door hinge, about a leaf long)
      if (curved && hinges.length && hinges.some((h) => samples.every((p) => Math.abs(dist(p, h.c) - h.r) <= h.r * 0.12 + pt(0.03)))) { setAside.swing++; continue; }
      const out: ResidualVector = {
        id: `${v.id}:r${k}`,
        operation: 'stroke-path',
        commands: part as MuVector['commands'],
        points: pts,
        subpaths: [pts],
        bounds: bb,
        color: v.color,
        strokeWidth: v.strokeWidth,
        strokeWidthPt: v.strokeWidthPt,
        layer: pen,
        sourceVectorId: v.id,
        ...(dashed ? { dashes: v.dashes } : {}),
        ...(v.layer ? { sourceLayer: v.layer } : {}),
      };
      if (dashed) { dashedOut.push(out); setAside.dashed++; continue; }
      strokes.push(out);
    }
  }

  const text = drawnText(strokes);
  setAside.text = text.ids.size;
  const kept = text.ids.size ? strokes.filter((v) => !text.ids.has(v.id)) : strokes;
  for (const v of kept) weights.push(v.strokeWidthPt ?? v.strokeWidth ?? 0);
  weights.sort((a, b) => a - b);
  const maxGap = pt(3);
  return {
    strokes: kept,
    dashed: dashedOut,
    longLines,
    pens,
    medianLinePt: weights.length ? weights[weights.length >> 1] : 0,
    scaleMmPerPt: input.scaleMmPerPt,
    texts: input.texts ?? [],
    drawnTexts: text.boxes,
    wallFaces: wallFaceLines(walls),
    wallGapM: (p) => Math.min(3, body.nearest(p, maxGap) * mPerPt),
    inWall: (p) => body.inBand(p),
    setAside,
  };
}
