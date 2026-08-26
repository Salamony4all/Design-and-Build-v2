import test from 'node:test';
import assert from 'node:assert/strict';
import { extractColumns } from '../src/columns.ts';
import { loadUnclaimedGeometry } from '../src/fixture.ts';

test('real fixture: columns extraction runs and emits Pascal ColumnNode-compatible drafts', () => {
  const c = extractColumns(loadUnclaimedGeometry());
  assert.ok(c.length > 0, 'expected some column candidates from the canonical drawing');
  const a = c[0];
  assert.ok(a.deterministicExtractionId);
  assert.equal(a.pascal.nodeType, 'column');
  assert.ok(['RECTANGULAR', 'CIRCULAR', 'POLYGONAL'].includes(a.footprintType));
  assert.ok(Array.isArray(a.sourceSegmentIds));
  assert.ok(Array.isArray(a.sourceOperationIds));
  assert.ok(a.centreProjectM && Number.isFinite(a.centreProjectM.x));
  assert.ok(Number.isFinite(a.rotationRad));
  // columns must never be represented as short walls (verdict REVIEW for non-rectangular)
  assert.ok(c.some((x) => x.footprintType === 'RECTANGULAR'));
});

test('real fixture: deterministic rerun yields identical accepted ids', () => {
  const a = extractColumns(loadUnclaimedGeometry()).map((x) => x.deterministicExtractionId).sort();
  const b = extractColumns(loadUnclaimedGeometry()).map((x) => x.deterministicExtractionId).sort();
  assert.deepEqual(a, b);
});
