// features/furniture/product-cards.ts
// Real product photos in the model. A furnished stand-in whose product has a picture
// becomes a pad in the product's colour with a cut-out of the product's photo standing
// on it, at the product's own height (or the usual one of its kind). Where the drawing
// shows which way the piece faces, the photo stands turned that way: it turns towards
// the camera by at most 45°, so seen from the side it shows at an angle, and from
// behind it shows as a plain silhouette (the product's back). A piece with no known
// front turns its photo to the camera. In the top view the photo lies flat inside the
// footprint, its foot at the piece's front. Cards hang under the item's own 3D object,
// so they move with it, show in every capture (AI renders leave the pads out, so they
// are not drawn as rugs), and stay out of the model-line passes.

import * as THREE from 'three';
import { getPascalStores } from 'design-build-simplified-viewer-shell';
import { cardNormal } from './card-orientation';

/** Height of the coloured pad under a photo, in metres. */
export const PAD_TOP_M = 0.03;
const CARD_KEY = 'dbProductCard';
/** Marks the photo and silhouette planes of a card (kept out of picking and the model-line passes). */
const CARD_MESH_KEY = 'dbProductCardMesh';
/** What a card was made for (product, height, footprint): another one is made when it changes. */
const SIG_KEY = 'dbProductCardSig';

/** Usual height of each kind of furniture, for sizing its photo. */
const KIND_HEIGHT_M: Record<string, number> = {
  seat: 0.85,
  sofa: 0.8,
  table: 0.75,
  'side-table': 0.5,
  desk: 1.05,
  bed: 1.0,
  storage: 1.8,
  plant: 1.6,
  screen: 1.2,
  sanitary: 0.85,
  equipment: 1.4,
  joinery: 2.1,
};

interface Cutout {
  texture: THREE.Texture;
  /** The photo, seen from the front. */
  front: THREE.MeshBasicMaterial;
  /** Its silhouette in grey, seen from behind. */
  back: THREE.MeshBasicMaterial;
  /** Width over height of the trimmed photo. */
  aspect: number;
}

const cutoutByUrl = new Map<string, Promise<Cutout | null>>();
const cutoutByProduct = new Map<string, Cutout>();

/** Dispose all cached product cutout textures/materials and clear caches. */
export function disposeProductCutouts(): void {
  const seenTex = new Set<THREE.Texture>();
  const seenMat = new Set<THREE.Material>();
  for (const cut of cutoutByProduct.values()) {
    if (cut.texture && !seenTex.has(cut.texture)) {
      seenTex.add(cut.texture);
      cut.texture.dispose();
    }
    if (cut.front && !seenMat.has(cut.front)) {
      seenMat.add(cut.front);
      cut.front.dispose();
    }
    if (cut.back && !seenMat.has(cut.back)) {
      seenMat.add(cut.back);
      cut.back.dispose();
    }
  }
  cutoutByProduct.clear();
  for (const p of cutoutByUrl.values()) {
    void p.then((cut) => {
      if (!cut) return;
      if (cut.texture && !seenTex.has(cut.texture)) {
        seenTex.add(cut.texture);
        cut.texture.dispose();
      }
      if (cut.front && !seenMat.has(cut.front)) {
        seenMat.add(cut.front);
        cut.front.dispose();
      }
      if (cut.back && !seenMat.has(cut.back)) {
        seenMat.add(cut.back);
        cut.back.dispose();
      }
    });
  }
  cutoutByUrl.clear();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The product picture could not be read.'));
    img.src = src;
  });
}

/**
 * The photo with its plain light background taken out and trimmed to the product.
 * Catalogue photos stand on white: border pixels of one light colour are flooded
 * away, edge pixels fade with their closeness to it, and soft shadows stay. A photo
 * without such a background stays whole (a framed picture of the product).
 */
