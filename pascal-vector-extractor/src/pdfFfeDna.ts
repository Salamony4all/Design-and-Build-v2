import type { Vec2 } from './types';
import type { DnaProfile } from './pdfFfeTypes';

const area = (v: readonly Vec2[]) =>
  Math.abs(
    v.reduce((s, p, i) => {
      const q = v[(i + 1) % v.length]!;
      return s + p.x * q.y - q.x * p.y;
    }, 0)
  ) / 2;

const perimeter = (v: readonly Vec2[]) =>
  v.reduce((s, p, i) => {
    const q = v[(i + 1) % v.length]!;
    return s + Math.hypot(q.x - p.x, q.y - p.y);
  }, 0);

const q = (v: number, n = 6) => Number(v.toFixed(n)).toString();

export function deduplicateVertices(pts: readonly Vec2[], tol = 1e-4): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    if (out.length === 0 || Math.hypot(p.x - out[out.length - 1]!.x, p.y - out[out.length - 1]!.y) > tol) {
      out.push(p);
    }
  }
  if (out.length > 2 && Math.hypot(out[0]!.x - out[out.length - 1]!.x, out[0]!.y - out[out.length - 1]!.y) <= tol) {
    out.pop();
  }
  return out;
}

export function simplifyCollinear(pts: readonly Vec2[], tol = 1e-3): Vec2[] {
  if (pts.length <= 3) return [...pts];
  const out: Vec2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const curr = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const cross = Math.abs((curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x));
    if (cross > tol) {
      out.push(curr);
    }
  }
  return out.length >= 3 ? out : [...pts];
}

export function normalizeWinding(pts: readonly Vec2[]): Vec2[] {
  let signedArea = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const qPt = pts[(i + 1) % pts.length]!;
    signedArea += p.x * qPt.y - qPt.x * p.y;
  }
  // Enforce CCW orientation (positive signed area)
  return signedArea < 0 ? [...pts].reverse() : [...pts];
}

export function canonicalizeRing(rawPts: readonly Vec2[]): Vec2[] {
  const dedup = deduplicateVertices(rawPts);
  const simplified = simplifyCollinear(dedup);
  const ccw = normalizeWinding(simplified);

  if (ccw.length === 0) return [];

  // Find lexicographically smallest vertex as canonical start
  let minIdx = 0;
  for (let i = 1; i < ccw.length; i++) {
    if (ccw[i]!.x < ccw[minIdx]!.x || (ccw[i]!.x === ccw[minIdx]!.x && ccw[i]!.y < ccw[minIdx]!.y)) {
      minIdx = i;
    }
  }

  return [...ccw.slice(minIdx), ...ccw.slice(0, minIdx)];
}

function lexMin(a: readonly string[]): string {
  let best = '';
  for (let k = 0; k < a.length; k++) {
    const s = [...a.slice(k), ...a.slice(0, k)].join(';');
    if (k === 0 || s < best) best = s;
  }
  return best;
}

function boundaryTokens(v: readonly Vec2[]): string[] {
  const p = perimeter(v);
  if (p === 0) return [];
  return v.map((x, i) => {
    const prev = v[(i - 1 + v.length) % v.length]!;
    const next = v[(i + 1) % v.length]!;
    const a = { x: prev.x - x.x, y: prev.y - x.y };
    const b = { x: next.x - x.x, y: next.y - x.y };
    const la = Math.hypot(a.x, a.y);
    const lb = Math.hypot(b.x, b.y);
    const ang = Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (la * lb || 1))));
    return `${q(ang)}|${q(lb / p)}`;
  });
}

export function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = BigInt.asUintN(64, h * 0x100000001b3n);
  }
  return `topo64:${h.toString(16).padStart(16, '0')}`;
}

export function topologicalDna(
  perimeterLoop: readonly Vec2[],
  hull: readonly Vec2[],
  L: number,
  W: number,
  nestedLoops: readonly (readonly Vec2[])[] = []
): DnaProfile {
  const cPerimeter = canonicalizeRing(perimeterLoop);
  const cHull = canonicalizeRing(hull);
  const cNested = nestedLoops.map(canonicalizeRing).sort((a, b) => area(b) - area(a));

  const A = area(cPerimeter);
  const P = perimeter(cPerimeter);
  const HA = area(cHull);
  const aspect = L / Math.max(W, 1e-9);
  const compact = (4 * Math.PI * A) / Math.max(P * P, 1e-9);
  const sol = A / Math.max(HA, 1e-9);

  const f = lexMin(boundaryTokens(cPerimeter));
  const r = lexMin(boundaryTokens([...cPerimeter].reverse()));
  const cyclic = f < r ? f : r;

  const canonical = `ar=${q(aspect)}|iso=${q(compact)}|sol=${q(sol)}|loops=${cNested.length}|seq=${cyclic}`;
  return {
    aspectRatio: aspect,
    compactness: compact,
    solidity: sol,
    nestedLoopCount: cNested.length,
    cyclicTokens: cyclic.split(';'),
    canonical,
    hash: fnv1a64(canonical),
  };
}
