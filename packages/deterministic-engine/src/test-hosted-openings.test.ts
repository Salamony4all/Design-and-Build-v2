import { describe, it, expect } from 'vitest';
import { detectHostedOpenings, type HostedWall, type RawStroke, type DoorSymbol, type WindowSymbol } from './guide-trace/hosted-openings';

const EXP = 'exp_test';

function hWall(id: string, x0: number, x1: number, y = 0): HostedWall {
  return { id, axis: 'H', a: [x0, y], b: [x1, y], exposureId: EXP };
}
// strokes covering [s,e] along the wall (so a gap is the uncovered middle)
function cover(s: number, e: number, y = 0): RawStroke {
  return { a: [s, y], b: [e, y] };
}

describe('Hosted Opening Signatures', () => {
  it('1) wall with one door gap + leaf line -> matched door', () => {
    const wall = hWall('w1', 0, 4);
    const res = detectHostedOpenings({
      walls: [wall],
      strokes: [cover(0, 1.5), cover(2.5, 4)],
      doorSymbols: [{ kind: 'leaf', a: [1.5, -0.5], b: [2.5, 0.5] }],
      windowSymbols: [],
    });
    expect(res.diagnostics.hostedGapCount).toBe(1);
    expect(res.diagnostics.matchedDoorCount).toBe(1);
    expect(res.openings[0]!.signature).toBe('door');
    expect(res.openings[0]!.matchStatus).toBe('matched');
    expect(res.openings[0]!.hostWallId).toBe('w1');
    expect(res.openings[0]!.widthM).toBeCloseTo(1.0, 3);
  });

  it('2) wall with one door gap + swing arc -> matched door', () => {
    const wall = hWall('w1', 0, 4);
    const res = detectHostedOpenings({
      walls: [wall],
      strokes: [cover(0, 1.5), cover(2.5, 4)],
      doorSymbols: [{ kind: 'arc', center: [2.0, 0], radiusM: 0.5 }],
      windowSymbols: [],
    });
    expect(res.diagnostics.matchedDoorCount).toBe(1);
    expect(res.openings[0]!.signature).toBe('door');
    expect(res.openings[0]!.swingOrientation).toBe('out');
  });

  it('3) wall with window-frame lines -> matched window', () => {
    const wall = hWall('w1', 0, 4);
    const res = detectHostedOpenings({
      walls: [wall],
      strokes: [cover(0, 1.5), cover(2.5, 4)],
      doorSymbols: [],
      windowSymbols: [
        { a: [1.4, -0.05], b: [2.6, -0.05] },
        { a: [1.4, 0.05], b: [2.6, 0.05] },
      ],
    });
    expect(res.diagnostics.matchedWindowCount).toBe(1);
    expect(res.openings[0]!.signature).toBe('window');
    expect(res.openings[0]!.sillHeightM).toBeDefined();
  });

  it('4) arc away from any wall -> ignored (no orphan opening)', () => {
    const wall = hWall('w1', 0, 4);
    const res = detectHostedOpenings({
      walls: [wall],
      strokes: [cover(0, 4)], // fully covered, no gap
      doorSymbols: [{ kind: 'arc', center: [10, 10], radiusM: 0.5 }],
      windowSymbols: [],
    });
    expect(res.diagnostics.hostedGapCount).toBe(0);
    expect(res.diagnostics.matchedDoorCount).toBe(0);
    expect(res.diagnostics.orphanOpeningCount).toBe(0);
    expect(res.diagnostics.ignoredLocalPrimitiveCount).toBe(1);
    expect(res.openings.length).toBe(0);
  });

  it('5) frame lines without a host gap -> ignored', () => {
    const wall = hWall('w1', 0, 4);
    const res = detectHostedOpenings({
      walls: [wall],
      strokes: [cover(0, 4)],
      doorSymbols: [],
      windowSymbols: [
        { a: [1.0, -0.05], b: [2.0, -0.05] },
        { a: [1.0, 0.05], b: [2.0, 0.05] },
      ],
    });
    expect(res.diagnostics.hostedGapCount).toBe(0);
    expect(res.diagnostics.matchedWindowCount).toBe(0);
    expect(res.diagnostics.ignoredLocalPrimitiveCount).toBe(2);
    expect(res.openings.length).toBe(0);
  });

  it('6) wall gap without symbol evidence -> ambiguous', () => {
    const wall = hWall('w1', 0, 4);
    const res = detectHostedOpenings({
      walls: [wall],
      strokes: [cover(0, 1.5), cover(2.5, 4)],
      doorSymbols: [],
      windowSymbols: [],
    });
    expect(res.diagnostics.hostedGapCount).toBe(1);
    expect(res.diagnostics.ambiguousGapCount).toBe(1);
    expect(res.openings[0]!.matchStatus).toBe('ambiguous');
  });

  it('7) duplicate evidence -> one opening (no duplicate)', () => {
    const wall = hWall('w1', 0, 4);
    const res = detectHostedOpenings({
      walls: [wall],
      strokes: [cover(0, 1.5), cover(2.5, 4)],
      doorSymbols: [
        { kind: 'leaf', a: [1.5, -0.5], b: [2.5, 0.5] },
        { kind: 'leaf', a: [1.5, -0.5], b: [2.5, 0.5] }, // duplicate
      ],
      windowSymbols: [],
    });
    expect(res.diagnostics.matchedDoorCount).toBe(1);
    expect(res.openings.filter(o => o.signature === 'door').length).toBe(1);
    expect(res.diagnostics.duplicateOpeningCount).toBe(0);
  });

  it('8) opening position is deterministic along host wall', () => {
    const wall = hWall('w1', 0, 4);
    const run = () => detectHostedOpenings({
      walls: [wall],
      strokes: [cover(0, 1.5), cover(2.5, 4)],
      doorSymbols: [{ kind: 'arc', center: [2.0, 0], radiusM: 0.5 }],
      windowSymbols: [],
    });
    const a = run();
    const b = run();
    expect(a.openings[0]!.startAlongHostM).toBe(b.openings[0]!.startAlongHostM);
    expect(a.openings[0]!.endAlongHostM).toBe(b.openings[0]!.endAlongHostM);
    expect(a.openings[0]!.centerAlongHostM).toBe(b.openings[0]!.centerAlongHostM);
    expect(a.openings[0]!.distanceAlongHostM).toBeCloseTo(2.0, 3);
  });

  it('hard gates: no orphan, no duplicate, every opening references a matched wall', () => {
    const wall = hWall('w1', 0, 4);
    const res = detectHostedOpenings({
      walls: [wall],
      strokes: [cover(0, 1.5), cover(2.5, 4)],
      doorSymbols: [{ kind: 'arc', center: [2.0, 0], radiusM: 0.5 }],
      windowSymbols: [{ a: [1.4, -0.05], b: [2.6, -0.05] }, { a: [1.4, 0.05], b: [2.6, 0.05] }],
    });
    expect(res.diagnostics.orphanOpeningCount).toBe(0);
    expect(res.diagnostics.duplicateOpeningCount).toBe(0);
    for (const o of res.openings) expect(o.hostWallId).toBe('w1');
  });
});
