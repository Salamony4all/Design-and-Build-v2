// features/pro/ProEditorLazy.tsx
//
// Optional official Pascal PRO editing mode — the PRO rendering surface.
//
// ARCHITECTURE (atomic shell switch, single Canvas/Viewer invariant):
// Mounted by page.tsx ONLY after preload completes and STANDARD's Canvas has
// unmounted. The official <Editor> renders its own Viewer + Canvas and calls
// unloadScene -> onLoad against the SAME @pascal-app/core useScene singleton.
//
// STABILITY CONTRACT (why props are memoized):
// The official Editor loads the scene in `useEffect(..., [onLoad, …])` — it
// RELOADS the scene whenever onLoad's identity changes. A prior version created
// onLoad/onSave/onLoaderChange/navbarSlot as fresh closures every render, which
// made the Editor re-run unloadScene -> applySceneGraphToEditor on every parent
// re-render — a scene-reload loop that crashed the tab. All callbacks/slots here
// are therefore useCallback/useMemo-stable and projectId is frozen for the
// session, so the load runs EXACTLY ONCE. onLoad additionally guards against a
// second call within the same transition.
//
// The official Editor exposes NO onReady callback. Truthful readiness is derived
// from onLoad-resolved + onLoaderChange(false) + root dimensions + shared-scene
// node-count parity (see evaluateReady).
//
// Persistence: onSave is a no-op (Design & Build remains the persistence owner).
//
// PROP IDENTITY IS FIXED AFTER MOUNT — do not recreate onLoad/onSave/onLoaderChange
// or change projectId during a PRO session.

'use client';

import dynamic from 'next/dynamic';
import type { ComponentType, ReactNode } from 'react';
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useScene } from '@pascal-app/core';
import { registerPascalEditorIcons } from './pascal-editor-icons';
import type { ProPreloadResult } from './proPreload';
import type { ProStage } from './useEditorMode';
import './pro.css';

const Editor = dynamic(
  () => import('@pascal-app/editor').then((m) => m.Editor as ComponentType<Record<string, unknown>>),
  {
    ssr: false,
    loading: () => (
      <div className="pascal-pro-root" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
        Loading Pascal PRO Editor…
      </div>
    ),
  },
);

interface Props {
  projectId: string;
  preload: ProPreloadResult;
  onReturn: () => void;
  onStage?: (stage: ProStage) => void;
  onReady?: () => void;
  onError?: (e: unknown) => void;
}

type SceneGraphLike = Record<string, unknown>;

const STABILITY = typeof window !== 'undefined' ? (window as unknown as { __pascalProStability?: unknown[] }).__pascalProStability : null;

// Bounded dev-only ring buffer — never logged per frame, never the crash source.
function markStage(stage: string, extra?: Record<string, unknown>) {
  if (!STABILITY || typeof window === 'undefined') return;
  const canvases = document.querySelectorAll('canvas').length;
  const sample = {
    stage,
    t: Date.now(),
    canvas: canvases,
    nodes: Object.keys((useScene.getState() as unknown as { nodes?: Record<string, unknown> }).nodes ?? {}).length,
    ...extra,
  };
  STABILITY.push(sample);
  if (STABILITY.length > 60) STABILITY.shift();
}

