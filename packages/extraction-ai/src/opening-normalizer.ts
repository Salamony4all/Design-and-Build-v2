// packages/extraction-ai/src/opening-normalizer.ts
// Broadened canonical opening alias resolver & 2-stage normalizer.
// Pure geometry & schema types, no Pascal/Viewer dependencies.

import type { Vec2, WindowContract, DoorContract, Provenance } from 'design-build-extraction-contracts';

export type CanonicalOpeningType = 'DOOR' | 'WINDOW' | 'AMBIGUOUS' | 'UNSUPPORTED' | 'INVALID';

export type OpeningOutcome =
  | 'ACCEPT_HOST'
  | 'REVIEW_HOST'
  | 'REJECT_NO_HOST'
  | 'REJECT_INVALID_GEOMETRY'
  | 'REJECT_UNSUPPORTED_TYPE';

export interface ParsedOpening {
  id?: string;
  type: string;
  pos: [number, number];
  width: number;
  height: number;
  elevation?: number;
}

export interface NormalizedWall {
  id: string;
  startM: Vec2;
  endM: Vec2;
  thicknessM: number;
}

export interface OpeningNormalizerInput {
  parsedOpenings: ParsedOpening[];
  normalizedWalls: NormalizedWall[];
  documentFrame?: unknown;
}

export interface OpeningTypeResolution {
  rawType: string;
  normalizedToken: string;
  canonicalType: CanonicalOpeningType;
  aliasRule: string;
  ambiguityReason?: string;
}

export interface HostCandidate {
  wallId: string;
  centreToFiniteSegmentDistanceM: number;
  projectedParameter: number;
  projectionInsideFiniteWall: boolean;
  intervalStartParameter: number;
  intervalEndParameter: number;
  intervalContained: boolean;
  wallThicknessM: number;
  score: number;
  clamped?: boolean;
  clampDistanceM?: number;
}

export interface OpeningDiagnostic {
  sourceId: string;
  category: CanonicalOpeningType;
  outcome: OpeningOutcome;
  reason?: string;
  candidates: HostCandidate[];
  hostWallId?: string;
  startM?: Vec2;
  endM?: Vec2;
  sillM?: number;
  headM?: number;
  normalizedType?: string;
  rawType?: string;
  AIPosition?: [number, number];
  normalizedPosition?: Vec2;
  hostScore?: number;
  hostDistanceM?: number;
  secondBestWallId?: string;
  secondBestScore?: number;
  ambiguityMargin?: number;
  clamped?: boolean;
  clampDistanceM?: number;
  reviewStatus?: 'ACCEPTED' | 'REVIEW_REQUIRED' | 'REJECTED';
}

export interface OpeningNormalizerResult {
  acceptedWindows: WindowContract[];
  acceptedDoors: DoorContract[];
  reviewOpenings: OpeningDiagnostic[];
  rejectedOpenings: OpeningDiagnostic[];
  diagnostics: OpeningDiagnostic[];
}

const EPS = 0.15; // metres

const EXACT_DOOR_ALIASES: ReadonlySet<string> = new Set([
  'door',
  'doorway',
  'doorway-front',
  'glass-door',
  'sliding-door',
  'double-door',
  'single-door',
  'door-bar',
  'door-with-bar',
  'pivot-door',
  'folding-door',
  'pocket-door',
  'french-door',
  'entry-door',
  'interior-door',
  'exterior-door',
]);

const EXACT_WINDOW_ALIASES: ReadonlySet<string> = new Set([
  'window',
  'window-simple',
  'window-double',
  'window-large',
  'window-small',
  'window-small-2',
  'window-square',
  'window-rectangle',
  'window-round',
  'window1-black-open-1731',
  'glazing',
  'fixed-glazing',
  'sliding-window',
  'casement-window',
  'bay-window',
  'ribbon-window',
  'storefront-window',
]);

