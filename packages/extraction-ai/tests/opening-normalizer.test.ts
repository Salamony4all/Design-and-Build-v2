// packages/extraction-ai/tests/opening-normalizer.test.ts
// Opening normalizer test matrix (checkpoint Step 13). Pure geometry, no Pascal,
// no MuPDF, no fixed 5 m tolerance.

import { describe, it, expect } from 'vitest';
import { normalizeOpenings, type ParsedOpening, type NormalizedWall } from '../src/opening-normalizer';

const walls: NormalizedWall[] = [
  { id: 'w1', startM: { x: 0, y: 0 }, endM: { x: 10, y: 0 }, thicknessM: 0.2 },
  { id: 'w2', startM: { x: 10, y: 0 }, endM: { x: 10, y: 8 }, thicknessM: 0.2 },
];

function op(p: Partial<ParsedOpening> & Pick<ParsedOpening, 'type' | 'pos'>): ParsedOpening {
  return { width: 0.9, height: 2.1, ...p };
}

describe('opening normalizer', () => {
  it('accepts a door hosted on a wall', () => {
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'd1', type: 'door', pos: [5, 0] })], normalizedWalls: walls });
    expect(r.acceptedDoors.length).toBe(1);
    expect(r.acceptedDoors[0].wallId).toBe('w1');
    expect(r.acceptedDoors[0].kind).toBe('door');
    expect(r.acceptedWindows.length).toBe(0);
  });

  it('accepts a window with sill/head derivation', () => {
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'w1', type: 'window', pos: [10, 4], width: 1.2, height: 1.4, elevation: 0.9 })], normalizedWalls: walls });
    expect(r.acceptedWindows.length).toBe(1);
    expect(r.acceptedWindows[0].wallId).toBe('w2');
    expect(r.acceptedWindows[0].sillM).toBeCloseTo(0.9, 5);
    expect(r.acceptedWindows[0].headM).toBeCloseTo(2.3, 5);
  });

  it('normalizes case-insensitive types (DOOR / Window / glass-door)', () => {
    const r = normalizeOpenings({
      parsedOpenings: [
        op({ id: 'a', type: 'DOOR', pos: [2, 0] }),
        op({ id: 'b', type: 'Window', pos: [10, 2] }),
        op({ id: 'c', type: 'glass-door', pos: [8, 0] }),
      ],
      normalizedWalls: walls,
    });
    expect(r.acceptedDoors.length).toBe(2); // DOOR + glass-door
    expect(r.acceptedWindows.length).toBe(1);
  });

  it('rejects unsupported type into rejection with reason', () => {
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'x', type: 'hatch', pos: [5, 0] })], normalizedWalls: walls });
    expect(r.acceptedDoors.length).toBe(0);
    expect(r.acceptedWindows.length).toBe(0);
    expect(r.rejectedOpenings.length).toBe(1);
    expect(r.rejectedOpenings[0].outcome).toBe('REJECT_UNSUPPORTED_TYPE');
  });

  it('rejects projection beyond wall end', () => {
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'p', type: 'door', pos: [12, 0] })], normalizedWalls: walls });
    expect(r.rejectedOpenings.length).toBe(1);
    expect(r.rejectedOpenings[0].outcome).toBe('REJECT_NO_HOST');
  });

  it('rejects opening interval crossing wall end', () => {
    // width 3 centred at x=9 on a 10m wall → interval [7.5,10.5] crosses end
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'c', type: 'door', pos: [9, 0], width: 3 })], normalizedWalls: walls });
    expect(r.rejectedOpenings.length).toBe(1);
    expect(r.rejectedOpenings[0].outcome).toBe('REJECT_NO_HOST');
  });

  it('rejects non-positive width', () => {
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'z', type: 'door', pos: [5, 0], width: 0 })], normalizedWalls: walls });
    expect(r.rejectedOpenings[0].outcome).toBe('REJECT_INVALID_GEOMETRY');
  });

  it('rejects non-finite position', () => {
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'n', type: 'door', pos: [NaN, 0] })], normalizedWalls: walls });
    expect(r.rejectedOpenings[0].outcome).toBe('REJECT_INVALID_GEOMETRY');
  });

  it('rejects when no eligible wall exists', () => {
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'o', type: 'door', pos: [50, 50] })], normalizedWalls: walls });
    expect(r.rejectedOpenings.length).toBe(1);
    expect(r.rejectedOpenings[0].outcome).toBe('REJECT_NO_HOST');
  });

  it('reviews (does not arbitrarily pick) when two walls are equally plausible', () => {
    // Two parallel walls 5cm apart; opening centred between them is eligible on
    // BOTH (interval contained, distance within tol) and equidistant → ambiguous.
    const parallelWalls: NormalizedWall[] = [
      { id: 'p1', startM: { x: 0, y: 0 }, endM: { x: 10, y: 0 }, thicknessM: 0.2 },
      { id: 'p2', startM: { x: 0, y: 0.05 }, endM: { x: 10, y: 0.05 }, thicknessM: 0.2 },
    ];
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'amb', type: 'door', pos: [5, 0.025] })], normalizedWalls: parallelWalls });
    expect(r.reviewOpenings.length).toBe(1);
    expect(r.reviewOpenings[0].outcome).toBe('REVIEW_HOST');
    expect(r.acceptedDoors.length).toBe(0);
  });

  it('thickness-aware acceptance: opening offset within half-thickness+EPS is accepted', () => {
    // 0.25m off the wall centreline, thickness 0.2 (tol=0.25) → eligible
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 't', type: 'door', pos: [5, 0.25] })], normalizedWalls: walls });
    expect(r.acceptedDoors.length).toBe(1);
  });

  it('produces deterministic IDs derived from source identity', () => {
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'd1', type: 'door', pos: [5, 0] })], normalizedWalls: walls });
    expect(r.acceptedDoors[0].id).toBe('open_d1');
  });

  it('preserves provider evidence separately (caller responsibility) — normalizer keeps candidates', () => {
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'd1', type: 'door', pos: [5, 0] })], normalizedWalls: walls });
    expect(r.diagnostics.length).toBe(1);
    expect(r.diagnostics[0].candidates.length).toBe(2);
  });

  it('does not use a 5m fallback: a far-but-within-5m opening with no host is rejected', () => {
    // at 4.9m perpendicular from wall — beyond tol (0.25) → rejected, not accepted by 5m rule
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'far', type: 'door', pos: [5, 4.9] })], normalizedWalls: walls });
    expect(r.rejectedOpenings.length).toBe(1);
    expect(r.rejectedOpenings[0].outcome).toBe('REJECT_NO_HOST');
  });

  it('"glass" remains UNKNOWN (not auto-WINDOW) unless explicitly enabled', () => {
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'g1', type: 'glass', pos: [5, 0] })], normalizedWalls: walls });
    expect(r.rejectedOpenings.length).toBe(1);
    expect(r.rejectedOpenings[0].outcome).toBe('REJECT_UNSUPPORTED_TYPE');
    expect(r.acceptedWindows.length).toBe(0);
  });

  it('"glass-door" is an explicit DOOR alias', () => {
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'gd1', type: 'glass-door', pos: [5, 0] })], normalizedWalls: walls });
    expect(r.acceptedDoors.length).toBe(1);
    expect(r.acceptedDoors[0].kind).toBe('door');
  });

  it('duplicate source IDs remain distinct and host to their own walls', () => {
    const r = normalizeOpenings({
      parsedOpenings: [
        op({ id: 'dup', type: 'door', pos: [3, 0] }),
        op({ id: 'dup', type: 'door', pos: [10, 4] }),
      ],
      normalizedWalls: walls,
    });
    expect(r.acceptedDoors.length).toBe(2);
    expect(r.acceptedDoors[0].id).toBe('open_dup');
    expect(r.acceptedDoors[1].id).toBe('open_dup');
    expect(r.acceptedDoors[0].wallId).toBe('w1');
    expect(r.acceptedDoors[1].wallId).toBe('w2');
  });

  it('thin wall with an opening centre just within tolerance is accepted', () => {
    const thin: NormalizedWall[] = [{ id: 't1', startM: { x: 0, y: 0 }, endM: { x: 10, y: 0 }, thicknessM: 0.05 }];
    // 0.05/2 + 0.15 = 0.175 tolerance; centre 0.17 off → within tol
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 't', type: 'door', pos: [5, 0.17] })], normalizedWalls: thin });
    expect(r.acceptedDoors.length).toBe(1);
  });

  it('thick wall with an opening centre beyond tolerance is rejected', () => {
    const thick: NormalizedWall[] = [{ id: 'k1', startM: { x: 0, y: 0 }, endM: { x: 10, y: 0 }, thicknessM: 0.4 }];
    // tol = 0.2 + 0.15 = 0.35; centre 0.5 off → rejected
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'k', type: 'door', pos: [5, 0.5] })], normalizedWalls: thick });
    expect(r.rejectedOpenings[0].outcome).toBe('REJECT_NO_HOST');
  });

  it('tolerance boundary: centre exactly at tolerance is accepted', () => {
    const w: NormalizedWall[] = [{ id: 'b1', startM: { x: 0, y: 0 }, endM: { x: 10, y: 0 }, thicknessM: 0.2 }];
    // tol = 0.1 + 0.15 = 0.25; centre 0.25 off → exactly at boundary → accepted
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'b', type: 'door', pos: [5, 0.25] })], normalizedWalls: w });
    expect(r.acceptedDoors.length).toBe(1);
  });

  it('opening touching a wall endpoint with exactly-contained interval is accepted', () => {
    // door width 0.2 at x=0.1 → interval [0, 0.2] within [0,1] → contained
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'e', type: 'door', pos: [0.1, 0], width: 0.2 })], normalizedWalls: walls });
    expect(r.acceptedDoors.length).toBe(1);
  });

  it('opening interval equal to the usable wall interval (full-width) is accepted', () => {
    const r = normalizeOpenings({ parsedOpenings: [op({ id: 'fw', type: 'door', pos: [5, 0], width: 10 })], normalizedWalls: walls });
    expect(r.acceptedDoors.length).toBe(1);
  });

  it('is deterministic across repeated runs', () => {
    const input = { parsedOpenings: [op({ id: 'd1', type: 'door', pos: [5, 0] }), op({ id: 'w1', type: 'window', pos: [10, 4], width: 1.2, height: 1.4, elevation: 0.9 })], normalizedWalls: walls };
    const a = normalizeOpenings(input);
    const b = normalizeOpenings(input);
    expect(JSON.stringify(a.acceptedDoors)).toBe(JSON.stringify(b.acceptedDoors));
    expect(JSON.stringify(a.acceptedWindows)).toBe(JSON.stringify(b.acceptedWindows));
  });

  it('accepts repeated windows as distinct records on separate wall segments', () => {
    const r = normalizeOpenings({
      parsedOpenings: [
        op({ id: 'win1', type: 'window', pos: [10, 1], width: 1.2, height: 1.4, elevation: 0.9 }),
        op({ id: 'win2', type: 'window', pos: [10, 3], width: 1.2, height: 1.4, elevation: 0.9 }),
        op({ id: 'win3', type: 'window', pos: [10, 6], width: 1.2, height: 1.4, elevation: 0.9 }),
      ],
      normalizedWalls: walls,
    });
    expect(r.acceptedWindows.length).toBe(3);
    expect(new Set(r.acceptedWindows.map((w) => w.id)).size).toBe(3);
    expect(r.acceptedWindows.every((w) => w.wallId === 'w2')).toBe(true);
  });

  it('ZERO-WINDOW RECALL REGRESSION: provider returns no type:"window" → adapter yields zero windows (upstream defect the V4 window pass fixes)', () => {
    const coreOnlyDoors = normalizeOpenings({
      parsedOpenings: [op({ id: 'd1', type: 'door', pos: [5, 0] })],
      normalizedWalls: walls,
    });
    expect(coreOnlyDoors.acceptedWindows.length).toBe(0);
    const withV4 = normalizeOpenings({
      parsedOpenings: [
        op({ id: 'd1', type: 'door', pos: [5, 0] }),
        op({ id: 'wv4', type: 'window', pos: [10, 4], width: 1.0, height: 1.4, elevation: 0.9 }),
      ],
      normalizedWalls: walls,
    });
    expect(withV4.acceptedWindows.length).toBe(1);
    expect(withV4.acceptedWindows[0].wallId).toBe('w2');
  });
});
