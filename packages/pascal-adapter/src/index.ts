// design-build-pascal-adapter
// The ONLY package permitted to import both extraction-contracts and Pascal
// (@pascal-app/core / @pascal-app/nodes). At the first checkpoint it provides
// INTERFACES ONLY — live extraction is not connected yet (Section 12 rule).

import type {
  SlabContract, WallContract, ColumnContract, WindowContract, DoorContract, ExtractionResult,
} from 'design-build-extraction-contracts';

export interface StagedCommit {
  slabs: SlabContract[];
  walls: WallContract[];
  columns: ColumnContract[];
  windows: WindowContract[];
  doors: DoorContract[];
}

export interface AdaptedNode {
  id: string;
  kind: string;
  node: unknown;
}

export interface PascalAdapter {
  adaptSlab(contract: SlabContract): AdaptedNode;
  adaptWall(contract: WallContract): AdaptedNode;
  adaptColumn(contract: ColumnContract): AdaptedNode;
  adaptWindow(contract: WindowContract): AdaptedNode;
  adaptDoor(contract: DoorContract): AdaptedNode;
  commit(result: ExtractionResult, onPhase?: (phase: string, nodes: AdaptedNode[]) => void): Promise<string[]>;
  rollback(commitId: string): Promise<void>;
}

export function createNeutralAdapter(): PascalAdapter {
  const noop = (c: { id: string; kind: string }) => ({ id: c.id, kind: c.kind, node: null });
  return {
    adaptSlab: noop, adaptWall: noop, adaptColumn: noop, adaptWindow: noop, adaptDoor: noop,
    async commit() { return []; },
    async rollback() { /* no-op */ },
  };
}

export * from './scene-tree';
