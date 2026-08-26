// harness/ai-scene-install/types.ts
// Shared scene-install context + furniture item shape accepted by installFurnitureItem.

import type { ExtractionResult } from 'design-build-extraction-contracts';

export interface SceneInstallContext {
  nodes: Record<string, unknown>;
  createNodes: (ops: { node: unknown; parentId?: string }[]) => void;
  removeNodeIds?: (ids: string[]) => void;
  levelId: string;
  onProgress?: (kind: 'furniture' | 'slab' | 'walls' | 'windows' | 'doors', installed: number, total: number) => void;
}

/** A normalized furniture item that either installer can supply. */
export interface FurnitureItem {
  id?: string;              // V2 neutral FurnitureInstance.id (preserves instance identity)
  familyId?: string;        // V2 (catalog:slug)
  type?: string;            // V3 (catalog:slug or slug)
  positionM?: { x: number; y: number }; // V2
  pos?: [number, number];   // V3
  widthM?: number;          // V2
  width?: number;           // V3
  depthM?: number;          // V2
  depth?: number;           // V3
  heightM?: number;         // V2
  height?: number;          // V3
  rotationDeg?: number;     // V2
  rotation?: number;        // V3
  zoneId?: string | null;
  confidence?: number;
  sourceEntityId?: string;
  frameId?: string;
}

export type { ExtractionResult };
