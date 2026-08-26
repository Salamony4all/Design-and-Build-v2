// features/progressive-build/GuideControls.tsx
// Compact, non-modal Guide controls: visibility toggle + opacity slider.
//
// Editor-owned (Phase 10): both controls drive the SHARED core scene/Viewer
// store, never a separate Guide store. Guide visibility uses the Viewer
// preference (`useViewer.showGuides`, read by the Viewer's GuideSystem). Guide
// opacity is written directly onto the installed guide node in the Editor-owned
// scene store (`useScene`) — the Viewer renders the guide from that node's
// material opacity, so no published-package patch is required.
//
// Opacity normalization (defensive, applied once on write):
//   - value 0..1          -> unchanged
//   - value >1..100       -> divided by 100
//   - out of range        -> clamped to [0,1]
//   - invalid             -> safe default 0.7
// This fixes the historical near-invisible Guide (a >1/100 convention applied
// to a 0..1 value yields ~0.005 opacity).

import { useViewer } from '@pascal-app/viewer';
import { useMemo } from 'react';
import { getPascalStores } from 'design-build-simplified-viewer-shell';

const SAFE_DEFAULT_OPACITY = 0.7;

function normalizeOpacity(input: number | undefined): number {
  if (typeof input !== 'number' || Number.isNaN(input)) return SAFE_DEFAULT_OPACITY;
  let v = input;
  if (v > 1) v = v / 100; // legacy 0..100 convention
  if (v < 0) v = 0;
  if (v > 1) v = 1;
  return v;
}

