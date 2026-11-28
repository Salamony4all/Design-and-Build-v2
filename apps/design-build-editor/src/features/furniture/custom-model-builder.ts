// features/furniture/custom-model-builder.ts
// Production-grade procedural 3D furniture & fixture builder from MuPDF-extracted
// footprints, facing directions, and internal vector sub-parts (overhead cabinets,
// basin/tub/sink cutouts, WC cisterns, bed pillows, sofa cushions).
// Pure Three.js — runs in both browser and Node/Vitest without WebGL/DOM.

import * as THREE from 'three';
import { BACK, SIDE, depthAlong, edgeBands } from './stand-in-bands';

/** Height of the coloured pad under a BOQ product photo, in metres. */
export const PAD_TOP_M = 0.03;

export interface CustomModelSubPart {
  role: string;
  outlineM: { x: number; y: number }[];
  dashed?: boolean;
}

export type MaterialFinishPreset =
  | 'wood'
  | 'fluted-wood'
  | 'stone'
  | 'marble'
  | 'terrazzo'
  | 'boucle'
  | 'leather'
  | 'velvet'
  | 'matte-lacquer'
  | 'brushed-metal';

export interface CustomModelRecipe {
  v: 1;
  kind: string;
  subtype?: string;
  shape: string;
  widthM: number;
  depthM: number;
  heightM: number;
  angle: number;
  facing?: number;
  centerM: { x: number; y: number };
  outlineM: { x: number; y: number }[];
  subParts?: CustomModelSubPart[];
  tint?: string;
  accentTint?: string;
  tertiaryTint?: string;
  materialPreset?: MaterialFinishPreset;
  glassDoors?: boolean;
  pad?: boolean;
}

interface Look {
  body: string;
  accent: string;
  secondary: string;
}

function materialPropsOf(preset?: MaterialFinishPreset): { roughness: number; metalness: number } {
  switch (preset) {
    case 'marble':
    case 'stone':
      return { roughness: 0.24, metalness: 0.04 };
    case 'terrazzo':
      return { roughness: 0.38, metalness: 0.03 };
    case 'boucle':
    case 'velvet':
      return { roughness: 0.92, metalness: 0.01 };
    case 'leather':
      return { roughness: 0.48, metalness: 0.03 };
    case 'fluted-wood':
    case 'wood':
      return { roughness: 0.64, metalness: 0.04 };
    case 'matte-lacquer':
      return { roughness: 0.52, metalness: 0.05 };
    case 'brushed-metal':
      return { roughness: 0.32, metalness: 0.72 };
    default:
      return { roughness: 0.76, metalness: 0.04 };
  }
}

function lookOf(kind: string, subtype?: string, tint?: string, accentTint?: string, tertiaryTint?: string): Look {
  if (tint) {
    return {
      body: tint,
      accent: accentTint || '#6d665f',
      secondary: tertiaryTint || accentTint || '#dcd6cd',
    };
  }
  const key = subtype || kind;
  switch (key) {
    case 'chair':
    case 'armchair':
    case 'stool':
    case 'seat':
    case 'sofa':
    case 'l-sofa':
    case 'curved-sofa':
    case 'bench':
      return { body: '#e7e1d8', accent: '#756e67', secondary: '#dcd4c8' };
    case 'booth':
    case 'banquette':
      return { body: '#d5cbb9', accent: '#5d3f2e', secondary: '#c9beab' };
    case 'wall-art':
      return { body: '#d8cdbf', accent: '#36322d', secondary: '#a9553c' };
    case 'table':
    case 'side-table':
    case 'coffee-table':
    case 'dining-table':
    case 'meeting-table':
      return { body: '#d8cdbf', accent: '#6e665e', secondary: '#c5b8a7' };
    case 'desk':
    case 'reception-counter':
      return { body: '#dfd6ca', accent: '#787068', secondary: '#c8bfb3' };
    case 'retail-kiosk':
    case 'bar-counter':
      return { body: '#7c563a', accent: '#8c6f47', secondary: '#d8cfc0' };
    case 'feature-column':
      return { body: '#7c563a', accent: '#8c6f47', secondary: '#63432c' };
    case 'slat-screen':
      return { body: '#785236', accent: '#8c6f47', secondary: '#5e3f28' };
    case 'bed':
    case 'single-bed':
    case 'double-bed':
      return { body: '#efeae2', accent: '#8e857c', secondary: '#f8f6f2' };
    case 'wardrobe':
      return { body: '#7a5a42', accent: '#2c2926', secondary: '#c9b18f' };
    case 'island':
      return { body: '#75533a', accent: '#8a6d46', secondary: '#ece8df' };
    case 'storage':
    case 'cabinet':
    case 'credenza':
    case 'shelving':
    case 'joinery':
    case 'kitchen-counter':
      return { body: '#e5dfd6', accent: '#78726a', secondary: '#d2cac0' };
    case 'plant':
      return { body: '#6f9a63', accent: '#9b8e80', secondary: '#557a4b' };
    case 'screen':
      return { body: '#1f2328', accent: '#3a3f46', secondary: '#111418' };
    case 'sanitary':
    case 'wc':
    case 'basin':
    case 'bathtub':
    case 'shower':
    case 'urinal':
      return { body: '#f7f7f5', accent: '#b7bcc2', secondary: '#dde1e6' };
    case 'equipment':
    case 'appliance':
      return { body: '#c9ced6', accent: '#767d87', secondary: '#aeb5bf' };
    default:
      return { body: '#ece8e2', accent: '#8f8880', secondary: '#dad4cc' };
  }
}

const stdMat = (color: string, roughness = 0.78, metalness = 0.04) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function polyArea2D(pts: readonly { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(s) / 2;
}

/** Remove duplicate or ultra-close vertices (< 2 mm) and guard against degenerate polygons. */
export function sanitizeOutline(pts: readonly { x: number; y: number }[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= 0.002) {
      out.push({ x: p.x, y: p.y });
    }
  }
  if (out.length >= 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 0.002) {
    out.pop();
  }
  if (out.length < 3 || polyArea2D(out) < 1e-4) return [];
  return out;
}

function shapeFromPts(pts: readonly { x: number; y: number }[], center: { x: number; y: number }): THREE.Shape {
  return new THREE.Shape(pts.map((q) => new THREE.Vector2(q.x - center.x, -(q.y - center.y))));
}

function canBevel(pts: readonly { x: number; y: number }[], height: number): boolean {
  if (height < 0.04 || pts.length < 3 || pts.length > 48) return false;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length];
    const b = pts[i];
    const c = pts[(i + 1) % pts.length];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    if (l1 < 0.025 || l2 < 0.025) return false;
  }
  return true;
}

