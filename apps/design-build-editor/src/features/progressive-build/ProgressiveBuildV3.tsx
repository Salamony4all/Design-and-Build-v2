'use client';

import React, { useState } from 'react';
import type { BuildStage, FurnitureCandidate } from 'design-build-extraction-ai';

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
}

const ORDER: BuildStage[] = ['guide', 'slab', 'walls', 'windows', 'doors', 'furniture'];
const LABELS: Record<BuildStage, string> = {
  guide: 'Placing Guide',
  slab: 'Creating Slab',
  walls: 'Building Walls',
  windows: 'Installing Windows',
  doors: 'Installing Doors',
  furniture: 'Supplying Furniture',
};
const STATUS_COLOR: Record<StageStatus, string> = {
  pending: '#6b7280',
  running: '#3b82f6',
  completed: '#22c55e',
  review: '#f59e0b',
  failed: '#ef4444',
  cancelled: '#9ca3af',
};

function elapsed(s?: StageCardState): string {
  if (!s?.startedAt) return '';
  const end = s.completedAt ?? Date.now();
  const ms = Math.max(0, end - s.startedAt);
  return `${(ms / 1000).toFixed(1)}s`;
}

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

export function ProgressiveBuildV3({ active, runId, stages, review, onCancel, onAcceptReview, onRetryFurniture, wallMap, structural }: ProgressiveBuildV3Props) {
  const [collapsed, setCollapsed] = React.useState(false);
  if (!active) return null;
  const furniture = stages.furniture;
  const audit = furniture?.audit;

  const totalNodes =
    (stages.walls?.installed ?? 0) +
    (stages.windows?.installed ?? 0) +
    (stages.doors?.installed ?? 0) +
    (stages.furniture?.installed ?? 0) +
    (stages.slab?.installed ? 1 : 0);

  return (
    <aside className={`db-rail glass ${collapsed ? 'collapsed' : ''}`} aria-label="AI Progressive Build progress">
      <div className="db-rail-head">
        <div>
          <small>LIVE PROJECT BUILD</small>
          <h3>AI Progressive Build</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={onCancel}
            style={{
              background: '#fee2e2',
              color: '#dc2626',
              border: '1px solid #fecaca',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button className="db-link" onClick={() => setCollapsed((v) => !v)} aria-label="Collapse rail">
            {collapsed ? '▸' : '×'}
          </button>
        </div>
      </div>

      <div className="db-rail-summary">
        <div className="db-rail-counts">
          <div>Walls <b>{stages.walls?.installed ?? 0}</b> / {stages.walls?.total || (stages.walls?.installed ?? 0)}</div>
          <div>Windows <b>{stages.windows?.installed ?? 0}</b> / {stages.windows?.total || (stages.windows?.installed ?? 0)}</div>
          <div>Doors <b>{stages.doors?.installed ?? 0}</b> / {stages.doors?.total || (stages.doors?.installed ?? 0)}</div>
          {stages.furniture && (
            <div>Furniture <b>{stages.furniture.installed}</b> / {stages.furniture.total || stages.furniture.installed}</div>
          )}
          <div className="db-rail-total">Total validated Pascal nodes <b>{totalNodes}</b></div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '8px 0' }}>
        {ORDER.map((stage) => {
          const s = stages[stage];
          const color = STATUS_COLOR[s?.status ?? 'pending'];
          return (
            <div key={stage} className="db-stage-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderBottom: '1px solid var(--line, #e5e7eb)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{LABELS[stage]}</div>
                <div style={{ color: 'var(--muted, #64748b)', fontSize: 10 }}>
                  {s?.status === 'review' ? `review: ${s.review}` : s ? `${s.installed}/${s.total} installed` : 'pending'}
                  {elapsed(s) && ` · ${elapsed(s)}`}
                </div>
              </div>
              <span style={{ textTransform: 'uppercase', fontSize: 9, fontWeight: 700, color }}>{s?.status ?? 'pending'}</span>
            </div>
          );
        })}

        {/* Phase B §9: Runtime wall map */}
        <div className="db-stage-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderBottom: '1px solid var(--line, #e5e7eb)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: wallMap?.status === 'READY' ? '#22c55e' : wallMap ? '#f59e0b' : '#6b7280', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 12 }}>Mapping Wall Hosts</div>
            <div style={{ color: 'var(--muted, #64748b)', fontSize: 10 }}>
              {wallMap ? `${wallMap.entries.length} host mappings · ${wallMap.status}` : 'pending'}
            </div>
          </div>
          <span style={{ textTransform: 'uppercase', fontSize: 9, fontWeight: 700, color: wallMap?.status === 'READY' ? '#22c55e' : '#9ca3af' }}>{wallMap?.status ?? 'pending'}</span>
        </div>

        {/* Phase B §10: Structural validation */}
        <div className="db-stage-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: structural ? (structural.status === 'FAILED' ? '#ef4444' : '#22c55e') : '#6b7280', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 12 }}>Structural Validation</div>
            <div style={{ color: 'var(--muted, #64748b)', fontSize: 10 }}>
              {structural ? `${structural.status} · orphans ${(structural.orphanWindowCount ?? 0) + (structural.orphanDoorCount ?? 0)} · meta ${structural.metadataSchemaFailures ?? 0}` : 'pending'}
            </div>
          </div>
          <span style={{ textTransform: 'uppercase', fontSize: 9, fontWeight: 700, color: structural ? (structural.status === 'FAILED' ? '#ef4444' : '#22c55e') : '#9ca3af' }}>{structural?.status ?? 'pending'}</span>
        </div>
      </div>

      {audit && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--line, #e5e7eb)', fontSize: 10, color: 'var(--muted, #64748b)' }}>
          <div style={{ fontWeight: 600 }}>Furniture audit</div>
          <div>verified {audit.verified} · accepted {audit.accepted} · review {audit.review}</div>
        </div>
      )}

      {review.length > 0 && (
        <div style={{ marginTop: 8, borderTop: '1px solid var(--line, #e5e7eb)', paddingTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 12 }}>Review ({review.length})</strong>
            <button onClick={onRetryFurniture} style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 10 }}>Retry</button>
          </div>
          <div style={{ maxHeight: 140, overflowY: 'auto', marginTop: 4 }}>
            {review.map((item, i) => (
              <div key={item.sourceEntityId ?? i} style={{ background: 'rgba(241,245,249,0.7)', borderRadius: 6, padding: 6, marginBottom: 4, border: '1px solid var(--line, #e5e7eb)' }}>
                <div style={{ fontWeight: 600, fontSize: 11 }}>{item.type}</div>
                <div style={{ color: 'var(--muted, #64748b)', fontSize: 9 }}>conf {(item.confidence ?? 0).toFixed(2)} · {item.reason ?? 'review'}</div>
                <button onClick={() => onAcceptReview(item)} style={{ marginTop: 3, background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 10 }}>Accept</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
