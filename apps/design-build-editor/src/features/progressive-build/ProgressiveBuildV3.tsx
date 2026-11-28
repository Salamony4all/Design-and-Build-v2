'use client';

import React from 'react';
import type { BuildStage, FurnitureCandidate } from 'design-build-extraction-ai';
import { BuildCard, combineStates, formatElapsed, sequenceSteps, stepProgress, type BuildStep, type BuildStepState } from './BuildCard';

export type StageStatus = 'pending' | 'running' | 'completed' | 'review' | 'failed' | 'cancelled';

// Fine-grained lifecycle for the Guide stage so the UI can distinguish node
// creation from actual texture readiness (Phase A). Only states with a real
// observable signal are exposed:
//  - node-created: GuideNode installed (guide.ready handled)
//  - texture-ready: Viewer emitted 'guide:texture-ready' (texture resolved)
//  - failed: Viewer emitted 'guide:texture-failed' or install threw
// Non-observable states (texture-loading/rendered) are intentionally omitted.
export type GuideLifecycle = 'node-created' | 'texture-ready' | 'failed';

export interface StageCardState {
  status: StageStatus;
  /** Guide-only fine-grained lifecycle (truthful readiness signal). */
  lifecycle?: GuideLifecycle;
  startedAt?: number;
  completedAt?: number;
  installed: number;
  total: number;
  review: number;
  message?: string;
  audit?: Record<string, number>;
}

export interface ProgressiveBuildV3Props {
  active: boolean;
  runId: string | null;
  stages: Record<BuildStage, StageCardState>;
  review: FurnitureCandidate[];
  onCancel: () => void;
  onAcceptReview: (item: FurnitureCandidate) => void;
  onRetryFurniture: () => void;
  /** Phase B runtime wall map (installation artifact) — shown as a build stage. */
  wallMap?: import('@/harness/ai-scene-install/runtime-wall-map').RuntimeWallMapBuild | null;
  /** Phase B structural validation result. */
  structural?: import('@/harness/ai-scene-install/structural-validation').StructuralValidationResult | null;
  /** Live text of the extraction step in progress. */
  detail?: string;
  /** Source file name. */
  fileName?: string;
  /** Photoreal render shortcut, shown once the model is ready. */
  onRender?: () => void;
  /** Open the export suite rail once the model is ready. */
  onExport?: () => void;
  /** Hide while another right-side panel is open. */
  hidden?: boolean;
}

const ORDER: BuildStage[] = ['guide', 'slab', 'walls', 'windows', 'doors', 'furniture'];

/**
 * Truthful Guide lifecycle transitions (Phase A, Step 6).
 *
 * The only observable signals are:
 *  - 'node-created': the GuideNode was installed (guide.ready handled, no texture yet)
 *  - 'texture-ready': the Viewer emitted 'guide:texture-ready' (texture resolved)
 *  - 'failed': install threw or the Viewer emitted 'guide:texture-failed'
 *
 * 'guide.ready' MUST NOT mark the stage completed — only 'texture-ready' does.
 * A 'failed' signal never retroactively becomes completed. This is a pure function
 * so it can be unit-tested without rendering React.
 */
export type GuideReadinessSignal = 'node-created' | 'texture-ready' | 'failed';

export function applyGuideReadiness(
  prev: StageCardState,
  signal: GuideReadinessSignal,
  now: number = Date.now(),
): StageCardState {
  switch (signal) {
    case 'node-created':
      // Node exists but texture is not confirmed — stay running.
      return { ...prev, status: 'running', lifecycle: 'node-created', startedAt: prev.startedAt ?? now };
    case 'texture-ready':
      // Only complete if we haven't already failed — a prior failure is terminal
      // (Guide failure must not be hidden or retroactively marked ready).
      if (prev.status === 'failed') return prev;
      return { ...prev, status: 'completed', lifecycle: 'texture-ready', completedAt: now, installed: prev.total || 1, total: prev.total || 1 };
    case 'failed':
      return { ...prev, status: 'failed', lifecycle: 'failed' };
    default:
      return prev;
  }
}

/**
 * Run-scoped Guide signal acceptance (Phase A, Step 3). A 'guide:texture-ready' /
 * 'guide:texture-failed' callback is applied ONLY when all of these hold:
 *  - the event runId matches the active run;
 *  - the event guideId matches the active Guide node id;
 *  - the run has not been cancelled;
 *  - the Guide stage has not already resolved (no duplicate / resurrection).
 *
 * Pure + testable so the inline emitter adapter in page.tsx can delegate to it.
 */
export interface GuideSignalContext {
  activeRunId: string | null;
  activeGuideId: string | null;
  cancelled: boolean;
  alreadyResolved: boolean;
}

export function guideSignalApplicable(
  event: { runId?: string; guideId: string },
  ctx: GuideSignalContext,
): boolean {
  if (ctx.cancelled) return false;
  if (ctx.alreadyResolved) return false;
  if (event.runId !== ctx.activeRunId) return false;
  if (event.guideId !== ctx.activeGuideId) return false;
  return true;
}

