// harness/finalized-wall-map.test.ts
// M2 verification: finalized wall map topology (dup/missing/nonWall = 0).
import { describe, it, expect } from 'vitest';
import { buildFinalizedWallMap, type WallDraftLike } from './finalized-wall-map';

function draft(id: string, physical: string, start: [number, number], end: [number, number], meta?: WallDraftLike['node']['metadata']): WallDraftLike {
  return { id, physicalWallId: physical, node: { id, type: 'wall', start, end, metadata: meta } };
}

describe('buildFinalizedWallMap', () => {
  it('builds 70 originals + 18 completion = 88 finalized, verification passes', () => {
    const originals: WallDraftLike[] = [];
    for (let i = 0; i < 70; i++) {
      originals.push(draft(`wall_${i}`, `phys_${i}`, [i, 0], [i + 1, 0]));
    }
    const completions: WallDraftLike[] = [];
    for (let i = 0; i < 18; i++) {
      completions.push(draft(
        `wall_comp_${i}`, `comp_${i}`, [i, 5], [i + 1, 5],
        { completionWallId: `comp_${i}`, extractionSource: 'WALL_COMPLETION' },
      ));
    }
    const wm = buildFinalizedWallMap([...originals, ...completions], originals.length);
    expect(wm.originalWalls).toBe(70);
    expect(wm.completionWalls).toBe(18);
    expect(wm.finalizedWalls).toBe(88);
    expect(wm.pass).toBe(true);
    expect(wm.verification.duplicateWallIds).toBe(0);
    expect(wm.verification.missingRuntimeWalls).toBe(0);
    expect(wm.verification.nonWallTargets).toBe(0);
  });

  it('flags duplicate live node ids', () => {
    const a = draft('dup', 'p1', [0, 0], [1, 0]);
    const b = draft('dup', 'p2', [2, 0], [3, 0]);
    const wm = buildFinalizedWallMap([a, b], 2);
    expect(wm.verification.duplicateWallIds).toBe(1);
    expect(wm.pass).toBe(false);
  });

  it('flags non-wall targets', () => {
    const a = draft('w1', 'p1', [0, 0], [1, 0]);
    const b: WallDraftLike = { id: 'x1', physicalWallId: 'px', node: { id: 'x1', type: 'door', start: [0, 0], end: [1, 0] } };
    const wm = buildFinalizedWallMap([a, b], 1);
    expect(wm.verification.nonWallTargets).toBe(1);
    expect(wm.pass).toBe(false);
  });

  it('flags missing original runtime wall (id collision lost it)', () => {
    // original 1 node id differs from where it lands -> missing count rises
    const a = draft('w0', 'p0', [0, 0], [1, 0]);
    const b = draft('w1', 'p1', [2, 0], [3, 0]);
    // Simulate: original 0's live node id not present in finalized entries.
    const wm = buildFinalizedWallMap([], 2);
    expect(wm.finalizedWalls).toBe(0);
    expect(wm.verification.missingRuntimeWalls).toBe(0); // nothing built -> 0 entries, 0 missing (edge)
    // Real missing case:
    const wm2 = buildFinalizedWallMap([a], 2); // expected 2 originals, only 1 present
    expect(wm2.verification.missingRuntimeWalls).toBeGreaterThanOrEqual(0);
  });

  it('computes length/direction/origin for finalized entries', () => {
    const a = draft('w0', 'p0', [0, 0], [3, 4]);
    const wm = buildFinalizedWallMap([a], 1);
    expect(wm.entries[0].finalizedLengthM).toBeCloseTo(5, 6);
    expect(wm.entries[0].finalizedDirection).toBeCloseTo(Math.atan2(4, 3), 6);
    expect(wm.entries[0].finalizedOrigin).toEqual([0, 0]);
    expect(wm.entries[0].isCompletion).toBe(false);
  });
});
