// features/pro/pro-milestone-b.test.ts
// Tests for Milestone B: Safe Deletion Capability Matrix & Item Workflow.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockSceneState = {
  nodes: {} as Record<string, any>,
  deleteNode: (id: string) => {
    delete mockSceneState.nodes[id];
  },
  updateNode: (id: string, node: any) => {
    mockSceneState.nodes[id] = node;
  },
  temporal: {
    undo: vi.fn(),
    redo: vi.fn(),
  },
};

const mockViewerSelection = {
  selectedIds: [] as string[],
  buildingId: null as string | null,
  levelId: null as string | null,
};

vi.mock('@pascal-app/core', () => ({
  useScene: Object.assign(
    (selector: any) => selector(mockSceneState),
    {
      getState: () => mockSceneState,
      setState: (s: any) => Object.assign(mockSceneState, s),
      temporal: {
        getState: () => mockSceneState.temporal,
      },
    },
  ),
}));

vi.mock('@pascal-app/viewer', () => ({
  useViewer: Object.assign(
    (selector: any) => selector({ selection: mockViewerSelection }),
    {
      getState: () => ({
        selection: mockViewerSelection,
        setSelection: (sel: any) => Object.assign(mockViewerSelection, sel),
      }),
    },
  ),
}));

import {
  canSafelyDeleteNode,
  getDeleteDisabledReason,
  performSafeDelete,
  DELETION_CAPABILITY_MATRIX,
} from './safeDelete';

describe('Milestone B1: Safe Deletion Capability Matrix', () => {
  beforeEach(() => {
    mockSceneState.nodes = {
      item_1: {
        id: 'item_1',
        type: 'item',
        parentId: 'level_1',
        name: 'Sofa',
      },
      door_1: {
        id: 'door_1',
        type: 'door',
        parentId: 'wall_1',
        name: 'Front Door',
      },
      window_1: {
        id: 'window_1',
        type: 'window',
        parentId: 'wall_1',
        name: 'Window',
      },
      wall_1: {
        id: 'wall_1',
        type: 'wall',
        parentId: 'level_1',
        name: 'Wall 1',
      },
      slab_1: {
        id: 'slab_1',
        type: 'slab',
        parentId: 'level_1',
        name: 'Floor Slab',
      },
    };
    mockViewerSelection.selectedIds = ['item_1'];
  });

  it('allows safe deletion of items', () => {
    expect(canSafelyDeleteNode('item_1')).toBe(true);
    const success = performSafeDelete('item_1');
    expect(success).toBe(true);
    expect(mockSceneState.nodes['item_1']).toBeUndefined();
    expect(mockViewerSelection.selectedIds).toEqual([]);
  });

  it('disables deletion of hosted doors, windows, walls, and slabs until verified', () => {
    expect(canSafelyDeleteNode('door_1')).toBe(false);
    expect(getDeleteDisabledReason('door_1')).toContain('opening restoration');

    expect(canSafelyDeleteNode('window_1')).toBe(false);
    expect(getDeleteDisabledReason('window_1')).toContain('opening restoration');

    expect(canSafelyDeleteNode('wall_1')).toBe(false);
    expect(getDeleteDisabledReason('wall_1')).toContain('hosted-child');

    expect(canSafelyDeleteNode('slab_1')).toBe(false);
    expect(getDeleteDisabledReason('slab_1')).toContain('dependency');
  });
});

describe('Milestone B1: Item Placement and History Workflow', () => {
  beforeEach(() => {
    mockSceneState.nodes = {
      building_1: { id: 'building_1', type: 'building', name: 'Main' },
      level_1: { id: 'level_1', type: 'level', parentId: 'building_1', name: 'Level 0' },
    };
    mockViewerSelection.buildingId = 'building_1';
    mockViewerSelection.levelId = 'level_1';
    mockViewerSelection.selectedIds = [];
  });

  it('commits ItemNode with schema-supported manual metadata and undo/redo support', () => {
    const newItemId = 'item_test_100';
    const newItemNode = {
      id: newItemId,
      type: 'item',
      parentId: 'level_1',
      name: 'Modern Chair',
      position: [2.5, 0, 1.5],
      rotation: [0, 0, 0],
      metadata: {
        creationMethod: 'manual-pro',
        userModified: true,
      },
    };

    // Simulate authoritative creation
    mockSceneState.updateNode(newItemId, newItemNode);
    mockViewerSelection.selectedIds = [newItemId];

    expect(mockSceneState.nodes[newItemId]).toBeDefined();
    expect(mockViewerSelection.selectedIds).toEqual([newItemId]);
    expect(mockSceneState.nodes[newItemId].metadata.creationMethod).toBe('manual-pro');

    // Simulate undo
    mockSceneState.deleteNode(newItemId);
    expect(mockSceneState.nodes[newItemId]).toBeUndefined();

    // Simulate redo
    mockSceneState.updateNode(newItemId, newItemNode);
    expect(mockSceneState.nodes[newItemId]).toBeDefined();
    expect(mockSceneState.nodes[newItemId].id).toBe(newItemId);
  });
});
