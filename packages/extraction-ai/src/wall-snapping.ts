// packages/extraction-ai/src/wall-snapping.ts
// Conservative Wall Topology Analysis & Junction Repair.
// Separates raw AI walls from analyzed topology and repaired geometry.

import type { Vec2, WallContract } from 'design-build-extraction-contracts';

export type JunctionType =
  | 'ENDPOINT_ENDPOINT'
  | 'ENDPOINT_SEGMENT'
  | 'SEGMENT_CROSSING'
  | 'COLLINEAR_OVERLAP'
  | 'PARALLEL_NEAR_MISS'
  | 'INTENTIONAL_GAP'
  | 'DUPLICATE_SEGMENT'
  | 'SHORT_RETURN';

export interface WallTopologyConfig {
  endpointToEndpointToleranceM: number;
  endpointToSegmentToleranceM: number;
  collinearAngleToleranceDeg: number;
  minWallLengthM: number;
  maxDisplacementM: number;
}

export const DEFAULT_WALL_TOPOLOGY_CONFIG: WallTopologyConfig = {
  endpointToEndpointToleranceM: 0.25,
  endpointToSegmentToleranceM: 0.20,
  collinearAngleToleranceDeg: 5.0,
  minWallLengthM: 0.30,
  maxDisplacementM: 0.35,
};

export interface WallRepairRecord {
  wallId: string;
  originalStart: Vec2;
  originalEnd: Vec2;
  repairedStart: Vec2;
  repairedEnd: Vec2;
  repairType: JunctionType;
  displacementM: number;
  confidence: number;
}

