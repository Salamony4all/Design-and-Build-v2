// features/pro/selection-action-store.ts
// Lightweight store sharing screen anchor coordinates between R3F Canvas and DOM overlay.

import { create } from 'zustand';

export interface SelectionAnchorState {
  screenX: number;
  screenY: number;
  visible: boolean;
  selectedId: string | null;
  nodeType: string | null;
  worldBoundsFinite: boolean;
  projectedAnchorFinite: boolean;
  unclampedPosition: { x: number; y: number };
  finalClampedPosition: { x: number; y: number };
  toolbarInsideViewer: boolean;
  viewerBounds: { left: number; top: number; width: number; height: number; right: number; bottom: number };

  setAnchor: (data: Partial<SelectionAnchorState>) => void;
  hide: () => void;
}

export const useSelectionActionStore = create<SelectionAnchorState>((set) => ({
  screenX: 0,
  screenY: 0,
  visible: false,
  selectedId: null,
  nodeType: null,
  worldBoundsFinite: false,
  projectedAnchorFinite: false,
  unclampedPosition: { x: 0, y: 0 },
  finalClampedPosition: { x: 0, y: 0 },
  toolbarInsideViewer: false,
  viewerBounds: { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 },

  setAnchor: (data) => set((s) => ({ ...s, ...data })),
  hide: () => set({ visible: false }),
}));
