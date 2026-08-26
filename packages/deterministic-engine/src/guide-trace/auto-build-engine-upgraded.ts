import type { GuideTraceGraph, HostedGap, WallBand } from './guide-trace-types';
import type { GraphFace, RoomSeed, SpaceValidationResult } from './space-topology-validator-upgraded';
import { isProductionGraphReady, validateGraphFaces } from './space-topology-validator-upgraded';

export interface AutoBuildWall {
  id: string; type: 'wall'; start: [number, number]; end: [number, number];
  thickness: number; height: number; visible: boolean; metadata: Record<string, unknown>;
}
export interface AutoBuildOpening {
  id: string; type: 'door' | 'window'; wallId: string;
  position: [number, number, number]; width: number; height: number;
  visible: boolean; metadata: Record<string, unknown>;
}
export interface AutoBuildSlab {
  id: string; type: 'slab'; polygon: Array<[number, number]>;
  holes: Array<Array<[number, number]>>; elevation: number; visible: boolean;
  metadata: Record<string, unknown>;
}
export interface TraceBuildInput {
  guideTrace: GuideTraceGraph;
  graphFaces: GraphFace[];
  roomSeeds: RoomSeed[];
  diagnosticMode?: boolean;
  allowProductionExtrusion?: boolean;
}
export interface TraceBuildOutput {
  wallNodes: AutoBuildWall[];
  openingNodes: AutoBuildOpening[];
  slabNodes: AutoBuildSlab[];
  furnitureNodes: never[];
  validation: SpaceValidationResult;
  metrics: Record<string, number | boolean>;
}

function bandMidpoint(b: WallBand): [number, number] {
  return [(b.centerlineStart[0] + b.centerlineEnd[0]) / 2, (b.centerlineStart[1] + b.centerlineEnd[1]) / 2];
}

function gapPosition(band: WallBand, gap: HostedGap): [number, number, number] {
  const [x1, y1] = band.centerlineStart, [x2, y2] = band.centerlineEnd;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const t = ((gap.startAlongM + gap.endAlongM) / 2) / Math.max(length, 1e-9);
  return [x1 + (x2 - x1) * t, 0, y1 + (y2 - y1) * t];
}

export class AutoBuildEngine {
  static processGuideTrace(input: TraceBuildInput): TraceBuildOutput {
    const { guideTrace, graphFaces, roomSeeds } = input;
    const validation = validateGraphFaces(guideTrace, graphFaces, roomSeeds);
    const topologyReady = validation.passed;
    const graphReady = isProductionGraphReady(guideTrace);
    const productionAllowed = Boolean(input.allowProductionExtrusion && graphReady && topologyReady && !input.diagnosticMode);

    const wallNodes: AutoBuildWall[] = guideTrace.acceptedBands.map(band => ({
      id: band.id, type: 'wall',
      start: [...band.centerlineStart], end: [...band.centerlineEnd],
      thickness: band.thicknessM,
      height: productionAllowed ? 2.8 : 0,
      visible: true,
      metadata: {
        source: 'direct-guide-maximal-line', confidence: band.confidence,
        componentId: band.componentId, sourceIds: band.sourceIds,
        diagnosticCenterline: !productionAllowed,
      },
    }));

    const bandById = new Map(guideTrace.acceptedBands.map(b => [b.id, b]));
    const openingNodes: AutoBuildOpening[] = [];
    if (productionAllowed) for (const gap of guideTrace.hostedGaps) {
      const band = bandById.get(gap.hostBandId);
      if (!band || (gap.classification !== 'door' && gap.classification !== 'window')) continue;
      openingNodes.push({
        id: gap.id, type: gap.classification, wallId: band.id,
        position: gapPosition(band, gap), width: gap.widthM,
        height: gap.classification === 'door' ? 2.1 : 1.4,
        visible: true,
        metadata: { confidence: gap.confidence, connectedSpaceIds: gap.connectedSpaceIds },
      });
    }

    const slabNodes: AutoBuildSlab[] = topologyReady ? graphFaces
      .filter(f => validation.seedAssignments.some(a => a.faceId === f.id))
      .map(face => ({
        id: `slab_${face.id}`, type: 'slab', polygon: face.polygon.map(p => [...p]),
        holes: [], elevation: 0, visible: true,
        metadata: { source: 'trace-graph-face', boundaryBandIds: face.boundaryBandIds },
      })) : [];

    return {
      wallNodes, openingNodes, slabNodes, furnitureNodes: [], validation,
      metrics: {
        rawLineCount: guideTrace.metrics.rawLineCount,
        maximalFaceCount: guideTrace.metrics.maximalFaceCount,
        wallBandCount: guideTrace.metrics.wallBandCount,
        acceptedBandCount: guideTrace.metrics.acceptedBandCount,
        principalComponentRate: guideTrace.metrics.principalComponentRate,
        endpointSupportRate: guideTrace.metrics.endpointSupportRate,
        danglingEndpointCount: guideTrace.metrics.danglingEndpointCount,
        topologyReady, graphReady, productionAllowed,
      },
    };
  }
}
