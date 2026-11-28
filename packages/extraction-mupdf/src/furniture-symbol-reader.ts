/**
 * Telling furniture from everything else in a drawing that keeps no furniture layers
 * (steps 2 and 3 of the layer-free reading; step 1 is furniture-residual.ts).
 *
 * A furniture layer tells a piece's family for free. Without one, each piece traced
 * from the residual linework is measured (symbolEvidence) and three kinds of evidence
 * decide what it is:
 *
 *  1. Plain rules (notFurniture) reject what is plainly something else: tags (a bare
 *     outline around text, a small symbol around a number), columns (a bare outline
 *     in a wall or on a structural grid), shafts and voids (crossed boxes), walled
 *     cells, stairs and hatching, door swings, slivers.
 *  2. A small trained model (furniture-symbol-model.ts) gives the family a furniture
 *     layer would have given the piece (furniture, plant, sanitary, equipment,
 *     joinery) or none, from shape, drawing and context measures. Copies of one CAD
 *     block share one answer, and each piece is weighed with the other pieces of its
 *     pen: one pen draws one kind of thing, so a pen that mostly draws furniture
 *     lifts its pieces and a pen that mostly draws tags or structure lowers them.
 *  3. The symbol grammar in furniture-symbols.ts (cistern and bowl, pillows, dashed
 *     overhead units, labels) names the piece, and can vouch for a piece the model
 *     is unsure of.
 *
 * decideBroadPiece puts the three together: a piece is kept as a known kind, kept as
 * an unknown custom item (furniture by the model, but no kind fits: it is built from
 * its own outline), or dropped. A bare single outline needs more of the model's
 * trust; a piece standing right beside one the model is sure of needs less.
 *
 * The geometry places every piece; the model only says whether it is furniture. It
 * is trained on drawings that keep their layers, where each piece's layer is its
 * label (tests/tools/symbol-dataset.test.ts and train-symbol-model.py), so it grows
 * with every layered drawing added and is tuned to none of them.
 */
import type { MuVector, Vec2 } from './vector-device';
import type { ResidualScene } from './furniture-residual';
import { SYMBOL_MODEL, type SymbolModel } from './furniture-symbol-model';

/** Families the model chooses between; 'none' is not furniture. */
export const SYMBOL_CLASSES = ['none', 'furniture', 'plant', 'sanitary', 'equipment', 'joinery'] as const;
export type SymbolClass = (typeof SYMBOL_CLASSES)[number];
export type SymbolFamily = Exclude<SymbolClass, 'none'>;

/** A traced piece, as furniture-blocks.ts measures it. */
export interface SymbolPiece {
  outline: Vec2[];
  hull: Vec2[];
  center: Vec2;
  /** Long side, short side (metres) and long-side angle of the smallest box around it. */
  widthM: number;
  depthM: number;
  angle: number;
  areaM2: number;
  perimM: number;
  /** Length of all its strokes, metres. */
  inkM: number;
  fill: number;
  solidity: number;
  circularity: number;
  corners: number;
  busy: number;
  bandM: number;
  shape: string;
  /** Read as a table top (chairs pulled up to it were split off). */
  isTop: boolean;
  /** Its strokes, flattened, page points. */
  lines: Vec2[][];
  /** Its strokes (residual vectors: one subpath each, pen as layer). */
  vectors: MuVector[];
  /** The pen (colour and weight) it is drawn in. */
  pen: string;
}

export interface SymbolReaderConfig {
  /** Least probability of any family (over none) to keep a piece on the model's word. */
  minFamilyP: number;
  /** Least probability to keep a piece no kind fits, as an unknown custom item. */
  minCustomP: number;
  /** Below this, not even the symbol grammar keeps a piece. */
  vetoP: number;
  /** Least probability for a bare single outline with no copy on the sheet. */
  minAloneP: number;
  /** Least probability for a piece standing right beside one the model is sure of. */
  minBesideP: number;
}

export const SYMBOL_READER_DEFAULTS: SymbolReaderConfig = { minFamilyP: 0.6, minCustomP: 0.7, vetoP: 0.1, minAloneP: 0.7, minBesideP: 0.5 };

/** Pieces whose centres are closer than half their lengths plus this stand beside each other (metres). */
export const BESIDE_GAP_M = 0.3;

