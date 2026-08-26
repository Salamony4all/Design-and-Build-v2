// packages/extraction-ai/src/structural-adapter.ts
// Pure adapter: converts the existing V2 ExtractionResult into progressive stage
// events (spec §8). Does NOT transform entities, change coordinates, or rescale.
// The stage payloads use the SAME neutral contracts consumed by the installer.

import type { ExtractionResult } from 'design-build-extraction-contracts';
import type { ProgressiveBuildEvent, BuildStage } from './progressive-types';

export interface SourceFrame {
  frameId: string;
  sourceFileName: string;
  fullImageWidthPx: number;
  fullImageHeightPx: number;
  cropBoundsPx?: [number, number, number, number];
  widthM: number;
  heightM: number;
  originM: [number, number];
  rotationDeg: number;
  mirroredX: boolean;
  mirroredY: boolean;
}

export interface StructuralAdapterOptions {
  frameId?: string;
  sourceFrame?: SourceFrame;
}

/**
 * Emit the structural stage events (slab/walls/windows/doors) for a completed
 * V2 ExtractionResult. Each payload is the raw contract array — coordinates are
 * preserved. Sequence + runId + timestamp are supplied by the caller's emitter.
 */
export function structuralStagesFromResult(
  result: ExtractionResult,
  opts: StructuralAdapterOptions = {},
): Array<{ stage: BuildStage; status: 'completed'; message: string; payload: unknown; counts: Record<string, number> }> {
  const frameId = opts.frameId;
  const stages: Array<{ stage: BuildStage; status: 'completed'; message: string; payload: unknown; counts: Record<string, number> }> = [];

  if (result.slab) {
    stages.push({
      stage: 'slab',
      status: 'completed',
      message: 'Ground slab ready',
      payload: { ...result.slab, frameId },
      counts: { slabs: 1 },
    });
  }
  stages.push({
    stage: 'walls',
    status: 'completed',
    message: 'Walls ready',
    payload: result.walls ?? [],
    counts: { walls: (result.walls ?? []).length },
  });
  stages.push({
    stage: 'windows',
    status: 'completed',
    message: 'Windows ready',
    payload: result.windows ?? [],
    counts: { windows: (result.windows ?? []).length },
  });
  stages.push({
    stage: 'doors',
    status: 'completed',
    message: 'Doors ready',
    payload: result.doors ?? [],
    counts: { doors: (result.doors ?? []).length },
  });
  return stages;
}

/** Build a single ProgressiveBuildEvent with sequence/runId/timestamp filled. */
export function makeEvent(
  runId: string,
  seq: number,
  ev: Omit<ProgressiveBuildEvent, 'runId' | 'sequence' | 'timestamp'>,
): ProgressiveBuildEvent {
  return { runId, sequence: seq, timestamp: new Date().toISOString(), ...ev } as ProgressiveBuildEvent;
}
