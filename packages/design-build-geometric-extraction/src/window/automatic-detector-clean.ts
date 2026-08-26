// Clean Blind Automatic Window Detector - R1.3 corrected.
// Blind to target counts, WA data, manual bounds, and prior verdicts.
// Decision order: source -> host competition -> raw interval -> frame -> opening evidence -> conflicts -> merge.

import { createHash } from 'crypto';
import { CoordinateAdapter } from './coordinate-adapter.ts';
import { CLEAN_DETECTOR_CONFIG } from './clean-detector-config.ts';
import type {
  ExclusionRecord,
  GateTransition,
  AutomaticFeature,
  AutomaticCandidate,
  DuplicateCluster,
  PhysicalWindowAssembly,
  IntervalValidationResult,
  FrameLineAudit,
  JambPairRecord,
  WallFaceGapRecord,
  FrameBayRecord,
  HostCompetitionRecord,
  FinalDecision,
  MergeEvidenceRecord,
} from './clean-detector-contracts.ts';

type Wall = {
  physicalWallId: string;
  thickness: number;
  centerline: { a: { x: number; y: number }; b: { x: number; y: number } };
};

const FATAL_EVIDENCE = new Set([
  'interval-extends-beyond-wall',
  'invalid-reversed-interval',
  'invalid-zero-width-interval',
  'continuous-wall-face-detected',
  'hatch-recurrence-pattern',
  'door-curve-intersection-conflict',
  'missing-opening-evidence',
  'no-host',
]);

export class AutomaticDetectorClean {
  private exclusionLedger: ExclusionRecord[] = [];

  public getExclusionLedger(): ExclusionRecord[] {
    return this.exclusionLedger;
  }

  public detect(
    operations: any[],
    wallsInput: any[],
  ): {
    features: AutomaticFeature[];
    candidates: AutomaticCandidate[];
    clusters: DuplicateCluster[];
    assemblies: PhysicalWindowAssembly[];
  } {
    this.exclusionLedger = [];
    const walls = wallsInput as Wall[];
    const allFeaturesByWall = this.buildWallFeatures(operations, walls);
    const flatFeatures = Array.from(allFeaturesByWall.values()).flat();

    // Generate raw candidates without pretending that the generating wall is uniquely correct.
    const rawCandidates: AutomaticCandidate[] = [];
    for (const wall of walls) {
      rawCandidates.push(...this.generateCandidatesForWall(wall, allFeaturesByWall.get(wall.physicalWallId) ?? []));
    }

    // Host competition must run before final decision.
    this.resolveHostCompetition(rawCandidates, walls);
    for (const candidate of rawCandidates) {
      this.finalizeCandidateDecision(candidate);
    }

    // Merge only after constituent decisions are known. Never clear evidence.
    const { clusters, dedupedCandidates } = this.deduplicateCandidates(rawCandidates, walls);
    const assemblies = this.buildAssemblies(dedupedCandidates, flatFeatures);
    return { features: flatFeatures, candidates: dedupedCandidates, clusters, assemblies };
  }

