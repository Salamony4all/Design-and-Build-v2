// harness/install-ai-extract.ts
// AI multipass extract -> live Pascal scene installer (V2 path; rollback for V3).
//
// CLONED from the proven Pascal 0.9.2 connection model. Now delegates all
// geometry / asset / parent-child logic to the shared ai-scene-install modules
// (spec §10) so V2 and V3 share ONE implementation. The Guide is installed via
// the SAME provider-neutral installGuide used by V3 — sourced from the uploaded
// user image (data: URL), never a CODE_06 / MuPDF asset.

import type { ExtractionResult } from 'design-build-extraction-contracts';
import type { BuildingFrameContract } from './building-frame';
import {
  installFurniture,
  installSlab,
  installWindows,
  installDoors,
  installGuideShared,
} from './ai-scene-install';
import type { SceneInstallContext } from './ai-scene-install';

export interface AiExtractInstallerContext extends SceneInstallContext {}

export interface AiExtractInstallOptions {
  /** Run-scoped Guide image (data: URL of the uploaded plan). AI-native. */
  guideDataUrl?: string;
  /** Authoritative AI building frame (same as slab + walls). */
  buildingFrame?: BuildingFrameContract | null;
  runId?: string;
  fileName?: string;
  frameId?: string;
  sourceFrame?: unknown;
}

export interface AiExtractInstallResult {
  furniture: number;
  slab: number;
  windows: number;
  doors: number;
  guideNodeId: string | null;
}

/**
 * Install AI-extracted SLAB, FURNITURE, WINDOWS, DOORS and the GUIDE into the
 * live Pascal scene via the shared installers. Idempotent clear at the start
 * removes previously AI-installed nodes (tagged source='ai-extract') so re-running
 * replaces rather than doubles. Openings are hosted on the live geometric walls.
 */
export function installAiExtract(
  ctx: AiExtractInstallerContext,
  result: ExtractionResult,
  options?: AiExtractInstallOptions,
): AiExtractInstallResult {
  // ── Idempotent clear: remove previously AI-installed nodes (V2 tag:
  // source='ai-extract', no extractionMode). This clears V2 nodes only.
  if (ctx.removeNodeIds) {
    const prior: string[] = [];
    for (const [id, node] of Object.entries(ctx.nodes)) {
      const meta = ((node as Record<string, unknown>)?.metadata ?? {}) as Record<string, unknown>;
      if (meta.source === 'ai-extract' && meta.extractionMode === undefined) prior.push(id);
    }
    if (prior.length) ctx.removeNodeIds(prior);
  }

  const furniture = installFurniture(ctx, result.furniture ?? []);
  const slab = installSlab(ctx, result.slab, result.walls as any);
  const windows = installWindows(ctx, result.windows ?? []).installed;
  const doors = installDoors(ctx, result.doors ?? []).installed;

  // AI-native Guide: the uploaded plan image, aligned to the AI building frame.
  const guide = options?.guideDataUrl
    ? installGuideShared(ctx, {
        runId: options.runId ?? 'ai-v2',
        fileName: options.fileName ?? 'AI Guide',
        frameId: options.frameId ?? `frame_${options.runId ?? 'ai-v2'}`,
        dataUrl: options.guideDataUrl,
        buildingFrame: options.buildingFrame ?? null,
        sourceFrame: options.sourceFrame,
      })
    : { guideNodeId: null, status: 'skipped-no-url' as const };

  return { furniture, slab, windows, doors, guideNodeId: guide.guideNodeId };
}
