/**
 * Which page of a multi-page PDF is the floor plan to read.
 *
 * Wall counts alone mislead: a sheet of enlarged part-plans or details holds more
 * (short) walls than the floor plan it enlarges, and would be read instead of it.
 * Drawing sets list the main floor plan before enlarged plans, elevations and
 * details, so the plan is the earliest page that holds a good share of the best
 * page's walls. Pages whose scale could not be read count only when no page has one.
 */
export interface PlanPageCandidate {
  pageIndex: number;
  /** Walls the wall reader accepts on the page. */
  wallCount: number;
  /** The page's scale was read from the drawing (not a fallback). */
  scaled: boolean;
}

/** Share of the best page's walls a page needs to count as a plan. */
export const PLAN_PAGE_WALL_SHARE = 0.4;

export function choosePlanPage<T extends PlanPageCandidate>(candidates: readonly T[]): T | null {
  const withWalls = candidates.filter((c) => c.wallCount > 0);
  const pool = withWalls.some((c) => c.scaled) ? withWalls.filter((c) => c.scaled) : withWalls;
  if (!pool.length) return null;
  const most = Math.max(...pool.map((c) => c.wallCount));
  return pool.filter((c) => c.wallCount >= PLAN_PAGE_WALL_SHARE * most).sort((a, b) => a.pageIndex - b.pageIndex)[0] ?? null;
}
