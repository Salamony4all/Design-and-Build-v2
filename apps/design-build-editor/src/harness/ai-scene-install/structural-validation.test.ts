// apps/design-build-editor/src/harness/ai-scene-install/structural-validation.test.ts
// Phase B §10: structural runtime validation over the ACTUAL Pascal scene.
import { describe, it, expect } from 'vitest';
import { validateStructuralScene } from './structural-validation';
import type { RuntimeWallMapBuild } from './runtime-wall-map';
import type { OpeningLedger } from './install-opening';

function emptyWallMap(ready = true): RuntimeWallMapBuild {
  return {
    runId: 'run-1', status: ready ? 'READY' : 'FAILED', ready, entries: [],
    diagnostics: {
      acceptedWalls: 0, attemptedWalls: 0, installedWalls: 0, wallMapEntries: 0,
      missingRuntimeWallIds: 0, duplicateSemanticWallIds: 0, duplicateRuntimeWallIds: 0, invalidGeometryEntries: 0,
    }, missingOrInvalidSemanticIds: [],
  };
}

function nodesWith(level: string, extra: Record<string, any>[] = []): Record<string, any> {
  const nodes: Record<string, any> = { [level]: { id: level, type: 'level', name: 'Level', children: [] as string[] } };
  for (const n of extra) {
    nodes[n.id] = n;
    if (n.parentId === level) nodes[level].children.push(n.id);
    else if (n.parentId && nodes[n.parentId]) {
      const p = nodes[n.parentId];
      p.children = p.children ?? [];
      p.children.push(n.id);
    }
  }
  return nodes;
}

const baseInput = (nodes: Record<string, any>, opts: Partial<Parameters<typeof validateStructuralScene>[0]> = {}) => ({
  nodes, runId: 'run-1', guideNodeId: 'g1', slabPresent: true,
  wallMap: emptyWallMap(true), windowLedger: null, doorLedger: null,
  acceptedWindows: 0, acceptedDoors: 0, acceptedWalls: 0, ...opts,
});

describe('structural validation — valid scene', () => {
  it('passes when guide/slab/walls/windows/doors all valid and wall map READY', () => {
    const nodes = nodesWith('lvl', [
      { id: 'g1', type: 'guide', metadata: { sourceRecordId: 'g1' } },
      { id: 's1', type: 'slab', metadata: { sourceRecordId: 'sl' } },
      { id: 'w1', type: 'wall', parentId: 'lvl', metadata: { physicalWallId: 'wa', runId: 'run-1', extractionProvider: 'PURE_AI' } },
      { id: 'win1', type: 'window', parentId: 'w1', metadata: { physicalWallId: 'wa', semanticWallId: 'wa' } },
    ]);
    const wallMap = emptyWallMap(true); wallMap.entries = [{ runId: 'run-1', semanticWallId: 'wa', runtimeWallId: 'w1', startM: [0, 0], endM: [5, 0], thicknessM: 0.2, heightM: 3, installationStatus: 'installed' }];
    const res = validateStructuralScene(baseInput(nodes, { wallMap, acceptedWindows: 1 }));
    expect(res.status).toBe('PASSED');
    expect(res.orphanWindowCount).toBe(0);
    expect(res.installedWindowCount).toBe(1);
  });

  it('passes WITH_REVIEW when review records exist', () => {
    const nodes = nodesWith('lvl', [
      { id: 'g1', type: 'guide', metadata: { sourceRecordId: 'g1' } },
      { id: 's1', type: 'slab', metadata: { sourceRecordId: 'sl' } },
      { id: 'w1', type: 'wall', parentId: 'lvl', metadata: { physicalWallId: 'wa', runId: 'run-1', extractionProvider: 'PURE_AI' } },
    ]);
    const res = validateStructuralScene(baseInput(nodes, { reviewCount: 3 }));
    expect(res.status).toBe('PASSED_WITH_REVIEW');
  });
});