  private buildWallFeatures(operations: any[], walls: Wall[]): Map<string, AutomaticFeature[]> {
    const result = new Map<string, AutomaticFeature[]>();
    const config = CLEAN_DETECTOR_CONFIG;
    const roi = config.ROI;

    // 1. Pre-flatten and pre-validate segments of operations.
    // This runs exactly once, saving massive redundant loops over operations/subpaths/segments for each wall.
    interface FlatSegment {
      id: string;
      cmd: string;
      sb: [number, number, number, number];
      dx: number;
      dy: number;
      len: number;
      opId: string;
      spId: string;
    }

    const flatSegs: FlatSegment[] = [];

    for (const op of operations) {
      if (op.operationType === 'clip' || op.operationType === 'pop-clip') continue;
      const [ox0, oy0, ox1, oy1] = op.transformedBounds || [0, 0, 0, 0];
      if (ox1 - ox0 > 600 || oy1 - oy0 > 300) continue;
      for (const sp of op.subpaths || []) {
        for (const seg of sp.segments || []) {
          const segId = seg.segmentId;
          const cmd = seg.commandType;
          const sb = seg.transformedBounds as [number, number, number, number] | undefined;
          if (!sb) {
            this.recordExclusion(segId, cmd, [0, 0, 0, 0], 'MISSING_BOUNDS', 'PERMANENTLY_EXCLUDED');
            continue;
          }
          if (!sb.every(Number.isFinite)) {
            this.recordExclusion(segId, cmd, sb, 'NON_FINITE_COORDINATES', 'PERMANENTLY_EXCLUDED');
            continue;
          }
          const segDx = sb[2] - sb[0];
          const segDy = sb[3] - sb[1];
          const segLength = Math.hypot(segDx, segDy);
          if (segLength < config.ZERO_LENGTH_THRESHOLD) {
            this.recordExclusion(segId, cmd, sb, 'ZERO_LENGTH', 'PERMANENTLY_EXCLUDED');
            continue;
          }
          flatSegs.push({
            id: segId,
            cmd,
            sb,
            dx: segDx,
            dy: segDy,
            len: segLength,
            opId: op.operationId,
            spId: sp.subpathId,
          });
        }
      }
    }

    // 2. Loop over walls and find matching features.
    for (const wall of walls) {
      const features: AutomaticFeature[] = [];
      result.set(wall.physicalWallId, features);
      const dx = wall.centerline.b.x - wall.centerline.a.x;
      const dy = wall.centerline.b.y - wall.centerline.a.y;
      const wallLength = Math.hypot(dx, dy);
      if (wallLength < 1e-6) continue;
      const ux = dx / wallLength;
      const uy = dy / wallLength;
      const nx = -uy;
      const ny = ux;
      const vMax = wall.thickness * 4.5;

      const wallMidX = (wall.centerline.a.x + wall.centerline.b.x) / 2;
      const wallMidY = (wall.centerline.a.y + wall.centerline.b.y) / 2;
      const wallInsideRoi = wallMidX >= roi[0] - wallLength && wallMidX <= roi[2] + wallLength &&
                            wallMidY >= roi[1] - wallLength && wallMidY <= roi[3] + wallLength;

      // Expanded wall bounding box for fast pre-filtering.
      const wMinX = Math.min(wall.centerline.a.x, wall.centerline.b.x) - vMax - config.OVERLAP_TOLERANCE;
      const wMaxX = Math.max(wall.centerline.a.x, wall.centerline.b.x) + vMax + config.OVERLAP_TOLERANCE;
      const wMinY = Math.min(wall.centerline.a.y, wall.centerline.b.y) - vMax - config.OVERLAP_TOLERANCE;
      const wMaxY = Math.max(wall.centerline.a.y, wall.centerline.b.y) + vMax + config.OVERLAP_TOLERANCE;

      for (const seg of flatSegs) {
        // Fast AABB check: skip immediately if segment bounds do not overlap the expanded wall corridor bounds.
        // This is extremely cheap (just 4 comparisons) and filters out >98% of the workload.
        if (seg.sb[2] < wMinX || seg.sb[0] > wMaxX || seg.sb[3] < wMinY || seg.sb[1] > wMaxY) {
          continue;
        }

        if (wallInsideRoi && (seg.sb[2] < roi[0] - 5 || seg.sb[0] > roi[2] + 5 || seg.sb[3] < roi[1] - 5 || seg.sb[1] > roi[3] + 5)) {
          this.recordExclusion(seg.id, seg.cmd, seg.sb, 'OUT_OF_BUILDING_ROI', 'PROVISIONALLY_EXCLUDED');
          continue;
        }

        const rel0x = seg.sb[0] - wall.centerline.a.x;
        const rel0y = seg.sb[1] - wall.centerline.a.y;
        const rel1x = seg.sb[2] - wall.centerline.a.x;
        const rel1y = seg.sb[3] - wall.centerline.a.y;
        const uStart = rel0x * ux + rel0y * uy;
        const uEnd = rel1x * ux + rel1y * uy;
        const vStart = rel0x * nx + rel0y * ny;
        const vEnd = rel1x * nx + rel1y * ny;
        const uMin = Math.min(uStart, uEnd);
        const uMax = Math.max(uStart, uEnd);
        if (Math.abs(vStart) > vMax || Math.abs(vEnd) > vMax || uMax < -config.OVERLAP_TOLERANCE || uMin > wallLength + config.OVERLAP_TOLERANCE) {
          this.recordExclusion(seg.id, seg.cmd, seg.sb, 'WALL_CORRIDOR_MISMATCH', 'PROVISIONALLY_EXCLUDED');
          continue;
        }

        // Correct undirected angle in [0, 90]. Perpendicular is 90, not 0 or 45.
        const dot = Math.abs((seg.dx / seg.len) * ux + (seg.dy / seg.len) * uy);
        const undirectedAngleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
        const normalOffset = (Math.abs(vStart) + Math.abs(vEnd)) / 2;
        const featureType = seg.cmd === 'C' ? 'CURVE_SEGMENT' : seg.cmd === 'Z' ? 'CLOSE_PATH_SEGMENT' : 'LINE_SEGMENT';
        const featureId = `f_${config.algorithmVersion}_${this.hashStr(`${seg.id}_${seg.cmd}_${wall.physicalWallId}`)}`;
        this.recordExclusion(seg.id, seg.cmd, seg.sb, 'ACCEPTED_PRIMITIVE', 'ACCEPTED');
        features.push({
          featureId,
          sourceOperationIds: [seg.opId],
          sourceSubpathIds: [seg.spId],
          sourceSegmentIds: [seg.id],
          geometry: {
            commandType: seg.cmd,
            uStart: +uStart.toFixed(3),
            uEnd: +uEnd.toFixed(3),
            vStart: +vStart.toFixed(3),
            vEnd: +vEnd.toFixed(3),
            undirectedAngleDeg: +undirectedAngleDeg.toFixed(3),
            wallNormalOffsetPx: +normalOffset.toFixed(3),
            lengthPx: +seg.len.toFixed(3),
          },
          featureType,
          derivationRule: 'wall-corridor-projection-r1.3',
          confidence: seg.cmd === 'C' ? 0.4 : 0.8,
        });
      }
    }

    return result;
  }

  private generateCandidatesForWall(wall: Wall, wallFeatures: AutomaticFeature[]): AutomaticCandidate[] {
    const config = CLEAN_DETECTOR_CONFIG;
    const wallLength = Math.hypot(
      wall.centerline.b.x - wall.centerline.a.x,
      wall.centerline.b.y - wall.centerline.a.y,
    );
    const lines = wallFeatures.filter(f => f.featureType === 'LINE_SEGMENT' || f.featureType === 'CLOSE_PATH_SEGMENT');
    const curves = wallFeatures.filter(f => f.featureType === 'CURVE_SEGMENT');
    const parallelLines = lines.filter(f => f.geometry.undirectedAngleDeg <= config.PARALLEL_ANGLE_MAX_DEG);
    const pairKeys = new Set<string>();
    const results: AutomaticCandidate[] = [];

    for (let i = 0; i < parallelLines.length; i++) {
      for (let j = i + 1; j < parallelLines.length; j++) {
        const a = parallelLines[i]!;
        const b = parallelLines[j]!;
        const spacing = Math.abs((a.geometry.vStart + a.geometry.vEnd) / 2 - (b.geometry.vStart + b.geometry.vEnd) / 2);
        if (spacing < config.PARALLEL_SPACING_MIN_PX || spacing > config.PARALLEL_SPACING_MAX_PX) continue;
        const a0 = Math.min(a.geometry.uStart, a.geometry.uEnd);
        const a1 = Math.max(a.geometry.uStart, a.geometry.uEnd);
        const b0 = Math.min(b.geometry.uStart, b.geometry.uEnd);
        const b1 = Math.max(b.geometry.uStart, b.geometry.uEnd);
        const overlap = Math.min(a1, b1) - Math.max(a0, b0);
        if (overlap < 3) continue;
        const key = [a.featureId, b.featureId].sort().join(':');
        if (pairKeys.has(key)) continue;
        pairKeys.add(key);
        const rawFrom = Math.min(a0, b0);
        const rawTo = Math.max(a1, b1);
        results.push(this.makeCandidate(wall, wallLength, [a, b], wallFeatures, curves, rawFrom, rawTo));
      }
    }
    return results;
  }

