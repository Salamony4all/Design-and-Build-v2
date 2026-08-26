import { describe, it, expect } from 'vitest';
import {
  computeAiSceneDiff,
  type DiffableNode,
  type SceneDiffInput,
} from '../src/scene-diff';

describe('AI Scene Diffing V2 (CAP-02: User-Edit Protection)', () => {
  it('1. Correctly classifies new, modified, and unchanged AI nodes', () => {
    const liveNodes: Record<string, DiffableNode> = {
      wall_1: {
        id: 'wall_1',
        type: 'wall',
        start: [0, 0],
        end: [5, 0],
        provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'wall' },
      },
      wall_2: {
        id: 'wall_2',
        type: 'wall',
        start: [5, 0],
        end: [5, 4],
        provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'wall' },
      },
    };

    const incomingNodes: DiffableNode[] = [
      // Unchanged
      {
        id: 'wall_1',
        type: 'wall',
        start: [0, 0],
        end: [5, 0],
        provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'wall' },
      },
      // Modified endpoint in pass 2
      {
        id: 'wall_2',
        type: 'wall',
        start: [5, 0],
        end: [5, 4.5],
        provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.95, extractionType: 'wall' },
      },
      // Genuinely new door
      {
        id: 'door_1',
        type: 'door',
        start: [2, 0],
        end: [2.9, 0],
        provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.85, extractionType: 'door' },
      },
    ];

    const input: SceneDiffInput = {
      pipelineKind: 'ai',
      liveNodes,
      incomingNodes,
      options: { enabled: true },
    };

    const diff = computeAiSceneDiff(input);
    expect(diff.nodesToCreate).toHaveLength(1);
    expect(diff.nodesToCreate[0].id).toBe('door_1');

    expect(diff.nodesToUpdate).toHaveLength(1);
    expect(diff.nodesToUpdate[0].id).toBe('wall_2');
    expect(diff.nodesToUpdate[0].changes.end).toEqual([5, 4.5]);

    expect(diff.nodesToRetain).toHaveLength(1);
    expect(diff.nodesToRetain[0].id).toBe('wall_1');

    expect(diff.conflicts).toHaveLength(0);
  });

  it('2. Protects user-modified PRO nodes from incoming AI overwrites', () => {
    const liveNodes: Record<string, DiffableNode> = {
      item_chair_1: {
        id: 'item_chair_1',
        type: 'item',
        position: [3.5, 0, 4.2], // User moved chair in PRO mode
        rotation: [0, Math.PI / 4, 0],
        metadata: { _userModified: true },
        provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'item' },
      },
    };

    const incomingNodes: DiffableNode[] = [
      {
        id: 'item_chair_1',
        type: 'item',
        position: [3.0, 0, 4.0], // AI raw position in pass 4
        rotation: [0, 0, 0],
        provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.8, extractionType: 'item' },
      },
    ];

    const input: SceneDiffInput = {
      pipelineKind: 'ai',
      liveNodes,
      incomingNodes,
      options: { enabled: true, protectUserEdits: true },
    };

    const diff = computeAiSceneDiff(input);
    // User value preserved: not in nodesToUpdate
    expect(diff.nodesToUpdate).toHaveLength(0);
    expect(diff.nodesToRetain).toHaveLength(1);

    // Conflict ledger record created
    expect(diff.conflicts).toHaveLength(2); // position + rotation
    expect(diff.conflicts[0].nodeId).toBe('item_chair_1');
    expect(diff.conflicts[0].conflictStatus).toBe('PRESERVED_USER_VALUE');
  });

  it('3. Retains manual user-created nodes even if omitted by later AI pass', () => {
    const liveNodes: Record<string, DiffableNode> = {
      manual_wall_1: {
        id: 'manual_wall_1',
        type: 'wall',
        start: [10, 0],
        end: [10, 5],
        provenance: { sourceKind: 'mock', sourcePrimitiveIds: [], confidence: 1.0, extractionType: 'wall' },
      },
      ai_wall_1: {
        id: 'ai_wall_1',
        type: 'wall',
        start: [0, 0],
        end: [5, 0],
        provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.85, extractionType: 'wall' },
      },
    };

    const incomingNodes: DiffableNode[] = [
      {
        id: 'ai_wall_1',
        type: 'wall',
        start: [0, 0],
        end: [5, 0],
        provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.85, extractionType: 'wall' },
      },
    ];

    const input: SceneDiffInput = {
      pipelineKind: 'ai',
      liveNodes,
      incomingNodes,
      options: { enabled: true },
    };

    const diff = computeAiSceneDiff(input);
    expect(diff.nodesToRetain.some((n) => n.id === 'manual_wall_1')).toBe(true);
    expect(diff.nodesRetainedForReview).toHaveLength(0);
  });

  it('4. Retains missing AI nodes for review rather than silent deletion', () => {
    const liveNodes: Record<string, DiffableNode> = {
      ai_desk_1: {
        id: 'ai_desk_1',
        type: 'item',
        position: [2, 0, 3],
        provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.75, extractionType: 'item' },
      },
    };

    const incomingNodes: DiffableNode[] = []; // Omitted in revised pass

    const input: SceneDiffInput = {
      pipelineKind: 'ai',
      liveNodes,
      incomingNodes,
      options: { enabled: true },
    };

    const diff = computeAiSceneDiff(input);
    expect(diff.nodesRetainedForReview).toHaveLength(1);
    expect(diff.nodesRetainedForReview[0].id).toBe('ai_desk_1');
    expect(diff.nodesRetainedForReview[0].reason).toBe('AI_NODE_MISSING_FROM_LATER_PASS');
  });

  it('5. Matches incoming nodes by semanticId and sourceRecordId when ID differs', () => {
    const liveNodes: Record<string, DiffableNode> = {
      wall_old_id: {
        id: 'wall_old_id',
        semanticId: 'semantic_wall_south',
        type: 'wall',
        start: [0, 0],
        end: [6, 0],
        provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'wall' },
      },
    };

    const incomingNodes: DiffableNode[] = [
      {
        id: 'wall_new_id',
        semanticId: 'semantic_wall_south',
        type: 'wall',
        start: [0, 0],
        end: [6.2, 0], // Extended slightly
        provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.95, extractionType: 'wall' },
      },
    ];

    const input: SceneDiffInput = {
      pipelineKind: 'ai',
      liveNodes,
      incomingNodes,
      options: { enabled: true },
    };

    const diff = computeAiSceneDiff(input);
    expect(diff.nodesToCreate).toHaveLength(0);
    expect(diff.nodesToUpdate).toHaveLength(1);
    expect(diff.nodesToUpdate[0].id).toBe('wall_old_id');
  });
});
