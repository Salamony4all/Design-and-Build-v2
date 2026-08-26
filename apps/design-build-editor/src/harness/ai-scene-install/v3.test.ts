// apps/design-build-editor/src/harness/ai-scene-install/v3.test.ts
// Pure AI Progressive V3 — app-level installer tests (spec §5, §6, §7, §10, §11).
// Exercised in a node env against the real Pascal @pascal-app/core schema.
import { describe, it, expect } from 'vitest';
import { installWalls, installWindows, installDoors, installFurniture, clearRunStage, beginRunCleanup } from './index';
import { resolveHostWall } from './helpers';
import type { SceneInstallContext } from './types';
import type { WallContract, WindowContract, DoorContract, Provenance } from 'design-build-extraction-contracts';

function makeCtx(levelId = 'lvl1', runId = 'run-1'): SceneInstallContext & { nodes: Record<string, any> } {
  const nodes: Record<string, any> = {
    [levelId]: { id: levelId, type: 'level', name: 'Level', children: [] as string[] },
  };
  return {
    nodes,
    levelId,
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
    removeNodeIds(ids: string[]) {
      for (const id of ids) delete nodes[id];
    },
    onProgress: () => {},
  } as SceneInstallContext & { nodes: Record<string, any> };
}

const v = (a: [number, number]) => ({ x: a[0], y: a[1] });
const prov = (type: string): Provenance => ({ sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: type });
const wall = (id: string, a: [number, number], b: [number, number]): WallContract => ({
  id, kind: 'wall', startM: v(a), endM: v(b), thicknessM: 0.2, heightM: 3,
  provenance: prov('wall'), metadata: { material: 'white' },
} as WallContract);

// ───────────────────────── 5. real wall installer ─────────────────────────
describe('§5 installWalls — real WallNode creation', () => {
  it('creates WallNodes with correct geometry and provenance', () => {
    const ctx = makeCtx();
    const walls = [wall('w1', [0, 0], [5, 0]), wall('w2', [5, 0], [5, 4])];
    const res = installWalls(ctx, walls, { runId: 'run-1', stage: 'walls' });
    expect(res.installed).toBe(2);
    expect(Object.values(ctx.nodes).filter((x) => x.type === 'wall').length).toBe(2);

    const w1 = Object.values(ctx.nodes).find((x) => x.metadata?.physicalWallId === 'w1');
    expect(w1).toBeTruthy();
    expect(w1.start).toEqual([0, 0]);
    expect(w1.end).toEqual([5, 0]);
    expect(w1.thickness).toBeCloseTo(0.2);
    expect(w1.height).toBeCloseTo(3);
    // parented under level
    expect(ctx.nodes[ctx.levelId].children).toContain(w1.id);
    // provenance §7
    expect(w1.metadata.extractionProvider).toBe('PURE_AI');
    expect(w1.metadata.automaticExtraction).toBe(true);
    expect(w1.metadata.runId).toBe('run-1');
    expect(w1.metadata.stageId).toBe('walls');
    expect(w1.metadata.sourceRecordId).toBe('w1');
  });

  it('preserves physicalWallId so openings resolve', () => {
    const ctx = makeCtx();
    installWalls(ctx, [wall('wA', [0, 0], [10, 0])], { runId: 'r', stage: 'walls' });
    const liveId = resolveHostWall(ctx.nodes, 'wA');
    expect(liveId).not.toBeNull();
    expect(ctx.nodes[liveId!].metadata.physicalWallId).toBe('wA');
  });

  it('does not create duplicate walls when a re-run clears the previous stage first', () => {
    const ctx = makeCtx();
    installWalls(ctx, [wall('w1', [0, 0], [5, 0])], { runId: 'r', stage: 'walls' });
    // Documented lifecycle: clear the prior stage before re-installing.
    clearRunStage(ctx as any, 'r', 'walls');
    installWalls(ctx, [wall('w1', [0, 0], [5, 0])], { runId: 'r', stage: 'walls' });
    const withId = Object.values(ctx.nodes).filter((x) => x.metadata?.physicalWallId === 'w1');
    expect(withId.length).toBe(1);
  });
});

