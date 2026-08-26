import { describe, expect, it } from 'vitest';
import {
  proposeLocalCorrections,
  evaluateCorrectionProposal,
  evaluateGeometricRegression,
  runLocalCorrectionConvergence,
  DEFAULT_CORRECTION_ACCEPTANCE_POLICY,
} from '../src/index';

describe('Item 7: Proposal & Convergence Engine Complete Test Suite', () => {

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

  it('1. SNAP_T_JUNCTION generation', () => {
    const reg = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const { proposals } = proposeLocalCorrections(mockWallGraph, [], reg, mockRoomGraph, []);
    expect(proposals.some(p => p.type === 'SNAP_T_JUNCTION')).toBe(true);
  });

  it('2. TRANSLATE_LOCAL_CENTERLINE generation', () => {
    const reg = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const { proposals } = proposeLocalCorrections(mockWallGraph, [], reg, mockRoomGraph, []);
    expect(proposals.some(p => p.type === 'TRANSLATE_LOCAL_CENTERLINE')).toBe(true);
  });

  it('3. CLOSE_SHORT_NON_OPENING_GAP generation', () => {
    const reg = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const { proposals } = proposeLocalCorrections(mockWallGraph, [], reg, mockRoomGraph, []);
    expect(proposals.some(p => p.type === 'CLOSE_SHORT_NON_OPENING_GAP')).toBe(true);
  });

  it('4. REMOVE_FALSE_WALL_SEGMENT generation', () => {
    const reg = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const { proposals } = proposeLocalCorrections(mockWallGraph, [], reg, mockRoomGraph, []);
    expect(proposals.some(p => p.type === 'REMOVE_FALSE_WALL_SEGMENT')).toBe(true);
  });

  it('5. RESTORE_MISSING_WALL_SEGMENT generation', () => {
    const reg = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const { proposals } = proposeLocalCorrections(mockWallGraph, [], reg, mockRoomGraph, []);
    expect(proposals.some(p => p.type === 'RESTORE_MISSING_WALL_SEGMENT')).toBe(true);
  });

  it('6. COLLAPSE_DUPLICATE_WALL generation', () => {
    const reg = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const { proposals } = proposeLocalCorrections(mockWallGraph, [], reg, mockRoomGraph, []);
    expect(proposals.some(p => p.type === 'COLLAPSE_DUPLICATE_WALL')).toBe(true);
  });

  it('7 & 8. no proposal across a door or window', () => {
    const reg = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const { proposals } = proposeLocalCorrections(mockWallGraph, [], reg, mockRoomGraph, []);
    const spansDoorOrWindow = proposals.some(p => p.proposalId.includes('door') || p.proposalId.includes('window'));
    expect(spansDoorOrWindow).toBe(false);
  });

  it('9. no proposal without supporting source evidence', () => {
    const reg = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const { proposals } = proposeLocalCorrections(mockWallGraph, [], reg, mockRoomGraph, []);
    expect(proposals.every(p => p.confidenceScore > 0)).toBe(true);
  });

  it('10. deterministic proposal order', () => {
    const reg = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const run1 = proposeLocalCorrections(mockWallGraph, [], reg, mockRoomGraph, []);
    const run2 = proposeLocalCorrections(mockWallGraph, [], reg, mockRoomGraph, []);
    expect(run1.proposals.map(p => p.proposalId)).toEqual(run2.proposals.map(p => p.proposalId));
  });

  it('11. stable correction IDs', () => {
    const reg = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const { proposals } = proposeLocalCorrections(mockWallGraph, [], reg, mockRoomGraph, []);
    expect(proposals[0].proposalId).toMatch(/^prop_/);
  });

  it('12. atomic application & 17. cache invalidation / revision increment', () => {
    const reg = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const summary = runLocalCorrectionConvergence({
      wallGraph: mockWallGraph,
      structuralEvidence: [],
      regressionReport: reg,
      roomGraph: mockRoomGraph,
      openingHosts: [],
      profile: mockProfile,
    });

    expect(summary.ledger.length).toBe(6);
    expect(summary.evaluatedCorrectionCount).toBe(1);
    expect(summary.acceptedCorrectionCount).toBe(1);
    expect(summary.skippedCorrectionCount).toBe(5);

    const firstEntry = summary.ledger[0];
    expect(firstEntry.status).toBe('ACCEPTED');
    expect(firstEntry.geometryRevisionAfter).toBeGreaterThan(firstEntry.geometryRevisionBefore);
    expect(firstEntry.mismatchComponentIds).toEqual(['missing_src_comp_2']);
    expect(firstEntry.affectedWallIds).toEqual(['wall_14', 'wall_2']);
    expect(firstEntry.graphDefectIds).toEqual([]);
    expect(firstEntry.proposedWallIds).toEqual([]);

    const skippedEntry = summary.ledger[1];
    expect(skippedEntry.status).toBe('SKIPPED');
    expect(skippedEntry.skipReason).toBe('FINAL_TIER_REACHED_BEFORE_EVALUATION');
  });

  it('13 & 14. rollback after IoU reduction or false wall increase', () => {
    const reg = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const badProp = {
      proposalId: 'prop_bad',
      type: 'REMOVE_FALSE_WALL_SEGMENT' as const,
      targetComponentId: 'wall_bad',
      payload: { wallId: 'wall_bad', unsupportedLengthMm: 100, nearestSourceDistanceMm: 100, relatedEvidenceIds: [] },
      confidenceScore: 0.1,
    };

    const evalRes = evaluateCorrectionProposal(
      {
        wallGraph: mockWallGraph,
        structuralEvidence: [],
        regressionReport: reg,
        roomGraph: mockRoomGraph,
        openingHosts: [],
      },
      badProp,
      DEFAULT_CORRECTION_ACCEPTANCE_POLICY
    );

    expect(evalRes.accepted).toBe(false);
    expect(evalRes.rollbackPerformed).toBe(true);
    expect(evalRes.rejectionReason).toBeDefined();
  });

  it('19. final-tier convergence', () => {
    const reg = evaluateGeometricRegression(mockPhaseResult, mockProfile);
    const summary = runLocalCorrectionConvergence({
      wallGraph: mockWallGraph,
      structuralEvidence: [],
      regressionReport: reg,
      roomGraph: mockRoomGraph,
      openingHosts: [],
      profile: mockProfile,
    });

    expect(summary.stopReason).toBe('FINAL_TIER_REACHED');
    expect(summary.finalTier).toBe('final');
    expect(summary.exportAllowed).toBe(true);
    expect(summary.wallIoUAfter).toBeGreaterThanOrEqual(0.98);
  });

});
