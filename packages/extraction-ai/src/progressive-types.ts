// packages/extraction-ai/src/progressive-types.ts
// Progressive build event contract (spec §3, §7). Discriminated union over the
// `type` field. Required event classes:
//   run.started | guide.ready | slab.ready | walls.ready | windows.ready
//   | doors.ready | furniture.detected | furniture.verified | furniture.review
//   | stage.completed | run.completed | run.failed | run.cancelled
// Malformed events fail validation() and must NOT mutate Pascal state.

export type BuildStage = 'guide' | 'slab' | 'walls' | 'windows' | 'doors' | 'furniture';

export type ProgressiveEventClass =
  | 'run.started'
  | 'guide.ready'
  | 'slab.ready'
  | 'walls.ready'
  | 'windows.ready'
  | 'doors.ready'
  | 'furniture.detected'
  | 'furniture.verified'
  | 'furniture.review'
  | 'stage.completed'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

interface BaseEvent {
  /** Discriminator (spec §3). */
  type: ProgressiveEventClass;
  runId: string;
  sequence: number;
  timestamp: string;
}

export interface RunStartedEvent extends BaseEvent { type: 'run.started'; }
export interface StageReadyEvent extends BaseEvent {
  type: 'guide.ready' | 'slab.ready' | 'walls.ready' | 'windows.ready' | 'doors.ready';
  stage: BuildStage;
  message: string;
  payload?: unknown;
  counts?: Record<string, number>;
}
export interface FurnitureDetectedEvent extends BaseEvent { type: 'furniture.detected'; detected: number; payload?: unknown; }
export interface FurnitureVerifiedEvent extends BaseEvent { type: 'furniture.verified'; verified: number; payload?: unknown; }
export interface FurnitureReviewEvent extends BaseEvent {
  type: 'furniture.review';
  message: string;
  payload?: { accepted?: unknown[]; review?: unknown[]; rejected?: unknown[]; audit?: unknown };
  counts?: Record<string, number>;
  audit?: unknown;
}
export interface StageCompletedEvent extends BaseEvent {
  type: 'stage.completed';
  stage: BuildStage;
  message: string;
  installed?: number;
  total?: number;
  payload?: unknown;
  counts?: Record<string, number>;
  audit?: unknown;
}
export interface RunCompletedEvent extends BaseEvent { type: 'run.completed'; message: string; counts?: Record<string, number>; }
export interface RunFailedEvent extends BaseEvent { type: 'run.failed'; message: string; code?: string; }
export interface RunCancelledEvent extends BaseEvent { type: 'run.cancelled'; message: string; }

export type ProgressiveBuildEvent =
  | RunStartedEvent
  | StageReadyEvent
  | FurnitureDetectedEvent
  | FurnitureVerifiedEvent
  | FurnitureReviewEvent
  | StageCompletedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunCancelledEvent;

export interface FurnitureEvidence {
  familyId: string;
  pos: [number, number];
  width: number;
  depth: number;
  rotation: number;
  zoneId: string | null;
  confidence: number;
  evidence: 'visible-symbol' | 'ambiguous-symbol';
  sourceBoxPx?: [number, number, number, number];
  sourceEntityId?: string;
  frameId?: string;
}

/** Validate an unknown payload as a ProgressiveBuildEvent (spec §3). */
export function validateEvent(value: unknown): ProgressiveBuildEvent | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const type = v.type;
  const runId = v.runId;
  const seq = v.sequence;
  const ts = v.timestamp;
  if (typeof type !== 'string') return null;
  const valid = new Set<ProgressiveEventClass>([
    'run.started', 'guide.ready', 'slab.ready', 'walls.ready', 'windows.ready',
    'doors.ready', 'furniture.detected', 'furniture.verified', 'furniture.review',
    'stage.completed', 'run.completed', 'run.failed', 'run.cancelled',
  ]);
  if (!valid.has(type as ProgressiveEventClass)) return null;
  if (typeof runId !== 'string' || typeof seq !== 'number' || typeof ts !== 'string') return null;
  switch (type) {
    case 'guide.ready': case 'slab.ready': case 'walls.ready': case 'windows.ready': case 'doors.ready':
      if (typeof v.stage !== 'string' || typeof v.message !== 'string') return null;
      break;
    case 'furniture.detected':
      if (typeof v.detected !== 'number') return null;
      break;
    case 'furniture.verified':
      if (typeof v.verified !== 'number') return null;
      break;
    case 'furniture.review':
      if (typeof v.message !== 'string') return null;
      break;
    case 'stage.completed':
      if (typeof v.stage !== 'string' || typeof v.message !== 'string') return null;
      break;
    case 'run.completed':
      if (typeof v.message !== 'string') return null;
      break;
    case 'run.failed':
      if (typeof v.message !== 'string') return null;
      break;
    case 'run.cancelled':
      if (typeof v.message !== 'string') return null;
      break;
    case 'run.started':
      break;
  }
  return value as ProgressiveBuildEvent;
}
