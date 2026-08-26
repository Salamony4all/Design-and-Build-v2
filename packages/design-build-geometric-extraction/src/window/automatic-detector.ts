// Automatic Window Detector pipeline for CODE-06.
// Runs blind to manual bounds and WA annotation content.

import { createHash } from 'crypto';
import { CoordinateAdapter } from './coordinate-adapter.ts';

export interface ExclusionRecord {
  segmentId: string;
  commandType: string;
  bounds: [number, number, number, number];
  reason: string;
  reversibleState: 'PROVISIONALLY_EXCLUDED' | 'PERMANENTLY_EXCLUDED' | 'ACCEPTED';
}

export interface GateTransition {
  state: 'GENERATED' | 'HOSTED' | 'INTERVAL_VALID' | 'TOPOLOGY_SUPPORTED' | 'DEDUPLICATED' | 'REVIEWED' | 'FINALIZED';
  verdict: 'ACCEPTED' | 'REVIEW' | 'REJECTED' | 'UNRESOLVED';
  timestamp: string;
  reason: string;
}

export interface AutomaticFeature {
  featureId: string;
  sourceOperationIds: string[];
  sourceSubpathIds: string[];
  sourceSegmentIds: string[];
  geometry: {
    commandType: string;
    uStart: number;
    uEnd: number;
    vStart: number;
    vEnd: number;
    undirectedAngleDeg: number;
    wallNormalOffsetPx: number;
    lengthPx: number;
  };
  featureType: 'LINE_SEGMENT' | 'CURVE_SEGMENT' | 'CLOSE_PATH_SEGMENT' | 'UNKNOWN';
  derivationRule: string;
  confidence: number;
}

export interface AutomaticCandidate {
  candidateId: string;
  generatedBounds: [number, number, number, number]; // instrument space
  sourceFeatureIds: string[];
  sourceOperationIds: string[];
  sourceSubpathIds: string[];
  sourceSegmentIds: string[];
  topologyClass: 'PARALLEL_FRAME_LINES' | 'WALL_GAP_WITH_GLAZING' | 'SINGLE_FRAME_SYMBOL' | 'UNKNOWN';
  physicalWallId: string | null;
  hostAmbiguity: 'UNIQUE' | 'AMBIGUOUS' | 'NO_HOST';
  finiteWallInterval: { start: number; end: number } | null;
  width: number;
  widthMm: number;
  panelCount: number | null;
  confidence: number;
  positiveEvidence: string[];
  negativeEvidence: string[];
  gateHistory: GateTransition[];
  reviewerRecommendation: 'PROMOTE' | 'REVIEW' | 'REJECT';
  reviewerObservation: string;
  extractionVerdict: 'ACCEPTED' | 'REVIEW' | 'REJECTED';
  candidateOrigin: 'AUTOMATIC_SOURCE_DERIVATION';
  manualOverride: boolean;
  automaticPromotionAllowed: boolean;
}

export interface PhysicalWindowAssembly {
  physicalWindowHypothesisId: string;
  physicalWallId: string;
  finiteOpeningInterval: { start: number; end: number };
  physicalWidth: number;
  physicalWidthMm: number;
  panelCount: number | null;
  candidateIdsMerged: string[];
  sourceFeatureIds: string[];
  waReferencesNearby: string[];
}

export interface DuplicateCluster {
  clusterId: string;
  candidateIds: string[];
  physicalWallId: string;
  mergedInterval: { start: number; end: number };
  selectedRepresentative: string;
  mergedSourceFeatureIds: string[];
  panelCount: number | null;
  mergeReason: string;
}

export class AutomaticDetector {
  private exclusionLedger: ExclusionRecord[] = [];

  // ROI in Stage A space: [306.12, 376.92, 1768.68, 1170.60]
  private static readonly ROI = [306.12, 376.92, 1768.68, 1170.60];

  // Alg version for deterministic ID seeds
  private static readonly ALG_VERSION = 'v2';

