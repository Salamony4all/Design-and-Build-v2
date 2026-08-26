// features/viewer-interaction/selection-context.ts
//
// Read-only bridge to the official Pascal Viewer selection state. The UI may
// READ which Pascal nodes are selected and DISPLAY their properties, but it
// must NOT mutate the scene directly. Selection itself is performed by the
// official Pascal Viewer (click / Ctrl-click). For programmatic selection
// (Fit Selection, clear), we call the Viewer's own setSelection/resetSelection
// — never a scene mutation.

import { useViewer } from '@pascal-app/viewer';
import { useScene } from '@pascal-app/core';

/**
 * Generic selected-node shape (spec Phase 7). Surfaces, for ANY selected Pascal
 * node, the fields the Editor review/property UI needs:
 *   nodeId, nodeType, semanticId, sourceRecordId, extractionMethod,
 *   editableProperties, reviewStatus.
 * Walls additionally carry MuPDF geometric provenance when present.
 *
 * This is a SINGLE selection bridge over the existing Viewer-driven selection
 * (useViewer selection.selectedIds + useScene nodes). No second selection system.
 */
export interface SelectedNodeInfo {
  nodeId: string;
  nodeType: string;
  semanticId: string | null;
  sourceRecordId: string | null;
  extractionMethod: string | null;
  editableProperties: Record<string, unknown>;
  reviewStatus: 'approved' | 'review' | 'invalid' | 'unset';
  // MuPDF geometric provenance (walls only; optional)
  physicalWallId?: string | null;
  confidence?: number;
  sourcePrimitives?: string[];
  provider?: string;
}

function num(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/** Read currently-selected nodes and derive display properties (all types). */
export function useSelectionInfo(): { selected: SelectedNodeInfo[]; selectedIds: string[] } {
  const selectedIds = useViewer((s) => s.selection.selectedIds);
  const nodes = useScene((s) => s.nodes) as unknown as Record<string, { type?: string; data?: Record<string, unknown>; metadata?: Record<string, unknown>; parentId?: string; visible?: boolean }>;

  const selected: SelectedNodeInfo[] = [];
  for (const id of selectedIds) {
    const node = nodes[id] as any;
    if (!node) continue;
    const type = node.type ?? 'unknown';
    const data = (node.data ?? {}) as Record<string, unknown>;
    const meta = (node.metadata ?? {}) as Record<string, unknown>;
    const conf = typeof meta.confidence === 'number' ? meta.confidence : (typeof data.confidence === 'number' ? data.confidence : 1);
    const props: Record<string, unknown> = {};

    if (type === 'wall') {
      const start = node.start ?? data.start;
      const end = node.end ?? data.end;
      if (Array.isArray(start) && Array.isArray(end)) {
        props.lengthM = Math.hypot(num(end[0]) - num(start[0]), num(end[1]) - num(start[1]));
      }
      if (node.thickness !== undefined || data.thickness !== undefined) {
        props.thicknessM = num(node.thickness ?? data.thickness);
      }
      if (node.height !== undefined || data.height !== undefined) {
        props.heightM = num(node.height ?? data.height);
      }
    } else if (type === 'item') {
      if (node.asset?.name || node.name) {
        props.name = node.asset?.name ?? node.name;
      }
      if (node.position || data.positionM) {
        const p = node.position ?? data.positionM;
        if (Array.isArray(p)) {
          props.positionM = { x: num(p[0]), y: num(p[1]), z: num(p[2]) };
        } else if (typeof p === 'object' && p !== null) {
          props.positionM = p;
        }
      }
      if (node.rotation) {
        const rotY = Array.isArray(node.rotation) ? num(node.rotation[1]) : 0;
        props.rotationDeg = Math.round((rotY * 180) / Math.PI);
      }
      if (node.asset?.dimensions) {
        props.dimensions = node.asset.dimensions.map((d: number) => num(d).toFixed(2)).join(' × ') + ' m';
      }
    } else if (type === 'door' || type === 'window') {
      if (node.parentId) {
        props.hostWallId = node.parentId;
      }
      if (node.width !== undefined || data.widthM !== undefined || data.width !== undefined) {
        props.widthM = num(node.width ?? data.widthM ?? data.width);
      }
      if (node.height !== undefined || data.heightM !== undefined || data.height !== undefined) {
        props.heightM = num(node.height ?? data.heightM ?? data.height);
      }
      if (node.elevation !== undefined || data.sillM !== undefined || data.elevation !== undefined) {
        props.sillM = num(node.elevation ?? data.sillM ?? data.elevation);
      }
    } else if (type === 'slab') {
      if (node.thickness !== undefined) props.thicknessM = num(node.thickness);
      if (node.elevation !== undefined) props.elevationM = num(node.elevation);
    } else if (type === 'guide') {
      props.visible = node.visible !== false ? 'Visible' : 'Hidden';
      if (node.opacity !== undefined) props.opacity = `${Math.round(num(node.opacity) * 100)}%`;
    }

    const review = (meta.reviewStatus as string) ?? (meta.review as string) ?? (typeof conf === 'number' ? (conf < 0.5 ? 'invalid' : conf < 0.75 ? 'review' : 'approved') : 'unset');
    selected.push({
      nodeId: id,
      nodeType: type,
      semanticId: (meta.semanticId as string) ?? (meta.physicalWallId as string) ?? null,
      sourceRecordId: (meta.sourceRecordId as string) ?? null,
      extractionMethod: (meta.extractionMethod as string) ?? (meta.source as string) ?? null,
      editableProperties: props,
      reviewStatus: (review === 'invalid' || review === 'review' || review === 'approved' ? (review as SelectedNodeInfo['reviewStatus']) : 'unset'),
      ...(type === 'wall' ? {
        physicalWallId: (meta.physicalWallId as string) ?? null,
        confidence: conf,
        sourcePrimitives: (meta.sourcePrimitiveIds as string[]) ?? [],
        provider: 'Pure MuPDF (frozen)',
      } : {}),
    });
  }
  return { selected, selectedIds };
}

/** Frame the currently-selected building objects (delegates to host framing). */
export function selectNodes(ids: string[]) {
  const v = useViewer.getState();
  v.setSelection({ selectedIds: ids });
}
export function clearSelection() {
  useViewer.getState().resetSelection();
}
