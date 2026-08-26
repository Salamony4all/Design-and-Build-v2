// apps/design-build-editor/src/harness/ai-scene-install/helpers.test.ts
// Null-safe wall geometry reading — regression for the live crash where
// readLiveWallData(undefined) threw "Cannot read properties of undefined (reading 'start')".
import { describe, it, expect } from 'vitest';
import { readLiveWallData, pointToSegmentDist } from './helpers';

describe('readLiveWallData null-safety', () => {
  it('returns null (never throws) for absent / malformed nodes', () => {
    expect(readLiveWallData(undefined)).toBeNull();
    expect(readLiveWallData(null)).toBeNull();
    expect(readLiveWallData(42)).toBeNull();
    expect(readLiveWallData({ type: 'wall' })).toBeNull(); // no start/end
    expect(readLiveWallData({ type: 'wall', start: [1, 1] })).toBeNull(); // partial
  });

  it('reads geometry from start/end or startM/endM', () => {
    expect(readLiveWallData({ start: [1, 2], end: [3, 4] })).toEqual({ start: [1, 2], end: [3, 4] });
    expect(readLiveWallData({ startM: [5, 6], endM: [7, 8] })).toEqual({ start: [5, 6], end: [7, 8] });
  });

  it('pointToSegmentDist handles a point off the segment', () => {
    expect(pointToSegmentDist([1, 0], [0, 0], [10, 0])).toBeCloseTo(0);
    expect(pointToSegmentDist([3, 5], [0, 0], [0, 10])).toBeCloseTo(3); // 3 m to the right of a vertical wall
  });
});
