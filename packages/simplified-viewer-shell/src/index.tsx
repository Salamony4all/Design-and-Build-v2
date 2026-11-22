// design-build-simplified-viewer-shell
// Official Pascal Viewer bootstrap: loads builtinPlugin BEFORE the Viewer
// mounts, and renders a loading boundary until registration finishes.
// (Section 3 + 5 of the reconstruction spec.)

'use client';
import React, { useEffect, useRef, useState } from 'react';
import { loadPlugin, useScene, sceneRegistry, useLiveTransforms, nodeRegistry } from '@pascal-app/core';
import { builtinPlugin } from '@pascal-app/nodes';
import { Viewer } from '@pascal-app/viewer';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

// Expose this shell's (statically-imported) core singleton identity so the
// harness can confirm it shares the SAME core instance as the Viewer. The
// harness must consume these handles rather than dynamically importing
// @pascal-app/core itself — a dynamic import lands in a separate webpack chunk
// and produces a SECOND core module instance (separate useScene/sceneRegistry
// singletons), which is the split-store bug that makes dirty nodes invisible.
if (typeof window !== 'undefined') {
  (window as unknown as { __pascalShellStores?: unknown }).__pascalShellStores = {
    useScene, sceneRegistry, useLiveTransforms, nodeRegistry,
    useSceneId: (useScene as unknown as { _dbgId?: string })._dbgId,
  };
}

/** Returns the shell's statically-imported Pascal core stores (shared with Viewer). */
export function getPascalStores() {
  return { loadPlugin, useScene, sceneRegistry, useLiveTransforms, nodeRegistry };
}

export type ViewerControls = { target: THREE.Vector3; update: () => void } | null;

/**
 * Stable viewer handle bridged out of the R3F Canvas (where useThree is valid).
 * The host (production page) uses this to drive camera framing without
 * patching Pascal internals. The handle object is created ONCE and its mutable
 * camera/controls/scene/invalidate fields are updated in place as they become
 * available — it is never recreated per render.
 */
export interface ViewerHandle {
  camera: THREE.Camera;
  controls: ViewerControls;
  invalidate: () => void;
  gl: THREE.WebGLRenderer | unknown;
  scene: THREE.Scene;
}

/**
 * Live viewer handle bridged out of the R3F Canvas.
 * Readiness = camera && scene && invalidate. Controls are OPTIONAL — this
 * Pascal Viewer does not expose OrbitControls through useThree(state.controls),
 * so framing must succeed with camera-only fallback. Pascal's own navigation
 * continues independently; we never create a competing controls instance.
 */
function ViewerBridge({ onReady }: { onReady: (h: ViewerHandle) => void }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as ViewerControls;
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  // Stable handle — mutate in place, never recreate.
  const handleRef = useRef<ViewerHandle | null>(null);
  if (!handleRef.current) {
    handleRef.current = {
      camera: undefined as unknown as THREE.Camera,
      controls: null,
      invalidate,
      gl,
      scene: undefined as unknown as THREE.Scene,
    };
  }
  const h = handleRef.current;
  h.camera = camera as THREE.Camera;
  h.controls = controls;
  h.invalidate = invalidate;
  h.gl = gl;
  h.scene = scene as THREE.Scene;
  const fired = useRef(false);
  useEffect(() => {
    // Fire onReady once, when camera + scene + invalidate are available.
    // Controls are NOT a blocking condition (may be null in this Pascal build).
    if (fired.current) return;
    if (!camera || !scene || !invalidate) return;
    fired.current = true;
    onReady(h);
  }, [camera, controls, scene, invalidate, onReady]);
  return null;
}

export function updateViewerHandleMutable(h: ViewerHandle, patch: Partial<ViewerHandle>) {
  if (patch.camera) h.camera = patch.camera;
  if (patch.controls !== undefined) h.controls = patch.controls;
  if (patch.invalidate) h.invalidate = patch.invalidate;
  if (patch.gl) h.gl = patch.gl;
  if (patch.scene) h.scene = patch.scene;
}

