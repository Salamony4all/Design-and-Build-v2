// features/project-export/ExportRail.tsx
// Full standalone Export Suite & Post-Build Geometric BOQ Control Rail.
'use client';
import React, { useState } from 'react';
import { isPilotCommercialExcluded } from '@/features/window-pilot/install-pilot-windows';
import type { GeometricTakeoff, StandaloneBoqRow } from '@/features/boq/geometric-takeoff';
import type { ProjectPlanMetaInput } from '@/features/project-export/dynamic-project-planner';
import type { StandaloneExportKind } from '@/features/project-export/standalone-export-suite';

const OPTIONS: { label: StandaloneExportKind; badge?: string }[] = [
  { label: 'BOQ Excel', badge: 'Post-Build' },
  { label: 'BOQ Summary', badge: 'PDF' },
  { label: 'Submittals (MAS/MIR/WIR/DN)', badge: 'ZIP' },
  { label: 'Project Plan (.xlsx)', badge: '10 Sheets' },
  { label: 'MS Project (.xml)', badge: 'MSPDI' },
  { label: 'Mood Board', badge: 'A3 PDF' },
  { label: 'Design & Build Presentation', badge: 'PPTX' },
  { label: 'FF&E Schedule', badge: 'XLSX' },
  { label: 'Drawing Package', badge: 'ZIP' },
  { label: 'Scene JSON', badge: '3D' },
  { label: 'Photorealistic Renders', badge: 'PNG' },
  { label: 'Extraction Audit', badge: '3D Takeoff' },
];

/** Enforce pilot exclusion on any node list before export/BOQ/schedule. */
export function filterCommercialNodes(nodes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (node && !isPilotCommercialExcluded(node)) out[id] = node;
  }
  return out;
}

export interface ExportRailProps {
  visible: boolean;
  onExport: (kind: StandaloneExportKind) => Promise<void> | void;
  onClose?: () => void;
  disabled?: boolean;
  projectMeta?: ProjectPlanMetaInput & { company?: string };
  onProjectMetaChange?: (next: ProjectPlanMetaInput & { company?: string }) => void;
  takeoff?: GeometricTakeoff | null;
  boqRows?: StandaloneBoqRow[];
  onBoqRowChange?: (id: string, patch: { qty?: number; rate?: number }) => void;
  exportStatus?: string | null;
  exportError?: string | null;
  busy?: boolean;
}

