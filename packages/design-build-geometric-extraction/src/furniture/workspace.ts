// CS4 FF&E review workspace grouping.
import type { ClassifiedFamily } from './sector-classifier.ts';

export type WorkspaceView =
  | 'sector' | 'space' | 'category' | 'family' | 'product-type'
  | 'scope' | 'catalogue-status' | 'boq-status' | 'review-status';

export interface WorkspaceGroup {
  key: string;
  title: string;
  familyIds: string[];
  instanceCount: number;
  reviewCount: number;
}

function keyFor(f: ClassifiedFamily, view: WorkspaceView): string {
  switch (view) {
    case 'sector': return f.assignment.sector;
    case 'space': return f.assignment.spaceType ?? 'unassigned';
    case 'category': return f.assignment.category;
    case 'family': return f.family.id;
    case 'product-type': return f.assignment.productType;
    case 'scope': return f.assignment.scope;
    case 'catalogue-status': return f.family.catalogueStatus;
    default: return 'review';
  }
}

export function buildWorkspace(fs: ClassifiedFamily[], view: WorkspaceView): WorkspaceGroup[] {
  const m = new Map<string, WorkspaceGroup>();
  for (const f of fs) {
    const key = keyFor(f, view);
    const g = m.get(key) ?? { key, title: key, familyIds: [], instanceCount: 0, reviewCount: 0 };
    g.familyIds.push(f.family.id);
    g.instanceCount += f.family.instances.length;
    g.reviewCount += f.assignment.confidence < 0.7 ? f.family.instances.length : 0;
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => b.instanceCount - a.instanceCount || a.key.localeCompare(b.key));
}
