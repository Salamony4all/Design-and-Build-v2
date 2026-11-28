// features/furniture/plan-furniture.ts
// Furniture read from the drawing (the extraction route's 'stage-furniture') becomes
// Pascal items. Each piece is a simple stand-in built from its own traced footprint,
// so the 3D space is furnished exactly where and as big as the plan draws it: seats
// and sofas as upholstered blocks, tables as a top on a stem, plants as a pot and
// foliage, screens as a panel. A piece whose front the drawing shows (facing) gets
// it in 3D too: a raised back on seats and sofas, a headboard on beds, a modesty
// panel and end panels on desks, so it reads the right way round in the model and in
// renders. Products chosen in BOQ Flow are then attached to the pieces they match
// (name, brand, model, picture) and tinted per product.

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ItemNode } from '@pascal-app/core';
import type { AnyNode } from '@pascal-app/core';
import { getPascalStores } from 'design-build-simplified-viewer-shell';
import { uid } from '@/harness/ai-scene-install/helpers';
import { matchProducts, productHeight, type MatchProduct, type MatchResult } from './match-products';
import { PRODUCT_COLOURS, productLabel, setProductRefs, type ProductColour } from './product-refs';
import {
  PAD_TOP_M,
  buildCustomFurnitureGroup,
  disposeObject3D,
  recipeSignature,
  type CustomModelRecipe,
  type CustomModelSubPart,
  type MaterialFinishPreset,
} from './custom-model-builder';
import { disposeProductCutouts, hasProductPhoto, loadProductCutouts } from './product-cards';
import { resolvePascalCatalogAsset } from './pascal-catalog-map';
import { BACK, SIDE, depthAlong, edgeBands } from './stand-in-bands';
import {
  applyArchitecturalFeaturesToScene,
  installDefaultArchitecturalFeatures,
  type ArchitecturalZoneInput,
} from './architectural-features';

export interface PlanFurniturePiece {
  id: string;
  typeId: string;
  layer: string;
  family: string;
  kind: string;
  subtype?: string;
  room?: string;
  sourceMode?: 'layer' | 'broad';
  confidence?: number;
  clusterCount?: number;
  customModel?: boolean;
  shape: string;
  widthM: number;
  depthM: number;
  heightM: number;
  areaM2: number;
  angle: number;
  label?: string;
  /**
   * Which way the piece faces, from its back to its front, as an angle in the plan
   * frame (x, y = Pascal z): the open side of a seat or sofa, the user's side of a
   * desk, the foot of a bed. Absent where the drawing does not tell.
   */
  facing?: number;
  /** What told the front: 'table', 'chair', 'shape', 'curve', 'wall' or 'room'. */
  facingBy?: string;
  /** Pascal plan metres: x, and y = Pascal z. */
  centerM: { x: number; y: number };
  outlineM: { x: number; y: number }[];
  subParts?: CustomModelSubPart[];
}

export type PlanArchitecturalZone = ArchitecturalZoneInput;

export interface PlanFurniture {
  pieces: PlanFurniturePiece[];
  types?: { id: string; kind: string; subtype?: string; sourceMode?: 'layer' | 'broad'; customModel?: boolean; shape: string; widthM: number; depthM: number; count: number }[];
  zones?: PlanArchitecturalZone[];
  layers?: string[];
}

export const PLAN_FURNITURE_SOURCE = 'plan-furniture';

const KIND_LABEL: Record<string, string> = {
  seat: 'Chair',
  sofa: 'Sofa',
  table: 'Table',
  'side-table': 'Side table',
  desk: 'Desk',
  bed: 'Bed',
  storage: 'Storage',
  plant: 'Plant',
  screen: 'Screen',
  sanitary: 'Sanitary fitting',
  equipment: 'Equipment',
  joinery: 'Joinery',
  unknown: 'Furniture',
};

