/**
 * PURE MuPDF wall tracer — production-candidate pipeline (spec DIRECTION CHANGE).
 *
 * Self-contained: derives the complete physical wall network from MuPDF vectors
 * only. It MUST NOT import current-tracer or fusion modules that could change
 * MuPDF decisions. The legacy current tracer and the experimental fused union
 * remain available as DEVELOPMENT-ONLY comparisons (see trace/mode.ts), but they
 * never feed MuPDF acceptance/rejection.
 *
 * Coordinate space: MuPDF PDF *points* (no ÷16 hard-code; per-page scale derived
 * from the page MediaBox). Overlays register because the source PNG is the full
 * page and the SVG viewBox is the MuPDF page bounds.
 *
 * Stage order (spec §2):
 *   MuPDF vector ops → normalized primitives → building footprint →
 *   wall-evidence generators → candidate fusion → physical connectivity →
 *   evidence classification → accepted/review/rejected → split accepted only.
 */
import * as mupdf from 'mupdf';
import { collectSegments, detectDoorSymbols } from './door-symbols';
import { estimateScale, textsFromStructuredTextJson } from './scale-detection';
import { detectWallsGeneral, type WallRaster } from './wall-general';
import {
  collectPageVectors,
  type Bounds,
  type MuVector,
  type Vec2,
  type LineageStore,
} from './vector-device';
import {
  rectArea,
  rectWidth,
  rectHeight,
  intersects,
  isAxisRect,
  medial,
  pointSegmentDistance,
  dedupePoints,
} from './geometry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvidenceType =
  | 'filled-rect'
  | 'filled-polygon'
  | 'parallel-face'
  | 'single-line'
  | 'recovered';

export interface PureCandidate {
  id: string;
  evidenceType: EvidenceType;
  sourceRootIds: string[];
  sourceSubpathIds: string[];
  sourceStrokeIds: string[];
  centerline: { a: Vec2; b: Vec2 };
  thickness: number; // mupdf points (perpendicular wall thickness)
  length: number;
  orientation: number; // 0 = horizontal, π/2 = vertical, else other (legacy audit grouping only)
  orientationRadians: number; // true oriented direction angle in [0, 2π)
  orientationClass: 'horizontal' | 'vertical' | 'diagonal';
  confidence: number;
  evidence: string[];
}

export interface LogicalWallRun {
  logicalWallRunId: string;
  physicalFragmentIds: string[];
  openingIntervals: { from: number; to: number }[];
  sourcePrimitiveIds: string[];
}

export interface ThicknessBand {
  center: number;
  min: number;
  max: number;
  frequency: number;
  totalSupportedLength: number;
  confidence: number;
}

export interface Junction {
  kind: 'endpoint' | 'T' | 'X' | 'collinear' | 'opening' | 'perimeter' | 'near-miss' | 'floating';
  at: Vec2;
  candidateIds: string[];
  scaleDerivedTolerance: number;
}

export type PureVerdict = 'accepted' | 'review' | 'rejected';

export interface PurePhysicalWall extends PureCandidate {
  physicalWallId: string;
  verdict: PureVerdict;
  networkConnectivity: number;
  perimeterContribution: boolean;
  genuinelyFloating: boolean;
  floatingClass?: WallConnectivity['floatingClass'];
  connectivityClass?: WallConnectivity['classification'];
  fusedCandidateIds: string[];
  evidenceTypes: EvidenceType[];
  positiveEvidence: string[];
  negativeEvidence: string[];
  logicalWallRunId?: string;
  isFragmentOfOpening?: boolean;
  rejectionReason?: string;
  ownedBy?: string; // physicalWallId of the stronger candidate that owns this primitive
}

export interface RecallDiscrepancy {
  mupdfAccepted: number;
  legacyPhysicalInsideRoi: number;
  matched: number;
  legacyOnly: { id: string; nearMupdfPrimitive?: string[] }[];
  mupdfOnly: number;
}

export interface OrientationAudit {
  acceptedHorizontalWalls: number;
  acceptedVerticalWalls: number;
  acceptedOtherAngleWalls: number;
  acceptedHorizontalLength: number;
  acceptedVerticalLength: number;
  shortAcceptedWalls: number;
  mediumAcceptedWalls: number;
  longAcceptedWalls: number;
  acceptedJunctionPartitions: number;
  acceptedPerimeterWalls: number;
  reviewWalls: number;
  rejectedWalls: number;
  floatingAcceptedWalls: number;
}

export interface PureTiming {
  pdfLoad: number;
  vectorCollection: number;
  subpathNormalization: number;
  roiDerivation: number;
  thicknessInference: number;
  candidateGeneration: number;
  filledClassification: number;
  candidateFusion: number;
  connectivity: number;
  connectivityAnalysis: number;
  classification: number;
  overlayGeneration: number;
  total: number;
}

export interface MuPdfLineageAuditResult {
  pureResult: MuPdfPureResult;
  lineageStore: LineageStore;
  vectorLineageRefs: Record<string, { opId: string; subpathId?: string; segmentId?: string }[]>;
}

export interface MuPdfPureResult {
  pageBoundsMupdf: Bounds;
  activeBuildingRegionMupdf: Bounds;
  activeBuildingRegionSource: Bounds; // normalized for downstream/overlay convenience
  vectorOperationCount: number;
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
  };
  // candidates by evidence source (before fusion)
  candidatesBySource: Record<EvidenceType, PureCandidate[]>;
  allCandidates: PureCandidate[];
  thicknessBands: ThicknessBand[];
  logicalWallRuns: LogicalWallRun[];
  collinearRuns: { combinedId: string; memberIds: string[]; openingIntervals: { from: number; to: number }[] }[];
  junctions: Junction[];
  recoveredSmallWalls: PureCandidate[];
  physicalWalls: PurePhysicalWall[];
  roi: Bounds;
  accepted: PurePhysicalWall[];
  /** Real-world scale (mm per PDF point), derived from the drawing's dimension
   *  text via MuPDF — no pdf2json. Used to convert walls to meters. */
  scaleMmPerPt: number;
  scaleSource: 'dim-text' | 'fallback' | 'dimension-vote' | 'dimension-vote+title' | 'title-block';
  /** which wall stages produced `accepted`: the fill-based legacy stages or the general detector */
  wallEngine?: 'legacy' | 'general';
  /** why that engine was chosen (diagnostic) */
  wallEngineNote?: string;
  review: PurePhysicalWall[];
  rejected: PurePhysicalWall[];
  floatingAccepted: PurePhysicalWall[];
  genuinelyFloatingAcceptedPhysicalWalls: PurePhysicalWall[];
  connectivity: WallConnectivity[];
  connectivitySummary: Record<string, number>;
  floatingAttributionBreakdown: {
    totalFloatingAttributions: number;
    duplicateFragmentArtifacts: number;
    endpointToleranceMisses: number;
    validPerimeterTerminations: number;
    validDoorOpeningTerminations: number;
    validFinitePartitions: number;
    validFreeEnds: number;
    genuinelyFloatingPhysicalWalls: number;
    unexplained: number;
  };
  primitiveOwnership: {
    totalNormalizedPrimitives: number;
    ownedByAcceptedWalls: number;
    ownedByOpeningEvidence: number;
    ownedByJunctionEvidence: number;
    rejectedNonWalls: number;
    unresolvedWallLikePrimitives: number;
    unclassifiedPrimitives: number;
  };
  rejectionByReason: Record<string, number>;
  reviewByGenerator: Record<string, number>;
  promotedSingleLines: { physicalWallId: string; promotionEvidence: string[] }[];
  openingLedger: {
    logicalWallRunId: string;
    physicalFragmentIds: string[];
    openingIntervals: { from: number; to: number }[];
    openingWidths: number[];
    sourcePrimitiveIds: string[];
    collinearError: number;
    wallThickness: number;
    openingPreserved: boolean;
  }[];
  duplicateFusionLedger: { physicalWallId: string; fusedCandidateIds: string[]; reason: string }[];
  recall: RecallDiscrepancy;
  orientation: OrientationAudit;
  timings: PureTiming;
  candidateHash: string;
}

// ---------------------------------------------------------------------------
// Dynamic configuration (NO CODE-06-specific constants — P14/P23)
// ---------------------------------------------------------------------------

export interface PureWallConfig {
  /** max fraction of page area a filled path may occupy and still be a wall mass */
  pageFillMaxRatio: number;
  minThickness: number; // mupdf points
  maxThickness: number; // mupdf points
  minLength: number; // mupdf points
  minAspect: number;
  mergeGap: number; // mupdf points
  axisToleranceRadians: number;
  connectTolerance: number;
  acceptAt: number;
  /** door-opening gap band (mupdf points) */
  doorGapMin: number;
  doorGapMax: number;
  /** parallel-face stroke matching */
  faceOverlapMin: number;
  /** recovery pass */
  recoveryEndpointTol: number;
}

export const PURE_DEFAULTS: PureWallConfig = {
  pageFillMaxRatio: 0.8,
  minThickness: 3.2,
  maxThickness: 16,
  minLength: 18,
  minAspect: 3.2,
  mergeGap: 2.4,
  axisToleranceRadians: 1.4,
  connectTolerance: 5.5,
  acceptAt: 0.66,
  doorGapMin: 14,
  doorGapMax: 60,
  faceOverlapMin: 0.55,
  recoveryEndpointTol: 4.0,
};

/**
 * Derive dimensional tolerances from page scale, coordinate precision and the
 * inferred wall-thickness bands (spec §5) — NO fixed magic numbers beyond the
 * dimensionless ratios below. Everything scales with the drawing's own geometry.
 *
 *   - coordinatePrecision: smallest meaningful separation at this page scale
 *     (derived from the page diagonal in MuPDF points vs. a nominal 1px)
 *   - min/max thickness & bands come from inferThicknessBands on filled masses
 *   - join distance / merge gap / endpoint tolerance scale with precision + band
 *   - opening bands scale with the dominant wall thickness (door ≈ 0.6–1.2×T)
 */
