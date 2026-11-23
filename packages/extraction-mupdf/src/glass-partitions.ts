/**
 * Straight glass partitions and glazed screens, read from the drawing's own linework
 * (no raster, no AI).
 *
 * Two kinds of evidence:
 *  1. The drawing's key. A legend entry whose text says glass, glazed or glazing has a
 *     sample line beside it, and that sample's style (colour, line weight, dash, one line
 *     or two lines a set distance apart) is the drawing's own definition of a glass
 *     partition: plan lines drawn in that style are glass. A one-line sample counts only
 *     when it is coloured, because plain black lines draw everything else.
 *  2. Without a key: two hairlines 2–7 cm apart (a glazed screen's frame; solid
 *     partitions are drawn thicker) that run from wall to wall, with no wall, worktop or
 *     desk edge alongside them, and that are not a window in an outside wall.
 *
 * Walls the wall detector already read along glass-styled lines are marked glass; the
 * other glass runs become new walls. A run continues through a door drawn in line with
 * it, so the door detector can hang that door in the glass wall.
 *
 * Coordinates are MuPDF page points (y down).
 */
import type { Bounds, MuVector, Vec2 } from './vector-device';
import { collectSegments, detectDoorSymbols } from './door-symbols';

export interface GlassText { text: string; x: number; y: number; w: number; h: number }
export interface GlassHostWall { id: string; a: Vec2; b: Vec2; thickness: number; perimeter?: boolean }
export type GlassSource = 'legend' | 'double-line';

export interface GlassStyle {
  rgb: [number, number, number];
  widthPt: number;
  dashed: boolean;
  fill: boolean;
  /** two-line samples: distance between the two lines, points */
  sepPt?: number;
  /** text of the legend entry */
  label: string;
  sample: Bounds;
}

export interface GlassPartition {
  id: string;
  a: Vec2;
  b: Vec2;
  thicknessPt: number;
  lengthM: number;
  thicknessM: number;
  source: GlassSource;
  label?: string;
  /** door openings the run continues through, as intervals (points) from `a` */
  openings: { from: number; to: number }[];
  sourceOperationIds: string[];
}

export interface GlassResult {
  partitions: GlassPartition[];
  /** walls already detected along glass-styled lines */
  glassWallIds: string[];
  /** ...with the evidence that made each one glass */
  glassWalls: { id: string; source: GlassSource }[];
  styles: GlassStyle[];
  diagnostics: {
    lines: number;
    legendEntries: number;
    legendRuns: number;
    pairRuns: number;
    doorOpenings: number;
    rejected: Record<string, number>;
  };
}

export interface GlassConfig {
  /** shortest glass run kept (keyed styles) */
  minRunM: number;
  /** two-hairline rule: spacing band (WC cubicle panels are thinner, solid partitions thicker), heaviest stroke kept, shortest run */
  pairMinSepM: number;
  pairMaxSepM: number;
  pairMaxStrokePt: number;
  /** ...and never closer than this on the page (points): drawn line weights would touch */
  pairMinSepPt: number;
  /** two hairlines this close still confirm a thin wall the wall detector read */
  thinWallMinSepM: number;
  /** a thin wall at least this long needs no door to count as a glazed front */
  thinWallLongM: number;
  pairMinRunM: number;
  /** two-hairline rule: brightest colour channel of a line (0 = black) */
  pairMaxShade: number;
  /** two-hairline rule: a run meets a wall square on (at least this angle) or in line with it */
  pairMinMeetDeg: number;
  /** two-hairline rule: two or more long parallel lines this close on one side make a stair, grid or hatch */
  patternM: number;
  /** a stroke at least this heavy (points) is a wall face */
  heavyStrokePt: number;
  /** a run end this close to a wall face, another glass run or a door jamb is attached */
  attachTolM: number;
  /** a gap this wide in line with a run end, up to a wall or glass run, is a doorway */
  doorGapMinM: number;
  doorGapMaxM: number;
  /** a wall or line alongside a two-hairline run closer than this makes it a worktop or desk edge */
  clearM: number;
  /** keyed two-line spacing accepted in metres */
  legendMinSepM: number;
  legendMaxSepM: number;
  /** a coloured one-line sample needs at least this much colour (max − min channel) */
  minChroma: number;
  /** a detected wall is glass when glass-styled lines run along this share of it */
  markWallShare: number;
  defaultThicknessM: number;
  minThicknessM: number;
  maxThicknessM: number;
}

export const GLASS_DEFAULTS: GlassConfig = {
  minRunM: 0.3,
  pairMinSepM: 0.04,
  pairMaxSepM: 0.07,
  pairMaxStrokePt: 0.75,
  pairMinSepPt: 0.8,
  thinWallMinSepM: 0.025,
  thinWallLongM: 3.0,
  pairMinRunM: 1.0,
  pairMaxShade: 0.35,
  pairMinMeetDeg: 60,
  patternM: 0.9,
  heavyStrokePt: 0.9,
  attachTolM: 0.15,
  doorGapMinM: 0.6,
  doorGapMaxM: 1.8,
  clearM: 0.75,
  legendMinSepM: 0.015,
  legendMaxSepM: 0.25,
  minChroma: 0.25,
  markWallShare: 0.6,
  defaultThicknessM: 0.05,
  minThicknessM: 0.03,
  maxThicknessM: 0.12,
};

const GLASS_RE = /\bglaz(?:ed|ing|e)?\b|\bglass\b/i;
const NOT_GLASS_RE =
  /fib(?:re|er)\s*-?\s*glass|fibreglass|fiberglass|glass\s*-?\s*(?:fib(?:re|er)|wool|mat\b|insulat|reinforced)|spandrel|glazed\s+(?:tile|brick|ceramic|block|pot)|glass\s+block|vision\s+panel|glazing\s+bead/i;
const DOOR_RE = /\bdoors?\b/i;
/** room names of toilets: thin double lines there are cubicle panels, not glass */
const WET_RE = /\b(?:w\.?c\.?s?|toilets?|cubicles?|lavator(?:y|ies)|urinals?|showers?|washrooms?|restrooms?)\b/i;
const PARTITION_RE = /screen|partition|wall|curtain/i;

