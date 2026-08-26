'use client';

import { ColumnNode } from '@pascal-app/core';
import type { ColumnContract } from 'design-build-extraction-mupdf';

export type LiveColumnInstallResult = {
  physicalColumnId: string;
  columnNodeId: string | null;
  mappingStatus: 'INSTALLED' | 'SKIPPED_REVIEW' | 'SKIPPED_NONRECTANGULAR';
  position: [number, number, number];
  rotation: [number, number, number];
  widthM: number;
  depthM: number;
  heightM: number;
  worldCentre: [number, number, number];
};

export type LiveColumnInstallerContext = {
  nodes: Record<string, unknown>;
  /** Batch-create nodes under a parent id. Host wires this to useScene.createNodes. */
  createNodes: (ops: { node: unknown; parentId?: string }[]) => void;
  /** Column parent (level/root). Columns are top-level structural nodes, NOT wall children. */
  parentId: string;
  onProgress?: (installed: number, total: number) => void;
};

// Configurable default column height (metres). NOT source-measured.
export const COLUMN_DEFAULT_HEIGHT_M = 3;

/** Build a native Pascal ColumnNode from a proven rectangular ACCEPT contract. */
function buildColumnNode(
  c: ColumnContract,
  parentId: string,
  defaultHeightM: number,
): { node: unknown; worldCentre: [number, number, number] } {
  const cx = c.centreProjectM.x;
  const cz = c.centreProjectM.y;
  // World-space placement (same convention as live windows/columns): column
  // centre is the extracted project point; y lifts the mesh centre to half
  // height so the base sits on the slab.
  const position: [number, number, number] = [cx, defaultHeightM / 2, cz];
  const rotation: [number, number, number] = [0, c.rotationRad, 0];
  const crossSection: 'square' | 'rectangular' = Math.abs(c.widthM - c.depthM) < 0.02 ? 'square' : 'rectangular';

  const node = ColumnNode.parse({
    id: `column_${c.physicalColumnId}`,
    name: `Column ${c.physicalColumnId}`,
    parentId,
    type: 'column',
    position,
    rotation: c.rotationRad,
    crossSection,
    width: c.widthM,
    depth: c.depthM,
    height: defaultHeightM,
    radius: Math.min(c.widthM, c.depthM) / 2,
    style: 'faceted',
    status: 'AUTOMATIC_EXTRACTION',
    metadata: {
      physicalColumnId: c.physicalColumnId,
      sourceHash: (c as any).sourceHash ?? '',
      sourceSegmentIds: c.sourceSegmentIds,
      sourceOperationIds: c.sourceOperationIds,
      automaticExtraction: true,
      verticalPropertiesStatus: 'DEFAULT_NOT_SOURCE_MEASURED',
      positionSource: 'DEFAULT_NOT_SOURCE_MEASURED',
      heightSource: 'DEFAULT_NOT_SOURCE_MEASURED',
      footprintType: c.footprintType,
      verdict: c.verdict,
    },
  });
  return { node, worldCentre: [cx, defaultHeightM / 2, cz] };
}

/**
 * Batch-install all proven rectangular ACCEPT columns as native Pascal
 * ColumnNodes. Columns are structural: they are committed top-level under the
 * level/root (parentId), NEVER as children of walls, and NEVER represented as
 * short WallNodes. A single createNodes() call performs the whole batch — no
 * per-column scene rebuild.
 *
 * Only ACCEPT rectangular/square contracts are eligible (the frozen manifest).
 * REVIEW / non-rectangular records are NOT installed.
 */
export function installLiveColumns(
  ctx: LiveColumnInstallerContext,
  columns: ColumnContract[],
  defaultHeightM: number = COLUMN_DEFAULT_HEIGHT_M,
): LiveColumnInstallResult[] {
  const results: LiveColumnInstallResult[] = [];
  const idsToCreate: { node: unknown; parentId: string }[] = [];

  for (const c of columns) {
    // Eligibility: only proven rectangular/square ACCEPT columns.
    if (c.verdict !== 'ACCEPT' || c.footprintType !== 'RECTANGULAR') {
      results.push({
        physicalColumnId: c.physicalColumnId,
        columnNodeId: null,
        mappingStatus: c.footprintType === 'RECTANGULAR' ? 'SKIPPED_REVIEW' : 'SKIPPED_NONRECTANGULAR',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        widthM: c.widthM,
        depthM: c.depthM,
        heightM: defaultHeightM,
        worldCentre: [0, 0, 0],
      });
      continue;
    }

    const { node, worldCentre } = buildColumnNode(c, ctx.parentId, defaultHeightM);
    idsToCreate.push({ node, parentId: ctx.parentId });
    results.push({
      physicalColumnId: c.physicalColumnId,
      columnNodeId: (node as Record<string, unknown>).id as string,
      mappingStatus: 'INSTALLED',
      position: [c.centreProjectM.x, defaultHeightM / 2, c.centreProjectM.y],
      rotation: [0, c.rotationRad, 0],
      widthM: c.widthM,
      depthM: c.depthM,
      heightM: defaultHeightM,
      worldCentre: worldCentre as [number, number, number],
    });
  }

  if (idsToCreate.length > 0) {
    ctx.createNodes(idsToCreate);
  }

  let installed = 0;
  for (const r of results) {
    if (r.mappingStatus === 'INSTALLED') {
      installed += 1;
      if (typeof ctx.onProgress === 'function') ctx.onProgress(installed, results.length);
    }
  }

  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log(`[LiveColumnInstaller] installed ${installed}/${results.length}`);
  }
  return results;
}