export function safeExtrude(
  pts: readonly { x: number; y: number }[],
  center: { x: number; y: number },
  fromY: number,
  toY: number,
  material: THREE.Material,
  bevel = false,
): THREE.Mesh | null {
  const clean = sanitizeOutline(pts);
  if (!clean.length) return null;
  const h = Math.max(0.01, toY - fromY);
  const shape = shapeFromPts(clean, center);
  const useBevel = bevel && canBevel(clean, h);
  let geom: THREE.ExtrudeGeometry;
  try {
    if (useBevel) {
      const bt = Math.min(0.012, h * 0.25);
      const bs = 0.01;
      geom = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.005, h - 2 * bt),
        bevelEnabled: true,
        bevelThickness: bt,
        bevelSize: bs,
        bevelSegments: 2,
        curveSegments: 1,
      });
      geom.rotateX(-Math.PI / 2);
      geom.translate(0, fromY + bt, 0);
    } else {
      geom = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
      geom.rotateX(-Math.PI / 2);
      geom.translate(0, fromY, 0);
    }
  } catch {
    geom = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
    geom.rotateX(-Math.PI / 2);
    geom.translate(0, fromY, 0);
  }
  return new THREE.Mesh(geom, material);
}

/** Dispose every unique geometry and material inside a Three.js object tree. */
export function disposeObject3D(root: THREE.Object3D): void {
  const geoms = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) geoms.add(mesh.geometry);
    if (Array.isArray(mesh.material)) {
      for (const m of mesh.material) if (m) mats.add(m);
    } else if (mesh.material) {
      mats.add(mesh.material);
    }
  });
  for (const g of geoms) g.dispose();
  for (const m of mats) m.dispose();
}

export function recipeSignature(r: CustomModelRecipe): string {
  const qPt = (q: { x: number; y: number }) =>
    `${Math.round((q.x - r.centerM.x) * 200)},${Math.round((q.y - r.centerM.y) * 200)}`;
  const pts = r.outlineM.map(qPt).join(';');
  const subs = (r.subParts ?? [])
    .map((sp) => `${sp.role}${sp.dashed ? ':d' : ''}:${sp.outlineM.map(qPt).join(',')}`)
    .join('|');
  const facing = typeof r.facing === 'number' && Number.isFinite(r.facing) ? Math.round(r.facing * 1000) : 'none';
  return `v${r.v}|${r.kind}|${r.subtype ?? ''}|${Math.round(r.heightM * 100)}|${r.tint ?? ''}|${r.accentTint ?? ''}|${r.tertiaryTint ?? ''}|${r.materialPreset ?? ''}|${r.glassDoors ? 'glass' : 'solid'}|${r.pad ? 'pad' : 'body'}|${Math.round(r.angle * 1000)}|${facing}|${pts}|${subs}`;
}

function addIf(group: THREE.Group, mesh: THREE.Mesh | null) {
  if (mesh) group.add(mesh);
}

function addAll(group: THREE.Group, meshes: readonly THREE.Object3D[]) {
  for (const m of meshes) group.add(m);
}

function insetRectCorners(w: number, d: number, inset: number, angle: number): [number, number][] {
  const hw = Math.max(0.05, w / 2 - inset);
  const hd = Math.max(0.05, d / 2 - inset);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rot = (x: number, y: number): [number, number] => [x * c - y * s, x * s + y * c];
  return [rot(-hw, -hd), rot(hw, -hd), rot(hw, hd), rot(-hw, hd)];
}

function fallbackBox(r: CustomModelRecipe, fromY: number, toY: number, mat: THREE.Material): THREE.Mesh {
  const h = Math.max(0.01, toY - fromY);
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.1, r.widthM), h, Math.max(0.1, r.depthM)), mat);
  m.position.y = fromY + h / 2;
  m.rotation.y = -r.angle;
  return m;
}

/**
 * Build a multi-part Three.js model centred on `recipe.centerM`, standing on `y = 0`.
 * With `pad: true`, returns only the thin coloured pad for BOQ photo cutouts.
 */
function chaikinSmooth(pts: readonly { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 5) return [...pts];
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
    out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  return out;
}

