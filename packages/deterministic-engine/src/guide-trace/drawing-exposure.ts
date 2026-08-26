/**
 * DrawingExposure — Phase 1 of the 2.5D camera-like stamping pipeline.
 *
 * ONE immutable coordinate exposure shared by:
 *   - rendered guide image
 *   - native PDF vectors
 *   - trace evidence
 *   - Pascal elements
 *   - pointer / picking coordinates
 *   - diagnostic overlays
 *
 * The guide image and parsed vectors MUST NOT calculate scale, crop, origin, or rotation
 * independently. Every consumer reads these transforms from the single DrawingExposure.
 *
 * Transforms are 2D affine matrices [a, b, c, d, e, f]:
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 */
export type YAxisDirection = 'up' | 'down';

export interface Matrix2D {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

export const identityMatrix = (): Matrix2D => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function applyMatrix(m: Matrix2D, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

export type ScaleStatus = 'resolved' | 'unresolved';

/**
 * Structural view of the PDF parser result needed to build an exposure. Declared locally so
 * the deterministic-engine does not couple to the editor package import path. Matches
 * `PdfVectorResult` / `VectorTransform` in apps/editor/src/lib/pdf-vector-parser.ts.
 */
export interface ParserTransformLike {
  transformId: string;
  pageWidthPt: number;
  pageHeightPt: number;
  pointsPerMeter: number;
  scaleDenominator: number;
  rotation: number;
  yAxisDirection: 'up' | 'down';
  worldOrigin: [number, number];
}
export interface ParserResultLike {
  ptsPerMeter: number;
  pageWidthPt: number;
  pageHeightPt: number;
  widthM: number;
  heightM: number;
  transform: ParserTransformLike;
  transformId: string;
}

export interface DrawingExposure {
  exposureId: string;
  sourceFileUrl: string;
  pageIndex: number;
  // PDF boxes (points)
  mediaBox: { x1Pt: number; y1Pt: number; x2Pt: number; y2Pt: number };
  cropBox: { x1Pt: number; y1Pt: number; x2Pt: number; y2Pt: number };
  pageRotation: number; // degrees, clockwise from PDF
  // Rendered guide image (pixels)
  imageWidthPx: number;
  imageHeightPx: number;
  // World (metres)
  worldWidthM: number;
  worldDepthM: number;
  worldOrigin: [number, number];
  yAxisDirection: YAxisDirection;
  scaleStatus: ScaleStatus;
  scaleDenominator: number; // 1:N read from the sheet (1 = undefined)
  // Transforms (immutable, shared)
  pdfToExposure: Matrix2D;   // PDF points -> rendered guide pixels
  pixelToExposure: Matrix2D; // raw pixels -> exposure pixels (identity unless cropped)
  exposureToWorld: Matrix2D; // exposure pixels -> world metres
  pdfToWorld: Matrix2D;      // PDF points -> world metres (derived, for focus test)
  pixelToWorld: Matrix2D;    // rendered guide pixels -> world metres (= exposureToWorld ∘ pixelToExposure)
  transformId: string;       // mirrors the parser VectorTransform id (single source of truth)
  ptsPerMeter: number;
}

export interface BuildExposureInput {
  sourceFileUrl: string;
  pageIndex?: number;
  parser: ParserResultLike;
  imageWidthPx?: number;
  imageHeightPx?: number;
  worldOrigin?: [number, number];
  exposureId?: string;
  pageRotation?: number;
}

/**
 * Build one immutable DrawingExposure from a parsed PDF result. Removes any independent
 * scale/crop/origin/rotation calculation from downstream consumers — they read these fields.
 */
export function buildDrawingExposure(input: BuildExposureInput): DrawingExposure {
  const { parser, sourceFileUrl } = input;
  const t = parser.transform;
  const pageRotation = input.pageRotation ?? t.rotation ?? 0;
  const ptsPerMeter = parser.ptsPerMeter;
  const scaleResolved = Number.isFinite(ptsPerMeter) && ptsPerMeter > 0 && t.scaleDenominator > 0;

  const mediaBox = { x1Pt: 0, y1Pt: 0, x2Pt: t.pageWidthPt, y2Pt: t.pageHeightPt };
  // CropBox is not exposed by the parser; default to MediaBox (no independent crop decision).
  const cropBox = mediaBox;

  const imageWidthPx = input.imageWidthPx ?? t.pageWidthPt;
  const imageHeightPx = input.imageHeightPx ?? t.pageHeightPt;

  const worldWidthM = imageWidthPx / ptsPerMeter;
  const worldDepthM = imageHeightPx / ptsPerMeter;
  const worldOrigin = input.worldOrigin ?? [0, 0];

  // pdfToExposure: PDF points -> rendered pixels (Y flipped to image space).
  const sx = imageWidthPx / t.pageWidthPt;
  const sy = imageHeightPx / t.pageHeightPt;
  const pdfToExposure: Matrix2D = { a: sx, b: 0, c: 0, d: -sy, e: 0, f: imageHeightPx };
  const pixelToExposure: Matrix2D = identityMatrix();
  // exposureToWorld: image pixels (Y-down, 0 at top) -> world metres (Y up).
  // pdfToExposure already flipped PDF Y to image space, so here we map guideY -> worldY
  // WITHOUT re-flipping: worldY = guideY / ppm (+ origin). This keeps pdfToWorld and
  // exposureToWorld∘pdfToExposure consistent (single round-trip, no drift).
  const exposureToWorld: Matrix2D = {
    a: 1 / ptsPerMeter, b: 0, c: 0, d: 1 / ptsPerMeter,
    e: worldOrigin[0], f: worldOrigin[1],
  };
  // pdfToWorld: PDF points -> world metres (Y flipped to make world Y up).
  const pdfToWorld: Matrix2D = {
    a: 1 / ptsPerMeter, b: 0, c: 0, d: -1 / ptsPerMeter,
    e: worldOrigin[0], f: worldOrigin[1] + worldDepthM,
  };

  const exposureId = input.exposureId ?? `exp_${t.transformId}`;

  return {
    exposureId,
    sourceFileUrl,
    pageIndex: input.pageIndex ?? 0,
    mediaBox,
    cropBox,
    pageRotation,
    imageWidthPx,
    imageHeightPx,
    worldWidthM,
    worldDepthM,
    worldOrigin,
    yAxisDirection: 'up',
    scaleStatus: scaleResolved ? 'resolved' : 'unresolved',
    scaleDenominator: t.scaleDenominator,
    pdfToExposure,
    pixelToExposure,
    exposureToWorld,
    pdfToWorld,
    pixelToWorld: exposureToWorld, // pixelToExposure is identity here; exposed as a distinct field
    transformId: t.transformId,
    ptsPerMeter,
  };
}

/** Project a PDF point (MediaBox pts) to world metres using the exposure. */
export function pdfPointToWorld(exp: DrawingExposure, pdfX: number, pdfY: number): [number, number] {
  return applyMatrix(exp.pdfToWorld, pdfX, pdfY);
}

/** Project a PDF point to rendered guide pixels using the exposure. */
export function pdfPointToGuidePixel(exp: DrawingExposure, pdfX: number, pdfY: number): [number, number] {
  return applyMatrix(exp.pdfToExposure, pdfX, pdfY);
}

/** Project a world point to rendered guide pixels (for overlays / picking). */
export function worldPointToGuidePixel(exp: DrawingExposure, wx: number, wy: number): [number, number] {
  return applyMatrix(exp.exposureToWorld, wx, wy);
}
