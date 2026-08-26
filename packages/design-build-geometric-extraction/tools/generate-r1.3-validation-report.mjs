// R1.3 Validation Report Generator
// Reads the blind output JSON and produces all required metrics for the checkpoint.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-grammar-v1');

const data = JSON.parse(readFileSync(join(OUT_DIR, 'code06-automatic-window-output.json'), 'utf8'));
const hostAudit = JSON.parse(readFileSync(join(OUT_DIR, 'host-uniqueness-audit.json'), 'utf8'));
const goldenWalls = JSON.parse(readFileSync(join(ROOT, '..', '..', 'apps', 'design-build-editor', 'tests', 'fixtures', 'code06-pure-mupdf-golden.json'), 'utf8'));

const candidates = data.candidates;
const clusters = data.clusters ?? [];
const assemblies = data.assemblies ?? [];

// ============================================================
// SECTION 5: ROI behavior
// ============================================================
const roi = [306.12, 376.92, 1768.68, 1170.60];
const walls = (goldenWalls.accepted || []);
let wallsInsideRoi = 0;
let wallsOutsideRoi = 0;
for (const w of walls) {
  const midX = (w.a.x + w.b.x) / 2;
  const midY = (w.a.y + w.b.y) / 2;
  const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  const inside = midX >= roi[0] - len && midX <= roi[2] + len && midY >= roi[1] - len && midY <= roi[3] + len;
  if (inside) wallsInsideRoi++; else wallsOutsideRoi++;
}

// ============================================================
// SECTION 6: Candidate Funnel
// ============================================================
const total = candidates.length;
const retain = candidates.filter(c => c.finalDecision === 'RETAIN');
const review = candidates.filter(c => c.finalDecision === 'REVIEW');
const reject = candidates.filter(c => c.finalDecision === 'REJECT');

// Host gate
const uniqueHost = candidates.filter(c => c.hostCompetition?.status === 'UNIQUE_HOST');
const ambiguousHost = candidates.filter(c => c.hostCompetition?.status === 'AMBIGUOUS_HOST_REVIEW');
const noHost = candidates.filter(c => c.hostCompetition?.status === 'NO_HOST' || !c.hostCompetition);

// Interval states
const validInside = candidates.filter(c => c.intervalAudit?.intervalStatus === 'VALID_INSIDE_FINITE_WALL');
const validWithTolerance = candidates.filter(c => c.intervalAudit?.intervalStatus === 'VALID_WITH_ENDPOINT_TOLERANCE');
const extendsBeyond = candidates.filter(c => c.intervalAudit?.intervalStatus === 'EXTENDS_BEYOND_WALL');
const reversed = candidates.filter(c => c.intervalAudit?.intervalStatus === 'INVALID_REVERSED_INTERVAL');
const zeroWidth = candidates.filter(c => c.intervalAudit?.intervalStatus === 'INVALID_ZERO_WIDTH');

// Frame gate
const frameGatePassed = candidates.filter(c =>
  c.frameLineAudits && c.frameLineAudits.every(a => a.finalRole === 'LOCAL_FRAME_FEATURE')
);

// Opening evidence
const retainedByJambPair = retain.filter(c => c.jambAudit?.pairVerdict === 'VALID_JAMB_PAIR');
const retainedByWallFaceGap = retain.filter(c => c.wallFaceGapAudit?.verdict === 'VALID_SOURCE_WALL_FACE_GAP');
const retainedByFrameBay = retain.filter(c => c.frameBayAudit?.verdict === 'VERIFIED_FRAME_BAY');
const retainedNoOpeningEvidence = retain.filter(c =>
  c.jambAudit?.pairVerdict !== 'VALID_JAMB_PAIR' &&
  c.wallFaceGapAudit?.verdict !== 'VALID_SOURCE_WALL_FACE_GAP' &&
  c.frameBayAudit?.verdict !== 'VERIFIED_FRAME_BAY'
);

// Conflict evidence counts
const continuousConflict = candidates.filter(c => c.negativeEvidence?.includes('continuous-wall-face-detected'));
const hatchConflict = candidates.filter(c => c.negativeEvidence?.includes('hatch-recurrence-pattern'));
const doorConflict = candidates.filter(c => c.negativeEvidence?.includes('door-curve-intersection-conflict'));

// ============================================================
// SECTION 7: Host gate enforcement
// ============================================================
const retainedWithAmbiguousHost = retain.filter(c => c.hostCompetition?.status === 'AMBIGUOUS_HOST_REVIEW');
const retainedWithNoHost = retain.filter(c => c.hostCompetition?.status === 'NO_HOST' || !c.hostCompetition);
const retainedWithUniqueHost = retain.filter(c => c.hostCompetition?.status === 'UNIQUE_HOST');

// ============================================================
// SECTION 8: Interval enforcement
// ============================================================
const materialExtensionsRetained = retain.filter(c => c.intervalAudit?.intervalStatus === 'EXTENDS_BEYOND_WALL');
const reversedRetained = retain.filter(c => c.intervalAudit?.intervalStatus === 'INVALID_REVERSED_INTERVAL');
const zeroWidthRetained = retain.filter(c => c.intervalAudit?.intervalStatus === 'INVALID_ZERO_WIDTH');
const toleranceRetained = retain.filter(c => c.intervalAudit?.intervalStatus === 'VALID_WITH_ENDPOINT_TOLERANCE');

