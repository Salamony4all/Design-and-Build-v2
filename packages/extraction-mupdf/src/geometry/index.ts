/** Geometry helpers (ported from mupdf-wall-vision-js/geometry.js). Pure math. */
import type { Bounds, Vec2 } from '../vector-device';

export const rectArea = (r: Bounds): number => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
export const rectWidth = (r: Bounds): number => r[2] - r[0];
export const rectHeight = (r: Bounds): number => r[3] - r[1];
export const intersects = (a: Bounds, b: Bounds): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
export const contains = (r: Bounds, p: Vec2): boolean => p.x >= r[0] && p.x <= r[2] && p.y >= r[1] && p.y <= r[3];

export function dedupePoints(points: Vec2[], tol = 0.01): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const q = out.at(-1);
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > tol) out.push(p);
  }
  return out;
}

/** A filled path is an axis-aligned rectangle if every vertex sits on one of its bbox edges. */
export function isAxisRect(v: { points: Vec2[]; bounds: Bounds }, tol = 1.5): boolean {
  const p = dedupePoints(v.points);
  if (p.length < 4) return false;
  const r = v.bounds, w = rectWidth(r), h = rectHeight(r);
  if (w <= 0 || h <= 0) return false;
  return p.every((x) =>
    Math.min(Math.abs(x.x - r[0]), Math.abs(x.x - r[2])) <= tol ||
    Math.min(Math.abs(x.y - r[1]), Math.abs(x.y - r[3])) <= tol);
}

/** Medial centerline of an axis-aligned rectangle. */
export function medial(r: Bounds): { a: Vec2; b: Vec2; thickness: number } {
  const w = rectWidth(r), h = rectHeight(r);
  return w >= h
    ? { a: { x: r[0], y: (r[1] + r[3]) / 2 }, b: { x: r[2], y: (r[1] + r[3]) / 2 }, thickness: h }
    : { a: { x: (r[0] + r[2]) / 2, y: r[1] }, b: { x: (r[0] + r[2]) / 2, y: r[3] }, thickness: w };
}

export function pointSegmentDistance(p: Vec2, s: { a: Vec2; b: Vec2 }): number {
  const vx = s.b.x - s.a.x, vy = s.b.y - s.a.y, l2 = vx * vx + vy * vy;
  if (!l2) return Math.hypot(p.x - s.a.x, p.y - s.a.y);
  const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * vx + (p.y - s.a.y) * vy) / l2));
  return Math.hypot(p.x - (s.a.x + t * vx), p.y - (s.a.y + t * vy));
}

/** Perpendicular distance from point p to line through s. */
export function perpendicularDistance(p: Vec2, s: { a: Vec2; b: Vec2 }): number {
  return pointSegmentDistance(p, s);
}