interface Line {
  a: Vec2;
  b: Vec2;
  len: number;
  op: string;
  rgb: [number, number, number];
  w: number;
  dashed: boolean;
  fill: boolean;
}

/** A straight run: centre line a→b with the ops it came from. */
interface Run {
  a: Vec2;
  b: Vec2;
  len: number;
  sep: number;
  ops: string[];
  source: GlassSource;
  label?: string;
  /** coloured key style: one attached end is enough */
  loose: boolean;
  openings: { from: number; to: number }[];
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a: Vec2, b: Vec2) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const unit = (a: Vec2, b: Vec2) => {
  const l = dist(a, b) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};
const lerp = (a: Vec2, b: Vec2, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
  return dist(p, { x: a.x + d.x * t, y: a.y + d.y * t });
}

/** |sin| of the angle between two directions (0 = parallel). */
const sinBetween = (u: Vec2, v: Vec2) => Math.abs(u.x * v.y - u.y * v.x);

function toRgb(c?: number[]): [number, number, number] {
  if (!c || c.length === 0) return [0, 0, 0];
  if (c.length === 1) return [c[0]!, c[0]!, c[0]!];
  if (c.length === 4) {
    const [C, M, Y, K] = c as [number, number, number, number];
    return [(1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K)];
  }
  return [c[0]!, c[1]!, c[2]!];
}
const chroma = (c: [number, number, number]) => Math.max(...c) - Math.min(...c);
const colourDist = (p: [number, number, number], q: [number, number, number]) =>
  Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));

/** Straight lines with their paint. Curved paths are skipped (they are not straight glass). */
function collectLines(vectors: MuVector[]): Line[] {
  const hasCurve = (v: MuVector) => (v.commands ?? []).some((c) => c.op === 'C');
  const curvedRoots = new Set<string>();
  for (const v of vectors) if (hasCurve(v)) curvedRoots.add(v.id);
  const seen = new Set<string>();
  const out: Line[] = [];
  const key = (p: Vec2) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  for (const v of vectors) {
    if (hasCurve(v)) continue;
    if (v.sourceRootId && curvedRoots.has(v.sourceRootId)) continue;
    const m = /^(.*):s\d+$/.exec(v.id);
    if (m && curvedRoots.has(m[1]!)) continue;
    if (v.alpha !== undefined && v.alpha < 0.3) continue;
    const rgb = toRgb(v.color);
    if (Math.min(...rgb) > 0.9) continue; // white masks
    const op = v.sourceRootId ?? v.id;
    const dashed = !!v.dashes && v.dashes.some((d) => d > 0);
    const subs = v.subpaths && v.subpaths.length ? v.subpaths : [v.points];
    const styleKey = `${rgb.map((x) => x.toFixed(2)).join(',')}|${dashed ? 1 : 0}`;
    if (v.operation === 'fill-path') {
      // a thin filled rectangle drawn instead of a heavy line
      for (const s of subs) {
        const pts = s.length > 4 && dist(s[0]!, s[s.length - 1]!) < 0.05 ? s.slice(0, -1) : s;
        if (pts.length !== 4) continue;
        const [p0, p1, p2, p3] = pts as [Vec2, Vec2, Vec2, Vec2];
        const e1 = dist(p0, p1), e2 = dist(p1, p2);
        if (Math.abs(e1 - dist(p2, p3)) > 0.05 * Math.max(e1, 1) || Math.abs(e2 - dist(p3, p0)) > 0.05 * Math.max(e2, 1)) continue;
        if (Math.abs(dot(unit(p0, p1), unit(p1, p2))) > 0.02) continue; // not a rectangle
        const [w, a, b] = e1 >= e2 ? [e2, lerp(p0, p3, 0.5), lerp(p1, p2, 0.5)] : [e1, lerp(p0, p1, 0.5), lerp(p3, p2, 0.5)];
        const len = dist(a, b);
        if (w <= 0 || w > 12 || len < 6 * w) continue;
        const k = `F|${key(a)}|${key(b)}|${styleKey}|${w.toFixed(2)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ a, b, len, op, rgb, w, dashed: false, fill: true });
      }
      continue;
    }
    const w = v.strokeWidthPt ?? v.strokeWidth ?? 0;
    for (const s of subs) {
      for (let i = 0; i + 1 < s.length; i++) {
        const a = s[i]!, b = s[i + 1]!;
        const len = dist(a, b);
        if (len < 0.3) continue;
        const ka = key(a), kb = key(b);
        const k = `S|${ka < kb ? ka + '|' + kb : kb + '|' + ka}|${styleKey}|${w.toFixed(2)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ a, b, len, op, rgb, w, dashed, fill: false });
      }
    }
  }
  return out;
}

/** Direction angle folded into [0, π). */
function foldedAngle(a: Vec2, b: Vec2): number {
  let t = Math.atan2(b.y - a.y, b.x - a.x);
  if (t < 0) t += Math.PI;
  if (t >= Math.PI) t -= Math.PI;
  return t;
}

interface Framed<T> { item: T; u: Vec2; n: Vec2; rho: number; t0: number; t1: number }

/**
 * Index straight items by direction: buckets of `angTol` with items near 0/π also filed
 * (flipped) just below 0, so parallel lines are always found in neighbouring buckets.
 */
function directionIndex<T>(items: T[], ends: (x: T) => [Vec2, Vec2], angTol: number) {
  const buckets = new Map<number, Framed<T>[]>();
  const add = (k: number, f: Framed<T>) => {
    let arr = buckets.get(k);
    if (!arr) buckets.set(k, (arr = []));
    arr.push(f);
  };
  const frame = (item: T, theta: number): Framed<T> => {
    const [a, b] = ends(item);
    const u = { x: Math.cos(theta), y: Math.sin(theta) };
    const n = { x: -u.y, y: u.x };
    const ta = dot(a, u), tb = dot(b, u);
    return { item, u, n, rho: (dot(a, n) + dot(b, n)) / 2, t0: Math.min(ta, tb), t1: Math.max(ta, tb) };
  };
  const keyOf = (theta: number) => Math.round(theta / angTol);
  const nb = Math.round(Math.PI / angTol);
  for (const it of items) {
    const [a, b] = ends(it);
    const th = foldedAngle(a, b);
    add(keyOf(th), frame(it, th));
    if (th > Math.PI - 2 * angTol) add(keyOf(th - Math.PI), frame(it, th - Math.PI));
  }
  for (const arr of buckets.values()) arr.sort((p, q) => p.rho - q.rho);
  return { buckets, keyOf, nb };
}

