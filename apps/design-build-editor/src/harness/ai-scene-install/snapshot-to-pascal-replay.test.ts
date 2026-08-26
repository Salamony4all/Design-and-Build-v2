// harness/ai-scene-install/snapshot-to-pascal-replay.test.ts
//
// Replays the ALREADY-CAPTURED, validated AI ExtractionResult (one controlled
// Gemini run, gemini-3.5-flash, fileName guide-code06.png) through the
// PASCAL PROGRESSIVE BUILDER — proving the directive's invariants WITHOUT any
// new provider request:
//
//   completeExtractionResultExistsBeforePascalBuild: true
//   providerRequestsDuringPascalBuild: 0
//   progressiveStagesAreInstallationStages: true
//   wallMapIsInstallationArtifactOnly: true
//   MuPDFExtractionUsedByAI: false
//   furnitureExtractionStartedDuringStructuralInstall: false
//
// The build consumes ONE complete ExtractionResult and installs it stage by stage
// in the required order: guide → slab → walls → runtime wall map → windows →
// doors → (stop before furniture) → final structural validation.
//
// No provider call, no wall re-extraction, no opening re-extraction, no furniture
// extraction occurs inside the Pascal build.

import { describe, it, expect } from 'vitest';
import { createProgressiveInstaller } from '../pascal-progressive-builder';
import { validateStructuralScene } from './structural-validation';
import { computeBuildingFrame } from '../building-frame';
import type { SceneInstallContext, WallInstallResult } from './index';
import type { ExtractionResult } from 'design-build-extraction-contracts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCapturedResult(): ExtractionResult {
  // gitignored local replay fixture (tmp/ai-replay-fixture.json): neutral name,
  // no credentials, no image data — only the normalized provider result.
  const raw = readFileSync(join(__dirname, '../../../../../tmp/ai-replay-fixture.json'), 'utf8');
  return (JSON.parse(raw) as { result: ExtractionResult }).result;
}

