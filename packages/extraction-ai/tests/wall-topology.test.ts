import { describe, it, expect } from 'vitest';
import {
  repairWallTopology,
  type TopologyWall,
} from '../src/wall-topology';

describe('AI Wall Topology V2 (CAP-06: Conservative Cleanup)', () => {
  it('1. Removes duplicate walls in direct and reversed directions', () => {
    const rawWalls: TopologyWall[] = [
      { id: 'w1', start: [0, 0], end: [5, 0], thickness: 0.2 },
      { id: 'w1_dup', start: [0.01, 0], end: [5.01, 0], thickness: 0.2 },
      { id: 'w1_rev_dup', start: [5.0, 0], end: [0, 0], thickness: 0.2 },
      { id: 'w2', start: [5, 0], end: [5, 5], thickness: 0.2 },
    ];

    const res = repairWallTopology(rawWalls, { enabled: true });
    expect(res.duplicatesRemoved).toBe(2);
    expect(res.walls).toHaveLength(2);
  });

  it('2. Snaps L-junction endpoints cleanly within snap radius', () => {
    const rawWalls: TopologyWall[] = [
      { id: 'w_h', start: [0, 0], end: [4.95, 0], thickness: 0.2 }, // 0.05m gap
      { id: 'w_v', start: [5.0, 0.05], end: [5.0, 5], thickness: 0.2 },
    ];

    const res = repairWallTopology(rawWalls, { enabled: true, junctionSnapRadiusM: 0.15 });
    expect(res.lJunctionsRepaired).toBe(1);

    const cornerH = res.walls.find((w) => w.id === 'w_h')!.end;
    const cornerV = res.walls.find((w) => w.id === 'w_v')!.start;
    expect(cornerH).toEqual(cornerV);
  });

  it('3. Merges collinear contiguous wall segments', () => {
    const rawWalls: TopologyWall[] = [
      { id: 'w_seg1', start: [0, 0], end: [5, 0], thickness: 0.2 },
      { id: 'w_seg2', start: [5, 0], end: [10, 0], thickness: 0.2 },
    ];

    const res = repairWallTopology(rawWalls, { enabled: true });
    expect(res.collinearMerged).toBe(1);
    expect(res.walls).toHaveLength(1);
    expect(res.walls[0].start).toEqual([0, 0]);
    expect(res.walls[0].end).toEqual([10, 0]);
  });

  it('4. Preserves thickness differences and does not merge dissimilar walls', () => {
    const rawWalls: TopologyWall[] = [
      { id: 'w_thick', start: [0, 0], end: [5, 0], thickness: 0.3 }, // exterior
      { id: 'w_thin', start: [5, 0], end: [10, 0], thickness: 0.1 },  // interior partition
    ];

    const res = repairWallTopology(rawWalls, { enabled: true });
    expect(res.collinearMerged).toBe(0);
    expect(res.walls).toHaveLength(2);
  });
});
