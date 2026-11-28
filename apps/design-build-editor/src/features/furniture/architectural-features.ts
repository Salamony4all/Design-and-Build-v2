// features/furniture/architectural-features.ts
// Binds BOQ Flow Fit-Out & Custom Fabrication specifications (decorative wall cladding,
// gypsum feature partitions, free-form / pod glazing mullions & fluted glass, and
// suspended custom ceiling canopies) onto live Pascal WallNodes and Three.js scene
// geometry so both Image 1 (beauty pass) and Image 2 (model line/edge pass) lock them.

import * as THREE from 'three';
import { getPascalStores } from 'design-build-simplified-viewer-shell';
import type { MatchProduct } from './match-products';
import { PRODUCT_COLOURS, productLabel, type ProductColour, type ProductFinish, type ProductRef } from './product-refs';
import { buildCeilingCanopyMesh, disposeObject3D, type CeilingCanopyStyle } from './custom-model-builder';
import { computeWallGapClosures, type WallLike } from '../viewer-interaction/wall-selection-helper';

export type ArchitecturalRole =
  | 'wall-cladding'
  | 'glazing-partition'
  | 'ceiling-feature'
  | 'gypsum-partition'
  | 'wall-artwork';

export interface ArchitecturalZoneInput {
  id: string;
  kind: 'rotunda-canopy' | 'ceiling-bulkhead' | 'feature-zone' | string;
  shape: 'round' | 'oval' | 'polygon' | string;
  centerM: { x: number; y: number };
  widthM: number;
  depthM: number;
  radiusM?: number;
  innerRadiiM?: number[];
  outlineM: { x: number; y: number }[];
  label?: string;
  roomContext?: string | null;
}

export type CladdingStyle = 'fluted-wood' | 'wood-veneer' | 'acoustic-fabric' | 'stone-cladding' | 'metal-inlay' | 'painted-plaster';
export type GlazingStyle = 'single-glazed-slim' | 'double-glazed-framed' | 'fluted-glass';
export type ArtworkStyle = 'framed-canvas' | 'sculptural-relief' | 'triptych-gallery';

export interface ActiveCeilingFeature {
  id: string;
  kind: string;
  shape: string;
  style: CeilingCanopyStyle;
  centerM: { x: number; y: number };
  widthM: number;
  depthM: number;
  radiusM?: number;
  wallTopM: number;
  dropM: number;
  label: string;
  code?: string;
  brand?: string;
  description?: string;
  colourHex: string;
  accentHex?: string;
  colourName: string;
  finishes?: readonly ProductFinish[];
  imageUrl?: string;
  productId?: string;
}

export interface ActiveWallCladding {
  productId: string;
  wallIds: string[];
  curved: boolean;
  style: CladdingStyle;
  label: string;
  code?: string;
  description: string;
  colourHex: string;
  colourName: string;
  finishes?: readonly ProductFinish[];
  imageUrl?: string;
  anchors: { x: number; y: number; z: number }[];
}

export interface ActiveGlazingExecution {
  productId?: string;
  wallIds: string[];
  curved: boolean;
  style: GlazingStyle;
  label: string;
  code?: string;
  description: string;
  glassHex: string;
  frameHex: string;
  frameName: string;
  finishes?: readonly ProductFinish[];
  imageUrl?: string;
  anchors: { x: number; y: number; z: number }[];
}

export interface ActiveWallArtwork {
  productId: string;
  wallIds: string[];
  style: ArtworkStyle;
  label: string;
  code?: string;
  description: string;
  widthM: number;
  heightM: number;
  frameHex: string;
  canvasHex: string;
  frameName: string;
  finishes?: readonly ProductFinish[];
  imageUrl?: string;
  anchors: { x: number; y: number; z: number }[];
}

export interface ActiveSlabFinish {
  slabId: string;
  label: string;
  description: string;
  colourHex: string;
}

export interface ArchitecturalSceneState {
  ceilings: ActiveCeilingFeature[];
  wallCladdings: ActiveWallCladding[];
  glazingExecutions: ActiveGlazingExecution[];
  wallArtworks: ActiveWallArtwork[];
  slabFinishes?: ActiveSlabFinish[];
}

export interface ClassifiedArchitecturalProduct {
  role: ArchitecturalRole;
  claddingStyle?: CladdingStyle;
  glazingStyle?: GlazingStyle;
  ceilingStyle?: CeilingCanopyStyle;
  artworkStyle?: ArtworkStyle;
  primaryHex: string;
  secondaryHex: string;
  frameName: string;
  glassOpacity?: number;
  glassRoughness?: number;
}

let activeState: ArchitecturalSceneState = {
  ceilings: [],
  wallCladdings: [],
  glazingExecutions: [],
  wallArtworks: [],
  slabFinishes: [],
};

export function getActiveArchitecturalFeatures(): ArchitecturalSceneState {
  return activeState;
}

export function resetArchitecturalFeaturesState(): void {
  activeState = { ceilings: [], wallCladdings: [], glazingExecutions: [], wallArtworks: [], slabFinishes: [] };
}

/** Classify a BOQ Flow item into an architectural wall, glazing, or ceiling role when applicable. */
export function classifyArchitecturalProduct(
  p: Pick<MatchProduct, 'description' | 'category' | 'brand' | 'model' | 'designBuildKind' | 'finishes'> & {
    code?: string;
    architecturalRole?: string;
  },
): ClassifiedArchitecturalProduct | null {
  const code = String(p.code || p.model || '').toUpperCase().trim();
  const hay = `${code} ${p.category ?? ''} ${p.brand ?? ''} ${p.description ?? ''}`;
  const f0 = p.finishes?.[0]?.hex;
  const f1 = p.finishes?.[1]?.hex;
  const finishText = (p.finishes ?? []).map((f) => f.name).join(' ');
  const warmBronze = /bronze|brass|champagne|gold|walnut|oak/i.test(`${hay} ${finishText}`);

  // 1. Overhead custom ceiling canopies, baffles & recessed gypsum bulkheads
  if (
    p.architecturalRole === 'ceiling-feature' ||
    /^CL-(?:WOD|ACU|GYP)-|^FAB-CLG-/.test(code) ||
    /\b(rotunda\s*canopy|slatted?\s*(?:ceiling|canopy)|ceiling\s*(?:baffle|cloud|canopy)|hunter\s*douglas\s*.*ceil|recessed\s*cove\s*ceil|suspended\s*wood\s*slat)\b/i.test(hay)
  ) {
    const ceilingStyle: CeilingCanopyStyle =
      /^FAB-CLG-01/.test(code) || /rotunda|circular\s*slat|drum\s*canopy/i.test(hay)
        ? 'slatted-ring'
        : /^CL-GYP-/.test(code) || /gypsum|bulkhead|coffer/i.test(hay)
          ? 'recessed-cove'
          : 'baffle-cloud';
    return {
      role: 'ceiling-feature',
      ceilingStyle,
      primaryHex: f0 || (ceilingStyle === 'recessed-cove' ? '#ece8e1' : '#7c563a'),
      secondaryHex: f1 || '#8c6f47',
      frameName: warmBronze ? 'brushed bronze' : 'matte black',
    };
  }

  // 2. Glazed partitions, curved pods & specialty fluted/reeded glass
  if (
    p.architecturalRole === 'glazing-partition' ||
    /^PT-GLS-/.test(code) ||
    /\b(single[\s-]*glaz|double[\s-]*glaz|fluted\s*glass|reeded\s*glass|frosted\s*glass|satinovo|optima\s*(?:revolution|glaz)|acoustic\s*glass\s*partition|glass\s*partition)\b/i.test(hay)
  ) {
    const glazingStyle: GlazingStyle =
      /^PT-GLS-03/.test(code) || /fluted|reeded|frosted|ribbed|satinovo/i.test(hay)
        ? 'fluted-glass'
        : /^PT-GLS-02/.test(code) || /double[\s-]*glaz|revolution\s*100/i.test(hay)
          ? 'double-glazed-framed'
          : 'single-glazed-slim';
    return {
      role: 'glazing-partition',
      glazingStyle,
      primaryHex: glazingStyle === 'fluted-glass' ? '#c7d6da' : '#bad8e4',
      secondaryHex: f0 || f1 || (warmBronze ? '#8a6d46' : '#26292e'),
      frameName: warmBronze ? 'brushed bronze aluminium' : 'matte black anodised aluminium',
      glassOpacity: glazingStyle === 'fluted-glass' ? 0.52 : glazingStyle === 'double-glazed-framed' ? 0.32 : 0.26,
      glassRoughness: glazingStyle === 'fluted-glass' ? 0.36 : 0.08,
    };
  }

  // 2b. Wall-mounted framed artwork & sculptural relief panels
  if (
    p.architecturalRole === 'wall-artwork' ||
    /^FAB-ART-|^FN-ART-/.test(code) ||
    /\b(wall\s*art(?:work)?|framed\s*(?:art|canvas|print|painting)|sculptural\s*(?:wall\s*)?(?:art|relief|panel)|bas[\s-]*relief|gallery\s*art(?:work)?|commissioned\s*mural)\b/i.test(hay)
  ) {
    const artworkStyle: ArtworkStyle =
      /triptych|diptych|multi[\s-]*panel|set\s*of\s*[234]|3[\s-]*panel/i.test(hay)
        ? 'triptych-gallery'
        : /relief|sculptural|3d|carved/i.test(hay)
          ? 'sculptural-relief'
          : 'framed-canvas';
    return {
      role: 'wall-artwork',
      artworkStyle,
      primaryHex: f0 || '#d8cdbf',
      secondaryHex: f1 || (warmBronze ? '#8a6d46' : '#26292e'),
      frameName: warmBronze ? 'brushed bronze frame' : 'matte black gallery frame',
    };
  }

  // 3. Decorative wall cladding & feature gypsum treatments (wood slats, veneer, acoustic panels, stone, PVD)
  if (
    p.architecturalRole === 'wall-cladding' ||
    /^WC-(?:WOD|FLT|ACU|MTL)-|^FAB-FTR-/.test(code) ||
    /\b(fluted\s*(?:timber|wood|oak|walnut)?\s*(?:wall|panel|slat)|wood\s*veneer\s*wall\s*cladding|acoustic\s*wall\s*panel|feature\s*wall\s*(?:panel|cladding)|stone\s*cladding|travertine\s*wall|pvd.*wall\s*trim)\b/i.test(hay)
  ) {
    const claddingStyle: CladdingStyle =
      /^WC-FLT-|^FAB-FTR-01/.test(code) || /flut|slat/i.test(hay)
        ? 'fluted-wood'
        : /^WC-ACU-/.test(code) || /fabric|vescom|autex.*panel|acoustic\s*wall/i.test(hay)
          ? 'acoustic-fabric'
          : /^WC-MTL-/.test(code) || /pvd|stainless\s*steel\s*wall\s*trim/i.test(hay)
            ? 'metal-inlay'
            : /stone|marble|travertine|limestone/i.test(hay)
              ? 'stone-cladding'
              : 'wood-veneer';
    const defaultHex =
      claddingStyle === 'fluted-wood'
        ? '#7a5336'
        : claddingStyle === 'wood-veneer'
          ? '#875f3f'
          : claddingStyle === 'acoustic-fabric'
            ? '#cfc6b8'
            : claddingStyle === 'stone-cladding'
              ? '#d8cfc0'
              : '#8c6f47';
    return {
      role: 'wall-cladding',
      claddingStyle,
      primaryHex: f0 || defaultHex,
      secondaryHex: f1 || '#8c6f47',
      frameName: warmBronze ? 'brushed bronze' : 'charcoal shadow-gap',
    };
  }

  // 4. Gypsum partitions (drywall)
  if (p.architecturalRole === 'gypsum-partition' || /^PT-DRY-/.test(code) || /\b(knauf.*drywall|gypsum\s*partition)\b/i.test(hay)) {
    return {
      role: 'gypsum-partition',
      primaryHex: f0 || '#f2efe9',
      secondaryHex: '#c8bfb3',
      frameName: 'shadow-gap plasterboard',
    };
  }

  return null;
}

const ARCH_GROUP_NAME = 'architectural-features';

