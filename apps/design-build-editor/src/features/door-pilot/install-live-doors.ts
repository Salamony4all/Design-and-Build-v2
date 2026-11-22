'use client';

import { DoorNode } from '@pascal-app/core';

/**
 * Live Pascal DoorNode installer for the verified Pure MuPDF door-extraction set.
 *
 * Mirrors installLiveWindows (Change Set 2, Gate C, live): each accepted door
 * carries the detector's host physicalWallId + a wall-local interval (centre +
 * width, METRES from endpoint A). We resolve the live WallNode by
 * EXACT_RUNTIME_WALL_MAPPING (metadata.physicalWallId), then place the DoorNode
 * in the host wall's LOCAL frame (the renderer expects wall-local position, never
 * world — see computeWallLocalWindowTransform / the verified pilot convention).
 *
 * DoorNode.position is wall-local (Y = height/2 at floor); rotation aligns to the
 * wall. We NEVER write world coordinates into position (that would double-transform
 * under the parent wall's world matrix), and we NEVER use annotation coordinates as
 * physical placement.
 *
 * DR-16 + any REVIEW/REJECT/ANNOTATION_ONLY records are excluded: only ACCEPT
 * assemblies with UNIQUE_HOST and an installable evidence mode are installed.
 */
export type LiveDoorContract = {
  doorAssemblyId: string;
  wallId: string;
  doorType: string;
  intervalStartM: number;
  intervalEndM: number;
  widthM: number;
  hingeSide: 'left' | 'right';
  swingDirection: 'inward' | 'outward';
  evidenceMode: 'GEOMETRY_ONLY' | 'ANNOTATION_ASSISTED_GEOMETRY_VERIFIED';
  annotationIds: string[];
  sourceSegmentIds: string[];
  sourceOperationIds: string[];
  provenance?: { sourcePrimitiveIds?: string[]; confidence?: number; extractionType?: string; note?: string };
};

export type LiveDoorInstallResult = {
  doorAssemblyId: string;
  physicalWallId: string;
  livePascalWallNodeId: string | null;
  doorNodeId: string | null;
  mappingStatus: 'EXACT_RUNTIME_WALL_MAPPING' | 'FAILED_RUNTIME_HOST';
  widthM: number;
  position: [number, number, number];
  rotation: [number, number, number];
  worldCentre: [number, number, number];
  reviewReason?: string;
};

export type LiveDoorInstallerContext = {
  nodes: Record<string, unknown>;
  createNodes: (ops: { node: unknown; parentId?: string }[]) => void;
  onProgress?: (installed: number, total: number) => void;
};

const PILOT_DEFAULTS = {
  height: 2.1,
  frameThickness: 0.05,
  frameDepth: 0.07,
  threshold: true,
  thresholdHeight: 0.02,
} as const;

const SOURCE_HASH = 'PURE_MUPDF_DOOR_EXTRACTOR';

function isWallLike(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  return (node as Record<string, unknown>).type === 'wall';
}

function readLiveWallData(node: unknown) {
  const n = node as Record<string, unknown>;
  return { start: (n.start ?? [0, 0]) as [number, number], end: (n.end ?? [0, 0]) as [number, number] };
}

function wallAngleRad(start: [number, number], end: [number, number]) {
  return Math.atan2(end[1] - start[1], end[0] - start[0]);
}

function wallLengthM(start: [number, number], end: [number, number]) {
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}

/**
 * Wall-local door placement (same convention as computeWallLocalWindowTransform):
 * local +X = along the wall from endpoint A toward B; local +Y = up; +Z = wall
 * normal (centred in thickness). centreFromA = (start+end)/2 metres FROM endpoint A.
 * Y is fixed at height/2 (floor-mounted leaf), matching DoorNode.schema.
 */
function computeWallLocalDoorTransform(
  start: [number, number],
  end: [number, number],
  intervalStartM: number,
  intervalEndM: number,
  doorCentreY: number,
) {
  const angle = wallAngleRad(start, end);
  const centreFromA = (intervalStartM + intervalEndM) / 2;
  const d = centreFromA;
  const worldCentre: [number, number, number] = [start[0] + d * Math.cos(angle), doorCentreY, start[1] + d * Math.sin(angle)];
  const localPosition: [number, number, number] = [d, doorCentreY, 0];
  const localRotation: [number, number, number] = [0, 0, 0];
  return { localPosition, localRotation, worldCentre, centreFromA };
}