export const SYMBOL_FEATURES = [
  'widthM', 'depthM', 'aspect', 'areaM2', 'perimM', 'inkM', 'busy', 'fill', 'solidity', 'circularity', 'corners', 'bandM',
  'shape', 'isTop', 'strokes', 'segments', 'curveShare', 'closedShare', 'lineRel', 'penWallShare', 'penShare', 'paperMm',
  'textInside', 'textNear', 'wallGapM', 'wallOverlap', 'wallSides', 'onLongLine', 'squareShare', 'diagonalShare', 'parallelRun', 'crossed',
  'quarterArc', 'endLines', 'repeats', 'copyTurns', 'rowMates', 'gridAligned', 'inkDensity',
  'g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8',
] as const;
export type SymbolFeature = (typeof SYMBOL_FEATURES)[number];

const F = Object.fromEntries(SYMBOL_FEATURES.map((k, i) => [k, i])) as Record<SymbolFeature, number>;
const SHAPE_CODE: Record<string, number> = { round: 0, rect: 1, curved: 2, 'l-shape': 3, free: 4 };

/**
 * Words that name furniture, fittings or fixtures when written on or beside a piece.
 * Words that are as often a room's name (WC, bath, shower, bar, reception, bed) are
 * left out: a bare box around one of those is the room, not a fitting.
 */
export const FURNITURE_WORD_RE = /\b(sofas?|settees?|couch(es)?|chairs?|armchairs?|stools?|bench(es)?|seat(s|ing)?|tables?|desks?|workstations?|counters?|credenzas?|cabinets?|cupboards?|wardrobes?|closets?|robes?|lockers?|shel(f|ves|ving)|bookcases?|cribs?|cots?|booths?|banquettes?|islands?|vanit(y|ies)|basins?|sinks?|urinals?|bathtubs?|tubs?|fridges?|refrigerators?|freezers?|ovens?|hobs?|cookers?|dishwashers?|washers?|dryers?|microwaves?|tv|televisions?|screens?|monitors?|displays?|planters?|artworks?|art\s*works?|wall\s*art|murals?|paintings?|tapestr(y|ies)|mirrors?|kiosks?|vitrines?|pianos?|pool\s*tables?|sideboards?|dressers?|nightstands?|bedside)\b/i;

/** Words that name a shaft, duct or void (a crossed box is one of these, not a cabinet). */
export const SHAFT_WORD_RE = /\b(shafts?|ducts?|risers?|voids?|lifts?|elevators?|chases?|flues?|chimneys?|open\s*to\s*below|atrium|skylights?|a\/?c|ahu|mech(anical)?|elec(trical)?|plumbing)\b/i;

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

interface Seg { a: Vec2; b: Vec2; curve: boolean; mid?: Vec2 }

/** Straight pieces of a piece's own commands (curves as one chord each, with their middle point). */
function pieceSegments(p: SymbolPiece): Seg[] {
  const segs: Seg[] = [];
  for (const v of p.vectors) {
    let last: Vec2 | null = null, first: Vec2 | null = null;
    for (const c of v.commands as Array<Record<string, any>>) {
      if (c.op === 'M') last = first = { x: c.x, y: c.y };
      else if (c.op === 'L' && last) { const q = { x: c.x, y: c.y }; segs.push({ a: last, b: q, curve: false }); last = q; }
      else if (c.op === 'C' && last) {
        const mid = { x: (last.x + 3 * c.p1.x + 3 * c.p2.x + c.p3.x) / 8, y: (last.y + 3 * c.p1.y + 3 * c.p2.y + c.p3.y) / 8 };
        segs.push({ a: last, b: c.p3, curve: true, mid });
        last = c.p3;
      } else if (c.op === 'Z' && last && first) { if (dist(last, first) > 1e-6) segs.push({ a: last, b: first, curve: false }); last = first; }
    }
  }
  return segs;
}

/** Circle through three points, or null when they lie on a line. */
function circle3(a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { c: { x: ux, y: uy }, r: Math.hypot(a.x - ux, a.y - uy) };
}

/**
 * A door swing on its own: one arc of about a quarter turn, a leaf's length in radius,
 * and at most the leaf and a jamb tick beside it.
 */
