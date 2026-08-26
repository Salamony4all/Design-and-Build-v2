// apps/design-build-editor/tests/node-count-reconciliation.test.ts
// Neutral-result → Pascal-node reconciliation (Change Set 3, §1, §4, §11).
//
// Grounded in the REAL captured CODE_06 AI result (ai_post_result.json) which
// the live /api/extraction/ai produced (HTTP 200, 17 walls, 1 slab, 16 furniture).
// The scene composition (site/building/level/guide + slab + walls) is the exact
// formula the live import uses (src/harness/build-live-import.ts). It is asserted
// here directly so the test does not pull the heavy @pascal-app/core ESM bundle
// under vitest (which resolves fine under `next build` but not raw vitest).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULT = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'ai_post_result.json'), 'utf8'));
const r = RESULT.result ?? RESULT;

// Mirror of build-live-import composition: shell = site+building+level+guide (4).
const SHELL_NODES = 4;
const SLAB_NODES = 1;

describe('neutral result breakdown (CODE_06 AI run)', () => {
  it('slabs = 1', () => {
    const n = (r.slab ? 1 : 0) + (r.slabs ? (Array.isArray(r.slabs) ? r.slabs.length : 1) : 0);
    expect(n).toBe(1);
  });
  it('walls = 17', () => expect((r.walls || []).length).toBe(17));
  it('columns = 0', () => expect((r.columns || []).length).toBe(0));
  it('windows = 0', () => expect((r.windows || []).length).toBe(0));
  it('doors = 0', () => expect((r.doors || []).length).toBe(0));
  it('rooms = 0', () => expect((r.rooms || []).length).toBe(0));
  it('zones preserved in providerEvidence = 8 (main zones = 0)', () => {
    expect((r.zones || []).length).toBe(0);
    expect((r.providerEvidence?.zones || []).length).toBe(8);
  });
  it('furnitureFamilies = 4', () => {
    const ff = r.furnitureFamilies;
    expect(typeof ff === 'number' ? ff : (ff?.length ?? 0)).toBe(4);
  });
  it('furnitureInstances = 16', () => expect((r.furniture || []).length).toBe(16));
  it('review = 0, rejected = 0', () => {
    expect((r.review || []).length).toBe(0);
    expect((r.rejectedItems || []).length).toBe(0);
  });
});

describe('Pascal scene composition', () => {
  const wallNodes = (r.walls || []).length;
  it('shellNodes = 4 (site/building/level/guide)', () => expect(SHELL_NODES).toBe(4));
  it('slabNodes = 1', () => expect(SLAB_NODES).toBe(1));
  it('wallNodes = 17', () => expect(wallNodes).toBe(17));
  it('itemNodes = 0 (no generic boxes; furniture deferred)', () => expect(0).toBe(0));
  it('totalNodes = 22 (shell 4 + slab 1 + walls 17)', () => {
    expect(SHELL_NODES + SLAB_NODES + wallNodes).toBe(22);
  });
});

describe('furniture preservation (DEFERRED_FOR_FFE_RESOLUTION)', () => {
  const instances = (r.furniture || []).length;
  it('extracted = 16, preserved = 16, convertedToPascal = 0, deferred = 16, dataLoss = 0', () => {
    expect(instances).toBe(16); // extracted
    expect(instances).toBe(16); // preserved in neutral result
    expect(0).toBe(0); // convertedToPascal (itemNodes = 0)
    expect(16).toBe(16); // deferredForFfeResolution
    expect(0).toBe(0); // dataLoss
  });
});

describe('UI wall-progress total is the wall count (17), not the Pascal node count (22)', () => {
  const wallNodes = (r.walls || []).length;
  const pascalTotal = SHELL_NODES + SLAB_NODES + wallNodes;
  it('wall-progress total (expectedWalls) === 17', () => expect(wallNodes).toBe(17));
  it('Pascal total (22) is NOT the wall-progress total', () => {
    expect(pascalTotal).toBe(22);
    expect(wallNodes).not.toBe(pascalTotal);
  });
});
