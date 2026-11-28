// features/furniture/pascal-catalog-map.ts
// Maps strictly neutral non-furniture architectural fixtures (sanitaryware and indoor
// plants) onto Pascal Editor's built-in 3D GLB catalog (@pascal-app/editor/catalog).
// Loose furniture, desks, seating, bespoke joinery, storage, and display screens stay
// footprint-accurate via `buildCustomFurnitureGroup` / BOQ product photo cutouts so
// stylized third-party GLBs (e.g. mahogany desks or rear VESA TVs) never conflict with
// matched BOQ product reference images in photoreal renders.

import type { AssetInput } from '@pascal-app/core';
import { CATALOG_ITEMS, type CatalogItem } from '@pascal-app/editor/catalog';
import type { MatchProduct } from './match-products';

export interface PlanPieceLike {
  kind: string;
  subtype?: string;
  shape: string;
  widthM: number;
  depthM: number;
  heightM?: number;
  angle: number;
  facing?: number;
  label?: string;
  subParts?: readonly { role: string }[];
}

export interface PascalCatalogAssetMatch {
  catalogId: string;
  asset: AssetInput;
  rotationY: number;
}

const BY_ID = new Map<string, CatalogItem>(CATALOG_ITEMS.map((item) => [item.id, item]));

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function pickCatalogId(piece: PlanPieceLike, product?: MatchProduct): string | null {
  const text = `${product?.brand ?? ''} ${product?.model ?? ''} ${product?.description ?? ''} ${piece.label ?? ''}`.toLowerCase();
  const sub = piece.subtype || '';

  switch (piece.kind) {
    case 'sanitary': {
      if (sub === 'wc' || /\b(wc|toilet)\b/.test(text)) return 'toilet';
      if (sub === 'shower' || /\bshower\b/.test(text)) return 'shower-square';
      if (sub === 'bathtub' || /\bbath\b/.test(text)) return 'bathtub';
      return 'bathroom-sink';
    }
    case 'plant':
      return piece.widthM <= 0.5 ? 'small-indoor-plant' : 'indoor-plant';
    default:
      return null;
  }
}

/**
 * Resolves a standard furniture/fixture piece to a scaled, oriented Pascal Editor `.glb` catalog asset.
 * Returns `null` when smooth custom procedural geometry is better (curved/L-shaped bespoke joinery).
 */
export function resolvePascalCatalogAsset(
  piece: PlanPieceLike,
  product?: MatchProduct,
): PascalCatalogAssetMatch | null {
  const id = pickCatalogId(piece, product);
  if (!id) return null;
  const tpl = BY_ID.get(id);
  if (!tpl) return null;

  const [natW, natH, natD] = tpl.dimensions ?? [0.6, 0.75, 0.6];
  const [baseSx, baseSy, baseSz] = tpl.scale ?? [1, 1, 1];
  const [ox, oy, oz] = tpl.offset ?? [0, 0, 0];

  const targetH = product?.dims?.h && product.dims.h > 0.2 ? product.dims.h : (piece.heightM || natH);
  const targetW = Math.max(0.25, piece.widthM);
  const targetD = Math.max(0.25, piece.depthM);

  const proportional = piece.kind === 'seat' || piece.kind === 'sanitary' || piece.kind === 'plant' || piece.kind === 'equipment';
  let rw: number;
  let rh: number;
  let rd: number;

  if (proportional) {
    const planMax = Math.max(targetW, targetD);
    const natMax = Math.max(natW, natD, 0.2);
    const u = clamp(planMax / natMax, 0.72, 1.38);
    rw = u;
    rh = clamp(targetH / Math.max(natH, 0.2), 0.78, 1.32);
    rd = u;
  } else {
    // Match catalog horizontal axes: if native long axis differs from piece width vs depth, fit longest to widthM
    const swapHoriz = natD > natW * 1.15 && targetW >= targetD;
    rw = clamp((swapHoriz ? targetD : targetW) / Math.max(natW, 0.2), 0.55, 1.9);
    rd = clamp((swapHoriz ? targetW : targetD) / Math.max(natD, 0.2), 0.55, 1.9);
    rh = clamp(targetH / Math.max(natH, 0.2), 0.65, 1.45);
  }

  const swapAxes = natD > natW * 1.15 && targetW >= targetD;
  const hasFacing = typeof piece.facing === 'number' && Number.isFinite(piece.facing);
  const baseRotY = hasFacing
    ? Math.PI / 2 - (piece.facing as number)
    : -piece.angle + (swapAxes ? Math.PI / 2 : 0);

  const thumb = product?.imageUrl && /^https?:\/\//i.test(product.imageUrl)
    ? product.imageUrl
    : tpl.thumbnail;

  return {
    catalogId: tpl.id,
    rotationY: r3(baseRotY),
    asset: {
      id: `pascal-${tpl.id}`,
      category: tpl.category,
      name: tpl.name,
      src: tpl.src,
      thumbnail: thumb,
      ...(tpl.floorPlanUrl ? { floorPlanUrl: tpl.floorPlanUrl } : {}),
      dimensions: [r3(natW * rw), r3(natH * rh), r3(natD * rd)],
      offset: [r3(ox * rw), r3(oy * rh), r3(oz * rd)],
      rotation: [tpl.rotation?.[0] ?? 0, tpl.rotation?.[1] ?? 0, tpl.rotation?.[2] ?? 0],
      scale: [r3(baseSx * rw), r3(baseSy * rh), r3(baseSz * rd)],
      ...(tpl.surface ? { surface: { height: r3(tpl.surface.height * rh) } } : {}),
    },
  };
}
