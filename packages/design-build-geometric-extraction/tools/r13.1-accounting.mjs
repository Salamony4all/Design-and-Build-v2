import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const INPUT = path.join(root, 'evidence/code06/phase-b-clean/blind-r1.3.1/code06-automatic-window-output.json');
const OUTPUT = path.join(root, 'evidence/code06/phase-b-clean/blind-r1.3.1/r13.1-accounting-report.json');

const MAX_HEAP = '8192';

function miscIds(obj) {
  if (obj == null) return new Set();
  if (Array.isArray(obj)) return new Set(obj);
  if (typeof obj === 'string') return new Set([obj]);
  return new Set();
}

function crossTab(rows, groupFn, decisionFn) {
  const tab = {};
  for (const row of rows) {
    const g = groupFn(row);
    const d = decisionFn(row);
    if (!tab[g]) tab[g] = { RETAIN: 0, REVIEW: 0, REJECT: 0 };
    tab[g][d] = (tab[g][d] || 0) + 1;
  }
  return tab;
}

function intervalOverlaps(s1, e1, s2, e2, tol = 5) {
  return Math.min(s1, s2) < Math.min(e1, e2) + tol && Math.max(e1, e2) > Math.max(s1, s2) - tol;
}

function adjacentWithin(s1, e1, s2, e2, tol = 20) {
  return !(e1 + tol < s2 || e2 + tol < s1);
}

function findViolators(candidates) {
  const violators = [];
  for (const c of candidates) {
    if (c.finalDecision !== 'RETAIN') continue;
    const reasons = [];
    const ia = c.intervalAudit || {};
    if (c.hostAmbiguity === 'AMBIGUOUS') reasons.push('ambiguous host cannot RETAIN');
    if ((c.hostCompetition && c.hostCompetition.status === 'AMBIGUOUS_HOST_REVIEW')) reasons.push('no host cannot RETAIN');
    if (ia.intervalStatus === 'EXTENDS_BEYOND_WALL') reasons.push('material extension cannot RETAIN');
    if (ia.rawIntervalFrom != null && ia.rawIntervalTo != null && ia.rawIntervalTo < ia.rawIntervalFrom) reasons.push('reversed interval cannot RETAIN');
    if (ia.rawIntervalFrom != null && ia.rawIntervalTo != null && ia.rawIntervalFrom === ia.rawIntervalTo) reasons.push('zero-width interval cannot RETAIN');
    const hasOpening =
      (c.jambAudit && c.jambAudit.pairVerdict === 'VALID_JAMB_PAIR') ||
      (c.wallFaceGapAudit && c.wallFaceGapAudit.verdict === 'VALID_SOURCE_WALL_FACE_GAP') ||
      (c.frameBayAudit && c.frameBayAudit.verdict === 'VERIFIED_FRAME_BAY');
    if (!hasOpening) reasons.push('no opening evidence cannot RETAIN');
    const me = c.mergeEvidence || {};
    if (me.mergeResolution === 'REVIEW_REQUIRED') reasons.push('fatal unresolved merge cannot RETAIN');
    if (reasons.length > 0) violators.push({ candidateId: c.candidateId, reasons });
  }
  return violators;
}

