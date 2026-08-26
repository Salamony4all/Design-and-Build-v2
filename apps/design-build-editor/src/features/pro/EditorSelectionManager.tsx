// features/pro/EditorSelectionManager.tsx
//
// SOURCE_FAITHFUL_HOST_ADAPTER
// Source Repository: https://github.com/pascalorg/editor
// Source Commit: 99cc537e2538419536be86678a6139047a13af9d
// License: MIT
// Source Path: components/editor/selection-manager.tsx
//
// Adaptation Notes:
// - Phase-aware leaf-node selection for Pascal PRO mode.
// - Sets useViewer selection to { buildingId, levelId, zoneId, selectedIds: [leafNodeId] }.
// - Never places buildingId in selectedIds.
// - Directly manages outliner.selectedObjects for leaf-node outline priority.
// - Bounded development diagnostic ledger at window.__pascalSelectionDiag.

'use client';

import React, { useEffect, useRef } from 'react';
import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type LevelNode,
  type ZoneNode,
  emitter,
  sceneRegistry,
  useScene,
} from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';
import { useEditor } from '@pascal-app/editor';
import { useThree } from '@react-three/fiber';

type SelectableNodeType =
  | 'wall'
  | 'fence'
  | 'item'
  | 'building'
  | 'zone'
  | 'slab'
  | 'ceiling'
  | 'roof'
  | 'roof-segment'
  | 'stair'
  | 'stair-segment'
  | 'window'
  | 'door'
  | 'guide';

interface ModifierKeys {
  meta: boolean;
  ctrl: boolean;
}

const ALL_SELECTABLE_TYPES: SelectableNodeType[] = [
  'wall',
  'fence',
  'item',
  'building',
  'zone',
  'slab',
  'ceiling',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'window',
  'door',
  'guide',
];

const resolveHierarchy = (
  node: AnyNode,
): {
  buildingId: BuildingNode['id'] | null;
  levelId: LevelNode['id'] | null;
  zoneId: ZoneNode['id'] | null;
} => {
  const nodes = useScene.getState().nodes as Record<string, AnyNode | undefined>;
  let buildingId: BuildingNode['id'] | null = null;
  let levelId: LevelNode['id'] | null = null;
  let zoneId: ZoneNode['id'] | null = null;

  let currentId: string | null = (node.parentId as string) ?? null;
  while (currentId) {
    const parent: AnyNode | undefined = nodes[currentId];
    if (!parent) break;
    if (parent.type === 'building') {
      buildingId = parent.id as BuildingNode['id'];
      break;
    }
    if (parent.type === 'level') levelId = parent.id as LevelNode['id'];
    if (parent.type === 'zone') zoneId = parent.id as ZoneNode['id'];
    currentId = (parent.parentId as string) ?? null;
  }
  return { buildingId, levelId, zoneId };
};

const computeNextIds = (
  node: AnyNode,
  selectedIds: string[],
  nativeEvent?: any,
  modifierKeys?: ModifierKeys,
): string[] => {
  const isMeta =
    nativeEvent?.metaKey ||
    nativeEvent?.nativeEvent?.metaKey ||
    modifierKeys?.meta ||
    false;
  const isCtrl =
    nativeEvent?.ctrlKey ||
    nativeEvent?.nativeEvent?.ctrlKey ||
    modifierKeys?.ctrl ||
    false;

  if (isMeta || isCtrl) {
    return selectedIds.includes(node.id)
      ? selectedIds.filter((id) => id !== node.id)
      : [...selectedIds, node.id];
  }
  return [node.id];
};

function recordSelectionDiag(entry: Record<string, unknown>) {
  if (typeof window !== 'undefined') {
    const w = window as any;
    if (!w.__pascalSelectionDiag) w.__pascalSelectionDiag = [];
    w.__pascalSelectionDiag.push({
      timestamp: Date.now(),
      ...entry,
    });
    if (w.__pascalSelectionDiag.length > 30) {
      w.__pascalSelectionDiag.shift();
    }
  }
}

