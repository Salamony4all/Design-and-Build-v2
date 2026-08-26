// design-build-extraction-ai
// CAP-07 through CAP-10: Room, Furniture & Joinery Intelligence V2
//   - AI_ROOM_CONTEXT_V2 (Spatial Zone & Containment Validation)
//   - AI_FURNITURE_CATALOG_V2 (Catalogue Mapping & 7-Tier Dimension Hierarchy)
//   - AI_FURNITURE_REPETITION_V2 (Cluster Consensus & Outlier Repair)
//   - AI_JOINERY_CONTEXT_V2 (Continuous Run & Built-in Joinery Classification)
//
// Invariants:
//   - Preserves EVERY physical instance as a separate ItemNode.
//   - Rejects generative furniture hallucination (area/density formulas).
//   - Enforces 7-tier dimension precedence.
//   - Pure calculations; zero provider calls.

import type { Provenance } from 'design-build-extraction-contracts';

export const AI_ROOM_CONTEXT_V2 = false;
export const AI_FURNITURE_CATALOG_V2 = false;
export const AI_FURNITURE_REPETITION_V2 = false;
export const AI_JOINERY_CONTEXT_V2 = false;

export type RoomCategory =
  | 'living'
  | 'bedroom'
  | 'bathroom'
  | 'kitchen'
  | 'office'
  | 'corridor'
  | 'balcony'
  | 'utility'
  | 'dining'
  | 'generic';

export interface RoomZone {
  id: string;
  name: string;
  category: RoomCategory;
  polygon: Array<[number, number]>;
  confidence: number;
}

export type DimensionSource =
  | 'measured-geometry'
  | 'ai-explicit'
  | 'calibrated-symbol'
  | 'repetition-consensus'
  | 'room-context'
  | 'catalogue-default'
  | 'generic-fallback';

export const DIMENSION_PRIORITY_WEIGHT: Record<DimensionSource, number> = {
  'measured-geometry': 7,
  'ai-explicit': 6,
  'calibrated-symbol': 5,
  'repetition-consensus': 4,
  'room-context': 3,
  'catalogue-default': 2,
  'generic-fallback': 1,
};

export interface FurnitureDimensionInput {
  measuredWidthM?: number;
  measuredDepthM?: number;
  measuredHeightM?: number;
  aiWidthM?: number;
  aiDepthM?: number;
  aiHeightM?: number;
  symbolWidthM?: number;
  symbolDepthM?: number;
  symbolHeightM?: number;
  consensusWidthM?: number;
  consensusDepthM?: number;
  consensusHeightM?: number;
  roomDefaultWidthM?: number;
  roomDefaultDepthM?: number;
  roomDefaultHeightM?: number;
  catalogDefaultWidthM?: number;
  catalogDefaultDepthM?: number;
  catalogDefaultHeightM?: number;
}

export interface ResolvedDimensions {
  widthM: number;
  depthM: number;
  heightM: number;
  dimensionSource: DimensionSource;
}

/**
 * Resolves item dimensions using the strict 7-tier priority hierarchy.
 */
export function resolveDimensionHierarchy(input: FurnitureDimensionInput): ResolvedDimensions {
  // 1. Measured drawing geometry
  if (input.measuredWidthM && input.measuredDepthM && input.measuredWidthM > 0 && input.measuredDepthM > 0) {
    return {
      widthM: input.measuredWidthM,
      depthM: input.measuredDepthM,
      heightM: input.measuredHeightM ?? 0.8,
      dimensionSource: 'measured-geometry',
    };
  }

  // 2. Valid AI dimensions
  if (input.aiWidthM && input.aiDepthM && input.aiWidthM > 0.2 && input.aiDepthM > 0.2) {
    return {
      widthM: input.aiWidthM,
      depthM: input.aiDepthM,
      heightM: input.aiHeightM ?? 0.8,
      dimensionSource: 'ai-explicit',
    };
  }

  // 3. Calibrated symbol bounds
  if (input.symbolWidthM && input.symbolDepthM && input.symbolWidthM > 0.2 && input.symbolDepthM > 0.2) {
    return {
      widthM: input.symbolWidthM,
      depthM: input.symbolDepthM,
      heightM: input.symbolHeightM ?? 0.8,
      dimensionSource: 'calibrated-symbol',
    };
  }

  // 4. Repetition consensus
  if (input.consensusWidthM && input.consensusDepthM && input.consensusWidthM > 0 && input.consensusDepthM > 0) {
    return {
      widthM: input.consensusWidthM,
      depthM: input.consensusDepthM,
      heightM: input.consensusHeightM ?? 0.8,
      dimensionSource: 'repetition-consensus',
    };
  }

  // 5. Room context defaults
  if (input.roomDefaultWidthM && input.roomDefaultDepthM && input.roomDefaultWidthM > 0) {
    return {
      widthM: input.roomDefaultWidthM,
      depthM: input.roomDefaultDepthM,
      heightM: input.roomDefaultHeightM ?? 0.8,
      dimensionSource: 'room-context',
    };
  }

  // 6. Catalogue defaults
  if (input.catalogDefaultWidthM && input.catalogDefaultDepthM && input.catalogDefaultWidthM > 0) {
    return {
      widthM: input.catalogDefaultWidthM,
      depthM: input.catalogDefaultDepthM,
      heightM: input.catalogDefaultHeightM ?? 0.8,
      dimensionSource: 'catalogue-default',
    };
  }

  // 7. Reviewed generic fallback
  return {
    widthM: 0.8,
    depthM: 0.8,
    heightM: 0.8,
    dimensionSource: 'generic-fallback',
  };
}