const SUBTYPE_LABEL: Record<string, string> = {
  chair: 'Chair',
  armchair: 'Armchair',
  stool: 'Stool',
  sofa: 'Sofa',
  'l-sofa': 'L-shaped sofa',
  'curved-sofa': 'Curved sofa',
  bench: 'Bench',
  'dining-table': 'Dining table',
  'meeting-table': 'Meeting table',
  'coffee-table': 'Coffee table',
  'side-table': 'Side table',
  desk: 'Desk',
  'reception-counter': 'Reception counter',
  'retail-kiosk': 'Retail display kiosk',
  'bar-counter': 'Refreshment bar counter',
  'feature-column': 'Fluted feature column',
  'slat-screen': 'Architectural slat screen',
  booth: 'Acoustic dining booth',
  banquette: 'Built-in banquette',
  'wall-art': 'Framed wall artwork',
  'single-bed': 'Single bed',
  'double-bed': 'Double bed',
  cabinet: 'Cabinet',
  wardrobe: 'Wardrobe',
  credenza: 'Credenza',
  'kitchen-counter': 'Kitchen counter',
  island: 'Kitchen island',
  shelving: 'Shelving',
  joinery: 'Joinery',
  wc: 'WC',
  basin: 'Basin',
  shower: 'Shower',
  bathtub: 'Bathtub',
  urinal: 'Urinal',
  plant: 'Plant',
  screen: 'Screen',
  appliance: 'Appliance',
  equipment: 'Equipment',
};

const THUMB = 'data:image/svg+xml;base64,' + (typeof btoa === 'function'
  ? btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" rx="2" fill="#d9d4cc"/></svg>')
  : '');

export function inferMaterialPreset(product?: Pick<MatchProduct, 'description' | 'category' | 'finishes'>): MaterialFinishPreset | undefined {
  if (!product) return undefined;
  const hay = `${product.description ?? ''} ${product.category ?? ''} ${(product.finishes ?? []).map((f) => `${f.role} ${f.name}`).join(' ')}`.toLowerCase();
  if (/flut|slat|reed/.test(hay) && /wood|oak|walnut|ash|timber/.test(hay)) return 'fluted-wood';
  if (/marble|calacatta|carrara|travertine/.test(hay)) return 'marble';
  if (/terrazzo|ceppo/.test(hay)) return 'terrazzo';
  if (/stone|quartz|silestone|dekton|corian/.test(hay)) return 'stone';
  if (/boucle/.test(hay)) return 'boucle';
  if (/velvet/.test(hay)) return 'velvet';
  if (/leather|aniline/.test(hay)) return 'leather';
  if (/lacquer|fenix|nano/.test(hay)) return 'matte-lacquer';
  if (/oak|walnut|timber|wood|veneer/.test(hay)) return 'wood';
  if (/brass|bronze|pvd|stainless|brushed/.test(hay)) return 'brushed-metal';
  return undefined;
}

export function toCustomModelRecipe(
  p: PlanFurniturePiece,
  tint?: string,
  opts: {
    pad?: boolean;
    heightM?: number;
    accentTint?: string;
    tertiaryTint?: string;
    subtype?: string;
    materialPreset?: MaterialFinishPreset;
    glassDoors?: boolean;
  } = {},
): CustomModelRecipe {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const sub = opts.subtype ?? p.subtype;
  return {
    v: 1,
    kind: p.kind,
    ...(sub ? { subtype: sub } : {}),
    shape: p.shape,
    widthM: r3(p.widthM),
    depthM: r3(p.depthM),
    heightM: r3(opts.heightM ?? p.heightM ?? 0.75),
    angle: r3(p.angle),
    ...(typeof p.facing === 'number' && Number.isFinite(p.facing) ? { facing: r3(p.facing) } : {}),
    centerM: { x: r3(p.centerM.x), y: r3(p.centerM.y) },
    outlineM: p.outlineM.map((q) => ({ x: r3(q.x), y: r3(q.y) })),
    ...(p.subParts?.length
      ? {
          subParts: p.subParts.map((sp) => ({
            role: sp.role,
            outlineM: sp.outlineM.map((q) => ({ x: r3(q.x), y: r3(q.y) })),
            ...(sp.dashed ? { dashed: true } : {}),
          })),
        }
      : {}),
    ...(tint ? { tint } : {}),
    ...(opts.accentTint ? { accentTint: opts.accentTint } : {}),
    ...(opts.tertiaryTint ? { tertiaryTint: opts.tertiaryTint } : {}),
    ...(opts.materialPreset ? { materialPreset: opts.materialPreset } : {}),
    ...(opts.glassDoors ? { glassDoors: true } : {}),
    ...(opts.pad ? { pad: true } : {}),
  };
}

/**
 * A stand-in for one piece, centred on its footprint centre, standing on y = 0. With
 * `pad`, only a thin pad in the product's colour: the product's photo stands on it.
 */
