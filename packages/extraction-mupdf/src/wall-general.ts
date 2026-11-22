/**
 * General wall detector (drawing-agnostic, deterministic).
 *
 * Whatever the drafting style, a wall in plan is a long BAND bounded by two parallel
 * faces a wall-thickness apart. The faces may be strokes (hollow double-line walls,
 * hatched walls) or the edges of a filled shape (solid poche). This module finds those
 * bands and keeps the ones that behave like a building:
 *
 *  1. FACES   every stroke and dark-fill edge, grouped by direction and merged into
 *             maximal lines.
 *  2. BANDS   pairs of faces 40-500 mm apart that overlap for at least 400 mm with no
 *             third line between them, a centre line apart (ladders such as stair treads and table rows
 *             are rejected: a line that is a face on both sides at the same spacing).
 *  3. POCHE   on the rendered page, is the inside of the band darker than what lies
 *             beside it? (solid fill, dense hatch, grey tone). Only judged when the
 *             band is at least 6 px wide in the render.
 *  4. SEEDS   if a substantial share of bands is poche, poche bands are the walls
 *             (furniture is outline-only or white-masked). Otherwise walls are the
 *             bands drawn with the dominant heavy pen at the recurring thicknesses.
 *  5. GROWTH  other bands join only through real junctions (L / T / collinear across
 *             a door-sized gap) and only if drawn at least as boldly as the seeds.
 *  6. NETWORK isolated bits are dropped; a wall system is a connected network in at
 *             least two directions.
 *
 * All sizes are in millimetres via the sheet's detected scale; no sheet-specific values.
 */
import type { Vec2 } from './vector-device';
import type { Seg } from './door-symbols';

export interface WallRaster {
  pxPerPt: number;
  width: number;
  height: number;
  /** luminance 0 (black) .. 1 (white) at pixel (xi, yi) */
  lum(xi: number, yi: number): number;
}

export interface GeneralWall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  length: number;
  /** how the band was recognised */
  kind: 'poche' | 'faces';
  /** direction in degrees, 0..179 */
  dir: number;
}

export interface GeneralWallOptions {
  minThicknessMm: number;
  maxThicknessMm: number;
  minLengthMm: number;
  /** inside must be at least this much darker than the lighter side (0..1) */
  pocheContrast: number;
  /** collinear bands across a gap up to this size belong to one wall line */
  maxOpeningMm: number;
}

export const GENERAL_WALL_DEFAULTS: GeneralWallOptions = {
  minThicknessMm: 40,
  maxThicknessMm: 500,
  minLengthMm: 400,
  pocheContrast: 0.12,
  maxOpeningMm: 1300,
};

interface Line { c: number; lo: number; hi: number; w: number }
interface Strip {
  dir: number; ux: number; uy: number;
  c: number; t: number; lo: number; hi: number;
  cls: 'poche' | 'pen' | 'edge';
  pen: number;
  li: string; lj: string;
  seed?: boolean;
  a: Vec2; b: Vec2;
}

const len = (s: Strip) => s.hi - s.lo;