function findLiveThreeScene(): THREE.Scene | null {
  try {
    const { sceneRegistry } = getPascalStores() as unknown as { sceneRegistry: { nodes: Map<string, THREE.Object3D> } };
    const any = sceneRegistry.nodes.values().next().value as THREE.Object3D | undefined;
    let cur = any;
    while (cur?.parent) cur = cur.parent;
    return cur && (cur as THREE.Scene).isScene ? (cur as THREE.Scene) : null;
  } catch {
    return null;
  }
}

function getOrCreateArchGroup(scene: THREE.Scene): THREE.Group {
  const existing = scene.getObjectByName(ARCH_GROUP_NAME);
  if (existing && existing instanceof THREE.Group) return existing;
  const g = new THREE.Group();
  g.name = ARCH_GROUP_NAME;
  g.userData.architecturalLock = true;
  scene.add(g);
  return g;
}

export function clearArchitecturalFeaturesGroup(): void {
  const s = findLiveThreeScene();
  if (!s) return;
  const existing = s.getObjectByName(ARCH_GROUP_NAME);
  if (existing) {
    s.remove(existing);
    disposeObject3D(existing);
  }
}

interface WallLikeNode {
  id: string;
  type: string;
  start?: [number, number];
  end?: [number, number];
  curveOffset?: number;
  height?: number;
  thickness?: number;
  visible?: boolean;
  children?: string[];
  material?: { preset?: string; properties?: Record<string, unknown> };
  materialPreset?: string;
  interiorMaterial?: { preset?: string; properties?: Record<string, unknown> };
  interiorMaterialPreset?: string;
  exteriorMaterial?: { preset?: string; properties?: Record<string, unknown> };
  exteriorMaterialPreset?: string;
  slots?: Record<string, string>;
  skirting?: Record<string, unknown>;
  crown?: Record<string, unknown>;
  chairRail?: Record<string, unknown>;
  faceBands?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type WallCladdingPresetId =
  | 'none'
  | 'fluted-oak'
  | 'fluted-walnut'
  | 'veneer-brass'
  | 'travertine-stone'
  | 'acoustic-felt'
  | 'bronze-pvd';

export type WallDecorElementId =
  | 'none'
  | 'framed-canvas'
  | 'sculptural-relief'
  | 'triptych-gallery'
  | 'backlit-mirror'
  | 'wall-sconces';

export interface WallPaintPresetSpec {
  id: string;
  label: string;
  hex: string;
}

export const WALL_PAINT_PRESETS: readonly WallPaintPresetSpec[] = [
  { id: 'warm-white', label: 'Warm White', hex: '#F2EFE9' },
  { id: 'alabaster', label: 'Alabaster', hex: '#EAE3D5' },
  { id: 'sandstone', label: 'Sandstone', hex: '#D6C7B2' },
  { id: 'warm-greige', label: 'Warm Greige', hex: '#B5ACA0' },
  { id: 'sage-olive', label: 'Sage Olive', hex: '#8C9B8E' },
  { id: 'slate-blue', label: 'Slate Blue', hex: '#5E738B' },
  { id: 'terracotta', label: 'Terracotta', hex: '#B86B52' },
  { id: 'charcoal', label: 'Charcoal', hex: '#363A40' },
];

export const STANDARD_GLASS_WALL_THICKNESS_M = 0.024;

export interface ManualWallTreatment {
  surfaceMode?: 'paint' | 'cladding' | 'clear-glass' | 'fluted-glass';
  paintHex?: string;
  paintSheen?: 'matte' | 'satin';
  claddingPreset?: WallCladdingPresetId;
  side?: 'both' | 'interior' | 'exterior';
  primaryHex?: string;
  accentHex?: string;
  savedSolidThicknessM?: number;
  skirting?: boolean;
  crown?: boolean;
  chairRail?: boolean;
  ledCove?: boolean;
  decorKind?: WallDecorElementId;
  decorTitle?: string;
  decorImageUrl?: string;
}

export type SlabCladdingPresetId =
  | 'parquet'
  | 'natural-oak'
  | 'herringbone-walnut'
  | 'travertine-honed'
  | 'calacatta-marble'
  | 'venetian-terrazzo'
  | 'brushed-concrete'
  | 'boucle-carpet'
  | 'porcelain-stone';

export interface SlabCladdingPresetSpec {
  id: SlabCladdingPresetId;
  label: string;
  hex: string;
  roughness: number;
  metalness: number;
}

export const SLAB_PAINT_PRESETS: readonly WallPaintPresetSpec[] = [
  { id: 'microcement-warm', label: 'Warm Microcement', hex: '#E3DED6' },
  { id: 'limestone-screed', label: 'Limestone Screed', hex: '#D4CCC0' },
  { id: 'greige-resin', label: 'Greige Epoxy', hex: '#B4ACA1' },
  { id: 'sage-screed', label: 'Sage Resin', hex: '#8F9C90' },
  { id: 'terracotta-screed', label: 'Terracotta Screed', hex: '#B66F57' },
  { id: 'slate-screed', label: 'Slate Microcement', hex: '#636D75' },
  { id: 'charcoal-epoxy', label: 'Charcoal Epoxy', hex: '#383C42' },
  { id: 'ivory-selflevel', label: 'Ivory Screed', hex: '#F1EDE6' },
];

export const SLAB_CLADDING_PRESETS: readonly SlabCladdingPresetSpec[] = [
  { id: 'parquet', label: 'Classic Parquet', hex: '#C69D6B', roughness: 0.62, metalness: 0.04 },
  { id: 'natural-oak', label: 'Natural Oak Plank', hex: '#D1B186', roughness: 0.58, metalness: 0.04 },
  { id: 'herringbone-walnut', label: 'Herringbone Walnut', hex: '#684836', roughness: 0.54, metalness: 0.05 },
  { id: 'travertine-honed', label: 'Travertine Honed', hex: '#DDD5C7', roughness: 0.44, metalness: 0.04 },
  { id: 'calacatta-marble', label: 'Calacatta Marble', hex: '#EFECE6', roughness: 0.22, metalness: 0.06 },
  { id: 'venetian-terrazzo', label: 'Venetian Terrazzo', hex: '#CFC9BE', roughness: 0.34, metalness: 0.05 },
  { id: 'brushed-concrete', label: 'Brushed Concrete', hex: '#9A9B9E', roughness: 0.78, metalness: 0.03 },
  { id: 'boucle-carpet', label: 'Bouclé Carpet', hex: '#B8B0A4', roughness: 0.94, metalness: 0.01 },
  { id: 'porcelain-stone', label: 'Porcelain Tile', hex: '#C5C2BC', roughness: 0.32, metalness: 0.06 },
];

export interface ManualSlabTreatment {
  surfaceMode?: 'paint' | 'cladding';
  paintHex?: string;
  paintSheen?: 'matte' | 'satin' | 'polished';
  claddingPreset?: SlabCladdingPresetId;
  primaryHex?: string;
}

interface SlabLikeNode {
  id: string;
  type: string;
  parentId?: string;
  polygon?: [number, number][];
  elevation?: number;
  visible?: boolean;
  material?: { preset?: string; properties?: Record<string, unknown> };
  materialPreset?: string;
  slots?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

function dispatchSceneInvalidate(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('db:scene-invalidate'));
  }
}

function runBatchHistoryStep(useSceneStore: unknown, fn: () => void): void {
  const storeWithTemporal = useSceneStore as {
    temporal?: {
      getState?: () => { pastStates?: unknown[] };
      setState?: (p: Record<string, unknown>) => void;
    };
  };
  const temporal = storeWithTemporal?.temporal;
  const before = temporal?.getState?.()?.pastStates;
  if (!temporal || !Array.isArray(before)) {
    fn();
    return;
  }
  fn();
  const after = temporal.getState?.()?.pastStates;
  if (!Array.isArray(after)) return;
  let retained = 0;
  for (let start = 0; start < before.length; start += 1) {
    const len = before.length - start;
    if (len > after.length) continue;
    let match = true;
    for (let i = 0; i < len; i += 1) {
      if (before[start + i] !== after[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      retained = len;
      break;
    }
  }
  if (after.length - retained > 1) {
    const firstAdded = after[retained];
    if (firstAdded !== undefined) {
      temporal.setState?.({
        pastStates: [...after.slice(0, retained), firstAdded],
      });
    }
  }
}

export interface WallCladdingPresetSpec {
  id: WallCladdingPresetId;
  label: string;
  style: CladdingStyle;
  primaryHex: string;
  accentHex: string;
  roughness: number;
  metalness: number;
}

export const WALL_CLADDING_PRESETS: readonly WallCladdingPresetSpec[] = [
  { id: 'none', label: 'Plaster (None)', style: 'wood-veneer', primaryHex: '#e9e7e3', accentHex: '#c8bfb3', roughness: 0.85, metalness: 0.02 },
  { id: 'fluted-oak', label: 'Fluted Oak', style: 'fluted-wood', primaryHex: '#C29D6E', accentHex: '#232426', roughness: 0.66, metalness: 0.04 },
  { id: 'fluted-walnut', label: 'Fluted Walnut', style: 'fluted-wood', primaryHex: '#5E4030', accentHex: '#8A6D46', roughness: 0.64, metalness: 0.05 },
  { id: 'veneer-brass', label: 'Veneer + Brass', style: 'wood-veneer', primaryHex: '#875F3F', accentHex: '#B5985A', roughness: 0.56, metalness: 0.08 },
  { id: 'travertine-stone', label: 'Travertine Stone', style: 'stone-cladding', primaryHex: '#D8CFC0', accentHex: '#8C6F47', roughness: 0.42, metalness: 0.04 },
  { id: 'acoustic-felt', label: 'Acoustic Felt', style: 'acoustic-fabric', primaryHex: '#5A5D60', accentHex: '#8A6D46', roughness: 0.92, metalness: 0.01 },
  { id: 'bronze-pvd', label: 'Bronze PVD', style: 'metal-inlay', primaryHex: '#8A6D46', accentHex: '#373C40', roughness: 0.34, metalness: 0.72 },
];

export const WALL_DECOR_PRESETS: readonly { id: WallDecorElementId; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'framed-canvas', label: 'Framed Art' },
  { id: 'sculptural-relief', label: '3D Bas-Relief' },
  { id: 'triptych-gallery', label: 'Triptych' },
  { id: 'backlit-mirror', label: 'Backlit Mirror' },
  { id: 'wall-sconces', label: 'Brass Sconces' },
];

function tagWallOverlay(obj: THREE.Object3D, wallId: string) {
  obj.userData.architecturalLock = true;
  obj.userData.wallId = wallId;
}

function buildWallSurfaceMaterialPatch(
  w: WallLikeNode,
  side: 'both' | 'interior' | 'exterior',
  mat: { preset: string; properties: Record<string, unknown> },
) {
  const nextSlots = w.slots ? { ...w.slots } : undefined;
  if (nextSlots) {
    if (side === 'both' || side === 'interior') {
      delete nextSlots.interior;
      delete nextSlots.lowerInterior;
      delete nextSlots.middleInterior;
      delete nextSlots.upperInterior;
      delete nextSlots.topInterior;
    }
    if (side === 'both' || side === 'exterior') {
      delete nextSlots.exterior;
      delete nextSlots.lowerExterior;
      delete nextSlots.middleExterior;
      delete nextSlots.upperExterior;
      delete nextSlots.topExterior;
    }
  }
  return {
    ...(side === 'both' ? { material: mat, materialPreset: undefined } : {}),
    ...(side === 'both' || side === 'interior' ? { interiorMaterial: mat, interiorMaterialPreset: undefined } : {}),
    ...(side === 'both' || side === 'exterior' ? { exteriorMaterial: mat, exteriorMaterialPreset: undefined } : {}),
    ...(nextSlots ? { slots: nextSlots } : {}),
  };
}

/** Sample points and local tangents along a straight or Pascal curved WallNode (plan x, z). */
export function sampleWallCenterline(w: WallLikeNode, stepM = 0.5): { x: number; z: number; angle: number }[] {
  const s = w.start;
  const e = w.end;
  if (!s || !e) return [];
  const dx = e[0] - s[0];
  const dz = e[1] - s[1];
  const chord = Math.hypot(dx, dz);
  if (chord < 0.05) return [];
  const off = typeof w.curveOffset === 'number' && Number.isFinite(w.curveOffset) ? w.curveOffset : 0;
  const baseAng = Math.atan2(dz, dx);
  if (Math.abs(off) < 0.008) {
    const n = Math.max(2, Math.round(chord / Math.max(0.15, stepM)) + 1);
    return Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return { x: s[0] + dx * t, z: s[1] + dz * t, angle: baseAng };
    });
  }
  const nx = -dz / chord;
  const nz = dx / chord;
  const mx = (s[0] + e[0]) / 2;
  const mz = (s[1] + e[1]) / 2;
  const midX = mx - nx * off;
  const midZ = mz - nz * off;
  const d = 2 * (s[0] * (midZ - e[1]) + midX * (e[1] - s[1]) + e[0] * (s[1] - midZ));
  if (Math.abs(d) < 1e-8) {
    return [{ x: s[0], z: s[1], angle: baseAng }, { x: e[0], z: e[1], angle: baseAng }];
  }
  const s2 = s[0] * s[0] + s[1] * s[1];
  const m2 = midX * midX + midZ * midZ;
  const e2 = e[0] * e[0] + e[1] * e[1];
  const cx = (s2 * (midZ - e[1]) + m2 * (e[1] - s[1]) + e2 * (s[1] - midZ)) / d;
  const cz = (s2 * (e[0] - midX) + m2 * (s[0] - e[0]) + e2 * (midX - s[0])) / d;
  const r = Math.hypot(s[0] - cx, s[1] - cz);
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const a0 = Math.atan2(s[1] - cz, s[0] - cx);
  const am = Math.atan2(midZ - cz, midX - cx);
  const a1 = Math.atan2(e[1] - cz, e[0] - cx);
  const sweep = wrap(am - a0) + wrap(a1 - am);
  const arcLen = Math.max(chord, Math.abs(sweep) * r);
  const n = Math.max(3, Math.round(arcLen / Math.max(0.15, stepM)) + 1);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const a = a0 + sweep * t;
    const tx = -Math.sin(a) * Math.sign(sweep || 1);
    const tz = Math.cos(a) * Math.sign(sweep || 1);
    return { x: cx + r * Math.cos(a), z: cz + r * Math.sin(a), angle: Math.atan2(tz, tx) };
  });
}

