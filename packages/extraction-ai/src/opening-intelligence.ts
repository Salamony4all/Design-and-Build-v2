// design-build-extraction-ai
// CAP-04 & CAP-05: AI Opening Intelligence V2
//   - AI_OPENING_ALIASES_V2 (Controlled Opening Aliases)
//   - AI_OPENING_HOSTING_V2 (Adaptive Multi-Factor Wall-Host Scoring)
//   - AI_OPENING_GAP_EVIDENCE_V2 (Wall Gap & Symbol Evidence)
//
// Boundary rules:
//   - Search radius capped at 1.20m.
//   - Multi-factor scoring (distance, orientation, finite wall interval, gap evidence).
//   - Close ties (<0.15 score diff) or low confidence (<0.60) routed to Review.
//   - Pure, deterministic calculations; zero provider calls.

import type { Provenance } from 'design-build-extraction-contracts';

export const AI_OPENING_ALIASES_V2 = false;
export const AI_OPENING_HOSTING_V2 = false;
export const AI_OPENING_GAP_EVIDENCE_V2 = false;

export type DoorSubtype =
  | 'single-swing'
  | 'double-swing'
  | 'pocket-door'
  | 'sliding-door'
  | 'bifold-door'
  | 'revolving-door'
  | 'overhead-door'
  | 'cased-opening'
  | 'generic-door';

export type WindowSubtype =
  | 'casement-window'
  | 'sliding-window'
  | 'hung-window'
  | 'fixed-glazing'
  | 'storefront-glazing'
  | 'curtain-wall'
  | 'skylight'
  | 'generic-window';

const DOOR_ALIAS_MAP: Record<string, DoorSubtype> = {
  single: 'single-swing',
  'single swing': 'single-swing',
  'single-swing': 'single-swing',
  'single door': 'single-swing',
  swing: 'single-swing',
  double: 'double-swing',
  'double swing': 'double-swing',
  'double-swing': 'double-swing',
  'double door': 'double-swing',
  pocket: 'pocket-door',
  'pocket door': 'pocket-door',
  sliding: 'sliding-door',
  'sliding door': 'sliding-door',
  slider: 'sliding-door',
  bifold: 'bifold-door',
  'bi-fold': 'bifold-door',
  'folding door': 'bifold-door',
  revolving: 'revolving-door',
  overhead: 'overhead-door',
  garage: 'overhead-door',
  'cased opening': 'cased-opening',
  opening: 'cased-opening',
  door: 'generic-door',
};

const WINDOW_ALIAS_MAP: Record<string, WindowSubtype> = {
  casement: 'casement-window',
  'casement window': 'casement-window',
  sliding: 'sliding-window',
  'sliding window': 'sliding-window',
  slider: 'sliding-window',
  hung: 'hung-window',
  'single hung': 'hung-window',
  'double hung': 'hung-window',
  fixed: 'fixed-glazing',
  'fixed window': 'fixed-glazing',
  glazing: 'fixed-glazing',
  storefront: 'storefront-glazing',
  'curtain wall': 'curtain-wall',
  curtainwall: 'curtain-wall',
  skylight: 'skylight',
  window: 'generic-window',
};

/**
 * Resolves a raw AI opening label to a canonical opening subtype.
 */
export function resolveOpeningSubtype(
  rawLabel: string,
  kind: 'door' | 'window'
): { canonicalType: DoorSubtype | WindowSubtype; confidence: number; isKnownAlias: boolean } {
  const norm = (rawLabel || '').trim().toLowerCase();
  if (kind === 'door') {
    const matched = DOOR_ALIAS_MAP[norm];
    if (matched) {
      return { canonicalType: matched, confidence: 0.95, isKnownAlias: true };
    }
    // Partial substring fallback
    for (const [k, v] of Object.entries(DOOR_ALIAS_MAP)) {
      if (norm.includes(k)) {
        return { canonicalType: v, confidence: 0.85, isKnownAlias: true };
      }
    }
    return { canonicalType: 'generic-door', confidence: 0.5, isKnownAlias: false };
  } else {
    const matched = WINDOW_ALIAS_MAP[norm];
    if (matched) {
      return { canonicalType: matched, confidence: 0.95, isKnownAlias: true };
    }
    for (const [k, v] of Object.entries(WINDOW_ALIAS_MAP)) {
      if (norm.includes(k)) {
        return { canonicalType: v, confidence: 0.85, isKnownAlias: true };
      }
    }
    return { canonicalType: 'generic-window', confidence: 0.5, isKnownAlias: false };
  }
}