function isQuarterArc(segs: Seg[], mPerPt: number): boolean {
  const curves = segs.filter((s) => s.curve);
  if (curves.length < 1 || curves.length > 3) return false;
  let c0: { c: Vec2; r: number } | null = null, sweep = 0;
  for (const s of curves) {
    const fit = s.mid ? circle3(s.a, s.mid, s.b) : null;
    if (!fit) return false;
    if (!c0) c0 = fit;
    else if (dist(fit.c, c0.c) > c0.r * 0.08 || Math.abs(fit.r - c0.r) > c0.r * 0.08) return false;
    sweep += 2 * Math.asin(Math.min(1, dist(s.a, s.b) / (2 * fit.r)));
  }
  if (!c0) return false;
  const rM = c0.r * mPerPt;
  if (rM < 0.5 || rM > 1.4 || sweep < (55 * Math.PI) / 180 || sweep > (125 * Math.PI) / 180) return false;
  let straight = 0, n = 0;
  for (const s of segs) if (!s.curve) { straight += dist(s.a, s.b); n++; }
  return n <= 3 && straight <= c0.r * 1.35;
}

/** Straight lines drawn across a piece near one end (pillows and covers on a bed), counted once per place. */
export function endLines(lines: readonly Vec2[][], angle: number, hull: readonly Vec2[], depthM: number, mPerPt: number): number {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  let u0 = Infinity, u1 = -Infinity;
  for (const q of hull) { const u = q.x * ca + q.y * sa; if (u < u0) u0 = u; if (u > u1) u1 = u; }
  const at: number[] = [];
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const l = dist(a, b);
      if (l * mPerPt < depthM * 0.5) continue;
      const along = Math.abs(((b.x - a.x) * ca + (b.y - a.y) * sa) / l);
      if (along > Math.sin((12 * Math.PI) / 180)) continue;
      const u = ((a.x + b.x) / 2) * ca + ((a.y + b.y) / 2) * sa;
      const e = Math.min(u - u0, u1 - u) * mPerPt;
      if (e < 0.08 || e > 0.65) continue;
      if (!at.some((x) => Math.abs(x - u) * mPerPt < 0.02)) at.push(u);
    }
  }
  return at.length;
}

export interface SymbolEvidence {
  /** Measures in SYMBOL_FEATURES order (the counts over all pieces are filled in by readSymbols). */
  x: number[];
  /** Text written inside the piece's outline, if any. */
  insideText?: string;
}

/**
 * Measures of a piece, all independent of where it stands and which way it is turned.
 */