export function buildPieceObject(p: PlanFurniturePiece, tint?: string, opts: { pad?: boolean; heightM?: number } = {}): THREE.Group {
  return buildCustomFurnitureGroup(toCustomModelRecipe(p, tint, opts));
}

const exporter = new GLTFExporter();
// Stand-ins are kept as in-memory models (blob: URLs); identical ones are built once.
const assetBySignature = new Map<string, Promise<string>>();
const ownBlobUrls = new Set<string>();

/**
 * Pascal's item renderer only loads models by https URL: it puts its CDN in front of
 * anything else, so a blob: URL arrives as "https://<cdn>/blob:…". For the stand-ins
 * made here (and only those), fetch the blob itself.
 */
function ensureBlobFetch(): void {
  const w = window as unknown as { fetch: typeof fetch; __dbPlanBlobFetch?: boolean };
  if (w.__dbPlanBlobFetch) return;
  w.__dbPlanBlobFetch = true;
  const original = w.fetch.bind(window);
  w.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = url.match(/^https?:\/\/[^/]+\/(blob:.+)$/);
    if (m && ownBlobUrls.has(m[1])) return original(m[1], init);
    return original(input as RequestInfo, init);
  }) as typeof fetch;
}

function recipeModelUrl(recipe: CustomModelRecipe): Promise<string> {
  const key = recipeSignature(recipe);
  let url = assetBySignature.get(key);
  if (!url) {
    url = (async () => {
      ensureBlobFetch();
      const obj = buildCustomFurnitureGroup(recipe);
      try {
        const out = (await exporter.parseAsync(obj, { binary: true })) as ArrayBuffer;
        const blobUrl = URL.createObjectURL(new Blob([out], { type: 'model/gltf-binary' }));
        ownBlobUrls.add(blobUrl);
        return blobUrl;
      } finally {
        disposeObject3D(obj);
      }
    })();
    url.catch(() => assetBySignature.delete(key));
    assetBySignature.set(key, url);
  }
  return url;
}

function modelUrl(p: PlanFurniturePiece, tint?: string, pad = false, heightM?: number): Promise<string> {
  return recipeModelUrl(toCustomModelRecipe(p, tint, { pad, heightM }));
}

/** Revoke all generated stand-in GLB blob URLs and clear the in-memory signature cache. */
export function disposePlanFurnitureAssets(): void {
  for (const url of ownBlobUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* noop */
    }
  }
  ownBlobUrls.clear();
  assetBySignature.clear();
}

function boxOf(obj: THREE.Object3D): [number, number, number] {
  try {
    const b = new THREE.Box3().setFromObject(obj);
    const s = b.getSize(new THREE.Vector3());
    return [Math.max(0.01, s.x), Math.max(0.01, s.y), Math.max(0.01, s.z)];
  } finally {
    disposeObject3D(obj);
  }
}

type SceneState = {
  nodes: Record<string, Record<string, unknown>>;
  createNodes: (ops: { node: unknown; parentId?: string }[]) => void;
  deleteNodes: (ids: string[]) => void;
  updateNode: (id: string, data: unknown) => void;
};

const scene = () => getPascalStores().useScene.getState() as unknown as SceneState;

/** Items installed from the drawing, by piece id. */
export function planFurnitureNodes(): Map<string, { id: string; node: Record<string, unknown> }> {
  const out = new Map<string, { id: string; node: Record<string, unknown> }>();
  for (const [id, node] of Object.entries(scene().nodes ?? {})) {
    const meta = node?.metadata as Record<string, unknown> | undefined;
    if (node?.type === 'item' && meta?.source === PLAN_FURNITURE_SOURCE && typeof meta.pieceId === 'string') out.set(meta.pieceId, { id, node });
  }
  return out;
}

export function removePlanFurniture(): void {
  const ids = [...planFurnitureNodes().values()].map((n) => n.id);
  if (ids.length) scene().deleteNodes(ids);
}

function levelId(): string | null {
  const nodes = scene().nodes ?? {};
  for (const n of Object.values(nodes)) if (n?.type === 'wall' && typeof n.parentId === 'string') return n.parentId;
  for (const [id, n] of Object.entries(nodes)) if (n?.type === 'level') return id;
  return null;
}

