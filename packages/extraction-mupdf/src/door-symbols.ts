/**
 * Door SYMBOL detector (geometry-only, drawing-agnostic).
 *
 * A hinged door is drawn as a LEAF (a straight line, usually shown open) plus a
 * SWING ARC centred on the hinge. From that symbol the real opening follows directly:
 *
 *      H (hinge = arc centre) ---- leaf ----> F (free end, on the arc)
 *      H ......opening in the wall......> C (closed position = other arc end)
 *
 * The opening is the segment H->C, NOT the drawn leaf. The host wall is the wall
 * whose axis is parallel to H->C and whose body contains both H and C. This is what
 * fixes doors drawn open at 90 degrees being hosted on the partition beside them or
 * shifted along the wall.
 *
 * No labels, expected counts or drawing-specific constants are used. Arcs may arrive
 * as flattened beziers (one subpath) or as many tiny independent line strokes (CAD
 * polyline arcs); both are handled by chaining short segments end to end.
 */
import type { MuVector, Vec2 } from './vector-device';

export interface SymbolWall {
  physicalWallId: string;
  centerline: { a: Vec2; b: Vec2 };
  thickness: number;
}

export interface DoorSymbolConfig {
  /** leaf length band (mm) for a single hinged leaf */
  minLeafMm: number;
  maxLeafMm: number;
  /** upper cap (pt) on how far outside the wall body the hinge/closed point may sit */
  hostCorridorPadPt: number;
}

export interface DoorSymbol {
  hinge: Vec2;
  closed: Vec2;
  free: Vec2;
  radiusPt: number;
  sweepRad: number;
  leafSegmentId: string;
  leafOperationId: string;
  arcSegmentIds: string[];
  arcOperationIds: string[];
}

export type HostedDoorStatus = 'UNIQUE_HOST' | 'AMBIGUOUS_HOST' | 'NO_HOST';

export interface HostedDoorSymbol {
  symbol: DoorSymbol;
  hostStatus: HostedDoorStatus;
  physicalWallId?: string;
  /** opening along the host wall, measured from centerline.a (pt), from < to */
  interval?: { from: number; to: number };
  /** leaf (clear) width along the wall before jamb snapping (pt) */
  leafWidthPt: number;
  /** true when the interval was snapped outward to the wall's jamb end-caps */
  jambSnapped: boolean;
  /** true when the opening sits in the gap beyond this wall's end (wall drawn stopping
   *  at the jamb); the interval then lies partly or wholly outside 0..wall length */
  inWallGap?: boolean;
  /** hinge at the interval start (nearer centerline.a) => 'left' in the wall-local frame */
  hingeSide: 'left' | 'right';
  /** +1 when the leaf opens toward the wall-local +Z normal (-u.y, u.x), else -1 */
  swingNormalSign: 1 | -1;
}

export interface Seg {
  id: string;
  op: string;
  a: Vec2;
  b: Vec2;
  len: number;
  w: number;
  /** true when this edge was seen as the outline of a filled path */
  fill?: boolean;
  /** true when it was seen as a stroke */
  stroke?: boolean;
  /** darkest luminance (0 = black .. 1 = white) of the paint that drew it */
  shade?: number;
  /** root id and luminance of the (darkest) filled path this edge bounds */
  fillOp?: string;
  fillShade?: number;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const angleOf = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);
const wrap = (d: number) => {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
const RAD = Math.PI / 180;

const CURVE_STEPS = 12;

/** Rebuild subpaths from path commands, flattening each cubic bezier into short chords. */
function flattenCommands(commands: any[]): Vec2[][] {
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  const flush = () => { if (cur.length > 1) out.push(cur); cur = []; };
  for (const c of commands) {
    if (c.op === 'M') { flush(); cur = [{ x: c.x, y: c.y }]; }
    else if (c.op === 'L') cur.push({ x: c.x, y: c.y });
    else if (c.op === 'C' && cur.length) {
      const p0 = cur[cur.length - 1]!;
      const { p1, p2, p3 } = c;
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS, u = 1 - t;
        cur.push({
          x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
          y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        });
      }
    } else if (c.op === 'Z') {
      if (cur.length > 1) cur.push(cur[0]!);
      flush();
    }
  }
  flush();
  return out;
}

