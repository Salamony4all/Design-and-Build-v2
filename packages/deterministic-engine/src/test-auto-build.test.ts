import { describe, it, expect } from 'vitest';
import {
  AutoBuildEngine,
  calculatePolygonArea,
  isClosedLoop,
  collapseParallelWallPaths,
  computeOrientedBoundingBox,
  classifyFurnitureFootprint,
} from './auto-build-engine';
import type { VectorPrimitive } from './router';

describe('AutoBuildEngine Unit & Integration Suite', () => {

  it('enforces Loop Closure Law and Shoelace polygon area calculation', () => {
    const closedSquare: Array<[number, number]> = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
    const openPolyline: Array<[number, number]> = [[0, 0], [2, 0], [2, 2]];

    expect(isClosedLoop(closedSquare)).toBe(true);
    expect(isClosedLoop(openPolyline)).toBe(false);
    expect(calculatePolygonArea(closedSquare)).toBeCloseTo(4.0, 2);
  });

  it('collapses parallel wall face lines into 2D wall centerlines', () => {
    const lines = [
      { p1: [0, 0] as [number, number], p2: [10, 0] as [number, number], length: 10, angle: 0, dx: 10, dy: 0, layer: 'A-WALL' },
      { p1: [0, 0.2] as [number, number], p2: [10, 0.2] as [number, number], length: 10, angle: 0, dx: 10, dy: 0, layer: 'A-WALL' },
    ];

    const walls = collapseParallelWallPaths(lines);
    expect(walls.length).toBe(1);
    expect(walls[0]!.thickness).toBeCloseTo(0.20, 2);
    expect(walls[0]!.start).toEqual([0, 0.1]);
    expect(walls[0]!.end).toEqual([10, 0.1]);
  });

  it('extracts Oriented Bounding Box (OBB) and classifies furniture envelopes', () => {
    // 2m x 1.8m rectangle (King Bed footprint)
    const kingBedLoop: Array<[number, number]> = [[0, 0], [2.0, 0], [2.0, 1.8], [0, 1.8], [0, 0]];
    const obb = computeOrientedBoundingBox(kingBedLoop);

    expect(obb.width).toBeCloseTo(1.8, 1);
    expect(obb.length).toBeCloseTo(2.0, 1);

    const info = classifyFurnitureFootprint(obb.width, obb.length);
    expect(info.sku).toBe('BED_KING_001');
    expect(info.category).toBe('Bedroom');
  });

  it('filters noise layers and scale envelopes in raw vector streams', () => {
    const rawPrimitives: VectorPrimitive[] = [
      // Noise text layer (should be dropped)
      { layer: 'A-TEXT-ANNO', type: 'text', text: 'ROOM 101', confidence: 1.0 },
      // Noise tiny loop < 0.35m² (callout bubble, should be dropped)
      { layer: 'A-SYMB', type: 'line', points: [[0, 0], [0.4, 0], [0.4, 0.4], [0, 0.4], [0, 0]], confidence: 1.0 },
      // Structural parallel lines
      { layer: 'A-WALL', type: 'line', points: [[0, 0], [5, 0]], confidence: 1.0 },
      { layer: 'A-WALL', type: 'line', points: [[0, 0.15], [5, 0.15]], confidence: 1.0 },
      // Valid Furniture Loop (Armchair footprint ~0.8m x 0.8m = 0.64m²)
      { layer: 'I-FURN', type: 'line', points: [[1, 1], [1.8, 1], [1.8, 1.8], [1, 1.8], [1, 1]], confidence: 1.0 },
    ];

    const result = AutoBuildEngine.processVectorStream({ primitives: rawPrimitives });

    expect(result.guideNode.position).toEqual([0, -0.01, 0]); // Negative elevation anti-Z-fighting
    expect(result.wallNodes.length).toBeGreaterThanOrEqual(1);
    expect(result.furnitureNodes.length).toBe(1);
    expect(result.furnitureNodes[0]!.sku).toBe('CHAIR_ARM_001');
    expect(result.metadata.filteredNoiseCount).toBeGreaterThanOrEqual(2);
  });

});