export function installLiveDoors(ctx: LiveDoorInstallerContext, doors: LiveDoorContract[]): LiveDoorInstallResult[] {
  const results: LiveDoorInstallResult[] = [];
  const idsToCreate: { node: unknown; parentId: string }[] = [];

  for (const dr of doors) {
    // Resolve the live WallNode by EXACT_RUNTIME_WALL_MAPPING (metadata.physicalWallId).
    let liveId: string | null = null;
    const targetNorm = dr.wallId.replace(/^(w_|fr|wall_)/i, '');
    for (const [id, node] of Object.entries(ctx.nodes)) {
      if (!isWallLike(node)) continue;
      const meta = ((node as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>;
      const phys = (meta.physicalWallId ?? meta.physical_wall_id ?? id) as string;
      const physNorm = phys.replace(/^(w_|fr|wall_)/i, '');
      if (phys === dr.wallId || id === dr.wallId || (physNorm.length > 0 && physNorm === targetNorm)) {
        liveId = id;
        break;
      }
    }

    if (!liveId) {
      results.push({
        doorAssemblyId: dr.doorAssemblyId,
        physicalWallId: dr.wallId,
        livePascalWallNodeId: null,
        doorNodeId: null,
        mappingStatus: 'FAILED_RUNTIME_HOST',
        widthM: dr.widthM,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        worldCentre: [0, 0, 0],
      });
      if (typeof console !== 'undefined') {
        console.warn(`[LiveDoorInstaller] ${dr.doorAssemblyId} NO_HOST_WALL wallId=${dr.wallId}`);
      }
      continue;
    }

    const wallNode = ctx.nodes[liveId] as Record<string, unknown>;
    const { start, end } = readLiveWallData(wallNode);
    const wl = wallLengthM(start, end);
    // Clamp the wall-local interval defensively within the finite host wall.
    const intervalStartM = Math.max(0, Math.min(wl, dr.intervalStartM));
    const intervalEndM = Math.max(0, Math.min(wl, dr.intervalEndM));
    const doorCentreY = PILOT_DEFAULTS.height / 2;

    const { localPosition, localRotation, worldCentre, centreFromA } = computeWallLocalDoorTransform(
      start, end, intervalStartM, intervalEndM, doorCentreY,
    );

    const node = DoorNode.parse({
      id: `door_${dr.doorAssemblyId.replace(/[^a-zA-Z0-9_]/g, '_').slice(-12)}_${liveId.slice(-6)}`,
      name: `Door ${dr.wallId} ${dr.doorAssemblyId.slice(-6)}`,
      parentId: liveId,
      wallId: liveId,
      // Production door: participates in BOQ / schedules / exports like windows.
      status: 'AUTO_EXTRACTED_DOOR',
      metadata: {
        sourceDoorAssemblyId: dr.doorAssemblyId,
        physicalWallId: dr.wallId,
        sourceMappingHash: SOURCE_HASH,
        sourceHash: SOURCE_HASH,
        evidenceMode: dr.evidenceMode,
        annotationIds: dr.annotationIds,
        sourceSegmentIds: dr.sourceSegmentIds,
        sourceOperationIds: dr.sourceOperationIds,
        automaticExtraction: true,
        pilotDefaultsUsed: false,
        automaticPromotionAllowed: true,
        positionSource: 'WALL_LOCAL_INTERVAL_FROM_ENDPOINT_A',
        verticalPropertiesStatus: 'DEFAULT_NOT_SOURCE_MEASURED',
        heightSource: 'DOOR_SCHEMA_DEFAULT_NOT_SOURCE_MEASURED',
        doorCentreY,
        centreFromA,
        worldCentre,
        wallLocalIntervalStartM: intervalStartM,
        wallLocalIntervalEndM: intervalEndM,
      },
      width: dr.widthM,
      height: PILOT_DEFAULTS.height,
      frameThickness: PILOT_DEFAULTS.frameThickness,
      frameDepth: PILOT_DEFAULTS.frameDepth,
      threshold: PILOT_DEFAULTS.threshold,
      thresholdHeight: PILOT_DEFAULTS.thresholdHeight,
      hingesSide: dr.hingeSide,
      swingDirection: dr.swingDirection,
      position: localPosition,
      rotation: localRotation,
    } as never);

    idsToCreate.push({ node, parentId: liveId });

    // Append the DoorNode id to the host wall's children (Pascal scene-graph convention).
    const children = (wallNode.children as string[] | undefined) ?? [];
    if (!children.includes((node as Record<string, unknown>).id as string)) {
      children.push((node as Record<string, unknown>).id as string);
      wallNode.children = children;
    }

    results.push({
      doorAssemblyId: dr.doorAssemblyId,
      physicalWallId: dr.wallId,
      livePascalWallNodeId: liveId,
      doorNodeId: (node as Record<string, unknown>).id as string,
      mappingStatus: 'EXACT_RUNTIME_WALL_MAPPING',
      widthM: dr.widthM,
      position: localPosition,
      rotation: localRotation,
      worldCentre,
    });
  }

  if (idsToCreate.length > 0) {
    ctx.createNodes(idsToCreate as never);
  }

  let installed = 0;
  for (const r of results) {
    if (r.mappingStatus === 'EXACT_RUNTIME_WALL_MAPPING') installed += 1;
  }
  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log(
      `[LiveDoorInstaller] installed ${installed}/${results.length}`,
      results.map((r) => ({ door: r.doorAssemblyId, wall: r.physicalWallId, host: r.livePascalWallNodeId, node: r.doorNodeId, status: r.mappingStatus })),
    );
  }
  return results;
}

export function getLiveDoorInstallerStageText(installed: number, total: number): string {
  if (installed <= 0) return 'Installing detected doors';
  if (installed >= total) return 'Installed detected doors';
  return `Installing detected doors (${installed}/${total})`;
}