// ───────────────────────── opening host resolution ─────────────────────────
describe('§5 opening host resolution through physicalWallId', () => {
  const win = (id: string, wallId: string, a: [number, number], b: [number, number]): WindowContract => ({
    id, kind: 'window', wallId, startM: v(a), endM: v(b), sillM: 0.9, headM: 2.1,
    provenance: prov('window'),
  });
  const dr = (id: string, wallId: string, a: [number, number], b: [number, number]): DoorContract => ({
    id, kind: 'door', wallId, startM: v(a), endM: v(b),
    provenance: prov('door'),
  });

  it('windows resolve their host wall via physicalWallId (no silent fallback)', () => {
    const ctx = makeCtx();
    installWalls(ctx, [wall('w1', [0, 0], [10, 0])], { runId: 'r', stage: 'walls' });
    const res = installWindows(ctx, [win('win1', 'w1', [3, 0], [4, 0])], { runId: 'r', stage: 'windows' });
    expect(res.installed).toBe(1);
    const wnode = Object.values(ctx.nodes).find((x) => x.type === 'window');
    expect(wnode).toBeTruthy();
    // parent is the resolved live wall, not the level
    const liveWall = resolveHostWall(ctx.nodes, 'w1')!;
    expect(wnode.parentId).toBe(liveWall);
    expect(ctx.nodes[liveWall].children).toContain(wnode.id);
    expect(wnode.metadata.physicalWallId).toBe('w1');
    expect(wnode.metadata.extractionProvider).toBe('PURE_AI');
  });

  it('doors resolve their host wall via physicalWallId', () => {
    const ctx = makeCtx();
    installWalls(ctx, [wall('w1', [0, 0], [10, 0])], { runId: 'r', stage: 'walls' });
    const res = installDoors(ctx, [dr('d1', 'w1', [2, 0], [3, 0])], { runId: 'r', stage: 'doors' });
    expect(res.installed).toBe(1);
    const dnode = Object.values(ctx.nodes).find((x) => x.type === 'door');
    expect(dnode).toBeTruthy();
    expect(dnode.parentId).toBe(resolveHostWall(ctx.nodes, 'w1'));
    expect(dnode.metadata.physicalWallId).toBe('w1');
  });

  it('opening with unknown wallId installs nothing when far from any wall (no host within tolerance)', () => {
    const ctx = makeCtx();
    installWalls(ctx, [wall('w1', [0, 0], [10, 0])], { runId: 'r', stage: 'walls' });
    // coordinates 50 m from the wall exceed the 2 m geometric tolerance → no host
    const n = installWindows(ctx, [win('winX', 'NONEXISTENT', [1, 50], [2, 50])], { runId: 'r', stage: 'windows' });
    expect(n.installed).toBe(0);
    expect(Object.values(ctx.nodes).some((x) => x.type === 'window')).toBe(false);
  });
});

// ───────────────────────── 7. run lifecycle / cleanup ─────────────────────────
describe('§7 run lifecycle cleanup', () => {
  it('clearRunStage removes only AI nodes for the requested run+stage', () => {
    const ctx = makeCtx();
    installWalls(ctx, [wall('w1', [0, 0], [5, 0]), wall('w2', [5, 0], [5, 4])], { runId: 'run-1', stage: 'walls' });
    // fabricate a furniture node in same run (different stage)
    const fid = 'item_abc';
    ctx.nodes[fid] = { id: fid, type: 'item', parentId: ctx.levelId, metadata: { extractionProvider: 'PURE_AI', runId: 'run-1', stageId: 'furniture', sourceRecordId: 'se-1' } };
    ctx.nodes[ctx.levelId].children.push(fid);
    const beforeWalls = Object.values(ctx.nodes).filter((x) => x.type === 'wall').length;
    expect(beforeWalls).toBe(2);

    clearRunStage(ctx as any, 'run-1', 'walls'); // returns void
    expect(Object.values(ctx.nodes).filter((x) => x.type === 'wall').length).toBe(0);
    // furniture node (different stageId) untouched
    expect(ctx.nodes[fid]).toBeTruthy();
  });

  it('beginRunCleanup removes only AI-created nodes from the previous run', () => {
    const ctx = makeCtx();
    // previous run walls
    installWalls(ctx, [wall('w1', [0, 0], [5, 0])], { runId: 'old-run', stage: 'walls' });
    // a MuPDF-created node (must survive)
    const mupdfId = 'mupdf_wall_x';
    ctx.nodes[mupdfId] = { id: mupdfId, type: 'wall', parentId: ctx.levelId, start: [0, 0], end: [1, 1], metadata: { source: 'mupdf' } };
    ctx.nodes[ctx.levelId].children.push(mupdfId);

    beginRunCleanup(ctx as any, 'replace-previous-ai-run', 'old-run'); // returns void
    // MuPDF wall preserved
    expect(ctx.nodes[mupdfId]).toBeTruthy();
    expect(ctx.nodes[mupdfId].metadata.source).toBe('mupdf');
    // no AI node with old-run remains
    expect(Object.values(ctx.nodes).some((x) => x.metadata?.extractionProvider === 'PURE_AI' && x.metadata?.runId === 'old-run')).toBe(false);
  });
});