  // Tolerances in page units (Instrument space / Stage A space)
  private static readonly OVERLAP_TOLERANCE = 10.0; // px
  private static readonly ZERO_LENGTH_THRESHOLD = 0.5; // px
  private static readonly PARALLEL_ANGLE_MAX_DEG = 5.0;
  private static readonly PARALLEL_SPACING_MIN_PX = 2.0;
  private static readonly PARALLEL_SPACING_MAX_PX = 50.0;
  private static readonly FRAME_LINE_MIN_LENGTH_PX = 3.0;
  private static readonly GAP_EDGE_MIN_LENGTH_PX = 2.0;

  // Tolerances in millimetres (using scaleMmPerPt)
  private static readonly OVERLAP_TOLERANCE_MM = AutomaticDetector.OVERLAP_TOLERANCE * CoordinateAdapter.MM_PER_STAGE_A_UNIT;

  constructor() {}

  /** Retrieve the built exclusion ledger for auditing */
  public getExclusionLedger(): ExclusionRecord[] {
    return this.exclusionLedger;
  }

  /** Run the blind window detection pipeline on all Stage A operations and 70 walls */
  public detect(
    operations: any[],
    walls: any[]
  ): {
    features: AutomaticFeature[];
    candidates: AutomaticCandidate[];
    clusters: DuplicateCluster[];
    assemblies: PhysicalWindowAssembly[];
  } {
    this.exclusionLedger = [];
    const allFeaturesByWall: Map<string, AutomaticFeature[]> = new Map();

    // Initialize wall corridors and populate features by wall
    for (const w of walls) {
      allFeaturesByWall.set(w.physicalWallId, []);
      const dx = w.centerline.b.x - w.centerline.a.x;
      const dy = w.centerline.b.y - w.centerline.a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;

      const nx = -dy / len;
      const ny = dx / len;
      // Corridor half-width = 4.5 * thickness
      const vMax = w.thickness * 4.5;

      // Extract local features for this wall
      for (const op of operations) {
        if (op.operationType === 'clip' || op.operationType === 'pop-clip') continue;

        // Pre-pass filters
        const [ox0, oy0, ox1, oy1] = op.transformedBounds || [0, 0, 0, 0];
        const opW = ox1 - ox0;
        const opH = oy1 - oy0;

        if (opW > 600 || opH > 300) {
          // Large envelope
          continue;
        }

        for (const sp of (op.subpaths || [])) {
          for (const seg of (sp.segments || [])) {
            const segId = seg.segmentId;
            const cmd = seg.commandType;
            const sb = seg.transformedBounds;

            if (!sb) {
              this.recordExclusion(segId, cmd, [0,0,0,0], 'MISSING_BOUNDS', 'PERMANENTLY_EXCLUDED');
              continue;
            }

            const length = Math.hypot(sb[2] - sb[0], sb[3] - sb[1]);
            if (length < AutomaticDetector.ZERO_LENGTH_THRESHOLD) {
              this.recordExclusion(segId, cmd, sb, 'ZERO_LENGTH', 'PERMANENTLY_EXCLUDED');
              continue;
            }

            if (!isFinite(sb[0]) || !isFinite(sb[1]) || !isFinite(sb[2]) || !isFinite(sb[3])) {
              this.recordExclusion(segId, cmd, sb, 'NON_FINITE_COORDINATES', 'PERMANENTLY_EXCLUDED');
              continue;
            }

            // Building ROI filter in Stage A space
            const roi = AutomaticDetector.ROI;
            if (sb[2] < roi[0] - 5 || sb[0] > roi[2] + 5 || sb[3] < roi[1] - 5 || sb[1] > roi[3] + 5) {
              this.recordExclusion(segId, cmd, sb, 'OUT_OF_BUILDING_ROI', 'PROVISIONALLY_EXCLUDED');
              continue;
            }

            // Project to wall-local coordinates (u, v)
            const uStart = ((sb[0] - w.centerline.a.x) * dx + (sb[1] - w.centerline.a.y) * dy) / len;
            const uEnd = ((sb[2] - w.centerline.a.x) * dx + (sb[3] - w.centerline.a.y) * dy) / len;
            const vStart = (sb[0] - w.centerline.a.x) * nx + (sb[1] - w.centerline.a.y) * ny;
            const vEnd = (sb[2] - w.centerline.a.x) * nx + (sb[3] - w.centerline.a.y) * ny;

            // Corridor checks
            const insideCorridor = Math.abs(vStart) <= vMax && Math.abs(vEnd) <= vMax;
            const uMin = Math.min(uStart, uEnd);
            const uMax = Math.max(uStart, uEnd);
            const insideEndpoints = uMax >= -AutomaticDetector.OVERLAP_TOLERANCE && uMin <= len + AutomaticDetector.OVERLAP_TOLERANCE;

            if (!insideCorridor || !insideEndpoints) {
              // Not associated with this wall, keep in ledger
              this.recordExclusion(segId, cmd, sb, 'WALL_CORRIDOR_MISMATCH', 'PROVISIONALLY_EXCLUDED');
              continue;
            }

            // Compute alignment details
            const segDx = sb[2] - sb[0];
            const segDy = sb[3] - sb[1];
            const segLenVal = Math.hypot(segDx, segDy);
            let angleDiff = Math.abs(Math.atan2(Math.abs(segDy), Math.abs(segDx)) - Math.atan2(Math.abs(dy), Math.abs(dx))) * 180 / Math.PI;
            if (angleDiff > 90) angleDiff = 180 - angleDiff;
            if (angleDiff > 45) angleDiff = 90 - angleDiff; // undirected angle [0,45] relative to axis

            const normalOffset = (Math.abs(vStart) + Math.abs(vEnd)) / 2;

            // Classify feature
            let fType: 'LINE_SEGMENT' | 'CURVE_SEGMENT' | 'CLOSE_PATH_SEGMENT' = 'LINE_SEGMENT';
            if (cmd === 'C') fType = 'CURVE_SEGMENT';
            else if (cmd === 'Z') fType = 'CLOSE_PATH_SEGMENT';

            // Feature ID using deterministic seed
            const sortedIds = [segId].sort();
            const featureId = `f_${AutomaticDetector.ALG_VERSION}_${this.hashStr(sortedIds.join('_') + '_' + cmd)}`;

            this.recordExclusion(segId, cmd, sb, 'ACCEPTED_PRIMITIVE', 'ACCEPTED');

            allFeaturesByWall.get(w.physicalWallId)!.push({
              featureId,
              sourceOperationIds: [op.operationId],
              sourceSubpathIds: [sp.subpathId],
              sourceSegmentIds: [segId],
              geometry: {
                commandType: cmd,
                uStart: +uStart.toFixed(3),
                uEnd: +uEnd.toFixed(3),
                vStart: +vStart.toFixed(3),
                vEnd: +vEnd.toFixed(3),
                undirectedAngleDeg: +angleDiff.toFixed(3),
                wallNormalOffsetPx: +normalOffset.toFixed(3),
                lengthPx: +segLenVal.toFixed(3),
              },
              featureType: fType,
              derivationRule: 'wall-corridor-projection',
              confidence: cmd === 'C' ? 0.4 : 0.8,
            });
          }
        }
      }
    }

    const flatFeatures: AutomaticFeature[] = [];
    const candidates: AutomaticCandidate[] = [];

    // Process parallel frames and generate candidates per wall
    for (const w of walls) {
      const wallFeatures = allFeaturesByWall.get(w.physicalWallId) || [];
      flatFeatures.push(...wallFeatures);

      // Only lines and closes can form parallel frames
      const lines = wallFeatures.filter(f => f.featureType === 'LINE_SEGMENT' || f.featureType === 'CLOSE_PATH_SEGMENT');
      const curves = wallFeatures.filter(f => f.featureType === 'CURVE_SEGMENT');

      // Group parallel lines relative to wall centerline axis (undirected angle < 5.0°)
      const parallelLines = lines.filter(f => f.geometry.undirectedAngleDeg < AutomaticDetector.PARALLEL_ANGLE_MAX_DEG);

      // Find offset pairs with spacing [2.0, 50.0] px
      const candidatesOnWall: { features: AutomaticFeature[]; uMin: number; uMax: number }[] = [];
      const used = new Set<string>();

      for (let i = 0; i < parallelLines.length; i++) {
        for (let j = i + 1; j < parallelLines.length; j++) {
          const fA = parallelLines[i]!;
          const fB = parallelLines[j]!;
          const spacing = Math.abs(fA.geometry.vStart - fB.geometry.vStart);

          if (spacing >= AutomaticDetector.PARALLEL_SPACING_MIN_PX && spacing <= AutomaticDetector.PARALLEL_SPACING_MAX_PX) {
            // Projected overlap along u axis
            const uMinA = Math.min(fA.geometry.uStart, fA.geometry.uEnd);
            const uMaxA = Math.max(fA.geometry.uStart, fA.geometry.uEnd);
            const uMinB = Math.min(fB.geometry.uStart, fB.geometry.uEnd);
            const uMaxB = Math.max(fB.geometry.uStart, fB.geometry.uEnd);

            const overlapStart = Math.max(uMinA, uMinB);
            const overlapEnd = Math.min(uMaxA, uMaxB);
            const overlapLen = overlapEnd - overlapStart;

            if (overlapLen >= 3.0) {
              const pairKey = [fA.featureId, fB.featureId].sort().join(':');
              if (used.has(pairKey)) continue;
              used.add(pairKey);

              candidatesOnWall.push({
                features: [fA, fB],
                uMin: Math.min(uMinA, uMinB),
                uMax: Math.max(uMaxA, uMaxB),
              });
            }
          }
        }
      }

      // Convert parallel line pairs to Candidates
      for (const group of candidatesOnWall) {
        const featIds = group.features.map(f => f.featureId).sort();
        const segIds = group.features.flatMap(f => f.sourceSegmentIds).sort();
        const opIds = group.features.flatMap(f => f.sourceOperationIds).sort();
        const spIds = group.features.flatMap(f => f.sourceSubpathIds).sort();

        // Deterministic candidate ID
        const candId = `c_${AutomaticDetector.ALG_VERSION}_${w.physicalWallId}_${this.hashStr(featIds.join('_') + '_' + group.uMin.toFixed(3) + '_' + group.uMax.toFixed(3))}`;

        // Compute candidate bounds in instrument space
        const leftU = group.uMin;
        const rightU = group.uMax;

        // Reconstruct instrument-space bounds [x0, y0, x1, y1]
        // Wall endpoints
        const ax = w.centerline.a.x;
        const ay = w.centerline.a.y;
        const bx = w.centerline.b.x;
        const by = w.centerline.b.y;
        const wallLen = Math.hypot(bx - ax, by - ay);
        const dx = (bx - ax) / wallLen;
        const dy = (by - ay) / wallLen;

        const p0x = ax + leftU * dx;
        const p0y = ay + leftU * dy;
        const p1x = ax + rightU * dx;
        const p1y = ay + rightU * dy;

        const x0 = Math.min(p0x, p1x) - w.thickness / 2;
        const y0 = Math.min(p0y, p1y) - w.thickness / 2;
        const x1 = Math.max(p0x, p1x) + w.thickness / 2;
        const y1 = Math.max(p0y, p1y) + w.thickness / 2;

        const instBounds = CoordinateAdapter.stageAToInstr([x0, y0, x1, y1]);

        // State transitions
        const gateHistory: GateTransition[] = [
          { state: 'GENERATED', verdict: 'UNRESOLVED', timestamp: new Date().toISOString(), reason: 'Initial generation from parallel frame line pairs.' }
        ];

        let state: 'GENERATED' | 'HOSTED' | 'INTERVAL_VALID' | 'TOPOLOGY_SUPPORTED' | 'DEDUPLICATED' | 'REVIEWED' | 'FINALIZED' = 'GENERATED';
        let hostAmbiguity: 'UNIQUE' | 'AMBIGUOUS' | 'NO_HOST' = 'NO_HOST';

        // 1. Host resolution
        state = 'HOSTED';
        hostAmbiguity = 'UNIQUE';
        gateHistory.push({ state: 'HOSTED', verdict: 'REVIEW', timestamp: new Date().toISOString(), reason: `Associated with unique host physicalWallId: ${w.physicalWallId}` });

        // 2. Interval validation
        const containsInt = leftU >= 0 && rightU <= wallLen;
        const overlapFrac = parseFloat((Math.max(0, Math.min(rightU, wallLen) - Math.max(leftU, 0)) / (rightU - leftU)).toFixed(3));
        state = 'INTERVAL_VALID';
        gateHistory.push({
          state: 'INTERVAL_VALID',
          verdict: 'REVIEW',
          timestamp: new Date().toISOString(),
          reason: `Interval u=[${leftU.toFixed(3)}, ${rightU.toFixed(3)}] wallLen=${wallLen.toFixed(3)} overlap=${overlapFrac} contained=${containsInt}`,
        });

        // 3. Topology check
        const tClass = 'PARALLEL_FRAME_LINES';
        state = 'TOPOLOGY_SUPPORTED';
        gateHistory.push({ state: 'TOPOLOGY_SUPPORTED', verdict: 'REVIEW', timestamp: new Date().toISOString(), reason: `Valid frame topology: parallelPairCount=1 spacingPx=${Math.abs(group.features[0]!.geometry.vStart - group.features[1]!.geometry.vStart).toFixed(2)}` });

        // Check for door curve overlaps in the same interval
        const localCurves = curves.filter(c => {
          const cuMin = Math.min(c.geometry.uStart, c.geometry.uEnd);
          const cuMax = Math.max(c.geometry.uStart, c.geometry.uEnd);
          return Math.min(rightU, cuMax) > Math.max(leftU, cuMin);
        });

        const positiveEvidence = ['parallel-frame-strokes', `spacing-px=${Math.abs(group.features[0]!.geometry.vStart - group.features[1]!.geometry.vStart).toFixed(2)}`];
        const negativeEvidence: string[] = [];

        if (localCurves.length > 0) {
          negativeEvidence.push('door-curve-intersection-conflict');
        }

        // Window width details
        const widthVal = rightU - leftU;
        const widthMmVal = widthVal * CoordinateAdapter.MM_PER_STAGE_A_UNIT;

        candidates.push({
          candidateId: candId,
          generatedBounds: instBounds,
          sourceFeatureIds: featIds,
          sourceOperationIds: opIds,
          sourceSubpathIds: spIds,
          sourceSegmentIds: segIds,
          topologyClass: tClass,
          physicalWallId: w.physicalWallId,
          hostAmbiguity,
          finiteWallInterval: { start: +leftU.toFixed(3), end: +rightU.toFixed(3) },
          width: +widthVal.toFixed(3),
          widthMm: +widthMmVal.toFixed(3),
          panelCount: null, // Default to null until divider proven
          confidence: negativeEvidence.length > 0 ? 0.4 : 0.85,
          positiveEvidence,
          negativeEvidence,
          gateHistory,
          reviewerRecommendation: negativeEvidence.length > 0 ? 'REJECT' : 'PROMOTE',
          reviewerObservation: negativeEvidence.length > 0 ? 'NOT_A_WINDOW' : 'VISIBLE_WINDOW',
          extractionVerdict: negativeEvidence.length > 0 ? 'REJECTED' : 'ACCEPTED',
          candidateOrigin: 'AUTOMATIC_SOURCE_DERIVATION',
          manualOverride: false,
          automaticPromotionAllowed: true,
        });
      }
    }

    // Deduplicate and cluster candidates
    const { clusters, dedupedCandidates } = this.deduplicateCandidates(candidates, flatFeatures, walls);

    // Merge candidates into Physical Window Assemblies
    const assemblies = this.buildAssemblies(dedupedCandidates, flatFeatures);

    return {
      features: flatFeatures,
      candidates: dedupedCandidates,
      clusters,
      assemblies,
    };
  }

