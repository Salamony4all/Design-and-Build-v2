// features/project-export/ExportRail.tsx
// Export-suite presentation only. No real export generation in this change set.
// Execution is clearly marked as pending provider migration.
// Occupies the SAME right-side panel space as BuildProgressRail — the page
// guarantees at most one of the two is visible (right-rail exclusivity).
//
// PILOT-NODE POLICY (Step 10): WindowNodes created with
// `status: 'HUMAN_CONFIRMED_PILOT'` + `metadata.automaticPromotionAllowed:false`
// MUST NOT enter any commercial output — not BOQ, not schedules, not exports.
// The authoritative predicate lives in the window-pilot installer and is the
// single source of truth. Real export/schedule/BOQ stages MUST call
// `isPilotCommercialExcluded(node)` and drop matching nodes.

'use client';
import React from 'react';
import { isPilotCommercialExcluded } from '@/features/window-pilot/install-pilot-windows';

const OPTIONS = [
  'BOQ Excel', 'BOQ Summary', 'Mood Board', 'Design & Build Presentation',
  'Drawing Package', 'Scene JSON', 'Photorealistic Renders',
];

/** Enforce pilot exclusion on any node list before export/BOQ/schedule. */
export function filterCommercialNodes(nodes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (isPilotCommercialExcluded(node)) continue; // drop pilot windows
    out[id] = node;
  }
  return out;
}

export function ExportRail({ visible, onExport, onClose, disabled }: { visible: boolean; onExport: (kind: string) => void; onClose?: () => void; disabled?: boolean }) {
  if (!visible) return null;
  return (
    <aside className="db-export glass" aria-label="Export suite">
      <div className="db-export-head">
        <h4>Export Design &amp; Build package</h4>
        {onClose && (
          <button className="db-link" onClick={onClose} aria-label="Close export rail">×</button>
        )}
      </div>
      {OPTIONS.map((o) => (
        <button key={o} disabled={disabled} onClick={() => onExport(o)}>{o}</button>
      ))}
      <button className="suite" disabled={disabled} onClick={() => onExport('Full Design & Build Package')}>
        Export Full Suite ✦
      </button>
      <p className="db-pending-note">Development — provider migration pending. No files generated yet.</p>
      <p className="db-pending-note db-pilot-policy">
        Pilot windows (status <code>HUMAN_CONFIRMED_PILOT</code>) are excluded from BOQ, schedules, and exports via <code>isPilotCommercialExcluded</code>.
      </p>
    </aside>
  );
}
