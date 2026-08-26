import { describe, it, expect } from 'vitest';
import { buildGuideTraceGraph, type RawMaximalLine } from './guide-trace/maximal-line-guide-tracer';
import { buildGraphFaces } from './guide-trace/integrate';
import { integrateGuideTrace } from './guide-trace/integrate';
import type { RoomSeed } from './guide-trace/space-topology-validator-upgraded';

/**
 * Build a clean rectangular room from maximal lines across 3 detector configs:
 *  - H walls at y=0 and y=3.2  (length 0..4)  -> exterior horizontal pair
 *  - V walls at x=0 and x=3.8  (length 0..3.2) -> exterior vertical pair
 */
function rectangularRoomRaw(): RawMaximalLine[] {
  const raw: RawMaximalLine[] = [];
  let id = 0;
  for (const cfg of ['fine', 'medium', 'coarse']) {
    // Each wall = two parallel maximal lines ~0.20m apart (inner + outer stroke edges).
    // Room interior is bounded by 4 wall bands at y=0.1, y=3.1, x=0.1, x=3.9.
    const lines: Array<['H' | 'V', number, number, number]> = [
      ['H', 0, 0, 4],
      ['H', 0.2, 0, 4],
      ['H', 3.0, 0, 4],
      ['H', 3.2, 0, 4],
      ['V', 0, 0, 3.2],
      ['V', 0.2, 0, 3.2],
      ['V', 3.8, 0, 3.2],
      ['V', 4.0, 0, 3.2],
    ];
    for (const [axis, c, a, b] of lines) {
      raw.push({
        id: `r${++id}`,
        axis,
        coordinateM: c,
        startM: a,
        endM: b,
        detectorConfigId: cfg,
        source: 'guide',
        confidence: 0.95,
      });
    }
  }
  return raw;
}

describe('Breakthrough Guide-Trace → Deterministic Engine integration', () => {
  it('builds a closed graph face (planar traversal) for a rectangular room', () => {
    const graph = buildGuideTraceGraph(rectangularRoomRaw(), { junctionToleranceM: 0.25 });
    expect(graph.metrics.wallBandCount).toBe(4);
    expect(graph.metrics.acceptedBandCount).toBe(4);

    const faces = buildGraphFaces(graph);
    // A closed box yields one bounded interior room plus the single unbounded exterior face,
    // so bounded faces = total - 1.
    const bounded = faces.length - 1;
    expect(bounded).toBe(1);
    // The interior room is bounded by the 4 wall bands (thick-wall corners yield >4 vertices).
    const room = faces.find(f => f.areaM2 > 10 && f.areaM2 < 15 && f.boundaryBandIds.length === 4);
    expect(room).toBeDefined();
    expect(room!.boundaryBandIds.length).toBe(4);
  });

  it('passes topology validation and emits zero-height diagnostic walls (no extrusion before gates pass)', () => {
    const graph = buildGuideTraceGraph(rectangularRoomRaw(), { junctionToleranceM: 0.25 });
    const seeds: RoomSeed[] = [{ id: 'seed_1', code: 'R-1', label: 'ROOM', point: [2, 1.5] }];
    const result = integrateGuideTrace({ guideTrace: graph, roomSeeds: seeds, diagnosticMode: true });

    expect(result.validation.passed).toBe(true);
    expect(result.diagnostics.detectedRoomSeeds).toBe(1);
    expect(result.diagnostics.acceptedConsensusSpaces).toBe(1);
    expect(result.diagnostics.exteriorWalls).toBe(4);
    expect(result.diagnostics.engineSlabNodes).toBe(1);
    // Diagnostic build: walls stay flat (height 0), furniture zero.
    expect(result.wallNodes.every(w => w.height === 0)).toBe(true);
    expect(result.furnitureNodes.length).toBe(0);
    expect(result.debugData.coordinateSystem).toBe('world-meters');
    expect(result.debugData.layers.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps furniture disabled and reports the 16 required diagnostics', () => {
    const graph = buildGuideTraceGraph(rectangularRoomRaw(), { junctionToleranceM: 0.25 });
    const seeds: RoomSeed[] = [{ id: 'seed_1', code: 'R-1', label: 'ROOM', point: [2, 1.5] }];
    const result = integrateGuideTrace({ guideTrace: graph, roomSeeds: seeds, diagnosticMode: true });

    const d = result.diagnostics;
    const keys = [
      'rawPdfPathCount', 'detectedRoomSeeds', 'candidateSpaces', 'acceptedConsensusSpaces',
      'openOrMissingSpaces', 'overlappingSpaces', 'slabPolygonCount', 'voidCount',
      'requiredBoundaryCount', 'exteriorWalls', 'structuralWalls', 'partitions',
      'preservedGaps', 'doors', 'windows', 'rejectedFalseWallCandidates',
      'danglingWallEndpoints', 'engineWallNodes', 'engineSlabNodes', 'engineOpeningNodes',
      'topologyReady', 'productionReady',
    ];
    for (const k of keys) expect(d).toHaveProperty(k);
    expect(d.topologyReady).toBe(true);
  });

  it('rejects a room seed that falls outside every closed face', () => {
    const graph = buildGuideTraceGraph(rectangularRoomRaw(), { junctionToleranceM: 0.25 });
    const seeds: RoomSeed[] = [{ id: 'seed_x', code: 'R-X', label: 'OUT', point: [20, 20] }];
    const result = integrateGuideTrace({ guideTrace: graph, roomSeeds: seeds, diagnosticMode: true });
    expect(result.validation.passed).toBe(false);
    expect(result.diagnostics.openOrMissingSpaces).toBe(1);
    expect(result.diagnostics.acceptedConsensusSpaces).toBe(0);
  });
});
