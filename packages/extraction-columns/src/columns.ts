// Column extraction for the CODE-06 secondary pipeline.
//
// SCOPE / OWNERSHIP
//   Consumes ONLY unclaimed captured vectors (walls / windows / doors already
//   removed upstream). Produces native Pascal ColumnNode-compatible drafts.
//
// ANTI-CHEAT INVARIANTS (asserted by test/e2e.mts)
//   * no audit/oracle JSON is imported;
//   * no expected count appears anywhere in this module;
//   * no drawing coordinate is hardcoded - every threshold is a physical
//     dimension in metres / radians / a dimensionless ratio;
//   * output is a pure function of the input geometry + options.
//
// CLASSIFICATION LADDER
//   RECTANGULAR  compact closed 4-corner ring, ~90 deg corners, equal opposite
//                sides, aspect <= maxAcceptAspect              -> ACCEPT
//   RECTANGULAR  same but aspect in (maxAcceptAspect, maxReviewAspect]
//                (pilaster / wall-nib ambiguity)               -> REVIEW
//   CIRCULAR     closed ring or cubic loop with a good circle fit
//                (curved columns land in a later phase)        -> REVIEW
//   POLYGONAL    compact closed convex-ish ring, 3..maxPolygonVertices corners
//                                                              -> REVIEW
//   everything else                                            -> REJECT (ledgered)

import {
  deterministicId,
  type CapturedGeometry,
  type Point,
  type Verdict,
} from './contracts';
import {
  bounds,
  buildComponents,
  canonicalEdges,
  circularity,
  convexHull,
  distance,
  fitCircle,
  fitRectangle,
  flattenCubic,
  mergeCollinear,
  polygonArea,
  polygonCentroid,
  type CanonicalEdge,
  type Ring,
} from './geometry';

export type ColumnFootprint = 'RECTANGULAR' | 'CIRCULAR' | 'POLYGONAL' | 'UNCLASSIFIED';
export type PascalColumnShape = 'square' | 'circle' | 'polygon';

export interface PhysicalColumn {
  /** required by the programme contract; stable across reruns */
  deterministicExtractionId: string;
  /** legacy alias kept for the pre-existing reference contract */
  physicalColumnId: string;
  footprintType: ColumnFootprint;
  centreProjectM: Point;
  widthM?: number;
  depthM?: number;
  radiusM?: number;
  polygonPoints?: Point[];
  rotationRad: number;
  heightM: number;
  sourceSegmentIds: string[];
  sourceOperationIds: string[];
  verdict: Verdict;
  /** human/geometric justification - drives the review manifest */
  reason: string;
  /** dimensionless quality descriptors used by the audit overlays */
  metrics: {
    aspect: number;
    rectangularity: number;
    circularity: number;
    circleRadialDev: number;
    cornerDevRad: number;
    sideRatioDev: number;
    vertexCount: number;
    edgeCount: number;
    explicitClose: boolean;
  };
  pascal: {
    nodeType: 'column';
    shape: PascalColumnShape;
    position: [number, number, number];
    rotation: [number, number, number];
    width?: number;
    depth?: number;
    radius?: number;
    height: number;
  };
}

export interface RejectedCandidate {
  candidateId: string;
  footprintType: ColumnFootprint;
  reason: string;
  widthM: number;
  depthM: number;
  centreProjectM: Point;
  edgeCount: number;
  vertexCount: number;
  sourceSegmentIds: string[];
}

export interface ColumnExtractionReport {
  columns: PhysicalColumn[];
  rejected: RejectedCandidate[];
  stats: {
    inputSegments: number;
    inputCurves: number;
    canonicalEdges: number;
    ringComponents: number;
    branchedComponents: number;
    oversizedComponents: number;
    curveLoops: number;
    accepted: number;
    review: number;
    rejected: number;
    duplicatesCollapsed: number;
    outsideEnvelope: number;
    // Corrected full distribution (accepted + review + rejected = totalCandidates).
    totalCandidates: number;
    acceptedByFootprintType: Record<string, number>;
    reviewByFootprintType: Record<string, number>;
    rejectedByFootprintType: Record<string, number>;
    reviewByReason: Record<string, number>;
    rejectedByReason: Record<string, number>;
    // Configurable structural-column rule context (not a universal constant).
    minStructuralDimM: number;
    minStructuralDimMNote: string;
  };
}

