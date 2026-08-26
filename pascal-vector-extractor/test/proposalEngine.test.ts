import { describe, expect, it } from 'vitest';
import {
  proposeLocalCorrections,
  evaluateCorrectionProposal,
  evaluateGeometricRegression,
  DEFAULT_CORRECTION_ACCEPTANCE_POLICY,
} from '../src/index';

describe('Local Correction Proposal & Evaluation Engine Tests', () => {

  const mockPhaseResult = {
    walls: Array.from({ length: 70 }, (_, i) => ({ id: `wall_${i + 1}`, start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, thickness: 0.15, height: 2.80 })),
    slabs: [{ id: 'slab_ground', polygon: [], holes: [], thickness: 0.20 }],
    openings: [
      ...Array.from({ length: 25 }, (_, i) => ({ id: `door_${i + 1}`, kind: 'door' as const, wallId: 'wall_1', position: { x: 1, y: 1 }, width: 0.9, height: 2.1, sillHeight: 0, rotation: 0 })),
      ...Array.from({ length: 24 }, (_, i) => ({ id: `window_${i + 1}`, kind: 'window' as const, wallId: 'wall_2', position: { x: 1.2, y: 1 }, width: 1.2, height: 1.2, sillHeight: 0.9, rotation: 0 })),
    ],
    items: [],
    unresolved: [],
  };

  const mockProfile = {
    profileId: 'CODE-06',
    drawingName: 'CODE_06 1 page.pdf',
    expectedDoors: 25,
    expectedWindows: 24,
    expectedRoomsTarget: 11,
    metadataOnlyScaleDenominator: 50,
  };

  const mockWallGraph = { walls: mockPhaseResult.walls, revision: 1 };
  const mockRoomGraph = { rooms: [], revision: 1 };
  const mockOpeningHosts: any[] = [];

  it('generates non-empty proposals and diagnostics for all mismatch components', () => {
    const regressionReport = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const { proposals, diagnostics } = proposeLocalCorrections(mockWallGraph, [], regressionReport, mockRoomGraph, mockOpeningHosts);

    expect(proposals.length).toBeGreaterThan(0);
    expect(diagnostics.length).toBeGreaterThan(0);

    for (const diag of diagnostics) {
      expect(diag.componentId).toBeDefined();
      expect(['missing', 'false']).toContain(diag.type);
      expect(diag.lengthMm).toBeGreaterThan(0);
      if (diag.generatedProposalIds.length === 0) {
        expect(diag.noProposalReason).toBeDefined();
      }
    }
  });

  it('evaluates proposal atomically and verifies IoU improvement', () => {
    const regressionReport = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const { proposals } = proposeLocalCorrections(mockWallGraph, [], regressionReport, mockRoomGraph, mockOpeningHosts);
    const snapProp = proposals.find(p => p.type === 'SNAP_T_JUNCTION')!;

    const baselineState = {
      wallGraph: mockWallGraph,
      structuralEvidence: [],
      regressionReport,
      roomGraph: mockRoomGraph,
      openingHosts: mockOpeningHosts,
    };

    const evalResult = evaluateCorrectionProposal(baselineState, snapProp, DEFAULT_CORRECTION_ACCEPTANCE_POLICY);

    expect(evalResult.accepted).toBe(true);
    expect(evalResult.afterMetrics.wallPolygonIoU).toBeGreaterThan(evalResult.beforeMetrics.wallPolygonIoU);
    expect(evalResult.afterMetrics.falseWallLengthMm).toBeLessThanOrEqual(evalResult.beforeMetrics.falseWallLengthMm);
    expect(evalResult.afterMetrics.validDoorHosts).toBe(25);
    expect(evalResult.afterMetrics.validWindowHosts).toBe(24);
  });

  it('evaluates proposal acceptance rules strictly', () => {
    const regressionReport = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const baselineState = {
      wallGraph: mockWallGraph,
      structuralEvidence: [],
      regressionReport,
      roomGraph: mockRoomGraph,
      openingHosts: mockOpeningHosts,
    };

    const snapProp = {
      proposalId: 'prop_snap_1',
      type: 'SNAP_T_JUNCTION' as const,
      targetComponentId: 'wall_14',
      payload: {
        stemWallId: 'wall_14',
        hostWallId: 'wall_2',
        oldEndpointMm: [5200, 3400] as [number, number],
        proposedEndpointMm: [5200, 3412] as [number, number],
        displacementMm: 12,
        evidenceIds: ['ev_snap_1'],
      },
      confidenceScore: 0.95,
    };

    const evalResult = evaluateCorrectionProposal(baselineState, snapProp);
    expect(evalResult.accepted).toBe(true);
  });
});
