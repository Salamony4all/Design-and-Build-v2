import { describe, test, expect } from 'vitest';
import { topologicalDna, fnv1a64, canonicalizeRing } from '../src/pdfFfeDna';
import { clusterDbscanRtree, discoverPdfFfe } from '../src/pdfFfePipeline';
import {
  AUTHORITATIVE_CATALOG_MANIFEST,
  validateFfeMaterializationBatch,
  materializePatternToItemNodes,
  buildColumnMajor4x4Metres,
  buildColumnMajor4x4Mm,
} from '../src/ffeCatalog';
import type { PdfVectorPrimitive, CircularArc, RoomMask, ClusterCatalogBinding } from '../src/pdfFfeTypes';

describe('FF&E Validation & Recurrence Suite', () => {
  const mockStructuralHash = '063f6c36be70111b1870a1d085c8cc395c4aac2fc09988e75a2d1af0fbdc461c';
  const mockDoorArc: CircularArc = {
    center: { x: 100, y: 100 },
    radius: 17.88,
    startAngle: 0,
    endAngle: Math.PI / 2,
    sourceId: 'arc1',
  };

  test('1. Structural and fixed-joinery exclusion masking', () => {
    const rawPrims: PdfVectorPrimitive[] = [
      { id: 'wall_stroke_1', kind: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false, sourceObjectId: 'WALL_LAYER' },
      { id: 'cabinet_fixed_1', kind: 'line', points: [{ x: 5, y: 5 }, { x: 15, y: 5 }], closed: false, sourceObjectId: 'CABINET_LAYER' },
      { id: 'loose_bed_1', kind: 'polyline', points: [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 120 }, { x: 100, y: 120 }], closed: true },
    ];
    const doorArcs: CircularArc[] = [mockDoorArc];
    const roomsPdf: RoomMask[] = [
      { id: 'room_1', polygon: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] },
    ];

    const staging = discoverPdfFfe(rawPrims, doorArcs, roomsPdf);
    const instIds = staging.instances.map((i) => i.instanceId);
    expect(instIds.some((id) => id.includes('wall_stroke_1'))).toBe(false);
    expect(instIds.some((id) => id.includes('cabinet_fixed_1'))).toBe(false);
  });

  test('2. Room-contained clustering & cross-room separation', () => {
    const primsRoomA: PdfVectorPrimitive[] = [
      { id: 'item_a1', kind: 'polyline', points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }], closed: true },
    ];
    const primsRoomB: PdfVectorPrimitive[] = [
      { id: 'item_b1', kind: 'polyline', points: [{ x: 110, y: 110 }, { x: 120, y: 110 }, { x: 120, y: 120 }], closed: true },
    ];

    const rooms: RoomMask[] = [
      { id: 'room_A', polygon: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }] },
      { id: 'room_B', polygon: [{ x: 100, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 150 }, { x: 100, y: 150 }] },
    ];

    const staging = discoverPdfFfe([...primsRoomA, ...primsRoomB], [mockDoorArc], rooms);
    expect(staging.instances.map((i) => i.roomId)).toContain('room_A');
    expect(staging.instances.map((i) => i.roomId)).toContain('room_B');
    const roomAInst = staging.instances.find((i) => i.roomId === 'room_A');
    const roomBInst = staging.instances.find((i) => i.roomId === 'room_B');
    expect(roomAInst?.instanceId).not.toBe(roomBInst?.instanceId);
  });

  test('3. Proximity clustering (100 mm merge vs 101 mm separation)', () => {
    const prim100a: PdfVectorPrimitive = { id: 'p1', kind: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false };
    const prim100b: PdfVectorPrimitive = { id: 'p2', kind: 'line', points: [{ x: 0, y: 99 }, { x: 10, y: 99 }], closed: false };

    const resMerge = clusterDbscanRtree([prim100a, prim100b], 100);
    expect(resMerge.clusters.length).toBe(1);

    const prim101b: PdfVectorPrimitive = { id: 'p3', kind: 'line', points: [{ x: 0, y: 101 }, { x: 10, y: 101 }], closed: false };
    const resSep = clusterDbscanRtree([prim100a, prim101b], 100);
    expect(resSep.clusters.length).toBe(2);
  });

  test('4. Anti-bridging behavior & articulation rejection', () => {
    const p1: PdfVectorPrimitive = { id: 'a', kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false };
    const bridge: PdfVectorPrimitive = { id: 'b', kind: 'line', points: [{ x: 10, y: 0 }, { x: 500, y: 0 }], closed: false };
    const p2: PdfVectorPrimitive = { id: 'c', kind: 'polyline', points: [{ x: 500, y: 0 }, { x: 510, y: 0 }], closed: false };

    const res = clusterDbscanRtree([p1, bridge, p2], 100);
    expect(res.rejectedBridges).toBeGreaterThan(0);
  });

  test('5. Rotated OBB & ring canonicalization before topo64 hashing', () => {
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }];
    const cRing = canonicalizeRing(ring);
    expect(cRing.length).toBe(4);

    const dna = topologicalDna(ring, ring, 20, 10, []);
    expect(dna.hash).toMatch(/^topo64:[0-9a-f]{16}$/);
    expect(dna.hash).toBe(fnv1a64(dna.canonical));
  });

  test('6. Stale mapping rejection on baseline hash mutation', () => {
    const binding: ClusterCatalogBinding = {
      clusterId: 'pattern_001',
      topologicalHash: 'topo64:1234567890abcdef',
      catalogId: 'OM-BED-SR-90X200',
      assetUrl: '/assets/models/om_bed_sr_90x200.glb',
      category: 'Furniture/Beds',
      dimensionsMm: [900, 2000, 500],
    };
    const instances = [{ instanceId: 'inst_1', intrinsicWidthMm: 900, intrinsicLengthMm: 2000 }];

    const mutatedHash = 'mutated_hash_xyz';
    const validation = validateFfeMaterializationBatch(binding, instances, mockStructuralHash, mutatedHash);
    expect(validation.isValid).toBe(false);
    expect(validation.reason).toBe('STALE_STRUCTURAL_BASELINE_MUTATED');
  });

  test('7. Authoritative catalogue SKU lookup for OM-BED-SR-90X200', () => {
    const entry = AUTHORITATIVE_CATALOG_MANIFEST['OM-BED-SR-90X200'];
    expect(entry).toBeDefined();
    expect(entry?.catalogId).toBe('OM-BED-SR-90X200');
    expect(entry?.dimensionsMetres).toEqual([0.90, 2.00, 0.50]);
    expect(entry?.dimensionsMm).toEqual([900, 2000, 500]);
    expect(entry?.assetUrl).toBe('/assets/models/om_bed_sr_90x200.glb');
  });

  test('8. Atomic ItemNode materialization & column-major 4x4 matrices', () => {
    const binding: ClusterCatalogBinding = {
      clusterId: 'pattern_001',
      topologicalHash: 'topo64:abcde1234567890f',
      catalogId: 'OM-BED-SR-90X200',
      assetUrl: '/assets/models/om_bed_sr_90x200.glb',
      category: 'Furniture/Beds',
      dimensionsMm: [900, 2000, 500],
      mappedBy: 'operator_admin',
    };

    const instances = [
      {
        instanceId: 'G-003:ffe:1',
        roomId: 'G-003',
        centerMm: { x: 4500, y: 8900 },
        intrinsicWidthMm: 900,
        intrinsicLengthMm: 2000,
        theta: 0,
      },
    ];

    const validation = validateFfeMaterializationBatch(binding, instances, mockStructuralHash, mockStructuralHash);
    expect(validation.isValid).toBe(true);

    const itemNodes = materializePatternToItemNodes(binding, instances, 'level_ground');
    expect(itemNodes.length).toBe(1);

    const node = itemNodes[0]!;
    expect(node.type as string).toBe('item');
    expect(node.asset.id).toBe('OM-BED-SR-90X200');
    expect(node.metadata.source).toBe('human-approved-pascal-ffe-binding');
    expect(node.metadata.matrices.auditMmColumnMajor4x4.length).toBe(16);
    expect(node.metadata.matrices.pascalSceneMetresColumnMajor4x4.length).toBe(16);
  });

  test('9. Column-major 4x4 matrix generators output valid values', () => {
    const mmMat = buildColumnMajor4x4Mm(1000, 2000, Math.PI / 2);
    expect(mmMat.length).toBe(16);
    expect(mmMat[12]).toBe(1000);
    expect(mmMat[13]).toBe(2000);

    const mMat = buildColumnMajor4x4Metres(1.0, 2.0, 0, 0.5);
    expect(mMat.length).toBe(16);
    expect(mMat[12]).toBe(1.0);
    expect(mMat[13]).toBe(0.5);
    expect(mMat[14]).toBe(2.0);
  });
});
