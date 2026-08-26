// features/viewer-interaction/SelectionPropertiesPanel.tsx
// Left collapsible properties panel. Hides when nothing is selected.
// Reads Pascal selection (read-only bridge) — never mutates the scene.

'use client';
import React from 'react';
import { useSelectionInfo, clearSelection, type SelectedNodeInfo } from './selection-context';

function EditableProps({ props }: { props: Record<string, unknown> }) {
  const rows: [string, string][] = [];
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (typeof v === 'object') rows.push([k, JSON.stringify(v)]);
    else if (typeof v === 'number') rows.push([k, k.toLowerCase().includes('rot') || k.toLowerCase().includes('deg') ? `${v}°` : `${v.toFixed(2)} m`]);
    else rows.push([k, String(v)]);
  }
  if (rows.length === 0) return <div className="db-prop-row"><span className="k">Properties</span><span className="v">—</span></div>;
  return (
    <>
      {rows.map(([k, val]) => (
        <div className="db-prop-row" key={k}><span className="k">{k}</span><span className="v">{val}</span></div>
      ))}
    </>
  );
}

export function SelectionPropertiesPanel() {
  const { selected } = useSelectionInfo();
  if (selected.length === 0) return null;

  if (selected.length > 1) {
    const byType: Record<string, number> = {};
    for (const s of selected) byType[s.nodeType] = (byType[s.nodeType] ?? 0) + 1;
    return (
      <aside className="db-props glass" aria-label="Selection properties">
        <h3>{selected.length} elements selected</h3>
        <div className="sub">Multi-selection</div>
        {Object.entries(byType).map(([t, n]) => (
          <div className="db-prop-row" key={t}><span className="k">{t}</span><span className="v">{n}</span></div>
        ))}
        <div className="db-prop-row"><span className="k">Batch</span><span className="v">Fit Selection available</span></div>
        <button className="db-btn ghost" style={{ marginTop: 12 }} onClick={clearSelection}>Clear selection</button>
      </aside>
    );
  }

  const w: SelectedNodeInfo = selected[0];
  const badge = w.reviewStatus === 'approved' ? 'ok' : w.reviewStatus === 'review' ? 'review' : w.reviewStatus === 'invalid' ? 'invalid' : 'unset';
  return (
    <aside className="db-props glass" aria-label="Selection properties">
      <h3>{w.nodeType} properties</h3>
      <div className="sub">{w.nodeId}</div>
      <div className="db-prop-row"><span className="k">nodeId</span><span className="v">{w.nodeId}</span></div>
      <div className="db-prop-row"><span className="k">nodeType</span><span className="v">{w.nodeType}</span></div>
      {w.semanticId && <div className="db-prop-row"><span className="k">semanticId</span><span className="v">{w.semanticId}</span></div>}
      {w.sourceRecordId && <div className="db-prop-row"><span className="k">sourceRecordId</span><span className="v">{w.sourceRecordId}</span></div>}
      {w.extractionMethod && <div className="db-prop-row"><span className="k">extractionMethod</span><span className="v">{w.extractionMethod}</span></div>}
      <EditableProps props={w.editableProperties} />
      {w.confidence !== undefined && (
        <div className="db-prop-row"><span className="k">Confidence</span><span className="v">{(w.confidence * 100).toFixed(0)}%</span></div>
      )}
      {w.physicalWallId && (
        <div className="db-prop-row"><span className="k">physicalWallId</span><span className="v">{w.physicalWallId}</span></div>
      )}
      {w.sourcePrimitives && (
        <div className="db-prop-row"><span className="k">Source primitives</span><span className="v">{w.sourcePrimitives.length}</span></div>
      )}
      <div className="db-prop-row"><span className="k">Review</span><span className="v"><span className={`db-badge ${badge}`}>{w.reviewStatus.toUpperCase()}</span></span></div>
      <button className="db-btn ghost" style={{ marginTop: 12 }} onClick={clearSelection}>Clear selection</button>
    </aside>
  );
}