export interface WallTopologyAnalysisResult {
  rawWalls: WallContract[];
  repairedWalls: WallContract[];
  repairs: WallRepairRecord[];
  duplicatesRemoved: string[];
  junctionCount: number;
  closureRate: number;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function len(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/** Distance from point p to finite segment [s, e] */
function pointToSegmentDist(p: Vec2, s: Vec2, e: Vec2): { dist: number; proj: Vec2; t: number } {
  const d = sub(e, s);
  const L2 = dot(d, d);
  if (L2 <= 1e-9) return { dist: dist(p, s), proj: { ...s }, t: 0 };
  let t = dot(sub(p, s), d) / L2;
  const clampedT = Math.max(0, Math.min(1, t));
  const proj: Vec2 = { x: s.x + clampedT * d.x, y: s.y + clampedT * d.y };
  return { dist: dist(p, proj), proj, t };
}

/** Deduplicate collinear overlapping wall segments separately from snapping */
export function deduplicateWalls(
  walls: WallContract[],
  config: WallTopologyConfig = DEFAULT_WALL_TOPOLOGY_CONFIG,
): { uniqueWalls: WallContract[]; removedIds: string[] } {
  const uniqueWalls: WallContract[] = [];
  const removedIds: string[] = [];

  for (const w of walls) {
    const wLen = dist(w.startM, w.endM);
    if (wLen < config.minWallLengthM) {
      removedIds.push(w.id);
      continue;
    }

    let isDuplicate = false;
    for (const existing of uniqueWalls) {
      const eLen = dist(existing.startM, existing.endM);
      const dStartStart = dist(w.startM, existing.startM);
      const dEndEnd = dist(w.endM, existing.endM);
      const dStartEnd = dist(w.startM, existing.endM);
      const dEndStart = dist(w.endM, existing.startM);

      // Direct duplicate in same or reverse direction
      if ((dStartStart < 0.15 && dEndEnd < 0.15) || (dStartEnd < 0.15 && dEndStart < 0.15)) {
        isDuplicate = true;
        removedIds.push(w.id);
        break;
      }
    }

    if (!isDuplicate) {
      uniqueWalls.push(w);
    }
  }

  return { uniqueWalls, removedIds };
}

/** Conservative wall junction repair */
export function repairWallTopology(
  rawWalls: WallContract[],
  customConfig?: Partial<WallTopologyConfig>,
): WallTopologyAnalysisResult {
  const config: WallTopologyConfig = { ...DEFAULT_WALL_TOPOLOGY_CONFIG, ...customConfig };
  const { uniqueWalls, removedIds } = deduplicateWalls(rawWalls, config);

  const repairedWalls: WallContract[] = uniqueWalls.map((w) => ({
    ...w,
    startM: { ...w.startM },
    endM: { ...w.endM },
  }));

  const repairs: WallRepairRecord[] = [];
  let junctionCount = 0;
  let closedJunctions = 0;

  // Pass 1: Endpoint-to-Endpoint (L-corners) Snapping
  for (let i = 0; i < repairedWalls.length; i++) {
    for (let j = i + 1; j < repairedWalls.length; j++) {
      const w1 = repairedWalls[i];
      const w2 = repairedWalls[j];

      const endpoints1: Array<{ pt: Vec2; isStart: boolean }> = [
        { pt: w1.startM, isStart: true },
        { pt: w1.endM, isStart: false },
      ];
      const endpoints2: Array<{ pt: Vec2; isStart: boolean }> = [
        { pt: w2.startM, isStart: true },
        { pt: w2.endM, isStart: false },
      ];

      for (const ep1 of endpoints1) {
        for (const ep2 of endpoints2) {
          const d = dist(ep1.pt, ep2.pt);
          if (d > 0.001 && d <= config.endpointToEndpointToleranceM) {
            junctionCount++;
            // Calculate midpoint meeting coordinate
            const midX = (ep1.pt.x + ep2.pt.x) / 2;
            const midY = (ep1.pt.y + ep2.pt.y) / 2;
            const displacement = d / 2;

            if (displacement <= config.maxDisplacementM) {
              const orig1: Vec2 = { ...ep1.pt };
              const orig2: Vec2 = { ...ep2.pt };

              ep1.pt.x = midX;
              ep1.pt.y = midY;
              ep2.pt.x = midX;
              ep2.pt.y = midY;

              repairs.push({
                wallId: w1.id,
                originalStart: ep1.isStart ? orig1 : w1.startM,
                originalEnd: ep1.isStart ? w1.endM : orig1,
                repairedStart: ep1.isStart ? { x: midX, y: midY } : w1.startM,
                repairedEnd: ep1.isStart ? w1.endM : { x: midX, y: midY },
                repairType: 'ENDPOINT_ENDPOINT',
                displacementM: displacement,
                confidence: 0.95,
              });

              closedJunctions++;
            }
          }
        }
      }
    }
  }

  // Pass 2: Endpoint-to-Segment (T-junctions) Snapping
  for (let i = 0; i < repairedWalls.length; i++) {
    for (let j = 0; j < repairedWalls.length; j++) {
      if (i === j) continue;
      const w1 = repairedWalls[i]; // wall whose endpoint may hit segment
      const w2 = repairedWalls[j]; // host wall segment

      const endpoints1: Array<{ pt: Vec2; isStart: boolean }> = [
        { pt: w1.startM, isStart: true },
        { pt: w1.endM, isStart: false },
      ];

      for (const ep of endpoints1) {
        const { dist: d, proj, t } = pointToSegmentDist(ep.pt, w2.startM, w2.endM);
        // Only snap if interior to segment (0.05 < t < 0.95) to prevent colliding with L-corners
        if (d > 0.001 && d <= config.endpointToSegmentToleranceM && t > 0.05 && t < 0.95) {
          junctionCount++;
          if (d <= config.maxDisplacementM) {
            const orig: Vec2 = { ...ep.pt };
            ep.pt.x = proj.x;
            ep.pt.y = proj.y;

            repairs.push({
              wallId: w1.id,
              originalStart: ep.isStart ? orig : w1.startM,
              originalEnd: ep.isStart ? w1.endM : orig,
              repairedStart: ep.isStart ? { ...proj } : w1.startM,
              repairedEnd: ep.isStart ? w1.endM : { ...proj },
              repairType: 'ENDPOINT_SEGMENT',
              displacementM: d,
              confidence: 0.90,
            });

            closedJunctions++;
          }
        }
      }
    }
  }

  const closureRate = junctionCount > 0 ? closedJunctions / junctionCount : 1.0;

  return {
    rawWalls,
    repairedWalls,
    repairs,
    duplicatesRemoved: removedIds,
    junctionCount,
    closureRate,
  };
}
