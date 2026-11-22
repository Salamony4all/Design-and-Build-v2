/**
 * Drawing scale (mm of building per PDF point) from the drawing's own evidence.
 *
 * 1. DIMENSION VOTE. Every dimension string ("3600", "28'-1\"") sits on a dimension
 *    line. For each string we collect the lengths it could be measuring: the parallel
 *    line segment under it, and the span between the nearest ticks / extension lines
 *    crossing that line on either side. value / length is a candidate scale. A wrong
 *    pairing gives a random ratio; the true scale is the one ratio that many
 *    different dimensions agree on.
 * 2. TITLE BLOCK. "1:50 @ A1", "SCALE 1:100", "1/8\" = 1'-0\"" give the plotted scale;
 *    with a true-size PDF, mm per point = N * 25.4 / 72.
 *
 * The vote wins when it is strong; a title-block scale within 1.5% snaps it to the
 * exact value. With no usable dimensions the title block alone is used when it is
 * unambiguous. No drawing-specific numbers are involved.
 */
import type { Vec2 } from './vector-device';

export interface ScaleSegment { a: Vec2; b: Vec2; len: number }

export interface ScaleText { text: string; x: number; y: number; w: number; h: number; size: number }

export interface ScaleEstimate {
  mmPerPt: number;
  source: 'dimension-vote' | 'dimension-vote+title' | 'title-block';
  /** distinct dimension strings agreeing on the scale (0 for title-block only) */
  votes: number;
  distinctValues: number;
  titleScales: number[];
}

const MM_PER_PT_AT_1_TO_1 = 25.4 / 72;

/** Parse a dimension string to millimetres, or null. */
export function parseDimensionMm(raw: string): number | null {
  const t = raw.trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (/^\d{3,5}$/.test(t)) {
    const v = parseInt(t, 10);
    return v >= 100 ? v : null;
  }
  // feet-inches: 28'-1"  8' - 11 1/8"  6' - 6"  12'
  const m = /^(\d{1,3})'\s*(?:-\s*)?(?:(\d{1,2})(?:\s+(\d{1,2})\/(\d{1,2}))?"?)?$/.exec(t);
  if (m) {
    const ft = parseInt(m[1]!, 10);
    const inch = m[2] ? parseInt(m[2], 10) : 0;
    const frac = m[3] && m[4] && parseInt(m[4], 10) > 0 ? parseInt(m[3], 10) / parseInt(m[4], 10) : 0;
    const mm = (ft * 12 + inch + frac) * 25.4;
    return mm >= 100 ? mm : null;
  }
  return null;
}