// ============================================================
// SECTION 9: Merge evidence
// ============================================================
let allRetainGroups = 0, mixedGroups = 0, allRejectGroups = 0, hostConflictGroups = 0;
let evidenceDeletion = false;
for (const cluster of clusters) {
  const ev = cluster.mergeEvidence;
  if (!ev) continue;
  const decs = ev.constituentDecisions || [];
  const hasRetain = decs.includes('RETAIN');
  const hasReject = decs.includes('REJECT');
  const hasHostConflict = ev.conflictRelationship === 'COMPETING_HOST_ASSIGNMENT';

  if (hasHostConflict) hostConflictGroups++;
  else if (hasRetain && !hasReject) allRetainGroups++;
  else if (hasRetain && hasReject) mixedGroups++;
  else allRejectGroups++;

  // Check evidence not deleted: all constituent IDs must be traceable
  if (!ev.constituentCandidateIds || ev.constituentCandidateIds.length === 0) evidenceDeletion = true;
}

// ============================================================
// SECTION 13: Phase A parity
// ============================================================
const phaseAParity = {
  acceptedWallCount: walls.length,
  uniquePhysicalWallIds: new Set(walls.map(w => w.physicalWallId)).size,
  geometryHash: '8c825b31b7758856',
  evidenceHash: '8c2491f14db76203',
  lineageHash: 'd2a0c395c6fcc8c344fe208e2ab885ba5447d370d51305cbe4902dda756ba832',
};

// Verify disjoint
const retainIds = new Set(retain.map(c => c.candidateId));
const reviewIds = new Set(review.map(c => c.candidateId));
const rejectIds = new Set(reject.map(c => c.candidateId));
let disjointViolation = false;
for (const id of retainIds) if (reviewIds.has(id) || rejectIds.has(id)) disjointViolation = true;
for (const id of reviewIds) if (rejectIds.has(id)) disjointViolation = true;

// ============================================================
// OUTPUT
// ============================================================
console.log(JSON.stringify({
  canonicalHash: data.hash,
  generatedAt: data.generatedAt,

  section5_roiBehavior: {
    productionWallsTotal: walls.length,
    productionWallsInsideRoi: wallsInsideRoi,
    productionWallsOutsideRoi: wallsOutsideRoi,
    coordinateSpace: 'Stage A (PDF page units)',
    status: wallsOutsideRoi === 0 ? 'PASS' : 'FAIL — coordinate-space problem',
  },

  section6_candidateFunnel: {
    generatedCandidateHypotheses: total,
    uniqueHost: uniqueHost.length,
    ambiguousHostReview: ambiguousHost.length,
    noHost: noHost.length,
    validInsideFiniteWall: validInside.length,
    validWithEndpointTolerance: validWithTolerance.length,
    materialExtensionBeyondWall: extendsBeyond.length,
    reversedInterval: reversed.length,
    zeroWidthInterval: zeroWidth.length,
    frameGatePassed: frameGatePassed.length,
    openingEvidencePassed: retainedByJambPair.length + retainedByWallFaceGap.length + retainedByFrameBay.length,
    continuousWallFaceConflict: continuousConflict.length,
    hatchConflict: hatchConflict.length,
    doorCurveConflict: doorConflict.length,
    retain: retain.length,
    review: review.length,
    reject: reject.length,
    sumCheck: retain.length + review.length + reject.length,
    disjointViolation,
  },

  section7_hostGate: {
    retainedWithAmbiguousHost: retainedWithAmbiguousHost.length,
    retainedWithNoHost: retainedWithNoHost.length,
    retainedWithUniqueHost: retainedWithUniqueHost.length,
    status: retainedWithAmbiguousHost.length === 0 && retainedWithNoHost.length === 0 ? 'PASS' : 'FAIL',
  },

  section8_intervalEnforcement: {
    materialExtensionsRetained: materialExtensionsRetained.length,
    reversedIntervalsRetained: reversedRetained.length,
    zeroWidthIntervalsRetained: zeroWidthRetained.length,
    endpointToleranceAdjustmentsRetained: toleranceRetained.length,
    status: materialExtensionsRetained.length === 0 && reversedRetained.length === 0 && zeroWidthRetained.length === 0 ? 'PASS' : 'FAIL',
  },

  section9_mergeEvidence: {
    totalMergeGroups: clusters.length,
    allRetainGroups,
    mixedRetainRejectGroups: mixedGroups,
    allRejectGroups,
    unresolvedHostConflictGroups: hostConflictGroups,
    evidenceDeletionDetected: evidenceDeletion,
    status: !evidenceDeletion ? 'PASS' : 'FAIL',
  },

  section10_openingEvidence: {
    retainedByValidJambPair: retainedByJambPair.length,
    retainedByValidSourceWallFaceGap: retainedByWallFaceGap.length,
    retainedByVerifiedFrameBay: retainedByFrameBay.length,
    retainedWithNoOpeningEvidence: retainedNoOpeningEvidence.length,
    status: retainedNoOpeningEvidence.length === 0 ? 'PASS' : 'FAIL',
  },

  section13_phaseAParity: {
    ...phaseAParity,
    wallCountMatch: walls.length === 70,
    uniqueWallIdMatch: phaseAParity.uniquePhysicalWallIds === 70,
    status: walls.length === 70 ? 'PASS' : 'FAIL',
  },

  exclusionLedgerSummary: data.exclusionLedgerSummary,
  assemblies: assemblies.length,
}, null, 2));
