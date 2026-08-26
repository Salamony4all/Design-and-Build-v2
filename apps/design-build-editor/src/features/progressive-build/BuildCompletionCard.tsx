// features/progressive-build/BuildCompletionCard.tsx
'use client';
import React from 'react';

export interface CompletionProps {
  visible: boolean;
  reviewCount: number;
  onReview: () => void;
  onRender: () => void;
  onExport: () => void;
  /** Dismiss the card (nonblocking, user-controlled). */
  onDismiss?: () => void;
  /** Active extraction provider label (e.g. "Pure MuPDF"). */
  provider?: string;
  /** Pilot window install results from the post-wall installer. */
  installedPilotWindows?: number;
  windowInstallResults?: Array<{
    anonymousRegionId: string;
    physicalWallId: string;
    livePascalWallNodeId: string | null;
    windowNodeId: string | null;
    mappingStatus: string;
    widthM: number;
  }>;
  windowInstallError?: string;
  // ── M2 semantic counts ──
  windowsExtracted?: number;
  windowsEligible?: number;
  windowsFailed?: number;
  doorsAccepted?: number;
  doorsAutoInstallable?: number;
  doorsAuditReview?: number;
  /** M4: 202 extraction candidates held for DIAGNOSTIC review only — never
   *  counted as production doors, eligible count, installer input, project-ready,
   *  or semantic node count. Shown separately, if needed. */
  diagnosticCandidates?: number;
  originalWalls?: number;
  completionWalls?: number;
  finalizedWalls?: number;
  wallMapPass?: boolean;
  validationPass?: boolean;
  projectReady?: 'PENDING' | 'READY';
}

export function BuildCompletionCard({ visible, reviewCount, onReview, onRender, onExport, onDismiss, provider, installedPilotWindows, windowInstallResults, windowInstallError, windowsExtracted, windowsEligible, windowsFailed, doorsAccepted, doorsAutoInstallable, doorsAuditReview, diagnosticCandidates, originalWalls, completionWalls, finalizedWalls, wallMapPass, validationPass, projectReady }: CompletionProps) {
  if (!visible) return null;
  const review = reviewCount > 0;
  const ready = projectReady === 'READY';
  return (
    <div className="db-complete glass" role="status" aria-live="polite">
      <span className="check" aria-hidden>✓</span>
      <div>
        <small>{ready ? 'BUILD COMPLETE' : 'BUILD IN PROGRESS'}{review ? ' — REVIEW RECOMMENDED' : ''}</small>
        <h2>{ready ? 'Your project is ready' : 'Finalizing the live model…'}</h2>
        <p>{ready
          ? 'Review the model, render, or export the Design & Build package.'
          : 'Waiting for wall map, window/door settlement, and validation to pass.'}</p>
        {provider && <p className="db-provider-label">Extracted with <b>{provider}</b></p>}
        {/* M2 wall breakdown — never one combined count. */}
        {finalizedWalls !== undefined && (
          <p className="db-provider-label">
            Walls: <b>{finalizedWalls}</b> finalized
            {originalWalls !== undefined && completionWalls !== undefined
              ? ` (original ${originalWalls} + completion ${completionWalls})`
              : ''}
            {wallMapPass === true ? ' · map ✓' : ''}
          </p>
        )}
        {/* M2: do NOT show "Windows 0 / 0" when windows are present in the model.
            Show the semantic extracted/eligible counts instead. */}
        {windowsExtracted !== undefined && (
          <p className="db-provider-label">
            Windows: detected <b>{windowsExtracted}</b>
            {windowsEligible !== undefined ? ` · eligible ${windowsEligible}` : ''}
            {installedPilotWindows !== undefined ? ` · installed ${installedPilotWindows}` : ''}
            {windowsFailed && windowsFailed > 0 ? ` · failed ${windowsFailed}` : ''}
          </p>
        )}
        {/* Door semantics: every accepted door is installation-eligible and reaches
            the installer. Review candidates (including AUDIT_GRANULARITY_CONFLICT
            records) are withheld, never counted as installed. The 202 extraction
            candidates are diagnostic-only — excluded from automatic installation
            and shown separately, never as production door reviews. */}
        {doorsAccepted !== undefined && (
          <p className="db-provider-label">
            Doors: <b>{doorsAccepted}</b> accepted
            {doorsAutoInstallable !== undefined ? ` · ${doorsAutoInstallable} auto-installable` : ''}
            {doorsAuditReview && doorsAuditReview > 0 ? ` · ${doorsAuditReview} production review candidates` : ''}
          </p>
        )}
        {/* The 202 extraction candidates are diagnostic-only — excluded from automatic
            installation. Shown separately, never as production door reviews. */}
        {diagnosticCandidates && diagnosticCandidates > 0 ? (
          <p className="db-provider-label">{diagnosticCandidates} diagnostic candidates excluded from automatic installation.</p>
        ) : null}
        {validationPass === true && <p className="db-provider-label">Live-model validation: <b>✓ passed</b></p>}
        {windowInstallError && (
          <p className="db-err" role="alert" style={{ marginTop: 8 }}>Window install error: {windowInstallError}</p>
        )}
      </div>
      <div className="actions">
        <button className="db-btn ghost" onClick={onReview}>Review project</button>
        <button className="db-btn primary" onClick={onRender}>Generate render</button>
        <button className="db-btn ghost" onClick={onExport}>Export</button>
      </div>
      {onDismiss && (
        <button className="db-complete-dismiss" onClick={onDismiss} aria-label="Dismiss completion card">×</button>
      )}
    </div>
  );
}
