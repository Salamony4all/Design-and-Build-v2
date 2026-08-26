import { describe, it, expect } from 'vitest';
import {
  sortNodesTopologically,
  planStaggeredInstallation,
  batchDirtyInvalidations,
} from '../src/staggered-installer';
import type { DiffableNode } from '../src/scene-diff';

describe('AI Staggered Installation V2 (CAP-03)', () => {
  it('1. Enforces strict parent-before-child topological ordering', () => {
    const rawNodes: DiffableNode[] = [
      { id: 'item_1', type: 'item' },
      { id: 'door_1', type: 'door' },
      { id: 'slab_1', type: 'slab' },
      { id: 'level_0', type: 'level' },
      { id: 'wall_1', type: 'wall' },
      { id: 'window_1', type: 'window' },
    ];

    const sorted = sortNodesTopologically(rawNodes);
    const sortedTypes = sorted.map((n) => n.type);

    expect(sortedTypes).toEqual(['level', 'slab', 'wall', 'door', 'window', 'item']);
  });

  it('2. Partitions 60 nodes into measured batches of 25 with phase labels', () => {
    const nodes: DiffableNode[] = Array.from({ length: 60 }, (_, i) => ({
      id: `node_${i + 1}`,
      type: i < 5 ? 'slab' : i < 30 ? 'wall' : 'item',
    }));

    const plan = planStaggeredInstallation(nodes, { batchSize: 25, sortTopologically: true });
    expect(plan.totalNodes).toBe(60);
    expect(plan.batchSize).toBe(25);
    expect(plan.batches).toHaveLength(3); // 25, 25, 10

    expect(plan.batches[0].nodes).toHaveLength(25);
    expect(plan.batches[1].nodes).toHaveLength(25);
    expect(plan.batches[2].nodes).toHaveLength(10);

    expect(plan.batches[0].phaseLabel).toContain('Batch 1/3');
  });

  it('3. Supports configurable batch sizes (10, 50)', () => {
    const nodes: DiffableNode[] = Array.from({ length: 25 }, (_, i) => ({
      id: `node_${i + 1}`,
      type: 'item',
    }));

    const plan10 = planStaggeredInstallation(nodes, { batchSize: 10 });
    expect(plan10.batches).toHaveLength(3); // 10, 10, 5

    const plan50 = planStaggeredInstallation(nodes, { batchSize: 50 });
    expect(plan50.batches).toHaveLength(1); // 25
  });

  it('4. Deduplicates dirty node invalidations and identifies structural invalidation', () => {
    const dirtyIds = ['wall_1', 'wall_2', 'wall_1', 'item_bed_1', 'item_bed_1'];
    const res = batchDirtyInvalidations(dirtyIds);

    expect(res.batched).toBe(true);
    expect(res.uniqueNodeCount).toBe(3);
    expect(res.dirtyIds).toEqual(['wall_1', 'wall_2', 'item_bed_1']);
    expect(res.structuralInvalidationRequired).toBe(true);
  });
});
