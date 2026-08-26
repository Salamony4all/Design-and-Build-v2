// CS4 geometric ↔ AI reconciliation. AI proposals are advisory evidence, never oracle truth.
import type { ClassifiedFamily } from './sector-classifier.ts';

export type ReconciliationVerdict =
  | 'CONFIRMED_BY_AI_AND_GEOMETRY' | 'GEOMETRIC_ONLY' | 'AI_ONLY' | 'CONFLICT' | 'REVIEW_REQUIRED';

export interface AiFurnitureProposal {
  id: string;
  class: string;
  center: { x: number; y: number };
  width: number;
  depth: number;
  rotation: number;
  confidence: number;
}

export interface ReconciledInstance {
  familyId: string;
  geometricInstanceId?: string;
  aiInstanceId?: string;
  positionDelta?: number;
  dimensionDelta?: number;
  rotationDelta?: number;
  verdict: ReconciliationVerdict;
  confidence: number;
  reasons: string[];
}

export function reconcileFamily(
  c: ClassifiedFamily,
  ai: AiFurnitureProposal[],
  positionTolerance = 0.35,
): ReconciledInstance[] {
  const out: ReconciledInstance[] = [];
  const used = new Set<string>();
  for (const g of c.family.instances) {
    let best: AiFurnitureProposal | undefined;
    let bestD = Infinity;
    for (const a of ai) {
      if (used.has(a.id)) continue;
      const d = Math.hypot(a.center.x - g.center.x, a.center.y - g.center.y);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best && bestD <= positionTolerance) {
      used.add(best.id);
      const dd = Math.abs(best.width - g.width) + Math.abs(best.depth - g.depth);
      const same = best.class === c.assignment.productType;
      out.push({
        familyId: c.family.id,
        geometricInstanceId: g.id,
        aiInstanceId: best.id,
        positionDelta: bestD,
        dimensionDelta: dd,
        rotationDelta: Math.abs(best.rotation - g.orientation),
        verdict: same ? 'CONFIRMED_BY_AI_AND_GEOMETRY' : 'CONFLICT',
        confidence: same ? Math.min(0.98, (g.confidence + best.confidence) / 2) : 0.45,
        reasons: [same ? 'semantic-agreement' : 'semantic-conflict', 'spatial-match'],
      });
    } else {
      out.push({
        familyId: c.family.id,
        geometricInstanceId: g.id,
        verdict: 'GEOMETRIC_ONLY',
        confidence: g.confidence,
        reasons: ['no-ai-match'],
      });
    }
  }
  for (const a of ai) {
    if (!used.has(a.id)) {
      out.push({
        familyId: c.family.id,
        aiInstanceId: a.id,
        verdict: 'AI_ONLY',
        confidence: a.confidence,
        reasons: ['no-geometric-match'],
      });
    }
  }
  return out;
}
