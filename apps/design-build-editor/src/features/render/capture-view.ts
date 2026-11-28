// features/render/capture-view.ts
// Captures the exact 3D view for the AI render: a clean "beauty pass" of the
// live Pascal scene (2D plan underlay hidden), rendered at a higher pixel ratio
// for crisp wall and window edges, centre-cropped to the nearest aspect ratio
// the image models accept. Browser-only.

import * as THREE from 'three';
import { getPascalStores, type ViewerHandle } from 'design-build-simplified-viewer-shell';
import {
  centreCrop,
  cropCentredAt,
  cropFieldOfView,
  focusCrop,
  nearestAspect,
  type AspectChoice,
  type NormRect,
  type OpeningInView,
  type ViewKind,
} from './render-presets';
import {
  depthMapDataUrl,
  depthMeshGuideDataUrl,
  depthMeshOverlayDataUrl,
  edgeGuideDataUrl,
  edgeOverlayDataUrl,
  gridLineMask,
  linearizeSrgbDepth,
  loadImage,
  maskGuideDataUrl,
  maskOverlayDataUrl,
  modelLineMask,
  rasterize,
  type RgbaImage,
} from './geometry-fidelity';
import { hideProductPads, isProductCardMesh } from '../furniture/product-cards';
import { getActiveArchitecturalFeatures } from '../furniture/architectural-features';
import type { ProductFinish } from '../furniture/product-refs';

export interface PreparedView {
  /** JPEG data URL of the cropped view (what the model receives as image 1). */
  dataUrl: string;
  width: number;
  height: number;
  aspect: AspectChoice;
  viewKind: ViewKind;
  /** Depth-weighted, 3D mesh-framed line map of the view (optional image 2). */
  edgeGuideUrl: string;
  /** Camera-space linear Z-depth map (near bright white -> far dark charcoal, optional image 3). */
  depthGuideUrl?: string;
  /** Transparent cyan edge overlay, for checking the result by eye. */
  edgeOverlayUrl: string;
  /** Transparent overlay highlighting foreground/midground/background edges + 3D mesh grid. */
  depthMeshOverlayUrl?: string;
  /** True when `edgeGuideUrl` encodes 3D perspective mesh framing & depth weighting. */
  meshFramedGuide?: boolean;
  /** Metric camera-space near..far depth range (in metres) represented by `depthGuideUrl`. */
  depthRangeM?: { nearM: number; farM: number };
  /** Interior views: lens of the view, 35 mm-equivalent. */
  lensMm?: number;
  /** The edge guide and overlay were drawn from the 3D model itself (not from the picture). */
  lineGuide?: boolean;
  /** Doors and windows visible in the view, from the 3D scene (interior views). */
  openings?: OpeningInView[];
  /** Angles the view covers, in degrees. */
  fovDeg?: { h: number; v: number };
  /** Camera pitch in degrees (positive = looking up). */
  pitchDeg?: number;
  /** A plain ceiling was added on top of the walls for the capture. */
  ceilingInView?: boolean;
  /** Parallel projection (orthographic camera, e.g. an isometric view): no perspective to keep. */
  parallel?: boolean;
  /** Furniture stand-ins in the view (from the drawing), grouped by the product they carry. */
  furniture?: FurnitureInView;
  /** Visible architectural ceiling canopies, gypsum wall claddings & free-form glazing executions. */
  architectural?: ArchitecturalInView;
}

export interface ArchitecturalCeilingOnScreen {
  label: string;
  code?: string;
  shape: string;
  style: string;
  widthM: number;
  depthM: number;
  dropM: number;
  x: number;
  y: number;
  distM?: number;
  finishes?: readonly ProductFinish[];
  imageUrl?: string;
}

export interface ArchitecturalWallCladdingOnScreen {
  label: string;
  code?: string;
  style: string;
  curved: boolean;
  colourHex: string;
  spots: { x: number; y: number; distM?: number }[];
  finishes?: readonly ProductFinish[];
  imageUrl?: string;
}

export interface ArchitecturalGlazingOnScreen {
  label: string;
  code?: string;
  style: string;
  curved: boolean;
  frameName: string;
  spots: { x: number; y: number; distM?: number }[];
  finishes?: readonly ProductFinish[];
  imageUrl?: string;
}

export interface ArchitecturalArtworkOnScreen {
  label: string;
  code?: string;
  style: string;
  widthM: number;
  heightM: number;
  frameName: string;
  spots: { x: number; y: number; distM?: number }[];
  finishes?: readonly ProductFinish[];
  imageUrl?: string;
}

export interface ArchitecturalSlabFinishOnScreen {
  slabId: string;
  label: string;
  description: string;
  colourHex: string;
}

export interface ArchitecturalOnScreen {
  ceilings: ArchitecturalCeilingOnScreen[];
  wallCladdings: ArchitecturalWallCladdingOnScreen[];
  glazingExecutions: ArchitecturalGlazingOnScreen[];
  wallArtworks?: ArchitecturalArtworkOnScreen[];
  slabFinishes?: ArchitecturalSlabFinishOnScreen[];
}

export interface ArchitecturalInView {
  ceilings: (ArchitecturalCeilingOnScreen & { x: number; y: number })[];
  wallCladdings: ArchitecturalWallCladdingOnScreen[];
  glazingExecutions: ArchitecturalGlazingOnScreen[];
  wallArtworks?: ArchitecturalArtworkOnScreen[];
  slabFinishes?: ArchitecturalSlabFinishOnScreen[];
}

/** A place in a prepared view (normalized: 0,0 top left, 1,1 bottom right). */
export interface ViewSpot {
  x: number;
  y: number;
  /** Camera distance in metres, when known. */
  distM?: number;
  /** Which way the piece standing there faces, as seen in the view. */
  facing?: ViewFacing;
  /** What told its front ('table' for a seat turned to its table, 'wall', …). */
  by?: string;
}

/**
 * Which way a piece faces as seen in a view: towards or away from the camera, to the
 * left or right, or turned between them ('-near' towards the camera, '-far' away). Seen
 * from straight above, by the image instead: 'down' (towards its bottom), 'up', and
 * the diagonals between them and left or right.
 */
export type ViewFacing =
  | 'camera'
  | 'away'
  | 'left'
  | 'right'
  | 'left-near'
  | 'right-near'
  | 'left-far'
  | 'right-far'
  | 'down'
  | 'up'
  | 'down-left'
  | 'down-right'
  | 'up-left'
  | 'up-right';

/** Furniture stand-ins in a prepared view; rects and spots are normalized to the view. */
export interface FurnitureInView {
  /** All stand-ins in view, with or without a product. */
  standIns: number;
  /** The stand-ins that carry a BOQ Flow product, most numerous first; `photo` when the product's own photo stands there. */
  products: { productId: string; count: number; kinds: string[]; photo: boolean; architecturalLock?: boolean; x0: number; y0: number; x1: number; y1: number; spots: ViewSpot[] }[];
  /** The stand-ins without a product, by kind (most numerous first). */
  plain: { kind: string; count: number; spots: ViewSpot[] }[];
  /** Stand-ins seen through glass. */
  behindGlass: number;
}

/** One furniture stand-in seen on screen, at its centre (normalized canvas coordinates). */
export interface FurnitureOnScreen {
  kind: string;
  productId?: string;
  /** The product's photo stands on a pad here (no solid stand-in). */
  photo?: boolean;
  /** True for 3D-locked architectural pieces (kiosks, counters, slat screens, feature columns). */
  architecturalLock?: boolean;
  /** Seen through glass (a glazed pod or partition). */
  glass?: boolean;
  /** Which way it faces in the view (pieces whose front the drawing shows). */
  facing?: ViewFacing;
  /** What told its front ('table', 'chair', 'wall', …). */
  by?: string;
  x: number;
  y: number;
  distM?: number;
}

/** Flat passes of the live view (surface orientation, object identity, linear Z-depth, and Z-occluded 3D mesh grid). */
export interface ModelPasses {
  normals: HTMLCanvasElement;
  ids: HTMLCanvasElement;
  depth: HTMLCanvasElement;
  meshGrid: HTMLCanvasElement;
  nearM: number;
  farM: number;
}

/** A door or window on screen, in normalized canvas coordinates. */
export interface OpeningOnScreen {
  kind: 'door' | 'window';
  rect: NormRect;
}

/** What the prompt needs to know about the camera. */
export interface CameraFacts {
  /** Vertical field of the whole canvas, degrees. */
  fovDeg: number;
  /** Canvas width / height. */
  aspect: number;
  /** Optical centre in normalized canvas coordinates (moves with the lens shift). */
  principal: { x: number; y: number };
  pitchDeg: number;
}

/** A fixed render frame (viewfinder): the part of the canvas to keep, and its exact format. */
export interface FrameCrop {
  rect: NormRect;
  aspect: AspectChoice;
}

