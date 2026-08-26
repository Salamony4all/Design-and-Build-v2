// apps/design-build-editor/src/harness/v3-pipeline.test.ts
// Pure AI Progressive V3 — pipeline orchestration tests (spec §3, §6, §7, §9, §10, §11).
// Drives the real createProgressiveInstaller + applyProgressiveEvent against a mock
// SceneInstallContext (passthrough @pascal-app/core stub). Exercises stage ordering,
// duplicate-event guards, stale-run rejection, cancellation, lifecycle cleanup,
// furniture policy arithmetic, and review-acceptance.
import { describe, it, expect } from 'vitest';
import { createProgressiveInstaller, applyProgressiveEvent, type ProgressiveInstaller } from './pascal-progressive-builder';
import type { SceneInstallContext } from './ai-scene-install/types';
import { validateEvent } from 'design-build-extraction-ai';
import { sanitizeFurnitureV3 } from 'design-build-extraction-ai';

function makeCtx(levelId = 'lvl1'): SceneInstallContext & { nodes: Record<string, any> } {
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
    removeNodeIds(ids: string[]) { for (const id of ids) delete nodes[id]; },
    onProgress: () => {},
  } as SceneInstallContext & { nodes: Record<string, any> };
}

const wall = (id: string, a: [number, number], b: [number, number]) => ({ id, kind: 'wall', startM: { x: a[0], y: a[1] }, endM: { x: b[0], y: b[1] }, thicknessM: 0.2, heightM: 3, provenance: { source: 'ai', stage: 'walls' }, metadata: { material: 'white' } });
const win = (id: string, wallId: string, a: [number, number], b: [number, number]) => ({ id, kind: 'window', wallId, startM: { x: a[0], y: a[1] }, endM: { x: b[0], y: b[1] }, sillM: 0.9, headM: 2.1, provenance: { source: 'ai', stage: 'windows' } });
const dr = (id: string, wallId: string, a: [number, number], b: [number, number]) => ({ id, kind: 'door', wallId, startM: { x: a[0], y: a[1] }, endM: { x: b[0], y: b[1] }, provenance: { source: 'ai', stage: 'doors' } });
const sofa = (id: string, pos: [number, number], frameId?: string, srcEntity?: string) => ({ type: 'sofa', pos, width: 2, depth: 0.9, height: 0.8, rotation: 0, confidence: 0.95, frameId, sourceEntityId: srcEntity ?? `se-${id}` });
// review case: rotation omitted (undefined) → UNCERTAIN_ROTATION → review
const sofaNoRot = (id: string, pos: [number, number], frameId?: string, srcEntity?: string) => ({ type: 'sofa', pos, width: 2, depth: 0.9, height: 0.8, confidence: 0.95, frameId, sourceEntityId: srcEntity ?? `se-${id}` });

function ev(partial: Record<string, unknown>): any {
  return validateEvent({ runId: 'run-1', sequence: 1, timestamp: new Date().toISOString(), ...partial });
}

// ───────────────────────── §3 stage order ─────────────────────────
describe('§3 stage-order: dependent stages defer safely', () => {
  it('windows before walls are not installed (host wall missing)', () => {
    const ctx = makeCtx();
    const inst: ProgressiveInstaller = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    applyProgressiveEvent(inst, ev({ type: 'windows.ready', stage: 'windows', message: 'w', payload: [win('win1', 'wX', [1, 0], [2, 0])] }), { fileName: 'u', frameId: 'f1' });
    expect(Object.values(ctx.nodes).some((x) => x.type === 'window')).toBe(false);
  });
  it('doors before walls are not installed', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    applyProgressiveEvent(inst, ev({ type: 'doors.ready', stage: 'doors', message: 'd', payload: [dr('d1', 'wX', [1, 0], [2, 0])] }), { fileName: 'u', frameId: 'f1' });
    expect(Object.values(ctx.nodes).some((x) => x.type === 'door')).toBe(false);
  });
  it('detection-only furniture never installs', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    applyProgressiveEvent(inst, ev({ type: 'furniture.detected', detected: 3, payload: [sofa('s1', [1, 1]), sofa('s2', [2, 2]), sofa('s3', [3, 3])] }), { fileName: 'u', frameId: 'f1' });
    expect(Object.values(ctx.nodes).some((x) => x.type === 'item')).toBe(false);
  });
});

