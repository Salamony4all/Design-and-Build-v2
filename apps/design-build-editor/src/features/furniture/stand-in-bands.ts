// features/furniture/stand-in-bands.ts
// The parts that show which way a furniture stand-in faces: boxes along the edges of
// its traced footprint (a raised back, a headboard, a desk's modesty and end panels).

import * as THREE from 'three';

/** What the bands need of a piece: its footprint and centre in plan metres (x, y = Pascal z). */
export interface BandPiece {
  outlineM: { x: number; y: number }[];
  centerM: { x: number; y: number };
  widthM: number;
  depthM: number;
}

/** Outline edges facing backwards (their outward side against the front). */
export const BACK = (d: number) => d < -0.5;
/** Outline edges along the sides. */
export const SIDE = (d: number) => Math.abs(d) <= 0.5;

/**
 * Boxes standing along the outline edges whose outward side `pick` accepts (by its
 * dot product with the facing direction, a plan angle): each runs the length of its
 * edge and `thick` inwards, from height `from` to `to`, around the piece's centre.
 */
export function edgeBands(p: BandPiece, facing: number, pick: (d: number) => boolean, thick: number, from: number, to: number, material: THREE.Material): THREE.Mesh[] {
  const pts = p.outlineM.map((q) => ({ x: q.x - p.centerM.x, y: q.y - p.centerM.y }));
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  const out: THREE.Mesh[] = [];
  const f = { x: Math.cos(facing), y: Math.sin(facing) };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.03) continue;
    const d = { x: dx / len, y: dy / len };
    const n = area > 0 ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x }; // outward
    if (!pick(n.x * f.x + n.y * f.y)) continue;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len + Math.min(thick, 0.04), to - from, thick), material);
    mesh.position.set((a.x + b.x) / 2 - (n.x * thick) / 2, (from + to) / 2, (a.y + b.y) / 2 - (n.y * thick) / 2);
    mesh.rotation.y = Math.atan2(-d.y, d.x);
    out.push(mesh);
  }
  return out;
}

/** Depth of the piece along its facing direction (a plan angle), metres. */
export function depthAlong(p: BandPiece, facing: number): number {
  const fx = Math.cos(facing);
  const fy = Math.sin(facing);
  let lo = Infinity;
  let hi = -Infinity;
  for (const q of p.outlineM) {
    const s = (q.x - p.centerM.x) * fx + (q.y - p.centerM.y) * fy;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return Number.isFinite(hi - lo) ? hi - lo : Math.min(p.widthM, p.depthM);
}
