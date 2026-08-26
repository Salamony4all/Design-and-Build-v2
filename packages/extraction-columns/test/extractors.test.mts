import test from 'node:test';
import assert from 'node:assert/strict';
import { extractColumns } from '../src/columns.ts';
import { loadUnclaimedGeometry } from '../src/fixture.ts';

// Build a closed rectangle as 4 explicit segments (4 corners + closing edge).
const rect = (x: number, y: number, w: number, d: number, prefix = 's') =>
  (['a', 'b', 'c', 'd'] as const).map((t, i) => {
    const pts = [[x, y], [x + w, y], [x + w, y + d], [x, y + d], [x, y]];
    return { id: `${prefix}_${t}`, a: { x: pts[i][0], y: pts[i][1] }, b: { x: pts[i + 1][0], y: pts[i + 1][1] } };
  });
// Open polyline (implicitly-closed filled path): 3 edges, closing edge implied.
const rectImplicit = (x: number, y: number, w: number, d: number, prefix = 's') =>
  (['a', 'b', 'c'] as const).map((t, i) => {
    const pts = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
    return { id: `${prefix}_${t}`, a: { x: pts[i][0], y: pts[i][1] }, b: { x: pts[i + 1][0], y: pts[i + 1][1] } };
  });
const poly = (n: number, r: number, prefix = 'p', closed = true) => {
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
  if (closed) pts.push(pts[0]);
  return pts.slice(1).map((p, i) => ({ id: `${prefix}_${i}`, a: { x: pts[i][0], y: pts[i][1] }, b: { x: p[0], y: p[1] } }));
};
const geo = (segments: any[], mmPerUnit = 1, claimedIdx: number[] = []) =>
  ({
    segments: segments.map((s, i) => (claimedIdx.includes(i) ? { ...s, claimedBy: 'wall' } : s)),
    curves: [], mmPerUnit, sourceHash: 'synthetic',
  });

// 1. duplicate source-edge collapse: two overlapping squares at the same spot.
test('duplicate source-edge collapse yields one column', () => {
  const a = rect(0, 0, 400, 400, 'a');
  const b = rect(0, 0, 400, 400, 'b'); // identical footprint, different ids
  const cols = extractColumns(geo([...a, ...b]));
  assert.equal(cols.length, 1);
  assert.equal(cols[0].footprintType, 'RECTANGULAR');
});

// 2. explicit four-edge square -> ACCEPT
test('explicit four-edge square becomes ACCEPT column', () => {
  const cols = extractColumns(geo(rect(0, 0, 460, 460, 'col')));
  assert.equal(cols.length, 1);
  assert.equal(cols[0].footprintType, 'RECTANGULAR');
  assert.equal(cols[0].verdict, 'ACCEPT');
  assert.equal(cols[0].pascal.nodeType, 'column');
});

// 3. implicitly closed square (open polyline) -> ACCEPT
test('implicitly closed square becomes ACCEPT column', () => {
  const cols = extractColumns(geo(rectImplicit(0, 0, 460, 460, 'col')));
  assert.equal(cols.length, 1);
  assert.equal(cols[0].footprintType, 'RECTANGULAR');
  assert.equal(cols[0].verdict, 'ACCEPT');
});

// 4. rectangular column (representative 0.46x0.46) -> ACCEPT
test('rectangular column 0.46x0.46 is ACCEPT', () => {
  const cols = extractColumns(geo(rect(0, 0, 460, 460, 'col')));
  assert.ok(cols.some((c) => c.footprintType === 'RECTANGULAR' && c.verdict === 'ACCEPT'));
});

// 5. pilaster (elongated rectangle, aspect between accept and review) -> REVIEW
test('pilaster elongated rectangle becomes REVIEW', () => {
  const cols = extractColumns(geo(rect(0, 0, 500, 1050, 'pil')), {}); // aspect 2.1
  assert.ok(cols.some((c) => c.footprintType === 'RECTANGULAR' && c.verdict === 'REVIEW'));
});

// 6. circular column -> REVIEW (curved columns deferred)
test('circular footprint becomes REVIEW', () => {
  const cols = extractColumns(geo(poly(16, 300)));
  assert.ok(cols.some((c) => c.footprintType === 'CIRCULAR' && c.verdict === 'REVIEW'));
});

// 7. polygonal column -> REVIEW
test('polygonal footprint becomes REVIEW', () => {
  const cols = extractColumns(geo(poly(6, 300)));
  assert.ok(cols.some((c) => c.footprintType === 'POLYGONAL' && c.verdict === 'REVIEW'));
});

// 8. title-block rejection (large rect far above maxSizeM) -> not a column
test('title-block / oversized rectangle is rejected', () => {
  const cols = extractColumns(geo(rect(0, 0, 3000, 2000, 'tb')));
  assert.equal(cols.filter((c) => c.footprintType === 'RECTANGULAR').length, 0);
});

// 9. structural-envelope rejection (huge open rectangle) -> not a column
test('structural envelope outline is rejected', () => {
  const cols = extractColumns(geo(rect(0, 0, 8000, 5000, 'env')));
  assert.equal(cols.filter((c) => c.footprintType === 'RECTANGULAR').length, 0);
});

// 10. furniture footprint rejection (below minSizeM) -> not a column
test('small furniture footprint is rejected', () => {
  const cols = extractColumns(geo(rect(0, 0, 100, 100, 'fur')));
  assert.equal(cols.filter((c) => c.footprintType === 'RECTANGULAR').length, 0);
});

// 11. claimed-vector exclusion: segments marked claimedBy are skipped
test('claimed vectors are excluded (ownership invariant)', () => {
  const segs = rect(0, 0, 460, 460, 'c');
  const cols = extractColumns(geo(segs, 1, [0, 1, 2, 3])); // all claimed
  assert.equal(cols.length, 0);
});

// 12. deterministic rerun yields identical IDs
test('deterministic rerun yields identical physicalColumnId', () => {
  const a = extractColumns(geo(rect(0, 0, 460, 460, 'col')));
  const b = extractColumns(geo(rect(0, 0, 460, 460, 'col')));
  assert.equal(a[0].physicalColumnId, b[0].physicalColumnId);
  assert.equal(a[0].deterministicExtractionId, b[0].deterministicExtractionId);
});

// 13. real fixture: claimed wall/window/door vectors excluded (ownership invariant)
test('real fixture: no column derives from claimed geometry', () => {
  const g = loadUnclaimedGeometry();
  assert.ok(g.segments.every((s) => !s.claimedBy));
  const cols = extractColumns(g);
  // every accepted/review column must have non-empty source from unclaimed geometry
  assert.ok(cols.every((c) => Array.isArray(c.sourceSegmentIds) && c.sourceSegmentIds.length > 0));
});