/** Axis-aligned region, in drawing units, that bounds the structure itself. */
export interface StructuralEnvelopeUnits {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ColumnOptions {
  /** vertex-equality tolerance, metres */
  joinToleranceM: number;
  /** smallest permitted footprint side, metres */
  minSizeM: number;
  /** smallest cross-section a *structural* column may have; below this a
   *  closed rectangle is treated as furniture / fitting, not a column. */
  minStructuralDimM: number;
  /** largest permitted footprint side, metres */
  maxSizeM: number;
  /** aspect (long/short) at or below which a rectangle is ACCEPTed */
  maxAcceptAspect: number;
  /** aspect above which a rectangle is not a column at all */
  maxReviewAspect: number;
  /** polygon area / oriented-bbox area required for a rectangle */
  minRectangularity: number;
  /** max corner deviation from 90 degrees, radians */
  maxCornerDevRad: number;
  /** max |opposite side| length mismatch as a fraction */
  maxSideRatioDev: number;
  /** max relative radial deviation for a circle fit */
  circleRadialTolerance: number;
  /** min isoperimetric compactness for a circle */
  minCircleCircularity: number;
  /** min ring vertices before a circle fit is trusted */
  minCircleVertices: number;
  /** polygon review band */
  maxPolygonVertices: number;
  /** min convexity (polygon area / hull area) for a polygon candidate */
  minPolygonConvexity: number;
  /** collinear-merge tolerance, radians */
  collinearToleranceRad: number;
  /** components larger than this are never a single footprint */
  maxComponentEdges: number;
  /** duplicate suppression radius, metres */
  duplicateToleranceM: number;
  defaultHeightM: number;
  /** flattening resolution for cubic loops */
  curveFlattenSteps: number;
  /** emit REJECT rows for near-miss candidates (audit ledger) */
  ledgerNearMisses: boolean;
  /**
   * Optional structural envelope in drawing units. When supplied, footprints
   * whose centroid falls outside it (plus `envelopePaddingM`) are rejected as
   * titleblock / legend / annotation furniture rather than structure.
   */
  structuralEnvelope?: StructuralEnvelopeUnits;
  /** tolerance band around the structural envelope, metres */
  envelopePaddingM: number;
}

export const COLUMN_DEFAULTS: ColumnOptions = {
  joinToleranceM: 0.002,
  minSizeM: 0.25,
  minStructuralDimM: 0.4,
  maxSizeM: 1.2,
  maxAcceptAspect: 1.6,
  maxReviewAspect: 2.6,
  minRectangularity: 0.94,
  maxCornerDevRad: 0.12,
  maxSideRatioDev: 0.08,
  circleRadialTolerance: 0.12,
  minCircleCircularity: 0.85,
  minCircleVertices: 8,
  maxPolygonVertices: 12,
  minPolygonConvexity: 0.85,
  collinearToleranceRad: 0.06,
  maxComponentEdges: 80,
  duplicateToleranceM: 0.05,
  defaultHeightM: 3,
  curveFlattenSteps: 8,
  ledgerNearMisses: true,
  envelopePaddingM: 0.5,
};

interface Candidate {
  ring: Point[];
  corners: Point[];
  edgeIds: string[];
  opIds: string[];
  edgeCount: number;
  explicitClose: boolean;
  origin: 'ring' | 'curve';
}

/** Full report form. `extractColumns` is the thin, contract-shaped wrapper. */
export function extractColumnReport(
  input: CapturedGeometry,
  options: Partial<ColumnOptions> = {},
): ColumnExtractionReport {
  const o: ColumnOptions = { ...COLUMN_DEFAULTS, ...options };
  const mmPerUnit = input.mmPerUnit;
  const unitsPerM = 1000 / mmPerUnit; // drawing units in one metre
  const toM = (u: number) => (u * mmPerUnit) / 1000;
  const joinUnits = Math.max(o.joinToleranceM * unitsPerM, 1e-6);

  const edges = canonicalEdges(input.segments, joinUnits);
  const comps = buildComponents(edges, joinUnits, o.maxComponentEdges);

  const candidates: Candidate[] = [];
  for (const r of comps.rings) {
    const corners = mergeCollinear(r.vertices, o.collinearToleranceRad);
    candidates.push({
      ring: r.vertices,
      corners,
      edgeIds: r.edgeIds,
      opIds: r.opIds,
      edgeCount: r.edgeCount,
      explicitClose: r.explicitClose,
      origin: 'ring',
    });
  }
  for (const loop of curveLoops(input, o, joinUnits)) candidates.push(loop);

  const columns: PhysicalColumn[] = [];
  const rejected: RejectedCandidate[] = [];
  let outsideEnvelope = 0;

  // Structural envelope in metres (converted once). Geometry outside the
  // building outline is drawing furniture, never a column.
  const env = o.structuralEnvelope;
  const envM = env
    ? {
        minX: toM(env.minX) - o.envelopePaddingM,
        minY: toM(env.minY) - o.envelopePaddingM,
        maxX: toM(env.maxX) + o.envelopePaddingM,
        maxY: toM(env.maxY) + o.envelopePaddingM,
      }
    : undefined;

  for (const c of candidates) {
    const evalRes = evaluate(c, o, toM);
    if (evalRes.column) {
      const p = evalRes.column.centreProjectM;
      if (envM && (p.x < envM.minX || p.x > envM.maxX || p.y < envM.minY || p.y > envM.maxY)) {
        outsideEnvelope++;
        if (o.ledgerNearMisses) {
          rejected.push({
            candidateId: deterministicId('cand', c.edgeIds),
            footprintType: 'UNCLASSIFIED',
            reason: 'outside-structural-envelope (titleblock / legend / annotation region)',
            widthM: evalRes.column.widthM ?? 0,
            depthM: evalRes.column.depthM ?? 0,
            centreProjectM: p,
            edgeCount: c.edgeCount,
            vertexCount: c.corners.length,
            sourceSegmentIds: c.edgeIds,
          });
        }
        continue;
      }
      columns.push(evalRes.column);
    } else if (o.ledgerNearMisses && evalRes.ledger) rejected.push(evalRes.ledger);
  }

  // ---- duplicate suppression (same physical footprint reached twice) -------
  const dupTolUnits = o.duplicateToleranceM;
  const kept: PhysicalColumn[] = [];
  let duplicatesCollapsed = 0;
  const sorted = columns.slice().sort(columnOrder);
  for (const col of sorted) {
    const twin = kept.find(
      (k) =>
        distance(k.centreProjectM, col.centreProjectM) <= dupTolUnits &&
        k.footprintType === col.footprintType,
    );
    if (twin) {
      duplicatesCollapsed++;
      // merge provenance so no source vector is lost
      twin.sourceSegmentIds = [...new Set([...twin.sourceSegmentIds, ...col.sourceSegmentIds])].sort();
      twin.sourceOperationIds = [...new Set([...twin.sourceOperationIds, ...col.sourceOperationIds])].sort();
      continue;
    }
    kept.push(col);
  }
  kept.sort(columnOrder);

  const accepted = kept.filter((c) => c.verdict === 'ACCEPT').length;
  const review = kept.filter((c) => c.verdict === 'REVIEW').length;

  const byFootprint = (arr: { footprintType: string }[]) =>
    arr.reduce<Record<string, number>>((m, c) => ((m[c.footprintType] = (m[c.footprintType] ?? 0) + 1), m), {});
  const byReason = (arr: { reason: string }[]) =>
    arr.reduce<Record<string, number>>((m, c) => {
      const k = (c.reason ?? 'unknown').split('(')[0].trim();
      m[k] = (m[k] ?? 0) + 1;
      return m;
    }, {});

  return {
    columns: kept,
    rejected: rejected.sort((a, b) => (a.candidateId < b.candidateId ? -1 : 1)),
    stats: {
      inputSegments: input.segments.length,
      inputCurves: input.curves.length,
      canonicalEdges: edges.length,
      ringComponents: comps.rings.length,
      branchedComponents: comps.branched.length,
      oversizedComponents: comps.oversized,
      curveLoops: candidates.filter((c) => c.origin === 'curve').length,
      accepted,
      review,
      rejected: rejected.length,
      duplicatesCollapsed,
      outsideEnvelope,
      // ---- corrected full distribution (accepted + review + rejected = totalCandidates) ----
      totalCandidates: accepted + review + rejected.length,
      acceptedByFootprintType: byFootprint(kept.filter((c) => c.verdict === 'ACCEPT')),
      reviewByFootprintType: byFootprint(kept.filter((c) => c.verdict === 'REVIEW')),
      rejectedByFootprintType: byFootprint(rejected),
      reviewByReason: byReason(kept.filter((c) => c.verdict === 'REVIEW')),
      rejectedByReason: byReason(rejected),
      // ---- configurable structural-column rule context (Item 2) ----
      minStructuralDimM: o.minStructuralDimM,
      minStructuralDimMNote: 'configurable per project/source; not a universal constant',
    },
  };
}

/** Contract entry point: the accepted + review column drafts. */
export function extractColumns(
  input: CapturedGeometry,
  options: Partial<ColumnOptions> = {},
): PhysicalColumn[] {
  return extractColumnReport(input, options).columns;
}

function columnOrder(a: PhysicalColumn, b: PhysicalColumn): number {
  const ax = round6(a.centreProjectM.x);
  const bx = round6(b.centreProjectM.x);
  if (ax !== bx) return ax - bx;
  const ay = round6(a.centreProjectM.y);
  const by = round6(b.centreProjectM.y);
  if (ay !== by) return ay - by;
  return a.deterministicExtractionId < b.deterministicExtractionId ? -1 : 1;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

function evaluate(
  c: Candidate,
  o: ColumnOptions,
  toM: (u: number) => number,
): { column?: PhysicalColumn; ledger?: RejectedCandidate } {
  const bb = bounds(c.ring);
  const wM = toM(bb.width);
  const hM = toM(bb.height);
  const centreBbox: Point = { x: toM((bb.minX + bb.maxX) / 2), y: toM((bb.minY + bb.maxY) / 2) };
  const shortM = Math.min(wM, hM);
  const longM = Math.max(wM, hM);
  const candidateId = deterministicId('cand', c.edgeIds);
  const ledgerBase = {
    candidateId,
    footprintType: 'UNCLASSIFIED' as ColumnFootprint,
    widthM: wM,
    depthM: hM,
    centreProjectM: centreBbox,
    edgeCount: c.edgeCount,
    vertexCount: c.corners.length,
    sourceSegmentIds: c.edgeIds,
  };

  if (shortM < o.minSizeM) return { ledger: { ...ledgerBase, reason: `below-min-size(${shortM.toFixed(3)}m)` } };
  if (shortM < o.minStructuralDimM) return { ledger: { ...ledgerBase, reason: `below-min-structural-column(${shortM.toFixed(3)}m)` } };
  if (longM > o.maxSizeM) return { ledger: { ...ledgerBase, reason: `above-max-size(${longM.toFixed(3)}m)` } };

  const circ = circularity(c.ring);
  const fitC = fitCircle(c.ring);
  const isCircle =
    c.ring.length >= o.minCircleVertices &&
    fitC.maxRelDev <= o.circleRadialTolerance &&
    circ >= o.minCircleCircularity;

  const rect = fitRectangle(c.corners);
  const aspect = longM / Math.max(shortM, 1e-9);

  // ---------------- circular ------------------------------------------------
  if (isCircle) {
    const radiusM = toM(fitC.radius);
    const centre: Point = { x: toM(fitC.centre.x), y: toM(fitC.centre.y) };
    if (radiusM * 2 < o.minSizeM || radiusM * 2 > o.maxSizeM) {
      return { ledger: { ...ledgerBase, footprintType: 'CIRCULAR', reason: `circle-out-of-size(${(radiusM * 2).toFixed(3)}m)` } };
    }
    return {
      column: makeColumn({
        footprintType: 'CIRCULAR',
        shape: 'circle',
        centre,
        radiusM,
        polygonPoints: c.ring.map((p) => ({ x: toM(p.x), y: toM(p.y) })),
        rotationRad: 0,
        verdict: 'REVIEW',
        reason: `circular-footprint diameter=${(radiusM * 2).toFixed(3)}m radialDev=${fitC.maxRelDev.toFixed(3)}; curved columns are deferred to a later phase`,
        c,
        o,
        metrics: {
          aspect,
          rectangularity: 0,
          circularity: circ,
          circleRadialDev: fitC.maxRelDev,
          cornerDevRad: 0,
          sideRatioDev: 0,
        },
      }),
    };
  }

  // ---------------- rectangular --------------------------------------------
  if (
    c.corners.length === 4 &&
    rect.isRect &&
    rect.rectangularity >= o.minRectangularity &&
    rect.maxCornerDevRad <= o.maxCornerDevRad &&
    rect.sideRatioDev <= o.maxSideRatioDev
  ) {
    const centroid = polygonCentroid(c.corners);
    const centre: Point = { x: toM(centroid.x), y: toM(centroid.y) };
    const longSideM = toM(rect.longUnits);
    const shortSideM = toM(rect.shortUnits);
    const orientedAspect = longSideM / Math.max(shortSideM, 1e-9);
    if (shortSideM < o.minSizeM) {
      return { ledger: { ...ledgerBase, footprintType: 'RECTANGULAR', reason: `rect-side-below-min(${shortSideM.toFixed(3)}m)` } };
    }
    if (longSideM > o.maxSizeM) {
      return { ledger: { ...ledgerBase, footprintType: 'RECTANGULAR', reason: `rect-side-above-max(${longSideM.toFixed(3)}m)` } };
    }
    if (orientedAspect > o.maxReviewAspect) {
      return {
        ledger: {
          ...ledgerBase,
          footprintType: 'RECTANGULAR',
          reason: `elongated-not-a-column aspect=${orientedAspect.toFixed(2)} (wall / panel / door-leaf geometry)`,
        },
      };
    }
    // width follows the local X axis of the footprint (rotation carries orientation)
    const widthM = longSideM;
    const depthM = shortSideM;
    const acceptable = orientedAspect <= o.maxAcceptAspect;
    return {
      column: makeColumn({
        footprintType: 'RECTANGULAR',
        shape: 'square',
        centre,
        widthM,
        depthM,
        rotationRad: rect.rotationRad,
        verdict: acceptable ? 'ACCEPT' : 'REVIEW',
        reason: acceptable
          ? `compact closed rectangular footprint ${widthM.toFixed(3)}x${depthM.toFixed(3)}m aspect=${orientedAspect.toFixed(2)} rectangularity=${rect.rectangularity.toFixed(3)}`
          : `elongated rectangular footprint aspect=${orientedAspect.toFixed(2)} - possible pilaster / wall nib, held for review`,
        c,
        o,
        metrics: {
          aspect: orientedAspect,
          rectangularity: rect.rectangularity,
          circularity: circ,
          circleRadialDev: fitC.maxRelDev,
          cornerDevRad: rect.maxCornerDevRad,
          sideRatioDev: rect.sideRatioDev,
        },
      }),
    };
  }

  // ---------------- polygonal ----------------------------------------------
  if (c.corners.length >= 3 && c.corners.length <= o.maxPolygonVertices) {
    const hull = convexHull(c.corners);
    const hullArea = polygonArea(hull);
    const convexity = hullArea > 1e-12 ? polygonArea(c.corners) / hullArea : 0;
    if (convexity >= o.minPolygonConvexity && aspect <= o.maxReviewAspect) {
      const centroid = polygonCentroid(c.corners);
      return {
        column: makeColumn({
          footprintType: 'POLYGONAL',
          shape: 'polygon',
          centre: { x: toM(centroid.x), y: toM(centroid.y) },
          widthM: wM,
          depthM: hM,
          polygonPoints: c.corners.map((p) => ({ x: toM(p.x), y: toM(p.y) })),
          rotationRad: 0,
          verdict: 'REVIEW',
          reason: `polygonal footprint ${c.corners.length} corners convexity=${convexity.toFixed(3)} - retained for review`,
          c,
          o,
          metrics: {
            aspect,
            rectangularity: 0,
            circularity: circ,
            circleRadialDev: fitC.maxRelDev,
            cornerDevRad: 0,
            sideRatioDev: 0,
          },
        }),
      };
    }
    return {
      ledger: {
        ...ledgerBase,
        footprintType: 'POLYGONAL',
        reason: `polygon-rejected convexity=${convexity.toFixed(3)} aspect=${aspect.toFixed(2)}`,
      },
    };
  }

  return {
    ledger: {
      ...ledgerBase,
      reason: `unclassified corners=${c.corners.length} circularity=${circ.toFixed(3)} radialDev=${fitC.maxRelDev.toFixed(3)}`,
    },
  };
}

function makeColumn(args: {
  footprintType: ColumnFootprint;
  shape: PascalColumnShape;
  centre: Point;
  widthM?: number;
  depthM?: number;
  radiusM?: number;
  polygonPoints?: Point[];
  rotationRad: number;
  verdict: Verdict;
  reason: string;
  c: Candidate;
  o: ColumnOptions;
  metrics: {
    aspect: number;
    rectangularity: number;
    circularity: number;
    circleRadialDev: number;
    cornerDevRad: number;
    sideRatioDev: number;
  };
}): PhysicalColumn {
  const { c, o } = args;
  const id = deterministicId('col', c.edgeIds);
  return {
    deterministicExtractionId: id,
    physicalColumnId: id,
    footprintType: args.footprintType,
    centreProjectM: { x: round6(args.centre.x), y: round6(args.centre.y) },
    widthM: args.widthM === undefined ? undefined : round6(args.widthM),
    depthM: args.depthM === undefined ? undefined : round6(args.depthM),
    radiusM: args.radiusM === undefined ? undefined : round6(args.radiusM),
    polygonPoints: args.polygonPoints?.map((p) => ({ x: round6(p.x), y: round6(p.y) })),
    rotationRad: round6(args.rotationRad),
    heightM: o.defaultHeightM,
    sourceSegmentIds: c.edgeIds,
    sourceOperationIds: c.opIds,
    verdict: args.verdict,
    reason: args.reason,
    metrics: {
      ...args.metrics,
      vertexCount: c.corners.length,
      edgeCount: c.edgeCount,
      explicitClose: c.explicitClose,
    },
    pascal: {
      nodeType: 'column',
      shape: args.shape,
      position: [round6(args.centre.x), 0, round6(args.centre.y)],
      rotation: [0, round6(args.rotationRad), 0],
      width: args.widthM === undefined ? undefined : round6(args.widthM),
      depth: args.depthM === undefined ? undefined : round6(args.depthM),
      radius: args.radiusM === undefined ? undefined : round6(args.radiusM),
      height: o.defaultHeightM,
    },
  };
}

/**
 * Curve-fit path: consecutive cubics belonging to one operation that return to
 * their start form a closed curved loop (a drawn circle). Flattened and handed
 * to the same classifier so circular columns are found even when the capture
 * kept them as bezier commands.
 */
function curveLoops(input: CapturedGeometry, o: ColumnOptions, joinUnits: number): Candidate[] {
  const byOp = new Map<string, typeof input.curves>();
  for (const cu of input.curves) {
    if (cu.claimedBy) continue;
    const op = cu.sourceOperationId ?? cu.id;
    const arr = byOp.get(op);
    if (arr) arr.push(cu);
    else byOp.set(op, [cu]);
  }
  const out: Candidate[] = [];
  for (const [, curves] of [...byOp.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (curves.length < 2 || curves.length > o.maxComponentEdges) continue;
    const first = curves[0];
    const last = curves[curves.length - 1];
    if (distance(first.p0, last.p3) > joinUnits * 4) continue; // not a closed loop
    const pts: Point[] = [];
    for (const cu of curves) {
      const fl = flattenCubic(cu, o.curveFlattenSteps);
      for (let i = 0; i < fl.length - 1; i++) pts.push(fl[i]);
    }
    if (pts.length < o.minCircleVertices) continue;
    const ids = curves.map((c) => c.id).sort();
    const ops = [...new Set(curves.map((c) => c.sourceOperationId).filter((v): v is string => !!v))].sort();
    out.push({
      ring: pts,
      corners: mergeCollinear(pts, o.collinearToleranceRad),
      edgeIds: ids,
      opIds: ops,
      edgeCount: curves.length,
      explicitClose: true,
      origin: 'curve',
    });
  }
  return out;
}

export type { CanonicalEdge, Ring };