interface LiveViewer {
  gl: {
    render: (scene: THREE.Scene, camera: THREE.Camera) => unknown;
    domElement: HTMLCanvasElement;
    getPixelRatio?: () => number;
    setPixelRatio?: (r: number) => void;
  };
  scene: THREE.Scene;
  camera: THREE.Camera;
  invalidate?: () => void;
}

/** Node kinds hidden entirely in the beauty pass: the plan underlay and point-cloud scans. */
const HIDDEN_NODE_TYPES = new Set(['guide', 'scan']);
/**
 * Node kinds whose own visuals (lot slab, ground) are hidden while their child
 * nodes (the building) stay: a bare lot next to a roofless building reads as an
 * unfinished floor plate, and image models "complete" it with invented rooms.
 */
const HIDDEN_OWN_VISUAL_TYPES = new Set(['site']);
/** Node kinds that make up the building (used to frame it). */
const BUILDING_NODE_TYPES = new Set(['wall', 'door', 'window', 'slab', 'column', 'roof', 'stair']);

function resolveViewer(handle: ViewerHandle | null): LiveViewer | null {
  const gl = handle?.gl as LiveViewer['gl'] | undefined;
  if (handle && gl && typeof gl.render === 'function' && handle.scene && handle.camera) {
    return { gl, scene: handle.scene, camera: handle.camera, invalidate: handle.invalidate };
  }
  // Fallback: walk from any registered node to the R3F root store.
  try {
    const { sceneRegistry } = getPascalStores() as unknown as { sceneRegistry: { nodes: Map<string, THREE.Object3D> } };
    const any = sceneRegistry.nodes.values().next().value as (THREE.Object3D & { __r3f?: { root?: { getState: () => LiveViewer } } }) | undefined;
    let root: (THREE.Object3D & { __r3f?: { root?: { getState: () => LiveViewer } } }) | undefined = any;
    while (root?.parent) root = root.parent as typeof root;
    const st = root?.__r3f?.root?.getState();
    if (st?.gl && st.scene && st.camera) return st;
  } catch {
    /* no live scene */
  }
  return null;
}

/** Hides `obj`'s own meshes and groups but keeps every registered child node visible. */
function hideOwnVisuals(obj: THREE.Object3D, registered: Set<THREE.Object3D>, restore: THREE.Object3D[]) {
  for (const c of obj.children) {
    if (registered.has(c)) continue;
    let holdsNode = false;
    c.traverse((d) => {
      if (d !== c && registered.has(d)) holdsNode = true;
    });
    if (holdsNode) hideOwnVisuals(c, registered, restore);
    else if (c.visible && !(c as THREE.Light).isLight) {
      c.visible = false;
      restore.push(c);
    }
  }
}

function hideNonModelNodes(scene?: THREE.Scene): () => void {
  const restore: THREE.Object3D[] = [];
  try {
    const selHighlight = scene?.getObjectByName('db-selection-highlight');
    if (selHighlight?.visible) {
      selHighlight.visible = false;
      restore.push(selHighlight);
    }
    const { useScene, sceneRegistry } = getPascalStores() as unknown as {
      useScene: { getState: () => { nodes: Record<string, { id: string; type: string }> } };
      sceneRegistry: { nodes: Map<string, THREE.Object3D> };
    };
    const registered = new Set(sceneRegistry.nodes.values());
    for (const n of Object.values(useScene.getState().nodes ?? {})) {
      const obj = sceneRegistry.nodes.get(n.id);
      if (!obj) continue;
      if (HIDDEN_NODE_TYPES.has(n.type)) {
        if (obj.visible) {
          obj.visible = false;
          restore.push(obj);
        }
      } else if (HIDDEN_OWN_VISUAL_TYPES.has(n.type)) {
        hideOwnVisuals(obj, registered, restore);
      }
    }
  } catch {
    /* registry unavailable: capture as-is */
  }
  return () => {
    for (const o of restore) o.visible = true;
  };
}

/** On-screen box of the building's elements (walls, openings, slabs), or null. */
function buildingScreenRect(v: LiveViewer): NormRect | null {
  try {
    const { useScene, sceneRegistry } = getPascalStores() as unknown as {
      useScene: { getState: () => { nodes: Record<string, { id: string; type: string }> } };
      sceneRegistry: { nodes: Map<string, THREE.Object3D> };
    };
    // The camera may have moved since the last frame (frameloop "never"):
    // refresh its matrices so the box is projected with the view being captured.
    v.camera.updateMatrixWorld();
    (v.camera as THREE.PerspectiveCamera).updateProjectionMatrix?.();
    const box = new THREE.Box3();
    for (const n of Object.values(useScene.getState().nodes ?? {})) {
      if (!BUILDING_NODE_TYPES.has(n.type)) continue;
      const o = sceneRegistry.nodes.get(n.id);
      if (o?.visible) box.expandByObject(o);
    }
    if (box.isEmpty()) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(v.camera);
      if (p.z > 1) return null; // a corner is behind the camera: keep the full frame
      x0 = Math.min(x0, (p.x + 1) / 2);
      x1 = Math.max(x1, (p.x + 1) / 2);
      y0 = Math.min(y0, (1 - p.y) / 2);
      y1 = Math.max(y1, (1 - p.y) / 2);
    }
    const r = { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(1, x1), y1: Math.min(1, y1) };
    return r.x1 - r.x0 > 0.02 && r.y1 - r.y0 > 0.02 ? r : null;
  } catch {
    return null;
  }
}

function viewKindOf(camera: THREE.Camera): ViewKind {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  // Looking down by more than ~27° reads as a cutaway / 3D plan view.
  return dir.y < -0.45 ? 'cutaway' : 'eye-level';
}

/** True when the live perspective camera is positioned inside the building footprint at eye/room height. */
export function isCameraInsideBuilding(handle: ViewerHandle | null): { interior: boolean; lensMm: number } {
  const v = resolveViewer(handle);
  if (!v) return { interior: false, lensMm: 0 };
  const cam = v.camera as THREE.PerspectiveCamera;
  if (!cam.isPerspectiveCamera) return { interior: false, lensMm: 0 };
  const ext = buildingExtents();
  if (!ext) return { interior: false, lensMm: 0 };
  const size = ext.box.getSize(new THREE.Vector3());
  if (size.x < 0.4 || size.z < 0.4) return { interior: false, lensMm: 0 };
  v.camera.updateMatrixWorld();
  const pos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  const topY = (ext.wallTop ?? 3.0) + 0.35;
  const insideX = pos.x >= ext.box.min.x + 0.15 && pos.x <= ext.box.max.x - 0.15;
  const insideZ = pos.z >= ext.box.min.z + 0.15 && pos.z <= ext.box.max.z - 0.15;
  const insideY = pos.y >= 0.25 && pos.y <= topY;
  const interior = dir.y > -0.42 && insideX && insideZ && insideY;
  const fovRad = THREE.MathUtils.degToRad(Math.max(5, Math.min(165, cam.fov || 50)));
  const lensMm = interior ? Math.round(18 / Math.tan(fovRad / 2)) : 0;
  return { interior, lensMm };
}

/** View kind of the live camera ('cutaway' when unknown). */
export function currentViewKind(handle: ViewerHandle | null): ViewKind {
  const v = resolveViewer(handle);
  if (!v) return 'cutaway';
  if (isCameraInsideBuilding(handle).interior) return 'interior';
  return viewKindOf(v.camera);
}

/** True when a 3D scene with at least one wall is mounted. */
export function hasRenderableScene(handle: ViewerHandle | null): boolean {
  if (!resolveViewer(handle)) return false;
  try {
    const { useScene } = getPascalStores() as unknown as {
      useScene: { getState: () => { nodes: Record<string, { type: string }> } };
    };
    return Object.values(useScene.getState().nodes ?? {}).some((n) => n.type === 'wall');
  } catch {
    return false;
  }
}

/** The building's box and the usual height of its wall tops, from the scene. */
function buildingExtents(): { box: THREE.Box3; wallTop: number | null } | null {
  try {
    const { useScene, sceneRegistry } = getPascalStores() as unknown as {
      useScene: { getState: () => { nodes: Record<string, { id: string; type: string }> } };
      sceneRegistry: { nodes: Map<string, THREE.Object3D> };
    };
    const box = new THREE.Box3();
    const b = new THREE.Box3();
    const tops: number[] = [];
    for (const n of Object.values(useScene.getState().nodes ?? {})) {
      if (!BUILDING_NODE_TYPES.has(n.type)) continue;
      const o = sceneRegistry.nodes.get(n.id);
      if (!o?.visible) continue;
      b.setFromObject(o);
      if (b.isEmpty()) continue;
      box.union(b);
      if (n.type === 'wall') tops.push(b.max.y);
    }
    if (box.isEmpty()) return null;
    tops.sort((x, y) => x - y);
    return { box, wallTop: tops.length ? tops[tops.length >> 1] : null };
  } catch {
    return null;
  }
}

