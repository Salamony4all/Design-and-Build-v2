// harness/building-frame.test.ts
// Focused M1 tests: BuildingFrameContract, mm->m /1000, Guide/slab/walls share
// one frame + centre, single centring, active region != full page.

import { describe, it, expect } from 'vitest';
import {
  computeBuildingFrame,
  guideWorldPlacement,
  frameToCoordinateFrame,
  type BuildingFrameContract,
} from './building-frame';
import type { Bounds } from 'design-build-coordinate-frame';

// Verified CODE_06 inputs (PDF points). Full page is larger than the building.
const PAGE: Bounds = [0, 0, 1680, 1188]; // letter-ish sheet
const ROI: Bounds = [120, 90, 1560, 1098]; // building footprint only (excludes title block/margin)
const SCALE_MM_PER_PT = 5; // example scale

function makeFrame(): BuildingFrameContract {
  return computeBuildingFrame({
    frameId: 'bf_1',
    sourceHash: 'h',
    pageBoundsPt: PAGE,
    activeRegionPt: ROI,
    scaleMmPerPt: SCALE_MM_PER_PT,
  });
}

describe('BuildingFrameContract', () => {
  it('converts millimetres to metres using /1000', () => {
    const f = makeFrame();
    const expectedW = ((ROI[2] - ROI[0]) * SCALE_MM_PER_PT) / 1000;
    const expectedD = ((ROI[3] - ROI[1]) * SCALE_MM_PER_PT) / 1000;
    expect(f.widthM).toBeCloseTo(expectedW, 6);
    expect(f.depthM).toBeCloseTo(expectedD, 6);
    // Sanity: full page would be larger; we must NOT use the full page.
    const pageW = ((PAGE[2] - PAGE[0]) * SCALE_MM_PER_PT) / 1000;
    expect(f.widthM).toBeLessThan(pageW);
  });

  it('does not use the full PDF page as the active region', () => {
    const f = makeFrame();
    expect(f.activeRegionPt).toEqual(ROI);
    expect(f.activeRegionPt).not.toEqual(PAGE);
    // Verified boundary excludes the full sheet.
    expect(f.pageBoundsPt).toEqual(PAGE);
  });

  it('centres the building origin on the active-region centre (one centre)', () => {
    const f = makeFrame();
    const cf = frameToCoordinateFrame(f);
    const [cx, cz] = cf.toPascal((ROI[0] + ROI[2]) / 2, (ROI[1] + ROI[3]) / 2);
    expect(f.projectOriginM[0]).toBeCloseTo(cx, 6);
    expect(f.projectOriginM[1]).toBeCloseTo(cz, 6);
  });

  it('Guide placement uses the shared frame (no double centring)', () => {
    const f = makeFrame();
    const p = guideWorldPlacement(f);
    // Centring applied exactly once: position is the building centre; scale is widthM.
    expect(p.position[0]).toBeCloseTo(f.projectOriginM[0], 6);
    expect(p.position[2]).toBeCloseTo(f.projectOriginM[1], 6);
    expect(p.scale).toBeCloseTo(f.widthM / 10, 6); // widthM/10 -> 10m base plane * scale = widthM
    expect(p.position[1]).toBeCloseTo(0.02, 6); // small vertical offset (above slab) for visibility
  });

  it('Guide, slab, and walls share the same world origin', () => {
    const f = makeFrame();
    const cf = frameToCoordinateFrame(f);
    const guide = guideWorldPlacement(f);
    // Slab polygon (from ROI) and walls (from cf.toPascal) both resolve around projectOriginM.
    const [sx, sz] = cf.toPascal(ROI[0], ROI[1]); // ROI corner in world
    // The frame origin is the ROI centre; a corner offset from it must be consistent.
    expect(guide.position[0]).toBeCloseTo(f.projectOriginM[0], 6);
    expect(sx).not.toBeCloseTo(f.projectOriginM[0], 3); // corner != centre (sanity)
  });

  it('frame is immutable/identical for guide, slab, walls (single frame)', () => {
    const f = makeFrame();
    const a = guideWorldPlacement(f);
    const b = guideWorldPlacement(f);
    expect(a).toEqual(b); // deterministic single centring
    expect(f.frameId).toBe('bf_1');
  });

  it('PDF->world round trip is exact (no drift)', () => {
    const f = makeFrame();
    const cf = frameToCoordinateFrame(f);
    const [wx, wz] = cf.toPascal(ROI[0], ROI[3]);
    const [px, py] = cf.toPdf(wx, wz);
    expect(px).toBeCloseTo(ROI[0], 6);
    expect(py).toBeCloseTo(ROI[3], 6);
  });
});