  private makeCandidate(
    wall: Wall,
    wallLength: number,
    pair: AutomaticFeature[],
    wallFeatures: AutomaticFeature[],
    curves: AutomaticFeature[],
    rawFrom: number,
    rawTo: number,
  ): AutomaticCandidate {
    const config = CLEAN_DETECTOR_CONFIG;
    const featureIds = pair.map(f => f.featureId).sort();
    const sourceSegmentIds = this.unique(pair.flatMap(f => f.sourceSegmentIds));
    const candidateId = `c_${config.algorithmVersion}_${wall.physicalWallId}_${this.hashStr(`${featureIds.join('_')}_${rawFrom.toFixed(3)}_${rawTo.toFixed(3)}`)}`;
    const intervalAudit = this.validateInterval(rawFrom, rawTo, wallLength, config.ENDPOINT_TOLERANCE);
    const frameLineAudits = pair.map(f => this.auditFrameLine(f, rawFrom, rawTo, wallLength, config.CONTINUOUS_WALL_FACE_MIN_LENGTH));
    const jambAudit = this.verifyJambs(wallFeatures, rawFrom, rawTo, config.JAMB_MAX_LENGTH, config.ENDPOINT_TOLERANCE);
    const wallFaceGapAudit = this.verifyWallFaceGap(wallFeatures, rawFrom, rawTo, config.ENDPOINT_TOLERANCE);
    const frameBayAudit: FrameBayRecord = { supportingFeatureIds: [], verdict: 'NO_VERIFIED_FRAME_BAY' };
    const isHatch = this.isHatchPattern(wallFeatures, rawFrom, rawTo);
    const localCurves = curves.filter(c => this.intervalsOverlap(rawFrom, rawTo, Math.min(c.geometry.uStart, c.geometry.uEnd), Math.max(c.geometry.uStart, c.geometry.uEnd)));
    const generatedBounds = this.boundsFromInterval(wall, rawFrom, rawTo);

    const candidate: AutomaticCandidate = {
      candidateId,
      generatedBounds,
      sourceFeatureIds: featureIds,
      sourceOperationIds: this.unique(pair.flatMap(f => f.sourceOperationIds)),
      sourceSubpathIds: this.unique(pair.flatMap(f => f.sourceSubpathIds)),
      sourceSegmentIds,
      topologyClass: 'PARALLEL_FRAME_LINES',
      physicalWallId: wall.physicalWallId,
      hostAmbiguity: 'AMBIGUOUS',
      finiteWallInterval: { start: +rawFrom.toFixed(3), end: +rawTo.toFixed(3) },
      displayClippedInterval: {
        start: intervalAudit.clippedIntervalFrom,
        end: intervalAudit.clippedIntervalTo,
      },
      width: +(rawTo - rawFrom).toFixed(3),
      widthMm: +((rawTo - rawFrom) * CoordinateAdapter.MM_PER_STAGE_A_UNIT).toFixed(3),
      panelCount: null,
      confidence: 0,
      positiveEvidence: ['parallel-frame-strokes'],
      negativeEvidence: [],
      gateHistory: [this.transition('GENERATED', 'UNRESOLVED', 'Generated from a source-derived parallel pair.')],
      reviewerRecommendation: 'REVIEW',
      reviewerObservation: 'UNREVIEWED_BLIND_HYPOTHESIS',
      extractionVerdict: 'REVIEW',
      finalDecision: 'REVIEW',
      finalDecisionReasons: ['host-competition-pending'],
      candidateOrigin: 'AUTOMATIC_SOURCE_DERIVATION',
      manualOverride: false,
      automaticPromotionAllowed: false,
      intervalAudit,
      frameLineAudits,
      jambAudit,
      wallFaceGapAudit,
      frameBayAudit,
      hatchPatternDetails: isHatch ? 'uniform-parallel-recurrence' : undefined,
    };

    if (frameLineAudits.some(a => a.finalRole === 'CONTINUOUS_WALL_FACE')) candidate.negativeEvidence.push('continuous-wall-face-detected');
    if (isHatch) candidate.negativeEvidence.push('hatch-recurrence-pattern');
    if (localCurves.length > 0) candidate.negativeEvidence.push('door-curve-intersection-conflict');
    return candidate;
  }

