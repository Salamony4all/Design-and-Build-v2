/**
 * Broad CAD symbol intelligence, sub-part extraction, block fingerprinting, and
 * fine-grained furniture/fixture classification (pure vector geometry, no AI).
 *
 * Works alongside `furniture-blocks.ts` for both:
 *  - Layered CAD exports (extracts sub-parts, subtypes, room context, custom-model flags)
 *  - Layerless / flattened PDFs (recovers unclaimed interior furniture & sanitary blocks
 *    while filtering out walls, door swings, parallel hatches, and stray framing boxes).
 *
 * All coordinates are MuPDF page points (y down).
 */
import type { Bounds, MuVector, Vec2 } from './vector-device';
import type { FacingWall } from './furniture-facing';

export type FurnitureSubtype =
  | 'chair'
  | 'armchair'
  | 'stool'
  | 'sofa'
  | 'l-sofa'
  | 'curved-sofa'
  | 'bench'
  | 'dining-table'
  | 'meeting-table'
  | 'coffee-table'
  | 'side-table'
  | 'desk'
  | 'reception-counter'
  | 'retail-kiosk'
  | 'bar-counter'
  | 'feature-column'
  | 'slat-screen'
  | 'booth'
  | 'banquette'
  | 'wall-art'
  | 'single-bed'
  | 'double-bed'
  | 'cabinet'
  | 'wardrobe'
  | 'credenza'
  | 'kitchen-counter'
  | 'island'
  | 'shelving'
  | 'joinery'
  | 'wc'
  | 'basin'
  | 'shower'
  | 'bathtub'
  | 'urinal'
  | 'plant'
  | 'screen'
  | 'appliance'
  | 'equipment';

export type SubPartRole =
  | 'overhead'
  | 'cutout'
  | 'cistern'
  | 'pillow'
  | 'cushion'
  | 'arm-back'
  | 'x-brace'
  | 'table-top';

export interface PieceSubPart {
  role: SubPartRole;
  outline: Vec2[];
  areaM2: number;
  dashed?: boolean;
}

export type RoomContext =
  | 'wc'
  | 'kitchen'
  | 'bedroom'
  | 'meeting'
  | 'office'
  | 'lounge'
  | 'reception'
  | 'retail'
  | 'storage'
  | null;

export interface SymbolFingerprint {
  wCm: number;
  dCm: number;
  shape: string;
  hasArcs: boolean;
  radialBins: number[];
}

export interface SymbolTextItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SymbolStrokeInput {
  v: MuVector;
  lines: Vec2[][];
  closed: Vec2[][];
  curves: { p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2 }[];
  bb: Bounds;
  len: number;
}

// ── local geometry primitives ───────────────────────────────────────────────

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function segDist2(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  let t = l > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const x = a.x + t * dx - p.x;
  const y = a.y + t * dy - p.y;
  return x * x + y * y;
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(s) / 2;
}

function polygonCentroid(pts: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
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

function convexHullLocal(points: Vec2[]): Vec2[] {
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

function minAreaRectLocal(hull: Vec2[]): { w: number; d: number; angle: number } {
  if (hull.length < 2) return { w: 0, d: 0, angle: 0 };
  let best = { area: Infinity, w: 0, d: 0, angle: 0 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * c + p.y * s;
      const v = -p.x * s + p.y * c;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU;
    const d = maxV - minV;
    if (w * d < best.area) {
      best = w >= d ? { area: w * d, w, d, angle: ang } : { area: w * d, w: d, d: w, angle: ang + Math.PI / 2 };
    }
  }
  let angle = best.angle % Math.PI;
  if (angle < 0) angle += Math.PI;
  return { w: best.w, d: best.d, angle };
}

function simplifyPoly(pts: Vec2[], tol: number, maxPts = 24): Vec2[] {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  let t = tol;
  let out = pts;
  for (let attempt = 0; attempt < 4; attempt++) {
    keep.fill(0);
    keep[0] = 1;
    keep[pts.length - 1] = 1;
    stack.length = 0;
    stack.push([0, pts.length - 1]);
    const t2 = t * t;
    while (stack.length) {
      const [i, j] = stack.pop()!;
      let worst = -1;
      let wd = 0;
      for (let k = i + 1; k < j; k++) {
        const d2 = segDist2(pts[k], pts[i], pts[j]);
        if (d2 > wd) {
          wd = d2;
          worst = k;
        }
      }
      if (worst > 0 && wd > t2) {
        keep[worst] = 1;
        stack.push([i, worst], [worst, j]);
      }
    }
    out = pts.filter((_, k) => keep[k]);
    if (out.length <= maxPts) break;
    t *= 1.8;
  }
  if (out.length > maxPts) {
    const step = out.length / maxPts;
    const sampled: Vec2[] = [];
    for (let i = 0; i < maxPts; i++) sampled.push(out[Math.floor(i * step)]);
    return sampled;
  }
  return out;
}

function bezLocal(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

// ── 1. Layerless / unclaimed interior vector filter ─────────────────────────

const GENERIC_LAYER_RE = /^(?:0|layer\s*0|default|model|defpoints?)$/i;

function isDarkFill(color?: number[]): boolean {
  if (!color || !color.length) return true;
  if (color.length === 1) return color[0] < 0.35;
  if (color.length >= 3) return (color[0] + color[1] + color[2]) / 3 < 0.35;
  return false;
}

function quickCurveAngleDeg(cmd: Record<string, any>, start: Vec2): { sweepDeg: number; r: number; end: Vec2 } | null {
  const p0 = start;
  const p1 = cmd.p1 as Vec2 | undefined;
  const p2 = cmd.p2 as Vec2 | undefined;
  const p3 = cmd.p3 as Vec2 | undefined;
  if (!p1 || !p2 || !p3) return null;
  const pm = bezLocal(p0, p1, p2, p3, 0.5);
  // 3-point circle fit
  const ax = p0.x;
  const ay = p0.y;
  const bx = pm.x;
  const by = pm.y;
  const cx = p3.x;
  const cy = p3.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  if (!Number.isFinite(r) || r <= 1e-3) return null;
  const q1 = bezLocal(p0, p1, p2, p3, 0.25);
  const q3 = bezLocal(p0, p1, p2, p3, 0.75);
  const err = Math.max(Math.abs(Math.hypot(q1.x - ux, q1.y - uy) - r), Math.abs(Math.hypot(q3.x - ux, q3.y - uy) - r));
  if (err > r * 0.06 + 0.5) return null;
  const a0 = Math.atan2(p0.y - uy, p0.x - ux);
  const a1 = Math.atan2(p3.y - uy, p3.x - ux);
  let diff = Math.abs(a1 - a0);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return { sweepDeg: (diff * 180) / Math.PI, r, end: p3 };
}

function buildWallGrid(walls: readonly FacingWall[], mPerPt: number) {
  const pt = (m: number) => m / mPerPt;
  const cell = pt(1.0);
  const grid = new Map<string, { a: Vec2; b: Vec2; dir: Vec2; len: number; half: number }[]>();
  for (const w of walls) {
    const dx = w.b.x - w.a.x;
    const dy = w.b.y - w.a.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-3) continue;
    const item = { a: w.a, b: w.b, dir: { x: dx / l, y: dy / l }, len: l, half: (w.t && w.t > 0 ? w.t : pt(0.15)) / 2 };
    const xa = Math.floor((Math.min(w.a.x, w.b.x) - item.half - pt(0.2)) / cell);
    const xb = Math.floor((Math.max(w.a.x, w.b.x) + item.half + pt(0.2)) / cell);
    const ya = Math.floor((Math.min(w.a.y, w.b.y) - item.half - pt(0.2)) / cell);
    const yb = Math.floor((Math.max(w.a.y, w.b.y) + item.half + pt(0.2)) / cell);
    if ((xb - xa + 1) * (yb - ya + 1) > 400) continue;
    for (let gx = xa; gx <= xb; gx++) {
      for (let gy = ya; gy <= yb; gy++) {
        const k = `${gx},${gy}`;
        let arr = grid.get(k);
        if (!arr) grid.set(k, (arr = []));
        arr.push(item);
      }
    }
  }
  return { cell, grid };
}

function nearWallEndpoint(p: Vec2, wallGrid: ReturnType<typeof buildWallGrid>, tolPt: number): boolean {
  const gx = Math.floor(p.x / wallGrid.cell);
  const gy = Math.floor(p.y / wallGrid.cell);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const w of wallGrid.grid.get(`${gx + dx},${gy + dy}`) ?? []) {
        if (segDist2(p, w.a, w.b) <= (w.half + tolPt) ** 2) return true;
      }
    }
  }
  return false;
}