export function GuideControls() {
  const showGuides = useViewer((s) => s.showGuides);

  const { useScene } = getPascalStores();
  const guideNode = useScene((s) => {
    const nodes = s.nodes as Record<string, { id?: string; type?: string; opacity?: number; metadata?: { opacity?: number; invertY?: boolean } }>;
    return Object.values(nodes).find((n) => n.type === 'guide') ?? null;
  });

  if (!guideNode) return null;

  // Live opacity (in 0..1). Prefer the node's explicit opacity/material.
  const currentRaw =
    guideNode?.opacity ?? guideNode?.metadata?.opacity ?? SAFE_DEFAULT_OPACITY;
  const current = normalizeOpacity(currentRaw);
  const currentInvert = Boolean((guideNode?.metadata as any)?.invertY);

  const handleToggleVisibility = (show: boolean) => {
    useViewer.getState().setShowGuides(show);
    const scene = useScene.getState();
    const target = Object.values(
      scene.nodes as Record<string, { id?: string; type?: string }>,
    ).find((n) => n.type === 'guide');
    if (target?.id) {
      scene.updateNode?.(target.id as any, { visible: show } as any);
      scene.markDirty?.(target.id as any);
    }
  };

  const setOpacity = (value01: number) => {
    const normalized = normalizeOpacity(value01);
    const scene = useScene.getState();
    const target = Object.values(
      scene.nodes as Record<string, { id?: string; type?: string; metadata?: Record<string, unknown> }>,
    ).find((n) => n.type === 'guide');
    if (!target?.id) return;
    // Write onto the node material opacity the Viewer renderer consumes.
    scene.updateNode?.(target.id as any, {
      opacity: normalized > 0 && normalized <= 1 ? normalized * 100 : normalized,
      metadata: {
        ...(typeof target.metadata === 'object' && target.metadata !== null ? target.metadata : {}),
        opacity: normalized,
      },
    } as any);
    scene.markDirty?.(target.id as any);
  };

  const nudgeGuide = (dx: number, dz: number) => {
    const scene = useScene.getState();
    const target = Object.values(
      scene.nodes as Record<string, { id?: string; type?: string; position?: [number, number, number] }>,
    ).find((n) => n.type === 'guide');
    if (!target?.id) return;
    const pos = Array.isArray(target.position) ? target.position : [0, 0, 0];
    const [x, y, z] = pos;
    scene.updateNode?.(target.id as any, {
      position: [x + dx, y, z + dz],
    } as any);
    scene.markDirty?.(target.id as any);
  };

  const scaleGuide = (factor: number) => {
    const scene = useScene.getState();
    const target = Object.values(
      scene.nodes as Record<string, { id?: string; type?: string; scale?: number }>,
    ).find((n) => n.type === 'guide');
    if (!target?.id) return;
    const currentScale = typeof target.scale === 'number' && target.scale > 0 ? target.scale : 1;
    scene.updateNode?.(target.id as any, {
      scale: Math.max(0.01, currentScale * factor),
    } as any);
    scene.markDirty?.(target.id as any);
  };

  const selectGuideGizmo = () => {
    const scene = useScene.getState();
    const target = Object.values(
      scene.nodes as Record<string, { id?: string; type?: string }>,
    ).find((n) => n.type === 'guide');
    if (!target?.id) return;
    useViewer.getState().setSelection({ selectedIds: [target.id] });
  };

  const rotateGuide = (deg: number) => {
    const scene = useScene.getState();
    const target = Object.values(
      scene.nodes as Record<string, { id?: string; type?: string; rotation?: [number, number, number] }>,
    ).find((n) => n.type === 'guide');
    if (!target?.id) return;
    const currentRot = Array.isArray(target.rotation)
      ? target.rotation
      : [0, typeof target.rotation === 'number' ? target.rotation : 0, 0];
    const [rx, ry, rz] = currentRot;
    scene.updateNode?.(target.id as any, {
      rotation: [rx, ry + (deg * Math.PI) / 180, rz],
    } as any);
    scene.markDirty?.(target.id as any);
  };

  const toggleInvert = (inverted: boolean) => {
    const scene = useScene.getState();
    const target = Object.values(
      scene.nodes as Record<string, { id?: string; type?: string; metadata?: Record<string, unknown> }>,
    ).find((n) => n.type === 'guide');
    if (!target?.id) return;
    scene.updateNode?.(target.id as any, {
      metadata: {
        ...(typeof target.metadata === 'object' && target.metadata !== null ? target.metadata : {}),
        invertY: inverted,
      },
    } as any);
    scene.markDirty?.(target.id as any);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        background: 'rgba(20,22,28,0.94)',
        border: '1px solid #2a2e37',
        borderRadius: 8,
        color: '#d7dbe3',
        fontSize: 12,
        pointerEvents: 'auto',
        userSelect: 'none',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      }}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showGuides}
          onChange={(e) => handleToggleVisibility(e.target.checked)}
          aria-label="Toggle guide visibility"
        />
        Guide
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        Opacity
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={current}
          onChange={(e) => setOpacity(Number(e.target.value))}
          aria-label="Guide opacity"
          style={{ width: 80 }}
        />
        <span style={{ width: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(current * 100)}%
        </span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', borderLeft: '1px solid #333842', paddingLeft: 8 }}>
        <input
          type="checkbox"
          checked={currentInvert}
          onChange={(e) => toggleInvert(e.target.checked)}
          aria-label="Invert guide"
        />
        Invert
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, borderLeft: '1px solid #333842', paddingLeft: 8 }}>
        <span style={{ fontSize: 11, color: '#8b949e', marginRight: 2 }}>Rotate</span>
        <button
          type="button"
          onClick={() => rotateGuide(-90)}
          title="Rotate 90° Counter-Clockwise"
          style={{ padding: '2px 6px', background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
        >
          ⟲ 90°
        </button>
        <button
          type="button"
          onClick={() => rotateGuide(90)}
          title="Rotate 90° Clockwise"
          style={{ padding: '2px 6px', background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
        >
          ⟳ 90°
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, borderLeft: '1px solid #333842', paddingLeft: 8 }}>
        <span style={{ fontSize: 11, color: '#8b949e', marginRight: 2 }}>Nudge</span>
        <button
          type="button"
          onClick={() => nudgeGuide(-0.2, 0)}
          title="Nudge Left"
          style={{ padding: '2px 6px', background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => nudgeGuide(0.2, 0)}
          title="Nudge Right"
          style={{ padding: '2px 6px', background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
        >
          →
        </button>
        <button
          type="button"
          onClick={() => nudgeGuide(0, -0.2)}
          title="Nudge Up"
          style={{ padding: '2px 6px', background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => nudgeGuide(0, 0.2)}
          title="Nudge Down"
          style={{ padding: '2px 6px', background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => scaleGuide(0.98)}
          title="Scale Down"
          style={{ padding: '2px 6px', background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 4, cursor: 'pointer', fontSize: 11, marginLeft: 3 }}
        >
          -
        </button>
        <button
          type="button"
          onClick={() => scaleGuide(1.02)}
          title="Scale Up"
          style={{ padding: '2px 6px', background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
        >
          +
        </button>
        <button
          type="button"
          onClick={selectGuideGizmo}
          title="Select Guide & Show 3D Gizmo"
          style={{ padding: '2px 8px', background: '#1f6feb', border: '1px solid #388bfd', color: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 500, marginLeft: 4 }}
        >
          Gizmo 🎯
        </button>
      </div>
    </div>
  );
}