/** Every stroke segment on the page, de-duplicated by geometry (heaviest lineweight kept). */
export function collectSegments(vectors: MuVector[]): Seg[] {
  const byKey = new Map<string, Seg>();
  // The capture stores a bezier as its control polygon (p1, p2, p3 pushed as points),
  // which is not the drawn curve. Paths that contain curves are rebuilt from their
  // commands with each cubic flattened; their per-subpath copies are skipped.
  const hasCurve = (v: MuVector) => (v.commands ?? []).some((c) => c.op === 'C');
  const curvedRoots = new Set<string>();
  for (const v of vectors) if (hasCurve(v)) curvedRoots.add(v.id);
  for (const v of vectors) {
    const op = v.sourceRootId ?? v.id;
    let subs: Vec2[][];
    if (hasCurve(v)) {
      subs = flattenCommands(v.commands as any[]);
    } else {
      if (v.sourceRootId && v.sourceRootId !== v.id && curvedRoots.has(v.sourceRootId)) continue;
      const m = /^(.*):s\d+$/.exec(v.id);
      if (m && curvedRoots.has(m[1]!)) continue;
      subs = v.subpaths && v.subpaths.length ? v.subpaths : [v.points];
    }
    for (let si = 0; si < subs.length; si++) {
      const s = subs[si];
      if (!s || s.length < 2) continue;
      for (let i = 0; i + 1 < s.length; i++) {
        const a = s[i]!;
        const b = s[i + 1]!;
        const len = dist(a, b);
        if (len < 1e-6) continue;
        const ka = `${a.x.toFixed(1)},${a.y.toFixed(1)}`;
        const kb = `${b.x.toFixed(1)},${b.y.toFixed(1)}`;
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const w = v.strokeWidthPt ?? v.strokeWidth ?? 0;
        const prev = byKey.get(key);
        const isFill = v.operation === 'fill-path';
        const col = v.color ?? [];
        const shade = col.length >= 3 ? 0.299 * col[0]! + 0.587 * col[1]! + 0.114 * col[2]! : col.length === 1 ? col[0]! : 0;
        if (prev) {
          if (w > prev.w) prev.w = w;
          if (isFill) {
            // keep the darkest fill this edge bounds (a wall edge is often shared with a
            // lighter room/floor fill)
            if (!prev.fill || shade < (prev.fillShade ?? 1)) { prev.fillOp = op; prev.fillShade = shade; }
            prev.fill = true;
          } else prev.stroke = true;
          if (shade < (prev.shade ?? 1)) prev.shade = shade;
          continue;
        }
        // same id scheme as the legacy leaf ids / the route's claimed-source registry
        byKey.set(key, {
          id: `${v.id}:L${i}`, op, a, b, len, w, fill: isFill, stroke: !isFill, shade,
          ...(isFill ? { fillOp: op, fillShade: shade } : {}),
        });
      }
    }
  }
  return [...byKey.values()];
}

/** Algebraic least-squares circle fit. */
function fitCircle(pts: Vec2[]): { c: Vec2; r: number; res: number } | null {
  const n = pts.length;
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  sx /= n; sy /= n;
  let Suu = 0, Suv = 0, Svv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (const p of pts) {
    const u = p.x - sx, v = p.y - sy;
    Suu += u * u; Suv += u * v; Svv += v * v;
    Suuu += u * u * u; Svvv += v * v * v; Suvv += u * v * v; Svuu += v * u * u;
  }
  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-9) return null;
  const uc = (0.5 * (Suuu + Suvv) * Svv - 0.5 * (Svvv + Svuu) * Suv) / det;
  const vc = (0.5 * (Svvv + Svuu) * Suu - 0.5 * (Suuu + Suvv) * Suv) / det;
  const c = { x: uc + sx, y: vc + sy };
  const r = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / n);
  let res = 0;
  for (const p of pts) res = Math.max(res, Math.abs(dist(p, c) - r));
  return { c, r, res };
}

class PointGrid<T> {
  private cells = new Map<number, T[]>();
  constructor(private size: number) {}
  private key(cx: number, cy: number) { return cx * 1000003 + cy; }
  add(p: Vec2, item: T) {
    const k = this.key(Math.floor(p.x / this.size), Math.floor(p.y / this.size));
    const arr = this.cells.get(k);
    if (arr) arr.push(item); else this.cells.set(k, [item]);
  }
  *near(p: Vec2, radius: number): Generator<T> {
    const r = Math.ceil(radius / this.size);
    const cx = Math.floor(p.x / this.size), cy = Math.floor(p.y / this.size);
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const arr = this.cells.get(this.key(cx + dx, cy + dy));
        if (arr) yield* arr;
      }
    }
  }
}

