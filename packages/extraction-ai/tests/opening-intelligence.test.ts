import { describe, it, expect } from 'vitest';
import {
  resolveOpeningSubtype,
  scoreAdaptiveWallHost,
  type WallCandidate,
} from '../src/opening-intelligence';

describe('AI Opening Intelligence V2 (CAP-04 & CAP-05)', () => {
  it('1. Resolves canonical door and window aliases', () => {
    expect(resolveOpeningSubtype('pocket door', 'door').canonicalType).toBe('pocket-door');
    expect(resolveOpeningSubtype('double swing', 'door').canonicalType).toBe('double-swing');
    expect(resolveOpeningSubtype('bifold', 'door').canonicalType).toBe('bifold-door');
    expect(resolveOpeningSubtype('sliding glass door', 'door').canonicalType).toBe('sliding-door');

    expect(resolveOpeningSubtype('curtain wall', 'window').canonicalType).toBe('curtain-wall');
    expect(resolveOpeningSubtype('casement', 'window').canonicalType).toBe('casement-window');
    expect(resolveOpeningSubtype('fixed glazing', 'window').canonicalType).toBe('fixed-glazing');
  });

  it('2. Cleanly hosts opening on clear wall candidate', () => {
    const candidateWalls: WallCandidate[] = [
      { id: 'wall_south', start: [0, 0], end: [10, 0] },
      { id: 'wall_north', start: [0, 8], end: [10, 8] },
    ];

    const res = scoreAdaptiveWallHost({
      openingId: 'door_south_1',
      kind: 'door',
      position: [3.5, 0.05],
      candidateWalls,
    });

    expect(res.status).toBe('HOSTED');
    expect(res.bestWallId).toBe('wall_south');
    expect(res.score).toBeGreaterThan(0.85);
  });

  it('3. Rejects and orphans openings beyond 1.20m search radius', () => {
    const candidateWalls: WallCandidate[] = [
      { id: 'wall_far', start: [0, 0], end: [10, 0] },
    ];

    const res = scoreAdaptiveWallHost({
      openingId: 'door_rogue',
      kind: 'door',
      position: [5, 2.5], // 2.5m away > 1.20m radius
      candidateWalls,
    });

    expect(res.status).toBe('ORPHAN');
    expect(res.reviewRecord?.reviewCode).toBe('EXCESSIVE_HOSTING_DISTANCE');
  });

  it('4. Flags ambiguous wall hosts and routes to Review', () => {
    // Two close parallel walls (corridor)
    const candidateWalls: WallCandidate[] = [
      { id: 'wall_left', start: [0, 0], end: [10, 0] },
      { id: 'wall_right', start: [0, 0.7], end: [10, 0.7] },
    ];

    const res = scoreAdaptiveWallHost({
      openingId: 'door_mid',
      kind: 'door',
      position: [4, 0.36], // midway
      candidateWalls,
      options: { ambiguityDeltaThreshold: 0.15 },
    });

    expect(res.status).toBe('AMBIGUOUS');
    expect(res.reviewRecord?.reviewCode).toBe('AMBIGUOUS_WALL_HOST');
  });

  it('5. Prioritizes wall candidate matching vector gap evidence', () => {
    const candidateWalls: WallCandidate[] = [
      { id: 'wall_solid', start: [0, 0], end: [10, 0] },
      { id: 'wall_with_gap', start: [0, 0.2], end: [10, 0.2] },
    ];

    const res = scoreAdaptiveWallHost({
      openingId: 'door_gap',
      kind: 'door',
      position: [3, 0.1],
      candidateWalls,
      knownGaps: [{ center: [3, 0.2], widthM: 0.9 }],
    });

    expect(res.bestWallId).toBe('wall_with_gap');
  });
});