// ───────────────────────── duplicate events ─────────────────────────
describe('duplicate events never create duplicate nodes', () => {
  it('duplicate walls.ready installs walls once after clearRunStage', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    applyProgressiveEvent(inst, ev({ type: 'walls.ready', stage: 'walls', message: 'w', payload: [wall('w1', [0, 0], [5, 0])] }), { fileName: 'u', frameId: 'f1' });
    inst.clearRunStage('run-1', 'walls');
    applyProgressiveEvent(inst, ev({ type: 'walls.ready', stage: 'walls', message: 'w', payload: [wall('w1', [0, 0], [5, 0])] }), { fileName: 'u', frameId: 'f1' });
    const withId = Object.values(ctx.nodes).filter((x) => x.metadata?.physicalWallId === 'w1');
    expect(withId.length).toBe(1);
  });
  it('duplicate windows.ready installs once after clearRunStage', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    applyProgressiveEvent(inst, ev({ type: 'walls.ready', stage: 'walls', message: 'w', payload: [wall('w1', [0, 0], [10, 0])] }), { fileName: 'u', frameId: 'f1' });
    applyProgressiveEvent(inst, ev({ type: 'windows.ready', stage: 'windows', message: 'w', payload: [win('win1', 'w1', [3, 0], [4, 0])] }), { fileName: 'u', frameId: 'f1' });
    inst.clearRunStage('run-1', 'windows');
    applyProgressiveEvent(inst, ev({ type: 'windows.ready', stage: 'windows', message: 'w', payload: [win('win1', 'w1', [3, 0], [4, 0])] }), { fileName: 'u', frameId: 'f1' });
    expect(Object.values(ctx.nodes).filter((x) => x.type === 'window').length).toBe(1);
  });
  it('duplicate doors.ready installs once after clearRunStage', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    applyProgressiveEvent(inst, ev({ type: 'walls.ready', stage: 'walls', message: 'w', payload: [wall('w1', [0, 0], [10, 0])] }), { fileName: 'u', frameId: 'f1' });
    applyProgressiveEvent(inst, ev({ type: 'doors.ready', stage: 'doors', message: 'd', payload: [dr('d1', 'w1', [2, 0], [3, 0])] }), { fileName: 'u', frameId: 'f1' });
    inst.clearRunStage('run-1', 'doors');
    applyProgressiveEvent(inst, ev({ type: 'doors.ready', stage: 'doors', message: 'd', payload: [dr('d1', 'w1', [2, 0], [3, 0])] }), { fileName: 'u', frameId: 'f1' });
    expect(Object.values(ctx.nodes).filter((x) => x.type === 'door').length).toBe(1);
  });
});

// ───────────────────────── status-only events never mutate geometry ─────────────────────────
describe('status-only / repeated events never mutate geometry', () => {
  it('repeated stage.completed (no furniture) does not create nodes', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    applyProgressiveEvent(inst, ev({ type: 'stage.completed', stage: 'furniture', message: 'c' }), { fileName: 'u', frameId: 'f1' });
    applyProgressiveEvent(inst, ev({ type: 'stage.completed', stage: 'furniture', message: 'c' }), { fileName: 'u', frameId: 'f1' });
    expect(Object.values(ctx.nodes).some((x) => x.type === 'item')).toBe(false);
  });
  it('repeated run.completed does not mutate geometry', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    applyProgressiveEvent(inst, ev({ type: 'run.completed', message: 'done' }), { fileName: 'u', frameId: 'f1' });
    applyProgressiveEvent(inst, ev({ type: 'run.completed', message: 'done' }), { fileName: 'u', frameId: 'f1' });
    expect(Object.values(ctx.nodes).filter((x) => x.type === 'item').length).toBe(0);
  });
  it('run.failed after a stable completed stage leaves the scene intact', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    applyProgressiveEvent(inst, ev({ type: 'walls.ready', stage: 'walls', message: 'w', payload: [wall('w1', [0, 0], [5, 0])] }), { fileName: 'u', frameId: 'f1' });
    applyProgressiveEvent(inst, ev({ type: 'run.failed', message: 'boom', code: 'X' }), { fileName: 'u', frameId: 'f1' });
    expect(Object.values(ctx.nodes).filter((x) => x.type === 'wall').length).toBe(1);
  });
  it('malformed events are rejected by validateEvent and never reach the installer', () => {
    expect(validateEvent({ type: 'walls.ready' } as any)).toBeNull();
    expect(validateEvent({ type: 'bogus', runId: 'r', sequence: 1, timestamp: 't' } as any)).toBeNull();
    expect(validateEvent(null)).toBeNull();
  });
});