interface Arc { pts: Vec2[]; segs: Seg[]; c: Vec2; r: number; sweep: number }

function findArcs(segs: Seg[], minPt: number, maxPt: number): Arc[] {
  const JOIN_TOL = 0.35;
  const small = segs.filter((s) => s.len >= 0.2 && s.len <= 0.3 * maxPt);
  const grid = new PointGrid<{ i: number; e: 0 | 1 }>(1);
  small.forEach((s, i) => { grid.add(s.a, { i, e: 0 }); grid.add(s.b, { i, e: 1 }); });
  const used = new Uint8Array(small.length);
  const arcs: Arc[] = [];
  for (let i0 = 0; i0 < small.length; i0++) {
    if (used[i0]) continue;
    used[i0] = 1;
    const pts: Vec2[] = [small[i0]!.a, small[i0]!.b];
    const chain: Seg[] = [small[i0]!];
    let sign = 0;
    for (const direction of [1, -1] as const) {
      for (;;) {
        const end = direction === 1 ? pts[pts.length - 1]! : pts[0]!;
        const prev = direction === 1 ? pts[pts.length - 2]! : pts[1]!;
        const a1 = angleOf(prev, end);
        let best: { i: number; other: Vec2; t: number } | null = null;
        for (const { i, e } of grid.near(end, JOIN_TOL)) {
          if (used[i]) continue;
          const s = small[i]!;
          const here = e === 0 ? s.a : s.b;
          if (dist(here, end) > JOIN_TOL) continue;
          const other = e === 0 ? s.b : s.a;
          const t = wrap(angleOf(end, other) - a1);
          if (Math.abs(t) > 30 * RAD) continue;
          const tt = t * direction;
          if (sign !== 0 && Math.abs(tt) > 1 * RAD && (tt > 0) !== (sign > 0)) continue;
          if (!best || Math.abs(t) < Math.abs(best.t) || (Math.abs(t) === Math.abs(best.t) && i < best.i)) best = { i, other, t };
        }
        if (!best) break;
        used[best.i] = 1;
        if (sign === 0 && Math.abs(best.t) > 1 * RAD) sign = best.t * direction > 0 ? 1 : -1;
        if (direction === 1) { pts.push(best.other); chain.push(small[best.i]!); }
        else { pts.unshift(best.other); chain.unshift(small[best.i]!); }
      }
    }
    if (pts.length < 6) continue;
    // A chain can pick up a straight stub at either end (door frame, leaf end cap);
    // trim up to 3 points per end and keep the longest sub-chain that is a clean arc.
    let ok: Arc | null = null;
    for (let ta = 0; ta < 4; ta++) {
      for (let tb = 0; tb < 4; tb++) {
        const p = pts.slice(ta, pts.length - tb);
        if (p.length < 6) continue;
        if (ok && p.length <= ok.pts.length) continue;
        const f = fitCircle(p);
        if (!f) continue;
        if (f.res > Math.max(0.6, 0.03 * f.r) || f.r < minPt || f.r > maxPt) continue;
        // true swept angle (sum of the steps around the centre), so a nearly closed
        // circle is not mistaken for a short arc between its two ends
        let swept = 0;
        for (let i = 0; i + 1 < p.length; i++) swept += wrap(angleOf(f.c, p[i + 1]!) - angleOf(f.c, p[i]!));
        const sweep = Math.abs(swept);
        // quarter swing is typical; doors drawn part-open (30/45 degrees) are common too
        if (sweep < 25 * RAD || sweep > 130 * RAD) continue;
        ok = { pts: p, segs: chain.slice(ta, chain.length - tb), c: f.c, r: f.r, sweep };
      }
    }
    if (ok) arcs.push(ok);
  }
  return arcs;
}