// ───────────────────────── 10. review acceptance (shared installer) ─────────────────────────
describe('§10 review acceptance installs exactly one node', () => {
  it('installFurniture through shared installer creates one AI item node with provenance', () => {
    const ctx = makeCtx();
    const item = {
      type: 'sofa', // resolves via catalogue alias → reception-sofa
      pos: [2, 2], width: 2, depth: 0.9, height: 0.8, rotation: 0, confidence: 0.95,
      frameId: 'frame_1', sourceEntityId: 'se-accept-1',
    };
    installFurniture(ctx as any, [item as any], { progressive: true, metaExtras: { source: 'ai-extract', extractionMode: 'progressive-v3', runId: 'run-1', stage: 'furniture', sourceEntityId: 'se-accept-1', frameId: 'frame_1' } });
    const created = Object.values(ctx.nodes).filter((x) => x.type === 'item');
    expect(created.length).toBe(1);
    expect(created[0].metadata.extractionProvider).toBe('PURE_AI');
    expect(created[0].metadata.automaticExtraction).toBe(true);
    expect(created[0].metadata.runId).toBe('run-1');
    expect(created[0].metadata.stageId).toBe('furniture');
    // Installer records sourceRecordId from the deterministic instance identity
    // (provider id when present, else family + normalized geometry) — NOT the bare
    // familyId, so multiple same-family instances remain distinct (Step 7).
    expect(created[0].metadata.sourceRecordId).toBe('fur_sofa_2000_2000_2000_900_800_0');
    // resolved catalogue slug is available (deployed asset name)
    expect(typeof created[0].name).toBe('string');
    expect((created[0].name as string).length).toBeGreaterThan(0);
  });
});

