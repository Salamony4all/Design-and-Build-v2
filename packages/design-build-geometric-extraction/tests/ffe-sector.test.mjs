// CS4 FF&E sector tests — Node 24 native TypeScript type-stripping imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverFurnitureFamilies, canonicalSignature, propose } from '../src/furniture/family-extractor.ts';
import { classifyFamily } from '../src/furniture/sector-classifier.ts';
import { buildWorkspace } from '../src/furniture/workspace.ts';
import { getSectorProfile } from '../src/furniture/sector-dictionary.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(here, p), 'utf8'));

const workplace = readJson('../fixtures/sectors/workplace.json');
const kitchen = readJson('../fixtures/sectors/residential-kitchen.json');
const oracle = readJson('../e2e/code06-ffe-sector-oracle.json');

const UPM = 1000; // fixtures are millimeter-space

function rect(id, x, y, w, h) {
  return {
    id,
    bounds: [x, y, x + w, y + h],
    points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
    closed: true, curves: 0, lines: 4, strokeWidth: 1,
    source: { primitiveIds: [`${id}-p1`], rootIds: [id], page: 1 },
  };
}

function classifyGroup(group, sector, spaceType) {
  const fams = discoverFurnitureFamilies(group.components, { unitsPerMeter: UPM, minRecurrence: 1 });
  assert.equal(fams.length, 1, `${group.name}: expected one geometric family`);
  return classifyFamily(fams[0], { sector, spaceType, aiClass: group.hint }, { unitsPerMeter: UPM });
}

// ---------------------------------------------------------------- workplace
test('workplace priorities are explicit', () => {
  for (const x of ['workstation', 'desk', 'task-chair', 'visitor-chair', 'meeting-table', 'pedestal', 'filing-cabinet', 'storage-cabinet']) {
    assert.ok(workplace.priorityProducts.includes(x), `missing priority product ${x}`);
  }
  for (const s of ['open-office', 'private-office', 'meeting-room', 'reception', 'pantry']) {
    assert.ok(workplace.prioritySpaces.includes(s), `missing priority space ${s}`);
  }
  assert.equal(workplace.units, 'mm');
  assert.equal(workplace.synthetic, true);
});

test('workplace fixture groups classify to expected product types and scopes', () => {
  for (const group of workplace.groups) {
    const c = classifyGroup(group, 'workplace', group.space);
    assert.equal(c.assignment.productType, group.expected.productType, `${group.name}: productType`);
    assert.equal(c.assignment.scope, group.expected.scope, `${group.name}: scope`);
    assert.equal(c.assignment.category, group.expected.category, `${group.name}: category`);
  }
});

// ------------------------------------------------------- residential kitchen
test('residential kitchen separates cabinetry, appliances and loose FF&E', () => {
  assert.match(kitchen.scopeRule, /built-in joinery/);
  const classified = kitchen.groups.map((g) => classifyGroup(g, 'residential', 'kitchen'));
  const byName = new Map(kitchen.groups.map((g, i) => [g.name, classified[i]]));

  const joinery = ['base-cabinet-run', 'wall-cabinet-run', 'tall-unit-bank', 'sink-cabinet', 'island'];
  const appliances = ['refrigerator', 'cooker', 'oven', 'dishwasher', 'microwave', 'extractor-hood'];
  const loose = ['dining-table', 'dining-chairs'];
  for (const n of joinery) assert.equal(byName.get(n).assignment.scope, 'built-in-joinery', `${n} scope`);
  for (const n of appliances) assert.equal(byName.get(n).assignment.scope, 'appliance', `${n} scope`);
  for (const n of loose) assert.equal(byName.get(n).assignment.scope, 'loose-ffe', `${n} scope`);

  for (const g of kitchen.groups) {
    const c = byName.get(g.name);
    assert.equal(c.assignment.productType, g.expected.productType, `${g.name}: productType`);
    assert.equal(c.assignment.category, g.expected.category, `${g.name}: category`);
  }

  // Workspace scope view groups into exactly the three scope buckets.
  const scopeGroups = buildWorkspace(classified, 'scope');
  assert.deepEqual(new Set(scopeGroups.map((g) => g.key)), new Set(['built-in-joinery', 'appliance', 'loose-ffe']));
});

test('kitchen priority products cover cabinetry, appliances, worktops', () => {
  for (const x of ['base-cabinet', 'wall-cabinet', 'tall-cabinet', 'kitchen-island', 'countertop', 'sink-unit',
    'refrigerator', 'cooker', 'oven', 'dishwasher', 'microwave', 'extractor-hood']) {
    assert.ok(kitchen.priorityProducts.includes(x), `missing ${x}`);
  }
});

// ------------------------------------------------------------ CODE-06 oracle
test('CODE-06 oracle is never detector input', () => {
  assert.equal(oracle.oracleOnly, true);
  assert.equal(oracle.detectorInput, false);
  assert.equal(oracle.expectedBedInstances, 24);
  assert.equal(oracle.anchors.length, 4);
  for (const a of oracle.anchors) assert.equal(a.expectedBeds, 6);
  // Detector source must never reference the oracle file.
  const srcDir = path.join(here, '../src/furniture');
  for (const f of fs.readdirSync(srcDir)) {
    const body = fs.readFileSync(path.join(srcDir, f), 'utf8');
    assert.ok(!body.includes('code06-ffe-sector-oracle'), `${f} references the oracle`);
    assert.ok(!body.includes('expectedBedInstances'), `${f} consumes oracle expectations`);
  }
});

