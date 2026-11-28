// features/pro/EditorSelectionManager.tsx
//
// SOURCE_FAITHFUL_HOST_ADAPTER
// Source Repository: https://github.com/pascalorg/editor
// Source Commit: 99cc537e2538419536be86678a6139047a13af9d
// License: MIT
// Source Path: components/editor/selection-manager.tsx
//
// Adaptation Notes:
// - Phase-aware leaf-node selection for Pascal PRO & Standard modes.
// - Sets useViewer selection to { buildingId, levelId, zoneId, selectedIds: [leafNodeId] }.
// - Never places buildingId in selectedIds.
// - Directly manages outliner.selectedObjects and 3D wall edge highlight for leaf-node priority.
// - Includes direct Three.js raycast + analytical thin-wall fallback because Pascal WallRenderer
//   attaches pointer events only to an invisible (`visible={false}`) collision mesh.
// - Bounded development diagnostic ledger at window.__pascalSelectionDiag.

'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
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
import {
  detectClickedWallSide,
  pickSceneNodeAtPoint,
  setLastClickedWall,
  type WallLike,
} from '../viewer-interaction/wall-selection-helper';

const OVERLAY_LAYER = 1;

function extractClientCoords(ev: any): { clientX: number; clientY: number } | null {
  for (const cand of [ev, ev?.nativeEvent, ev?.nativeEvent?.nativeEvent, ev?.sourceEvent]) {
    if (
      cand &&
      typeof cand.clientX === 'number' &&
      Number.isFinite(cand.clientX) &&
      typeof cand.clientY === 'number' &&
      Number.isFinite(cand.clientY)
    ) {
      return { clientX: cand.clientX, clientY: cand.clientY };
    }
  }
  return null;
}

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
  shift: boolean;
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
  const isShift =
    nativeEvent?.shiftKey ||
    nativeEvent?.nativeEvent?.shiftKey ||
    modifierKeys?.shift ||
    false;

  if (isMeta || isCtrl || isShift) {
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
  const { camera, scene, gl, invalidate } = useThree();
  const threeRef = useRef({ camera, scene, gl, invalidate });
  threeRef.current = { camera, scene, gl, invalidate };

  const clickHandledRef = useRef(false);
  const modifierKeysRef = useRef<ModifierKeys>({ meta: false, ctrl: false, shift: false });

  // Key modifiers
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Meta') modifierKeysRef.current.meta = true;
      if (e.key === 'Control') modifierKeysRef.current.ctrl = true;
      if (e.key === 'Shift') modifierKeysRef.current.shift = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Meta') modifierKeysRef.current.meta = false;
      if (e.key === 'Control') modifierKeysRef.current.ctrl = false;
      if (e.key === 'Shift') modifierKeysRef.current.shift = false;
    };
    const onBlur = () => {
      modifierKeysRef.current.meta = false;
      modifierKeysRef.current.ctrl = false;
      modifierKeysRef.current.shift = false;
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

  const commitSelection = useCallback((rawNode: AnyNode, nativeEvent?: any, hitPoint?: THREE.Vector3) => {
    let nodeToSelect = rawNode;
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
      nativeEvent,
      modifierKeysRef.current,
    );

    if (nodeToSelect.type === 'wall') {
      const camPos = threeRef.current.camera.position;
      const side = detectClickedWallSide(nodeToSelect as unknown as WallLike, camPos, hitPoint);
      setLastClickedWall({
        wallId: nodeToSelect.id,
        side,
        point: hitPoint ? [hitPoint.x, hitPoint.y, hitPoint.z] : [camPos.x, camPos.y, camPos.z],
      });
    } else if (nextIds.every((id) => useScene.getState().nodes[id as AnyNodeId]?.type !== 'wall')) {
      setLastClickedWall(null);
    }

    const targetBuildingId = buildingId ?? currentSelection.buildingId;
    const targetLevelId = levelId ?? currentSelection.levelId;
    const targetZoneId = zoneId ?? currentSelection.zoneId;

    useViewer.getState().setSelection({
      buildingId: targetBuildingId,
      levelId: targetLevelId,
      zoneId: targetZoneId,
      selectedIds: nextIds,
    });
    useViewer.setState({ hoveredId: null });
    threeRef.current.invalidate?.();

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
      clickedSemanticNodeId: nodeToSelect.id,
      clickedSemanticNodeType: nodeToSelect.type,
      selectionBefore: currentSelection.selectedIds,
      selectionAfter: nextIds,
      outlinedNodeIds: outlinedIds,
      contextualActionIds: actionIds,
    });
  }, []);

  // Main Event Listeners
  useEffect(() => {
    const markHandled = () => {
      clickHandledRef.current = true;
      setTimeout(() => {
        clickHandledRef.current = false;
      }, 150);
    };

    const onClick = (event: any) => {
      const mode = useEditor.getState().mode;
      const tool = useEditor.getState().tool;
      if (mode === 'build' && tool) return;

      const rawNode = event?.node as AnyNode | undefined;
      if (!rawNode) return;

      event.stopPropagation?.();
      markHandled();

      const coords = extractClientCoords(event);
      const rect = threeRef.current.gl.domElement.getBoundingClientRect();
      const rawHitPt =
        Array.isArray(event?.position) && event.position.length >= 3
          ? new THREE.Vector3(event.position[0], event.position[1], event.position[2])
          : undefined;
      const rawHitDist = rawHitPt ? threeRef.current.camera.position.distanceTo(rawHitPt) : Infinity;
      const isLeafPriority =
        rawNode.type === 'item' ||
        rawNode.type === 'door' ||
        rawNode.type === 'window' ||
        rawNode.type === 'column';
      const isNonLeafShell =
        rawNode.type === 'building' ||
        rawNode.type === 'level' ||
        rawNode.type === 'zone' ||
        rawNode.type === 'guide' ||
        rawNode.type === 'ceiling';

      if (coords && rect.width > 0 && rect.height > 0) {
        const picked = pickSceneNodeAtPoint({
          ndcX: ((coords.clientX - rect.left) / rect.width) * 2 - 1,
          ndcY: -((coords.clientY - rect.top) / rect.height) * 2 + 1,
          camera: threeRef.current.camera,
          scene: threeRef.current.scene,
          nodes: useScene.getState().nodes as unknown as Record<string, WallLike | undefined>,
          registryNodes: sceneRegistry.nodes,
        });

        if (picked && picked.node.type !== 'slab') {
          if (isLeafPriority && rawHitDist <= picked.distance + 0.35) {
            commitSelection(rawNode, event.nativeEvent, rawHitPt);
          } else {
            commitSelection(picked.node as unknown as AnyNode, event.nativeEvent, picked.point);
          }
          return;
        }
        if (picked && picked.node.type === 'slab') {
          if (isLeafPriority) {
            commitSelection(rawNode, event.nativeEvent, rawHitPt);
          } else {
            commitSelection(picked.node as unknown as AnyNode, event.nativeEvent, picked.point);
          }
          return;
        }
        if (isNonLeafShell) {
          setLastClickedWall(null);
          useViewer.getState().setSelection({ selectedIds: [] });
          return;
        }
      } else if (isNonLeafShell) {
        setLastClickedWall(null);
        useViewer.getState().setSelection({ selectedIds: [] });
        return;
      }

      commitSelection(rawNode, event.nativeEvent, rawHitPt);
    };

    const onEnter = (event: any) => {
      if (useViewer.getState().cameraDragging) return;
      const node = event?.node;
      if (
        node &&
        node.type !== 'slab' &&
        node.type !== 'building' &&
        node.type !== 'level' &&
        node.type !== 'zone' &&
        node.type !== 'guide' &&
        node.type !== 'ceiling'
      ) {
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
  }, [commitSelection]);

  return (
    <>
      <CanvasWallAndFallbackPicker clickHandledRef={clickHandledRef} onPickNode={commitSelection} />
      <ProOutlinerSync />
      <WallSelectionHighlight3D />
    </>
  );
}

function CanvasWallAndFallbackPicker({
  clickHandledRef,
  onPickNode,
}: {
  clickHandledRef: React.MutableRefObject<boolean>;
  onPickNode: (node: AnyNode, nativeEvent?: any, hitPoint?: THREE.Vector3) => void;
}) {
  const { gl, scene, camera, invalidate } = useThree();
  const threeRef = useRef({ scene, camera, invalidate });
  threeRef.current = { scene, camera, invalidate };

  useEffect(() => {
    const canvas = gl.domElement;
    let downInfo: { x: number; y: number; t: number; pointerType: string } | null = null;
    let hoverRaf = 0;
    let lastWallHoverId: string | null = null;

    const toNdc = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        ndcX: ((clientX - rect.left) / rect.width) * 2 - 1,
        ndcY: -((clientY - rect.top) / rect.height) * 2 + 1,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) {
        downInfo = null;
        return;
      }
      downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), pointerType: e.pointerType };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons !== 0 || useViewer.getState().cameraDragging || useViewer.getState().inputDragging) {
        if (lastWallHoverId !== null && useViewer.getState().hoveredId === lastWallHoverId) {
          useViewer.setState({ hoveredId: null });
          threeRef.current.invalidate?.();
        }
        lastWallHoverId = null;
        canvas.style.cursor = '';
        return;
      }
      const mode = useEditor.getState().mode;
      const tool = useEditor.getState().tool;
      if (mode === 'build' && tool) return;

      const cx = e.clientX;
      const cy = e.clientY;
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        const ndc = toNdc(cx, cy);
        if (!ndc) return;
        const picked = pickSceneNodeAtPoint({
          ndcX: ndc.ndcX,
          ndcY: ndc.ndcY,
          camera: threeRef.current.camera,
          scene: threeRef.current.scene,
          nodes: useScene.getState().nodes as unknown as Record<string, WallLike | undefined>,
          registryNodes: sceneRegistry.nodes,
        });
        if (picked?.node.type === 'wall') {
          lastWallHoverId = picked.node.id;
          if (useViewer.getState().hoveredId !== picked.node.id) {
            useViewer.setState({ hoveredId: picked.node.id as AnyNodeId });
            threeRef.current.invalidate?.();
          }
          canvas.style.cursor = 'pointer';
        } else {
          if (lastWallHoverId !== null && useViewer.getState().hoveredId === lastWallHoverId) {
            useViewer.setState({ hoveredId: null });
            threeRef.current.invalidate?.();
          }
          lastWallHoverId = null;
          canvas.style.cursor = picked && picked.node.type !== 'slab' ? 'pointer' : '';
        }
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0 || !downInfo) return;
      const d = downInfo;
      downInfo = null;
      const vs = useViewer.getState();
      if (vs.cameraDragging || vs.inputDragging) return;
      const mode = useEditor.getState().mode;
      const tool = useEditor.getState().tool;
      if (mode === 'build' && tool) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 450) return;
      if ((window as unknown as { __dbWalkModeActive?: boolean }).__dbWalkModeActive && d.pointerType === 'touch') {
        return;
      }

      const cx = e.clientX;
      const cy = e.clientY;
      const evSnapshot = {
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        clientX: cx,
        clientY: cy,
      };

      requestAnimationFrame(() => {
        if (clickHandledRef.current) {
          clickHandledRef.current = false;
          return;
        }
        const ndc = toNdc(cx, cy);
        if (!ndc) return;
        const picked = pickSceneNodeAtPoint({
          ndcX: ndc.ndcX,
          ndcY: ndc.ndcY,
          camera: threeRef.current.camera,
          scene: threeRef.current.scene,
          nodes: useScene.getState().nodes as unknown as Record<string, WallLike | undefined>,
          registryNodes: sceneRegistry.nodes,
        });
        if (picked) {
          onPickNode(picked.node as unknown as AnyNode, evSnapshot, picked.point);
          return;
        }
        const currentSelectedIds = useViewer.getState().selection.selectedIds;
        if (currentSelectedIds.length > 0) {
          setLastClickedWall(null);
          useViewer.getState().setSelection({ selectedIds: [] });
          recordSelectionDiag({
            source: 'viewer-empty-space',
            eventName: 'pointer-missed:click',
            selectedIdsBefore: currentSelectedIds,
            selectedIdsAfter: [],
          });
        }
        useViewer.setState({ hoveredId: null });
        threeRef.current.invalidate?.();
      });
    };

    const onPointerLeave = () => {
      downInfo = null;
      canvas.style.cursor = '';
      if (lastWallHoverId !== null && useViewer.getState().hoveredId === lastWallHoverId) {
        useViewer.setState({ hoveredId: null });
        threeRef.current.invalidate?.();
      }
      lastWallHoverId = null;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    return () => {
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      canvas.style.cursor = '';
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [gl, clickHandledRef, onPickNode]);

  return null;
}

