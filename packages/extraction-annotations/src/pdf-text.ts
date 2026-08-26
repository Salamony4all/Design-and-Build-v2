// Direct PDF text extraction (preferred). Uses MuPDF page.search for door tags
// and falls back to structured-text walking. Returns recovered door-tag annotations
// with PDF-space bounds and centres.
import type * as mupdf from 'mupdf';
import {
  AnnotationCaptureOptions,
  BBoxPdf,
  bboxCentre,
  bboxFromQuad,
  normalizeDoorTag,
  RecoveredAnnotation,
} from './contracts';

let seq = 0;
function nextId(): string {
  return `anno-txt-${seq++}`;
}

/**
 * Extract door-tag annotations via direct PDF text search.
 * CODE-06 stores DT labels as real (searchable) PDF text, so page.search('DT')
 * returns one quad per occurrence. We return each as a PDF_TEXT annotation.
 */
export function extractDoorTagsFromText(
  page: mupdf.Page,
  options: AnnotationCaptureOptions,
  pageIndex = 0,
): RecoveredAnnotation[] {
  const out: RecoveredAnnotation[] = [];
  if (!options.enableText) return out;
  let hits: number[][][] = [];
  try {
    hits = (page as any).search(options.doorTagSearchTerm, 100) as number[][][];
  } catch {
    return out;
  }
  // NOTE: page.search returns one quad per occurrence of the SEARCH TERM (e.g. "DT"),
  // not the full label ("DT-07"). The digits are not in the returned quad text, so we
  // do NOT apply the strict door-tag regex here (that would drop every anchor). Each
  // hit is a valid PDF_TEXT anchor; position is what the door pipeline consumes. When
  // structured text is available, extractDoorTagsFromStructuredText supplies labels.
  for (const quad of hits) {
    const b: BBoxPdf = bboxFromQuad(quad as number[][]);
    const c = bboxCentre(b);
    const text = options.doorTagSearchTerm;
    const normalized = normalizeDoorTag(text);
    out.push({
      annotationId: nextId(),
      text,
      normalizedText: normalized,
      kind: 'PDF_TEXT',
      pageIndex,
      boundsPdf: [b.x0, b.y0, b.x1, b.y1],
      centrePdf: c,
      confidence: 'medium',
      matchedPattern: normalized,
    });
  }
  return out;
}

/**
 * Walk structured text to recover the actual label string for each text span,
 * filtered by the door-tag pattern. Used when the exact text (e.g. "DT-07") is
 * required (not just the anchor quad from search).
 */
export function extractDoorTagsFromStructuredText(
  page: mupdf.Page,
  options: AnnotationCaptureOptions,
  pageIndex = 0,
): RecoveredAnnotation[] {
  const out: RecoveredAnnotation[] = [];
  if (!options.enableText) return out;
  let stext: any;
  try {
    stext = (page as any).toStructuredText('preserve-whitespace');
  } catch {
    return out;
  }
  const pattern = options.doorTagPattern ? new RegExp(options.doorTagPattern, 'i') : null;
  let blockId = 0;
  let spanId = 0;
  try {
    stext.walk({
      beginTextBlock() {
        blockId++;
      },
      beginLine() {},
      onText(text: string, bbox: any) {
        spanId++;
        const normalized = normalizeDoorTag(text);
        if (pattern && !pattern.test(normalized)) return;
        const b: BBoxPdf = bbox ? bboxFromQuad([bbox]) : { x0: 0, y0: 0, x1: 0, y1: 0 };
        const c = bboxCentre(b);
        out.push({
          annotationId: nextId(),
          text: String(text).trim(),
          normalizedText: normalized,
          kind: 'PDF_TEXT',
          pageIndex,
          boundsPdf: [b.x0, b.y0, b.x1, b.y1],
          centrePdf: c,
          confidence: 'high',
          sourceBlockId: `block-${blockId}`,
          sourceSpanId: `span-${spanId}`,
          matchedPattern: normalized,
        });
      },
      endLine() {},
      endTextBlock() {},
    } as any);
  } catch {
    /* structured text walker unsupported for this document */
  }
  return out;
}
