import { describe, expect, it } from 'vitest';
import { calibrateFromDoorArcs, evaluateGeometricRegression } from '../src/index';

describe('Radius-Family Door Swing Arc Clustering & Calibration', () => {
  it('should cluster door arcs by radius family and isolate dominant 900mm family', () => {
    const sampleArcs = [
      { sourceId: 'arc1', center: { x: 10, y: 10 }, radius: 18.0, startAngle: 0, endAngle: Math.PI / 2 },
      { sourceId: 'arc2', center: { x: 20, y: 10 }, radius: 18.0, startAngle: 0, endAngle: Math.PI / 2 },
      { sourceId: 'arc3', center: { x: 30, y: 10 }, radius: 18.1, startAngle: 0, endAngle: Math.PI / 2 },
      { sourceId: 'arc4', center: { x: 40, y: 10 }, radius: 24.0, startAngle: 0, endAngle: Math.PI / 2 }, // 1200mm double door
    ];

    const result = calibrateFromDoorArcs(sampleArcs, 900);

    expect(result.report.isValid).toBe(true);
    expect(result.report.families.length).toBeGreaterThanOrEqual(1);
    expect(result.report.selectedFamily?.nominalRadiusMm).toBe(900);
    expect(result.mmPerPdfUnit).toBeCloseTo(49.9, 0);
  });
});

describe('Geometric Regression Evaluation', () => {
  it('should evaluate regression metrics against audit profile targets', () => {
    const mockPhaseResult = {
      slabs: [{ id: 'slab_0', polygon: [], holes: [], thickness: 0.20 }],
      walls: Array.from({ length: 70 }, (_, i) => ({ id: `wall_${i}`, start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, thickness: 0.15, height: 2.80 })),
      openings: [
        ...Array.from({ length: 25 }, (_, i) => ({ id: `door_${i}`, kind: 'door' as const, wallId: 'wall_1', position: { x: 1, y: 1 }, width: 0.9, height: 2.1, sillHeight: 0, rotation: 0 })),
        ...Array.from({ length: 24 }, (_, i) => ({ id: `win_${i}`, kind: 'window' as const, wallId: 'wall_2', position: { x: 2, y: 1 }, width: 1.2, height: 1.2, sillHeight: 0.9, rotation: 0 })),
      ],
      items: [],
      unresolved: [],
    };

    const mockProfile = {
      profileId: 'CODE-06-TEST',
      drawingName: 'CODE_06 1 page.pdf',
      expectedDoors: 25,
      expectedWindows: 24,
      expectedRoomsTarget: 11,
      metadataOnlyScaleDenominator: 50,
    };

    const metrics = evaluateGeometricRegression(mockPhaseResult, mockProfile);

    expect(metrics.detectedDoorsCount).toBe(25);
    expect(metrics.detectedWindowsCount).toBe(24);
    expect(metrics.unhostedDoorsCount).toBe(0);
    expect(metrics.unhostedWindowsCount).toBe(0);
    expect(metrics.rawEvidence.boundarySampleCount).toBeGreaterThan(0);
  });
});