function ProOutlinerSync() {
  const selection = useViewer((s) => s.selection);
  const hoveredId = useViewer((s) => s.hoveredId);
  const outliner = useViewer((s) => s.outliner);
  const nodes = useScene((s) => s.nodes) as Record<string, AnyNode | undefined>;

  useEffect(() => {
    outliner.selectedObjects.length = 0;
    for (const id of selection.selectedIds) {
      const node = nodes[id];
      if (!node || node.type === 'building' || node.type === 'level' || node.type === 'site' || node.type === 'slab') {
        continue;
      }
      const obj = sceneRegistry.nodes.get(id);
      if (obj) outliner.selectedObjects.push(obj);
    }

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

/** 3D edge outline overlay on selected & hovered walls (placed on OVERLAY_LAYER so MRT/renders ignore it). */
function WallSelectionHighlight3D() {
  const { scene, invalidate } = useThree();
  const selectedIds = useViewer((s) => s.selection.selectedIds);
  const hoveredId = useViewer((s) => s.hoveredId);
  const geometryRevision = useViewer((s) => s.geometryRevision);
  const nodes = useScene((s) => s.nodes) as Record<string, AnyNode | undefined>;

  useEffect(() => {
    const existing = scene.getObjectByName('db-selection-highlight');
    if (existing) scene.remove(existing);

    const selWallIds = selectedIds.filter((id) => nodes[id]?.type === 'wall');
    const hoverWallId = hoveredId && nodes[hoveredId]?.type === 'wall' && !selectedIds.includes(hoveredId) ? hoveredId : null;
    if (selWallIds.length === 0 && !hoverWallId) {
      invalidate();
      return;
    }

    const group = new THREE.Group();
    group.name = 'db-selection-highlight';
    group.layers.set(OVERLAY_LAYER);
    const disposables: Array<{ dispose: () => void }> = [];

    const addWallOutline = (wallId: string, color: number, opacity: number) => {
      const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh | undefined;
      if (!mesh || !mesh.geometry) return;
      mesh.updateWorldMatrix(true, false);
      const edgeGeo = new THREE.EdgesGeometry(mesh.geometry, 18);
      const edgeMat = new THREE.LineBasicMaterial({
        color,
        fog: false,
        depthTest: false,
        transparent: true,
        opacity,
      });
      const lines = new THREE.LineSegments(edgeGeo, edgeMat);
      lines.layers.set(OVERLAY_LAYER);
      lines.applyMatrix4(mesh.matrixWorld);
      lines.renderOrder = 999;
      group.add(lines);
      disposables.push(edgeGeo, edgeMat);
    };

    for (const id of selWallIds) addWallOutline(id, 0x2563eb, 0.95);
    if (hoverWallId) addWallOutline(hoverWallId, 0x0ea5e9, 0.68);

    if (group.children.length > 0) scene.add(group);
    invalidate();

    return () => {
      scene.remove(group);
      for (const d of disposables) d.dispose();
    };
  }, [scene, invalidate, selectedIds, hoveredId, geometryRevision, nodes]);

  return null;
}
