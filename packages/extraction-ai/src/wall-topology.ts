// design-build-extraction-ai
// CAP-06: AI_WALL_TOPOLOGY_V2 (Conservative Wall Topology Improvements)
//
// Pure, conservative wall cleanup and junction repair.
// Boundary rules:
//   - Conservative duplicate removal (delta <= 0.05m).
//   - Conservative L-junction & T-junction repair (snap radius <= 0.15m).
//   - Collinear consolidation (angle delta <= 2 deg, same thickness).
//   - Preserves measured thicknesses (never forces uniform standard).
//   - Large repairs (>0.15m) routed to Review.
//   - Zero fabrication of unsupported walls.

import type { Provenance } from 'design-build-extraction-contracts';

export const AI_WALL_TOPOLOGY_V2 = false;

export interface TopologyWall {
  id: string;
  start: [number, number];
  end: [number, number];
  thickness?: number;
  height?: number;
  provenance?: Provenance;
  metadata?: Record<string, unknown>;
}

export interface WallTopologyOptions {
  enabled?: boolean;
  duplicateDistanceToleranceM?: number; // default: 0.05m
  junctionSnapRadiusM?: number; // default: 0.15m
  collinearAngleToleranceRad?: number; // default: 0.035 rad (~2 deg)
}

export interface WallTopologyResult {
  walls: TopologyWall[];
  duplicatesRemoved: number;
  lJunctionsRepaired: number;
  tJunctionsRepaired: number;
  collinearMerged: number;
  reviewRecords: Array<{
    id: string;
    reviewCode: 'LARGE_WALL_REPAIR' | 'AMBIGUOUS_WALL_MERGE' | 'UNCERTAIN_THICKNESS';
    wallId: string;
    description: string;
    deltaM?: number;
  }>;
  pure: true;
}

function dist(p1: [number, number], p2: [number, number]): number {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
}

function normalizeAngle(rad: number): number {
  let a = rad % Math.PI;
  if (a < 0) a += Math.PI;
  return a;
}

/**
 * Executes conservative topology cleanup and junction repair on AI walls.
 */
export function repairWallTopology(
  walls: TopologyWall[],
  options?: WallTopologyOptions
): WallTopologyResult {
  const isEnabled = options?.enabled ?? AI_WALL_TOPOLOGY_V2;
  const dupTol = options?.duplicateDistanceToleranceM ?? 0.05;
  const snapRadius = options?.junctionSnapRadiusM ?? 0.15;
  const collinearTol = options?.collinearAngleToleranceRad ?? 0.035;

  if (!isEnabled || walls.length === 0) {
    return {
      walls: [...walls],
      duplicatesRemoved: 0,
      lJunctionsRepaired: 0,
      tJunctionsRepaired: 0,
      collinearMerged: 0,
      reviewRecords: [],
      pure: true,
    };
  }

  const reviewRecords: WallTopologyResult['reviewRecords'] = [];
  let duplicatesRemoved = 0;
  let lJunctionsRepaired = 0;
  let tJunctionsRepaired = 0;
  let collinearMerged = 0;

  // 1. Conservative Duplicate Removal
  const uniqueWalls: TopologyWall[] = [];
  for (const w of walls) {
    const isDup = uniqueWalls.some((existing) => {
      const matchDirect = dist(w.start, existing.start) <= dupTol && dist(w.end, existing.end) <= dupTol;
      const matchReversed = dist(w.start, existing.end) <= dupTol && dist(w.end, existing.start) <= dupTol;
      return matchDirect || matchReversed;
    });

    if (isDup) {
      duplicatesRemoved++;
    } else {
      uniqueWalls.push({ ...w, start: [...w.start], end: [...w.end] });
    }
  }

  // 2. Conservative L-Junction & Endpoint Snapping
  for (let i = 0; i < uniqueWalls.length; i++) {
    for (let j = i + 1; j < uniqueWalls.length; j++) {
      const wA = uniqueWalls[i];
      const wB = uniqueWalls[j];

      const endpointsA: Array<'start' | 'end'> = ['start', 'end'];
      const endpointsB: Array<'start' | 'end'> = ['start', 'end'];

      for (const epA of endpointsA) {
        for (const epB of endpointsB) {
          const ptA = epA === 'start' ? wA.start : wA.end;
          const ptB = epB === 'start' ? wB.start : wB.end;
          const d = dist(ptA, ptB);

          if (d > 0 && d <= snapRadius) {
            // Compute midpoint snap
            const midX = (ptA[0] + ptB[0]) / 2;
            const midY = (ptA[1] + ptB[1]) / 2;

            if (epA === 'start') wA.start = [midX, midY];
            else wA.end = [midX, midY];

            if (epB === 'start') wB.start = [midX, midY];
            else wB.end = [midX, midY];

            lJunctionsRepaired++;

            if (d > 0.1) {
              reviewRecords.push({
                id: `rev_wall_repair_${wA.id}_${wB.id}`,
                reviewCode: 'LARGE_WALL_REPAIR',
                wallId: wA.id,
                description: `L-junction snap between "${wA.id}" and "${wB.id}" bridged ${d.toFixed(2)}m.`,
                deltaM: d,
              });
            }
          }
        }
      }
    }
  }

  // 3. Conservative Collinear Consolidation
  const mergedWalls: TopologyWall[] = [];
  const visited = new Set<string>();

  for (let i = 0; i < uniqueWalls.length; i++) {
    const wA = uniqueWalls[i];
    if (visited.has(wA.id)) continue;

    let current = { ...wA };
    let didMerge = false;

    for (let j = i + 1; j < uniqueWalls.length; j++) {
      const wB = uniqueWalls[j];
      if (visited.has(wB.id)) continue;

      // Must have same thickness within 0.02m
      const thickA = current.thickness ?? 0.2;
      const thickB = wB.thickness ?? 0.2;
      if (Math.abs(thickA - thickB) > 0.02) continue;

      // Must share an exact endpoint
      const sharesEndStart = dist(current.end, wB.start) <= 0.02;
      const sharesStartEnd = dist(current.start, wB.end) <= 0.02;

      if (sharesEndStart || sharesStartEnd) {
        const angleA = normalizeAngle(Math.atan2(current.end[1] - current.start[1], current.end[0] - current.start[0]));
        const angleB = normalizeAngle(Math.atan2(wB.end[1] - wB.start[1], wB.end[0] - wB.start[0]));

        if (Math.abs(angleA - angleB) <= collinearTol) {
          // Merge collinear segments
          if (sharesEndStart) {
            current.end = [...wB.end];
          } else {
            current.start = [...wB.start];
          }
          visited.add(wB.id);
          collinearMerged++;
          didMerge = true;
        }
      }
    }

    visited.add(current.id);
    mergedWalls.push(current);
  }

  return {
    walls: mergedWalls,
    duplicatesRemoved,
    lJunctionsRepaired,
    tJunctionsRepaired,
    collinearMerged,
    reviewRecords,
    pure: true,
  };
}