function buildGlazingMullions(walls: WallLikeNode[], frameHex: string, wallTopFallback: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'glazing-mullions';
  g.userData = { architecturalLock: true, architecturalKind: 'glazing-mullion' };
  const frameMat = new THREE.MeshStandardMaterial({ color: frameHex, roughness: 0.35, metalness: 0.65 });
  for (const w of walls) {
    if ((w.metadata?.wallClassification as string) === 'POD_DOOR_WALL') continue;
    const pts = sampleWallCenterline(w, 0.32);
    if (pts.length < 2) continue;
    const h = Math.max(1.8, w.height ?? wallTopFallback);
    const thick = Math.max(0.045, (w.thickness ?? 0.08) + 0.014);
    // Top and bottom slim perimeter channel segments along curve/straight run
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 0.03) continue;
      const segAng = Math.atan2(b.z - a.z, b.x - a.x);
      const trackGeo = new THREE.BoxGeometry(segLen + 0.015, 0.042, thick);
      for (const y of [0.021, h - 0.021]) {
        const track = new THREE.Mesh(trackGeo, frameMat);
        track.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
        track.rotation.y = -segAng;
        tagWallOverlay(track, w.id);
        g.add(track);
      }
    }
    // Vertical slim mullions spaced roughly every ~1.05 m along the glazing run
    let distAcc = 0;
    const mullGeo = new THREE.BoxGeometry(0.032, h - 0.06, thick + 0.004);
    const addMull = (pt: { x: number; z: number; angle: number }) => {
      const m = new THREE.Mesh(mullGeo, frameMat);
      m.position.set(pt.x, h / 2, pt.z);
      m.rotation.y = -pt.angle;
      tagWallOverlay(m, w.id);
      g.add(m);
    };
    addMull(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      distAcc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      if (distAcc >= 1.05 || i === pts.length - 1) {
        distAcc = 0;
        addMull(pts[i]);
      }
    }
  }
  return g;
}

function buildWallFlutesGroup(
  walls: WallLikeNode[],
  hex: string,
  accentHex: string,
  side: 'both' | 'interior' | 'exterior' = 'both',
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'wall-cladding-flutes';
  g.userData = { architecturalLock: true, architecturalKind: 'wall-cladding' };
  const fluteMat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.62, metalness: 0.05 });
  const trimMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.35, metalness: 0.6 });
  const signs = side === 'interior' ? [1] : side === 'exterior' ? [-1] : [-1, 1];
  let count = 0;
  for (const w of walls) {
    if (count >= 380) break;
    const pts = sampleWallCenterline(w, 0.14);
    if (pts.length < 2) continue;
    const h = Math.max(2.0, w.height ?? 3.0);
    const halfT = (w.thickness ?? 0.2) / 2;
    const battenGeo = new THREE.BoxGeometry(0.026, h - 0.16, 0.018);
    for (let i = 0; i < pts.length && count < 380; i++) {
      const p = pts[i];
      const nx = -Math.sin(p.angle);
      const nz = Math.cos(p.angle);
      for (const sgn of signs) {
        const b = new THREE.Mesh(battenGeo, fluteMat);
        b.position.set(p.x + nx * (halfT + 0.009) * sgn, h / 2, p.z + nz * (halfT + 0.009) * sgn);
        b.rotation.y = -p.angle;
        tagWallOverlay(b, w.id);
        g.add(b);
        count++;
      }
    }
    // Slim metallic shadow-gap skirting reveal at base & ends
    const a = pts[0];
    const b = pts[pts.length - 1];
    const trim = new THREE.Mesh(new THREE.CylinderGeometry(halfT + 0.015, halfT + 0.015, 0.03, 12), trimMat);
    trim.position.set(a.x, 0.015, a.z);
    tagWallOverlay(trim, w.id);
    const trim2 = trim.clone();
    trim2.position.set(b.x, 0.015, b.z);
    tagWallOverlay(trim2, w.id);
    g.add(trim, trim2);
  }
  return g;
}

function buildWallInlayStripsGroup(
  walls: WallLikeNode[],
  accentHex: string,
  side: 'both' | 'interior' | 'exterior' = 'both',
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'wall-cladding-inlays';
  g.userData = { architecturalLock: true, architecturalKind: 'wall-cladding' };
  const inlayMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.28, metalness: 0.78 });
  const signs = side === 'interior' ? [1] : side === 'exterior' ? [-1] : [-1, 1];
  for (const w of walls) {
    const pts = sampleWallCenterline(w, 0.45);
    if (pts.length < 2) continue;
    const h = Math.max(2.0, w.height ?? 3.0);
    const halfT = (w.thickness ?? 0.2) / 2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 0.03) continue;
      const segAng = Math.atan2(b.z - a.z, b.x - a.x);
      const nx = -Math.sin(segAng);
      const nz = Math.cos(segAng);
      const railGeo = new THREE.BoxGeometry(segLen, 0.014, 0.012);
      for (const sgn of signs) {
        for (const y of [0.95, h - 0.38]) {
          const rail = new THREE.Mesh(railGeo, inlayMat);
          rail.position.set((a.x + b.x) / 2 + nx * (halfT + 0.006) * sgn, y, (a.z + b.z) / 2 + nz * (halfT + 0.006) * sgn);
          rail.rotation.y = -segAng;
          tagWallOverlay(rail, w.id);
          g.add(rail);
        }
      }
    }
    const stileGeo = new THREE.BoxGeometry(0.012, h - 0.16, 0.012);
    for (let i = 0; i < pts.length; i += 2) {
      const p = pts[i];
      const nx = -Math.sin(p.angle);
      const nz = Math.cos(p.angle);
      for (const sgn of signs) {
        const stile = new THREE.Mesh(stileGeo, inlayMat);
        stile.position.set(p.x + nx * (halfT + 0.006) * sgn, h / 2, p.z + nz * (halfT + 0.006) * sgn);
        stile.rotation.y = -p.angle;
        tagWallOverlay(stile, w.id);
        g.add(stile);
      }
    }
  }
  return g;
}

function buildWallLedCoveGroup(
  walls: WallLikeNode[],
  side: 'both' | 'interior' | 'exterior' = 'both',
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'wall-led-cove';
  g.userData = { architecturalLock: true, architecturalKind: 'wall-cladding' };
  const ledMat = new THREE.MeshStandardMaterial({
    color: '#fff3d6',
    emissive: '#ffcf7a',
    emissiveIntensity: 1.85,
    roughness: 0.25,
    metalness: 0.05,
  });
  const pelmetMat = new THREE.MeshStandardMaterial({ color: '#2b2d30', roughness: 0.45, metalness: 0.35 });
  const signs = side === 'interior' ? [1] : side === 'exterior' ? [-1] : [-1, 1];
  for (const w of walls) {
    const pts = sampleWallCenterline(w, 0.45);
    if (pts.length < 2) continue;
    const h = Math.max(2.0, w.height ?? 3.0);
    const halfT = (w.thickness ?? 0.2) / 2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 0.04) continue;
      const segAng = Math.atan2(b.z - a.z, b.x - a.x);
      const nx = -Math.sin(segAng);
      const nz = Math.cos(segAng);
      const stripGeo = new THREE.BoxGeometry(segLen, 0.022, 0.024);
      const pelmetGeo = new THREE.BoxGeometry(segLen, 0.032, 0.045);
      for (const sgn of signs) {
        const topLed = new THREE.Mesh(stripGeo, ledMat);
        topLed.position.set((a.x + b.x) / 2 + nx * (halfT + 0.016) * sgn, h - 0.14, (a.z + b.z) / 2 + nz * (halfT + 0.016) * sgn);
        topLed.rotation.y = -segAng;
        tagWallOverlay(topLed, w.id);

        const pelmet = new THREE.Mesh(pelmetGeo, pelmetMat);
        pelmet.position.set((a.x + b.x) / 2 + nx * (halfT + 0.022) * sgn, h - 0.105, (a.z + b.z) / 2 + nz * (halfT + 0.022) * sgn);
        pelmet.rotation.y = -segAng;
        tagWallOverlay(pelmet, w.id);

        const plinthLed = new THREE.Mesh(stripGeo, ledMat);
        plinthLed.position.set((a.x + b.x) / 2 + nx * (halfT + 0.012) * sgn, 0.04, (a.z + b.z) / 2 + nz * (halfT + 0.012) * sgn);
        plinthLed.rotation.y = -segAng;
        tagWallOverlay(plinthLed, w.id);

        g.add(topLed, pelmet, plinthLed);
      }
    }
  }
  return g;
}

function isGlassWall(w: WallLikeNode): boolean {
  const cls = String(w.metadata?.wallClassification ?? '');
  if (cls === 'GLASS_PARTITION') return true;
  if (cls === 'POD_DOOR_WALL') return false;
  if (w.material?.preset === 'glass') return true;
  if (typeof w.materialPreset === 'string' && w.materialPreset.toLowerCase().includes('glass')) return true;
  return false;
}

function wallLengthApprox(w: WallLikeNode): number {
  if (!w.start || !w.end) return 0;
  return Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
}

/**
 * Install baseline 3D architectural ceilings (rotunda canopies/bulkheads) and slim 3D glazing
 * mullions for extracted glazed pods & partitions even before BOQ products arrive.
 */