export function buildCustomFurnitureGroup(recipe: CustomModelRecipe): THREE.Group {
  const group = new THREE.Group();
  const subtype = recipe.subtype;
  const look = lookOf(recipe.kind, subtype, recipe.tint, recipe.accentTint, recipe.tertiaryTint);
  let clean = sanitizeOutline(recipe.outlineM);
  if (recipe.shape === 'curved' && clean.length >= 6 && clean.length <= 40) {
    clean = sanitizeOutline(chaikinSmooth(clean));
  }
  const bandPiece = {
    outlineM: clean.length >= 3 ? clean : recipe.outlineM,
    centerM: recipe.centerM,
    widthM: recipe.widthM,
    depthM: recipe.depthM,
  };

  if (recipe.pad) {
    const pad = safeExtrude(clean, recipe.centerM, 0, PAD_TOP_M, stdMat(look.body, 0.7)) ?? fallbackBox(recipe, 0, PAD_TOP_M, stdMat(look.body, 0.7));
    group.add(pad);
    return group;
  }

  const facing = typeof recipe.facing === 'number' && Number.isFinite(recipe.facing) ? recipe.facing : null;
  const short = Math.max(0.2, Math.min(recipe.widthM, recipe.depthM));
  const long = Math.max(0.2, Math.max(recipe.widthM, recipe.depthM));
  const subParts = recipe.subParts ?? [];
  const pbr = materialPropsOf(recipe.materialPreset);
  const bodyMat = stdMat(look.body, pbr.roughness, pbr.metalness);
  const accentMat = stdMat(
    look.accent,
    recipe.materialPreset === 'brushed-metal' ? 0.3 : 0.45,
    recipe.materialPreset === 'brushed-metal' ? 0.78 : 0.25,
  );
  const secMat = stdMat(
    look.secondary,
    recipe.materialPreset === 'marble' || recipe.materialPreset === 'stone' || subtype === 'island' ? 0.24 : pbr.roughness,
    pbr.metalness,
  );

  // ── 1. Tables & Coffee/Side/Meeting/Dining Tables ─────────────────────────
  if (
    recipe.kind === 'table' ||
    recipe.kind === 'side-table' ||
    subtype === 'coffee-table' ||
    subtype === 'dining-table' ||
    subtype === 'meeting-table' ||
    subtype === 'side-table'
  ) {
    const defaultH = subtype === 'coffee-table' ? 0.42 : recipe.kind === 'side-table' || subtype === 'side-table' ? 0.5 : 0.74;
    const h = recipe.heightM > 0.25 && recipe.heightM <= 1.2 ? recipe.heightM : defaultH;
    const top = safeExtrude(clean, recipe.centerM, h - 0.04, h, stdMat(look.body, 0.55), true) ?? fallbackBox(recipe, h - 0.04, h, stdMat(look.body, 0.55));
    group.add(top);

    const legH = Math.max(0.05, h - 0.04);
    if (recipe.shape !== 'round' && long > 2.2) {
      // Twin pedestals for long conference / dining tables
      const offset = long * 0.28;
      const ux = Math.cos(recipe.angle);
      const uz = Math.sin(recipe.angle);
      for (const sgn of [-1, 1]) {
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, legH, 16), accentMat);
        ped.position.set(sgn * offset * ux, legH / 2, sgn * offset * uz);
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(0.26, short * 0.28), Math.min(0.28, short * 0.3), 0.025, 20), accentMat);
        foot.position.set(sgn * offset * ux, 0.0125, sgn * offset * uz);
        group.add(ped, foot);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(offset * 2, 0.04, 0.05), accentMat);
      rail.position.y = Math.min(0.25, legH * 0.45);
      rail.rotation.y = -recipe.angle;
      group.add(rail);
    } else if (recipe.shape === 'rect' && long > 1.35) {
      // 4 inset corner legs rotated along the table's axis
      const corners = insetRectCorners(recipe.widthM, recipe.depthM, Math.min(0.12, short * 0.18), recipe.angle);
      for (const [lx, lz] of corners) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, legH, 12), accentMat);
        leg.position.set(lx, legH / 2, lz);
        group.add(leg);
      }
    } else {
      // Central pedestal + base disc
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, legH, 16), accentMat);
      stem.position.y = legH / 2;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(0.28, short * 0.3), Math.min(0.28, short * 0.3), 0.02, 24), accentMat);
      base.position.y = 0.01;
      group.add(stem, base);
    }
    return group;
  }

  // ── 2. Plants ─────────────────────────────────────────────────────────────
  if (recipe.kind === 'plant' || subtype === 'plant') {
    const r = short / 2;
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.42, 0.36, 20), accentMat);
    pot.position.y = 0.18;
    const foliageMat = stdMat(look.body, 0.88, 0);
    const main = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.85, 1), foliageMat);
    main.scale.set(1, 1.18, 1);
    main.position.y = 0.36 + r * 0.82;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.55, 1), stdMat(look.secondary, 0.9, 0));
    crown.position.set(r * 0.2, 0.36 + r * 1.25, -r * 0.15);
    group.add(pot, main, crown);
    return group;
  }

  // ── 3. Screens & Architectural Vertical Slat Privacy Screens ────────────────
  if (subtype === 'slat-screen') {
    const h = recipe.heightM >= 1.2 ? recipe.heightM : 2.5;
    const ux = Math.cos(recipe.angle);
    const uz = Math.sin(recipe.angle);
    const vx = -uz;
    const vz = ux;
    // Derive centerline spine across outline in local piece coordinates so curved screens follow their exact arc
    const spine: { x: number; z: number }[] = [];
    if (clean.length >= 4) {
      const bins = new Map<number, { u: number; sumV: number; n: number }>();
      const binSize = Math.max(0.08, long / 18);
      for (const p of clean) {
        const dx = p.x - recipe.centerM.x;
        const dz = p.y - recipe.centerM.y;
        const u = dx * ux + dz * uz;
        const v = dx * vx + dz * vz;
        const b = Math.round(u / binSize);
        const cur = bins.get(b) ?? { u: 0, sumV: 0, n: 0 };
        cur.u += u;
        cur.sumV += v;
        cur.n += 1;
        bins.set(b, cur);
      }
      const ordered = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, cur]) => {
        const u = cur.u / cur.n;
        const v = cur.sumV / cur.n;
        return { x: ux * u + vx * v, z: uz * u + vz * v };
      });
      if (ordered.length >= 2) spine.push(...ordered);
    }
    if (spine.length < 2) {
      const hw = long / 2;
      spine.push({ x: -ux * hw, z: -uz * hw }, { x: ux * hw, z: uz * hw });
    }
    let totalLen = 0;
    const cum: number[] = [0];
    for (let i = 1; i < spine.length; i++) {
      totalLen += Math.hypot(spine[i].x - spine[i - 1].x, spine[i].z - spine[i - 1].z);
      cum.push(totalLen);
    }
    const sampleAt = (s: number) => {
      for (let i = 1; i < spine.length; i++) {
        if (s <= cum[i] || i === spine.length - 1) {
          const span = Math.max(1e-5, cum[i] - cum[i - 1]);
          const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / span));
          const x = spine[i - 1].x + (spine[i].x - spine[i - 1].x) * t;
          const z = spine[i - 1].z + (spine[i].z - spine[i - 1].z) * t;
          const ang = Math.atan2(spine[i].z - spine[i - 1].z, spine[i].x - spine[i - 1].x);
          return { x, z, ang };
        }
      }
      return { x: spine[0].x, z: spine[0].z, ang: recipe.angle };
    };
    const slatCount = Math.max(4, Math.min(64, Math.round(totalLen / 0.095)));
    const slatDepth = Math.min(0.14, Math.max(0.055, short * 0.72));
    const slatH = Math.max(0.8, h - 0.05);
    const slatGeo = new THREE.BoxGeometry(0.032, slatH, slatDepth);
    for (let i = 0; i < slatCount; i++) {
      const pt = sampleAt((i / Math.max(1, slatCount - 1)) * totalLen);
      const slat = new THREE.Mesh(slatGeo, bodyMat);
      slat.position.set(pt.x, 0.025 + slatH / 2, pt.z);
      slat.rotation.y = -pt.ang;
      group.add(slat);
    }
    for (let i = 1; i < spine.length; i++) {
      const dx = spine[i].x - spine[i - 1].x;
      const dz = spine[i].z - spine[i - 1].z;
      const segL = Math.hypot(dx, dz);
      if (segL < 0.02) continue;
      const railGeo = new THREE.BoxGeometry(segL + 0.02, 0.028, slatDepth + 0.015);
      const ang = Math.atan2(dz, dx);
      for (const y of [0.014, h - 0.014]) {
        const rail = new THREE.Mesh(railGeo, accentMat);
        rail.position.set((spine[i - 1].x + spine[i].x) / 2, y, (spine[i - 1].z + spine[i].z) / 2);
        rail.rotation.y = -ang;
        group.add(rail);
      }
    }
    group.userData.architecturalLock = true;
    return group;
  }

  if (subtype === 'wall-art') {
    const artW = Math.min(4.2, Math.max(0.55, long));
    const artH = Math.min(1.5, Math.max(0.75, recipe.heightM || 1.15));
    const mountBottom = 0.92;
    const holder = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(artW, artH, 0.045), accentMat);
    frame.position.y = mountBottom + artH / 2;
    const canvas = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.3, artW - 0.07), Math.max(0.3, artH - 0.07), 0.02), bodyMat);
    canvas.position.set(0, mountBottom + artH / 2, 0.016);
    holder.add(frame, canvas);
    const ribCount = Math.max(3, Math.min(9, Math.round(artW / 0.24)));
    const ribGeo = new THREE.BoxGeometry(0.022, Math.max(0.25, artH - 0.14), 0.016);
    for (let i = 0; i < ribCount; i++) {
      const rx = -artW * 0.36 + (i / Math.max(1, ribCount - 1)) * (artW * 0.72);
      const rib = new THREE.Mesh(ribGeo, secMat);
      rib.position.set(rx, mountBottom + artH / 2, 0.028);
      holder.add(rib);
    }
    holder.rotation.y = facing !== null ? Math.PI / 2 - facing : -recipe.angle;
    group.add(holder);
    group.userData.architecturalLock = true;
    return group;
  }

  if (recipe.kind === 'screen' || subtype === 'screen') {
    const len = recipe.widthM;
    const tall = len > 2 ? 1.6 : Math.min(1.1, len * 0.5625);
    const bottom = len > 2 ? 0.6 : 1.05;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(len, tall, 0.045), bodyMat);
    bezel.position.y = bottom + tall / 2;
    const display = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.1, len - 0.04), Math.max(0.1, tall - 0.04), 0.015), accentMat);
    display.position.set(0, bottom + tall / 2, 0.02);
    const holder = new THREE.Group();
    holder.add(bezel, display);
    holder.rotation.y = facing !== null ? Math.PI / 2 - facing : -recipe.angle;
    group.add(holder);
    return group;
  }

  // ── 3b. Free-Standing Feature Columns & Duty-Free / Retail Kiosks ─────────
  if (subtype === 'feature-column') {
    const h = recipe.heightM >= 2.0 ? recipe.heightM : 3.0;
    const r = Math.max(0.22, Math.min(1.15, short / 2 - 0.02));
    const core = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32), bodyMat);
    core.position.y = h / 2;
    group.add(core);
    const flutes = 24;
    const ribGeo = new THREE.BoxGeometry(0.028, h - 0.22, 0.024);
    for (let i = 0; i < flutes; i++) {
      const a = (i / flutes) * Math.PI * 2;
      const rib = new THREE.Mesh(ribGeo, secMat);
      rib.position.set(Math.cos(a) * (r + 0.008), h / 2, Math.sin(a) * (r + 0.008));
      rib.rotation.y = -a;
      group.add(rib);
    }
    const baseCollar = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.025, r + 0.028, 0.12, 32), accentMat);
    baseCollar.position.y = 0.06;
    const midTrim = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.022, r + 0.022, 0.045, 32), accentMat);
    midTrim.position.y = 1.04;
    const crownGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(r + 0.026, r + 0.026, 0.06, 32),
      new THREE.MeshStandardMaterial({ color: '#ffdfa8', emissive: '#ffbe6b', emissiveIntensity: 0.45, roughness: 0.35 }),
    );
    crownGlow.position.y = h - 0.04;
    group.add(baseCollar, midTrim, crownGlow);
    group.userData.architecturalLock = true;
    return group;
  }

  if (subtype === 'retail-kiosk' || subtype === 'bar-counter') {
    const isKiosk = subtype === 'retail-kiosk';
    const deckH = isKiosk ? 0.90 : Math.min(1.08, Math.max(0.92, recipe.heightM || 1.05));
    const totalH = isKiosk ? Math.max(deckH + 0.26, recipe.heightM || 1.22) : deckH;
    const plinth = safeExtrude(clean, recipe.centerM, 0, 0.08, accentMat) ?? fallbackBox(recipe, 0, 0.08, accentMat);
    const body = safeExtrude(clean, recipe.centerM, 0.08, deckH - 0.04, bodyMat, true) ?? fallbackBox(recipe, 0.08, deckH - 0.04, bodyMat);
    const deck = safeExtrude(clean, recipe.centerM, deckH - 0.04, deckH, secMat, true) ?? fallbackBox(recipe, deckH - 0.04, deckH, secMat);
    group.add(plinth, body, deck);

    // Architectural vertical flute slats around kiosk/bar apron
    if (clean.length >= 4) {
      let perim = 0;
      for (let i = 0; i < clean.length; i++) {
        const a = clean[i];
        const b = clean[(i + 1) % clean.length];
        perim += Math.hypot(b.x - a.x, b.y - a.y);
      }
      const ribStep = Math.max(0.11, perim / 44);
      const ribH = Math.max(0.4, deckH - 0.14);
      const ribGeo = new THREE.BoxGeometry(0.018, ribH, 0.02);
      let acc = 0;
      let placedRibs = 0;
      for (let i = 0; i < clean.length && placedRibs < 48; i++) {
        const a = clean[i];
        const b = clean[(i + 1) % clean.length];
        const dx = b.x - a.x;
        const dz = b.y - a.y;
        const segL = Math.hypot(dx, dz);
        if (segL < 0.02) continue;
        acc += segL;
        if (acc >= ribStep) {
          acc = 0;
          placedRibs++;
          const mx = (a.x + b.x) / 2 - recipe.centerM.x;
          const mz = (a.y + b.y) / 2 - recipe.centerM.y;
          const rib = new THREE.Mesh(ribGeo, bodyMat);
          rib.position.set(mx, 0.08 + ribH / 2, mz);
          rib.rotation.y = -Math.atan2(dz, dx);
          group.add(rib);
        }
      }
    }

    // Upper illuminated display vitrine case on retail kiosks
    if (isKiosk && totalH > deckH + 0.08) {
      const vitrineGlassMat = new THREE.MeshStandardMaterial({
        color: '#d8eef5',
        roughness: 0.08,
        metalness: 0.1,
        opacity: 0.34,
        transparent: true,
        depthWrite: false,
      });
      const vitrine = safeExtrude(clean, recipe.centerM, deckH, totalH - 0.02, vitrineGlassMat) ?? fallbackBox(recipe, deckH, totalH - 0.02, vitrineGlassMat);
      const topRail = safeExtrude(clean, recipe.centerM, totalH - 0.025, totalH, accentMat) ?? fallbackBox(recipe, totalH - 0.025, totalH, accentMat);
      const ledStrip = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.2, long * 0.72), 0.015, Math.max(0.15, short * 0.45)),
        new THREE.MeshStandardMaterial({ color: '#ffdfa8', emissive: '#ffbe6b', emissiveIntensity: 0.4, roughness: 0.4 }),
      );
      ledStrip.position.y = deckH + 0.008;
      ledStrip.rotation.y = -recipe.angle;
      group.add(vitrine, topRail, ledStrip);
    }
    group.userData.architecturalLock = true;
    return group;
  }

  // ── 4. Seating (booth, banquette, stool, chair, armchair, bench, sofa) ────
  if (subtype === 'booth' || subtype === 'banquette') {
    const isBooth = subtype === 'booth';
    const shroudH = isBooth ? Math.max(1.22, recipe.heightM || 1.32) : Math.max(0.92, recipe.heightM || 0.98);
    const plinth = safeExtrude(clean, recipe.centerM, 0, 0.08, accentMat) ?? fallbackBox(recipe, 0, 0.08, accentMat);
    const seatBase = safeExtrude(clean, recipe.centerM, 0.08, 0.35, bodyMat, true) ?? fallbackBox(recipe, 0.08, 0.35, bodyMat);
    const cushionDeck = safeExtrude(clean, recipe.centerM, 0.35, 0.45, secMat, true) ?? fallbackBox(recipe, 0.35, 0.45, secMat);
    group.add(plinth, seatBase, cushionDeck);

    const effFacing = facing !== null ? facing : recipe.angle + Math.PI / 2;
    const depth = depthAlong(bandPiece, effFacing);
    const backThick = Math.min(0.22, Math.max(0.11, depth * 0.16));
    addAll(group, edgeBands(bandPiece, effFacing, BACK, backThick, 0.08, shroudH, bodyMat));
    if (isBooth || recipe.shape === 'l-shape' || recipe.shape === 'curved') {
      const wingThick = Math.min(0.16, Math.max(0.09, short * 0.1));
      addAll(group, edgeBands(bandPiece, effFacing, SIDE, wingThick, 0.08, shroudH, bodyMat));
    }

    // Channel-tufted vertical backrest flutes spaced ~0.18 m along back spine
    const ux = Math.cos(recipe.angle);
    const uz = Math.sin(recipe.angle);
    const fx = Math.cos(effFacing);
    const fz = Math.sin(effFacing);
    const backOffset = Math.max(0.12, depth / 2 - backThick - 0.012);
    const ribCount = Math.max(4, Math.min(28, Math.round((long - 0.16) / 0.18)));
    const ribH = Math.max(0.32, shroudH - 0.5);
    const ribGeo = new THREE.BoxGeometry(0.032, ribH, 0.035);
    for (let i = 0; i < ribCount; i++) {
      const along = -long * 0.42 + (i / Math.max(1, ribCount - 1)) * (long * 0.84);
      const rib = new THREE.Mesh(ribGeo, secMat);
      rib.position.set(ux * along - fx * backOffset, 0.45 + ribH / 2, uz * along - fz * backOffset);
      rib.rotation.y = Math.PI / 2 - effFacing;
      group.add(rib);
    }

    if (isBooth && short >= 1.25 && long >= 1.45 && !subParts.some((sp) => sp.role === 'cutout')) {
      const tblW = Math.max(0.55, long * 0.48);
      const tblD = Math.max(0.5, short * 0.42);
      const tableTop = new THREE.Mesh(new THREE.BoxGeometry(tblW, 0.035, tblD), accentMat);
      tableTop.position.set(fx * (depth * 0.06), 0.7375, fz * (depth * 0.06));
      tableTop.rotation.y = -recipe.angle;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.72, 14), accentMat);
      stem.position.set(fx * (depth * 0.06), 0.36, fz * (depth * 0.06));
      group.add(tableTop, stem);
    }
    group.userData.architecturalLock = true;
    return group;
  }

  if (
    recipe.kind === 'seat' ||
    recipe.kind === 'sofa' ||
    subtype === 'chair' ||
    subtype === 'armchair' ||
    subtype === 'stool' ||
    subtype === 'sofa' ||
    subtype === 'l-sofa' ||
    subtype === 'curved-sofa' ||
    subtype === 'bench'
  ) {
    const isStool = subtype === 'stool';
    const isBench = subtype === 'bench';
    const isCompactChair = (recipe.kind === 'seat' || subtype === 'chair') && long <= 0.72 && !isStool;
    if (isStool) {
      const h = recipe.heightM > 0.35 ? recipe.heightM : 0.48;
      const pan = safeExtrude(clean, recipe.centerM, h - 0.05, h, bodyMat, true) ?? fallbackBox(recipe, h - 0.05, h, bodyMat);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, h - 0.05, 14), accentMat);
      stem.position.y = (h - 0.05) / 2;
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(0.18, short * 0.4), Math.min(0.2, short * 0.45), 0.02, 18), accentMat);
      foot.position.y = 0.01;
      group.add(pan, stem, foot);
      return group;
    }

    if (isCompactChair) {
      // 4 legs + beveled seat pan + raised back
      const legs = insetRectCorners(recipe.widthM, recipe.depthM, 0.05, recipe.angle);
      for (const [lx, lz] of legs) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.41, 10), accentMat);
        leg.position.set(lx, 0.205, lz);
        group.add(leg);
      }
      const seat = safeExtrude(clean, recipe.centerM, 0.4, 0.46, bodyMat, true) ?? fallbackBox(recipe, 0.4, 0.46, bodyMat);
      group.add(seat);
      if (facing !== null) {
        const depth = depthAlong(bandPiece, facing);
        const thick = Math.min(0.14, Math.max(0.08, depth * 0.18));
        addAll(group, edgeBands(bandPiece, facing, BACK, thick, 0.45, 0.82, bodyMat));
      }
      return group;
    }

    // Lounge armchair / sofa / L-sofa / curved sofa / bench
    const plinth = safeExtrude(clean, recipe.centerM, 0, 0.07, accentMat) ?? fallbackBox(recipe, 0, 0.07, accentMat);
    const base = safeExtrude(clean, recipe.centerM, 0.07, 0.34, bodyMat, true) ?? fallbackBox(recipe, 0.07, 0.34, bodyMat);
    group.add(plinth, base);

    const cushions = subParts.filter((sp) => sp.role === 'cushion');
    if (cushions.length >= 2) {
      for (const c of cushions) {
        addIf(group, safeExtrude(c.outlineM, recipe.centerM, 0.34, 0.44, secMat, true));
      }
    } else {
      const seatDeck = safeExtrude(clean, recipe.centerM, 0.34, 0.43, secMat, true) ?? fallbackBox(recipe, 0.34, 0.43, secMat);
      group.add(seatDeck);
    }

    if (facing !== null && !isBench) {
      const depth = depthAlong(bandPiece, facing);
      const backThick = recipe.kind === 'seat' ? Math.min(0.18, Math.max(0.12, depth * 0.2)) : Math.min(0.25, Math.max(0.15, depth * 0.22));
      const backTop = recipe.kind === 'seat' ? 0.82 : 0.78;
      addAll(group, edgeBands(bandPiece, facing, BACK, backThick, 0.42, backTop, bodyMat));
      if (subtype !== 'chair') {
        const armThick = Math.min(0.16, Math.max(0.09, short * 0.14));
        addAll(group, edgeBands(bandPiece, facing, SIDE, armThick, 0.42, 0.62, bodyMat));
      }
    }
    return group;
  }

  // ── 5. Desks & Reception Counters ─────────────────────────────────────────
  if (recipe.kind === 'desk' || subtype === 'desk' || subtype === 'reception-counter') {
    const isReception = subtype === 'reception-counter' || recipe.widthM > 2.4;
    if (isReception) {
      const plinth = safeExtrude(clean, recipe.centerM, 0, 0.08, accentMat) ?? fallbackBox(recipe, 0, 0.08, accentMat);
      const body = safeExtrude(clean, recipe.centerM, 0.08, 0.75, bodyMat, true) ?? fallbackBox(recipe, 0.08, 0.75, bodyMat);
      group.add(plinth, body);
      if (facing !== null) {
        addAll(group, edgeBands(bandPiece, facing, BACK, 0.28, 0.75, 1.06, bodyMat));
        addAll(group, edgeBands(bandPiece, facing, BACK, 0.32, 1.06, 1.09, secMat));
      } else {
        const cap = safeExtrude(clean, recipe.centerM, 0.75, 1.05, bodyMat, true) ?? fallbackBox(recipe, 0.75, 1.05, bodyMat);
        group.add(cap);
      }
      return group;
    }
    if (facing === null) {
      const desk = safeExtrude(clean, recipe.centerM, 0, 0.75, bodyMat, true) ?? fallbackBox(recipe, 0, 0.75, bodyMat);
      group.add(desk);
      return group;
    }
    const top = safeExtrude(clean, recipe.centerM, 0.71, 0.75, bodyMat, true) ?? fallbackBox(recipe, 0.71, 0.75, bodyMat);
    group.add(top);
    addAll(group, edgeBands(bandPiece, facing, BACK, 0.025, 0.3, 0.71, secMat));
    addAll(group, edgeBands(bandPiece, facing, SIDE, 0.03, 0, 0.71, accentMat));
    return group;
  }

  // ── 6. Beds ───────────────────────────────────────────────────────────────
  if (recipe.kind === 'bed' || subtype === 'single-bed' || subtype === 'double-bed') {
    const frame = safeExtrude(clean, recipe.centerM, 0.05, 0.26, accentMat) ?? fallbackBox(recipe, 0.05, 0.26, accentMat);
    const mattress = safeExtrude(clean, recipe.centerM, 0.26, 0.52, bodyMat, true) ?? fallbackBox(recipe, 0.26, 0.52, bodyMat);
    group.add(frame, mattress);
    if (facing !== null) {
      addAll(group, edgeBands(bandPiece, facing, BACK, 0.07, 0, 1.05, accentMat));
    }
    const pillows = subParts.filter((sp) => sp.role === 'pillow');
    if (pillows.length) {
      for (const p of pillows) {
        addIf(group, safeExtrude(p.outlineM, recipe.centerM, 0.52, 0.64, secMat, true));
      }
    } else if (facing !== null) {
      // Synthesize 1 or 2 pillows near the headboard
      const count = short >= 1.3 ? 2 : 1;
      const depth = depthAlong(bandPiece, facing);
      const backDist = Math.max(0.25, depth / 2 - 0.28);
      const fx = Math.cos(facing);
      const fz = Math.sin(facing);
      const sx = -fz;
      const sz = fx;
      for (let i = 0; i < count; i++) {
        const lat = count === 1 ? 0 : (i === 0 ? -1 : 1) * Math.min(0.36, short * 0.23);
        const pil = new THREE.Mesh(new THREE.BoxGeometry(Math.min(0.62, short * 0.42), 0.11, 0.36), secMat);
        pil.position.set(-fx * backDist + sx * lat, 0.575, -fz * backDist + sz * lat);
        pil.rotation.y = Math.PI / 2 - facing;
        group.add(pil);
      }
    }
    return group;
  }

  // ── 7. Sanitary (WC, Basin, Bathtub, Shower, Urinal) ──────────────────────
  if (
    recipe.kind === 'sanitary' ||
    subtype === 'wc' ||
    subtype === 'basin' ||
    subtype === 'bathtub' ||
    subtype === 'shower' ||
    subtype === 'urinal'
  ) {
    if (subtype === 'shower') {
      const tray = safeExtrude(clean, recipe.centerM, 0, 0.08, bodyMat, true) ?? fallbackBox(recipe, 0, 0.08, bodyMat);
      group.add(tray);
      const glassMat = new THREE.MeshStandardMaterial({
        color: '#cce4ee',
        roughness: 0.1,
        metalness: 0.1,
        transparent: true,
        opacity: 0.35,
      });
      if (facing !== null) {
        addAll(group, edgeBands(bandPiece, facing, BACK, 0.025, 0.08, 2.05, glassMat));
        addAll(group, edgeBands(bandPiece, facing, SIDE, 0.025, 0.08, 2.05, glassMat));
      } else {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(recipe.widthM, 1.97, 0.025), glassMat);
        panel.position.y = 0.08 + 1.97 / 2;
        panel.rotation.y = -recipe.angle;
        group.add(panel);
      }
      const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 16), accentMat);
      drain.position.y = 0.085;
      group.add(drain);
      return group;
    }

    if (subtype === 'wc') {
      const base = safeExtrude(clean, recipe.centerM, 0, 0.18, secMat) ?? fallbackBox(recipe, 0, 0.18, secMat);
      group.add(base);
      const bowlSub = subParts.find((sp) => sp.role === 'cutout');
      const bowl = bowlSub
        ? safeExtrude(bowlSub.outlineM, recipe.centerM, 0.18, 0.42, bodyMat, true)
        : safeExtrude(clean, recipe.centerM, 0.18, 0.42, bodyMat, true);
      addIf(group, bowl);
      const cisternSub = subParts.find((sp) => sp.role === 'cistern');
      if (cisternSub) {
        addIf(group, safeExtrude(cisternSub.outlineM, recipe.centerM, 0.35, 0.8, bodyMat, true));
      } else if (facing !== null) {
        addAll(group, edgeBands(bandPiece, facing, BACK, 0.16, 0.35, 0.8, bodyMat));
      }
      return group;
    }

    if (subtype === 'bathtub') {
      const tub = safeExtrude(clean, recipe.centerM, 0, 0.55, bodyMat, true) ?? fallbackBox(recipe, 0, 0.55, bodyMat);
      group.add(tub);
      const cavitySub = subParts.find((sp) => sp.role === 'cutout');
      if (cavitySub) {
        addIf(group, safeExtrude(cavitySub.outlineM, recipe.centerM, 0.48, 0.555, secMat));
      }
      return group;
    }

    // Basin / Vanity / Generic sanitary
    const base = safeExtrude(clean, recipe.centerM, 0, 0.78, secMat) ?? fallbackBox(recipe, 0, 0.78, secMat);
    const rim = safeExtrude(clean, recipe.centerM, 0.78, 0.85, bodyMat, true) ?? fallbackBox(recipe, 0.78, 0.85, bodyMat);
    group.add(base, rim);
    const bowlSub = subParts.find((sp) => sp.role === 'cutout');
    if (bowlSub) {
      addIf(group, safeExtrude(bowlSub.outlineM, recipe.centerM, 0.82, 0.855, accentMat));
    }
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.14, 10), accentMat);
    if (facing !== null) {
      const d = depthAlong(bandPiece, facing);
      tap.position.set(-Math.cos(facing) * (d * 0.35), 0.92, -Math.sin(facing) * (d * 0.35));
    } else {
      tap.position.y = 0.92;
    }
    group.add(tap);
    return group;
  }

  // ── 8. Wardrobes, Kitchen Islands, Storage & Custom Joinery ───────────────
  if (subtype === 'wardrobe') {
    const h = recipe.heightM >= 1.7 ? recipe.heightM : 2.25;
    const carcassMat = bodyMat;
    const plinth = safeExtrude(clean, recipe.centerM, 0, 0.07, accentMat) ?? fallbackBox(recipe, 0, 0.07, accentMat);
    const carcass = safeExtrude(clean, recipe.centerM, 0.07, h - 0.04, carcassMat) ?? fallbackBox(recipe, 0.07, h - 0.04, carcassMat);
    const cornice = safeExtrude(clean, recipe.centerM, h - 0.04, h, secMat, true) ?? fallbackBox(recipe, h - 0.04, h, secMat);
    group.add(plinth, carcass, cornice);

    const effFacing = facing !== null ? facing : recipe.angle + Math.PI / 2;
    const depth = Math.max(0.35, depthAlong(bandPiece, effFacing));
    const doorCount = Math.max(2, Math.min(8, Math.round(long / 0.55)));
    const doorW = (long - 0.02 * (doorCount + 1)) / doorCount;
    const doorH = Math.max(1.4, h - 0.14);
    const doorMat = recipe.glassDoors
      ? new THREE.MeshStandardMaterial({
          color: '#7e7060',
          roughness: 0.14,
          metalness: 0.2,
          opacity: 0.38,
          transparent: true,
        })
      : secMat;

    const fx = Math.cos(effFacing);
    const fz = Math.sin(effFacing);
    const ux = -fz;
    const uz = fx;
    const frontOff = depth / 2 + 0.009;
    const doorRotY = Math.PI / 2 - effFacing;

    if (recipe.glassDoors) {
      const shelfGeo = new THREE.BoxGeometry(Math.max(0.4, long - 0.06), 0.022, Math.max(0.28, depth - 0.08));
      for (const y of [0.45, 0.9, 1.35, 1.8]) {
        if (y >= h - 0.15) continue;
        const shelf = new THREE.Mesh(shelfGeo, secMat);
        shelf.position.y = y;
        shelf.rotation.y = doorRotY;
        group.add(shelf);
      }
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, Math.max(0.4, long - 0.08), 10), accentMat);
      rail.rotation.order = 'YXZ';
      rail.rotation.y = doorRotY;
      rail.rotation.z = Math.PI / 2;
      rail.position.y = h - 0.28;
      group.add(rail);
    }

    const leafGeo = new THREE.BoxGeometry(Math.max(0.25, doorW), doorH, 0.018);
    const pullGeo = new THREE.BoxGeometry(0.016, 0.85, 0.024);
    for (let i = 0; i < doorCount; i++) {
      const along = -long / 2 + 0.02 + doorW / 2 + i * (doorW + 0.02);
      const leaf = new THREE.Mesh(leafGeo, doorMat);
      leaf.position.set(fx * frontOff + ux * along, 0.08 + doorH / 2, fz * frontOff + uz * along);
      leaf.rotation.y = doorRotY;
      group.add(leaf);

      const handleOffset = (i % 2 === 0 ? 1 : -1) * Math.max(0.06, doorW * 0.36);
      const pull = new THREE.Mesh(pullGeo, accentMat);
      pull.position.set(
        fx * (frontOff + 0.02) + ux * (along + handleOffset),
        Math.min(h - 0.55, 1.08),
        fz * (frontOff + 0.02) + uz * (along + handleOffset),
      );
      pull.rotation.y = doorRotY;
      group.add(pull);
    }

    group.userData.architecturalLock = true;
    return group;
  }

  if (subtype === 'island') {
    const h = recipe.heightM >= 0.8 && recipe.heightM <= 1.15 ? recipe.heightM : 0.9;
    const ux = Math.cos(recipe.angle);
    const uz = Math.sin(recipe.angle);
    const vx = -uz;
    const vz = ux;
    const overhang = Math.min(0.24, short * 0.24);
    const cabDepth = Math.max(0.45, short - overhang);
    const cabLen = Math.max(0.8, long - 0.09);

    // Recessed plinth + fluted cabinetry core shifted back to leave seating knee overhang
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(cabLen - 0.08, 0.08, Math.max(0.38, cabDepth - 0.06)), accentMat);
    plinth.position.set(-vx * (overhang / 2), 0.04, -vz * (overhang / 2));
    plinth.rotation.y = -recipe.angle;
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(cabLen, h - 0.125, cabDepth), bodyMat);
    cabinet.position.set(-vx * (overhang / 2), 0.08 + (h - 0.125) / 2, -vz * (overhang / 2));
    cabinet.rotation.y = -recipe.angle;
    group.add(plinth, cabinet);

    // Architectural vertical flutes along front apron
    const fluteCount = Math.max(6, Math.min(36, Math.round(cabLen / 0.1)));
    const fluteGeo = new THREE.BoxGeometry(0.022, h - 0.15, 0.018);
    const frontDist = cabDepth / 2 - overhang / 2 + 0.009;
    for (let i = 0; i < fluteCount; i++) {
      const along = -cabLen * 0.47 + (i / Math.max(1, fluteCount - 1)) * (cabLen * 0.94);
      const flute = new THREE.Mesh(fluteGeo, bodyMat);
      flute.position.set(ux * along + vx * frontDist, 0.08 + (h - 0.125) / 2, uz * along + vz * frontDist);
      flute.rotation.y = -recipe.angle;
      group.add(flute);
    }

    // Mitered stone/marble top slab + twin full-height waterfall stone end-slabs
    const stoneMat = stdMat(look.secondary, 0.24, 0.04);
    const topSlab = safeExtrude(clean, recipe.centerM, h - 0.045, h, stoneMat, true) ?? fallbackBox(recipe, h - 0.045, h, stoneMat);
    group.add(topSlab);
    const legGeo = new THREE.BoxGeometry(0.045, h, short);
    for (const sgn of [-1, 1]) {
      const wf = new THREE.Mesh(legGeo, stoneMat);
      wf.position.set(sgn * ux * (long / 2 - 0.0225), h / 2, sgn * uz * (long / 2 - 0.0225));
      wf.rotation.y = -recipe.angle;
      group.add(wf);
    }

    const cutouts = subParts.filter((sp) => sp.role === 'cutout');
    if (cutouts.length > 0) {
      for (const cut of cutouts) {
        addIf(group, safeExtrude(cut.outlineM, recipe.centerM, h - 0.01, h + 0.008, accentMat));
      }
      const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.24, 10), accentMat);
      tap.position.set(-vx * (short * 0.18), h + 0.12, -vz * (short * 0.18));
      group.add(tap);
    } else {
      const hob = new THREE.Mesh(new THREE.BoxGeometry(Math.min(0.75, cabLen * 0.3), 0.01, Math.min(0.48, cabDepth * 0.55)), accentMat);
      hob.position.set(ux * (long * 0.16), h + 0.005, uz * (long * 0.16));
      hob.rotation.y = -recipe.angle;
      const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.24, 10), accentMat);
      tap.position.set(-ux * (long * 0.16), h + 0.12, -uz * (long * 0.16));
      group.add(hob, tap);
    }

    group.userData.architecturalLock = true;
    return group;
  }

  if (
    recipe.kind === 'storage' ||
    recipe.kind === 'joinery' ||
    subtype === 'cabinet' ||
    subtype === 'credenza' ||
    subtype === 'shelving' ||
    subtype === 'kitchen-counter'
  ) {
    const h = recipe.heightM > 0.3 ? recipe.heightM : subtype === 'wardrobe' || subtype === 'shelving' ? 2.1 : 0.9;
    const plinth = safeExtrude(clean, recipe.centerM, 0, 0.08, accentMat) ?? fallbackBox(recipe, 0, 0.08, accentMat);
    const carcass = safeExtrude(clean, recipe.centerM, 0.08, Math.max(0.15, h - 0.03), bodyMat) ?? fallbackBox(recipe, 0.08, Math.max(0.15, h - 0.03), bodyMat);
    const cap = safeExtrude(clean, recipe.centerM, Math.max(0.15, h - 0.03), h, secMat, true) ?? fallbackBox(recipe, Math.max(0.15, h - 0.03), h, secMat);
    group.add(plinth, carcass, cap);

    // Wall-hung upper cabinets from dashed overhead CAD lines
    for (const ov of subParts.filter((sp) => sp.role === 'overhead')) {
      addIf(group, safeExtrude(ov.outlineM, recipe.centerM, 1.45, 2.15, secMat, true));
    }

    // Recessed sink / hob cutouts in kitchen counters or islands
    for (const cut of subParts.filter((sp) => sp.role === 'cutout')) {
      addIf(group, safeExtrude(cut.outlineM, recipe.centerM, h - 0.005, h + 0.008, accentMat));
    }
    return group;
  }

  // ── 9. Equipment / Default fallback ───────────────────────────────────────
  const defaultH = recipe.kind === 'equipment' ? 1.2 : Math.max(0.3, recipe.heightM || 0.6);
  const body = safeExtrude(clean, recipe.centerM, 0, defaultH, bodyMat, true) ?? fallbackBox(recipe, 0, defaultH, bodyMat);
  group.add(body);
  return group;
}