export function derivePureConfig(
  pageBounds: Bounds,
  bands: ThicknessBand[],
  precisionOverride?: number,
): PureWallConfig {
  const pb = pageBounds;
  const pageDiag = Math.hypot(pb[2] - pb[0], pb[3] - pb[1]); // mupdf points
  // coordinate precision: ~1/2000 of the page diagonal (sub-pixel at this scale)
  const precision = precisionOverride ?? Math.max(0.25, pageDiag / 2000);
  const dom = bands.length
    ? bands.reduce((m, b) => (b.frequency > m.frequency ? b : m), bands[0]!).center
    : 6;
  const thin = bands.length ? Math.min(...bands.map((b) => b.center)) : 3.2;
  const thick = bands.length ? Math.max(...bands.map((b) => b.center)) : 16;
  const minThickness = Math.max(precision, thin * 0.7);
  const maxThickness = Math.max(thick * 1.4, thin * 4);
  const minLength = Math.max(precision * 8, thin * 3); // a wall spans several thicknesses
  const mergeGap = Math.max(precision * 1.5, thin * 0.4);
  const connectTolerance = Math.max(precision * 2, thick * 0.5);
  const axisToleranceRadians = Math.max(0.6, precision * 0.5); // radians; ~0.03rad for typical pages
  const doorGapMin = dom * 0.6;   // a door is at least ~0.6× wall thickness
  const doorGapMax = dom * 1.2 + thick; // up to ~1.2×T plus thick (double-leaf / wide opening)

  // ---- dimensionless safety limits (spec §12): dynamic ≠ unconstrained ----
  // every derived value is clamped to a plausible normalized range; if a value
  // is non-finite the seed default is kept (fail-safe, geometry goes to review
  // rather than being accepted more broadly).
  const clamp = (v: number, lo: number, hi: number, fallback: number): number =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  const boundedMinThickness = clamp(minThickness, precision, pageDiag * 0.01, PURE_DEFAULTS.minThickness);
  const boundedMaxThickness = clamp(maxThickness, boundedMinThickness * 2, pageDiag * 0.02, PURE_DEFAULTS.maxThickness);
  const boundedMinLength = clamp(minLength, precision * 4, pageDiag * 0.05, PURE_DEFAULTS.minLength);
  // merge gap never exceeds the thin wall band (max merge gap relative to candidate thickness)
  const boundedMergeGap = clamp(mergeGap, precision * 0.5, thin, PURE_DEFAULTS.mergeGap);
  // connection tolerance never exceeds one full structural thickness
  const boundedConnectTolerance = clamp(connectTolerance, precision, thick, PURE_DEFAULTS.connectTolerance);
  const boundedAxisTol = clamp(axisToleranceRadians, 0.01, Math.PI / 4, PURE_DEFAULTS.axisToleranceRadians);
  const boundedDoorGapMin = clamp(doorGapMin, precision * 2, pageDiag * 0.01, PURE_DEFAULTS.doorGapMin);
  // opening width bounded by module scale: ≤ 6× dominant thickness and ≤ 2% of page diagonal
  const boundedDoorGapMax = clamp(doorGapMax, boundedDoorGapMin * 1.5, Math.min(pageDiag * 0.02, dom * 6), PURE_DEFAULTS.doorGapMax);
  return {
    ...PURE_DEFAULTS,
    minThickness: +boundedMinThickness.toFixed(3),
    maxThickness: +boundedMaxThickness.toFixed(3),
    minLength: +boundedMinLength.toFixed(3),
    mergeGap: +boundedMergeGap.toFixed(3),
    connectTolerance: +boundedConnectTolerance.toFixed(3),
    axisToleranceRadians: +boundedAxisTol.toFixed(4),
    doorGapMin: +boundedDoorGapMin.toFixed(3),
    doorGapMax: +boundedDoorGapMax.toFixed(3),
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers (pure, in mupdf points)
// ---------------------------------------------------------------------------

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

/** Input for withOrientation: a candidate whose orientation stamps are optional. */
type PureCandidateDraft = Omit<PureCandidate, 'orientation' | 'orientationRadians' | 'orientationClass'> &
  Partial<Pick<PureCandidate, 'orientation' | 'orientationRadians' | 'orientationClass'>>;
/** Stamp true orientation (radians + coarse class) on a candidate. */
function withOrientation(c0: PureCandidateDraft): PureCandidate {
  const c = c0 as PureCandidate;
  c.orientation = segOrientation(c.centerline.a, c.centerline.b);
  c.orientationRadians = segmentAngleRad(c.centerline);
  c.orientationClass = segmentAngleClass(c.centerline);
  return c;
}

function segOrientation(a: Vec2, b: Vec2): number {
  // legacy binary orientation (0 = horizontal, π/2 = vertical) — kept for audit grouping only
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  if (dx < 1e-6 && dy < 1e-6) return 0;
  return dx >= dy ? 0 : Math.PI / 2;
}
/** Unit direction vector of a complete segment (independent of its endpoints). */
function segmentDir(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}
/** Oriented direction angle of a single segment, in [0, 2π). EXPORTED for tests. */
export function segmentAngleRad(seg: { a: Vec2; b: Vec2 }): number {
  const ang = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x);
  return ang < 0 ? ang + Math.PI * 2 : ang;
}
/** Coarse orientation class of a single segment. EXPORTED for tests. */
export function segmentAngleClass(seg: { a: Vec2; b: Vec2 }): 'horizontal' | 'vertical' | 'diagonal' {
  const ang = segmentAngleRad(seg) % Math.PI; // [0, π)
  const eps = 0.02;
  if (ang <= eps || Math.abs(ang - Math.PI) < eps) return 'horizontal';
  if (Math.abs(ang - Math.PI / 2) <= eps) return 'vertical';
  return 'diagonal';
}
/**
 * Smallest angle between TWO complete segments, in [0, π/2].
 * Each segment contributes its OWN direction vector; a reversed segment is the
 * same line (parallel), so the difference is 0. This is the correct comparator
 * for pairing / fusion / collinearity / junctions — never a self-comparison.
 */
/** Smallest angle between TWO complete segments, in [0, π/2]. EXPORTED for tests. */
export function segmentAngleDiffRad(s1: { a: Vec2; b: Vec2 }, s2: { a: Vec2; b: Vec2 }): number {
  const a = segmentAngleRad(s1) % Math.PI;
  const b = segmentAngleRad(s2) % Math.PI;
  let d = Math.abs(a - b);
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}
function perpDistance(p: Vec2, s: { a: Vec2; b: Vec2 }): number { return pointSegmentDistance(p, s); }
/** Perpendicular distance from a point to the INFINITE line through s (not clamped). */
function pointLineDistance(p: Vec2, s: { a: Vec2; b: Vec2 }): number {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return Math.hypot(p.x - s.a.x, p.y - s.a.y);
  return Math.abs((p.x - s.a.x) * dy - (p.y - s.a.y) * dx) / l;
}
function segLen(a: Vec2, b: Vec2): number { return Math.hypot(b.x - a.x, b.y - a.y); }
function projParam(p: Vec2, u: Vec2): number { return p.x * u.x + p.y * u.y; }
function overlapFrac1d(a0: number, a1: number, b0: number, b1: number): number {
  const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
  const ov = Math.max(0, hi - lo);
  const short = Math.min(Math.abs(a1 - a0), Math.abs(b1 - b0)) || 1;
  return ov / short;
}

interface Pt { x: number; y: number; }
function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x, yi = poly[i]!.y, xj = poly[j]!.x, yj = poly[j]!.y;
    const intersect = (yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Building ROI — dominant filled path bounds (dynamic, not page-like)
// ---------------------------------------------------------------------------

export function derivePureBuildingRoi(vectors: MuVector[], pageBounds: Bounds, cfg: PureWallConfig = PURE_DEFAULTS): { roiMupdf: Bounds; roiSource: Bounds } {
  const pageArea = rectArea(pageBounds);
  const candidates = vectors.filter(
    (v) => v.operation === 'fill-path' && rectArea(v.bounds) > 0 && rectArea(v.bounds) < pageArea * cfg.pageFillMaxRatio,
  );
  // Drawings whose walls are plain double lines have no fill at all. That is not an
  // error: the legacy fill-based stages find nothing and the general detector takes over.
  if (!candidates.length) return { roiMupdf: pageBounds, roiSource: pageBounds };
  const dominant = [...candidates].sort((a, b) => rectArea(b.bounds) - rectArea(a.bounds))[0]!;
  return { roiMupdf: dominant.bounds, roiSource: dominant.bounds };
}

// ---------------------------------------------------------------------------
// Evidence generators
// ---------------------------------------------------------------------------

let _cid = 0;
function nextId(prefix: string): string { return `${prefix}${_cid++}`; }
function resetIds() { _cid = 0; }

/** Precompute fill-subpaths grouped by owning root (avoids O(roots×vectors) scans). */
function buildSubpathIndex(vectors: MuVector[]): Map<string, MuVector[]> {
  const idx = new Map<string, MuVector[]>();
  for (const v of vectors) {
    if (v.sourceRootId && v.operation === 'fill-path') {
      if (!idx.has(v.sourceRootId)) idx.set(v.sourceRootId, []);
      idx.get(v.sourceRootId)!.push(v);
    }
  }
  return idx;
}

/** A. Filled rectangular wall strips (preserves the strong existing detector). */
export function genFilledRects(vectors: MuVector[], roi: Bounds, cfg: PureWallConfig): PureCandidate[] {
  const roots = vectors.filter((v) => !v.sourceRootId && v.operation === 'fill-path');
  const subIdx = buildSubpathIndex(vectors);
  const out: PureCandidate[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    const subs = subIdx.get(root.id) ?? [];
    const targets = subs.length ? subs : [root];
    for (const t of targets) {
      if (!intersects(t.bounds, roi) || !isAxisRect(t)) continue;
      const w = rectWidth(t.bounds), h = rectHeight(t.bounds), short = Math.min(w, h), long = Math.max(w, h);
      if (short < cfg.minThickness || short > cfg.maxThickness || long < cfg.minLength || long / short < cfg.minAspect) continue;
      const key = t.bounds.map((x) => x.toFixed(1)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const md = medial(t.bounds);
      out.push(withOrientation({
        id: nextId('fr'),
        evidenceType: 'filled-rect',
        sourceRootIds: [root.id],
        sourceSubpathIds: subs.length ? subs.map((s) => s.id) : [],
        sourceStrokeIds: [],
        centerline: { a: { ...md.a }, b: { ...md.b } },
        thickness: short,
        length: long,
        confidence: 0.82,
        evidence: ['closed-filled-wall-mass', short >= 8 ? 'structural-thickness-band' : 'partition-thickness'],
      }));
    }
  }
  return out;
}

/**
 * B. General filled wall polygons (L/T/stepped/compound). Decompose an
 * orthogonal filled subpath into maximal axis-aligned strip cells via run-length
 * rasterization, then emit a centerline per maximal strip. Each resulting wall
 * retains the source polygon + decomposition record.
 */
export function genFilledPolygons(vectors: MuVector[], roi: Bounds, cfg: PureWallConfig): PureCandidate[] {
  const roots = vectors.filter((v) => !v.sourceRootId && v.operation === 'fill-path');
  const subIdx = buildSubpathIndex(vectors);
  const out: PureCandidate[] = [];
  for (const root of roots) {
    const subs = subIdx.get(root.id) ?? [];
    const targets = subs.length ? subs : [root];
    for (const t of targets) {
      if (!intersects(t.bounds, roi)) continue;
      if (isAxisRect(t)) continue; // handled by genFilledRects
      // rings: multi-subpath fills (e.g. ring with hole) rasterize even-odd
      const rings = (t.subpaths && t.subpaths.length > 1)
        ? t.subpaths.map((r) => dedupePoints(r))
        : [dedupePoints(t.points)];
      if (rings.some((r) => r.length < 4)) continue;
      // only orthogonal polygons (every edge of every ring axis-aligned)
      const ortho = rings.every((ring) => ring.every((p, i) => {
        const q = ring[(i + 1) % ring.length]!;
        return Math.abs(p.x - q.x) < 1.5 || Math.abs(p.y - q.y) < 1.5;
      }));
      if (!ortho) continue;
      const strips = decomposeOrthogonalPolygon(rings, t.bounds, cfg);
      for (const st of strips) {
        const w = rectWidth(st.bbox), h = rectHeight(st.bbox), short = Math.min(w, h), long = Math.max(w, h);
        if (short < cfg.minThickness || short > cfg.maxThickness || long < cfg.minLength || long / short < cfg.minAspect) continue;
        const md = medial(st.bbox);
        out.push(withOrientation({
          id: nextId('fp'),
          evidenceType: 'filled-polygon',
          sourceRootIds: [root.id],
          sourceSubpathIds: [t.id],
          sourceStrokeIds: [],
          centerline: { a: { ...md.a }, b: { ...md.b } },
          thickness: short,
          length: long,
          confidence: 0.74,
          evidence: ['closed-filled-wall-mass', 'general-polygon-decomposition', short >= 8 ? 'structural-thickness-band' : 'partition-thickness'],
        }));
      }
    }
  }
  return out;
}

/**
 * Rasterize an orthogonal polygon (outer ring + optional hole rings, even-odd)
 * and decompose it into maximal axis-aligned rectangles by merging identical
 * consecutive row-runs. The rectangles PARTITION the filled region, so no
 * duplicate medial axes are emitted at L/T intersections, and holes (door
 * openings, room interiors) remain open.
 */
function decomposeOrthogonalPolygon(rings: Vec2[][], bbox: Bounds, cfg: PureWallConfig): { bbox: Bounds; kind: 'h' | 'v' }[] {
  const x0 = Math.floor(bbox[0]), y0 = Math.floor(bbox[1]), x1 = Math.ceil(bbox[2]), y1 = Math.ceil(bbox[3]);
  const W = Math.max(1, x1 - x0), H = Math.max(1, y1 - y0);
  const inside = (px: number, py: number): boolean => {
    // even-odd across all rings
    let odd = false;
    for (const ring of rings) {
      if (pointInPolygon({ x: px, y: py }, ring)) odd = !odd;
    }
    return odd;
  };
  // per-row runs
  type Run = { a: number; b: number }; // [a,b) in grid x
  const rows: Run[][] = [];
  for (let gy = 0; gy < H; gy++) {
    const runs: Run[] = [];
    let start = -1;
    for (let gx = 0; gx <= W; gx++) {
      const on = gx < W && inside(x0 + gx + 0.5, y0 + gy + 0.5);
      if (on && start < 0) start = gx;
      if (!on && start >= 0) { runs.push({ a: start, b: gx }); start = -1; }
    }
    rows.push(runs);
  }
  // merge identical runs across consecutive rows into rectangles
  const out: { bbox: Bounds; kind: 'h' | 'v' }[] = [];
  type Open = { a: number; b: number; y: number };
  let open: Open[] = [];
  const close = (o: Open, yEnd: number) => {
    const rw = o.b - o.a, rh = yEnd - o.y;
    if (rw <= 0 || rh <= 0) return;
    out.push({ bbox: [x0 + o.a, y0 + o.y, x0 + o.b, y0 + yEnd], kind: rw >= rh ? 'h' : 'v' });
  };
  for (let gy = 0; gy <= H; gy++) {
    const runs = gy < H ? rows[gy]! : [];
    const next: Open[] = [];
    for (const r of runs) {
      const cont = open.find((o) => o.a === r.a && o.b === r.b);
      if (cont) { next.push(cont); open = open.filter((o) => o !== cont); }
      else next.push({ a: r.a, b: r.b, y: gy });
    }
    for (const o of open) close(o, gy);
    open = next;
  }
  return out;
}

/**
 * C. Parallel stroked faces. Pair stroke subpaths that are parallel, separated
 * by a perpendicular distance within a wall-thickness band, with sufficient
 * projected overlap. Emit one medial centerline (never both faces).
 *
 * Strokes are pre-filtered to long thin wall-face candidates (the page has
 * ~127k vector ops incl. dimensions/text; only wall-like faces pair). A spatial
 * grid bounds the O(n²) pairing to local neighbourhoods.
 */
export function genParallelFaces(vectors: MuVector[], roi: Bounds, cfg: PureWallConfig, bands: ThicknessBand[]): PureCandidate[] {
  const strokesAll = vectors.filter((v) => v.operation === 'stroke-path' && intersects(v.bounds, roi));
  // wall-like faces: thin pen line, long, short dim within a plausible wall thickness
  const strokes = strokesAll.filter((s) => {
    const w = rectWidth(s.bounds), h = rectHeight(s.bounds);
    const len = Math.max(w, h), short = Math.min(w, h);
    const sw = s.strokeWidth ?? 0.5;
    return len >= cfg.minLength && short <= cfg.maxThickness * 1.6 && sw <= cfg.maxThickness;
  });
  const out: PureCandidate[] = [];
  const used = new Set<string>();
  // spatial grid keyed by cell of centerline midpoint
  const cell = cfg.maxThickness * 6;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  strokes.forEach((s, i) => {
    const c = strokeCenterline(s);
    const k = key((c.a.x + c.b.x) / 2, (c.a.y + c.b.y) / 2);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(i);
  });
  const neigh = (s: MuVector): number[] => {
    const c = strokeCenterline(s);
    const cx = (c.a.x + c.b.x) / 2, cy = (c.a.y + c.b.y) / 2;
    const out2: number[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const g = grid.get(`${Math.floor(cx / cell) + dx},${Math.floor(cy / cell) + dy}`);
      if (g) out2.push(...g);
    }
    return out2;
  };
  for (let a = 0; a < strokes.length; a++) {
    const sa = strokes[a]!;
    if (used.has(sa.id)) continue;
    const ca = strokeCenterline(sa);
    for (const b of neigh(sa)) {
      if (b <= a || used.has(strokes[b]!.id)) continue;
      const sb = strokes[b]!;
      const cb = strokeCenterline(sb);
      if (segmentAngleClass(ca) === 'diagonal' && segmentAngleClass(cb) === 'diagonal') continue;
      if (segmentAngleDiffRad(ca, cb) > cfg.axisToleranceRadians) continue;
      const sep = perpSeparation(ca, cb);
      const inBand = sep >= cfg.minThickness * 0.8 && sep <= cfg.maxThickness * 1.2 &&
        bands.some((bd) => sep >= bd.min * 0.7 && sep <= bd.max * 1.3);
      if (!inBand) continue;
      const ov = projectedOverlap(ca, cb);
      if (ov < cfg.faceOverlapMin) continue;
      // require both strokes to be wall-like length (reject tiny door-jamb pairs)
      const lenA = segLen(ca.a, ca.b), lenB = segLen(cb.a, cb.b);
      if (lenA < cfg.minLength * 1.5 || lenB < cfg.minLength * 1.5) continue;
      const mid: { a: Vec2; b: Vec2 } = {
        a: { x: (ca.a.x + cb.a.x) / 2, y: (ca.a.y + cb.a.y) / 2 },
        b: { x: (ca.b.x + cb.b.x) / 2, y: (ca.b.y + cb.b.y) / 2 },
      };
      out.push(withOrientation({
        id: nextId('pf'),
        evidenceType: 'parallel-face',
        sourceRootIds: [sa.id, sb.id],
        sourceSubpathIds: [],
        sourceStrokeIds: [sa.id, sb.id],
        centerline: mid,
        thickness: sep,
        length: segLen(mid.a, mid.b),
        confidence: 0.7,
        evidence: ['parallel-face-pairing', 'structural-thickness-band'],
      }));
      used.add(sa.id); used.add(sb.id);
    }
  }
  return out;
}

function strokeCenterline(s: MuVector): { a: Vec2; b: Vec2 } {
  // use the axis-aligned bbox centerline (stroke is a thin line)
  const b = s.bounds;
  const w = rectWidth(b), h = rectHeight(b);
  return w >= h
    ? { a: { x: b[0], y: (b[1] + b[3]) / 2 }, b: { x: b[2], y: (b[1] + b[3]) / 2 } }
    : { a: { x: (b[0] + b[2]) / 2, y: b[1] }, b: { x: (b[0] + b[2]) / 2, y: b[3] } };
}
function perpSeparation(a: { a: Vec2; b: Vec2 }, b: { a: Vec2; b: Vec2 }): number {
  // perpendicular distance between the two parallel centerlines
  const d1 = perpDistance(a.a, b) + perpDistance(a.b, b);
  const d2 = perpDistance(b.a, a) + perpDistance(b.b, a);
  return Math.min(d1, d2) / 2;
}
function projectedOverlap(a: { a: Vec2; b: Vec2 }, b: { a: Vec2; b: Vec2 }): number {
  const ua = norm(a.b.x - a.a.x, a.b.y - a.a.y);
  const ub = norm(b.b.x - b.a.x, b.b.y - b.a.y);
  const pa0 = projParam(a.a, ua), pa1 = projParam(a.b, ua);
  const pb0 = projParam(b.a, ub), pb1 = projParam(b.b, ub);
  const lo = Math.max(Math.min(pa0, pa1), Math.min(pb0, pb1));
  const hi = Math.min(Math.max(pa0, pa1), Math.max(pb0, pb1));
  const ov = Math.max(0, hi - lo);
  const short = Math.min(Math.abs(pa1 - pa0), Math.abs(pb1 - pb0)) || 1;
  return ov / short;
}
function norm(x: number, y: number): Vec2 { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; }

/**
 * D. Structural single-line partitions. A single stroke that is long and
 * structurally supported (near an accepted wall, repeated spacing, T-junction,
 * separates regions). Defaults to REVIEW — never auto-accepted on length alone.
 */
export function genSingleLines(vectors: MuVector[], roi: Bounds, cfg: PureWallConfig, skeleton: PureCandidate[]): PureCandidate[] {
  const strokesAll = vectors.filter((v) => v.operation === 'stroke-path' && intersects(v.bounds, roi));
  const strokes = strokesAll.filter((s) => {
    const w = rectWidth(s.bounds), h = rectHeight(s.bounds);
    const len = Math.max(w, h), short = Math.min(w, h);
    const sw = s.strokeWidth ?? 0.5;
    return len >= cfg.minLength * 1.5 && short <= cfg.maxThickness * 1.6 && sw <= cfg.maxThickness;
  });
  const out: PureCandidate[] = [];
  for (const s of strokes) {
    const c = strokeCenterline(s);
    const len = segLen(c.a, c.b);
    if (len < cfg.minLength * 1.5) continue;
    const explained = skeleton.some((k) => k.evidenceType === 'parallel-face' && k.sourceStrokeIds.includes(s.id));
    if (explained) continue;
    let support = 0;
    for (const k of skeleton) {
      const dEnd = Math.min(pointSegmentDistance(k.centerline.a, c), pointSegmentDistance(k.centerline.b, c));
      const dMid = pointSegmentDistance({ x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 }, k.centerline);
      if (dEnd <= cfg.connectTolerance * 1.5 || dMid <= cfg.connectTolerance * 1.5) { support++; break; }
    }
    out.push(withOrientation({
      id: nextId('sl'),
      evidenceType: 'single-line',
      sourceRootIds: [s.id],
      sourceSubpathIds: [],
      sourceStrokeIds: [s.id],
      centerline: c,
      thickness: s.strokeWidth ? s.strokeWidth * 2 : 3.5,
      length: len,
      confidence: support > 0 ? 0.55 : 0.4,
      evidence: support > 0 ? ['structural-single-line', 'attached-to-confirmed-wall'] : ['structural-single-line'],
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Thickness bands — dynamically inferred (spec §4)
// ---------------------------------------------------------------------------

export function inferThicknessBands(samples: number[], cfg: PureWallConfig): ThicknessBand[] {
  const valid = samples.filter((s) => s >= cfg.minThickness * 0.7 && s <= cfg.maxThickness * 1.4);
  if (!valid.length) return [];
  // cluster by rounding to 1.0pt
  const buckets = new Map<number, number[]>();
  for (const s of valid) {
    const k = Math.round(s);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(s);
  }
  const bands: ThicknessBand[] = [];
  for (const [k, arr] of buckets) {
    if (arr.length < 2) continue; // need recurrence
    const sorted = [...arr].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / arr.length;
    bands.push({
      center: +mean.toFixed(2),
      min: +sorted[0]!.toFixed(2),
      max: +sorted[sorted.length - 1]!.toFixed(2),
      frequency: arr.length,
      totalSupportedLength: 0,
      confidence: Math.min(1, 0.5 + arr.length * 0.05),
    });
  }
  bands.sort((a, b) => b.frequency - a.frequency);
  return bands;
}

// ---------------------------------------------------------------------------
// Candidate fusion across evidence generators (spec §8)
// ---------------------------------------------------------------------------

export function fusePureCandidates(cands: PureCandidate[], cfg: PureWallConfig): { fused: PureCandidate[]; ledger: { physicalWallId: string; fusedCandidateIds: string[]; reason: string }[] } {
  const n = cands.length;
  const out = cands.map((x) => clone(x));
  const ledger: { physicalWallId: string; fusedCandidateIds: string[]; reason: string }[] = [];
  if (n === 0) return { fused: out, ledger };
  // union-find
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { const p = parent[x]!; parent[x] = parent[p]!; x = parent[x]!; } return x; };
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  // spatial grid to find nearby candidate pairs
  const cell = cfg.maxThickness * 8;
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const grid = new Map<string, number[]>();
  out.forEach((c, i) => {
    const mx = (c.centerline.a.x + c.centerline.b.x) / 2, my = (c.centerline.a.y + c.centerline.b.y) / 2;
    const k = key(mx, my);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(i);
  });
  for (let i = 0; i < n; i++) {
    const a = out[i]!;
    const mx = (a.centerline.a.x + a.centerline.b.x) / 2, my = (a.centerline.a.y + a.centerline.b.y) / 2;
    const neigh: number[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const g = grid.get(`${Math.floor(mx / cell) + dx},${Math.floor(my / cell) + dy}`);
      if (g) neigh.push(...g);
    }
    for (const j of neigh) {
      if (j <= i) continue;
      const b = out[j]!;
      const ang = segmentAngleRad(a.centerline) % Math.PI;
      const angB = segmentAngleRad(b.centerline) % Math.PI;
      if (Math.abs(ang - angB) > cfg.axisToleranceRadians) continue;
      const perp = (perpDistance(a.centerline.a, b.centerline) + perpDistance(a.centerline.b, b.centerline)) / 2;
      if (perp > cfg.mergeGap * 3) continue;
      const ov = projectedOverlap(a.centerline, b.centerline);
      if (ov < 0.5) continue;
      if (Math.abs(a.thickness - b.thickness) > Math.max(a.thickness, b.thickness) * 0.5) continue;
      const shared = a.sourceRootIds.some((r) => b.sourceRootIds.includes(r)) ||
        a.sourceSubpathIds.some((s) => b.sourceSubpathIds.includes(s)) ||
        a.sourceStrokeIds.some((s) => b.sourceStrokeIds.includes(s));
      union(i, j);
      ledger.push({ physicalWallId: `g${find(i)}`, fusedCandidateIds: [a.id, b.id], reason: `angular+perp+overlap${shared ? '+shared-source' : ''}` });
    }
  }
  // collapse groups
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  }
  const fused: PureCandidate[] = [];
  for (const [, idxs] of groups) {
    if (idxs.length === 1) { fused.push(out[idxs[0]!]!); continue; }
    // representative = highest confidence (tie: longest)
    const members = idxs.map((k) => out[k]!);
    const base = members.slice().sort((p, q) => q.confidence - p.confidence || q.length - p.length)[0]!;
    const merged: PureCandidate = withOrientation({
      ...base,
      id: `m:${members.map((m) => m.id).join('+')}`,
      evidenceType: base.evidenceType,
      sourceRootIds: [...new Set(members.flatMap((m) => m.sourceRootIds))],
      sourceSubpathIds: [...new Set(members.flatMap((m) => m.sourceSubpathIds))],
      sourceStrokeIds: [...new Set(members.flatMap((m) => m.sourceStrokeIds))],
      thickness: +(members.reduce((s, m) => s + m.thickness, 0) / members.length).toFixed(2),
      length: Math.max(...members.map((m) => m.length)),
      confidence: Math.min(1, base.confidence + 0.1 * (members.length - 1)),
      evidence: [...new Set(members.flatMap((m) => m.evidence))],
    });
    fused.push(merged);
  }
  return { fused, ledger };
}

// ---------------------------------------------------------------------------
// Collinear run merge (spec §3E variant): combine end-to-end collinear filled
// rects that form one physical wall (zero-overlap, same orientation, shared
// thickness band, gap within join tolerance). Never merges across an opening.
// ---------------------------------------------------------------------------

export function mergeCollinearRuns(cands: PureCandidate[], cfg: PureWallConfig): { merged: PureCandidate[]; runs: { combinedId: string; memberIds: string[]; openingIntervals: { from: number; to: number }[] }[] } {
  const out = cands.map((x) => clone(x));
  const runs: { combinedId: string; memberIds: string[]; openingIntervals: { from: number; to: number }[] }[] = [];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < out.length + 5) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[i]!;
      for (let j = i + 1; j < out.length; j++) {
        const b = out[j]!;
        if (segmentAngleDiffRad(a.centerline, b.centerline) > cfg.axisToleranceRadians) continue;
        if (Math.abs(a.thickness - b.thickness) > Math.max(a.thickness, b.thickness) * 0.25) continue;
        const u = norm(a.centerline.b.x - a.centerline.a.x, a.centerline.b.y - a.centerline.a.y);
        const pa0 = projParam(a.centerline.a, u), pa1 = projParam(a.centerline.b, u);
        const pb0 = projParam(b.centerline.a, u), pb1 = projParam(b.centerline.b, u);
        const a0 = Math.min(pa0, pa1), a1 = Math.max(pa0, pa1);
        const b0 = Math.min(pb0, pb1), b1 = Math.max(pb0, pb1);
        const perp = (perpDistance(a.centerline.a, b.centerline) + perpDistance(a.centerline.b, b.centerline)) / 2;
        if (perp > cfg.connectTolerance) continue;
        // end-to-end: one interval adjacent to the other, gap within join tolerance
        const gap = Math.max(a0, b0) - Math.min(a1, b1);
        const overlap = Math.min(a1, b1) - Math.max(a0, b0);
        if (gap > cfg.mergeGap && overlap <= 0) continue;
        if (overlap > 0) continue; // overlap handled by fusePureCandidates
        // combined centerline spans the union
        const p1 = pa0 <= pb0 ? a.centerline.a : b.centerline.a;
        const p2 = pa1 >= pb1 ? a.centerline.b : b.centerline.b;
        const combined: PureCandidate = withOrientation({
          ...a,
          id: `cm:${a.id}+${b.id}`,
          evidenceType: a.evidenceType,
          sourceRootIds: [...new Set([...a.sourceRootIds, ...b.sourceRootIds])],
          sourceSubpathIds: [...new Set([...a.sourceSubpathIds, ...b.sourceSubpathIds])],
          sourceStrokeIds: [...new Set([...a.sourceStrokeIds, ...b.sourceStrokeIds])],
          centerline: { a: { ...p1 }, b: { ...p2 } },
          length: Math.hypot(p2.x - p1.x, p2.y - p1.y),
          thickness: (a.thickness + b.thickness) / 2,
          evidence: [...new Set([...a.evidence, ...b.evidence, 'collinear-run-merge'])],
        });
        out[i] = combined;
        out.splice(j, 1);
        runs.push({ combinedId: combined.id, memberIds: [a.id, b.id], openingIntervals: [] });
        changed = true;
        break;
      }
    }
  }
  return { merged: out, runs };
}

// ---------------------------------------------------------------------------
// Door-gap runs (spec §3E): link collinear fragments separated by a plausible opening
// ---------------------------------------------------------------------------

export function linkDoorGapRuns(cands: PureCandidate[], cfg: PureWallConfig): { runs: LogicalWallRun[]; fragmentIds: Set<string> } {
  const fragIds = new Set<string>();
  const runs: LogicalWallRun[] = [];
  // group by TRUE orientation class (axis-aligned AND diagonal), not the legacy
  // binary c.orientation field
  const horiz = cands.filter((c) => c.orientationClass === 'horizontal');
  const vert = cands.filter((c) => c.orientationClass === 'vertical');
  const diag = cands.filter((c) => c.orientationClass === 'diagonal');
  const process = (group: PureCandidate[]) => {
    for (let i = 0; i < group.length; i++) {
      const a = group[i]!;
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        const b = group[j]!;
        if (a.thickness < cfg.minThickness || b.thickness < cfg.minThickness) continue;
        if (Math.abs(a.thickness - b.thickness) > Math.max(a.thickness, b.thickness) * 0.4) continue;
        // collinear, same orientation, adjacent in projection, separated by a gap
        const ua = norm(a.centerline.b.x - a.centerline.a.x, a.centerline.b.y - a.centerline.a.y);
        const pa0 = projParam(a.centerline.a, ua), pa1 = projParam(a.centerline.b, ua);
        const pb0 = projParam(b.centerline.a, ua), pb1 = projParam(b.centerline.b, ua);
        const a0 = Math.min(pa0, pa1), a1 = Math.max(pa0, pa1);
        const b0 = Math.min(pb0, pb1), b1 = Math.max(pb0, pb1);
        if (a1 > b0) continue; // overlapping, not separated
        const gap = b0 - a1;
        if (gap < cfg.doorGapMin || gap > cfg.doorGapMax) continue;
        // NOTE: separated fragments must NOT require projected interval overlap
        // (a door leaves the two leaves on the SAME axis, collinear but disjoint).
        // Collinearity = perpendicular distance to the INFINITE line through b's
        // axis (pointSegmentDistance clamps to the finite segment and would
        // re-introduce the overlap requirement for disjoint fragments).
        const perp = (pointLineDistance(a.centerline.a, b.centerline) + pointLineDistance(a.centerline.b, b.centerline)) / 2;
        if (perp > cfg.mergeGap) continue;
        runs.push({
          logicalWallRunId: `run:${a.id}-${b.id}`,
          physicalFragmentIds: [a.id, b.id],
          openingIntervals: [{ from: +a1.toFixed(2), to: +b0.toFixed(2) }],
          sourcePrimitiveIds: [...new Set([...a.sourceSubpathIds, ...a.sourceStrokeIds, ...b.sourceSubpathIds, ...b.sourceStrokeIds])],
        });
        fragIds.add(a.id); fragIds.add(b.id);
      }
    }
  };
  process(horiz); process(vert); process(diag);
  return { runs, fragmentIds: fragIds };
}

// ---------------------------------------------------------------------------
// Physical junction graph (spec §6) + canonicalization (§7)
// ---------------------------------------------------------------------------

export function buildJunctionGraph(cands: PureCandidate[], cfg: PureWallConfig, pageBounds: Bounds): { junctions: Junction[]; canonical: PureCandidate[] } {
  // dynamic tolerance from page scale + dominant thickness + coordinate precision
  const domThick = cands.reduce((m, c) => Math.max(m, c.thickness), cfg.connectTolerance);
  const tol = Math.max(cfg.connectTolerance, domThick * 0.6);
  const prec = 0.01;
  const junctions: Junction[] = [];
  const canonical = cands.map((c) => clone(c));
  // spatial grid
  const cell = tol * 4;
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const grid = new Map<string, number[]>();
  canonical.forEach((c, i) => {
    for (const p of [c.centerline.a, c.centerline.b]) {
      const k = key(p.x, p.y);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(i);
    }
  });
  const near = (p: Vec2): number[] => {
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const g = grid.get(`${Math.floor(p.x / cell) + dx},${Math.floor(p.y / cell) + dy}`);
      if (g) out.push(...g);
    }
    return out;
  };
  const seenPair = new Set<string>();
  for (let i = 0; i < canonical.length; i++) {
    const a = canonical[i]!;
    for (const ep of [a.centerline.a, a.centerline.b]) {
      for (const j of near(ep)) {
        if (j <= i) continue;
        if (seenPair.has(`${i},${j}`)) continue;
        const b = canonical[j]!;
        // endpoint-to-endpoint or endpoint-to-segment
        const ea = [a.centerline.a, a.centerline.b];
        const eb = [b.centerline.a, b.centerline.b];
        let kind: Junction['kind'] | null = null;
        let at: Vec2 = ep;
        let score = Infinity;
        for (const pa of ea) for (const pb of eb) {
          const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
          if (d <= tol + prec && d < score) { score = d; kind = 'endpoint'; at = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }; }
        }
        for (const pb of eb) {
          const d = pointSegmentDistance(pb, a.centerline);
          if (d <= tol + prec && d < score) { score = d; kind = 'T'; at = pb; }
        }
        for (const pa of ea) {
          const d = pointSegmentDistance(pa, b.centerline);
          if (d <= tol + prec && d < score) { score = d; kind = 'T'; at = pa; }
        }
        // collinear continuation (gap within tol, same orientation)
        const ang = segmentAngleRad(a.centerline) % Math.PI;
        const angB = segmentAngleRad(b.centerline) % Math.PI;
        if (Math.abs(ang - angB) <= cfg.axisToleranceRadians) {
          const ov = projectedOverlap(a.centerline, b.centerline);
          const gapEnd = Math.min(
            pointSegmentDistance(a.centerline.a, b.centerline) + pointSegmentDistance(a.centerline.b, b.centerline),
            pointSegmentDistance(b.centerline.a, a.centerline) + pointSegmentDistance(b.centerline.b, a.centerline),
          ) / 2;
          if (ov >= 0.5) kind = kind ?? 'collinear';
          else if (gapEnd <= tol && ov >= 0) kind = kind ?? 'collinear';
        }
        if (kind) {
          seenPair.add(`${i},${j}`);
          junctions.push({ kind, at, candidateIds: [a.id, b.id], scaleDerivedTolerance: +tol.toFixed(2) });
        }
      }
    }
  }
  return { junctions, canonical };
}

