// features/furniture/plan-furniture.ts
// Furniture read from the drawing (the extraction route's 'stage-furniture') becomes
// Pascal items. Each piece is a simple stand-in built from its own traced footprint,
// so the 3D space is furnished exactly where and as big as the plan draws it: seats
// and sofas as upholstered blocks, tables as a top on a stem, plants as a pot and
// foliage, screens as a panel. Products chosen in BOQ Flow are then attached to the
// pieces they match (name, brand, model, picture) and tinted per product.

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ItemNode } from '@pascal-app/core';
import type { AnyNode } from '@pascal-app/core';
import { getPascalStores } from 'design-build-simplified-viewer-shell';
import { uid } from '@/harness/ai-scene-install/helpers';
import { matchProducts, type MatchProduct, type MatchResult } from './match-products';

export interface PlanFurniturePiece {
  id: string;
  typeId: string;
  layer: string;
  family: string;
  kind: string;
  shape: string;
  widthM: number;
  depthM: number;
  heightM: number;
  areaM2: number;
  angle: number;
  label?: string;
  /** Pascal plan metres: x, and y = Pascal z. */
  centerM: { x: number; y: number };
  outlineM: { x: number; y: number }[];
}

export interface PlanFurniture {
  pieces: PlanFurniturePiece[];
  types?: { id: string; kind: string; shape: string; widthM: number; depthM: number; count: number }[];
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

/** Soft tints that tell products apart in the model and in renders. */
const PRODUCT_TINTS = ['#d9c6a5', '#a9c4d9', '#c9d9a9', '#d9a9b8', '#b8a9d9', '#a9d9cf', '#d9bfa9', '#c4c4c4', '#e0d29a', '#9fb7c9'];

const THUMB = 'data:image/svg+xml;base64,' + (typeof btoa === 'function'
  ? btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" rx="2" fill="#d9d4cc"/></svg>')
  : '');

interface Look { body: string; accent: string }

function lookOf(kind: string, tint?: string): Look {
  if (tint) return { body: tint, accent: '#8f877e' };
  switch (kind) {
    case 'seat':
    case 'sofa':
      return { body: '#e7e1d8', accent: '#8f877e' };
    case 'table':
    case 'side-table':
      return { body: '#d8cdbf', accent: '#7d756d' };
    case 'plant':
      return { body: '#6f9a63', accent: '#9b8e80' };
    case 'screen':
      return { body: '#1f2328', accent: '#3a3f46' };
    case 'sanitary':
      return { body: '#f7f7f5', accent: '#c9c9c9' };
    case 'equipment':
      return { body: '#c9ced6', accent: '#8a9099' };
    default:
      return { body: '#ece8e2', accent: '#9a938b' };
  }
}

const mat = (color: string, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });

/** Footprint as a THREE.Shape around the piece centre (shape y = −plan z, so it lies flat after rotating). */
function footprintShape(p: PlanFurniturePiece): THREE.Shape {
  const pts = p.outlineM.map((q) => new THREE.Vector2(q.x - p.centerM.x, -(q.y - p.centerM.y)));
  return new THREE.Shape(pts);
}

function extrudeFootprint(p: PlanFurniturePiece, from: number, to: number, material: THREE.Material): THREE.Mesh {
  const g = new THREE.ExtrudeGeometry(footprintShape(p), { depth: Math.max(0.01, to - from), bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, from, 0);
  return new THREE.Mesh(g, material);
}

/** A stand-in for one piece, centred on its footprint centre, standing on y = 0. */
export function buildPieceObject(p: PlanFurniturePiece, tint?: string): THREE.Group {
  const look = lookOf(p.kind, tint);
  const group = new THREE.Group();
  const short = Math.max(0.2, Math.min(p.widthM, p.depthM));
  switch (p.kind) {
    case 'table':
    case 'side-table': {
      const h = p.kind === 'table' ? 0.74 : 0.5;
      group.add(extrudeFootprint(p, h - 0.04, h, mat(look.body, 0.6)));
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, h - 0.04, 16), mat(look.accent, 0.5));
      stem.position.y = (h - 0.04) / 2;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(0.28, short * 0.3), Math.min(0.28, short * 0.3), 0.02, 24), mat(look.accent, 0.5));
      base.position.y = 0.01;
      group.add(stem, base);
      break;
    }
    case 'plant': {
      const r = short / 2;
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.42, 0.36, 20), mat(look.accent));
      pot.position.y = 0.18;
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.95, 1), mat(look.body, 0.9));
      leaves.scale.set(1, 1.15, 1);
      leaves.position.y = 0.36 + r * 0.95;
      group.add(pot, leaves);
      break;
    }
    case 'screen': {
      const len = p.widthM;
      const tall = len > 2 ? 1.6 : Math.min(1.1, len * 0.5625);
      const bottom = len > 2 ? 0.6 : 1.05;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(len, tall, 0.05), mat(look.body, 0.35));
      panel.position.y = bottom + tall / 2;
      panel.rotation.y = -p.angle;
      group.add(panel);
      break;
    }
    case 'seat':
    case 'sofa':
      group.add(extrudeFootprint(p, 0, 0.42, mat(look.body)));
      break;
    case 'desk':
      group.add(extrudeFootprint(p, 0, p.widthM > 2.4 ? 1.05 : 0.75, mat(look.body, 0.7)));
      break;
    case 'bed':
      group.add(extrudeFootprint(p, 0, 0.5, mat(look.body)));
      break;
    case 'equipment':
      group.add(extrudeFootprint(p, 0, 1.2, mat(look.body, 0.6)));
      break;
    case 'sanitary':
      group.add(extrudeFootprint(p, 0, 0.42, mat(look.body, 0.3)));
      break;
    case 'joinery':
      group.add(extrudeFootprint(p, 0, 0.9, mat(look.body, 0.7)));
      break;
    default:
      group.add(extrudeFootprint(p, 0, Math.max(0.3, p.heightM || 0.6), mat(look.body)));
  }
  return group;
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