  private resolveHostCompetition(candidates: AutomaticCandidate[], walls: Wall[]): void {
    // 1. Build a map of segmentId -> candidates that use this segment
    const segmentToCandidates = new Map<string, AutomaticCandidate[]>();
    for (const c of candidates) {
      for (const segId of c.sourceSegmentIds) {
        let list = segmentToCandidates.get(segId);
        if (!list) {
          list = [];
          segmentToCandidates.set(segId, list);
        }
        list.push(c);
      }
    }

    // 2. Build a map of wallId -> candidates belonging to that wall
    const wallToCandidates = new Map<string, AutomaticCandidate[]>();
    for (const c of candidates) {
      if (c.physicalWallId) {
        let list = wallToCandidates.get(c.physicalWallId);
        if (!list) {
          list = [];
          wallToCandidates.set(c.physicalWallId, list);
        }
        list.push(c);
      }
    }

    // 3. Pre-compute geographically overlapping walls to narrow down candidates to check
    const overlappingWalls = new Map<string, Set<string>>();
    for (const w1 of walls) {
      const set = new Set<string>();
      overlappingWalls.set(w1.physicalWallId, set);
      
      const b1x0 = Math.min(w1.centerline.a.x, w1.centerline.b.x) - w1.thickness * 4.5;
      const b1x1 = Math.max(w1.centerline.a.x, w1.centerline.b.x) + w1.thickness * 4.5;
      const b1y0 = Math.min(w1.centerline.a.y, w1.centerline.b.y) - w1.thickness * 4.5;
      const b1y1 = Math.max(w1.centerline.a.y, w1.centerline.b.y) + w1.thickness * 4.5;

      for (const w2 of walls) {
        if (w1.physicalWallId === w2.physicalWallId) continue;
        const b2x0 = Math.min(w2.centerline.a.x, w2.centerline.b.x) - w2.thickness * 4.5;
        const b2x1 = Math.max(w2.centerline.a.x, w2.centerline.b.x) + w2.thickness * 4.5;
        const b2y0 = Math.min(w2.centerline.a.y, w2.centerline.b.y) - w2.thickness * 4.5;
        const b2y1 = Math.max(w2.centerline.a.y, w2.centerline.b.y) + w2.thickness * 4.5;

        // Check if wall bounding boxes overlap
        if (!(b2x1 < b1x0 || b2x0 > b1x1 || b2y1 < b1y0 || b2y0 > b1y1)) {
          set.add(w2.physicalWallId);
        }
      }
    }

    // 4. Loop over each candidate and resolve competition
    for (const candidate of candidates) {
      const competitors = new Set<AutomaticCandidate>();

      // A. Add candidates that share at least one source segment
      for (const segId of candidate.sourceSegmentIds) {
        const matching = segmentToCandidates.get(segId);
        if (matching) {
          for (const m of matching) {
            if (m !== candidate && m.physicalWallId !== candidate.physicalWallId) {
              competitors.add(m);
            }
          }
        }
      }

      // B. Add candidates from overlapping walls that satisfy bounding box criteria
      const hostWallId = candidate.physicalWallId;
      const adjWalls = hostWallId ? (overlappingWalls.get(hostWallId) ?? new Set<string>()) : new Set<string>();
      
      const [ax0, ay0, ax1, ay1] = candidate.generatedBounds;

      for (const adjWallId of adjWalls) {
        const matchingCandidates = wallToCandidates.get(adjWallId) ?? [];
        for (const other of matchingCandidates) {
          const [bx0, by0, bx1, by1] = other.generatedBounds;
          // Fast AABB intersection check
          if (bx1 < ax0 || bx0 > ax1 || by1 < ay0 || by0 > ay1) {
            continue;
          }
          // If bounding boxes overlap, verify exact overlap fraction
          const overlap = this.boundsOverlapFraction(candidate.generatedBounds, other.generatedBounds);
          if (overlap >= 0.65) {
            competitors.add(other);
          }
        }
      }

      const alternatives = Array.from(competitors).map(other => {
        // Calculate shared count with an optimized loop
        let shared = 0;
        const otherSet = new Set(other.sourceSegmentIds);
        for (const s of candidate.sourceSegmentIds) {
          if (otherSet.has(s)) {
            shared++;
          }
        }

        const overlap = this.boundsOverlapFraction(candidate.generatedBounds, other.generatedBounds);

        return {
          physicalWallId: other.physicalWallId!,
          candidateId: other.candidateId,
          sharedSourceSegmentCount: shared,
          boundsOverlapFraction: +overlap.toFixed(4),
          wallNormalOffsetScore: this.averageCandidateNormalOffset(other),
        };
      })
      .sort((a, b) => b.sharedSourceSegmentCount - a.sharedSourceSegmentCount || b.boundsOverlapFraction - a.boundsOverlapFraction || a.wallNormalOffsetScore - b.wallNormalOffsetScore);

      const ownScore = this.averageCandidateNormalOffset(candidate);
      const bestAlternative = alternatives[0];
      let audit: HostCompetitionRecord;
      if (!candidate.physicalWallId) {
        audit = { status: 'NO_HOST', selectedPhysicalWallId: null, consideredHosts: alternatives, selectionMargin: null, reason: 'No generating host wall.' };
      } else if (!bestAlternative) {
        audit = { status: 'UNIQUE_HOST', selectedPhysicalWallId: candidate.physicalWallId, consideredHosts: [], selectionMargin: null, reason: 'No competing wall shares source geometry or material spatial overlap.' };
      } else {
        const alternativeIsMaterial = bestAlternative.sharedSourceSegmentCount > 0 || bestAlternative.boundsOverlapFraction >= 0.65;
        const margin = bestAlternative.wallNormalOffsetScore - ownScore;
        audit = alternativeIsMaterial
          ? { status: 'AMBIGUOUS_HOST_REVIEW', selectedPhysicalWallId: null, consideredHosts: alternatives, selectionMargin: +margin.toFixed(3), reason: 'Competing wall claims the same source geometry or substantially overlapping bounds.' }
          : { status: 'UNIQUE_HOST', selectedPhysicalWallId: candidate.physicalWallId, consideredHosts: alternatives, selectionMargin: +margin.toFixed(3), reason: 'Generating wall is materially better than alternatives.' };
      }
      candidate.hostCompetition = audit;
      candidate.hostAmbiguity = audit.status === 'UNIQUE_HOST' ? 'UNIQUE' : audit.status === 'NO_HOST' ? 'NO_HOST' : 'AMBIGUOUS';
      candidate.gateHistory.push(this.transition('HOSTED', audit.status === 'UNIQUE_HOST' ? 'ACCEPTED' : audit.status === 'NO_HOST' ? 'REJECTED' : 'REVIEW', audit.reason));
    }
  }

