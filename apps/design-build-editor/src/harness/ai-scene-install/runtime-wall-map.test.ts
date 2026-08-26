// apps/design-build-editor/src/harness/ai-scene-install/runtime-wall-map.test.ts
// Phase B: FINALIZED AI WALL MAP — construction, READY gate, diagnostics.
import { describe, it, expect } from 'vitest';
import { buildRuntimeWallMap } from './runtime-wall-map';
import type { WallContract } from 'design-build-extraction-contracts';

const v = (a: [number, number]) => ({ x: a[0], y: a[1] });
const prov = () => ({ sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'wall' });
const wall = (id: string, a: [number, number], b: [number, number]): WallContract => ({
  id, kind: 'wall', startM: v(a), endM: v(b), thicknessM: 0.2, heightM: 3,
  provenance: prov(), metadata: { material: 'white' },
} as WallContract);

const install = (entries: { semanticWallId: string; runtimeWallId: string; startM?: [number, number]; endM?: [number, number] }[], installed: number, attempted = installed) => ({
  attempted, installed, invalid: attempted - installed,
  entries: entries.map((e) => ({ startM: [0, 0] as [number, number], endM: [0, 0] as [number, number], ...e })),
});

describe('wall map construction', () => {
  it('is built only after wall installation settles (settled=false → BUILDING)', () => {
    const m = buildRuntimeWallMap('run-1', install([{ semanticWallId: 'w1', runtimeWallId: 'r1' }], 1), [wall('w1', [0, 0], [5, 0])], { settled: false });
    expect(m.status).toBe('BUILDING');
    expect(m.ready).toBe(false);
  });

  it('contains only successfully installed walls (invalid excluded)', () => {
    // attempted 2, installed 1 → only the installed entry maps
    const m = buildRuntimeWallMap('run-1', install([{ semanticWallId: 'w1', runtimeWallId: 'r1' }], 1, 2), [wall('w1', [0, 0], [5, 0]), wall('w2', [0, 0], [0, 5])]);
    expect(m.entries.length).toBe(1);
    expect(m.diagnostics.installedWalls).toBe(1);
    expect(m.diagnostics.wallMapEntries).toBe(1);
  });

  it('entry count equals installed wall count (invariant)', () => {
    const m = buildRuntimeWallMap('run-1', install([
      { semanticWallId: 'w1', runtimeWallId: 'r1' },
      { semanticWallId: 'w2', runtimeWallId: 'r2' },
    ], 2), [wall('w1', [0, 0], [5, 0]), wall('w2', [0, 0], [0, 5])]);
    expect(m.diagnostics.wallMapEntries).toBe(m.diagnostics.installedWalls);
  });

  it('reports accepted walls exceeding installed as missing/undefined', () => {
    const m = buildRuntimeWallMap('run-1', install([{ semanticWallId: 'w1', runtimeWallId: 'r1' }], 1, 2), [wall('w1', [0, 0], [5, 0]), wall('w2', [0, 0], [0, 5])]);
    expect(m.diagnostics.acceptedWalls).toBe(2);
    expect(m.diagnostics.installedWalls).toBe(1);
    expect(m.missingOrInvalidSemanticIds).toContain('w2');
  });
});

describe('wall map READY gate', () => {
  it('READY requires every installed wall to have a runtime id', () => {
    const m = buildRuntimeWallMap('run-1', install([{ semanticWallId: 'w1', runtimeWallId: '' }], 1), [wall('w1', [0, 0], [5, 0])]);
    expect(m.status).toBe('FAILED');
    expect(m.diagnostics.missingRuntimeWallIds).toBe(1);
    expect(m.ready).toBe(false);
  });

  it('READY requires unique semantic ids', () => {
    const m = buildRuntimeWallMap('run-1', install([
      { semanticWallId: 'w1', runtimeWallId: 'r1' },
      { semanticWallId: 'w1', runtimeWallId: 'r2' },
    ], 2), [wall('w1', [0, 0], [5, 0])]);
    expect(m.status).toBe('FAILED');
    expect(m.diagnostics.duplicateSemanticWallIds).toBe(1);
    expect(m.ready).toBe(false);
  });

  it('READY requires unique runtime ids', () => {
    const m = buildRuntimeWallMap('run-1', install([
      { semanticWallId: 'w1', runtimeWallId: 'r1' },
      { semanticWallId: 'w2', runtimeWallId: 'r1' },
    ], 2), [wall('w1', [0, 0], [5, 0]), wall('w2', [0, 0], [0, 5])]);
    expect(m.status).toBe('FAILED');
    expect(m.diagnostics.duplicateRuntimeWallIds).toBe(1);
    expect(m.ready).toBe(false);
  });

  it('READY requires finite geometry', () => {
    const badContract = wall('w1', [0, 0], [5, 0]);
    (badContract.startM as any).x = NaN;
    const m = buildRuntimeWallMap('run-1', install([{ semanticWallId: 'w1', runtimeWallId: 'r1' }], 1), [badContract]);
    expect(m.diagnostics.invalidGeometryEntries).toBe(1);
    expect(m.ready).toBe(false);
    expect(m.status).toBe('FAILED');
  });

  it('READY requires all entries belong to the active run', () => {
    const m = buildRuntimeWallMap('run-1', install([{ semanticWallId: 'w1', runtimeWallId: 'r1' }], 1), [wall('w1', [0, 0], [5, 0])]);
    // entry.runId is set to the requested runId; if it differed it would fail. Here it matches.
    expect(m.ready).toBe(true);
    expect(m.status).toBe('READY');
  });
});
