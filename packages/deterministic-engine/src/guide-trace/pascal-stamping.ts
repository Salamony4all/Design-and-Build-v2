/**
 * Pascal Semantic 2.5D Stamping — Phases 4-7 of the camera-like stamping pipeline.
 *
 * The drawing already exists. We do NOT reconstruct it through room-first reasoning.
 * We take one immutable DrawingExposure, stamp supported signatures directly, translate
 * matched signatures into Pascal Semantic JSON, and build them progressively.
 *
 *   DrawingExposure -> Direct geometric stamp -> Signature matching -> Pascal Semantic JSON -> Progressive build
 *
 * buildGraphFaces (FROZEN) is used ONLY to derive spaces/slabs (Phase 4 #4). Walls, doors and
 * windows are stamped directly from evidence and must NOT depend on room closure.
 */
import { buildGraphFaces, type GraphDiagnostics } from './integrate';
import { buildDrawingExposure, type DrawingExposure } from './drawing-exposure';
import type { GuideTraceGraph, WallBand, HostedGap } from './guide-trace-types';

export type MatchStatus = 'matched' | 'ambiguous' | 'ignored';
export type SignatureType = 'wall' | 'door' | 'window' | 'space' | 'slab' | 'furniture';

export const DIAGNOSTIC_COLORS = {
  wallFaceH: '#00C853',    // green: horizontal matched wall faces
  wallFaceV: '#F44336',    // red: vertical matched wall faces
  wallCenterline: '#FFFFFF', // white: matched Pascal wall centerlines
  openingGap: '#2196F3',   // blue: hosted opening gaps
  door: '#E91E63',         // magenta: doors
  window: '#00BCD4',       // cyan: windows and spaces
  space: '#00BCD4',        // cyan: spaces
  ambiguous: '#FFEB3B',    // yellow: ambiguous signatures
  ignored: '#9E9E9E',      // gray: ignored source geometry
  furniture: '#FF9800',    // orange: supported furniture templates
};

const Z = { guide: -0.006, trace: -0.003, matchedWall: 0.0, matchedOpening: 0.001, space: 0.003 } as const;

export interface PascalWall {
  id: string;
  signature: 'wall';
  matchStatus: MatchStatus;
  axis: 'H' | 'V';
  start: [number, number];
  end: [number, number];
  z: number;
  thicknessM: number;
  color: string;
  sourceBandId: string;
  sourcePrimitiveIds: string[];
  exposureId: string;
  hostOfOpenings: string[];
}
export interface PascalOpening {
  id: string;
  signature: 'door' | 'window';
  matchStatus: MatchStatus;
  hostWallId: string;
  center: [number, number];
  z: number;
  widthM: number;
  color: string;
  sourceGapId: string;
  sourcePrimitiveIds: string[];
  exposureId: string;
}
export interface PascalSpace {
  id: string;
  signature: 'space';
  matchStatus: MatchStatus;
  polygon: Array<[number, number]>;
  z: number;
  areaM2: number;
  color: string;
  boundaryBandIds: string[];
  containedSeedIds: string[];
  sourcePrimitiveIds: string[];
  exposureId: string;
}
export interface PascalSlab {
  id: string;
  signature: 'slab';
  matchStatus: MatchStatus;
  polygon: Array<[number, number]>;
  z: number;
  areaM2: number;
  color: string;
  exposureId: string;
}
export interface PascalScene {
  exposureId: string;
  sourceFileUrl: string;
  walls: PascalWall[];
  doors: PascalOpening[];
  windows: PascalOpening[];
  spaces: PascalSpace[];
  slabs: PascalSlab[];
  furniture: [];
  matchStatuses: Record<MatchStatus, number>;
  buildOrder: string[]; // progressive build stages executed
}

export interface StampInput {
  exposure: DrawingExposure;
  graph: GuideTraceGraph;
  sourceFileUrl: string;
  minWallConfidence?: number; // bands below this are 'ambiguous'
}

function classifyBand(b: WallBand, minConf: number): MatchStatus {
  if (b.status === 'rejected') return 'ignored';
  if (b.status === 'unresolved' || b.confidence < minConf) return 'ambiguous';
  return 'matched';
}