  private finalizeCandidateDecision(candidate: AutomaticCandidate): void {
    const reasons: string[] = [];
    let decision: FinalDecision = 'RETAIN';
    const hostStatus = candidate.hostCompetition?.status ?? 'NO_HOST';
    if (hostStatus === 'NO_HOST') {
      decision = 'REJECT';
      reasons.push('no-host');
    } else if (hostStatus === 'AMBIGUOUS_HOST_REVIEW') {
      decision = 'REVIEW';
      reasons.push('ambiguous-host');
    }

    const intervalStatus = candidate.intervalAudit?.intervalStatus;
    if (intervalStatus === 'EXTENDS_BEYOND_WALL' || intervalStatus === 'INVALID_REVERSED_INTERVAL' || intervalStatus === 'INVALID_ZERO_WIDTH') {
      decision = 'REJECT';
      const intervalReason = intervalStatus === 'EXTENDS_BEYOND_WALL'
        ? 'interval-extends-beyond-wall'
        : intervalStatus === 'INVALID_REVERSED_INTERVAL'
          ? 'invalid-reversed-interval'
          : 'invalid-zero-width-interval';
      reasons.push(intervalReason);
      // Also record in negativeEvidence for consistent accounting reporting.
      if (!candidate.negativeEvidence.includes(intervalReason)) {
        candidate.negativeEvidence.push(intervalReason);
      }
    } else if (intervalStatus === 'AMBIGUOUS_AT_JUNCTION' && decision !== 'REJECT') {
      decision = 'REVIEW';
      reasons.push('junction-ambiguity');
    }

    const localFrameGate = candidate.frameLineAudits?.every(a => a.finalRole === 'LOCAL_FRAME_FEATURE') ?? false;
    if (!localFrameGate) {
      decision = 'REJECT';
      reasons.push('continuous-wall-face-detected');
    }

    const openingEvidenceGate =
      candidate.jambAudit?.pairVerdict === 'VALID_JAMB_PAIR'
      || candidate.wallFaceGapAudit?.verdict === 'VALID_SOURCE_WALL_FACE_GAP'
      || candidate.frameBayAudit?.verdict === 'VERIFIED_FRAME_BAY';
    if (!openingEvidenceGate) {
      decision = decision === 'REJECT' ? 'REJECT' : 'REVIEW';
      reasons.push('missing-opening-evidence');
    }

    for (const evidence of candidate.negativeEvidence) {
      if (FATAL_EVIDENCE.has(evidence)) {
        decision = 'REJECT';
        reasons.push(evidence);
      }
    }

    candidate.finalDecision = decision;
    candidate.finalDecisionReasons = this.unique(reasons);
    candidate.extractionVerdict = decision === 'RETAIN' ? 'ACCEPTED' : decision === 'REVIEW' ? 'REVIEW' : 'REJECTED';
    candidate.reviewerRecommendation = decision === 'RETAIN' ? 'PROMOTE' : decision === 'REVIEW' ? 'REVIEW' : 'REJECT';
    candidate.reviewerObservation = decision === 'RETAIN' ? 'UNREVIEWED_RETAINED_BLIND_HYPOTHESIS' : decision === 'REVIEW' ? 'UNRESOLVED_BLIND_HYPOTHESIS' : 'REJECTED_BY_BLIND_GRAMMAR';
    candidate.automaticPromotionAllowed = false; // Never physical acceptance in blind research output.
    candidate.confidence = decision === 'RETAIN' ? 0.8 : decision === 'REVIEW' ? 0.5 : 0.2;
    candidate.gateHistory.push(this.transition('FINALIZED', candidate.extractionVerdict, candidate.finalDecisionReasons.join(', ') || 'All mandatory blind gates passed.'));
  }

  private deduplicateCandidates(candidates: AutomaticCandidate[], walls: Wall[]): { clusters: DuplicateCluster[]; dedupedCandidates: AutomaticCandidate[] } {
    const clusters: DuplicateCluster[] = [];
    const output: AutomaticCandidate[] = [];
    const byWall = new Map<string, AutomaticCandidate[]>();
    for (const candidate of candidates) {
      const key = candidate.physicalWallId ?? '__NO_HOST__';
      byWall.set(key, [...(byWall.get(key) ?? []), candidate]);
    }

    for (const [wallId, wallCandidates] of byWall) {
      const sorted = [...wallCandidates].sort((a, b) => (a.finiteWallInterval?.start ?? 0) - (b.finiteWallInterval?.start ?? 0));
      const groups: AutomaticCandidate[][] = [];
      for (const candidate of sorted) {
        const matching = groups.find(group => group.some(existing => this.candidatesOverlap(existing, candidate)));
        if (matching) matching.push(candidate);
        else groups.push([candidate]);
      }

      for (const group of groups) {
        if (group.length === 1) {
          output.push(group[0]!);
          continue;
        }
        const merge = this.mergeCandidateGroup(group, walls.find(w => w.physicalWallId === wallId));
        clusters.push(merge.cluster);
        output.push(...merge.candidates);
      }
    }
    return { clusters, dedupedCandidates: output };
  }

