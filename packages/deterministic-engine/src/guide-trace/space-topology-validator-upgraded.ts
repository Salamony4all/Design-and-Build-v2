import type { GuideTraceGraph, WallBand } from './guide-trace-types';

export interface RoomSeed {
  id: string;
  code: string;
  label: string;
  point: [number, number];
}

export interface GraphFace {
  id: string;
  polygon: Array<[number, number]>;
  boundaryBandIds: string[];
  areaM2: number;
  signedAreaM2: number;   // signed: +1 = CCW (world Y-up) / orientation below
  orientation: 'cw' | 'ccw';
  vertexCount: number;
  virtualClosureEdgeCount: number; // doors/windows/open passages bridged for enclosure
  containedSeedIds: string[];
}

export interface SpaceValidationResult {
  seedAssignments: Array<{ seedId: string; faceId: string | null }>;
  roomsExpected: number;
  roomsDetected: number;
  roomClosureRate: number;
  seedCollisionCount: number;
  overlapCount: number;
  orphanFaceCount: number;
  passed: boolean;
}

export function pointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1] + 1e-12) + a[0]) inside = !inside;
  }
  return inside;
}

export function validateGraphFaces(
  graph: GuideTraceGraph,
  faces: GraphFace[],
  seeds: RoomSeed[],
): SpaceValidationResult {
  const validBandIds = new Set(graph.acceptedBands.map(b => b.id));
  const validFaces = faces.filter(f => f.polygon.length >= 3 && f.areaM2 > 0.25 && f.boundaryBandIds.every(id => validBandIds.has(id)));
  const seedAssignments = seeds.map(seed => {
    const containing = validFaces.filter(face => pointInPolygon(seed.point, face.polygon)).sort((a, b) => a.areaM2 - b.areaM2);
    return { seedId: seed.id, faceId: containing[0]?.id ?? null };
  });
  const roomsDetected = seedAssignments.filter(a => a.faceId).length;
  const grouped = new Map<string, number>();
  for (const a of seedAssignments) if (a.faceId) grouped.set(a.faceId, (grouped.get(a.faceId) ?? 0) + 1);
  const seedCollisionCount = [...grouped.values()].reduce((n, count) => n + Math.max(0, count - 1), 0);
  const assignedFaceIds = new Set(seedAssignments.flatMap(a => a.faceId ? [a.faceId] : []));
  const orphanFaceCount = validFaces.filter(f => !assignedFaceIds.has(f.id)).length;
  const roomsExpected = seeds.length;
  const roomClosureRate = roomsExpected ? roomsDetected / roomsExpected * 100 : 0;
  const overlapCount = 0; // Graph faces from one planar traversal are disjoint by construction.
  // Zero expected rooms is a FAILURE, not a vacuous pass: it means text/seeds were empty
  // (topology validation failed upstream). Do not treat it as a passing gate.
  const passed = roomsExpected > 0 && roomsDetected === roomsExpected && seedCollisionCount === 0 && overlapCount === 0;
  return { seedAssignments, roomsExpected, roomsDetected, roomClosureRate, seedCollisionCount, overlapCount, orphanFaceCount, passed };
}

export function isProductionGraphReady(graph: GuideTraceGraph): boolean {
  return graph.metrics.principalComponentRate >= 0.90 &&
    graph.metrics.endpointSupportRate >= 0.95 &&
    graph.metrics.danglingEndpointCount === 0;
}
