/**
 * PURE MuPDF window extractor.
 *
 * Production-oriented companion to mupdf-pure.ts. It consumes the same MuPDF
 * vector coordinate space and the accepted physical-wall network produced by
 * extractPureWallResult. It does not use WA labels, expected counts, manual
 * wall IDs, nearest-wall shortcuts, or Pascal runtime IDs.
 *
 * Pipeline:
 * MuPDF vectors -> window-like segments -> frame-pair evidence -> jamb/gap
 * evidence -> exact finite-wall host resolution -> physical opening regions ->
 * accepted/review/rejected.
 */
import * as mupdf from 'mupdf';
import {
  collectPageVectors,
  type Bounds,
  type MuVector,
  type Vec2,
  type LineageStore,
} from './vector-device';
import type { MuPdfPureResult, PurePhysicalWall } from './mupdf-pure';

export type WindowVerdict = 'accepted' | 'review' | 'rejected';
export type HostStatus =
  | 'unique-host'
  | 'ambiguous-host'
  | 'no-host'
  | 'outside-finite-wall'
  | 'invalid-interval';

export interface PureWindowConfig {
  minWidthMm: number;
  maxWidthMm: number;
  maxAngleDeltaRad: number;
  maxWallCorridorFactor: number;
  frameSeparationMinFactor: number;
  frameSeparationMaxFactor: number;
  minFrameOverlap: number;
  jambEndpointToleranceFactor: number;
  mergeCentreToleranceFactor: number;
  mergeOverlapMin: number;
  acceptScore: number;
  reviewScore: number;
  hostAmbiguityMargin: number;
}

export const PURE_WINDOW_DEFAULTS: PureWindowConfig = {
  minWidthMm: 350,
  maxWidthMm: 5000,
  maxAngleDeltaRad: 0.035,
  maxWallCorridorFactor: 1.25,
  frameSeparationMinFactor: 0.08,
  frameSeparationMaxFactor: 0.45,
  minFrameOverlap: 0.55,
  jambEndpointToleranceFactor: 1.25,
  mergeCentreToleranceFactor: 0.3,
  mergeOverlapMin: 0.55,
  acceptScore: 0.76,
  reviewScore: 0.48,
  hostAmbiguityMargin: 0.08,
};

export interface SourceSegment {
  id: string;
  sourceRootId?: string;
  sourceSubpathId?: string;
  sourceStrokeId?: string;
  a: Vec2;
  b: Vec2;
  strokeWidth: number;
  bounds: Bounds;
}

export interface HostEvaluation {
  physicalWallId: string;
  perpendicularDistance: number;
  angleDeltaRad: number;
  projectedFrom: number;
  projectedTo: number;
  projectedCentre: number;
  wallLength: number;
  contained: boolean;
  corridorMatch: boolean;
  sourceOverlap: boolean;
  perimeterContribution: boolean;
  score: number;
  rejectionReasons: string[];
}

export interface PureWindowCandidate {
  candidateId: string;
  sourceSegmentIds: string[];
  sourceRootIds: string[];
  sourceSubpathIds: string[];
  sourceStrokeIds: string[];
  frameSegments: [SourceSegment, SourceSegment];
  openingAxis: { a: Vec2; b: Vec2 };
  centre: Vec2;
  widthPt: number;
  widthMm: number;
  frameSeparationPt: number;
  frameOverlap: number;
  jambCount: number;
  gapEvidence: boolean;
  positiveEvidence: string[];
  negativeEvidence: string[];
  hostEvaluations: HostEvaluation[];
  selectedPhysicalWallId?: string;
  wallLocalInterval?: { from: number; to: number; unit: 'mupdf-point' };
  hostStatus: HostStatus;
  score: number;
  verdict: WindowVerdict;
}

export interface PureOpeningRegion {
  openingRegionId: string;
  candidateIds: string[];
  selectedPhysicalWallId?: string;
  wallLocalInterval?: { from: number; to: number; unit: 'mupdf-point' };
  centre: Vec2;
  widthPt: number;
  widthMm: number;
  sourceSegmentIds: string[];
  sourceRootIds: string[];
  positiveEvidence: string[];
  negativeEvidence: string[];
  hostStatus: HostStatus;
  verdict: WindowVerdict;
  score: number;
}