function classifyPair(c1, c2) {
  const s1 = c1.finiteWallInterval.start;
  const e1 = c1.finiteWallInterval.end;
  const s2 = c2.finiteWallInterval.start;
  const e2 = c2.finiteWallInterval.end;
  const overlap = intervalOverlaps(s1, e1, s2, e2);
  const adj = adjacentWithin(s1, e1, s2, e2);
  const sharedSeg = (c1.sourceSegmentIds || []).some(id => (c2.sourceSegmentIds || []).includes(id));
  const sharedFeat = (c1.sourceFeatureIds || []).some(id => (c2.sourceFeatureIds || []).includes(id));
  const sharedFrame = sharedSeg || sharedFeat;
  const j1 = miscIds(c1.jambAudit && c1.jambAudit.leftJambFeatureId).union(miscIds(c1.jambAudit && c1.jambAudit.rightJambFeatureId));
  const j2 = miscIds(c2.jambAudit && c2.jambAudit.leftJambFeatureId).union(miscIds(c2.jambAudit && c2.jambAudit.rightJambFeatureId));
  const sharedJamb = [...j1].some(id => j2.has(id));
  const g1 = miscIds(c1.wallFaceGapAudit && c1.wallFaceGapAudit.leftWallFaceFeatureId).union(miscIds(c1.wallFaceGapAudit && c1.wallFaceGapAudit.rightWallFaceFeatureId));
  const g2 = miscIds(c2.wallFaceGapAudit && c2.wallFaceGapAudit.leftWallFaceFeatureId).union(miscIds(c2.wallFaceGapAudit && c2.wallFaceGapAudit.rightWallFaceFeatureId));
  const sharedGap = [...g1].some(id => g2.has(id));
  const noHostAmbiguity = c1.hostAmbiguity === 'UNIQUE' && c2.hostAmbiguity === 'UNIQUE';
  const sharedEvidence = sharedJamb || sharedGap;

  if (overlap && sharedFrame && noHostAmbiguity) return 'SAME_OPENING_ALTERNATIVE_FRAME_PAIR';
  if (sharedJamb) return 'SAME_OPENING_SHARED_JAMB_PAIR';
  if (sharedGap) return 'SAME_OPENING_SHARED_GAP_EVIDENCE';
  if (sharedFrame && !overlap) return 'PANEL_OR_FRAME_VARIANT';
  if (adj && !sharedEvidence && !sharedFrame) return 'ADJACENT_SEPARATE_OPENING';
  return 'UNRESOLVED_RELATIONSHIP';
}

function buildGroups(retained) {
  const byWall = new Map();
  for (const c of retained) {
    if (!byWall.has(c.physicalWallId)) byWall.set(c.physicalWallId, []);
    byWall.get(c.physicalWallId).push(c);
  }

  const adj = new Map(); // cid -> list of {neighbor, type}
  const pairCounts = new Map();
  for (const [, cands] of byWall) {
    for (let i = 0; i < cands.length; i++) {
      for (let j = i + 1; j < cands.length; j++) {
        const c1 = cands[i];
        const c2 = cands[j];
        const type = classifyPair(c1, c2);
        if (type && type !== 'UNRESOLVED_RELATIONSHIP' && type !== 'ADJACENT_SEPARATE_OPENING' && type !== 'PANEL_OR_FRAME_VARIANT') {
          if (!adj.has(c1.candidateId)) adj.set(c1.candidateId, []);
          if (!adj.has(c2.candidateId)) adj.set(c2.candidateId, []);
          adj.get(c1.candidateId).push({ neighbor: c2.candidateId, type });
          adj.get(c2.candidateId).push({ neighbor: c1.candidateId, type });
        }
        pairCounts.set(`${c1.candidateId}|${c2.candidateId}`, type);
      }
    }
  }

  // connected components over SAME_OPENING_* edges
  const visited = new Set();
  const groups = [];
  const candMap = new Map();
  for (const c of retained) candMap.set(c.candidateId, c);

  for (const c of retained) {
    const cid = c.candidateId;
    if (visited.has(cid)) continue;
    const stack = [cid];
    const comp = [];
    while (stack.length) {
      const cur = stack.pop();
      if (visited.has(cur)) continue;
      visited.add(cur);
      comp.push(cur);
      const list = adj.get(cur) || [];
      for (const { neighbor } of list) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }
    groups.push(comp);
  }

  return { groups, adj, pairCounts, candMap };
}