function overlapsWall(pts: Vec2[], wallGrid: ReturnType<typeof buildWallGrid>, padPt: number): boolean {
  if (pts.length < 2) return false;
  let totalLen = 0;
  let coveredLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const segLen = dist(a, b);
    if (segLen < 1e-4) continue;
    totalLen += segLen;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const sdx = (b.x - a.x) / segLen;
    const sdy = (b.y - a.y) / segLen;
    const gx = Math.floor(mid.x / wallGrid.cell);
    const gy = Math.floor(mid.y / wallGrid.cell);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (const w of wallGrid.grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (Math.abs(sdx * w.dir.x + sdy * w.dir.y) < 0.92) continue;
          const t2 = (w.half + padPt) ** 2;
          if (segDist2(a, w.a, w.b) <= t2 && segDist2(b, w.a, w.b) <= t2 && segDist2(mid, w.a, w.b) <= t2) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) coveredLen += segLen;
  }
  return totalLen > 0 && coveredLen / totalLen >= 0.75;
}

function detectParallelHatchIds(
  candidates: { v: MuVector; a: Vec2; b: Vec2; len: number; angleBin: number; perp: number; proj: number }[],
  mPerPt: number,
): Set<string> {
  const drop = new Set<string>();
  const maxGapPt = 0.16 / mPerPt;
  const byBin = new Map<number, typeof candidates>();
  for (const c of candidates) {
    let arr = byBin.get(c.angleBin);
    if (!arr) byBin.set(c.angleBin, (arr = []));
    arr.push(c);
  }
  for (const arr of byBin.values()) {
    if (arr.length < 8) continue;
    arr.sort((p, q) => p.perp - q.perp);
    let runStart = 0;
    for (let i = 1; i <= arr.length; i++) {
      const sameRun =
        i < arr.length &&
        arr[i].perp - arr[i - 1].perp <= maxGapPt &&
        Math.abs(arr[i].proj - arr[i - 1].proj) <= Math.max(arr[i].len, arr[i - 1].len) * 1.5;
      if (sameRun) continue;
      const runLen = i - runStart;
      if (runLen >= 8) {
        const sub = arr.slice(runStart, i);
        const avgLen = sub.reduce((s, x) => s + x.len, 0) / sub.length;
        const spacings: number[] = [];
        for (let k = 1; k < sub.length; k++) {
          const sp = sub[k].perp - sub[k - 1].perp;
          if (sp > 0.2) spacings.push(sp);
        }
        const span = sub[sub.length - 1].perp - sub[0].perp;
        if (spacings.length >= 5) {
          const med = [...spacings].sort((a, b) => a - b)[spacings.length >> 1];
          const uniform = spacings.filter((sp) => Math.abs(sp - med) <= Math.max(med * 0.45, 0.5)).length / spacings.length;
          // Dense parallel hatching (floor tiles, insulation, stair treads) has uniform tight spacing
          if (uniform >= 0.65 && med <= maxGapPt && (avgLen * mPerPt > med * mPerPt * 2.5 || span * mPerPt > 0.6)) {
            for (const item of sub) drop.add(item.v.id);
          }
        }
      }
      runStart = i;
    }
  }
  return drop;
}