export function cutoutCanvas(img: CanvasImageSource & { width: number; height: number }, maxSide = 640): HTMLCanvasElement | null {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height, 1));
  const w = Math.max(1, Math.round(img.width * s));
  const h = Math.max(1, Math.round(img.height * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, w, h);
  let data: ImageData;
  try {
    data = g.getImageData(0, 0, w, h);
  } catch {
    return null; // a picture from another site without CORS cannot become a texture
  }
  const px = data.data;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  let r = 0;
  let gr = 0;
  let b = 0;
  for (const i of border) {
    r += px[i * 4];
    gr += px[i * 4 + 1];
    b += px[i * 4 + 2];
  }
  r /= border.length;
  gr /= border.length;
  b /= border.length;
  const diff = (i: number) => Math.max(Math.abs(px[i * 4] - r), Math.abs(px[i * 4 + 1] - gr), Math.abs(px[i * 4 + 2] - b));
  const even = border.filter((i) => diff(i) <= 24).length / border.length;
  if ((r + gr + b) / 3 > 200 && even > 0.85) {
    const TOL = 26;
    const bg = new Uint8Array(w * h);
    const stack: number[] = [];
    for (const i of border) {
      if (!bg[i] && diff(i) <= TOL) {
        bg[i] = 1;
        stack.push(i);
      }
    }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of next) {
        if (j >= 0 && !bg[j] && diff(j) <= TOL) {
          bg[j] = 1;
          stack.push(j);
        }
      }
    }
    // A soft floor shadow (light, colourless, in the lower part of the product and
    // touching the background) becomes see-through instead of a grey band.
    let top = h;
    let bottom = -1;
    for (let i = 0; i < w * h; i++) {
      if (bg[i]) continue;
      const y = (i - (i % w)) / w;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
    const shadowFrom = top + (bottom - top) * 0.7;
    const shadow = new Uint8Array(w * h);
    const isShadow = (j: number) => {
      if (bg[j] || shadow[j] || (j - (j % w)) / w < shadowFrom) return false;
      const d = diff(j);
      const sat = Math.max(px[j * 4], px[j * 4 + 1], px[j * 4 + 2]) - Math.min(px[j * 4], px[j * 4 + 1], px[j * 4 + 2]);
      return d > TOL && d <= 60 && sat < 16;
    };
    for (let i = 0; i < w * h; i++) {
      if (!bg[i]) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && isShadow(j)) {
          shadow[j] = 1;
          stack.push(j);
        }
      }
    }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && isShadow(j)) {
          shadow[j] = 1;
          stack.push(j);
        }
      }
    }
    for (let i = 0; i < w * h; i++) {
      if (bg[i]) {
        px[i * 4 + 3] = 0;
        continue;
      }
      if (shadow[i]) {
        // darker shadow, more opaque; never more than half
        px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 40;
        px[i * 4 + 3] = Math.round(255 * Math.min(0.5, (diff(i) - TOL) / 70));
        continue;
      }
      const x = i % w;
      const y = (i - x) / w;
      const edge = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w]);
      if (edge) px[i * 4 + 3] = Math.round(255 * Math.max(0.35, Math.min(1, diff(i) / 70)));
    }
    g.putImageData(data, 0, 0);
  }
  // Trim to the product.
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  const pad = 2;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')?.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function cutoutFor(url: string): Promise<Cutout | null> {
  let job = cutoutByUrl.get(url);
  if (!job) {
    job = (async () => {
      try {
        const canvas = cutoutCanvas(await loadImage(url));
        if (!canvas) return null;
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        const front = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.08, depthWrite: true, fog: false, side: THREE.FrontSide });
        front.toneMapped = false;
        // The back: the same outline in plain grey (seen from behind, mirrored as it should be).
        const shade = document.createElement('canvas');
        shade.width = canvas.width;
        shade.height = canvas.height;
        const g = shade.getContext('2d');
        if (g) {
          g.drawImage(canvas, 0, 0);
          g.globalCompositeOperation = 'source-in';
          g.fillStyle = '#8d8780';
          g.fillRect(0, 0, shade.width, shade.height);
        }
        const backTexture = new THREE.CanvasTexture(shade);
        backTexture.colorSpace = THREE.SRGBColorSpace;
        const back = new THREE.MeshBasicMaterial({ map: backTexture, transparent: true, alphaTest: 0.08, depthWrite: true, fog: false, side: THREE.BackSide });
        back.toneMapped = false;
        return { texture, front, back, aspect: canvas.width / Math.max(1, canvas.height) };
      } catch {
        return null;
      }
    })();
    cutoutByUrl.set(url, job);
  }
  return job;
}

