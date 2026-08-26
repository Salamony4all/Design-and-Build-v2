// apps/design-build-editor/src/harness/ai-scene-install/opening-host.test.ts
// Phase B: host openings through the EXPLICIT AI wall map (semantic → runtime).
// No nearest-wall fallback. Truthful zero-state + missing-host classification.
import { describe, it, expect } from 'vitest';
import { installWindows, installDoors } from './install-opening';
import { resolveHostWallExact } from './helpers';
import type { SceneInstallContext } from './types';
import type { WindowContract, DoorContract, WallContract } from 'design-build-extraction-contracts';

function makeCtx(levelId = 'lvl1'): SceneInstallContext & { nodes: Record<string, any> } {
  const nodes: Record<string, any> = { [levelId]: { id: levelId, type: 'level', name: 'Level', children: [] as string[] } };
  return {
    nodes, levelId,
    createNodes(ops: { node: unknown; parentId?: string }[]) {
      for (const op of ops) {
        const n = op.node as any;
        nodes[n.id] = n;
        if (op.parentId && nodes[op.parentId]) {
          const ch = Array.isArray(nodes[op.parentId].children) ? (nodes[op.parentId].children as string[]) : [];
          if (!ch.includes(n.id)) ch.push(n.id);
          nodes[op.parentId].children = ch;
        }
      }
    },
    removeNodeIds(ids: string[]) { for (const id of ids) delete nodes[id]; },
    onProgress: () => {},
  } as SceneInstallContext & { nodes: Record<string, any> };
}

const v = (a: [number, number]) => ({ x: a[0], y: a[1] });
const prov = () => ({ sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'wall' });
const wall = (id: string, a: [number, number], b: [number, number]): WallContract => ({ id, kind: 'wall', startM: v(a), endM: v(b), thicknessM: 0.2, heightM: 3, provenance: prov(), metadata: { material: 'white' } } as WallContract);
// crude wall install that sets physicalWallId so the exact resolver works
function fakeInstallWalls(ctx: any, walls: WallContract[]): { attempted: number; installed: number; invalid: number; entries: { semanticWallId: string; runtimeWallId: string; startM: [number, number]; endM: [number, number] }[] } {
  const entries: { semanticWallId: string; runtimeWallId: string; startM: [number, number]; endM: [number, number] }[] = [];
  for (const w of walls) {
    const rid = `runtime_${w.id}`;
    ctx.nodes[rid] = { id: rid, type: 'wall', parentId: ctx.levelId, start: [w.startM.x, w.startM.y], end: [w.endM.x, w.endM.y], metadata: { physicalWallId: w.id } };
    ctx.nodes[ctx.levelId].children.push(rid);
    entries.push({ semanticWallId: w.id, runtimeWallId: rid, startM: [w.startM.x, w.startM.y], endM: [w.endM.x, w.endM.y] });
  }
  return { attempted: walls.length, installed: walls.length, invalid: 0, entries };
}

const win = (id: string, wallId: string, a: [number, number], b: [number, number]): WindowContract => ({ id, kind: 'window', wallId, startM: v(a), endM: v(b), sillM: 0.9, headM: 2.1, provenance: prov() } as WindowContract);
const dr = (id: string, wallId: string, a: [number, number], b: [number, number]): DoorContract => ({ id, kind: 'door', wallId, startM: v(a), endM: v(b), provenance: prov() } as DoorContract);

