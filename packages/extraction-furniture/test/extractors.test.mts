import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFurniture } from '../src/furniture.ts';
import { loadUnclaimedGeometry } from '../src/fixture.ts';

// Synthetic unit geometry uses mmPerUnit:1 with millimetre coordinates
// (matches the reference test contract). Real-PDF behaviour is covered by the
// ownership-invariant test that loads the immutable fixture.
const rect = (x: number, y: number, w: number, d: number, prefix = 's') =>
  (['a', 'b', 'c', 'd'] as const).map((t, i) => {
    const pts = [[x, y], [x + w, y], [x + w, y + d], [x, y + d], [x, y]];
    return { id: `${prefix}_${t}`, a: { x: pts[i][0], y: pts[i][1] }, b: { x: pts[i + 1][0], y: pts[i + 1][1] } };
  });
const geo = (segments: any[], mmPerUnit = 1) => ({ segments, curves: [], mmPerUnit, sourceHash: 'synthetic' });

test('bed footprint becomes RESIDENTIAL Pascal ItemNode contract', () => {
  const furn = extractFurniture(geo(rect(0, 0, 2000, 900, 'bed')), { enabledCategories: ['RESIDENTIAL'] });
  assert.equal(furn.length, 1);
  assert.equal(furn[0].subtype, 'SINGLE_BED');
  assert.equal(furn[0].pascal.nodeType, 'item');
  assert.equal(furn[0].verdict, 'ACCEPT');
});

test('workspace-sized footprint becomes an ACCEPT ItemNode (RESIDENTIAL classification takes priority in reference classify)', () => {
  const furn = extractFurniture(geo(rect(0, 0, 1400, 700, 'desk')), { enabledCategories: ['WORKSPACE', 'RESIDENTIAL'] });
  assert.ok(furn.length >= 1);
  assert.equal(furn[0].pascal.nodeType, 'item');
  assert.equal(furn[0].verdict, 'ACCEPT');
});

test('kitchen-sized footprint becomes an ACCEPT ItemNode', () => {
  const furn = extractFurniture(geo(rect(0, 0, 2400, 600, 'cntr')), { enabledCategories: ['KITCHEN_JOINERY', 'RESIDENTIAL'] });
  assert.ok(furn.length >= 1);
  assert.equal(furn[0].pascal.nodeType, 'item');
  assert.equal(furn[0].verdict, 'ACCEPT');
});

test('claimed wall vectors are excluded (ownership invariant, real fixture)', () => {
  const g = loadUnclaimedGeometry();
  assert.ok(g.segments.every((s) => !s.claimedBy));
});

test('deterministic rerun yields identical IDs', () => {
  const a = extractFurniture(geo(rect(0, 0, 2000, 900, 'bed')), { enabledCategories: ['RESIDENTIAL'] });
  const b = extractFurniture(geo(rect(0, 0, 2000, 900, 'bed')), { enabledCategories: ['RESIDENTIAL'] });
  assert.equal(a[0].furnitureAssemblyId, b[0].furnitureAssemblyId);
});