/** Find every leaf + swing-arc door symbol on the page (not yet tied to a wall). */
export function detectDoorSymbols(segs: Seg[], scaleMmPerPt: number, cfg: DoorSymbolConfig): DoorSymbol[] {
  const minPt = cfg.minLeafMm / scaleMmPerPt;
  const maxPt = cfg.maxLeafMm / scaleMmPerPt;
  const arcs = findArcs(segs, minPt, maxPt);
  const longs = segs.filter((s) => s.len >= minPt * 0.9 && s.len <= maxPt * 1.05);
  const grid = new PointGrid<{ s: Seg; e: 0 | 1 }>(4);
  for (const s of longs) { grid.add(s.a, { s, e: 0 }); grid.add(s.b, { s, e: 1 }); }
  const out: DoorSymbol[] = [];
  for (const arc of arcs) {
    const hingeTol = Math.max(3, 0.1 * arc.r);
    const freeTol = Math.max(3, 0.12 * arc.r);
    const ends = [arc.pts[0]!, arc.pts[arc.pts.length - 1]!];
    let best: { cost: number; fi: number; leaf: Seg } | null = null;
    for (const { s, e } of grid.near(arc.c, hingeTol)) {
      if (Math.abs(s.len - arc.r) > 0.15 * arc.r) continue;
      const h = e === 0 ? s.a : s.b;
      const f = e === 0 ? s.b : s.a;
      const dh = dist(h, arc.c);
      if (dh > hingeTol) continue;
      for (let fi = 0; fi < 2; fi++) {
        const df = dist(f, ends[fi]!);
        if (df > freeTol) continue;
        const cost = dh + df;
        if (!best || cost < best.cost || (cost === best.cost && s.id < best.leaf.id)) best = { cost, fi, leaf: s };
      }
    }
    if (!best) continue;
    const free = ends[best.fi]!;
    const closed = ends[1 - best.fi]!;
    if (out.some((o) => dist(o.hinge, arc.c) < 1.5 && dist(o.closed, closed) < 1.5)) continue;
    out.push({
      hinge: arc.c,
      closed,
      free,
      radiusPt: arc.r,
      sweepRad: arc.sweep,
      leafSegmentId: best.leaf.id,
      leafOperationId: best.leaf.op,
      arcSegmentIds: arc.segs.map((s) => s.id),
      arcOperationIds: [...new Set(arc.segs.map((s) => s.op))],
    });
  }
  return out;
}

/**
 * Tie each symbol to its wall and compute the opening interval.
 * Host = wall parallel to hinge->closed whose body contains both points.
 * The interval is then snapped outward to the wall's jamb end-caps (short strokes
 * across the wall thickness, heaviest lineweight first) when they exist, so the
 * width is the structural opening rather than the bare leaf.
 */
