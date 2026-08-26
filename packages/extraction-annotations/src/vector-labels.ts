// Vector-glyph fallback. When a door tag is unavailable as PDF text or an
// annotation object, a localized cluster of short strokes near a known anchor may
// indicate a vector-glyph label. This module only COUNTS glyph-like strokes; it
// never invents label text (the text must come from the PDF text layer or OCR).
export interface MuVector {
  id: string;
  sourceRootId?: string;
  points: Array<{ x: number; y: number }>;
  subpaths?: Array<Array<{ x: number; y: number }>>;
  fill?: boolean;
  stroke?: boolean;
}

export interface VectorGlyphProbe {
  glyphStrokeCount: number;
}

/**
 * Count short strokes within `radiusMm` of a point that look like glyph outlines
 * (many short segments, not wall-parallel runs). Used only as a confidence hint,
 * never as a label source.
 */
export function probeVectorGlyphCluster(
  point: { x: number; y: number },
  vectors: MuVector[],
  radiusMm: number,
  scaleMmPerPt: number,
): VectorGlyphProbe {
  const r = radiusMm / scaleMmPerPt;
  let count = 0;
  for (const v of vectors) {
    const subs = v.subpaths && v.subpaths.length ? v.subpaths : [v.points];
    for (const s of subs) {
      for (let i = 0; i + 1 < s.length; i++) {
        const mx = (s[i]!.x + s[i + 1]!.x) / 2;
        const my = (s[i]!.y + s[i + 1]!.y) / 2;
        if (Math.hypot(mx - point.x, my - point.y) <= r) count++;
      }
    }
  }
  return { glyphStrokeCount: count };
}