function lowerBound<T>(arr: Framed<T>[], rho: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]!.rho < rho) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Centre pieces of parallel line pairs `sepMin`–`sepMax` apart that overlap. */
function pairLines(
  lines: Line[],
  sepMin: number,
  sepMax: number,
  compat: (p: Line, q: Line) => boolean,
  minOverlap: number,
): Run[] {
  const angTol = 0.6 * (Math.PI / 180);
  const { buckets, keyOf } = directionIndex(lines, (l) => [l.a, l.b], angTol);
  const out: Run[] = [];
  for (const l of lines) {
    const th = foldedAngle(l.a, l.b);
    const k = keyOf(th);
    const u = { x: Math.cos(th), y: Math.sin(th) };
    const n = { x: -u.y, y: u.x };
    const rho = (dot(l.a, n) + dot(l.b, n)) / 2;
    const ta = dot(l.a, u), tb = dot(l.b, u);
    const t0 = Math.min(ta, tb), t1 = Math.max(ta, tb);
    for (const kk of [k - 1, k, k + 1]) {
      const arr = buckets.get(kk);
      if (!arr) continue;
      for (let i = lowerBound(arr, rho + sepMin - 0.5); i < arr.length && arr[i]!.rho <= rho + sepMax + 0.5; i++) {
        const o = arr[i]!.item;
        if (o === l) continue;
        if (sinBetween(u, unit(o.a, o.b)) > Math.sin(angTol * 1.5)) continue;
        const orho = (dot(o.a, n) + dot(o.b, n)) / 2;
        const sep = orho - rho;
        if (sep < sepMin || sep > sepMax) continue;
        if (!compat(l, o)) continue;
        const oa = dot(o.a, u), ob = dot(o.b, u);
        const lo = Math.max(t0, Math.min(oa, ob)), hi = Math.min(t1, Math.max(oa, ob));
        if (hi - lo < minOverlap) continue;
        const mid = rho + sep / 2;
        const a = { x: n.x * mid + u.x * lo, y: n.y * mid + u.y * lo };
        const b = { x: n.x * mid + u.x * hi, y: n.y * mid + u.y * hi };
        out.push({ a, b, len: hi - lo, sep, ops: [l.op, o.op], source: 'double-line', loose: false, openings: [] });
      }
    }
  }
  return out;
}

/** Merge collinear pieces (gaps up to `gapTol`, offsets up to `offTol`) into runs. */
function mergeRuns(pieces: Run[], offTol: number, gapTol: number): Run[] {
  const angTol = 1 * (Math.PI / 180);
  const used = new Set<Run>();
  const { buckets, keyOf } = directionIndex(pieces, (p) => [p.a, p.b], angTol);
  const out: Run[] = [];
  // longest first so a run takes its frame from its strongest piece
  const order = [...pieces].sort((p, q) => q.len - p.len);
  for (const seed of order) {
    if (used.has(seed)) continue;
    const th = foldedAngle(seed.a, seed.b);
    const u = { x: Math.cos(th), y: Math.sin(th) };
    const n = { x: -u.y, y: u.x };
    const rho = (dot(seed.a, n) + dot(seed.b, n)) / 2;
    const group: { p: Run; t0: number; t1: number }[] = [];
    for (const kk of [keyOf(th) - 1, keyOf(th), keyOf(th) + 1]) {
      const arr = buckets.get(kk);
      if (!arr) continue;
      for (const f of arr) {
        const p = f.item;
        if (used.has(p) || group.some((g) => g.p === p)) continue;
        if (sinBetween(u, unit(p.a, p.b)) > Math.sin(angTol * 1.5)) continue;
        if (Math.abs((dot(p.a, n) + dot(p.b, n)) / 2 - rho) > offTol) continue;
        const ta = dot(p.a, u), tb = dot(p.b, u);
        group.push({ p, t0: Math.min(ta, tb), t1: Math.max(ta, tb) });
      }
    }
    group.sort((x, y) => x.t0 - y.t0);
    // split the collinear group at gaps; keep the cluster that holds the seed
    let cur: typeof group = [];
    let curHi = -Infinity;
    const clusters: (typeof group)[] = [];
    for (const g of group) {
      if (cur.length && g.t0 > curHi + gapTol) { clusters.push(cur); cur = []; curHi = -Infinity; }
      cur.push(g);
      curHi = Math.max(curHi, g.t1);
    }
    if (cur.length) clusters.push(cur);
    const mine = clusters.find((c) => c.some((g) => g.p === seed))!;
    for (const g of mine) used.add(g.p);
    const t0 = Math.min(...mine.map((g) => g.t0)), t1 = Math.max(...mine.map((g) => g.t1));
    const a = { x: n.x * rho + u.x * t0, y: n.y * rho + u.y * t0 };
    const b = { x: n.x * rho + u.x * t1, y: n.y * rho + u.y * t1 };
    const seps = mine.map((g) => g.p.sep).sort((x, y) => x - y);
    out.push({
      a, b, len: t1 - t0,
      sep: seps[seps.length >> 1]!,
      ops: [...new Set(mine.flatMap((g) => g.p.ops))],
      source: seed.source,
      label: seed.label,
      loose: seed.loose,
      openings: [],
    });
  }
  return out;
}

interface LegendFind { styles: GlassStyle[]; zones: Bounds[] }

