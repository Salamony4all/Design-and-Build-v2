// packages/extraction-ai/src/furniture-dimensions.ts
// Furniture dimension source priority and provenance resolution.

import type { FurnitureResolutionResult } from './pascal-furniture-catalog';

export type DimensionSource =
  | 'measured'
  | 'ai-provided'
  | 'symbol-bbox'
  | 'repetition-consensus'
  | 'room-context'
  | 'canonical-catalog-default'
  | 'generic-fallback';

export interface ResolvedFurnitureDimensions {
  widthM: number;
  depthM: number;
  heightM: number;
  dimensionSource: DimensionSource;
  dimensionConfidence: number;
}

export function resolveFurnitureDimensions(
  rawItem: { width?: number; depth?: number; height?: number },
  catalogRes: FurnitureResolutionResult,
): ResolvedFurnitureDimensions {
  const rawW = rawItem.width;
  const rawD = rawItem.depth;
  const rawH = rawItem.height;

  // 1. AI-provided dimensions if valid and in reasonable scale range
  if (
    typeof rawW === 'number' &&
    Number.isFinite(rawW) &&
    rawW >= 0.2 &&
    rawW <= 8.0 &&
    typeof rawD === 'number' &&
    Number.isFinite(rawD) &&
    rawD >= 0.2 &&
    rawD <= 8.0
  ) {
    const heightM = typeof rawH === 'number' && Number.isFinite(rawH) && rawH > 0 ? rawH : catalogRes.defaultDimensionsM[2];
    return {
      widthM: rawW,
      depthM: rawD,
      heightM,
      dimensionSource: 'ai-provided',
      dimensionConfidence: 0.90,
    };
  }

  // 2. Canonical Catalogue Default
  if (catalogRes.family) {
    const [defW, defD, defH] = catalogRes.defaultDimensionsM;
    return {
      widthM: defW,
      depthM: defD,
      heightM: defH,
      dimensionSource: 'canonical-catalog-default',
      dimensionConfidence: 0.85,
    };
  }

  // 3. Generic Fallback
  return {
    widthM: 1.0,
    depthM: 1.0,
    heightM: 0.8,
    dimensionSource: 'generic-fallback',
    dimensionConfidence: 0.30,
  };
}
