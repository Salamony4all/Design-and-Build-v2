// features/progressive-build/BuildProgressRail.tsx
// Real progressive-build rail. Driven by the frozen import event log.
// Only stages that actually run are shown (windows/doors/furniture are NOT
// shown during the frozen fixture, per spec).

'use client';
import React from 'react';
import { BuildStageRow, type StageView } from './BuildStageRow';

export interface RailProps {
  visible: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  stages: StageView[];
  committed: number;
  total: number;
  elapsedMs: number;
  reviewCount: number;
  /** real installed-element counts for the live progress summary (§12). */
  wallsInstalled?: number;
  wallsTotal?: number;
  /** M2: explicit wall breakdown — do NOT show one combined count. */
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
  /** Project title — never a hardcoded CODE-06 / filename; derived from the active build. */
  title?: string;
}

function fmtElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function BuildProgressRail({ visible, collapsed, onToggleCollapse, stages, committed, total, elapsedMs, reviewCount, wallsInstalled, wallsTotal, wallsOriginal, wallsCompletion, wallsFinalized, windowsInstalled, windowsTotal, windowsExtracted, windowsEligible, windowsFailed, doorsInstalled, doorsEligible, doorsAuditReview, doorDiagnosticReviewCount, title }: RailProps) {
  if (!visible) return null;
  const projectTitle = title && title.trim().length > 0 ? title : 'Live Project Build';
  const showBreakdown =
    wallsInstalled !== undefined && windowsInstalled !== undefined && doorsInstalled !== undefined;
  const totalValidated =
    (wallsInstalled ?? 0) + (windowsInstalled ?? 0) + (doorsInstalled ?? 0);
  return (
    <aside className={`db-rail glass ${collapsed ? 'collapsed' : ''}`} aria-label="Build progress">
      <div className="db-rail-head">
        <div>
          <small>LIVE PROJECT BUILD</small>
          <h3>{projectTitle}</h3>
        </div>
        <button className="db-link" onClick={onToggleCollapse} aria-label="Collapse rail">
          {collapsed ? '▸' : '×'}
        </button>
      </div>
      <div className="db-rail-summary">
        {showBreakdown ? (
          <div className="db-rail-counts">
            <div>Walls <b>{wallsInstalled}</b> / {wallsTotal ?? wallsInstalled}</div>
            {wallsOriginal !== undefined && wallsCompletion !== undefined && wallsFinalized !== undefined ? (
              <div className="db-rail-sub">
                <span>original {wallsOriginal}</span>
                <span>completion {wallsCompletion}</span>
                <span>finalized {wallsFinalized}</span>
              </div>
            ) : null}
            {/* M2: do NOT show "Windows 0 / 0" when WindowNodes exist — show the
                semantic extracted/eligible counts instead. */}
            <div>Windows <b>{windowsInstalled}</b> / {windowsTotal ?? windowsInstalled}</div>
            {windowsExtracted !== undefined ? (
              <div className="db-rail-sub">
                <span>extracted {windowsExtracted}</span>
                {windowsEligible !== undefined ? <span>eligible {windowsEligible}</span> : null}
                {windowsFailed && windowsFailed > 0 ? <span>failed {windowsFailed}</span> : null}
              </div>
            ) : null}
            <div>Doors <b>{doorsInstalled}</b> / {doorsEligible ?? doorsInstalled}{doorsAuditReview ? <span className="db-review"> (+{doorsAuditReview} audit review)</span> : null}</div>
            {doorsAuditReview && doorsAuditReview > 0 ? (
              <div className="db-rail-sub"><span>{doorsAuditReview} production review candidates (not auto-installed)</span></div>
            ) : null}
            {doorDiagnosticReviewCount && doorDiagnosticReviewCount > 0 ? (
              <div className="db-rail-sub"><span>{doorDiagnosticReviewCount} diagnostic candidates excluded from automatic installation</span></div>
            ) : null}
            <div className="db-rail-total">Total validated Pascal nodes <b>{totalValidated}</b></div>
            {reviewCount ? <div className="db-rail-sub"><span>{reviewCount} candidate review evidence</span></div> : null}
          </div>
        ) : (
          <>
            <b>{committed}</b>
            <span>/ {total} validated Pascal nodes</span>
          </>
        )}
      </div>
      {stages.map((s) => <BuildStageRow key={s.key} stage={s} />)}
      <div className="db-rail-details">
        <span>Elapsed</span>
        <b>{fmtElapsed(elapsedMs)}</b>
      </div>
    </aside>
  );
}
