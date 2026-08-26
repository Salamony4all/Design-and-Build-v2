// harness/ai-scene-install/catalogue.ts
// Catalogue-constrained furniture asset resolution — shared by both installers.
// NO hardcoded mapping: resolves the AI familyId via resolvePascalFurniture
// (Pascal deployed manifest) and returns the CDN asset path + real dimensions.

import { resolvePascalFurniture } from 'design-build-extraction-ai';

export interface ResolvedFurniture {
  slug: string;
  label: string;
  category: string;
  src: string;
  thumbnail: string;
  widthM: number;
  depthM: number;
  heightM: number;
}

/**
 * Resolve an AI familyId to a verified Pascal catalogue asset.
 * Returns null when the asset is unknown or the match confidence is too low
 * (alias/ambiguous), so callers MUST skip rather than guess a URL.
 */
export function lookupFurniture(familyId: string | undefined): ResolvedFurniture | null {
  if (!familyId) return null;
  const r = resolvePascalFurniture(familyId);
  if (!r.def || r.confidence < 0.72) return null;
  const slug = r.def.slug;
  const src = `/items/${slug}/model.glb`;
  return {
    slug,
    label: r.def.label,
    category: 'furniture',
    src,
    thumbnail: src.replace(/model\.glb$/, 'thumbnail.webp'),
    widthM: r.def.widthM,
    depthM: r.def.depthM,
    heightM: r.def.heightM,
  };
}

/** Build the ItemNode asset block from a resolved furniture entry. */
export function furnitureAsset(def: ResolvedFurniture) {
  return {
    id: def.slug,
    category: 'furniture' as const,
    name: def.label,
    thumbnail: def.thumbnail,
    src: def.src,
    dimensions: [0, 0, 0] as [number, number, number], // caller fills [w,h,d]
    attachTo: undefined as undefined,
    rotation: [0, 0, 0] as [number, number, number],
  };
}
