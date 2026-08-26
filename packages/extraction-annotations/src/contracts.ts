// Shared contracts for the read-only programmatic annotation sidecar.
// This package captures PDF text, annotation objects, and vector-label glyphs
// during the SAME single PDF pass used by the trusted wall/window/door extractors.
// Annotations are NEVER used to modify geometry; they only act as local search
// anchors that help recover and verify door symbols.

export type AnnotationKind =
  | 'PDF_TEXT'
  | 'PDF_ANNOTATION_OBJECT'
  | 'VECTOR_GLYPH_OUTLINES'
  | 'RASTER_TEXT'
  | 'NOT_RECOVERABLE';

export type AnnotationConfidence = 'high' | 'medium' | 'low';

export interface RecoveredAnnotation {
  annotationId: string;
  text: string;
  normalizedText: string;
  kind: AnnotationKind;
  pageIndex: number;
  /** PDF user-space rectangle [x0, y0, x1, y1] (y up). */
  boundsPdf: [number, number, number, number];
  /** PDF user-space centre [x, y] (y up). */
  centrePdf: [number, number];
  confidence: AnnotationConfidence;
  sourceBlockId?: string;
  sourceSpanId?: string;
  /** Optional: the regex group that matched (e.g. "DT-01"). */
  matchedPattern?: string;
}

export interface AnnotationCaptureOptions {
  /** Enable direct PDF text extraction (page.search / structured text). */
  enableText: boolean;
  /** Enable PDF annotation-object enumeration. */
  enableAnnotationObjects: boolean;
  /** Enable vector-glyph fallback (count glyph-like strokes near a text anchor). */
  enableVectorGlyphFallback: boolean;
  /** Enable OCR fallback (localized) when text/annotation unavailable. */
  enableOcrFallback: boolean;
  /** Door-tag regex, e.g. /^DT[-\s]?\d{1,3}$/i. Empty disables pattern filtering. */
  doorTagPattern: string;
  /** Search term used to locate door tags via direct text search. */
  doorTagSearchTerm: string;
}

export const DEFAULT_ANNOTATION_OPTIONS: AnnotationCaptureOptions = {
  enableText: true,
  enableAnnotationObjects: true,
  enableVectorGlyphFallback: false,
  enableOcrFallback: false,
  doorTagPattern: '^DT[-\\s]?\\d{1,3}$',
  doorTagSearchTerm: 'DT',
};

/** Feature flags (set false to keep wall/window/geometry-only results identical). */
export interface AnnotationFeatureFlags {
  ENABLE_PROGRAMMATIC_ANNOTATIONS: boolean;
  ENABLE_DOOR_ANNOTATION_ASSIST: boolean;
  ENABLE_ANNOTATION_OCR_FALLBACK: boolean;
}

export const DEFAULT_ANNOTATION_FEATURE_FLAGS: AnnotationFeatureFlags = {
  ENABLE_PROGRAMMATIC_ANNOTATIONS: true,
  ENABLE_DOOR_ANNOTATION_ASSIST: true,
  ENABLE_ANNOTATION_OCR_FALLBACK: false,
};

/** Axis-aligned bounding box in PDF space. */
export interface BBoxPdf {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function bboxFromQuad(quad: number[][]): BBoxPdf {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of quad) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return { x0, y0, x1, y1 };
}

export function bboxCentre(b: BBoxPdf): [number, number] {
  return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
}

export function normalizeDoorTag(text: string): string {
  return text.trim().replace(/\s+/g, '').toUpperCase();
}
