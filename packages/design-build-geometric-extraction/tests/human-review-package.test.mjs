import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Portable root: resolved relative to this test file (tests/ -> package root)
const GEOM_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(GEOM_ROOT, 'evidence', 'code06', 'human-window-review', 'anonymized-manifest.json');

test('Human Review Package Integrity', async (t) => {
  await t.test('manifest exists and parses correctly', () => {
    assert.ok(existsSync(MANIFEST_PATH), 'Anonymized manifest should exist on disk');
    const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    assert.ok(raw.shuffleHash, 'Manifest must have a shuffleHash');
    assert.ok(Array.isArray(raw.manifest), 'Manifest must contain an array of items');
    assert.equal(raw.manifest.length, 66, 'Should contain exactly 66 hypotheses');
  });

  await t.test('every hypothesis is unique and represented exactly once', () => {
    const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const ids = raw.manifest.map(m => m.hypothesisId);
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, 66, 'All 66 hypothesisIds must be unique in the manifest');
  });

  await t.test('target leakage prevention: no expected count or WA count is visible in items', () => {
    const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    for (const item of raw.manifest) {
      assert.equal(item.expectedWindowCount, undefined, 'expectedWindowCount must be undefined');
      assert.equal(item.targetWindowCount, undefined, 'targetWindowCount must be undefined');
      assert.equal(item.waReferenceCount, undefined, 'waReferenceCount must be undefined');
    }
  });

  await t.test('target leakage prevention: model verdicts and confidence scores are stripped or hidden', () => {
    const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    for (const item of raw.manifest) {
      assert.equal(item.confidence, undefined, 'confidence scores must not be present');
      assert.equal(item.reviewerObservation, undefined, 'reviewerObservation must be hidden');
    }
  });

  await t.test('deterministic shuffle is stable', () => {
    const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const auditIds = raw.manifest.map(m => m.auditId);
    // Audit IDs must be sequential 1..66
    const expectedIds = Array.from({ length: 66 }, (_, i) => i + 1);
    assert.deepEqual(auditIds, expectedIds, 'Audit IDs must be in sequential order after deterministic shuffle');
  });
});