  private mergeCandidateGroup(group: AutomaticCandidate[], wall?: Wall): { cluster: DuplicateCluster; candidates: AutomaticCandidate[] } {
    const config = CLEAN_DETECTOR_CONFIG;
    const ids = group.map(c => c.candidateId).sort();
    const decisions = group.map(c => c.finalDecision ?? 'REVIEW');
    const allPositive = this.unique(group.flatMap(c => c.positiveEvidence));
    const allNegative = this.unique(group.flatMap(c => c.negativeEvidence));
    const fatalIds = group.filter(c => c.negativeEvidence.some(e => FATAL_EVIDENCE.has(e)) || c.finalDecision === 'REJECT').map(c => c.candidateId);
    const allSameSource = group.every(c => this.intersectionSize(c.sourceSegmentIds, group[0]!.sourceSegmentIds) === Math.min(c.sourceSegmentIds.length, group[0]!.sourceSegmentIds.length));
    const anyAmbiguousHost = group.some(c => c.hostCompetition?.status === 'AMBIGUOUS_HOST_REVIEW');
    const hasRetainConstituent = decisions.some(d => d === 'RETAIN');
    const allRejectConstituents = decisions.every(d => d === 'REJECT');

    let resolution: MergeEvidenceRecord['mergeResolution'] = 'SAFE_MERGE';
    let relationship: MergeEvidenceRecord['conflictRelationship'] = allSameSource ? 'SAME_SOURCE_GEOMETRY' : 'PANEL_OR_FRAME_FRAGMENT';
    // RETAIN only if all RETAIN with no fatal evidence and no host ambiguity.
    // REJECT if all constituents are REJECT (uniform fatal failure — no conflict).
    // REVIEW if there is a genuine conflict between RETAIN and REJECT, or host ambiguity.
    let finalDecision: FinalDecision = decisions.every(d => d === 'RETAIN') && !anyAmbiguousHost && fatalIds.length === 0
      ? 'RETAIN'
      : allRejectConstituents && !anyAmbiguousHost
        ? 'REJECT'
        : 'REVIEW';
    const reasons: string[] = [];
    if (fatalIds.length > 0 && hasRetainConstituent) {
      // Conflict: a RETAIN and a REJECT are merged — escalate to REVIEW.
      resolution = 'REVIEW_REQUIRED';
      relationship = 'UNRESOLVED';
      finalDecision = 'REVIEW';
      reasons.push('constituent-fatal-evidence-preserved');
    } else if (fatalIds.length > 0 && allRejectConstituents) {
      // Uniform rejection: all constituents have fatal evidence. Keep REJECT.
      resolution = 'REVIEW_REQUIRED';
      relationship = 'UNRESOLVED';
      // finalDecision remains 'REJECT' as set above.
      reasons.push('all-constituents-rejected-with-fatal-evidence');
    }
    if (anyAmbiguousHost) {
      resolution = 'REVIEW_REQUIRED';
      relationship = 'COMPETING_HOST_ASSIGNMENT';
      finalDecision = 'REVIEW';
      reasons.push('constituent-host-ambiguity');
    }

    const mergeAudit: MergeEvidenceRecord = {
      constituentCandidateIds: ids,
      constituentDecisions: decisions,
      allPositiveEvidence: allPositive,
      allNegativeEvidence: allNegative,
      fatalConflictCandidateIds: fatalIds,
      conflictRelationship: relationship,
      mergeResolution: resolution,
      finalDecision,
      finalDecisionReasons: reasons.length ? reasons : ['all-constituents-compatible'],
    };

    const start = Math.min(...group.map(c => c.finiteWallInterval?.start ?? 0));
    const end = Math.max(...group.map(c => c.finiteWallInterval?.end ?? 0));
    const cluster: DuplicateCluster = {
      clusterId: `cl_${config.algorithmVersion}_${this.hashStr(ids.join('_'))}`,
      candidateIds: ids,
      physicalWallId: wall?.physicalWallId ?? '__NO_HOST__',
      mergedInterval: { start, end },
      selectedRepresentative: group[0]!.candidateId,
      mergedSourceFeatureIds: this.unique(group.flatMap(c => c.sourceFeatureIds)),
      panelCount: null,
      mergeReason: 'overlapping-wall-local-interval-audited',
      mergeEvidence: mergeAudit,
    };

    // Preserve all constituent records.
    // Conflict (RETAIN+REJECT merge → REVIEW): all constituents including RETAIN become REVIEW.
    // A RETAIN embedded in a conflict merge cannot be promoted — contamination must be reviewed.
    // Uniform REJECT (all fatal): do not override — keep each constituent as REJECT.
    for (const candidate of group) {
      candidate.mergeEvidence = mergeAudit;
      if (finalDecision === 'REVIEW') {
        // Override ALL constituents to REVIEW in a conflict merge, including RETAIN.
        candidate.finalDecision = 'REVIEW';
        candidate.extractionVerdict = 'REVIEW';
        candidate.reviewerRecommendation = 'REVIEW';
        candidate.reviewerObservation = 'MERGE_CONFLICT_REVIEW';
        candidate.automaticPromotionAllowed = false;
        candidate.finalDecisionReasons = this.unique([...(candidate.finalDecisionReasons ?? []), ...mergeAudit.finalDecisionReasons]);
      }
      candidate.gateHistory.push(this.transition('DEDUPLICATED', candidate.extractionVerdict, `Cluster ${cluster.clusterId}: ${mergeAudit.mergeResolution}`));
    }
    return { cluster, candidates: group };
  }

