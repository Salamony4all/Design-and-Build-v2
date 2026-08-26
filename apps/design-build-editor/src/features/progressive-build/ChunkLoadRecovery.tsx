// features/progressive-build/ChunkLoadRecovery.tsx
// S9: Chunk-load recovery UX. Shown ONLY when a ChunkLoadError (viewer Pascal
// module failed to load) is detected. The semantic model data is preserved; we
// surface a controllable reload action and diagnostics export. We must NOT show
// wall-map failure, extraction failure, or "Project Ready" — the run is halted.
'use client';
import React from 'react';

export interface ChunkLoadRecoveryProps {
  visible: boolean;
  error?: string;
  onReload: () => void;
  onExportDiagnostics?: () => void;
  onReturnToProject?: () => void;
}

export function ChunkLoadRecovery({ visible, error, onReload, onExportDiagnostics, onReturnToProject }: ChunkLoadRecoveryProps) {
  if (!visible) return null;
  return (
    <div className="db-chunk-recovery glass" role="alertdialog" aria-modal="false" aria-labelledby="chunk-recovery-title">
      <span className="db-chunk-recovery-icon" aria-hidden>⚠</span>
      <div className="db-chunk-recovery-body">
        <h3 id="chunk-recovery-title">The 3D renderer could not load an application module</h3>
        <p>Your model data is safe. Reload the application to continue.</p>
        {error ? <p className="db-chunk-recovery-detail"><code>{error}</code></p> : null}
        <div className="db-chunk-recovery-actions">
          <button className="db-btn primary" onClick={onReload}>Reload application</button>
          {onExportDiagnostics ? <button className="db-btn ghost" onClick={onExportDiagnostics}>Export diagnostics</button> : null}
          {onReturnToProject ? <button className="db-btn ghost" onClick={onReturnToProject}>Return to project</button> : null}
        </div>
      </div>
    </div>
  );
}