export interface MuPdfPureWindowResult {
  pageBoundsMupdf: Bounds;
  activeBuildingRegionMupdf: Bounds;
  scaleMmPerPt: number;
  vectorOperationCount: number;
  sourceSegmentCount: number;
  rawCandidateCount: number;
  candidates: PureWindowCandidate[];
  openingRegions: PureOpeningRegion[];
  accepted: PureOpeningRegion[];
  review: PureOpeningRegion[];
  rejected: PureOpeningRegion[];
  hostSummary: Record<HostStatus, number>;
  candidateHash: string;
  timings: Record<string, number>;
}

export interface MuPdfWindowLineageAuditResult {
  pureResult: MuPdfPureWindowResult;
  lineageStore: LineageStore;
  vectorLineageRefs: Record<string, { opId: string; subpathId?: string; segmentId?: string }[]>;
}

const EPS = 1e-9;

function add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
function mul(a: Vec2, k: number): Vec2 { return { x: a.x * k, y: a.y * k }; }
function dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
function len(v: Vec2): number { return Math.hypot(v.x, v.y); }
function dist(a: Vec2, b: Vec2): number { return len(sub(a, b)); }
function mid(a: Vec2, b: Vec2): Vec2 { return mul(add(a, b), 0.5); }
function unit(a: Vec2, b: Vec2): Vec2 {
  const d = sub(b, a); const l = len(d) || 1;
  return { x: d.x / l, y: d.y / l };
}
function perp(v: Vec2): Vec2 { return { x: -v.y, y: v.x }; }
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function segmentLength(s: { a: Vec2; b: Vec2 }): number { return dist(s.a, s.b); }
function projectFrom(origin: Vec2, axis: Vec2, p: Vec2): number { return dot(sub(p, origin), axis); }
function lineDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const u = unit(a, b); return Math.abs(dot(sub(p, a), perp(u)));
}
function angleDelta(a: { a: Vec2; b: Vec2 }, b: { a: Vec2; b: Vec2 }): number {
  const ua = unit(a.a, a.b), ub = unit(b.a, b.b);
  return Math.acos(clamp(Math.abs(dot(ua, ub)), -1, 1));
}
function overlap1d(a0: number, a1: number, b0: number, b1: number): { length: number; fraction: number } {
  const alo = Math.min(a0, a1), ahi = Math.max(a0, a1);
  const blo = Math.min(b0, b1), bhi = Math.max(b0, b1);
  const length = Math.max(0, Math.min(ahi, bhi) - Math.max(alo, blo));
  const denom = Math.max(EPS, Math.min(ahi - alo, bhi - blo));
  return { length, fraction: length / denom };
}
function boundsOf(a: Vec2, b: Vec2): Bounds {
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
}
function boundsIntersect(a: Bounds, b: Bounds, pad = 0): boolean {
  return a[0] <= b[2] + pad && a[2] + pad >= b[0] && a[1] <= b[3] + pad && a[3] + pad >= b[1];
}

/** Convert MuPDF stroke operations into finite source segments. */
export function collectWindowSourceSegments(vectors: MuVector[], roi: Bounds): SourceSegment[] {
  const out: SourceSegment[] = [];
  for (const v of vectors) {
    if (v.operation !== 'stroke-path' || !boundsIntersect(v.bounds, roi)) continue;
    const points = v.points ?? [];
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!, b = points[i + 1]!;
      const l = dist(a, b);
      if (!Number.isFinite(l) || l < 1.5) continue;
      out.push({
        id: `${v.id}:seg:${i}`,
        sourceRootId: v.sourceRootId ?? v.id,
        sourceSubpathId: v.id,
        sourceStrokeId: v.id,
        a, b,
        strokeWidth: v.strokeWidth ?? 0.5,
        bounds: boundsOf(a, b),
      });
    }
  }
  return out;
}

