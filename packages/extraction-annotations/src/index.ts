// Public entry point for the annotation sidecar. Captures door-tag annotations
// during the SAME single PDF pass as the trusted extractors (no PDF reopen).
// Produces a spatial index used by the door pipeline as a local search anchor.
import type * as mupdf from 'mupdf';
import {
  AnnotationCaptureOptions,
  AnnotationFeatureFlags,
  DEFAULT_ANNOTATION_FEATURE_FLAGS,
  DEFAULT_ANNOTATION_OPTIONS,
  RecoveredAnnotation,
} from './contracts';
import { extractDoorTagsFromText, extractDoorTagsFromStructuredText } from './pdf-text';
import { extractAnnotationsFromObjects } from './pdf-annotations';
import { AnnotationSpatialIndex, buildAnnotationSpatialIndex } from './spatial-index';

export * from './contracts';
export * from './pdf-text';
export * from './pdf-annotations';
export * from './vector-labels';
export * from './spatial-index';

export interface AnnotationCaptureResult {
  annotations: RecoveredAnnotation[];
  index: AnnotationSpatialIndex;
  /** distribution by kind */
  byKind: Record<string, number>;
  /** whether any annotation object was found at all (vs only text anchors) */
  storageClassified: 'PDF_TEXT' | 'PDF_ANNOTATION_OBJECT' | 'MIXED' | 'NONE';
  /** per-stage capture timings (ms) */
  timings: { textSearchMs: number; structuredTextMs: number; indexBuildMs: number; totalMs: number };
}

/**
 * Capture door-tag annotations from a single loaded page. Caller must open the PDF
 * and load the page ONCE and reuse the same document/page instance for vectors,
 * text, and annotations (no reopen).
 */
export function captureDoorAnnotations(
  page: mupdf.Page,
  options: AnnotationCaptureOptions = DEFAULT_ANNOTATION_OPTIONS,
  featureFlags: AnnotationFeatureFlags = DEFAULT_ANNOTATION_FEATURE_FLAGS,
  pageIndex = 0,
): AnnotationCaptureResult {
  const annotations: RecoveredAnnotation[] = [];
  if (!featureFlags.ENABLE_PROGRAMMATIC_ANNOTATIONS) {
    return {
      annotations: [],
      index: buildAnnotationSpatialIndex([]),
      byKind: {},
      storageClassified: 'NONE',
      timings: { textSearchMs: 0, structuredTextMs: 0, indexBuildMs: 0, totalMs: 0 },
    };
  }
  const t0 = Date.now();
  // Preferred: structured text gives the real label string.
  const tsStruct = Date.now();
  const fromStructured = extractDoorTagsFromStructuredText(page, options, pageIndex);
  const structuredMs = Date.now() - tsStruct;
  const tsSearch = Date.now();
  const fromSearch = extractDoorTagsFromText(page, options, pageIndex);
  const searchMs = Date.now() - tsSearch;
  const fromObjects = extractAnnotationsFromObjects(page, options, pageIndex);
  annotations.push(...fromStructured, ...fromSearch, ...fromObjects);

  const byKind: Record<string, number> = {};
  for (const a of annotations) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;

  // De-duplicate anchors that share the same centre (structured + search may both
  // fire for the same label). Keep the one with the real text (structured).
  const seenCentre = new Set<string>();
  const deduped: RecoveredAnnotation[] = [];
  for (const a of annotations) {
    const key = `${a.centrePdf[0].toFixed(1)},${a.centrePdf[1].toFixed(1)}`;
    if (seenCentre.has(key)) continue;
    seenCentre.add(key);
    deduped.push(a);
  }

  let storage: AnnotationCaptureResult['storageClassified'] = 'NONE';
  const hasText = deduped.some((a) => a.kind === 'PDF_TEXT');
  const hasObj = deduped.some((a) => a.kind === 'PDF_ANNOTATION_OBJECT');
  if (hasText && hasObj) storage = 'MIXED';
  else if (hasText) storage = 'PDF_TEXT';
  else if (hasObj) storage = 'PDF_ANNOTATION_OBJECT';

  const ti = Date.now();
  const index = buildAnnotationSpatialIndex(deduped);
  const indexMs = Date.now() - ti;

  return {
    annotations: deduped,
    index,
    byKind,
    storageClassified: storage,
    timings: { textSearchMs: searchMs, structuredTextMs: structuredMs, indexBuildMs: indexMs, totalMs: Date.now() - t0 },
  };
}