function signature(p: PlanFurniturePiece, tint?: string): string {
  const pts = p.outlineM.map((q) => `${Math.round((q.x - p.centerM.x) * 200)},${Math.round((q.y - p.centerM.y) * 200)}`).join(';');
  return `${p.kind}|${tint ?? ''}|${Math.round(p.angle * 1000)}|${pts}`;
}

function modelUrl(p: PlanFurniturePiece, tint?: string): Promise<string> {
  const key = signature(p, tint);
  let url = assetBySignature.get(key);
  if (!url) {
    url = (async () => {
      ensureBlobFetch();
      const out = (await exporter.parseAsync(buildPieceObject(p, tint), { binary: true })) as ArrayBuffer;
      const blobUrl = URL.createObjectURL(new Blob([out], { type: 'model/gltf-binary' }));
      ownBlobUrls.add(blobUrl);
      return blobUrl;
    })();
    url.catch(() => assetBySignature.delete(key));
    assetBySignature.set(key, url);
  }
  return url;
}

function boxOf(obj: THREE.Object3D): [number, number, number] {
  const b = new THREE.Box3().setFromObject(obj);
  const s = b.getSize(new THREE.Vector3());
  return [Math.max(0.01, s.x), Math.max(0.01, s.y), Math.max(0.01, s.z)];
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
      const [w, h, d] = boxOf(buildPieceObject(p));
      const src = await modelUrl(p);
      const id = uid('item');
      const name = p.label && p.kind === 'screen' ? p.label : KIND_LABEL[p.kind] ?? 'Furniture';
      const node = ItemNode.parse({
        id,
        name,
        parentId,
        position: [p.centerM.x, 0, p.centerM.y],
        rotation: [0, 0, 0],
        asset: { id: `plan-${p.id}`, category: 'furniture', name, thumbnail: THUMB, src, dimensions: [w, h, d], offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        metadata: { source: PLAN_FURNITURE_SOURCE, pieceId: p.id, typeId: p.typeId, kind: p.kind, shape: p.shape, layer: p.layer, sizeM: [p.widthM, p.depthM] },
      } as never) as AnyNode;
      ops.push({ node, parentId });
    } catch (e) {
      console.warn('[plan-furniture] skipped piece', p.id, e);
    }
  }
  if (ops.length) scene().createNodes(ops);
  return { installed: ops.length };
}

export interface FurnishResult {
  match: MatchResult;
  placed: number;
}

/**
 * Attach BOQ Flow's products to the drawn pieces they match: each matched item takes
 * the product's name and reference, and a tint shared by all pieces of that product.
 */
export async function applyProducts(f: PlanFurniture, products: MatchProduct[]): Promise<FurnishResult> {
  const match = matchProducts(f.pieces, products);
  const installed = planFurnitureNodes();
  const tintOf = new Map(products.map((p, i) => [p.id, PRODUCT_TINTS[i % PRODUCT_TINTS.length]]));
  const byId = new Map(products.map((p) => [p.id, p]));
  let placed = 0;
  for (const piece of f.pieces) {
    const hit = installed.get(piece.id);
    if (!hit) continue;
    const productId = match.byPiece[piece.id];
    const product = productId ? byId.get(productId) : undefined;
    const meta = { ...(hit.node.metadata as Record<string, unknown>) };
    const asset = { ...(hit.node.asset as Record<string, unknown>) };
    const tint = product ? tintOf.get(product.id) : undefined;
    try {
      asset.src = await modelUrl(piece, tint);
    } catch {
      // keep the untinted stand-in
    }
    if (product) {
      placed++;
      meta.product = { id: product.id, description: product.description, brand: product.brand, model: product.model, imageUrl: product.imageUrl, tint };
    } else delete meta.product;
    const name = product ? [product.brand, product.model].filter(Boolean).join(' · ') || product.description.slice(0, 60) : KIND_LABEL[piece.kind] ?? 'Furniture';
    asset.name = name;
    scene().updateNode(hit.id, { name, metadata: meta, asset });
  }
  return { match, placed };
}