function hashId(parts: Array<string | number>): string {
  const s = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `gw_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export function detectWallsGeneral(
  segs: Seg[],
  scaleMmPerPt: number,
  raster?: WallRaster,
  options: Partial<GeneralWallOptions> = {},
): GeneralWall[] {
  const o = { ...GENERAL_WALL_DEFAULTS, ...options };
  const S = scaleMmPerPt;
  if (!(S > 0)) return [];
  const tMin = o.minThicknessMm / S, tMax = o.maxThicknessMm / S, minLen = o.minLengthMm / S;

  // ---- 1. faces: eligible segments and the sheet's dominant directions
  type Item = { x1: number; y1: number; x2: number; y2: number; w: number; L: number; ang: number };
  const items: Item[] = [];
  const hist = new Map<number, number>();
  const minSeg = Math.max(1, 60 / S);
  for (const s of segs) {
    if (s.len < minSeg) continue;
    const darkFill = !!s.fill && (s.fillShade ?? 1) <= 0.9;
    if (!s.stroke && !darkFill) continue; // white masking fills are not drawn lines
    let ang = (Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180) / Math.PI;
    ang = ((ang % 180) + 180) % 180;
    items.push({ x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y, w: s.stroke ? s.w : -1, L: s.len, ang });
    const bin = Math.round(ang) % 180;
    hist.set(bin, (hist.get(bin) ?? 0) + s.len);
  }
  let total = 0;
  for (const v of hist.values()) total += v;
  const dirs: number[] = [];
  for (const [a, v] of [...hist.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])) {
    if (v < 0.04 * total) break;
    if (dirs.some((d) => Math.min(Math.abs(a - d), 180 - Math.abs(a - d)) <= 3)) continue;
    dirs.push(a);
  }

  // ---- 2. bands
  const strips: Strip[] = [];
  for (const d of dirs) {
    const th = (d * Math.PI) / 180, ux = Math.cos(th), uy = Math.sin(th);
    const lines: Line[] = [];
    for (const it of items) {
      if (Math.min(Math.abs(it.ang - d), 180 - Math.abs(it.ang - d)) > 1.5) continue;
      const a1 = it.x1 * ux + it.y1 * uy, a2 = it.x2 * ux + it.y2 * uy;
      const c = (-(it.x1 + it.x2) * uy + (it.y1 + it.y2) * ux) / 2;
      lines.push({ c, lo: Math.min(a1, a2), hi: Math.max(a1, a2), w: it.w });
    }
    // group lines that lie on the same axis (offsets within 0.3 pt), then join the
    // pieces of each group end to end
    lines.sort((p, q) => p.c - q.c || p.lo - q.lo);
    const merged: Line[] = [];
    const flush = (g: Line[]) => {
      g.sort((p, q) => p.lo - q.lo);
      let cur: Line | null = null;
      for (const l of g) {
        if (cur && l.lo - cur.hi <= 0.8) {
          if (l.hi - l.lo > cur.hi - cur.lo) cur.c = l.c;
          cur.hi = Math.max(cur.hi, l.hi);
          cur.w = Math.max(cur.w, l.w);
        } else {
          cur = { ...l };
          merged.push(cur);
        }
      }
    };
    let group: Line[] = [];
    for (const l of lines) {
      if (group.length && l.c - group[0]!.c > 0.3) { flush(group); group = []; }
      group.push(l);
    }
    if (group.length) flush(group);
    const faces = merged.filter((m) => m.hi - m.lo >= minLen * 0.5).sort((p, q) => p.c - q.c || p.lo - q.lo);
    const cs = faces.map((f) => f.c);
    const firstAbove = (v: number) => {
      let a = 0, b = cs.length;
      while (a < b) { const m = (a + b) >> 1; if (cs[m]! <= v) a = m + 1; else b = m; }
      return a;
    };
    for (let i = 0; i < faces.length; i++) {
      const li = faces[i]!;
      for (let j = firstAbove(li.c + tMin - 1e-6); j < faces.length; j++) {
        const lj = faces[j]!;
        const dd = lj.c - li.c;
        if (dd > tMax) break;
        const lo = Math.max(li.lo, lj.lo), hi = Math.min(li.hi, lj.hi);
        if (hi - lo < Math.max(minLen, 1.5 * dd)) continue;
        let blocked = false;
        for (let k = firstAbove(li.c + 0.4); k < j; k++) {
          const lk = faces[k]!;
          if (lk.c >= lj.c - 0.4) break;
          if (Math.min(hi, lk.hi) - Math.max(lo, lk.lo) >= 0.5 * (hi - lo)) {
            // a thin wall drawn with a centre line (glazed or cored partition) is still one wall
            if (dd * S <= 250 && Math.abs(lk.c - (li.c + lj.c) / 2) <= 0.12 * dd) continue;
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        const pw = Math.min(li.w, lj.w);
        const c = (li.c + lj.c) / 2;
        strips.push({
          dir: d, ux, uy, c, t: dd, lo, hi,
          cls: pw >= 0 ? 'pen' : 'edge', pen: Math.max(pw, 0),
          li: `${d}:${i}`, lj: `${d}:${j}`,
          a: { x: lo * ux - c * uy, y: lo * uy + c * ux },
          b: { x: hi * ux - c * uy, y: hi * uy + c * ux },
        });
      }
    }
  }
  if (!strips.length) return [];

  // ---- 3. poche test on the rendered page
  if (raster) {
    const r = raster.pxPerPt;
    const lum = (x: number, y: number) => {
      const xi = Math.floor(x * r), yi = Math.floor(y * r);
      return xi >= 0 && yi >= 0 && xi < raster.width && yi < raster.height ? raster.lum(xi, yi) : 1;
    };
    for (const s of strips) {
      if (s.t * r < 6) continue; // too thin in the render to tell the inside from its edges
      const n = Math.max(4, Math.floor((len(s) * r) / 2));
      const mean = (off: number) => {
        let tot = 0;
        for (let k = 0; k < n; k++) {
          const al = s.lo + ((k + 0.5) * len(s)) / n, ac = s.c + off;
          tot += lum(al * s.ux - ac * s.uy, al * s.uy + ac * s.ux);
        }
        return tot / n;
      };
      const off = Math.max(2 / r, 0.3 * s.t);
      const inside = (mean(0) + mean(-0.15 * s.t) + mean(0.15 * s.t)) / 3;
      const outside = Math.max(mean(-s.t / 2 - off), mean(s.t / 2 + off));
      if (outside - inside >= o.pocheContrast) s.cls = 'poche';
    }
  }

  // ---- ladders (stair treads, table rows): a line that is a face on both sides at the same spacing
  const use = new Map<string, { lo: Strip[]; hi: Strip[] }>();
  for (const s of strips) {
    if (s.cls === 'poche') continue;
    (use.get(s.li) ?? use.set(s.li, { lo: [], hi: [] }).get(s.li)!).lo.push(s);
    (use.get(s.lj) ?? use.set(s.lj, { lo: [], hi: [] }).get(s.lj)!).hi.push(s);
  }
  const ladder = new Set<Strip>();
  for (const u of use.values()) {
    for (const a of u.lo) for (const b of u.hi) {
      if (Math.abs(a.t - b.t) <= 0.15 * Math.max(a.t, b.t) &&
        Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) >= 0.5 * Math.min(len(a), len(b))) { ladder.add(a); ladder.add(b); }
    }
  }
  const cand = strips.filter((s) => !ladder.has(s));

  // ---- 4. seeds
  let Lpoche = 0, Ledge = 0;
  const Lpen = new Map<number, number>();
  const penKey = (p: number) => Math.round(p * 10) / 10;
  for (const s of cand) {
    if (s.cls === 'poche') Lpoche += len(s);
    else if (s.cls === 'edge') Ledge += len(s);
    else Lpen.set(penKey(s.pen), (Lpen.get(penKey(s.pen)) ?? 0) + len(s));
  }
  let totPen = 0;
  for (const v of Lpen.values()) totPen += v;
  let wMax = 0;
  for (const [p, v] of Lpen) if (v >= 0.05 * totPen && p > wMax) wMax = p;
  if (wMax <= 0) wMax = 1;
  const penScore = new Map<string, number>();
  for (const [p, v] of Lpen) penScore.set(`pen:${p}`, v * Math.min(1, p / wMax));
  if (Ledge) penScore.set('edge', Ledge);
  let bestPen = 0;
  for (const v of penScore.values()) bestPen = Math.max(bestPen, v);
  const pocheMode = Lpoche > 0 && Lpoche >= 0.25 * bestPen;
  const seedPens: number[] = [];
  let edgeSeed = false;
  if (!pocheMode) {
    for (const [k, v] of penScore) {
      if (v < 0.5 * bestPen) continue;
      if (k === 'edge') edgeSeed = true; else seedPens.push(Number(k.slice(4)));
    }
  }
  const inSeedClass = (s: Strip) =>
    s.cls === 'poche' ? pocheMode : s.cls === 'edge' ? edgeSeed : seedPens.includes(penKey(s.pen));
  // recurring thicknesses within the seed class (10 mm bins, neighbours pooled)
  const thk = new Map<number, number>();
  const tBin = (s: Strip) => Math.round((s.t * S) / 10);
  let thkTotal = 0;
  for (const s of cand) if (inSeedClass(s)) { thk.set(tBin(s), (thk.get(tBin(s)) ?? 0) + len(s)); thkTotal += len(s); }
  const good = new Set<number>();
  for (const b of thk.keys()) {
    if ((thk.get(b) ?? 0) + (thk.get(b - 1) ?? 0) + (thk.get(b + 1) ?? 0) >= 0.06 * thkTotal) good.add(b);
  }
  for (const s of cand) s.seed = inSeedClass(s) && (s.cls === 'poche' || good.has(tBin(s)));
  let maxGood = 0;
  for (const b of good) maxGood = Math.max(maxGood, b);
  const tCap = good.size ? (1.6 * maxGood * 10) / S : tMax;
  const growPen = pocheMode ? 0.6 * wMax : seedPens.length ? 0.5 * Math.min(...seedPens) : Infinity;
  const mayJoin = (s: Strip) => {
    if (s.cls === 'poche') return true;
    if (s.t > tCap) return false;
    if (s.cls === 'edge') return edgeSeed || pocheMode;
    return s.pen >= growPen;
  };

  // ---- 5. junction graph
  const doorMax = o.maxOpeningMm / S;
  const cell = Math.max(40, 3000 / S);
  const grid = new Map<string, number[]>();
  cand.forEach((s, i) => {
    const x0 = Math.min(s.a.x, s.b.x) - doorMax, x1 = Math.max(s.a.x, s.b.x) + doorMax;
    const y0 = Math.min(s.a.y, s.b.y) - doorMax, y1 = Math.max(s.a.y, s.b.y) + doorMax;
    for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
      for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) {
        const k = `${cx},${cy}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
      }
    }
  });
  const endNear = (e: Vec2, q: Strip, pad: number) => {
    const al = e.x * q.ux + e.y * q.uy, ac = -e.x * q.uy + e.y * q.ux;
    return al >= q.lo - pad && al <= q.hi + pad && Math.abs(ac - q.c) <= q.t / 2 + pad;
  };
  const touch = (p: Strip, q: Strip) => {
    if (p.dir === q.dir) {
      if (Math.abs(p.c - q.c) > 0.5 * Math.max(p.t, q.t)) return false;
      return Math.max(p.lo, q.lo) - Math.min(p.hi, q.hi) <= doorMax;
    }
    const pad = 0.75 * Math.min(p.t, q.t) + 1;
    return endNear(p.a, q, pad) || endNear(p.b, q, pad) || endNear(q.a, p, pad) || endNear(q.b, p, pad);
  };
  const adj: Array<Set<number>> = cand.map(() => new Set<number>());
  const seen = new Set<number>();
  const N = cand.length;
  for (const ids of grid.values()) {
    for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
      const i = ids[x]!, j = ids[y]!;
      const key = i * N + j;
      if (seen.has(key)) continue;
      seen.add(key);
      if (touch(cand[i]!, cand[j]!)) { adj[i]!.add(j); adj[j]!.add(i); }
    }
  }
  const acc = new Set<number>();
  cand.forEach((s, i) => { if (s.seed) acc.add(i); });
  const front = [...acc];
  while (front.length) {
    const i = front.pop()!;
    for (const j of adj[i]!) if (!acc.has(j) && mayJoin(cand[j]!)) { acc.add(j); front.push(j); }
  }

  // ---- 6. connected networks
  const parent = new Map<number, number>();
  for (const i of acc) parent.set(i, i);
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    while (parent.get(x)! !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; }
    return r;
  };
  for (const i of acc) for (const j of adj[i]!) if (acc.has(j) && find(i) !== find(j)) parent.set(find(i), find(j));
  const comps = new Map<number, number[]>();
  for (const i of acc) { const r = find(i); (comps.get(r) ?? comps.set(r, []).get(r)!).push(i); }
  let biggest = 0;
  const compLen = new Map<number, number>();
  for (const [r, ids] of comps) {
    const L = ids.reduce((t, i) => t + len(cand[i]!), 0);
    compLen.set(r, L);
    biggest = Math.max(biggest, L);
  }
  const keep: Strip[] = [];
  for (const [r, ids] of comps) {
    const L = compLen.get(r)!;
    if (!(L >= 0.12 * biggest || L * S >= 15000)) continue;
    if (ids.length < 3 || new Set(ids.map((i) => cand[i]!.dir)).size < 2) continue;
    for (const i of ids) keep.push(cand[i]!);
  }

  // ---- finish: drop near-duplicates, close corners, emit
  keep.sort((p, q) => p.dir - q.dir || p.c - q.c || p.lo - q.lo);
  const finalStrips: Strip[] = [];
  for (const s of keep) {
    const dup = finalStrips.find(
      (f) => f.dir === s.dir && Math.abs(f.c - s.c) < 0.5 * Math.min(f.t, s.t) &&
        Math.min(f.hi, s.hi) - Math.max(f.lo, s.lo) > 0.5 * Math.min(len(f), len(s)),
    );
    if (dup) {
      if (len(s) > len(dup)) { dup.lo = Math.min(dup.lo, s.lo); dup.hi = Math.max(dup.hi, s.hi); }
      continue;
    }
    finalStrips.push({ ...s });
  }
  // a band ends where its shorter face ends, one thickness short of the corner:
  // run each end on to the centreline of the wall it meets
  for (const s of finalStrips) {
    for (const end of ['lo', 'hi'] as const) {
      const al = s[end];
      const e = { x: al * s.ux - s.c * s.uy, y: al * s.uy + s.c * s.ux };
      let best: number | null = null;
      for (const q of finalStrips) {
        if (q === s || q.dir === s.dir) continue;
        if (!endNear(e, q, 0.75 * Math.min(s.t, q.t) + 1 + q.t / 2)) continue;
        // along-s coordinate of q's centreline
        const cross = s.ux * q.uy - s.uy * q.ux; // sin of the angle between them
        if (Math.abs(cross) < 0.3) continue;
        // point on q's centreline: P = q.c * (-q.uy, q.ux) + k * (q.ux, q.uy); solve for the along-s value where s's centreline meets it
        const px = -q.c * q.uy, py = q.c * q.ux;
        const sx = -s.c * s.uy, sy = s.c * s.ux;
        // s line: (sx, sy) + m * (s.ux, s.uy); q line: (px, py) + k * (q.ux, q.uy)
        const m = ((px - sx) * q.uy - (py - sy) * q.ux) / cross;
        if (Math.abs(m - al) <= q.t + s.t && (best === null || Math.abs(m - al) < Math.abs(best - al))) best = m;
      }
      if (best !== null) s[end] = best;
    }
  }
  const out: GeneralWall[] = [];
  for (const s of finalStrips) {
    if (s.hi - s.lo < minLen * 0.5) continue;
    const a = { x: s.lo * s.ux - s.c * s.uy, y: s.lo * s.uy + s.c * s.ux };
    const b = { x: s.hi * s.ux - s.c * s.uy, y: s.hi * s.uy + s.c * s.ux };
    out.push({
      id: hashId([s.dir, s.c.toFixed(2), s.lo.toFixed(2), s.hi.toFixed(2), s.t.toFixed(2)]),
      a, b, thickness: s.t, length: s.hi - s.lo,
      kind: s.cls === 'poche' ? 'poche' : 'faces',
      dir: s.dir,
    });
  }
  out.sort((p, q) => p.a.y - q.a.y || p.a.x - q.a.x || p.id.localeCompare(q.id));
  return out;
}
