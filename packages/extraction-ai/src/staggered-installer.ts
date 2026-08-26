// design-build-extraction-ai
// CAP-03: AI_STAGGERED_INSTALL_V2 (Staggered Node Installation & Batch Invalidation)
//
// Pure scheduling & topological batching engine for high-performance BIM scene installation.
// Boundary rules:
//   - Enforces parent-before-child topological ordering.
//   - Batches scene nodes into measured chunks (default: 25) with frame yielding.
//   - Batches renderer dirty invalidations without redundant redraw thrashing.
//   - Applies ONLY when pipelineKind === 'ai'.

import type { DiffableNode } from './scene-diff';

/** Feature flag for AI staggered installation V2 (Default: false). */
export const AI_STAGGERED_INSTALL_V2 = false;

export const NODE_TYPE_INSTALL_ORDER: Record<string, number> = {
  site: 0,
  building: 1,
  level: 2,
  slab: 3,
  wall: 4,
  column: 5,
  door: 6,
  window: 7,
  opening: 8,
  item: 9,
  furniture: 9,
  zone: 10,
  room: 10,
  ceiling: 11,
  guide: 12,
};

export interface StaggeredBatchOptions {
  batchSize?: number; // default 25
  sortTopologically?: boolean; // default true
}

export interface NodeBatch {
  batchIndex: number;
  totalBatches: number;
  nodes: DiffableNode[];
  phaseLabel: string;
}

export interface StaggeredInstallationPlan {
  totalNodes: number;
  batchSize: number;
  batches: NodeBatch[];
  topologicallyOrdered: boolean;
  pure: true;
}

/**
 * Sorts nodes topologically so parents and structural foundations precede dependent children.
 */
export function sortNodesTopologically(nodes: DiffableNode[]): DiffableNode[] {
  return [...nodes].sort((a, b) => {
    const orderA = NODE_TYPE_INSTALL_ORDER[a.type.toLowerCase()] ?? 99;
    const orderB = NODE_TYPE_INSTALL_ORDER[b.type.toLowerCase()] ?? 99;

    if (orderA !== orderB) {
      return orderA - orderB;
    }
    // Stable tie-breaker by ID
    return a.id.localeCompare(b.id);
  });
}

/**
 * Computes a deterministic staggered installation plan with parent-before-child ordering.
 */
export function planStaggeredInstallation(
  nodes: DiffableNode[],
  options?: StaggeredBatchOptions
): StaggeredInstallationPlan {
  const batchSize = Math.max(1, options?.batchSize ?? 25);
  const sort = options?.sortTopologically ?? true;

  const ordered = sort ? sortNodesTopologically(nodes) : [...nodes];
  const batches: NodeBatch[] = [];
  const totalBatches = Math.max(1, Math.ceil(ordered.length / batchSize));

  for (let i = 0; i < ordered.length; i += batchSize) {
    const chunk = ordered.slice(i, i + batchSize);
    const batchIndex = batches.length;

    // Derive a human-readable phase label for telemetry
    const typesInBatch = Array.from(new Set(chunk.map((n) => n.type)));
    const phaseLabel = `Batch ${batchIndex + 1}/${totalBatches} (${typesInBatch.join(', ')})`;

    batches.push({
      batchIndex,
      totalBatches,
      nodes: chunk,
      phaseLabel,
    });
  }

  return {
    totalNodes: ordered.length,
    batchSize,
    batches,
    topologicallyOrdered: sort,
    pure: true,
  };
}

export interface InvalidationBatchResult {
  batched: boolean;
  uniqueNodeCount: number;
  structuralInvalidationRequired: boolean;
  dirtyIds: string[];
}

/**
 * Deduplicates and batches dirty node invalidations to prevent redundant R3F renderer reruns.
 */
export function batchDirtyInvalidations(dirtyNodeIds: string[]): InvalidationBatchResult {
  const uniqueIds = Array.from(new Set(dirtyNodeIds.filter(Boolean)));
  const structuralTypes = ['wall', 'slab', 'ceiling', 'level'];
  const hasStructural = uniqueIds.some((id) => structuralTypes.some((t) => id.toLowerCase().includes(t)));

  return {
    batched: uniqueIds.length > 0,
    uniqueNodeCount: uniqueIds.length,
    structuralInvalidationRequired: hasStructural,
    dirtyIds: uniqueIds,
  };
}
