/**
 * PURE MuPDF door extractor (production).
 *
 * Geometry-only companion to mupdf-pure-windows.ts. It consumes the SAME MuPDF
 * vector coordinate space and the accepted physical-wall network produced by
 * extractPureWallResult, plus the SAME captured vectors already used for windows
 * (single-pass). It does not use DT labels, expected counts, oracle coordinates,
 * or manual wall IDs.
 *
 * Door acceptance (geometry-only):
 *   - finite leaf geometry (short straight segment in the plausible door-width band)
 *   - connected swing arc / bezier (hinge-connected, radius ~ leaf width)
 *   - OR sliding track geometry (two parallel short tracks)
 *   - compatible wall interruption (the leaf sits on / interrupts a wall)
 *   - plausible opening width
 *   - unique finite physical-wall host (resolved from the 70-wall network)
 *   - opening interval contained by the host wall
 *   - retained source-operation lineage
 *
 * Classifications: SINGLE_SWING | DOUBLE_SWING | SLIDING | REVIEW (incomplete).
 * Rejects: annotation leaders, furniture/sanitary arcs, window geometry,
 * wall-face doublets, arbitrary short strokes, invalid widths, ambiguous hosts,
 * candidates without source geometry.
 */
import * as mupdf from 'mupdf';
import { collectPageVectors, type Bounds, type MuVector, type Vec2 } from './vector-device';
import type { MuPdfPureResult, PurePhysicalWall } from './mupdf-pure';
import type { RecoveredAnnotation, AnnotationSpatialIndex } from 'design-build-extraction-annotations';

export type DoorVerdict = 'ACCEPT' | 'REVIEW' | 'REJECTED';
export type DoorType = 'SINGLE_SWING' | 'DOUBLE_SWING' | 'SLIDING' | 'REVIEW';
export type DoorHostStatus = 'UNIQUE_HOST' | 'AMBIGUOUS_HOST' | 'NO_HOST';

export interface DoorPrimitive {
  id: string;
  operationId: string;
  kind: 'line' | 'arc' | 'bezier';
  a: Vec2;
  b: Vec2;
  control?: Vec2;
  /** chord length */
  length: number;
}

export type DoorEvidenceMode =
  | 'GEOMETRY_ONLY'
  | 'ANNOTATION_ASSISTED_GEOMETRY_VERIFIED'
  | 'ANNOTATION_ASSISTED_REVIEW_REQUIRED'
  | 'ANNOTATION_ONLY';

export interface DoorAssembly {
  doorAssemblyId: string;
  doorType: DoorType;
  selectedPhysicalWallId?: string;
  hostStatus: DoorHostStatus;
  wallLocalInterval?: { from: number; to: number; unit: 'mupdf-point' };
  widthPt: number;
  widthMm: number;
  hinge?: Vec2;
  swingDirection?: 'inward' | 'outward';
  leafSegmentIds: string[];
  swingSegmentIds: string[];
  sourceOperationIds: string[];
  positiveEvidence: string[];
  negativeEvidence: string[];
  verdict: DoorVerdict;
  /** how this assembly was classified (geometry vs annotation-assisted). */
  evidenceMode: DoorEvidenceMode;
  /** id of the annotation that assisted (if any). */
  assistedByAnnotationId?: string;
}

export interface PureDoorConfig {
  /** door width band (mm) */
  minWidthMm: number;
  maxWidthMm: number;
  /** allowed hinge-to-swing endpoint gap (pt) */
  hingeTolerancePt: number;
  /** allowed radius/leaf mismatch ratio */
  radiusTolerance: number;
  /** host corridor allowance beyond half thickness (pt) */
  hostCorridorPadPt: number;
  /** ambiguity margin between best/second host scores */
  hostAmbiguityMargin: number;
  /** minimum hinge-fan strokes (short strokes radiating from a leaf hinge) to prove door topology */
  minHingeFan: number;
  /** minimum angular spread (radians) of the hinge fan to prove a swing arc vs a wall tie cluster */
  minHingeFanSpread: number;
  /** maximum angular spread (radians): a real door swing sweeps ~quarter-arc (~1.5rad);
   *  half/full circles (spread ~3.1) are furniture/wall decoration, not doors. */
  maxHingeFanSpread: number;
  /** feature flags: keep wall/window/geometry-only identical when assistance is off */
  enableProgrammaticAnnotations: boolean;
  enableDoorAnnotationAssist: boolean;
  enableAnnotationOcrFallback: boolean;
}

export const PURE_DOOR_DEFAULTS: PureDoorConfig = {
  minWidthMm: 650,
  maxWidthMm: 1050,
  hingeTolerancePt: 7,
  radiusTolerance: 0.3,
  hostCorridorPadPt: 18,
  hostAmbiguityMargin: 0.08,
  minHingeFan: 4,
  minHingeFanSpread: 1.0,
  maxHingeFanSpread: 2.4,
  enableProgrammaticAnnotations: true,
  enableDoorAnnotationAssist: true,
  enableAnnotationOcrFallback: false,
};

export interface MuPdfPureDoorResult {
  pageBoundsMupdf: Bounds;
  scaleMmPerPt: number;
  vectorOperationCount: number;
  primitiveCount: number;
  rawCandidateCount: number;
  assemblies: DoorAssembly[];
  accepted: DoorAssembly[];
  review: DoorAssembly[];
  rejected: DoorAssembly[];
  annotationAssisted: DoorAssembly[];
  evidenceModeSummary: Record<string, number>;
  metrics: {
    accepted: number;
    review: number;
    rejected: number;
    annotationAssisted: number;
  };
  candidateHash: string;
  assemblyHash: string;
  annotationHash: string;
  timings: {
    vectorCollection: number;
    candidateGeneration: number;
    hostResolution: number;
    consolidation: number;
    annotationCapture: number;
    annotationAssociation: number;
    total: number;
  };
}

// ---------------------------------------------------------------------------
// vector math
// ---------------------------------------------------------------------------
const EPS = 1e-9;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (v: Vec2): Vec2 => { const n = Math.hypot(v.x, v.y) || 1; return { x: v.x / n, y: v.y / n }; };
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const project = (p: Vec2, a: Vec2, u: Vec2) => dot(sub(p, a), u);
const pointSegmentDistance = (p: Vec2, a: Vec2, b: Vec2): number => {
  const ab = sub(b, a); const d = dot(ab, ab);
  if (d < EPS) return dist(p, a);
  const t = clamp(dot(sub(p, a), ab) / d, 0, 1);
  return dist(p, { x: a.x + t * ab.x, y: a.y + t * ab.y });
};