// ───────────────────────── §7 lifecycle / stale-run / cancellation ─────────────────────────
describe('§7 lifecycle: stale-run and cancellation', () => {
  it('starting run B aborts run A; run A events afterward are ignored', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-A' });
    applyProgressiveEvent(inst, ev({ type: 'walls.ready', stage: 'walls', message: 'w', payload: [wall('wA', [0, 0], [5, 0])] }), { fileName: 'u', frameId: 'f1' });
    // Begin run B on the SAME installer (clears run A's nodes + updates activeRunId)
    inst.beginRun({ runId: 'run-B' });
    // run A wall must be gone
    expect(Object.values(ctx.nodes).some((x) => x.metadata?.physicalWallId === 'wA')).toBe(false);
    // Now a late run-A event must not install into the scene (stale-run guard)
    applyProgressiveEvent(inst, ev({ type: 'walls.ready', stage: 'walls', message: 'w', runId: 'run-A', payload: [wall('wA2', [0, 0], [3, 0])] }), { fileName: 'u', frameId: 'f1' });
    expect(Object.values(ctx.nodes).some((x) => x.metadata?.physicalWallId === 'wA2')).toBe(false);
  });
  it('cancelled-run events cannot mutate the scene after cancelRun', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    applyProgressiveEvent(inst, ev({ type: 'walls.ready', stage: 'walls', message: 'w', payload: [wall('w1', [0, 0], [5, 0])] }), { fileName: 'u', frameId: 'f1' });
    inst.cancelRun({ runId: 'run-1' });
    // A late event for the cancelled run must not add nodes
    const before = Object.keys(ctx.nodes).length;
    applyProgressiveEvent(inst, ev({ type: 'walls.ready', stage: 'walls', message: 'w', payload: [wall('wLate', [0, 0], [2, 0])] }), { fileName: 'u', frameId: 'f1' });
    expect(Object.keys(ctx.nodes).length).toBe(before);
    expect(Object.values(ctx.nodes).some((x) => x.metadata?.physicalWallId === 'wLate')).toBe(false);
  });
  it('retry starts from deterministic clean state (beginRun clears previous AI run)', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    applyProgressiveEvent(inst, ev({ type: 'walls.ready', stage: 'walls', message: 'w', payload: [wall('w1', [0, 0], [5, 0])] }), { fileName: 'u', frameId: 'f1' });
    // retry on the SAME installer
    inst.beginRun({ runId: 'run-2' });
    expect(Object.values(ctx.nodes).some((x) => x.metadata?.extractionProvider === 'PURE_AI')).toBe(false);
    // re-install with the CURRENT run id (stale-run guard rejects the old run-1 event)
    applyProgressiveEvent(inst, ev({ type: 'walls.ready', stage: 'walls', message: 'w', runId: 'run-2', payload: [wall('w1', [0, 0], [5, 0])] }), { fileName: 'u', frameId: 'f1' });
    expect(Object.values(ctx.nodes).filter((x) => x.metadata?.physicalWallId === 'w1').length).toBe(1);
  });
  it('failed runs do not leave partial duplicate stages', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    applyProgressiveEvent(inst, ev({ type: 'walls.ready', stage: 'walls', message: 'w', payload: [wall('w1', [0, 0], [5, 0])] }), { fileName: 'u', frameId: 'f1' });
    applyProgressiveEvent(inst, ev({ type: 'run.failed', message: 'x', code: 'X' }), { fileName: 'u', frameId: 'f1' });
    expect(Object.values(ctx.nodes).filter((x) => x.metadata?.physicalWallId === 'w1').length).toBe(1);
  });
});

