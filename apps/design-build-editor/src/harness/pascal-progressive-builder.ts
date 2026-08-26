// harness/pascal-progressive-builder.ts
//
// PASCAL PROGRESSIVE BUILDER — installs an ALREADY-COMPLETED, validated AI
// ExtractionResult into the Pascal scene, stage by stage. This is NOT an
// extraction pipeline: the provider multipass has already finished upstream and
// produced one complete ExtractionResult. NO provider request, NO wall re-
// extraction, NO opening re-extraction, and NO furniture extraction happens inside
// any installation stage. Each stage consumes the next slice of the snapshot and
// installs it.
//
// Build order (PascalBuildStage):
//   guide → slab → walls → RUNTIME WALL MAP (installation artifact) →
//   windows → doors → [furniture — out of scope for Phase B] →
//   final structural validation.
//
// The runtime wall map (runtime-wall-map.ts) is an INSTALLATION-TIME artifact only:
// it records semantic WallContract.id → installed Pascal WallNode runtime id so
// windows/doors can be parented to the exact runtime wall. It is not an extraction
// stage and performs no AI work.

import type { AnyNode } from '@pascal-app/core';
import { type BuildingFrameContract } from './building-frame';
import type { ProgressiveBuildEvent, BuildStage, FurnitureEvidence } from 'design-build-extraction-ai';
import type { WallContract } from 'design-build-extraction-contracts';
import {
  type SceneInstallContext,
  type FurnitureItem,
  type InstallGuideResult,
  type WallInstallResult,
  aiMeta,
  clearRunStage,
  beginRunCleanup,
  previousRunId,
  installFurniture,
  installSlab,
  installWalls,
  installWindows,
  installDoors,
  installGuideShared,
  alignGuideToBuilding,
  buildRuntimeWallMap,
  type RuntimeWallMapBuild,
} from './ai-scene-install';

export interface ProgressiveInstaller {
  beginRun(args: { runId: string; policy?: 'replace-previous-ai-run' | 'keep-previous-ai-run' }): void;
  clearRunStage(runId: string, stage: BuildStage): void;
  installGuide(payload: any, args: { runId: string; fileName: string; frameId: string; sourceFrame?: unknown; buildingFrame?: BuildingFrameContract }): InstallGuideResult;
  installSlab(payload: any, args: { runId: string; stage: BuildStage; walls?: any[] }): number;
  installWalls(payload: any[], args: { runId: string; stage: BuildStage }): WallInstallResult;
  installWindows(payload: any[], args: { runId: string; stage: BuildStage }): import('./ai-scene-install/install-opening').OpeningLedger;
  installDoors(payload: any[], args: { runId: string; stage: BuildStage }): import('./ai-scene-install/install-opening').OpeningLedger;
  installFurniture(payload: { accepted: FurnitureItem[]; review: FurnitureItem[]; rejected: FurnitureItem[]; audit?: unknown }, args: { runId: string; stage: BuildStage }): number;
  completeRun(args: { runId: string }): void;
  cancelRun(args: { runId: string }): void;
  /** Last wall-install result (semantic→runtime mapping) — used to build the runtime wall map. */
  lastWallInstall: WallInstallResult | null;
  /** Build the runtime wall map from the last wall install + neutral contracts (installation artifact). */
  buildWallMap(runId: string, contracts: WallContract[]): RuntimeWallMapBuild;
  /** The currently active run; events for other runIds are ignored (stale-run safety). */
  activeRunId: string | null;
}

function meta(runId: string, stage: BuildStage, extra: Record<string, unknown> = {}) {
  return aiMeta({ runId, stageId: stage, extractionMode: 'progressive-v3', ...extra });
}

export function createProgressiveInstaller(ctx: SceneInstallContext): ProgressiveInstaller {
  const installer: ProgressiveInstaller = {
    activeRunId: null,
    lastWallInstall: null as WallInstallResult | null,
    beginRun({ runId, policy = 'replace-previous-ai-run' }) {
      const prev = previousRunId(ctx);
      beginRunCleanup(ctx, policy, prev);
      installer.activeRunId = runId;
    },
    clearRunStage(runId, stage) {
      clearRunStage(ctx, runId, stage);
    },
    installGuide(payload, { runId, fileName, frameId, sourceFrame, buildingFrame }) {
      const levelId = ctx.levelId;
      const dataUrl = payload?.dataUrl ?? payload?.url;
      return installGuideShared(ctx, {
        runId, fileName, frameId, dataUrl, buildingFrame, sourceFrame, parentId: levelId,
        extractionMode: 'progressive-v3',
      });
    },
    installSlab(payload, { runId, stage, walls }) {
      const w = walls ?? (installer.lastWallInstall?.entries.map((e) => ({ startM: e.startM, endM: e.endM })) ?? []);
      const count = installSlab(ctx, payload, w, meta(runId, stage));
      alignGuideToBuilding(ctx);
      return count;
    },
    installWalls(payload, { runId, stage }) {
      const res = installWalls(ctx, payload ?? [], meta(runId, stage));
      installer.lastWallInstall = res;
      alignGuideToBuilding(ctx);
      return res;
    },
    buildWallMap(runId, contracts) {
      return buildRuntimeWallMap(runId, installer.lastWallInstall ?? { attempted: 0, installed: 0, invalid: 0, entries: [] }, contracts, { settled: true });
    },
    installWindows(payload, { runId, stage }) {
      return installWindows(ctx, payload ?? [], meta(runId, stage), { entries: installer.lastWallInstall?.entries ?? [] });
    },
    installDoors(payload, { runId, stage }) {
      return installDoors(ctx, payload ?? [], meta(runId, stage), { entries: installer.lastWallInstall?.entries ?? [] });
    },
    installFurniture(payload, { runId, stage }) {
      const accepted = (payload?.accepted ?? []) as FurnitureItem[];
      return installFurniture(ctx, accepted, {
        progressive: true,
        metaExtras: meta(runId, stage),
      });
    },
    completeRun() { /* hooks for telemetry */ },
    cancelRun() { installer.activeRunId = null; }, // cancelled runs reject subsequent events
  };
  return installer;
}