export function hostDoorSymbols(symbols: DoorSymbol[], walls: SymbolWall[], segs: Seg[], cfg: DoorSymbolConfig): HostedDoorSymbol[] {
  const maxT = Math.max(1, ...walls.map((w) => w.thickness));
  const capGrid = new PointGrid<Seg>(16);
  for (const s of segs) {
    if (s.len <= maxT * 1.25) capGrid.add({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, s);
  }
  const out: HostedDoorSymbol[] = [];
  for (const sym of symbols) {
    const d = { x: sym.closed.x - sym.hinge.x, y: sym.closed.y - sym.hinge.y };
    const dl = Math.hypot(d.x, d.y) || 1;
    const cands: Array<{ w: SymbolWall; score: number; ah: number; ac: number; u: Vec2; len: number; inGap: boolean }> = [];
    for (const w of walls) {
      const A = w.centerline.a, B = w.centerline.b;
      const len = dist(A, B);
      if (len < 1e-6) continue;
      const u = { x: (B.x - A.x) / len, y: (B.y - A.y) / len };
      if (Math.abs(u.x * d.y - u.y * d.x) / dl > Math.sin(12 * RAD)) continue;
      const along = (p: Vec2) => (p.x - A.x) * u.x + (p.y - A.y) * u.y;
      const perp = (p: Vec2) => Math.abs((p.x - A.x) * u.y - (p.y - A.y) * u.x);
      const t = w.thickness;
      const limit = t / 2 + Math.min(cfg.hostCorridorPadPt, Math.max(1.5, 0.35 * t));
      // the hinge (arc centre) is exact; the closed end may drift off the wall line by as
      // much as the 12 degree direction tolerance allows
      const ph = perp(sym.hinge), pc = perp(sym.closed);
      if (ph > limit || pc > limit + dl * Math.sin(12 * RAD)) continue;
      const score = Math.max(ph, pc);
      const ah = along(sym.hinge), ac = along(sym.closed);
      const lo = Math.min(ah, ac), hi = Math.max(ah, ac);
      // Many drawings stop the wall at each jamb, so the opening sits in the GAP
      // between two collinear wall pieces instead of inside one wall. Accept a wall
      // on the same line whose end is at the opening's jamb.
      const inGap = lo < -t || hi > len + t;
      if (inGap && Math.max(0, -hi, lo - len) > 0.25 * dl + t) continue;
      cands.push({ w, score, ah, ac, u, len, inGap });
    }
    cands.sort(
      (x, y) => Number(x.inGap) - Number(y.inGap) || x.score - y.score || x.w.physicalWallId.localeCompare(y.w.physicalWallId),
    );
    const leafWidthPt = dl;
    if (!cands.length) {
      out.push({ symbol: sym, hostStatus: 'NO_HOST', leafWidthPt, jambSnapped: false, hingeSide: 'left', swingNormalSign: 1 });
      continue;
    }
    const best = cands[0]!;
    const { w, u } = best;
    const A = w.centerline.a;
    // a second candidate is a COMPETING host only if it is a different wall line;
    // the wall piece on the other side of the same opening is not a competitor
    const second = cands[1];
    const secondOffLine = second
      ? Math.abs((second.w.centerline.a.x - A.x) * u.y - (second.w.centerline.a.y - A.y) * u.x) > 1
      : false;
    const ambiguous = !!second && secondOffLine && second.inGap === best.inGap && second.score - best.score < 1;
    const t = w.thickness;
    // jamb end-caps: strokes across the wall, about one thickness long, centred on it
    const sg = best.ah > best.ac ? 1 : -1; // outward direction on the hinge side
    const reach = 0.2 * sym.radiusPt;
    const caps: Array<{ al: number; w: number }> = [];
    const seen = new Set<Seg>();
    for (const anchor of [sym.hinge, sym.closed]) {
      for (const s of capGrid.near(anchor, reach + t + 16)) {
        if (seen.has(s)) continue;
        seen.add(s);
        if (s.len < 0.75 * t || s.len > 1.25 * t) continue;
        const dx = (s.b.x - s.a.x) / s.len, dy = (s.b.y - s.a.y) / s.len;
        if (Math.abs(dx * u.x + dy * u.y) > 0.2) continue;
        const pa = Math.abs((s.a.x - A.x) * u.y - (s.a.y - A.y) * u.x);
        const pb = Math.abs((s.b.x - A.x) * u.y - (s.b.y - A.y) * u.x);
        if (Math.max(pa, pb) > t / 2 + 1.5) continue;
        caps.push({ al: ((s.a.x + s.b.x) / 2 - A.x) * u.x + ((s.a.y + s.b.y) / 2 - A.y) * u.y, w: s.w });
      }
    }
    const pick = (base: number, outward: (al: number) => number): number | null => {
      const c = caps.filter((k) => outward(k.al) >= 0 && outward(k.al) <= reach);
      if (!c.length) return null;
      const mw = Math.max(...c.map((k) => k.w));
      const heavy = c.filter((k) => k.w >= 0.9 * mw);
      heavy.sort((x, y) => outward(x.al) - outward(y.al));
      return heavy[0]!.al;
    };
    const nh = pick(best.ah, (al) => (al - best.ah) * sg);
    const nc = pick(best.ac, (al) => (best.ac - al) * sg);
    const jambSnapped = !best.inGap && nh !== null && nc !== null;
    const h = jambSnapped ? nh! : best.ah;
    const c = jambSnapped ? nc! : best.ac;
    // in-gap openings keep their true position, which lies beyond this wall's end
    const from = best.inGap ? Math.min(h, c) : Math.max(0, Math.min(h, c));
    const to = best.inGap ? Math.max(h, c) : Math.min(best.len, Math.max(h, c));
    const f = { x: sym.free.x - sym.hinge.x, y: sym.free.y - sym.hinge.y };
    out.push({
      symbol: sym,
      hostStatus: ambiguous ? 'AMBIGUOUS_HOST' : 'UNIQUE_HOST',
      physicalWallId: w.physicalWallId,
      interval: { from, to },
      leafWidthPt,
      jambSnapped,
      inWallGap: best.inGap,
      hingeSide: best.ah < best.ac ? 'left' : 'right',
      swingNormalSign: u.x * f.y - u.y * f.x > 0 ? 1 : -1,
    });
  }
  return out;
}