// ───────────────────────── §7 metadata on every AI node ─────────────────────────
describe('§7 metadata provenance on every AI node', () => {
  it('guide/slab/walls/windows/doors/furniture all carry the required provenance', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    applyProgressiveEvent(inst, ev({ type: 'guide.ready', stage: 'guide', message: 'g', payload: { dataUrl: 'data:image/png;base64,AAA' } }), { fileName: 'plan.png', frameId: 'frame_1' });
    applyProgressiveEvent(inst, ev({ type: 'slab.ready', stage: 'slab', message: 's', payload: { polygonM: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }], thicknessM: 0.2 } }), { fileName: 'plan.png', frameId: 'frame_1' });
    applyProgressiveEvent(inst, ev({ type: 'walls.ready', stage: 'walls', message: 'w', payload: [wall('w1', [0, 0], [5, 0])] }), { fileName: 'plan.png', frameId: 'frame_1' });
    applyProgressiveEvent(inst, ev({ type: 'windows.ready', stage: 'windows', message: 'w', payload: [win('win1', 'w1', [2, 0], [3, 0])] }), { fileName: 'plan.png', frameId: 'frame_1' });
    applyProgressiveEvent(inst, ev({ type: 'doors.ready', stage: 'doors', message: 'd', payload: [dr('d1', 'w1', [3, 0], [4, 0])] }), { fileName: 'plan.png', frameId: 'frame_1' });
    applyProgressiveEvent(inst, ev({ type: 'furniture.review', message: 'r', payload: { accepted: [sofa('s1', [1, 1], 'frame_1', 'se-1')] } }), { fileName: 'plan.png', frameId: 'frame_1' });
    // furniture.review does not install; install accepted via stage.completed
    applyProgressiveEvent(inst, ev({ type: 'stage.completed', stage: 'furniture', message: 'c', payload: { accepted: [sofa('s1', [1, 1], 'frame_1', 'se-1')] } }), { fileName: 'plan.png', frameId: 'frame_1' });

    const aiNodes = Object.values(ctx.nodes).filter((x) => x.metadata?.extractionProvider === 'PURE_AI');
    expect(aiNodes.length).toBeGreaterThanOrEqual(5); // guide, slab, wall, window, door, item
    for (const n of aiNodes) {
      expect(n.metadata.extractionProvider).toBe('PURE_AI');
      expect(n.metadata.automaticExtraction).toBe(true);
      expect(n.metadata.runId).toBe('run-1');
      expect(n.metadata.stageId).toBeTruthy();
      expect(n.metadata.sourceRecordId).toBeTruthy();
    }
  });
});

// ───────────────────────── §14 furniture policy arithmetic ─────────────────────────
describe('§14 furniture policy: audit arithmetic + auto-install rules', () => {
  const zones = [{ id: 'z1', name: 'Living', boundary: [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][] }];
  const floor: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const audit = () => sanitizeFurnitureV3([], { zones, floorBoundary: floor, frameId: 'frame_1' });

  it('accepted item installs; review/rejected/duplicate do not', () => {
    const res = sanitizeFurnitureV3(
      [sofa('a1', [2, 2], 'frame_1', 'se-a'), sofaNoRot('r1', [3, 3], 'frame_1', 'se-r'), sofa('x1', [50, 50], 'frame_1', 'se-x')],
      { zones, floorBoundary: floor, frameId: 'frame_1' },
    );
    // a1: accepted (in zone, rotation set); r1: review (no rotation => undefined); x1: rejected (outside floor)
    expect(res.accepted.length).toBe(1);
    expect(res.review.length).toBe(1);
    expect(res.rejected.length).toBe(1);
  });
  it('audit arithmetic: detected = accepted + review + rejected (duplicatesRemoved is a subset of rejected)', () => {
    const items = [
      sofa('a', [2, 2], 'frame_1', 'se-a'),           // accepted (in zone, in floor, rotation set)
      sofaNoRot('r', [3, 3], 'frame_1', 'se-r'),      // review (no rotation => undefined)
      sofa('bad', [50, 50], 'frame_1', 'se-bad'),    // rejected (outside floor)
      sofa('u', [2, 2], 'frame_1', 'se-u'),          // duplicate of a => rejected (counted in duplicatesRemoved AND rejected)
    ];
    const res = sanitizeFurnitureV3(items, { zones, floorBoundary: floor, frameId: 'frame_1' });
    const a = res.audit;
    expect(a.detected).toBe(items.length);
    // Documented arithmetic: duplicatesRemoved is a SUBSET of rejected (not additive).
    expect(a.accepted + a.review + a.rejected).toBe(a.detected);
    expect(a.duplicatesRemoved).toBe(1);
    expect(a.duplicatesRemoved).toBeLessThanOrEqual(a.rejected);
    expect(a.rejected).toBe(2); // bad (outside floor) + u (duplicate)
  });
  it('unknown asset never receives an unrelated catalogue asset', () => {
    const res = sanitizeFurnitureV3([{ type: 'NoSuchAssetXYZ', pos: [2, 2], width: 1, depth: 1, height: 1, rotation: 0, confidence: 0.95, frameId: 'frame_1', sourceEntityId: 'se-1' } as any], { zones, floorBoundary: floor, frameId: 'frame_1' });
    expect(res.accepted.length).toBe(0);
    expect(res.rejected.length).toBe(1);
    expect(res.audit.unknownAsset).toBe(1);
  });
  it('frame mismatch goes to review (never auto-installs)', () => {
    const res = sanitizeFurnitureV3([sofa('a', [2, 2], 'frame_2', 'se-a')], { zones, floorBoundary: floor, frameId: 'frame_1' });
    expect(res.accepted.length).toBe(0);
    expect(res.review.length).toBe(1);
    expect(res.audit.frameMismatch).toBe(1);
  });
  it('coordinate-frame mismatch (outside floor) never auto-installs', () => {
    const res = sanitizeFurnitureV3([sofa('a', [50, 50], 'frame_1', 'se-a')], { zones, floorBoundary: floor, frameId: 'frame_1' });
    expect(res.accepted.length).toBe(0);
    expect(res.rejected.length).toBe(1);
    expect(res.audit.outsideFloor).toBe(1);
  });
  it('missing zone forces review, not acceptance', () => {
    const res = sanitizeFurnitureV3([sofa('a', [2, 2], 'frame_1', 'se-a')], { zones: [], floorBoundary: floor, frameId: 'frame_1' });
    expect(res.accepted.length).toBe(0);
    expect(res.review.length).toBe(1);
  });
  it('invalid dimensions rejected', () => {
    const res = sanitizeFurnitureV3([{ type: 'sofa', pos: [2, 2], width: 0, depth: 0, height: 0, rotation: 0, confidence: 0.95, frameId: 'frame_1', sourceEntityId: 'se-1' } as any], { zones, floorBoundary: floor, frameId: 'frame_1' });
    expect(res.accepted.length).toBe(0);
    expect(res.rejected.length).toBe(1);
  });
  it('duplicates create no extra Pascal node (count consistency)', () => {
    const res = sanitizeFurnitureV3([sofa('a', [2, 2], 'frame_1', 'se-a'), sofa('b', [2, 2], 'frame_1', 'se-b')], { zones, floorBoundary: floor, frameId: 'frame_1' });
    expect(res.accepted.length).toBe(1);
    expect(res.audit.duplicatesRemoved).toBe(1);
  });
});