/**
 * Apply a single completed build event via the installer. Each event installs one
 * slice of the ALREADY-VALIDATED ExtractionResult — no provider call occurs here.
 * Malformed events are rejected upstream by validateEvent() before reaching here,
 * so no Pascal mutation happens for bad payloads.
 *
 * STALE-RUN / CANCELLATION SAFETY: an event whose runId does not match the
 * installer's activeRunId is ignored. After cancelRun()/beginRun() the activeRunId
 * changes, so late events from a previous or cancelled run cannot mutate the scene.
 */
export function applyProgressiveEvent(
  installer: ProgressiveInstaller,
  event: ProgressiveBuildEvent,
  guideArgs?: { fileName: string; frameId: string; sourceFrame?: unknown },
): void {
  if (event.runId !== installer.activeRunId) return;
  switch (event.type) {
    case 'guide.ready': installer.installGuide(event.payload, { runId: event.runId, fileName: guideArgs?.fileName ?? 'upload', frameId: guideArgs?.frameId ?? '', sourceFrame: guideArgs?.sourceFrame }); break;
    case 'slab.ready': installer.installSlab(event.payload, { runId: event.runId, stage: 'slab' }); break;
    case 'walls.ready': installer.installWalls(event.payload as any[], { runId: event.runId, stage: 'walls' }); break;
    case 'windows.ready': installer.installWindows(event.payload as any[], { runId: event.runId, stage: 'windows' }); break;
    case 'doors.ready': installer.installDoors(event.payload as any[], { runId: event.runId, stage: 'doors' }); break;
    case 'stage.completed':
      if (event.stage === 'furniture') installer.installFurniture(event.payload as any, { runId: event.runId, stage: 'furniture' });
      break;
    case 'furniture.review':
      break; // review payload is surfaced to the UI; not installed
    default:
      break;
  }
}

/**
 * Pure AI extraction dispatch decision (spec §17, §19). Single source of truth for
 * which route/panel a given provider + feature-flag selection resolves to. Kept pure
 * (no React/Next imports) so it is unit-testable and reused by the page dispatcher.
 *
 *  - 'gemini'  + flag ON  → progressive V3 route + V3 panel, V2 route NOT used.
 *  - 'gemini'  + flag OFF → V2 AI route, V3 panel NOT rendered.
 *  - 'mupdf'    (any flag)→ Pure MuPDF route; AI installer + V3 panel never engaged.
 */
export type ExtractionProvider = 'gemini' | 'mupdf';
export interface AiExtractionPlan {
  route: 'progressive-v3' | 'v2-ai' | 'pure-mupdf';
  progressiveRouteCalled: boolean;
  v2RouteCalled: boolean;
  progressiveV3Rendered: boolean;
  aiSceneInstallerCalled: boolean;
  isPureMupdf: boolean;
}

export function resolveAiExtractionPlan(provider: ExtractionProvider, progressiveFlagEnabled: boolean): AiExtractionPlan {
  if (provider === 'mupdf') {
    return {
      route: 'pure-mupdf',
      progressiveRouteCalled: false,
      v2RouteCalled: false,
      progressiveV3Rendered: false,
      aiSceneInstallerCalled: false,
      isPureMupdf: true,
    };
  }
  // provider === 'gemini' (Pure AI)
  if (progressiveFlagEnabled) {
    return {
      route: 'progressive-v3',
      progressiveRouteCalled: true,
      v2RouteCalled: false,
      progressiveV3Rendered: true,
      aiSceneInstallerCalled: true,
      isPureMupdf: false,
    };
  }
  return {
    route: 'v2-ai',
    progressiveRouteCalled: false,
    v2RouteCalled: true,
    progressiveV3Rendered: false,
    aiSceneInstallerCalled: true, // V2 also uses the shared AI scene installer
    isPureMupdf: false,
  };
}