export function symbolEvidence(p: SymbolPiece, scene: ResidualScene): SymbolEvidence {
  const mPerPt = scene.scaleMmPerPt / 1000;
  const segs = pieceSegments(p);
  let ink = 0, curveInk = 0, square = 0, diagonal = 0;
  const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
  const lengths: { dir: number; len: number }[] = [];
  for (const s of segs) {
    const l = dist(s.a, s.b);
    ink += l;
    if (s.curve) { curveInk += l; continue; }
    if (l <= 0) continue;
    // angle to the piece's long side, folded to 0..45°
    const ux = (s.b.x - s.a.x) / l, uy = (s.b.y - s.a.y) / l;
    let t = Math.abs(Math.atan2(-ux * sa + uy * ca, ux * ca + uy * sa)) % (Math.PI / 2);
    if (t > Math.PI / 4) t = Math.PI / 2 - t;
    if (t < (5 * Math.PI) / 180) square += l;
    else if (t > (25 * Math.PI) / 180) diagonal += l;
    lengths.push({ dir: Math.round(((Math.atan2(uy, ux) + Math.PI) % Math.PI) / ((3 * Math.PI) / 180)), len: l });
  }
  // longest run of parallel lines of about one length (stair treads, hatching, slats)
  let parallelRun = 0;
  const byDir = new Map<number, number[]>();
  for (const s of lengths) {
    if (s.len * mPerPt < 0.15) continue;
    const arr = byDir.get(s.dir);
    if (arr) arr.push(s.len); else byDir.set(s.dir, [s.len]);
  }
  for (const arr of byDir.values()) {
    arr.sort((x, y) => x - y);
    let j = 0;
    for (let i = 0; i < arr.length; i++) {
      while (arr[i] > arr[j] * 1.08) j++;
      parallelRun = Math.max(parallelRun, i - j + 1);
    }
  }
  // two long diagonals crossing near the middle (shafts, voids, risers; tall units)
  const diagL = Math.hypot(p.widthM, p.depthM) / mPerPt;
  const longDiag = segs.filter((s) => !s.curve && dist(s.a, s.b) >= diagL * 0.7);
  let crossed = 0;
  for (let i = 0; i < longDiag.length && !crossed; i++) {
    for (let j = i + 1; j < longDiag.length; j++) {
      const a = longDiag[i], b = longDiag[j];
      const d1x = a.b.x - a.a.x, d1y = a.b.y - a.a.y, d2x = b.b.x - b.a.x, d2y = b.b.y - b.a.y;
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((b.a.x - a.a.x) * d2y - (b.a.y - a.a.y) * d2x) / den;
      const u = ((b.a.x - a.a.x) * d1y - (b.a.y - a.a.y) * d1x) / den;
      if (t > 0.3 && t < 0.7 && u > 0.3 && u < 0.7) { crossed = 1; break; }
    }
  }
  const closed = p.vectors.filter((v) => v.commands.some((c) => c.op === 'Z') || (v.points.length > 2 && dist(v.points[0], v.points[v.points.length - 1]) < 1e-3)).length;
  const linePt = p.vectors.reduce((s, v) => s + (v.strokeWidthPt ?? v.strokeWidth ?? 0), 0) / Math.max(1, p.vectors.length);
  // what the piece's pen draws elsewhere: structure (wall pens), or much of the sheet
  let penInk = 0, penWall = 0, allInk = 0;
  const own = new Set(p.vectors.map((v) => v.layer ?? ''));
  for (const [k, st] of scene.pens) {
    allInk += st.ink;
    if (own.has(k)) { penInk += st.ink; penWall += st.wallInk; }
  }
  // a long line (grid, dimension) through its middle: columns, grid bubbles
  let onLongLine = 0;
  const tolC = Math.max(0.03 / mPerPt, (Math.min(p.widthM, p.depthM) / mPerPt) * 0.1);
  for (const l of scene.longLines) {
    const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, l2 = dx * dx + dy * dy;
    if (l2 <= 0) continue;
    const t = ((p.center.x - l.a.x) * dx + (p.center.y - l.a.y) * dy) / l2;
    if (t < 0 || t > 1) continue;
    if (Math.hypot(l.a.x + t * dx - p.center.x, l.a.y + t * dy - p.center.y) <= tolC) { onLongLine++; if (onLongLine >= 2) break; }
  }
  // text on it and beside it (the text layer's and text drawn with lines)
  let textInside = 0, textNear = 0;
  let insideText: string | undefined;
  const reach = Math.max(p.widthM / 2 + 0.3, 0.6) / mPerPt;
  for (const list of [scene.texts, scene.drawnTexts]) {
    for (const t of list) {
      const c = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
      if (Math.abs(c.x - p.center.x) > reach || Math.abs(c.y - p.center.y) > reach) continue;
      if (pointInPolygon(c, p.outline)) { textInside++; if (!insideText && t.text) insideText = t.text; }
      else if (dist(c, p.center) <= reach) textNear++;
    }
  }
  // the piece's own box
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const q of p.hull) {
    const u = q.x * ca + q.y * sa, v = -q.x * sa + q.y * ca;
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const at = (u: number, v: number): Vec2 => ({ x: u * ca - v * sa, y: u * sa + v * ca });
  // walls: the nearest face, the share of the footprint inside wall bodies (columns and
  // wall ends), and how many of the box's four sides lie along a wall face
  let wallGapM = 3;
  for (const q of p.hull) { const g = scene.wallGapM(q); if (g < wallGapM) wallGapM = g; }
  let inside = 0, inWall = 0, wallSides = 0;
  if (wallGapM < 3) {
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        const q = at(u0 + ((i + 0.5) / 7) * (u1 - u0), v0 + ((j + 0.5) / 7) * (v1 - v0));
        if (!pointInPolygon(q, p.outline)) continue;
        inside++;
        if (scene.inWall(q)) inWall++;
      }
    }
    if (wallGapM <= 0.06) {
      const sides: [number, number, number, number][] = [[u0, v0, u1, v0], [u1, v0, u1, v1], [u1, v1, u0, v1], [u0, v1, u0, v0]];
      for (const [ua, va, ub, vb] of sides) {
        let near = 0;
        for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) if (scene.wallGapM(at(ua + (ub - ua) * f, va + (vb - va) * f)) <= 0.05) near++;
        if (near >= 4) wallSides++;
      }
    }
  }
  // ink spread over a 3 x 3 grid in the piece's own box, folded so the heaviest corner comes first
  const g = new Array<number>(9).fill(0);
  let total = 0;
  for (const line of p.lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const l = dist(a, b);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const u = (mx * ca + my * sa - u0) / Math.max(1e-6, u1 - u0), v = (-mx * sa + my * ca - v0) / Math.max(1e-6, v1 - v0);
      g[Math.min(2, Math.max(0, Math.floor(v * 3))) * 3 + Math.min(2, Math.max(0, Math.floor(u * 3)))] += l;
      total += l;
    }
  }
  const norm = g.map((x) => x / Math.max(1e-9, total));
  const flips = [norm, [2, 1, 0, 5, 4, 3, 8, 7, 6].map((i) => norm[i]), [6, 7, 8, 3, 4, 5, 0, 1, 2].map((i) => norm[i]), [8, 7, 6, 5, 4, 3, 2, 1, 0].map((i) => norm[i])];
  flips.sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[3] - x[3]);
  const grid = flips[0];
  const f: Record<SymbolFeature, number> = {
    widthM: p.widthM,
    depthM: p.depthM,
    aspect: p.depthM / Math.max(1e-6, p.widthM),
    areaM2: p.areaM2,
    perimM: p.perimM,
    inkM: p.inkM,
    busy: p.busy,
    fill: p.fill,
    solidity: p.solidity,
    circularity: p.circularity,
    corners: p.corners,
    bandM: p.bandM,
    shape: SHAPE_CODE[p.shape] ?? 4,
    isTop: p.isTop ? 1 : 0,
    strokes: p.vectors.length,
    segments: segs.length,
    curveShare: curveInk / Math.max(1e-9, ink),
    closedShare: closed / Math.max(1, p.vectors.length),
    lineRel: scene.medianLinePt > 0 ? linePt / scene.medianLinePt : 1,
    penWallShare: penWall / Math.max(1e-9, penInk),
    penShare: penInk / Math.max(1e-9, allInk),
    paperMm: (p.widthM / mPerPt) * (25.4 / 72),
    textInside,
    textNear,
    wallGapM,
    wallOverlap: inside ? inWall / inside : 0,
    wallSides,
    onLongLine,
    squareShare: square / Math.max(1e-9, ink - curveInk),
    diagonalShare: diagonal / Math.max(1e-9, ink - curveInk),
    parallelRun,
    crossed,
    quarterArc: isQuarterArc(segs, mPerPt) ? 1 : 0,
    endLines: endLines(p.lines, p.angle, p.hull, p.depthM, mPerPt),
    repeats: 0,
    copyTurns: 0,
    rowMates: 0,
    gridAligned: 0,
    inkDensity: p.inkM / Math.max(0.01, p.areaM2),
    g0: grid[0], g1: grid[1], g2: grid[2], g3: grid[3], g4: grid[4], g5: grid[5], g6: grid[6], g7: grid[7], g8: grid[8],
  };
  return { x: SYMBOL_FEATURES.map((k) => f[k]), ...(insideText ? { insideText } : {}) };
}