export function collectBroadCandidateVectors(input: {
  vectors: MuVector[];
  scaleMmPerPt: number;
  within?: Bounds | null;
  walls?: FacingWall[];
  claimedVectorIds?: ReadonlySet<string>;
  maxPieceM: number;
  excludedLayerRe: RegExp;
}): MuVector[] {
  const mPerPt = input.scaleMmPerPt / 1000;
  const pt = (m: number) => m / mPerPt;
  const within = input.within ?? null;
  const claimed = input.claimedVectorIds ?? new Set<string>();
  const normalizedClaimed = new Set<string>();
  for (const id of claimed) normalizedClaimed.add(String(id).split(':')[0]);

  const walls = input.walls ?? [];
  const wallGrid = buildWallGrid(walls, mPerPt);
  const minExtPt = pt(0.03);
  const maxExtPt = pt(input.maxPieceM);
  const minTinyPt = pt(0.015);
  const denseSheet = input.vectors.length > 30_000;

  const preliminary: MuVector[] = [];
  const straightForHatch: { v: MuVector; a: Vec2; b: Vec2; len: number; angleBin: number; perp: number; proj: number }[] = [];

  for (const v of input.vectors) {
    if (v.sourceRootId) continue;
    if (normalizedClaimed.has(v.id)) continue;
    if (v.layer) {
      if (input.excludedLayerRe.test(v.layer)) continue;
      if (!GENERIC_LAYER_RE.test(v.layer.trim())) continue;
    }
    const b = v.bounds;
    if (within && (b[2] < within[0] || b[0] > within[2] || b[3] < within[1] || b[1] > within[3])) continue;
    const bw = b[2] - b[0];
    const bh = b[3] - b[1];
    const ext = Math.max(bw, bh);
    if (ext < minExtPt || ext > maxExtPt) continue;
    if (denseSheet && ext < minTinyPt) continue;

    if (v.operation === 'fill-path') {
      const areaM2 = bw * bh * mPerPt * mPerPt;
      if (areaM2 > 0.8) continue;
      if (isDarkFill(v.color) && areaM2 > 0.12) continue;
    } else if (v.operation !== 'stroke-path') {
      continue;
    }

    // Reject isolated door-swing arcs anchored near a wall
    const cmds = v.commands as Array<Record<string, any>>;
    if (v.operation === 'stroke-path' && cmds.length === 2 && cmds[0]?.op === 'M' && cmds[1]?.op === 'C') {
      const p0 = { x: Number(cmds[0].x), y: Number(cmds[0].y) };
      const arc = quickCurveAngleDeg(cmds[1], p0);
      if (arc && arc.sweepDeg >= 65 && arc.sweepDeg <= 115) {
        const rM = arc.r * mPerPt;
        if (rM >= 0.55 && rM <= 1.35) {
          if (nearWallEndpoint(p0, wallGrid, pt(0.15)) || nearWallEndpoint(arc.end, wallGrid, pt(0.15))) continue;
        }
      }
    }

    // Reject single straight strokes lying directly on top of a wall face/centerline
    if (walls.length && v.points.length >= 2 && v.points.length <= 4 && overlapsWall(v.points, wallGrid, pt(0.04))) {
      continue;
    }

    preliminary.push(v);

    // Track single straight segments for hatch cluster filtering
    if (v.operation === 'stroke-path' && cmds.length === 2 && cmds[0]?.op === 'M' && cmds[1]?.op === 'L') {
      const a = { x: Number(cmds[0].x), y: Number(cmds[0].y) };
      const p = { x: Number(cmds[1].x), y: Number(cmds[1].y) };
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      const l = Math.hypot(dx, dy);
      if (l >= minTinyPt) {
        let ang = Math.atan2(dy, dx) % Math.PI;
        if (ang < 0) ang += Math.PI;
        const angleBin = Math.round((ang / Math.PI) * 36) % 36;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const mx = (a.x + p.x) / 2;
        const my = (a.y + p.y) / 2;
        straightForHatch.push({
          v,
          a,
          b: p,
          len: l,
          angleBin,
          perp: -mx * s + my * c,
          proj: mx * c + my * s,
        });
      }
    }
  }

  const hatchIds = detectParallelHatchIds(straightForHatch, mPerPt);
  return hatchIds.size ? preliminary.filter((v) => !hatchIds.has(v.id)) : preliminary;
}

// ── 2. Rectangular table-top splitting ──────────────────────────────────────

export interface RectTableSplitResult {
  tableParts: number[];
  chairParts: number[][];
}

export function findRectTableTops(
  groupStrokeIds: number[],
  strokes: readonly { lines: Vec2[][]; closed: Vec2[][]; bb: Bounds }[],
  edges: ReadonlySet<number>,
  totalStrokes: number,
  mPerPt: number,
): RectTableSplitResult | null {
  if (groupStrokeIds.length < 5) return null;
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;
  for (const s of groupStrokeIds) {
    const b = strokes[s].bb;
    if (b[0] < gx0) gx0 = b[0];
    if (b[1] < gy0) gy0 = b[1];
    if (b[2] > gx1) gx1 = b[2];
    if (b[3] > gy1) gy1 = b[3];
  }
  if (Math.max(gx1 - gx0, gy1 - gy0) * mPerPt < 1.1) return null;

  // Candidate closed rectangular/rounded-rect loop inside the group
  let bestTop: { strokeId: number; poly: Vec2[]; areaM2: number } | null = null;
  for (const s of groupStrokeIds) {
    for (const loop of strokes[s].closed) {
      if (loop.length < 4 || loop.length > 36) continue;
      const areaM2 = polygonArea(loop) * mPerPt * mPerPt;
      if (areaM2 < 0.4) continue;
      const hull = convexHullLocal(loop);
      const box = minAreaRectLocal(hull);
      const wM = box.w * mPerPt;
      const dM = box.d * mPerPt;
      if (wM < 0.6 || wM > 6.0 || dM < 0.5 || dM > 2.2) continue;
      const fill = areaM2 / Math.max(1e-6, wM * dM);
      if (fill < 0.88) continue;
      if (!bestTop || areaM2 > bestTop.areaM2) {
        bestTop = { strokeId: s, poly: loop, areaM2 };
      }
    }
  }
  if (!bestTop) return null;

  // Partition remaining strokes without the table-top stroke
  const rest = groupStrokeIds.filter((s) => s !== bestTop!.strokeId);
  if (!rest.length) return null;
  const inRest = new Set(rest);
  const parent = new Map<number, number>(rest.map((s) => [s, s]));
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (c !== r) {
      const nxt = parent.get(c)!;
      parent.set(c, r);
      c = nxt;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const key of edges) {
    const a = Math.floor(key / totalStrokes);
    const b = key % totalStrokes;
    if (inRest.has(a) && inRest.has(b)) union(a, b);
  }

  const comps = new Map<number, number[]>();
  for (const s of rest) {
    const r = find(s);
    let arr = comps.get(r);
    if (!arr) comps.set(r, (arr = []));
    arr.push(s);
  }

  const tableParts: number[] = [bestTop.strokeId];
  const chairParts: number[][] = [];
  for (const ids of comps.values()) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const s of ids) {
      const b = strokes[s].bb;
      if (b[0] < x0) x0 = b[0];
      if (b[1] < y0) y0 = b[1];
      if (b[2] > x1) x1 = b[2];
      if (b[3] > y1) y1 = b[3];
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const extM = Math.max(x1 - x0, y1 - y0) * mPerPt;
    if (pointInPolygon({ x: cx, y: cy }, bestTop.poly)) {
      tableParts.push(...ids);
    } else if (extM >= 0.32 && extM <= 0.95) {
      chairParts.push(ids);
    } else {
      tableParts.push(...ids);
    }
  }

  return chairParts.length >= 1 ? { tableParts, chairParts } : null;
}

// ── 3. Internal sub-part extraction ─────────────────────────────────────────