/** Put the drawing's furniture in the model (replacing any from an earlier plan). */
export async function installPlanFurniture(f: PlanFurniture, opts: { kinds?: Set<string> } = {}): Promise<{ installed: number }> {
  removePlanFurniture();
  const parentId = levelId();
  if (!parentId || !f?.pieces?.length) return { installed: 0 };
  const ops: { node: AnyNode; parentId: string }[] = [];
  for (const p of f.pieces) {
    if (opts.kinds && !opts.kinds.has(p.kind)) continue;
    if (!p.outlineM || p.outlineM.length < 3) continue;
    try {
      const pascalMatch = isArchitectural3DLockedPiece(p) ? null : resolvePascalCatalogAsset(p);
      const id = uid('item');
      const name = p.label && p.kind === 'screen' ? p.label : (p.subtype ? SUBTYPE_LABEL[p.subtype] : undefined) ?? KIND_LABEL[p.kind] ?? 'Furniture';
      let itemAsset: Record<string, unknown>;
      let rotation: [number, number, number] = [0, 0, 0];
      let geometrySpec: CustomModelRecipe | undefined;
      let catalogId: string | undefined;
      if (pascalMatch) {
        itemAsset = pascalMatch.asset as unknown as Record<string, unknown>;
        rotation = [0, pascalMatch.rotationY, 0];
        catalogId = pascalMatch.catalogId;
      } else {
        const recipe = toCustomModelRecipe(p);
        const [w, h, d] = boxOf(buildCustomFurnitureGroup(recipe));
        const src = await recipeModelUrl(recipe);
        itemAsset = { id: `plan-${p.id}`, category: 'furniture', name, thumbnail: THUMB, src, dimensions: [w, h, d], offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
        geometrySpec = recipe;
      }
      const node = ItemNode.parse({
        id,
        name,
        parentId,
        position: [p.centerM.x, 0, p.centerM.y],
        rotation,
        asset: itemAsset,
        metadata: {
          source: PLAN_FURNITURE_SOURCE,
          pieceId: p.id,
          typeId: p.typeId,
          kind: p.kind,
          ...(p.subtype ? { subtype: p.subtype } : {}),
          ...(p.room ? { room: p.room } : {}),
          ...(p.sourceMode ? { sourceMode: p.sourceMode } : {}),
          ...(p.customModel ? { customModel: true } : {}),
          shape: p.shape,
          layer: p.layer,
          sizeM: [p.widthM, p.depthM],
          ...(catalogId ? { catalogId } : {}),
          ...(geometrySpec ? { geometrySpec } : {}),
          ...(isArchitectural3DLockedPiece(p) ? { architecturalLock: true } : {}),
          // Plan angle of the piece's front (the item stands unturned, so it is the item's own).
          ...(typeof p.facing === 'number' ? { facing: p.facing, facingBy: p.facingBy } : {}),
        },
      } as never) as AnyNode;
      ops.push({ node, parentId });
    } catch (e) {
      console.warn('[plan-furniture] skipped piece', p.id, e);
    }
  }
  if (ops.length) scene().createNodes(ops);
  installDefaultArchitecturalFeatures(f.zones);
  return { installed: ops.length };
}

/** Rebuild ephemeral blob: GLBs for any ItemNode carrying a saved `geometrySpec` (e.g. after Scene JSON reload). */
export async function rehydratePlanFurnitureModels(): Promise<number> {
  let rebuilt = 0;
  for (const [, hit] of planFurnitureNodes()) {
    const asset = (hit.node.asset ?? {}) as Record<string, unknown>;
    const meta = (hit.node.metadata ?? {}) as Record<string, unknown>;
    const spec = meta.geometrySpec as CustomModelRecipe | undefined;
    if (!spec || spec.v !== 1) continue;
    const src = typeof asset.src === 'string' ? asset.src : '';
    if (src.startsWith('blob:') && ownBlobUrls.has(src)) continue;
    try {
      const freshSrc = await recipeModelUrl(spec);
      const dims = boxOf(buildCustomFurnitureGroup(spec));
      scene().updateNode(hit.id, { asset: { ...asset, src: freshSrc, dimensions: dims } });
      rebuilt++;
    } catch {
      /* skip unrebuildable spec */
    }
  }
  return rebuilt;
}

const ARCHITECTURAL_LOCK_SUBTYPES = new Set([
  'retail-kiosk',
  'bar-counter',
  'reception-counter',
  'kitchen-counter',
  'island',
  'booth',
  'banquette',
  'wardrobe',
  'wall-art',
  'feature-column',
  'slat-screen',
]);

/**
 * True for bespoke architectural joinery, free-standing kiosks, feature columns, and
 * full-height slat privacy screens whose 3D procedural geometry must NEVER be flattened
 * to a 3 cm 2D photo cutout pad and whose silhouette edges stay locked in Image 2.
 */
export function isArchitectural3DLockedPiece(
  piece: Pick<PlanFurniturePiece, 'kind' | 'subtype' | 'customModel' | 'heightM'>,
): boolean {
  if (piece.kind === 'joinery') return true;
  if (piece.subtype && ARCHITECTURAL_LOCK_SUBTYPES.has(piece.subtype)) return true;
  if (piece.kind === 'screen' && ((piece.heightM ?? 0) >= 1.6 || piece.customModel === true)) return true;
  return false;
}

export interface FurnishResult {
  match: MatchResult;
  placed: number;
  /** Products shown by their own photo in the model. */
  withPhotos: number;
  /** Architectural Fit-Out / Fabrication product ids bound onto walls, glazing, or ceilings. */
  handledArchitecturalIds?: string[];
}

const isSwatchCardUrl = (url?: string): boolean => /\/fitout-v2\/|\/fabrication\//i.test(url || '');

/**
 * Attach BOQ Flow's products to the drawn pieces they match: each matched loose-furniture
 * item with a real product photo stands by its own cut-out photo on a subtle anchor pad;
 * bespoke 3D-locked architectural pieces (kiosks, counters, slat screens, feature columns)
 * ALWAYS keep full 3D procedural geometry (`pad: false`) while passing any photo as a design
 * reference; Fit-Out & Fabrication wall/glazing/ceiling items bind directly to scene walls
 * and overhead ceiling assemblies.
 */
export async function applyProducts(f: PlanFurniture, products: MatchProduct[]): Promise<FurnishResult> {
  const archResult = applyArchitecturalFeaturesToScene(f.zones, products);
  const match = matchProducts(f.pieces, products);
  const installed = planFurnitureNodes();
  const byId = new Map(products.map((p) => [p.id, p]));
  const placedLines = match.products.filter((m) => m.placed > 0 && byId.has(m.productId)).sort((a, b) => b.placed - a.placed);
  const colourOf = new Map<string, ProductColour>(placedLines.map((m, i) => [m.productId, PRODUCT_COLOURS[i % PRODUCT_COLOURS.length]]));
  const lockedProductIds = new Set<string>();
  for (const piece of f.pieces) {
    if (!isArchitectural3DLockedPiece(piece)) continue;
    const pid = match.byPiece[piece.id];
    if (pid) lockedProductIds.add(pid);
  }
  setProductRefs([
    ...placedLines.map((m) => {
      const p = byId.get(m.productId)!;
      return { id: p.id, label: productLabel(p), description: p.description, imageUrl: p.imageUrl, colour: colourOf.get(p.id)!, finishes: p.finishes };
    }),
    ...archResult.architecturalRefs,
  ]);
  // Real product photos take priority for loose furniture cutouts; 3D-locked architectural pieces and finish swatches stay 3D.
  disposeProductCutouts();
  await loadProductCutouts(
    placedLines.map((m) => {
      const p = byId.get(m.productId);
      const url = p?.imageUrl;
      const allPiecesForProductAre3DLocked = m.typeIds.length > 0 && lockedProductIds.has(m.productId) && f.pieces.filter((pc) => match.byPiece[pc.id] === m.productId).every(isArchitectural3DLockedPiece);
      return {
        id: m.productId,
        imageUrl: url && !isSwatchCardUrl(url) && !allPiecesForProductAre3DLocked ? url : undefined,
      };
    }),
  );
  const withPhotos = placedLines.filter((m) => hasProductPhoto(m.productId)).length;
  let placed = 0;
  for (const piece of f.pieces) {
    const hit = installed.get(piece.id);
    if (!hit) continue;
    const productId = match.byPiece[piece.id];
    const product = productId ? byId.get(productId) : undefined;
    const archLocked = isArchitectural3DLockedPiece(piece);
    const meta = { ...(hit.node.metadata as Record<string, unknown>) };
    if (archLocked) meta.architecturalLock = true;
    let asset = { ...(hit.node.asset as Record<string, unknown>) };
    let rotation = Array.isArray(hit.node.rotation) ? [...(hit.node.rotation as [number, number, number])] : [0, 0, 0];
    const colour = product ? colourOf.get(product.id) : undefined;
    const primaryFinishHex = product?.finishes?.[0]?.hex;
    const accentFinishHex = product?.finishes?.[1]?.hex;
    const tertiaryFinishHex = product?.finishes?.[2]?.hex;
    const tint = primaryFinishHex || colour?.hex;
    const heightM = product ? productHeight(product.description, product.dims) : undefined;
    const effectiveSubtype =
      product?.subtype && (!piece.subtype || ['sofa', 'bench', 'cabinet', 'credenza', 'joinery', 'table', 'dining-table', 'meeting-table', 'screen'].includes(piece.subtype))
        ? product.subtype
        : piece.subtype;
    const effArchLocked = archLocked || isArchitectural3DLockedPiece({ ...piece, subtype: effectiveSubtype });
    if (effArchLocked) meta.architecturalLock = true;
    const photo = !!product && !effArchLocked && hasProductPhoto(product.id);
    const pascalMatch = !photo && !effArchLocked ? resolvePascalCatalogAsset(piece, product) : null;
    const materialPreset = inferMaterialPreset(product);
    const glassDoors = !!product && /\b(glass\s*door|smoked\s*glass|fluted\s*glass|vitrine)\b/i.test(product.description);
    const name = product ? productLabel(product) : (effectiveSubtype ? SUBTYPE_LABEL[effectiveSubtype] : undefined) ?? KIND_LABEL[piece.kind] ?? 'Furniture';
    if (photo && product) {
      // Real product photo cutout stands on a thin coloured pad at the exact plan orientation
      const recipe = toCustomModelRecipe(piece, colour?.hex, { pad: true, subtype: effectiveSubtype, ...(heightM ? { heightM } : {}) });
      try {
        const dims = boxOf(buildCustomFurnitureGroup(recipe));
        const src = await recipeModelUrl(recipe);
        asset = {
          id: `plan-${piece.id}`,
          category: 'furniture',
          name,
          thumbnail: THUMB,
          src,
          dimensions: dims,
          offset: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        };
        rotation = [0, 0, 0];
        meta.geometrySpec = recipe;
        delete meta.catalogId;
      } catch {
        asset.name = name;
      }
    } else if (pascalMatch) {
      asset = { ...pascalMatch.asset, name };
      rotation = [0, pascalMatch.rotationY, 0];
      meta.catalogId = pascalMatch.catalogId;
      delete meta.geometrySpec;
    } else {
      const recipe = toCustomModelRecipe(piece, tint, {
        pad: false,
        subtype: effectiveSubtype,
        ...(heightM ? { heightM } : {}),
        ...(accentFinishHex ? { accentTint: accentFinishHex } : {}),
        ...(tertiaryFinishHex ? { tertiaryTint: tertiaryFinishHex } : {}),
        ...(materialPreset ? { materialPreset } : {}),
        ...(glassDoors ? { glassDoors: true } : {}),
      });
      try {
        asset = {
          id: `plan-${piece.id}`,
          category: 'furniture',
          name,
          thumbnail: THUMB,
          src: await recipeModelUrl(recipe),
          dimensions: boxOf(buildCustomFurnitureGroup(recipe)),
          offset: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        };
        rotation = [0, 0, 0];
        meta.geometrySpec = recipe;
        delete meta.catalogId;
      } catch {
        // keep existing stand-in
      }
      asset.name = name;
    }
    if (product) {
      placed++;
      const imageUrl = product.imageUrl && (/^https?:\/\/|^data:image\//i.test(product.imageUrl)) ? product.imageUrl : undefined;
      meta.product = {
        id: product.id,
        description: product.description,
        brand: product.brand,
        model: product.model,
        imageUrl,
        tint,
        colour: colour?.name,
        photo,
        architecturalLock: archLocked,
        ...(product.finishes?.length ? { finishes: product.finishes } : {}),
        ...(heightM ? { heightM } : {}),
      };
    } else delete meta.product;
    scene().updateNode(hit.id, { name, rotation, metadata: meta, asset });
  }
  return {
    match,
    placed,
    withPhotos,
    handledArchitecturalIds: [...archResult.handledProductIds],
  };
}