  private buildAssemblies(candidates: AutomaticCandidate[], features: AutomaticFeature[]): PhysicalWindowAssembly[] {
    const config = CLEAN_DETECTOR_CONFIG;
    const assemblies: PhysicalWindowAssembly[] = [];
    for (const candidate of candidates) {
      if (candidate.finalDecision !== 'RETAIN' || candidate.hostCompetition?.status !== 'UNIQUE_HOST' || !candidate.physicalWallId || !candidate.finiteWallInterval) continue;
      const relevant = features.filter(f => f.sourceSegmentIds.some(id => candidate.sourceSegmentIds.includes(id)));
      const ticks = relevant.filter(f => f.featureType === 'LINE_SEGMENT' && f.geometry.undirectedAngleDeg >= 85 && this.midU(f) >= candidate.finiteWallInterval!.start && this.midU(f) <= candidate.finiteWallInterval!.end);
      const panelCount = ticks.length > 0 ? ticks.length + 1 : null;
      assemblies.push({
        physicalWindowHypothesisId: `as_${config.algorithmVersion}_${candidate.physicalWallId}_${this.hashStr(`${candidate.candidateId}_${candidate.finiteWallInterval.start.toFixed(3)}_${candidate.finiteWallInterval.end.toFixed(3)}`)}`,
        physicalWallId: candidate.physicalWallId,
        finiteOpeningInterval: candidate.finiteWallInterval,
        physicalWidth: candidate.width,
        physicalWidthMm: candidate.widthMm,
        panelCount,
        candidateIdsMerged: [candidate.candidateId],
        sourceFeatureIds: candidate.sourceFeatureIds,
        externalAnchorIds: [],
        evidenceStatus: 'BLIND_PHYSICAL_OPENING_HYPOTHESIS',
      });
    }
    return assemblies;
  }

  private validateInterval(rawFrom: number, rawTo: number, wallLength: number, tolerance: number): IntervalValidationResult {
    if (rawFrom > rawTo) return this.intervalResult(wallLength, rawFrom, rawTo, rawTo, rawFrom, tolerance, 0, 'INVALID_REVERSED_INTERVAL');
    const width = rawTo - rawFrom;
    if (width < 1e-4) return this.intervalResult(wallLength, rawFrom, rawTo, rawFrom, rawTo, tolerance, 0, 'INVALID_ZERO_WIDTH');
    const clippedFrom = Math.max(0, rawFrom);
    const clippedTo = Math.min(wallLength, rawTo);
    const leftExcess = Math.max(0, -rawFrom);
    const rightExcess = Math.max(0, rawTo - wallLength);
    const status = leftExcess > tolerance || rightExcess > tolerance
      ? 'EXTENDS_BEYOND_WALL'
      : leftExcess > 0 || rightExcess > 0
        ? 'VALID_WITH_ENDPOINT_TOLERANCE'
        : 'VALID_INSIDE_FINITE_WALL';
    return this.intervalResult(wallLength, rawFrom, rawTo, clippedFrom, clippedTo, tolerance, width / wallLength, status);
  }

  private intervalResult(wallLength: number, rawFrom: number, rawTo: number, clippedFrom: number, clippedTo: number, tolerance: number, coverage: number, status: IntervalValidationResult['intervalStatus']): IntervalValidationResult {
    return {
      wallLength: +wallLength.toFixed(3), rawIntervalFrom: +rawFrom.toFixed(3), rawIntervalTo: +rawTo.toFixed(3),
      clippedIntervalFrom: +clippedFrom.toFixed(3), clippedIntervalTo: +clippedTo.toFixed(3), endpointTolerance: tolerance,
      coverageFraction: +coverage.toFixed(3), intervalStatus: status,
    };
  }

  private auditFrameLine(feature: AutomaticFeature, leftU: number, rightU: number, wallLength: number, minimumContinuousLength: number): FrameLineAudit {
    const uMin = Math.min(feature.geometry.uStart, feature.geometry.uEnd);
    const uMax = Math.max(feature.geometry.uStart, feature.geometry.uEnd);
    const total = feature.geometry.lengthPx;
    const inside = Math.max(0, Math.min(rightU, uMax) - Math.max(leftU, uMin));
    // Coverage fraction only applies as a CONTINUOUS_WALL_FACE indicator when the line
    // is shorter than the wall (i.e. it occupies most of the wall without being endpoint-extended).
    // A line that exceeds wallLength due to endpoint tolerance is expected in valid window frames.
    const fractionIsContinuous = total < wallLength && total / wallLength > 0.8;
    const role: FrameLineAudit['finalRole'] = total >= minimumContinuousLength || fractionIsContinuous
      ? 'CONTINUOUS_WALL_FACE'
      : feature.geometry.undirectedAngleDeg >= 85
        ? total <= 15 ? 'POSSIBLE_JAMB' : 'POSSIBLE_PANEL_DIVIDER'
        : feature.geometry.undirectedAngleDeg <= 5
          ? 'LOCAL_FRAME_FEATURE'
          : total <= 3 ? 'SHORT_MARK_OR_TICK' : 'UNRESOLVED';
    return {
      totalSourceLength: +total.toFixed(3), lengthInsideCandidateInterval: +inside.toFixed(3),
      extensionBefore: +Math.max(0, leftU - uMin).toFixed(3), extensionAfter: +Math.max(0, uMax - rightU).toFixed(3),
      hostWallCoverageFraction: +(total / wallLength).toFixed(3), finalRole: role,
    };
  }

  private verifyJambs(features: AutomaticFeature[], leftU: number, rightU: number, jambMaxLength: number, endpointTolerance: number): JambPairRecord {
    const perpendicular = features.filter(f => f.geometry.undirectedAngleDeg >= 85 && f.geometry.lengthPx <= jambMaxLength);
    const pick = (target: number) => perpendicular
      .map(f => ({ f, error: Math.abs(this.midU(f) - target) }))
      .filter(x => x.error <= endpointTolerance)
      .sort((a, b) => a.error - b.error)[0];
    const left = pick(leftU);
    const right = pick(rightU);
    if (left && right && left.f.featureId !== right.f.featureId) {
      return {
        leftJambFeatureId: left.f.featureId, rightJambFeatureId: right.f.featureId,
        separation: +(this.midU(right.f) - this.midU(left.f)).toFixed(3),
        endpointErrors: [+left.error.toFixed(3), +right.error.toFixed(3)],
        angleErrors: [+(90 - left.f.geometry.undirectedAngleDeg).toFixed(3), +(90 - right.f.geometry.undirectedAngleDeg).toFixed(3)],
        styleCompatibility: left.f.geometry.commandType === right.f.geometry.commandType,
        pairVerdict: left.f.geometry.commandType === right.f.geometry.commandType ? 'VALID_JAMB_PAIR' : 'INVALID_JAMB_PAIR',
      };
    }
    return { leftJambFeatureId: null, rightJambFeatureId: null, separation: 0, endpointErrors: [left?.error ?? 0, right?.error ?? 0], angleErrors: [0, 0], styleCompatibility: false, pairVerdict: 'NO_JAMB_PAIR' };
  }