// ── counts over all the pieces of a drawing ───────────────────────────────────

/** Copies of one CAD block: same size (2 cm), ink (2%) and stroke count. A copy id per piece. */
export function symbolCopies(pieces: readonly SymbolPiece[]): number[] {
  const ids = new Array<number>(pieces.length).fill(-1);
  const order = pieces.map((_, i) => i).sort((a, b) => pieces[a].inkM - pieces[b].inkM);
  let next = 0;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    if (ids[i] >= 0) continue;
    ids[i] = next;
    const p = pieces[i];
    for (let j = k + 1; j < order.length; j++) {
      const q = pieces[order[j]];
      if (q.inkM > p.inkM * 1.02 + 0.01) break;
      if (ids[order[j]] >= 0) continue;
      if (Math.abs(q.widthM - p.widthM) <= 0.02 && Math.abs(q.depthM - p.depthM) <= 0.02 && Math.abs(q.vectors.length - p.vectors.length) <= Math.max(1, p.vectors.length * 0.1)) ids[order[j]] = next;
    }
    next++;
  }
  return ids;
}

/**
 * In how many ways the copies of each piece are turned (long side to 5°): furniture is
 * turned to fit its room and its table; tags, text and columns all stand one way.
 */
export function copyTurns(pieces: readonly SymbolPiece[], copies: readonly number[]): number[] {
  const byCopy = new Map<number, number[]>();
  copies.forEach((c, i) => { const arr = byCopy.get(c); if (arr) arr.push(i); else byCopy.set(c, [i]); });
  const out = new Array<number>(pieces.length).fill(0);
  for (const members of byCopy.values()) {
    if (members.length < 2) continue;
    const turns = new Set(members.map((i) => Math.round((((pieces[i].angle % Math.PI) + Math.PI) % Math.PI) / ((5 * Math.PI) / 180)) % 36));
    for (const i of members) out[i] = turns.size;
  }
  return out;
}

