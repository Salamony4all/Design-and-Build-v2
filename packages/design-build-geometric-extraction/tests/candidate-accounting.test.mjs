import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Portable root: resolved relative to this test file (tests/ -> package root)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = path.join(ROOT, 'evidence/code06/phase-b-clean/blind-grammar-v1/code06-automatic-window-output.json');
const HOST_AUDIT_PATH = path.join(ROOT, 'evidence/code06/phase-b-clean/blind-grammar-v1/host-uniqueness-audit.json');
const RECONCILIATION_PATH = path.join(ROOT, 'evidence/code06/phase-b-clean/blind-grammar-v1/assignments-reconciliation.json');

test('Candidate Accounting: all candidates have exactly one final decision and sets are disjoint', () => {
  const data = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  const candidates = data.candidates;

  const retained = candidates.filter(c => c.extractionVerdict === 'ACCEPTED');
  const rejected = candidates.filter(c => c.extractionVerdict === 'REJECTED');
  const review = candidates.filter(c => c.extractionVerdict === 'REVIEW');

  // Assert we have candidates
  assert.ok(candidates.length > 0);

  // Assert disjoint sets
  const retainedIds = new Set(retained.map(c => c.candidateId));
  const rejectedIds = new Set(rejected.map(c => c.candidateId));
  const reviewIds = new Set(review.map(c => c.candidateId));

  for (const id of retainedIds) {
    assert.ok(!rejectedIds.has(id), `ID ${id} is both ACCEPTED and REJECTED`);
    assert.ok(!reviewIds.has(id), `ID ${id} is both ACCEPTED and REVIEW`);
  }
  for (const id of rejectedIds) {
    assert.ok(!reviewIds.has(id), `ID ${id} is both REJECTED and REVIEW`);
  }

  // Assert total sum matches
  assert.equal(retained.length + rejected.length + review.length, candidates.length);
});

test('Candidate Accounting: mandatory gate failure prevents retention', () => {
  const data = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  const candidates = data.candidates;

  for (const c of candidates) {
    if (c.extractionVerdict === 'ACCEPTED') {
      // Must not have any fatal negative evidence conflicts
      assert.equal(c.negativeEvidence.length, 0);
    } else if (c.extractionVerdict === 'REJECTED') {
      // Must have at least one fatal negative evidence conflict
      assert.ok(c.negativeEvidence.length > 0);
    }
  }
});

test('Candidate Accounting: raw and clipped interval states are distinct', () => {
  const data = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  const candidates = data.candidates;

  for (const c of candidates) {
    const audit = c.intervalAudit;
    if (audit) {
      const isOutside = audit.rawIntervalFrom < 0 || audit.rawIntervalTo > audit.wallLength;
      if (isOutside) {
        // Clipped interval must be different from raw interval
        assert.ok(
          audit.clippedIntervalFrom !== audit.rawIntervalFrom ||
          audit.clippedIntervalTo !== audit.rawIntervalTo
        );
      }
    }
  }
});

test('Candidate Accounting: source segment/wall assignments are unique', () => {
  const recon = JSON.parse(fs.readFileSync(RECONCILIATION_PATH, 'utf8'));
  assert.equal(recon.duplicateSegmentWallPairs, 0);
  for (const detail of recon.segmentDetails) {
    assert.equal(detail.duplicateAssignmentsPerWall, 0);
  }
});

test('Candidate Accounting: host ambiguity is not forced to unique', () => {
  const hostAudit = JSON.parse(fs.readFileSync(HOST_AUDIT_PATH, 'utf8'));
  const ambiguous = hostAudit.filter(h => h.hostStatus === 'AMBIGUOUS_HOST_REVIEW');
  const unique = hostAudit.filter(h => h.hostStatus === 'UNIQUE_HOST');

  // Assert we have detected ambiguous hosts (e.g. near corners/junctions)
  assert.ok(ambiguous.length > 0);
});

test('Candidate Accounting: no physical-window terminology is emitted for unreviewed hypotheses', () => {
  const data = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  // Ensure fields are named candidate hypotheses and not physical windows
  assert.ok(!data.hasOwnProperty('physicalWindows'));
  assert.ok(!data.hasOwnProperty('acceptedWindows'));
});
