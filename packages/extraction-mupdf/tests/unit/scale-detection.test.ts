import { describe, expect, it } from 'vitest';
import { estimateScale, parseDimensionMm, parseTitleScales, type ScaleSegment, type ScaleText } from '../../src/scale-detection';

const seg = (x1: number, y1: number, x2: number, y2: number): ScaleSegment => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, len: Math.hypot(x2 - x1, y2 - y1) });
const text = (t: string, x: number, y: number, w = 20, h = 6): ScaleText => ({ text: t, x, y, w, h, size: 6 });

describe('scale detection', () => {
  it('parses metric and feet-inch dimension strings', () => {
    expect(parseDimensionMm('3600')).toBe(3600);
    expect(parseDimensionMm('12')).toBeNull();
    expect(parseDimensionMm("28'-1\"")).toBeCloseTo((28 * 12 + 1) * 25.4, 3);
    expect(parseDimensionMm("8' - 11 1/8\"")).toBeCloseTo((8 * 12 + 11.125) * 25.4, 3);
    expect(parseDimensionMm('ROOM 101')).toBeNull();
  });

  it('reads the plot scale from the title block, choosing the one for this sheet size', () => {
    const t = [text('1:50 @ A1', 0, 0), text('1:100 @ A3', 0, 10)];
    const r = parseTitleScales(t, 2384, 1684);
    expect(r.forThisSheet).toBeCloseTo(50 * 25.4 / 72, 4);
    expect(parseTitleScales([text('1/8" = 1\'-0"', 0, 0)], 2592, 1728).all[0]).toBeCloseTo(96 * 25.4 / 72, 4);
  });

  it('recovers the scale from dimension lines by vote, ignoring unrelated numbers', () => {
    const S = 20; // mm per pt
    const segs: ScaleSegment[] = [];
    const texts: ScaleText[] = [text('17185', 900, 900), text('2500', 700, 40)]; // project number, stray number
    // a chain of dimensions along y = 100, each on its own segment with end ticks
    let x = 100;
    for (const mm of [3600, 2400, 4900, 1200, 6700]) {
      const len = mm / S;
      segs.push(seg(x, 100, x + len, 100), seg(x - 2, 102, x + 2, 98), seg(x + len - 2, 102, x + len + 2, 98));
      texts.push(text(String(mm), x + len / 2 - 10, 92));
      x += len;
    }
    // one continuous vertical dimension line carrying two dimensions, split only by ticks
    segs.push(seg(50, 200, 50, 200 + 5000 / S), seg(48, 200, 52, 200), seg(48, 200 + 3000 / S, 52, 200 + 3000 / S), seg(48, 200 + 5000 / S, 52, 200 + 5000 / S));
    texts.push({ text: '3000', x: 41, y: 200 + 1500 / S - 10, w: 6, h: 20, size: 6 });
    texts.push({ text: '2000', x: 41, y: 200 + 4000 / S - 10, w: 6, h: 20, size: 6 });
    const est = estimateScale(texts, segs, 2000, 1500)!;
    expect(est.source).toBe('dimension-vote');
    expect(est.mmPerPt).toBeCloseTo(S, 1);
    expect(est.votes).toBeGreaterThanOrEqual(6);
  });

  it('returns null when the sheet gives no usable evidence', () => {
    expect(estimateScale([text('HELLO', 0, 0)], [seg(0, 0, 100, 0)], 1000, 1000)).toBeNull();
  });
});