/** Pieces of about one height standing in a row beside each one, as the letters of a word do. */
export function rowMates(pieces: readonly SymbolPiece[]): number[] {
  const boxes = pieces.map((p) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of p.hull) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, h: y1 - y0 };
  });
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].cy - boxes[b].cy);
  const out = new Array<number>(pieces.length).fill(0);
  for (let k = 0; k < order.length; k++) {
    const a = boxes[order[k]];
    if (a.h <= 0) continue;
    for (let j = k + 1; j < order.length; j++) {
      const b = boxes[order[j]];
      if (b.cy - a.cy > a.h * 0.2) break;
      if (Math.abs(b.h - a.h) > a.h * 0.15 || Math.abs(b.cx - a.cx) > a.h * 3) continue;
      out[order[k]]++;
      out[order[j]]++;
    }
  }
  return out;
}

/**
 * For each piece, the share of its copies that line up with another copy both across
 * and down the page (the columns of a structural grid do; furniture rarely does both).
 */
export function gridAlignment(pieces: readonly SymbolPiece[], copies: readonly number[], scaleMmPerPt: number): number[] {
  const tol = 0.02 / (scaleMmPerPt / 1000);
  const byCopy = new Map<number, number[]>();
  copies.forEach((c, i) => { const arr = byCopy.get(c); if (arr) arr.push(i); else byCopy.set(c, [i]); });
  const out = new Array<number>(pieces.length).fill(0);
  for (const members of byCopy.values()) {
    if (members.length < 4) continue;
    let both = 0;
    for (const i of members) {
      const a = pieces[i].center;
      const sameX = members.some((j) => j !== i && Math.abs(pieces[j].center.x - a.x) <= tol && Math.abs(pieces[j].center.y - a.y) > tol * 50);
      const sameY = members.some((j) => j !== i && Math.abs(pieces[j].center.y - a.y) <= tol && Math.abs(pieces[j].center.x - a.x) > tol * 50);
      if (sameX && sameY) both++;
    }
    for (const i of members) out[i] = both / members.length;
  }
  return out;
}

// ── plain rules ───────────────────────────────────────────────────────────────

/** A bare outline: one or two strokes with nothing drawn inside. */
export function isPlain(x: readonly number[]): boolean {
  return x[F.busy] <= 1.35 && x[F.strokes] <= 3;
}

/**
 * Why a piece is plainly not furniture, whatever the model says, or null. `insideText`
 * is the text written inside it and `label` the text on or beside it.
 */
export function notFurniture(x: readonly number[], texts: { insideText?: string; label?: string } = {}): string | null {
  const plain = isPlain(x);
  const inside = texts.insideText ?? '';
  const namedInside = FURNITURE_WORD_RE.test(inside);
  if (x[F.depthM] < 0.12 && !(texts.label && FURNITURE_WORD_RE.test(texts.label))) return 'sliver';
  if (x[F.quarterArc]) return 'door swing';
  // a bare outline around text, or a small symbol around a number (door, window, wall and room tags)
  if (x[F.textInside] > 0 && !namedInside && (plain || (x[F.widthM] <= 1.0 && /\d/.test(inside)))) return 'tag';
  if (x[F.widthM] <= 1.0 && (x[F.wallOverlap] >= 0.3 || (plain && x[F.gridAligned] >= 0.5))) return 'column';
  // all four sides along wall faces: the lining of a walled cell (a shaft, a lift car, a riser)
  if (x[F.wallSides] >= 4) return 'walled space';
  if (x[F.crossed]) {
    const said = `${inside} ${texts.label ?? ''}`;
    if (x[F.depthM] >= 1.1) return 'shaft';
    if (x[F.busy] <= 2.2 && (x[F.depthM] > 0.95 || x[F.depthM] < 0.3 || SHAFT_WORD_RE.test(said))) return 'shaft';
  }
  if (x[F.parallelRun] >= 8 && x[F.widthM] >= 1.8) return 'stair or hatching';
  return null;
}

/** A family other than plain furniture must lead it by this much to be believed. */
const FAMILY_LEAD = 1.5;

// ── the model ─────────────────────────────────────────────────────────────────