// ---------------------------------------------------------------------------
// Per-wall endpoint connectivity analysis (spec §5/§6).
// Computes, for each accepted physical wall, its endpoint terminations and
// decides whether it is genuinely floating. Tolerance is LOCAL per endpoint:
//   localTol = max(coordinatePrecision, halfLocalThickness + 2pt, connectTolerance*0.6)
// i.e. a wall may end offset from a neighbour's centerline by up to half its
// own thickness and still be a valid (T / endpoint) connection.
// ---------------------------------------------------------------------------

export type EndpointTerminationType =
  | 'endpoint' | 'T' | 'collinear' | 'opening' | 'perimeter' | 'free';

export interface EndpointConnectivity {
  endpoint: Vec2;
  nearestEndpointDistance: number;
  nearestSegmentDistance: number;
  intersectionType: EndpointTerminationType;
  connectedPhysicalWallIds: string[];
  localTolerance: number;
  dominantThickness: number;
  perimeterAttachment: boolean;
  openingContinuationId: string | null;
}

export interface WallConnectivity {
  physicalWallId: string;
  endpoints: EndpointConnectivity[];
  networkConnectivity: number;       // distinct other walls touched (sum both ends)
  validTermination: boolean;         // at least one end connects or is perimeter
  genuinelyFloating: boolean;        // no justified structural relationship
  /** Physical-wall-level floating classification (spec §4). */
  floatingClass:
    | 'two-ends-connected'
    | 'one-end-connected-one-free'
    | 'perimeter-termination'
    | 'opening-separated-termination'
    | 'valid-finite-partition'
    | 'duplicate-artifact'
    | 'genuinely-floating';
  classification:
    | 'physical-wall'
    | 'wall-fragment'
    | 'graph-segment'
    | 'endpoint-connectivity'
    | 't-junction-connectivity'
    | 'x-junction-connectivity'
    | 'collinear-continuation'
    | 'opening-separated-continuation'
    | 'perimeter-attachment'
    | 'genuinely-floating';
}

