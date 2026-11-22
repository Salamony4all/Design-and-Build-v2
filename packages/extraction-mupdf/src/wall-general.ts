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
          cls: pw >= 0 ? 'pen' : 'edge', pen: Math.max(pw, 0),
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
    for (const st of strips) {
      if (st.cls === 'poche') continue;
      const x0 = Math.min(st.a.x, st.b.x) - st.t, x1 = Math.max(st.a.x, st.b.x) + st.t;
      const y0 = Math.min(st.a.y, st.b.y) - st.t, y1 = Math.max(st.a.y, st.b.y) + st.t;
      let n = 0;
      for (let cx = Math.floor(x0 / hcell); cx <= Math.floor(x1 / hcell); cx++) {
        for (let cy = Math.floor(y0 / hcell); cy <= Math.floor(y1 / hcell); cy++) {
          for (const sg of hgrid.get(`${cx},${cy}`) ?? []) {
            const ac1 = -sg.a.x * st.uy + sg.a.y * st.ux - st.c, ac2 = -sg.b.x * st.uy + sg.b.y * st.ux - st.c;
            if (Math.max(Math.abs(ac1), Math.abs(ac2)) > st.t / 2 + 0.3 || Math.abs(ac2 - ac1) < 0.5 * st.t) continue;
            const al1 = sg.a.x * st.ux + sg.a.y * st.uy, al2 = sg.b.x * st.ux + sg.b.y * st.uy;
            if (Math.min(al1, al2) < st.lo || Math.max(al1, al2) > st.hi) continue;
            const cosA = Math.abs(((sg.b.x - sg.a.x) * st.ux + (sg.b.y - sg.a.y) * st.uy) / sg.len);
            if (cosA < cosLo || cosA > cosHi) continue;
            n++;
          }
        }
      }
      if (n >= 3 && n * st.t >= 0.5 * len(st)) st.cls = 'poche';
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
      if (len(s) > len(dup)) { dup.lo = Math.min(dup.lo, s.lo); dup.hi = Math.max(dup.hi, s.hi); }
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
      dir, ux, uy, c, t, lo, hi: lo + L, cls: 'opening', pen: 0, li: 'opening', lj: 'opening',
      a: op.a, b: op.b,
    });
  }
  for (let i = finalStrips.length - 1; i >= 0; i--) if (removed.has(finalStrips[i]!)) finalStrips.splice(i, 1);
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
      thickness: s.t, length: s.hi - s.lo, kind: 'opening', dir: s.dir,
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
    });
  }
  if (diag) { diag.openingWalls = openingStrips.length; diag.columns = columns.length; diag.frame = excluded.size; }
  out.sort((p, q) => p.a.y - q.a.y || p.a.x - q.a.x || p.id.localeCompare(q.id));
  return out;
}