/** Class probabilities from the forest (mean of the trees' leaf distributions). */
export function predictSymbol(model: SymbolModel, x: readonly number[]): number[] {
  const k = model.classes.length;
  const out = new Array<number>(k).fill(0);
  if (!model.trees.length) { out[0] = 1; return out; }
  for (const t of model.trees) {
    let n = 0;
    while (t.left[n] >= 0) n = x[t.feature[n]] <= t.threshold[n] ? t.left[n] : t.right[n];
    const v = t.value[n];
    for (let i = 0; i < k; i++) out[i] += v[i];
  }
  for (let i = 0; i < k; i++) out[i] /= model.trees.length;
  return out;
}

export interface SymbolVerdict {
  /** Measures (SYMBOL_FEATURES order). */
  x: number[];
  insideText?: string;
  /** Why it is plainly not furniture, if a rule says so. */
  rejected: string | null;
  /** Class probabilities (SYMBOL_CLASSES order), shared by the copies of one block. */
  probs: number[];
  /** Probability that it is furniture of any family, by its own measures alone. */
  ownP: number;
  /** The same for the other pieces drawn in its pen (its copies left out). */
  penP: number;
  /** Probability that it is furniture of any family, its pen weighed in. */
  p: number;
  /** The highest such probability among the pieces right beside it (0: it stands alone). */
  besideP: number;
  /** The likeliest family. */
  family: SymbolFamily;
  /** Other copies of the same block on the sheet. */
  repeats: number;
  /** Copy id (pieces with one id are copies of one block). */
  copy: number;
  /** A bare outline with nothing drawn inside. */
  plain: boolean;
}

/**
 * Steps 2 and 3 for every piece of a drawing: measures, plain rules and the model's
 * word, with the copies of one block sharing one answer and each pen weighed as a
 * whole. `labels` are the texts furniture-blocks.ts found on or beside each piece.
 */
export function readSymbols(
  pieces: readonly SymbolPiece[],
  scene: ResidualScene,
  labels: readonly (string | undefined)[] = [],
  model: SymbolModel = SYMBOL_MODEL,
): SymbolVerdict[] {
  const copies = symbolCopies(pieces);
  const counts = new Map<number, number>();
  for (const c of copies) counts.set(c, (counts.get(c) ?? 0) + 1);
  const turns = copyTurns(pieces, copies);
  const mates = rowMates(pieces);
  const grid = gridAlignment(pieces, copies, scene.scaleMmPerPt);
  const evidence = pieces.map((p, i) => {
    const e = symbolEvidence(p, scene);
    e.x[F.repeats] = (counts.get(copies[i]) ?? 1) - 1;
    e.x[F.copyTurns] = turns[i];
    e.x[F.rowMates] = mates[i];
    e.x[F.gridAligned] = grid[i];
    return e;
  });
  const rejected = evidence.map((e, i) => notFurniture(e.x, { insideText: e.insideText, label: labels[i] }));
  const none = model.classes.map((_, k) => (k === 0 ? 1 : 0));
  const probs = evidence.map((e, i) => (rejected[i] ? none : predictSymbol(model, e.x)));
  // copies of one block share one answer (rule-rejected copies keep out of the mean)
  const sum = new Map<number, { p: number[]; n: number }>();
  probs.forEach((pr, i) => {
    if (rejected[i]) return;
    const s = sum.get(copies[i]);
    if (s) { pr.forEach((v, k) => (s.p[k] += v)); s.n++; } else sum.set(copies[i], { p: [...pr], n: 1 });
  });
  const shared = evidence.map((_, i) => {
    const s = rejected[i] ? null : sum.get(copies[i]);
    return s ? s.p.map((v) => v / s.n) : probs[i];
  });
  const own = shared.map((pr) => 1 - pr[0]);
  // The pen's word. One pen draws one kind of thing, so a piece is weighed with the
  // other pieces of its pen: a pen that mostly draws furniture lifts it, a pen that
  // mostly draws other things lowers it. A pen with few pieces says little.
  const penP = [...own];
  const final = [...own];
  const ctx = model.context;
  if (ctx) {
    let all = 0, live = 0;
    const pens = new Map<string, { sum: number; n: number; copies: Map<number, { sum: number; n: number }> }>();
    pieces.forEach((p, i) => {
      if (rejected[i]) return;
      all += own[i];
      live++;
      let pen = pens.get(p.pen);
      if (!pen) pens.set(p.pen, (pen = { sum: 0, n: 0, copies: new Map() }));
      pen.sum += own[i];
      pen.n++;
      const c = pen.copies.get(copies[i]);
      if (c) { c.sum += own[i]; c.n++; } else pen.copies.set(copies[i], { sum: own[i], n: 1 });
    });
    const sheet = live ? all / live : 0;
    pieces.forEach((p, i) => {
      if (rejected[i]) return;
      const pen = pens.get(p.pen)!;
      const mine = pen.copies.get(copies[i])!;
      penP[i] = (pen.sum - mine.sum + ctx.shrink * sheet) / (pen.n - mine.n + ctx.shrink);
      final[i] = 1 / (1 + Math.exp(-(ctx.bias + ctx.own * logit(own[i]) + ctx.pen * (logit(penP[i]) - logit(sheet)))));
    });
  }
  // Furniture stands in groups: what the likeliest piece right beside each one says.
  const beside = new Array<number>(pieces.length).fill(0);
  const mPerPt = scene.scaleMmPerPt / 1000;
  const liveIdx = pieces.map((_, i) => i).filter((i) => !rejected[i]).sort((a, b) => pieces[a].center.x - pieces[b].center.x);
  let longest = 0;
  for (const i of liveIdx) if (pieces[i].widthM > longest) longest = pieces[i].widthM;
  for (let a = 0; a < liveIdx.length; a++) {
    const i = liveIdx[a], pi = pieces[i];
    const reachPt = ((pi.widthM + longest) / 2 + BESIDE_GAP_M) / mPerPt;
    for (let b = a + 1; b < liveIdx.length; b++) {
      const j = liveIdx[b], pj = pieces[j];
      if (pj.center.x - pi.center.x > reachPt) break;
      if (copies[i] === copies[j]) continue;
      if (Math.hypot(pj.center.x - pi.center.x, pj.center.y - pi.center.y) * mPerPt > (pi.widthM + pj.widthM) / 2 + BESIDE_GAP_M) continue;
      if (final[j] > beside[i]) beside[i] = final[j];
      if (final[i] > beside[j]) beside[j] = final[i];
    }
  }
  return evidence.map((e, i) => {
    const pr = shared[i];
    // furniture unless another family clearly leads it
    let best = 1;
    for (let k = 2; k < pr.length; k++) if (pr[k] > pr[best]) best = k;
    if (best !== 1 && pr[best] < FAMILY_LEAD * pr[1]) best = 1;
    return {
      x: e.x,
      ...(e.insideText ? { insideText: e.insideText } : {}),
      rejected: rejected[i],
      probs: pr,
      ownP: own[i],
      penP: penP[i],
      p: final[i],
      besideP: beside[i],
      family: (model.classes[best] ?? 'furniture') as SymbolFamily,
      repeats: (counts.get(copies[i]) ?? 1) - 1,
      copy: copies[i],
      plain: isPlain(e.x),
    };
  });
}