// ───────────────────────── §9 Pure MuPDF isolation ─────────────────────────
// AI beginRunCleanup MUST NOT remove MuPDF nodes; only PURE_AI nodes are touched.
describe('§9 Pure MuPDF node isolation under AI cleanup', () => {
  it('beginRunCleanup(replace-previous-ai-run) preserves mupdf + manual nodes, removes only PURE_AI', () => {
    const ctx = makeCtx();
    const mupdfNode = { id: 'mupdf-1', type: 'wall', metadata: { source: 'mupdf', runId: 'mupdf-run', stageId: 'walls' } };
    const manualNode = { id: 'manual-1', type: 'slab', metadata: { source: 'user', runId: 'manual' } };
    const aiNodeOld = { id: 'ai-old', type: 'wall', metadata: { extractionProvider: 'PURE_AI', runId: 'run-A', stageId: 'walls' } };
    const aiNodeOther = { id: 'ai-other', type: 'wall', metadata: { extractionProvider: 'PURE_AI', runId: 'run-B', stageId: 'walls' } };
    ctx.nodes[mupdfNode.id] = mupdfNode as any;
    ctx.nodes[manualNode.id] = manualNode as any;
    ctx.nodes[aiNodeOld.id] = aiNodeOld as any;
    ctx.nodes[aiNodeOther.id] = aiNodeOther as any;

    // AI run B starts; replace-previous-ai-run targets run-A specifically.
    beginRunCleanup(ctx as any, 'replace-previous-ai-run', 'run-A');

    expect(ctx.nodes['mupdf-1']).toBeDefined();        // MuPDF preserved
    expect(ctx.nodes['manual-1']).toBeDefined();        // manual preserved
    expect(ctx.nodes['ai-old']).toBeUndefined();        // old AI run removed
    expect(ctx.nodes['ai-other']).toBeDefined();        // different AI run untouched
  });

  it('beginRunCleanup with no prevRunId removes ALL PURE_AI but never mupdf', () => {
    const ctx = makeCtx();
    ctx.nodes['m1'] = { id: 'm1', type: 'wall', metadata: { source: 'mupdf' } } as any;
    ctx.nodes['a1'] = { id: 'a1', type: 'wall', metadata: { extractionProvider: 'PURE_AI', runId: 'x' } } as any;
    beginRunCleanup(ctx as any, 'replace-previous-ai-run');
    expect(ctx.nodes['m1']).toBeDefined();
    expect(ctx.nodes['a1']).toBeUndefined();
  });

  it('keep-previous-ai-run policy removes nothing (no AI takeover during MuPDF run)', () => {
    const ctx = makeCtx();
    ctx.nodes['m1'] = { id: 'm1', type: 'wall', metadata: { source: 'mupdf', runId: 'mupdf-run' } } as any;
    ctx.nodes['a1'] = { id: 'a1', type: 'wall', metadata: { extractionProvider: 'PURE_AI', runId: 'run-A' } } as any;
    beginRunCleanup(ctx as any, 'keep-previous-ai-run', 'run-A');
    expect(ctx.nodes['m1']).toBeDefined();
    expect(ctx.nodes['a1']).toBeDefined();
  });
});

// ───────────────────────── A2/A3 live-store regression ─────────────────────────
// The Viewer renders from the SAME store the builder writes to. The blank-Viewer
// regression was two-fold: (1) the Viewer was never mounted in AI mode, and
// (2) ctx.nodes had to stay a LIVE reference, because a real store (Zustand) does
// an IMMUTABLE swap of its `nodes` object on every createNodes — so a captured
// snapshot would go stale and addChild() would write into a dead object. This pins
// that the builder uses a getter so writes always land on the current store object.
describe('§A2/A3 builder writes to the LIVE store object (survives immutable swap)', () => {
  it('LIVE getter ctx keeps populating children after the store swaps its nodes object', () => {
    // External store that swaps its `nodes` reference on every commit (Zustand-like).
    const store: { nodes: Record<string, any> } = {
      nodes: { lvlLive: { id: 'lvlLive', type: 'level', name: 'Level', children: [] as string[] } },
    };
    const ctx = {
      get nodes() { return store.nodes; }, // LIVE getter — mirrors the page.tsx fix
      levelId: 'lvlLive',
      createNodes(ops: { node: unknown; parentId?: string }[]) {
        // Immutable swap: build a NEW nodes object, then replace the reference.
        const next = { ...store.nodes };
        for (const op of ops) {
          const n = op.node as any;
          next[n.id] = n;
          if (op.parentId && next[op.parentId]) {
            const ch = ((next[op.parentId].children as string[]) ?? []).slice();
            if (!ch.includes(n.id)) ch.push(n.id);
            next[op.parentId].children = ch;
          }
        }
        store.nodes = next; // REFERENCE SWAP
      },
      removeNodeIds(ids: string[]) { const next = { ...store.nodes }; for (const id of ids) delete next[id]; store.nodes = next; },
      onProgress: () => {},
    } as unknown as SceneInstallContext & { nodes: Record<string, any> };

    installWalls(ctx, [wall('w1', [0, 0], [5, 0])], { runId: 'r', stage: 'walls' });
    // After createNodes swapped store.nodes, addChild(...) inside installWalls wrote
    // to the SAME live getter — so the (new) level.children must contain the wall.
    const wallId = Object.values(store.nodes).find((x: any) => x.type === 'wall').id;
    expect(store.nodes['lvlLive'].children).toContain(wallId);
    expect(store.nodes[wallId].parentId).toBe('lvlLive');
  });
});