export function extractSymbolSubParts(input: {
  strokes: readonly SymbolStrokeInput[];
  outline: Vec2[];
  center: Vec2;
  widthM: number;
  depthM: number;
  angle: number;
  mPerPt: number;
}): PieceSubPart[] {
  const { strokes, outline, center, widthM, depthM, angle, mPerPt } = input;
  const outerAreaM2 = Math.max(0.02, polygonArea(outline) * mPerPt * mPerPt);
  const subParts: PieceSubPart[] = [];
  const resTol = 0.015 / mPerPt;

  const isInsideOuter = (pts: Vec2[]): boolean => {
    const c = polygonCentroid(pts);
    if (pointInPolygon(c, outline)) return true;
    return pts.some((p) => pointInPolygon(p, outline));
  };

  // 1. Dashed overhead elements (wall-hung upper cabinets, canopies)
  for (const st of strokes) {
    if (!st.v.dashes || st.v.dashes.length === 0) continue;
    for (const loop of st.closed) {
      const areaM2 = polygonArea(loop) * mPerPt * mPerPt;
      if (areaM2 < 0.08 || areaM2 > 6.0) continue;
      if (!isInsideOuter(loop)) continue;
      subParts.push({ role: 'overhead', outline: simplifyPoly(loop, resTol), areaM2, dashed: true });
    }
  }

  // 2. X-brace detection (two crossing diagonals in tall wardrobes / full-height cabinets)
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const vx = -uy;
  const vy = ux;
  const halfW = (widthM / mPerPt) / 2;
  const halfD = (depthM / mPerPt) / 2;
  const diag = Math.hypot(widthM / mPerPt, depthM / mPerPt);
  const nearCenterSegs: { a: Vec2; b: Vec2; ang: number }[] = [];
  for (const st of strokes) {
    for (const line of st.lines) {
      if (line.length < 2) continue;
      const a = line[0];
      const b = line[line.length - 1];
      const sl = dist(a, b);
      if (sl < diag * 0.55) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (dist(mid, center) > diag * 0.18) continue;
      // Endpoints should sit near opposite corners (non-axis-aligned relative to box)
      const daU = Math.abs((a.x - center.x) * ux + (a.y - center.y) * uy);
      const daV = Math.abs((a.x - center.x) * vx + (a.y - center.y) * vy);
      if (daU > halfW * 0.65 && daV > halfD * 0.65) {
        nearCenterSegs.push({ a, b, ang: Math.atan2(b.y - a.y, b.x - a.x) });
      }
    }
  }
  let hasXBrace = false;
  for (let i = 0; i < nearCenterSegs.length && !hasXBrace; i++) {
    for (let j = i + 1; j < nearCenterSegs.length && !hasXBrace; j++) {
      let diff = Math.abs(nearCenterSegs[i].ang - nearCenterSegs[j].ang) % Math.PI;
      if (diff > Math.PI / 2) diff = Math.PI - diff;
      if (diff >= (30 * Math.PI) / 180) {
        hasXBrace = true;
        subParts.push({
          role: 'x-brace',
          outline: [nearCenterSegs[i].a, nearCenterSegs[j].a, nearCenterSegs[i].b, nearCenterSegs[j].b],
          areaM2: outerAreaM2,
        });
      }
    }
  }

  // Gather candidate internal closed loops (excluding exact outer footprint duplicates)
  const innerLoops: { poly: Vec2[]; areaM2: number; wM: number; dM: number; center: Vec2; fill: number }[] = [];
  for (const st of strokes) {
    if (st.v.dashes && st.v.dashes.length > 0) continue;
    for (const loop of st.closed) {
      if (loop.length < 4) continue;
      const areaM2 = polygonArea(loop) * mPerPt * mPerPt;
      if (areaM2 < 0.015 || areaM2 > outerAreaM2 * 0.92) continue;
      if (!isInsideOuter(loop)) continue;
      const hull = convexHullLocal(loop);
      const box = minAreaRectLocal(hull);
      const wM = box.w * mPerPt;
      const dM = box.d * mPerPt;
      const fill = areaM2 / Math.max(1e-6, wM * dM);
      innerLoops.push({ poly: simplifyPoly(loop, resTol), areaM2, wM, dM, center: polygonCentroid(loop), fill });
    }
  }

  // 3. Bed pillows (1-2 small rectangular loops near a short end of a bed-sized rectangle)
  const isBedSized = widthM >= 1.7 && widthM <= 2.35 && depthM >= 0.75 && depthM <= 2.25;
  if (isBedSized && innerLoops.length) {
    const pillows = innerLoops.filter(
      (l) => l.wM >= 0.28 && l.wM <= 0.85 && l.dM >= 0.18 && l.dM <= 0.58 && l.fill >= 0.78 && Math.abs((l.center.x - center.x) * ux + (l.center.y - center.y) * uy) >= halfW * 0.3,
    );
    if (pillows.length >= 1 && pillows.length <= 4) {
      for (const p of pillows.slice(0, 2)) {
        subParts.push({ role: 'pillow', outline: p.poly, areaM2: p.areaM2 });
      }
    }
  }

  // 4. WC cistern + bowl cutout
  const isWcSized = widthM >= 0.48 && widthM <= 0.92 && depthM >= 0.30 && depthM <= 0.62;
  if (isWcSized && innerLoops.length >= 2) {
    const sorted = [...innerLoops].sort((a, b) => a.areaM2 - b.areaM2);
    const cistern = sorted.find((l) => l.dM >= 0.10 && l.dM <= 0.28 && l.fill >= 0.82);
    const bowl = sorted.find((l) => l !== cistern && l.wM >= 0.22 && l.wM <= 0.56 && l.areaM2 >= 0.03);
    if (cistern && bowl) {
      subParts.push({ role: 'cistern', outline: cistern.poly, areaM2: cistern.areaM2 });
      subParts.push({ role: 'cutout', outline: bowl.poly, areaM2: bowl.areaM2 });
    }
  }

  // 5. Sofa / seating cushions (2..8 similar-sized loops inside seating-depth piece)
  const hasBedPillows = subParts.some((sp) => sp.role === 'pillow');
  if (widthM >= 0.8 && (!isBedSized || depthM <= 1.15) && !hasBedPillows && innerLoops.length >= 2) {
    const cand = innerLoops.filter((l) => l.wM >= 0.25 && l.wM <= 1.15 && l.dM >= 0.25 && l.dM <= 1.1);
    if (cand.length >= 2 && cand.length <= 8) {
      const areas = cand.map((c) => c.areaM2).sort((a, b) => a - b);
      const med = areas[areas.length >> 1];
      const similar = cand.filter((c) => c.areaM2 >= med / 1.38 && c.areaM2 <= med * 1.38);
      if (similar.length >= 2) {
        for (const c of similar) {
          subParts.push({ role: 'cushion', outline: c.poly, areaM2: c.areaM2 });
        }
      }
    }
  }

  // 6. Basin / Bathtub / Sink inner cutout (if not WC and not multi-cushion seating)
  if (!subParts.some((sp) => sp.role === 'cutout' || sp.role === 'cushion')) {
    const cutouts = innerLoops
      .filter((l) => l.areaM2 >= outerAreaM2 * 0.12 && l.areaM2 <= outerAreaM2 * 0.84)
      .sort((a, b) => b.areaM2 - a.areaM2);
    if (cutouts.length >= 1 && (widthM <= 2.4 || cutouts[0].areaM2 <= 0.72)) {
      subParts.push({ role: 'cutout', outline: cutouts[0].poly, areaM2: cutouts[0].areaM2 });
    }
  }

  return subParts.slice(0, 12);
}

