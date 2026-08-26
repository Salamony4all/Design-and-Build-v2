// features/viewer-interaction/KeyboardElementControls.tsx
// Global keyboard manipulation for selected scene elements (items, walls, openings, guides).
// Supports Arrow keys (0.1m nudge / 0.5m with Shift), Delete/Backspace, R (90° rotation), and Escape.

'use client';

import { useEffect } from 'react';
import { useScene, type AnyNodeId } from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';

export function KeyboardElementControls() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore keystrokes when the user is actively typing in a text field
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) {
        return;
      }

      const selectedIds = useViewer.getState().selection.selectedIds;
      if (!selectedIds || selectedIds.length === 0) return;

      // ── DELETE / BACKSPACE ──
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const scene = useScene.getState();
        for (const id of selectedIds) {
          try {
            scene.deleteNode(id as AnyNodeId);
          } catch (err) {
            console.warn('[KeyboardControls] Failed to delete node:', id, err);
          }
        }
        useViewer.getState().resetSelection();
        return;
      }

      // ── ESCAPE (Clear selection) ──
      if (e.key === 'Escape') {
        e.preventDefault();
        useViewer.getState().resetSelection();
        return;
      }

      // ── R / r (Rotate Item 90 degrees) ──
      if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const scene = useScene.getState();
        for (const id of selectedIds) {
          const node = scene.nodes[id as AnyNodeId] as any;
          if (!node) continue;
          if (node.type === 'item') {
            const currentRot = Array.isArray(node.rotation) ? node.rotation : [0, 0, 0];
            const currentY = currentRot[1] ?? 0;
            const delta = e.shiftKey ? -Math.PI / 2 : Math.PI / 2;
            const nextY = (((currentY + delta) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            scene.updateNode(id as AnyNodeId, {
              rotation: [currentRot[0] ?? 0, nextY, currentRot[2] ?? 0],
            });
            scene.markDirty(id as AnyNodeId);
          }
        }
        return;
      }

      // ── ARROW KEYS (X/Z Plane Movement) ──
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 0.5 : 0.1; // 10cm standard step, 50cm with Shift
        let dx = 0;
        let dz = 0;

        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dz = -step;
        if (e.key === 'ArrowDown') dz = step;

        const scene = useScene.getState();
        for (const id of selectedIds) {
          const node = scene.nodes[id as AnyNodeId] as any;
          if (!node) continue;

          if (node.type === 'item' || node.type === 'guide') {
            const pos = Array.isArray(node.position) ? [...node.position] : [0, 0, 0];
            scene.updateNode(id as AnyNodeId, {
              position: [pos[0] + dx, pos[1] ?? 0, pos[2] + dz],
            });
            scene.markDirty(id as AnyNodeId);
          } else if (node.type === 'wall') {
            const start = Array.isArray(node.start) ? [...node.start] : [0, 0];
            const end = Array.isArray(node.end) ? [...node.end] : [0, 0];
            scene.updateNode(id as AnyNodeId, {
              start: [start[0] + dx, start[1] + dz],
              end: [end[0] + dx, end[1] + dz],
            });
            scene.markDirty(id as AnyNodeId);
          } else if (node.type === 'door' || node.type === 'window') {
            const pos = Array.isArray(node.position) ? [...node.position] : [0, 0, 0];
            scene.updateNode(id as AnyNodeId, {
              position: [pos[0] + dx, pos[1] ?? 0, pos[2] + dz],
            });
            scene.markDirty(id as AnyNodeId);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return null;
}
