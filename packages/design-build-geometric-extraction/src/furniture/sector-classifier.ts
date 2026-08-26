// CS4 sector classifier — maps geometric families onto sector product priors.
import type { FurnitureFamily, ProposedClass } from './family-extractor.ts';
import { getSectorProfile, type ProductPrior } from './sector-dictionary.ts';
import type { ConfidenceVector, SectorId, TaxonomyAssignment } from './taxonomy.ts';

export interface ContextEvidence {
  sector: SectorId;
  spaceType?: string;
  /** AI / annotation hint, e.g. from vision proposal or a room schedule. Never oracle data. */
  aiClass?: string;
  roomLabel?: string;
}

export interface ClassifyOptions {
  /** Drawing units per meter for the family instances (1000 for mm fixtures). */
  unitsPerMeter?: number;
}

export interface ClassifiedFamily {
  family: FurnitureFamily;
  assignment: TaxonomyAssignment;
  confidence: ConfidenceVector;
  warnings: string[];
}

const PROPOSED_KEYWORDS: Record<ProposedClass, string[]> = {
  bed: ['bed'],
  wardrobe: ['wardrobe'],
  desk: ['desk'],
  table: ['table'],
  chair: ['chair'],
  'generic-item': [],
};

function scorePrior(prior: ProductPrior, widthM: number, depthM: number, family: FurnitureFamily, ctx: ContextEvidence): number {
  let s = 0;
  const hasW = prior.minWidth != null && prior.maxWidth != null;
  const hasD = prior.minDepth != null && prior.maxDepth != null;
  if (hasW) {
    if (widthM >= prior.minWidth! && widthM <= prior.maxWidth!) s += 0.22;
    else if (widthM < prior.minWidth! * 0.75 || widthM > prior.maxWidth! * 1.25) s -= 0.15;
  }
  if (hasD) {
    if (depthM >= prior.minDepth! && depthM <= prior.maxDepth!) s += 0.22;
    else if (depthM < prior.minDepth! * 0.75 || depthM > prior.maxDepth! * 1.25) s -= 0.15;
  }
  const hint = (ctx.aiClass ?? '').toLowerCase();
  if (hint && prior.keywords.some((k) => hint.includes(k))) s += 0.34;
  const proposedWords = PROPOSED_KEYWORDS[family.proposedClass] ?? [];
  if (proposedWords.length && prior.keywords.some((k) => proposedWords.some((w) => k.includes(w)))) s += 0.18;
  return s;
}

export function classifyFamily(family: FurnitureFamily, ctx: ContextEvidence, opts: ClassifyOptions = {}): ClassifiedFamily {
  const upm = opts.unitsPerMeter ?? 1;
  const profile = getSectorProfile(ctx.sector);
  const i = family.instances[0];
  const widthM = i ? i.width / upm : 0;
  const depthM = i ? i.depth / upm : 0;
  const warnings: string[] = [];

  let best: ProductPrior | undefined;
  let score = -Infinity;
  for (const prior of profile.products) {
    const s = scorePrior(prior, widthM, depthM, family, ctx);
    if (s > score) { score = s; best = prior; }
  }

  const recurrence = Math.min(1, family.recurrence / 6);
  // No prior, or nothing scored positively → unclassified (do NOT force-fit a product).
  if (!best || score <= 0) {
    if (!best) warnings.push('no-sector-product-prior');
    else warnings.push('no-positive-prior-match');
    return {
      family,
      assignment: {
        sector: ctx.sector, spaceType: ctx.spaceType,
        category: 'unclassified', scope: 'loose-ffe', productType: 'generic-item',
        confidence: 0.2, basis: ['geometry-only'],
      },
      confidence: { geometry: 0.65, recurrence, spaceContext: ctx.spaceType ? 0.8 : 0.2, semantic: 0.2, pascalAsset: 0, catalogue: 0 },
      warnings,
    };
  }

  const semantic = Math.min(0.95, 0.25 + Math.max(0, score));
  return {
    family,
    assignment: {
      sector: ctx.sector, spaceType: ctx.spaceType,
      category: best.category, scope: best.scope, productType: best.productType,
      confidence: semantic,
      basis: [
        'geometric-family', 'sector-profile',
        ...(ctx.spaceType ? ['space-context'] : []),
        ...(ctx.aiClass ? ['ai-proposal'] : []),
      ],
    },
    confidence: { geometry: 0.78, recurrence, spaceContext: ctx.spaceType ? 0.82 : 0.25, semantic, pascalAsset: 0, catalogue: 0 },
    warnings,
  };
}