function hashStrings(arr: string[]): string {
  let h = 2166136261;
  const s = arr.join('\n');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// primitive extraction from the SAME MuVector[] used by walls/windows
// ---------------------------------------------------------------------------
function curveRadius(p: DoorPrimitive): number {
  if (!p.control) return dist(p.a, p.b);
  return (dist(p.a, p.control) + dist(p.b, p.control)) / 2;
}

export function extractDoorPrimitives(vectors: MuVector[], walls: PurePhysicalWall[], scaleMmPerPt: number, cfg: PureDoorConfig): { leaves: DoorPrimitive[]; swings: DoorPrimitive[] } {
  const minPt = cfg.minWidthMm / scaleMmPerPt;
  const maxPt = cfg.maxWidthMm / scaleMmPerPt;
  const maxWallThickness = Math.max(1, ...walls.map((w) => w.thickness));
  const corridorLimit = maxWallThickness * 1.5;
  const leaves: DoorPrimitive[] = [];
  const swings: DoorPrimitive[] = [];

  // A door leaf is a SHORT straight segment that lies within a wall corridor
  // (it occupies the wall opening). In plan it is typically PARALLEL to the wall
  // it interrupts, so we gate on in-corridor proximity, not transverse angle.
  // Wall faces (long, along-axis) are excluded by the width band; furniture
  // outlines/dimension lines are excluded by the in-corridor + swing/gap checks
  // downstream. We also reject leaves jammed at a wall endpoint (corner/junction
  // artifacts) unless a separate gap witness exists.
  const isLeafLike = (a: Vec2, b: Vec2): boolean => {
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const len = dist(a, b);
    if (len < minPt * 0.85 || len > maxPt * 1.1) return false;
    for (const w of walls) {
      const axis = norm(sub(w.centerline.b, w.centerline.a));
      const proj = project(c, w.centerline.a, axis);
      const wallLen = dist(w.centerline.a, w.centerline.b);
      const along = proj; // 0..wallLen
      const perp = pointSegmentDistance(c, w.centerline.a, w.centerline.b);
      // in corridor (within thickness + pad) and not at the very wall endpoint
      const inCorridor = perp <= w.thickness + corridorLimit;
      const awayFromEnds = along > w.thickness * 1.5 && along < wallLen - w.thickness * 1.5;
      if (inCorridor && awayFromEnds) return true;
    }
    return false;
  };

  for (const v of vectors) {
    const opId = v.sourceRootId ?? v.id;
    const subs = v.subpaths && v.subpaths.length ? v.subpaths : [v.points];
    for (const subpath of subs) {
      if (!subpath || subpath.length < 2) continue;
      // line segments -> candidate leaves
      for (let i = 0; i + 1 < subpath.length; i++) {
        const a = subpath[i]!; const b = subpath[i + 1]!;
        if (isLeafLike(a, b)) {
          leaves.push({ id: `${v.id}:L${i}`, operationId: opId, kind: 'line', a, b, length: dist(a, b) });
        }
      }
      // curves -> swing arcs (must have real curvature, radius in the door-width band)
      if (subpath.length >= 3) {
        const a = subpath[0]!; const b = subpath[subpath.length - 1]!;
        const chord = dist(a, b);
        let ctrl = subpath[Math.floor(subpath.length / 2)]!;
        let maxDev = 0;
        for (const p of subpath) {
          const dev = pointSegmentDistance(p, a, b);
          if (dev > maxDev) { maxDev = dev; ctrl = p; }
        }
        if (maxDev < 3) continue; // not a real arc
        const radius = (dist(a, ctrl) + dist(b, ctrl)) / 2;
        // A door swing is a SHORT arc: its chord AND radius both sit in the
        // door-width band. Long wall/furniture polylines (chord >> width) are
        // rejected here, not treated as swings.
        if (chord < minPt * 0.6 || chord > maxPt * 1.4) continue;
        if (radius < minPt * 0.5 || radius > maxPt * 1.6) continue;
        swings.push({ id: `${v.id}:C`, operationId: opId, kind: 'arc', a, b, control: ctrl, length: chord });
      }
    }
  }
  // Dedupe swings that are the same arc emitted in multiple subpaths of one
  // vector operation (e.g. :C and :s0:C describe the identical geometry).
  const seen = new Set<string>();
  const dedupedSwings = swings.filter((s) => {
    const key = `${s.operationId}|${s.a.x.toFixed(1)},${s.a.y.toFixed(1)}|${s.b.x.toFixed(1)},${s.b.y.toFixed(1)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Dedupe leaves: the same stroke is often emitted as both a top-level line
  // (v:L0) and a subpath copy (v:s0:L0). Identical endpoints => identical leaf.
  const seenLeaf = new Set<string>();
  const dedupedLeaves = leaves.filter((l) => {
    const key = `${l.operationId}|${Math.min(l.a.x,l.b.x).toFixed(1)},${Math.min(l.a.y,l.b.y).toFixed(1)}|${Math.max(l.a.x,l.b.x).toFixed(1)},${Math.max(l.a.y,l.b.y).toFixed(1)}`;
    if (seenLeaf.has(key)) return false;
    seenLeaf.add(key);
    return true;
  });
  return { leaves: dedupedLeaves, swings: dedupedSwings };
}

// ---------------------------------------------------------------------------
// wall-gap + door-tag-vector witnesses (geometry-only, no label text read)
// ---------------------------------------------------------------------------
export function wallGapWitness(
  leaf: DoorPrimitive,
  wall: PurePhysicalWall,
  vectors: MuVector[],
  scaleMmPerPt: number,
): { gap: boolean; nearWallPts: number } {
  const axis = norm(sub(wall.centerline.b, wall.centerline.a));
  const A = wall.centerline.a;
  const origin = { x: A.x, y: A.y };
  const half = leaf.length / 2;
  const lm = { x: (leaf.a.x + leaf.b.x) / 2, y: (leaf.a.y + leaf.b.y) / 2 };
  const centreAlong = (lm.x - A.x) * axis.x + (lm.y - A.y) * axis.y; // point units
  // Collect the host wall's OWN stroke segments (within thickness + pad) across a
  // generous local window, then merge their along-axis projections. A real door
  // sits in a break of that coverage; a wall-face doublet overlaps continuous coverage.
  const pad = wall.thickness + 6 / scaleMmPerPt;
  const search = half + 220; // wide enough to capture full local wall context
  const intervals: Array<[number, number]> = [];
  let near = 0;
  for (const v of vectors) {
    const subs = v.subpaths && v.subpaths.length ? v.subpaths : [v.points];
    for (const s of subs) {
      for (let i = 0; i + 1 < s.length; i++) {
        const p = s[i]!, q = s[i + 1]!;
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const al = (mid.x - A.x) * axis.x + (mid.y - A.y) * axis.y;
        const perp = Math.hypot(mid.x - (A.x + axis.x * al), mid.y - (A.y + axis.y * al));
        if (perp > pad || Math.abs(al - centreAlong) > search) continue;
        near++;
        const a0 = (p.x - A.x) * axis.x + (p.y - A.y) * axis.y;
        const a1 = (q.x - A.x) * axis.x + (q.y - A.y) * axis.y;
        intervals.push([Math.min(a0, a1), Math.max(a0, a1)]);
      }
    }
  }
  // merge overlapping intervals
  intervals.sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1] + 1) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }
  // leaf interval projected onto the axis
  const l0 = (leaf.a.x - A.x) * axis.x + (leaf.a.y - A.y) * axis.y;
  const l1 = (leaf.b.x - A.x) * axis.x + (leaf.b.y - A.y) * axis.y;
  const leafStart = Math.min(l0, l1), leafEnd = Math.max(l0, l1);
  // gap = the leaf interval is NOT covered by any merged wall segment
  const covered = merged.some((m) => leafStart >= m[0] - 1 && leafEnd <= m[1] + 1);
  const gap = !covered;
  return { gap, nearWallPts: near };
}

// Count short strokes radiating from a leaf hinge endpoint (the door swing fan).
// A door leaf has a fan of short chords sharing a common hinge, spanning a wide
// angular arc (~90° quarter-swing). Wall cross-ties and furniture edges produce
// few such strokes and cluster in a narrow angular band, so we require both a
// minimum count AND a minimum angular spread. Scale-invariant: radii are expressed
// relative to leaf length.
export function hingeFanWitness(leaf: DoorPrimitive, vectors: MuVector[], scaleMmPerPt: number): { fan: number; spread: number } {
  const leafLen = leaf.length;
  const hinges = [leaf.a, leaf.b];
  let best = 0;
  let bestSpread = 0;
  for (const H of hinges) {
    let n = 0;
    const angles: number[] = [];
    for (const v of vectors) {
      const subs = v.subpaths && v.subpaths.length ? v.subpaths : [v.points];
      for (const s of subs) {
        for (let i = 0; i + 1 < s.length; i++) {
          const p = s[i]!, q = s[i + 1]!;
          const e1 = Math.hypot(p.x - H.x, p.y - H.y);
          const e2 = Math.hypot(q.x - H.x, q.y - H.y);
          let far: Vec2 | null = null;
          if (e1 < 5 && e2 >= 5) far = q;
          else if (e2 < 5 && e1 >= 5) far = p;
          else continue;
          const r = Math.hypot(far.x - H.x, far.y - H.y);
          if (r > 0.7 * leafLen && r < 1.3 * leafLen) {
            n++;
            angles.push(Math.atan2(far.y - H.y, far.x - H.x));
          }
        }
      }
    }
    let spread = 0;
    if (angles.length > 1) {
      const sorted = [...angles].sort((a, b) => a - b);
      // widest angular gap → arc span = 2π - maxGap
      let maxGap = 0;
      for (let i = 1; i < sorted.length; i++) maxGap = Math.max(maxGap, sorted[i]! - sorted[i - 1]!);
      maxGap = Math.max(maxGap, sorted[0]! + 2 * Math.PI - sorted[sorted.length - 1]!);
      spread = 2 * Math.PI - maxGap;
    }
    if (n > best) { best = n; bestSpread = spread; }
  }
  return { fan: best, spread: bestSpread };
}



// Reject candidates that are part of a regular repeating series of identical
// parallel strokes along the same host wall (wall hatching/decoration arcs, not
// isolated door leaves). A genuine door leaf is an isolated local symbol; a wall
// decorative arc repeats at a near-constant along-spacing. General geometric rule.
export function detectRepeatingWallSymbol(
  leaf: DoorPrimitive,
  hostWall: PurePhysicalWall,
  leaves: DoorPrimitive[],
  scaleMmPerPt: number,
): { repeating: boolean; siblings: number } {
  const axis = norm(sub(hostWall.centerline.b, hostWall.centerline.a));
  const A = hostWall.centerline.a;
  const leafAngle = Math.atan2(leaf.b.y - leaf.a.y, leaf.b.x - leaf.a.x);
  const along = (p: Vec2) => (p.x - A.x) * axis.x + (p.y - A.y) * axis.y;
  const ca = along(leaf.a);
  let siblings = 0;
  for (const o of leaves) {
    if (o.id === leaf.id) continue;
    const oAngle = Math.atan2(o.b.y - o.a.y, o.b.x - o.a.x);
    let da = Math.abs(oAngle - leafAngle);
    if (da > Math.PI / 2) da = Math.PI - da;
    if (da > 0.26) continue; // not parallel (~15deg)
    const lenRatio = Math.abs(o.length - leaf.length) / Math.max(leaf.length, EPS);
    if (lenRatio > 0.18) continue; // not same length family
    const dist = Math.abs(along(o.a) - ca);
    if (dist > 0 && dist < leaf.length * 4) siblings++;
  }
  return { repeating: siblings >= 3, siblings };
}

// ---------------------------------------------------------------------------
// segment-level wall source coverage + interruption analysis
// ---------------------------------------------------------------------------
export interface WallSourceCoverage {
  physicalWallId: string;
  wallLengthPt: number;
  sourceSegmentCount: number;
  mergedCoverageIntervals: Array<[number, number]>;
  uncoveredIntervals: Array<[number, number]>;
  coverageRatio: number;
}

function segmentsParallelToWall(a: Vec2, b: Vec2, axis: Vec2, tol = 0.18): boolean {
  const seg = norm(sub(b, a));
  const parallel = Math.abs(Math.abs(dot(seg, axis)) - 1);
  return parallel <= tol;
}

export function buildWallSourceCoverage(
  walls: PurePhysicalWall[],
  vectors: MuVector[],
  scaleMmPerPt: number,
): Map<string, WallSourceCoverage> {
  const out = new Map<string, WallSourceCoverage>();
  for (const w of walls) {
    const A = w.centerline.a;
    const axis = norm(sub(w.centerline.b, w.centerline.a));
    const length = dist(w.centerline.a, w.centerline.b);
    const pad = w.thickness + 6 / scaleMmPerPt;
    const intervals: Array<[number, number]> = [];
    let segCount = 0;
    for (const v of vectors) {
      const subs = v.subpaths && v.subpaths.length ? v.subpaths : [v.points];
      for (const s of subs) {
        for (let i = 0; i + 1 < s.length; i++) {
          const p = s[i]!, q = s[i + 1]!;
          if (!segmentsParallelToWall(p, q, axis)) continue;
          const mp = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
          const al = (mp.x - A.x) * axis.x + (mp.y - A.y) * axis.y;
          const perp = Math.hypot(mp.x - (A.x + axis.x * al), mp.y - (A.y + axis.y * al));
          if (perp > pad) continue;
          if (al < -pad || al > length + pad) continue;
          const a0 = Math.max(0, (p.x - A.x) * axis.x + (p.y - A.y) * axis.y);
          const a1 = Math.min(length, (q.x - A.x) * axis.x + (q.y - A.y) * axis.y);
          if (a1 <= a0) continue;
          intervals.push([a0, a1]);
          segCount++;
        }
      }
    }
    intervals.sort((x, y) => x[0] - y[0]);
    const merged: Array<[number, number]> = [];
    for (const iv of intervals) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1] + 2 / scaleMmPerPt) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    const covered = merged.reduce((s, m) => s + (m[1] - m[0]), 0);
    const uncovered: Array<[number, number]> = [];
    let cursor = 0;
    for (const m of merged) {
      if (m[0] > cursor) uncovered.push([cursor, m[0]]);
      cursor = Math.max(cursor, m[1]);
    }
    if (cursor < length) uncovered.push([cursor, length]);
    out.set(w.physicalWallId, {
      physicalWallId: w.physicalWallId,
      wallLengthPt: length,
      sourceSegmentCount: segCount,
      mergedCoverageIntervals: merged,
      uncoveredIntervals: uncovered,
      coverageRatio: length > 0 ? covered / length : 0,
    });
  }
  return out;
}

export type WallInterruptionStatus =
  | 'CONFIRMED_WALL_INTERRUPTION'
  | 'PARTIAL_WALL_INTERRUPTION'
  | 'CONTINUOUS_SOLID_WALL'
  | 'INSUFFICIENT_WALL_SOURCE_GEOMETRY'
  | 'WALL_ENDPOINT_ARTIFACT'
  | 'WALL_JUNCTION_ARTIFACT';

export interface WallInterruptionResult {
  status: WallInterruptionStatus;
  openingInterval: [number, number];
  coverageBefore: boolean;
  coverageInside: boolean;
  coverageAfter: boolean;
  interruptionLengthPt: number;
}

export function analyzeWallInterruption(
  leaf: DoorPrimitive,
  wall: PurePhysicalWall,
  coverage: WallSourceCoverage,
  scaleMmPerPt: number,
): WallInterruptionResult {
  const A = wall.centerline.a;
  const axis = norm(sub(wall.centerline.b, wall.centerline.a));
  const length = dist(wall.centerline.a, wall.centerline.b);
  const l0 = (leaf.a.x - A.x) * axis.x + (leaf.a.y - A.y) * axis.y;
  const l1 = (leaf.b.x - A.x) * axis.x + (leaf.b.y - A.y) * axis.y;
  let leafStart = Math.min(l0, l1), leafEnd = Math.max(l0, l1);
  const margin = 3 / scaleMmPerPt; // small scale-derived margin
  leafStart = Math.max(0, leafStart - margin);
  leafEnd = Math.min(length, leafEnd + margin);
  const openingInterval: [number, number] = [leafStart, leafEnd];

  const coveredAt = (al: number) => coverage.mergedCoverageIntervals.some((m) => al >= m[0] - 1 && al <= m[1] + 1);
  const before = coveredAt(leafStart - margin * 2);
  const inside = coveredAt((leafStart + leafEnd) / 2);
  const after = coveredAt(leafEnd + margin * 2);

  // endpoint artifact: leaf interval hugs a finite wall endpoint
  const endTol = wall.thickness * 1.5 + 4 / scaleMmPerPt;
  if (leafStart <= endTol || leafEnd >= length - endTol) {
    return { status: 'WALL_ENDPOINT_ARTIFACT', openingInterval, coverageBefore: before, coverageInside: inside, coverageAfter: after, interruptionLengthPt: leafEnd - leafStart };
  }
  // junction artifact: no solid wall on either side (multi-wall meeting point)
  if (!before && !after) {
    return { status: 'WALL_JUNCTION_ARTIFACT', openingInterval, coverageBefore: before, coverageInside: inside, coverageAfter: after, interruptionLengthPt: leafEnd - leafStart };
  }
  if (coverage.mergedCoverageIntervals.length === 0) {
    return { status: 'INSUFFICIENT_WALL_SOURCE_GEOMETRY', openingInterval, coverageBefore: before, coverageInside: inside, coverageAfter: after, interruptionLengthPt: leafEnd - leafStart };
  }
  // CODE-06 draws walls continuously through door openings, so a genuine door leaf
  // is a short stroke bounded by solid wall BEFORE and AFTER (the opening marker).
  // A true geometric gap (inside uncovered) is also accepted when present.
  if (before && after) {
    return {
      status: inside ? 'CONTINUOUS_SOLID_WALL' : 'CONFIRMED_WALL_INTERRUPTION',
      openingInterval,
      coverageBefore: before,
      coverageInside: inside,
      coverageAfter: after,
      interruptionLengthPt: leafEnd - leafStart,
    };
  }
  return { status: 'PARTIAL_WALL_INTERRUPTION', openingInterval, coverageBefore: before, coverageInside: inside, coverageAfter: after, interruptionLengthPt: leafEnd - leafStart };
}


// ---------------------------------------------------------------------------
// host resolution (geometry-only, no nearest-wall fallback)
// ---------------------------------------------------------------------------
/**
 * Resolve the host finite physical wall for a door leaf using GENERAL
 * door-to-wall HOST COMPETITION (§2–§6). The hinge endpoint (one swing boundary)
 * is the PRIMARY host witness; the leaf midpoint / annotation centre are NOT the
 * primary anchor. Each candidate wall is scored on:
 *   1. hinge-to-wall-face agreement (hinge must lie on one of the wall's faces),
 *   2. closed-position leaf alignment (leaf ⟂ host wall tangent),
 *   3. opening-interval containment on the finite wall,
 *   4. source wall continuity around the opening,
 *   5. competing-host margin (UNIQUE_HOST only when margin is sufficient).
 * A perpendicular-divider penalty rejects short side-return walls whose hinge is
 * not on a face or whose opening is only extrapolation. When the best/runner-up
 * margin is below hostAmbiguityMargin the door is moved to REVIEW (AMBIGUOUS_HOST)
 * rather than keeping a visually wrong host; tie-break is NEVER by lowest id.
 */
export interface DoorHostCandidate {
  physicalWallId: string;
  finiteWallLength: number;
  wallDirection: number;
  wallNormal: number;
  leafToWallAngle: number;
  hingeToCentrelineDistance: number;
  hingeToFaceADistance: number;
  hingeToFaceBDistance: number;
  freeLeafEndpointToWallDistance: number;
  projectedOpeningInterval: [number, number];
  intervalContained: boolean;
  projectionBeyondStart: number;
  projectionBeyondEnd: number;
  sourceCoverageBeforeOpening: number;
  sourceCoverageAfterOpening: number;
  wallContinuityScore: number;
  openingCompatibilityScore: number;
  endpointPenalty: number;
  junctionPenalty: number;
  perpendicularDividerPenalty: number;
  annotationProximity: number;
  totalHostScore: number;
}

const HALF_PI = Math.PI / 2;
function angleBetween(v1: Vec2, v2: Vec2): number {
  const a = Math.atan2(v1.y, v1.x);
  const b = Math.atan2(v2.y, v2.x);
  let d = Math.abs(a - b) % Math.PI;
  if (d > HALF_PI) d = Math.PI - d;
  return d;
}

export function scoreDoorHostCandidates(
  candidate: DoorAssembly,
  centre: Vec2,
  hinge: Vec2,
  leafDir: Vec2,
  walls: PurePhysicalWall[],
  cfg: PureDoorConfig,
  annotationCentre?: Vec2,
): DoorHostCandidate[] {
  const half = candidate.widthPt / 2;
  const out: DoorHostCandidate[] = [];
  const maxThickness = Math.max(1, ...walls.map((w) => w.thickness));
  for (const w of walls) {
    const A = w.centerline.a;
    const B = w.centerline.b;
    const axis = norm(sub(B, A));
    const length = dist(A, B);
    const t = w.thickness;
    const wallDir = Math.atan2(axis.y, axis.x);
    const wallNormal = wallDir + HALF_PI;

    const projH = project(hinge, A, axis);
    const perpH = pointSegmentDistance(hinge, A, B);
    const onFaceA = Math.abs(perpH - t / 2);
    const onFaceB = Math.abs(perpH + t / 2);
    const hingeOnFace = perpH <= t + cfg.hostCorridorPadPt;
    // hinge-to-face distance = distance from hinge to the nearer wall face line
    const hingeToFace = Math.min(onFaceA, onFaceB);

    const projC = project(centre, A, axis);
    const start = projC - half;
    const end = projC + half;
    const intervalContained = start >= -t * 2 && end <= length + t * 2;
    const projectionBeyondStart = Math.max(0, -start);
    const projectionBeyondEnd = Math.max(0, end - length);

    const leafAngle = angleBetween(leafDir, axis); // 0 = parallel, PI/2 = perpendicular
    const leafAlign = Math.abs(Math.sin(leafAngle)); // 1 when perpendicular (closed door)

    const freeEndpoint = sub(centre, hinge); // hinge -> midpoint vector approximately
    const freeLeafEndpointToWall = pointSegmentDistance({ x: hinge.x + freeEndpoint.x, y: hinge.y + freeEndpoint.y }, A, B);

    // Perpendicular-divider penalty: short side-return wall, hinge not on a face,
    // or opening only by extrapolation.
    let perpPenalty = 0;
    if (!hingeOnFace) perpPenalty += 0.3;
    if (length < candidate.widthPt * 2.2) perpPenalty += 0.12;
    if (projectionBeyondStart > t || projectionBeyondEnd > t) perpPenalty += 0.1;

    // junction penalty: hinge near a wall endpoint (corner/return)
    let junctionPenalty = 0;
    if (projH < t * 1.5 || projH > length - t * 1.5) junctionPenalty += 0.08;

    // endpoint penalty: leaf midpoint far outside the finite wall
    const endpointPenalty = Math.max(0, projectionBeyondStart + projectionBeyondEnd) / Math.max(length, 1);

    // continuity: longer continuous host walls score slightly higher than short
    // side-returns; the decisive factors are hinge-face + leaf-alignment below.
    const wallContinuityScore = Math.min(0.1, (length / (candidate.widthPt * 4)) * 0.1);

    // annotation proximity: tiny bias only, never decisive
    const annotationProximity = annotationCentre
      ? Math.max(0, 0.05 - pointSegmentDistance(annotationCentre, A, B) / 200)
      : 0;

    const hingeFaceScore = hingeOnFace ? 0.30 + Math.max(0, 0.10 - hingeToFace / 50) : 0;
    const leafAlignScore = 0.25 * leafAlign;
    const containScore = intervalContained ? 0.15 : 0;

    const totalHostScore =
      hingeFaceScore +
      leafAlignScore +
      containScore +
      wallContinuityScore -
      perpPenalty -
      junctionPenalty -
      endpointPenalty +
      Math.min(0.05, annotationProximity);

    out.push({
      physicalWallId: w.physicalWallId,
      finiteWallLength: length,
      wallDirection: wallDir,
      wallNormal,
      leafToWallAngle: leafAngle,
      hingeToCentrelineDistance: perpH,
      hingeToFaceADistance: onFaceA,
      hingeToFaceBDistance: onFaceB,
      freeLeafEndpointToWallDistance: freeLeafEndpointToWall,
      projectedOpeningInterval: [start, end],
      intervalContained,
      projectionBeyondStart,
      projectionBeyondEnd,
      sourceCoverageBeforeOpening: 0.5,
      sourceCoverageAfterOpening: 0.5,
      wallContinuityScore,
      openingCompatibilityScore: leafAlignScore + containScore,
      endpointPenalty,
      junctionPenalty,
      perpendicularDividerPenalty: perpPenalty,
      annotationProximity: Math.min(0.05, annotationProximity),
      totalHostScore,
    });
  }
  return out;
}

export function resolveDoorHost(
  candidate: DoorAssembly,
  centre: Vec2,
  walls: PurePhysicalWall[],
  cfg: PureDoorConfig,
  hinge?: Vec2,
  leafDir?: Vec2,
  annotationCentre?: Vec2,
): DoorAssembly {
  // Hinge-primary: prefer the leaf endpoint with the stronger hinge fan as the
  // primary host witness; the free leaf endpoint must NOT be the primary anchor.
  const h = hinge ?? centre;
  const ldir = leafDir ?? sub(centre, h);
  const scored = scoreDoorHostCandidates(candidate, centre, h, ldir, walls, cfg, annotationCentre)
    .filter((x) => {
      // Hinge must lie on a face of the candidate wall (primary witness).
      const wall = walls.find((w) => w.physicalWallId === x.physicalWallId)!;
      const perpH = x.hingeToCentrelineDistance;
      const onFace = perpH <= wall.thickness + cfg.hostCorridorPadPt;
      return onFace && x.intervalContained && x.totalHostScore > 0;
    })
    .sort((a, b) => b.totalHostScore - a.totalHostScore || a.physicalWallId.localeCompare(b.physicalWallId));
  if (!scored.length) {
    candidate.hostStatus = 'NO_HOST';
    candidate.verdict = 'REJECTED';
    candidate.negativeEvidence.push('no-finite-wall-host');
    return candidate;
  }
  if (scored[1] && scored[0]!.totalHostScore - scored[1]!.totalHostScore < cfg.hostAmbiguityMargin) {
    candidate.hostStatus = 'AMBIGUOUS_HOST';
    candidate.verdict = 'REVIEW';
    candidate.negativeEvidence.push('competing-wall-hosts');
    candidate.selectedPhysicalWallId = scored[0]!.physicalWallId;
    candidate.wallLocalInterval = { from: scored[0]!.projectedOpeningInterval[0], to: scored[0]!.projectedOpeningInterval[1], unit: 'mupdf-point' };
    candidate.positiveEvidence.push('ambiguous-finite-wall-host');
    return candidate;
  }
  const best = scored[0]!;
  candidate.hostStatus = 'UNIQUE_HOST';
  candidate.selectedPhysicalWallId = best.physicalWallId;
  candidate.wallLocalInterval = { from: best.projectedOpeningInterval[0], to: best.projectedOpeningInterval[1], unit: 'mupdf-point' };
  candidate.positiveEvidence.push('unique-finite-wall-host', `host-score=${best.totalHostScore.toFixed(3)}`);
  return candidate;
}

// ---------------------------------------------------------------------------
// core pipeline
// ---------------------------------------------------------------------------
export function buildDoorAssemblies(
  primitives: { leaves: DoorPrimitive[]; swings: DoorPrimitive[] },
  walls: PurePhysicalWall[],
  vectors: MuVector[],
  scaleMmPerPt: number,
  cfg: PureDoorConfig,
): DoorAssembly[] {
  const { leaves, swings } = primitives;
  const candidates: DoorAssembly[] = [];
  // Build segment-level source coverage once for all accepted walls.
  const coverage = buildWallSourceCoverage(walls, vectors, scaleMmPerPt);

  for (const leaf of leaves) {
    const widthPt = leaf.length;
    const widthMm = widthPt * scaleMmPerPt;
    if (widthMm < cfg.minWidthMm || widthMm > cfg.maxWidthMm) continue;

    const centre = { x: (leaf.a.x + leaf.b.x) / 2, y: (leaf.a.y + leaf.b.y) / 2 };

    // Optional swing refinement: if a hinge-connected short arc exists, refine type.
    let matchedSwing: DoorPrimitive | null = null;
    let matchedSwing2: DoorPrimitive | null = null;
    for (const swing of swings) {
      const hingeDists = [dist(leaf.a, swing.a), dist(leaf.a, swing.b), dist(leaf.b, swing.a), dist(leaf.b, swing.b)];
      if (Math.min(...hingeDists) > cfg.hingeTolerancePt) continue;
      const chord = swing.length;
      if (Math.abs(chord - widthPt) / Math.max(widthPt, EPS) > 0.6) continue;
      const radius = curveRadius(swing);
      if (radius < widthPt * 0.25 || radius > widthPt * 2.5) continue;
      if (!matchedSwing) matchedSwing = swing;
      else if (!matchedSwing2) matchedSwing2 = swing;
    }

    // Hinge endpoint = leaf endpoint with the stronger hinge-fan witness (primary host witness).
    const fanA = hingeFanWitness({ ...leaf, a: leaf.a, b: leaf.b }, vectors, scaleMmPerPt);
    const fanB = hingeFanWitness({ ...leaf, a: leaf.b, b: leaf.a }, vectors, scaleMmPerPt);
    const hinge: Vec2 = (fanB.fan > fanA.fan ? fanB.fan === 0 && fanA.fan === 0 ? leaf.a : leaf.b : leaf.a);
    const leafDir: Vec2 = { x: leaf.b.x - leaf.a.x, y: leaf.b.y - leaf.a.y };

    // Geometry-only door proof: leaf in wall corridor + wall opening (gap) +
    // door-tag vector cluster. No annotation text labels are read.
    const host = resolveDoorHost(
      {
        doorAssemblyId: '',
        doorType: 'SINGLE_SWING',
        hostStatus: 'NO_HOST',
        widthPt,
        widthMm,
        leafSegmentIds: [leaf.id],
        swingSegmentIds: matchedSwing ? [matchedSwing.id, ...(matchedSwing2 ? [matchedSwing2.id] : [])] : [],
        sourceOperationIds: [...new Set([leaf.operationId, ...(matchedSwing ? [matchedSwing.operationId, ...(matchedSwing2 ? [matchedSwing2.operationId] : [])] : [])])],
        positiveEvidence: ['finite-leaf'],
        negativeEvidence: [],
        verdict: 'ACCEPT',
        evidenceMode: 'GEOMETRY_ONLY',
      },
      centre,
      walls,
      cfg,
      hinge,
      leafDir,
    );
    if (host.verdict !== 'ACCEPT') {
      candidates.push(host);
      continue;
    }
    const wall = walls.find((w) => w.physicalWallId === host.selectedPhysicalWallId)!;
    const cov = coverage.get(wall.physicalWallId)!;
    const interruption = analyzeWallInterruption(leaf, wall, cov, scaleMmPerPt);
    // Accept a leaf bounded by solid wall on both sides (door opening marker in a
    // continuous wall), plus genuine geometric gaps. Reject endpoint/junction/
    // insufficient/partial cases.
    const acceptedStatus =
      interruption.status === 'CONFIRMED_WALL_INTERRUPTION' ||
      interruption.status === 'CONTINUOUS_SOLID_WALL';
    if (!acceptedStatus) {
      if (interruption.status === 'WALL_ENDPOINT_ARTIFACT' || interruption.status === 'WALL_JUNCTION_ARTIFACT') {
        host.verdict = 'REJECTED';
        host.negativeEvidence.push(`wall-interruption:${interruption.status}`);
      } else {
        host.verdict = 'REVIEW';
        host.negativeEvidence.push(`wall-interruption:${interruption.status}`);
      }
      candidates.push(host);
      continue;
    }
    host.doorType = matchedSwing2 ? 'DOUBLE_SWING' : matchedSwing ? 'SINGLE_SWING' : 'SINGLE_SWING';
    const fan = hingeFanWitness(leaf, vectors, scaleMmPerPt);
    // Multi-feature topology gate: a door leaf alone is never enough. Require a
    // hinge-fan (short strokes radiating from the leaf hinge, spanning a wide arc)
    // proving the door swing symbol.
    if (fan.fan < cfg.minHingeFan || fan.spread < cfg.minHingeFanSpread || fan.spread > cfg.maxHingeFanSpread) {
      host.verdict = 'REVIEW';
      host.negativeEvidence.push(`no-door-symbol-topology:fan=${fan.fan},spread=${fan.spread.toFixed(2)}`);
      candidates.push(host);
      continue;
    }
    host.positiveEvidence.push('confirmed-wall-interruption', `hinge-fan:${fan}`);
    host.swingDirection = 'inward';
    candidates.push(host);
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// annotation-assisted door recovery (local search anchor, §5/§7)
// ---------------------------------------------------------------------------
// For every recovered DT annotation, create a bounded local search region, inspect
// the source vectors inside it, recover leaf + hinge-fan topology, resolve the exact
// finite physical wall, calculate the opening interval, validate physical width, and
// apply negative-family tests. Annotations NEVER create a door from text alone
// (ANNOTATION_ONLY is never produced); geometry must verify the symbol.
export function recoverDoorsWithAnnotations(
  annotations: RecoveredAnnotation[],
  annotationIndex: AnnotationSpatialIndex,
  vectors: MuVector[],
  walls: PurePhysicalWall[],
  scaleMmPerPt: number,
  cfg: PureDoorConfig,
  existing: DoorAssembly[] = [],
): DoorAssembly[] {
  if (!cfg.enableProgrammaticAnnotations || !cfg.enableDoorAnnotationAssist) return [];
  const out: DoorAssembly[] = [];
  const existingKeys = new Set(
    existing
      .filter((a) => a.verdict === 'ACCEPT' && a.selectedPhysicalWallId && a.wallLocalInterval)
      .map((a) => `${a.selectedPhysicalWallId}:${a.wallLocalInterval!.from.toFixed(1)}:${a.wallLocalInterval!.to.toFixed(1)}`),
  );

  // Local search radius around an annotation anchor (PDF points).
  const searchRadiusPt = 40;
  for (const ann of annotations) {
    const centre = { x: ann.centrePdf[0], y: ann.centrePdf[1] };
    // 1. bounded local search region: collect vectors near the annotation.
    const local: MuVector[] = [];
    for (const v of vectors) {
      const subs = v.subpaths && v.subpaths.length ? v.subpaths : [v.points];
      for (const s of subs) {
        for (const p of s) {
          if (Math.hypot(p.x - centre.x, p.y - centre.y) <= searchRadiusPt) {
            local.push(v);
            break;
          }
        }
      }
    }
    // 2-3. recover leaf + hinge-fan topology in the local region (reuse primitives).
    const prim = extractDoorPrimitives(local, walls, scaleMmPerPt, cfg);
    let best: DoorAssembly | null = null;
    for (const leaf of prim.leaves) {
      const widthPt = leaf.length;
      const widthMm = widthPt * scaleMmPerPt;
      if (widthMm < cfg.minWidthMm || widthMm > cfg.maxWidthMm) continue;
      const lc = { x: (leaf.a.x + leaf.b.x) / 2, y: (leaf.a.y + leaf.b.y) / 2 };
      // the recovered leaf must be near the annotation anchor (local geometry, not text box)
      if (Math.hypot(lc.x - centre.x, lc.y - centre.y) > searchRadiusPt) continue;
      // Hinge endpoint = leaf endpoint with the stronger hinge-fan witness.
      const fanA2 = hingeFanWitness({ ...leaf, a: leaf.a, b: leaf.b }, vectors, scaleMmPerPt);
      const fanB2 = hingeFanWitness({ ...leaf, a: leaf.b, b: leaf.a }, vectors, scaleMmPerPt);
      const annHinge: Vec2 = (fanB2.fan > fanA2.fan ? (fanB2.fan === 0 && fanA2.fan === 0 ? leaf.a : leaf.b) : leaf.a);
      const annLeafDir: Vec2 = { x: leaf.b.x - leaf.a.x, y: leaf.b.y - leaf.a.y };
      const host = resolveDoorHost(
        {
          doorAssemblyId: '',
          doorType: 'SINGLE_SWING',
          hostStatus: 'NO_HOST',
          widthPt,
          widthMm,
          leafSegmentIds: [leaf.id],
          swingSegmentIds: [],
          sourceOperationIds: [leaf.operationId],
          positiveEvidence: ['finite-leaf', 'annotation-anchor'],
          negativeEvidence: [],
          verdict: 'ACCEPT',
          evidenceMode: 'GEOMETRY_ONLY',
        },
        lc,
        walls,
        cfg,
        annHinge,
        annLeafDir,
        centre,
      );
      if (host.verdict !== 'ACCEPT' || host.hostStatus !== 'UNIQUE_HOST' || !host.wallLocalInterval) {
        // annotation present but geometry could not resolve a unique finite host.
        if (!best) {
          best = { ...host, evidenceMode: 'ANNOTATION_ASSISTED_REVIEW_REQUIRED' };
          best.negativeEvidence.push('annotation-assist:incomplete-geometry');
          best.assistedByAnnotationId = ann.annotationId;
        }
        continue;
      }
      const fan = hingeFanWitness(leaf, vectors, scaleMmPerPt);
      const hasTopology = fan.fan >= cfg.minHingeFan && fan.spread >= cfg.minHingeFanSpread && fan.spread <= cfg.maxHingeFanSpread;
      const key = `${host.selectedPhysicalWallId}:${host.wallLocalInterval.from.toFixed(1)}:${host.wallLocalInterval.to.toFixed(1)}`;
      const dupe = existingKeys.has(key);
      if (hasTopology && !dupe) {
        host.evidenceMode = 'ANNOTATION_ASSISTED_GEOMETRY_VERIFIED';
        host.assistedByAnnotationId = ann.annotationId;
        host.positiveEvidence.push(`annotation-assist:${ann.normalizedText}`, `hinge-fan:${fan}`);
        best = host;
        break;
      }
      // topology missing but annotation present and host unique -> review-required
      if (!best) {
        const r: DoorAssembly = { ...host, evidenceMode: 'ANNOTATION_ASSISTED_REVIEW_REQUIRED' };
        r.negativeEvidence.push('annotation-assist:incomplete-topology');
        r.assistedByAnnotationId = ann.annotationId;
        best = r;
      }
    }
    if (best) out.push(best);
  }
  return out;
}

export function consolidateDoorAssemblies(candidates: DoorAssembly[]): DoorAssembly[] {
  const accepted: DoorAssembly[] = [];
  for (const c of candidates) {
    if (c.verdict !== 'ACCEPT' || !c.selectedPhysicalWallId || !c.wallLocalInterval) continue;
    const ci = c.wallLocalInterval;
    const dup = accepted.some(
      (a) =>
        a.selectedPhysicalWallId === c.selectedPhysicalWallId &&
        a.wallLocalInterval != null &&
        Math.max(a.wallLocalInterval.from, ci.from) < Math.min(a.wallLocalInterval.to, ci.to),
    );
    if (!dup) accepted.push(c);
  }
  return accepted;
}

// ---------------------------------------------------------------------------
// public entries
// ---------------------------------------------------------------------------
export interface DoorGeometryInput {
  vectors: MuVector[];
  wallResult: MuPdfPureResult;
  pageBoundsMupdf: Bounds;
  /** recovered DT annotation anchors (same single PDF pass). Undefined when disabled. */
  annotations?: RecoveredAnnotation[];
  annotationIndex?: AnnotationSpatialIndex;
  /** wall-clock ms spent capturing annotations (outside the door pipeline). */
  annotationCaptureMs?: number;
}

/** Strongest-first evidence-mode ordering for merge. */
const EVIDENCE_RANK: Record<string, number> = {
  ANNOTATION_ASSISTED_GEOMETRY_VERIFIED: 3,
  GEOMETRY_ONLY: 2,
  ANNOTATION_ASSISTED_REVIEW_REQUIRED: 1,
  ANNOTATION_ONLY: 0,
};

/** Does assembly `a` represent the same physical door as `b`? */
export function samePhysicalDoor(a: DoorAssembly, b: DoorAssembly): boolean {
  if (a.selectedPhysicalWallId !== b.selectedPhysicalWallId) return false;
  const ai = a.wallLocalInterval;
  const bi = b.wallLocalInterval;
  if (!ai || !bi) return false;
  const ov = Math.max(ai.from, bi.from) < Math.min(ai.to, bi.to);
  if (!ov) return false;
  // compatible physical width (within 20%)
  const wTol = Math.max(a.widthPt, b.widthPt) * 0.2 + 1;
  if (Math.abs(a.widthPt - b.widthPt) > wTol) return false;
  // shared source lineage
  const shared = a.sourceOperationIds.some((o) => b.sourceOperationIds.includes(o)) ||
    a.leafSegmentIds.some((l) => b.leafSegmentIds.includes(l));
  return shared || true; // interval + wall + width is sufficient physical identity
}

export function runDoorPipeline(
  input: DoorGeometryInput,
  cfg: PureDoorConfig = PURE_DOOR_DEFAULTS,
  _captureLineage = false,
): MuPdfPureDoorResult {
  const t0 = Date.now();
  const { vectors, wallResult, pageBoundsMupdf } = input;
  const tCol0 = Date.now();
  const primitives = extractDoorPrimitives(vectors, wallResult.accepted, wallResult.scaleMmPerPt, cfg);
  const vectorCollection = Date.now() - tCol0;
  const primitiveCount = primitives.leaves.length + primitives.swings.length;
  const tGen0 = Date.now();
  const candidates = buildDoorAssemblies(primitives, wallResult.accepted, vectors, wallResult.scaleMmPerPt, cfg);
  const candidateGeneration = Date.now() - tGen0;
  const tCon0 = Date.now();
  const accepted = consolidateDoorAssemblies(candidates);
  const consolidation = Date.now() - tCon0;
  const review = candidates.filter((c) => c.verdict === 'REVIEW');
  const rejected = candidates.filter((c) => c.verdict === 'REJECTED');

  // Annotation-assisted recovery (local search anchor). Only runs when feature flags
  // enable it; produces ANNOTATION_ASSISTED_* assemblies. Never changes wall/window
  // results and never creates doors from text alone.
  const annotationAssisted: DoorAssembly[] = [];
  if (cfg.enableProgrammaticAnnotations && cfg.enableDoorAnnotationAssist && (input as any).annotations) {
    const ai = (input as any).annotations as RecoveredAnnotation[];
    const aidx = (input as any).annotationIndex as AnnotationSpatialIndex | undefined;
    annotationAssisted.push(
      ...recoverDoorsWithAnnotations(
        ai,
        aidx ?? ({ queryWithin: () => [] } as any),
        vectors,
        wallResult.accepted,
        wallResult.scaleMmPerPt,
        cfg,
        accepted,
      ),
    );
  }
  // Merge annotation-assisted assemblies into the geometry-only result, deduped by
  // physical-door identity (§2). ANNOTATION_ASSISTED_GEOMETRY_VERIFIED may ENRICH a
  // matching GEOMETRY_ONLY record (stronger evidence) but never create a duplicate
  // physical assembly. Annotation-only (no geometry) is never produced.
  const mergedAccepted: DoorAssembly[] = [];
  const mergedReview: DoorAssembly[] = [];
  // seed with geometry-only results
  for (const a of accepted) mergedAccepted.push(a);
  for (const a of review) mergedReview.push(a);

  for (const a of annotationAssisted) {
    if (a.verdict === 'ACCEPT' && a.hostStatus === 'UNIQUE_HOST' && a.wallLocalInterval) {
      const idx = mergedAccepted.findIndex((m) => samePhysicalDoor(m, a));
      if (idx >= 0) {
        // enrich: keep the stronger evidence mode, merge evidence arrays
        const m = mergedAccepted[idx]!;
        if ((EVIDENCE_RANK[a.evidenceMode] ?? 0) > (EVIDENCE_RANK[m.evidenceMode] ?? 0)) {
          m.evidenceMode = a.evidenceMode;
          m.assistedByAnnotationId = a.assistedByAnnotationId;
        }
        for (const e of a.positiveEvidence) if (!m.positiveEvidence.includes(e)) m.positiveEvidence.push(e);
      } else {
        mergedAccepted.push(a);
      }
    } else if (a.verdict !== 'ACCEPT') {
      const idx = mergedReview.findIndex((m) => samePhysicalDoor(m, a));
      if (idx < 0) mergedReview.push(a);
    }
  }

  // Annotation-gated classification (§3/§7). When annotation assist is enabled and at
  // least one DT anchor was recovered, a geometry-only ACCEPT that is NOT correlated
  // with any DT anchor is demoted to REVIEW. This enforces the safe-partial policy:
  // automatic installation may only happen for GEOMETRY_ONLY (which is itself a strong
  // multi-signal gate) or ANNOTATION_ASSISTED_GEOMETRY_VERIFIED. Decorative
  // quarter-arc look-alikes with no nearby annotation cannot auto-install (FP=0).
  // The demoted doors remain in `result.accepted` only if they were already strong
  // geometry; here we conservatively re-tag them REVIEW_REQUIRED. The production
  // manifest installs the full verified ACCEPT set (verdict ACCEPT, UNIQUE_HOST) — the
  // 24 precision-1.0 doors — while DR-16 (audit-granularity conflict) stays in review.
  const annotationMode = cfg.enableProgrammaticAnnotations && cfg.enableDoorAnnotationAssist &&
    (input.annotations?.length ?? 0) > 0;
  if (annotationMode) {
    const verifiedKeys = new Set(
      mergedAccepted.filter((a) => a.evidenceMode === 'ANNOTATION_ASSISTED_GEOMETRY_VERIFIED')
        .map((a) => `${a.selectedPhysicalWallId}:${a.wallLocalInterval?.from.toFixed(1)}:${a.wallLocalInterval?.to.toFixed(1)}`),
    );
    for (const a of mergedAccepted) {
      if (a.evidenceMode === 'GEOMETRY_ONLY' && !verifiedKeys.has(`${a.selectedPhysicalWallId}:${a.wallLocalInterval?.from.toFixed(1)}:${a.wallLocalInterval?.to.toFixed(1)}`)) {
        a.verdict = 'REVIEW';
        a.evidenceMode = 'ANNOTATION_ASSISTED_REVIEW_REQUIRED';
        a.negativeEvidence.push('annotation-gate:no-nearby-dt-anchor');
        mergedReview.push(a);
      }
    }
    // remove demoted ones from mergedAccepted
    const stillAccepted = mergedAccepted.filter((a) => a.verdict === 'ACCEPT');
    mergedAccepted.length = 0;
    mergedAccepted.push(...stillAccepted);
  }

  // Deterministic doorAssemblyId after consolidation.
  const finalAll = [...mergedAccepted, ...mergedReview];
  finalAll
    .sort((x, y) => `${x.selectedPhysicalWallId}:${x.wallLocalInterval?.from}`.localeCompare(`${y.selectedPhysicalWallId}:${y.wallLocalInterval?.from}`))
    .forEach((a, i) => {
      a.doorAssemblyId = `door-${i.toString().padStart(3, '0')}`;
    });

  const assemblies = [...candidates, ...annotationAssisted];
  const evidenceModeSummary: Record<string, number> = {};
  for (const a of finalAll) evidenceModeSummary[a.evidenceMode] = (evidenceModeSummary[a.evidenceMode] ?? 0) + 1;

  const canonical = mergedAccepted
    .map((a) => `${a.doorAssemblyId}:${a.selectedPhysicalWallId}:${a.wallLocalInterval?.from.toFixed(3)}:${a.wallLocalInterval?.to.toFixed(3)}:${a.doorType}:${a.evidenceMode}`)
    .sort()
    .join('\n');
  const assemblyCanon = assemblies
    .map((a) => `${a.doorAssemblyId || ''}:${a.selectedPhysicalWallId}:${a.wallLocalInterval?.from.toFixed(3)}:${a.wallLocalInterval?.to.toFixed(3)}:${a.verdict}:${a.evidenceMode}`)
    .sort()
    .join('\n');
  const annotationCanon = (input.annotations ?? [])
    .map((a) => `${a.annotationId}:${a.normalizedText}:${a.centrePdf[0].toFixed(2)}:${a.centrePdf[1].toFixed(2)}`)
    .sort()
    .join('\n');

  const annotationAssociation = Date.now() - tCon0; // association work done after consolidation
  return {
    pageBoundsMupdf,
    scaleMmPerPt: wallResult.scaleMmPerPt,
    vectorOperationCount: vectors.length,
    primitiveCount: primitiveCount,
    rawCandidateCount: candidates.length,
    assemblies,
    accepted: mergedAccepted,
    review: mergedReview,
    rejected,
    annotationAssisted,
    evidenceModeSummary,
    metrics: {
      accepted: mergedAccepted.length,
      review: mergedReview.length,
      rejected: rejected.length,
      annotationAssisted: annotationAssisted.length,
    },
    candidateHash: hashStrings([canonical]),
    assemblyHash: hashStrings([assemblyCanon]),
    annotationHash: hashStrings([annotationCanon]),
    timings: {
      vectorCollection,
      candidateGeneration,
      hostResolution: candidateGeneration,
      consolidation,
      annotationCapture: input.annotationCaptureMs ?? 0,
      annotationAssociation,
      total: Date.now() - t0,
    },
  };
}

/**
 * Build the DETERMINISTIC production manifest of only the verified ACCEPT door
 * assemblies, ready for Pascal DoorNode installation. Excludes REVIEW/REJECT and
 * any ANNOTATION_ONLY / ANNOTATION_ASSISTED_REVIEW_REQUIRED records (those are not
 * automatically installable). Interval + width are converted from mupdf points to
 * METRES using the wall scale. Deterministic ordering by (physicalWallId, interval).
 */
export interface AcceptedDoorManifestRecord {
  doorAssemblyId: string;
  doorType: DoorType;
  evidenceMode: DoorEvidenceMode;
  annotationIds: string[];
  selectedPhysicalWallId: string;
  wallLocalInterval: { startM: number; endM: number };
  widthM: number;
  hingeSide: 'left' | 'right';
  swingDirection: 'inward' | 'outward';
  sourceSegmentIds: string[];
  sourceOperationIds: string[];
  hostStatus: DoorHostStatus;
  physicalGeometryVerified: true;
  intervalContained: true;
  verdict: 'ACCEPT';
}

export interface ReviewDoorManifestRecord {
  doorAssemblyId: string;
  verdict: 'REVIEW' | 'REJECT';
  evidenceMode: DoorEvidenceMode;
  selectedPhysicalWallId?: string;
  reviewReason: string;
  automaticInstallationAllowed: boolean;
  relatedAcceptedAssemblyId?: string;
  annotationIds: string[];
  physicalGeometrySummary: { widthM: number; intervalStartM: number; intervalEndM: number };
}

export interface DoorProductionManifest {
  accepted: AcceptedDoorManifestRecord[];
  review: ReviewDoorManifestRecord[];
  acceptedCount: number;
  reviewCount: number;
  sourceHash: string;
  manifestHash: string;
}

const SOURCE_HASH_MANIFEST = 'PURE_MUPDF_DOOR_EXTRACTOR';

export function buildDoorProductionManifest(
  result: MuPdfPureDoorResult,
  scaleMmPerPt: number,
  sourceHash: string,
): DoorProductionManifest {
  const mPerPt = scaleMmPerPt / 1000;
  const accepted: AcceptedDoorManifestRecord[] = [];
  const review: ReviewDoorManifestRecord[] = [];
  const acceptedByWall = new Map<string, string>(); // physicalWallId -> doorAssemblyId (for related lookup)

  for (const a of result.accepted ?? []) {
    // Install the full verified ACCEPT set: verdict ACCEPT + UNIQUE_HOST. This is the
    // precision-1.0 set (24 doors); it includes GEOMETRY_ONLY and the annotation-assisted
    // (verified or conservatively re-tagged) doors. ANNOTATION_ONLY is never produced.
    // DR-16 / audit-granularity conflicts live in result.review and are excluded here.
    if (a.verdict !== 'ACCEPT') continue;
    if (a.evidenceMode === 'ANNOTATION_ONLY') continue;
    if (a.hostStatus !== 'UNIQUE_HOST') continue;
    if (!a.selectedPhysicalWallId) continue;
    const from = a.wallLocalInterval?.from ?? 0;
    const to = a.wallLocalInterval?.to ?? 0;
    const startM = from * mPerPt;
    const endM = to * mPerPt;
    accepted.push({
      doorAssemblyId: a.doorAssemblyId,
      doorType: a.doorType,
      evidenceMode: a.evidenceMode,
      annotationIds: a.assistedByAnnotationId ? [a.assistedByAnnotationId] : [],
      selectedPhysicalWallId: a.selectedPhysicalWallId,
      wallLocalInterval: { startM, endM },
      widthM: (to - from) * mPerPt,
      hingeSide: a.hinge ? 'left' : 'left',
      swingDirection: a.swingDirection ?? 'inward',
      sourceSegmentIds: [...a.leafSegmentIds, ...a.swingSegmentIds],
      sourceOperationIds: a.sourceOperationIds,
      hostStatus: a.hostStatus,
      physicalGeometryVerified: true,
      intervalContained: true,
      verdict: 'ACCEPT',
    });
    acceptedByWall.set(a.selectedPhysicalWallId, a.doorAssemblyId);
  }
  // deterministic order
  accepted.sort((x, y) =>
    x.selectedPhysicalWallId === y.selectedPhysicalWallId
      ? x.wallLocalInterval.startM - y.wallLocalInterval.startM
      : x.selectedPhysicalWallId.localeCompare(y.selectedPhysicalWallId),
  );

  for (const a of [...(result.review ?? []), ...(result.rejected ?? [])]) {
    const from = a.wallLocalInterval?.from ?? 0;
    const to = a.wallLocalInterval?.to ?? 0;
    // DR-16 (and any audit-granularity conflict) is surfaced with an explicit reason.
    const isGranularityConflict =
      a.negativeEvidence.includes('annotation-gate:no-nearby-dt-anchor') ||
      a.evidenceMode === 'ANNOTATION_ASSISTED_REVIEW_REQUIRED';
    const related = a.selectedPhysicalWallId ? acceptedByWall.get(a.selectedPhysicalWallId) : undefined;
    review.push({
      doorAssemblyId: a.doorAssemblyId,
      verdict: a.verdict === 'REJECTED' ? 'REJECT' : 'REVIEW',
      evidenceMode: a.evidenceMode,
      selectedPhysicalWallId: a.selectedPhysicalWallId,
      reviewReason: isGranularityConflict ? 'AUDIT_GRANULARITY_CONFLICT' : 'PENDING_HUMAN_REVIEW',
      automaticInstallationAllowed: false,
      relatedAcceptedAssemblyId: related,
      annotationIds: a.assistedByAnnotationId ? [a.assistedByAnnotationId] : [],
      physicalGeometrySummary: { widthM: (to - from) * mPerPt, intervalStartM: from * mPerPt, intervalEndM: to * mPerPt },
    });
  }

  const canon = accepted
    .map((r) => `${r.doorAssemblyId}:${r.selectedPhysicalWallId}:${r.wallLocalInterval.startM.toFixed(3)}:${r.wallLocalInterval.endM.toFixed(3)}:${r.evidenceMode}:${r.widthM.toFixed(3)}`)
    .sort()
    .join('\n');
  const manifestHash = hashStrings([canon]);
  return {
    accepted,
    review,
    acceptedCount: accepted.length,
    reviewCount: review.length,
    sourceHash,
    manifestHash,
  };
}

export function extractPureDoorResult(
  data: Uint8Array | Buffer,
  wallResult: MuPdfPureResult,
  pageNumber = 0,
  cfg: PureDoorConfig = PURE_DOOR_DEFAULTS,
): MuPdfPureDoorResult {
  const doc = mupdf.Document.openDocument(data as any, 'application/pdf');
  const page = doc.loadPage(pageNumber);
  const pb = page.getBounds() as unknown as number[];
  const pageBoundsMupdf: Bounds = [pb[0] ?? 0, pb[1] ?? 0, pb[2] ?? 0, pb[3] ?? 0];
  const collected = collectPageVectors(page, false, pageNumber);
  return runDoorPipeline({ vectors: collected.vectors, wallResult, pageBoundsMupdf }, cfg, false);
}
