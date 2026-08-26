// PDF annotation-object enumeration (FreeText / Text / Stamp etc.). CODE-06 stores
// DT labels as real text, but this module supports documents that use annotation
// objects instead. Returns recovered annotations with PDF-space bounds.
import type * as mupdf from 'mupdf';
import {
  AnnotationCaptureOptions,
  BBoxPdf,
  bboxCentre,
  normalizeDoorTag,
  RecoveredAnnotation,
} from './contracts';

let seq = 0;
function nextId(): string {
  return `anno-obj-${seq++}`;
}

export function extractAnnotationsFromObjects(
  page: mupdf.Page,
  options: AnnotationCaptureOptions,
  pageIndex = 0,
): RecoveredAnnotation[] {
  const out: RecoveredAnnotation[] = [];
  if (!options.enableAnnotationObjects) return out;
  let annots: any[] = [];
  try {
    annots = (page as any).getAnnotations() as any[];
  } catch {
    return out;
  }
  const pattern = options.doorTagPattern ? new RegExp(options.doorTagPattern, 'i') : null;
  for (const a of annots) {
    let raw = '';
    try {
      raw = (a as any).getContents ? String((a as any).getContents() ?? '') : '';
    } catch {
      raw = '';
    }
    const normalized = normalizeDoorTag(raw);
    if (!raw) continue;
    if (pattern && !pattern.test(normalized)) continue;
    let b: BBoxPdf = { x0: 0, y0: 0, x1: 0, y1: 0 };
    try {
      const bb = (a as any).getBounds();
      if (bb) b = { x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1 };
    } catch {
      /* no bounds */
    }
    const c = bboxCentre(b);
    out.push({
      annotationId: nextId(),
      text: raw,
      normalizedText: normalized,
      kind: 'PDF_ANNOTATION_OBJECT',
      pageIndex,
      boundsPdf: [b.x0, b.y0, b.x1, b.y1],
      centrePdf: c,
      confidence: 'high',
      matchedPattern: normalized,
    });
  }
  return out;
}
