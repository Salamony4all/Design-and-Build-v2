import { describe, expect, it } from 'vitest';
import { computeSceneGeometricTakeoff, synthesizeStandaloneBoqFromTakeoff } from './geometric-takeoff';

describe('computeSceneGeometricTakeoff', () => {
  it('measures straight + curved walls, deducts doors/windows, computes slab area, and excludes pilot windows', () => {
    const nodes = {
      slab_1: {
        id: 'slab_1',
        type: 'slab',
        polygon: [[0, 0], [10, 0], [10, 8], [0, 8]],
      },
      w_south: {
        id: 'w_south',
        type: 'wall',
        start: [0, 0],
        end: [10, 0],
        height: 3,
        thickness: 0.2,
        metadata: { wallClassification: 'EXTERIOR_WALL' },
      },
      w_int: {
        id: 'w_int',
        type: 'wall',
        start: [4, 0],
        end: [4, 8],
        height: 3,
        thickness: 0.15,
        metadata: { wallClassification: 'INTERNAL_PARTITION' },
      },
      w_glass_curved: {
        id: 'w_glass_curved',
        type: 'wall',
        start: [6, 2],
        end: [6, 6],
        curveOffset: 1.0,
        height: 3,
        thickness: 0.1,
        material: { preset: 'glass' },
        metadata: { wallClassification: 'GLASS_PARTITION' },
      },
      d_1: {
        id: 'd_1',
        type: 'door',
        width: 1.0,
        height: 2.1,
        doorType: 'SINGLE_SWING',
      },
      win_prod: {
        id: 'win_prod',
        type: 'window',
        width: 2.0,
        height: 1.5,
        status: 'AUTO_EXTRACTED_WINDOW',
        metadata: { openingRegionId: 'win1' },
      },
      win_pilot: {
        id: 'win_pilot',
        type: 'window',
        width: 2.0,
        height: 1.2,
        status: 'HUMAN_CONFIRMED_PILOT',
        metadata: { anonymousRegionId: 'AR-23', automaticPromotionAllowed: false },
      },
      item_1: {
        id: 'item_1',
        type: 'item',
        metadata: {
          source: 'plan-furniture',
          typeId: 't_desk',
          kind: 'desk',
          shape: 'rect',
          sizeM: [1.6, 0.8],
        },
      },
    };

    const t = computeSceneGeometricTakeoff(nodes);
    expect(t.netFloorAreaM2).toBe(80);
    expect(t.ceilingAreaM2).toBe(80);
    expect(t.solidWallLengthLm).toBe(18);
    expect(t.glassPartitionLengthLm).toBeGreaterThan(4.1);
    expect(t.doors.total).toBe(1);
    expect(t.windows.total).toBe(1); // HUMAN_CONFIRMED_PILOT excluded!
    expect(t.solidWallNetPaintAreaM2).toBeGreaterThan(0);
    expect(t.furnitureTotalCount).toBe(1);

    const boq = synthesizeStandaloneBoqFromTakeoff(t);
    expect(boq.some((r) => r.code === 'FL-POR-01' && r.qty === 80)).toBe(true);
    expect(boq.some((r) => r.code === 'PT-GLS-01')).toBe(true);
  });
});