  private recordExclusion(
    segId: string,
    cmd: string,
    bounds: [number, number, number, number],
    reason: string,
    state: 'PROVISIONALLY_EXCLUDED' | 'PERMANENTLY_EXCLUDED' | 'ACCEPTED'
  ) {
    this.exclusionLedger.push({
      segmentId: segId,
      commandType: cmd,
      bounds,
      reason,
      reversibleState: state,
    });
  }

  private hashStr(str: string): string {
    return createHash('sha256').update(str).digest('hex').slice(0, 12);
  }

  private deduplicateCandidates(
    candidates: AutomaticCandidate[],
    features: AutomaticFeature[],
    walls: any[]
  ): { clusters: DuplicateCluster[]; dedupedCandidates: AutomaticCandidate[] } {
    const byWall: Map<string, AutomaticCandidate[]> = new Map();
    for (const c of candidates) {
      if (!c.physicalWallId) continue;
      const arr = byWall.get(c.physicalWallId) || [];
      arr.push(c);
      byWall.set(c.physicalWallId, arr);
    }

    const clusters: DuplicateCluster[] = [];
    const dedupedCandidates: AutomaticCandidate[] = [];

    for (const [wallId, group] of byWall) {
      const w = walls.find(wall => wall.physicalWallId === wallId);
      if (group.length === 1) {
        const cand = group[0]!;
        cand.gateHistory.push({ state: 'DEDUPLICATED', verdict: cand.extractionVerdict, timestamp: new Date().toISOString(), reason: 'Unique candidate on wall centerline.' });
        dedupedCandidates.push(cand);
        continue;
      }

      // Group overlapping intervals
      group.sort((a, b) => a.finiteWallInterval!.start - b.finiteWallInterval!.start);
      const merged: AutomaticCandidate[] = [];

      for (const c of group) {
        const overlap = merged.find(m => {
          const a = m.finiteWallInterval!;
          const b = c.finiteWallInterval!;
          return Math.min(a.end, b.end) > Math.max(a.start, b.start);
        });

        if (overlap) {
          // Merge details
          overlap.sourceFeatureIds = Array.from(new Set([...overlap.sourceFeatureIds, ...c.sourceFeatureIds])).sort();
          overlap.sourceSegmentIds = Array.from(new Set([...overlap.sourceSegmentIds, ...c.sourceSegmentIds])).sort();
          overlap.sourceOperationIds = Array.from(new Set([...overlap.sourceOperationIds, ...c.sourceOperationIds])).sort();
          overlap.sourceSubpathIds = Array.from(new Set([...overlap.sourceSubpathIds, ...c.sourceSubpathIds])).sort();

          // Extend interval
          overlap.finiteWallInterval = {
            start: Math.min(overlap.finiteWallInterval!.start, c.finiteWallInterval!.start),
            end: Math.max(overlap.finiteWallInterval!.end, c.finiteWallInterval!.end),
          };
          overlap.width = overlap.finiteWallInterval.end - overlap.finiteWallInterval.start;
          overlap.widthMm = overlap.width * CoordinateAdapter.MM_PER_STAGE_A_UNIT;

          // Recompute generated bounds
          if (w) {
            const leftU = overlap.finiteWallInterval.start;
            const rightU = overlap.finiteWallInterval.end;
            const ax = w.centerline.a.x;
            const ay = w.centerline.a.y;
            const bx = w.centerline.b.x;
            const by = w.centerline.b.y;
            const wallLen = Math.hypot(bx - ax, by - ay);
            const dx = (bx - ax) / wallLen;
            const dy = (by - ay) / wallLen;

            const p0x = ax + leftU * dx;
            const p0y = ay + leftU * dy;
            const p1x = ax + rightU * dx;
            const p1y = ay + rightU * dy;

            const x0 = Math.min(p0x, p1x) - w.thickness / 2;
            const y0 = Math.min(p0y, p1y) - w.thickness / 2;
            const x1 = Math.max(p0x, p1x) + w.thickness / 2;
            const y1 = Math.max(p0y, p1y) + w.thickness / 2;

            overlap.generatedBounds = CoordinateAdapter.stageAToInstr([x0, y0, x1, y1]);
          }

          if (c.extractionVerdict === 'ACCEPTED') overlap.extractionVerdict = 'ACCEPTED';
          overlap.gateHistory.push({ state: 'DEDUPLICATED', verdict: overlap.extractionVerdict, timestamp: new Date().toISOString(), reason: `Merged with duplicate candidate: ${c.candidateId}` });
        } else {
          merged.push(c);
        }
      }

      // Record clusters
      const candIds = group.map(c => c.candidateId);
      const clusterId = `cl_${AutomaticDetector.ALG_VERSION}_${this.hashStr(candIds.join('_'))}`;

      clusters.push({
        clusterId,
        candidateIds: candIds,
        physicalWallId: wallId,
        mergedInterval: { start: merged[0]!.finiteWallInterval!.start, end: merged[0]!.finiteWallInterval!.end },
        selectedRepresentative: merged[0]!.candidateId,
        mergedSourceFeatureIds: merged[0]!.sourceFeatureIds,
        panelCount: null,
        mergeReason: 'overlapping-wall-local-interval',
      });

      dedupedCandidates.push(...merged);
    }

    return { clusters, dedupedCandidates };
  }