export function resolveOpeningType(raw: string): OpeningTypeResolution {
  if (!raw || typeof raw !== 'string') {
    return {
      rawType: String(raw),
      normalizedToken: '',
      canonicalType: 'INVALID',
      aliasRule: 'EMPTY_OR_NON_STRING',
      ambiguityReason: 'Input was empty or not a string',
    };
  }

  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return {
      rawType: raw,
      normalizedToken: '',
      canonicalType: 'INVALID',
      aliasRule: 'EMPTY_STRING',
      ambiguityReason: 'Type string was empty after trim',
    };
  }

  let token = trimmed.replace(/[\s_]+/g, '-').replace(/-+/g, '-');
  if (!EXACT_WINDOW_ALIASES.has(token) && !EXACT_DOOR_ALIASES.has(token)) { token = token.replace(/-\d{1,4}$/, ''); }

  const hasDoorWord = token.includes('door');
  const hasWindowWord = token.includes('window');
  if (hasDoorWord && hasWindowWord) {
    return {
      rawType: raw,
      normalizedToken: token,
      canonicalType: 'AMBIGUOUS',
      aliasRule: 'CONFLICTING_DOOR_AND_WINDOW_EVIDENCE',
      ambiguityReason: 'Token contains both door and window keywords: ' + token,
    };
  }

  if (EXACT_DOOR_ALIASES.has(token)) {
    return {
      rawType: raw,
      normalizedToken: token,
      canonicalType: 'DOOR',
      aliasRule: 'EXACT_DOOR_ALIAS',
    };
  }

  if (EXACT_WINDOW_ALIASES.has(token)) {
    return {
      rawType: raw,
      normalizedToken: token,
      canonicalType: 'WINDOW',
      aliasRule: 'EXACT_WINDOW_ALIAS',
    };
  }

  if (token.startsWith('door-') || token.endsWith('-door') || token.startsWith('doorway-')) {
    return {
      rawType: raw,
      normalizedToken: token,
      canonicalType: 'DOOR',
      aliasRule: 'CONTROLLED_DOOR_FAMILY_PATTERN',
    };
  }

  if (token.startsWith('window-') || token.endsWith('-window') || token.startsWith('glazing-') || token.endsWith('-glazing')) {
    return {
      rawType: raw,
      normalizedToken: token,
      canonicalType: 'WINDOW',
      aliasRule: 'CONTROLLED_WINDOW_FAMILY_PATTERN',
    };
  }

  return {
    rawType: raw,
    normalizedToken: token,
    canonicalType: 'UNSUPPORTED',
    aliasRule: 'NO_CONTROLLED_ALIAS_MATCH',
    ambiguityReason: 'unsupported opening category: ' + token,
  };
}

function sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
function dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
function len(a: Vec2): number { return Math.hypot(a.x, a.y); }

function projectToSegment(p: Vec2, s: Vec2, e: Vec2): { t: number; dist: number; proj: Vec2 } {
  const d = sub(e, s);
  const L2 = dot(d, d);
  if (L2 <= 1e-9) {
    const dist = len(sub(p, s));
    return { t: 0, dist, proj: { ...s } };
  }
  let t = dot(sub(p, s), d) / L2;
  const clampedT = Math.max(0, Math.min(1, t));
  const proj = { x: s.x + clampedT * d.x, y: s.y + clampedT * d.y };
  return { t, dist: len(sub(p, proj)), proj };
}

function makeProvenance(category: CanonicalOpeningType, sourceId: string): Provenance {
  return {
    sourceKind: 'gemini',
    sourcePrimitiveIds: [sourceId],
    confidence: category === 'AMBIGUOUS' ? 0.4 : 0.8,
    extractionType: category === 'DOOR' ? 'door' : category === 'WINDOW' ? 'window' : 'opening-unknown',
  };
}