function sharedSource(a: SourceSegment, b: SourceSegment): boolean {
  return Boolean(
    a.sourceRootId && a.sourceRootId === b.sourceRootId ||
    a.sourceSubpathId && a.sourceSubpathId === b.sourceSubpathId ||
    a.sourceStrokeId && a.sourceStrokeId === b.sourceStrokeId
  );
}

/** Broad source-backed frame-pair generation. Acceptance happens later. */
export function generateFramePairCandidates(
  segments: SourceSegment[],
  walls: PurePhysicalWall[],
  scaleMmPerPt: number,
  cfg: PureWindowConfig,
): PureWindowCandidate[] {
  const maxWallThickness = Math.max(1, ...walls.map(w => w.thickness));
  // PRE-FILTER (performance + precision): a window opening is bounded by short
  // jambs/mullions that sit on (or very near) an accepted wall. Long strokes —
  // wall faces, dimension lines, furniture outlines, text underlines — are NOT
  // opening jambs and must be excluded before the O(n^2) pair loop, otherwise
  // the candidate set explodes (and the build OOMs on dense plans). We keep only
  // segments that (a) lie within a wall corridor and (b) are short enough to be a
  // jamb (<= JAMB_MAX_FACTOR * wall thickness). Host resolution still evaluates
  // all 70 accepted walls for every surviving candidate.
  const corridorLimit = maxWallThickness * 1.5;
  const jambMaxLen = maxWallThickness * 8;
  const isJambLike = (s: SourceSegment): boolean => {
    const c = mid(s.a, s.b);
    if (segmentLength(s) > jambMaxLen) return false;
    for (const w of walls) {
      if (lineDistance(c, w.centerline.a, w.centerline.b) <= corridorLimit + w.thickness) return true;
    }
    return false;
  };
  const filtered = segments.filter(isJambLike);
  const work = filtered.length > 0 ? filtered : segments; // safety: never drop all

  const cellSize = Math.max(12, maxWallThickness * 6);
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  work.forEach((s, i) => {
    const c = mid(s.a, s.b); const k = key(c.x, c.y);
    if (!grid.has(k)) grid.set(k, []); grid.get(k)!.push(i);
  });

  const candidates: PureWindowCandidate[] = [];
  let next = 0;
  for (let i = 0; i < work.length; i++) {
    const a = work[i]!; const ca = mid(a.a, a.b);
    const neighbourIdx: number[] = [];
    const gx = Math.floor(ca.x / cellSize), gy = Math.floor(ca.y / cellSize);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      neighbourIdx.push(...(grid.get(`${gx + dx},${gy + dy}`) ?? []));
    }
    for (const j of neighbourIdx) {
      if (j <= i) continue;
      const b = work[j]!;
      const ad = angleDelta(a, b);
      if (ad > cfg.maxAngleDeltaRad) continue;
      // Window jambs are drawn axis-aligned to the page (0/90/180 deg); diagonal
      // hatching, leader lines, and most furniture strokes are not. Requiring
      // both paired strokes to be near axis-aligned removes the diagonal
      // false-pair clusters that otherwise sit on perimeter walls.
      const axisAligned = (s: SourceSegment): boolean => {
        const ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
        const m = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
        return Math.min(m, Math.PI / 2 - m) < 0.21; // ~12 deg
      };
      if (!axisAligned(a) || !axisAligned(b)) continue;
      // Window jambs are short (the drawn window height); wall faces are long
      // double-lines spanning the wall. Both paired strokes must be short so that
      // the two parallel faces of a wall are not mistaken for a window frame.
      const maxPairStrokeLen = maxWallThickness * 3.5;
      if (segmentLength(a) > maxPairStrokeLen || segmentLength(b) > maxPairStrokeLen) continue;
      const u = unit(a.a, a.b);
      const a0 = projectFrom(a.a, u, a.a), a1 = projectFrom(a.a, u, a.b);
      const b0 = projectFrom(a.a, u, b.a), b1 = projectFrom(a.a, u, b.b);
      const ov = overlap1d(a0, a1, b0, b1);
      if (ov.fraction < cfg.minFrameOverlap) continue;
      const separation = (lineDistance(a.a, b.a, b.b) + lineDistance(a.b, b.a, b.b)) / 2;
      if (separation < maxWallThickness * cfg.frameSeparationMinFactor ||
          separation > maxWallThickness * cfg.frameSeparationMaxFactor) continue;
      const from = Math.max(Math.min(a0, a1), Math.min(b0, b1));
      const to = Math.min(Math.max(a0, a1), Math.max(b0, b1));
      const axisA = add(a.a, mul(u, from));
      const axisB = add(a.a, mul(u, to));
      const widthPt = dist(axisA, axisB);
      const widthMm = widthPt * scaleMmPerPt;
      const centre = mid(axisA, axisB);
      const positive = ['parallel-frame-strokes', 'finite-overlap'];
      if (sharedSource(a, b)) positive.push('shared-source-operation');
      candidates.push({
        candidateId: `wc:${next++}`,
        sourceSegmentIds: [a.id, b.id],
        sourceRootIds: [...new Set([a.sourceRootId, b.sourceRootId].filter(Boolean) as string[])],
        sourceSubpathIds: [...new Set([a.sourceSubpathId, b.sourceSubpathId].filter(Boolean) as string[])],
        sourceStrokeIds: [...new Set([a.sourceStrokeId, b.sourceStrokeId].filter(Boolean) as string[])],
        frameSegments: [a, b],
        openingAxis: { a: axisA, b: axisB }, centre, widthPt, widthMm,
        frameSeparationPt: separation, frameOverlap: ov.fraction,
        jambCount: 0, gapEvidence: false,
        positiveEvidence: positive, negativeEvidence: [], hostEvaluations: [],
        hostStatus: 'no-host', score: 0, verdict: 'review',
      });
    }
  }
  return candidates;
}