export function analyzeWallConnectivity(
  accepted: PurePhysicalWall[],
  roi: Bounds,
  cfg: PureWallConfig,
): { perWall: WallConnectivity[]; genuineFloatingIds: string[]; summary: Record<string, number> } {
  const onPerimeter = (p: Vec2): boolean => {
    const m = 6; // small band around ROI boundary counts as perimeter attachment
    return Math.min(Math.abs(p.x - roi[0]), Math.abs(p.x - roi[2]), Math.abs(p.y - roi[1]), Math.abs(p.y - roi[3])) <= m;
  };
  // The accepted set is small (~tens of walls), so a definitive O(n) per-endpoint
  // scan against every other wall is both correct and cheap — avoids any spatial
  // grid miss that would falsely flag a T-junction as floating.
  const near = (_p: Vec2): number[] => accepted.map((_, i) => i);

  const perWall: WallConnectivity[] = accepted.map((w) => {
    const localTol = Math.max(0.5, w.thickness * 0.5 + 2, cfg.connectTolerance * 0.6);
    const ends: EndpointConnectivity[] = [];
    let touched = new Set<string>();
    let valid = false;
    let types = new Set<EndpointTerminationType>();
    for (const which of ['a', 'b'] as const) {
      const e = w.centerline[which];
      const perim = onPerimeter(e);
      let bestEp = Infinity, bestSeg = Infinity, bestType: EndpointTerminationType = 'free';
      // nearest wall regardless of tolerance (for opening detection + diagnostics)
      let anyEp = Infinity, anyEpId: string | null = null, anySeg = Infinity;
      const conn: string[] = [];
      for (const nwi of near(e)) {
        if (nwi === accepted.indexOf(w)) continue;
        const o = accepted[nwi]!;
        if (o.physicalWallId === w.physicalWallId) continue;
        // pair-aware tolerance: two walls meeting at a corner have centerlines
        // offset by up to (t1/2 + t2/2); never a single global inflation.
        const pairTol = (w.thickness + o.thickness) / 2 + 2;
        const dEp = Math.hypot(e.x - o.centerline.a.x, e.y - o.centerline.a.y);
        const dEpB = Math.hypot(e.x - o.centerline.b.x, e.y - o.centerline.b.y);
        const dEpMin = Math.min(dEp, dEpB);
        const dSeg = pointSegmentDistance(e, o.centerline);
        if (dEpMin < anyEp) { anyEp = dEpMin; anyEpId = o.physicalWallId; }
        if (dSeg < anySeg) anySeg = dSeg;
        if (dEpMin <= pairTol && dEpMin < bestEp) { bestEp = dEpMin; bestType = 'endpoint'; conn.push(o.physicalWallId); touched.add(o.physicalWallId); }
        else if (dSeg <= pairTol && dSeg < bestSeg && bestType !== 'endpoint') {
          // T-junction: this endpoint lands on the other wall's interior
          // confirm the projection is interior (not beyond both ends)
          const u = norm(o.centerline.b.x - o.centerline.a.x, o.centerline.b.y - o.centerline.a.y);
          const t = projParam(e, u) - projParam(o.centerline.a, u);
          const olen = segLen(o.centerline.a, o.centerline.b);
          if (t > -pairTol && t < olen + pairTol) { bestSeg = dSeg; bestType = 'T'; conn.push(o.physicalWallId); touched.add(o.physicalWallId); }
        }
      }
      // opening-separated termination: endpoint free but another wall END lies
      // within a plausible door-opening width (never snapped — recorded only)
      let openingId: string | null = null;
      if (bestType === 'free' && !perim && anyEp <= cfg.doorGapMax && anyEpId) {
        bestType = 'opening';
        openingId = anyEpId;
        valid = true;
      }
      if (perim) { bestType = 'perimeter'; valid = true; }
      else if (bestType === 'endpoint' || bestType === 'T') valid = true;
      types.add(bestType);
      ends.push({
        endpoint: e,
        nearestEndpointDistance: Number.isFinite(bestEp) ? +bestEp.toFixed(2) : (Number.isFinite(anyEp) ? +anyEp.toFixed(2) : -1),
        nearestSegmentDistance: Number.isFinite(bestSeg) ? +bestSeg.toFixed(2) : (Number.isFinite(anySeg) ? +anySeg.toFixed(2) : -1),
        intersectionType: bestType,
        connectedPhysicalWallIds: [...new Set(conn)],
        localTolerance: +localTol.toFixed(2),
        dominantThickness: +w.thickness.toFixed(2),
        perimeterAttachment: perim,
        openingContinuationId: openingId,
      });
    }
    const endTypes = ends.map((e) => e.intersectionType);
    const connectedEnds = endTypes.filter((t) => t === 'endpoint' || t === 'T').length;
    // near wall offset (max endpoint+segment distance among ends) → bounded parallel freestanding partition
    const worstOffset = Math.max(
      ...ends.map((e) => Math.max(e.nearestEndpointDistance > 0 ? e.nearestEndpointDistance : 0, e.nearestSegmentDistance > 0 ? e.nearestSegmentDistance : 0)),
    );
    const isStrongFilled = w.evidenceType === 'filled-rect' || w.evidenceType === 'filled-polygon';
    // A free-ended wall is a valid finite partition when it is a real filled wall
    // mass (strong evidence) and its free end sits within a bounded offset of a
    // neighbour — scaled by thickness AND by its own length (a 192pt wall ending
    // 23pt short of a parallel neighbour is a normal partition, not noise).
    const boundedOffset = worstOffset <= Math.max(cfg.connectTolerance * 2, w.thickness * 3, w.length * 0.25);

    let floatingClass: WallConnectivity['floatingClass'] = 'genuinely-floating';
    if (endTypes.every((t) => t === 'endpoint' || t === 'T')) floatingClass = 'two-ends-connected';
    else if (connectedEnds === 1) floatingClass = 'one-end-connected-one-free';
    else if (endTypes.some((t) => t === 'perimeter')) floatingClass = 'perimeter-termination';
    else if (endTypes.some((t) => t === 'opening')) floatingClass = 'opening-separated-termination';
    else if (isStrongFilled && boundedOffset) floatingClass = 'valid-finite-partition';
    else floatingClass = 'genuinely-floating';

    // A wall is genuinely floating ONLY when it has NO justified structural
    // relationship (spec §4): not a perimeter wall, not a partition connected at
    // one end, not a T-junction, not an opening-separated fragment, and not a
    // finite freestanding partition with strong filled-mass evidence.
    const genuinelyFloating = floatingClass === 'genuinely-floating';
    let classification: WallConnectivity['classification'] = 'physical-wall';
    if (genuinelyFloating) classification = 'genuinely-floating';
    else if (floatingClass === 'opening-separated-termination') classification = 'opening-separated-continuation';
    else if (floatingClass === 'perimeter-termination') classification = 'perimeter-attachment';
    else if (endTypes.some((t) => t === 'T')) classification = 't-junction-connectivity';
    else if (endTypes.some((t) => t === 'endpoint')) classification = 'endpoint-connectivity';
    else if (floatingClass === 'valid-finite-partition') classification = 'physical-wall';
    else classification = 'physical-wall';
    const validTerm = floatingClass !== 'genuinely-floating';
    return {
      physicalWallId: w.physicalWallId,
      endpoints: ends,
      networkConnectivity: touched.size,
      validTermination: validTerm,
      genuinelyFloating,
      floatingClass,
      classification,
    };
  });

  const genuineFloatingIds = perWall.filter((w) => w.genuinelyFloating).map((w) => w.physicalWallId);
  const summary: Record<string, number> = {
    total: perWall.length,
    validTermination: perWall.filter((w) => w.validTermination).length,
    genuinelyFloating: genuineFloatingIds.length,
    perimeterAttachment: perWall.filter((w) => w.classification === 'perimeter-attachment').length,
    openingSeparated: perWall.filter((w) => w.classification === 'opening-separated-continuation').length,
    tJunction: perWall.filter((w) => w.classification === 't-junction-connectivity').length,
    endpoint: perWall.filter((w) => w.classification === 'endpoint-connectivity').length,
  };
  return { perWall, genuineFloatingIds, summary };
}

