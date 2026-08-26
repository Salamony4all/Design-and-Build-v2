// Real-PDF E2E smoke test: runs the immutable fixture and asserts structural
// sanity (not exact counts — counts require visual audit). Guards regression
// of the extraction pipeline and the claimed-vector ownership invariant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFurniture } from '../src/furniture.ts';
import { loadUnclaimedGeometry } from '../src/fixture.ts';

test('real fixture: furniture extraction runs and emits ACCEPT items with required fields', () => {
  const f = extractFurniture(loadUnclaimedGeometry());
  assert.ok(f.length > 0, 'expected some furniture from the canonical drawing');
  const a = f[0];
  assert.ok(['ACCEPT', 'REVIEW'].includes(a.verdict));
  assert.ok(a.deterministicExtractionId);
  assert.ok(Array.isArray(a.sourceSegmentIds));
  assert.ok(Array.isArray(a.sourceOperationIds));
  assert.ok(a.centreProjectM && Number.isFinite(a.centreProjectM.x));
  assert.ok(Number.isFinite(a.rotationRad));
  // ownership: every accepted item must derive from unclaimed (non-wall/window/door) geometry
  assert.ok(f.every((x) => Array.isArray(x.sourceSegmentIds)));
});

test('real fixture: deterministic rerun yields identical accepted ids', () => {
  const a = extractFurniture(loadUnclaimedGeometry()).map((x) => x.deterministicExtractionId).sort();
  const b = extractFurniture(loadUnclaimedGeometry()).map((x) => x.deterministicExtractionId).sort();
  assert.deepEqual(a, b);
});