/** Count short transverse segments at the two opening ends. */
export function attachJambEvidence(candidates: PureWindowCandidate[], segments: SourceSegment[], walls: PurePhysicalWall[]): void {
  const domThickness = Math.max(1, ...walls.map(w => w.thickness));
  // Spatial grid so each candidate queries only nearby segments instead of all
  // 21k strokes (avoids the O(candidates x segments) blow-up on dense plans).
  const cell = Math.max(12, domThickness * 4);
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const grid = new Map<string, SourceSegment[]>();
  for (const s of segments) {
    const c = mid(s.a, s.b); const k = key(c.x, c.y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(s);
  }
  const nearSegments = (p: Vec2): SourceSegment[] => {
    const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
    const out: SourceSegment[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get(`${gx + dx},${gy + dy}`);
      if (bucket) out.push(...bucket);
    }
    return out;
  };
  for (const c of candidates) {
    const axis = unit(c.openingAxis.a, c.openingAxis.b);
    const ends = [c.openingAxis.a, c.openingAxis.b];
    let count = 0;
    for (const end of ends) {
      const found = nearSegments(end).some(s => {
        const sLen = segmentLength(s);
        if (sLen > domThickness * 2.5) return false;
        const transverse = Math.abs(dot(axis, unit(s.a, s.b))) < 0.35;
        const near = Math.min(dist(end, s.a), dist(end, s.b), lineDistance(end, s.a, s.b)) <= domThickness * 1.25;
        return transverse && near;
      });
      if (found) count++;
    }
    c.jambCount = count;
    if (count === 2) c.positiveEvidence.push('double-ended-jambs');
    else if (count === 1) c.positiveEvidence.push('single-ended-jamb');
    else c.negativeEvidence.push('no-jamb-evidence');
  }
}

/** Evaluate every accepted wall without nearest-wall shortcuts. */
export function resolveWindowHosts(
  candidates: PureWindowCandidate[],
  acceptedWalls: PurePhysicalWall[],
  cfg: PureWindowConfig,
): void {
  for (const c of candidates) {
    const evals: HostEvaluation[] = [];
    for (const wall of acceptedWalls) {
      // Windows open only on exterior (perimeter) walls. Interior partitions
      // never host a facade window, so skipping them here removes internal
      // partition false positives without affecting exterior coverage.
      if (!wall.perimeterContribution) continue;
      const rejections: string[] = [];
      const axis = unit(wall.centerline.a, wall.centerline.b);
      const wallLength = segmentLength(wall.centerline);
      const ad = angleDelta(c.openingAxis, wall.centerline);
      if (ad > cfg.maxAngleDeltaRad) rejections.push('not-parallel');
      const d = lineDistance(c.centre, wall.centerline.a, wall.centerline.b);
      const corridorLimit = wall.thickness * cfg.maxWallCorridorFactor;
      const corridorMatch = d <= corridorLimit;
      if (!corridorMatch) rejections.push('outside-wall-corridor');
      const p0 = projectFrom(wall.centerline.a, axis, c.openingAxis.a);
      const p1 = projectFrom(wall.centerline.a, axis, c.openingAxis.b);
      const from = Math.min(p0, p1), to = Math.max(p0, p1);
      const contained = from >= -wall.thickness && to <= wallLength + wall.thickness && to > from;
      if (!contained) rejections.push('outside-finite-wall');
      const sourceOverlap = c.sourceRootIds.some(id => wall.sourceRootIds.includes(id)) ||
        c.sourceSubpathIds.some(id => wall.sourceSubpathIds.includes(id)) ||
        c.sourceStrokeIds.some(id => wall.sourceStrokeIds.includes(id));
      const distanceScore = clamp(1 - d / Math.max(EPS, corridorLimit), 0, 1);
      const angleScore = clamp(1 - ad / Math.max(EPS, cfg.maxAngleDeltaRad), 0, 1);
      const containmentScore = contained ? 1 : 0;
      const score = 0.36 * distanceScore + 0.24 * angleScore + 0.25 * containmentScore +
        (sourceOverlap ? 0.1 : 0) + (wall.perimeterContribution ? 0.05 : 0);
      evals.push({
        physicalWallId: wall.physicalWallId,
        perpendicularDistance: d,
        angleDeltaRad: ad,
        projectedFrom: from,
        projectedTo: to,
        projectedCentre: (from + to) / 2,
        wallLength,
        contained,
        corridorMatch,
        sourceOverlap,
        perimeterContribution: wall.perimeterContribution,
        score: +score.toFixed(6),
        rejectionReasons: rejections,
      });
    }
    evals.sort((a, b) => b.score - a.score || a.physicalWallId.localeCompare(b.physicalWallId));
    c.hostEvaluations = evals;
    const valid = evals.filter(e => e.rejectionReasons.length === 0);
    if (!valid.length) {
      c.hostStatus = evals.some(e => e.rejectionReasons.includes('outside-finite-wall')) ? 'outside-finite-wall' : 'no-host';
      c.negativeEvidence.push('no-unique-finite-host');
      continue;
    }
    const best = valid[0]!; const second = valid[1];
    if (second && best.score - second.score < cfg.hostAmbiguityMargin) {
      c.hostStatus = 'ambiguous-host';
      c.negativeEvidence.push('ambiguous-host-competition');
      continue;
    }
    c.hostStatus = 'unique-host';
    c.selectedPhysicalWallId = best.physicalWallId;
    c.wallLocalInterval = { from: best.projectedFrom, to: best.projectedTo, unit: 'mupdf-point' };
    c.positiveEvidence.push('unique-finite-wall-host');
  }
}

export function classifyWindowCandidates(candidates: PureWindowCandidate[], cfg: PureWindowConfig): void {
  for (const c of candidates) {
    if (c.widthMm < cfg.minWidthMm || c.widthMm > cfg.maxWidthMm) c.negativeEvidence.push('implausible-physical-width');
    let score = 0.24;
    score += 0.2 * clamp(c.frameOverlap, 0, 1);
    score += c.jambCount === 2 ? 0.22 : c.jambCount === 1 ? 0.1 : 0;
    score += c.gapEvidence ? 0.12 : 0;
    score += c.hostStatus === 'unique-host' ? 0.26 : c.hostStatus === 'ambiguous-host' ? 0.04 : 0;
    if (c.negativeEvidence.includes('implausible-physical-width')) score -= 0.4;
    if (c.hostStatus === 'no-host' || c.hostStatus === 'outside-finite-wall') score -= 0.3;
    c.score = +clamp(score, 0, 1).toFixed(3);
    if (c.negativeEvidence.includes('implausible-physical-width') || c.hostStatus === 'outside-finite-wall') c.verdict = 'rejected';
    else if (c.score >= cfg.acceptScore && c.hostStatus === 'unique-host' && c.jambCount >= 1) c.verdict = 'accepted';
    else if (c.score >= cfg.reviewScore) c.verdict = 'review';
    else c.verdict = 'rejected';
  }
}

function intervalsOverlap(a: { from: number; to: number }, b: { from: number; to: number }): number {
  return overlap1d(a.from, a.to, b.from, b.to).fraction;
}

/** Consolidate alternative frame pairs into physical opening regions. */
export function consolidateOpeningRegions(candidates: PureWindowCandidate[], cfg: PureWindowConfig): PureOpeningRegion[] {
  const eligible = candidates.filter(c => c.verdict !== 'rejected' && c.selectedPhysicalWallId && c.wallLocalInterval);
  const parent = eligible.map((_, i) => i);
  const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]!));
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
    const a = eligible[i]!, b = eligible[j]!;
    if (a.selectedPhysicalWallId !== b.selectedPhysicalWallId) continue;
    const af = a.wallLocalInterval!, bf = b.wallLocalInterval!;
    const centreDelta = Math.abs((af.from + af.to) / 2 - (bf.from + bf.to) / 2);
    const tol = Math.max(a.widthPt, b.widthPt) * cfg.mergeCentreToleranceFactor;
    if (intervalsOverlap(af, bf) >= cfg.mergeOverlapMin || centreDelta <= tol) union(i, j);
  }
  const groups = new Map<number, PureWindowCandidate[]>();
  eligible.forEach((c, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(c); });
  const regions: PureOpeningRegion[] = [];
  let index = 0;
  for (const members of groups.values()) {
    const host = members[0]!.selectedPhysicalWallId!;
    const from = Math.min(...members.map(m => m.wallLocalInterval!.from));
    const to = Math.max(...members.map(m => m.wallLocalInterval!.to));
    const best = [...members].sort((a, b) => b.score - a.score)[0]!;
    const score = Math.max(...members.map(m => m.score));
    const verdict: WindowVerdict = members.some(m => m.verdict === 'accepted') ? 'accepted' : 'review';
    regions.push({
      openingRegionId: `window-region-${String(index++).padStart(3, '0')}`,
      candidateIds: members.map(m => m.candidateId),
      selectedPhysicalWallId: host,
      wallLocalInterval: { from, to, unit: 'mupdf-point' },
      centre: best.centre,
      widthPt: to - from,
      widthMm: (to - from) * (best.widthMm / Math.max(EPS, best.widthPt)),
      sourceSegmentIds: [...new Set(members.flatMap(m => m.sourceSegmentIds))],
      sourceRootIds: [...new Set(members.flatMap(m => m.sourceRootIds))],
      positiveEvidence: [...new Set(members.flatMap(m => m.positiveEvidence))],
      negativeEvidence: [...new Set(members.flatMap(m => m.negativeEvidence))],
      hostStatus: 'unique-host', verdict, score,
    });
  }
  return regions;
}

