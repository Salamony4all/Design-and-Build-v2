// packages/extraction-ai/tests/opening-adapter-gap.test.ts
// Step 10 (checkpoint): FREE local adapter dry-run — lock the CURRENT opening
// loss behavior. No provider call. Proves the adapter deliberately discards
// parsed openings as installable Window/Door contracts and keeps them only in
// providerEvidence.
//
// Classification this test locks: ADAPTER_RETAINED_OPENINGS_AS_EVIDENCE_ONLY
// (windows/doors are guaranteed empty from the current adapter, independent of
// what the core pass returns).

import { describe, it, expect } from 'vitest';
import { adaptMultipassResult } from '../src/result-adapter';
import type { MultipassResult } from '../src/multipass-controller';
import type { StructuralSchemaType } from '../src/schema';

function fixtureWithOpenings(): MultipassResult {
  const core: StructuralSchemaType = {
    walls: [
      { id: 'w1', start: [0, 0], end: [10, 0], thickness: 0.2, height: 3, material: 'conc' },
      { id: 'w2', start: [10, 0], end: [10, 8], thickness: 0.2, height: 3, material: 'conc' },
    ],
    openings: [
      { id: 'd1', type: 'door', pos: [5, 0], width: 0.9, height: 2.1, elevation: 0 },
      { id: 'w1', type: 'window', pos: [10, 4], width: 1.2, height: 1.4, elevation: 0.9 },
    ],
    furniture: [],
    floors: [],
    ceilings: [],
    zones: [],
  };
  return {
    runId: 'dry-run-1',
    modelId: 'gemini-3.5-flash',
    passes: [],
    wallsContextSize: 2,
    totalDurationMs: 1,
    phases: { shell: null, core, fitout: null, ffe: null },
  };
}

describe('opening adapter gap (current behavior lock)', () => {
  const result = adaptMultipassResult(fixtureWithOpenings());

  it('parsed openings are preserved on the core phase', () => {
    expect(result.providerEvidence?.openings?.length).toBe(2);
    expect(result.providerEvidence?.openings?.[0]?.type).toBe('door');
    expect(result.providerEvidence?.openings?.[1]?.type).toBe('window');
  });

  it('adapter now builds WindowContract records from parsed openings', () => {
    expect(result.windows.length).toBe(1);
    expect(result.windows[0].kind).toBe('window');
    expect(result.windows[0].wallId).toBeTruthy();
  });

  it('adapter now builds DoorContract records from parsed openings', () => {
    expect(result.doors.length).toBe(1);
    expect(result.doors[0].kind).toBe('door');
    expect(result.doors[0].wallId).toBeTruthy();
  });

  it('audit counts now reflect normalized windows/doors', () => {
    expect(result.audit.counts.windows).toBe(1);
    expect(result.audit.counts.doors).toBe(1);
  });

  it('adapter note records that openings are now normalized (not CS3-skipped)', () => {
    expect(result.audit.notes.some((n) => /openings normalized:/.test(n))).toBe(true);
    expect(result.audit.notes.some((n) => /not in CS3 scope/.test(n))).toBe(false);
  });
});

describe('opening adapter review/reject propagation', () => {
  // Two parallel walls 5cm apart; a door centred between them is eligible on BOTH
  // → REVIEW_HOST. An unsupported type → REJECT_UNSUPPORTED_TYPE.
  function reviewFixture(): MultipassResult {
    const core: StructuralSchemaType = {
      walls: [
        { id: 'p1', start: [0, 0], end: [10, 0], thickness: 0.2, height: 3, material: 'conc' },
        { id: 'p2', start: [0, 0.05], end: [10, 0.05], thickness: 0.2, height: 3, material: 'conc' },
      ],
      openings: [
        { id: 'amb', type: 'door', pos: [5, 0.025], width: 0.9, height: 2.1, elevation: 0 },
        { id: 'bad', type: 'hatch', pos: [2, 0], width: 0.9, height: 2.1, elevation: 0 },
      ],
      furniture: [],
      floors: [],
      ceilings: [],
      zones: [],
    };
    return {
      runId: 'dry-run-review',
      modelId: 'gemini-3.5-flash',
      passes: [],
      wallsContextSize: 2,
      totalDurationMs: 1,
      phases: { shell: null, core, fitout: null, ffe: null },
    };
  }

  const result = adaptMultipassResult(reviewFixture());

  it('review openings are surfaced into result.review', () => {
    expect(result.review.length).toBe(1);
    expect(result.review[0].id).toBe('open_amb');
    expect(result.review[0].kind).toBe('review');
    expect(result.review[0].category).toBe('opening');
  });

  it('rejected openings are surfaced into result.rejectedItems', () => {
    expect(result.rejectedItems?.length).toBe(1);
    expect(result.rejectedItems?.[0].id).toBe('open_bad');
    expect(result.rejectedItems?.[0].reason).toContain('unsupported');
  });

  it('provider evidence retains raw openings incl. door height', () => {
    const ev = result.providerEvidence?.openings as Array<{ id: string; height: number; type: string }>;
    expect(ev?.length).toBe(2);
    const amb = ev?.find((o) => o.id === 'amb');
    expect(amb?.type).toBe('door');
    expect(amb?.height).toBe(2.1); // door height preserved in evidence even though DoorContract has no height field
  });
});

