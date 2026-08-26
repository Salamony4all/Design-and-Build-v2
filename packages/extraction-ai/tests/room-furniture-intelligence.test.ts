import { describe, it, expect } from 'vitest';
import {
  resolveDimensionHierarchy,
  validateRoomContainment,
  detectRepetitionConsensus,
  type RoomZone,
  type FurnitureInstance,
} from '../src/room-furniture-intelligence';

describe('AI Room & Furniture Intelligence V2 (CAP-07 through CAP-10)', () => {
  it('1. Enforces 7-tier dimension priority hierarchy (Measured > AI > Symbol > Catalog)', () => {
    // Case A: Measured geometry present -> wins over AI and catalog
    const dimA = resolveDimensionHierarchy({
      measuredWidthM: 2.1,
      measuredDepthM: 0.9,
      aiWidthM: 1.8,
      aiDepthM: 0.8,
      catalogDefaultWidthM: 1.5,
      catalogDefaultDepthM: 0.75,
    });
    expect(dimA.dimensionSource).toBe('measured-geometry');
    expect(dimA.widthM).toBe(2.1);

    // Case B: No measured geometry, valid AI dimensions -> wins over catalog
    const dimB = resolveDimensionHierarchy({
      aiWidthM: 1.6,
      aiDepthM: 0.8,
      catalogDefaultWidthM: 1.2,
      catalogDefaultDepthM: 0.6,
    });
    expect(dimB.dimensionSource).toBe('ai-explicit');
    expect(dimB.widthM).toBe(1.6);

    // Case C: Catalog default fallback
    const dimC = resolveDimensionHierarchy({
      catalogDefaultWidthM: 1.2,
      catalogDefaultDepthM: 0.6,
    });
    expect(dimC.dimensionSource).toBe('catalogue-default');
    expect(dimC.widthM).toBe(1.2);
  });

  it('2. Validates room spatial containment and flags room mismatch', () => {
    const rooms: RoomZone[] = [
      {
        id: 'room_living',
        name: 'Living Room',
        category: 'living',
        polygon: [[0, 0], [6, 0], [6, 5], [0, 5]],
        confidence: 0.95,
      },
      {
        id: 'room_bed',
        name: 'Master Bedroom',
        category: 'bedroom',
        polygon: [[6, 0], [12, 0], [12, 5], [6, 5]],
        confidence: 0.95,
      },
    ];

    // Inside Living Room
    const sofa: FurnitureInstance = {
      id: 'item_sofa_1',
      family: 'sofa',
      position: [3, 0, 2.5],
      dimensions: { widthM: 2.0, depthM: 0.9 },
      roomId: 'room_living',
    };
    const resA = validateRoomContainment(sofa, rooms);
    expect(resA.valid).toBe(true);
    expect(resA.assignedCategory).toBe('living');

    // Conflict: Position is in bedroom [8, 0, 2.5] but labeled as living room
    const rogueSofa: FurnitureInstance = {
      id: 'item_sofa_rogue',
      family: 'sofa',
      position: [8, 0, 2.5],
      dimensions: { widthM: 2.0, depthM: 0.9 },
      roomId: 'room_living',
    };
    const resB = validateRoomContainment(rogueSofa, rooms);
    expect(resB.valid).toBe(false);
    expect(resB.conflict?.reviewCode).toBe('ROOM_CONTAINMENT_CONFLICT');
  });

  it('3. Computes repetition consensus for workstation cluster while preserving all nodes', () => {
    const workstations: FurnitureInstance[] = [
      { id: 'desk_1', family: 'office_desk', position: [1, 0, 1], dimensions: { widthM: 1.6, depthM: 0.8 } },
      { id: 'desk_2', family: 'office_desk', position: [3, 0, 1], dimensions: { widthM: 1.6, depthM: 0.8 } },
      { id: 'desk_3', family: 'office_desk', position: [5, 0, 1], dimensions: { widthM: 1.6, depthM: 0.8 } },
      { id: 'desk_4', family: 'office_desk', position: [7, 0, 1], dimensions: { widthM: 2.4, depthM: 1.2 } }, // Outlier!
    ];

    const res = detectRepetitionConsensus(workstations);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].count).toBe(4);
    expect(res.outliersAdjusted).toBe(1);

    // Verify 4 distinct nodes preserved
    expect(res.repairedInstances).toHaveLength(4);
    const adjustedDesk4 = res.repairedInstances.find((d) => d.id === 'desk_4')!;
    expect(adjustedDesk4.dimensions.widthM).toBe(1.6); // Conformed to median 1.6m
    expect(adjustedDesk4.dimensions.depthM).toBe(0.8);
  });
});
