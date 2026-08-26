// packages/extraction-ai/src/multipass-controller.ts
// §4 — the ACTIVE legacy pass topology, preserved as-is from
// ChatBox.runBimPipeline (apps/editor/src/components/ChatBox.tsx, freeze
// sha256 9f721cfe6244f5e3…):
//
//   Promise.all([ shell (failure tolerated), core (required) ])
//   → cumulativeWalls = core.walls
//   → Promise.allSettled([ fitout(wallsContext), ffe(wallsContext) ])
//
// Legacy has NO automatic retry and NO cancellation; the clean controller
// preserves the no-retry default and ADDS AbortSignal cancellation + stale-run
// rejection (documented EXPECTED_ADAPTER_CHANGE per ledger).
// The controller is provider-agnostic (§8): all transport goes through
// AiModelRuntime adapters.

import { getShellPrompt, getCorePrompt, getFitoutPrompt, getFFEPrompt } from './prompts';
import { getWindowDetectionPromptV4 } from './prompts-window-v4';
import { parseAIResponse } from './parser';
import type { StructuralSchemaType } from './schema';
import type { AiModelRuntime } from './model-runtime';

/** Feature flags (env-gated, default OFF). V3/legacy remains the rollback. */
export const AI_WINDOWS_V4 = process.env.AI_WINDOWS_V4 === 'true';
export const AI_FURNITURE_V4 = process.env.AI_FURNITURE_V4 === 'true';

export type PassId = 'shell' | 'core' | 'fitout' | 'ffe' | 'window-v4';

export interface MultipassRequest {
  runId: string;
  correlationId?: string;
  imageBase64: string;
  imageMimeType: string;
  modelId: string;
  signal?: AbortSignal;
  /** Source image dimensions (optional; used by versioned passes like window V4). */
  imageWidthPx?: number;
  imageHeightPx?: number;
}

export type MultipassEventType =
  | 'run-started'
  | 'pass-started'
  | 'pass-completed'
  | 'pass-failed'
  | 'extraction-completed'
  | 'extraction-cancelled'
  | 'extraction-failed';

export interface MultipassEvent {
  type: MultipassEventType;
  runId: string;
  sequence: number;
  timestamp: string;
  passId?: PassId;
  message: string;
  code?: string;
  durationMs?: number;
  /** Present on pass-completed: entity counts for real progress display. */
  counts?: Record<string, number>;
}

export interface PassRecord {
  passId: PassId;
  order: number;
  status: 'completed' | 'failed';
  durationMs: number;
  tolerated: boolean;
  parsed?: StructuralSchemaType;
  error?: string;
}

export interface MultipassResult {
  runId: string;
  modelId: string;
  passes: PassRecord[];
  wallsContextSize: number;
  totalDurationMs: number;
  /** Per-pass parsed results (legacy merge input shape). */
  phases: {
    shell: StructuralSchemaType | null;
    core: StructuralSchemaType | null;
    fitout: StructuralSchemaType | null;
    ffe: StructuralSchemaType | null;
  };
}

function counts(r: StructuralSchemaType | null): Record<string, number> {
  if (!r) return {};
  return {
    walls: (r.walls ?? []).length,
    openings: (r.openings ?? []).length,
    furniture: (r.furniture ?? []).length,
    floors: (r.floors ?? []).length,
    ceilings: (r.ceilings ?? []).length,
    zones: (r.zones ?? []).length,
  };
}

export class MultipassCancelledError extends Error {
  public runId: string;
  constructor(runId: string) {
    super(`Extraction run ${runId} was cancelled.`);
    this.runId = runId;
    this.name = 'MultipassCancelledError';
  }
}