/** Phase 4 #1 — direct WALL stamping. Does NOT depend on room closure. */
function stampWalls(input: StampInput): { walls: PascalWall[]; openingHostIndex: Map<string, string[]> } {
  const { graph, exposure } = input;
  const minConf = input.minWallConfidence ?? 0.5;
  const walls: PascalWall[] = [];
  const openingHostIndex = new Map<string, string[]>();
  for (const b of graph.acceptedBands) {
    const status = classifyBand(b, minConf);
    if (status === 'ignored') continue; // gray: no Pascal object
    const a = b.centerlineStart, c = b.centerlineEnd;
    const wall: PascalWall = {
      id: `wall_${b.id}`,
      signature: 'wall',
      matchStatus: status,
      axis: b.axis,
      start: [a[0], a[1]],
      end: [c[0], c[1]],
      z: Z.matchedWall,
      thicknessM: b.thicknessM,
      color: status === 'ambiguous' ? DIAGNOSTIC_COLORS.ambiguous
        : (b.axis === 'H' ? DIAGNOSTIC_COLORS.wallFaceH : DIAGNOSTIC_COLORS.wallFaceV),
      sourceBandId: b.id,
      sourcePrimitiveIds: b.sourceIds,
      exposureId: exposure.exposureId,
      hostOfOpenings: [],
    };
    walls.push(wall);
    if (!openingHostIndex.has(b.id)) openingHostIndex.set(b.id, []);
    openingHostIndex.get(b.id)!.push(wall.id);
  }
  return { walls, openingHostIndex };
}

/** Phase 4 #2/#3 — DOOR / WINDOW stamping. Must reference a host wall. */
function stampOpenings(input: StampInput, hostIndex: Map<string, string[]>): { doors: PascalOpening[]; windows: PascalOpening[] } {
  const { graph, exposure } = input;
  const doors: PascalOpening[] = [];
  const windows: PascalOpening[] = [];
  for (const g of graph.hostedGaps) {
    const hostWallIds = hostIndex.get(g.hostBandId) ?? [];
    if (hostWallIds.length === 0) continue; // gap with no host wall -> ignore (no Pascal object)
    const hostWallId = hostWallIds[0]!;
    const lo = Math.min(g.startAlongM, g.endAlongM), hi = Math.max(g.startAlongM, g.endAlongM);
    const band = graph.acceptedBands.find(x => x.id === g.hostBandId);
    let center: [number, number] = [(lo + hi) / 2, (lo + hi) / 2];
    if (band) {
      const mid = (lo + hi) / 2;
      center = band.axis === 'H' ? [(band.centerlineStart[0] + band.centerlineEnd[0]) / 2, mid]
        : [mid, (band.centerlineStart[1] + band.centerlineEnd[1]) / 2];
    }
    const sig = g.classification === 'door' ? 'door' : 'window';
    const opening: PascalOpening = {
      id: `${sig}_${g.id}`,
      signature: sig,
      matchStatus: 'matched',
      hostWallId,
      center,
      z: Z.matchedOpening,
      widthM: g.widthM,
      color: sig === 'door' ? DIAGNOSTIC_COLORS.door : DIAGNOSTIC_COLORS.window,
      sourceGapId: g.id,
      sourcePrimitiveIds: [g.id, g.hostBandId],
      exposureId: exposure.exposureId,
    };
    if (sig === 'door') doors.push(opening); else windows.push(opening);
  }
  return { doors, windows };
}

/** Phase 4 #4 — SPACE + SLAB from the FROZEN buildGraphFaces utility only. */
function stampSpaces(input: StampInput): { spaces: PascalSpace[]; slabs: PascalSlab[]; diagnostics: GraphDiagnostics } {
  const { graph, exposure } = input;
  const { faces, diagnostics } = buildGraphDebugSafe(graph);
  const spaces: PascalSpace[] = [];
  const slabs: PascalSlab[] = [];
  // Bounded faces = all except the largest (exterior).
  const bounded = faces.length > 0 ? faces.slice().sort((a, b) => a.areaM2 - b.areaM2).slice(0, Math.max(0, faces.length - 1)) : [];
  for (const f of bounded) {
    const space: PascalSpace = {
      id: `space_${f.id}`,
      signature: 'space',
      matchStatus: 'matched',
      polygon: f.polygon,
      z: Z.space,
      areaM2: f.areaM2,
      color: DIAGNOSTIC_COLORS.space,
      boundaryBandIds: f.boundaryBandIds,
      containedSeedIds: f.containedSeedIds,
      sourcePrimitiveIds: f.boundaryBandIds,
      exposureId: exposure.exposureId,
    };
    spaces.push(space);
    slabs.push({
      id: `slab_${f.id}`,
      signature: 'slab',
      matchStatus: 'matched',
      polygon: f.polygon,
      z: Z.space,
      areaM2: f.areaM2,
      color: DIAGNOSTIC_COLORS.space,
      exposureId: exposure.exposureId,
    });
  }
  return { spaces, slabs, diagnostics };
}

