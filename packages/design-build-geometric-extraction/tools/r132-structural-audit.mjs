/**
 * R1.3.2 structural over-merge audit.
 *
 * Read-only analysis from frozen R1.3.1 outputs.
 * Writes: evidence/code06/phase-b-clean/blind-r1.3.2/r132-structural-audit.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2');
mkdirSync(OUT_DIR, { recursive: true });

const windowOutput = JSON.parse(readFileSync(join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.1', 'code06-automatic-window-output.json'), 'utf8'));
const report = JSON.parse(readFileSync(join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.1', 'r13.1-accounting-report.json'), 'utf8'));

const candidates = windowOutput.candidates;
const candidateById = new Map(candidates.map(c => [c.candidateId, c]));

const regions = report.openingRegionConsolidation.regions || [];

function disjointIntervals(rc) {
  const intervals = [];
  for (const c of rc) {
    const interval = c.finiteWallInterval || c.intervalAudit || c.displayClippedInterval;
    const start = typeof interval?.start === 'number' ? interval.start : interval?.rawIntervalFrom;
    const end = typeof interval?.end === 'number' ? interval.end : interval?.rawIntervalTo;
    if (typeof start === 'number' && typeof end === 'number') intervals.push([start, end]);
  }
  if (!intervals.length) return { count: 0, gaps: [] };
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  let disjointCount = 1;
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1][1];
    const currStart = sorted[i][0];
    if (currStart - prevEnd > 5) {
      disjointCount++;
      gaps.push({ from: prevEnd, to: currStart, gap: +(currStart - prevEnd).toFixed(3) });
    }
  }
  return { count: disjointCount, gaps };
}

function connectedSourceComponents(rc) {
  const sets = new Map();
  function find(x) {
    while (sets.has(x)) x = sets.get(x);
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) sets.set(ra, rb);
  }
  const segToCand = new Map();
  for (const c of rc) {
    for (const seg of (c.sourceSegmentIds || [])) {
      segToCand.set(seg, [...(segToCand.get(seg) || []), c.candidateId]);
    }
  }
  for (const ids of segToCand.values()) {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }
  const roots = new Set(rc.map(c => find(c.candidateId)));
  return roots.size;
}

const audit = regions.map(region => {
  const ids = region.constituentCandidateIds || [];
  const rc = ids.map(id => candidateById.get(id)).filter(Boolean);
  const intervals = disjointIntervals(rc);
  const frameCount = rc.reduce((acc, c) => acc + (Array.isArray(c.frameLineAudits) ? c.frameLineAudits.length : 0), 0);
  const jambCount = rc.filter(c => c.jambAudit?.pairVerdict === 'VALID_JAMB_PAIR').length;
  const gapCount = rc.filter(c => c.wallFaceGapAudit?.verdict === 'VALID_SOURCE_WALL_FACE_GAP').length;
  const bayCount = rc.filter(c => c.frameBayAudit?.verdict === 'VERIFIED_FRAME_BAY').length;
  const connectedComponents = connectedSourceComponents(rc);
  const highEvidenceCount = rc.filter(c => {
    const hasOpening = c.jambAudit?.pairVerdict === 'VALID_JAMB_PAIR' || c.wallFaceGapAudit?.verdict === 'VALID_SOURCE_WALL_FACE_GAP' || c.frameBayAudit?.verdict === 'VERIFIED_FRAME_BAY';
    const validInterval = c.intervalAudit?.intervalStatus === 'VALID_INSIDE_FINITE_WALL' || c.intervalAudit?.intervalStatus === 'VALID_WITH_ENDPOINT_TOLERANCE';
    return hasOpening && validInterval;
  }).length;
  let structuralClassification;
  if (intervals.count > 2 && intervals.gaps.length >= 2) structuralClassification = 'MULTIPLE_SEPARATE_INTERVALS';
  else if (intervals.count >= 2 && highEvidenceCount > 3) structuralClassification = 'MULTI_PANEL_ASSEMBLY';
  else if (intervals.count >= 2 && intervals.gaps.length === 0) structuralClassification = 'OVERLAPPING_ALTERNATIVE_FRAME_PAIRS';
  else if (disjointIntervals(rc).count === 0 && connectedComponents > 1) structuralClassification = 'POSSIBLE_OVER_MERGE';
  else if (rc.length <= 1) structuralClassification = 'ONE_BOUNDED_OPENING';
  else structuralClassification = 'UNRESOLVED_STRUCTURE';
  return {
    regionId: region.openingRegionId,
    physicalWallId: region.physicalWallId,
    constituentCandidateCount: rc.length,
    disjointIntervalCount: intervals.count,
    intervalGaps: intervals.gaps,
    frameBayCount: bayCount,
    jambPairCount: jambCount,
    connectedSourceComponents: connectedComponents,
    structuralClassification,
    intervalUnion: region.intervalUnion,
    intervalIntersection: region.intervalIntersection,
    evidenceTypes: region.evidenceTypes,
  };
});

writeFileSync(join(OUT_DIR, 'r132-structural-audit.json'), JSON.stringify({ generatedAt: new Date().toISOString(), regions: audit }, null, 2));
console.log(JSON.stringify({ regions: audit.length, classifications: audit.map(r => r.structuralClassification) }, null, 2));