export function ProgressiveBuildV3({ active, stages, review, onCancel, onAcceptReview, onRetryFurniture, wallMap, structural, detail, fileName, onRender, onExport, hidden }: ProgressiveBuildV3Props) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [showReview, setShowReview] = React.useState(false);
  if (!active || hidden) return null;

  const settled = (s?: StageCardState) => !!s && (s.status === 'completed' || s.status === 'review' || s.status === 'failed' || s.status === 'cancelled');
  const toStep = (s?: StageCardState): BuildStepState =>
    !s ? 'pending'
      : s.status === 'completed' ? 'done'
        : s.status === 'running' ? 'active'
          : s.status === 'review' ? 'review'
            : s.status === 'failed' ? 'failed'
              : 'pending';
  const furniture = stages.furniture;
  const hasFurniture = !!furniture && (furniture.total > 0 || furniture.installed > 0 || furniture.status === 'running');
  const checkState: BuildStepState = structural
    ? (structural.status === 'FAILED' ? 'failed' : 'done')
    : wallMap ? 'active' : 'pending';

  const steps: BuildStep[] = sequenceSteps([
    { key: 'read', label: 'Reading the drawing', state: combineStates([toStep(stages.guide), toStep(stages.slab)]) },
    { key: 'walls', label: 'Walls', state: toStep(stages.walls), value: stages.walls?.installed ? String(stages.walls.installed) : undefined },
    {
      key: 'openings', label: 'Windows and doors', state: combineStates([toStep(stages.windows), toStep(stages.doors)]),
      value: (stages.windows?.installed ?? 0) + (stages.doors?.installed ?? 0) > 0 ? `${stages.windows?.installed ?? 0} · ${stages.doors?.installed ?? 0}` : undefined,
    },
    ...(hasFurniture ? [{ key: 'furniture', label: 'Furniture', state: toStep(furniture), value: furniture.installed ? String(furniture.installed) : undefined }] : []),
    { key: 'check', label: 'Checking the model', state: checkState },
  ]);

  const allSettled = ORDER.every((k) => settled(stages[k]) || (k === 'furniture' && !hasFurniture));
  const anyStarted = ORDER.some((k) => stages[k] && stages[k].status !== 'pending');
  const failed = ORDER.some((k) => stages[k]?.status === 'failed' && k !== 'furniture');
  const status: 'running' | 'done' | 'failed' = failed ? 'failed' : allSettled && anyStarted ? 'done' : 'running';
  const starts = ORDER.map((k) => stages[k]?.startedAt).filter((v): v is number => typeof v === 'number');
  const ends = ORDER.map((k) => stages[k]?.completedAt ?? (stages[k]?.startedAt ? Date.now() : undefined)).filter((v): v is number => typeof v === 'number');
  const elapsedMs = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : 0;

  return (
    <BuildCard
      status={status}
      title={status === 'done' ? 'Model ready' : status === 'failed' ? 'Build stopped' : 'Building with AI'}
      fileName={fileName}
      detail={detail}
      progress={status === 'done' ? 1 : stepProgress(steps)}
      elapsed={elapsedMs > 0 ? formatElapsed(elapsedMs) : undefined}
      counts={[
        { label: 'Walls', value: stages.walls?.installed ?? 0 },
        { label: 'Windows', value: stages.windows?.installed ?? 0 },
        { label: 'Doors', value: stages.doors?.installed ?? 0 },
        ...(hasFurniture ? [{ label: 'Furniture', value: furniture.installed }] : []),
      ]}
      steps={steps}
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed((v) => !v)}
      onCancel={onCancel}
      onRender={onRender}
      onExport={onExport}
      ariaLabel="AI build progress"
    >
      {review.length > 0 && (
        <div className="db-bc__review">
          <button type="button" className="db-bc__review-toggle" onClick={() => setShowReview((v) => !v)} aria-expanded={showReview}>
            {review.length === 1 ? '1 item to review' : `${review.length} items to review`}
            <span aria-hidden>{showReview ? '▴' : '▾'}</span>
          </button>
          {showReview && (
            <ul>
              {review.map((item, i) => (
                <li key={item.sourceEntityId ?? i}>
                  <span>
                    <b>{item.type}</b>
                    <small>{Math.round((item.confidence ?? 0) * 100)}% sure{item.reason ? ` · ${item.reason}` : ''}</small>
                  </span>
                  <button type="button" className="db-btn-quiet" onClick={() => onAcceptReview(item)}>Add</button>
                </li>
              ))}
              <li className="db-bc__review-retry">
                <button type="button" className="db-link" onClick={onRetryFurniture}>Try furniture again</button>
              </li>
            </ul>
          )}
        </div>
      )}
    </BuildCard>
  );
}