// ---------------------------------------------------------------------------
// Small-wall recovery pass (spec §5)
// ---------------------------------------------------------------------------

export function recoverSmallWalls(vectors: MuVector[], roi: Bounds, cfg: PureWallConfig, accepted: PureCandidate[], bands: ThicknessBand[]): PureCandidate[] {
  const subIdx = buildSubpathIndex(vectors);
  const roots = vectors.filter((v) => !v.sourceRootId && v.operation === 'fill-path');
  const out: PureCandidate[] = [];
  const isNear = (c: PureCandidate): boolean => {
    for (const k of accepted) {
      const dEp = Math.min(pointSegmentDistance(c.centerline.a, k.centerline), pointSegmentDistance(c.centerline.b, k.centerline));
      const dMid = pointSegmentDistance({ x: (c.centerline.a.x + c.centerline.b.x) / 2, y: (c.centerline.a.y + c.centerline.b.y) / 2 }, k.centerline);
      if (dEp <= cfg.recoveryEndpointTol * 2 || dMid <= cfg.recoveryEndpointTol * 2) return true;
    }
    return false;
  };
  for (const root of roots) {
    const subs = subIdx.get(root.id) ?? [];
    const targets = subs.length ? subs : [root];
    for (const t of targets) {
      if (!intersects(t.bounds, roi)) continue;
      const w = rectWidth(t.bounds), h = rectHeight(t.bounds), short = Math.min(w, h), long = Math.max(w, h);
      if (short < cfg.minThickness * 0.6 || short > cfg.maxThickness * 1.6) continue;
      if (long < cfg.minLength || long / short < 2) continue; // require at least partition length
      if (!isAxisRect(t)) continue;
      const md = medial(t.bounds);
      const cand: PureCandidate = withOrientation({
        id: nextId('rc'),
        evidenceType: 'recovered',
        sourceRootIds: [root.id], sourceSubpathIds: subs.length ? subs.map((s) => s.id) : [], sourceStrokeIds: [],
        centerline: { a: { ...md.a }, b: { ...md.b } },
        thickness: short, length: long,
        confidence: bandMatch(short, bands) ? 0.6 : 0.45,
        evidence: bandMatch(short, bands) ? ['recovered-small-partition', 'thickness-band-fill'] : ['recovered-small-partition'],
      });
      if (isNear(cand)) out.push(cand);
    }
  }
  // dedupe near-duplicate recovered walls: keep only one per small spatial cluster
  const deduped: PureCandidate[] = [];
  const cell = cfg.minLength;
  const grid = new Map<string, number[]>();
  out.forEach((c, i) => {
    const mx = (c.centerline.a.x + c.centerline.b.x) / 2, my = (c.centerline.a.y + c.centerline.b.y) / 2;
    const k = `${Math.floor(mx / cell)},${Math.floor(my / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(i);
  });
  const used = new Set<number>();
  for (const idxs of grid.values()) {
    const members = idxs.filter((i) => !used.has(i));
    if (!members.length) continue;
    // keep the longest / highest-confidence
    members.sort((a, b) => out[b]!.length - out[a]!.length || out[b]!.confidence - out[a]!.confidence);
    const keep = members[0]!;
    for (const m of members) used.add(m);
    deduped.push(out[keep]!);
  }
  return deduped;
}
function bandMatch(t: number, bands: ThicknessBand[]): boolean {
  return bands.some((b) => t >= b.min * 0.8 && t <= b.max * 1.2);
}

/** Is candidate c's endpoint (or midpoint) within join-distance of an accepted wall? */
function isRoiConnected(c: PureCandidate, accepted: PurePhysicalWall[], cfg: PureWallConfig): boolean {
  const tol = cfg.connectTolerance * 2.5;
  for (const k of accepted) {
    const dEp = Math.min(pointSegmentDistance(c.centerline.a, k.centerline), pointSegmentDistance(c.centerline.b, k.centerline));
    const dMid = pointSegmentDistance({ x: (c.centerline.a.x + c.centerline.b.x) / 2, y: (c.centerline.a.y + c.centerline.b.y) / 2 }, k.centerline);
    if (dEp <= tol || dMid <= tol) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pure-MuPDF evidence classifier (spec §9) — positive/negative evidence only
// ---------------------------------------------------------------------------

function classifyPure(cands: PureCandidate[], roi: Bounds, cfg: PureWallConfig, junctions: Junction[], degreeMap?: Map<string, number>): PurePhysicalWall[] {
  const junctionCandIds = new Set(junctions.flatMap((j) => j.candidateIds));
  const onFacade = (w: PureCandidate): boolean => {
    const r = roi;
    return [w.centerline.a, w.centerline.b].some(
      (p) => Math.min(Math.abs(p.x - r[0]), Math.abs(p.x - r[2]), Math.abs(p.y - r[1]), Math.abs(p.y - r[3])) <= 8,
    );
  };
  return cands.map((c) => {
    const deg = degreeMap?.get(c.id) ?? 0;
    const pos: string[] = [...c.evidence];
    const neg: string[] = [];
    if (c.evidenceType === 'filled-rect' || c.evidenceType === 'filled-polygon') pos.push('closed-filled-wall-mass');
    if (c.evidenceType === 'parallel-face') pos.push('parallel-face-pairing');
    if (junctionCandIds.has(c.id)) pos.push('valid-junction-role');
    if (onFacade(c)) pos.push('building-perimeter-contribution');
    if (c.length >= cfg.minLength * 3) pos.push('substantial-physical-length');
    if (c.evidence.length >= 2) pos.push('multi-generator-support');
    // negative evidence
    const r = roi;
    const outside = [c.centerline.a, c.centerline.b].every(
      (p) => p.x < r[0] || p.x > r[2] || p.y < r[1] || p.y > r[3],
    );
    if (outside) neg.push('outside-building-ROI');
    if (c.length < cfg.minLength) neg.push('implausibly-short');
    if (c.thickness > cfg.maxThickness) neg.push('implausible-thickness');
    if (c.evidenceType === 'single-line' && c.confidence < 0.5) neg.push('unsupported-short-stroke');
    if (outside) neg.push('isolated-outside');
    const posScore = pos.length;
    const negScore = neg.length;
    let verdict: PureVerdict;
    if (outside) verdict = 'rejected';
    else if (negScore > 0 && posScore <= 1) verdict = 'rejected';
    else if (posScore >= 2 || (posScore >= 1 && c.confidence >= 0.66)) verdict = 'accepted';
    else verdict = 'review';
    // Stroke-evidence walls require a junction (connectivity) or perimeter to be
    // auto-accepted; otherwise they REVIEW (defensive gate against annotation noise).
    if (c.evidenceType === 'single-line' && deg === 0 && !onFacade(c)) verdict = 'review';
    if (c.evidenceType === 'parallel-face' && (deg === 0 || c.length < cfg.minLength * 2) && !onFacade(c)) verdict = 'review';
    const net = Math.min(1, 0.4 + 0.12 * posScore - 0.15 * negScore + (onFacade(c) ? 0.05 : 0) + 0.05 * Math.min(deg, 4));
    return {
      ...c,
      physicalWallId: c.id,
      verdict,
      networkConnectivity: deg,
      perimeterContribution: onFacade(c),
      genuinelyFloating: false,
      fusedCandidateIds: [c.id],
      evidenceTypes: [c.evidenceType],
      positiveEvidence: pos,
      negativeEvidence: neg,
      confidence: +net.toFixed(3),
    } satisfies PurePhysicalWall;
  });
}

// ---------------------------------------------------------------------------
// Orientation / coverage audit (spec §11)
// ---------------------------------------------------------------------------

function orientationAudit(walls: PurePhysicalWall[], junctions: Junction[], cfg: PureWallConfig): OrientationAudit {
  const acc = walls.filter((w) => w.verdict === 'accepted');
  let h = 0, v = 0, o = 0, hL = 0, vL = 0, short = 0, med = 0, long = 0, junc = 0, per = 0, floating = 0;
  const juncIds = new Set(junctions.filter((j) => j.kind === 'T' || j.kind === 'X').flatMap((j) => j.candidateIds));
  for (const w of acc) {
    if (w.orientation === 0) { h++; hL += w.length; }
    else if (w.orientation === Math.PI / 2) { v++; vL += w.length; }
    else o++;
    if (w.length < cfg.minLength * 2) short++;
    else if (w.length < cfg.minLength * 6) med++;
    else long++;
    if (juncIds.has(w.id)) junc++;
    if (w.perimeterContribution) per++;
    if (w.networkConnectivity === 0 && !w.perimeterContribution) floating++;
  }
  return {
    acceptedHorizontalWalls: h, acceptedVerticalWalls: v, acceptedOtherAngleWalls: o,
    acceptedHorizontalLength: +hL.toFixed(1), acceptedVerticalLength: +vL.toFixed(1),
    shortAcceptedWalls: short, mediumAcceptedWalls: med, longAcceptedWalls: long,
    acceptedJunctionPartitions: junc, acceptedPerimeterWalls: per,
    reviewWalls: walls.filter((w) => w.verdict === 'review').length,
    rejectedWalls: walls.filter((w) => w.verdict === 'rejected').length,
    floatingAcceptedWalls: floating,
  };
}

/**
 * Orchestrator. Runs the full PURE MuPDF pipeline (spec §2). `legacyForRecall`
 * is an OPTIONAL, read-only input used only for the recall-audit (§10); it never
 * influences MuPDF acceptance/rejection.
 */

/**
 * Derive real-world scale (mm per PDF point) WITHOUT pdf2json, so the pure
 * pipeline stays fully self-contained. Mirrors the AI pipeline's
 * `deriveScaleDimText`: find the largest 3–5 digit dimension number in the
 * drawing's text, then mm/pt = thatNumber / drawingWidthInPoints.
 * The drawing width is the accepted-wall ROI width (the building's full span in
 * mupdf points) — this makes the final building width = maxDim/1000 metres,
 * identical to what the AI pipeline reports (e.g. CODE_06 → 25600 → 25.6 m).
 */
function derivePureScaleMmPerPt(
  page: mupdf.Page,
  roi: Bounds,
): { mmPerPt: number; source: 'dim-text' | 'fallback' } {
  let maxDim = 0;
  try {
    const st = page.toStructuredText();
    const json = JSON.parse((st as unknown as { asJSON: () => string }).asJSON());
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      const o = n as Record<string, unknown>;
      if (typeof o.text === 'string') {
        const m = /^(\d{3,5})$/.exec(o.text.trim());
        if (m) maxDim = Math.max(maxDim, parseInt(m[1]!, 10));
      }
      for (const k of Object.keys(o)) walk(o[k]);
    };
    walk(json);
  } catch {
    // text extraction unavailable — fall back to 1 mm/pt (no scaling)
  }
  const spanPt = roi[2] - roi[0];
  if (maxDim > 0 && spanPt > 1) return { mmPerPt: maxDim / spanPt, source: 'dim-text' };
  return { mmPerPt: 1, source: 'fallback' };
}

export type PureScaleSource = 'dim-text' | 'fallback' | 'dimension-vote' | 'dimension-vote+title' | 'title-block';

/**
 * Final scale. The legacy rule above (largest number on the sheet / building width)
 * only holds when the sheet's largest number happens to be the overall building
 * dimension; on other drawings it is wrong by large factors. The evidence-based
 * estimate (scale-detection.ts: dimension-line vote, then title-block scale) is used
 * whenever it exists. Exception: when the legacy value already agrees within 3% it
 * is kept, so the frozen CODE_06 baselines (hashes, parity) stay bit-identical.
 */
function resolveScale(
  page: mupdf.Page,
  vectors: MuVector[],
  pageBounds: Bounds,
  legacy: { mmPerPt: number; source: 'dim-text' | 'fallback' },
): { mmPerPt: number; source: PureScaleSource } {
  try {
    const json = (page.toStructuredText('preserve-whitespace') as unknown as { asJSON: () => string }).asJSON();
    const est = estimateScale(
      textsFromStructuredTextJson(json),
      collectSegments(vectors),
      pageBounds[2] - pageBounds[0],
      pageBounds[3] - pageBounds[1],
    );
    if (est) {
      const legacyAgrees = legacy.source === 'dim-text' && Math.abs(est.mmPerPt - legacy.mmPerPt) / legacy.mmPerPt <= 0.03;
      if (!legacyAgrees) return { mmPerPt: est.mmPerPt, source: est.source };
    }
  } catch {
    // no text layer / unexpected structure: keep the legacy value
  }
  return legacy;
}

export function extractPureWallResult(
  data: Uint8Array | Buffer,
  pageNumber?: number,
  legacyForRecall?: { insideRoi: { id: string; a: Vec2; b: Vec2 }[]; sourcePageWidth: number },
  cfg?: PureWallConfig,
  captureLineage?: false
): MuPdfPureResult;

export function extractPureWallResult(
  data: Uint8Array | Buffer,
  pageNumber: number,
  legacyForRecall: { insideRoi: { id: string; a: Vec2; b: Vec2 }[]; sourcePageWidth: number } | undefined,
  cfg: PureWallConfig | undefined,
  captureLineage: true
): MuPdfLineageAuditResult;

export function extractPureWallResult(
  data: Uint8Array | Buffer,
  pageNumber = 0,
  legacyForRecall?: { insideRoi: { id: string; a: Vec2; b: Vec2 }[]; sourcePageWidth: number },
  cfg: PureWallConfig = PURE_DEFAULTS,
  captureLineage = false
): MuPdfPureResult | MuPdfLineageAuditResult {
  const t0 = Date.now();
  const doc = mupdf.Document.openDocument(data as any, 'application/pdf');
  const page = doc.loadPage(pageNumber);
  const tPdf = Date.now() - t0;
  const pbRaw = page.getBounds() as unknown as number[];
  const pageBoundsMupdf: Bounds = [pbRaw[0] ?? 0, pbRaw[1] ?? 0, pbRaw[2] ?? 0, pbRaw[3] ?? 0];
  const tVc0 = Date.now();
  const collected = collectPageVectors(page, captureLineage, pageNumber);
  const vectors = collected.vectors;
  const tVc = Date.now() - tVc0;
  const tSub = 0; // subpath normalization is done inside collectPageVectors
  const tRoi0 = Date.now();
  const { roiMupdf } = derivePureBuildingRoi(vectors, pageBoundsMupdf, cfg);
  const tRoi = Date.now() - tRoi0;

  // ---- derive dimensional tolerances from page scale + inferred bands (§5) ----
  // First-pass band discovery (cheap) so the full config can scale to THIS drawing.
  const tBand0 = Date.now();
  const _fr0 = genFilledRects(vectors, roiMupdf, cfg);
  const _fp0 = genFilledPolygons(vectors, roiMupdf, cfg);
  const _bands0 = inferThicknessBands([..._fr0, ..._fp0].map((c) => c.thickness), cfg);
  const derived = derivePureConfig(pageBoundsMupdf, _bands0);
  cfg = derived; // downstream stages use the derived, scale-aware config
  const tBand = Date.now() - tBand0;

  resetIds();
  const tGen0 = Date.now();
  const fr = genFilledRects(vectors, roiMupdf, cfg);
  const fp = genFilledPolygons(vectors, roiMupdf, cfg);
  const thickSamples = [...fr, ...fp].map((c) => c.thickness);
  const bands = inferThicknessBands(thickSamples, cfg);
  const pfRaw = genParallelFaces(vectors, roiMupdf, cfg, bands);
  const slRaw = genSingleLines(vectors, roiMupdf, cfg, [...fr, ...fp, ...pfRaw]);
  const tGen = Date.now() - tGen0;

  // Filled masses are the STRONG primary set (closed-wall evidence). First merge
  // collinear end-to-end filled rects into one physical wall (matches the baseline
  // merged-network structure), forming the PRIMARY wall network.
  const tClsF0 = Date.now();
  const { merged: frMerged, runs: frRuns } = mergeCollinearRuns([...fr, ...fp], cfg);
  const filledSet: PureCandidate[] = frMerged;
  const filledClassified = classifyPure(filledSet, roiMupdf, cfg, []);
  const tClsF = Date.now() - tClsF0;
  const acceptedFilled = filledClassified.filter((w) => w.verdict === 'accepted');

  // Junction graph on the PRIMARY filled network (dynamic tolerance).
  const tConn0 = Date.now();
  const { junctions } = buildJunctionGraph(filledSet, cfg, pageBoundsMupdf);
  const tConn = Date.now() - tConn0;
  const degree = new Map<string, number>();
  for (const j of junctions) for (const id of j.candidateIds) degree.set(id, (degree.get(id) ?? 0) + 1);

  // Stroke candidates only SUPPLEMENT walls not already explained by a filled mass.
  const explainedBy = (c: PureCandidate): boolean =>
    acceptedFilled.some((w) => {
      if (segmentAngleDiffRad(w.centerline, c.centerline) > cfg.axisToleranceRadians) return false;
      return (
        pointSegmentDistance(c.centerline.a, w.centerline) <= cfg.connectTolerance * 2.5 ||
        pointSegmentDistance(c.centerline.b, w.centerline) <= cfg.connectTolerance * 2.5 ||
        pointSegmentDistance({ x: (c.centerline.a.x + c.centerline.b.x) / 2, y: (c.centerline.a.y + c.centerline.b.y) / 2 }, w.centerline) <= cfg.connectTolerance * 2.5
      );
    });
  const pfCand = pfRaw.filter((c) => !explainedBy(c));
  const slCand = slRaw.filter((c) => !explainedBy(c));

  // Fuse the PRIMARY filled network + uncovered parallel-face candidates.
  const tFus0 = Date.now();
  const { fused, ledger } = fusePureCandidates([...filledSet, ...pfCand], cfg);
  const tFus = Date.now() - tFus0;

  // degree propagates through fused ids
  const fusedDegree = new Map<string, number>();
  const idDegree = (c: PureCandidate): number => {
    let d = 0;
    for (const rid of c.sourceRootIds) d = Math.max(d, degree.get(rid) ?? 0);
    for (const sid of c.sourceSubpathIds) d = Math.max(d, degree.get(sid) ?? 0);
    for (const stid of c.sourceStrokeIds) d = Math.max(d, degree.get(stid) ?? 0);
    return d;
  };
  for (const f of fused) fusedDegree.set(f.id, idDegree(f));

  // door-gap runs (preserve openings — never merge)
  const door = linkDoorGapRuns(fused, cfg);

  // classify the fused walls (junction-degree gated)
  const tCls0 = Date.now();
  const classified = classifyPure(fused, roiMupdf, cfg, junctions, fusedDegree);
  const tCls = Date.now() - tCls0;

  const accepted0 = classified.filter((w) => w.verdict === 'accepted');

  // small-wall recovery: only commit recovered fills that connect to accepted walls
  const tRec0 = Date.now();
  const recovered = recoverSmallWalls(vectors, roiMupdf, cfg, accepted0, bands)
    .filter((c) => isRoiConnected(c, accepted0, cfg) && !explainedBy(c));
  const tRec = Date.now() - tRec0;

  // single-lines are appended as REVIEW-only proposals (diagnostic surface)
  const singleLineWalls: PurePhysicalWall[] = slCand.map((c) => ({
    ...c,
    physicalWallId: c.id,
    verdict: 'review' as PureVerdict,
    networkConnectivity: 0,
    perimeterContribution: false,
    genuinelyFloating: false,
    fusedCandidateIds: [c.id],
    evidenceTypes: ['single-line'] as EvidenceType[],
    positiveEvidence: c.evidence,
    negativeEvidence: ['review-only-stroke'],
    confidence: c.confidence,
  }));

  const classifiedFinal: PurePhysicalWall[] = [
    ...classified,
    ...recovered.map((c) => ({
      ...c,
      physicalWallId: c.id,
      verdict: 'accepted' as PureVerdict,
      networkConnectivity: 1,
      perimeterContribution: false,
      genuinelyFloating: false,
      fusedCandidateIds: [c.id],
      evidenceTypes: [c.evidenceType] as EvidenceType[],
      positiveEvidence: c.evidence,
      negativeEvidence: [] as string[],
      confidence: c.confidence,
    })),
    ...singleLineWalls,
  ];
  const acceptedFinal = classifiedFinal.filter((w) => w.verdict === 'accepted');
  // genuine-floating analysis on the FINAL accepted set (per-endpoint, local tol)
  const tConn2 = Date.now();
  const conn = analyzeWallConnectivity(acceptedFinal, roiMupdf, cfg);
  const tConnAna = Date.now() - tConn2;
  const connById = new Map(conn.perWall.map((c) => [c.physicalWallId, c]));
  // capture OLD (degree-derived) floating count for the attribution breakdown
  const oldFloatingCount = acceptedFinal.filter((w) => w.networkConnectivity === 0 && !w.perimeterContribution).length;
  // stamp connectivity onto accepted walls
  for (const w of acceptedFinal) {
    const c = connById.get(w.physicalWallId);
    if (c) { w.networkConnectivity = c.networkConnectivity; w.genuinelyFloating = c.genuinelyFloating; w.floatingClass = c.floatingClass; w.connectivityClass = c.classification; }
  }
  const floating = acceptedFinal.filter((w) => w.genuinelyFloating === true);
  const genuinelyFloatingIds = conn.genuineFloatingIds;

  // -------------------------------------------------------------------------
  // Primitive-ownership cascade + discriminating rejection (spec §7/§8).
  // A review candidate whose geometry is already covered by an accepted wall
  // is NOT an unresolved hypothesis — it is the same source primitive again
  // (e.g. the stroked faces of a filled wall mass). Those are rejected as
  // duplicates. Clear non-walls get explicit rejection reasons. Ambiguous
  // wall-like geometry stays in review.
  // -------------------------------------------------------------------------
  const tOwn0 = Date.now();
  const pageW = pageBoundsMupdf[2] - pageBoundsMupdf[0];
  const pageH = pageBoundsMupdf[3] - pageBoundsMupdf[1];
  const insideRoiPt = (p: Vec2) =>
    p.x >= roiMupdf[0] - 2 && p.x <= roiMupdf[2] + 2 && p.y >= roiMupdf[1] - 2 && p.y <= roiMupdf[3] + 2;
  const angleOf = (s: { a: Vec2; b: Vec2 }) => Math.abs(Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x)) % Math.PI;
  let ownedByAcceptedWalls = 0, rejectedNonWalls = 0;
  for (const w of classifiedFinal) {
    if (w.verdict !== 'review') continue;
    const mid = { x: (w.centerline.a.x + w.centerline.b.x) / 2, y: (w.centerline.a.y + w.centerline.b.y) / 2 };
    // 1) ownership by an accepted wall (same primitive re-emitted as stroke)
    let owner: PurePhysicalWall | undefined;
    for (const a of acceptedFinal) {
      const cov = a.thickness / 2 + 2;
      if (pointSegmentDistance(w.centerline.a, a.centerline) <= cov &&
          pointSegmentDistance(w.centerline.b, a.centerline) <= cov) {
        const dAng = Math.abs(angleOf(w.centerline) - angleOf(a.centerline));
        if (dAng <= 0.1 || Math.abs(dAng - Math.PI) <= 0.1) { owner = a; break; }
      }
    }
    if (owner) {
      w.verdict = 'rejected';
      w.rejectionReason = 'duplicate-of-accepted-physical-wall';
      w.ownedBy = owner.physicalWallId;
      ownedByAcceptedWalls++;
      continue;
    }
    // 2) proven non-wall rejections
    if (!insideRoiPt(mid) && !insideRoiPt(w.centerline.a) && !insideRoiPt(w.centerline.b)) {
      w.verdict = 'rejected'; w.rejectionReason = 'outside-building-roi'; rejectedNonWalls++; continue;
    }
    if (w.length >= 0.85 * Math.min(pageW, pageH)) {
      w.verdict = 'rejected'; w.rejectionReason = 'page-or-sheet-frame'; rejectedNonWalls++; continue;
    }
    if (!Number.isFinite(w.length) || !Number.isFinite(w.centerline.a.x) || w.length <= 0) {
      w.verdict = 'rejected'; w.rejectionReason = 'invalid-or-nonfinite-geometry'; rejectedNonWalls++; continue;
    }
    if (w.length < cfg.minLength * 0.5) {
      w.verdict = 'rejected'; w.rejectionReason = 'no-structural-relation-after-evidence-passes'; rejectedNonWalls++; continue;
    }
    // else: legitimately ambiguous wall-like geometry — stays review
  }
  // 3) structural-relation test for single-line review candidates: a physical
  // wall drawn as strokes has TWO parallel faces. A lone stroke with (a) no
  // parallel partner within 1.5× max wall thickness and (b) no endpoint
  // attachment to an accepted wall is proven non-wall geometry (dimension
  // chain / annotation / symbol edge). Parallel pairs (possible partitions)
  // and attached strokes remain review — NOT rejected merely for lacking
  // filled-mass support.
  {
    const reviewSL = classifiedFinal.filter((w) => w.verdict === 'review' && w.evidenceType === 'single-line');
    const isHorizontal = (s: { a: Vec2; b: Vec2 }) => Math.abs(s.b.y - s.a.y) <= Math.abs(s.b.x - s.a.x);
    const gapMax = cfg.maxThickness * 1.5;
    for (const w of reviewSL) {
      const hor = isHorizontal(w.centerline);
      const lo = hor ? Math.min(w.centerline.a.x, w.centerline.b.x) : Math.min(w.centerline.a.y, w.centerline.b.y);
      const hi = hor ? Math.max(w.centerline.a.x, w.centerline.b.x) : Math.max(w.centerline.a.y, w.centerline.b.y);
      const fix = hor ? w.centerline.a.y : w.centerline.a.x;
      let hasPartner = false;
      for (const o of reviewSL) {
        if (o === w) continue;
        if (isHorizontal(o.centerline) !== hor) continue;
        const oFix = hor ? o.centerline.a.y : o.centerline.a.x;
        const gap = Math.abs(oFix - fix);
        if (gap < 0.5 || gap > gapMax) continue;
        const oLo = hor ? Math.min(o.centerline.a.x, o.centerline.b.x) : Math.min(o.centerline.a.y, o.centerline.b.y);
        const oHi = hor ? Math.max(o.centerline.a.x, o.centerline.b.x) : Math.max(o.centerline.a.y, o.centerline.b.y);
        const ovl = Math.min(hi, oHi) - Math.max(lo, oLo);
        if (ovl >= Math.min(hi - lo, oHi - oLo) * 0.3) { hasPartner = true; break; }
      }
      if (hasPartner) continue;
      let attached = false;
      // LOCAL structural-relation tolerance (spec §11): scale per candidate from
      // the candidate's own stroke thickness + the nearest accepted wall's
      // thickness (pair-aware), never the single global tolerance. A nearby
      // PARALLEL wall alongside the stroke is NOT endpoint attachment — require
      // either a transverse (perpendicular-ish) relation or a collinear
      // end-to-end continuation.
      for (const a of acceptedFinal) {
        const pairTol = Math.max(cfg.mergeGap * 2, (w.thickness + a.thickness) / 2 + cfg.mergeGap);
        const dA = pointSegmentDistance(w.centerline.a, a.centerline);
        const dB = pointSegmentDistance(w.centerline.b, a.centerline);
        if (Math.min(dA, dB) > pairTol) continue;
        const angDiff = segmentAngleDiffRad(w.centerline, a.centerline);
        if (angDiff >= Math.PI / 6) { attached = true; break; } // transverse attachment (T/L)
        // near-parallel: only counts when it is a genuine end-to-end collinear
        // continuation (endpoint near the accepted wall's END, not its side)
        const dEndA = Math.min(
          Math.hypot(w.centerline.a.x - a.centerline.a.x, w.centerline.a.y - a.centerline.a.y),
          Math.hypot(w.centerline.a.x - a.centerline.b.x, w.centerline.a.y - a.centerline.b.y),
        );
        const dEndB = Math.min(
          Math.hypot(w.centerline.b.x - a.centerline.a.x, w.centerline.b.y - a.centerline.a.y),
          Math.hypot(w.centerline.b.x - a.centerline.b.x, w.centerline.b.y - a.centerline.b.y),
        );
        if (Math.min(dEndA, dEndB) <= pairTol) { attached = true; break; }
        // otherwise: parallel wall alongside — NOT an endpoint attachment
      }
      if (!attached) {
        w.verdict = 'rejected';
        w.rejectionReason = 'no-structural-relation-after-evidence-passes';
        rejectedNonWalls++;
      }
    }
  }
  const tOwn = Date.now() - tOwn0;
  const reviewFinal = classifiedFinal.filter((w) => w.verdict === 'review');
  const rejectedFinal = classifiedFinal.filter((w) => w.verdict === 'rejected');
  const ownership = {
    totalNormalizedPrimitives: classifiedFinal.length,
    ownedByAcceptedWalls,
    ownedByOpeningEvidence: 0,
    ownedByJunctionEvidence: 0,
    rejectedNonWalls,
    unresolvedWallLikePrimitives: reviewFinal.length,
    unclassifiedPrimitives: 0,
  };
  const rejectionByReason: Record<string, number> = {};
  for (const w of rejectedFinal) {
    const r = w.rejectionReason ?? 'unspecified';
    rejectionByReason[r] = (rejectionByReason[r] ?? 0) + 1;
  }
  const reviewByGenerator: Record<string, number> = {};
  for (const w of reviewFinal) {
    reviewByGenerator[w.evidenceType] = (reviewByGenerator[w.evidenceType] ?? 0) + 1;
  }
  // single-line promotion ledger (spec §9): single-lines are review by default;
  // none are auto-promoted in this pass (promotion requires attachment +
  // band + junction evidence — deliberately conservative, so ledger is explicit).
  const promotedSingleLines: { physicalWallId: string; promotionEvidence: string[] }[] =
    acceptedFinal.filter((w) => w.evidenceTypes.includes('single-line'))
      .map((w) => ({ physicalWallId: w.physicalWallId, promotionEvidence: w.positiveEvidence }));

  // opening-preservation ledger (spec §10): for each logical run with openings,
  // verify no accepted wall spans through any opening interval.
  const openingLedger = door.runs.map((run) => {
    const frags = acceptedFinal.filter((w) => run.physicalFragmentIds.includes(w.physicalWallId));
    const widths = run.openingIntervals.map((iv) => +(iv.to - iv.from).toFixed(2));
    // collinear error: max perpendicular deviation between fragment centerlines
    let colErr = 0;
    if (frags.length >= 2) {
      const ref = frags[0]!.centerline;
      for (const f of frags.slice(1)) {
        colErr = Math.max(colErr,
          pointSegmentDistance(f.centerline.a, ref),
          pointSegmentDistance(f.centerline.b, ref));
      }
    }
    // preserved = no accepted wall covers any opening interval midpoint
    const horizontal = frags[0] ? Math.abs(frags[0].centerline.b.y - frags[0].centerline.a.y) <= Math.abs(frags[0].centerline.b.x - frags[0].centerline.a.x) : true;
    const fixedCoord = frags[0] ? (horizontal ? frags[0].centerline.a.y : frags[0].centerline.a.x) : 0;
    let preserved = true;
    for (const iv of run.openingIntervals) {
      const midAlong = (iv.from + iv.to) / 2;
      const midPt = horizontal ? { x: midAlong, y: fixedCoord } : { x: fixedCoord, y: midAlong };
      for (const a of acceptedFinal) {
        if (run.physicalFragmentIds.includes(a.physicalWallId)) continue;
        if (pointSegmentDistance(midPt, a.centerline) <= a.thickness / 2) { preserved = false; break; }
      }
      // also: no fragment of the run itself may span the interval
      for (const f of frags) {
        const lo = horizontal ? Math.min(f.centerline.a.x, f.centerline.b.x) : Math.min(f.centerline.a.y, f.centerline.b.y);
        const hi = horizontal ? Math.max(f.centerline.a.x, f.centerline.b.x) : Math.max(f.centerline.a.y, f.centerline.b.y);
        if (lo < midAlong && hi > midAlong) { preserved = false; break; }
      }
    }
    const thick = frags.length ? frags.reduce((s, f) => s + f.thickness, 0) / frags.length : 0;
    return {
      logicalWallRunId: run.logicalWallRunId,
      physicalFragmentIds: run.physicalFragmentIds,
      openingIntervals: run.openingIntervals,
      openingWidths: widths,
      sourcePrimitiveIds: run.sourcePrimitiveIds,
      collinearError: +colErr.toFixed(2),
      wallThickness: +thick.toFixed(2),
      openingPreserved: preserved,
    };
  });

  const orientation = orientationAudit(classifiedFinal, junctions, cfg);

  // record the primary-network merge runs
  const collinearRuns = frRuns;

  // recall audit (READ-ONLY diff vs legacy). Legacy segments are in pdf2json
  // SOURCE units (÷16 from MuPDF points); pure candidates are in MuPDF points,
  // so project legacy into the MuPDF frame for proximity comparison.
  let recall: RecallDiscrepancy = { mupdfAccepted: acceptedFinal.length, legacyPhysicalInsideRoi: 0, matched: 0, legacyOnly: [], mupdfOnly: 0 };
  if (legacyForRecall && legacyForRecall.sourcePageWidth > 0) {
    // uniform page scale MuPDF->legacy-source, derived from the CALLER-SUPPLIED
    // legacy page width (no fixture constants in this module)
    const S = pageBoundsMupdf[2] / legacyForRecall.sourcePageWidth;
    const legacyMupdf = legacyForRecall.insideRoi.map((w) => ({
      id: w.id,
      a: { x: w.a.x * S, y: w.a.y * S },
      b: { x: w.b.x * S, y: w.b.y * S },
    }));
    const mupdfSegs = acceptedFinal.map((w) => w.centerline);
    const isNear = (a: Vec2, b: Vec2, c: { a: Vec2; b: Vec2 }) =>
      pointSegmentDistance(a, c) <= cfg.connectTolerance * 3 ||
      pointSegmentDistance(b, c) <= cfg.connectTolerance * 3 ||
      pointSegmentDistance({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, c) <= cfg.connectTolerance * 3;
    let matched = 0;
    const legacyOnly: { id: string; nearMupdfPrimitive?: string[] }[] = [];
    for (const lg of legacyMupdf) {
      const near = mupdfSegs.some((m) => isNear(lg.a, lg.b, m));
      if (near) matched++; else legacyOnly.push({ id: lg.id });
    }
    recall = {
      mupdfAccepted: acceptedFinal.length,
      legacyPhysicalInsideRoi: legacyMupdf.length,
      matched,
      legacyOnly,
      mupdfOnly: acceptedFinal.length - matched,
    };
  }

  const candHash = hashStrings(classifiedFinal.map((w) => `${w.id}:${w.centerline.a.x.toFixed(3)},${w.centerline.a.y.toFixed(3)},${w.centerline.b.x.toFixed(3)},${w.centerline.b.y.toFixed(3)},${w.thickness.toFixed(2)},${w.verdict}`));

  // floating-attribution breakdown (spec §6): explain the OLD 64 floating attributions
  const perWallConn = conn.perWall;
  const endpointToleranceMisses = perWallConn.filter((c) =>
    c.endpoints.some((e) => (e.intersectionType === 'free') &&
      Math.min(e.nearestEndpointDistance, e.nearestSegmentDistance) <= e.localTolerance * 2 &&
      Math.min(e.nearestEndpointDistance, e.nearestSegmentDistance) > e.localTolerance)).length;
  const validPerimeter = perWallConn.filter((c) => c.classification === 'perimeter-attachment').length;
  const validOpenings = perWallConn.filter((c) => c.classification === 'opening-separated-continuation').length;
  const validFreeEnds = perWallConn.filter((c) => !c.genuinelyFloating && c.classification === 'physical-wall').length;
  // duplicate fragment artifacts: two accepted walls sharing nearly-identical centerlines
  let duplicateFrag = 0;
  for (let i = 0; i < acceptedFinal.length; i++) {
    for (let j = i + 1; j < acceptedFinal.length; j++) {
      const a = acceptedFinal[i]!, b = acceptedFinal[j]!;
      const same = (Math.hypot(a.centerline.a.x - b.centerline.a.x, a.centerline.a.y - b.centerline.a.y) < 3 &&
        Math.hypot(a.centerline.b.x - b.centerline.b.x, a.centerline.b.y - b.centerline.b.y) < 3);
      if (same) duplicateFrag++;
    }
  }
  const validFinitePartitions = perWallConn.filter((c) => c.floatingClass === 'valid-finite-partition').length;
  const floatingAttributionBreakdown = {
    totalFloatingAttributions: oldFloatingCount,
    duplicateFragmentArtifacts: duplicateFrag,
    endpointToleranceMisses,
    validPerimeterTerminations: validPerimeter,
    validDoorOpeningTerminations: validOpenings,
    validFinitePartitions,
    validFreeEnds,
    genuinelyFloatingPhysicalWalls: genuinelyFloatingIds.length,
    unexplained: genuinelyFloatingIds.length,
  };

  const total = Date.now() - t0;
  const { mmPerPt: scaleMmPerPt, source: scaleSource } = resolveScale(
    page,
    vectors,
    pageBoundsMupdf,
    derivePureScaleMmPerPt(page, roiMupdf),
  );
  const pureResult: MuPdfPureResult = {
    pageBoundsMupdf,
    activeBuildingRegionMupdf: roiMupdf,
    activeBuildingRegionSource: roiMupdf, // downstream/overlay convenience (same mupdf-point frame)
    vectorOperationCount: vectors.length,
    diagnostics: collected.diagnostics,
    candidatesBySource: { 'filled-rect': fr, 'filled-polygon': fp, 'parallel-face': pfCand, 'single-line': slCand, 'recovered': recovered },
    allCandidates: [...fr, ...fp, ...pfCand, ...slCand, ...recovered],
    thicknessBands: bands,
    logicalWallRuns: door.runs,
    collinearRuns,
    junctions,
    recoveredSmallWalls: recovered,
    physicalWalls: classifiedFinal,
    roi: roiMupdf,
    accepted: acceptedFinal,
    scaleMmPerPt,
    scaleSource,
    review: reviewFinal,
    rejected: rejectedFinal,
    floatingAccepted: floating,
    genuinelyFloatingAcceptedPhysicalWalls: floating,
    connectivity: conn.perWall,
    connectivitySummary: conn.summary,
    floatingAttributionBreakdown,
    primitiveOwnership: ownership,
    rejectionByReason,
    reviewByGenerator,
    promotedSingleLines,
    openingLedger,
    duplicateFusionLedger: ledger,
    recall,
    orientation,
    timings: {
      pdfLoad: tPdf, vectorCollection: tVc, subpathNormalization: tSub, roiDerivation: tRoi,
      thicknessInference: tBand, candidateGeneration: tGen, filledClassification: tClsF,
      candidateFusion: tFus, connectivity: tConn, connectivityAnalysis: tConnAna, classification: tCls, overlayGeneration: 0, total,
    },
    candidateHash: candHash,
  };
  applyGeneralWallsIfNeeded(pureResult, page, vectors);

  if (captureLineage) {
    return {
      pureResult,
      lineageStore: collected.lineageStore!,
      vectorLineageRefs: collected.vectorLineageRefs!
    };
  }
  return pureResult;
}

/**
 * The legacy wall stages are tuned to drawings whose walls are filled masses (they
 * derive the building region and thickness bands from fills). They are kept untouched
 * for those drawings. When they accept almost nothing, the general detector (wall-general.ts) is
 * run and, if it finds more wall than the legacy stages did, its walls become the
 * accepted set.
 */
function applyGeneralWallsIfNeeded(r: MuPdfPureResult, page: mupdf.Page, vectors: MuVector[]): void {
  // The review pile is not a usable signal: fill-based drawings that extract correctly
  // still leave several times more candidates in review than they accept.
  const legacyHealthy = r.accepted.length >= 8;
  r.wallEngine = 'legacy';
  if (legacyHealthy) return;
  try {
    const pb = r.pageBoundsMupdf;
    const pxPerPt = Math.min(4, 6000 / Math.max(pb[2] - pb[0], pb[3] - pb[1], 1));
    const pix = (page as any).toPixmap(mupdf.Matrix.scale(pxPerPt, pxPerPt), mupdf.ColorSpace.DeviceGray, false, true);
    const W: number = pix.getWidth(), H: number = pix.getHeight(), stride: number = pix.getStride();
    const n: number = pix.getNumberOfComponents();
    const ox: number = typeof pix.getX === 'function' ? pix.getX() : 0;
    const oy: number = typeof pix.getY === 'function' ? pix.getY() : 0;
    const px: Uint8ClampedArray = pix.getPixels();
    const raster: WallRaster = {
      pxPerPt,
      width: ox + W,
      height: oy + H,
      lum: (xi, yi) => (xi < ox || yi < oy ? 1 : (px[(yi - oy) * stride + (xi - ox) * n] ?? 255) / 255),
    };
    // Door symbols tell the wall detector where openings are: walls run on through their
    // doors, and a door set across a corner still gets the wall piece it hangs in.
    const segs = collectSegments(vectors);
    const symbols = detectDoorSymbols(segs, r.scaleMmPerPt, { minLeafMm: 500, maxLeafMm: 1500, hostCorridorPadPt: 18 });
    const openings = symbols.map((s) => ({ a: s.hinge, b: s.closed, leaf: { a: s.hinge, b: s.free } }));
    const diag: Record<string, unknown> = {};
    const walls = detectWallsGeneral(segs, r.scaleMmPerPt, raster, { openings }, diag);
    const generalLen = walls.reduce((t, w) => t + w.length, 0);
    const legacyLen = r.accepted.reduce((t, w) => t + w.length, 0);
    const openingWalls = walls.filter((w) => w.kind === 'opening').length;
    r.wallEngineNote =
      `general ${walls.length} walls (${openingWalls} door headers, ${symbols.length} door symbols, ` +
      `${diag.columns ?? 0} columns) / ${Math.round(generalLen)}pt vs legacy ${r.accepted.length} / ${Math.round(legacyLen)}pt`;
    if (walls.length < 3 || generalLen <= legacyLen) return;
    const evidenceOf = (k: string) => (k === 'poche' ? 'poche-band' : k === 'opening' ? 'door-opening-header' : 'parallel-faces');
    const physical: PurePhysicalWall[] = walls.map((w) => ({
      ...withOrientation({
        id: w.id,
        evidenceType: w.kind === 'poche' ? 'filled-rect' : 'parallel-face',
        sourceRootIds: [],
        sourceSubpathIds: [],
        sourceStrokeIds: [],
        centerline: { a: w.a, b: w.b },
        thickness: w.thickness,
        length: w.length,
        confidence: w.kind === 'opening' ? 0.7 : 0.8,
        evidence: ['general-wall-detector', evidenceOf(w.kind), 'connected-network'],
      }),
      physicalWallId: w.id,
      verdict: 'accepted' as const,
      networkConnectivity: 1,
      perimeterContribution: false,
      genuinelyFloating: false,
      fusedCandidateIds: [w.id],
      evidenceTypes: [w.kind === 'poche' ? 'filled-rect' : 'parallel-face'] as EvidenceType[],
      positiveEvidence: ['general-wall-detector'],
      negativeEvidence: [],
    }));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const w of walls) for (const p of [w.a, w.b]) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    const roi: Bounds = [x0, y0, x1, y1];
    r.accepted = physical;
    r.physicalWalls = physical;
    r.review = [];
    r.rejected = [];
    r.floatingAccepted = [];
    r.genuinelyFloatingAcceptedPhysicalWalls = [];
    r.roi = roi;
    r.activeBuildingRegionMupdf = roi;
    r.activeBuildingRegionSource = roi;
    r.wallEngine = 'general';
  } catch (e) {
    // keep the legacy result
    r.wallEngineNote = `general detector failed: ${String(e).slice(0, 160)}`;
  }
}

function hashStrings(xs: string[]): string {
  let h = 0x811c9dc5 >>> 0;
  for (const s of xs) { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } }
  return h.toString(16).padStart(8, '0');
}





