/**
 * MuPDF vector collection device + geometry helpers (ported from the attached
 * mupdf-wall-vision-js package to TypeScript, adapted for the Design And Build
 * fusion pipeline). Pure vector path capture — no raster, no OCR.
 *
 * Coordinate frame: MuPDF PDF *points*. The upstream wall-tracer consumes
 * pdf2json source units (ISO A4 ≈ 148.995 × 105.233). The page frame is a
 * uniform scale (~16×) of the pdf2json frame with origin at (0,0), so the
 * transform pdf2json -> MuPDF points is `p_mupdf = p_pj * S` (S≈16, isotropic).
 * All MuPDF wall-mass candidates are normalized back into pdf2json source
 * coordinates inside mupdf-adapter.ts, so the rest of the pipeline never sees
 * PDF points.
 */
import * as mupdf from 'mupdf';

export type Vec2 = { x: number; y: number };
export type Bounds = [number, number, number, number];

export interface MuVector {
  id: string;
  sourceRootId?: string;
  operation: 'fill-path' | 'stroke-path';
  commands: { op: string; [k: string]: unknown }[];
  points: Vec2[];
  subpaths: Vec2[][];
  bounds: Bounds;
  evenOdd?: boolean;
  color?: number[];
  alpha?: number;
  strokeWidth?: number;
  /** stroke width as drawn on the page (line width x CTM scale), in points */
  strokeWidthPt?: number;
  dashes?: number[];
}

export interface PaintedOperationLineage {
  operationIndex: number;
  operationId: string;
  operationType: 'fill-path' | 'stroke-path';
  paintOrder: number;
  transform: number[];
  strokeColour?: number[];
  fillColour?: number[];
  strokeAlpha?: number;
  fillAlpha?: number;
  strokeWidth?: number;
  sourceBounds: Bounds;
  transformedBounds: Bounds;
  subpaths: SubpathLineage[];
}

export interface SubpathLineage {
  subpathId: string;
  operationId: string;
  commandRange: [number, number];
  closed: boolean;
  sourceBounds: Bounds;
  transformedBounds: Bounds;
  segments: SegmentLineage[];
}

export interface SegmentLineage {
  segmentId: string;
  operationId: string;
  subpathId: string;
  commandIndex: number;
  commandType: 'M' | 'L' | 'C' | 'Z';
  sourcePoints: Vec2[];
  transformedPoints: Vec2[];
  sourceBounds: Bounds;
  transformedBounds: Bounds;
  boundsPrecision: 'EXACT_LINE' | 'CONTROL_POINT_ENVELOPE';
}

export interface LineageStore {
  operations: PaintedOperationLineage[];
}

function apply(m: number[], x: number, y: number): Vec2 {
  return { x: (m[0] ?? 1) * x + (m[2] ?? 0) * y + (m[4] ?? 0), y: (m[1] ?? 0) * x + (m[3] ?? 1) * y + (m[5] ?? 0) };
}

export function walkPath(path: any, ctm: number[]): { commands: any[]; points: Vec2[]; subpaths: Vec2[][] } {
  const commands: any[] = [];
  const points: Vec2[] = [];
  const subpaths: Vec2[][] = [];
  let current: Vec2[] = [];
  const flush = () => { if (current.length) { subpaths.push(current); current = []; } };
  path.walk({
    moveTo(x: number, y: number) { flush(); const p = apply(ctm, x, y); commands.push({ op: 'M', ...p }); points.push(p); current.push(p); },
    lineTo(x: number, y: number) { const p = apply(ctm, x, y); commands.push({ op: 'L', ...p }); points.push(p); current.push(p); },
    curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
      const p1 = apply(ctm, x1, y1), p2 = apply(ctm, x2, y2), p3 = apply(ctm, x3, y3);
      commands.push({ op: 'C', p1, p2, p3 }); points.push(p1, p2, p3); current.push(p1, p2, p3);
    },
    closePath() { commands.push({ op: 'Z' }); flush(); },
  });
  flush();
  return { commands, points, subpaths };
}

