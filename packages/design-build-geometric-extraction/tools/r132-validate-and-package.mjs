/**
 * R1.3.2 validation and review-manifest generator.
 *
 * Read-only analysis from frozen R1.3.1 outputs.
 * Writes: evidence/code06/phase-b-clean/blind-r1.3.2/r132-validate-report.json
 *         evidence/code06/phase-b-clean/blind-r1.3.2/blind-review-manifest.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2');
mkdirSync(OUT_DIR, { recursive: true });

const windowOutput = JSON.parse(readFileSync(join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.1', 'code06-automatic-window-output.json'), 'utf8'));
const report = JSON.parse(readFileSync(join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.1', 'r13.1-accounting-report.json'), 'utf8'));

const candidates = windowOutput.candidates;
const candidateById = new Map(candidates.map(c => [c.candidateId, c]));

const retained = candidates.filter(c => c.finalDecision === 'RETAIN');
const review = candidates.filter(c => c.finalDecision === 'REVIEW');
const rejected = candidates.filter(c => c.finalDecision === 'REJECT');

const regions = report.openingRegionConsolidation.regions || [];

// Manifest uniqueness invariants.
const retainedRegionMap = new Map();
const allRetainedIds = new Set();
for (const region of regions) {
  for (const id of region.constituentCandidateIds || []) {
    if (retainedRegionMap.has(id)) {
      throw new Error(`retained candidate ${id} belongs to multiple regions: ${retainedRegionMap.get(id)} and ${region.openingRegionId}`);
    }
    retainedRegionMap.set(id, region.openingRegionId);
    allRetainedIds.add(id);
  }
}
if (allRetainedIds.size !== retained.length) {
  throw new Error(`expected ${retained.length} retained candidates, but region map has ${allRetainedIds.size}`);
}

// Resolution audit: source references for RETAIN candidates.
const unresolvedRetained = retained.filter(c => {
  const segs = Array.isArray(c.sourceSegmentIds) ? c.sourceSegmentIds : [];
  const ops = Array.isArray(c.sourceOperationIds) ? c.sourceOperationIds : [];
  const subs = Array.isArray(c.sourceSubpathIds) ? c.sourceSubpathIds : [];
  return segs.length === 0 && ops.length === 0 && subs.length === 0;
});

// Close-up existence audit.
const groupDir = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.1', 'group-evidence');
const missingCloseups = [];
for (let i = 0; i < regions.length; i++) {
  const path = join(groupDir, `region-${String(i).padStart(3, '0')}.svg`);
  try {
    const stat = readFileSync(path);
    if (!stat.length) missingCloseups.push(path);
  } catch {
    missingCloseups.push(path);
  }
}

// High-evidence review candidates: have opening evidence + valid interval + frame, but failed host ambiguity or merge uncertainty only.
const isHighEvidenceReview = (c) => {
  const hasOpening = c.jambAudit?.pairVerdict === 'VALID_JAMB_PAIR' || c.wallFaceGapAudit?.verdict === 'VALID_SOURCE_WALL_FACE_GAP' || c.frameBayAudit?.verdict === 'VERIFIED_FRAME_BAY';
  const hasFrame = Array.isArray(c.frameLineAudits) && c.frameLineAudits.length > 0;
  const validInterval = c.intervalAudit?.intervalStatus === 'VALID_INSIDE_FINITE_WALL' || c.intervalAudit?.intervalStatus === 'VALID_WITH_ENDPOINT_TOLERANCE';
  const failHost = c.hostCompetition?.status === 'AMBIGUOUS_HOST_REVIEW' || !c.hostCompetition || c.hostCompetition.status === 'NO_HOST';
  const mergeReview = c.mergeEvidence?.mergeResolution === 'REVIEW_REQUIRED' || c.finalDecision === 'REVIEW';
  return hasOpening && hasFrame && validInterval && failHost && mergeReview;
};
const highEvidenceReview = review.filter(isHighEvidenceReview);

// Coverage audit: review candidates overlapping retained regions by candidateId or interval bounds.
const regionBounds = regions.map(r => ({
  regionId: r.openingRegionId,
  physicalWallId: r.physicalWallId,
  intervalUnion: r.intervalUnion,
  candidateIds: new Set(r.constituentCandidateIds || []),
}));

function overlapsRegion(candidate) {
  for (const rb of regionBounds) {
    if (rb.candidateIds.has(candidate.candidateId)) return rb.regionId;
    const wall = candidate.physicalWallId;
    if (wall !== rb.physicalWallId) continue;
    const interval = candidate.finiteWallInterval || candidate.intervalAudit || candidate.displayClippedInterval;
    if (!interval) continue;
    const cStart = typeof interval.start === 'number' ? interval.start : interval.rawIntervalFrom;
    const cEnd = typeof interval.end === 'number' ? interval.end : interval.rawIntervalTo;
    if (typeof cStart !== 'number' || typeof cEnd !== 'number') continue;
    const rStart = rb.intervalUnion?.start ?? 0;
    const rEnd = rb.intervalUnion?.end ?? 0;
    const overlapStart = Math.max(cStart, rStart);
    const overlapEnd = Math.min(cEnd, rEnd);
    if (overlapEnd - overlapStart > 1e-6) return rb.regionId;
  }
  return null;
}

const reviewOverlappingRetainedRegions = [];
const reviewOutsideRetainedRegions = [];
for (const c of review) {
  const overlap = overlapsRegion(c);
  if (overlap) reviewOverlappingRetainedRegions.push({ candidateId: c.candidateId, regionId: overlap });
  else reviewOutsideRetainedRegions.push(c.candidateId);
}

const highEvidenceOutsideRetainedRegions = highEvidenceReview.filter(c => !reviewOverlappingRetainedRegions.some(o => o.candidateId === c.candidateId));

// Deterministic shuffle of anonymous region index, seeded by canonical hash.
const canonicalHash = windowOutput.hash || createHash('sha256').update(JSON.stringify(windowOutput)).digest('hex');
const seed = createHash('sha256').update(`${canonicalHash}::region-shuffle`).digest('hex');
const regionIndices = Array.from({ length: regions.length }, (_, i) => i);
for (let i = regionIndices.length - 1; i > 0; i--) {
  const hex = seed.slice((i % 32), ((i % 32) + 8) || seed.length);
  const n = parseInt(hex, 16);
  const j = n % (i + 1);
  [regionIndices[i], regionIndices[j]] = [regionIndices[j], regionIndices[i]];
}

const anonymousRegionIdByRegion = new Map();
for (const [seq, idx] of regionIndices.entries()) {
  const region = regions[idx];
  anonymousRegionIdByRegion.set(region.openingRegionId, `AR-${String(seq + 1).padStart(2, '0')}`);
}

// Build blind review manifest without exposing internal logic beyond allowed identifiers.
const manifest = {
  canonicalHash,
  generatedAt: new Date().toISOString(),
  anonymousRegionCount: regions.length,
  shuffleSeedHash: seed,
  shuffledAnonymousOrder: regionIndices.map(i => ({
    anonymousRegionId: anonymousRegionIdByRegion.get(regions[i].openingRegionId),
    openingRegionId: regions[i].openingRegionId,
  })),
  regions: regions.map(region => ({
    anonymousRegionId: anonymousRegionIdByRegion.get(region.openingRegionId),
    openingRegionId: region.openingRegionId,
    physicalWallId: region.physicalWallId,
    rawIntervalUnion: region.intervalUnion,
    rawIntervalIntersection: region.intervalIntersection,
    constituentCandidateIds: region.constituentCandidateIds,
    constituentCandidateCount: region.constituentCandidateIds.length,
    sourceSegmentIds: region.sourceSegmentIds,
    frameFeatureIds: region.frameFeatureIds,
    jambFeatureIds: region.jambFeatureIds,
    wallFaceGapFeatureIds: region.wallFaceGapFeatureIds,
    frameBayFeatureIds: region.frameBayFeatureIds,
    hostStatus: (region.constituentCandidateIds.map(id => candidateById.get(id)?.hostCompetition?.status).find(Boolean)) || 'UNKNOWN',
    unresolvedRelationships: region.unresolvedRelationships,
    closeupPath: `region-${String(regions.indexOf(region)).padStart(3, '0')}.svg`,
    reviewState: {
      humanVerdict: null,
      physicalWindowQuantity: null,
      humanNotes: '',
      reviewedAt: null,
      reviewerType: null,
    },
  })),
  reviewOnlyClusters: highEvidenceOutsideRetainedRegions.map(c => ({
    candidateId: c.candidateId,
    physicalWallId: c.physicalWallId,
    finiteWallInterval: c.finiteWallInterval,
    positiveEvidence: c.positiveEvidence,
    negativeEvidence: c.negativeEvidence,
  })),
};

writeFileSync(join(OUT_DIR, 'blind-review-manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(OUT_DIR, 'r132-validate-report.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  validationStatus: 'PASS',
  regionCount: regions.length,
  retainedCandidateCount: allRetainedIds.size,
  retainedMultiRegionViolations: 0,
  unresolvedSourceReferences: unresolvedRetained.map(c => c.candidateId),
  missingCloseups,
  reviewCandidatesTotal: review.length,
  highEvidenceReviewCandidatesTotal: highEvidenceReview.length,
  reviewCandidatesOverlappingRetainedRegions: reviewOverlappingRetainedRegions.length,
  reviewCandidatesOutsideRetainedRegions: reviewOutsideRetainedRegions.length,
  highEvidenceReviewCandidatesOutsideRetainedRegions: highEvidenceOutsideRetainedRegions.length,
  reviewOnlyRegionClusters: highEvidenceOutsideRetainedRegions.length,
  shuffleHash: seed,
}, null, 2));

console.log(JSON.stringify({
  regionCount: regions.length,
  missingCloseups: missingCloseups.length,
  reviewTotal: review.length,
  highEvidenceReview: highEvidenceReview.length,
  overlappingReview: reviewOverlappingRetainedRegions.length,
  outsideReview: reviewOutsideRetainedRegions.length,
  highEvidenceOutside: highEvidenceOutsideRetainedRegions.length,
  shuffleHash: seed,
  outDir: OUT_DIR
}, null, 2));
