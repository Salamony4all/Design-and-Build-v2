// features/viewer-interaction/scene-history.ts
// Global Undo/Redo coordinator & reactive history hook backed by `@pascal-app/core` zundo temporal state.

'use client';

import { useEffect, useState } from 'react';
import { type AnyNodeId, useScene } from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';
import { syncManualWallTreatmentsToScene } from '../furniture/architectural-features';

export const SCENE_INVALIDATE_EVENT = 'db:scene-invalidate';

type TemporalStateShape = {
  pastStates: unknown[];
  futureStates: unknown[];
  isTracking?: boolean;
  undo: () => void;
  redo: () => void;
  resume?: () => void;
};

type TemporalStoreHandle = {
  getState: () => TemporalStateShape;
  subscribe?: (cb: () => void) => () => void;
};

function getTemporalStore(): TemporalStoreHandle | undefined {
  return (useScene as unknown as { temporal?: TemporalStoreHandle }).temporal;
}

/** Sync custom architectural overlays, bump geometry revision, and request a canvas frame. */
export function notifySceneMutated(): void {
  try {
    syncManualWallTreatmentsToScene();
  } catch {
    /* non-fatal when stores/scene absent */
  }
  try {
    useViewer.getState().bumpGeometryRevision?.();
  } catch {
    /* non-fatal */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SCENE_INVALIDATE_EVENT));
  }
}

function syncSceneAfterHistoryJump(beforeNodes: Record<string, any>): void {
  const state = useScene.getState();
  const afterNodes = (state.nodes ?? {}) as Record<string, any>;
  const levelsToRefresh = new Set<string>();
  const changedIds = new Set<string>();

  for (const id of Object.keys(afterNodes)) {
    if (beforeNodes[id] !== afterNodes[id]) {
      changedIds.add(id);
      if (afterNodes[id]?.parentId) levelsToRefresh.add(String(afterNodes[id].parentId));
    }
  }
  for (const id of Object.keys(beforeNodes)) {
    if (!afterNodes[id]) {
      changedIds.add(id);
      if (beforeNodes[id]?.parentId) levelsToRefresh.add(String(beforeNodes[id].parentId));
    }
  }

  for (const id of changedIds) {
    if (afterNodes[id]) state.markDirty?.(id as AnyNodeId);
    const parentId = afterNodes[id]?.parentId ?? beforeNodes[id]?.parentId;
    if (parentId && afterNodes[parentId]) {
      state.markDirty?.(parentId as AnyNodeId);
    }
  }

  for (const node of Object.values(afterNodes)) {
    if (!node) continue;
    if (
      (node.type === 'wall' || node.type === 'slab' || node.type === 'door' || node.type === 'window') &&
      (!node.parentId || levelsToRefresh.has(String(node.parentId)) || changedIds.size === 0)
    ) {
      state.markDirty?.(node.id as AnyNodeId);
    }
  }

  try {
    const viewer = useViewer.getState();
    const curSel = viewer.selection?.selectedIds ?? [];
    const surviving = curSel.filter((id) => Boolean(afterNodes[id]));
    if (surviving.length !== curSel.length) {
      viewer.setSelection({ selectedIds: surviving });
    }
  } catch {
    /* viewer store optional in tests */
  }

  notifySceneMutated();
}

export function performGlobalUndo(): boolean {
  const temporal = getTemporalStore();
  if (!temporal) return false;
  const st = temporal.getState();
  if (st.isTracking === false) st.resume?.();
  if (!st.pastStates?.length) return false;

  const beforeNodes = { ...useScene.getState().nodes };
  st.undo();
  syncSceneAfterHistoryJump(beforeNodes);
  queueMicrotask(() => syncSceneAfterHistoryJump(beforeNodes));
  return true;
}

export function performGlobalRedo(): boolean {
  const temporal = getTemporalStore();
  if (!temporal) return false;
  const st = temporal.getState();
  if (st.isTracking === false) st.resume?.();
  if (!st.futureStates?.length) return false;

  const beforeNodes = { ...useScene.getState().nodes };
  st.redo();
  syncSceneAfterHistoryJump(beforeNodes);
  queueMicrotask(() => syncSceneAfterHistoryJump(beforeNodes));
  return true;
}

export function useSceneHistoryState(): { canUndo: boolean; canRedo: boolean } {
  const readCounts = () => {
    try {
      const st = getTemporalStore()?.getState();
      return {
        canUndo: (st?.pastStates?.length ?? 0) > 0,
        canRedo: (st?.futureStates?.length ?? 0) > 0,
      };
    } catch {
      return { canUndo: false, canRedo: false };
    }
  };

  const [counts, setCounts] = useState(readCounts);

  useEffect(() => {
    const sync = () => {
      const next = readCounts();
      setCounts((prev) =>
        prev.canUndo === next.canUndo && prev.canRedo === next.canRedo ? prev : next,
      );
    };
    sync();
    const unsubTemporal = getTemporalStore()?.subscribe?.(sync);
    const unsubScene = (useScene as unknown as { subscribe?: (cb: () => void) => () => void }).subscribe?.(sync);
    return () => {
      unsubTemporal?.();
      unsubScene?.();
    };
  }, []);

  return counts;
}