/**
 * Inside views: a plain ceiling on top of the walls, for the capture only. The
 * model has no ceilings, and asking the image model to invent one made it
 * redraw the walls under it; with the room closed it only re-skins it.
 */
function addCaptureCeiling(scene: THREE.Scene): (() => void) | null {
  const ext = buildingExtents();
  if (!ext || ext.wallTop === null) return null;
  const size = ext.box.getSize(new THREE.Vector3());
  const centre = ext.box.getCenter(new THREE.Vector3());
  const geo = new THREE.PlaneGeometry(size.x + 2, size.z + 2);
  // Subtle directional + warm bounce response separates ceiling from vertical walls without turning dark.
  const mat = new THREE.MeshStandardMaterial({
    color: 0xf1efe9,
    roughness: 0.9,
    metalness: 0.0,
    emissive: 0x8e8b84,
    emissiveIntensity: 0.28,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'db-capture-ceiling';
  mesh.rotation.x = Math.PI / 2; // facing down
  mesh.position.set(centre.x, ext.wallTop - 0.003, centre.z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);
  mesh.updateMatrixWorld(true);
  return () => {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
  };
}

/**
 * Adds directional key + hemisphere + soft camera fill lighting plus grounded contact
 * shadows under freestanding furniture & 3D architectural millwork during the beauty pass.
 * Must be cleaned up BEFORE flat model geometry/depth passes run.
 */
function addCaptureDepthRig(v: LiveViewer): () => void {
  const added: THREE.Object3D[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  let cleaned = false;

  try {
    const scene = v.scene;
    const ext = buildingExtents();
    const centre = ext ? ext.box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const wallTop = ext?.wallTop ?? 3.0;

    const dir = new THREE.DirectionalLight(0xfffdf8, 0.55);
    dir.position.set(centre.x + 12, wallTop + 14, centre.z + 9);
    dir.target.position.set(centre.x, 0, centre.z);
    scene.add(dir);
    scene.add(dir.target);
    dir.target.updateMatrixWorld(true);
    added.push(dir, dir.target);

    const hemi = new THREE.HemisphereLight(0xeef4ff, 0xcbbfae, 0.32);
    scene.add(hemi);
    added.push(hemi);

    v.camera.updateMatrixWorld();
    const camPos = new THREE.Vector3().setFromMatrixPosition(v.camera.matrixWorld);
    const camFill = new THREE.PointLight(0xfffaf0, 0.35, 16, 1.4);
    camFill.position.copy(camPos);
    scene.add(camFill);
    added.push(camFill);

    // Soft grounded contact shadows under freestanding kiosks, columns & plan furniture
    const shadowGroup = new THREE.Group();
    shadowGroup.name = 'db-contact-shadows';
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x181c24, transparent: true, opacity: 0.22, depthWrite: false });
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x181c24, transparent: true, opacity: 0.09, depthWrite: false });
    mats.push(coreMat, haloMat);

    const { useScene, sceneRegistry } = getPascalStores() as unknown as {
      useScene: { getState: () => { nodes: Record<string, { id: string; type: string; metadata?: Record<string, unknown> }> } };
      sceneRegistry: { nodes: Map<string, THREE.Object3D> };
    };
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    for (const n of Object.values(useScene.getState().nodes ?? {})) {
      const isGroundable =
        n.type === 'column' ||
        (n.type === 'item' && (n.metadata?.source === 'plan-furniture' || n.metadata?.architecturalLock === true));
      if (!isGroundable) continue;
      const o = sceneRegistry.nodes.get(n.id);
      if (!o?.visible) continue;
      box.setFromObject(o);
      if (box.isEmpty() || box.min.y > 0.25) continue;
      box.getSize(size);
      if (size.x < 0.1 || size.z < 0.1 || size.x > 8 || size.z > 8) continue;
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      const baseY = Math.max(0.004, box.min.y + 0.004);

      const coreGeo = new THREE.PlaneGeometry(size.x + 0.06, size.z + 0.06);
      const haloGeo = new THREE.PlaneGeometry(size.x + 0.18, size.z + 0.18);
      geos.push(coreGeo, haloGeo);

      const core = new THREE.Mesh(coreGeo, coreMat);
      core.rotation.x = -Math.PI / 2;
      core.position.set(cx, baseY, cz);

      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(cx, 0.002, cz);

      shadowGroup.add(halo, core);
    }
    if (shadowGroup.children.length > 0) {
      scene.add(shadowGroup);
      shadowGroup.updateMatrixWorld(true);
      added.push(shadowGroup);
    }
  } catch {
    /* non-fatal when stores or lights unavailable */
  }

  return () => {
    if (cleaned) return;
    cleaned = true;
    for (const obj of added) v.scene.remove(obj);
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
  };
}

type AnyMaterial = THREE.Material & { visible?: boolean; colorWrite?: boolean; transparent?: boolean; opacity?: number; side?: THREE.Side };

function materialsOf(m: THREE.Mesh): AnyMaterial[] {
  return (Array.isArray(m.material) ? m.material : [m.material]).filter(Boolean) as AnyMaterial[];
}

/** Meshes that actually draw (not picking proxies with hidden or fully transparent materials). */
function drawnMesh(m: THREE.Mesh): boolean {
  return materialsOf(m).some((mt) => mt.visible !== false && mt.colorWrite !== false && !(mt.transparent && (mt.opacity ?? 1) < 0.05));
}