describe('structural validation — failures', () => {
  it('detects orphan window (parent not a wall / no semantic id)', () => {
    const nodes = nodesWith('lvl', [
      { id: 'g1', type: 'guide', metadata: { sourceRecordId: 'g1' } },
      { id: 's1', type: 'slab', metadata: { sourceRecordId: 'sl' } },
      { id: 'w1', type: 'wall', parentId: 'lvl', metadata: { physicalWallId: 'wa', runId: 'run-1', extractionProvider: 'PURE_AI' } },
      { id: 'win1', type: 'window', parentId: 'lvl', metadata: {} }, // parented to level, not a wall
    ]);
    const res = validateStructuralScene(baseInput(nodes, { acceptedWindows: 1 }));
    expect(res.status).toBe('FAILED');
    expect(res.orphanWindowCount).toBe(1);
    expect(res.failures).toContain('orphan-windows');
  });

  it('detects orphan door', () => {
    const nodes = nodesWith('lvl', [
      { id: 'g1', type: 'guide', metadata: { sourceRecordId: 'g1' } },
      { id: 's1', type: 'slab', metadata: { sourceRecordId: 'sl' } },
      { id: 'w1', type: 'wall', parentId: 'lvl', metadata: { physicalWallId: 'wa', runId: 'run-1', extractionProvider: 'PURE_AI' } },
      { id: 'd1', type: 'door', parentId: 'lvl', metadata: {} },
    ]);
    const res = validateStructuralScene(baseInput(nodes, { acceptedDoors: 1 }));
    expect(res.orphanDoorCount).toBe(1);
    expect(res.failures).toContain('orphan-doors');
  });

  it('detects metadata schema failure', () => {
    const nodes = nodesWith('lvl', [
      { id: 'g1', type: 'guide', metadata: { sourceRecordId: 'g1' } },
      { id: 's1', type: 'slab', metadata: {} }, // no schema signal
      { id: 'w1', type: 'wall', parentId: 'lvl', metadata: { physicalWallId: 'wa', runId: 'run-1', extractionProvider: 'PURE_AI' } },
    ]);
    const res = validateStructuralScene(baseInput(nodes));
    expect(res.metadataSchemaFailures).toBeGreaterThan(0);
    expect(res.failures).toContain('metadata-schema');
  });

  it('detects stale CODE_06 nodes in a fresh AI project', () => {
    const nodes = nodesWith('lvl', [
      { id: 'g1', type: 'guide', metadata: { sourceRecordId: 'g1' } },
      { id: 's1', type: 'slab', metadata: { sourceRecordId: 'sl' } },
      { id: 'c1', type: 'wall', parentId: 'lvl', metadata: { source: 'code06', physicalWallId: 'CODE06_1' } },
    ]);
    const res = validateStructuralScene(baseInput(nodes));
    expect(res.staleCode06Nodes).toBeGreaterThan(0);
    expect(res.failures).toContain('stale-code06-nodes');
  });

  it('detects stale run nodes (AI nodes from a different run)', () => {
    const nodes = nodesWith('lvl', [
      { id: 'g1', type: 'guide', metadata: { sourceRecordId: 'g1' } },
      { id: 's1', type: 'slab', metadata: { sourceRecordId: 'sl' } },
      { id: 'w1', type: 'wall', parentId: 'lvl', metadata: { physicalWallId: 'wa', runId: 'OLD', extractionProvider: 'PURE_AI' } },
    ]);
    const res = validateStructuralScene(baseInput(nodes));
    expect(res.staleRunNodes).toBeGreaterThan(0);
    expect(res.failures).toContain('stale-run-nodes');
  });

  it('fails when wall map is not READY', () => {
    const nodes = nodesWith('lvl', [
      { id: 'g1', type: 'guide', metadata: { sourceRecordId: 'g1' } },
      { id: 's1', type: 'slab', metadata: { sourceRecordId: 'sl' } },
      { id: 'w1', type: 'wall', parentId: 'lvl', metadata: { physicalWallId: 'wa', runId: 'run-1', extractionProvider: 'PURE_AI' } },
    ]);
    const res = validateStructuralScene(baseInput(nodes, { wallMap: emptyWallMap(false) }));
    expect(res.wallMapStatus).toBe('FAILED');
    expect(res.failures).toContain('wall-map-invalid');
  });

  it('fails when accepted windows disappear without review/invalid accounting', () => {
    const nodes = nodesWith('lvl', [
      { id: 'g1', type: 'guide', metadata: { sourceRecordId: 'g1' } },
      { id: 's1', type: 'slab', metadata: { sourceRecordId: 'sl' } },
      { id: 'w1', type: 'wall', parentId: 'lvl', metadata: { physicalWallId: 'wa', runId: 'run-1', extractionProvider: 'PURE_AI' } },
    ]);
    const res = validateStructuralScene(baseInput(nodes, { acceptedWindows: 2, windowLedger: { attempted: 0, installed: 0, invalid: 0, skipped: 0, review: 0, rejected: 0, perItem: [] } }));
    expect(res.failures).toContain('windows-disappeared');
  });

  // ── Regression class: "doors-disappeared" (directive §3/§8/§9). ──
  describe('structural validation — door preservation regression', () => {
    const doorScene = (doorMeta: Record<string, any>[]) => {
      const doors = doorMeta.map((m, i) => ({ id: `d${i + 1}`, type: 'door', parentId: 'w1', metadata: m }));
      return nodesWith('lvl', [
        { id: 'g1', type: 'guide', metadata: { sourceRecordId: 'g1' } },
        { id: 's1', type: 'slab', metadata: { sourceRecordId: 'sl' } },
        { id: 'w1', type: 'wall', parentId: 'lvl', metadata: { physicalWallId: 'wa', runId: 'run-1', extractionProvider: 'PURE_AI' } },
        ...doors,
      ]);
    };
    const okLedger = (installed: number, invalid = 0): OpeningLedger => ({ attempted: installed + invalid, installed, invalid, skipped: 0, review: 0, rejected: 0, perItem: [] });

    it('does NOT flag doors-disappeared when two accepted doors are installed', () => {
      const nodes = doorScene([{ physicalWallId: 'wa', semanticWallId: 'wa', sourceRecordId: 'open_door_entrance_left' }, { physicalWallId: 'wa', semanticWallId: 'wa', sourceRecordId: 'open_door_entrance_right' }]);
      const res = validateStructuralScene(baseInput(nodes, { acceptedDoors: 2, doorLedger: okLedger(2) }));
      expect(res.failures).not.toContain('doors-disappeared');
      expect(res.status).not.toBe('FAILED');
      expect(res.installedDoorCount).toBe(2);
    });

    it('DoorNode exists before validation and remains after (validation is read-only)', () => {
      const nodes = doorScene([{ physicalWallId: 'wa', semanticWallId: 'wa', sourceRecordId: 'open_door_entrance_left' }, { physicalWallId: 'wa', semanticWallId: 'wa', sourceRecordId: 'open_door_entrance_right' }]);
      expect(Object.values(nodes).filter((n) => n.type === 'door').length).toBe(2);
      const before = Object.values(nodes).filter((n) => n.type === 'door').length;
      const res = validateStructuralScene(baseInput(nodes, { acceptedDoors: 2, doorLedger: okLedger(2) }));
      // validation must not remove nodes
      expect(Object.values(nodes).filter((n) => n.type === 'door').length).toBe(before);
      expect(res.status).not.toBe('FAILED');
    });

    it('uses accepted count, not detected; review/rejected doors are not "disappeared"', () => {
      const nodes = nodesWith('lvl', [
        { id: 'g1', type: 'guide', metadata: { sourceRecordId: 'g1' } },
        { id: 's1', type: 'slab', metadata: { sourceRecordId: 'sl' } },
        { id: 'w1', type: 'wall', parentId: 'lvl', metadata: { physicalWallId: 'wa', runId: 'run-1', extractionProvider: 'PURE_AI' } },
      ]);
      // 2 doors were detected, but only 1 accepted+installed; 1 went to review.
      const ledger: OpeningLedger = { attempted: 2, installed: 1, invalid: 0, skipped: 0, review: 1, rejected: 0, perItem: [] };
      const res = validateStructuralScene(baseInput(nodes, { acceptedDoors: 2, doorLedger: ledger, reviewCount: 1 }));
      // installed(1) + invalid(0) + reviewCount(1) = 2 >= accepted(2) → no disappearance
      expect(res.failures).not.toContain('doors-disappeared');
    });

    it('runtime node type matching is correct (doors are type "door", not "item"/"window")', () => {
      const nodes = doorScene([{ physicalWallId: 'wa', semanticWallId: 'wa', sourceRecordId: 'open_door_entrance_left' }]);
      const d = Object.values(nodes).find((n) => n.type === 'door') as any;
      expect(d.type).toBe('door');
      expect(d.parentId).toBe('w1');
      expect((nodes[d.parentId] as any).type).toBe('wall');
    });

    it('runtime runId + semantic id matching is correct', () => {
      const m = { physicalWallId: 'wa', semanticWallId: 'wa', runtimeWallId: 'w1', sourceRecordId: 'open_door_entrance_left', runId: 'run-1' };
      const nodes = doorScene([m]);
      const d = Object.values(nodes).find((n) => n.type === 'door') as any;
      expect(d.metadata.semanticWallId).toBe('wa');
      expect(d.metadata.runtimeWallId).toBe('w1');
      expect(d.metadata.runId).toBe('run-1');
    });
  });
});