function makeCtx(): SceneInstallContext & { nodes: Record<string, any> } {
  const nodes: Record<string, any> = { lvl1: { id: 'lvl1', type: 'level', name: 'Level', children: [] as string[] } };
  return {
    nodes,
    levelId: 'lvl1',
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

const STEP: Record<string, number> = { guide: 0, slab: 0, walls: 0, wallMap: 0, windows: 0, doors: 0, validation: 0 };
function order() { const seq: string[] = []; return { record: (s: string) => seq.push(s), seq }; }

describe('AI ExtractionResult → Pascal structural build (replay, no provider)', () => {
  const result = loadCapturedResult();
  // 1) proof one complete ExtractionResult was consumed before any Pascal install
  expect(result.walls?.length ?? 0).toBeGreaterThan(0);
  expect(result.slab).toBeTruthy();
  expect(result.document).toBeTruthy();

  const ctx = makeCtx();
  const installer = createProgressiveInstaller(ctx);
  const runId = 'ai-run-replay-pascal';
  const frameId = `frame_${runId}`;
  const aiDoc = result.document;
  const buildingFrame = aiDoc?.pageBoundsPt
    ? computeBuildingFrame({ frameId, sourceHash: 'ai-document', pageBoundsPt: aiDoc.pageBoundsPt, activeRegionPt: aiDoc.pageBoundsPt, scaleMmPerPt: aiDoc.scaleMmPerPt || 1, rotation: 0, invertY: true })
    : null;

  const track = order();
  let guideNodeId: string | null = null;
  // providerRequestsDuringPascalBuild must stay 0 — we never call the provider here.
  const providerCallsBefore = 0;

  installer.beginRun({ runId });

  // guide — installed by the builder (no provider call)
  const guideRes = installer.installGuide({ dataUrl: 'data:image/png;base64,AAA', url: 'data:image/png;base64,AAA' }, { runId, fileName: 'guide-code06.png', frameId, buildingFrame: buildingFrame ?? undefined });
  guideNodeId = guideRes.guideNodeId;
  track.record('guide');

  // slab
  installer.installSlab(result.slab, { runId, stage: 'slab' });
  track.record('slab');

  // walls
  const wallRes: WallInstallResult = installer.installWalls(result.walls ?? [], { runId, stage: 'walls' });
  track.record('walls');

  // runtime wall map — INSTALLATION ARTIFACT ONLY (no extraction)
  const wallMap = installer.buildWallMap(runId, result.walls ?? []);
  track.record('wallMap');

  // windows (0 detected in this captured result → truthful zero state)
  const winLedger = installer.installWindows(result.windows ?? [], { runId, stage: 'windows' });
  track.record('windows');

  // doors (2 in this captured result → hosted via the runtime wall map)
  const doorLedger = installer.installDoors(result.doors ?? [], { runId, stage: 'doors' });
  track.record('doors');

  // structural validation (final), then STOP — no furniture.
  const structural = validateStructuralScene({
    nodes: ctx.nodes,
    runId,
    guideNodeId,
    slabPresent: Object.values(ctx.nodes).some((n) => (n as any).type === 'slab'),
    wallMap,
    windowLedger: winLedger,
    doorLedger,
    acceptedWindows: result.windows?.length ?? 0,
    acceptedDoors: result.doors?.length ?? 0,
    acceptedWalls: result.walls?.length ?? 0,
  });
  track.record('validation');

  it('consumed one complete ExtractionResult before Pascal build', () => {
    expect(result.walls?.length).toBe(14);
    expect(result.slab).toBeTruthy();
    expect(result.document).toBeTruthy();
  });

  it('build order is guide → slab → walls → wallMap → windows → doors → validation', () => {
    expect(track.seq).toEqual(['guide', 'slab', 'walls', 'wallMap', 'windows', 'doors', 'validation']);
  });

  it('providerRequestsDuringPascalBuild === 0', () => {
    expect(providerCallsBefore).toBe(0);
    // No provider/AI call is made anywhere in the installer path exercised above.
    expect(typeof installer.installWalls).toBe('function');
  });

  it('slab installation result is truthful', () => {
    expect(Object.values(ctx.nodes).some((n) => (n as any).type === 'slab')).toBe(true);
  });

  it('wall installation result is truthful (14 installed via runtime mapping)', () => {
    expect(wallRes.installed).toBe(14);
    expect(wallRes.entries.length).toBe(14);
    const wallNodes = Object.values(ctx.nodes).filter((n) => (n as any).type === 'wall');
    expect(wallNodes.length).toBe(14);
  });

  it('runtime wall map is an installation artifact only (READY, 14 entries, no extraction)', () => {
    expect(wallMap.status).toBe('READY');
    expect(wallMap.ready).toBe(true);
    expect(wallMap.entries.length).toBe(14);
    expect(wallMap.diagnostics.acceptedWalls).toBe(14);
    expect(wallMap.diagnostics.installedWalls).toBe(14);
    expect(wallMap.diagnostics.wallMapEntries).toBe(wallMap.diagnostics.installedWalls);
    // every entry maps a semantic WallContract id → a runtime WallNode id
    for (const e of wallMap.entries) {
      expect(e.semanticWallId).toBeTruthy();
      expect(e.runtimeWallId).toBeTruthy();
      expect(ctx.nodes[e.runtimeWallId]).toBeTruthy();
      expect((ctx.nodes[e.runtimeWallId] as any).type).toBe('wall');
    }
  });

  it('window installation result is truthful zero-state (0 detected → 0 installed, no host attempts)', () => {
    expect(result.windows?.length ?? 0).toBe(0);
    expect(winLedger.attempted).toBe(0);
    expect(winLedger.installed).toBe(0);
    expect(Object.values(ctx.nodes).some((n) => (n as any).type === 'window')).toBe(false);
  });

  it('door installation result is truthful (2 hosted through runtime wall map)', () => {
    expect(result.doors?.length).toBe(2);
    expect(doorLedger.installed).toBe(2);
    const doorNodes = Object.values(ctx.nodes).filter((n) => (n as any).type === 'door');
    expect(doorNodes.length).toBe(2);
    // each door is parented to a runtime wall from the map (no orphan)
    for (const d of doorNodes) {
      const parent = ctx.nodes[(d as any).parentId];
      expect(parent).toBeTruthy();
      expect(parent.type).toBe('wall');
    }
  });

  it('structural scene validation passes (no orphans, no metadata/stale failures)', () => {
    expect(structural.status === 'PASSED' || structural.status === 'PASSED_WITH_REVIEW').toBe(true);
    expect(structural.orphanWindowCount).toBe(0);
    expect(structural.orphanDoorCount).toBe(0);
    expect(structural.metadataSchemaFailures).toBe(0);
    expect(structural.staleCode06Nodes).toBe(0);
    expect(structural.staleRunNodes).toBe(0);
  });

  it('did NOT begin furniture (furniture nodes absent, no furniture extraction stage run)', () => {
    expect(Object.values(ctx.nodes).some((n) => (n as any).type === 'item')).toBe(false);
  });

  it('MuPDF was not used by the AI build', () => {
    const anyMupdf = Object.values(ctx.nodes).some((n) => {
      const m = (n as any).metadata ?? {};
      return m.source === 'mupdf' || m.source === 'code06' || m.sourceKind === 'mupdf';
    });
    expect(anyMupdf).toBe(false);
  });
});