/** A material that lets the eye through (glass and other see-through surfaces, or nothing drawn). */
function seeThrough(mt: AnyMaterial | null | undefined): boolean {
  return (
    !mt ||
    mt.visible === false ||
    mt.colorWrite === false ||
    (!!mt.transparent && (mt.opacity ?? 1) < 0.6) ||
    ((mt as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0.2
  );
}

/**
 * The material a ray hit with: a multi-material mesh (a glass wall with solid cut
 * edges) is drawn with the material of the face that was hit.
 */
function hitMaterial(hit: THREE.Intersection): AnyMaterial | undefined {
  const mat = (hit.object as THREE.Mesh).material;
  if (!Array.isArray(mat)) return mat as AnyMaterial | undefined;
  return (mat[hit.face?.materialIndex ?? 0] ?? mat[0]) as AnyMaterial | undefined;
}

/** Copy of the WebGL/WebGPU canvas as it is right after a render. */
function snapshotCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  return c;
}

/** Builds a Z-testable 3D perspective floor/ceiling grid + freestanding 3D millwork bounding cages. */
function buildSpatialMeshFrame(v: LiveViewer): { lines: THREE.LineSegments; dispose: () => void } | null {
  const ext = buildingExtents();
  if (!ext) return null;
  const pos: number[] = [];
  const pushSeg = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    pos.push(x0, y0, z0, x1, y1, z1);
  };

  const minX = Math.floor(ext.box.min.x) - 1;
  const maxX = Math.ceil(ext.box.max.x) + 1;
  const minZ = Math.floor(ext.box.min.z) - 1;
  const maxZ = Math.ceil(ext.box.max.z) + 1;
  const span = Math.max(maxX - minX, maxZ - minZ);
  const step = span > 80 ? 2.0 : 1.0;

  // 1m x 1m converged perspective floor plane grid (proves open floor aisles behind foreground kiosks)
  for (let x = minX; x <= maxX; x += step) {
    pushSeg(x, 0.008, minZ, x, 0.008, maxZ);
  }
  for (let z = minZ; z <= maxZ; z += step) {
    pushSeg(minX, 0.008, z, maxX, 0.008, z);
  }

  // Fine 0.5m perspective subdivisions within 8m of the camera
  const camPos = new THREE.Vector3().setFromMatrixPosition(v.camera.matrixWorld);
  const fx0 = Math.max(minX, Math.floor(camPos.x - 8));
  const fx1 = Math.min(maxX, Math.ceil(camPos.x + 8));
  const fz0 = Math.max(minZ, Math.floor(camPos.z - 8));
  const fz1 = Math.min(maxZ, Math.ceil(camPos.z + 8));
  for (let x = fx0 + 0.5; x < fx1; x += 1.0) pushSeg(x, 0.009, fz0, x, 0.009, fz1);
  for (let z = fz0 + 0.5; z < fz1; z += 1.0) pushSeg(fx0, 0.009, z, fx1, 0.009, z);

  // Overhead ceiling plane grid (2m x 2m) when capture ceiling is active
  if (ext.wallTop !== null && v.scene.getObjectByName('db-capture-ceiling')) {
    const cy = ext.wallTop - 0.008;
    for (let x = minX; x <= maxX; x += 2.0) pushSeg(x, cy, minZ, x, cy, maxZ);
    for (let z = minZ; z <= maxZ; z += 2.0) pushSeg(minX, cy, z, maxX, cy, z);
  }

  // 3D wireframe bounding cages around freestanding 3D-locked millwork & columns
  try {
    const { useScene, sceneRegistry } = getPascalStores() as unknown as {
      useScene: { getState: () => { nodes: Record<string, { id: string; type: string; metadata?: Record<string, unknown> }> } };
      sceneRegistry: { nodes: Map<string, THREE.Object3D> };
    };
    const b = new THREE.Box3();
    const s = new THREE.Vector3();
    for (const n of Object.values(useScene.getState().nodes ?? {})) {
      if (n.type !== 'column' && !(n.type === 'item' && n.metadata?.architecturalLock === true)) continue;
      const o = sceneRegistry.nodes.get(n.id);
      if (!o?.visible) continue;
      b.setFromObject(o);
      if (b.isEmpty() || b.min.y > 0.35) continue;
      b.getSize(s);
      if (s.x < 0.25 || s.z < 0.25 || s.y < 0.35 || s.x > 7 || s.z > 7) continue;
      const y0 = Math.max(0.012, b.min.y + 0.008);
      const y1 = b.max.y + 0.004;
      const { x: bx0, z: bz0 } = b.min;
      const { x: bx1, z: bz1 } = b.max;
      // Floor footprint outline
      pushSeg(bx0, y0, bz0, bx1, y0, bz0);
      pushSeg(bx1, y0, bz0, bx1, y0, bz1);
      pushSeg(bx1, y0, bz1, bx0, y0, bz1);
      pushSeg(bx0, y0, bz1, bx0, y0, bz0);
      // Top silhouette cage
      pushSeg(bx0, y1, bz0, bx1, y1, bz0);
      pushSeg(bx1, y1, bz0, bx1, y1, bz1);
      pushSeg(bx1, y1, bz1, bx0, y1, bz1);
      pushSeg(bx0, y1, bz1, bx0, y1, bz0);
      // Four vertical corners locking top volume to floor grid
      pushSeg(bx0, y0, bz0, bx0, y1, bz0);
      pushSeg(bx1, y0, bz0, bx1, y1, bz0);
      pushSeg(bx1, y0, bz1, bx1, y1, bz1);
      pushSeg(bx0, y0, bz1, bx0, y1, bz1);
    }
  } catch {
    /* scene store unavailable */
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x1e3a5f, fog: false, depthTest: true, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'db-spatial-mesh-frame';
  lines.frustumCulled = false;
  return {
    lines,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Four flat GPU passes of the same view: surface orientation (normals), object
 * identity (ids), linear camera-space metric Z-depth, and Z-occluded 3D perspective mesh framing.
 */
function captureModelPasses(v: LiveViewer): ModelPasses | null {
  const scene = v.scene;
  const swaps: Array<{ mesh: THREE.Mesh; material: THREE.Mesh['material'] }> = [];
  const hidden: THREE.Object3D[] = [];
  const tempHiddenGlass: THREE.Object3D[] = [];
  const made: THREE.Material[] = [];
  const prevBackground = scene.background;
  const prevFog = scene.fog;
  let meshFrame: { lines: THREE.LineSegments; dispose: () => void } | null = null;
  try {
    // Exclude loose plan-furniture stand-ins/items from architectural edge-locking (Image 2),
    // while KEEPING bespoke 3D architectural millwork (kiosks, counters, slat screens, feature columns)
    // and overhead ceiling / glazing mullion assemblies (`architecturalLock === true`) edge-locked!
    const excludedRoots = new Set<THREE.Object3D>();
    try {
      const { useScene, sceneRegistry } = getPascalStores() as unknown as {
        useScene: { getState: () => { nodes: Record<string, { id: string; type: string; metadata?: Record<string, unknown> }> } };
        sceneRegistry: { nodes: Map<string, THREE.Object3D> };
      };
      for (const n of Object.values(useScene.getState().nodes ?? {})) {
        if (n?.type === 'item' && n.metadata?.source === 'plan-furniture' && n.metadata?.architecturalLock !== true) {
          const obj = sceneRegistry.nodes.get(n.id);
          if (obj) excludedRoots.add(obj);
        }
      }
    } catch {
      /* scene store unavailable */
    }
    const isArchLockedObj = (obj: THREE.Object3D): boolean => {
      let cur: THREE.Object3D | null = obj;
      while (cur) {
        if (cur.userData?.architecturalLock === true) return true;
        cur = cur.parent;
      }
      return false;
    };
    const underExcluded = (obj: THREE.Object3D): boolean => {
      if (isArchLockedObj(obj)) return false;
      let cur: THREE.Object3D | null = obj;
      while (cur) {
        if (excludedRoots.has(cur)) return true;
        cur = cur.parent;
      }
      return false;
    };
    const meshes: THREE.Mesh[] = [];
    scene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        if (drawnMesh(m) && !isProductCardMesh(m) && !underExcluded(m)) meshes.push(m);
        else {
          m.visible = false;
          hidden.push(m);
        }
      } else if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) {
        o.visible = false;
        hidden.push(o);
      }
    });
    if (!meshes.length) return null;

    scene.background = new THREE.Color(0xffffff);
    scene.fog = null;
    const sideOf = (m: THREE.Mesh) => materialsOf(m)[0]?.side ?? THREE.FrontSide;
    const normalBySide = new Map<THREE.Side, THREE.Material>();
    for (const m of meshes) {
      const side = sideOf(m);
      let mat = normalBySide.get(side);
      if (!mat) {
        mat = new THREE.MeshNormalMaterial({ flatShading: true, side });
        mat.toneMapped = false;
        normalBySide.set(side, mat);
        made.push(mat);
      }
      swaps.push({ mesh: m, material: m.material });
      m.material = mat;
    }
    v.gl.render(scene, v.camera);
    const normals = snapshotCanvas(v.gl.domElement);

    meshes.forEach((m, i) => {
      // Golden-ratio hues and three lightness levels: neighbours never share a colour.
      const color = new THREE.Color().setHSL((i * 0.6180339887) % 1, 0.8, 0.28 + 0.2 * (i % 3));
      const mat = new THREE.MeshBasicMaterial({ color, side: sideOf(m) });
      mat.toneMapped = false;
      made.push(mat);
      m.material = mat;
    });
    v.gl.render(scene, v.camera);
    const ids = snapshotCanvas(v.gl.domElement);

    // Hide pure translucent glass panes (keeping opaque metal mullions & walls) for true metric Z-depth & Z-occluded grid
    const opaqueMeshes: THREE.Mesh[] = [];
    for (const m of meshes) {
      const orig = swaps.find((s) => s.mesh === m)?.material;
      const origMats = orig ? (Array.isArray(orig) ? orig : [orig]) as AnyMaterial[] : [];
      if (origMats.length > 0 && origMats.every(seeThrough)) {
        m.visible = false;
        tempHiddenGlass.push(m);
      } else {
        opaqueMeshes.push(m);
      }
    }

    // Compute metric eye-space depth bounds across opaque meshes in view
    v.camera.updateMatrixWorld();
    const invView = v.camera.matrixWorldInverse;
    const box = new THREE.Box3();
    const pt = new THREE.Vector3();
    let minD = Infinity;
    let maxD = -Infinity;
    for (const m of opaqueMeshes) {
      if (m.name === 'db-capture-ceiling') continue;
      box.setFromObject(m);
      if (box.isEmpty()) continue;
      for (let i = 0; i < 8; i++) {
        pt.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).applyMatrix4(invView);
        const d = -pt.z;
        if (d > 0.05 && Number.isFinite(d)) {
          if (d < minD) minD = d;
          if (d > maxD) maxD = d;
        }
      }
    }
    const rawNearM = Number.isFinite(minD) ? Math.max(0.2, minD - 0.15) : 0.4;
    const rawFarM = Number.isFinite(maxD) ? Math.max(rawNearM + 1.0, maxD + 0.25) : Math.max(rawNearM + 1.0, 18.0);
    const ext = buildingExtents();
    const camPos = new THREE.Vector3().setFromMatrixPosition(v.camera.matrixWorld);
    const indoorPersp = (v.camera as THREE.PerspectiveCamera).isPerspectiveCamera === true && !!ext && camPos.y <= (ext.wallTop ?? 3.0) + 0.4;
    const nearM = indoorPersp ? Math.max(0.6, Math.min(2.0, Number.isFinite(minD) ? minD : 0.8)) : rawNearM;
    const farM = indoorPersp ? Math.max(nearM + 2.0, Math.min(rawFarM, nearM + 15.5)) : rawFarM;

    // Pass 3: WebGPU- and WebGL-compatible linear camera-space metric Z-depth via native THREE.Fog
    const depthBySide = new Map<THREE.Side, THREE.MeshBasicMaterial>();
    for (const m of opaqueMeshes) {
      const orig = swaps.find((s) => s.mesh === m)?.material;
      const origSide = orig ? (((Array.isArray(orig) ? orig[0] : orig) as AnyMaterial)?.side ?? THREE.FrontSide) : THREE.FrontSide;
      let dMat = depthBySide.get(origSide);
      if (!dMat) {
        dMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true, side: origSide, toneMapped: false });
        depthBySide.set(origSide, dMat);
        made.push(dMat);
      }
      m.material = dMat;
    }
    scene.background = new THREE.Color(0x050505);
    scene.fog = new THREE.Fog(0x050505, nearM, farM);
    v.gl.render(scene, v.camera);
    const depth = snapshotCanvas(v.gl.domElement);

    // Pass 4: Z-occluded 3D perspective spatial mesh frame (floor grid + ceiling grid + 3D millwork cages)
    scene.fog = null;
    const depthOnlyBySide = new Map<THREE.Side, THREE.MeshBasicMaterial>();
    for (const m of opaqueMeshes) {
      const orig = swaps.find((s) => s.mesh === m)?.material;
      const origSide = orig ? (((Array.isArray(orig) ? orig[0] : orig) as AnyMaterial)?.side ?? THREE.FrontSide) : THREE.FrontSide;
      let occ = depthOnlyBySide.get(origSide);
      if (!occ) {
        occ = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true, fog: false, side: origSide });
        occ.toneMapped = false;
        depthOnlyBySide.set(origSide, occ);
        made.push(occ);
      }
      m.material = occ;
    }
    scene.background = new THREE.Color(0xffffff);
    meshFrame = buildSpatialMeshFrame(v);
    if (meshFrame) {
      scene.add(meshFrame.lines);
      meshFrame.lines.updateMatrixWorld(true);
    }
    v.gl.render(scene, v.camera);
    const meshGrid = snapshotCanvas(v.gl.domElement);

    return { normals, ids, depth, meshGrid, nearM, farM };
  } catch {
    return null;
  } finally {
    if (meshFrame) {
      scene.remove(meshFrame.lines);
      meshFrame.dispose();
    }
    for (const g of tempHiddenGlass) g.visible = true;
    for (const sw of swaps) sw.mesh.material = sw.material;
    for (const o of hidden) o.visible = true;
    scene.background = prevBackground;
    scene.fog = prevFog;
    for (const mt of made) mt.dispose();
  }
}

