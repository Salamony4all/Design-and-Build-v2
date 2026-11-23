// features/viewer-interaction/SelectionPropertiesPanel.tsx
// What is selected: a short card with the element's name and size, a "Zoom
// to it" action and the technical details folded away. Hides when nothing is
// selected. Reads Pascal selection (read-only bridge) — never mutates the scene.

'use client';
import React from 'react';
import { Scan, X } from 'lucide-react';
import { useSelectionInfo, clearSelection, type SelectedNodeInfo } from './selection-context';

const TYPE_LABEL: Record<string, string> = {
  wall: 'Wall',
  door: 'Door',
  window: 'Window',
  slab: 'Floor slab',
  column: 'Column',
  item: 'Furniture',
  building: 'Building',
  level: 'Floor level',
  site: 'Site',
  guide: 'Plan drawing',
  stair: 'Stair',
  roof: 'Roof',
  zone: 'Room',
};

const PROP_LABEL: Record<string, string> = {
  lengthM: 'Length',
  heightM: 'Height',
  thicknessM: 'Thickness',
  widthM: 'Width',
  depthM: 'Depth',
  elevationM: 'Elevation',
  sillHeightM: 'Sill height',
  areaM2: 'Area',
  name: 'Name',
};

const label = (type: string) => TYPE_LABEL[type] ?? type.charAt(0).toUpperCase() + type.slice(1);

/** "3 walls", "18 pieces of furniture". */
const countOf = (type: string, n: number) =>
  type === 'item' ? `${n} ${n === 1 ? 'piece' : 'pieces'} of furniture` : `${n} ${label(type).toLowerCase()}${n > 1 ? 's' : ''}`;

function formatValue(key: string, v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    if (/m2$/i.test(key)) return `${v.toFixed(1)} m²`;
    if (/rot|deg/i.test(key)) return `${Math.round(v)}°`;
    return `${v.toFixed(2)} m`;
  }
  if (typeof v === 'object') return null;
  return String(v);
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="db-prop-row"><span className="k">{k}</span><span className="v">{v}</span></div>;
}

export function SelectionPropertiesPanel({ onZoomTo }: { onZoomTo?: () => void }) {
  const { selected } = useSelectionInfo();
  if (selected.length === 0) return null;

  if (selected.length > 1) {
    const byType: Record<string, number> = {};
    for (const s of selected) byType[s.nodeType] = (byType[s.nodeType] ?? 0) + 1;
    // Pieces of one product (BOQ Flow's legend selects them): name the product.
    const names = new Set(selected.map((s) => (s.nodeType === 'item' ? String(s.editableProperties.name ?? '') : '')));
    const product = names.size === 1 ? [...names][0] : '';
    return (
      <aside className="db-props glass" aria-label="Selection">
        <div className="db-props__head">
          <div>
            <h3>{product || `${selected.length} elements`}</h3>
            <p>{product ? `${selected.length} pieces in the model` : Object.entries(byType).map(([t, n]) => countOf(t, n)).join(', ')}</p>
          </div>
          <button type="button" className="db-icon-btn" onClick={clearSelection} aria-label="Clear the selection"><X size={16} /></button>
        </div>
        {onZoomTo && (
          <div className="db-props__actions">
            <button type="button" className="db-btn-quiet" onClick={onZoomTo}><Scan size={14} /> Zoom to them</button>
          </div>
        )}
      </aside>
    );
  }

  const w: SelectedNodeInfo = selected[0];
  const main: [string, string][] = [];
  const extra: [string, string][] = [];
  for (const [k, v] of Object.entries(w.editableProperties)) {
    const text = formatValue(k, v);
    if (text === null) continue;
    if (PROP_LABEL[k]) main.push([PROP_LABEL[k], text]);
    else extra.push([k, text]);
  }
  const lengthText = main.find(([k]) => k === 'Length')?.[1];
  const badge = w.reviewStatus === 'approved' ? 'ok' : w.reviewStatus === 'review' ? 'review' : w.reviewStatus === 'invalid' ? 'invalid' : 'unset';
  const status = w.reviewStatus === 'approved' ? 'Checked' : w.reviewStatus === 'review' ? 'Needs review' : w.reviewStatus === 'invalid' ? 'Problem' : null;

  return (
    <aside className="db-props glass" aria-label="Selection">
      <div className="db-props__head">
        <div>
          <h3>{label(w.nodeType)}</h3>
          <p>
            {lengthText ? `${lengthText} long` : 'Selected'}
            {status && <span className={`db-badge ${badge}`}>{status}</span>}
          </p>
        </div>
        <button type="button" className="db-icon-btn" onClick={clearSelection} aria-label="Clear the selection"><X size={16} /></button>
      </div>
      {main.filter(([k]) => k !== 'Length').map(([k, v]) => <Row key={k} k={k} v={v} />)}
      {onZoomTo && (
        <div className="db-props__actions">
          <button type="button" className="db-btn-quiet" onClick={onZoomTo}><Scan size={14} /> Zoom to it</button>
        </div>
      )}
      <details className="db-props__details">
        <summary>Details</summary>
        <Row k="ID" v={w.nodeId} />
        <Row k="Type" v={w.nodeType} />
        {w.semanticId && <Row k="Semantic ID" v={w.semanticId} />}
        {w.sourceRecordId && <Row k="Source record" v={w.sourceRecordId} />}
        {w.extractionMethod && <Row k="Read by" v={w.extractionMethod} />}
        {w.confidence !== undefined && <Row k="Confidence" v={`${(w.confidence * 100).toFixed(0)}%`} />}
        {w.physicalWallId && <Row k="Physical wall" v={w.physicalWallId} />}
        {w.sourcePrimitives && <Row k="Drawing lines" v={String(w.sourcePrimitives.length)} />}
        {extra.map(([k, v]) => <Row key={k} k={k} v={v} />)}
      </details>
    </aside>
  );
}