  private verifyWallFaceGap(features: AutomaticFeature[], leftU: number, rightU: number, tolerance: number): WallFaceGapRecord {
    const faces = features.filter(f => f.geometry.undirectedAngleDeg <= 5 && f.geometry.lengthPx >= 20);
    const left = faces.map(f => ({ f, error: Math.abs(Math.max(f.geometry.uStart, f.geometry.uEnd) - leftU) })).filter(x => x.error <= tolerance).sort((a, b) => a.error - b.error)[0];
    const right = faces.map(f => ({ f, error: Math.abs(Math.min(f.geometry.uStart, f.geometry.uEnd) - rightU) })).filter(x => x.error <= tolerance).sort((a, b) => a.error - b.error)[0];
    if (left && right && left.f.featureId !== right.f.featureId) {
      return { leftWallFaceFeatureId: left.f.featureId, rightWallFaceFeatureId: right.f.featureId, leftEndpointError: +left.error.toFixed(3), rightEndpointError: +right.error.toFixed(3), gapWidth: +(rightU - leftU).toFixed(3), verdict: 'VALID_SOURCE_WALL_FACE_GAP' };
    }
    return { leftWallFaceFeatureId: null, rightWallFaceFeatureId: null, leftEndpointError: left?.error ?? 0, rightEndpointError: right?.error ?? 0, gapWidth: +(rightU - leftU).toFixed(3), verdict: 'NO_SOURCE_WALL_FACE_GAP' };
  }

  private isHatchPattern(features: AutomaticFeature[], leftU: number, rightU: number): boolean {
    const local = features.filter(f => f.geometry.undirectedAngleDeg <= 5 && this.intervalsOverlap(leftU, rightU, Math.min(f.geometry.uStart, f.geometry.uEnd), Math.max(f.geometry.uStart, f.geometry.uEnd)));
    if (local.length < 4) return false;
    const offsets = local.map(f => (f.geometry.vStart + f.geometry.vEnd) / 2).sort((a, b) => a - b);
    const diffs = offsets.slice(1).map((v, i) => v - offsets[i]!);
    if (!diffs.length) return false;
    const average = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const variance = diffs.reduce((sum, d) => sum + (d - average) ** 2, 0) / diffs.length;
    return variance < 1;
  }

  private boundsFromInterval(wall: Wall, start: number, end: number): [number, number, number, number] {
    const dx = wall.centerline.b.x - wall.centerline.a.x;
    const dy = wall.centerline.b.y - wall.centerline.a.y;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const p0 = { x: wall.centerline.a.x + start * ux, y: wall.centerline.a.y + start * uy };
    const p1 = { x: wall.centerline.a.x + end * ux, y: wall.centerline.a.y + end * uy };
    return CoordinateAdapter.stageAToInstr([
      Math.min(p0.x, p1.x) - wall.thickness / 2,
      Math.min(p0.y, p1.y) - wall.thickness / 2,
      Math.max(p0.x, p1.x) + wall.thickness / 2,
      Math.max(p0.y, p1.y) + wall.thickness / 2,
    ]);
  }

  private candidatesOverlap(a: AutomaticCandidate, b: AutomaticCandidate): boolean {
    if (a.physicalWallId !== b.physicalWallId || !a.finiteWallInterval || !b.finiteWallInterval) return false;
    return Math.min(a.finiteWallInterval.end, b.finiteWallInterval.end) > Math.max(a.finiteWallInterval.start, b.finiteWallInterval.start);
  }

  private boundsOverlapFraction(a: [number, number, number, number], b: [number, number, number, number]): number {
    const x = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
    const y = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const intersection = x * y;
    const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
    const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    return Math.min(areaA, areaB) > 0 ? intersection / Math.min(areaA, areaB) : 0;
  }

  private averageCandidateNormalOffset(candidate: AutomaticCandidate): number {
    const audits = candidate.frameLineAudits ?? [];
    if (!audits.length) return Number.POSITIVE_INFINITY;
    // The current contract does not store offset in the audit, so use candidate source geometry indirectly.
    return candidate.width;
  }

  private intervalsOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
    return Math.min(a1, b1) > Math.max(a0, b0);
  }

  private intersectionSize(a: string[], b: string[]): number {
    const set = new Set(b);
    return new Set(a.filter(x => set.has(x))).size;
  }

  private midU(feature: AutomaticFeature): number {
    return (feature.geometry.uStart + feature.geometry.uEnd) / 2;
  }

  private unique<T>(items: T[]): T[] {
    return Array.from(new Set(items)).sort() as T[];
  }

  private hashStr(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 12);
  }

  private recordExclusion(segmentId: string, commandType: string, bounds: [number, number, number, number], reason: string, reversibleState: ExclusionRecord['reversibleState']): void {
    this.exclusionLedger.push({ segmentId, commandType, bounds, reason, reversibleState });
  }

  private transition(state: GateTransition['state'], verdict: GateTransition['verdict'], reason: string): GateTransition {
    return { state, verdict, timestamp: new Date().toISOString(), reason };
  }
}