export function ExportRail({
  visible,
  onExport,
  onClose,
  disabled,
  projectMeta,
  onProjectMetaChange,
  takeoff,
  boqRows = [],
  onBoqRowChange,
  exportStatus,
  exportError,
  busy,
}: ExportRailProps) {
  const [showTakeoff, setShowTakeoff] = useState(false);

  if (!visible) return null;

  const meta = projectMeta || {};
  const setMeta = (patch: Partial<ProjectPlanMetaInput & { company?: string }>) => {
    onProjectMetaChange?.({ ...meta, ...patch });
  };
  const netTotal = boqRows.reduce((s, r) => s + Number(r.qty || 0) * Number(r.rate || 0), 0);

  return (
    <aside className="db-export glass" aria-label="Export project suite" style={{ width: showTakeoff ? 420 : 320 }}>
      <div className="db-export-head">
        <h4>Export Project Suite</h4>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{ width: 'auto', margin: 0, padding: '2px 8px' }}
            aria-label="Close export rail"
          >
            ✕
          </button>
        )}
      </div>

      {/* Standalone Project & Branding Quick Fields */}
      {onProjectMetaChange && (
        <div style={{ display: 'grid', gap: 5, marginBottom: 10, padding: 8, borderRadius: 10, background: 'rgba(248,250,252,0.8)', border: '1px solid var(--line)' }}>
          <input
            type="text"
            value={meta.projectName || ''}
            onChange={(e) => setMeta({ projectName: e.target.value })}
            placeholder="Project Name"
            style={{ width: '100%', padding: '5px 8px', fontSize: 11.5, borderRadius: 7, border: '1px solid var(--line-strong)', background: '#fff' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            <input
              type="text"
              value={meta.clientName || ''}
              onChange={(e) => setMeta({ clientName: e.target.value })}
              placeholder="Client Name"
              style={{ width: '100%', padding: '5px 8px', fontSize: 11, borderRadius: 7, border: '1px solid var(--line-strong)', background: '#fff' }}
            />
            <input
              type="text"
              value={meta.company || ''}
              onChange={(e) => setMeta({ company: e.target.value })}
              placeholder="Company / Contractor"
              style={{ width: '100%', padding: '5px 8px', fontSize: 11, borderRadius: 7, border: '1px solid var(--line-strong)', background: '#fff' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 78px 66px', gap: 5 }}>
            <input
              type="text"
              value={meta.locationZone || ''}
              onChange={(e) => setMeta({ locationZone: e.target.value })}
              placeholder="Location"
              style={{ width: '100%', padding: '5px 8px', fontSize: 11, borderRadius: 7, border: '1px solid var(--line-strong)', background: '#fff' }}
            />
            <input
              type="number"
              min={15}
              max={720}
              value={meta.contractDurationDays ?? ''}
              onChange={(e) => setMeta({ contractDurationDays: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Auto Days"
              title="Contract duration in days (blank = auto scale)"
              style={{ width: '100%', padding: '5px 6px', fontSize: 11, borderRadius: 7, border: '1px solid var(--line-strong)', background: '#fff' }}
            />
            <input
              type="text"
              value={meta.currency || 'OMR'}
              onChange={(e) => setMeta({ currency: e.target.value })}
              placeholder="OMR"
              style={{ width: '100%', padding: '5px 6px', fontSize: 11, borderRadius: 7, border: '1px solid var(--line-strong)', background: '#fff' }}
            />
          </div>
        </div>
      )}

      {/* Post-Build 3D Geometric Takeoff Summary & Inline BOQ Editor */}
      {takeoff && (
        <div style={{ marginBottom: 10, padding: 8, borderRadius: 10, background: 'rgba(239,246,255,0.85)', border: '1px solid rgba(37,99,235,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, fontWeight: 700, color: '#0f172a' }}>
            <span>3D Pure Takeoff ({takeoff.netFloorAreaM2.toFixed(1)} m²)</span>
            <button
              type="button"
              onClick={() => setShowTakeoff((v) => !v)}
              style={{ width: 'auto', margin: 0, padding: '2px 7px', fontSize: 10.5 }}
            >
              {showTakeoff ? 'Hide BOQ' : `Edit BOQ (${boqRows.length})`}
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: '#475569', marginTop: 4 }}>
            Wall paint {takeoff.solidWallNetPaintAreaM2.toFixed(1)} m² · Glass {takeoff.glassPartitionAreaM2.toFixed(1)} m² · {takeoff.doors.total} doors · Net {meta.currency || 'OMR'} {netTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </div>
          {showTakeoff && boqRows.length > 0 && (
            <div style={{ maxHeight: 210, overflowY: 'auto', marginTop: 8, background: '#fff', borderRadius: 8, border: '1px solid var(--line)', padding: 6 }}>
              {boqRows.map((row) => (
                <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '1fr 54px 64px', gap: 4, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #f1f5f9', fontSize: 10.5 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{row.code} · {row.brand}</div>
                    <div style={{ color: '#64748b', fontSize: 9.5 }}>{row.description.slice(0, 48)}</div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={row.qty}
                    onChange={(e) => onBoqRowChange?.(row.id, { qty: Number(e.target.value) || 0 })}
                    title={`Qty (${row.unit})`}
                    style={{ width: '100%', padding: '3px 4px', fontSize: 10.5, borderRadius: 5, border: '1px solid #cbd5e1', textAlign: 'right' }}
                  />
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={row.rate}
                    onChange={(e) => onBoqRowChange?.(row.id, { rate: Number(e.target.value) || 0 })}
                    title={`Rate (${meta.currency || 'OMR'})`}
                    style={{ width: '100%', padding: '3px 4px', fontSize: 10.5, borderRadius: 5, border: '1px solid #cbd5e1', textAlign: 'right' }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {OPTIONS.map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => void onExport(o.label)}
          disabled={disabled || busy}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span>{o.label}</span>
          {o.badge && <span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>{o.badge}</span>}
        </button>
      ))}
      <button
        type="button"
        className="suite"
        onClick={() => void onExport('Full Design & Build Package')}
        disabled={disabled || busy}
      >
        {busy ? 'Generating Package…' : 'Download Full Design & Build ZIP'}
      </button>

      {exportStatus && (
        <p style={{ fontSize: 11, color: '#0369a1', marginTop: 8, marginBottom: 0, fontWeight: 600 }}>{exportStatus}</p>
      )}
      {exportError && (
        <p style={{ fontSize: 11, color: '#b91c1c', marginTop: 6, marginBottom: 0 }}>{exportError}</p>
      )}
    </aside>
  );
}
