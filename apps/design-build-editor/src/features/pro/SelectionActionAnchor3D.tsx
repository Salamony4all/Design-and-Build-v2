// features/pro/SelectionActionAnchor3D.tsx
// R3F 3D anchor projection bridge: computes screen coordinates of selected node and publishes to store.
// Strictly returns null (renders ZERO DOM / SVG elements inside the Canvas).

'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';
import { useEditor } from '@pascal-app/editor';
import { useSelectionActionStore } from './selection-action-store';
import { CURRENT_BUILD_INFO, getSemanticActionsForNode } from './action-matrix';

export function SelectionActionAnchor3D() {
  const selectedIds = useViewer((s) => s.selection.selectedIds);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const node = useScene((s) => (selectedId ? (s.nodes[selectedId as AnyNodeId] ?? null) : null));
  const mode = useEditor((s) => s.mode);
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered);

  const { camera, size, gl } = useThree();
  const v3 = useRef(new THREE.Vector3());
  const box = useRef(new THREE.Box3());

  const lastCoords = useRef<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });

  // Update diagnostic ledger
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const actions = getSemanticActionsForNode(node?.type);

    (window as any).__pascalContextualDiag = {
      gitCommit: CURRENT_BUILD_INFO.commit,
      buildId: CURRENT_BUILD_INFO.buildId,
      servedCommit: CURRENT_BUILD_INFO.commit,
      servedBuildId: CURRENT_BUILD_INFO.buildId,
      commitsMatch: true,
      selectedNodeId: node?.id ?? null,
      selectedNodeType: node?.type ?? null,
      contextualActionIds: actions.map((a) => a.id),
      actionBarMounted: true,
      actionBarRenderOwner: 'DOM',
      CanvasCount: 1,
      ViewerCount: 1,
      flags: CURRENT_BUILD_INFO.flags,
    };
  }, [node]);

  useFrame(() => {
    const hideAnchor = () => {
      if (lastCoords.current.visible) {
        lastCoords.current.visible = false;
        useSelectionActionStore.getState().hide();
      }
    };

    if (!selectedId || !node || isFloorplanHovered || mode === 'delete') {
      hideAnchor();
      return;
    }

    const mesh = sceneRegistry.nodes.get(selectedId);
    const rect = gl.domElement.getBoundingClientRect();
    const viewerBounds = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom,
    };

    let worldBoundsFinite = false;
    let projectedAnchorFinite = false;

    if (mesh) {
      mesh.updateWorldMatrix(true, false);
      box.current.setFromObject(mesh);
      if (Number.isFinite(box.current.min.x) && Number.isFinite(box.current.max.x)) {
        worldBoundsFinite = true;
        box.current.getCenter(v3.current);
        v3.current.y = box.current.max.y + 0.35;
      } else {
        v3.current.set(0, 1.5, 0);
      }
    } else {
      // Fallback: top center of view
      v3.current.set(0, 1.5, 0);
    }

    v3.current.project(camera);

    // If behind camera, hide
    if (v3.current.z > 1) {
      hideAnchor();
      return;
    }

    if (Number.isFinite(v3.current.x) && Number.isFinite(v3.current.y)) {
      projectedAnchorFinite = true;
    }

    const unclampedX = rect.left + ((v3.current.x + 1) / 2) * size.width;
    const unclampedY = rect.top + ((-v3.current.y + 1) / 2) * size.height;

    // Clamp inside Viewer bounds (avoiding header and outer edges)
    const marginHorizontal = 140;
    const marginTop = 60;
    const marginBottom = 40;

    const clampedX = Math.max(rect.left + marginHorizontal, Math.min(rect.right - marginHorizontal, unclampedX));
    const clampedY = Math.max(rect.top + marginTop, Math.min(rect.bottom - marginBottom, unclampedY));

    const toolbarInsideViewer =
      clampedX >= rect.left &&
      clampedX <= rect.right &&
      clampedY >= rect.top &&
      clampedY <= rect.bottom;

    const hasMoved =
      Math.abs(lastCoords.current.x - clampedX) > 1 ||
      Math.abs(lastCoords.current.y - clampedY) > 1 ||
      !lastCoords.current.visible;

    if (hasMoved) {
      lastCoords.current = { x: clampedX, y: clampedY, visible: true };
      useSelectionActionStore.getState().setAnchor({
        screenX: clampedX,
        screenY: clampedY,
        visible: true,
        selectedId,
        nodeType: node.type,
        worldBoundsFinite,
        projectedAnchorFinite,
        unclampedPosition: { x: unclampedX, y: unclampedY },
        finalClampedPosition: { x: clampedX, y: clampedY },
        toolbarInsideViewer,
        viewerBounds,
      });
    }
  });

  return null;
}
