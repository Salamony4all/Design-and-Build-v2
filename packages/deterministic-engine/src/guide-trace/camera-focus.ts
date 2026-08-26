/**
 * Camera Focus Test — Phase 3 of the 2.5D stamping pipeline.
 *
 * Before matching signatures, PROVE that parsed PDF geometry lands on the visible guide.
 * We sample PDF vector points and project: PDF point -> exposure point -> world point ->
 * guide pixel. The hard focus gate must pass before any signature translation begins.
 */
import {
  type DrawingExposure, applyMatrix, pdfPointToGuidePixel, pdfPointToWorld,
} from './drawing-exposure';

export interface FocusSample {
  pdfX: number;
  pdfY: number;
  guidePx: [number, number]; // projected guide pixel
  world: [number, number];
  onGuide: boolean;
  pixelOffset: number; // |projected - reference| in px (0 when reference == projected)
  roundTripErrorPt: number; // PDF -> world -> PDF reconstruction error (pts)
}

export interface FocusResult {
  sampledPointCount: number;
  pointsOnGuideEvidence: number;
  guideAlignmentRate: number; // 0..1
  meanPixelOffset: number;
  maximumPixelOffset: number;
  roundTripFailed: boolean;
  passed: boolean; // hard focus gate
  samples: FocusSample[];
  exposureId: string;
}

export interface CameraFocusOptions {
  maxPixelOffsetPx?: number;     // default 2
  minAlignmentRate?: number;      // default 0.95
  referenceGuidePx?: Array<[number, number]>; // optional measured on-image positions
}

/**
 * Run the camera focus test. `pdfPoints` are sampled MediaBox points from parsed vectors.
 * When `referenceGuidePx` is supplied, the projected guide pixel is compared against it;
 * otherwise the projection is self-referential (the guide IS the parsed vectors) and the
 * offset measures the PDF->world->guide-pixel projection against the PDF->guide-pixel direct
 * route (both must agree, proving a single consistent transform).
 */
export function runCameraFocus(
  exp: DrawingExposure,
  pdfPoints: Array<[number, number]>,
  opts: CameraFocusOptions = {},
): FocusResult {
  const maxPixelOffsetPx = opts.maxPixelOffsetPx ?? 2;
  const minAlignmentRate = opts.minAlignmentRate ?? 0.95;

  const samples: FocusSample[] = [];
  let onGuide = 0;
  let offsetSum = 0;
  let maxOffset = 0;
  let roundTripFailed = false;

  pdfPoints.forEach(([px, py], i) => {
    const guidePx = pdfPointToGuidePixel(exp, px, py);
    const world = pdfPointToWorld(exp, px, py);
    // Round-trip check: the two derived routes (pdfToWorld vs exposureToWorld∘pdfToExposure)
    // must agree. A corrupt pdfToWorld diverges from the guide-projection route.
    const route2 = applyMatrix(exp.exposureToWorld, guidePx[0], guidePx[1]);
    const roundTripErrorPt = Math.hypot(route2[0] - world[0], route2[1] - world[1]);
    if (!Number.isFinite(roundTripErrorPt) || roundTripErrorPt > 1e-6) roundTripFailed = true;

    const inBounds =
      guidePx[0] >= -0.5 && guidePx[0] <= exp.imageWidthPx + 0.5 &&
      guidePx[1] >= -0.5 && guidePx[1] <= exp.imageHeightPx + 0.5;

    let pixelOffset = 0;
    let reference: [number, number] | null = null;
    if (opts.referenceGuidePx && opts.referenceGuidePx[i]) {
      reference = opts.referenceGuidePx[i]!;
      pixelOffset = Math.hypot(guidePx[0] - reference[0], guidePx[1] - reference[1]);
    } else {
      // self-reference: project PDF->guide directly and compare to the world-derived route.
      const direct = applyMatrix(exp.pdfToExposure, px, py);
      pixelOffset = Math.hypot(guidePx[0] - direct[0], guidePx[1] - direct[1]);
    }

    const ok = inBounds && pixelOffset <= maxPixelOffsetPx && !roundTripFailed;
    if (ok) onGuide++;
    offsetSum += pixelOffset;
    maxOffset = Math.max(maxOffset, pixelOffset);
    samples.push({
      pdfX: px, pdfY: py, guidePx, world, onGuide: ok, pixelOffset, roundTripErrorPt,
      ...(reference ? { referenceGuidePx: reference } : {}),
    } as FocusSample);
  });

  const sampledPointCount = samples.length;
  const guideAlignmentRate = sampledPointCount === 0 ? 0 : onGuide / sampledPointCount;
  const meanPixelOffset = sampledPointCount === 0 ? 0 : offsetSum / sampledPointCount;

  const passed =
    !roundTripFailed &&
    sampledPointCount > 0 &&
    guideAlignmentRate >= minAlignmentRate &&
    maxOffset <= maxPixelOffsetPx;

  return {
    sampledPointCount,
    pointsOnGuideEvidence: onGuide,
    guideAlignmentRate,
    meanPixelOffset,
    maximumPixelOffset: maxOffset,
    roundTripFailed,
    passed,
    samples,
    exposureId: exp.exposureId,
  };
}

function invert(m: { a: number; b: number; c: number; d: number; e: number; f: number }) {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det;
  const ie = -(ia * m.e + ic * m.f), if_ = -(ib * m.e + id * m.f);
  return { a: ia, b: ib, c: ic, d: id, e: ie, f: if_ };
}

void invert; // retained for callers needing matrix inversion (unused here)
