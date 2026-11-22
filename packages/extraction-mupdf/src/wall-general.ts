/**
 * General wall detector (drawing-agnostic, deterministic).
 *
 * Whatever the drafting style, a wall in plan is a long BAND bounded by two parallel
 * faces a wall-thickness apart. The faces may be strokes (hollow double-line walls,
 * hatched walls, compound walls drawn with their layers) or the edges of a filled shape
 * (solid poche). This module finds those bands and keeps the ones that behave like a
 * building:
 *
 *  1. FACES   every stroke and dark-fill edge in each direction carrying at least 1% of
 *             the sheet's linework (so splayed and chamfered walls count), merged into
 *             maximal lines.
 *  2. BANDS   pairs of faces 40-500 mm apart that overlap for at least 400 mm with no
 *             third line between them, except a centre line or layer lines drawn
 *             lighter than both faces (compound walls). Ladders (stair treads, table
 *             rows: a line that is a face on both sides at the same spacing) and bands
 *             lying along a door leaf are rejected.
 *  3. POCHE   the inside of the band is darker than what lies beside it on the rendered
 *             page, or carries diagonal hatch strokes spanning it.
 *  4. SEEDS   poche bands, and bands of every pen class carrying at least half the
 *             evidence of the strongest class, at the recurring thicknesses. A sheet may
 *             mix styles (masonry poche beside hollow stud walls); no class excludes
 *             another.
 *  5. GROWTH  other bands join only through real junctions: L / T, collinear across a
 *             door-sized gap, a column both walls stop at, or a door symbol whose two
 *             jambs they carry; and only if drawn at least as boldly as the seeds.
 *  6. NETWORK isolated bits are dropped; a wall system is a connected network in at
 *             least two directions. The sheet border is never part of it.
 *  7. DOORS   a wall runs on through its doors; a door with no wall on its own line
 *             gets the wall piece the width of its opening (the header above it).
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
  /** how the band was recognised; 'opening' = the wall piece spanning a door opening
   *  that has no wall drawn on its own line (the header above the door) */
  kind: 'poche' | 'faces' | 'opening';
  /** direction in degrees, 0..179 */
  dir: number;
  /** one face looks out of the building: rays from it meet no other wall */
  exterior: boolean;
  /** windows in this wall, measured along it from a (pt) */
  windows?: Array<{ from: number; to: number }>;
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

/** A door opening (hinge -> closed jamb) found from its drawn symbol. */
export interface WallOpening {
  a: Vec2;
  b: Vec2;
  /** the drawn leaf (hinge -> free end); a band along it is the door, not a wall */
  leaf?: { a: Vec2; b: Vec2 };
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
  cls: 'poche' | 'pen' | 'edge' | 'opening';
  pen: number;
  /** pens of the low-c and high-c faces (-1: a fill edge) */
  wA: number; wB: number;
  li: string; lj: string;
  seed?: boolean;
  a: Vec2; b: Vec2;
  /** windows, as absolute along-coordinates */
  windows?: Win[];
}
/** a window along a strip; `outside`: shown only by lines where the faces stop, so a
 * window only if the wall looks out of the building there */
