// features/pro/safeDelete.ts
// Safe deletion capability matrix and authoritative deletion actions for PRO mode.

import { useScene, type AnyNodeId, type AnyNode } from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';

export interface DeletionCapability {
  nodeType: string;
  officialDeleteAction: string;
  handlesChildren: boolean;
  rebuildsHostGeometry: boolean;
  updatesParentChildren: boolean;
  clearsSelection: boolean;
  createsOneHistoryStep: boolean;
  enabled: boolean;
  reasonDisabled?: string;
}

export const DELETION_CAPABILITY_MATRIX: Record<string, DeletionCapability> = {
  item: {
    nodeType: 'item',
    officialDeleteAction: 'useScene.deleteNode',
    handlesChildren: true,
    rebuildsHostGeometry: false,
    updatesParentChildren: true,
    clearsSelection: true,
    createsOneHistoryStep: true,
    enabled: true,
  },
  door: {
    nodeType: 'door',
    officialDeleteAction: 'useScene.deleteNode',
    handlesChildren: false,
    rebuildsHostGeometry: true,
    updatesParentChildren: true,
    clearsSelection: true,
    createsOneHistoryStep: true,
    enabled: false,
    reasonDisabled: 'Door deletion disabled until Wall opening restoration passes verification.',
  },
  window: {
    nodeType: 'window',
    officialDeleteAction: 'useScene.deleteNode',
    handlesChildren: false,
    rebuildsHostGeometry: true,
    updatesParentChildren: true,
    clearsSelection: true,
    createsOneHistoryStep: true,
    enabled: false,
    reasonDisabled: 'Window deletion disabled until Wall opening restoration passes verification.',
  },
  wall: {
    nodeType: 'wall',
    officialDeleteAction: 'useScene.deleteNode',
    handlesChildren: true,
    rebuildsHostGeometry: false,
    updatesParentChildren: true,
    clearsSelection: true,
    createsOneHistoryStep: true,
    enabled: false,
    reasonDisabled: 'Wall deletion disabled until hosted-child and junction behavior passes.',
  },
  slab: {
    nodeType: 'slab',
    officialDeleteAction: 'useScene.deleteNode',
    handlesChildren: true,
    rebuildsHostGeometry: false,
    updatesParentChildren: true,
    clearsSelection: true,
    createsOneHistoryStep: true,
    enabled: false,
    reasonDisabled: 'Slab deletion disabled until dependency behavior passes.',
  },
  guide: {
    nodeType: 'guide',
    officialDeleteAction: 'none',
    handlesChildren: false,
    rebuildsHostGeometry: false,
    updatesParentChildren: false,
    clearsSelection: true,
    createsOneHistoryStep: false,
    enabled: false,
    reasonDisabled: 'Guide deletion is disabled in PRO editing.',
  },
};

export function canSafelyDeleteNode(nodeId: string): boolean {
  const nodes = useScene.getState().nodes as Record<string, AnyNode | undefined>;
  const node = nodes[nodeId];
  if (!node || !node.type) return false;
  return DELETION_CAPABILITY_MATRIX[node.type]?.enabled ?? false;
}

export function getDeleteDisabledReason(nodeId: string): string | null {
  const nodes = useScene.getState().nodes as Record<string, AnyNode | undefined>;
  const node = nodes[nodeId];
  if (!node || !node.type) return 'Node not found';
  const cap = DELETION_CAPABILITY_MATRIX[node.type];
  if (!cap) return 'Deletion of type ' + node.type + ' is not supported';
  return cap.enabled ? null : (cap.reasonDisabled ?? 'Deletion disabled');
}

export function performSafeDelete(nodeId: string): boolean {
  if (!canSafelyDeleteNode(nodeId)) return false;
  useScene.getState().deleteNode(nodeId as AnyNodeId);
  const currentSelected = useViewer.getState().selection.selectedIds;
  if (currentSelected.includes(nodeId as AnyNodeId)) {
    useViewer.getState().setSelection({
      selectedIds: currentSelected.filter((id) => id !== nodeId),
    });
  }
  return true;
}
