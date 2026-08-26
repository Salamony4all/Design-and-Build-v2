// features/project-export/ExportProgress.tsx
'use client';
import React from 'react';

const STEPS = [
  'Collecting drawings', 'Generating BOQ', 'Preparing FF&E schedule',
  'Building presentation', 'Adding renders', 'Validating files', 'Preparing download',
];

export function ExportProgress({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <aside className="db-export glass" aria-label="Export progress" aria-live="polite">
      <h4>Exporting…</h4>
      {STEPS.map((s, i) => (
        <div key={s} className="db-rail-details" style={{ borderTop: '1px solid var(--line)', padding: '5px 0' }}>
          <span>{s}</span><b>{i === 0 ? '…' : '·'}</b>
        </div>
      ))}
      <p className="db-pending-note">Development — provider migration pending. Presentation only.</p>
    </aside>
  );
}