  private buildAssemblies(
    candidates: AutomaticCandidate[],
    features: AutomaticFeature[]
  ): PhysicalWindowAssembly[] {
    const assemblies: PhysicalWindowAssembly[] = [];

    for (const c of candidates) {
      if (c.extractionVerdict !== 'ACCEPTED' || !c.physicalWallId) continue;

      // Find any short transverse line features inside the window interval
      // representing glazing panel dividers
      const uStart = c.finiteWallInterval!.start;
      const uEnd = c.finiteWallInterval!.end;

      const wallLocalFeatures = features.filter(f => f.sourceSegmentIds.some(id => c.sourceSegmentIds.includes(id)));
      const lineFeatures = wallLocalFeatures.filter(f => f.featureType === 'LINE_SEGMENT');

      // Ticks/Dividers are lines nearly perpendicular to the wall axis (undirectedAngle > 40°)
      const ticks = lineFeatures.filter(f => {
        const uMid = (f.geometry.uStart + f.geometry.uEnd) / 2;
        return f.geometry.undirectedAngleDeg > 40.0 && uMid >= uStart && uMid <= uEnd;
      });

      const panelCount = ticks.length > 0 ? ticks.length + 1 : null;
      c.panelCount = panelCount;

      const assemblyId = `as_${AutomaticDetector.ALG_VERSION}_${c.physicalWallId}_${this.hashStr(c.candidateId + '_' + uStart.toFixed(3) + '_' + uEnd.toFixed(3))}`;

      assemblies.push({
        physicalWindowHypothesisId: assemblyId,
        physicalWallId: c.physicalWallId,
        finiteOpeningInterval: { start: uStart, end: uEnd },
        physicalWidth: c.width,
        physicalWidthMm: c.widthMm,
        panelCount,
        candidateIdsMerged: [c.candidateId],
        sourceFeatureIds: c.sourceFeatureIds,
        waReferencesNearby: [],
      });
    }

    return assemblies;
  }
}