/**
 * Doors and windows actually seen from the camera (not hidden behind a wall),
 * from the 3D scene. Each opening is sampled on a 3 x 3 grid; a sample counts
 * when nothing stands between the camera and the opening's box.
 */
function visibleOpenings(v: LiveViewer): OpeningOnScreen[] {
  const out: OpeningOnScreen[] = [];
  try {
    const { useScene, sceneRegistry } = getPascalStores() as unknown as {
      useScene: { getState: () => { nodes: Record<string, { id: string; type: string }> } };
      sceneRegistry: { nodes: Map<string, THREE.Object3D> };
    };
    const cam = v.camera;
    cam.updateMatrixWorld();
    (cam as THREE.PerspectiveCamera).updateProjectionMatrix?.();
    const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const targets: THREE.Object3D[] = [];
    v.scene.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh && drawnMesh(o as THREE.Mesh)) targets.push(o);
    });
    const ray = new THREE.Raycaster();
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const hitBox = new THREE.Vector3();
    for (const n of Object.values(useScene.getState().nodes ?? {})) {
      if (n.type !== 'door' && n.type !== 'window') continue;
      const o = sceneRegistry.nodes.get(n.id);
      if (!o?.visible) continue;
      box.setFromObject(o);
      if (box.isEmpty()) continue;
      box.getSize(size);
      // Sample across the opening's two large dimensions, through the middle of the thin one.
      const thin = size.x <= size.y && size.x <= size.z ? 'x' : size.z <= size.y ? 'z' : 'y';
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const a of [0.15, 0.5, 0.85]) {
        for (const b of [0.15, 0.5, 0.85]) {
          const t = { x: a, y: b, z: b };
          if (thin === 'x') { t.x = 0.5; t.z = a; } else if (thin === 'z') { t.z = 0.5; } else { t.y = 0.5; t.z = b; }
          p.set(box.min.x + size.x * t.x, box.min.y + size.y * t.y, box.min.z + size.z * t.z);
          q.copy(p).project(cam);
          if (q.z > 1 || q.z < -1 || Math.abs(q.x) > 1 || Math.abs(q.y) > 1) continue;
          const dir = p.clone().sub(eye);
          const dist = dir.length();
          if (dist < 1e-3) continue;
          ray.set(eye, dir.divideScalar(dist));
          ray.far = dist + 0.5;
          const entry = ray.ray.intersectBox(box, hitBox) ? hitBox.distanceTo(eye) : dist;
          const first = ray.intersectObjects(targets, false)[0];
          if (first && first.distance < entry - 0.06) continue; // something stands in front
          const sx = (q.x + 1) / 2;
          const sy = (1 - q.y) / 2;
          x0 = Math.min(x0, sx);
          x1 = Math.max(x1, sx);
          y0 = Math.min(y0, sy);
          y1 = Math.max(y1, sy);
        }
      }
      if (x0 <= x1) out.push({ kind: n.type === 'door' ? 'door' : 'window', rect: { x0, y0, x1, y1 } });
    }
  } catch {
    /* no scene data: no inventory */
  }
  return out;
}

/**
 * How a piece facing the plan angle `facing` (its item's own frame, x and z) looks in
 * the view: from the camera's side of it, and its front's direction on screen.
 */
export function viewFacing(
  item: THREE.Object3D,
  facing: number,
  cam: THREE.Camera,
  center: THREE.Vector3,
): ViewFacing {
  const q = item.getWorldQuaternion(new THREE.Quaternion());
  const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
  const a = facing - yaw;
  const f = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const s0 = center.clone().project(cam);
  const s1 = center.clone().addScaledVector(f, 0.5).project(cam);
  const dx = s1.x - s0.x;
  const dy = s1.y - s0.y; // up the screen
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  const ortho = (cam as THREE.OrthographicCamera).isOrthographicCamera;
  const toCam = ortho ? dir.clone().negate() : new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld).sub(center);
  const flat = Math.hypot(toCam.x, toCam.z);
  if (flat < 0.25 * toCam.length()) {
    // From straight above: by the image.
    const ang = Math.atan2(-dy, dx); // screen angle, y down: 0 right, π/2 down
    const k = Math.round(ang / (Math.PI / 4));
    const names: ViewFacing[] = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
    return names[((k % 8) + 8) % 8];
  }
  const cos = (f.x * toCam.x + f.z * toCam.z) / flat;
  const side = dx < 0 ? 'left' : 'right';
  if (cos >= Math.cos(Math.PI / 6)) return 'camera';
  if (cos <= -Math.cos(Math.PI / 6)) return 'away';
  if (cos > Math.cos((70 * Math.PI) / 180)) return `${side}-near`;
  if (cos < -Math.cos((70 * Math.PI) / 180)) return `${side}-far`;
  return side;
}

/**
 * Furniture stand-ins (pieces placed from the drawing) seen from the camera: one
 * entry per stand-in whose centre or top is not hidden behind something opaque.
 */