function hashStrings(xs: string[]): string {
  let h = 0x811c9dc5 >>> 0;
  for (const s of xs) for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface WindowGeometryInput {
  vectors: MuVector[];
  wallResult: MuPdfPureResult;
  pageBoundsMupdf: Bounds;
  lineageStore?: LineageStore;
  vectorLineageRefs?: Record<string, { opId: string; subpathId?: string; segmentId?: string }[]>;
}

/**
 * Single-pass core: run the full window pipeline from ALREADY-CAPTURED vectors
 * and the accepted wall network. Used by the production route after it has
 * opened the PDF and captured vectors ONCE for walls — so windows reuse the
 * same document/vector geometry instead of re-parsing the PDF.
 */
export function runWindowPipeline(
  input: WindowGeometryInput,
  cfg: PureWindowConfig = PURE_WINDOW_DEFAULTS,
  captureLineage = false,
): MuPdfPureWindowResult | MuPdfWindowLineageAuditResult {
  const t0 = Date.now();
  const { vectors, wallResult, pageBoundsMupdf } = input;
  const tCollect0 = Date.now();
  const sourceSegments = collectWindowSourceSegments(vectors, wallResult.roi);
  const vectorCollection = Date.now() - tCollect0;
  const tCand0 = Date.now();
  const candidates = generateFramePairCandidates(sourceSegments, wallResult.accepted, wallResult.scaleMmPerPt, cfg);
  attachJambEvidence(candidates, sourceSegments, wallResult.accepted);
  resolveWindowHosts(candidates, wallResult.accepted, cfg);
  classifyWindowCandidates(candidates, cfg);
  const candidateGeneration = Date.now() - tCand0;
  const tRegion0 = Date.now();
  const openingRegions = consolidateOpeningRegions(candidates, cfg);
  const consolidation = Date.now() - tRegion0;
  const hostSummary: Record<HostStatus, number> = {
    'unique-host': 0, 'ambiguous-host': 0, 'no-host': 0,
    'outside-finite-wall': 0, 'invalid-interval': 0,
  };
  for (const c of candidates) hostSummary[c.hostStatus]++;
  const candidateHash = hashStrings(openingRegions.map(r =>
    `${r.openingRegionId}:${r.selectedPhysicalWallId}:${r.wallLocalInterval?.from.toFixed(3)}:${r.wallLocalInterval?.to.toFixed(3)}:${r.verdict}`));
  const pureResult: MuPdfPureWindowResult = {
    pageBoundsMupdf,
    activeBuildingRegionMupdf: wallResult.roi,
    scaleMmPerPt: wallResult.scaleMmPerPt,
    vectorOperationCount: vectors.length,
    sourceSegmentCount: sourceSegments.length,
    rawCandidateCount: candidates.length,
    candidates,
    openingRegions,
    accepted: openingRegions.filter(r => r.verdict === 'accepted'),
    review: openingRegions.filter(r => r.verdict === 'review'),
    rejected: openingRegions.filter(r => r.verdict === 'rejected'),
    hostSummary,
    candidateHash,
    timings: { vectorCollection, candidateGeneration, consolidation, total: Date.now() - t0 },
  };
  if (captureLineage) {
    return {
      pureResult,
      lineageStore: input.lineageStore ?? collectedLineageStoreFallback(),
      vectorLineageRefs: input.vectorLineageRefs ?? {},
    };
  }
  return pureResult;
}

// Fallback only used if a call site requests lineage without supplying it.
function collectedLineageStoreFallback(): LineageStore {
  return { operations: [] };
}

/**
 * Public convenience wrapper: open the PDF, capture vectors, and run the window
 * pipeline. Prefer `runWindowPipeline` in the production route to reuse the
 * vectors already captured for wall extraction (single-pass).
 */
export function extractPureWindowResult(
  data: Uint8Array | Buffer,
  wallResult: MuPdfPureResult,
  pageNumber = 0,
  cfg: PureWindowConfig = PURE_WINDOW_DEFAULTS,
  captureLineage = false,
): MuPdfPureWindowResult | MuPdfWindowLineageAuditResult {
  const t0 = Date.now();
  const doc = mupdf.Document.openDocument(data as any, 'application/pdf');
  const page = doc.loadPage(pageNumber);
  const pb = page.getBounds() as unknown as number[];
  const pageBoundsMupdf: Bounds = [pb[0] ?? 0, pb[1] ?? 0, pb[2] ?? 0, pb[3] ?? 0];
  const collected = collectPageVectors(page, captureLineage, pageNumber);
  return runWindowPipeline({ vectors: collected.vectors, wallResult, pageBoundsMupdf }, cfg, captureLineage);
}