/** Glass entries of the drawing's key and the style of the sample line beside each. */
function findLegend(lines: Line[], texts: GlassText[], mPerPt: number, cfg: GlassConfig): LegendFind {
  const styles: GlassStyle[] = [];
  const zones: Bounds[] = [];
  const horizontal = lines.filter((l) => Math.abs(l.a.y - l.b.y) <= 0.3);
  for (const t of texts) {
    if (!GLASS_RE.test(t.text) || t.h <= 0) continue;
    const h = t.h;
    // the entry's block: lines stacked above with the same left edge
    let first = t;
    const blockTexts = [t];
    for (let guard = 0; guard < 4; guard++) {
      const up = texts.find((o) => o !== first && Math.abs(o.x - first.x) <= 1.5 * h && o.y < first.y &&
        first.y - (o.y + o.h) <= 0.9 * h && Math.abs(o.h - first.h) <= 0.4 * Math.max(o.h, first.h));
      if (!up) break;
      first = up;
      blockTexts.push(up);
    }
    const below = texts.filter((o) => o !== t && Math.abs(o.x - t.x) <= 1.5 * h && o.y > t.y && o.y - (t.y + t.h) <= 0.9 * h);
    const block = [...blockTexts, ...below].map((o) => o.text).join(' ');
    if (NOT_GLASS_RE.test(block)) continue;
    if (DOOR_RE.test(block) && !PARTITION_RE.test(block)) continue;
    const y0 = first.y - 0.6 * h, y1 = t.y + t.h + 0.6 * h;
    const x1 = first.x - 0.5, x0 = first.x - 24 * h;
    const inZone = horizontal.filter((l) => {
      const lx0 = Math.min(l.a.x, l.b.x), lx1 = Math.max(l.a.x, l.b.x);
      return lx0 >= x0 && lx1 <= x1 && l.a.y >= y0 && l.a.y <= y1 && l.len >= Math.max(6, 1.5 * h) && l.len <= 30 * h;
    });
    // group by paint; pick the style whose sample ends nearest the text
    const groups: Line[][] = [];
    for (const l of inZone) {
      const g = groups.find((gg) => colourDist(gg[0]!.rgb, l.rgb) <= 0.06 && Math.abs(gg[0]!.w - l.w) <= 0.05 * Math.max(1, l.w) &&
        gg[0]!.dashed === l.dashed && gg[0]!.fill === l.fill);
      if (g) g.push(l); else groups.push([l]);
    }
    let best: { st: GlassStyle; gap: number } | null = null;
    for (const g of groups) {
      const ys: number[] = [];
      for (const l of g) if (!ys.some((y) => Math.abs(y - l.a.y) <= 0.3)) ys.push(l.a.y);
      ys.sort((p, q) => p - q);
      const gx0 = Math.min(...g.map((l) => Math.min(l.a.x, l.b.x))), gx1 = Math.max(...g.map((l) => Math.max(l.a.x, l.b.x)));
      let sepPt: number | undefined;
      if (ys.length === 2) {
        sepPt = ys[1]! - ys[0]!;
        if (sepPt < 0.3 || sepPt > 3 * h) continue;
      } else if (ys.length !== 1) continue;
      const proto = g[0]!;
      if (sepPt === undefined) {
        if (chroma(proto.rgb) < cfg.minChroma) continue; // plain black/grey lines draw everything
      } else {
        const m = sepPt * mPerPt;
        if (m < cfg.legendMinSepM || m > cfg.legendMaxSepM) continue;
      }
      const gap = first.x - gx1;
      if (gap > 8 * h) continue;
      const st: GlassStyle = {
        rgb: proto.rgb, widthPt: proto.w, dashed: proto.dashed, fill: proto.fill,
        ...(sepPt !== undefined ? { sepPt } : {}),
        label: block.trim().slice(0, 120),
        sample: [gx0, Math.min(...ys) - proto.w, gx1, Math.max(...ys) + proto.w],
      };
      if (!best || gap < best.gap) best = { st, gap };
    }
    if (!best) continue;
    const st = best.st;
    const allTexts = [...blockTexts, ...below];
    zones.push([
      Math.min(st.sample[0], ...allTexts.map((o) => o.x)) - h,
      Math.min(st.sample[1], ...allTexts.map((o) => o.y)) - h,
      Math.max(st.sample[2], ...allTexts.map((o) => o.x + o.w)) + h,
      Math.max(st.sample[3], ...allTexts.map((o) => o.y + o.h)) + h,
    ]);
    const dup = styles.find((s) => colourDist(s.rgb, st.rgb) <= 0.06 && Math.abs(s.widthPt - st.widthPt) <= 0.1 &&
      s.dashed === st.dashed && s.fill === st.fill && (s.sepPt === undefined) === (st.sepPt === undefined) &&
      (s.sepPt === undefined || Math.abs(s.sepPt - st.sepPt!) <= 0.3 * s.sepPt));
    if (!dup) styles.push(st);
  }
  return { styles, zones };
}

const inBounds = (p: Vec2, b: Bounds) => p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3];

interface Cover { wall: GlassHostWall; lo: number; hi: number; share: number }

/** Stretches of a run (t from `a`, points) lying in the band of a parallel detected wall. */
function wallCover(r: { a: Vec2; b: Vec2; len: number }, walls: GlassHostWall[], extra: number): Cover[] {
  const u = unit(r.a, r.b);
  const out: Cover[] = [];
  for (const w of walls) {
    const wl = dist(w.a, w.b);
    if (wl < 1e-6) continue;
    const wu = unit(w.a, w.b);
    if (sinBetween(u, wu) > Math.sin(3 * Math.PI / 180)) continue;
    const band = w.thickness / 2 + extra;
    const wn = { x: -wu.y, y: wu.x };
    const offA = Math.abs(dot(sub(r.a, w.a), wn)), offB = Math.abs(dot(sub(r.b, w.a), wn));
    if (offA > band || offB > band) continue;
    const ta = dot(sub(w.a, r.a), u), tb = dot(sub(w.b, r.a), u);
    const lo = Math.max(0, Math.min(ta, tb)), hi = Math.min(r.len, Math.max(ta, tb));
    if (hi - lo <= 0.5) continue;
    out.push({ wall: w, lo, hi, share: (hi - lo) / wl });
  }
  return out;
}