export interface WallCandidate {
  id: string;
  start: [number, number];
  end: [number, number];
  thickness?: number;
}

export interface GapEvidence {
  center: [number, number];
  widthM: number;
}

export interface HostScoringInput {
  openingId: string;
  kind: 'door' | 'window';
  position: [number, number];
  widthM?: number;
  rotationRad?: number;
  candidateWalls: WallCandidate[];
  knownGaps?: GapEvidence[];
  options?: {
    maxSearchRadiusM?: number; // default: 1.20m
    minConfidenceThreshold?: number; // default: 0.60
    ambiguityDeltaThreshold?: number; // default: 0.15
  };
}

export interface HostScoringResult {
  openingId: string;
  status: 'HOSTED' | 'AMBIGUOUS' | 'ORPHAN';
  bestWallId?: string;
  score: number;
  projectedPosition?: [number, number];
  offsetAlongWallM?: number;
  reasons: string[];
  reviewRecord?: {
    id: string;
    reviewCode: 'AMBIGUOUS_WALL_HOST' | 'EXCESSIVE_HOSTING_DISTANCE' | 'INTERVAL_CLAMPED';
    openingId: string;
    candidateScores: Array<{ wallId: string; score: number }>;
    description: string;
  };
}

function distSq(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

/**
 * Projects a point onto a line segment and returns distance, parameter t, and projected point.
 */
function projectPointToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { distM: number; t: number; projX: number; projY: number; lenM: number } {
  const lenSq = distSq(x1, y1, x2, y2);
  const lenM = Math.sqrt(lenSq);
  if (lenSq === 0) {
    return { distM: Math.hypot(px - x1, py - y1), t: 0, projX: x1, projY: y1, lenM: 0 };
  }

  const rawT = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / lenSq;
  const t = Math.max(0, Math.min(1, rawT));
  const projX = x1 + t * (x2 - x1);
  const projY = y1 + t * (y2 - y1);
  const distM = Math.hypot(px - projX, py - projY);

  return { distM, t, projX, projY, lenM };
}

/**
 * Evaluates adaptive multi-factor wall-hosting for an opening candidate.
 */
export function scoreAdaptiveWallHost(input: HostScoringInput): HostScoringResult {
  const maxSearchRadius = input.options?.maxSearchRadiusM ?? 1.2;
  const minConfidence = input.options?.minConfidenceThreshold ?? 0.6;
  const ambiguityDelta = input.options?.ambiguityDeltaThreshold ?? 0.15;

  const [ox, oy] = input.position;
  const scoredCandidates: Array<{
    wall: WallCandidate;
    score: number;
    distM: number;
    t: number;
    projX: number;
    projY: number;
    lenM: number;
    hasGapEvidence: boolean;
  }> = [];

  for (const wall of input.candidateWalls) {
    const { distM, t, projX, projY, lenM } = projectPointToSegment(
      ox,
      oy,
      wall.start[0],
      wall.start[1],
      wall.end[0],
      wall.end[1]
    );

    if (distM > maxSearchRadius) continue;

    // 1. Distance Score: 1.0 at 0m down to 0.0 at maxSearchRadius
    const distScore = Math.max(0, 1 - distM / maxSearchRadius);

    // 2. Interval Containment Score: higher if well within wall segment [0.05, 0.95]
    const intervalScore = t >= 0.05 && t <= 0.95 ? 1.0 : t >= 0 && t <= 1 ? 0.8 : 0.4;

    // 3. Orientation Score (if opening rotation provided)
    let orientationScore = 1.0;
    if (input.rotationRad !== undefined && lenM > 0) {
      const wallAngle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
      let diff = Math.abs(input.rotationRad - wallAngle) % Math.PI;
      if (diff > Math.PI / 2) diff = Math.PI - diff;
      // Parallel (diff ~ 0) or perpendicular (diff ~ PI/2 for swing arc)
      const isParallel = diff < 0.26; // ~15 deg
      const isPerp = Math.abs(diff - Math.PI / 2) < 0.26;
      orientationScore = isParallel || isPerp ? 1.0 : 0.7;
    }

    // 4. Gap Evidence Score
    let hasGapEvidence = false;
    if (input.knownGaps && input.knownGaps.length > 0) {
      for (const gap of input.knownGaps) {
        if (Math.hypot(gap.center[0] - projX, gap.center[1] - projY) <= (gap.widthM / 2 + 0.2)) {
          hasGapEvidence = true;
          break;
        }
      }
    }
    const gapScore = hasGapEvidence ? 1.0 : 0.75;

    // Weighted composite score
    const totalScore = distScore * 0.45 + intervalScore * 0.25 + orientationScore * 0.15 + gapScore * 0.15;

    scoredCandidates.push({
      wall,
      score: totalScore,
      distM,
      t,
      projX,
      projY,
      lenM,
      hasGapEvidence,
    });
  }

  // Sort descending by score
  scoredCandidates.sort((a, b) => b.score - a.score);

  if (scoredCandidates.length === 0) {
    return {
      openingId: input.openingId,
      status: 'ORPHAN',
      score: 0,
      reasons: ['No wall candidates found within search radius 1.20m.'],
      reviewRecord: {
        id: `rev_orphan_${input.openingId}`,
        reviewCode: 'EXCESSIVE_HOSTING_DISTANCE',
        openingId: input.openingId,
        candidateScores: [],
        description: `Opening "${input.openingId}" has no wall within 1.20m search radius.`,
      },
    };
  }

  const best = scoredCandidates[0];

  // Check ambiguity against second best
  if (scoredCandidates.length > 1) {
    const second = scoredCandidates[1];
    const scoreDiff = best.score - second.score;
    if (scoreDiff < ambiguityDelta && best.score < 0.85) {
      return {
        openingId: input.openingId,
        status: 'AMBIGUOUS',
        bestWallId: best.wall.id,
        score: best.score,
        projectedPosition: [best.projX, best.projY],
        offsetAlongWallM: best.t * best.lenM,
        reasons: [
          `Ambiguous host candidates: "${best.wall.id}" (score ${best.score.toFixed(2)}) vs "${second.wall.id}" (score ${second.wall.id})`,
        ],
        reviewRecord: {
          id: `rev_ambig_${input.openingId}`,
          reviewCode: 'AMBIGUOUS_WALL_HOST',
          openingId: input.openingId,
          candidateScores: scoredCandidates.slice(0, 3).map((c) => ({ wallId: c.wall.id, score: c.score })),
          description: `Opening "${input.openingId}" has ambiguous wall hosts (delta ${scoreDiff.toFixed(2)} < ${ambiguityDelta}).`,
        },
      };
    }
  }

  if (best.score < minConfidence) {
    return {
      openingId: input.openingId,
      status: 'AMBIGUOUS',
      bestWallId: best.wall.id,
      score: best.score,
      projectedPosition: [best.projX, best.projY],
      offsetAlongWallM: best.t * best.lenM,
      reasons: [`Best host score (${best.score.toFixed(2)}) below minimum threshold (${minConfidence}).`],
      reviewRecord: {
        id: `rev_lowconf_${input.openingId}`,
        reviewCode: 'AMBIGUOUS_WALL_HOST',
        openingId: input.openingId,
        candidateScores: [{ wallId: best.wall.id, score: best.score }],
        description: `Best host confidence for "${input.openingId}" below threshold.`,
      },
    };
  }

  return {
    openingId: input.openingId,
    status: 'HOSTED',
    bestWallId: best.wall.id,
    score: best.score,
    projectedPosition: [best.projX, best.projY],
    offsetAlongWallM: best.t * best.lenM,
    reasons: [`Clean host match on wall "${best.wall.id}" with score ${best.score.toFixed(2)}.`],
  };
}
