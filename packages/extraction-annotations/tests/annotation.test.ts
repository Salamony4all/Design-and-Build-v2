import { describe, expect, it } from 'vitest';
import {
  normalizeDoorTag,
  bboxFromQuad,
  bboxCentre,
  AnnotationSpatialIndex,
} from '../src/index';

describe('DT normalization', () => {
  it('normalizes "DT-07" and "dt 07" to the same canonical tag', () => {
    expect(normalizeDoorTag('DT-07')).toBe('DT-07');
    expect(normalizeDoorTag('dt 07')).toBe('DT-07');
    expect(normalizeDoorTag(' DT 12 ')).toBe('DT-12');
  });
});

describe('bbox utilities', () => {
  it('computes bounds and centre from a quad', () => {
    const b = bboxFromQuad([
      [10, 20],
      [10, 30],
      [40, 20],
      [40, 30],
    ]);
    expect(b).toEqual({ x0: 10, y0: 20, x1: 40, y1: 30 });
    expect(bboxCentre(b)).toEqual([25, 25]);
  });
});

describe('annotation spatial index', () => {
  it('queries annotations within a radius and intersects a box', () => {
    const idx = new AnnotationSpatialIndex();
    idx.insert({
      annotationId: 'a1',
      text: 'DT',
      normalizedText: 'DT',
      kind: 'PDF_TEXT',
      pageIndex: 0,
      boundsPdf: [0, 0, 10, 10],
      centrePdf: [5, 5],
      confidence: 'medium',
    });
    idx.insert({
      annotationId: 'a2',
      text: 'DT',
      normalizedText: 'DT',
      kind: 'PDF_TEXT',
      pageIndex: 0,
      boundsPdf: [100, 100, 110, 110],
      centrePdf: [105, 105],
      confidence: 'medium',
    });
    expect(idx.queryWithin({ x: 5, y: 5 }, 20)).toHaveLength(1);
    expect(idx.queryWithin({ x: 50, y: 50 }, 200)).toHaveLength(2);
    expect(idx.queryIntersecting({ x0: 0, y0: 0, x1: 50, y1: 50 })).toHaveLength(1);
    expect(idx.nearest({ x: 104, y: 104 })?.annotationId).toBe('a2');
  });
});

describe('DT search-anchor recovery (real CODE_06 PDF)', () => {
  it('recovers ~25 DT anchors as PDF_TEXT without OCR', async () => {
    const mupdf = await import('mupdf');
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const { captureDoorAnnotations, DEFAULT_ANNOTATION_OPTIONS } = await import('../src/index');
    const ROOT = process.cwd();
    const PDF = join(ROOT, '..', '..', 'test drawings and png', 'CODE_06 1 page.pdf');
    const bytes = new Uint8Array(readFileSync(PDF));
    const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf');
    const page = doc.loadPage(0);
    const res = captureDoorAnnotations(page, DEFAULT_ANNOTATION_OPTIONS, undefined, 0);
    expect(res.storageClassified).toBe('PDF_TEXT');
    expect(res.annotations.length).toBeGreaterThanOrEqual(20);
    // all anchors are PDF_TEXT (no OCR used)
    expect(res.annotations.every((a) => a.kind === 'PDF_TEXT')).toBe(true);
  });
});
