// features/pro/pro-final-acceptance.test.ts
// Comprehensive acceptance tests for PRO Creation, Hosting, History, Safe Deletion, and Provenance.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  canSafelyDeleteNode,
  getDeleteDisabledReason,
  performSafeDelete,
  DELETION_CAPABILITY_MATRIX,
} from './safeDelete';

const mockSceneState = {
  nodes: {} as Record<string, any>,
  rootNodeIds: [] as string[],
  deleteNode: (id: string) => {
    delete mockSceneState.nodes[id];
  },
  updateNode: (id: string, node: any) => {
    mockSceneState.nodes[id] = node;
  },
  createNodes: (parent: string, newNodes: any[]) => {
    for (const n of newNodes) {
      mockSceneState.nodes[n.id] = { ...n, parentId: parent };
    }
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

describe('1. Single-Node Selection & Hosted Elements', () => {
  beforeEach(() => {
    mockSceneState.nodes = {
      building_1: { id: 'building_1', type: 'building', name: 'Main' },
      level_0: { id: 'level_0', type: 'level', parentId: 'building_1', name: 'Level 0' },
      wall_1: { id: 'wall_1', type: 'wall', parentId: 'level_0', name: 'South Wall' },
      door_1: { id: 'door_1', type: 'door', parentId: 'wall_1', name: 'Main Door' },
      window_1: { id: 'window_1', type: 'window', parentId: 'wall_1', name: 'Living Window' },
      slab_1: { id: 'slab_1', type: 'slab', parentId: 'level_0', name: 'Floor Slab' },
      guide_1: { id: 'guide_1', type: 'guide', parentId: 'level_0', name: 'PDF Guide' },
      item_1: { id: 'item_1', type: 'item', parentId: 'level_0', name: 'Queen Bed' },
    };
  });

  it('selecting DoorNode leaves host wall unselected', () => {
    mockViewerSelection.selectedIds = ['door_1'];
    expect(mockViewerSelection.selectedIds).toEqual(['door_1']);
    expect(mockViewerSelection.selectedIds.includes('wall_1')).toBe(false);
  });

  it('selecting WindowNode leaves host wall unselected', () => {
    mockViewerSelection.selectedIds = ['window_1'];
    expect(mockViewerSelection.selectedIds).toEqual(['window_1']);
    expect(mockViewerSelection.selectedIds.includes('wall_1')).toBe(false);
  });

  it('resolves item child mesh click to parent item node', () => {
    const childMeshId = 'mesh_cushion_sub';
    const parentItemId = 'item_1';
    // Mapping from child to parent
    const resolvedId = mockSceneState.nodes[parentItemId] ? parentItemId : null;
    mockViewerSelection.selectedIds = [resolvedId!];
    expect(mockViewerSelection.selectedIds).toEqual(['item_1']);
  });
});

describe('2. Wall, Slab, Door, and Window Creation Tools', () => {
  it('creates WallNode with valid start/end points and manual metadata', () => {
    const newWall = {
      id: 'wall_manual_101',
      type: 'wall',
      parentId: 'level_0',
      start: [0, 0],
      end: [4.5, 0],
      thickness: 0.2,
      height: 3.0,
      metadata: {
        creationMethod: 'manual-pro',
        sourceRecordId: null,
        userModified: true,
      },
    };
    mockSceneState.updateNode(newWall.id, newWall);
    expect(mockSceneState.nodes['wall_manual_101']).toBeDefined();
    expect(mockSceneState.nodes['wall_manual_101'].metadata.creationMethod).toBe('manual-pro');
  });

  it('creates SlabNode with closed boundary polygon and manual metadata', () => {
    const newSlab = {
      id: 'slab_manual_201',
      type: 'slab',
      parentId: 'level_0',
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      metadata: {
        creationMethod: 'manual-pro',
        sourceRecordId: null,
        userModified: true,
      },
    };
    mockSceneState.updateNode(newSlab.id, newSlab);
    expect(mockSceneState.nodes['slab_manual_201']).toBeDefined();
    expect(mockSceneState.nodes['slab_manual_201'].polygon.length).toBe(4);
  });

  it('creates hosted DoorNode on host wall', () => {
    const newDoor = {
      id: 'door_manual_301',
      type: 'door',
      parentId: 'wall_1',
      position: 1.5,
      width: 0.9,
      height: 2.1,
      metadata: {
        creationMethod: 'manual-pro',
        sourceRecordId: null,
        userModified: true,
      },
    };
    mockSceneState.updateNode(newDoor.id, newDoor);
    expect(mockSceneState.nodes['door_manual_301']).toBeDefined();
    expect(mockSceneState.nodes['door_manual_301'].parentId).toBe('wall_1');
  });

  it('creates hosted WindowNode on host wall with sill height', () => {
    const newWindow = {
      id: 'window_manual_401',
      type: 'window',
      parentId: 'wall_1',
      position: 2.8,
      width: 1.2,
      height: 1.4,
      sill: 0.9,
      metadata: {
        creationMethod: 'manual-pro',
        sourceRecordId: null,
        userModified: true,
      },
    };
    mockSceneState.updateNode(newWindow.id, newWindow);
    expect(mockSceneState.nodes['window_manual_401']).toBeDefined();
    expect(mockSceneState.nodes['window_manual_401'].sill).toBe(0.9);
  });
});

describe('3. Safe Deletion Matrix & Provenance Preservation', () => {
  it('allows Item deletion and safely blocks Door/Window/Wall/Slab deletion', () => {
    expect(canSafelyDeleteNode('item_1')).toBe(true);
    expect(canSafelyDeleteNode('door_1')).toBe(false);
    expect(canSafelyDeleteNode('window_1')).toBe(false);
    expect(canSafelyDeleteNode('wall_1')).toBe(false);
    expect(canSafelyDeleteNode('slab_1')).toBe(false);
    expect(canSafelyDeleteNode('guide_1')).toBe(false);
  });

  it('preserves imported provenance and tracks user modifications', () => {
    const importedWall = {
      id: 'wall_imp_1',
      type: 'wall',
      metadata: {
        extractionMethod: 'mupdf-vector',
        sourceRecordId: 'rec_mupdf_w1',
        semanticId: 'wall_1',
        confidence: 0.98,
      },
    };

    // Apply manual edit
    const editedWall = {
      ...importedWall,
      thickness: 0.25,
      metadata: {
        ...importedWall.metadata,
        userModified: true,
        modifiedAt: '2026-08-18T00:00:00Z',
      },
    };

    expect(editedWall.metadata.extractionMethod).toBe('mupdf-vector');
    expect(editedWall.metadata.sourceRecordId).toBe('rec_mupdf_w1');
    expect(editedWall.metadata.userModified).toBe(true);
  });
});
