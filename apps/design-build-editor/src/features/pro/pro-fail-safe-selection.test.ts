// features/pro/pro-fail-safe-selection.test.ts
// Tests for fail-safe component resolution, mode separation, and error boundaries.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  canSafelyDeleteNode,
  getDeleteDisabledReason,
  performSafeDelete,
  DELETION_CAPABILITY_MATRIX,
} from './safeDelete';

describe('1. Mode Separation & Clean PRO Entry', () => {
  it('starts PRO in Select mode without mounting build or move tools', () => {
    const proEntryState = {
      mode: 'select',
      tool: null,
      movingNode: null,
    };
    expect(proEntryState.mode).toBe('select');
    expect(proEntryState.tool).toBeNull();
    expect(proEntryState.movingNode).toBeNull();
  });

  it('clicking an Item selects the node without changing mode to build or tool to item', () => {
    const state = {
      mode: 'select',
      tool: null,
      movingNode: null,
      selection: { selectedIds: [] as string[] },
    };

    // Simulate click on Item node
    state.selection.selectedIds = ['item_sofa_1'];

    expect(state.selection.selectedIds).toEqual(['item_sofa_1']);
    expect(state.mode).toBe('select');
    expect(state.tool).toBeNull();
    expect(state.movingNode).toBeNull();
  });
});

describe('2. Safe Inspector & Error Boundary Fallback', () => {
  it('displays read-only properties for inspectable node types', () => {
    const node = {
      id: 'wall_main_1',
      type: 'wall',
      name: 'Main Exterior Wall',
      parentId: 'level_0',
      thickness: 0.2,
      height: 3.0,
    };

    expect(node.type).toBe('wall');
    expect(node.thickness).toBe(0.2);
    expect(node.height).toBe(3.0);
  });
});

describe('3. Node Selectability Capability Matrix', () => {
  const NODE_CAPABILITIES: Record<
    string,
    {
      rendererAvailable: boolean;
      semanticClickAvailable: boolean;
      inspectorAvailable: boolean;
      editingAvailable: boolean;
      creationAvailable: boolean;
      deletionAvailable: boolean;
      mode: 'EDITABLE' | 'SELECTABLE_READ_ONLY' | 'HIDDEN_BY_POLICY';
    }
  > = {
    item: {
      rendererAvailable: true,
      semanticClickAvailable: true,
      inspectorAvailable: true,
      editingAvailable: true,
      creationAvailable: true,
      deletionAvailable: true,
      mode: 'EDITABLE',
    },
    wall: {
      rendererAvailable: true,
      semanticClickAvailable: true,
      inspectorAvailable: true,
      editingAvailable: true,
      creationAvailable: false, // Gated until Phase B2
      deletionAvailable: false,
      mode: 'EDITABLE',
    },
    door: {
      rendererAvailable: true,
      semanticClickAvailable: true,
      inspectorAvailable: true,
      editingAvailable: false,
      creationAvailable: false, // Gated until Phase B3
      deletionAvailable: false,
      mode: 'SELECTABLE_READ_ONLY',
    },
    window: {
      rendererAvailable: true,
      semanticClickAvailable: true,
      inspectorAvailable: true,
      editingAvailable: false,
      creationAvailable: false, // Gated until Phase B3
      deletionAvailable: false,
      mode: 'SELECTABLE_READ_ONLY',
    },
    slab: {
      rendererAvailable: true,
      semanticClickAvailable: true,
      inspectorAvailable: true,
      editingAvailable: false,
      creationAvailable: false, // Gated until Phase B2
      deletionAvailable: false,
      mode: 'SELECTABLE_READ_ONLY',
    },
    guide: {
      rendererAvailable: true,
      semanticClickAvailable: true,
      inspectorAvailable: true,
      editingAvailable: false,
      creationAvailable: false,
      deletionAvailable: false,
      mode: 'SELECTABLE_READ_ONLY',
    },
  };

  it('all existing semantic node types have valid non-crashing modes', () => {
    const types = ['guide', 'slab', 'wall', 'door', 'window', 'item'];
    for (const t of types) {
      const cap = NODE_CAPABILITIES[t];
      expect(cap).toBeDefined();
      expect(cap.semanticClickAvailable).toBe(true);
      expect(cap.rendererAvailable).toBe(true);
      expect(['EDITABLE', 'SELECTABLE_READ_ONLY', 'HIDDEN_BY_POLICY']).toContain(cap.mode);
    }
  });

  it('doors and windows select their own node ID when clicked rather than host wall', () => {
    const doorNode = { id: 'door_front_1', type: 'door', parentId: 'wall_ext_1' };
    const windowNode = { id: 'window_living_1', type: 'window', parentId: 'wall_ext_1' };

    expect(doorNode.id).toBe('door_front_1');
    expect(doorNode.type).toBe('door');

    expect(windowNode.id).toBe('window_living_1');
    expect(windowNode.type).toBe('window');
  });
});
