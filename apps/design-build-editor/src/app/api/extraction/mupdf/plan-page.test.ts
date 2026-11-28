import { describe, expect, it } from 'vitest';
import { choosePlanPage } from './plan-page';

const page = (pageIndex: number, wallCount: number, scaled = true) => ({ pageIndex, wallCount, scaled });

describe('choosePlanPage', () => {
  it('reads the floor plan, not the sheet of enlarged part-plans that holds more walls', () => {
    // the ten-page CODE_06 set: ground and first floor plans, then elevations, enlarged plans (page 7), details
    const set = [page(6, 118), page(5, 19), page(0, 70), page(1, 66), page(7, 22), page(8, 8)];
    expect(choosePlanPage(set)?.pageIndex).toBe(0);
  });

  it('skips a cover sheet and a sheet with only a few walls before the plans', () => {
    expect(choosePlanPage([page(0, 0), page(1, 30), page(2, 200), page(3, 190), page(6, 250)])?.pageIndex).toBe(2);
  });

  it('keeps the only page with walls', () => {
    expect(choosePlanPage([page(0, 0), page(5, 62), page(6, 0)])?.pageIndex).toBe(5);
  });

  it('prefers pages whose scale was read, and falls back to the others when none was', () => {
    expect(choosePlanPage([page(0, 300, false), page(3, 60)])?.pageIndex).toBe(3);
    expect(choosePlanPage([page(2, 12, false), page(4, 9, false)])?.pageIndex).toBe(2);
  });

  it('has no answer when no page has walls', () => {
    expect(choosePlanPage([page(0, 0), page(1, 0)])).toBeNull();
    expect(choosePlanPage([])).toBeNull();
  });
});