// ── 4. Rotation- & mirror-invariant CAD block fingerprinting ────────────────

export function computeSymbolFingerprint(input: {
  lines: readonly Vec2[][];
  center: Vec2;
  widthM: number;
  depthM: number;
  shape: string;
  hasArcs: boolean;
  mPerPt: number;
}): SymbolFingerprint {
  const bins = new Array<number>(8).fill(0);
  const maxR = Math.max(0.1 / input.mPerPt, Math.hypot(input.widthM / input.mPerPt, input.depthM / input.mPerPt) / 2);
  let total = 0;
  for (const line of input.lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const l = dist(a, b);
      if (l <= 0) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const r = Math.hypot(mx - input.center.x, my - input.center.y) / maxR;
      const idx = Math.min(7, Math.max(0, Math.floor(r * 8)));
      bins[idx] += l;
      total += l;
    }
  }
  if (total > 0) {
    for (let i = 0; i < 8; i++) bins[i] = Math.round((bins[i] / total) * 1000) / 1000;
  }
  return {
    wCm: Math.round(input.widthM * 100),
    dCm: Math.round(input.depthM * 100),
    shape: input.shape,
    hasArcs: input.hasArcs,
    radialBins: bins,
  };
}

export function clusterSymbols(
  fingerprints: readonly SymbolFingerprint[],
): { clusterId: string; clusterCount: number }[] {
  const n = fingerprints.length;
  const clusterIds = new Array<number>(n).fill(-1);
  const clusters: { rep: SymbolFingerprint; members: number[] }[] = [];

  for (let i = 0; i < n; i++) {
    const fp = fingerprints[i];
    let hit = -1;
    for (let c = 0; c < clusters.length; c++) {
      const r = clusters[c].rep;
      if (r.shape !== fp.shape) continue;
      if (Math.abs(r.wCm - fp.wCm) > 5 || Math.abs(r.dCm - fp.dCm) > 5) continue;
      let l1 = 0;
      for (let k = 0; k < 8; k++) l1 += Math.abs(r.radialBins[k] - fp.radialBins[k]);
      if (l1 <= 0.28) {
        hit = c;
        break;
      }
    }
    if (hit < 0) {
      hit = clusters.length;
      clusters.push({ rep: fp, members: [] });
    }
    clusters[hit].members.push(i);
    clusterIds[i] = hit;
  }

  return clusterIds.map((cid) => ({
    clusterId: `blk_${cid + 1}`,
    clusterCount: clusters[cid].members.length,
  }));
}

// ── 5. Room context inference & fine-grained classification ─────────────────

const ROOM_PATTERNS: [Exclude<RoomContext, null>, RegExp][] = [
  ['wc', /\b(wc|w\.c\.|toilet|restroom|bath(room)?|ensuite|en-suite|washroom|lavatory|powder\s*room|shower)\b/i],
  ['kitchen', /\b(kitchen|pantry|tea\s*point|kitchenette|bar|break\s*room|canteen|dining|cafe|cafeteria|bistro|servery)\b/i],
  ['bedroom', /\b(bed\s*room|master\s*bed|guest\s*room|suite\s*\d*|dormitory|dressing|walk[\s-]*in\s*robe|\bwir\b)\b/i],
  ['meeting', /\b(meeting|board\s*room|conference|huddle|seminar)\b/i],
  ['retail', /\b(duty[\s-]*free|boutique|retail|kiosk|merchandise|souvenir|concession|perfume|cosmetic)\b/i],
  ['reception', /\b(reception|lobby|foyer|concierge|check[\s-]*in)\b/i],
  ['lounge', /\b(lounge|living|sitting|breakout|waiting)\b/i],
  ['office', /\b(office|work\s*area|studio|open\s*plan|workstation)\b/i],
  ['storage', /\b(store|storage|closet|wardrobe|utility|archive|robe)\b/i],
];

export function inferRoomContext(
  center: Vec2,
  texts: readonly SymbolTextItem[],
  mPerPt: number,
): RoomContext {
  const maxDistPt = 4.0 / mPerPt;
  const retailDistPt = 8.0 / mPerPt;
  let bestDist = Infinity;
  let bestRoom: RoomContext = null;
  let dutyDist = Infinity;
  let freeOrShopDist = Infinity;
  for (const t of texts) {
    const tc = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
    const d = dist(center, tc);
    if (d <= retailDistPt) {
      if (/\bduty\b/i.test(t.text) && d < dutyDist) dutyDist = d;
      if (/\b(free|shop|boutique|retail)\b/i.test(t.text) && d < freeOrShopDist) freeOrShopDist = d;
    }
    if (d > maxDistPt) continue;
    for (const [room, re] of ROOM_PATTERNS) {
      if (re.test(t.text) && d < bestDist) {
        bestDist = d;
        bestRoom = room;
        break;
      }
    }
  }
  // Duty-Free rotundas often split "DUTY" / "FREE" / "SHOP" across stacked text lines up to ~8 m wide.
  const combinedRetailDist = Math.max(dutyDist, freeOrShopDist);
  if (combinedRetailDist < retailDistPt && (!bestRoom || combinedRetailDist <= bestDist * 2.2)) {
    return 'retail';
  }
  return bestRoom;
}

export interface ClassifySymbolResult {
  kind:
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
  subtype: FurnitureSubtype;
  heightM: number;
  confidence: number;
  customModel: boolean;
}

