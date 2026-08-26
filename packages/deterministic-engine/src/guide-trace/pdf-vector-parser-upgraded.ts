import type { Axis, RawMaximalLine, VectorClass, WorldTransform } from './guide-trace-types';

export interface PdfVectorSegment {
  id: string;
  x1Pt: number; y1Pt: number; x2Pt: number; y2Pt: number;
  lineWidthPt: number;
  layer?: string;
  hasCurves?: boolean;
  vectorClass?: VectorClass; // wall/structure/partition evidence vs unclassified
  wallType?: 'structural_concrete' | 'interior_partition';
}

export interface PdfTextEvidence {
  id: string; text: string; xPt: number; yPt: number;
  widthPt?: number; heightPt?: number;
}

export interface PdfEvidenceResult {
  transform: WorldTransform;
  maximalLines: RawMaximalLine[];
  textEvidence: PdfTextEvidence[];
  scaleErrorPercent: number;
}

const MUTED = /TEXT|ANNO|TITLE|BORDER|LEGEND|DIM|GRID|HEADER|MARGIN/i;
const round = (v: number) => Number(v.toFixed(4));

export function vectorsToMaximalLineEvidence(
  segments: PdfVectorSegment[],
  pointsPerMeter: number,
  pageHeightPt: number,
  detectorConfigId = 'pdf-vector',
  maxAxisDeviationDeg = 2.5,
): RawMaximalLine[] {
  const output: RawMaximalLine[] = [];
  for (const s of segments) {
    if (s.layer && MUTED.test(s.layer)) continue;
    if (s.hasCurves) continue;
    const x1 = s.x1Pt / pointsPerMeter, x2 = s.x2Pt / pointsPerMeter;
    const y1 = (pageHeightPt - s.y1Pt) / pointsPerMeter;
    const y2 = (pageHeightPt - s.y2Pt) / pointsPerMeter;
    const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
    if (length < 0.25) continue;
    const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) % 180;
    let axis: Axis | undefined;
    if (Math.min(angle, 180 - angle) <= maxAxisDeviationDeg) axis = 'H';
    else if (Math.abs(angle - 90) <= maxAxisDeviationDeg) axis = 'V';
    if (!axis) continue;
    const coordinateM = axis === 'H' ? (y1 + y2) / 2 : (x1 + x2) / 2;
    const startM = axis === 'H' ? Math.min(x1, x2) : Math.min(y1, y2);
    const endM = axis === 'H' ? Math.max(x1, x2) : Math.max(y1, y2);
    const vClass = s.vectorClass
      ?? (s.wallType === 'structural_concrete' ? 'structure'
        : s.wallType === 'interior_partition' ? 'partition'
        : (s.layer && /WALL|STR|CONC|PRTN/i.test(s.layer)) ? 'wall'
        : 'unclassified');
    // Single-source confirmation is allowed ONLY for explicit wall/structure/partition
    // evidence; unclassified PDF vectors stay at 0.72 (unresolved unless fused by guide
    // planes or graph closure). See maximal-line-guide-tracer mergeIntervals.
    const confidence = vClass === 'unclassified' ? 0.72 : (vClass === 'structure' ? 0.95 : 0.90);
    output.push({
      id: `${detectorConfigId}_${s.id}`, axis,
      coordinateM: round(coordinateM), startM: round(startM), endM: round(endM),
      detectorConfigId, source: 'pdf-vector', sourceId: s.id,
      confidence, vectorClass: vClass,
    });
  }
  return output;
}

export function computeImmutableTransform(
  pixelsPerMeter: number,
  roiPixelOrigin: [number, number],
  roiWorldOrigin: [number, number],
): WorldTransform {
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) throw new Error('Invalid pixelsPerMeter');
  return { pixelsPerMeter, roiPixelOrigin: [...roiPixelOrigin], roiWorldOrigin: [...roiWorldOrigin] };
}
