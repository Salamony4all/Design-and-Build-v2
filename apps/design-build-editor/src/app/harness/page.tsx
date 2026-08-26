// /harness — Section 4 capability harness page.
// loadPlugin(builtinPlugin) -> setScene(static capability scene) -> official Viewer.
// ALL Pascal imports are lazy client-side imports: @pascal-app/core at module
// scope breaks Next SSR chunk loading (three/webgpu deps), so we import() it
// after mount. window.__harness exposes the REAL stores for the automated test.
'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { CapabilityScene } from '@/harness/build-capability-scene';
import { getPascalStores } from 'design-build-simplified-viewer-shell';

const PascalViewerShell = dynamic(
  () => import('design-build-simplified-viewer-shell').then((m) => m.PascalViewerShell),
  { ssr: false },
);

const STORAGE_KEY = 'db-harness-scene-v1';

declare global {
  interface Window {
    __harness?: {
      ids: CapabilityScene['ids'];
      useScene: unknown;
      sceneRegistry: unknown;
      useViewer?: unknown;
      useLiveTransforms?: { getState: () => { get: (id: string) => unknown } };
      nodeRegistry?: { get: (k: string) => { system?: unknown; geometry?: unknown; renderer?: unknown } | undefined };
      sceneReadyKey?: number;
      temporal?: { getState: () => { undo: () => void; redo: () => void; clear: () => void } };
      dirtyAll?: () => void;
      rebuild: () => void;
    };
  }
}