const SCREEN_LABEL = /\btv\b|screen|[eé]cran|monitor|display|advert|signage/i;
const SLAT_SCREEN_LABEL = /\b(slat|louver|louvre|privacy\s*screen|divider|mashrabiya|trellis)\b/i;
const WALL_ART_LABEL = /\b(wall\s*art(?:work)?|framed\s*art(?:work)?|art\s*work|artwork|gallery\s*(?:wall|art)|mural|bas[\s-]*relief|tapestry|painting)\b/i;
const RETAIL_KIOSK_LABEL = /\b(duty|free|kiosk|vitrine|boutique|retail|merchandise|cash\s*wrap|shop)\b/i;
const BAR_COUNTER_LABEL = /\b(bar\s*counter|beverage\s*bar|juice\s*bar|coffee\s*bar|buffet\s*counter|refreshment)\b/i;
const ISLAND_LABEL = /\b((?:kitchen|pantry|waterfall|stone|breakfast|prep|hospitality)\s*islands?|island\s*(?:unit|counter|bar)|breakfast\s*bar|\bisland\b)\b/i;
const BOOTH_LABEL = /\b(booths?|dining\s*booths?|alcove\s*(?:seat|booth)|phone\s*booth|meeting\s*pod|acoustic\s*booth|diner\s*booth)\b/i;
const BANQUETTE_LABEL = /\b(banquettes?|built[\s-]*in\s*(?:bench|seat(?:ing)?)|bench\s*seating)\b/i;
const FEATURE_COL_LABEL = /\b(column|totem|pillar|rotunda\s*core)\b/i;
const WARDROBE_LABEL = /\b(wardrobes?|closets?|armoires?|w\.?i\.?r\.?|b\.?i\.?r\.?|walk[\s-]*in|built[\s-]*in\s*robe|robes?)\b/i;
const STORAGE_LABEL = /\b(cabinet|wardrobe|closet|armoire|w\.?i\.?r\.?|b\.?i\.?r\.?|credenza|cupboard|locker|shelf|shelving|bookcase|storage|robe)\b/i;