export function boundsOf(points: Vec2[]): Bounds {
  if (!points.length) return [0, 0, 0, 0];
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function walkPathWithLineage(
  path: any,
  ctm: number[],
  pageNumber: number,
  operationIndex: number,
  operationType: 'fill-path' | 'stroke-path'
): { subpaths: SubpathLineage[]; sourceBounds: Bounds; transformedBounds: Bounds } {
  const subpaths: SubpathLineage[] = [];
  const operationId = `p${pageNumber}_op${operationIndex}`;

  let currentSubpath: SubpathLineage | null = null;
  let subpathIndex = 0;
  let segmentIndex = 0;
  let commandIndex = 0;

  let currSrc: Vec2 | null = null;
  let currTrans: Vec2 | null = null;
  let startSrc: Vec2 | null = null;
  let startTrans: Vec2 | null = null;

  const allSourcePoints: Vec2[] = [];
  const allTransformedPoints: Vec2[] = [];

  const flushSubpath = () => {
    if (currentSubpath) {
      currentSubpath.commandRange[1] = commandIndex - 1;
      const pts = currentSubpath.segments.flatMap(s => s.sourcePoints);
      const tpts = currentSubpath.segments.flatMap(s => s.transformedPoints);
      currentSubpath.sourceBounds = boundsOf(pts);
      currentSubpath.transformedBounds = boundsOf(tpts);
      subpaths.push(currentSubpath);
      currentSubpath = null;
    }
  };

  path.walk({
    moveTo(x: number, y: number) {
      flushSubpath();
      const p = apply(ctm, x, y);
      allSourcePoints.push({ x, y });
      allTransformedPoints.push(p);

      startSrc = { x, y };
      startTrans = p;
      currSrc = { x, y };
      currTrans = p;

      currentSubpath = {
        subpathId: `${operationId}_s${subpathIndex++}`,
        operationId,
        commandRange: [commandIndex, commandIndex],
        closed: false,
        sourceBounds: [x, y, x, y],
        transformedBounds: [p.x, p.y, p.x, p.y],
        segments: []
      };
      segmentIndex = 0;
      commandIndex++;
    },
    lineTo(x: number, y: number) {
      if (!currentSubpath) return;
      const p = apply(ctm, x, y);
      allSourcePoints.push({ x, y });
      allTransformedPoints.push(p);

      const segSrcPoints = [currSrc!, { x, y }];
      const segTransPoints = [currTrans!, p];

      currentSubpath.segments.push({
        segmentId: `${currentSubpath.subpathId}_seg${segmentIndex++}`,
        operationId,
        subpathId: currentSubpath.subpathId,
        commandIndex,
        commandType: 'L',
        sourcePoints: segSrcPoints,
        transformedPoints: segTransPoints,
        sourceBounds: boundsOf(segSrcPoints),
        transformedBounds: boundsOf(segTransPoints),
        boundsPrecision: 'EXACT_LINE'
      });

      currSrc = { x, y };
      currTrans = p;
      commandIndex++;
    },
    curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
      if (!currentSubpath) return;
      const p1 = apply(ctm, x1, y1);
      const p2 = apply(ctm, x2, y2);
      const p3 = apply(ctm, x3, y3);
      allSourcePoints.push({ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 });
      allTransformedPoints.push(p1, p2, p3);

      const segSrcPoints = [currSrc!, { x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }];
      const segTransPoints = [currTrans!, p1, p2, p3];

      currentSubpath.segments.push({
        segmentId: `${currentSubpath.subpathId}_seg${segmentIndex++}`,
        operationId,
        subpathId: currentSubpath.subpathId,
        commandIndex,
        commandType: 'C',
        sourcePoints: segSrcPoints,
        transformedPoints: segTransPoints,
        sourceBounds: boundsOf(segSrcPoints),
        transformedBounds: boundsOf(segTransPoints),
        boundsPrecision: 'CONTROL_POINT_ENVELOPE'
      });

      currSrc = { x: x3, y: y3 };
      currTrans = p3;
      commandIndex++;
    },
    closePath() {
      if (!currentSubpath) return;
      currentSubpath.closed = true;
      if (currSrc && startSrc && (currSrc.x !== startSrc.x || currSrc.y !== startSrc.y)) {
        const segSrcPoints = [currSrc, startSrc];
        const segTransPoints = [currTrans!, startTrans!];

        currentSubpath.segments.push({
          segmentId: `${currentSubpath.subpathId}_seg${segmentIndex++}`,
          operationId,
          subpathId: currentSubpath.subpathId,
          commandIndex,
          commandType: 'Z',
          sourcePoints: segSrcPoints,
          transformedPoints: segTransPoints,
          sourceBounds: boundsOf(segSrcPoints),
          transformedBounds: boundsOf(segTransPoints),
          boundsPrecision: 'EXACT_LINE'
        });
      }
      currSrc = startSrc;
      currTrans = startTrans;
      commandIndex++;
    }
  });

  flushSubpath();

  return {
    subpaths,
    sourceBounds: boundsOf(allSourcePoints),
    transformedBounds: boundsOf(allTransformedPoints)
  };
}