export async function runMultipass(
  runtime: AiModelRuntime,
  request: MultipassRequest,
  onEvent?: (e: MultipassEvent) => void,
): Promise<MultipassResult> {
  const t0 = Date.now();
  let seq = 0;
  const emit = (e: Omit<MultipassEvent, 'runId' | 'sequence' | 'timestamp'>) => {
    onEvent?.({ ...e, runId: request.runId, sequence: ++seq, timestamp: new Date().toISOString() });
  };
  const throwIfAborted = () => {
    if (request.signal?.aborted) throw new MultipassCancelledError(request.runId);
  };

  const passes: PassRecord[] = [];

  const runPass = async (
    passId: PassId,
    prompt: string,
    tolerated: boolean,
  ): Promise<StructuralSchemaType | null> => {
    throwIfAborted();
    const started = Date.now();
    emit({ type: 'pass-started', passId, message: `Pass ${passId} started` });
    try {
      const { text } = await runtime.generate({
        prompt,
        imageBase64: request.imageBase64,
        imageMimeType: request.imageMimeType,
        modelId: request.modelId,
        signal: request.signal,
      });
      throwIfAborted();
      const parsed = parseAIResponse(text);
      const durationMs = Date.now() - started;
      passes.push({ passId, order: passes.length + 1, status: 'completed', durationMs, tolerated, parsed });
      emit({ type: 'pass-completed', passId, message: `Pass ${passId} completed`, durationMs, counts: counts(parsed) });
      return parsed;
    } catch (e: any) {
      if (request.signal?.aborted || e instanceof MultipassCancelledError) {
        throw new MultipassCancelledError(request.runId);
      }
      const durationMs = Date.now() - started;
      passes.push({ passId, order: passes.length + 1, status: 'failed', durationMs, tolerated, error: String(e?.message ?? e).slice(0, 500) });
      emit({ type: 'pass-failed', passId, message: `Pass ${passId} failed: ${String(e?.message ?? e).slice(0, 200)}`, code: e?.code, durationMs });
      if (!tolerated) throw e;
      return null;
    }
  };

  emit({ type: 'run-started', message: `Multipass extraction started (model ${request.modelId})` });

  try {
    // Phase 1+2: shell (tolerated) ‖ core (required) — legacy Promise.all with
    // shell .catch(() => {}) tolerance.
    const [shell, core] = await Promise.all([
      runPass('shell', getShellPrompt(), true),
      runPass('core', getCorePrompt(), false),
    ]);

    // ── STRUCTURAL_WINDOW_DETECTION_V4 (feature-flagged, default OFF) ──
    // When enabled, run a dedicated window pass so providers that omit windows
    // from the Core opening array still get high-recall window detection. The
    // result is merged into core.openings as type:"window" — the existing
    // opening-normalizer accepts these deterministically (host confirmed by
    // geometry, never a nearest-wall fallback). Legacy (flag OFF) keeps the
    // Core-only rollback unchanged.
    if (AI_WINDOWS_V4 && core) {
      const wallIds = (core.walls ?? []).map((w: any) => w.id).filter(Boolean);
      const winPass = await runPass(
        'window-v4',
        getWindowDetectionPromptV4({
          imageWidthPx: request.imageWidthPx ?? 1600,
          imageHeightPx: request.imageHeightPx ?? 1200,
          acceptedWallIds: wallIds,
        }),
        true,
      );
      const detected = (winPass as any)?.windows ?? [];
      if (detected.length) {
        const existing = (core as any).openings ?? [];
        (core as any).openings = [
          ...existing,
          ...detected.map((w: any) => ({
            id: w.id,
            type: 'window',
            pos: w.pos,
            width: w.width,
            height: w.height,
            elevation: w.elevation ?? w.sillM ?? 0,
          })),
        ];
      }
      // Uncertain window symbols are preserved in providerEvidence for Review
      // (never auto-installed). They do not enter core.openings.
      const reviewCount = (winPass as any)?.review?.length ?? 0;
      if (reviewCount) {
        (core as any).providerEvidence = {
          ...((core as any).providerEvidence ?? {}),
          windowReview: (winPass as any).review,
        };
      }
    }

    const cumulativeWalls: any[] = core?.walls ? [...core.walls] : [];

    // Phase 3+4: fitout ‖ ffe with wallsContext — legacy Promise.allSettled.
    const settled = await Promise.allSettled([
      runPass('fitout', getFitoutPrompt(cumulativeWalls), true),
      runPass('ffe', getFFEPrompt(cumulativeWalls), true),
    ]);
    // Cancellation surfaces even from tolerated passes:
    for (const s of settled) {
      if (s.status === 'rejected' && s.reason instanceof MultipassCancelledError) throw s.reason;
    }
    const fitout = settled[0].status === 'fulfilled' ? settled[0].value : null;
    const ffe = settled[1].status === 'fulfilled' ? settled[1].value : null;

    const result: MultipassResult = {
      runId: request.runId,
      modelId: request.modelId,
      passes,
      wallsContextSize: cumulativeWalls.length,
      totalDurationMs: Date.now() - t0,
      phases: { shell, core, fitout, ffe },
    };
    emit({ type: 'extraction-completed', message: 'Multipass extraction completed' });
    return result;
  } catch (e: any) {
    if (e instanceof MultipassCancelledError) {
      emit({ type: 'extraction-cancelled', message: 'Extraction cancelled by user', code: 'CANCELLED' });
      throw e;
    }
    emit({ type: 'extraction-failed', message: String(e?.message ?? e).slice(0, 300), code: e?.code ?? 'EXTRACTION_FAILED' });
    throw e;
  }
}
