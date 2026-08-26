// harness/building-frame.ts
// One authoritative BuildingFrameContract shared by Guide AND slab AND walls.
// Derived ONCE from the verified architectural building footprint (NOT the full
// PDF page, NOT title block / sheet border / notes / legends / dimensions /
// revision tables / north arrow / empty margins / unrelated details).
//
// All downstream geometry (Guide plane, slab polygon, wall centre-lines) uses
// the SAME coordinate-frame conversion and the SAME building centre, so they
// are permanently aligned.

import type { Bounds } from 'design-build-coordinate-frame';
import { createCoordinateFrame, type CoordinateFrame } from 'design-build-coordinate-frame';

export interface BuildingFrameContract {
  frameId: string;
  sourceHash: string;
  /** Full PDF page bounds in points [x0,y0,x1,y1]. */
  pageBoundsPt: Bounds;
  /** Verified architectural building footprint bounds in points [x0,y0,x1,y1]. */
  activeRegionPt: Bounds;
  /** Centre of the verified building footprint in PDF points. */
  buildingCentrePt: [number, number];
  /** Millimetres per PDF point (Pure MuPDF document metric). */
  scaleMmPerPt: number;
  /** Project world origin in metres (Pascal world). Equals building centre. */
  projectOriginM: [number, number];
  /** Guide/slab footprint width in metres (active-region x extent). */
  widthM: number;
  /** Guide/slab footprint depth in metres (active-region y extent). */
  depthM: number;
  /** PDF->world rotation (degrees). 0 for axis-aligned CODE_06. */
  rotation: number;
  /** PDF Y-axis inversion flag (Pascal world mirrors PDF Y). */
  invertY: boolean;
}

const MM_PER_M = 1000;

/**
 * Compute the authoritative BuildingFrameContract from the verified building
 * footprint (active-region bounds in PDF points) + document metrics.
 * `scaleMmPerPt` comes from the Pure MuPDF route (documentFrameFromPure).
 */
export function computeBuildingFrame(args: {
  frameId: string;
  sourceHash: string;
  pageBoundsPt: Bounds;
  activeRegionPt: Bounds;
  scaleMmPerPt: number;
  rotation?: number;
  invertY?: boolean;
}): BuildingFrameContract {
  const { frameId, sourceHash, pageBoundsPt, activeRegionPt, scaleMmPerPt } = args;
  const widthM = ((activeRegionPt[2] - activeRegionPt[0]) * scaleMmPerPt) / MM_PER_M;
  const depthM = ((activeRegionPt[3] - activeRegionPt[1]) * scaleMmPerPt) / MM_PER_M;
  const buildingCentrePt: [number, number] = [
    (activeRegionPt[0] + activeRegionPt[2]) / 2,
    (activeRegionPt[1] + activeRegionPt[3]) / 2,
  ];
  // The single coordinate-frame conversion (verified CODE_06 alignment,
  // round-trip error = 0). toPascal maps PDF points -> Pascal world (X,Z).
  const cf = createCoordinateFrame({
    pageBoundsPt,
    scaleMmPerPt,
    pageWidthM: ((pageBoundsPt[2] - pageBoundsPt[0]) * scaleMmPerPt) / MM_PER_M,
    pageHeightM: ((pageBoundsPt[3] - pageBoundsPt[1]) * scaleMmPerPt) / MM_PER_M,
  });
  const [cx, cz] = cf.toPascal(buildingCentrePt[0], buildingCentrePt[1]);
  return {
    frameId,
    sourceHash,
    pageBoundsPt,
    activeRegionPt,
    buildingCentrePt,
    scaleMmPerPt,
    projectOriginM: [cx, cz],
    widthM,
    depthM,
    rotation: args.rotation ?? 0,
    invertY: args.invertY ?? false,
  };
}

/** The shared coordinate-frame conversion for this building frame. */
export function frameToCoordinateFrame(contract: BuildingFrameContract): CoordinateFrame {
  return createCoordinateFrame({
    pageBoundsPt: contract.pageBoundsPt,
    scaleMmPerPt: contract.scaleMmPerPt,
    pageWidthM: ((contract.pageBoundsPt[2] - contract.pageBoundsPt[0]) * contract.scaleMmPerPt) / MM_PER_M,
    pageHeightM: ((contract.pageBoundsPt[3] - contract.pageBoundsPt[1]) * contract.scaleMmPerPt) / MM_PER_M,
  });
}

/**
 * Guide placement in Pascal world. The GuideNode renderer (pascal-app/nodes
 * guide/renderer.js — DO NOT MODIFY) builds a base plane that is 10m wide and
 * multiplies BOTH dimensions by `scale`:
 *     planeWidth  = 10 * scale
 *     planeHeight = (10 / imageAspect) * scale
 * So to size the guide to the building footprint (widthM x depthM) we must pass
 *     scale = widthM / 10
 * The cropped guide PNG already carries the widthM:depthM aspect ratio, so the
 * height resolves to depthM exactly. Position is the building centre (same
 * origin as slab + walls) so the guide lands on the slab. Centring is applied
 * EXACTLY ONCE here.
 */
export function guideWorldPlacement(
  contract: BuildingFrameContract,
  calibration?: {
    buildingRoiNormalized?: { topY: number; leftX: number; bottomY: number; rightX: number };
    rotationDeg?: number;
  },
): {
  position: [number, number, number];
  scale: number;
  rotation: [number, number, number];
  fullImageWidthM?: number;
  fullImageDepthM?: number;
} {
  const [cx, cz] = contract.projectOriginM;
  const rotDeg = calibration?.rotationDeg ?? contract.rotation ?? 0;
  const rad = (rotDeg * Math.PI) / 180;

  const roi = calibration?.buildingRoiNormalized;
  if (roi && typeof roi.leftX === 'number' && typeof roi.rightX === 'number') {
    const spanX = Math.max(0.05, Math.min(1.0, roi.rightX - roi.leftX));
    const spanY = Math.max(0.05, Math.min(1.0, roi.bottomY - roi.topY));
    const fullImageWidthM = contract.widthM / spanX;
    const fullImageDepthM = contract.depthM / spanY;

    const roiCenterX = (roi.leftX + roi.rightX) / 2;
    const roiCenterY = (roi.topY + roi.bottomY) / 2;
    const offsetX = (0.5 - roiCenterX) * fullImageWidthM;
    const offsetZ = (0.5 - roiCenterY) * fullImageDepthM;

    return {
      position: [cx + offsetX, 0.02, cz + offsetZ],
      scale: fullImageWidthM / 10,
      rotation: [0, rad, 0],
      fullImageWidthM,
      fullImageDepthM,
    };
  }

  return {
    position: [cx, 0.02, cz],
    scale: contract.widthM / 10,
    rotation: [0, rad, 0],
    fullImageWidthM: contract.widthM,
    fullImageDepthM: contract.depthM,
  };
}
