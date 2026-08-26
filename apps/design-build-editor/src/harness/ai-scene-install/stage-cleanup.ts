// harness/ai-scene-install/stage-cleanup.ts
// Idempotent clearing of progressively-installed nodes (spec §12).
// clearRunStage removes ONLY nodes matching BOTH runId and stage.
// beginRunCleanup removes all nodes of a previous run (replace-previous-ai-run).

import type { SceneInstallContext } from './types';
import type { BuildStage } from 'design-build-extraction-ai';

export type NewRunPolicy = 'replace-previous-ai-run' | 'keep-previous-ai-run';

const META_SOURCE = 'ai-extract';

function nodeMeta(node: unknown): Record<string, unknown> {
  return (((node as Record<string, unknown>)?.metadata ?? {}) as Record<string, unknown>);
}

/** Remove only nodes belonging to a specific run + stage. */
export function clearRunStage(ctx: SceneInstallContext, runId: string, stage: BuildStage): void {
  if (!ctx.removeNodeIds) return;
  const ids: string[] = [];
  for (const [id, node] of Object.entries(ctx.nodes)) {
    const m = nodeMeta(node);
    // aiMeta writes the stage under `stageId` (spec §7); match that key.
    if (m.source === META_SOURCE && m.runId === runId && m.stageId === stage) ids.push(id);
  }
  if (ids.length) ctx.removeNodeIds(ids);
}

/** At run start, optionally remove the previous AI run's nodes (default policy). */
export function beginRunCleanup(ctx: SceneInstallContext, policy: NewRunPolicy, prevRunId?: string): void {
  if (policy !== 'replace-previous-ai-run') return;
  if (!ctx.removeNodeIds) return;
  const ids: string[] = [];
  for (const [id, node] of Object.entries(ctx.nodes)) {
    const m = nodeMeta(node);
    // AI nodes always carry extractionProvider:'PURE_AI' (spec §7); MuPDF nodes
    // carry source:'mupdf' and are never touched. Covers both V2 and V3 runs.
    if (m.extractionProvider === 'PURE_AI' && (!prevRunId || m.runId === prevRunId)) ids.push(id);
  }
  if (ids.length) ctx.removeNodeIds(ids);
}

/** Find the most recent progressive-v3 runId currently in the scene (for replace policy). */
export function previousRunId(ctx: SceneInstallContext): string | undefined {
  let found: string | undefined;
  for (const node of Object.values(ctx.nodes)) {
    const m = nodeMeta(node);
    if (m.source === META_SOURCE && m.extractionMode === 'progressive-v3' && typeof m.runId === 'string') found = m.runId as string;
  }
  return found;
}
