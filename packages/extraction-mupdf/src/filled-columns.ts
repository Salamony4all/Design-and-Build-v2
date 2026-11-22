/**
 * Structural columns from SOLID-FILLED rectangles (geometry-only).
 *
 * Architectural plans draw structural columns as solid poche: a filled rectangle
 * sitting in the wall line (or free-standing on the grid). Furniture squares
 * (tables, bedside units) are stroked outlines, never fills, so the fill is what
 * separates a column from a table of the same size.
 *
 * A filled rectangle is ACCEPTED as a column when
 *   - it is a true rectangle with both sides in the column size band,
 *   - its fill colour is not also used for long fills (i.e. it is not wall poche),
 *   - and its centre lies inside the wall network (within the wall body, or on the
 *     wall's line just past its end, which is where corner columns sit),
 *     or it is free-standing but shares its fill colour with wall-embedded columns.
 * Anything else is REVIEW and is not installed.
 */
import type { MuVector, Vec2 } from './vector-device';

export interface FilledColumnWall {
  physicalWallId: string;
  centerline: { a: Vec2; b: Vec2 };
  thickness: number;
}

export interface FilledColumn {
  physicalColumnId: string;
  footprintType: 'RECTANGULAR';
  /** page frame in metres (point * scaleMmPerPt / 1000), same as the legacy contract */
  centreProjectM: { x: number; y: number };
  widthM: number;
  depthM: number;
  rotationRad: number;
  heightM: number;
  sourceSegmentIds: string[];
  sourceOperationIds: string[];
  verdict: 'ACCEPT' | 'REVIEW';
  evidence: string[];
}

export interface FilledColumnOptions {
  minSizeMm: number;
  maxSizeMm: number;
  maxAspect: number;
  /** a fill colour that also fills something longer than this is wall poche, not columns */
  wallFillExtentMm: number;
}