function buildGraphDebugSafe(graph: GuideTraceGraph): { faces: any[]; diagnostics: GraphDiagnostics } {
  // buildGraphFaces is frozen; we call it directly. It returns all faces (incl. exterior).
  try {
    const faces = buildGraphFaces(graph);
    const diagnostics = ((buildGraphFaces as any)._lastDiag as GraphDiagnostics) ?? {
      inputBandCount: graph.acceptedBands.length, deduplicatedEdgeCount: 0, intersectionCount: 0,
      tJunctionCount: 0, splitSubEdgeCount: 0, vertexCount: 0, halfEdgeCount: 0,
      degreeHistogram: {}, isolatedVertexCount: 0, danglingVertexCount: 0, traversedCycleCount: 0,
      rejectedCycleCountByReason: {}, boundedFaceCount: 0, exteriorFaceCount: 0, virtualClosureEdgeCount: graph.hostedGaps.length,
    };
    return { faces, diagnostics };
  } catch {
    return { faces: [], diagnostics: {} as GraphDiagnostics };
  }
}

/**
 * Stamp a full Pascal Semantic scene from one DrawingExposure + guide-trace graph.
 * Progressive build order is recorded in `buildOrder`. Furniture is intentionally empty
 * (disabled until walls/openings/spaces are stable).
 */
export function stampScene(input: StampInput): PascalScene {
  const { exposure, sourceFileUrl } = input;
  const buildOrder: string[] = ['guide-exposure'];

  buildOrder.push('raw-source-stamp');
  const { walls, openingHostIndex } = stampWalls(input);
  buildOrder.push('matched-flat-wall-signatures');

  const { doors, windows } = stampOpenings(input, openingHostIndex);
  buildOrder.push('matched-wall-objects', 'hosted-openings');

  const { spaces, slabs } = stampSpaces(input);
  buildOrder.push('spaces-and-slabs');
  buildOrder.push('supported-furniture'); // empty by design

  const matchStatuses: Record<MatchStatus, number> = { matched: 0, ambiguous: 0, ignored: 0 };
  for (const w of walls) matchStatuses[w.matchStatus]++;
  for (const o of [...doors, ...windows]) matchStatuses[o.matchStatus]++;
  for (const s of spaces) matchStatuses[s.matchStatus]++;

  return {
    exposureId: exposure.exposureId,
    sourceFileUrl,
    walls, doors, windows, spaces, slabs, furniture: [],
    matchStatuses,
    buildOrder,
  };
}

/** Render the flat Pascal semantic overlay as an SVG (diagnostic colors). */
export function renderSceneOverlay(scene: PascalScene, exp: DrawingExposure): string {
  const W = exp.imageWidthPx, H = exp.imageHeightPx;
  const toPx = (wx: number, wy: number): [number, number] => {
    // world -> guide pixel (exposureToWorld inverse)
    const a = exp.exposureToWorld.a, b = exp.exposureToWorld.b, c = exp.exposureToWorld.c, d = exp.exposureToWorld.d, e = exp.exposureToWorld.e, f = exp.exposureToWorld.f;
    const det = a * d - b * c;
    const x = (d * (wx - e) - c * (wy - f)) / det;
    const y = (-b * (wx - e) + a * (wy - f)) / det;
    return [x, y];
  };
  const lines: string[] = [];
  const polys: string[] = [];
  for (const w of scene.walls) {
    const [x1, y1] = toPx(w.start[0], w.start[1]);
    const [x2, y2] = toPx(w.end[0], w.end[1]);
    lines.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${w.color}" stroke-width="${w.matchStatus === 'ambiguous' ? 2 : 2.5}"/>`);
  }
  for (const o of [...scene.doors, ...scene.windows]) {
    const [x, y] = toPx(o.center[0], o.center[1]);
    const r = Math.max(2, o.widthM * exp.ptsPerMeter / 2);
    polys.push(`<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${(2 * r).toFixed(1)}" height="${(2 * r).toFixed(1)}" fill="${o.color}" opacity="0.7"/>`);
  }
  for (const s of scene.spaces) {
    const pts = s.polygon.map(p => { const [x, y] = toPx(p[0], p[1]); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ');
    polys.push(`<polygon points="${pts}" fill="${s.color}" fill-opacity="0.10" stroke="${s.color}" stroke-width="1"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0b0e14"/>${polys.join('')}${lines.join('')}</svg>`;
}