/** Cut out the pictures of these products (those that have one), a few at a time. */
export async function loadProductCutouts(products: readonly { id: string; imageUrl?: string }[], timeoutMs = 10000): Promise<void> {
  await Promise.all(
    products.map(async (p) => {
      if (!p.imageUrl) return;
      const cut = await Promise.race([cutoutFor(p.imageUrl), new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
      if (cut) cutoutByProduct.set(p.id, cut);
      else cutoutByProduct.delete(p.id);
    }),
  );
}

export function hasProductPhoto(productId: string): boolean {
  return cutoutByProduct.has(productId);
}

/** Standing size: the product's height (else the usual one of its kind), no wider than its footprint allows. */
function standingSize(kind: string, foot: readonly number[], aspect: number, heightM?: number): { w: number; h: number } {
  const footMax = Math.max(0.3, foot[0] || 0, foot[1] || 0);
  let h = heightM && heightM > 0.15 && heightM < 3.5 ? heightM : KIND_HEIGHT_M[kind] ?? 0.9;
  let w = h * aspect;
  if (w > footMax * 1.1) {
    w = footMax * 1.1;
    h = w / aspect;
  }
  return { w, h };
}

/** Lying size (top view): the photo fitted inside the footprint. */
function lyingSize(foot: readonly number[], aspect: number): { w: number; h: number } {
  const fit = Math.max(0.3, foot[0] || 0, foot[1] || 0) * 0.95;
  return aspect >= 1 ? { w: fit, h: fit / aspect } : { w: fit * aspect, h: fit };
}

/** Plan angle (x, z) of a world direction. */
const planAngleOf = (x: number, z: number) => Math.atan2(z, x);
/** Turn about +Y that brings a plane's +Z normal to the plan angle `a`. */
const yawFor = (a: number) => Math.PI / 2 - a;

const viewDir = new THREE.Vector3();
const camPos = new THREE.Vector3();
const cardPos = new THREE.Vector3();
const camUp = new THREE.Vector3();
const parentQ = new THREE.Quaternion();
const wantQ = new THREE.Quaternion();
const tiltQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const yawQ = new THREE.Quaternion();
const offset = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);
const euler = new THREE.Euler();
/** One plane, its foot on y = 0 (scaled per card). */
const CARD_PLANE = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

function makeCard(productId: string, cut: Cutout, kind: string, foot: readonly number[], heightM: number | undefined, sig: string, facing: number | null): THREE.Group {
  const card = new THREE.Group();
  card.name = 'Product photo';
  card.userData[CARD_KEY] = productId;
  card.userData[SIG_KEY] = sig;
  const front = new THREE.Mesh(CARD_PLANE, cut.front);
  const back = new THREE.Mesh(CARD_PLANE, cut.back);
  for (const m of [front, back]) {
    m.userData[CARD_MESH_KEY] = true;
    m.frustumCulled = false;
    m.raycast = () => {}; // never picked: selection and walking go to the model itself
    card.add(m);
  }
  const stand = standingSize(kind, foot, cut.aspect, heightM);
  const lie = lyingSize(foot, cut.aspect);
  let lastFrame = -1;
  const orient = (renderer: unknown, camera: THREE.Camera) => {
    // both planes call this; once per frame is enough
    const frame = (renderer as { info?: { render?: { frame?: number } } })?.info?.render?.frame ?? -2;
    if (frame === lastFrame && frame >= 0) return;
    lastFrame = frame;
    const parent = card.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    parent.getWorldQuaternion(parentQ);
    parent.getWorldPosition(cardPos);
    euler.setFromQuaternion(parentQ, 'YXZ');
    // the item's own turn (plan furniture stands unturned, but the editor can turn it)
    const worldFacing = facing === null ? null : facing - euler.y;
    camera.getWorldDirection(viewDir);
    if (viewDir.y < -0.9) {
      // Top view: flat inside the footprint, the photo's foot towards the piece's front.
      let up: number;
      if (worldFacing !== null) up = worldFacing + Math.PI;
      else {
        camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
        up = planAngleOf(camUp.x, camUp.z);
      }
      yawQ.setFromAxisAngle(yAxis, yawFor(up + Math.PI));
      wantQ.copy(yawQ).multiply(tiltQ);
      offset.set(-Math.cos(up) * (lie.h / 2), PAD_TOP_M + 0.01, -Math.sin(up) * (lie.h / 2));
      card.scale.set(lie.w, lie.h, 1);
    } else {
      camera.getWorldPosition(camPos);
      const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
      const toCamera = ortho ? planAngleOf(-viewDir.x, -viewDir.z) : planAngleOf(camPos.x - cardPos.x, camPos.z - cardPos.z);
      wantQ.setFromAxisAngle(yAxis, yawFor(cardNormal(worldFacing, toCamera)));
      offset.set(0, PAD_TOP_M, 0);
      card.scale.set(stand.w, stand.h, 1);
    }
    // into the item's own frame
    parentQ.invert();
    card.quaternion.copy(parentQ).multiply(wantQ);
    card.position.copy(offset).applyQuaternion(parentQ);
    card.updateMatrixWorld(true);
  };
  front.onBeforeRender = (renderer, _scene, camera) => orient(renderer, camera);
  back.onBeforeRender = (renderer, _scene, camera) => orient(renderer, camera);
  card.scale.set(stand.w, stand.h, 1);
  card.position.set(0, PAD_TOP_M, 0);
  return card;
}

/** True for the photo and silhouette planes of a product card. */
export function isProductCardMesh(o: THREE.Object3D): boolean {
  return o.userData?.[CARD_MESH_KEY] === true;
}

interface SceneNode {
  id: string;
  type: string;
  metadata?: Record<string, unknown>;
}

function stores() {
  return getPascalStores() as unknown as {
    useScene: { getState: () => { nodes: Record<string, SceneNode> }; subscribe: (fn: () => void) => () => void };
    sceneRegistry: { nodes: Map<string, THREE.Object3D> };
  };
}

/**
 * Put a photo card on every furnished stand-in whose product has a photo, and take
 * cards off the others. Returns how many stand-ins still wait for their 3D object.
 */
export function syncProductCards(): { cards: number; waiting: number } {
  let cards = 0;
  let waiting = 0;
  try {
    const { useScene, sceneRegistry } = stores();
    for (const n of Object.values(useScene.getState().nodes ?? {})) {
      if (n.type !== 'item' || n.metadata?.source !== 'plan-furniture') continue;
      const product = n.metadata.product as { id?: string; photo?: boolean; heightM?: number } | undefined;
      const want = product?.id && product.photo ? cutoutByProduct.get(product.id) : undefined;
      const obj = sceneRegistry.nodes.get(n.id);
      if (!obj) {
        if (want) waiting++;
        continue;
      }
      const foot = Array.isArray(n.metadata.sizeM) ? (n.metadata.sizeM as number[]) : [0.8, 0.8];
      const heightM = typeof product?.heightM === 'number' ? product.heightM : undefined;
      const facing = typeof n.metadata.facing === 'number' && Number.isFinite(n.metadata.facing) ? (n.metadata.facing as number) : null;
      const sig = `${product?.id ?? ''}|${heightM ?? ''}|${foot.map((v) => Math.round(v * 100)).join('x')}|${facing === null ? '' : Math.round(facing * 1000)}`;
      const have = obj.children.filter((c) => c.userData[CARD_KEY]);
      if (want && product?.id && have.length === 1 && have[0].userData[SIG_KEY] === sig) {
        cards++;
        continue;
      }
      for (const c of have) obj.remove(c);
      if (want && product?.id) {
        obj.add(makeCard(product.id, want, String(n.metadata.kind ?? ''), foot, heightM, sig, facing));
        cards++;
      }
    }
  } catch {
    /* scene not ready */
  }
  return { cards, waiting };
}

/** Show or hide every product photo (the plain plan is captured without them). */
export function setProductCardsVisible(visible: boolean): void {
  try {
    for (const obj of stores().sceneRegistry.nodes.values()) {
      for (const c of obj.children) if (c.userData[CARD_KEY]) c.visible = visible;
    }
  } catch {
    /* scene not ready */
  }
}

/**
 * Take the coloured pads from under the product photos, keeping the photos: AI renders
 * would draw the pads as rugs and the code colours as upholstery. Returns the undo.
 */
export function hideProductPads(): () => void {
  const hidden: THREE.Object3D[] = [];
  try {
    for (const obj of stores().sceneRegistry.nodes.values()) {
      if (!obj.children.some((c) => c.userData[CARD_KEY])) continue;
      for (const c of obj.children) {
        if (c.userData[CARD_KEY] || !c.visible) continue;
        c.visible = false;
        hidden.push(c);
      }
    }
  } catch {
    /* scene not ready */
  }
  return () => {
    for (const o of hidden) o.visible = true;
  };
}

let unsubscribe: (() => void) | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Keep the cards in place: sync now, retry while stand-ins wait for their 3D object,
 * and again whenever the scene changes (the viewer can rebuild an item's object).
 */
export function keepProductCards(invalidate: () => void): void {
  const run = (attempt: number) => {
    const { waiting } = syncProductCards();
    invalidate();
    if (waiting > 0 && attempt < 8) syncTimer = setTimeout(() => run(attempt + 1), 250 * (attempt + 1));
  };
  if (syncTimer) clearTimeout(syncTimer);
  run(0);
  if (!unsubscribe) {
    try {
      let pending: ReturnType<typeof setTimeout> | null = null;
      unsubscribe = stores().useScene.subscribe(() => {
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          pending = null;
          syncProductCards();
          invalidate();
        }, 400);
      });
    } catch {
      /* scene not ready */
    }
  }
}