export interface FurnitureInstance {
  id: string;
  family: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  dimensions: { widthM: number; depthM: number; heightM?: number };
  roomCategory?: RoomCategory;
  roomId?: string;
  joineryKind?: 'movable' | 'continuous-counter' | 'wardrobe-run' | 'vanity';
}

/**
 * Checks if a 2D point is inside a polygon using ray casting algorithm.
 */
export function isPointInPolygon(pt: [number, number], polygon: Array<[number, number]>): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  const [x, y] = pt;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface ContainmentValidationResult {
  valid: boolean;
  assignedRoomId?: string;
  assignedCategory?: RoomCategory;
  conflict?: {
    id: string;
    reviewCode: 'ROOM_CONTAINMENT_CONFLICT';
    itemId: string;
    expectedRoomId: string;
    description: string;
  };
}

/**
 * Validates furniture spatial containment inside extracted room boundaries.
 */
export function validateRoomContainment(
  item: FurnitureInstance,
  rooms: RoomZone[]
): ContainmentValidationResult {
  const pt2D: [number, number] = [item.position[0], item.position[2]]; // X-Z ground plane

  let containingRoom: RoomZone | undefined;
  for (const r of rooms) {
    if (isPointInPolygon(pt2D, r.polygon)) {
      containingRoom = r;
      break;
    }
  }

  if (item.roomId && containingRoom && containingRoom.id !== item.roomId) {
    return {
      valid: false,
      assignedRoomId: containingRoom.id,
      assignedCategory: containingRoom.category,
      conflict: {
        id: `rev_containment_${item.id}`,
        reviewCode: 'ROOM_CONTAINMENT_CONFLICT',
        itemId: item.id,
        expectedRoomId: item.roomId,
        description: `Item "${item.id}" positioned inside room "${containingRoom.name}" (${containingRoom.id}) but labeled as room "${item.roomId}".`,
      },
    };
  }

  return {
    valid: true,
    assignedRoomId: containingRoom?.id,
    assignedCategory: containingRoom?.category ?? 'generic',
  };
}

export interface RepetitionGroup {
  family: string;
  count: number;
  instances: FurnitureInstance[];
  consensusDimensions: { widthM: number; depthM: number };
  consensusRotationRad?: number;
}

/**
 * Detects repeated furniture patterns and applies consensus parameters to noisy outliers.
 * Preserves EVERY instance as an independent node.
 */
export function detectRepetitionConsensus(instances: FurnitureInstance[]): {
  groups: RepetitionGroup[];
  repairedInstances: FurnitureInstance[];
  outliersAdjusted: number;
} {
  const byFamily = new Map<string, FurnitureInstance[]>();
  for (const inst of instances) {
    const list = byFamily.get(inst.family) || [];
    list.push(inst);
    byFamily.set(inst.family, list);
  }

  const groups: RepetitionGroup[] = [];
  const repairedInstances: FurnitureInstance[] = [];
  let outliersAdjusted = 0;

  for (const [family, items] of byFamily.entries()) {
    if (items.length < 2) {
      repairedInstances.push(...items);
      continue;
    }

    // Compute median dimensions
    const widths = items.map((i) => i.dimensions.widthM).sort((a, b) => a - b);
    const depths = items.map((i) => i.dimensions.depthM).sort((a, b) => a - b);
    const medianW = widths[Math.floor(widths.length / 2)];
    const medianD = depths[Math.floor(depths.length / 2)];

    const group: RepetitionGroup = {
      family,
      count: items.length,
      instances: items,
      consensusDimensions: { widthM: medianW, depthM: medianD },
    };
    groups.push(group);

    for (const inst of items) {
      const devW = Math.abs(inst.dimensions.widthM - medianW) / medianW;
      const devD = Math.abs(inst.dimensions.depthM - medianD) / medianD;

      // If noisy outlier (>15% deviation), apply consensus dimension
      if (devW > 0.15 || devD > 0.15) {
        repairedInstances.push({
          ...inst,
          dimensions: {
            widthM: medianW,
            depthM: medianD,
            heightM: inst.dimensions.heightM,
          },
        });
        outliersAdjusted++;
      } else {
        repairedInstances.push({ ...inst });
      }
    }
  }

  return { groups, repairedInstances, outliersAdjusted };
}
