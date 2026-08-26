// Lightweight spatial index over recovered annotations (PDF space). Supports
// radius queries used to anchor local door-symbol search. Read-only.
import { BBoxPdf, bboxCentre, RecoveredAnnotation } from './contracts';

export class AnnotationSpatialIndex {
  private items: RecoveredAnnotation[] = [];

  insert(a: RecoveredAnnotation): void {
    this.items.push(a);
  }

  insertAll(list: RecoveredAnnotation[]): void {
    for (const a of list) this.insert(a);
  }

  get all(): RecoveredAnnotation[] {
    return this.items;
  }

  /**
   * Return annotations whose centre lies within `radiusPt` of `point` (PDF space).
   */
  queryWithin(point: { x: number; y: number }, radiusPt: number): RecoveredAnnotation[] {
    const out: RecoveredAnnotation[] = [];
    for (const a of this.items) {
      const c = a.centrePdf;
      if (Math.hypot(c[0] - point.x, c[1] - point.y) <= radiusPt) out.push(a);
    }
    return out;
  }

  /**
   * Return annotations whose bounds intersect the given box.
   */
  queryIntersecting(box: BBoxPdf): RecoveredAnnotation[] {
    const out: RecoveredAnnotation[] = [];
    for (const a of this.items) {
      const b = a.boundsPdf;
      const overlap = b[0] <= box.x1 && b[2] >= box.x0 && b[1] <= box.y1 && b[3] >= box.y0;
      if (overlap) out.push(a);
    }
    return out;
  }

  /** Nearest annotation to a point, or null. */
  nearest(point: { x: number; y: number }): RecoveredAnnotation | null {
    let best: RecoveredAnnotation | null = null;
    let bd = Infinity;
    for (const a of this.items) {
      const c = a.centrePdf;
      const d = Math.hypot(c[0] - point.x, c[1] - point.y);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }
}

export function buildAnnotationSpatialIndex(list: RecoveredAnnotation[]): AnnotationSpatialIndex {
  const idx = new AnnotationSpatialIndex();
  idx.insertAll(list);
  return idx;
}

export { bboxCentre };
