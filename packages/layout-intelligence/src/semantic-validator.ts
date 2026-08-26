import { TopologyBuilder } from './topology-builder';
import { RoomClassifier } from './room-classifier';
import { PartitionClassifier } from './partition-classifier';
import { FurnitureIntelligence } from './furniture-intelligence';
import { AssetResolver } from './asset-resolver';
import { LayoutValidator } from './layout-validator';
import { LayoutDiagnostics } from './layout-diagnostics';
import type { LegacyPascalPayload, WallPrimitive } from './topology-builder';

export class SemanticValidator {
  /**
   * Orchestrates the entire layout intelligence pipeline.
   * Transforms raw compiler payload into a topology-aware, validated semantic BIM model.
   */
  public validate(payload: LegacyPascalPayload): LegacyPascalPayload {
    // 1. Gather OCR texts & determine if this is a Dormitory layout
    const ocrTexts: any[] = [];
    if (payload.semanticBim?.diagnostics?.ocrText) {
      // Use existing
    }
    // Extract text primitives from vector primitives if available
    const vectorPrimitives = payload.core?.zones || []; // check zones or custom texts
    
    // Scan all text in payload
    const ocrKeywords: string[] = [];
    const extractTextFromPrimitive = (prim: any) => {
      if (prim.type === 'text' && prim.text) {
        ocrKeywords.push(prim.text.toLowerCase());
        ocrTexts.push({ text: prim.text, position: prim.position || prim.pos });
      }
    };

    // If payload has raw vector primitives (like text)
    if ((payload as any).vectorPrimitives) {
      (payload as any).vectorPrimitives.forEach(extractTextFromPrimitive);
    }
    // Also scan zones name
    if (payload.core?.zones) {
      payload.core.zones.forEach((z: any) => {
        if (z.name) {
          ocrKeywords.push(z.name.toLowerCase());
          ocrTexts.push({ text: z.name, position: z.boundary?.[0] });
        }
      });
    }

    const hasDormitoryOcr = ocrKeywords.some(kw => 
      kw.includes('dormitory') || kw.includes('6 bed') || kw.includes('bed unit') || kw.includes('6-bed')
    );

    const bedsCount = (payload.ffe?.looseFurniture || []).filter(f => {
      const sku = (f.sku || '').toLowerCase();
      return sku.includes('bed') || sku.includes('single-bed') || sku.includes('double-bed');
    }).length;

    // A dormitory unit has 3+ beds, or explicit OCR keywords
    const isDormitoryLayout = hasDormitoryOcr || bedsCount >= 3;

    // 2. Classify Partitions first to identify privacy dividers
    const partitionClassifier = new PartitionClassifier();
    const wallsWithTypes = partitionClassifier.classifyPartitions(
      payload.shell.walls || [],
      [], // No rooms extracted yet
      payload.ffe?.looseFurniture || [],
      isDormitoryLayout
    );

    // 3. Filter out privacy partitions/curtains/screens for room loop topology building
    // This prevents over-segmentation (privacy dividers won't become room boundaries)
    const roomDefiningWalls = wallsWithTypes.filter(
      w => w.type === 'structural_wall' || w.type === 'partition_wall'
    );

    // 4. Build Room Topology Graph
    const tempPayload: LegacyPascalPayload = {
      ...payload,
      shell: {
        ...payload.shell,
        walls: roomDefiningWalls
      }
    };

    const topologyBuilder = new TopologyBuilder();
    const graph = topologyBuilder.build(tempPayload);

    // 5. Classify Rooms using the graph and context
    const roomClassifier = new RoomClassifier();
    graph.rooms.forEach(room => {
      const classification = roomClassifier.classify(
        room,
        graph,
        payload.ffe?.looseFurniture || [],
        payload.joinery?.fixedFixtures || [],
        ocrTexts
      );
      room.type = classification.type;
      room.confidence = classification.confidence;
    });

    // Special Dormitory Rule: if it is a dormitory layout, ensure at least one dominant room is classified as Dormitory
    if (isDormitoryLayout && graph.rooms.length > 0) {
      // Find the largest room polygon by area and classify it as Dormitory
      let largestRoom = graph.rooms[0]!;
      graph.rooms.forEach(r => {
        if (r.area > largestRoom.area) {
          largestRoom = r;
        }
      });
      largestRoom.type = 'Dormitory';
      largestRoom.confidence = 0.99;
    }

    // 6. Furniture Intelligence (refining types, dimensions, and confidence)
    const furnitureIntelligence = new FurnitureIntelligence();
    const refinedFurniture = furnitureIntelligence.process(
      payload.ffe?.looseFurniture || [],
      payload.joinery?.fixedFixtures || [],
      graph.rooms
    );

    // 7. Asset Resolution (map semantic classes to GLB assets)
    const assetResolver = new AssetResolver();
    const resolvedFurniture = assetResolver.resolve(refinedFurniture);

    // 8. Re-classify partitions with correct room nodes for accurate boundaries
    const finalWallsWithTypes = partitionClassifier.classifyPartitions(
      payload.shell.walls || [],
      graph.rooms,
      payload.ffe?.looseFurniture || [],
      isDormitoryLayout
    );

    // 9. Run Layout Validator
    const layoutValidator = new LayoutValidator();
    const validationErrors = layoutValidator.validate(
      graph,
      finalWallsWithTypes,
      resolvedFurniture,
      payload.shell.openings || []
    );

    // 10. Run Layout Diagnostics
    const layoutDiagnostics = new LayoutDiagnostics();
    const diagnostics = layoutDiagnostics.generate(graph, validationErrors);

    // 11. Construct final semantic BIM structure
    const shellWalls = finalWallsWithTypes.filter(w => w.type === 'structural_wall');
    const corePartitions = finalWallsWithTypes.filter(w => w.type === 'partition_wall' || w.type === 'privacy_partition');

    const semanticBim = {
      shell: {
        walls: shellWalls
      },
      core: {
        partitions: corePartitions
      },
      joinery: {
        doors: (payload.shell.openings || []).filter((o: any) => o.type === 'door'),
        windows: (payload.shell.openings || []).filter((o: any) => o.type === 'window'),
        wardrobes: resolvedFurniture.filter((f: any) => f.type === 'wardrobe' || f.type === 'locker')
      },
      ffe: {
        beds: resolvedFurniture.filter((f: any) => f.type && f.type.includes('bed')),
        tables: resolvedFurniture.filter((f: any) => f.type === 'table' || f.type === 'desk' || f.type === 'reception_desk'),
        chairs: resolvedFurniture.filter((f: any) => f.type === 'chair')
      },
      diagnostics
    };

    // Return the updated Legacy Pascal Payload, retaining full compatibility
    return {
      core: {
        slabs: payload.core.slabs || [],
        ceilings: payload.core.ceilings || [],
        zones: payload.core.zones || []
      },
      shell: {
        walls: finalWallsWithTypes.map(w => ({
          id: w.id,
          points: w.points,
          thickness: w.thickness,
          height: w.height,
          curveOffset: w.curveOffset,
          status: w.status,
          type: w.type // Export classified type
        })),
        columns: payload.shell.columns || [],
        openings: payload.shell.openings || []
      },
      joinery: {
        fixedFixtures: (payload.joinery.fixedFixtures || []).map(f => {
          const matched = resolvedFurniture.find(rf => rf.id === f.id);
          return {
            ...f,
            type: matched ? matched.type : f.type,
            status: f.status
          };
        })
      },
      ffe: {
        looseFurniture: resolvedFurniture
      },
      semanticBim,
      diagnostics
    };
  }
}