export type CeilingCanopyStyle = 'slatted-ring' | 'baffle-cloud' | 'recessed-cove';

export interface CeilingCanopyInput {
  id: string;
  shape: 'round' | 'oval' | 'polygon' | string;
  centerM: { x: number; y: number };
  widthM: number;
  depthM: number;
  radiusM?: number;
  innerRadiiM?: number[];
  outlineM: { x: number; y: number }[];
  wallTopM?: number;
  dropM?: number;
  style?: CeilingCanopyStyle;
  primaryHex?: string;
  accentHex?: string;
}

/**
 * Build an architectural suspended decorative ceiling assembly (circular slatted canopy,
 * acoustic wood/felt baffle cloud, or stepped recessed LED gypsum bulkhead) anchored at
 * `y = wallTopM` hanging down by `dropM`. Tagged with `userData.architecturalLock = true`
 * so `captureModelPasses` keeps its silhouette edges in Image 2.
 */
export function buildCeilingCanopyMesh(input: CeilingCanopyInput): THREE.Group {
  const group = new THREE.Group();
  const wallTop = input.wallTopM ?? 3.0;
  const dropM = Math.min(0.55, Math.max(0.14, input.dropM ?? 0.28));
  const style: CeilingCanopyStyle =
    input.style ?? (input.shape === 'round' || input.shape === 'oval' ? 'slatted-ring' : 'baffle-cloud');
  const primaryMat = stdMat(input.primaryHex || '#7c563a', 0.68, 0.05);
  const accentMat = stdMat(input.accentHex || '#8c6f47', 0.36, 0.65);
  const coveMat = new THREE.MeshStandardMaterial({
    color: '#ffe4b5',
    emissive: '#ffbe6b',
    emissiveIntensity: 0.55,
    roughness: 0.35,
  });

  group.position.set(input.centerM.x, wallTop, input.centerM.y);
  group.userData = {
    architecturalLock: true,
    architecturalKind: 'ceiling-canopy',
    ceilingFeatureId: input.id,
    ceilingStyle: style,
  };

  const rx = Math.max(0.9, (input.radiusM ?? input.widthM / 2));
  const rz = Math.max(0.9, (input.radiusM ?? input.depthM / 2));

  if (style === 'slatted-ring') {
    const outerR = Math.max(rx, rz);
    const innerRingR = Math.max(0.7, Math.min(outerR * 0.65, input.innerRadiiM?.[0] ?? outerR * 0.32));
    const scaleZ = outerR > 0 ? rz / outerR : 1;

    // Outer metallic fascia drum ring
    const outerRingShape = new THREE.Shape();
    outerRingShape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
    const outerHole = new THREE.Path();
    outerHole.absarc(0, 0, Math.max(innerRingR + 0.1, outerR - 0.1), 0, Math.PI * 2, true);
    outerRingShape.holes.push(outerHole);
    const fasciaGeo = new THREE.ExtrudeGeometry(outerRingShape, { depth: dropM, bevelEnabled: false, curveSegments: 36 });
    fasciaGeo.rotateX(Math.PI / 2);
    const fascia = new THREE.Mesh(fasciaGeo, accentMat);
    fascia.scale.set(1, 1, scaleZ);
    group.add(fascia);

    // Warm 2700K LED cove ring tucked inside outer fascia
    const coveGeo = new THREE.TorusGeometry(Math.max(0.3, outerR - 0.14), 0.025, 8, 48);
    coveGeo.rotateX(Math.PI / 2);
    const coveRing = new THREE.Mesh(coveGeo, coveMat);
    coveRing.position.y = -dropM * 0.72;
    coveRing.scale.set(1, 1, scaleZ);
    group.add(coveRing);

    // Inner core collar ring
    const innerRingShape = new THREE.Shape();
    innerRingShape.absarc(0, 0, innerRingR + 0.08, 0, Math.PI * 2, false);
    const innerHole = new THREE.Path();
    innerHole.absarc(0, 0, Math.max(0.25, innerRingR), 0, Math.PI * 2, true);
    innerRingShape.holes.push(innerHole);
    const collarGeo = new THREE.ExtrudeGeometry(innerRingShape, { depth: dropM * 0.85, bevelEnabled: false, curveSegments: 28 });
    collarGeo.rotateX(Math.PI / 2);
    const collar = new THREE.Mesh(collarGeo, accentMat);
    collar.scale.set(1, 1, scaleZ);
    group.add(collar);

    // Radial timber acoustic slat fins spanning inner collar to outer fascia
    const spanLen = Math.max(0.4, outerR - innerRingR - 0.14);
    const midR = (outerR - 0.07 + innerRingR + 0.07) / 2;
    const finCount = 44;
    const finGeo = new THREE.BoxGeometry(spanLen, dropM * 0.72, 0.036);
    for (let i = 0; i < finCount; i++) {
      const a = (i / finCount) * Math.PI * 2;
      const fin = new THREE.Mesh(finGeo, primaryMat);
      fin.position.set(Math.cos(a) * midR, -dropM * 0.42, Math.sin(a) * midR * scaleZ);
      fin.rotation.y = -a;
      group.add(fin);
    }
    return group;
  }

  if (style === 'baffle-cloud') {
    const w = Math.max(1.4, input.widthM);
    const d = Math.max(1.4, input.depthM);
    const count = Math.max(5, Math.min(28, Math.round(w / 0.22)));
    const pitch = w / count;
    const baffleGeo = new THREE.BoxGeometry(0.04, dropM * 0.78, d);
    for (let i = 0; i < count; i++) {
      const b = new THREE.Mesh(baffleGeo, primaryMat);
      b.position.set(-w / 2 + (i + 0.5) * pitch, -dropM * 0.45, 0);
      group.add(b);
    }
    for (const zOff of [-d * 0.35, d * 0.35]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, 0.04), accentMat);
      rail.position.set(0, -0.025, zOff);
      group.add(rail);
    }
    return group;
  }

  // 'recessed-cove': stepped gypsum perimeter bulkhead + warm LED reveal
  const w = Math.max(1.6, input.widthM);
  const d = Math.max(1.6, input.depthM);
  const rim = 0.42;
  const frameShape = new THREE.Shape();
  frameShape.moveTo(-w / 2, -d / 2);
  frameShape.lineTo(w / 2, -d / 2);
  frameShape.lineTo(w / 2, d / 2);
  frameShape.lineTo(-w / 2, d / 2);
  frameShape.closePath();
  if (w > rim * 2.5 && d > rim * 2.5) {
    const inner = new THREE.Path();
    inner.moveTo(-w / 2 + rim, -d / 2 + rim);
    inner.lineTo(-w / 2 + rim, d / 2 - rim);
    inner.lineTo(w / 2 - rim, d / 2 - rim);
    inner.lineTo(w / 2 - rim, -d / 2 + rim);
    inner.closePath();
    frameShape.holes.push(inner);
  }
  const bulkGeo = new THREE.ExtrudeGeometry(frameShape, { depth: dropM, bevelEnabled: false });
  bulkGeo.rotateX(Math.PI / 2);
  group.add(new THREE.Mesh(bulkGeo, accentMat));
  const coveBar = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.4, w - rim * 1.9), 0.025, Math.max(0.4, d - rim * 1.9)), coveMat);
  coveBar.position.y = -dropM * 0.78;
  group.add(coveBar);
  return group;
}