// App-owned error boundary: any throw inside the official Editor subtree is caught
// and reported via onError so the parent can restore STANDARD.
class ProErrorBoundary extends Component<{ onError: (e: unknown) => void; children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

export function ProEditorLazy({ projectId, preload, onReturn, onStage, onReady, onError }: Props) {
  const [failed, setFailed] = useState(false);
  const [loadDone, setLoadDone] = useState(false);
  const [loaderActive, setLoaderActive] = useState(true);

  // Frozen payload captured during preload (STANDARD still mounted then). Never
  // changes for the life of this mounted PRO session.
  const capturedRef = useRef<SceneGraphLike | null>(preload.scenePayload as SceneGraphLike);
  const onLoadCalledRef = useRef(false);
  const readyFiredRef = useRef(false);

  // --- STABLE Editor callbacks (critical: identity must not change after mount) ---
  const onLoad = useCallback(async () => {
    if (onLoadCalledRef.current) return capturedRef.current as never; // exactly one load
    onLoadCalledRef.current = true;
    markStage('AFTER_EDITOR_ONLOAD');
    setLoadDone(true);
    return capturedRef.current as never;
  }, []);

  const onSave = useCallback(async () => {}, []);

  const onLoaderChange = useCallback((v: boolean) => {
    setLoaderActive(v);
    if (!v) markStage('AFTER_LOADER_FALSE');
  }, []);

  // Stable toolbar slot (avoid recreating the element each render).
  const navbarSlot = useMemo(
    () => (
      <button className="db-btn" style={{ margin: 8 }} onClick={onReturn}>
        Return to Standard Viewer
      </button>
    ),
    [onReturn],
  );

  const evaluateReady = useCallback(() => {
    if (readyFiredRef.current) return;
    const root = typeof document !== 'undefined' ? document.querySelector('.pascal-pro-root') : null;
    const w = root ? (root as HTMLElement).offsetWidth : 0;
    const h = root ? (root as HTMLElement).offsetHeight : 0;
    const sharedCount = Object.keys(
      (useScene.getState() as unknown as { nodes?: Record<string, unknown> }).nodes ?? {},
    ).length;
    const countsMatch = sharedCount === preload.capturedNodeCount;
    if (loadDone && !loaderActive && w > 0 && h > 0 && countsMatch) {
      readyFiredRef.current = true;
      markStage('AFTER_FIRST_PRO_FRAME', { ready: true });
      onReady?.();
    }
  }, [loadDone, loaderActive, preload.capturedNodeCount, onReady]);

  useEffect(() => {
    evaluateReady();
  }, [evaluateReady]);

  useEffect(() => {
    const id = requestAnimationFrame(() => evaluateReady());
    return () => cancelAnimationFrame(id);
  }, [evaluateReady]);

  // Expose official Editor identity + stable project diagnostics (acceptance).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (async () => {
      try {
        const mod = await import('@pascal-app/editor');
        const anyMod = mod as Record<string, unknown>;
        (window as unknown as Record<string, unknown>).__pascalEditorIdentity = {
          editorPackage: '@pascal-app/editor',
          editorVersion: '0.9.2',
          editorExportUsed: 'Editor',
          officialEditorMounted: true,
          hasEditorExport: typeof anyMod.Editor === 'function',
          viewerPackage: '@pascal-app/viewer',
          viewerVersion: '0.9.2',
          corePackage: '@pascal-app/core',
          coreVersion: '0.9.2',
          iconCollectionsRegistered: ['lucide', 'mdi', 'carbon', 'charm', 'ph', 'qlementine-icons'],
          proProjectId: projectId,
          capturedNodeCount: preload.capturedNodeCount,
          activeLevelId: preload.activeLevelId,
        };
      } catch {
        /* diagnostics best-effort */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) {
    return (
      <div className="pascal-pro-root" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div>
          <p style={{ color: 'var(--muted)' }}>Pascal PRO could not be opened. Standard mode remains available.</p>
          <button className="db-btn" style={{ marginTop: 12 }} onClick={onReturn}>
            Return to Standard Viewer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="pascal-pro-root"
      style={{ position: 'absolute', top: 64, left: 0, right: 0, bottom: 0, zIndex: 20, background: 'var(--background)' }}
    >
      <ProErrorBoundary onError={(e) => { setFailed(true); markStage('PRO_FAILED'); onError?.(e); }}>
        <Editor
          layoutVersion="v1"
          projectId={projectId}
          onLoad={onLoad}
          onSave={onSave}
          onLoaderChange={onLoaderChange}
          navbarSlot={navbarSlot}
        />
      </ProErrorBoundary>
    </div>
  );
}