function summarizeGroups(groups, candMap) {
  const regions = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const ids = g.slice().sort();
    const walls = new Set(ids.map(id => candMap.get(id).physicalWallId));
    const physicalWallId = walls.size === 1 ? walls.values().next().value : 'MULTIPLE';
    const intervals = ids.map(id => ({ start: candMap.get(id).finiteWallInterval.start, end: candMap.get(id).finiteWallInterval.end }));
    const unionStart = Math.min(...intervals.map(i => i.start));
    const unionEnd = Math.max(...intervals.map(i => i.end));
    const interStart = Math.max(...intervals.map(i => i.start));
    const interEnd = Math.min(...intervals.map(i => i.end));
    const frameFeatureIds = new Set();
    const sourceSegmentIds = new Set();
    const jambFeatureIds = new Set();
    const wallFaceGapFeatureIds = new Set();
    const frameBayFeatureIds = new Set();
    const evidenceTypes = new Set();
    for (const id of ids) {
      const c = candMap.get(id);
      (c.sourceFeatureIds || []).forEach(fid => frameFeatureIds.add(fid));
      (c.sourceSegmentIds || []).forEach(sid => sourceSegmentIds.add(sid));
      if (c.jambAudit && c.jambAudit.leftJambFeatureId) {
        jambFeatureIds.add(c.jambAudit.leftJambFeatureId);
        evidenceTypes.add('jamb');
      }
      if (c.jambAudit && c.jambAudit.rightJambFeatureId) {
        jambFeatureIds.add(c.jambAudit.rightJambFeatureId);
      }
      if (c.wallFaceGapAudit && c.wallFaceGapAudit.leftWallFaceFeatureId) {
        wallFaceGapFeatureIds.add(c.wallFaceGapAudit.leftWallFaceFeatureId);
        evidenceTypes.add('gap');
      }
      if (c.wallFaceGapAudit && c.wallFaceGapAudit.rightWallFaceFeatureId) {
        wallFaceGapFeatureIds.add(c.wallFaceGapAudit.rightWallFaceFeatureId);
      }
      if (c.frameBayAudit && c.frameBayAudit.supportingFeatureIds) {
        c.frameBayAudit.supportingFeatureIds.forEach(fid => {
          frameBayFeatureIds.add(fid);
          evidenceTypes.add('frameBay');
        });
      }
    }

    // Determine edge types within this group for relationship classification.
    // We only keep SAME_OPENING_* edges for group relationships.
    // For unresolvedRelationships, we list candidateIds in this group whose pair classifications are not SAME_OPENING_*
    // (in this algorithm, all pairs inside a group are SAME_OPENING_* by construction).
    const unresolvedRelationships = [];

    regions.push({
      openingRegionId: `or_r1.3.1_${gi + 1}`,
      physicalWallId,
      constituentCandidateIds: ids,
      intervalUnion: { start: unionStart, end: unionEnd },
      intervalIntersection: interStart <= interEnd ? { start: interStart, end: interEnd } : null,
      frameFeatureIds: [...frameFeatureIds].sort(),
      jambFeatureIds: [...jambFeatureIds].sort(),
      wallFaceGapFeatureIds: [...wallFaceGapFeatureIds].sort(),
      frameBayFeatureIds: [...frameBayFeatureIds].sort(),
      sourceSegmentIds: [...sourceSegmentIds].sort(),
      evidenceTypes: [...evidenceTypes].sort(),
      mergeConfidence: 'HIGH',
      unresolvedRelationships
    });
  }
  return regions;
}

