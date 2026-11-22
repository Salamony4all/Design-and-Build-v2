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
  edgeGuideDataUrl,
  edgeOverlayDataUrl,
  loadImage,
  maskGuideDataUrl,
  maskOverlayDataUrl,
  modelLineMask,
  rasterize,
  type RgbaImage,
} from './geometry-fidelity';

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
}

/** Flat passes of the live view (surface orientation, object identity) for drawing the model's own edges. */
export interface ModelPasses {
  normals: HTMLCanvasElement;
  ids: HTMLCanvasElement;
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
  // Unlit light grey: lit from below it came out nearly black, which reads as a void, not a ceiling.
  const mat = new THREE.MeshBasicMaterial({ color: 0xdcdbd7, side: THREE.DoubleSide });
  mat.toneMapped = false;
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

type AnyMaterial = THREE.Material & { visible?: boolean; colorWrite?: boolean; transparent?: boolean; opacity?: number; side?: THREE.Side };

function materialsOf(m: THREE.Mesh): AnyMaterial[] {
  return (Array.isArray(m.material) ? m.material : [m.material]).filter(Boolean) as AnyMaterial[];
}

/** Meshes that actually draw (not picking proxies with hidden or fully transparent materials). */
function drawnMesh(m: THREE.Mesh): boolean {
  return materialsOf(m).some((mt) => mt.visible !== false && mt.colorWrite !== false && !(mt.transparent && (mt.opacity ?? 1) < 0.05));
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

/**
 * Two flat renders of the same view: surface orientation and one colour per
 * mesh. Their changes are the model's real edges (no shadows or texture), drawn
 * into the line guide the image model follows and the "Show model lines" check.
 */
function captureModelPasses(v: LiveViewer): ModelPasses | null {
  const scene = v.scene;
  const swaps: Array<{ mesh: THREE.Mesh; material: THREE.Mesh['material'] }> = [];
  const hidden: THREE.Object3D[] = [];
  const made: THREE.Material[] = [];
  const prevBackground = scene.background;
  const prevFog = scene.fog;
  try {
    const meshes: THREE.Mesh[] = [];
    scene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        if (drawnMesh(m)) meshes.push(m);
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
    return { normals, ids };
  } catch {
    return null;
  } finally {
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
  camera: CameraFacts | null;
  ceilingInView: boolean;
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
  } = {},
): { dataUrl: string; viewKind: ViewKind; focus: NormRect | null } & CaptureExtras {
  const v = resolveViewer(handle);
  if (!v) throw new Error('The 3D view is not ready yet.');
  const targetLongSide = opts.targetLongSide ?? 1600;
  const canvas = v.gl.domElement;
  // A viewfinder frame is the subject when given; otherwise the building.
  const focus = opts.subject ?? (opts.frameBuilding === false ? null : buildingScreenRect(v));
  const restoreNodes = hideNonModelNodes();
  const removeCeiling = opts.ceiling ? addCaptureCeiling(v.scene) : null;
  const prevRatio = v.gl.getPixelRatio?.();
  let dataUrl = '';
  const extras: CaptureExtras = { passes: null, openings: null, camera: cameraFacts(v), ceilingInView: !!removeCeiling };
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
  } finally {
    if (prevRatio && v.gl.setPixelRatio && v.gl.getPixelRatio?.() !== prevRatio) {
      try {
        v.gl.setPixelRatio(prevRatio);
      } catch {
        /* ignore */
      }
    }
    removeCeiling?.();
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
  let edgeOverlayUrl = '';
  let lineGuide = false;
  if (extras.passes) {
    // The model's own edges, from the flat passes of the same view and crop.
    try {
      const mask = modelLineMask(cropPass(extras.passes.normals, norm, gw, gh), cropPass(extras.passes.ids, norm, gw, gh));
      let on = 0;
      for (let i = 0; i < mask.length; i++) on += mask[i];
      if (on > 0.002 * mask.length) {
        edgeGuideUrl = maskGuideDataUrl(mask, gw, gh);
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
  const cam = extras.camera;
  return {
    dataUrl,
    width: w,
    height: h,
    aspect,
    viewKind,
    edgeGuideUrl,
    edgeOverlayUrl,
    lineGuide,
    ...(openings ? { openings } : {}),
    ...(cam ? { fovDeg: cropFieldOfView(cam.fovDeg, cam.aspect, cam.principal, norm), pitchDeg: cam.pitchDeg } : {}),
    ...(extras.ceilingInView ? { ceilingInView: true } : {}),
  };
}

/** Capture + prepare in one step, for the one-click render button. */
export async function captureViewForRender(
  handle: ViewerHandle | null,
  opts: { frameBuilding?: boolean; frame?: FrameCrop | null; viewKind?: ViewKind; lensMm?: number; ceiling?: boolean } = {},
): Promise<PreparedView> {
  const frame = opts.frame ?? null;
  const interior = opts.viewKind === 'interior';
  const frameBuilding = !frame && !interior && (opts.frameBuilding ?? true);
  const shot = captureBeautyPass(handle, {
    frameBuilding,
    subject: frame?.rect ?? null,
    ceiling: interior && opts.ceiling !== false,
    modelLines: true,
    openings: interior,
  });
  const view = await prepareView(shot.dataUrl, opts.viewKind ?? shot.viewKind, 1536, frameBuilding ? shot.focus : null, frame, {
    passes: shot.passes,
    openings: shot.openings,
    camera: shot.camera,
    ceilingInView: shot.ceilingInView,
    centreOnCamera: !frame && !frameBuilding,
  });
  return opts.lensMm ? { ...view, lensMm: opts.lensMm } : view;
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