interface Win { lo: number; hi: number; outside?: boolean }

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
  options: Partial<GeneralWallOptions> & { openings?: WallOpening[] } = {},
  diag?: Record<string, unknown>,
): GeneralWall[] {
  const o = { ...GENERAL_WALL_DEFAULTS, ...options };
  const openings = options.openings ?? [];
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
    // diagonal walls are a small share of a sheet's linework: keep any direction holding
    // at least 1% of it (hatching that this admits is removed as ladders)
    if (v < 0.01 * total) break;
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
            // a compound wall drawn with all its layers: lines clearly lighter than both
            // faces are layer lines (veneer, insulation, lining), not faces of another wall
            if (lk.w >= 0 && li.w > 0 && lj.w > 0 && lk.w < 0.75 * Math.min(li.w, lj.w)) continue;
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        const pw = Math.min(li.w, lj.w);
        const c = (li.c + lj.c) / 2;
        strips.push({
          dir: d, ux, uy, c, t: dd, lo, hi,
          cls: pw >= 0 ? 'pen' : 'edge', pen: Math.max(pw, 0), wA: li.w, wB: lj.w,
          li: `${d}:${i}`, lj: `${d}:${j}`,
          a: { x: lo * ux - c * uy, y: lo * uy + c * ux },
          b: { x: hi * ux - c * uy, y: hi * uy + c * ux },
        });
      }
    }
  }
  // a door leaf drawn as a narrow rectangle is a band too: drop bands lying along a leaf
  const leaves = openings.filter((op) => op.leaf).map((op) => op.leaf!);
  if (leaves.length) {
    const sin5 = Math.sin((5 * Math.PI) / 180);
    const alongLeaf = (st: Strip) => leaves.some((lf) => {
      const lx = lf.b.x - lf.a.x, ly = lf.b.y - lf.a.y, ll = Math.hypot(lx, ly);
      if (ll < 1e-6 || Math.abs(st.ux * ly - st.uy * lx) / ll > sin5) return false;
      const acA = -lf.a.x * st.uy + lf.a.y * st.ux, acB = -lf.b.x * st.uy + lf.b.y * st.ux;
      if (Math.max(Math.abs(acA - st.c), Math.abs(acB - st.c)) > st.t + 1) return false;
      const alA = lf.a.x * st.ux + lf.a.y * st.uy, alB = lf.b.x * st.ux + lf.b.y * st.uy;
      return st.lo >= Math.min(alA, alB) - st.t - 1 && st.hi <= Math.max(alA, alB) + st.t + 1;
    });
    for (let i = strips.length - 1; i >= 0; i--) if (alongLeaf(strips[i]!)) strips.splice(i, 1);
  }
  if (!strips.length) return [];

  // ---- 3. poche test on the rendered page
  // how much darker the inside of a band is than the paper beside it, over [lo, hi]
  const pocheContrastOf = (s: { ux: number; uy: number; c: number; t: number }, lo: number, hi: number): number | null => {
    if (!raster) return null;
    const r = raster.pxPerPt;
    if (s.t * r < 6) return null; // too thin in the render to tell the inside from its edges
    const lum = (x: number, y: number) => {
      const xi = Math.floor(x * r), yi = Math.floor(y * r);
      return xi >= 0 && yi >= 0 && xi < raster.width && yi < raster.height ? raster.lum(xi, yi) : 1;
    };
    const n = Math.max(4, Math.floor(((hi - lo) * r) / 2));
    const mean = (off: number) => {
      let tot = 0;
      for (let k = 0; k < n; k++) {
        const al = lo + ((k + 0.5) * (hi - lo)) / n, ac = s.c + off;
        tot += lum(al * s.ux - ac * s.uy, al * s.uy + ac * s.ux);
      }
      return tot / n;
    };
    const off = Math.max(2 / r, 0.3 * s.t);
    const inside = (mean(0) + mean(-0.15 * s.t) + mean(0.15 * s.t)) / 3;
    const outside = Math.max(mean(-s.t / 2 - off), mean(s.t / 2 + off));
    return outside - inside;
  };
  for (const s of strips) {
    const k = pocheContrastOf(s, s.lo, s.hi);
    if (k !== null && k >= o.pocheContrast) s.cls = 'poche';
  }
  // the same, robust to lines drawn along the band (a window's frame and glass): the
  // median over many lines of samples across the band
  const solidContrastOf = (s: { ux: number; uy: number; c: number; t: number }, lo: number, hi: number): number | null => {
    if (!raster) return null;
    const r = raster.pxPerPt;
    if (s.t * r < 6) return null;
    const lum = (x: number, y: number) => {
      const xi = Math.floor(x * r), yi = Math.floor(y * r);
      return xi >= 0 && yi >= 0 && xi < raster.width && yi < raster.height ? raster.lum(xi, yi) : 1;
    };
    const n = Math.max(4, Math.floor(((hi - lo) * r) / 2));
    const mean = (off: number) => {
      let tot = 0;
      for (let k = 0; k < n; k++) {
        const al = lo + ((k + 0.5) * (hi - lo)) / n, ac = s.c + off;
        tot += lum(al * s.ux - ac * s.uy, al * s.uy + ac * s.ux);
      }
      return tot / n;
    };
    const ins: number[] = [];
    for (let k = -4; k <= 4; k++) ins.push(mean((k / 4) * 0.35 * s.t));
    ins.sort((x, y) => x - y);
    const off = Math.max(2 / r, 0.3 * s.t);
    return Math.max(mean(-s.t / 2 - off), mean(s.t / 2 + off)) - ins[4]!;
  };

  let hatchedOver: (st: { ux: number; uy: number; c: number; t: number }, lo: number, hi: number) => boolean = () => false;
  // ---- hatched poche: diagonal hatch strokes spanning the band (masonry, concrete,
  // insulated walls drawn with hatching too sparse for the raster test). Shelving and
  // lockers have perpendicular divisions, not diagonal ones, so they do not count.
  {
    const hcell = Math.max(4, tMax);
    const hgrid = new Map<string, Seg[]>();
    for (const sg of segs) {
      if (!sg.stroke || sg.len > 2 * tMax || sg.len < 0.2 * tMin) continue;
      const k = `${Math.floor((sg.a.x + sg.b.x) / 2 / hcell)},${Math.floor((sg.a.y + sg.b.y) / 2 / hcell)}`;
      (hgrid.get(k) ?? hgrid.set(k, []).get(k)!).push(sg);
    }
    const cosLo = Math.cos((65 * Math.PI) / 180), cosHi = Math.cos((25 * Math.PI) / 180);
    hatchedOver = (st, lo, hi) => {
      const p0 = { x: lo * st.ux - st.c * st.uy, y: lo * st.uy + st.c * st.ux };
      const p1 = { x: hi * st.ux - st.c * st.uy, y: hi * st.uy + st.c * st.ux };
      const x0 = Math.min(p0.x, p1.x) - st.t, x1 = Math.max(p0.x, p1.x) + st.t;
      const y0 = Math.min(p0.y, p1.y) - st.t, y1 = Math.max(p0.y, p1.y) + st.t;
      let n = 0;
      for (let cx = Math.floor(x0 / hcell); cx <= Math.floor(x1 / hcell); cx++) {
        for (let cy = Math.floor(y0 / hcell); cy <= Math.floor(y1 / hcell); cy++) {
          for (const sg of hgrid.get(`${cx},${cy}`) ?? []) {
            const ac1 = -sg.a.x * st.uy + sg.a.y * st.ux - st.c, ac2 = -sg.b.x * st.uy + sg.b.y * st.ux - st.c;
            if (Math.max(Math.abs(ac1), Math.abs(ac2)) > st.t / 2 + 0.3 || Math.abs(ac2 - ac1) < 0.5 * st.t) continue;
            const al1 = sg.a.x * st.ux + sg.a.y * st.uy, al2 = sg.b.x * st.ux + sg.b.y * st.uy;
            if (Math.min(al1, al2) < lo || Math.max(al1, al2) > hi) continue;
            const cosA = Math.abs(((sg.b.x - sg.a.x) * st.ux + (sg.b.y - sg.a.y) * st.uy) / sg.len);
            if (cosA < cosLo || cosA > cosHi) continue;
            n++;
          }
        }
      }
      return n >= 3 && n * st.t >= 0.5 * (hi - lo);
    };
    for (const st of strips) {
      if (st.cls === 'poche') continue;
      if (hatchedOver(st, st.lo, st.hi)) st.cls = 'poche';
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
  // A sheet may mix drafting styles (poche masonry beside hollow stud walls), so no
  // class excludes another: poche bands always seed, and every pen (or fill-edge)
  // class seeds when it carries at least half the evidence of the strongest class.
  const ref = Math.max(bestPen, Lpoche);
  const pocheMode = Lpoche > 0 && Lpoche >= 0.25 * bestPen;
  const seedPens: number[] = [];
  let edgeSeed = false;
  for (const [k, v] of penScore) {
    if (v < 0.5 * ref) continue;
    if (k === 'edge') edgeSeed = true; else seedPens.push(Number(k.slice(4)));
  }
  const inSeedClass = (s: Strip) =>
    s.cls === 'poche' ? true : s.cls === 'edge' ? edgeSeed : seedPens.includes(penKey(s.pen));
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
  const growPen = seedPens.length ? 0.5 * Math.min(...seedPens) : 0.6 * wMax;
  if (diag) {
    diag.dirs = dirs;
    diag.strips = strips.length;
    diag.ladders = ladder.size;
    diag.pocheM = Math.round((Lpoche * S) / 1000);
    diag.edgeM = Math.round((Ledge * S) / 1000);
    diag.penM = [...Lpen].map(([p, v]) => [p, Math.round((v * S) / 1000)]);
    diag.pocheMode = pocheMode;
    diag.seedPens = seedPens;
    diag.edgeSeed = edgeSeed;
    diag.goodThicknessMm = [...good].sort((a, b) => a - b).map((b) => b * 10);
  }
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
  // A door opening joins the wall pieces at its two jambs: walls run on through their
  // doors, so a piece standing between two doors still belongs to the network.
  const nearIds = (p: Vec2) => grid.get(`${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`) ?? [];
  // a door hinge may sit on a jamb return or frame a little outside the wall face
  const jambReach = Math.max(1.5, 250 / S);
  const jambPad = (q: Strip) => 0.5 * q.t + jambReach;
  const connectAll = (ids: number[]) => {
    for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
      const i = ids[x]!, j = ids[y]!;
      if (i !== j) { adj[i]!.add(j); adj[j]!.add(i); }
    }
  };
  // Columns: small closed outlines (circle, square; 150-1200 mm) at which walls stop.
  // Walls ending at the same column are joined through it.
  const columns: Array<{ c: Vec2; r: number; ids: number[] }> = [];
  {
    const colMax = 1200 / S, colMin = 150 / S;
    const keyOf = (p: Vec2) => `${Math.round(p.x * 20)},${Math.round(p.y * 20)}`;
    const up = new Map<string, string>();
    const root = (k: string): string => {
      let r = k;
      while (up.get(r)! !== r) r = up.get(r)!;
      let x = k;
      while (up.get(x)! !== r) { const n = up.get(x)!; up.set(x, r); x = n; }
      return r;
    };
    const shortSegs = segs.filter((sg) => sg.len <= colMax && (sg.stroke || sg.fill));
    for (const sg of shortSegs) {
      const ka = keyOf(sg.a), kb = keyOf(sg.b);
      if (!up.has(ka)) up.set(ka, ka);
      if (!up.has(kb)) up.set(kb, kb);
      const ra = root(ka), rb = root(kb);
      if (ra !== rb) up.set(ra, rb);
    }
    const groups = new Map<string, { segs: Seg[]; deg: Map<string, number> }>();
    for (const sg of shortSegs) {
      const r = root(keyOf(sg.a));
      const g = groups.get(r) ?? groups.set(r, { segs: [], deg: new Map() }).get(r)!;
      g.segs.push(sg);
      for (const k of [keyOf(sg.a), keyOf(sg.b)]) g.deg.set(k, (g.deg.get(k) ?? 0) + 1);
    }
    for (const g of groups.values()) {
      if (g.segs.length < 3) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, tot = 0;
      for (const sg of g.segs) {
        x0 = Math.min(x0, sg.a.x, sg.b.x); x1 = Math.max(x1, sg.a.x, sg.b.x);
        y0 = Math.min(y0, sg.a.y, sg.b.y); y1 = Math.max(y1, sg.a.y, sg.b.y);
        tot += sg.len;
      }
      const big = Math.max(x1 - x0, y1 - y0), small = Math.min(x1 - x0, y1 - y0);
      if (big < colMin || big > colMax || small < 0.6 * big || tot < 2.9 * big) continue;
      if ([...g.deg.values()].some((d) => d % 2 !== 0)) continue; // closed outline only
      columns.push({ c: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, r: big / 2, ids: [] });
    }
    for (const col of columns) {
      col.ids = nearIds(col.c).filter((i) => {
        const q = cand[i]!;
        // walls stop at the outline or within about one column radius of it (flared or
        // chamfered connections)
        return [q.a, q.b].some((e) => Math.hypot(e.x - col.c.x, e.y - col.c.y) <= col.r + 0.5 * q.t + Math.max(jambReach, col.r));
      });
      connectAll(col.ids);
    }
  }
  // the two leaves of a double door meet at their closed ends: one opening, jamb to jamb
  const doorOpenings: WallOpening[] = [];
  {
    const used = new Set<number>();
    for (let i = 0; i < openings.length; i++) {
      if (used.has(i)) continue;
      const p = openings[i]!;
      const lp = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) || 1;
      let paired = false;
      for (let j = i + 1; j < openings.length && !paired; j++) {
        if (used.has(j)) continue;
        const q = openings[j]!;
        const lq = Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) || 1;
        const dot = ((p.b.x - p.a.x) * (q.b.x - q.a.x) + (p.b.y - p.a.y) * (q.b.y - q.a.y)) / (lp * lq);
        if (dot < -0.9 && Math.hypot(p.b.x - q.b.x, p.b.y - q.b.y) <= Math.max(2, 0.2 * Math.min(lp, lq))) {
          doorOpenings.push({ a: p.a, b: q.a });
          used.add(j);
          paired = true;
        }
      }
      if (!paired) doorOpenings.push(p);
    }
  }
  const atJamb = (p: Vec2) => {
    const ids = nearIds(p).filter((i) => endNear(p, cand[i]!, jambPad(cand[i]!)));
    for (const col of columns) if (Math.hypot(p.x - col.c.x, p.y - col.c.y) <= col.r + jambReach) ids.push(...col.ids);
    return ids;
  };
  for (const op of doorOpenings) {
    const atA = atJamb(op.a), atB = atJamb(op.b);
    for (const i of atA) for (const j of atB) if (i !== j) { adj[i]!.add(j); adj[j]!.add(i); }
  }
  // ---- the sheet border: long bands hugging the sheet edges on three or four sides,
  // together with whatever hangs off them (title-block bars), are the drawing frame. A
  // tightly cropped plan has its outer walls at the sheet edges too, but they are joined
  // to walls that carry doors; a frame never is.
  const excluded = new Set<number>();
  {
    let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
    for (const sg of segs) {
      X0 = Math.min(X0, sg.a.x, sg.b.x); X1 = Math.max(X1, sg.a.x, sg.b.x);
      Y0 = Math.min(Y0, sg.a.y, sg.b.y); Y1 = Math.max(Y1, sg.a.y, sg.b.y);
    }
    const W = X1 - X0, H = Y1 - Y0;
    const sides = new Map<number, string>();
    cand.forEach((st, i) => {
      const horiz = Math.min(st.dir, 180 - st.dir) <= 2, vert = Math.abs(st.dir - 90) <= 2;
      if (!horiz && !vert) return;
      if (len(st) < 0.75 * (horiz ? W : H)) return;
      const mid = horiz ? (st.a.y + st.b.y) / 2 : (st.a.x + st.b.x) / 2;
      const m = 0.03 * (horiz ? H : W);
      const side = horiz ? (mid - Y0 <= m ? 'top' : Y1 - mid <= m ? 'bottom' : '') : (mid - X0 <= m ? 'left' : X1 - mid <= m ? 'right' : '');
      if (side) sides.set(i, side);
    });
    if (new Set(sides.values()).size >= 3) {
      const comp = new Set<number>(sides.keys());
      const stack = [...comp];
      while (stack.length) {
        const i = stack.pop()!;
        for (const j of adj[i]!) if (!comp.has(j)) { comp.add(j); stack.push(j); }
      }
      const carriesDoor = [...comp].some((i) => doorOpenings.some((op) => endNear(op.a, cand[i]!, jambPad(cand[i]!)) || endNear(op.b, cand[i]!, jambPad(cand[i]!))));
      if (!carriesDoor) for (const i of comp) excluded.add(i);
    }
  }
  const acc = new Set<number>();
  cand.forEach((s, i) => { if (s.seed && !excluded.has(i)) acc.add(i); });
  const front = [...acc];
  while (front.length) {
    const i = front.pop()!;
    for (const j of adj[i]!) if (!acc.has(j) && !excluded.has(j) && mayJoin(cand[j]!)) { acc.add(j); front.push(j); }
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

  if (diag && diag.wantStrips) {
    const keptSet = new Set(keep);
    const accSet = new Set([...acc].map((i) => cand[i]!));
    diag.stripList = strips.map((st) => ({
      dir: st.dir, c: +st.c.toFixed(2), t: +st.t.toFixed(2), lo: +st.lo.toFixed(2), hi: +st.hi.toFixed(2),
      cls: st.cls, pen: st.pen, ladder: ladder.has(st), seed: !!st.seed, acc: accSet.has(st), kept: keptSet.has(st),
    }));
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
      // the longer band is the wall (the shorter one pairs a face with a line of a
      // window or a fitting drawn against it): keep its faces, over both extents
      // of two about as long, the one whose faces are both drawn in the heavier pen
      const fw = (x: Strip) => Math.min(x.wA < 0 ? 1 : x.wA, x.wB < 0 ? 1 : x.wB);
      const sWins = len(s) > 1.1 * len(dup) || (len(dup) <= 1.1 * len(s) && (fw(s) > fw(dup) || (fw(s) === fw(dup) && len(s) > len(dup))));
      if (sWins) Object.assign(dup, { ...s, lo: Math.min(dup.lo, s.lo), hi: Math.max(dup.hi, s.hi) });
      else { dup.lo = Math.min(dup.lo, s.lo); dup.hi = Math.max(dup.hi, s.hi); }
      continue;
    }
    finalStrips.push({ ...s });
  }
  // a layer band lying inside a thicker accepted wall (a compound wall drawn with its
  // layers) is part of that wall
  for (let i = finalStrips.length - 1; i >= 0; i--) {
    const s = finalStrips[i]!;
    const inside = finalStrips.some(
      (f) => f !== s && f.dir === s.dir && f.t > s.t &&
        Math.abs(f.c - s.c) + s.t / 2 <= f.t / 2 + 0.5 &&
        Math.min(f.hi, s.hi) - Math.max(f.lo, s.lo) >= 0.8 * len(s),
    );
    if (inside) finalStrips.splice(i, 1);
  }
  // layer bands drawn side by side (a wall whose layers are all drawn with the same pen)
  // abut along their length: they are one wall from the outer face of one to the outer
  // face of the other
  const abutGap = Math.max(0.5, 50 / S);
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < finalStrips.length; i++) {
      for (let j = i + 1; j < finalStrips.length; j++) {
        const p = finalStrips[i]!, q = finalStrips[j]!;
        if (p.dir !== q.dir) continue;
        const gap = Math.abs(p.c - q.c) - (p.t + q.t) / 2;
        if (gap < -0.5 || gap > abutGap) continue;
        // layers run along the whole wall; a short band against a long wall is something
        // drawn against it (a fitting, a sill), not one of its layers
        const ov = Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo);
        if (ov < 0.8 * Math.min(len(p), len(q)) || ov < 0.5 * Math.max(len(p), len(q))) continue;
        const f0 = Math.min(p.c - p.t / 2, q.c - q.t / 2), f1 = Math.max(p.c + p.t / 2, q.c + q.t / 2);
        if (f1 - f0 > tMax) continue;
        const keepP = len(p) >= len(q) ? p : q;
        const wA = p.c - p.t / 2 <= q.c - q.t / 2 ? p.wA : q.wA, wB = p.c + p.t / 2 >= q.c + q.t / 2 ? p.wB : q.wB;
        p.wA = wA;
        p.wB = wB;
        p.c = (f0 + f1) / 2;
        p.t = f1 - f0;
        p.lo = keepP.lo;
        p.hi = keepP.hi;
        if (q.cls === 'poche') p.cls = 'poche';
        finalStrips.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  // ---- doors: a wall runs on through its doors. An opening whose wall is drawn
  // stopping at the jambs extends that wall across it (pieces on both sides become one
  // wall); an opening with no wall on its own line (set across a corner, in a splayed
  // vestibule, between two wall ends or columns) gets a wall piece the width of the
  // opening (the header above the door), at the thickness of the walls it connects.
  const sin12 = Math.sin((12 * Math.PI) / 180);
  const removed = new Set<Strip>();
  const openingStrips: Strip[] = [];
  for (const op of doorOpenings) {
    const L = Math.hypot(op.b.x - op.a.x, op.b.y - op.a.y);
    if (L < 1e-6) continue;
    const ux = (op.b.x - op.a.x) / L, uy = (op.b.y - op.a.y) / L;
    let inside = false;
    const touchT: number[] = [];
    const coll: Strip[] = [];
    for (const q of finalStrips) {
      if (removed.has(q)) continue;
      if (endNear(op.a, q, jambPad(q)) || endNear(op.b, q, jambPad(q))) touchT.push(q.t);
      if (Math.abs(q.ux * uy - q.uy * ux) > sin12) continue;
      const across = (p: Vec2) => Math.abs(-p.x * q.uy + p.y * q.ux - q.c);
      // the hinge end is exact; the other end may drift by the 12 degree tolerance
      const lim = q.t / 2 + Math.max(1.5, 0.35 * q.t);
      if (across(op.a) > lim || across(op.b) > lim + sin12 * L) continue;
      const aa = op.a.x * q.ux + op.a.y * q.uy, ab = op.b.x * q.ux + op.b.y * q.uy;
      const lo = Math.min(aa, ab), hi = Math.max(aa, ab);
      if (lo >= q.lo - 0.5 && hi <= q.hi + 0.5) { inside = true; break; }
      if (Math.max(0, q.lo - hi, lo - q.hi) <= 0.25 * L + q.t) coll.push(q);
    }
    if (inside) continue;
    if (coll.length) {
      coll.sort((x, y) => len(y) - len(x));
      const base = coll[0]!;
      const aa = op.a.x * base.ux + op.a.y * base.uy, ab = op.b.x * base.ux + op.b.y * base.uy;
      base.lo = Math.min(base.lo, aa, ab);
      base.hi = Math.max(base.hi, aa, ab);
      for (const q of coll.slice(1)) {
        if (q.dir !== base.dir || Math.abs(q.c - base.c) > 0.5 * Math.max(q.t, base.t)) continue;
        base.lo = Math.min(base.lo, q.lo);
        base.hi = Math.max(base.hi, q.hi);
        removed.add(q);
      }
      continue;
    }
    for (const col of columns) {
      if ([op.a, op.b].some((e) => Math.hypot(e.x - col.c.x, e.y - col.c.y) <= col.r + jambReach)) {
        for (const i of col.ids) if (acc.has(i)) touchT.push(cand[i]!.t);
      }
    }
    if (!touchT.length) continue;
    touchT.sort((x, y) => x - y);
    const t = touchT[touchT.length >> 1]!;
    const c = -op.a.x * uy + op.a.y * ux;
    const lo = op.a.x * ux + op.a.y * uy;
    let dir = Math.round((Math.atan2(uy, ux) * 180) / Math.PI);
    dir = ((dir % 180) + 180) % 180;
    openingStrips.push({
      dir, ux, uy, c, t, lo, hi: lo + L, cls: 'opening', pen: 0, wA: 0, wB: 0, li: 'opening', lj: 'opening',
      a: op.a, b: op.b,
    });
  }
  for (let i = finalStrips.length - 1; i >= 0; i--) if (removed.has(finalStrips[i]!)) finalStrips.splice(i, 1);
  // ---- windows. A window is an opening in a wall line, 300 mm to 6 m wide, closed at both
  // ends by jambs (lines across the wall), not a door, and glazed: lines along the wall
  // span it from jamb to jamb inside the wall's thickness (glass, frame) and stop there,
  // or - in an outside wall only - lighter lines run across it where the wall's own faces
  // stop (sill and frame drawn on the faces). A wall drawn solid is not solid across it.
  // The opening shows in one of three ways, and in each the wall runs on through the
  // window: a band of its own drawn lighter than the wall pieces beside it; a gap between
  // two wall pieces; a break in the wall's own faces or in its solid fill. No style, pen or
  // label is assumed; sizes are in millimetres.
  {
    const minWin = 300 / S, maxWin = 6000 / S;
    const wCell = Math.max(8, 1500 / S);
    const wGrid = new Map<string, Seg[]>();
    for (const sg of segs) {
      if (sg.len < 0.15) continue;
      for (let cx = Math.floor(Math.min(sg.a.x, sg.b.x) / wCell); cx <= Math.floor(Math.max(sg.a.x, sg.b.x) / wCell); cx++) {
        for (let cy = Math.floor(Math.min(sg.a.y, sg.b.y) / wCell); cy <= Math.floor(Math.max(sg.a.y, sg.b.y) / wCell); cy++) {
          const k = `${cx},${cy}`;
          (wGrid.get(k) ?? wGrid.set(k, []).get(k)!).push(sg);
        }
      }
    }
    type Band = { ux: number; uy: number; c: number; t: number; poche?: boolean; wA?: number; wB?: number };
    const near = (st: Band, a: number, b: number): Seg[] => {
      const r = st.t / 2 + 2;
      const pts = [[a, st.c - r], [a, st.c + r], [b, st.c - r], [b, st.c + r]].map(([al, ac]) => ({
        x: al! * st.ux - ac! * st.uy, y: al! * st.uy + ac! * st.ux,
      }));
      const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
      const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
      const out = new Set<Seg>();
      for (let cx = Math.floor(x0 / wCell); cx <= Math.floor(x1 / wCell); cx++) {
        for (let cy = Math.floor(y0 / wCell); cy <= Math.floor(y1 / wCell); cy++) {
          for (const sg of wGrid.get(`${cx},${cy}`) ?? []) out.add(sg);
        }
      }
      return [...out];
    };
    const cover = (runs: Array<{ lo: number; hi: number }>, a: number, b: number) => {
      const parts = runs.map((r) => [Math.max(a, r.lo), Math.min(b, r.hi)] as const).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
      let tot = 0, cur: [number, number] | null = null;
      for (const [x, y] of parts) {
        if (!cur || x > cur[1]) { if (cur) tot += cur[1] - cur[0]; cur = [x, y]; } else cur[1] = Math.max(cur[1], y);
      }
      if (cur) tot += cur[1] - cur[0];
      return tot;
    };
    // is [a, b] along band st a window? Its jamb-to-jamb interval, or null. The answer
    // depends only on the drawing, so it is kept for the merges that ask again.
    const seen = new Map<string, Win | null>();
    const windowAt = (st: Band, a: number, b: number): Win | null => {
      const k = [st.ux, st.uy, st.c, st.t, a, b, st.wA ?? 0, st.wB ?? 0].map((v) => v.toFixed(3)).join('|') + (st.poche ? 'p' : '');
      if (!seen.has(k)) seen.set(k, windowAt0(st, a, b));
      return seen.get(k)!;
    };
    const windowAt0 = (st: Band, a: number, b: number, doorAt?: { a?: boolean; b?: boolean }): Win | null => {
      const W = b - a;
      if (W < minWin || W > maxWin) return null;
      // a door in the interval: the window, if any, is beside it (a sidelight)
      const doorsIn: Array<[number, number]> = [];
      for (const op of doorOpenings) {
        const al1 = op.a.x * st.ux + op.a.y * st.uy, al2 = op.b.x * st.ux + op.b.y * st.uy;
        const ac1 = -op.a.x * st.uy + op.a.y * st.ux - st.c, ac2 = -op.b.x * st.uy + op.b.y * st.ux - st.c;
        if (Math.max(Math.abs(ac1), Math.abs(ac2)) > st.t / 2 + jambReach) continue;
        const dlo = Math.min(al1, al2), dhi = Math.max(al1, al2);
        if (Math.min(b, dhi) - Math.max(a, dlo) > 0) doorsIn.push([dlo, dhi]);
      }
      if (doorsIn.some(([x, y]) => Math.min(b, y) - Math.max(a, x) > Math.max(0.5, 0.05 * W))) {
        const pad = Math.max(0.5, 0.1 * st.t);
        let parts: Array<[number, number]> = [[a, b]];
        for (const [x, y] of doorsIn) {
          parts = parts.flatMap(([p0, p1]): Array<[number, number]> => [[p0, Math.min(p1, x - pad)], [Math.max(p0, y + pad), p1]]).filter(([p0, p1]) => p1 - p0 >= minWin);
        }
        parts.sort((u, v) => v[1] - v[0] - (u[1] - u[0]));
        if (!parts.length || parts[0]![1] - parts[0]![0] >= W) return null;
        // the door's frame is the window's jamb on that side
        const [p0, p1] = parts[0]!;
        return windowAt0(st, p0, p1, { a: p0 > a + 1e-6 || !!doorAt?.a, b: p1 < b - 1e-6 || !!doorAt?.b });
      }
      // a wall drawn solid (filled or hatched) is not solid across its windows
      if (st.poche) {
        const k = solidContrastOf(st, a, b);
        if ((k !== null && k >= o.pocheContrast) || hatchedOver(st, a, b)) return null;
      }
      const tol = Math.max(0.4, 0.12 * st.t);
      const groups: Array<{ ac: number; fill: boolean; maxW: number; runs: Array<{ lo: number; hi: number }>; raw: Array<{ lo: number; hi: number; w: number }> }> = [];
      const own: Array<Array<{ lo: number; hi: number }>> = [[], []];
      const jambA: number[] = [], jambB: number[] = [];
      const trans: Array<{ al: number; lo: number; hi: number }> = [];
      const pad = Math.max(1, 0.15 * W);
      const ext = Math.max(1, 0.5 * st.t, 150 / S);
      const reach = Math.max(3 * ext, 0.5 * W);
      for (const sg of near(st, a - reach - 1, b + reach + 1)) {
        const cosA = Math.abs(((sg.b.x - sg.a.x) * st.ux + (sg.b.y - sg.a.y) * st.uy) / sg.len);
        const ac1 = -sg.a.x * st.uy + sg.a.y * st.ux - st.c, ac2 = -sg.b.x * st.uy + sg.b.y * st.ux - st.c;
        const al1 = sg.a.x * st.ux + sg.a.y * st.uy, al2 = sg.b.x * st.ux + sg.b.y * st.uy;
        if (cosA >= 0.998) {
          if (Math.max(Math.abs(ac1), Math.abs(ac2)) > st.t / 2 + tol) continue;
          const ac = (ac1 + ac2) / 2;
          // the edge of a fill is not a drawn line: kept apart from the strokes it lies along
          const fill = !sg.stroke;
          let g = groups.find((x) => Math.abs(x.ac - ac) <= 0.3 && x.fill === fill);
          if (!g) { g = { ac, fill, maxW: 0, runs: [], raw: [] }; groups.push(g); }
          g.raw.push({ lo: Math.min(al1, al2), hi: Math.max(al1, al2), w: sg.stroke ? sg.w : -1 });
          const lo = Math.max(a, Math.min(al1, al2)), hi = Math.min(b, Math.max(al1, al2));
          if (hi > lo) {
            g.runs.push({ lo, hi });
            if (sg.stroke) g.maxW = Math.max(g.maxW, sg.w);
            for (const [side, at, pen] of [[0, -st.t / 2, st.wA ?? 0], [1, st.t / 2, st.wB ?? 0]] as const) {
              if (Math.abs(ac - at) > tol) continue;
              if (pen < 0 ? fill : pen > 0 && !!sg.stroke && sg.w >= 0.75 * pen) own[side]!.push({ lo, hi });
            }
          }
        } else if (cosA <= 0.35) {
          if (Math.min(ac1, ac2) > st.t / 2 + tol || Math.max(ac1, ac2) < -st.t / 2 - tol) continue;
          const al = (al1 + al2) / 2;
          if (Math.abs(al - a) <= pad || Math.abs(al - b) <= pad) {
            trans.push({ al, lo: Math.max(-st.t / 2 - tol, Math.min(ac1, ac2)), hi: Math.min(st.t / 2 + tol, Math.max(ac1, ac2)) });
          }
        }
      }
      // a jamb crosses the wall: lines across it at one place, drawn in one piece or several
      trans.sort((p, q) => p.al - q.al);
      for (let i = 0; i < trans.length; ) {
        let j = i;
        while (j + 1 < trans.length && trans[j + 1]!.al - trans[i]!.al <= 0.4) j++;
        const cl = trans.slice(i, j + 1).sort((p, q) => p.lo - q.lo);
        let span = 0, cur: { lo: number; hi: number } | null = null;
        for (const x of cl) {
          if (cur && x.lo <= cur.hi + 0.8) cur.hi = Math.max(cur.hi, x.hi);
          else { if (cur) span = Math.max(span, cur.hi - cur.lo); cur = { lo: x.lo, hi: x.hi }; }
        }
        if (cur) span = Math.max(span, cur.hi - cur.lo);
        if (span >= 0.5 * st.t) {
          const al = cl.reduce((t0, x) => t0 + x.al, 0) / cl.length;
          if (Math.abs(al - a) <= pad) jambA.push(al);
          if (Math.abs(al - b) <= pad) jambB.push(al);
        }
        i = j + 1;
      }
      if (doorAt?.a) jambA.push(a);
      if (doorAt?.b) jambB.push(b);
      // glass and frame lines span the opening, jamb to jamb; a line running on along the
      // wall past it, whole or broken (a face, a cavity, a cladding or lining layer, a
      // dashed line, a face broken by studs), is part of the wall. A glazed door beside
      // the window may carry its lines on: that end is not checked.
      const confined = (g: { raw: Array<{ lo: number; hi: number }> }) =>
        !g.raw.some((r) => (!doorAt?.a && r.lo < a - ext && r.hi > a - 2 * ext) || (!doorAt?.b && r.hi > b + ext && r.lo < b + 2 * ext));
      const lines = groups.filter((g) => cover(g.runs, a, b) >= 0.6 * W);
      const margin = Math.max(0.3, 0.05 * st.t);
      // where the wall's own face stops, a lighter line drawn on across the opening in its
      // place (the sill, the frame's outer line), however far past the jambs it runs
      const inPlace = (g: (typeof groups)[number]) => {
        const side = g.ac < 0 ? 0 : 1;
        const pen = side === 0 ? st.wA ?? 0 : st.wB ?? 0;
        if (!(pen > 0) || g.maxW >= 0.75 * pen || cover(own[side]!, a, b) >= 0.3 * W) return false;
        const light = g.raw.filter((r) => r.w < 0.75 * pen).sort((p, q) => p.lo - q.lo);
        if (light.some((r) => (!doorAt?.a && r.lo < a - reach) || (!doorAt?.b && r.hi > b + reach))) return false;
        // one line across, not a dashed one
        let pieces = 0, end = -Infinity;
        for (const r of light) {
          if (r.hi <= a || r.lo >= b) continue;
          if (r.lo > end + 0.8) pieces++;
          end = Math.max(end, r.hi);
        }
        return pieces <= 2;
      };
      const glazed = lines.filter((g) => !g.fill && Math.abs(g.ac) <= st.t / 2 - margin && confined(g));
      const inner = glazed.length ? glazed : lines.filter((g) => !g.fill && Math.abs(g.ac) > st.t / 2 - margin && inPlace(g));
      if (!inner.length || lines.length < 2 || !jambA.length || !jambB.length) return null;
      const snap = (xs: number[], v: number) => (xs.length ? xs.reduce((p, q) => (Math.abs(q - v) < Math.abs(p - v) ? q : p)) : v);
      const lo = snap(jambA, a), hi = snap(jambB, b);
      // lines only where the faces stop (no glass inside) are a window only in an outside
      // wall: inside, the same lines over an opening are its header (checked once the
      // walls are finished)
      return hi - lo >= minWin ? { lo: Math.min(lo, hi), hi: Math.max(lo, hi), ...(glazed.length ? {} : { outside: true }) } : null;
    };
    const collinear = (p: Strip, q: Strip) => q !== p && q.dir === p.dir && Math.abs(q.c - p.c) <= 0.5 * Math.max(p.t, q.t);
    // a band drawn lighter than the wall it continues: not poche beside poche, or both its
    // faces in a clearly lighter pen than both of the wall's
    const lighter = (q: Strip, p: Strip) =>
      q.cls !== 'poche' && q.cls !== 'opening' &&
      (p.cls === 'poche' || (q.wA >= 0 && q.wB >= 0 && p.wA > 0 && p.wB > 0 && Math.max(q.wA, q.wB) < 0.75 * Math.min(p.wA, p.wB)));
    const drop = (xs: Strip[]) => { for (const x of xs) { const i = finalStrips.indexOf(x); if (i >= 0) finalStrips.splice(i, 1); } };
    // 1. a window drawn as a band of its own in the wall's line, beside wall pieces drawn
    // heavier: the wall runs through it
    for (let changed = true; changed; ) {
      changed = false;
      for (const q of finalStrips) {
        if (len(q) < minWin || len(q) > maxWin) continue;
        const slack = Math.max(1, 0.5 * q.t);
        const longest = (xs: Strip[]) => xs.sort((x, y) => len(y) - len(x))[0];
        const b = longest(finalStrips.filter((p) => collinear(q, p) && lighter(q, p) && Math.abs(p.hi - q.lo) <= slack));
        const a = longest(finalStrips.filter((p) => collinear(q, p) && lighter(q, p) && Math.abs(p.lo - q.hi) <= slack));
        const host = longest([b, a].filter((x): x is Strip => !!x));
        if (!host) continue;
        const iv = windowAt({ ux: host.ux, uy: host.uy, c: host.c, t: host.t, poche: host.cls === 'poche', wA: host.wA, wB: host.wB }, q.lo, q.hi);
        if (!iv) continue;
        const parts = [b, q, a].filter((x): x is Strip => !!x);
        host.windows = [...new Set(parts.flatMap((x) => x.windows ?? [])), iv];
        host.lo = Math.min(...parts.map((x) => x.lo));
        host.hi = Math.max(...parts.map((x) => x.hi));
        drop(parts.filter((x) => x !== host));
        changed = true;
        break;
      }
    }
    // 2. a wall drawn stopping at the window jambs: two collinear pieces, the window
    // between them (and any lighter band drawn in it)
    for (let merged = true; merged; ) {
      merged = false;
      outer: for (const p of finalStrips) {
        // the wall line runs on through wall pieces overlapping its end
        let reach = p.hi;
        for (let grew = true; grew; ) {
          grew = false;
          for (const q of finalStrips) {
            if (collinear(p, q) && !lighter(q, p) && q.lo <= reach + 0.5 && q.hi > reach + 0.5) { reach = q.hi; grew = true; }
          }
        }
        if (reach > p.hi + 0.5) continue;
        const cands = finalStrips
          .filter((q) => collinear(p, q) && q.lo - p.hi >= -0.5 && q.lo - p.hi <= maxWin)
          .sort((x, y) => x.lo - y.lo);
        const between: Strip[] = [];
        for (const q of cands) {
          if (lighter(q, p)) { between.push(q); continue; }
          const band = len(p) >= len(q) ? p : q;
          const iv = windowAt({ ux: p.ux, uy: p.uy, c: band.c, t: Math.max(p.t, q.t), poche: p.cls === 'poche' && q.cls === 'poche', wA: band.wA, wB: band.wB }, p.hi, q.lo);
          if (iv) {
            p.windows = [...(p.windows ?? []), iv, ...(q.windows ?? [])];
            if (band === q) { p.c = q.c; p.t = q.t; p.wA = q.wA; p.wB = q.wB; }
            p.hi = Math.max(p.hi, q.hi);
            drop([q, ...between.filter((x) => x.hi <= q.lo + 0.5)]);
            merged = true;
            break outer;
          }
          break;
        }
      }
    }
    // 3. a wall running on with its own faces broken at the window
    for (const st of finalStrips) {
      const tol = Math.max(0.4, 0.12 * st.t);
      const faceRuns: Array<Array<{ lo: number; hi: number }>> = [[], []];
      for (const sg of near(st, st.lo, st.hi)) {
        if (Math.abs(((sg.b.x - sg.a.x) * st.ux + (sg.b.y - sg.a.y) * st.uy) / sg.len) < 0.998) continue;
        const ac1 = -sg.a.x * st.uy + sg.a.y * st.ux - st.c, ac2 = -sg.b.x * st.uy + sg.b.y * st.ux - st.c;
        const al1 = sg.a.x * st.ux + sg.a.y * st.uy, al2 = sg.b.x * st.ux + sg.b.y * st.uy;
        for (const [side, at, pen] of [[0, -st.t / 2, st.wA], [1, st.t / 2, st.wB]] as const) {
          if (Math.abs(ac1 - at) > tol || Math.abs(ac2 - at) > tol) continue;
          const own = pen < 0 ? !!sg.fill && !sg.stroke : !!sg.stroke && sg.w >= 0.75 * pen;
          if (own) faceRuns[side]!.push({ lo: Math.min(al1, al2), hi: Math.max(al1, al2) });
        }
      }
      const gaps: Array<{ lo: number; hi: number }> = [];
      for (const runs of faceRuns) {
        // a face the wall's own pen barely draws is not where this band says it is
        if (cover(runs, st.lo, st.hi) < 0.05 * len(st)) continue;
        const parts = runs.map((r) => [Math.max(st.lo, r.lo), Math.min(st.hi, r.hi)] as const).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
        let at = st.lo;
        for (const [x, y] of parts) {
          if (x - at >= minWin) gaps.push({ lo: at, hi: x });
          at = Math.max(at, y);
        }
        if (st.hi - at >= minWin && parts.length) gaps.push({ lo: at, hi: st.hi });
      }
      // a wall drawn solid whose faces run on past its windows (an outline around a filled
      // or hatched wall): the window is where the solid stops
      if (st.cls !== 'opening' && raster && solidContrastOf(st, st.lo, st.hi) !== null) {
        const step = Math.max(0.5, 1 / raster.pxPerPt), h = Math.max(0.75, 0.25 * st.t);
        const runs: Array<{ lo: number; hi: number }> = [];
        let runLo: number | null = null, nSolid = 0, n = 0;
        for (let x = st.lo + h; x <= st.hi - h + 1e-9; x += step) {
          const solid = (solidContrastOf(st, x - h, x + h) ?? 1) >= o.pocheContrast;
          n++;
          if (solid) nSolid++;
          if (!solid) { if (runLo === null) runLo = x; continue; }
          if (runLo !== null && x - runLo >= minWin) runs.push({ lo: runLo, hi: x });
          runLo = null;
        }
        if (runLo !== null && st.hi - h - runLo >= minWin) runs.push({ lo: runLo, hi: st.hi - h });
        // only a wall that is drawn solid somewhere has its solid broken by a window
        if (nSolid >= 0.15 * n) gaps.push(...runs);
      }
      // a window breaking both faces leaves the same gap in each: try the shorter first
      gaps.sort((p, q) => p.hi - p.lo - (q.hi - q.lo));
      for (const g of gaps) {
        if ((st.windows ?? []).some((w) => Math.min(w.hi, g.hi) - Math.max(w.lo, g.lo) > 0)) continue;
        const iv = windowAt({ ux: st.ux, uy: st.uy, c: st.c, t: st.t, poche: st.cls === 'poche', wA: st.wA, wB: st.wB }, g.lo, g.hi);
        if (iv) st.windows = [...(st.windows ?? []), iv];
      }
    }
    // ---- window checks on the finished wall lines
    {
      // a piece left lying inside a wall that now runs through its windows is that wall
      for (let i = finalStrips.length - 1; i >= 0; i--) {
        const s = finalStrips[i]!;
        const f = finalStrips.find(
          (g) => g !== s && g.dir === s.dir && Math.abs(g.c - s.c) < 0.5 * Math.min(g.t, s.t) && len(g) > len(s) &&
            Math.min(g.hi, s.hi) - Math.max(g.lo, s.lo) >= 0.9 * len(s),
        );
        if (!f) continue;
        for (const w of s.windows ?? []) {
          if (!(f.windows ?? []).some((v) => Math.min(v.hi, w.hi) - Math.max(v.lo, w.lo) > 0)) f.windows = [...(f.windows ?? []), w];
        }
        finalStrips.splice(i, 1);
      }
      // one opening drawn across a wall and a layer band against it (cladding, a projecting
      // sill) is one window: it belongs to the band that is the wall (both faces in its pen)
      const faceW = (st: Strip) => Math.min(st.wA < 0 ? 1 : st.wA, st.wB < 0 ? 1 : st.wB);
      const moves: Array<[Strip, Win]> = [];
      for (const st of finalStrips) {
        if (!st.windows?.length) continue;
        st.windows = st.windows.filter((w) => {
          let to: Strip | null = null;
          for (const q of finalStrips) {
            if (q === st || q.dir !== st.dir) continue;
            if (Math.abs(q.c - st.c) - (q.t + st.t) / 2 > abutGap) continue;
            if (q.lo > w.lo + 0.5 || q.hi < w.hi - 0.5) continue;
            if (faceW(q) > 1.25 * faceW(st) && (!to || faceW(q) > faceW(to))) to = q;
          }
          if (!to) return true;
          moves.push([to, w]);
          return false;
        });
      }
      for (const [q, w] of moves) {
        if (!(q.windows ?? []).some((v) => Math.min(v.hi, w.hi) - Math.max(v.lo, w.lo) > 0)) q.windows = [...(q.windows ?? []), w];
      }
      // one window found on two overlapping pieces of a wall line is one window: it stays
      // with the longer piece
      const order = new Map(finalStrips.map((x, i) => [x, i] as const));
      for (const st of finalStrips) {
        if (!st.windows?.length) continue;
        st.windows = st.windows.filter((w) => !finalStrips.some((q) =>
          collinear(st, q) && (len(q) > len(st) || (len(q) === len(st) && order.get(q)! < order.get(st)!)) &&
          (q.windows ?? []).some((v) => Math.min(v.hi, w.hi) - Math.max(v.lo, w.lo) > 0.5 * Math.min(v.hi - v.lo, w.hi - w.lo))));
      }
      // an opening fronting a shallow recess closed by walls (a cupboard, an alcove, a bay
      // opened into the room) is not a window: 250-900 mm behind it, on either side, runs a
      // wall drawn at least as heavily across its whole width, and lines close the space
      // between the two at both ends
      const recessMin = 250 / S, recess = 900 / S, closeReach = 1500 / S;
      for (const st of finalStrips) {
        if (!st.windows?.length) continue;
        st.windows = st.windows.filter((w) => {
          const W = w.hi - w.lo;
          for (const side of [-1, 1]) {
            const face = st.c + side * st.t / 2;
            for (const q of finalStrips) {
              if (q === st || q.dir !== st.dir || faceW(q) < 0.9 * faceW(st)) continue;
              const depth = side > 0 ? q.c - q.t / 2 - face : face - (q.c + q.t / 2);
              if (depth < recessMin || depth > recess) continue;
              if (Math.min(q.hi, w.hi) - Math.max(q.lo, w.lo) < 0.8 * W) continue;
              const ac0 = Math.min(face, face + side * depth), ac1 = Math.max(face, face + side * depth);
              const mid = { c: (ac0 + ac1) / 2, t: ac1 - ac0 };
              const closes = (from: number, to: number) => near({ ux: st.ux, uy: st.uy, c: mid.c, t: mid.t }, from, to).some((sg) => {
                if (Math.abs(((sg.b.x - sg.a.x) * st.ux + (sg.b.y - sg.a.y) * st.uy) / sg.len) > 0.35) return false;
                const al = ((sg.a.x + sg.b.x) * st.ux + (sg.a.y + sg.b.y) * st.uy) / 2;
                if (al < from || al > to) return false;
                const c1 = -sg.a.x * st.uy + sg.a.y * st.ux, c2 = -sg.b.x * st.uy + sg.b.y * st.ux;
                return Math.min(c1, c2) <= ac0 + 0.15 * mid.t && Math.max(c1, c2) >= ac1 - 0.15 * mid.t;
              });
              if (closes(w.lo - closeReach, w.lo + 0.25 * W) && closes(w.hi - 0.25 * W, w.hi + closeReach)) return false;
            }
          }
          return true;
        });
      }
    }
  }
  const minWinOut = 300 / S;
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
  for (const s of openingStrips) {
    out.push({
      id: hashId(['opening', s.dir, s.c.toFixed(2), s.lo.toFixed(2), s.hi.toFixed(2)]),
      a: { x: s.lo * s.ux - s.c * s.uy, y: s.lo * s.uy + s.c * s.ux },
      b: { x: s.hi * s.ux - s.c * s.uy, y: s.hi * s.uy + s.c * s.ux },
      thickness: s.t, length: s.hi - s.lo, kind: 'opening', dir: s.dir, exterior: false,
    });
  }
  for (const s of finalStrips) {
    if (s.hi - s.lo < minLen * 0.5) continue;
    const a = { x: s.lo * s.ux - s.c * s.uy, y: s.lo * s.uy + s.c * s.ux };
    const b = { x: s.hi * s.ux - s.c * s.uy, y: s.hi * s.uy + s.c * s.ux };
    out.push({
      id: hashId([s.dir, s.c.toFixed(2), s.lo.toFixed(2), s.hi.toFixed(2), s.t.toFixed(2)]),
      a, b, thickness: s.t, length: s.hi - s.lo,
      kind: s.cls === 'poche' ? 'poche' : 'faces',
      dir: s.dir,
      exterior: false,
      ...(s.windows?.length
        ? {
          windows: s.windows
            .map((w) => ({ from: Math.max(0, w.lo - s.lo), to: Math.min(s.hi - s.lo, w.hi - s.lo), ...(w.outside ? { outside: true } : {}) }))
            .filter((w) => w.to - w.from >= minWinOut)
            .sort((p, q) => p.from - q.from),
        }
        : {}),
    });
  }
  // ---- exterior walls: three rays from a face (at a quarter, half and three quarters of
  // its length) cast straight out; if most meet no other wall, that face looks out of the
  // building. Walls run on through doors, so rays rarely escape through an opening.
  const rayHits = (p: Vec2, d: Vec2, self: number) => {
    for (let k = 0; k < out.length; k++) {
      if (k === self) continue;
      const q = out[k]!;
      const el = Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) || 1;
      const qx = (q.b.x - q.a.x) / el, qy = (q.b.y - q.a.y) / el, pad = q.thickness / 2;
      const ax = q.a.x - qx * pad, ay = q.a.y - qy * pad;
      const ex = q.b.x + qx * pad - ax, ey = q.b.y + qy * pad - ay;
      const den = d.x * ey - d.y * ex;
      if (Math.abs(den) < 1e-9) continue;
      const wx = ax - p.x, wy = ay - p.y;
      const sAlong = (wx * ey - wy * ex) / den, rOn = (wx * d.y - wy * d.x) / den;
      if (sAlong > 0 && rOn >= 0 && rOn <= 1) return true;
    }
    return false;
  };
  out.forEach((w, i) => {
    if (w.length < 1e-6) return;
    const ux = (w.b.x - w.a.x) / w.length, uy = (w.b.y - w.a.y) / w.length;
    for (const side of [1, -1]) {
      const n = { x: -uy * side, y: ux * side };
      let escapes = 0;
      for (const f of [0.25, 0.5, 0.75]) {
        const off = w.thickness / 2 + 0.5;
        const p = { x: w.a.x + ux * f * w.length + n.x * off, y: w.a.y + uy * f * w.length + n.y * off };
        if (!rayHits(p, n, i)) escapes++;
      }
      if (escapes >= 2) { w.exterior = true; break; }
    }
  });
  // a window shown only by lines where the faces stop must look out of the building:
  // straight out from its middle, on one side, no other wall
  out.forEach((w, i) => {
    if (!w.windows?.length) return;
    const ux = (w.b.x - w.a.x) / (w.length || 1), uy = (w.b.y - w.a.y) / (w.length || 1);
    w.windows = w.windows.filter((win) => {
      const o = win as { from: number; to: number; outside?: boolean };
      if (!o.outside) return true;
      delete o.outside;
      const m = (win.from + win.to) / 2;
      return [1, -1].some((side) => {
        const n = { x: -uy * side, y: ux * side }, off = w.thickness / 2 + 0.5;
        return !rayHits({ x: w.a.x + ux * m + n.x * off, y: w.a.y + uy * m + n.y * off }, n, i);
      });
    });
    if (!w.windows.length) delete w.windows;
  });
  if (diag) {
    diag.openingWalls = openingStrips.length; diag.columns = columns.length; diag.frame = excluded.size;
    diag.exterior = out.filter((w) => w.exterior).length;
    diag.windows = out.reduce((n, w) => n + (w.windows?.length ?? 0), 0);
  }
  out.sort((p, q) => p.a.y - q.a.y || p.a.x - q.a.x || p.id.localeCompare(q.id));
  return out;
}