export const FILLED_COLUMN_DEFAULTS: FilledColumnOptions = {
  minSizeMm: 150,
  maxSizeMm: 1500,
  maxAspect: 6,
  wallFillExtentMm: 3000,
};

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function hashId(parts: Array<string | number>): string {
  const s = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `col_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

interface Ring { pts: Vec2[]; vectorId: string; colourKey: string }

function fillRings(vectors: MuVector[]): Ring[] {
  const out: Ring[] = [];
  for (const v of vectors) {
    if (v.operation !== 'fill-path') continue;
    if (v.alpha !== undefined && v.alpha <= 0.05) continue;
    const col = v.color ?? [];
    if (!col.length || col.every((c) => c > 0.97)) continue; // white / paper fills
    const colourKey = col.map((c) => c.toFixed(2)).join(',');
    const rings = v.subpaths && v.subpaths.length ? v.subpaths : [v.points];
    for (const r of rings) if (r && r.length >= 3) out.push({ pts: r, vectorId: v.id, colourKey });
  }
  return out;
}

/** 4 distinct corners, opposite sides equal, adjacent sides perpendicular. */
function asRectangle(pts: Vec2[]): { centre: Vec2; a: number; b: number; angle: number } | null {
  const p = pts.slice();
  if (p.length === 5 && dist(p[0]!, p[4]!) < 0.05) p.pop();
  if (p.length !== 4) return null;
  const e = [0, 1, 2, 3].map((i) => ({ x: p[(i + 1) % 4]!.x - p[i]!.x, y: p[(i + 1) % 4]!.y - p[i]!.y }));
  const len = e.map((v) => Math.hypot(v.x, v.y));
  if (len.some((l) => l < 0.5)) return null;
  if (Math.abs(len[0]! - len[2]!) > 0.03 * len[0]! || Math.abs(len[1]! - len[3]!) > 0.03 * len[1]!) return null;
  for (let i = 0; i < 4; i++) {
    const u = e[i]!, w = e[(i + 1) % 4]!;
    if (Math.abs(u.x * w.x + u.y * w.y) > 0.03 * len[i]! * len[(i + 1) % 4]!) return null;
  }
  const centre = { x: (p[0]!.x + p[2]!.x) / 2, y: (p[0]!.y + p[2]!.y) / 2 };
  let angle = Math.atan2(e[0]!.y, e[0]!.x);
  let a = len[0]!, b = len[1]!;
  // normalise so an axis-aligned rectangle reports rotation 0 with a = x-extent
  while (angle > Math.PI / 4) { angle -= Math.PI / 2; [a, b] = [b, a]; }
  while (angle <= -Math.PI / 4) { angle += Math.PI / 2; [a, b] = [b, a]; }
  if (Math.abs(angle) < 1e-4) angle = 0;
  return { centre, a, b, angle };
}

export function detectFilledColumns(
  vectors: MuVector[],
  walls: FilledColumnWall[],
  scaleMmPerPt: number,
  options: Partial<FilledColumnOptions> = {},
): FilledColumn[] {
  const o = { ...FILLED_COLUMN_DEFAULTS, ...options };
  const rings = fillRings(vectors);
  // longest fill per colour: a colour that also fills long shapes is wall poche
  const maxExtentMm = new Map<string, number>();
  for (const r of rings) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of r.pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const ext = Math.max(maxX - minX, maxY - minY) * scaleMmPerPt;
    maxExtentMm.set(r.colourKey, Math.max(maxExtentMm.get(r.colourKey) ?? 0, ext));
  }

  type Cand = { rect: NonNullable<ReturnType<typeof asRectangle>>; ring: Ring; ids: Set<string>; embedded: boolean };
  const cands = new Map<string, Cand>();
  for (const ring of rings) {
    const rect = asRectangle(ring.pts);
    if (!rect) continue;
    const aMm = rect.a * scaleMmPerPt, bMm = rect.b * scaleMmPerPt;
    const lo = Math.min(aMm, bMm), hi = Math.max(aMm, bMm);
    if (lo < o.minSizeMm || hi > o.maxSizeMm || hi / lo > o.maxAspect) continue;
    const key = `${rect.centre.x.toFixed(1)},${rect.centre.y.toFixed(1)},${Math.min(rect.a, rect.b).toFixed(1)},${Math.max(rect.a, rect.b).toFixed(1)}`;
    const prev = cands.get(key);
    if (prev) { prev.ids.add(ring.vectorId); continue; }
    // wall-embedded: centre inside the wall body, or on the wall line just past an end
    let embedded = false;
    for (const w of walls) {
      const A = w.centerline.a, B = w.centerline.b;
      const L = dist(A, B);
      if (L < 1e-6) continue;
      const u = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
      const along = (rect.centre.x - A.x) * u.x + (rect.centre.y - A.y) * u.y;
      const across = Math.abs((rect.centre.x - A.x) * u.y - (rect.centre.y - A.y) * u.x);
      // extent of the rectangle along / across this wall
      const ca = Math.abs(Math.cos(rect.angle) * u.x + Math.sin(rect.angle) * u.y);
      const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
      const extAlong = rect.a * ca + rect.b * sa;
      const extAcross = rect.a * sa + rect.b * ca;
      if (across > Math.max(w.thickness, extAcross) / 2) continue;
      if (along < -extAlong || along > L + extAlong) continue;
      embedded = true;
      break;
    }
    cands.set(key, { rect, ring, ids: new Set([ring.vectorId]), embedded });
  }

  const embeddedColours = new Set<string>();
  for (const c of cands.values()) if (c.embedded) embeddedColours.add(c.ring.colourKey);

  const out: FilledColumn[] = [];
  for (const c of cands.values()) {
    const evidence = ['solid-filled-rectangle', `fill=${c.ring.colourKey}`];
    let verdict: 'ACCEPT' | 'REVIEW' = 'REVIEW';
    if ((maxExtentMm.get(c.ring.colourKey) ?? 0) > o.wallFillExtentMm) evidence.push('fill-colour-also-used-for-long-fills');
    else if (c.embedded) { verdict = 'ACCEPT'; evidence.push('in-wall-network'); }
    else if (embeddedColours.has(c.ring.colourKey)) { verdict = 'ACCEPT'; evidence.push('free-standing-same-fill-as-wall-columns'); }
    else evidence.push('free-standing-no-structural-witness');
    const k = scaleMmPerPt / 1000;
    const ids = [...c.ids].sort();
    out.push({
      physicalColumnId: hashId([c.rect.centre.x.toFixed(2), c.rect.centre.y.toFixed(2), c.rect.a.toFixed(2), c.rect.b.toFixed(2)]),
      footprintType: 'RECTANGULAR',
      centreProjectM: { x: c.rect.centre.x * k, y: c.rect.centre.y * k },
      widthM: c.rect.a * k,
      depthM: c.rect.b * k,
      rotationRad: c.rect.angle,
      heightM: 3,
      sourceSegmentIds: ids,
      sourceOperationIds: ids,
      verdict,
      evidence,
    });
  }
  out.sort((x, y) => x.centreProjectM.y - y.centreProjectM.y || x.centreProjectM.x - y.centreProjectM.x);
  return out;
}