/**
 * Mouse and touch navigation for the Pascal Viewer. Pascal 0.9.2's <Viewer>
 * ships NO camera controls (useThree(s => s.controls) is null), so without
 * this the scene is static. We mount drei's OrbitControls with makeDefault so
 * it registers as the R3F default controls — ViewerBridge then bridges it into
 * ViewerHandle.controls and the host's view navigator drives it natively (no
 * competing instance: there is no other one).
 *
 * Navigation model:
 *   - click / tap           → select node (only drags navigate)
 *   - left-drag / 1 finger  → orbit
 *   - right or middle-drag  → move across the ground (pan)
 *   - 2 fingers             → pinch to zoom and move
 *   - wheel / pinch         → zoom towards the pointer, not the screen centre
 * The camera cannot orbit below the ground. The host sets zoom limits and
 * clipping planes for the model's size after each build.
 *
 * The Viewer draws continuously (Pascal's FrameLimiter); invalidate() is kept
 * for hosts that render on demand. Damping is disabled so the camera stops
 * where the user lets go.
 */
function MouseNavigation() {
  const invalidate = useThree((s) => s.invalidate);
  return (
    <OrbitControls
      makeDefault
      enableDamping={false}
      zoomToCursor
      screenSpacePanning={false}
      maxPolarAngle={Math.PI / 2 - 0.04}
      mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      onChange={() => invalidate()}
    />
  );
}

let pluginLoadPromise: Promise<void> | null = null;

/** Idempotent bootstrap — loadPlugin(builtinPlugin) exactly once per session. */
export function ensureBuiltinPluginLoaded(): Promise<void> {
  if (!pluginLoadPromise) {
    pluginLoadPromise = loadPlugin(builtinPlugin);
  }
  return pluginLoadPromise;
}

export interface PascalViewerShellProps {
  /** Rendered while node registration is in flight. */
  fallback?: React.ReactNode;
  children?: React.ReactNode;
  /** Rendered inside the official <Viewer> after the core children. */
  overlay?: React.ReactNode;
  /**
   * Host-controlled scene-readiness key forwarded to <Viewer>. Changing it
   * forces the viewer to invalidate() and run a frame — required because the
   * Canvas runs frameloop="never", so per-kind useFrame systems (WallSystem,
   * ColumnSystem, …) only tick when frames are explicitly requested.
   */
  sceneReadyKey?: string | number | null;
  /**
   * When false, the shell keeps the loading boundary and does NOT mount the
   * Viewer — even after the plugin is loaded. The host sets this true ONLY
   * after the scene has been installed into useScene (and installedPlugins
   * preserved). This guarantees the Viewer mounts exactly once, with a fully
   * populated node registry AND an installed scene, so RegisteredSystems'
   * useMemo sees the real entry list and mounts the per-kind systems.
   */
  mountViewer?: boolean;
  /** A key that changes to force a clean single remount (bootstrap generation). */
  viewerKey?: string | number;
  /** Selection manager injection: 'default' for standard viewer selection, 'custom' for PRO editor selection. */
  selectionManager?: 'default' | 'custom';
  /** Bridge the live R3F camera + controls out to the host (camera framing). */
  onViewerReady?: (h: ViewerHandle) => void;
}

/**
 * Mounts the official Pascal Viewer only after builtinPlugin registration
 * completes AND the host signals the scene is installed. No custom scene
 * bridge, no legacy mount points.
 */
export function PascalViewerShell({ fallback, children, overlay, sceneReadyKey, mountViewer, viewerKey, selectionManager = 'default', onViewerReady }: PascalViewerShellProps) {
  const [pluginReady, setPluginReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureBuiltinPluginLoaded()
      .then(() => {
        // loadPlugin registers node kinds but does NOT populate useScene's
        // installedPlugins — enable the builtin plugin explicitly (using THIS
        // shell's statically-imported useScene, which is the same instance the
        // Viewer renders from) so every node kind is drawable.
        try {
          useScene.getState().setInstalledPlugins([builtinPlugin.id]);
        } catch { /* noop */ }
        if (!cancelled) setPluginReady(true);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <div role="alert" className="db-shell-error">Plugin load failed: {error}</div>;
  if (!pluginReady || !mountViewer) return <>{fallback ?? <div className="db-shell-loading">Loading node registry…</div>}</>;
  return (
    <div className="db-viewer-shell" style={{ position: 'absolute', inset: 0 }}>
      <Viewer key={viewerKey ?? 'pascal-viewer'} sceneReadyKey={sceneReadyKey} selectionManager={selectionManager}>
        {onViewerReady ? <ViewerBridge onReady={onViewerReady} /> : null}
        <MouseNavigation />
        {overlay ? <>{overlay}</> : null}
      </Viewer>
      {children}
    </div>
  );
}