export function classifySymbol(input: {
  family: 'furniture' | 'plant' | 'sanitary' | 'equipment' | 'joinery' | 'fixture';
  shape: 'round' | 'rect' | 'curved' | 'l-shape' | 'free';
  widthM: number;
  depthM: number;
  busy: number;
  circularity: number;
  bandM: number;
  fill: number;
  solidity: number;
  corners: number;
  label?: string;
  room?: RoomContext;
  subParts?: readonly PieceSubPart[];
  baseKind: ClassifySymbolResult['kind'] | null;
  hasWallBehind?: boolean;
  wasSplitFromTable?: boolean;
  isTableTop?: boolean;
  hasSplitChairs?: boolean;
  segmentCount?: number;
}): ClassifySymbolResult | null {
  const {
    family,
    shape,
    widthM: w,
    depthM: d,
    busy,
    circularity,
    fill,
    label,
    room,
    subParts = [],
    baseKind,
    hasWallBehind,
    wasSplitFromTable,
    isTableTop,
    hasSplitChairs,
    segmentCount = 0,
  } = input;
  const thin = d < 0.15 || input.bandM < 0.12;
  if (family === 'fixture') return null;

  const hasCistern = subParts.some((sp) => sp.role === 'cistern');
  const hasCutout = subParts.some((sp) => sp.role === 'cutout');
  const hasPillow = subParts.some((sp) => sp.role === 'pillow');
  const hasXBrace = subParts.some((sp) => sp.role === 'x-brace');
  const hasOverhead = subParts.some((sp) => sp.role === 'overhead');
  const cushionCount = subParts.filter((sp) => sp.role === 'cushion').length;

  const isCustomBase = shape === 'curved' || shape === 'l-shape' || shape === 'free' || subParts.length > 0 || w > 2.4;

  // 1. Screen / TV or wall-mounted artwork by explicit label (exclude architectural slat screens handled below)
  if (label && WALL_ART_LABEL.test(label) && w >= 0.45 && w <= 4.5 && d <= 0.35) {
    return { kind: 'screen', subtype: 'wall-art', heightM: 1.2, confidence: 0.9, customModel: true };
  }
  if (label && SCREEN_LABEL.test(label) && !SLAT_SCREEN_LABEL.test(label) && family === 'furniture') {
    return { kind: 'screen', subtype: 'screen', heightM: 0.7, confidence: 0.9, customModel: false };
  }

  // 2. Plant / Equipment families
  if (family === 'plant') {
    return { kind: 'plant', subtype: 'plant', heightM: 1.2, confidence: 0.85, customModel: false };
  }
  if (family === 'equipment') {
    return { kind: 'equipment', subtype: 'equipment', heightM: 1.2, confidence: 0.8, customModel: isCustomBase };
  }

  // 3. Strong sub-part grammars (work across both layered and layerless drawings)
  if (hasCistern && hasCutout && w >= 0.48 && w <= 0.92 && d >= 0.30 && d <= 0.62) {
    return { kind: 'sanitary', subtype: 'wc', heightM: 0.8, confidence: 0.95, customModel: true };
  }
  if (hasPillow && w >= 1.7 && w <= 2.35 && d >= 0.75 && d <= 2.25) {
    const sub: FurnitureSubtype = d >= 1.3 ? 'double-bed' : 'single-bed';
    return { kind: 'bed', subtype: sub, heightM: 0.52, confidence: 0.93, customModel: true };
  }
  if (hasXBrace && shape === 'rect' && d >= 0.32 && d <= 0.95 && w >= 0.5) {
    return { kind: 'storage', subtype: 'wardrobe', heightM: 2.1, confidence: 0.92, customModel: true };
  }
  if (hasCutout && w >= 1.35 && w <= 2.05 && d >= 0.62 && d <= 1.05 && (family === 'sanitary' || room === 'wc' || busy < 2.2)) {
    return { kind: 'sanitary', subtype: 'bathtub', heightM: 0.55, confidence: 0.88, customModel: true };
  }
  if (hasCutout && w >= 0.34 && w <= 1.05 && d >= 0.28 && d <= 0.68 && (family === 'sanitary' || room === 'wc' || room === 'kitchen')) {
    return { kind: 'sanitary', subtype: 'basin', heightM: 0.85, confidence: 0.88, customModel: true };
  }
  if (hasOverhead && (family === 'joinery' || room === 'kitchen' || d >= 0.45)) {
    return { kind: 'joinery', subtype: 'kitchen-counter', heightM: 0.9, confidence: 0.9, customModel: true };
  }

  // 3b. Free-standing architectural vertical slat / privacy screens
  const isCurvedSlatScreen =
    (shape === 'curved' || shape === 'free') &&
    input.bandM >= 0.04 &&
    input.bandM <= 0.24 &&
    d <= 0.95 &&
    d / Math.max(w, 0.01) <= 0.45 &&
    w >= 1.15 &&
    w / Math.max(input.bandM, 0.01) >= 5.0;
  const isStraightSlatScreen =
    shape !== 'curved' &&
    shape !== 'free' &&
    d >= 0.05 &&
    d <= 0.28 &&
    w >= 1.15 &&
    w / Math.max(d, 0.01) >= 5.0 &&
    (fill < 0.55 || subParts.length >= 4 || segmentCount >= 14 || Boolean(label && SLAT_SCREEN_LABEL.test(label)));
  if ((family === 'furniture' || family === 'joinery') && (isCurvedSlatScreen || isStraightSlatScreen)) {
    return { kind: 'screen', subtype: 'slat-screen', heightM: 2.5, confidence: 0.82, customModel: true };
  }

  // 4. Sanitary family (explicit layer or WC room context)
  if (family === 'sanitary' || room === 'wc') {
    if (thin && d < 0.06) return null;
    if (w >= 1.35 && w <= 2.1 && d >= 0.6 && d <= 1.05) {
      return { kind: 'sanitary', subtype: 'bathtub', heightM: 0.55, confidence: 0.85, customModel: true };
    }
    if (shape === 'rect' && w >= 0.75 && w <= 1.35 && d >= 0.75 && d <= 1.35 && Math.abs(w - d) <= 0.25 && busy >= 1.4) {
      return { kind: 'sanitary', subtype: 'shower', heightM: 2.0, confidence: 0.82, customModel: true };
    }
    if (w >= 0.45 && w <= 0.9 && d >= 0.30 && d <= 0.62 && (w / Math.max(d, 0.01) >= 1.2 || hasCistern)) {
      return { kind: 'sanitary', subtype: 'wc', heightM: 0.8, confidence: 0.82, customModel: true };
    }
    if (w <= 1.0 && d <= 0.65) {
      return { kind: 'sanitary', subtype: 'basin', heightM: 0.85, confidence: 0.78, customModel: isCustomBase };
    }
    // Inside a washroom/WC zone, oversized merged boxes (> 2.1m or deep L/curved blobs) are partitions/pipes, never sofas
    if (room === 'wc' && (w > 2.2 || d > 1.1 || shape === 'l-shape' || shape === 'curved')) return null;
    if (family === 'joinery' && d <= 0.75) {
      return { kind: 'sanitary', subtype: 'basin', heightM: 0.85, confidence: 0.76, customModel: isCustomBase };
    }
    return family === 'sanitary' ? { kind: 'sanitary', subtype: 'basin', heightM: 0.85, confidence: 0.72, customModel: isCustomBase } : null;
  }

  // 5. Joinery family
  if (family === 'joinery') {
    if (thin) return null;
    if (room === 'retail' || (label && RETAIL_KIOSK_LABEL.test(label))) {
      return { kind: 'joinery', subtype: 'retail-kiosk', heightM: 1.2, confidence: 0.88, customModel: true };
    }
    if (label && BAR_COUNTER_LABEL.test(label)) {
      return { kind: 'joinery', subtype: 'bar-counter', heightM: 1.1, confidence: 0.85, customModel: true };
    }
    if (room === 'kitchen' || hasCutout) {
      const sub: FurnitureSubtype = w >= 1.2 && d >= 0.85 && !hasWallBehind ? 'island' : 'kitchen-counter';
      return { kind: 'joinery', subtype: sub, heightM: 0.9, confidence: 0.84, customModel: true };
    }
    if (label && STORAGE_LABEL.test(label)) {
      return { kind: 'storage', subtype: 'cabinet', heightM: 1.8, confidence: 0.84, customModel: true };
    }
    return { kind: 'joinery', subtype: 'joinery', heightM: 0.9, confidence: 0.8, customModel: true };
  }

  if (thin) return null;

  // 5b. Architectural kiosks, bar counters & central retail rotunda columns
  if (
    circularity >= 0.72 &&
    w >= 0.75 &&
    w <= 2.3 &&
    d / Math.max(w, 0.01) >= 0.78 &&
    !hasSplitChairs &&
    (room === 'retail' || (label && FEATURE_COL_LABEL.test(label)))
  ) {
    return { kind: 'joinery', subtype: 'feature-column', heightM: 3.0, confidence: 0.86, customModel: true };
  }
  if (
    w >= 1.15 &&
    w <= 6.5 &&
    d >= 0.42 &&
    d <= 1.75 &&
    circularity < 0.78 &&
    (label && RETAIL_KIOSK_LABEL.test(label)
      ? true
      : room === 'retail' && cushionCount === 0 && (shape === 'curved' || shape === 'free' || shape === 'rect'))
  ) {
    return { kind: 'joinery', subtype: 'retail-kiosk', heightM: 1.2, confidence: 0.88, customModel: true };
  }
  if (label && BAR_COUNTER_LABEL.test(label) && w >= 1.6 && d >= 0.5 && d <= 1.3) {
    return { kind: 'joinery', subtype: 'bar-counter', heightM: 1.1, confidence: 0.85, customModel: true };
  }
  if (
    !hasWallBehind &&
    w >= 1.2 &&
    w <= 4.8 &&
    d >= 0.72 &&
    d <= 1.85 &&
    circularity < 0.82 &&
    ((label && ISLAND_LABEL.test(label)) ||
      (!wasSplitFromTable && room === 'kitchen' && !isTableTop && (hasCutout || (shape === 'rect' && d >= 0.82 && busy >= 1.15))) ||
      (!wasSplitFromTable && hasCutout && !hasCistern && !hasPillow && room !== 'bedroom' && d >= 0.78))
  ) {
    return { kind: 'joinery', subtype: 'island', heightM: 0.9, confidence: 0.86, customModel: true };
  }

  // 6. Explicit storage & built-in wardrobe detection (label, X-brace, or bedroom/storage wall-backed cabinet)
  const isWallBanquetteOrBooth =
    (label && (BANQUETTE_LABEL.test(label) || BOOTH_LABEL.test(label))) ||
    baseKind === 'sofa' ||
    cushionCount >= 2 ||
    (hasWallBehind && shape === 'rect' && (room === 'kitchen' || room === 'lounge') && d >= 0.48 && d <= 0.82 && w >= 1.5 && !(label && STORAGE_LABEL.test(label)));
  const isWardrobeWall = (room === 'bedroom' || room === 'storage') && hasWallBehind && d >= 0.48 && d <= 0.8 && w >= 0.85 && w <= 3.8;
  if (
    !isWallBanquetteOrBooth &&
    ((label && STORAGE_LABEL.test(label)) ||
      isWardrobeWall ||
      (hasWallBehind && shape === 'rect' && d >= 0.32 && d <= 0.72 && w >= 0.6 && w <= 3.8 && busy < 2.2))
  ) {
    const subtype: FurnitureSubtype =
      (label && WARDROBE_LABEL.test(label)) || isWardrobeWall
        ? 'wardrobe'
        : label && /shelf|shelving|bookcase/i.test(label)
          ? 'shelving'
          : w >= 1.2
            ? 'credenza'
            : 'cabinet';
    const heightM = subtype === 'wardrobe' || subtype === 'shelving' ? 2.2 : 0.95;
    return { kind: 'storage', subtype, heightM, confidence: label || isWardrobeWall ? 0.86 : 0.74, customModel: subtype === 'wardrobe' || isCustomBase };
  }

  // 7. Split table-top or chair
  if (isTableTop && family === 'furniture') {
    if (w < 0.6) return { kind: 'side-table', subtype: 'side-table', heightM: 0.5, confidence: 0.9, customModel: false };
    const subtype: FurnitureSubtype = w >= 1.8 || room === 'meeting' ? 'meeting-table' : 'dining-table';
    return { kind: 'table', subtype, heightM: 0.74, confidence: 0.9, customModel: w > 2.4 };
  }
  if (wasSplitFromTable) {
    return { kind: 'seat', subtype: w > 0.65 ? 'armchair' : 'chair', heightM: 0.45, confidence: 0.9, customModel: false };
  }

  // 8. Round shapes
  if (shape === 'round') {
    if (busy > 3 || circularity < 0.95) {
      if (w <= 0.48) return { kind: 'seat', subtype: 'stool', heightM: 0.48, confidence: 0.78, customModel: false };
      if (w <= 1.2) return { kind: 'seat', subtype: w > 0.68 ? 'armchair' : 'chair', heightM: 0.45, confidence: 0.78, customModel: false };
      return { kind: 'sofa', subtype: 'curved-sofa', heightM: 0.45, confidence: 0.76, customModel: true };
    }
    if (w < 0.6) return { kind: 'side-table', subtype: 'side-table', heightM: 0.5, confidence: 0.72, customModel: false };
    if (w <= 1.7) {
      const sub: FurnitureSubtype = room === 'lounge' && w <= 1.1 ? 'coffee-table' : room === 'meeting' ? 'meeting-table' : 'dining-table';
      return { kind: 'table', subtype: sub, heightM: sub === 'coffee-table' ? 0.42 : 0.74, confidence: 0.72, customModel: false };
    }
    return null;
  }

  // 9. Custom Booths, Banquettes, Seats & Sofas
  if (label && BOOTH_LABEL.test(label) && w >= 0.9 && d >= 0.65) {
    return { kind: 'sofa', subtype: 'booth', heightM: 1.32, confidence: 0.88, customModel: true };
  }
  if (label && BANQUETTE_LABEL.test(label) && w >= 1.0 && d >= 0.42) {
    return { kind: 'sofa', subtype: 'banquette', heightM: 0.98, confidence: 0.87, customModel: true };
  }
  if (baseKind === 'seat' || (w <= 1.1 && busy >= 2.2)) {
    const sub: FurnitureSubtype = w <= 0.46 && d <= 0.46 && busy < 2.5 ? 'stool' : w > 0.65 ? 'armchair' : 'chair';
    return { kind: 'seat', subtype: sub, heightM: 0.45, confidence: cushionCount >= 1 || busy >= 2.5 ? 0.8 : 0.68, customModel: false };
  }
  if (baseKind === 'sofa' || cushionCount >= 2 || (hasWallBehind && (room === 'kitchen' || room === 'lounge') && d >= 0.48 && d <= 0.82 && w >= 1.5)) {
    const isWallBanquette = hasWallBehind && (room === 'kitchen' || room === 'lounge') && d >= 0.48 && d <= 0.82 && w >= 1.5;
    const sub: FurnitureSubtype = isWallBanquette
      ? 'banquette'
      : shape === 'l-shape'
        ? 'l-sofa'
        : shape === 'curved'
          ? 'curved-sofa'
          : d <= 0.65 && busy < 2.2
            ? 'bench'
            : 'sofa';
    return {
      kind: 'sofa',
      subtype: sub,
      heightM: sub === 'banquette' ? 0.96 : 0.45,
      confidence: cushionCount >= 2 || shape === 'curved' || shape === 'l-shape' || isWallBanquette ? 0.86 : 0.76,
      customModel: sub === 'banquette' || sub === 'l-sofa' || sub === 'curved-sofa' || isCustomBase,
    };
  }

  // 10. Beds without detected pillow loops
  if (baseKind === 'bed') {
    const sub: FurnitureSubtype = d >= 1.3 ? 'double-bed' : 'single-bed';
    return { kind: 'bed', subtype: sub, heightM: 0.5, confidence: 0.8, customModel: false };
  }

  // 11. Tables & Desks
  if (baseKind === 'side-table') {
    return { kind: 'side-table', subtype: 'side-table', heightM: 0.5, confidence: 0.64, customModel: false };
  }
  if (baseKind === 'desk') {
    const isReception = w > 2.4 || room === 'reception';
    const sub: FurnitureSubtype = isReception ? 'reception-counter' : 'desk';
    return { kind: 'desk', subtype: sub, heightM: w > 2.4 ? 1.05 : 0.75, confidence: isReception || room === 'office' ? 0.76 : 0.62, customModel: isReception || isCustomBase };
  }
  if (baseKind === 'table') {
    const sub: FurnitureSubtype =
      room === 'lounge' && w <= 1.5
        ? 'coffee-table'
        : w >= 1.8 || room === 'meeting'
          ? 'meeting-table'
          : 'dining-table';
    return { kind: 'table', subtype: sub, heightM: sub === 'coffee-table' ? 0.42 : 0.74, confidence: room ? 0.74 : 0.6, customModel: w > 2.4 || isCustomBase };
  }

  return null;
}

/**
 * Precision gate for layerless/untagged drawings (`sourceMode === 'broad'`):
 * accepts strong symbol grammars, repeated CAD blocks across the floor, or
 * directly labelled pieces — rejecting stray room boxes and drafting clutter.
 */
export function acceptBroadCandidate(p: {
  confidence: number;
  clusterCount: number;
  label?: string;
}): boolean {
  if (p.confidence >= 0.72) return true;
  if (p.clusterCount >= 2 && p.confidence >= 0.55) return true;
  if (p.label && p.confidence >= 0.55) return true;
  return false;
}