export function evaluateHostCandidates(
  op: ParsedOpening,
  centre: Vec2,
  walls: NormalizedWall[],
): { candidates: HostCandidate[]; eligible: HostCandidate[]; ambiguous: boolean } {
  const halfW = op.width / 2;
  const candidates: HostCandidate[] = [];
  const eligible: HostCandidate[] = [];

  for (const w of walls) {
    const L = len(sub(w.endM, w.startM));
    if (L <= 1e-9) continue;

    const { t, dist, proj } = projectToSegment(centre, w.startM, w.endM);
    const intervalHalf = halfW / L;
    const iStart = t - intervalHalf;
    const iEnd = t + intervalHalf;
    const projectionInsideFiniteWall = t >= -1e-6 && t <= 1 + 1e-6;
    const strictContained = iStart >= -1e-6 && iEnd <= 1 + 1e-6;
    const clamped = !strictContained && (t >= 0 && t <= 1);
    const clampDistanceM = clamped ? Math.max(0, -iStart, iEnd - 1) * L : 0;
    const intervalContained = strictContained || (clamped && clampDistanceM <= 0.60);
    const tol = Math.max(w.thicknessM / 2 + 0.35, 0.60);
    const score = dist;

    const candidate: HostCandidate = {
      wallId: w.id,
      clamped,
      clampDistanceM,
      centreToFiniteSegmentDistanceM: dist,
      projectedParameter: t,
      projectionInsideFiniteWall,
      intervalStartParameter: iStart,
      intervalEndParameter: iEnd,
      intervalContained,
      wallThicknessM: w.thicknessM,
      score,
    };

    candidates.push(candidate);
    if (projectionInsideFiniteWall && intervalContained && dist <= tol) {
      eligible.push(candidate);
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  eligible.sort((a, b) => a.score - b.score);

  let ambiguous = false;
  if (eligible.length >= 2) {
    const margin = Math.abs(eligible[0].score - eligible[1].score);
    if (margin < 0.05) {
      ambiguous = true;
    }
  }

  return { candidates, eligible, ambiguous };
}

export function normalizeOpenings(input: OpeningNormalizerInput): OpeningNormalizerResult {
  const { parsedOpenings, normalizedWalls } = input;
  const acceptedWindows: WindowContract[] = [];
  const acceptedDoors: DoorContract[] = [];
  const reviewOpenings: OpeningDiagnostic[] = [];
  const rejectedOpenings: OpeningDiagnostic[] = [];
  const diagnostics: OpeningDiagnostic[] = [];

  for (let idx = 0; idx < parsedOpenings.length; idx++) {
    const op = parsedOpenings[idx];
    const sourceId = op.id || ('opening_' + (idx + 1));
    const contractId = op.id ? ('open_' + op.id) : ('open_' + (idx + 1));

    const typeRes = resolveOpeningType(op.type);
    const category = typeRes.canonicalType;

    if (!Number.isFinite(op.pos?.[0]) || !Number.isFinite(op.pos?.[1]) || !Number.isFinite(op.width) || op.width <= 0 || !Number.isFinite(op.height) || op.height <= 0) {
      const diag: OpeningDiagnostic = {
        sourceId,
        category,
        outcome: 'REJECT_INVALID_GEOMETRY',
        reason: 'Opening position or dimensions are non-finite or non-positive',
        candidates: [],
        rawType: op.type,
        AIPosition: op.pos,
        reviewStatus: 'REJECTED',
      };
      rejectedOpenings.push(diag);
      diagnostics.push(diag);
      continue;
    }

    if (category === 'UNSUPPORTED' || category === 'INVALID') {
      const diag: OpeningDiagnostic = {
        sourceId,
        category,
        outcome: 'REJECT_UNSUPPORTED_TYPE',
        reason: typeRes.ambiguityReason ?? ('unsupported opening type: ' + op.type),
        candidates: [],
        rawType: op.type,
        normalizedType: typeRes.normalizedToken,
        AIPosition: op.pos,
        reviewStatus: 'REJECTED',
      };
      rejectedOpenings.push(diag);
      diagnostics.push(diag);
      continue;
    }

    const centre: Vec2 = { x: op.pos[0], y: op.pos[1] };

    if (category === 'AMBIGUOUS') {
      const diag: OpeningDiagnostic = {
        sourceId,
        category,
        outcome: 'REVIEW_HOST',
        reason: typeRes.ambiguityReason ?? 'Ambiguous opening type keywords',
        candidates: [],
        rawType: op.type,
        normalizedType: typeRes.normalizedToken,
        AIPosition: op.pos,
        normalizedPosition: centre,
        reviewStatus: 'REVIEW_REQUIRED',
      };
      reviewOpenings.push(diag);
      diagnostics.push(diag);
      continue;
    }

    const { candidates, eligible, ambiguous } = evaluateHostCandidates(op, centre, normalizedWalls);

    if (ambiguous) {
      const diag: OpeningDiagnostic = {
        sourceId,
        category,
        outcome: 'REVIEW_HOST',
        reason: 'Ambiguous parallel host candidates',
        candidates,
        rawType: op.type,
        normalizedType: typeRes.normalizedToken,
        AIPosition: op.pos,
        normalizedPosition: centre,
        secondBestWallId: eligible[1]?.wallId,
        secondBestScore: eligible[1]?.score,
        ambiguityMargin: Math.abs(eligible[0].score - (eligible[1]?.score ?? 0)),
        reviewStatus: 'REVIEW_REQUIRED',
      };
      reviewOpenings.push(diag);
      diagnostics.push(diag);
      continue;
    }

    const chosenHost = eligible[0];

    if (!chosenHost) {
      const bestCandidate = candidates[0];
      if (bestCandidate && bestCandidate.centreToFiniteSegmentDistanceM <= 1.20) {
        const diag: OpeningDiagnostic = {
          sourceId,
          category,
          outcome: 'REVIEW_HOST',
          reason: `Opening within search radius (${bestCandidate.centreToFiniteSegmentDistanceM.toFixed(2)}m) but exceeds primary snap tolerance (Review required)`,
          candidates,
          rawType: op.type,
          normalizedType: typeRes.normalizedToken,
          AIPosition: op.pos,
          normalizedPosition: centre,
          hostWallId: bestCandidate.wallId,
          hostDistanceM: bestCandidate.centreToFiniteSegmentDistanceM,
          hostScore: bestCandidate.score,
          reviewStatus: 'REVIEW_REQUIRED',
        };
        reviewOpenings.push(diag);
        diagnostics.push(diag);
        continue;
      }
      const diag: OpeningDiagnostic = {
        sourceId,
        category,
        outcome: 'REJECT_NO_HOST',
        reason: 'No eligible host wall found within tolerance',
        candidates,
        rawType: op.type,
        normalizedType: typeRes.normalizedToken,
        AIPosition: op.pos,
        normalizedPosition: centre,
        reviewStatus: 'REJECTED',
      };
      rejectedOpenings.push(diag);
      diagnostics.push(diag);
      continue;
    }

    const hostWall = normalizedWalls.find((w) => w.id === chosenHost.wallId);
    if (!hostWall) {
      const diag: OpeningDiagnostic = {
        sourceId,
        category,
        outcome: 'REJECT_NO_HOST',
        reason: 'Host wall not found',
        candidates,
        rawType: op.type,
        normalizedType: typeRes.normalizedToken,
        AIPosition: op.pos,
        reviewStatus: 'REJECTED',
      };
      rejectedOpenings.push(diag);
      diagnostics.push(diag);
      continue;
    }

    const wallVec = sub(hostWall.endM, hostWall.startM);
    const wallLen = len(wallVec);
    const halfWidth = op.width / 2;

    const projCenterX = hostWall.startM.x + chosenHost.projectedParameter * wallVec.x;
    const projCenterY = hostWall.startM.y + chosenHost.projectedParameter * wallVec.y;

    const unitVecX = wallVec.x / wallLen;
    const unitVecY = wallVec.y / wallLen;

    const startM: Vec2 = {
      x: projCenterX - halfWidth * unitVecX,
      y: projCenterY - halfWidth * unitVecY,
    };
    let endM: Vec2 = {
      x: projCenterX + halfWidth * unitVecX,
      y: projCenterY + halfWidth * unitVecY,
    };
    if (chosenHost.clamped) {
      const minX = Math.min(hostWall.startM.x, hostWall.endM.x);
      const maxX = Math.max(hostWall.startM.x, hostWall.endM.x);
      const minY = Math.min(hostWall.startM.y, hostWall.endM.y);
      const maxY = Math.max(hostWall.startM.y, hostWall.endM.y);
      startM.x = Math.max(minX, Math.min(maxX, startM.x));
      startM.y = Math.max(minY, Math.min(maxY, startM.y));
      endM.x = Math.max(minX, Math.min(maxX, endM.x));
      endM.y = Math.max(minY, Math.min(maxY, endM.y));
    }

    const sillM = Math.max(0, op.elevation ?? (category === 'WINDOW' ? 0.9 : 0));
    const headM = sillM + Math.max(0.2, op.height);

    const diag: OpeningDiagnostic = {
      sourceId,
      category,
      outcome: 'ACCEPT_HOST',
      candidates,
      hostWallId: hostWall.id,
      clamped: chosenHost.clamped,
      clampDistanceM: chosenHost.clampDistanceM,
      startM,
      endM,
      sillM,
      headM,
      rawType: op.type,
      normalizedType: typeRes.normalizedToken,
      AIPosition: op.pos,
      normalizedPosition: { x: projCenterX, y: projCenterY },
      hostScore: chosenHost.score,
      hostDistanceM: chosenHost.centreToFiniteSegmentDistanceM,
      reviewStatus: 'ACCEPTED',
    };

    diagnostics.push(diag);

    if (category === 'DOOR') {
      const door: DoorContract = {
        id: contractId,
        kind: 'door',
        wallId: hostWall.id,
        startM,
        endM,
        provenance: makeProvenance('DOOR', sourceId),
      };
      acceptedDoors.push(door);
    } else if (category === 'WINDOW') {
      const window: WindowContract = {
        id: contractId,
        kind: 'window',
        wallId: hostWall.id,
        startM,
        endM,
        sillM,
        headM,
        provenance: makeProvenance('WINDOW', sourceId),
      };
      acceptedWindows.push(window);
    }
  }

  return {
    acceptedWindows,
    acceptedDoors,
    reviewOpenings,
    rejectedOpenings,
    diagnostics,
  };
}