export function installDefaultArchitecturalFeatures(zones?: readonly ArchitecturalZoneInput[]): void {
  resetArchitecturalFeaturesState();
  const sceneObj = findLiveThreeScene();
  const stores = getPascalStores() as unknown as {
    useScene?: { getState: () => { nodes?: Record<string, WallLikeNode> } };
  };
  const nodes = Object.values(stores.useScene?.getState()?.nodes ?? {}) as WallLikeNode[];
  const walls = nodes.filter((n) => n?.type === 'wall' && n.visible !== false);
  const heights = walls.map((w) => w.height ?? 3.0).filter((h) => h > 1.5);
  const wallTopM = heights.length ? Math.max(...heights) : 3.0;
  const glassWalls = walls.filter(isGlassWall);

  clearArchitecturalFeaturesGroup();
  const group = sceneObj ? getOrCreateArchGroup(sceneObj) : null;

  for (const z of zones ?? []) {
    if (z.kind !== 'rotunda-canopy' && z.kind !== 'ceiling-bulkhead') continue;
    const style: CeilingCanopyStyle = z.kind === 'rotunda-canopy' ? 'slatted-ring' : 'baffle-cloud';
    const spec: ActiveCeilingFeature = {
      id: z.id,
      kind: z.kind,
      shape: z.shape,
      style,
      centerM: z.centerM,
      widthM: z.widthM,
      depthM: z.depthM,
      ...(typeof z.radiusM === 'number' ? { radiusM: z.radiusM } : {}),
      wallTopM,
      dropM: 0.28,
      label: z.label || (z.kind === 'rotunda-canopy' ? 'Suspended Slatted Rotunda Canopy' : 'Suspended Ceiling Feature'),
      colourHex: '#7c563a',
      accentHex: '#8c6f47',
      colourName: 'warm walnut',
    };
    activeState.ceilings.push(spec);
    if (group) {
      group.add(
        buildCeilingCanopyMesh({
          id: z.id,
          shape: z.shape,
          centerM: z.centerM,
          widthM: z.widthM,
          depthM: z.depthM,
          radiusM: z.radiusM,
          innerRadiiM: z.innerRadiiM,
          outlineM: z.outlineM,
          wallTopM,
          dropM: 0.28,
          style,
          primaryHex: spec.colourHex,
          accentHex: spec.accentHex,
        }),
      );
    }
  }

  if (glassWalls.length) {
    if (group) group.add(buildGlazingMullions(glassWalls, '#8a6d46', wallTopM));
    activeState.glazingExecutions.push({
      wallIds: glassWalls.map((w) => w.id),
      curved: glassWalls.some((w) => Math.abs(w.curveOffset ?? 0) > 0.02 || Boolean(w.metadata?.podId)),
      style: 'single-glazed-slim',
      label: 'Acoustic Glazed Partition & Curved Pod Enclosure',
      description: 'Toughened acoustic clear glass partitions in slimline brushed bronze perimeter channels and vertical mullions',
      glassHex: '#bad8e4',
      frameHex: '#8a6d46',
      frameName: 'brushed bronze aluminium',
      anchors: glassWalls
        .slice(0, 12)
        .filter((w) => w.start && w.end)
        .map((w) => ({
          x: (w.start![0] + w.end![0]) / 2,
          y: Math.max(1.2, (w.height ?? wallTopM) * 0.5),
          z: (w.start![1] + w.end![1]) / 2,
        })),
    });
  }

  syncManualWallTreatmentsToScene(group);
}

function buildWallArtworkGroup(
  walls: WallLikeNode[],
  style: ArtworkStyle,
  canvasHex: string,
  frameHex: string,
  accentHex: string,
  artW: number,
  artH: number,
  side: 'both' | 'interior' | 'exterior' = 'both',
  imageUrl?: string,
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'wall-artworks';
  g.userData = { architecturalLock: true, architecturalKind: 'wall-artwork' };
  const frameMat = new THREE.MeshStandardMaterial({ color: frameHex, roughness: 0.34, metalness: 0.62 });
  const canvasMat = new THREE.MeshStandardMaterial({ color: canvasHex, roughness: 0.72, metalness: 0.04 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.56, metalness: 0.14 });
  if (imageUrl && typeof window !== 'undefined' && typeof Image !== 'undefined') {
    try {
      const loader = new THREE.TextureLoader();
      loader.load(imageUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        canvasMat.color.set('#ffffff');
        canvasMat.map = tex;
        canvasMat.needsUpdate = true;
      });
    } catch {
      /* ignore texture load failure in non-DOM contexts */
    }
  }
  const signs = side === 'interior' ? [1] : side === 'exterior' ? [-1] : [1, -1];

  for (const w of walls) {
    if (!w.start || !w.end) continue;
    const dx = w.end[0] - w.start[0];
    const dz = w.end[1] - w.start[1];
    const wallLen = Math.hypot(dx, dz);
    if (wallLen < Math.max(0.85, artW * 0.65)) continue;
    const ang = Math.atan2(dz, dx);
    const nx = -dz / wallLen;
    const nz = dx / wallLen;
    const halfT = (w.thickness ?? 0.2) / 2;
    const wallH = Math.max(2.4, w.height ?? 3.0);
    const centerY = Math.min(wallH - artH * 0.55 - 0.15, 1.52);
    const mx = (w.start[0] + w.end[0]) / 2;
    const mz = (w.start[1] + w.end[1]) / 2;

    const panelCount = style === 'triptych-gallery' ? 3 : 1;
    const gap = 0.12;
    const panelW = panelCount === 3 ? Math.max(0.36, (artW - gap * 2) / 3) : Math.min(wallLen - 0.3, artW);

    for (const sgn of signs) {
      const mountDist = halfT + 0.028;
      for (let pi = 0; pi < panelCount; pi++) {
        const along = panelCount === 3 ? (pi - 1) * (panelW + gap) : 0;
        const px = mx + (dx / wallLen) * along + nx * mountDist * sgn;
        const pz = mz + (dz / wallLen) * along + nz * mountDist * sgn;

        const frame = new THREE.Mesh(new THREE.BoxGeometry(panelW, artH, 0.045), frameMat);
        frame.position.set(px, centerY, pz);
        frame.rotation.y = -ang;
        tagWallOverlay(frame, w.id);
        g.add(frame);

        const canvas = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.25, panelW - 0.07), Math.max(0.25, artH - 0.07), 0.02), canvasMat);
        canvas.position.set(px + nx * 0.016 * sgn, centerY, pz + nz * 0.016 * sgn);
        canvas.rotation.y = -ang;
        tagWallOverlay(canvas, w.id);
        g.add(canvas);

        if (style === 'sculptural-relief') {
          const ribCount = 5;
          const ribGeo = new THREE.BoxGeometry(0.028, Math.max(0.2, artH - 0.14), 0.02);
          for (let ri = 0; ri < ribCount; ri++) {
            const uOff = -panelW * 0.34 + (ri / (ribCount - 1)) * (panelW * 0.68);
            const rib = new THREE.Mesh(ribGeo, accentMat);
            rib.position.set(
              px + (dx / wallLen) * uOff + nx * 0.03 * sgn,
              centerY,
              pz + (dz / wallLen) * uOff + nz * 0.03 * sgn,
            );
            rib.rotation.y = -ang;
            tagWallOverlay(rib, w.id);
            g.add(rib);
          }
        }
      }
    }
  }
  return g;
}

function buildWallDecorGroup(
  walls: WallLikeNode[],
  decorKind: WallDecorElementId,
  canvasHex: string,
  frameHex: string,
  accentHex: string,
  artW: number,
  artH: number,
  side: 'both' | 'interior' | 'exterior' = 'both',
  decorImageUrl?: string,
): THREE.Group {
  if (decorKind === 'framed-canvas' || decorKind === 'sculptural-relief' || decorKind === 'triptych-gallery') {
    return buildWallArtworkGroup(walls, decorKind, canvasHex, frameHex, accentHex, artW, artH, side, decorImageUrl);
  }
  const g = new THREE.Group();
  g.name = `wall-decor-${decorKind}`;
  g.userData = { architecturalLock: true, architecturalKind: decorKind };
  const brassMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.28, metalness: 0.78 });
  const mirrorMat = new THREE.MeshStandardMaterial({ color: '#dce6ec', roughness: 0.08, metalness: 0.92 });
  const haloMat = new THREE.MeshStandardMaterial({
    color: '#fff4dc',
    emissive: '#ffd280',
    emissiveIntensity: 1.7,
    roughness: 0.25,
    metalness: 0.05,
  });
  const signs = side === 'interior' ? [1] : side === 'exterior' ? [-1] : [1, -1];

  for (const w of walls) {
    if (!w.start || !w.end) continue;
    const dx = w.end[0] - w.start[0];
    const dz = w.end[1] - w.start[1];
    const wallLen = Math.hypot(dx, dz);
    if (wallLen < 0.8) continue;
    const ang = Math.atan2(dz, dx);
    const nx = -dz / wallLen;
    const nz = dx / wallLen;
    const halfT = (w.thickness ?? 0.2) / 2;
    const wallH = Math.max(2.2, w.height ?? 3.0);
    const mx = (w.start[0] + w.end[0]) / 2;
    const mz = (w.start[1] + w.end[1]) / 2;

    if (decorKind === 'backlit-mirror') {
      const mW = Math.min(wallLen - 0.35, Math.max(0.8, artW * 0.72));
      const mH = Math.min(wallH - 0.55, Math.max(1.1, artH));
      const cy = Math.min(wallH - mH * 0.52 - 0.15, 1.48);
      for (const sgn of signs) {
        const bx = mx + nx * (halfT + 0.015) * sgn;
        const bz = mz + nz * (halfT + 0.015) * sgn;
        const halo = new THREE.Mesh(new THREE.BoxGeometry(mW + 0.07, mH + 0.07, 0.014), haloMat);
        halo.position.set(bx, cy, bz);
        halo.rotation.y = -ang;
        tagWallOverlay(halo, w.id);

        const frame = new THREE.Mesh(new THREE.BoxGeometry(mW + 0.025, mH + 0.025, 0.028), brassMat);
        frame.position.set(mx + nx * (halfT + 0.028) * sgn, cy, mz + nz * (halfT + 0.028) * sgn);
        frame.rotation.y = -ang;
        tagWallOverlay(frame, w.id);

        const glass = new THREE.Mesh(new THREE.BoxGeometry(mW - 0.03, mH - 0.03, 0.016), mirrorMat);
        glass.position.set(mx + nx * (halfT + 0.038) * sgn, cy, mz + nz * (halfT + 0.038) * sgn);
        glass.rotation.y = -ang;
        tagWallOverlay(glass, w.id);

        g.add(halo, frame, glass);
      }
    } else if (decorKind === 'wall-sconces') {
      const span = Math.min(wallLen * 0.28, 0.9);
      const cy = Math.min(wallH - 0.45, 1.68);
      for (const sgn of signs) {
        for (const sideOff of [-span, span]) {
          const sx = mx + (dx / wallLen) * sideOff + nx * (halfT + 0.028) * sgn;
          const sz = mz + (dz / wallLen) * sideOff + nz * (halfT + 0.028) * sgn;
          const backplate = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.26, 0.025), brassMat);
          backplate.position.set(sx, cy, sz);
          backplate.rotation.y = -ang;
          tagWallOverlay(backplate, w.id);

          const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.34, 14), haloMat);
          shade.position.set(sx + nx * 0.045 * sgn, cy + 0.02, sz + nz * 0.045 * sgn);
          tagWallOverlay(shade, w.id);

          const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.04, 14), brassMat);
          collar.position.set(sx + nx * 0.045 * sgn, cy, sz + nz * 0.045 * sgn);
          tagWallOverlay(collar, w.id);

          g.add(backplate, shade, collar);
        }
      }
    }
  }
  return g;
}

/**
 * Bind BOQ Flow Fit-Out & Custom Fabrication lines (wall cladding, glazing partitions,
 * decorative ceiling canopies, and wall-mounted artworks) onto live WallNodes & Three.js
 * `architectural-features`, returning architectural `ProductRef`s to include in render references.
 */