test('CODE-06 synthetic six-bed units: detector output is compared to oracle, not seeded by it', () => {
  // Synthetic geometry built independently of oracle anchor coordinates: 4 units x 6 single beds (900x2000 mm).
  const beds = [];
  for (let unit = 0; unit < 4; unit++) {
    const ox = (unit % 2) * 12000, oy = Math.floor(unit / 2) * 9000;
    for (let b = 0; b < 6; b++) beds.push(rect(`u${unit + 1}-bed-${b + 1}`, ox + b * 1300, oy, 900, 2000));
  }
  const fams = discoverFurnitureFamilies(beds, { unitsPerMeter: UPM });
  assert.equal(fams.length, 1);
  assert.equal(fams[0].proposedClass, 'bed');
  assert.equal(fams[0].recurrence, oracle.expectedBedInstances); // comparison AFTER detection
  const c = classifyFamily(fams[0], { sector: 'accommodation', spaceType: 'six-bed-unit' }, { unitsPerMeter: UPM });
  assert.equal(c.assignment.productType, 'single-bed');
  assert.equal(c.assignment.category, 'sleeping');
});

// --------------------------------------------------------- propose discipline
test('bed proposal requires aspect 1.65-2.9 AND closed AND plausible bed dims', () => {
  assert.equal(propose(rect('b1', 0, 0, 900, 2000), UPM).value, 'bed');       // single bed
  assert.notEqual(propose(rect('b2', 0, 0, 2100, 1800), UPM).value, 'bed');   // aspect 1.17 too low
  assert.notEqual(propose(rect('b3', 0, 0, 400, 2000), UPM).value, 'bed');    // aspect 5 too high
  assert.notEqual(propose(rect('b4', 0, 0, 3000, 6600), UPM).value, 'bed');   // right aspect, implausible dims
  const open = { ...rect('b5', 0, 0, 900, 2000), closed: false };
  assert.notEqual(propose(open, UPM).value, 'bed');                            // not closed
});

test('not every rectangle is a desk', () => {
  assert.equal(propose(rect('d1', 0, 0, 1600, 800), UPM).value, 'desk');       // plausible desk
  assert.notEqual(propose(rect('d2', 0, 0, 900, 600), UPM).value, 'desk');     // too small
  assert.notEqual(propose(rect('d3', 0, 0, 3200, 1200), UPM).value, 'desk');   // meeting-table size
  assert.notEqual(propose(rect('d4', 0, 0, 300, 200), UPM).value, 'desk');     // tiny block
  assert.notEqual(propose(rect('d5', 0, 0, 5000, 900), UPM).value, 'desk');    // wall-length run
});

test('accommodation profile has single-bed 0.75-1.2 x 1.7-2.3 m and wardrobe priors', () => {
  const acc = getSectorProfile('accommodation');
  const bed = acc.products.find((p) => p.productType === 'single-bed');
  assert.ok(bed, 'single-bed prior missing');
  assert.equal(bed.minWidth, 0.75);
  assert.equal(bed.maxWidth, 1.2);
  assert.equal(bed.minDepth, 1.7);
  assert.equal(bed.maxDepth, 2.3);
  assert.ok(acc.products.some((p) => p.productType === 'wardrobe'), 'wardrobe prior missing');
});

// --------------------------------------------------------- rotation invariance
test('family signatures are rotation invariant (0° vs 90°)', () => {
  const a = rect('rot-a', 0, 0, 1600, 800);
  const b = rect('rot-b', 5000, 5000, 800, 1600); // same footprint rotated 90°
  assert.equal(canonicalSignature(a, UPM), canonicalSignature(b, UPM));
  const rotated = [0, 1, 2].map((i) => rect(`rr-${i}`, i * 3000, 8000, 800, 1600));
  const straight = [0, 1, 2].map((i) => rect(`rs-${i}`, i * 3000, 0, 1600, 800));
  const fams = discoverFurnitureFamilies([...straight, ...rotated], { unitsPerMeter: UPM });
  assert.equal(fams.length, 1, 'rotated instances must join the same family');
  assert.equal(fams[0].recurrence, 6);
  const orientations = new Set(fams[0].instances.map((i) => i.orientation));
  assert.equal(orientations.size, 2, 'both orientations preserved on instances');
});

// --------------------------------------------------------- recurrence stability
test('recurrence-first discovery is deterministic and input-order stable', () => {
  const all = [...workplace.groups, ...kitchen.groups].flatMap((g) => g.components);
  const forward = discoverFurnitureFamilies(all, { unitsPerMeter: UPM });
  const reversed = discoverFurnitureFamilies([...all].reverse(), { unitsPerMeter: UPM });
  const shuffled = discoverFurnitureFamilies(
    [...all].sort((x, y) => x.id.split('').reverse().join('').localeCompare(y.id.split('').reverse().join(''))),
    { unitsPerMeter: UPM },
  );
  const shape = (fams) => fams.map((f) => `${f.signature}#${f.recurrence}`);
  assert.deepEqual(shape(reversed), shape(forward));
  assert.deepEqual(shape(shuffled), shape(forward));
  // families sorted recurrence-first
  for (let i = 1; i < forward.length; i++) {
    assert.ok(forward[i - 1].recurrence >= forward[i].recurrence, 'families must be sorted by recurrence desc');
  }
  // instance ids deterministic
  assert.deepEqual(
    forward.map((f) => f.instances.map((x) => x.id)),
    reversed.map((f) => f.instances.map((x) => x.id)),
  );
});