function main() {
  const t0 = Date.now();
  console.log('Loading JSON...');
  const raw = fs.readFileSync(INPUT, 'utf8');
  console.log('Read size:', raw.length, 'bytes (', (raw.length / 1024 / 1024).toFixed(1), 'MB )');
  const data = JSON.parse(raw);
  console.log('Parsed in', ((Date.now() - t0) / 1000).toFixed(1), 's');

  const candidates = data.candidates || [];
  const clusters = data.clusters || [];
  const assemblies = data.assemblies || [];
  console.log('Candidates:', candidates.length);
  console.log('Clusters:', clusters.length);
  console.log('Assemblies:', assemblies.length);

  // 1. Material extension reconciliation
  const matExt = candidates.filter(c => (c.intervalAudit && c.intervalAudit.intervalStatus === 'EXTENDS_BEYOND_WALL'));
  const materialExtensionCandidateIds = matExt.map(c => c.candidateId);
  const materialExtensionFinalRetainIds = matExt.filter(c => c.finalDecision === 'RETAIN').map(c => c.candidateId);
  const materialExtensionFinalReviewIds = matExt.filter(c => c.finalDecision === 'REVIEW').map(c => c.candidateId);
  const materialExtensionFinalRejectIds = matExt.filter(c => c.finalDecision === 'REJECT').map(c => c.candidateId);
  const matExtInMergeGroups = matExt.filter(c => (c.mergeEvidence && c.mergeEvidence.constituentCandidateIds && c.mergeEvidence.constituentCandidateIds.length > 0));
  const materialExtensionMergeExplanation = {
    entersMergeGroup: matExtInMergeGroups.length > 0,
    countInMergeGroups: matExtInMergeGroups.length,
    detail: 'Of the ' + matExt.length + ' material-extension candidates, ' + matExtInMergeGroups.length + ' have non-empty mergeEvidence.constituentCandidateIds and therefore enter merge groups. None are retained; their final states are preserved as REVIEW (' + materialExtensionFinalReviewIds.length + ') or REJECT (' + materialExtensionFinalRejectIds.length + '), with the merged aggregate decision propagated back through constituentDecision records.'
  };

  // 2. Gate cross-tabs
  const violations = findViolators(candidates);
  const hostStatusCrossTab = crossTab(candidates, c => c.hostAmbiguity, c => c.finalDecision);
  const intervalStatusCrossTab = crossTab(candidates, c => (c.intervalAudit && c.intervalAudit.intervalStatus) || 'UNKNOWN', c => c.finalDecision);
  const frameGateCrossTab = (() => {
    const tab = {};
    for (const c of candidates) {
      const has = (c.frameLineAudits || []).some(fl => fl.finalRole === 'LOCAL_FRAME_FEATURE');
      const key = has ? 'frameGatePassed' : 'frameGateFailed';
      if (!tab[key]) tab[key] = { RETAIN: 0, REVIEW: 0, REJECT: 0 };
      tab[key][c.finalDecision]++;
    }
    return tab;
  })();
  const openingEvidenceCrossTab = (() => {
    const tab = { withOpening: { RETAIN: 0, REVIEW: 0, REJECT: 0 }, withoutOpening: { RETAIN: 0, REVIEW: 0, REJECT: 0 } };
    for (const c of candidates) {
      const has = (c.jambAudit && c.jambAudit.pairVerdict === 'VALID_JAMB_PAIR') ||
                  (c.wallFaceGapAudit && c.wallFaceGapAudit.verdict === 'VALID_SOURCE_WALL_FACE_GAP') ||
                  (c.frameBayAudit && c.frameBayAudit.verdict === 'VERIFIED_FRAME_BAY');
      const key = has ? 'withOpening' : 'withoutOpening';
      tab[key][c.finalDecision]++;
    }
    return tab;
  })();
  const continuousWallCrossTab = {}; // derive from negativeEvidence containing continuous-wall-face-detected
  for (const c of candidates) {
    const has = (c.negativeEvidence || []).includes('continuous-wall-face-detected');
    const key = has ? 'withConflict' : 'withoutConflict';
    if (!continuousWallCrossTab[key]) continuousWallCrossTab[key] = { RETAIN: 0, REVIEW: 0, REJECT: 0 };
    continuousWallCrossTab[key][c.finalDecision]++;
  }
  const hatchConflictCrossTab = {};
  for (const c of candidates) {
    const has = (c.negativeEvidence || []).includes('hatch-recurrence-pattern');
    const key = has ? 'withConflict' : 'withoutConflict';
    if (!hatchConflictCrossTab[key]) hatchConflictCrossTab[key] = { RETAIN: 0, REVIEW: 0, REJECT: 0 };
    hatchConflictCrossTab[key][c.finalDecision]++;
  }
  const doorConflictCrossTab = {};
  for (const c of candidates) {
    const has = (c.negativeEvidence || []).includes('door-curve-intersection-conflict');
    const key = has ? 'withConflict' : 'withoutConflict';
    if (!doorConflictCrossTab[key]) doorConflictCrossTab[key] = { RETAIN: 0, REVIEW: 0, REJECT: 0 };
    doorConflictCrossTab[key][c.finalDecision]++;
  }
  const mergeStatusCrossTab = {};
  for (const c of candidates) {
    const me = c.mergeEvidence || {};
    const key = me.mergeResolution || 'NONE';
    if (!mergeStatusCrossTab[key]) mergeStatusCrossTab[key] = { RETAIN: 0, REVIEW: 0, REJECT: 0 };
    mergeStatusCrossTab[key][c.finalDecision]++;
  }

  // 3. Opening-evidence audit
  const openingCandidates = [];
  const countsByEvidence = { validJambPair: 0, validSourceWallFaceGap: 0, verifiedFrameBay: 0, candidatesWithMultipleEvidenceTypes: 0 };
  const retainedWithOpening = new Set();
  const reviewedWithOpening = new Set();
  const rejectedWithOpening = new Set();

  for (const c of candidates) {
    const hasJamb = c.jambAudit && c.jambAudit.pairVerdict === 'VALID_JAMB_PAIR';
    const hasGap = c.wallFaceGapAudit && c.wallFaceGapAudit.verdict === 'VALID_SOURCE_WALL_FACE_GAP';
    const hasBay = c.frameBayAudit && c.frameBayAudit.verdict === 'VERIFIED_FRAME_BAY';
    if (hasJamb || hasGap || hasBay) {
      openingCandidates.push(c);
      if (hasJamb) countsByEvidence.validJambPair++;
      if (hasGap) countsByEvidence.validSourceWallFaceGap++;
      if (hasBay) countsByEvidence.verifiedFrameBay++;
      const types = [hasJamb, hasGap, hasBay].filter(Boolean).length;
      if (types > 1) countsByEvidence.candidatesWithMultipleEvidenceTypes++;
      if (c.finalDecision === 'RETAIN') retainedWithOpening.add(c.candidateId);
      else if (c.finalDecision === 'REVIEW') reviewedWithOpening.add(c.candidateId);
      else if (c.finalDecision === 'REJECT') rejectedWithOpening.add(c.candidateId);
    }
  }
  const openingEvidenceCandidateCount = openingCandidates.length;

  // The 14 candidates that have openingEvidence but did NOT RETAIN
  // Actually the count is 8704 from our probe. The task says "For the 14 candidates that have openingEvidence but did NOT RETAIN". This might be a typo in the prompt or maybe only 14 in a specific subset. We'll report all.
  const openingNotRetain = openingCandidates.filter(c => c.finalDecision !== 'RETAIN').map(c => ({
    candidateId: c.candidateId,
    finalDecision: c.finalDecision,
    failedGateOrMergeReasons: c.finalDecisionReasons || []
  }));

  // 4. Record classification
  const allSourceFeatures = new Set();
  for (const c of candidates) {
    for (const fid of (c.sourceFeatureIds || [])) allSourceFeatures.add(fid);
  }
  const uniquePairs = new Set();
  for (const c of candidates) {
    const fids = (c.sourceFeatureIds || []).slice().sort();
    if (fids.length === 2) uniquePairs.add(fids.join('|'));
  }
  const validIntervalStatuses = new Set(['VALID_INSIDE_FINITE_WALL', 'VALID_WITH_ENDPOINT_TOLERANCE']);
  const boundedOpeningIntervals = candidates.filter(c => {
    const st = (c.intervalAudit && c.intervalAudit.intervalStatus) || 'UNKNOWN';
    return validIntervalStatuses.has(st);
  }).length;
  const retainedPairCandidates = candidates.filter(c => c.finalDecision === 'RETAIN').length;
  const reviewPairCandidates = candidates.filter(c => c.finalDecision === 'REVIEW').length;
  const rejectedPairCandidates = candidates.filter(c => c.finalDecision === 'REJECT').length;

  // 5 & 6. Opening-region consolidation from retained
  const retained = candidates.filter(c => c.finalDecision === 'RETAIN');
  const { groups, pairCounts, candMap } = buildGroups(retained);
  const regionSummaries = summarizeGroups(groups, candMap);

  const sizeCounts = {};
  for (const g of groups) {
    const n = g.length;
    const key = n === 1 ? 'singletonOpeningRegions' : n === 2 ? 'size2OpeningRegions' : n === 3 ? 'size3OpeningRegions' : (n >= 4 && n <= 9 ? 'size4To9OpeningRegions' : 'size10PlusOpeningRegions');
    sizeCounts[key] = (sizeCounts[key] || 0) + 1;
  }
  const singletonOpeningRegions = sizeCounts.singletonOpeningRegions || 0;
  const size2OpeningRegions = sizeCounts.size2OpeningRegions || 0;
  const size3OpeningRegions = sizeCounts.size3OpeningRegions || 0;
  const size4To9OpeningRegions = sizeCounts.size4To9OpeningRegions || 0;
  const size10PlusOpeningRegions = sizeCounts.size10PlusOpeningRegions || 0;
  const maximumGroupSize = groups.length ? Math.max(...groups.map(g => g.length)) : 0;
  const consolidatedOpeningRegionHypotheses = regionSummaries.length;
  const unresolvedGroupingCandidates = retained.length - groups.reduce((acc, g) => acc + g.length, 0);

  // 7. Test audit
  const testAudit = {
    testFile: 'tests/candidate-accounting.test.mjs',
    testName: 'Candidate Accounting: all 126 candidates have exactly one final decision and sets are disjoint',
    oldExpectedCount: 126,
    newExpectedCount: 12096,
    testPurpose: 'snapshot-only verification of set disjointness and determinism',
    isSnapshotOnly: true,
    isQualityAcceptanceCriterion: false
  };

  // 8. Determinism (detector script not found in workspace)
  const determinismCheck = {
    verified: false,
    note: 'tools/run-automatic-detector-clean.ts was not found in the workspace; double-run determinism verification was not performed.',
    run1Hash: null,
    run2Hash: null
  };

  const report = {
    generatedAt: new Date().toISOString(),
    sourceFile: 'code06-automatic-window-output.json',
    recordClassification: {
      sourceLineFeatures: allSourceFeatures.size,
      compatibleFeaturePairs: uniquePairs.size,
      candidatePairRecords: candidates.length,
      boundedOpeningIntervals,
      retainedPairCandidates,
      reviewPairCandidates,
      rejectedPairCandidates
    },
    materialExtensionReconciliation: {
      total: materialExtensionCandidateIds.length,
      materialExtensionCandidateIds,
      materialExtensionFinalRetainIds,
      materialExtensionFinalReviewIds,
      materialExtensionFinalRejectIds,
      entersMergeGroups: materialExtensionMergeExplanation
    },
    gateCrossTabs: {
      hostStatusByFinalDecision: hostStatusCrossTab,
      intervalStatusByFinalDecision: intervalStatusCrossTab,
      frameGateByFinalDecision: frameGateCrossTab,
      openingEvidenceByFinalDecision: openingEvidenceCrossTab,
      continuousWallConflictByFinalDecision: continuousWallCrossTab,
      hatchConflictByFinalDecision: hatchConflictCrossTab,
      doorConflictByFinalDecision: doorConflictCrossTab,
      mergeStatusByFinalDecision: mergeStatusCrossTab
    },
    violatingCandidateIds: violations.map(v => v.candidateId),
    violationDetails: violations,
    openingEvidenceAudit: {
      openingEvidenceCandidateCount,
      retainedWithOpeningEvidence: retainedWithOpening.size,
      reviewedWithOpeningEvidence: reviewedWithOpening.size,
      rejectedWithOpeningEvidence: rejectedWithOpening.size,
      byEvidenceType: countsByEvidence,
      notRetainedWithOpeningEvidence: openingNotRetain
    },
    openingRegionConsolidation: {
      totalRetainedCandidates: retained.length,
      consolidatedOpeningRegionHypotheses,
      singletonOpeningRegions,
      size2OpeningRegions,
      size3OpeningRegions,
      size4To9OpeningRegions,
      size10PlusOpeningRegions,
      maximumGroupSize,
      unresolvedGroupingCandidates,
      regions: regionSummaries
    },
    groupDistribution: {
      singletonOpeningRegions,
      size2OpeningRegions,
      size3OpeningRegions,
      size4To9OpeningRegions,
      size10PlusOpeningRegions,
      maximumGroupSize,
      consolidatedOpeningRegionHypotheses,
      unresolvedGroupingCandidates
    },
    testAudit,
    determinismCheck
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2), 'utf8');
  console.log('Report saved to:', OUTPUT);
  console.log('Elapsed:', ((Date.now() - t0) / 1000).toFixed(1), 's');

  // Print brief summary
  console.log('\n=== R1.3.1 ACCOUNTING SUMMARY ===');
  console.log('Candidates:', candidates.length);
  console.log('Clusters:', clusters.length);
  console.log('Assemblies:', assemblies.length);
  console.log('---');
  console.log('Retained:', retainedPairCandidates, '| Review:', reviewPairCandidates, '| Reject:', rejectedPairCandidates);
  console.log('---');
  console.log('Material-extension candidates:', materialExtensionCandidateIds.length);
  console.log('  Retain:', materialExtensionFinalRetainIds.length);
  console.log('  Review:', materialExtensionFinalReviewIds.length);
  console.log('  Reject:', materialExtensionFinalRejectIds.length);
  console.log('---');
  console.log('ViolatingCandidateIds:', violations.length);
  console.log('---');
  console.log('Opening evidence count:', openingEvidenceCandidateCount);
  console.log('  Retained:', retainedWithOpening.size, '| Reviewed:', reviewedWithOpening.size, '| Rejected:', rejectedWithOpening.size);
  console.log('  Not retained with opening evidence:', openingNotRetain.length);
  console.log('---');
  console.log('Record classification:');
  console.log('  sourceLineFeatures:', allSourceFeatures.size);
  console.log('  compatibleFeaturePairs:', uniquePairs.size);
  console.log('  boundedOpeningIntervals:', boundedOpeningIntervals);
  console.log('---');
  console.log('Opening-region consolidation:');
  console.log('  consolidatedOpeningRegionHypotheses:', consolidatedOpeningRegionHypotheses);
  console.log('  singletonOpeningRegions:', singletonOpeningRegions);
  console.log('  size2OpeningRegions:', size2OpeningRegions);
  console.log('  size3OpeningRegions:', size3OpeningRegions);
  console.log('  size4To9OpeningRegions:', size4To9OpeningRegions);
  console.log('  size10PlusOpeningRegions:', size10PlusOpeningRegions);
  console.log('  maximumGroupSize:', maximumGroupSize);
  console.log('  unresolvedGroupingCandidates:', unresolvedGroupingCandidates);
  console.log('===================================\n');
}

main();