function logit(p: number): number {
  const q = Math.min(0.98, Math.max(0.02, p));
  return Math.log(q / (1 - q));
}

// ── putting the evidence together ─────────────────────────────────────────────

export interface BroadEvidence {
  verdict: SymbolVerdict;
  /** The symbol grammar named a kind for it. */
  classified: boolean;
  /** The grammar is sure of it from its parts (cistern and bowl, pillows, overhead unit, brace). */
  grammar: boolean;
  /** A label on or beside it names furniture. */
  named: boolean;
  /** Too thin to stand as a piece (a line, a thin arc). */
  thin: boolean;
}

/**
 * What becomes of a piece traced from residual linework: a known kind, an unknown
 * custom item (furniture by the model, but no kind fits), or nothing.
 */
export function decideBroadPiece(e: BroadEvidence, cfg: SymbolReaderConfig = SYMBOL_READER_DEFAULTS): 'known' | 'custom' | null {
  const v = e.verdict;
  if (v.rejected) return null;
  // the grammar's own parts, or a label naming furniture, vouch for a piece the model doubts
  if (e.classified && (e.grammar || e.named) && v.p >= cfg.vetoP) return 'known';
  // a bare single outline is weak evidence by itself: it needs a copy, or more of the model's trust
  // and furniture stands in groups: beside a piece the model is sure of, leaning is enough
  const need = v.plain
    ? (v.repeats === 0 ? Math.max(cfg.minAloneP, cfg.minFamilyP) : cfg.minFamilyP)
    : (v.besideP >= cfg.minFamilyP ? Math.min(cfg.minBesideP, cfg.minFamilyP) : cfg.minFamilyP);
  if (v.p < need) return null;
  if (e.classified) return 'known';
  // no kind fits: an unknown custom item, unless it is too thin to stand as a piece
  return !e.thin && v.p >= cfg.minCustomP ? 'custom' : null;
}