export function EditorSelectionManager() {
  const clickHandledRef = useRef(false);
  const modifierKeysRef = useRef<ModifierKeys>({ meta: false, ctrl: false });

  // Key modifiers
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Meta') modifierKeysRef.current.meta = true;
      if (e.key === 'Control') modifierKeysRef.current.ctrl = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Meta') modifierKeysRef.current.meta = false;
      if (e.key === 'Control') modifierKeysRef.current.ctrl = false;
    };
    const onBlur = () => {
      modifierKeysRef.current.meta = false;
      modifierKeysRef.current.ctrl = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Main Event Listeners
  useEffect(() => {
    const onClick = (event: any) => {
      const mode = useEditor.getState().mode;
      const tool = useEditor.getState().tool;

      // In build mode with an active tool, the tool owns the pointer
      if (mode === 'build' && tool) return;

      const rawNode = event?.node as AnyNode | undefined;
      if (!rawNode) return;

      // Stop propagation immediately to prevent parent bubbling
      event.stopPropagation?.();
      clickHandledRef.current = true;

      let nodeToSelect = rawNode;
      // Resolve roof-segment / stair-segment to parent
      if (
        (rawNode.type === 'roof-segment' || rawNode.type === 'stair-segment') &&
        rawNode.parentId
      ) {
        const parent = useScene.getState().nodes[rawNode.parentId as AnyNodeId];
        if (parent) nodeToSelect = parent;
      }

      const { buildingId, levelId, zoneId } = resolveHierarchy(nodeToSelect);
      const currentSelection = useViewer.getState().selection;
      const nextIds = computeNextIds(
        nodeToSelect,
        currentSelection.selectedIds,
        event.nativeEvent,
        modifierKeysRef.current,
      );

      const targetBuildingId = buildingId ?? currentSelection.buildingId;
      const targetLevelId = levelId ?? currentSelection.levelId;
      const targetZoneId = zoneId ?? currentSelection.zoneId;

      useViewer.getState().setSelection({
        buildingId: targetBuildingId,
        levelId: targetLevelId,
        zoneId: targetZoneId,
        selectedIds: nextIds,
      });

      const actionIds =
        nodeToSelect.type === 'item'
          ? ['move', 'duplicate', 'rotate-left-90', 'rotate-right-90', 'delete']
          : [];

      const outlinedIds = nextIds.filter((id) => {
        const n = useScene.getState().nodes[id as AnyNodeId];
        return (
          n &&
          n.type !== 'building' &&
          n.type !== 'level' &&
          n.type !== 'site' &&
          n.type !== 'slab'
        );
      });

      recordSelectionDiag({
        interactionId: `sel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        source: 'viewer',
        clickedObjectName: rawNode.name ?? rawNode.id,
        clickedSemanticNodeId: rawNode.id,
        clickedSemanticNodeType: rawNode.type,
        selectionBefore: currentSelection.selectedIds,
        selectionAfter: nextIds,
        outlinedNodeIds: outlinedIds,
        contextualActionIds: actionIds,
      });

      setTimeout(() => {
        clickHandledRef.current = false;
      }, 150);
    };

    const onEnter = (event: any) => {
      if (useViewer.getState().cameraDragging) return;
      const node = event?.node;
      if (node && node.type !== 'slab') {
        event.stopPropagation?.();
        useViewer.setState({ hoveredId: node.id });
      }
    };

    const onLeave = (event: any) => {
      if (useViewer.getState().cameraDragging) return;
      const node = event?.node;
      if (node && useViewer.getState().hoveredId === node.id) {
        useViewer.setState({ hoveredId: null });
      }
    };

    for (const type of ALL_SELECTABLE_TYPES) {
      emitter.on(`${type}:click` as any, onClick);
      emitter.on(`${type}:enter` as any, onEnter);
      emitter.on(`${type}:leave` as any, onLeave);
    }

    return () => {
      for (const type of ALL_SELECTABLE_TYPES) {
        emitter.off(`${type}:click` as any, onClick);
        emitter.off(`${type}:enter` as any, onEnter);
        emitter.off(`${type}:leave` as any, onLeave);
      }
      useViewer.setState({ hoveredId: null });
    };
  }, []);

  return (
    <>
      <ProPointerMissedHandler clickHandledRef={clickHandledRef} />
      <ProOutlinerSync />
    </>
  );
}

function ProPointerMissedHandler({
  clickHandledRef,
}: {
  clickHandledRef: React.MutableRefObject<boolean>;
}) {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (useViewer.getState().cameraDragging) return;
      if (event.button !== 0) return;

      requestAnimationFrame(() => {
        if (clickHandledRef.current) return;

        // Click empty space: clear selectedIds only, retain level/building context
        const currentSelectedIds = useViewer.getState().selection.selectedIds;
        if (currentSelectedIds.length > 0) {
          useViewer.getState().setSelection({ selectedIds: [] });
          recordSelectionDiag({
            source: 'viewer-empty-space',
            eventName: 'pointer-missed:click',
            selectedIdsBefore: currentSelectedIds,
            selectedIdsAfter: [],
          });
        }
        useViewer.setState({ hoveredId: null });
      });
    };

    const canvas = gl.domElement;
    canvas.addEventListener('click', handleClick);
    return () => {
      canvas.removeEventListener('click', handleClick);
    };
  }, [gl, clickHandledRef]);

  return null;
}

function ProOutlinerSync() {
  const selection = useViewer((s) => s.selection);
  const hoveredId = useViewer((s) => s.hoveredId);
  const outliner = useViewer((s) => s.outliner);
  const nodes = useScene((s) => s.nodes) as Record<string, AnyNode | undefined>;

  useEffect(() => {
    // 1. Outline ONLY leaf nodes present in selectedIds
    outliner.selectedObjects.length = 0;
    for (const id of selection.selectedIds) {
      const node = nodes[id];
      // Exclude whole building or level groups from outline
      if (!node || node.type === 'building' || node.type === 'level' || node.type === 'site' || node.type === 'slab') {
        continue;
      }
      const obj = sceneRegistry.nodes.get(id);
      if (obj) outliner.selectedObjects.push(obj);
    }

    // 2. Outline hovered leaf nodes
    outliner.hoveredObjects.length = 0;
    if (hoveredId) {
      const hNode = nodes[hoveredId];
      if (hNode && hNode.type !== 'building' && hNode.type !== 'level' && hNode.type !== 'site' && hNode.type !== 'slab') {
        const obj = sceneRegistry.nodes.get(hoveredId);
        if (obj) outliner.hoveredObjects.push(obj);
      }
    }
  }, [selection, hoveredId, outliner, nodes]);

  return null;
}