function visibleFurniture(v: LiveViewer): FurnitureOnScreen[] {
  const out: FurnitureOnScreen[] = [];
  try {
    const { useScene, sceneRegistry } = getPascalStores() as unknown as {
      useScene: { getState: () => { nodes: Record<string, { id: string; type: string; metadata?: Record<string, unknown> }> } };
      sceneRegistry: { nodes: Map<string, THREE.Object3D> };
    };
    const cam = v.camera;
    cam.updateMatrixWorld();
    (cam as THREE.PerspectiveCamera).updateProjectionMatrix?.();
    const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    let targets: THREE.Object3D[] | null = null;
    const ray = new THREE.Raycaster();
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const hitBox = new THREE.Vector3();
    for (const n of Object.values(useScene.getState().nodes ?? {})) {
      const meta = n.metadata;
      if (n.type !== 'item' || meta?.source !== 'plan-furniture') continue;
      const o = sceneRegistry.nodes.get(n.id);
      if (!o?.visible) continue;
      box.setFromObject(o);
      if (box.isEmpty()) continue;
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      let seen: { x: number; y: number; glass: boolean; distM: number } | null = null;
      const samplePts: [number, number][] = [
        [cx, cz],
        [box.min.x + (box.max.x - box.min.x) * 0.25, box.min.z + (box.max.z - box.min.z) * 0.25],
        [box.min.x + (box.max.x - box.min.x) * 0.75, box.min.z + (box.max.z - box.min.z) * 0.25],
        [box.min.x + (box.max.x - box.min.x) * 0.25, box.min.z + (box.max.z - box.min.z) * 0.75],
        [box.min.x + (box.max.x - box.min.x) * 0.75, box.min.z + (box.max.z - box.min.z) * 0.75],
      ];
      for (const y of [box.max.y - 0.02, (box.min.y + box.max.y) / 2]) {
        for (const [sxWorld, szWorld] of samplePts) {
          p.set(sxWorld, y, szWorld);
          q.copy(p).project(cam);
          if (q.z > 1 || q.z < -1 || Math.abs(q.x) > 1 || Math.abs(q.y) > 1) continue;
          const dir = p.clone().sub(eye);
          const dist = dir.length();
          if (dist < 1e-3) continue;
          if (!targets) {
            const list: THREE.Object3D[] = [];
            v.scene.traverseVisible((m) => {
              if ((m as THREE.Mesh).isMesh && drawnMesh(m as THREE.Mesh)) list.push(m);
            });
            targets = list;
          }
          ray.set(eye, dir.divideScalar(dist));
          ray.far = dist + 0.5;
          const entry = ray.ray.intersectBox(box, hitBox) ? hitBox.distanceTo(eye) : dist;
          // Glass (a glazed pod, a glass partition) does not hide what stands behind it.
          const hits = ray.intersectObjects(targets, false).filter((hit) => hit.distance < entry - 0.06);
          if (hits.some((hit) => !seeThrough(hitMaterial(hit)))) continue; // something stands in front
          const sampleDistM = Math.round(dist * 10) / 10;
          if (!seen || sampleDistM < seen.distM) {
            seen = { x: (q.x + 1) / 2, y: (1 - q.y) / 2, glass: hits.length > 0, distM: sampleDistM };
          }
        }
        if (seen) break;
      }
      if (!seen) continue;
      const product = meta.product as { id?: unknown; photo?: unknown; architecturalLock?: unknown } | undefined;
      const architecturalLock = meta.architecturalLock === true || product?.architecturalLock === true;
      let facing: ViewFacing | undefined;
      if (typeof meta.facing === 'number' && Number.isFinite(meta.facing)) {
        try {
          facing = viewFacing(o, meta.facing, cam, new THREE.Vector3(cx, (box.min.y + box.max.y) / 2, cz));
        } catch {
          facing = undefined;
        }
      }
      out.push({
        kind: typeof meta.kind === 'string' ? meta.kind : 'unknown',
        ...(typeof product?.id === 'string' ? { productId: product.id, photo: product.photo === true } : {}),
        ...(architecturalLock ? { architecturalLock: true } : {}),
        x: seen.x,
        y: seen.y,
        distM: seen.distM,
        ...(seen.glass ? { glass: true } : {}),
        ...(facing ? { facing, ...(typeof meta.facingBy === 'string' ? { by: meta.facingBy } : {}) } : {}),
      });
    }
  } catch {
    /* no scene data: no inventory */
  }
  return out;
}

function cameraFacts(v: LiveViewer): CameraFacts | null {
  const cam = v.camera as THREE.PerspectiveCamera;
  if (!cam.isPerspectiveCamera) return null;
  const canvas = v.gl.domElement;
  const view = cam.view;
  const principal = view?.enabled
    ? { x: 0.5 - view.offsetX / view.fullWidth, y: 0.5 - view.offsetY / view.fullHeight }
    : { x: 0.5, y: 0.5 };
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  return {
    fovDeg: cam.fov,
    aspect: Math.max(canvas.clientWidth, 1) / Math.max(canvas.clientHeight, 1),
    principal,
    pitchDeg: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))),
  };
}

/** Everything the beauty pass can return besides the picture. */
export interface CaptureExtras {
  passes: ModelPasses | null;
  openings: OpeningOnScreen[] | null;
  furniture: FurnitureOnScreen[] | null;
  architectural: ArchitecturalOnScreen | null;
  camera: CameraFacts | null;
  ceilingInView: boolean;
  /** The live camera is orthographic. */
  parallel: boolean;
}