export default function HarnessPage() {
  const [ids, setIds] = useState<CapabilityScene['ids'] | null>(null);
  const [sceneReadyKey, setSceneReadyKey] = useState<number>(0);
  // Bootstrap generation: bumped exactly once after the scene is installed,
  // forcing the Viewer to mount (with a fresh key) against a fully populated
  // registry + installed scene.
  const [viewerGen, setViewerGen] = useState<number>(0);
  const [sceneInstalled, setSceneInstalled] = useState(false);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      (window as unknown as { __errs?: string[] }).__errs = (window as unknown as { __errs?: string[] }).__errs ?? [];
      const errs = (window as unknown as { __errs: string[] }).__errs;
      try {
      // Use the SHELL's statically-imported core stores (shared with the Viewer)
      // rather than a dynamic import('@pascal-app/core') — a dynamic import lands
      // in a separate webpack chunk and creates a SECOND core module instance
      // with its own useScene/sceneRegistry singletons. That split-store bug is
      // why dirty nodes were invisible to the renderer. getPascalStores() returns
      // the exact same core instance the Viewer renders from.
      const core = getPascalStores();
      const [viewer, harness, nodesPkg] = await Promise.all([
        import('@pascal-app/viewer'),
        import('@/harness/build-capability-scene'),
        import('@pascal-app/nodes'),
      ]);
      if (cancelled) return;
      const { useScene, sceneRegistry, loadPlugin } = core as unknown as {
        useScene: {
          getState: () => {
            setScene: (n: never, r: never, extra?: { installedPlugins?: string[]; collections?: never; materials?: never; hasExplicitPluginInstallState?: boolean }) => void;
            markDirty: (id: never) => void;
            createNode: (node: never, parentId?: never) => void;
            loadScene: () => void;
            setInstalledPlugins: (ids: string[]) => void;
            nodes: Record<string, unknown>;
            dirtyNodes: Set<string>;
          };
          subscribe: (fn: (s: { nodes: unknown; rootNodeIds: unknown }) => void) => () => void;
          temporal: { getState: () => { undo: () => void; redo: () => void; clear: () => void } };
        };
        sceneRegistry: unknown;
        loadPlugin: (p: unknown) => Promise<void>;
        nodeRegistry: { get: (k: string) => { system?: unknown; geometry?: unknown; renderer?: unknown } | undefined };
        useLiveTransforms: { getState: () => { get: (id: string) => unknown } };
      };
      // Await node-definition registration BEFORE feeding the scene, so
      // markDirty()/the GeometrySystem see every node kind (wall/column/etc)
      // as enabled. loadPlugin() registers kinds into the registry but does NOT
      // populate useScene.installedPlugins — we must enable the builtin plugin
      // explicitly, otherwise markDirty() skips every non-base node kind and
      // only the slab (a base kind) renders.
      const builtin = (nodesPkg as { builtinPlugin: { id: string } }).builtinPlugin;
      await loadPlugin(builtin);
      useScene.getState().setInstalledPlugins([builtin.id]);

      let scene: CapabilityScene;
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        scene = JSON.parse(saved) as CapabilityScene; // persistence path (same ids after refresh)
      } else {
        scene = harness.buildCapabilityScene();
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
      }
      // Feed the scene through the canonical load pipeline: setScene (data) then
      // loadScene (marks all nodes dirty → GeometrySystem rebuild → node
      // transforms from start/end/position applied). CRITICAL: setScene RESETS
      // installedPlugins to [] unless we pass it via the extra arg, so the
      // builtin plugin id must ride along — otherwise markDirty() skips every
      // non-base node kind and only the slab draws.
      const installed = [builtin.id];
      useScene.getState().setScene(scene.nodes as never, scene.rootNodeIds as never, { installedPlugins: installed });
      useScene.getState().setInstalledPlugins(installed);
      useScene.getState().loadScene();
      // Scene now installed into the SHARED useScene (same instance the Viewer
      // renders from). Signal the shell to mount the Viewer exactly once, with
      // a fresh key, so RegisteredSystems mounts the per-kind systems against
      // the fully populated registry.
      setSceneInstalled(true);
      setViewerGen((g) => g + 1);
      // Drive frames. The Viewer Canvas runs frameloop="never", so the
      // per-kind useFrame systems (WallSystem/ColumnSystem/…) only tick when a
      // frame is requested. Bumping sceneReadyKey makes the Viewer invalidate()
      // (see viewer index.js), running one frame — which lets the systems
      // drain dirtyNodes. Pump until the dirty set empties (capped).
      const uv = (viewer as { useViewer?: { getState: () => { bumpGeometryRevision?: () => void } } }).useViewer;
      uv?.getState().bumpGeometryRevision?.();
      let pump = 0;
      const pumpTimer = setInterval(() => {
        if (cancelled) { clearInterval(pumpTimer); return; }
        const st = useScene.getState();
        if (st.dirtyNodes.size === 0 || pump >= 60) { clearInterval(pumpTimer); return; }
        pump += 1;
        setSceneReadyKey((k) => k + 1); // forces a viewer frame
        uv?.getState().bumpGeometryRevision?.();
      }, 80);
      setIds(scene.ids);

      // Persist every mutation (move/delete/undo/redo) so refresh restores CURRENT state.
      unsub = useScene.subscribe((s) => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          nodes: s.nodes, rootNodeIds: s.rootNodeIds, ids: scene.ids,
        }));
      });

      window.__harness = {
        ids: scene.ids,
        useScene,
        sceneRegistry,
        nodeRegistry: core.nodeRegistry,
        useLiveTransforms: core.useLiveTransforms,
        sceneReadyKey: sceneReadyKey,
        useViewer: (viewer as { useViewer?: unknown }).useViewer,
        temporal: (useScene as unknown as { temporal: { getState: () => { undo: () => void; redo: () => void; clear: () => void } } }).temporal,
        dirtyAll: () => {
          for (const id of Object.keys(useScene.getState().nodes)) useScene.getState().markDirty(id as never);
          const u = (viewer as { useViewer?: { getState: () => { bumpGeometryRevision?: () => void } } }).useViewer;
          u?.getState().bumpGeometryRevision?.();
        },
        rebuild: () => { window.localStorage.removeItem(STORAGE_KEY); window.location.reload(); },
      };
      } catch (e) {
        errs.push('harness effect: ' + (e instanceof Error ? (e.stack || e.message) : String(e)));
        console.error('[harness]', e);
      }
    })();

    return () => { cancelled = true; unsub?.(); };
  }, []);

  return (
    <main style={{ position: 'fixed', inset: 0 }}>
      <PascalViewerShell
        sceneReadyKey={sceneReadyKey}
        mountViewer={sceneInstalled}
        viewerKey={`pascal-viewer-${viewerGen}`}
        fallback={<div style={{ padding: 24 }}>Registering node definitions…</div>}
      />
      <div data-testid="harness-hud" style={{ position: 'absolute', top: 8, left: 8, background: '#111a', color: '#fff', padding: '6px 10px', borderRadius: 6, fontSize: 12, zIndex: 10 }}>
        Capability harness — {ids ? 'scene ready (native ColumnNode included)' : 'building scene…'}
      </div>
    </main>
  );
}
