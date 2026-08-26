// features/pro/SelectionActionBarDOM.tsx
// Pure DOM Contextual Action Bar rendered OUTSIDE the R3F Canvas in the shared viewer DOM layer.

'use client';

import React, { useCallback, useState, useEffect } from 'react';
import {
  type AnyNode,
  type AnyNodeId,
  type ItemNode,
  type GuideNode,
  type SlabNode,
  type WallNode,
  type DoorNode,
  type WindowNode,
  useScene,
} from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';
import { useEditor } from '@pascal-app/editor';
import {
  Move,
  Copy,
  RotateCcw,
  RotateCw,
  Trash2,
  Eye,
  EyeOff,
  MoveHorizontal,
  ArrowLeftRight,
  ArrowUpDown,
  RefreshCw,
  AlertTriangle,
  Sliders,
  Compass,
  FlipVertical,
} from 'lucide-react';
import { useSelectionActionStore } from './selection-action-store';
import { getSemanticActionsForNode } from './action-matrix';

interface DependencyConfirmationState {
  title: string;
  message: string;
  itemCount?: number;
  hostedOpeningCount?: number;
  onConfirm: () => void;
}

export function SelectionActionBarDOM() {
  const { screenX, screenY, visible, selectedId, nodeType } = useSelectionActionStore();
  const node = useScene((s) => (selectedId ? (s.nodes[selectedId as AnyNodeId] ?? null) : null));
  const mode = useEditor((s) => s.mode);
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered);

  const [dependencyConfirm, setDependencyConfirm] = useState<DependencyConfirmationState | null>(null);

  // Close dependency confirmation if selection changes
  useEffect(() => {
    setDependencyConfirm(null);
  }, [selectedId]);

  // -------------------------------------------------------------
  // ITEM HANDLERS
  // -------------------------------------------------------------
  const handleItemRotateLeft = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'item') return;
      const item = node as ItemNode;
      const currentRot = Array.isArray(item.rotation) ? item.rotation : [0, 0, 0];
      const currentY = currentRot[1] ?? 0;
      let nextY = currentY + Math.PI / 2;
      nextY = ((nextY % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

      useScene.getState().updateNode(selectedId as AnyNodeId, {
        rotation: [currentRot[0] ?? 0, nextY, currentRot[2] ?? 0],
        metadata: {
          ...(typeof item.metadata === 'object' && item.metadata !== null ? (item.metadata as Record<string, unknown>) : {}),
          userModified: true,
          modifiedAt: Date.now(),
        },
      });
    },
    [selectedId, node],
  );

  const handleItemRotateRight = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'item') return;
      const item = node as ItemNode;
      const currentRot = Array.isArray(item.rotation) ? item.rotation : [0, 0, 0];
      const currentY = currentRot[1] ?? 0;
      let nextY = currentY - Math.PI / 2;
      nextY = ((nextY % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

      useScene.getState().updateNode(selectedId as AnyNodeId, {
        rotation: [currentRot[0] ?? 0, nextY, currentRot[2] ?? 0],
        metadata: {
          ...(typeof item.metadata === 'object' && item.metadata !== null ? (item.metadata as Record<string, unknown>) : {}),
          userModified: true,
          modifiedAt: Date.now(),
        },
      });
    },
    [selectedId, node],
  );

  const handleItemMove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'item') return;
      const setMovingNode = (useEditor.getState() as any).setMovingNode;
      if (typeof setMovingNode === 'function') {
        setMovingNode(node);
      }
    },
    [selectedId, node],
  );

  const handleItemDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'item') return;
      const item = node as ItemNode;
      const newId = `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` as `item_${string}`;
      const pos = item.position ? [...item.position] : [0, 0, 0];
      pos[0] += 0.5;

      const duplicate: ItemNode = {
        ...item,
        id: newId,
        position: pos as [number, number, number],
        metadata: {
          ...(typeof item.metadata === 'object' && item.metadata !== null ? (item.metadata as Record<string, unknown>) : {}),
          isNew: true,
          source: 'manual-pro',
          creationMethod: 'manual-pro',
          duplicatedFromNodeId: item.id,
          sourceRecordId: null,
        },
      };

      const state = useScene.getState();
      state.createNode(duplicate, (item.parentId ?? undefined) as AnyNodeId);
      useViewer.getState().setSelection({ selectedIds: [newId] });
    },
    [selectedId, node],
  );

  const handleItemDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'item') return;
      useScene.getState().deleteNode(selectedId as AnyNodeId);
      useViewer.getState().resetSelection();
    },
    [selectedId, node],
  );

  // -------------------------------------------------------------
  // GUIDE HANDLERS
  // -------------------------------------------------------------
  const [guidePopover, setGuidePopover] = useState<'none' | 'opacity' | 'nudge'>('none');

  useEffect(() => {
    setGuidePopover('none');
  }, [selectedId]);

  const handleGuideMove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'guide') return;
      const setMovingNode = (useEditor.getState() as any).setMovingNode;
      if (typeof setMovingNode === 'function') {
        setMovingNode(node);
      }
    },
    [selectedId, node],
  );

  const handleGuideOpacityToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setGuidePopover((prev) => (prev === 'opacity' ? 'none' : 'opacity'));
    },
    [],
  );

  const handleGuideNudgeToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setGuidePopover((prev) => (prev === 'nudge' ? 'none' : 'nudge'));
    },
    [],
  );

  const handleGuideOpacityChange = useCallback(
    (val: number) => {
      if (!selectedId || !node || node.type !== 'guide') return;
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        opacity: val,
      });
    },
    [selectedId, node],
  );

  const handleGuideInvert = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'guide') return;
      const guide = node as GuideNode;
      const currentInvert = (guide.metadata as Record<string, unknown>)?.invertY === true;
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        metadata: {
          ...(typeof guide.metadata === 'object' && guide.metadata !== null ? (guide.metadata as Record<string, unknown>) : {}),
          invertY: !currentInvert,
        },
      });
    },
    [selectedId, node],
  );

  const handleGuideNudge = useCallback(
    (dx: number, dz: number) => {
      if (!selectedId || !node || node.type !== 'guide') return;
      const guide = node as GuideNode;
      const pos = Array.isArray(guide.position) ? guide.position : [0, 0, 0];
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        position: [pos[0] + dx, pos[1], pos[2] + dz],
      });
    },
    [selectedId, node],
  );

  const handleGuideScale = useCallback(
    (dScale: number) => {
      if (!selectedId || !node || node.type !== 'guide') return;
      const guide = node as GuideNode;
      const currentScale = typeof guide.scale === 'number' && guide.scale > 0 ? guide.scale : 1;
      const nextScale = Math.max(0.1, Math.min(20, Number((currentScale + dScale).toFixed(3))));
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        scale: nextScale,
      });
    },
    [selectedId, node],
  );

  const handleGuideDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'guide') return;
      const guide = node as GuideNode;
      const newId = `guide_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` as `guide_${string}`;
      const pos = Array.isArray(guide.position) ? guide.position : [0, 0, 0];

      const duplicate: GuideNode = {
        ...guide,
        id: newId,
        position: [pos[0] + 1.0, pos[1], pos[2] + 1.0],
        metadata: {
          ...(typeof guide.metadata === 'object' && guide.metadata !== null ? (guide.metadata as Record<string, unknown>) : {}),
          creationMethod: 'manual-pro',
          duplicatedFromNodeId: guide.id,
        },
      };

      useScene.getState().createNode(duplicate, (guide.parentId ?? undefined) as AnyNodeId);
      useViewer.getState().setSelection({ selectedIds: [newId] });
    },
    [selectedId, node],
  );

  const handleGuideRotateLeft = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'guide') return;
      const guide = node as GuideNode;
      const rot = Array.isArray(guide.rotation) ? guide.rotation : [0, 0, 0];
      let nextY = rot[1] + Math.PI / 2;
      nextY = ((nextY % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        rotation: [rot[0], nextY, rot[2]],
      });
    },
    [selectedId, node],
  );

  const handleGuideRotateRight = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'guide') return;
      const guide = node as GuideNode;
      const rot = Array.isArray(guide.rotation) ? guide.rotation : [0, 0, 0];
      let nextY = rot[1] - Math.PI / 2;
      nextY = ((nextY % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        rotation: [rot[0], nextY, rot[2]],
      });
    },
    [selectedId, node],
  );

  const handleGuideVisibility = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'guide') return;
      const guide = node as GuideNode;
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        visible: !(guide.visible ?? true),
      });
    },
    [selectedId, node],
  );

  const handleGuideDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'guide') return;
      useScene.getState().deleteNode(selectedId as AnyNodeId);
      useViewer.getState().resetSelection();
    },
    [selectedId, node],
  );

  // -------------------------------------------------------------
  // SLAB HANDLERS
  // -------------------------------------------------------------
  const handleSlabMove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'slab') return;
      const slab = node as SlabNode;
      const newPolygon = slab.polygon.map(([x, z]) => [x + 0.5, z + 0.5] as [number, number]);
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        polygon: newPolygon,
      });
    },
    [selectedId, node],
  );

  const handleSlabDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'slab') return;
      const slab = node as SlabNode;
      const newId = `slab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` as `slab_${string}`;
      const newPolygon = slab.polygon.map(([x, z]) => [x + 1.0, z + 1.0] as [number, number]);

      const duplicate: SlabNode = {
        ...slab,
        id: newId,
        polygon: newPolygon,
        metadata: {
          ...(typeof slab.metadata === 'object' && slab.metadata !== null ? (slab.metadata as Record<string, unknown>) : {}),
          creationMethod: 'manual-pro',
          duplicatedFromNodeId: slab.id,
        },
      };

      useScene.getState().createNode(duplicate, (slab.parentId ?? undefined) as AnyNodeId);
      useViewer.getState().setSelection({ selectedIds: [newId] });
    },
    [selectedId, node],
  );

  const handleSlabRotateLeft = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'slab') return;
      const slab = node as SlabNode;
      if (!slab.polygon.length) return;

      let cx = 0;
      let cz = 0;
      for (const [x, z] of slab.polygon) {
        cx += x;
        cz += z;
      }
      cx /= slab.polygon.length;
      cz /= slab.polygon.length;

      const newPolygon = slab.polygon.map(([x, z]) => {
        const rx = x - cx;
        const rz = z - cz;
        // CCW +90 deg: x' = -rz, z' = rx
        return [cx - rz, cz + rx] as [number, number];
      });

      useScene.getState().updateNode(selectedId as AnyNodeId, {
        polygon: newPolygon,
      });
    },
    [selectedId, node],
  );

  const handleSlabRotateRight = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'slab') return;
      const slab = node as SlabNode;
      if (!slab.polygon.length) return;

      let cx = 0;
      let cz = 0;
      for (const [x, z] of slab.polygon) {
        cx += x;
        cz += z;
      }
      cx /= slab.polygon.length;
      cz /= slab.polygon.length;

      const newPolygon = slab.polygon.map(([x, z]) => {
        const rx = x - cx;
        const rz = z - cz;
        // CW -90 deg: x' = rz, z' = -rx
        return [cx + rz, cz - rx] as [number, number];
      });

      useScene.getState().updateNode(selectedId as AnyNodeId, {
        polygon: newPolygon,
      });
    },
    [selectedId, node],
  );

  const handleSlabDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'slab') return;

      const allNodes = useScene.getState().nodes as Record<string, AnyNode | undefined>;
      const itemsCount = Object.values(allNodes).filter((n) => n && n.type === 'item').length;

      if (itemsCount > 0) {
        setDependencyConfirm({
          title: 'Delete Slab',
          message: `The project contains ${itemsCount} placed item(s). Deleting the slab boundary may leave them without floor support.`,
          itemCount: itemsCount,
          onConfirm: () => {
            useScene.getState().deleteNode(selectedId as AnyNodeId);
            useViewer.getState().resetSelection();
            setDependencyConfirm(null);
          },
        });
        return;
      }

      useScene.getState().deleteNode(selectedId as AnyNodeId);
      useViewer.getState().resetSelection();
    },
    [selectedId, node],
  );

  // -------------------------------------------------------------
  // WALL HANDLERS
  // -------------------------------------------------------------
  const handleWallNudge = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'wall') return;
      const wall = node as WallNode;
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        start: [wall.start[0] + 0.5, wall.start[1] + 0.5],
        end: [wall.end[0] + 0.5, wall.end[1] + 0.5],
      });
    },
    [selectedId, node],
  );

  const handleWallDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'wall') return;
      const wall = node as WallNode;
      const newId = `wall_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` as `wall_${string}`;

      const duplicate: WallNode = {
        ...wall,
        id: newId,
        children: [],
        start: [wall.start[0] + 1.0, wall.start[1] + 1.0],
        end: [wall.end[0] + 1.0, wall.end[1] + 1.0],
        metadata: {
          ...(typeof wall.metadata === 'object' && wall.metadata !== null ? (wall.metadata as Record<string, unknown>) : {}),
          creationMethod: 'manual-pro',
          duplicatedFromNodeId: wall.id,
        },
      };

      useScene.getState().createNode(duplicate, (wall.parentId ?? undefined) as AnyNodeId);
      useViewer.getState().setSelection({ selectedIds: [newId] });
    },
    [selectedId, node],
  );

  const handleWallRotateLeft = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'wall') return;
      const wall = node as WallNode;
      const mx = (wall.start[0] + wall.end[0]) / 2;
      const my = (wall.start[1] + wall.end[1]) / 2;
      const sx = wall.start[0] - mx;
      const sy = wall.start[1] - my;
      const ex = wall.end[0] - mx;
      const ey = wall.end[1] - my;

      // CCW +90: x' = -y, y' = x
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        start: [mx - sy, my + sx],
        end: [mx - ey, my + ex],
      });
    },
    [selectedId, node],
  );

  const handleWallRotateRight = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'wall') return;
      const wall = node as WallNode;
      const mx = (wall.start[0] + wall.end[0]) / 2;
      const my = (wall.start[1] + wall.end[1]) / 2;
      const sx = wall.start[0] - mx;
      const sy = wall.start[1] - my;
      const ex = wall.end[0] - mx;
      const ey = wall.end[1] - my;

      // CW -90: x' = y, y' = -x
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        start: [mx + sy, my - sx],
        end: [mx + ey, my - ex],
      });
    },
    [selectedId, node],
  );

  const handleWallDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'wall') return;
      const wall = node as WallNode;
      const childCount = wall.children?.length ?? 0;

      if (childCount > 0) {
        setDependencyConfirm({
          title: 'Delete Wall & Hosted Openings',
          message: `This wall hosts ${childCount} door/window opening(s). Deleting the wall will delete all hosted elements to prevent orphans.`,
          hostedOpeningCount: childCount,
          onConfirm: () => {
            const state = useScene.getState();
            if (wall.children) {
              for (const childId of wall.children) {
                state.deleteNode(childId as AnyNodeId);
              }
            }
            state.deleteNode(selectedId as AnyNodeId);
            useViewer.getState().resetSelection();
            setDependencyConfirm(null);
          },
        });
        return;
      }

      useScene.getState().deleteNode(selectedId as AnyNodeId);
      useViewer.getState().resetSelection();
    },
    [selectedId, node],
  );

  // -------------------------------------------------------------
  // DOOR HANDLERS
  // -------------------------------------------------------------
  const handleDoorMoveAlongWall = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'door') return;
      const door = node as DoorNode;
      const pos = Array.isArray(door.position) ? door.position : [0, 0, 0];
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        position: [pos[0] + 0.25, pos[1], pos[2]],
      });
    },
    [selectedId, node],
  );

  const handleDoorDuplicateOnWall = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'door') return;
      const door = node as DoorNode;
      const newId = `door_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` as `door_${string}`;
      const pos = Array.isArray(door.position) ? door.position : [0, 0, 0];

      const duplicate: DoorNode = {
        ...door,
        id: newId,
        position: [pos[0] + (door.width ?? 0.9) + 0.3, pos[1], pos[2]],
        metadata: {
          ...(typeof door.metadata === 'object' && door.metadata !== null ? (door.metadata as Record<string, unknown>) : {}),
          creationMethod: 'manual-pro',
          duplicatedFromNodeId: door.id,
        },
      };

      const state = useScene.getState();
      state.createNode(duplicate, (door.parentId ?? undefined) as AnyNodeId);
      if (door.parentId && state.nodes[door.parentId as AnyNodeId]) {
        const hostWall = state.nodes[door.parentId as AnyNodeId] as WallNode;
        state.updateNode(door.parentId as AnyNodeId, {
          children: [...(hostWall.children || []), newId],
        });
      }
      useViewer.getState().setSelection({ selectedIds: [newId] });
    },
    [selectedId, node],
  );

  const handleDoorFlipHanding = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'door') return;
      const door = node as DoorNode;
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        hingesSide: door.hingesSide === 'left' ? 'right' : 'left',
      });
    },
    [selectedId, node],
  );

  const handleDoorFlipSwing = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'door') return;
      const door = node as DoorNode;
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        swingDirection: door.swingDirection === 'inward' ? 'outward' : 'inward',
      });
    },
    [selectedId, node],
  );

  const handleDoorFlipSide = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'door') return;
      const door = node as DoorNode;
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        side: door.side === 'front' ? 'back' : 'front',
      });
    },
    [selectedId, node],
  );

  const handleDoorRehost = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'door') return;
      const door = node as DoorNode;
      const state = useScene.getState();
      const allNodes = state.nodes as Record<string, AnyNode | undefined>;
      const candidateWalls = Object.values(allNodes).filter(
        (n): n is WallNode => !!(n && n.type === 'wall' && n.id !== door.parentId),
      );
      const targetWall = candidateWalls[0];
      if (targetWall) {
        // Atomic rehost in 1 transaction
        if (door.parentId && state.nodes[door.parentId as AnyNodeId]) {
          const oldWall = state.nodes[door.parentId as AnyNodeId] as WallNode;
          state.updateNode(door.parentId as AnyNodeId, {
            children: (oldWall.children || []).filter((id) => id !== selectedId),
          });
        }
        state.updateNode(targetWall.id as AnyNodeId, {
          children: [...(targetWall.children || []), selectedId],
        });
        state.updateNode(selectedId as AnyNodeId, {
          parentId: targetWall.id,
          position: [0.5, door.position?.[1] ?? 1.05, 0],
        });
      }
    },
    [selectedId, node],
  );

  const handleDoorDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'door') return;
      const door = node as DoorNode;
      const state = useScene.getState();
      if (door.parentId && state.nodes[door.parentId as AnyNodeId]) {
        const host = state.nodes[door.parentId as AnyNodeId] as WallNode;
        state.updateNode(door.parentId as AnyNodeId, {
          children: (host.children || []).filter((id) => id !== selectedId),
        });
      }
      state.deleteNode(selectedId as AnyNodeId);
      useViewer.getState().resetSelection();
    },
    [selectedId, node],
  );

  // -------------------------------------------------------------
  // WINDOW HANDLERS
  // -------------------------------------------------------------
  const handleWindowMoveAlongWall = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'window') return;
      const windowNode = node as WindowNode;
      const pos = Array.isArray(windowNode.position) ? windowNode.position : [0, 0, 0];
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        position: [pos[0] + 0.25, pos[1], pos[2]],
      });
    },
    [selectedId, node],
  );

  const handleWindowDuplicateOnWall = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'window') return;
      const windowNode = node as WindowNode;
      const newId = `window_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` as `window_${string}`;
      const pos = Array.isArray(windowNode.position) ? windowNode.position : [0, 0, 0];

      const duplicate: WindowNode = {
        ...windowNode,
        id: newId,
        position: [pos[0] + (windowNode.width ?? 1.2) + 0.3, pos[1], pos[2]],
        metadata: {
          ...(typeof windowNode.metadata === 'object' && windowNode.metadata !== null ? (windowNode.metadata as Record<string, unknown>) : {}),
          creationMethod: 'manual-pro',
          duplicatedFromNodeId: windowNode.id,
        },
      };

      const state = useScene.getState();
      state.createNode(duplicate, (windowNode.parentId ?? undefined) as AnyNodeId);
      if (windowNode.parentId && state.nodes[windowNode.parentId as AnyNodeId]) {
        const hostWall = state.nodes[windowNode.parentId as AnyNodeId] as WallNode;
        state.updateNode(windowNode.parentId as AnyNodeId, {
          children: [...(hostWall.children || []), newId],
        });
      }
      useViewer.getState().setSelection({ selectedIds: [newId] });
    },
    [selectedId, node],
  );

  const handleWindowFlipSide = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'window') return;
      const windowNode = node as WindowNode;
      useScene.getState().updateNode(selectedId as AnyNodeId, {
        side: windowNode.side === 'front' ? 'back' : 'front',
      });
    },
    [selectedId, node],
  );

  const handleWindowRehost = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'window') return;
      const windowNode = node as WindowNode;
      const state = useScene.getState();
      const allNodes = state.nodes as Record<string, AnyNode | undefined>;
      const candidateWalls = Object.values(allNodes).filter(
        (n): n is WallNode => !!(n && n.type === 'wall' && n.id !== windowNode.parentId),
      );
      const targetWall = candidateWalls[0];
      if (targetWall) {
        if (windowNode.parentId && state.nodes[windowNode.parentId as AnyNodeId]) {
          const oldWall = state.nodes[windowNode.parentId as AnyNodeId] as WallNode;
          state.updateNode(windowNode.parentId as AnyNodeId, {
            children: (oldWall.children || []).filter((id) => id !== selectedId),
          });
        }
        state.updateNode(targetWall.id as AnyNodeId, {
          children: [...(targetWall.children || []), selectedId],
        });
        state.updateNode(selectedId as AnyNodeId, {
          parentId: targetWall.id,
          position: [0.5, windowNode.position?.[1] ?? 1.5, 0],
        });
      }
    },
    [selectedId, node],
  );

  const handleWindowDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedId || !node || node.type !== 'window') return;
      const windowNode = node as WindowNode;
      const state = useScene.getState();
      if (windowNode.parentId && state.nodes[windowNode.parentId as AnyNodeId]) {
        const host = state.nodes[windowNode.parentId as AnyNodeId] as WallNode;
        state.updateNode(windowNode.parentId as AnyNodeId, {
          children: (host.children || []).filter((id) => id !== selectedId),
        });
      }
      state.deleteNode(selectedId as AnyNodeId);
      useViewer.getState().resetSelection();
    },
    [selectedId, node],
  );

  if (!visible || !selectedId || !node || isFloorplanHovered || mode === 'delete') {
    return null;
  }

  const actions = getSemanticActionsForNode(node.type);
  if (actions.length === 0) return null;

  const renderIcon = (iconName: string) => {
    switch (iconName) {
      case 'Move':
        return <Move className="h-3.5 w-3.5" />;
      case 'Sliders':
        return <Sliders className="h-3.5 w-3.5" />;
      case 'Compass':
        return <Compass className="h-3.5 w-3.5" />;
      case 'FlipVertical':
        return <FlipVertical className="h-3.5 w-3.5" />;
      case 'Copy':
        return <Copy className="h-3.5 w-3.5" />;
      case 'RotateCcw':
        return <RotateCcw className="h-3.5 w-3.5" />;
      case 'RotateCw':
        return <RotateCw className="h-3.5 w-3.5" />;
      case 'Trash2':
        return <Trash2 className="h-3.5 w-3.5" />;
      case 'Eye':
        return <Eye className="h-3.5 w-3.5" />;
      case 'EyeOff':
        return <EyeOff className="h-3.5 w-3.5" />;
      case 'MoveHorizontal':
        return <MoveHorizontal className="h-3.5 w-3.5" />;
      case 'ArrowLeftRight':
        return <ArrowLeftRight className="h-3.5 w-3.5" />;
      case 'ArrowUpDown':
        return <ArrowUpDown className="h-3.5 w-3.5" />;
      case 'RefreshCw':
        return <RefreshCw className="h-3.5 w-3.5" />;
      default:
        return <Move className="h-3.5 w-3.5" />;
    }
  };

  const getHandlerForAction = (actionId: string) => {
    switch (node.type) {
      case 'item':
        if (actionId === 'move') return handleItemMove;
        if (actionId === 'duplicate') return handleItemDuplicate;
        if (actionId === 'rotate-left-90') return handleItemRotateLeft;
        if (actionId === 'rotate-right-90') return handleItemRotateRight;
        if (actionId === 'delete') return handleItemDelete;
        break;
      case 'guide':
        if (actionId === 'move') return handleGuideMove;
        if (actionId === 'opacity') return handleGuideOpacityToggle;
        if (actionId === 'nudge-menu') return handleGuideNudgeToggle;
        if (actionId === 'invert') return handleGuideInvert;
        if (actionId === 'rotate-left-90') return handleGuideRotateLeft;
        if (actionId === 'rotate-right-90') return handleGuideRotateRight;
        if (actionId === 'visibility-toggle') return handleGuideVisibility;
        if (actionId === 'duplicate') return handleGuideDuplicate;
        if (actionId === 'delete') return handleGuideDelete;
        break;
      case 'slab':
        if (actionId === 'move') return handleSlabMove;
        if (actionId === 'duplicate') return handleSlabDuplicate;
        if (actionId === 'rotate-left-90') return handleSlabRotateLeft;
        if (actionId === 'rotate-right-90') return handleSlabRotateRight;
        if (actionId === 'delete') return handleSlabDelete;
        break;
      case 'wall':
        if (actionId === 'nudge') return handleWallNudge;
        if (actionId === 'duplicate') return handleWallDuplicate;
        if (actionId === 'rotate-left-90') return handleWallRotateLeft;
        if (actionId === 'rotate-right-90') return handleWallRotateRight;
        if (actionId === 'delete') return handleWallDelete;
        break;
      case 'door':
        if (actionId === 'move-along-host') return handleDoorMoveAlongWall;
        if (actionId === 'duplicate-on-host') return handleDoorDuplicateOnWall;
        if (actionId === 'flip-handing') return handleDoorFlipHanding;
        if (actionId === 'flip-swing') return handleDoorFlipSwing;
        if (actionId === 'flip-side') return handleDoorFlipSide;
        if (actionId === 'rehost') return handleDoorRehost;
        if (actionId === 'delete') return handleDoorDelete;
        break;
      case 'window':
        if (actionId === 'move-along-host') return handleWindowMoveAlongWall;
        if (actionId === 'duplicate-on-host') return handleWindowDuplicateOnWall;
        if (actionId === 'flip-side') return handleWindowFlipSide;
        if (actionId === 'rehost') return handleWindowRehost;
        if (actionId === 'delete') return handleWindowDelete;
        break;
    }
    return () => {};
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: `${screenX}px`,
        top: `${screenY}px`,
        transform: 'translate(-50%, -100%) translateY(-10px)',
        zIndex: 9999,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {dependencyConfirm ? (
        <div
          className="flex flex-col gap-2 rounded-xl p-3 shadow-2xl backdrop-blur-md transition-all duration-150 animate-in fade-in"
          style={{
            background: 'rgba(255, 255, 255, 0.98)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.24)',
            maxWidth: '280px',
          }}
        >
          <div className="flex items-center gap-2 text-rose-600 font-semibold text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{dependencyConfirm.title}</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-tight">
            {dependencyConfirm.message}
          </p>
          <div className="flex items-center justify-end gap-1.5 pt-1">
            <button
              type="button"
              className="px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
              onClick={() => setDependencyConfirm(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-2.5 py-1 text-[11px] font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-md transition-colors shadow-sm"
              onClick={dependencyConfirm.onConfirm}
            >
              Confirm Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          {/* GUIDE OPACITY POPOVER */}
          {node.type === 'guide' && guidePopover === 'opacity' && (
            <div
              className="mb-2 flex flex-col gap-2 rounded-2xl p-3 shadow-2xl backdrop-blur-xl border border-slate-200/80 bg-white/95 text-slate-800 animate-in fade-in zoom-in-95"
              style={{ minWidth: 220, pointerEvents: 'auto' }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span className="flex items-center gap-1.5">
                  <Sliders className="h-3.5 w-3.5 text-blue-600" /> Guide Opacity
                </span>
                <span className="font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded text-[11px] font-bold">
                  {Math.round(((node as GuideNode).opacity ?? 100) > 1 ? ((node as GuideNode).opacity ?? 100) : ((node as GuideNode).opacity ?? 1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(((node as GuideNode).opacity ?? 100) > 1 ? ((node as GuideNode).opacity ?? 100) : ((node as GuideNode).opacity ?? 1) * 100)}
                onChange={(e) => handleGuideOpacityChange(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex items-center justify-between gap-1 pt-1">
                {[25, 50, 75, 100].map((preset) => {
                  const currentVal = Math.round(((node as GuideNode).opacity ?? 100) > 1 ? ((node as GuideNode).opacity ?? 100) : ((node as GuideNode).opacity ?? 1) * 100);
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleGuideOpacityChange(preset)}
                      className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition-colors ${
                        currentVal === preset
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {preset}%
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* GUIDE NUDGE & SCALE POPOVER */}
          {node.type === 'guide' && guidePopover === 'nudge' && (
            <div
              className="mb-2 flex flex-col gap-2 rounded-2xl p-3 shadow-2xl backdrop-blur-xl border border-slate-200/80 bg-white/95 text-slate-800 animate-in fade-in zoom-in-95"
              style={{ minWidth: 190, pointerEvents: 'auto' }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span className="flex items-center gap-1.5">
                  <Compass className="h-3.5 w-3.5 text-blue-600" /> Nudge & Scale
                </span>
                <span className="text-[10px] text-slate-400 font-mono">0.1m</span>
              </div>
              <div className="grid grid-cols-3 gap-1 w-24 mx-auto py-1">
                <div />
                <button
                  type="button"
                  onClick={() => handleGuideNudge(0, -0.1)}
                  title="Nudge North (-Z)"
                  className="flex items-center justify-center h-7 w-7 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 font-bold transition-colors shadow-xs"
                >
                  ↑
                </button>
                <div />
                <button
                  type="button"
                  onClick={() => handleGuideNudge(-0.1, 0)}
                  title="Nudge West (-X)"
                  className="flex items-center justify-center h-7 w-7 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 font-bold transition-colors shadow-xs"
                >
                  ←
                </button>
                <div className="flex items-center justify-center text-slate-300 text-xs">•</div>
                <button
                  type="button"
                  onClick={() => handleGuideNudge(0.1, 0)}
                  title="Nudge East (+X)"
                  className="flex items-center justify-center h-7 w-7 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 font-bold transition-colors shadow-xs"
                >
                  →
                </button>
                <div />
                <button
                  type="button"
                  onClick={() => handleGuideNudge(0, 0.1)}
                  title="Nudge South (+Z)"
                  className="flex items-center justify-center h-7 w-7 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 font-bold transition-colors shadow-xs"
                >
                  ↓
                </button>
                <div />
              </div>
              <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-slate-100 text-xs">
                <span className="text-[11px] text-slate-500 font-medium">Scale ({((node as GuideNode).scale ?? 1).toFixed(2)}x)</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleGuideScale(-0.05)}
                    title="Scale Down"
                    className="flex items-center justify-center h-6 w-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGuideScale(0.05)}
                    title="Scale Up"
                    className="flex items-center justify-center h-6 w-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* MAIN FLOATING PILL TOOLBAR */}
          <div
            className="flex items-center gap-1 rounded-full p-1 shadow-xl backdrop-blur-md transition-all duration-150"
            style={{
              background: 'rgba(255, 255, 255, 0.94)',
              border: '1px solid rgba(226, 232, 240, 0.8)',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.16)',
            }}
          >
            {actions.map((action) => {
              const isDestructive = action.id.includes('delete');
              const handler = getHandlerForAction(action.id);

              const isGuideInverted = action.id === 'invert' && (node.metadata as Record<string, unknown>)?.invertY === true;
              const isOpacityActive = action.id === 'opacity' && guidePopover === 'opacity';
              const isNudgeActive = action.id === 'nudge-menu' && guidePopover === 'nudge';
              const isHidden = action.id === 'visibility-toggle' && (node.visible === false);

              const isActive = isGuideInverted || isOpacityActive || isNudgeActive || isHidden;

              let iconToRender = action.icon;
              if (action.id === 'visibility-toggle' && node.visible === false) {
                iconToRender = 'EyeOff';
              }

              return (
                <button
                  key={action.id}
                  type="button"
                  disabled={!action.enabled}
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-all focus:outline-none focus:ring-2 ${
                    !action.enabled
                      ? 'text-slate-300 cursor-not-allowed'
                      : isDestructive
                        ? 'text-rose-600 hover:bg-rose-50 hover:text-rose-700 focus:ring-rose-500/50'
                        : isActive
                          ? 'bg-blue-600 text-white shadow-xs focus:ring-blue-500/50'
                          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus:ring-blue-500/50'
                  }`}
                  onClick={handler}
                  title={action.enabled ? action.tooltip : `${action.label} (disabled: ${action.disabledReason || 'unavailable in context'})`}
                  aria-label={action.label}
                >
                  {renderIcon(iconToRender)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
