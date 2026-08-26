// Change Set 4 — shared 2D helpers for the evidence-only extractors.
// Relative imports only; no production package dependencies.

import type { Vec2, Segment, Bounds } from './contracts.ts';

/** Euclidean length of a segment. */
export const len = (s: Segment): number => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);

/** Direction angle of a segment in radians (-π..π]. */
export const angle = (s: Segment): number => Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);

/** Smallest undirected angle between two segments (0..π/2). */
export function angleDiff(a: Segment, b: Segment): number {
  let d = Math.abs((angle(a) - angle(b)) % Math.PI);
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

/** Perpendicular distance from point `p` to the infinite line through `s`. */
export function pointLineDistance(p: Vec2, s: Segment): number {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return Math.hypot(p.x - s.a.x, p.y - s.a.y);
  return Math.abs((p.x - s.a.x) * dy - (p.y - s.a.y) * dx) / l;
}

/** Scalar projection of `p` onto `s`, as normalized parameter t (0 at a, 1 at b). */
export function project(p: Vec2, s: Segment): number {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return 0;
  return ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / l2;
}

export const midpoint = (s: Segment): Vec2 => ({
  x: (s.a.x + s.b.x) / 2,
  y: (s.a.y + s.b.y) / 2,
});

export const boundsSize = (b: Bounds): { w: number; h: number } => ({
  w: b[2] - b[0],
  h: b[3] - b[1],
});

/** Overlap length of intervals [a0,a1] and [b0,b1] (0 when disjoint). */
export function intervalOverlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

export const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/** Consecutive-point segments of a component polyline (closing edge when closed). */
export function polylineSegments(points: Vec2[], closed: boolean): Segment[] {
  const segs: Segment[] = [];
  for (let i = 1; i < points.length; i++) segs.push({ a: points[i - 1]!, b: points[i]! });
  if (closed && points.length > 2) segs.push({ a: points[points.length - 1]!, b: points[0]! });
  return segs;
}