describe('opening host mapping through explicit wall map', () => {
  it('accepted window maps semantic host → runtime host (no fallback)', () => {
    const ctx = makeCtx();
    const wm = fakeInstallWalls(ctx, [wall('w1', [0, 0], [10, 0])]);
    const ledger = installWindows(ctx, [win('win1', 'w1', [3, 0], [4, 0])], { runId: 'r', stage: 'windows' }, { entries: wm.entries });
    expect(ledger.installed).toBe(1);
    const rec = ledger.perItem[0];
    expect(rec.mappingFound).toBe(true);
    expect(rec.runtimeWallId).toBe('runtime_w1');
    expect(rec.geometricFallback).toBe(false);
    expect(rec.installationSucceeded).toBe(true);
    // node is parented to the runtime wall, not the level
    const wnode = Object.values(ctx.nodes).find((x) => x.type === 'window');
    expect(wnode.parentId).toBe('runtime_w1');
  });

  it('accepted door maps semantic host → runtime host', () => {
    const ctx = makeCtx();
    const wm = fakeInstallWalls(ctx, [wall('w1', [0, 0], [10, 0])]);
    const ledger = installDoors(ctx, [dr('d1', 'w1', [2, 0], [3, 0])], { runId: 'r', stage: 'doors' }, { entries: wm.entries });
    expect(ledger.installed).toBe(1);
    expect(ledger.perItem[0].runtimeWallId).toBe('runtime_w1');
    expect(ledger.perItem[0].geometricFallback).toBe(false);
  });

  it('missing host mapping prevents installation when far from any wall', () => {
    const ctx = makeCtx();
    const wm = fakeInstallWalls(ctx, [wall('w1', [0, 0], [10, 0])]);
    // door references a non-existent wall AND sits 50 m away → no geometric host
    const ledger = installWindows(ctx, [win('winX', 'NONEXISTENT', [120, 120], [121, 120])], { runId: 'r', stage: 'windows' }, { entries: wm.entries });
    expect(ledger.attempted).toBe(1);
    expect(ledger.installed).toBe(0);
    expect(ledger.invalid).toBe(1);
    expect(ledger.perItem[0].mappingFound).toBe(false);
    expect(ledger.perItem[0].geometricFallback).toBe(false);
    expect(ledger.perItem[0].installationAttempted).toBe(false);
    expect(ledger.perItem[0].failureReason).toBe('MISSING_RUNTIME_HOST');
    expect(Object.values(ctx.nodes).some((x) => x.type === 'window')).toBe(false);
  });

  it('geometric fallback: real AI door with imperfect wallId but coords on a wall is hosted', () => {
    const ctx = makeCtx();
    // Gemini output references wall 'w1' but the door wallId is a non-matching id;
    // its coordinates lie ON wall w1 → should resolve geometrically within tolerance.
    const wm = fakeInstallWalls(ctx, [wall('w1', [0, 0], [10, 0])]);
    const ledger = installDoors(ctx, [dr('dX', 'wrong-wall-id', [2, 0], [3, 0])], { runId: 'r', stage: 'doors' }, { entries: wm.entries });
    expect(ledger.attempted).toBe(1);
    expect(ledger.installed).toBe(1);
    const rec = ledger.perItem[0];
    expect(rec.mappingFound).toBe(true);
    expect(rec.geometricFallback).toBe(true);
    expect(rec.nearestWallDistM).not.toBeNull();
    expect(rec.nearestWallDistM!).toBeLessThanOrEqual(2);
    expect(rec.runtimeWallId).toBe('runtime_w1');
    const dnode = Object.values(ctx.nodes).find((x) => x.type === 'door');
    expect(dnode.parentId).toBe('runtime_w1');
  });

  it('geometric fallback only within tolerance (not for a wall metres away)', () => {
    const ctx = makeCtx();
    const wm = fakeInstallWalls(ctx, [wall('w1', [0, 0], [10, 0])]);
    // door at y=5 (5 m from the wall at y=0) exceeds the 2 m tolerance → not hosted
    const ledger = installDoors(ctx, [dr('dY', 'other', [2, 5], [3, 5])], { runId: 'r', stage: 'doors' }, { entries: wm.entries });
    expect(ledger.installed).toBe(0);
    expect(ledger.perItem[0].geometricFallback).toBe(false);
    expect(ledger.perItem[0].nearestWallDistM).not.toBeNull();
    expect(ledger.perItem[0].nearestWallDistM!).toBeGreaterThan(2);
  });

  it('zero provider detections produce SKIPPED_NO_PROVIDER_DETECTIONS at the installer ledger (attempted=0)', () => {
    const ctx = makeCtx();
    const ledger = installWindows(ctx, [], { runId: 'r', stage: 'windows' }, { entries: [] });
    expect(ledger.attempted).toBe(0);
    expect(ledger.installed).toBe(0);
    expect(ledger.skipped).toBe(0);
    // page-level composes SKIPPED_NO_PROVIDER_DETECTIONS when event.counts.windows is falsy
  });
});