/** Plot scales named in the sheet text, as mm of building per PDF point. */
export function parseTitleScales(texts: ScaleText[], pageWidthPt: number, pageHeightPt: number): { all: number[]; forThisSheet?: number } {
  const all: number[] = [];
  let forThisSheet: number | undefined;
  const sheet = (() => {
    const long = Math.max(pageWidthPt, pageHeightPt), short = Math.min(pageWidthPt, pageHeightPt);
    const sizes: Record<string, [number, number]> = { A0: [3370, 2384], A1: [2384, 1684], A2: [1684, 1191], A3: [1191, 842], A4: [842, 595] };
    for (const [k, [l, s]] of Object.entries(sizes)) if (Math.abs(long - l) < 0.02 * l && Math.abs(short - s) < 0.02 * s) return k;
    return undefined;
  })();
  for (const t of texts) {
    const s = t.text;
    for (const m of s.matchAll(/\b1\s*:\s*(\d{1,4})\b(?:\s*@\s*(A[0-4]))?/gi)) {
      const n = parseInt(m[1]!, 10);
      if (![5, 10, 20, 25, 40, 50, 75, 100, 125, 150, 200, 250, 500].includes(n)) continue;
      const v = n * MM_PER_PT_AT_1_TO_1;
      all.push(v);
      if (m[2] && sheet && m[2].toUpperCase() === sheet) forThisSheet = v;
    }
    for (const m of s.matchAll(/(\d{1,2})(?:\s*\/\s*(\d{1,2}))?\s*"\s*=\s*1\s*'/g)) {
      const inches = parseInt(m[1]!, 10) / (m[2] ? parseInt(m[2], 10) : 1);
      if (inches > 0 && inches <= 3) all.push((12 / inches) * MM_PER_PT_AT_1_TO_1);
    }
  }
  return { all, forThisSheet };
}

interface AxisSeg { c: number; lo: number; hi: number } // c = fixed coordinate, lo..hi along the axis

export function estimateScale(texts: ScaleText[], segments: ScaleSegment[], pageWidthPt: number, pageHeightPt: number): ScaleEstimate | null {
  const title = parseTitleScales(texts, pageWidthPt, pageHeightPt);
  const titleScales = [...new Set(title.all.map((v) => +v.toFixed(4)))];

  // axis-aligned segments, indexed for both orientations
  const H: AxisSeg[] = [];
  const V: AxisSeg[] = [];
  const obliqueShort: ScaleSegment[] = [];
  for (const s of segments) {
    if (s.len < 1) continue;
    const dx = Math.abs(s.b.x - s.a.x), dy = Math.abs(s.b.y - s.a.y);
    if (dy <= 0.05 * dx) H.push({ c: (s.a.y + s.b.y) / 2, lo: Math.min(s.a.x, s.b.x), hi: Math.max(s.a.x, s.b.x) });
    else if (dx <= 0.05 * dy) V.push({ c: (s.a.x + s.b.x) / 2, lo: Math.min(s.a.y, s.b.y), hi: Math.max(s.a.y, s.b.y) });
    else if (s.len <= 40) obliqueShort.push(s);
  }
  H.sort((p, q) => p.c - q.c);
  V.sort((p, q) => p.c - q.c);
  // short oblique strokes (45-degree ticks), indexed by their across coordinate
  const tickByY: AxisSeg[] = obliqueShort.map((o) => ({ c: (o.a.y + o.b.y) / 2, lo: (o.a.x + o.b.x) / 2, hi: 0 })).sort((p, q) => p.c - q.c);
  const tickByX: AxisSeg[] = obliqueShort.map((o) => ({ c: (o.a.x + o.b.x) / 2, lo: (o.a.y + o.b.y) / 2, hi: 0 })).sort((p, q) => p.c - q.c);
  const range = (arr: AxisSeg[], lo: number, hi: number): AxisSeg[] => {
    let a = 0, b = arr.length;
    while (a < b) { const m = (a + b) >> 1; if (arr[m]!.c < lo) a = m + 1; else b = m; }
    const out: AxisSeg[] = [];
    for (let i = a; i < arr.length && arr[i]!.c <= hi; i++) out.push(arr[i]!);
    return out;
  };

  type Vote = { ratio: number; textIndex: number; value: number };
  const votes: Vote[] = [];
  texts.forEach((t, ti) => {
    const mm = parseDimensionMm(t.text);
    if (mm === null) return;
    const vertical = t.h > 1.5 * t.w;
    const size = Math.max(2, Math.min(t.size || Math.min(t.w, t.h), Math.min(t.w, t.h) || t.size));
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    // work in (along, across) where `along` runs with the text / dimension line
    const along = vertical ? cy : cx;
    const across = vertical ? cx : cy;
    const parallel = vertical ? V : H;      // dimension line candidates
    const crossing = vertical ? H : V;      // ticks / extension lines
    const half = (vertical ? t.h : t.w) / 2;
    const lines = range(parallel, across - 3 * size, across + 3 * size).filter((l) => l.lo <= along + half && l.hi >= along - half && l.hi - l.lo >= 4);
    const seen = new Set<string>();
    const push = (len: number) => {
      if (len < 4) return;
      const ratio = mm / len;
      if (ratio < 0.5 || ratio > 2000) return;
      const k = Math.round(Math.log(ratio) / 0.004).toString();
      if (seen.has(k)) return;
      seen.add(k);
      votes.push({ ratio, textIndex: ti, value: Math.round(mm) });
    };
    for (const l of lines) {
      push(l.hi - l.lo);
      // nearest crossings on either side of the text along this line
      let left = -Infinity, right = Infinity;
      for (const c of range(crossing, l.lo - 0.5, l.hi + 0.5)) {
        if (c.lo > l.c + 1 || c.hi < l.c - 1) continue; // must touch the dimension line
        if (c.c <= along && c.c > left) left = c.c;
        if (c.c >= along && c.c < right) right = c.c;
      }
      for (const o of range(vertical ? tickByX : tickByY, l.c - 1.5, l.c + 1.5)) {
        const al = o.lo;
        if (al < l.lo - 0.5 || al > l.hi + 0.5) continue;
        if (al <= along && al > left) left = al;
        if (al >= along && al < right) right = al;
      }
      if (Number.isFinite(left) && Number.isFinite(right)) push(right - left);
    }
  });

  // cluster the ratios: the true scale is the 1.2%-wide window most dimension strings agree on
  let best: { votes: number; distinct: number; ratios: number[] } | null = null;
  const sorted = votes.slice().sort((a, b) => a.ratio - b.ratio);
  for (let i = 0, j = 0; i < sorted.length; i++) {
    while (j < sorted.length && sorted[j]!.ratio <= sorted[i]!.ratio * 1.012) j++;
    const win = sorted.slice(i, j);
    const textsIn = new Set(win.map((v) => v.textIndex)).size;
    const valuesIn = new Set(win.map((v) => v.value)).size;
    if (!best || textsIn > best.votes || (textsIn === best.votes && valuesIn > best.distinct)) best = { votes: textsIn, distinct: valuesIn, ratios: win.map((v) => v.ratio) };
  }

  if (best && best.votes >= 4 && best.distinct >= 2) {
    const r = best.ratios.slice().sort((a, b) => a - b);
    const median = r[r.length >> 1]!;
    const snap = titleScales.find((s) => Math.abs(s - median) / s <= 0.015);
    return {
      mmPerPt: snap ?? median,
      source: snap ? 'dimension-vote+title' : 'dimension-vote',
      votes: best.votes,
      distinctValues: best.distinct,
      titleScales,
    };
  }
  const t = title.forThisSheet ?? (titleScales.length === 1 ? titleScales[0] : undefined);
  if (t) return { mmPerPt: t, source: 'title-block', votes: 0, distinctValues: 0, titleScales };
  return null;
}

/** Text lines (with boxes) out of a MuPDF structured-text JSON string. */
export function textsFromStructuredTextJson(json: string): ScaleText[] {
  const out: ScaleText[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const o = n as Record<string, any>;
    if (typeof o.text === 'string' && o.bbox && typeof o.bbox.x === 'number') {
      out.push({ text: o.text, x: o.bbox.x, y: o.bbox.y, w: o.bbox.w, h: o.bbox.h, size: typeof o.font?.size === 'number' ? o.font.size : 0 });
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  try { walk(JSON.parse(json)); } catch { /* no text layer */ }
  return out;
}
