// Change Set 4 — window/door/furniture evidence tests (isolated package).
// Runs on Node >= 23.6 / 24 (native TypeScript type-stripping): the .ts
// extractor modules are imported directly with relative specifiers.
import test from 'node:test';
import assert from 'node:assert/strict';

import { extractWindowCandidates } from '../src/window/window-extractor.ts';
import { extractDoorCandidates } from '../src/door/door-extractor.ts';

const src = (id) => ({ primitiveIds: [id], rootIds: [`root:${id}`], page: 0 });

/** Horizontal host wall along y=0, t=0 at x=0, t=1 at x=100. */
const wall = {
  id: 'wall-1',
  centerline: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
  thickness: 2,
  length: 100,
  source: src('wall-1'),
  confidence: 0.95,
};

/** Two near-parallel frame/glazing strokes inside the wall corridor. */
const windowComponent = {
  id: 'cmp-window',
  bounds: [20, -0.5, 30, 0.5],
  points: [
    { x: 20, y: -0.5 },
    { x: 30, y: -0.5 },
    { x: 30, y: 0.5 },
    { x: 20, y: 0.5 },
  ],
  closed: false,
  curves: 0,
  lines: 3,
  strokeWidth: 0.3,
  source: src('cmp-window'),
};

/** Synthetic closed slender rect = door leaf, hinged near (49.7, 0). */
const leafComponent = {
  id: 'cmp-leaf',
  bounds: [49.7, 0, 50.3, 8],
  points: [
    { x: 49.7, y: 0 },
    { x: 50.3, y: 0 },
    { x: 50.3, y: 8 },
    { x: 49.7, y: 8 },
  ],
  closed: true,
  curves: 0,
  lines: 4,
  strokeWidth: 0.3,
  source: src('cmp-leaf'),
};

/** Synthetic quarter-circle swing arc, center ~hinge, radius 8. */
const arcComponent = {
  id: 'cmp-arc',
  bounds: [50, 0, 58, 8],
  points: [
    { x: 50, y: 8 },
    { x: 55.66, y: 5.66 },
    { x: 58, y: 0 },
  ],
  closed: false,
  curves: 1,
  lines: 0,
  strokeWidth: 0.3,
  source: src('cmp-arc'),
};

test('window candidate requires hosted interval with to > from', () => {
  const [w] = extractWindowCandidates([windowComponent], [wall]);
  assert.ok(w, 'window candidate emitted');
  assert.equal(w.verdict, 'accepted');
  assert.equal(w.hostWallId, 'wall-1');
  assert.ok(w.interval, 'hosted interval present');
  assert.ok(w.interval.to > w.interval.from, 'finite interval to > from');
  assert.ok(w.interval.from >= 0 && w.interval.to <= 1, 't in [0,1]');
  assert.ok(w.reasons.includes('parallel-frame-glazing-strokes'));
});

test('window is rejected without a host wall', () => {
  const [w] = extractWindowCandidates([windowComponent], []);
  assert.ok(w, 'candidate still reported as evidence');
  assert.equal(w.verdict, 'rejected');
  assert.equal(w.hostWallId, null);
  assert.equal(w.interval, null);
  assert.ok(w.reasons.includes('no-host-wall'));
});

test('door contract preserves opening: interval to - from > 0', () => {
  const [d] = extractDoorCandidates([leafComponent, arcComponent], [wall]);
  assert.ok(d, 'door candidate emitted');
  assert.equal(d.verdict, 'accepted');
  assert.equal(d.hostWallId, 'wall-1');
  assert.ok(d.interval, 'hosted interval present');
  assert.ok(d.interval.to - d.interval.from > 0, 'opening width preserved');
  assert.ok(d.interval.width > 0);
});

test('door swing arc is detected (leaf + hinge-mated arc)', () => {
  const [d] = extractDoorCandidates([leafComponent, arcComponent], [wall]);
  assert.ok(d.swing, 'swing evidence present');
  assert.equal(d.swing.arcComponentId, 'cmp-arc');
  assert.ok(d.swing.sweepRadians >= Math.PI / 6, 'plausible sweep angle');
  assert.ok(Math.abs(d.swing.radius - 8) < 1e-9, 'radius = leaf length');
  assert.ok(['left', 'right', 'unknown'].includes(d.handed));
  assert.ok(d.reasons.includes('swing-arc'));
});

test('window rejects hinge/leaf/swing topology (curves)', () => {
  const windows = extractWindowCandidates([arcComponent, leafComponent], [wall]);
  assert.equal(windows.length, 0, 'arc and closed leaf never become windows');
});

test('lone swing arc without leaf is not a door (annotation guard)', () => {
  const doors = extractDoorCandidates([arcComponent], [wall]);
  assert.equal(doors.length, 0);
});

test('furniture-like closed blob is neither window nor door', () => {
  const furniture = {
    id: 'cmp-chair',
    bounds: [70, 10, 74, 14],
    points: [
      { x: 70, y: 10 },
      { x: 74, y: 10 },
      { x: 74, y: 14 },
      { x: 70, y: 14 },
    ],
    closed: true,
    curves: 0,
    lines: 4,
    strokeWidth: 0.3,
    source: src('cmp-chair'),
  };
  // square (aspect 1) far from wall: no leaf (not slender), no window strokes host
  assert.equal(extractDoorCandidates([furniture, arcComponent], [wall]).length, 0);
  const windows = extractWindowCandidates([furniture], [wall]);
  assert.ok(windows.every((w) => w.verdict !== 'accepted'));
});