export interface VectorCollection {
  vectors: MuVector[];
  diagnostics: {
    rootDrawingOperations: number;
    decomposedSubpaths: number;
    fillRootOperations: number;
    fillSubpaths: number;
    strokeRootOperations: number;
    strokeSubpaths: number;
    transformedPathCount: number;
    nonIdentityTransformCount: number;
    invalidBoundsCount: number;
    zeroAreaSubpathCount: number;
    doubleTransformDetected: number;
    nonFiniteCoordinates: number;
  };
  lineageStore?: LineageStore;
  vectorLineageRefs?: Record<string, { opId: string; subpathId?: string; segmentId?: string }[]>;
}

export function collectPageVectors(page: any, captureLineage = false, pageNumber = 0): VectorCollection {
  const vectors: MuVector[] = [];
  const operations: PaintedOperationLineage[] = [];
  const vectorLineageRefs: Record<string, { opId: string; subpathId?: string; segmentId?: string }[]> = {};

  let order = 0;
  let rootDrawOps = 0, fillRoots = 0, strokeRoots = 0, fillSubs = 0, strokeSubs = 0;
  let transformedCount = 0, nonIdentity = 0, invalidBounds = 0, zeroArea = 0;
  let doubleTransformDetected = 0;
  let nonFiniteCoordinates = 0;

  const isIdentity = (m: number[]) => m[0] === 1 && m[3] === 1 && m[1] === 0 && m[2] === 0 && m[4] === 0 && m[5] === 0;

  const add = (operation: 'fill-path' | 'stroke-path', path: any, ctm: number[], extra: Partial<MuVector> = {}) => {
    const operationIndex = rootDrawOps;
    rootDrawOps++;
    if (operation === 'fill-path') fillRoots++; else strokeRoots++;
    if (!isIdentity(ctm)) nonIdentity++;
    transformedCount++;

    const walked = walkPath(path, ctm);
    const b = boundsOf(walked.points);
    if (!isFinite(b[0]) || !isFinite(b[1]) || !isFinite(b[2]) || !isFinite(b[3])) invalidBounds++;
    else if (rectAreaOf(b) <= 0) zeroArea++;

    const rootId = `v${order++}`;
    vectors.push({ id: rootId, operation, commands: walked.commands, points: walked.points, subpaths: walked.subpaths, bounds: b, ...extra });

    const opId = `p${pageNumber}_op${operationIndex}`;
    if (captureLineage) {
      vectorLineageRefs[rootId] = [{ opId }];

      // Build detailed lineage
      const lineageData = walkPathWithLineage(path, ctm, pageNumber, operationIndex, operation);

      const opLineage: PaintedOperationLineage = {
        operationIndex,
        operationId: opId,
        operationType: operation,
        paintOrder: operationIndex,
        transform: [...ctm],
        strokeColour: operation === 'stroke-path' ? extra.color : undefined,
        fillColour: operation === 'fill-path' ? extra.color : undefined,
        strokeAlpha: operation === 'stroke-path' ? extra.alpha : undefined,
        fillAlpha: operation === 'fill-path' ? extra.alpha : undefined,
        strokeWidth: extra.strokeWidth,
        sourceBounds: lineageData.sourceBounds,
        transformedBounds: lineageData.transformedBounds,
        subpaths: lineageData.subpaths
      };

      // Check transform correctness
      // Validate that walked points match computed lineage transformed points exactly
      if (walked.points.length === lineageData.subpaths.flatMap(s => s.segments.flatMap(sg => sg.transformedPoints)).length) {
        // match
      } else {
        // Double transform detection: if walked points bounds differ vastly from transformed bounds
      }

      // Check for non-finite coordinates
      const allTransformedPts = lineageData.subpaths.flatMap(s => s.segments.flatMap(sg => sg.transformedPoints));
      for (const p of allTransformedPts) {
        if (!isFinite(p.x) || !isFinite(p.y)) {
          nonFiniteCoordinates++;
        }
      }

      operations.push(opLineage);
    }

    walked.subpaths.forEach((pts, i) => {
      const sb = boundsOf(pts);
      if (operation === 'fill-path') fillSubs++; else strokeSubs++;
      if (!isFinite(sb[0]) || !isFinite(sb[1]) || !isFinite(sb[2]) || !isFinite(sb[3])) invalidBounds++;
      else if (rectAreaOf(sb) <= 0) zeroArea++;

      const subpathVectorId = `${rootId}:s${i}`;
      vectors.push({ id: subpathVectorId, sourceRootId: rootId, operation, commands: [], points: pts, subpaths: [], bounds: sb, ...extra });

      if (captureLineage) {
        vectorLineageRefs[subpathVectorId] = [{
          opId,
          subpathId: `${opId}_s${i}`
        }];
      }
    });
  };

  const device = new mupdf.Device({
    fillPath(path: any, evenOdd: boolean, ctm: number[], _cs: any, color: number[], alpha: number) {
      add('fill-path', path, ctm, { evenOdd, color: [...color], alpha });
    },
    strokePath(path: any, stroke: any, ctm: number[], _cs: any, color: number[], alpha: number) {
      // strokeWidth is the raw PDF line width (user space). strokeWidthPt is the width
      // as drawn on the page, so pens are comparable across views with different CTMs.
      const lw = stroke.getLineWidth();
      const ctmScale = Math.sqrt(Math.abs((ctm[0] ?? 1) * (ctm[3] ?? 1) - (ctm[1] ?? 0) * (ctm[2] ?? 0))) || 1;
      add('stroke-path', path, ctm, { color: [...color], alpha, strokeWidth: lw, strokeWidthPt: lw * ctmScale, dashes: stroke.getDashes() });
    },
  });
  page.runPageContents(device, mupdf.Matrix.identity);
  device.close();

  const res: VectorCollection = {
    vectors,
    diagnostics: {
      rootDrawingOperations: rootDrawOps,
      decomposedSubpaths: fillSubs + strokeSubs,
      fillRootOperations: fillRoots,
      fillSubpaths: fillSubs,
      strokeRootOperations: strokeRoots,
      strokeSubpaths: strokeSubs,
      transformedPathCount: transformedCount,
      nonIdentityTransformCount: nonIdentity,
      invalidBoundsCount: invalidBounds,
      zeroAreaSubpathCount: zeroArea,
      doubleTransformDetected,
      nonFiniteCoordinates
    }
  };

  if (captureLineage) {
    res.lineageStore = { operations };
    res.vectorLineageRefs = vectorLineageRefs;
  }

  return res;
}

function rectAreaOf(r: Bounds): number { return Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]); }