export function applyArchitecturalFeaturesToScene(
  zones: readonly ArchitecturalZoneInput[] | undefined,
  products: readonly (MatchProduct & { code?: string; architecturalRole?: string; customZoneId?: string })[],
): { architecturalRefs: ProductRef[]; handledProductIds: Set<string>; state: ArchitecturalSceneState } {
  resetArchitecturalFeaturesState();
  const stores = getPascalStores() as unknown as {
    useScene?: {
      getState: () => {
        nodes?: Record<string, WallLikeNode>;
        updateNode?: (id: string, data: Record<string, unknown>) => void;
        markDirty?: (id: string) => void;
      };
    };
    useViewer?: { getState: () => { bumpGeometryRevision?: () => void } };
  };
  const sceneStore = stores.useScene?.getState();
  const allNodes = Object.values(sceneStore?.nodes ?? {}) as WallLikeNode[];
  const walls = allNodes.filter((n) => n?.type === 'wall' && n.visible !== false);
  const heights = walls.map((w) => w.height ?? 3.0).filter((h) => h > 1.5);
  const wallTopM = heights.length ? Math.max(...heights) : 3.0;

  const sceneObj = findLiveThreeScene();
  clearArchitecturalFeaturesGroup();
  const group = sceneObj ? getOrCreateArchGroup(sceneObj) : null;

  const archRefs: ProductRef[] = [];
  const handledProductIds = new Set<string>();
  const wallCladdings: typeof products[number][] = [];
  const glazingSpecs: typeof products[number][] = [];
  const ceilingSpecs: typeof products[number][] = [];
  const wallArtworks: typeof products[number][] = [];

  for (const p of products) {
    const cls = classifyArchitecturalProduct(p);
    if (!cls) continue;
    if (cls.role === 'wall-cladding') {
      wallCladdings.push(p);
      handledProductIds.add(p.id);
    } else if (cls.role === 'glazing-partition') {
      glazingSpecs.push(p);
      handledProductIds.add(p.id);
    } else if (cls.role === 'ceiling-feature') {
      ceilingSpecs.push(p);
      handledProductIds.add(p.id);
    } else if (
      cls.role === 'wall-artwork' &&
      (!p.typeId || p.customZoneId === 'arch_walls' || p.typeId === 'arch_walls')
    ) {
      wallArtworks.push(p);
      handledProductIds.add(p.id);
    } else if (cls.role === 'gypsum-partition') {
      handledProductIds.add(p.id);
    }
  }

  let refIdx = 0;
  const nextColour = (hexOverride?: string): ProductColour => {
    const base = PRODUCT_COLOURS[refIdx % PRODUCT_COLOURS.length];
    refIdx++;
    return hexOverride ? { hex: hexOverride, name: base.name } : base;
  };

  // 1. Ceiling Canopies (extracted zones + BOQ FitOut / Custom Fabrication ceiling lines)
  const canopyZones = [...(zones ?? [])].filter((z) => z.kind === 'rotunda-canopy' || z.kind === 'ceiling-bulkhead');
  if (ceilingSpecs.length && !canopyZones.length && walls.length) {
    // Synthesize a centered feature canopy zone if BOQ specifies a ceiling feature but none was drawn on this sheet
    const xs = walls.flatMap((w) => [w.start?.[0] ?? 0, w.end?.[0] ?? 0]);
    const zs = walls.flatMap((w) => [w.start?.[1] ?? 0, w.end?.[1] ?? 0]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const spec0 = classifyArchitecturalProduct(ceilingSpecs[0]);
    canopyZones.push({
      id: ceilingSpecs[0].customZoneId || 'az_boq_1',
      kind: spec0?.ceilingStyle === 'slatted-ring' ? 'rotunda-canopy' : 'ceiling-bulkhead',
      shape: spec0?.ceilingStyle === 'slatted-ring' ? 'round' : 'polygon',
      centerM: { x: cx, y: cz },
      widthM: 5.4,
      depthM: 5.4,
      radiusM: spec0?.ceilingStyle === 'slatted-ring' ? 2.7 : undefined,
      outlineM: [
        { x: cx - 2.7, y: cz - 2.7 },
        { x: cx + 2.7, y: cz - 2.7 },
        { x: cx + 2.7, y: cz + 2.7 },
        { x: cx - 2.7, y: cz + 2.7 },
      ],
      label: productLabel(ceilingSpecs[0]),
    });
  }

  canopyZones.forEach((z, zi) => {
    const matched =
      ceilingSpecs.find((p) => p.customZoneId && p.customZoneId === z.id) ??
      ceilingSpecs[zi] ??
      ceilingSpecs[0];
    const cls = matched ? classifyArchitecturalProduct(matched) : null;
    const style: CeilingCanopyStyle =
      z.kind === 'rotunda-canopy' && cls?.ceilingStyle !== 'recessed-cove'
        ? 'slatted-ring'
        : cls?.ceilingStyle ?? (z.kind === 'rotunda-canopy' ? 'slatted-ring' : 'baffle-cloud');
    const primaryHex = cls?.primaryHex || '#7c563a';
    const accentHex = cls?.secondaryHex || '#8c6f47';
    const colour = nextColour(primaryHex);
    const label = matched ? productLabel(matched) : z.label || 'Suspended Feature Ceiling Canopy';
    activeState.ceilings.push({
      id: z.id,
      kind: z.kind,
      shape: z.shape,
      style,
      centerM: z.centerM,
      widthM: z.widthM,
      depthM: z.depthM,
      ...(typeof z.radiusM === 'number' ? { radiusM: z.radiusM } : {}),
      wallTopM,
      dropM: 0.28,
      label,
      ...(matched?.code ? { code: matched.code } : {}),
      ...(matched?.brand ? { brand: matched.brand } : {}),
      ...(matched?.description ? { description: matched.description } : {}),
      colourHex: primaryHex,
      accentHex,
      colourName: matched?.finishes?.[0]?.name || colour.name,
      ...(matched?.finishes?.length ? { finishes: matched.finishes } : {}),
      ...(matched?.imageUrl ? { imageUrl: matched.imageUrl } : {}),
      ...(matched?.id ? { productId: matched.id } : {}),
    });
    if (matched) {
      archRefs.push({
        id: `arch-ceil-${matched.id}`,
        label,
        description: matched.description,
        imageUrl: matched.imageUrl,
        colour,
        finishes: matched.finishes,
      });
    }
    if (group) {
      group.add(
        buildCeilingCanopyMesh({
          id: z.id,
          shape: z.shape,
          centerM: z.centerM,
          widthM: z.widthM,
          depthM: z.depthM,
          radiusM: z.radiusM,
          innerRadiiM: z.innerRadiiM,
          outlineM: z.outlineM,
          wallTopM,
          dropM: 0.28,
          style,
          primaryHex,
          accentHex,
        }),
      );
    }
  });

  // 2. Glazed Partitions & Curved Pod Enclosures
  const glassWalls = walls.filter(isGlassWall);
  if (glassWalls.length) {
    const primaryGlass = glazingSpecs[0];
    const cls = primaryGlass ? classifyArchitecturalProduct(primaryGlass) : null;
    const style: GlazingStyle = cls?.glazingStyle ?? 'single-glazed-slim';
    const glassHex = cls?.primaryHex || '#bad8e4';
    const frameHex = cls?.secondaryHex || '#8a6d46';
    const frameName = cls?.frameName || 'brushed bronze aluminium';
    const glassOpacity = cls?.glassOpacity ?? 0.28;
    const glassRoughness = cls?.glassRoughness ?? 0.08;
    const label = primaryGlass ? productLabel(primaryGlass) : 'Acoustic Glazed Partition & Curved Pod Enclosure';

    for (const w of glassWalls) {
      const glassMat = {
        preset: 'glass',
        properties: {
          color: glassHex,
          roughness: glassRoughness,
          metalness: 0.1,
          opacity: glassOpacity,
          transparent: true,
          side: 'double',
        },
      };
      sceneStore?.updateNode?.(w.id, {
        ...buildWallSurfaceMaterialPatch(w, 'both', glassMat),
        render_spec: {
          material_finish: style,
          color_palette: frameName,
          surface_treatment: label,
        },
        metadata: {
          ...(w.metadata ?? {}),
          architecturalTreatment: {
            role: 'glazing-partition',
            style,
            code: primaryGlass?.code,
            frameHex,
            glassHex,
            productId: primaryGlass?.id,
          },
        },
      });
      sceneStore?.markDirty?.(w.id);
    }

    if (group) group.add(buildGlazingMullions(glassWalls, frameHex, wallTopM));
    activeState.glazingExecutions.push({
      ...(primaryGlass?.id ? { productId: primaryGlass.id } : {}),
      wallIds: glassWalls.map((w) => w.id),
      curved: glassWalls.some((w) => Math.abs(w.curveOffset ?? 0) > 0.02 || Boolean(w.metadata?.podId)),
      style,
      label,
      ...(primaryGlass?.code ? { code: primaryGlass.code } : {}),
      description:
        primaryGlass?.description ||
        'Acoustic clear toughened glazing partitions with slimline brushed bronze channels and mullions',
      glassHex,
      frameHex,
      frameName,
      ...(primaryGlass?.finishes?.length ? { finishes: primaryGlass.finishes } : {}),
      ...(primaryGlass?.imageUrl ? { imageUrl: primaryGlass.imageUrl } : {}),
      anchors: glassWalls
        .slice(0, 12)
        .filter((w) => w.start && w.end)
        .map((w) => ({
          x: (w.start![0] + w.end![0]) / 2,
          y: Math.max(1.2, (w.height ?? wallTopM) * 0.5),
          z: (w.start![1] + w.end![1]) / 2,
        })),
    });
    if (primaryGlass) {
      archRefs.push({
        id: `arch-glass-${primaryGlass.id}`,
        label,
        description: primaryGlass.description,
        imageUrl: primaryGlass.imageUrl,
        colour: nextColour(frameHex),
        finishes: primaryGlass.finishes,
      });
    }
  }

  // 3. Decorative Gypsum Partition Cladding (Curved feature walls, pod shells & long interior walls)
  const solidWalls = walls.filter((w) => !isGlassWall(w) && (w.metadata?.wallClassification as string) !== 'POD_DOOR_WALL');
  if (wallCladdings.length && solidWalls.length) {
    const freeCurved = solidWalls.filter(
      (w) => (w.metadata?.wallClassification as string) === 'CURVED_WALL' && !w.metadata?.podId,
    );
    const podCurved = solidWalls.filter(
      (w) => (w.metadata?.wallClassification as string) === 'CURVED_WALL' && Boolean(w.metadata?.podId),
    );
    const interiorStraight = solidWalls
      .filter((w) => Math.abs(w.curveOffset ?? 0) < 0.01 && !(w.children ?? []).some((cid) => String(cid).startsWith('win')))
      .sort((a, b) => wallLengthApprox(b) - wallLengthApprox(a));

    const assignments: { product: typeof wallCladdings[number]; targets: WallLikeNode[] }[] = [];
    if (freeCurved.length || podCurved.length) {
      if (freeCurved.length) assignments.push({ product: wallCladdings[0], targets: freeCurved });
      if (podCurved.length) {
        assignments.push({
          product: wallCladdings[freeCurved.length && wallCladdings.length > 1 ? 1 : 0],
          targets: podCurved,
        });
      }
      const archWallSpecs = wallCladdings.filter(
        (wc) => wc.customZoneId === 'arch_walls' || wc.typeId === 'arch_walls',
      );
      if (archWallSpecs.length && interiorStraight.length) {
        const cap = Math.max(1, Math.min(4, Math.ceil(interiorStraight.length * 0.25)));
        assignments.push({ product: archWallSpecs[0], targets: interiorStraight.slice(0, cap) });
      }
    } else if (interiorStraight.length) {
      // Straight building plans: bind up to top 2 longest interior feature walls per cladding spec (capped at 4 walls)
      const cap = Math.max(1, Math.min(4, Math.ceil(interiorStraight.length * 0.25)));
      assignments.push({ product: wallCladdings[0], targets: interiorStraight.slice(0, cap) });
    }

    for (const { product, targets } of assignments) {
      if (!targets.length) continue;
      const cls = classifyArchitecturalProduct(product)!;
      const style = cls.claddingStyle ?? 'wood-veneer';
      const primaryHex = cls.primaryHex;
      const accentHex = cls.secondaryHex;
      const colour = nextColour(primaryHex);
      const label = productLabel(product);

      for (const w of targets) {
        const wallMat = {
          preset: 'custom',
          properties: {
            color: primaryHex,
            roughness: style === 'metal-inlay' ? 0.35 : style === 'stone-cladding' ? 0.55 : 0.68,
            metalness: style === 'metal-inlay' ? 0.65 : 0.05,
            opacity: 1,
            transparent: false,
            side: 'double',
          },
        };
        sceneStore?.updateNode?.(w.id, {
          ...buildWallSurfaceMaterialPatch(w, 'both', wallMat),
          render_spec: {
            material_finish: style,
            color_palette: product.finishes?.[0]?.name || colour.name,
            surface_treatment: label,
          },
          metadata: {
            ...(w.metadata ?? {}),
            architecturalTreatment: {
              role: 'wall-cladding',
              style,
              code: product.code,
              primaryHex,
              accentHex,
              productId: product.id,
            },
          },
        });
        sceneStore?.markDirty?.(w.id);
      }

      if (group && style === 'fluted-wood') {
        group.add(buildWallFlutesGroup(targets, primaryHex, accentHex));
      } else if (group && (style === 'wood-veneer' || style === 'metal-inlay')) {
        group.add(buildWallInlayStripsGroup(targets, accentHex));
      }

      activeState.wallCladdings.push({
        productId: product.id,
        wallIds: targets.map((w) => w.id),
        curved: targets.some((w) => Math.abs(w.curveOffset ?? 0) > 0.02 || Boolean(w.metadata?.podId)),
        style,
        label,
        ...(product.code ? { code: product.code } : {}),
        description: product.description,
        colourHex: primaryHex,
        colourName: product.finishes?.[0]?.name || colour.name,
        ...(product.finishes?.length ? { finishes: product.finishes } : {}),
        ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
        anchors: targets
          .slice(0, 12)
          .filter((w) => w.start && w.end)
          .map((w) => ({
            x: (w.start![0] + w.end![0]) / 2,
            y: Math.max(1.2, (w.height ?? wallTopM) * 0.5),
            z: (w.start![1] + w.end![1]) / 2,
          })),
      });

      archRefs.push({
        id: `arch-wall-${product.id}`,
        label,
        description: product.description,
        imageUrl: product.imageUrl,
        colour,
        finishes: product.finishes,
      });
    }
  }

  // 4. Wall-Mounted Framed Artworks & Sculptural Reliefs
  if (wallArtworks.length && solidWalls.length) {
    const galleryWalls = solidWalls
      .filter((w) => {
        if (!w.start || !w.end) return false;
        const hasOpening = (w.children ?? []).some((cid) => /^(win|door)/i.test(String(cid)));
        return !hasOpening && wallLengthApprox(w) >= 1.8;
      })
      .sort((a, b) => wallLengthApprox(b) - wallLengthApprox(a));

    let wallCursor = 0;
    for (const product of wallArtworks.slice(0, 4)) {
      if (!galleryWalls.length) break;
      const cls = classifyArchitecturalProduct(product)!;
      const count = Math.max(1, Math.min(3, product.qty || 1));
      const targets: WallLikeNode[] = [];
      for (let i = 0; i < count && i < galleryWalls.length; i++) {
        targets.push(galleryWalls[(wallCursor + i) % galleryWalls.length]);
      }
      wallCursor = (wallCursor + count) % galleryWalls.length;

      const style = cls.artworkStyle ?? 'framed-canvas';
      const artW = product.dims?.w && product.dims.w >= 0.4 && product.dims.w <= 5 ? product.dims.w : style === 'triptych-gallery' ? 2.1 : 1.6;
      const artH = product.dims?.h && product.dims.h >= 0.4 && product.dims.h <= 2.4 ? product.dims.h : 1.15;
      const canvasHex = cls.primaryHex;
      const frameHex = cls.secondaryHex;
      const accentHex = product.finishes?.[2]?.hex || '#a9553c';
      const colour = nextColour(frameHex);
      const label = productLabel(product);

      if (group) {
        group.add(buildWallArtworkGroup(targets, style, canvasHex, frameHex, accentHex, artW, artH));
      }

      activeState.wallArtworks.push({
        productId: product.id,
        wallIds: targets.map((w) => w.id),
        style,
        label,
        ...(product.code ? { code: product.code } : {}),
        description: product.description,
        widthM: artW,
        heightM: artH,
        frameHex,
        canvasHex,
        frameName: cls.frameName,
        ...(product.finishes?.length ? { finishes: product.finishes } : {}),
        ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
        anchors: targets
          .filter((w) => w.start && w.end)
          .map((w) => ({
            x: (w.start![0] + w.end![0]) / 2,
            y: Math.min((w.height ?? wallTopM) - artH * 0.55 - 0.15, 1.52),
            z: (w.start![1] + w.end![1]) / 2,
          })),
      });

      archRefs.push({
        id: `arch-art-${product.id}`,
        label,
        description: product.description,
        imageUrl: product.imageUrl,
        colour,
        finishes: product.finishes,
      });
    }
  }

  syncManualWallTreatmentsToScene(group);
  stores.useViewer?.getState()?.bumpGeometryRevision?.();
  return { architecturalRefs: archRefs, handledProductIds, state: activeState };
}

const MANUAL_GROUP_NAME = 'manual-wall-treatments';

export function getManualWallTreatment(wallId: string): ManualWallTreatment {
  try {
    const stores = getPascalStores() as unknown as {
      useScene?: { getState: () => { nodes?: Record<string, WallLikeNode> } };
    };
    const w = stores.useScene?.getState()?.nodes?.[wallId];
    const t = w?.metadata?.manualWallTreatment as ManualWallTreatment | undefined;
    return t && typeof t === 'object' ? t : {};
  } catch {
    return {};
  }
}

export function syncManualWallTreatmentsToScene(parentGroup?: THREE.Group | null): void {
  try {
    const stores = getPascalStores() as unknown as {
      useScene?: { getState: () => { nodes?: Record<string, WallLikeNode> } };
    };
    const nodes = Object.values(stores.useScene?.getState()?.nodes ?? {}) as WallLikeNode[];
    const styledWalls = nodes.filter(
      (n) => n?.type === 'wall' && n.visible !== false && n.metadata?.manualWallTreatment,
    );

    const sceneObj = findLiveThreeScene();
    const rootGroup = parentGroup ?? (sceneObj ? getOrCreateArchGroup(sceneObj) : null);
    if (rootGroup) {
      const old = rootGroup.getObjectByName(MANUAL_GROUP_NAME);
      if (old) {
        rootGroup.remove(old);
        disposeObject3D(old);
      }
    }
    const manualGroup = rootGroup ? new THREE.Group() : null;
    if (manualGroup && rootGroup) {
      manualGroup.name = MANUAL_GROUP_NAME;
      manualGroup.userData = { architecturalLock: true, architecturalKind: 'manual-wall-treatments' };
      rootGroup.add(manualGroup);
    }

    // Refresh manual cladding, glass, decor & slab finish entries inside activeState
    activeState.wallCladdings = activeState.wallCladdings.filter((c) => !c.productId.startsWith('manual-wall-'));
    activeState.wallArtworks = activeState.wallArtworks.filter((a) => !a.productId.startsWith('manual-art-'));
    activeState.glazingExecutions = activeState.glazingExecutions.filter((g) => !g.productId?.startsWith('manual-glass-'));
    activeState.slabFinishes = [];

    const styledSlabs = (nodes as unknown as SlabLikeNode[]).filter(
      (n) => n?.type === 'slab' && n.visible !== false && n.metadata?.manualSlabTreatment,
    );
    for (const s of styledSlabs) {
      const st = s.metadata!.manualSlabTreatment as ManualSlabTreatment;
      const presetSpec = SLAB_CLADDING_PRESETS.find((p) => p.id === (st.claddingPreset ?? 'parquet')) ?? SLAB_CLADDING_PRESETS[0];
      const colourHex = st.surfaceMode === 'paint' ? (st.paintHex || st.primaryHex || '#e3ded6') : (st.primaryHex || presetSpec.hex);
      const paintLabel =
        SLAB_PAINT_PRESETS.find((p) => p.hex.toLowerCase() === colourHex.toLowerCase())?.label ?? colourHex;
      const sheenLabel = st.paintSheen === 'polished' ? 'Polished' : st.paintSheen === 'satin' ? 'Satin' : 'Matte';
      const label =
        st.surfaceMode === 'paint'
          ? `${paintLabel} ${sheenLabel} Floor`
          : presetSpec.label;
      activeState.slabFinishes.push({
        slabId: s.id,
        label,
        description:
          st.surfaceMode === 'paint'
            ? `${sheenLabel} architectural floor screed/coat in ${colourHex}`
            : `${presetSpec.label} flooring finish across slab ${s.id}`,
        colourHex,
      });
    }

    const heights = styledWalls.map((w) => w.height ?? 3.0).filter((h) => h > 1.5);
    const wallTopM = heights.length ? Math.max(...heights) : 3.0;

    for (const w of styledWalls) {
      const t = w.metadata!.manualWallTreatment as ManualWallTreatment;
      const side = t.side ?? 'both';
      const mode =
        t.surfaceMode ??
        (t.claddingPreset && t.claddingPreset !== 'none'
          ? 'cladding'
          : t.paintHex
            ? 'paint'
            : undefined);
      const presetSpec = WALL_CLADDING_PRESETS.find((p) => p.id === (t.claddingPreset ?? 'none')) ?? WALL_CLADDING_PRESETS[0];
      const primaryHex = t.primaryHex || presetSpec.primaryHex;
      const accentHex = t.accentHex || presetSpec.accentHex;
      const midAnchor =
        w.start && w.end
          ? [{ x: (w.start[0] + w.end[0]) / 2, y: Math.max(1.2, (w.height ?? wallTopM) * 0.5), z: (w.start[1] + w.end[1]) / 2 }]
          : [];

      if (mode === 'paint') {
        const paintHex = t.paintHex || primaryHex || WALL_PAINT_PRESETS[0].hex;
        const paintLabel =
          WALL_PAINT_PRESETS.find((p) => p.hex.toLowerCase() === paintHex.toLowerCase())?.label ?? paintHex;
        const sheenLabel = t.paintSheen === 'satin' ? 'Satin' : 'Matte';
        activeState.wallCladdings.push({
          productId: `manual-wall-${w.id}`,
          wallIds: [w.id],
          curved: Math.abs(w.curveOffset ?? 0) > 0.02 || Boolean(w.metadata?.podId),
          style: 'painted-plaster',
          label: `${paintLabel} ${sheenLabel} Paint${t.ledCove ? ' + Warm LED Cove' : ''}${t.crown ? ' + Crown Moulding' : ''}`,
          description: `${sheenLabel} painted plaster finish (${paintHex}) applied to ${side} wall face(s)`,
          colourHex: paintHex,
          colourName: paintLabel,
          finishes: [{ role: 'Paint', name: `${paintLabel} (${sheenLabel})`, hex: paintHex }],
          anchors: midAnchor,
        });
      } else if (mode === 'clear-glass' || mode === 'fluted-glass') {
        const frameHex = t.accentHex || '#2f3237';
        if (manualGroup) {
          manualGroup.add(buildGlazingMullions([w], frameHex, wallTopM));
        }
        const gStyle: GlazingStyle = mode === 'fluted-glass' ? 'fluted-glass' : 'single-glazed-slim';
        const glassHex = mode === 'fluted-glass' ? '#d8e4e8' : '#bad8e4';
        activeState.glazingExecutions.push({
          productId: `manual-glass-${w.id}`,
          wallIds: [w.id],
          curved: Math.abs(w.curveOffset ?? 0) > 0.02 || Boolean(w.metadata?.podId),
          style: gStyle,
          label: mode === 'fluted-glass' ? 'Fluted Glass Partition' : 'Clear Slim Glass Partition',
          description: `${mode === 'fluted-glass' ? 'Reeded fluted' : 'Clear'} tempered glass partition with ${frameHex} slim perimeter frame`,
          glassHex,
          frameHex,
          frameName: frameHex.toLowerCase() === '#8a6d46' ? 'brushed bronze aluminium' : 'slim architectural aluminium',
          anchors: midAnchor,
        });
      } else if (t.claddingPreset && t.claddingPreset !== 'none') {
        if (manualGroup) {
          if (presetSpec.style === 'fluted-wood') {
            manualGroup.add(buildWallFlutesGroup([w], primaryHex, accentHex, side));
          } else if (presetSpec.style === 'wood-veneer' || presetSpec.style === 'metal-inlay') {
            manualGroup.add(buildWallInlayStripsGroup([w], accentHex, side));
          }
        }
        activeState.wallCladdings.push({
          productId: `manual-wall-${w.id}`,
          wallIds: [w.id],
          curved: Math.abs(w.curveOffset ?? 0) > 0.02 || Boolean(w.metadata?.podId),
          style: presetSpec.style,
          label: `${presetSpec.label}${t.ledCove ? ' + Warm LED Cove' : ''}${t.crown ? ' + Crown Moulding' : ''}`,
          description: `${presetSpec.label} cladding applied to ${side} wall face(s)`,
          colourHex: primaryHex,
          colourName: presetSpec.label,
          finishes: [
            { role: 'Primary', name: presetSpec.label, hex: primaryHex },
            { role: 'Trim', name: 'Architectural Trim', hex: accentHex },
          ],
          anchors: midAnchor,
        });
      }

      if (t.ledCove && manualGroup) {
        manualGroup.add(buildWallLedCoveGroup([w], side));
      }

      if (t.decorKind && t.decorKind !== 'none') {
        const wallLen = wallLengthApprox(w);
        const artW = Math.min(2.2, Math.max(0.85, wallLen * 0.45));
        const artH = t.decorKind === 'backlit-mirror' ? 1.55 : 1.15;
        if (manualGroup) {
          manualGroup.add(buildWallDecorGroup([w], t.decorKind, primaryHex, accentHex, accentHex, artW, artH, side, t.decorImageUrl));
        }
        if (t.decorKind === 'framed-canvas' || t.decorKind === 'sculptural-relief' || t.decorKind === 'triptych-gallery') {
          activeState.wallArtworks.push({
            productId: `manual-art-${w.id}`,
            wallIds: [w.id],
            style: t.decorKind,
            label: t.decorTitle || WALL_DECOR_PRESETS.find((d) => d.id === t.decorKind)?.label || 'Wall Artwork',
            description: `${t.decorKind} wall artwork mounted on wall ${w.id}`,
            widthM: artW,
            heightM: artH,
            frameHex: accentHex,
            canvasHex: primaryHex,
            frameName: 'architectural frame',
            ...(t.decorImageUrl ? { imageUrl: t.decorImageUrl } : {}),
            anchors: w.start && w.end ? [{ x: (w.start[0] + w.end[0]) / 2, y: Math.min((w.height ?? wallTopM) - artH * 0.55 - 0.15, 1.52), z: (w.start[1] + w.end[1]) / 2 }] : [],
          });
        }
      }
    }
  } catch {
    /* non-fatal when stores are absent */
  }
}

export function applyManualWallTreatment(
  wallIds: readonly string[],
  patch: Partial<ManualWallTreatment>,
  onInvalidate?: () => void,
): void {
  if (!wallIds.length) return;
  const stores = getPascalStores() as unknown as {
    useScene?: {
      getState: () => {
        nodes?: Record<string, WallLikeNode>;
        updateNode?: (id: string, data: Record<string, unknown>) => void;
        markDirty?: (id: string) => void;
      };
    };
    useViewer?: { getState: () => { bumpGeometryRevision?: () => void } };
  };
  const sceneStore = stores.useScene?.getState();
  if (!sceneStore?.nodes || !sceneStore.updateNode) return;

  const dirtyIds = new Set<string>();
  const allWalls = Object.values(sceneStore.nodes).filter(
    (n): n is WallLikeNode => Boolean(n && n.type === 'wall' && Array.isArray(n.start) && Array.isArray(n.end)),
  );
  const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.12;
  const markNeighborsDirty = (w: WallLikeNode) => {
    if (!w.start || !w.end) return;
    for (const other of allWalls) {
      if (dirtyIds.has(other.id) || !other.start || !other.end) continue;
      if (
        near(w.start, other.start) ||
        near(w.start, other.end) ||
        near(w.end, other.start) ||
        near(w.end, other.end)
      ) {
        dirtyIds.add(other.id);
      }
    }
  };

  runBatchHistoryStep(stores.useScene, () => {
    for (const wallId of wallIds) {
      const w = sceneStore.nodes?.[wallId];
      if (!w || w.type !== 'wall') continue;
      const prev = ((w.metadata?.manualWallTreatment as ManualWallTreatment | undefined) ?? {});
      let inferredMode = patch.surfaceMode ?? prev.surfaceMode;
      if (!patch.surfaceMode) {
        if (patch.claddingPreset && patch.claddingPreset !== 'none') inferredMode = 'cladding';
        else if (patch.paintHex) inferredMode = 'paint';
        else if (patch.claddingPreset === 'none' && prev.surfaceMode === 'cladding') inferredMode = undefined;
      }

      const next: ManualWallTreatment = {
        ...prev,
        ...patch,
        ...(inferredMode ? { surfaceMode: inferredMode } : {}),
      };
      if (!inferredMode) delete next.surfaceMode;
      if (inferredMode === 'paint' || inferredMode === 'clear-glass' || inferredMode === 'fluted-glass') {
        if (!patch.claddingPreset) next.claddingPreset = 'none';
        if (inferredMode === 'paint' && !next.paintHex) next.paintHex = WALL_PAINT_PRESETS[0].hex;
      }

      const side = next.side ?? 'both';
      const presetSpec = WALL_CLADDING_PRESETS.find((p) => p.id === (next.claddingPreset ?? 'none')) ?? WALL_CLADDING_PRESETS[0];
      const primaryHex =
        inferredMode === 'paint'
          ? (patch.paintHex ?? patch.primaryHex ?? next.paintHex ?? WALL_PAINT_PRESETS[0].hex)
          : (patch.primaryHex ?? (patch.claddingPreset ? presetSpec.primaryHex : (prev.primaryHex ?? presetSpec.primaryHex)));
      const accentHex = patch.accentHex ?? (patch.claddingPreset ? presetSpec.accentHex : (prev.accentHex ?? presetSpec.accentHex));
      next.primaryHex = primaryHex;
      next.accentHex = accentHex;

      let thicknessPatch: Record<string, unknown> = {};
      const curT = typeof w.thickness === 'number' && Number.isFinite(w.thickness) ? w.thickness : 0.2;
      if (inferredMode === 'clear-glass' || inferredMode === 'fluted-glass') {
        if (curT > 0.06) {
          next.savedSolidThicknessM = prev.savedSolidThicknessM ?? curT;
          thicknessPatch = { thickness: STANDARD_GLASS_WALL_THICKNESS_M };
          markNeighborsDirty(w);
        }
      } else if (typeof prev.savedSolidThicknessM === 'number' && (typeof w.thickness !== 'number' || w.thickness <= 0.06)) {
        thicknessPatch = { thickness: prev.savedSolidThicknessM };
        delete next.savedSolidThicknessM;
        markNeighborsDirty(w);
      }

      let wallMatPatch: Record<string, unknown>;
      let treatmentMeta: Record<string, unknown> | undefined;
      if (inferredMode === 'paint') {
        const paintHex = next.paintHex || primaryHex;
        const roughness = next.paintSheen === 'satin' ? 0.42 : 0.84;
        wallMatPatch = buildWallSurfaceMaterialPatch(w, side, {
          preset: 'custom',
          properties: {
            color: paintHex,
            roughness,
            metalness: 0.02,
            opacity: 1,
            transparent: false,
            side: 'double',
          },
        });
        treatmentMeta = {
          role: 'wall-cladding',
          style: 'painted-plaster',
          primaryHex: paintHex,
          accentHex,
        };
      } else if (inferredMode === 'clear-glass' || inferredMode === 'fluted-glass') {
        const glassHex = inferredMode === 'fluted-glass' ? '#d8e4e8' : '#bad8e4';
        wallMatPatch = buildWallSurfaceMaterialPatch(w, 'both', {
          preset: 'glass',
          properties: {
            color: glassHex,
            roughness: inferredMode === 'fluted-glass' ? 0.36 : 0.08,
            metalness: 0.08,
            opacity: inferredMode === 'fluted-glass' ? 0.56 : 0.32,
            transparent: true,
            side: 'double',
          },
        });
        treatmentMeta = {
          role: 'glazing-partition',
          style: inferredMode === 'fluted-glass' ? 'fluted-glass' : 'single-glazed-slim',
          primaryHex: glassHex,
          accentHex,
        };
      } else if (next.claddingPreset && next.claddingPreset !== 'none') {
        wallMatPatch = buildWallSurfaceMaterialPatch(w, side, {
          preset: 'custom',
          properties: {
            color: primaryHex,
            roughness: presetSpec.roughness,
            metalness: presetSpec.metalness,
            opacity: 1,
            transparent: false,
            side: 'double',
          },
        });
        treatmentMeta = {
          role: 'wall-cladding',
          style: presetSpec.style,
          primaryHex,
          accentHex,
        };
      } else {
        wallMatPatch = {
          materialPreset: undefined,
          interiorMaterialPreset: undefined,
          exteriorMaterialPreset: undefined,
          interiorMaterial: undefined,
          exteriorMaterial: undefined,
          material: undefined,
        };
      }

      const trimSide = side;
      const updatePayload: Record<string, unknown> = {
        ...wallMatPatch,
        ...thicknessPatch,
        skirting: next.skirting
          ? { enabled: true, sides: trimSide, height: 0.12, proud: 0.018, profile: 'base-modern' }
          : { enabled: false, sides: trimSide, height: 0.12, proud: 0.018, profile: 'base-modern' },
        crown: next.crown
          ? { enabled: true, sides: trimSide, height: 0.1, proud: 0.035, profile: 'crown-cove' }
          : { enabled: false, sides: trimSide, height: 0.1, proud: 0.035, profile: 'crown-cove' },
        chairRail: next.chairRail
          ? { enabled: true, sides: trimSide, height: 0.055, proud: 0.02, profile: 'rail-stepped', offsetY: 1.05 }
          : { enabled: false, sides: trimSide, height: 0.055, proud: 0.02, profile: 'rail-stepped', offsetY: 1.05 },
        metadata: {
          ...(w.metadata ?? {}),
          manualWallTreatment: next,
          ...(treatmentMeta ? { architecturalTreatment: treatmentMeta } : {}),
        },
      };
      sceneStore.updateNode?.(wallId, updatePayload);
      dirtyIds.add(wallId);
    }
  });

  for (const id of dirtyIds) {
    sceneStore.markDirty?.(id);
  }
  syncManualWallTreatmentsToScene();
  stores.useViewer?.getState()?.bumpGeometryRevision?.();
  dispatchSceneInvalidate();
  onInvalidate?.();
}

export function updateWallPropertiesLive(
  wallIds: readonly string[],
  props: { height?: number; thickness?: number; visible?: boolean },
  onInvalidate?: () => void,
): void {
  if (!wallIds.length) return;
  const stores = getPascalStores() as unknown as {
    useScene?: {
      getState: () => {
        nodes?: Record<string, WallLikeNode>;
        updateNode?: (id: string, data: Record<string, unknown>) => void;
        markDirty?: (id: string) => void;
      };
    };
    useViewer?: { getState: () => { bumpGeometryRevision?: () => void } };
  };
  const sceneStore = stores.useScene?.getState();
  if (!sceneStore?.nodes || !sceneStore.updateNode) return;

  const patch: Record<string, unknown> = {};
  if (typeof props.height === 'number' && Number.isFinite(props.height)) {
    patch.height = Math.round(Math.max(0.5, Math.min(6.0, props.height)) * 100) / 100;
  }
  if (typeof props.thickness === 'number' && Number.isFinite(props.thickness)) {
    patch.thickness = Math.round(Math.max(0.02, Math.min(0.6, props.thickness)) * 1000) / 1000;
  }
  if (typeof props.visible === 'boolean') {
    patch.visible = props.visible;
  }
  if (Object.keys(patch).length === 0) return;

  const dirtyIds = new Set<string>();
  const allWalls = Object.values(sceneStore.nodes).filter(
    (n): n is WallLikeNode => Boolean(n && n.type === 'wall' && Array.isArray(n.start) && Array.isArray(n.end)),
  );
  const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.12;

  runBatchHistoryStep(stores.useScene, () => {
    for (const wallId of wallIds) {
      const w = sceneStore.nodes?.[wallId];
      if (!w || w.type !== 'wall') continue;
      sceneStore.updateNode?.(wallId, patch);
      dirtyIds.add(wallId);
      if (w.start && w.end) {
        for (const other of allWalls) {
          if (dirtyIds.has(other.id) || !other.start || !other.end) continue;
          if (
            near(w.start, other.start) ||
            near(w.start, other.end) ||
            near(w.end, other.start) ||
            near(w.end, other.end)
          ) {
            dirtyIds.add(other.id);
          }
        }
      }
    }
  });

  for (const id of dirtyIds) {
    sceneStore.markDirty?.(id);
  }
  syncManualWallTreatmentsToScene();
  stores.useViewer?.getState()?.bumpGeometryRevision?.();
  dispatchSceneInvalidate();
  onInvalidate?.();
}

export function closeWallGapsAndExtend(
  wallIds: readonly string[],
  onInvalidate?: () => void,
  maxGapM = 1.8,
): number {
  if (!wallIds.length) return 0;
  const stores = getPascalStores() as unknown as {
    useScene?: {
      getState: () => {
        nodes?: Record<string, WallLikeNode>;
        updateNode?: (id: string, data: Record<string, unknown>) => void;
        markDirty?: (id: string) => void;
      };
    };
    useViewer?: { getState: () => { bumpGeometryRevision?: () => void } };
  };
  const sceneStore = stores.useScene?.getState();
  if (!sceneStore?.nodes || !sceneStore.updateNode) return 0;

  const closure = computeWallGapClosures(
    wallIds,
    sceneStore.nodes as unknown as Record<string, WallLike | undefined>,
    maxGapM,
  );
  if (closure.wallUpdates.length === 0) return 0;

  runBatchHistoryStep(stores.useScene, () => {
    for (const wu of closure.wallUpdates) {
      sceneStore.updateNode?.(wu.id, { start: wu.start, end: wu.end });
    }
    for (const cu of closure.childUpdates) {
      sceneStore.updateNode?.(cu.id, { position: cu.position });
    }
  });

  for (const id of closure.dirtyWallIds) {
    sceneStore.markDirty?.(id);
  }
  for (const n of Object.values(sceneStore.nodes)) {
    if (n?.type === 'slab') sceneStore.markDirty?.(n.id);
  }
  syncManualWallTreatmentsToScene();
  stores.useViewer?.getState()?.bumpGeometryRevision?.();
  dispatchSceneInvalidate();
  onInvalidate?.();
  return closure.wallUpdates.length;
}

export function clearManualWallTreatment(wallIds: readonly string[], onInvalidate?: () => void): void {
  if (!wallIds.length) return;
  const stores = getPascalStores() as unknown as {
    useScene?: {
      getState: () => {
        nodes?: Record<string, WallLikeNode>;
        updateNode?: (id: string, data: Record<string, unknown>) => void;
        markDirty?: (id: string) => void;
      };
    };
    useViewer?: { getState: () => { bumpGeometryRevision?: () => void } };
  };
  const sceneStore = stores.useScene?.getState();
  if (!sceneStore?.nodes || !sceneStore.updateNode) return;

  const dirtyIds = new Set<string>();
  const allWalls = Object.values(sceneStore.nodes).filter(
    (n): n is WallLikeNode => Boolean(n && n.type === 'wall' && Array.isArray(n.start) && Array.isArray(n.end)),
  );
  const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.12;

  runBatchHistoryStep(stores.useScene, () => {
    for (const wallId of wallIds) {
      const w = sceneStore.nodes?.[wallId];
      if (!w || w.type !== 'wall') continue;
      const prev = w.metadata?.manualWallTreatment as ManualWallTreatment | undefined;
      const restoreThickness =
        typeof prev?.savedSolidThicknessM === 'number' && (typeof w.thickness !== 'number' || w.thickness <= 0.06)
          ? prev.savedSolidThicknessM
          : undefined;
      const meta = { ...(w.metadata ?? {}) };
      delete meta.manualWallTreatment;
      delete meta.architecturalTreatment;
      const nextSlots = w.slots ? { ...w.slots } : undefined;
      if (nextSlots) {
        delete nextSlots.interior;
        delete nextSlots.lowerInterior;
        delete nextSlots.middleInterior;
        delete nextSlots.upperInterior;
        delete nextSlots.topInterior;
        delete nextSlots.exterior;
        delete nextSlots.lowerExterior;
        delete nextSlots.middleExterior;
        delete nextSlots.upperExterior;
        delete nextSlots.topExterior;
      }
      sceneStore.updateNode?.(wallId, {
        materialPreset: 'plaster',
        interiorMaterialPreset: undefined,
        exteriorMaterialPreset: undefined,
        interiorMaterial: undefined,
        exteriorMaterial: undefined,
        material: undefined,
        ...(restoreThickness !== undefined ? { thickness: restoreThickness } : {}),
        ...(nextSlots ? { slots: nextSlots } : {}),
        skirting: { enabled: false, sides: 'both', height: 0.12, proud: 0.018, profile: 'base-modern' },
        crown: { enabled: false, sides: 'both', height: 0.1, proud: 0.035, profile: 'crown-cove' },
        chairRail: { enabled: false, sides: 'both', height: 0.055, proud: 0.02, profile: 'rail-stepped', offsetY: 1.05 },
        metadata: meta,
      });
      dirtyIds.add(wallId);
      if (restoreThickness !== undefined && w.start && w.end) {
        for (const other of allWalls) {
          if (dirtyIds.has(other.id) || !other.start || !other.end) continue;
          if (
            near(w.start, other.start) ||
            near(w.start, other.end) ||
            near(w.end, other.start) ||
            near(w.end, other.end)
          ) {
            dirtyIds.add(other.id);
          }
        }
      }
    }
  });

  for (const id of dirtyIds) {
    sceneStore.markDirty?.(id);
  }
  syncManualWallTreatmentsToScene();
  stores.useViewer?.getState()?.bumpGeometryRevision?.();
  dispatchSceneInvalidate();
  onInvalidate?.();
}

export function getManualSlabTreatment(slabId: string): ManualSlabTreatment {
  try {
    const stores = getPascalStores() as unknown as {
      useScene?: { getState: () => { nodes?: Record<string, SlabLikeNode> } };
    };
    const s = stores.useScene?.getState()?.nodes?.[slabId];
    const t = s?.metadata?.manualSlabTreatment as ManualSlabTreatment | undefined;
    return t ? { ...t } : {};
  } catch {
    return {};
  }
}

export function applyManualSlabTreatment(
  slabIds: readonly string[],
  patch: Partial<ManualSlabTreatment>,
  onInvalidate?: () => void,
): void {
  if (!slabIds.length) return;
  const stores = getPascalStores() as unknown as {
    useScene?: {
      getState: () => {
        nodes?: Record<string, SlabLikeNode>;
        updateNode?: (id: string, data: Record<string, unknown>) => void;
        markDirty?: (id: string) => void;
      };
    };
    useViewer?: { getState: () => { bumpGeometryRevision?: () => void } };
  };
  const sceneStore = stores.useScene?.getState();
  if (!sceneStore?.nodes || !sceneStore.updateNode) return;

  runBatchHistoryStep(stores.useScene, () => {
    for (const slabId of slabIds) {
      const s = sceneStore.nodes?.[slabId];
      if (!s || s.type !== 'slab') continue;
      const prev = ((s.metadata?.manualSlabTreatment as ManualSlabTreatment | undefined) ?? {});
      let inferredMode = patch.surfaceMode ?? prev.surfaceMode;
      if (!patch.surfaceMode) {
        if (patch.claddingPreset) inferredMode = 'cladding';
        else if (patch.paintHex) inferredMode = 'paint';
      }
      const mode: 'paint' | 'cladding' = inferredMode ?? 'cladding';
      const next: ManualSlabTreatment = { ...prev, ...patch, surfaceMode: mode };
      const presetSpec =
        SLAB_CLADDING_PRESETS.find((p) => p.id === (next.claddingPreset ?? 'parquet')) ?? SLAB_CLADDING_PRESETS[0];

      const colorHex =
        mode === 'paint'
          ? (patch.paintHex ?? patch.primaryHex ?? next.paintHex ?? SLAB_PAINT_PRESETS[0].hex)
          : (patch.primaryHex ?? (patch.claddingPreset ? presetSpec.hex : (prev.primaryHex ?? presetSpec.hex)));
      next.primaryHex = colorHex;
      if (mode === 'paint' && !next.paintHex) next.paintHex = colorHex;

      const roughness =
        mode === 'paint'
          ? next.paintSheen === 'polished'
            ? 0.22
            : next.paintSheen === 'satin'
              ? 0.44
              : 0.84
          : presetSpec.roughness;
      const metalness = mode === 'paint' ? 0.02 : presetSpec.metalness;

      const nextSlots = s.slots ? { ...s.slots } : undefined;
      if (nextSlots) {
        delete nextSlots.surface;
        delete nextSlots.side;
      }

      // IMPORTANT: Never pass side: 'double' on Slab materials — SlabSystem/geometry requires FrontSide for WebGPU MRT pass.
      sceneStore.updateNode?.(slabId, {
        materialPreset: undefined,
        material: {
          preset: 'custom',
          properties: {
            color: colorHex,
            roughness,
            metalness,
          },
        },
        ...(nextSlots ? { slots: nextSlots } : {}),
        metadata: {
          ...(s.metadata ?? {}),
          manualSlabTreatment: next,
        },
      });
      sceneStore.markDirty?.(slabId);
    }
  });

  syncManualWallTreatmentsToScene();
  stores.useViewer?.getState()?.bumpGeometryRevision?.();
  dispatchSceneInvalidate();
  onInvalidate?.();
}

export function updateSlabPropertiesLive(
  slabIds: readonly string[],
  props: { elevation?: number; visible?: boolean },
  onInvalidate?: () => void,
): void {
  if (!slabIds.length) return;
  const stores = getPascalStores() as unknown as {
    useScene?: {
      getState: () => {
        nodes?: Record<string, SlabLikeNode>;
        updateNode?: (id: string, data: Record<string, unknown>) => void;
        markDirty?: (id: string) => void;
      };
    };
    useViewer?: { getState: () => { bumpGeometryRevision?: () => void } };
  };
  const sceneStore = stores.useScene?.getState();
  if (!sceneStore?.nodes || !sceneStore.updateNode) return;

  const patch: Record<string, unknown> = {};
  if (typeof props.elevation === 'number' && Number.isFinite(props.elevation)) {
    patch.elevation = Math.round(Math.max(-0.5, Math.min(1.0, props.elevation)) * 100) / 100;
  }
  if (typeof props.visible === 'boolean') {
    patch.visible = props.visible;
  }
  if (Object.keys(patch).length === 0) return;

  runBatchHistoryStep(stores.useScene, () => {
    for (const slabId of slabIds) {
      const s = sceneStore.nodes?.[slabId];
      if (!s || s.type !== 'slab') continue;
      sceneStore.updateNode?.(slabId, patch);
      sceneStore.markDirty?.(slabId);
    }
  });

  syncManualWallTreatmentsToScene();
  stores.useViewer?.getState()?.bumpGeometryRevision?.();
  dispatchSceneInvalidate();
  onInvalidate?.();
}

export function clearManualSlabTreatment(slabIds: readonly string[], onInvalidate?: () => void): void {
  if (!slabIds.length) return;
  const stores = getPascalStores() as unknown as {
    useScene?: {
      getState: () => {
        nodes?: Record<string, SlabLikeNode>;
        updateNode?: (id: string, data: Record<string, unknown>) => void;
        markDirty?: (id: string) => void;
      };
    };
    useViewer?: { getState: () => { bumpGeometryRevision?: () => void } };
  };
  const sceneStore = stores.useScene?.getState();
  if (!sceneStore?.nodes || !sceneStore.updateNode) return;

  runBatchHistoryStep(stores.useScene, () => {
    for (const slabId of slabIds) {
      const s = sceneStore.nodes?.[slabId];
      if (!s || s.type !== 'slab') continue;
      const meta = { ...(s.metadata ?? {}) };
      delete meta.manualSlabTreatment;
      const nextSlots = s.slots ? { ...s.slots } : undefined;
      if (nextSlots) {
        delete nextSlots.surface;
        delete nextSlots.side;
      }
      sceneStore.updateNode?.(slabId, {
        materialPreset: 'parquet',
        material: undefined,
        ...(nextSlots ? { slots: nextSlots } : {}),
        metadata: meta,
      });
      sceneStore.markDirty?.(slabId);
    }
  });

  syncManualWallTreatmentsToScene();
  stores.useViewer?.getState()?.bumpGeometryRevision?.();
  dispatchSceneInvalidate();
  onInvalidate?.();
}
