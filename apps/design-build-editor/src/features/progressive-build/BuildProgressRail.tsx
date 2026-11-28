// features/progressive-build/BuildProgressRail.tsx
// Geometric build status. The fine-grained construction stages from the page
// are grouped into four plain steps and shown in the shared BuildCard.

'use client';
import React from 'react';
import type { StageView } from './BuildStageRow';
import { BuildCard, combineStates, formatElapsed, sequenceSteps, stepProgress, type BuildStep, type BuildStepState } from './BuildCard';

export interface RailProps {
  visible: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  stages: StageView[];
  committed: number;
  total: number;
  elapsedMs: number;
  reviewCount: number;
  wallsInstalled?: number;
  wallsTotal?: number;
  wallsOriginal?: number;
  wallsCompletion?: number;
  wallsFinalized?: number;
  windowsInstalled?: number;
  windowsTotal?: number;
  windowsExtracted?: number;
  windowsEligible?: number;
  windowsFailed?: number;
  doorsInstalled?: number;
  doorsEligible?: number;
  doorsAuditReview?: number;
  doorDiagnosticReviewCount?: number;
  title?: string;
  /** Live text of the extraction step in progress. */
  detail?: string;
  /** Source file name. */
  fileName?: string;
  /** Extraction progress 0..100 while the drawing is being read. */
  percent?: number;
  /** The model is complete and validated. */
  done?: boolean;
  /** The build failed or stalled. */
  failed?: boolean;
  onRender?: () => void;
  onExport?: () => void;
  onCancel?: () => void;
}

const GROUPS: { key: string; label: string; stages: string[] }[] = [
  { key: 'read', label: 'Reading the drawing', stages: ['drawing', 'guide', 'slab'] },
  { key: 'walls', label: 'Walls', stages: ['original-walls', 'completion', 'finalize'] },
  { key: 'openings', label: 'Windows and doors', stages: ['windows', 'doors'] },
  { key: 'check', label: 'Checking the model', stages: ['structural-validation', 'opening-validation', 'final-validation', 'project-ready'] },
];

export function BuildProgressRail(p: RailProps) {
  if (!p.visible) return null;
  const byKey = new Map(p.stages.map((s) => [s.key, s]));
  const walls = p.wallsFinalized ?? p.wallsInstalled ?? p.committed;
  const windows = p.windowsInstalled ?? 0;
  const doors = p.doorsInstalled ?? 0;

  const steps: BuildStep[] = sequenceSteps(GROUPS.map((g) => {
    const states = g.stages
      .map((k) => byKey.get(k)?.status)
      .filter((s): s is StageView['status'] => !!s)
      .map((s) => s as BuildStepState);
    let state = combineStates(states);
    if (p.done) state = state === 'failed' ? 'failed' : state === 'review' ? 'review' : 'done';
    const value = g.key === 'walls' && walls > 0 ? String(walls)
      : g.key === 'openings' && windows + doors > 0 ? `${windows} · ${doors}`
        : undefined;
    return { key: g.key, label: g.label, state, value };
  }));

  const status: 'running' | 'done' | 'failed' = p.failed ? 'failed' : p.done ? 'done' : 'running';
  const fromSteps = stepProgress(steps);
  const fromExtraction = p.percent !== undefined ? (p.percent / 100) * 0.9 : 0;
  const review = (p.doorsAuditReview ?? 0) + (p.windowsFailed ?? 0);

  return (
    <BuildCard
      status={status}
      title={status === 'done' ? 'Model ready' : status === 'failed' ? 'Build stopped' : 'Building your model'}
      fileName={p.fileName}
      detail={p.detail}
      progress={status === 'done' ? 1 : Math.max(fromSteps, fromExtraction)}
      elapsed={p.elapsedMs > 0 ? formatElapsed(p.elapsedMs) : undefined}
      counts={[
        { label: 'Walls', value: walls },
        { label: 'Windows', value: windows },
        { label: 'Doors', value: doors },
      ]}
      steps={steps}
      collapsed={p.collapsed}
      onToggleCollapse={p.onToggleCollapse}
      onCancel={p.onCancel}
      onRender={p.onRender}
      onExport={p.onExport}
      ariaLabel="Build progress"
    >
      {review > 0 && status !== 'running' ? (
        <p className="db-bc__note">{review === 1 ? '1 opening was left for review' : `${review} openings were left for review`}</p>
      ) : null}
    </BuildCard>
  );
}