function visibleArchitectural(v: LiveViewer): ArchitecturalOnScreen | null {
  try {
    const state = getActiveArchitecturalFeatures();
    const stateSlabs = state.slabFinishes ?? [];
    if (
      !state.ceilings.length &&
      !state.wallCladdings.length &&
      !state.glazingExecutions.length &&
      !state.wallArtworks.length &&
      !stateSlabs.length
    ) {
      return null;
    }
    const cam = v.camera;
    cam.updateMatrixWorld();
    (cam as THREE.PerspectiveCamera).updateProjectionMatrix?.();
    const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const q = new THREE.Vector3();
    const projectPt = (x: number, y: number, z: number): { x: number; y: number; distM: number } | null => {
      q.set(x, y, z);
      const distM = Math.round(q.distanceTo(eye) * 10) / 10;
      q.project(cam);
      if (q.z > 1 || q.z < -1 || Math.abs(q.x) > 1.05 || Math.abs(q.y) > 1.05) return null;
      return { x: Math.max(0, Math.min(1, (q.x + 1) / 2)), y: Math.max(0, Math.min(1, (1 - q.y) / 2)), distM };
    };
    const ceilings: ArchitecturalCeilingOnScreen[] = [];
    for (const c of state.ceilings) {
      const pt = projectPt(c.centerM.x, c.wallTopM - c.dropM * 0.5, c.centerM.y);
      if (!pt) continue;
      ceilings.push({
        label: c.label,
        ...(c.code ? { code: c.code } : {}),
        shape: c.shape,
        style: c.style,
        widthM: c.widthM,
        depthM: c.depthM,
        dropM: c.dropM,
        x: pt.x,
        y: pt.y,
        distM: pt.distM,
        ...(c.finishes?.length ? { finishes: c.finishes } : {}),
        ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
      });
    }
    const wallCladdings: ArchitecturalWallCladdingOnScreen[] = [];
    for (const w of state.wallCladdings) {
      const spots = w.anchors.map((a) => projectPt(a.x, a.y, a.z)).filter((s): s is { x: number; y: number; distM: number } => !!s);
      if (!spots.length) continue;
      wallCladdings.push({
        label: w.label,
        ...(w.code ? { code: w.code } : {}),
        style: w.style,
        curved: w.curved,
        colourHex: w.colourHex,
        spots,
        ...(w.finishes?.length ? { finishes: w.finishes } : {}),
        ...(w.imageUrl ? { imageUrl: w.imageUrl } : {}),
      });
    }
    const glazingExecutions: ArchitecturalGlazingOnScreen[] = [];
    for (const g of state.glazingExecutions) {
      const spots = g.anchors.map((a) => projectPt(a.x, a.y, a.z)).filter((s): s is { x: number; y: number; distM: number } => !!s);
      if (!spots.length) continue;
      glazingExecutions.push({
        label: g.label,
        ...(g.code ? { code: g.code } : {}),
        style: g.style,
        curved: g.curved,
        frameName: g.frameName,
        spots,
        ...(g.finishes?.length ? { finishes: g.finishes } : {}),
        ...(g.imageUrl ? { imageUrl: g.imageUrl } : {}),
      });
    }
    const wallArtworks: ArchitecturalArtworkOnScreen[] = [];
    for (const a of state.wallArtworks) {
      const spots = a.anchors.map((pt) => projectPt(pt.x, pt.y, pt.z)).filter((s): s is { x: number; y: number; distM: number } => !!s);
      if (!spots.length) continue;
      wallArtworks.push({
        label: a.label,
        ...(a.code ? { code: a.code } : {}),
        style: a.style,
        widthM: a.widthM,
        heightM: a.heightM,
        frameName: a.frameName,
        spots,
        ...(a.finishes?.length ? { finishes: a.finishes } : {}),
        ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}),
      });
    }
    const slabFinishes: ArchitecturalSlabFinishOnScreen[] = stateSlabs.map((s) => ({
      slabId: s.slabId,
      label: s.label,
      description: s.description,
      colourHex: s.colourHex,
    }));
    if (!ceilings.length && !wallCladdings.length && !glazingExecutions.length && !wallArtworks.length && !slabFinishes.length) return null;
    return {
      ceilings,
      wallCladdings,
      glazingExecutions,
      ...(wallArtworks.length ? { wallArtworks } : {}),
      ...(slabFinishes.length ? { slabFinishes } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Renders the live camera view without the plan underlay. The renderer's pixel
 * ratio is raised for the one frame so the long side reaches `targetLongSide`
 * (thin window frames stay legible), then restored.
 */
export function captureBeautyPass(
  handle: ViewerHandle | null,
  opts: {
    targetLongSide?: number;
    frameBuilding?: boolean;
    subject?: NormRect | null;
    /** Close the rooms with a plain ceiling for the capture (inside views). */
    ceiling?: boolean;
    /** Also render the flat passes for the model's own edges. */
    modelLines?: boolean;
    /** Also list the doors and windows in view. */
    openings?: boolean;
    /** Also list the furniture stand-ins in view. */
    furniture?: boolean;
    /** Keep the coloured pads under product photos (exports); renders leave them out. */
    pads?: boolean;
  } = {},
): { dataUrl: string; viewKind: ViewKind; focus: NormRect | null } & CaptureExtras {
  const v = resolveViewer(handle);
  if (!v) throw new Error('The 3D view is not ready yet.');
  const targetLongSide = opts.targetLongSide ?? 1600;
  const canvas = v.gl.domElement;
  // A viewfinder frame is the subject when given; otherwise the building.
  const focus = opts.subject ?? (opts.frameBuilding === false ? null : buildingScreenRect(v));
  const restoreNodes = hideNonModelNodes(v.scene);
  // The pads are a code for the 3D model; a render would draw them as coloured rugs.
  const restorePads = opts.pads === false ? hideProductPads() : null;
  const removeCeiling = opts.ceiling ? addCaptureCeiling(v.scene) : null;
  const removeDepthRig = addCaptureDepthRig(v);
  const prevRatio = v.gl.getPixelRatio?.();
  let dataUrl = '';
  const extras: CaptureExtras = {
    passes: null,
    openings: null,
    furniture: null,
    architectural: null,
    camera: cameraFacts(v),
    ceilingInView: !!removeCeiling,
    parallel: (v.camera as THREE.OrthographicCamera).isOrthographicCamera === true,
  };
  try {
    const cssW = Math.max(canvas.clientWidth, 1);
    const cssH = Math.max(canvas.clientHeight, 1);
    // Resolution goes where the building is: a small building on screen gets a
    // higher pixel ratio so its walls and openings still land ~targetLongSide px.
    const subjectLong = focus ? Math.max((focus.x1 - focus.x0) * cssW, (focus.y1 - focus.y0) * cssH) * 1.15 : Math.max(cssW, cssH);
    const maxByPixels = Math.sqrt(16e6 / (cssW * cssH));
    const want = Math.max(1, Math.min(4, maxByPixels, 8192 / Math.max(cssW, cssH), targetLongSide / Math.max(1, subjectLong)));
    if (prevRatio && v.gl.setPixelRatio && Math.abs(want - prevRatio) > 0.05) {
      try {
        v.gl.setPixelRatio(want);
      } catch {
        /* keep the current ratio */
      }
    }
    v.gl.render(v.scene, v.camera);
    dataUrl = canvas.toDataURL('image/png');
    removeDepthRig();
    if (opts.modelLines) {
      // Lines need ~1280 px across, not the beauty pass's resolution.
      const lineRatio = Math.max(0.5, Math.min(4, 1280 / Math.max(cssW, cssH)));
      if (v.gl.setPixelRatio && Math.abs(lineRatio - (v.gl.getPixelRatio?.() ?? lineRatio)) > 0.05) {
        try {
          v.gl.setPixelRatio(lineRatio);
        } catch {
          /* keep the current ratio */
        }
      }
      extras.passes = captureModelPasses(v);
    }
    if (opts.openings) extras.openings = visibleOpenings(v);
    if (opts.furniture) {
      extras.furniture = visibleFurniture(v);
      extras.architectural = visibleArchitectural(v);
    }
  } finally {
    removeDepthRig();
    if (prevRatio && v.gl.setPixelRatio && v.gl.getPixelRatio?.() !== prevRatio) {
      try {
        v.gl.setPixelRatio(prevRatio);
      } catch {
        /* ignore */
      }
    }
    removeCeiling?.();
    restorePads?.();
    restoreNodes();
    v.invalidate?.();
  }
  if (!dataUrl || dataUrl.length < 2000) throw new Error('Could not read the 3D view (empty frame).');
  return { dataUrl, viewKind: viewKindOf(v.camera), focus, ...extras };
}

/** Part of a pass canvas (normalized rect) at w x h, without smoothing (flat colours stay flat). */
function cropPass(src: HTMLCanvasElement, r: NormRect, w: number, h: number): RgbaImage {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, r.x0 * src.width, r.y0 * src.height, (r.x1 - r.x0) * src.width, (r.y1 - r.y0) * src.height, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}

/** Extras for prepareView, from a live capture. */
export interface PrepareExtras extends Partial<CaptureExtras> {
  /** Centre the crop on the camera's optical centre (no viewfinder, no building framing). */
  centreOnCamera?: boolean;
}

/**
 * Crops any image (a fresh capture or a snapshot attached in the chat) to the
 * nearest supported aspect ratio and prepares the guide images.
 */
export async function prepareView(
  sourceUrl: string,
  viewKind: ViewKind,
  maxLongSide = 1536,
  focus?: NormRect | null,
  frame?: FrameCrop | null,
  extras: PrepareExtras = {},
): Promise<PreparedView> {
  const img = await loadImage(sourceUrl);
  let aspect = nearestAspect(img.width, img.height);
  let crop = centreCrop(img.width, img.height, aspect.ratio);
  if (frame) {
    // Exactly the viewfinder: same place, exact format.
    aspect = frame.aspect;
    const x = Math.max(0, frame.rect.x0) * img.width;
    const y = Math.max(0, frame.rect.y0) * img.height;
    let w = Math.min(1, frame.rect.x1) * img.width - x;
    let h = w / aspect.ratio;
    if (y + h > img.height) {
      h = img.height - y;
      w = h * aspect.ratio;
    }
    crop = { x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  } else if (focus) {
    const f = focusCrop(img.width, img.height, focus);
    aspect = f.aspect;
    crop = f;
  } else if (extras.centreOnCamera && extras.camera) {
    crop = cropCentredAt(img.width, img.height, aspect.ratio, extras.camera.principal.x * img.width, extras.camera.principal.y * img.height);
  }
  const norm: NormRect = { x0: crop.x / img.width, y0: crop.y / img.height, x1: (crop.x + crop.w) / img.width, y1: (crop.y + crop.h) / img.height };
  const scale = Math.min(1, maxLongSide / Math.max(crop.w, crop.h));
  const w = Math.round(crop.w * scale);
  const h = Math.round(crop.h * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  const dataUrl = c.toDataURL('image/jpeg', 0.92);

  // Guide images are computed at a moderate size (they only carry lines).
  const gs = Math.min(1, 1024 / Math.max(w, h));
  const gw = Math.round(w * gs);
  const gh = Math.round(h * gs);
  let edgeGuideUrl = '';
  let depthGuideUrl: string | undefined;
  let edgeOverlayUrl = '';
  let depthMeshOverlayUrl: string | undefined;
  let lineGuide = false;
  let meshFramedGuide = false;
  let depthRangeM: { nearM: number; farM: number } | undefined;
  if (extras.passes) {
    // The model's own edges, linear camera-space metric Z-depth, and Z-occluded 3D mesh grid.
    try {
      const mask = modelLineMask(cropPass(extras.passes.normals, norm, gw, gh), cropPass(extras.passes.ids, norm, gw, gh));
      let on = 0;
      for (let i = 0; i < mask.length; i++) on += mask[i];
      if (on > 0.002 * mask.length) {
        const depthCrop = extras.passes.depth ? linearizeSrgbDepth(cropPass(extras.passes.depth, norm, gw, gh)) : null;
        const gridCrop = extras.passes.meshGrid ? cropPass(extras.passes.meshGrid, norm, gw, gh) : null;
        const gMask = gridCrop ? gridLineMask(gridCrop) : null;
        if (depthCrop) {
          edgeGuideUrl = depthMeshGuideDataUrl(mask, gMask, depthCrop, gw, gh);
          depthGuideUrl = depthMapDataUrl(depthCrop);
          depthMeshOverlayUrl = depthMeshOverlayDataUrl(mask, gMask, depthCrop, gw, gh);
          meshFramedGuide = true;
          depthRangeM = {
            nearM: Math.round(extras.passes.nearM * 10) / 10,
            farM: Math.round(extras.passes.farM * 10) / 10,
          };
        } else {
          edgeGuideUrl = gMask ? depthMeshGuideDataUrl(mask, gMask, null, gw, gh) : maskGuideDataUrl(mask, gw, gh);
          depthMeshOverlayUrl = gMask ? depthMeshOverlayDataUrl(mask, gMask, null, gw, gh) : undefined;
          meshFramedGuide = !!gMask;
        }
        edgeOverlayUrl = maskOverlayDataUrl(mask, gw, gh);
        lineGuide = true;
      }
    } catch {
      /* fall back to the picture's edges */
    }
  }
  if (!lineGuide) {
    const croppedImg = await loadImage(dataUrl);
    const px = rasterize(croppedImg, gw, gh);
    edgeGuideUrl = edgeGuideDataUrl(px);
    edgeOverlayUrl = edgeOverlayDataUrl(px);
  }
  const openings = extras.openings
    ?.map((o): OpeningInView => ({
      kind: o.kind,
      x0: (o.rect.x0 - norm.x0) / (norm.x1 - norm.x0),
      y0: (o.rect.y0 - norm.y0) / (norm.y1 - norm.y0),
      x1: (o.rect.x1 - norm.x0) / (norm.x1 - norm.x0),
      y1: (o.rect.y1 - norm.y0) / (norm.y1 - norm.y0),
    }))
    .filter((o) => o.x1 > 0 && o.x0 < 1 && o.y1 > 0 && o.y0 < 1)
    .map((o) => ({ ...o, x0: Math.max(0, o.x0), y0: Math.max(0, o.y0), x1: Math.min(1, o.x1), y1: Math.min(1, o.y1) }));
  const furniture = extras.furniture ? furnitureInView(extras.furniture, norm) : null;
  const architectural = extras.architectural ? architecturalInView(extras.architectural, norm) : null;
  const cam = extras.camera;
  return {
    dataUrl,
    width: w,
    height: h,
    aspect,
    viewKind,
    edgeGuideUrl,
    ...(depthGuideUrl ? { depthGuideUrl } : {}),
    edgeOverlayUrl,
    ...(depthMeshOverlayUrl ? { depthMeshOverlayUrl } : {}),
    lineGuide,
    ...(meshFramedGuide ? { meshFramedGuide: true } : {}),
    ...(depthRangeM ? { depthRangeM } : {}),
    ...(openings ? { openings } : {}),
    ...(cam ? { fovDeg: cropFieldOfView(cam.fovDeg, cam.aspect, cam.principal, norm), pitchDeg: cam.pitchDeg } : {}),
    ...(extras.ceilingInView ? { ceilingInView: true } : {}),
    ...(extras.parallel ? { parallel: true } : {}),
    ...(furniture && furniture.standIns > 0 ? { furniture } : {}),
    ...(architectural ? { architectural } : {}),
  };
}

function architecturalInView(arch: ArchitecturalOnScreen, crop: NormRect): ArchitecturalInView | null {
  const w = crop.x1 - crop.x0;
  const h = crop.y1 - crop.y0;
  const mapPt = (p: { x: number; y: number; distM?: number }) => ({
    x: (p.x - crop.x0) / w,
    y: (p.y - crop.y0) / h,
    ...(typeof p.distM === 'number' ? { distM: p.distM } : {}),
  });
  const inside = (p: { x: number; y: number }) => p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05;
  const ceilings = arch.ceilings
    .map((c) => ({ ...c, ...mapPt(c) }))
    .filter((c) => inside(c))
    .map((c) => ({ ...c, x: Math.max(0, Math.min(1, c.x)), y: Math.max(0, Math.min(1, c.y)) }));
  const wallCladdings = arch.wallCladdings
    .map((wc) => ({ ...wc, spots: wc.spots.map(mapPt).filter(inside) }))
    .filter((wc) => wc.spots.length > 0);
  const glazingExecutions = arch.glazingExecutions
    .map((g) => ({ ...g, spots: g.spots.map(mapPt).filter(inside) }))
    .filter((g) => g.spots.length > 0);
  const wallArtworks = (arch.wallArtworks ?? [])
    .map((a) => ({ ...a, spots: a.spots.map(mapPt).filter(inside) }))
    .filter((a) => a.spots.length > 0);
  const slabFinishes = arch.slabFinishes ?? [];
  if (!ceilings.length && !wallCladdings.length && !glazingExecutions.length && !wallArtworks.length && !slabFinishes.length) return null;
  return {
    ceilings,
    wallCladdings,
    glazingExecutions,
    ...(wallArtworks.length ? { wallArtworks } : {}),
    ...(slabFinishes.length ? { slabFinishes } : {}),
  };
}

/** Spots kept per group (enough to say where they stand). */
const MAX_SPOTS = 24;

/** Stand-ins inside the crop, grouped by product (most numerous first) and the rest by kind, in view coordinates. */
export function furnitureInView(items: readonly FurnitureOnScreen[], crop: NormRect): FurnitureInView {
  const w = crop.x1 - crop.x0;
  const h = crop.y1 - crop.y0;
  const byProduct = new Map<string, FurnitureInView['products'][number]>();
  const byKind = new Map<string, FurnitureInView['plain'][number]>();
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  let standIns = 0;
  let behindGlass = 0;
  for (const it of items) {
    const x = (it.x - crop.x0) / w;
    const y = (it.y - crop.y0) / h;
    if (x < 0 || x > 1 || y < 0 || y > 1) continue;
    standIns++;
    if (it.glass) behindGlass++;
    const spot: ViewSpot = {
      x: r3(x),
      y: r3(y),
      ...(typeof it.distM === 'number' ? { distM: it.distM } : {}),
      ...(it.facing ? { facing: it.facing, ...(it.by ? { by: it.by } : {}) } : {}),
    };
    if (!it.productId) {
      let k = byKind.get(it.kind);
      if (!k) byKind.set(it.kind, (k = { kind: it.kind, count: 0, spots: [] }));
      k.count++;
      if (k.spots.length < MAX_SPOTS) k.spots.push(spot);
      continue;
    }
    let g = byProduct.get(it.productId);
    if (!g) {
      g = { productId: it.productId, count: 0, kinds: [], photo: !!it.photo, ...(it.architecturalLock ? { architecturalLock: true } : {}), x0: x, y0: y, x1: x, y1: y, spots: [] };
      byProduct.set(it.productId, g);
    }
    g.count++;
    if (it.architecturalLock) g.architecturalLock = true;
    if (!g.kinds.includes(it.kind)) g.kinds.push(it.kind);
    g.x0 = Math.min(g.x0, x);
    g.y0 = Math.min(g.y0, y);
    g.x1 = Math.max(g.x1, x);
    g.y1 = Math.max(g.y1, y);
    if (g.spots.length < MAX_SPOTS) g.spots.push(spot);
  }
  return {
    standIns,
    products: [...byProduct.values()].sort((a, b) => b.count - a.count),
    plain: [...byKind.values()].sort((a, b) => b.count - a.count),
    behindGlass,
  };
}

/** Furniture placed from the drawing, and how many BOQ Flow products it carries. */
export function furnitureSummary(): { pieces: number; products: number } {
  try {
    const { useScene } = getPascalStores() as unknown as {
      useScene: { getState: () => { nodes: Record<string, { type: string; metadata?: Record<string, unknown> }> } };
    };
    let pieces = 0;
    const products = new Set<string>();
    for (const n of Object.values(useScene.getState().nodes ?? {})) {
      if (n.type !== 'item' || n.metadata?.source !== 'plan-furniture') continue;
      pieces++;
      const id = (n.metadata.product as { id?: unknown } | undefined)?.id;
      if (typeof id === 'string') products.add(id);
    }
    return { pieces, products: products.size };
  } catch {
    return { pieces: 0, products: 0 };
  }
}

/** Capture + prepare in one step, for the one-click render button. */
export async function captureViewForRender(
  handle: ViewerHandle | null,
  opts: {
    frameBuilding?: boolean;
    frame?: FrameCrop | null;
    viewKind?: ViewKind;
    lensMm?: number;
    ceiling?: boolean;
    /** Keep the coloured pads under product photos (views for the export suite). */
    pads?: boolean;
  } = {},
): Promise<PreparedView> {
  const frame = opts.frame ?? null;
  const autoInterior = !opts.viewKind ? isCameraInsideBuilding(handle) : { interior: false, lensMm: 0 };
  const resolvedKind = opts.viewKind ?? (autoInterior.interior ? 'interior' : undefined);
  const interior = resolvedKind === 'interior';
  const effectiveLensMm = opts.lensMm || (interior ? autoInterior.lensMm : 0);
  const frameBuilding = !frame && !interior && (opts.frameBuilding ?? true);
  const shot = captureBeautyPass(handle, {
    frameBuilding,
    subject: frame?.rect ?? null,
    ceiling: interior && opts.ceiling !== false,
    modelLines: true,
    openings: interior,
    furniture: true,
    pads: opts.pads === true,
  });
  const view = await prepareView(shot.dataUrl, resolvedKind ?? shot.viewKind, 1536, frameBuilding ? shot.focus : null, frame, {
    passes: shot.passes,
    openings: shot.openings,
    furniture: shot.furniture,
    architectural: shot.architectural,
    camera: shot.camera,
    ceilingInView: shot.ceilingInView,
    parallel: shot.parallel,
    centreOnCamera: !frame && !frameBuilding,
  });
  return effectiveLensMm ? { ...view, lensMm: effectiveLensMm } : view;
}

/** Reads the floor-plan underlay (guide node) as a JPEG data URL, if one is loaded. */
export async function readPlanUnderlay(maxLongSide = 1536): Promise<string | undefined> {
  try {
    const { useScene } = getPascalStores() as unknown as {
      useScene: { getState: () => { nodes: Record<string, { type: string; url?: string; visible?: boolean }> } };
    };
    const guide = Object.values(useScene.getState().nodes ?? {}).find((n) => n.type === 'guide' && n.url);
    if (!guide?.url) return undefined;
    const img = await loadImage(guide.url);
    const s = Math.min(1, maxLongSide / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s);
    c.height = Math.round(img.height * s);
    const ctx = c.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  } catch {
    return undefined;
  }
}