/** Remove covered stretches from [0, len]; returns the free intervals. */
function freeIntervals(len: number, covers: { lo: number; hi: number }[]): [number, number][] {
  const cs = [...covers].sort((p, q) => p.lo - q.lo);
  const out: [number, number][] = [];
  let at = 0;
  for (const c of cs) {
    if (c.lo > at) out.push([at, c.lo]);
    at = Math.max(at, c.hi);
  }
  if (at < len) out.push([at, len]);
  return out;
}

interface Opening { a: Vec2; b: Vec2 }

type EndHit = { kind: 'wall'; wall: GlassHostWall; collinear: boolean } | { kind: 'glass' } | { kind: 'opening'; far: Vec2 } | { kind: 'gap' } | null;

export function detectGlassPartitions(
  input: { vectors: MuVector[]; texts: GlassText[]; walls: GlassHostWall[]; scaleMmPerPt: number; within?: Bounds },
  cfg: GlassConfig = GLASS_DEFAULTS,
): GlassResult {
  const mPerPt = input.scaleMmPerPt / 1000;
  const pt = (m: number) => m / mPerPt;
  const rejected: Record<string, number> = {};
  const reject = (why: string, _r?: unknown) => { rejected[why] = (rejected[why] ?? 0) + 1; };
  const lines = collectLines(input.vectors);
  const { styles, zones } = findLegend(lines, input.texts, mPerPt, cfg);
  const inPlan = (l: { a: Vec2; b: Vec2 }) =>
    (!input.within || (inBounds(l.a, input.within) && inBounds(l.b, input.within))) &&
    !zones.some((z) => inBounds(l.a, z) || inBounds(l.b, z));
  const plan = lines.filter(inPlan);
  const walls = input.walls;
  const tol = Math.max(3, pt(cfg.attachTolM));
  const glassWallIds = new Map<string, GlassSource>();
  const wetTexts = input.texts.filter((t) => WET_RE.test(t.text));

  // door openings (jamb to jamb) from the door symbols
  const openings: Opening[] = [];
  const leaves: Opening[] = [];
  try {
    const symbols = detectDoorSymbols(collectSegments(input.vectors), input.scaleMmPerPt, { minLeafMm: 500, maxLeafMm: 1500, hostCorridorPadPt: 18 });
    for (const s of symbols) {
      openings.push({ a: s.hinge, b: s.closed });
      leaves.push({ a: s.hinge, b: s.free });
    }
  } catch { /* no doors: runs simply end where they end */ }

  // ---- 1. keyed styles -----------------------------------------------------------------
  const keyed: Run[] = [];
  const keyedOps = new Set<string>();
  for (const st of styles) {
    const match = plan.filter((l) => l.dashed === st.dashed && l.fill === st.fill && colourDist(l.rgb, st.rgb) <= 0.1 &&
      Math.abs(l.w - st.widthPt) <= Math.max(0.15, 0.25 * st.widthPt));
    let pieces: Run[];
    if (st.sepPt === undefined) {
      pieces = match.map((l) => ({ a: l.a, b: l.b, len: l.len, sep: 0, ops: [l.op], source: 'legend' as const, loose: true, openings: [] }));
    } else {
      const s = st.sepPt;
      pieces = pairLines(match, s * 0.6 - 0.2, s * 1.4 + 0.2, () => true, 1).map((p) => ({ ...p, source: 'legend' as const }));
    }
    for (const p of pieces) { p.label = st.label; p.loose = chroma(st.rgb) >= cfg.minChroma; }
    for (const r of mergeRuns(pieces, 0.8 + st.widthPt / 2, Math.max(1.5, 2 * st.widthPt))) {
      if (r.len * mPerPt < cfg.minRunM) { reject('legend-short'); continue; }
      if (st.sepPt === undefined) r.sep = 0;
      keyed.push(r);
      for (const o of r.ops) keyedOps.add(o);
    }
  }

  // ---- 2. two hairlines (no key) ---------------------------------------------------------
  // dark lines only: grey and coloured linework is furniture, finishes and hatching
  const hair = plan.filter((l) => !l.fill && !l.dashed && l.w <= cfg.pairMaxStrokePt && l.len >= 2 && Math.max(...l.rgb) <= cfg.pairMaxShade && !keyedOps.has(l.op));
  // closer pairs are kept to confirm thin walls the wall detector read; new walls need pairMinSepM
  const pairPieces = pairLines(
    hair,
    Math.max(cfg.pairMinSepPt, pt(cfg.thinWallMinSepM)),
    pt(cfg.pairMaxSepM),
    (p, q) => colourDist(p.rgb, q.rgb) <= 0.1 && Math.max(p.w, q.w) <= 2.5 * Math.max(0.05, Math.min(p.w, q.w)),
    2,
  );
  const pairRuns = mergeRuns(pairPieces, 1.5, Math.max(1.5, pt(0.04))).filter((r) => {
    if (r.len * mPerPt < cfg.pairMinRunM) { reject('pair-short', r); return false; }
    return true;
  });

  // ---- 3. keyed runs along detected walls mark them glass; the rest are new -------------
  const fresh: Run[] = [];
  for (const r of keyed) {
    const covers = wallCover(r, walls, Math.max(1, r.sep / 2 + 0.5));
    for (const c of covers) if (c.share >= cfg.markWallShare) glassWallIds.set(c.wall.id, 'legend');
    for (const [lo, hi] of freeIntervals(r.len, covers)) {
      if ((hi - lo) * mPerPt < cfg.minRunM) continue;
      fresh.push({ ...r, a: lerp(r.a, r.b, lo / r.len), b: lerp(r.a, r.b, hi / r.len), len: hi - lo });
    }
  }
  const candidates: Run[] = [];
  /** detected thin walls the two hairlines run along: glazed screens the wall detector already read */
  const thinWalls = new Map<string, GlassHostWall>();
  const thinCover = new Map<string, { lo: number; hi: number }[]>();
  const maxThinPt = pt(cfg.pairMaxSepM + 0.01);
  const alongside = (r: { a: Vec2; b: Vec2; len: number; sep: number }, a: Vec2, b: Vec2, half: number) => {
    const u = unit(r.a, r.b), n = { x: -u.y, y: u.x };
    if (sinBetween(u, unit(a, b)) > Math.sin(3 * Math.PI / 180)) return false;
    const dc = Math.abs(dot(sub(lerp(a, b, 0.5), r.a), n));
    if (dc <= Math.max(1, 0.5 * r.sep)) return false; // the same line: a duplicate or a collinear piece
    // touching (a lining on a wall face) up to a worktop's depth away
    if (dc - half - r.sep / 2 > pt(cfg.clearM)) return false;
    const ta = dot(sub(a, r.a), u), tb = dot(sub(b, r.a), u);
    return Math.min(r.len, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb)) >= 0.7 * r.len;
  };
  // a wall or another line pair alongside: a worktop, desk or counter edge, not a screen
  const heavy = plan.filter((l) => !l.fill && l.w >= cfg.heavyStrokePt && l.len >= pt(0.3));
  const heavyIdx = directionIndex(heavy, (l) => [l.a, l.b], 1 * (Math.PI / 180));
  const hasAlongside = (r: { a: Vec2; b: Vec2; len: number; sep: number }, self?: string) => {
    if (walls.some((w) => w.id !== self && alongside(r, w.a, w.b, w.thickness / 2))) return true;
    if (pairRuns.some((o) => o !== r && alongside(r, o.a, o.b, o.sep / 2))) return true;
    // a heavy line alongside: the face of a wall the wall detector did not read
    const th = foldedAngle(r.a, r.b);
    for (const k of [heavyIdx.keyOf(th) - 1, heavyIdx.keyOf(th), heavyIdx.keyOf(th) + 1]) {
      for (const f of heavyIdx.buckets.get(k) ?? []) {
        const l = f.item;
        if (alongside(r, l.a, l.b, l.w / 2)) return true;
        // ...or drawn over one of the two lines: detail of a wall face
        const u = unit(r.a, r.b), n = { x: -u.y, y: u.x };
        if (sinBetween(u, unit(l.a, l.b)) > Math.sin(3 * Math.PI / 180)) continue;
        if (Math.abs(dot(sub(lerp(l.a, l.b, 0.5), r.a), n)) > r.sep / 2 + l.w / 2 + 0.5) continue;
        const ta = dot(sub(l.a, r.a), u), tb = dot(sub(l.b, r.a), u);
        if (Math.min(r.len, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb)) >= 0.5 * r.len) return true;
      }
    }
    return false;
  };
  // stairs, tiling, ceiling grids, hatching: several long parallel lines on one side
  const planIdx = directionIndex(plan, (l) => [l.a, l.b], 1 * (Math.PI / 180));
  const inPattern = (r: { a: Vec2; b: Vec2; len: number; sep: number }) => {
    const th = foldedAngle(r.a, r.b);
    const u = { x: Math.cos(th), y: Math.sin(th) }, n = { x: -u.y, y: u.x };
    const rho = (dot(r.a, n) + dot(r.b, n)) / 2;
    const t0 = Math.min(dot(r.a, u), dot(r.b, u)), t1 = Math.max(dot(r.a, u), dot(r.b, u));
    const reach = pt(cfg.patternM);
    // parallel lines grouped by offset; each group's cover of the run (dashes and tile edges add up)
    const groups: { off: number; iv: { lo: number; hi: number }[] }[] = [];
    for (const k of [planIdx.keyOf(th) - 1, planIdx.keyOf(th), planIdx.keyOf(th) + 1]) {
      const arr = planIdx.buckets.get(k);
      if (!arr) continue;
      for (let i = lowerBound(arr, rho - reach - 1); i < arr.length && arr[i]!.rho <= rho + reach + 1; i++) {
        const l = arr[i]!.item;
        if (sinBetween(u, unit(l.a, l.b)) > Math.sin(2 * Math.PI / 180)) continue;
        const off = (dot(l.a, n) + dot(l.b, n)) / 2 - rho;
        if (Math.abs(off) <= r.sep / 2 + 0.6 || Math.abs(off) > reach) continue;
        const la = dot(l.a, u), lb = dot(l.b, u);
        const lo = Math.max(t0, Math.min(la, lb)), hi = Math.min(t1, Math.max(la, lb));
        if (hi <= lo) continue;
        let g = groups.find((x) => Math.abs(x.off - off) <= 0.5);
        if (!g) groups.push((g = { off, iv: [] }));
        g.iv.push({ lo: lo - t0, hi: hi - t0 });
      }
    }
    const len = t1 - t0;
    const cover = (iv: { lo: number; hi: number }[]) => len - freeIntervals(len, iv).reduce((s2, [lo, hi]) => s2 + (hi - lo), 0);
    const sides = [0, 0], partial = [0, 0];
    for (const g of groups) {
      const c = cover(g.iv) / len;
      if (c >= 0.7) sides[g.off < 0 ? 0 : 1]!++;
      else if (c >= 0.3) partial[g.off < 0 ? 0 : 1]!++;
    }
    return sides.some((x) => x >= 2) || sides.some((x, i) => x + partial[i]! >= 4);
  };
  const nearWet = (r: { a: Vec2; b: Vec2; len: number }) => {
    const u = unit(r.a, r.b), n = { x: -u.y, y: u.x };
    const reach = pt(2), pad = pt(0.3);
    return wetTexts.some((t) => {
      const c = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
      const along = dot(sub(c, r.a), u), off = Math.abs(dot(sub(c, r.a), n));
      return along >= -pad && along <= r.len + pad && off <= reach;
    });
  };
  for (const r of pairRuns) {
    if (nearWet(r)) { reject('pair-wc', r); continue; }
    if (inPattern(r)) { reject('pair-pattern', r); continue; }
    // a door leaf (open or closed) is drawn as two hairlines too
    if ([...leaves, ...openings].some((d) => segDist(r.a, d.a, d.b) <= tol && segDist(r.b, d.a, d.b) <= tol)) { reject('pair-door-leaf', r); continue; }
    const covers = wallCover(r, walls, Math.max(1, r.sep / 2 + 0.5));
    const thick = covers.filter((c) => c.wall.thickness > maxThinPt || c.wall.perimeter);
    if (thick.reduce((s, c) => s + (c.hi - c.lo), 0) >= 0.3 * r.len) { reject('pair-in-wall', r); continue; }
    for (const c of covers) {
      if (thick.includes(c)) continue;
      // coverage in the wall's own frame, gathered over all runs along it
      const wu = unit(c.wall.a, c.wall.b);
      const ta = dot(sub(lerp(r.a, r.b, c.lo / r.len), c.wall.a), wu), tb = dot(sub(lerp(r.a, r.b, c.hi / r.len), c.wall.a), wu);
      let iv = thinCover.get(c.wall.id);
      if (!iv) thinCover.set(c.wall.id, (iv = []));
      iv.push({ lo: Math.min(ta, tb), hi: Math.max(ta, tb) });
    }
    if (r.sep < pt(cfg.pairMinSepM)) continue;
    for (const [lo, hi] of freeIntervals(r.len, covers)) {
      if ((hi - lo) * mPerPt < cfg.pairMinRunM) continue;
      const piece: Run = { ...r, a: lerp(r.a, r.b, lo / r.len), b: lerp(r.a, r.b, hi / r.len), len: hi - lo, openings: [] };
      if (hasAlongside(piece)) { reject('pair-alongside', piece); continue; }
      candidates.push(piece);
    }
  }

  // ---- 4. structure: run ends must meet walls, other glass or a door in line ------------
  const endHit = (r: Run, end: 'a' | 'b', glass: Run[]): EndHit => endHitWith(r, end, glass, walls);
  function endHitWith(r: Run, end: 'a' | 'b', glass: Run[], hostWalls: GlassHostWall[]): EndHit {
    const E = r[end];
    const out = end === 'a' ? unit(r.b, r.a) : unit(r.a, r.b);
    for (const w of hostWalls) {
      const d = segDist(E, w.a, w.b);
      if (d > w.thickness / 2 + tol) continue;
      const wu = unit(w.a, w.b);
      const meet = r.source === 'legend' ? 25 : cfg.pairMinMeetDeg;
      if (sinBetween(out, wu) >= Math.sin(meet * Math.PI / 180)) return { kind: 'wall', wall: w, collinear: false };
      if (sinBetween(out, wu) > Math.sin(5 * Math.PI / 180)) continue; // askew: a door leaf or furniture, not a partition
      // in line with the wall: only an end-to-end continuation counts
      if (Math.min(dist(E, w.a), dist(E, w.b)) <= tol + w.thickness / 2) return { kind: 'wall', wall: w, collinear: true };
    }
    for (const g of glass) {
      if (g === r) continue;
      if (segDist(E, g.a, g.b) <= Math.max(g.sep, r.sep) / 2 + tol) return { kind: 'glass' };
    }
    for (const o of openings) {
      const ou = unit(o.a, o.b);
      if (sinBetween(out, ou) > Math.sin(10 * Math.PI / 180)) continue;
      const da = dist(E, o.a), db = dist(E, o.b);
      if (Math.min(da, db) > tol) continue;
      const far = da <= db ? o.b : o.a;
      if (dot(sub(far, E), out) <= 0) continue; // the opening must lie beyond the end
      return { kind: 'opening', far };
    }
    // a doorway-wide gap in line with the run, to the end of a wall or glass run or the face
    // of a wall across its line: a door the door detector did not read (the run is not
    // continued across it). Only the first thing the line meets counts.
    const gapLo = pt(cfg.doorGapMinM), gapHi = pt(cfg.doorGapMaxM);
    let nearest = Infinity;
    const inLine = (F: Vec2, su: Vec2, half: number) => {
      if (sinBetween(out, su) > Math.sin(5 * Math.PI / 180)) return;
      const v = sub(F, E);
      const along = dot(v, out);
      if (along > 0 && Math.abs(v.x * out.y - v.y * out.x) <= half + tol) nearest = Math.min(nearest, along);
    };
    for (const w of hostWalls) {
      const wu = unit(w.a, w.b);
      inLine(w.a, wu, w.thickness / 2);
      inLine(w.b, wu, w.thickness / 2);
      const den = out.x * wu.y - out.y * wu.x;
      if (Math.abs(den) < 0.5) continue;
      const d = sub(w.a, E);
      const along = (d.x * wu.y - d.y * wu.x) / den;
      const sAlong = (d.x * out.y - d.y * out.x) / den;
      if (sAlong < -tol || sAlong > dist(w.a, w.b) + tol) continue;
      const face = along - (w.thickness / 2) / Math.abs(den);
      if (face > 0) nearest = Math.min(nearest, face);
    }
    for (const g of glass) {
      if (g === r) continue;
      const gu = unit(g.a, g.b);
      inLine(g.a, gu, g.sep / 2);
      inLine(g.b, gu, g.sep / 2);
    }
    if (nearest >= gapLo && nearest <= gapHi) return { kind: 'gap' };
    return null;
  }

  const hasDoor = (r: { a: Vec2; b: Vec2 }, ha: EndHit, hb: EndHit) =>
    ha?.kind === 'gap' || ha?.kind === 'opening' || hb?.kind === 'gap' || hb?.kind === 'opening' ||
    openings.some((o) => segDist(o.a, r.a, r.b) <= tol || segDist(o.b, r.a, r.b) <= tol);
  const accepted: Run[] = [];
  const pending = [...fresh, ...candidates];
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i]!;
      const glassNow = [...accepted, ...fresh];
      const ha = endHit(r, 'a', glassNow), hb = endHit(r, 'b', glassNow);
      const ok = r.loose ? !!(ha || hb) : !!(ha && hb);
      if (!ok) continue;
      // in line with outside walls at both ends: a window, not a partition
      if (r.source === 'double-line' && ha?.kind === 'wall' && hb?.kind === 'wall' && ha.collinear && hb.collinear &&
        ha.wall.perimeter && hb.wall.perimeter) {
        pending.splice(i--, 1);
        reject('pair-window');
        continue;
      }
      // a glazed screen without a key holds a door (or meets a doorway): lift doors, linings and
      // balustrades drawn the same way hold none
      if (r.source === 'double-line' && !hasDoor(r, ha, hb)) continue;
      // continue through doors drawn in line with the run
      for (const [end, hit] of [['a', ha], ['b', hb]] as const) {
        if (hit?.kind !== 'opening') continue;
        const u = unit(r.a, r.b);
        const t = dot(sub(hit.far, r.a), u);
        if (end === 'a' && t < 0) {
          const shift = -t;
          r.openings = [...r.openings.map((o) => ({ from: o.from + shift, to: o.to + shift })), { from: 0, to: shift }];
          r.a = { x: r.a.x + u.x * t, y: r.a.y + u.y * t };
          r.len += shift;
        } else if (end === 'b' && t > r.len) {
          r.openings.push({ from: r.len, to: t });
          r.b = { x: r.a.x + u.x * t, y: r.a.y + u.y * t };
          r.len = t;
        }
      }
      accepted.push(r);
      pending.splice(i--, 1);
      changed = true;
    }
    if (!changed) break;
  }
  for (const r of pending) reject(r.source === 'legend' ? 'legend-unattached' : 'pair-unattached', r);

  for (const [id, iv] of thinCover) {
    const w = walls.find((x) => x.id === id)!;
    const wl = dist(w.a, w.b);
    const free = freeIntervals(wl, iv.map((c) => ({ lo: Math.max(0, c.lo), hi: Math.min(wl, c.hi) })));
    const covered = wl - free.reduce((s2, [lo, hi]) => s2 + (hi - lo), 0);
    if (covered >= cfg.markWallShare * wl) thinWalls.set(id, w);
  }
  // thin walls along two hairlines: glass when they too meet walls, glass or doors at both
  // ends (their own ends excluded) and are no worktop edge or window
  for (const w of thinWalls.values()) {
    const r: Run = { a: w.a, b: w.b, len: dist(w.a, w.b), sep: w.thickness, ops: [], source: 'double-line', loose: false, openings: [] };
    if (nearWet(r)) { reject('thin-wall-wc', r); continue; }
    if (inPattern(r)) { reject('thin-wall-pattern', r); continue; }
    if (hasAlongside(r, w.id)) { reject('thin-wall-alongside', r); continue; }
    const others = walls.filter((o) => o.id !== w.id);
    const ha = endHitWith(r, 'a', accepted, others), hb = endHitWith(r, 'b', accepted, others);
    if (!ha || !hb) { reject('thin-wall-unattached', r); continue; }
    if (ha.kind === 'wall' && hb.kind === 'wall' && ha.collinear && hb.collinear && ha.wall.perimeter && hb.wall.perimeter) { reject('thin-wall-window', r); continue; }
    if (!hasDoor(r, ha, hb) && r.len * mPerPt < cfg.thinWallLongM) { reject('thin-wall-no-door', r); continue; }
    if (!glassWallIds.has(w.id)) glassWallIds.set(w.id, 'double-line');
  }

  // runs that now meet end to end through a door become one wall
  const merged: Run[] = [];
  const used = new Set<Run>();
  for (const r of accepted) {
    if (used.has(r)) continue;
    used.add(r);
    let cur = r;
    for (let grow = true; grow;) {
      grow = false;
      for (const o of accepted) {
        if (used.has(o)) continue;
        const u = unit(cur.a, cur.b), ou = unit(o.a, o.b);
        if (sinBetween(u, ou) > Math.sin(1.5 * Math.PI / 180)) continue;
        const n = { x: -u.y, y: u.x };
        if (Math.abs(dot(sub(o.a, cur.a), n)) > 1.5 || Math.abs(dot(sub(o.b, cur.a), n)) > 1.5) continue;
        const ta = dot(sub(o.a, cur.a), u), tb = dot(sub(o.b, cur.a), u);
        const lo = Math.min(ta, tb), hi = Math.max(ta, tb);
        if (lo > cur.len + 1.5 || hi < -1.5) continue;
        const nlo = Math.min(0, lo), nhi = Math.max(cur.len, hi);
        const shift = -nlo;
        const oFlip = ta > tb;
        const oOpen = o.openings.map((iv) => {
          const f = oFlip ? ta - iv.to : ta + iv.from, t = oFlip ? ta - iv.from : ta + iv.to;
          return { from: f + shift, to: t + shift };
        });
        cur = {
          ...cur,
          a: { x: cur.a.x + u.x * nlo, y: cur.a.y + u.y * nlo },
          b: { x: cur.a.x + u.x * nhi, y: cur.a.y + u.y * nhi },
          len: nhi - nlo,
          sep: Math.max(cur.sep, o.sep),
          ops: [...new Set([...cur.ops, ...o.ops])],
          openings: [...cur.openings.map((iv) => ({ from: iv.from + shift, to: iv.to + shift })), ...oOpen],
        };
        used.add(o);
        grow = true;
      }
    }
    merged.push(cur);
  }

  merged.sort((p, q) => Math.min(p.a.x, p.b.x) - Math.min(q.a.x, q.b.x) || Math.min(p.a.y, p.b.y) - Math.min(q.a.y, q.b.y));
  const partitions: GlassPartition[] = merged.map((r, i) => {
    const tM = Math.min(cfg.maxThicknessM, Math.max(cfg.minThicknessM, r.sep > 0 ? r.sep * mPerPt : cfg.defaultThicknessM));
    return {
      id: `gp_${i + 1}`,
      a: r.a,
      b: r.b,
      thicknessPt: tM / mPerPt,
      lengthM: r.len * mPerPt,
      thicknessM: tM,
      source: r.source,
      ...(r.label ? { label: r.label } : {}),
      openings: r.openings.map((o) => ({ from: Math.max(0, o.from), to: Math.min(r.len, o.to) })).filter((o) => o.to > o.from),
      sourceOperationIds: r.ops.slice(0, 64),
    };
  });

  return {
    partitions,
    glassWallIds: [...glassWallIds.keys()],
    glassWalls: [...glassWallIds].map(([id, source]) => ({ id, source })),
    styles,
    diagnostics: {
      lines: lines.length,
      legendEntries: styles.length,
      legendRuns: keyed.length,
      pairRuns: candidates.length,
      doorOpenings: openings.length,
      rejected,
    },
  };
}