// ───────────────────────── §10 review acceptance ─────────────────────────
describe('§10 review acceptance installs exactly one node', () => {
  it('accepting a review item verifies runId, frame, floor, asset and installs one node', () => {
    const ctx = makeCtx();
    const inst = createProgressiveInstaller(ctx);
    inst.beginRun({ runId: 'run-1' });
    // sanitize → review item (no rotation => undefined)
    const res = sanitizeFurnitureV3([sofaNoRot('r', [3, 3], 'frame_1', 'se-r')], { zones: [{ id: 'z1', name: 'L', boundary: [[0, 0], [10, 0], [10, 10], [0, 10]] }], floorBoundary: [[0, 0], [10, 0], [10, 10], [0, 10]], frameId: 'frame_1' });
    const item = res.review[0] as any;
    expect(item).toBeTruthy();
    expect(item.frameId).toBe('frame_1'); // frame check retained
    // install via stage.completed with accepted payload
    applyProgressiveEvent(inst, ev({ type: 'stage.completed', stage: 'furniture', message: 'accept', payload: { accepted: [item] } }), { fileName: 'u', frameId: 'frame_1' });
    const items = Object.values(ctx.nodes).filter((x) => x.type === 'item');
    expect(items.length).toBe(1);
    expect(items[0].metadata.runId).toBe('run-1');
    expect(items[0].metadata.stageId).toBe('furniture');
    // installer records sourceRecordId from the deterministic instance identity
    // (provider id when present, else family + normalized geometry) — NOT the bare
    // familyId, so multiple same-family instances remain distinct (Step 7).
    expect(items[0].metadata.sourceRecordId).toBe('fur_sofa_3000_3000_2000_900_800_0');
    expect(items[0].metadata.familyId).toBe('sofa');
    expect(items[0].metadata.extractionProvider).toBe('PURE_AI');
    // Double-acceptance prevention: re-accepting the same source record installs nothing extra.
    applyProgressiveEvent(inst, ev({ type: 'stage.completed', stage: 'furniture', message: 'accept-again', payload: { accepted: [item] } }), { fileName: 'u', frameId: 'frame_1' });
    const afterRepeat = Object.values(ctx.nodes).filter((x) => x.type === 'item');
    expect(afterRepeat.length).toBe(1);
  });
});
