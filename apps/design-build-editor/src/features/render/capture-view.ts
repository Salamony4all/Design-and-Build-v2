// features/render/capture-view.ts
// Captures the exact 3D view for the AI render: a clean "beauty pass" of the
// live Pascal scene (2D plan underlay hidden), rendered at a higher pixel ratio
// for crisp wall and window edges, centre-cropped to the nearest aspect ratio
// the image models accept. Browser-only.

import * as THREE from 'three';
import { getPascalStores, type ViewerHandle } from 'design-build-simplified-viewer-shell';
import { centreCrop, focusCrop, nearestAspect, type AspectChoice, type NormRect, type ViewKind } from './render-presets';
import { edgeGuideDataUrl, edgeOverlayDataUrl, loadImage, rasterize } from './geometry-fidelity';

export interface PreparedView {
  /** JPEG data URL of the cropped view (what the model receives as image 1). */
  dataUrl: string;
  width: number;
  height: number;
  aspect: AspectChoice;
  viewKind: ViewKind;
  /** Dark-on-white edge map of the view (optional image 2). */
  edgeGuideUrl: string;
  /** Transparent cyan edge overlay, for checking the result by eye. */
  edgeOverlayUrl: string;
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

function hideNonModelNodes(): () => void {
  const restore: THREE.Object3D[] = [];
  try {
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

/** View kind of the live camera ('cutaway' when unknown). */
export function currentViewKind(handle: ViewerHandle | null): ViewKind {
  const v = resolveViewer(handle);
  return v ? viewKindOf(v.camera) : 'cutaway';
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

/**
 * Renders the live camera view without the plan underlay. The renderer's pixel
 * ratio is raised for the one frame so the long side reaches `targetLongSide`
 * (thin window frames stay legible), then restored.
 */
export function captureBeautyPass(
  handle: ViewerHandle | null,
  opts: { targetLongSide?: number; frameBuilding?: boolean } = {},
): { dataUrl: string; viewKind: ViewKind; focus: NormRect | null } {
  const v = resolveViewer(handle);
  if (!v) throw new Error('The 3D view is not ready yet.');
  const targetLongSide = opts.targetLongSide ?? 1600;
  const canvas = v.gl.domElement;
  const focus = opts.frameBuilding === false ? null : buildingScreenRect(v);
  const restoreNodes = hideNonModelNodes();
  const prevRatio = v.gl.getPixelRatio?.();
  let dataUrl = '';
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
  } finally {
    if (prevRatio && v.gl.setPixelRatio && v.gl.getPixelRatio?.() !== prevRatio) {
      try {
        v.gl.setPixelRatio(prevRatio);
      } catch {
        /* ignore */
      }
    }
    restoreNodes();
    v.invalidate?.();
  }
  if (!dataUrl || dataUrl.length < 2000) throw new Error('Could not read the 3D view (empty frame).');
  return { dataUrl, viewKind: viewKindOf(v.camera), focus };
}

/**
 * Crops any image (a fresh capture or a snapshot attached in the chat) to the
 * nearest supported aspect ratio and prepares the guide images.
 */
export async function prepareView(sourceUrl: string, viewKind: ViewKind, maxLongSide = 1536, focus?: NormRect | null): Promise<PreparedView> {
  const img = await loadImage(sourceUrl);
  let aspect = nearestAspect(img.width, img.height);
  let crop = centreCrop(img.width, img.height, aspect.ratio);
  if (focus) {
    const f = focusCrop(img.width, img.height, focus);
    aspect = f.aspect;
    crop = f;
  }
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
  const croppedImg = await loadImage(dataUrl);
  const px = rasterize(croppedImg, Math.round(w * gs), Math.round(h * gs));
  return {
    dataUrl,
    width: w,
    height: h,
    aspect,
    viewKind,
    edgeGuideUrl: edgeGuideDataUrl(px),
    edgeOverlayUrl: edgeOverlayDataUrl(px),
  };
}

/** Capture + prepare in one step, for the one-click render button. */
export async function captureViewForRender(handle: ViewerHandle | null, opts: { frameBuilding?: boolean } = {}): Promise<PreparedView> {
  const frameBuilding = opts.frameBuilding ?? true;
  const { dataUrl, viewKind, focus } = captureBeautyPass(handle, { frameBuilding });
  return prepareView(dataUrl, viewKind, 1536, frameBuilding ? focus : null);
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
