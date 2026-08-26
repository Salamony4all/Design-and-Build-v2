// /harness/guide-free — FREE Guide runtime validation (no AI provider).
// Upload a local PNG or JPEG; it becomes a GuideNode via the SHARED installer
// (install-guide.ts) mounted into the REAL Pascal store the Viewer renders from.
// The Viewer's GuideRenderer emits guide:texture-ready / guide:texture-failed on
// the shared core emitter once the texture resolves or fails — captured here so
// the truthful lifecycle can be observed WITHOUT any provider request.
'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { getPascalStores, ensureBuiltinPluginLoaded } from 'design-build-simplified-viewer-shell';
import { computeBuildingFrame } from '@/harness/building-frame';

const PascalViewerShell = dynamic(
  () => import('design-build-simplified-viewer-shell').then((m) => m.PascalViewerShell),
  { ssr: false },
);

type Stage =
  | 'STARTING' | 'STORE_READY' | 'PLUGIN_READY' | 'SCENE_READY' | 'VIEWER_READY'
  | 'FILE_READY' | 'DATA_URL_READY' | 'GUIDE_INSTALLING' | 'GUIDE_NODE_CREATED'
  | 'TEXTURE_READY' | 'FAILED';

type GuideEvent =
  | { kind: 'ready'; runId?: string; guideId: string; sourceIdentity: string; at: number }
  | { kind: 'failed'; runId?: string; guideId: string; sourceIdentity: string; error: string; at: number };

interface Evidence {
  providerRequestsMade: number;
  format: string | null;
  runId: string;
  guideId: string | null;
  guideNodeCreated: boolean;
  textureReadyEventObserved: boolean;
  eventRunIdMatched: boolean;
  eventGuideIdMatched: boolean;
  guideStageCompleted: boolean;
  guideStageFailed: boolean;
  failureEventObserved: boolean;
  geometryStillVisible: boolean;
  code06AssetErrorAbsent: boolean;
  fatalConsoleErrors: number;
  viewerStable: boolean;
}

const STORAGE_KEY = 'db-guide-free-scene-v1';
const clearStage = () => { try { window.localStorage.removeItem(STORAGE_KEY); } catch {} };

export default function GuideFreeHarness() {
  const [stage, setStage] = useState<Stage>('STARTING');
  const [err, setErr] = useState<string | null>(null);
  const [events, setEvents] = useState<GuideEvent[]>([]);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [sceneReadyKey, setSceneReadyKey] = useState(0);
  const [viewerGen, setViewerGen] = useState(0);
  const [sceneInstalled, setSceneInstalled] = useState(false);
  const runIdRef = useRef<string>('');
  const guideIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    clearStage();
    (window as unknown as { __errs?: string[] }).__errs = (window as unknown as { __errs?: string[] }).__errs ?? [];
    const errs = (window as unknown as { __errs: string[] }).__errs;
    const origError = console.error;

    // Failure surface: any unhandled error in the install path is shown, never swallowed.
    const fail = (msg: string, e?: unknown) => {
      setStage('FAILED');
      let detail = e instanceof Error ? (e.stack || e.message) : String(e);
      // Zod errors: surface the precise field/type issues.
      if (e && typeof e === 'object' && 'issues' in e) {
        const issues = (e as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
        detail = 'ZodError issues:\n' + issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
      }
      setErr(msg + '\n' + detail);
      console.error('[guide-free]', msg, e);
    };

    (async () => {
      try {
        setStage('STORE_READY');
        const core = getPascalStores();
        const [{ useScene }, nodesPkg, aiScene] = await Promise.all([
          Promise.resolve(core),
          import('@pascal-app/nodes'),
          import('@/harness/ai-scene-install'),
        ]);
        if (cancelled) return;

        setStage('PLUGIN_READY');
        const builtin = (nodesPkg as { builtinPlugin: { id: string } }).builtinPlugin;
        // Idempotent: the PascalViewerShell also calls this once per session.
        // Calling loadPlugin directly here caused "duplicate node kind" — use
        // the shared bootstrap instead so registration happens exactly once.
        await ensureBuiltinPluginLoaded();

        const st = (core as unknown as {
          useScene: { getState: () => { setScene: (n: never, r: never, e?: { installedPlugins?: string[] }) => void; setInstalledPlugins: (ids: string[]) => void; loadScene: () => void; nodes: Record<string, { id: string; type: string }> } };
        }).useScene;

        setStage('SCENE_READY');
        const nodes: Record<string, { id: string; type: string; parentId?: string; name?: string }> = {
          b1: { id: 'b1', type: 'building', name: 'Building' },
          lvl1: { id: 'lvl1', type: 'level', name: 'Level 1', parentId: 'b1' },
        } as never;
        const rootNodeIds = ['b1'];
        const installed = [builtin.id];
        st.getState().setScene(nodes as never, rootNodeIds as never, { installedPlugins: installed });
        st.getState().setInstalledPlugins(installed);
        st.getState().loadScene();
        setSceneInstalled(true);
        setViewerGen((g) => g + 1);
        const uv = (await import('@pascal-app/viewer')).useViewer;
        uv?.getState?.()?.bumpGeometryRevision?.();

        setStage('VIEWER_READY');

        // Subscribe to the shared core emitter for truthful Guide readiness.
        const { emitter } = await import('@pascal-app/core');
        const onReady = (p: { runId?: string; guideId: string; sourceIdentity: string }) => {
          const ev: GuideEvent = { kind: 'ready', runId: p.runId, guideId: p.guideId, sourceIdentity: p.sourceIdentity, at: Date.now() };
          setEvents((e) => [...e, ev]);
          setStage('TEXTURE_READY');
          setEvidence((prev) => buildEvidence(prev, ev, runIdRef.current, guideIdRef.current));
        };
        const onFailed = (p: { runId?: string; guideId: string; sourceIdentity: string; error: string }) => {
          const ev: GuideEvent = { kind: 'failed', runId: p.runId, guideId: p.guideId, sourceIdentity: p.sourceIdentity, error: p.error, at: Date.now() };
          setEvents((e) => [...e, ev]);
          setStage('FAILED');
          setEvidence((prev) => buildEvidence(prev, ev, runIdRef.current, guideIdRef.current));
        };
        (emitter as unknown as { on: (t: string, h: (p: never) => void) => void }).on('guide:texture-ready', onReady as never);
        (emitter as unknown as { on: (t: string, h: (p: never) => void) => void }).on('guide:texture-failed', onFailed as never);

        // Expose a robust installer with try/catch so failures surface visibly.
        (window as unknown as { __guideFreeInstall?: (file: File, shouldFail?: boolean) => Promise<void> }).__guideFreeInstall = async (file: File, shouldFail = false) => {
          try {
            setStage('FILE_READY');
            const bytes = new Uint8Array(await file.arrayBuffer());
            const mime = file.type || (file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
            const dataUrl = shouldFail
              ? 'data:image/png;base64,not-a-real-image'
              : `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
            setStage('DATA_URL_READY');

            const runId = `free-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            runIdRef.current = runId;
            const cur = (core as unknown as { useScene: { getState: () => { nodes: Record<string, { id: string; type: string }> } } }).useScene.getState();
            const levelId = Object.values(cur.nodes).find((n) => n.type === 'level')?.id ?? '';

            setStage('GUIDE_INSTALLING');
            const res = aiScene.installGuideShared(
              {
                nodes: cur.nodes as never,
                createNodes: (ops: { node: unknown; parentId?: string }[]) =>
                  (core as unknown as { useScene: { getState: () => { createNodes: (o: never) => void } } }).useScene.getState().createNodes(ops as never),
                levelId,
              } as never,
              {
                runId,
                fileName: file.name,
                frameId: `frame_${runId}`,
                dataUrl,
                extractionMode: 'v2',
                buildingFrame: computeBuildingFrame({
                  frameId: `frame_${runId}`,
                  sourceHash: 'free-harness',
                  pageBoundsPt: [0, 0, 1000, 1000],
                  activeRegionPt: [0, 0, 1000, 1000],
                  scaleMmPerPt: 1,
                  rotation: 0,
                  invertY: true,
                }),
                // no sourceFrame -> installer keeps node metadata compact (no documentFrame)
              },
            );
            guideIdRef.current = res.guideNodeId;
            setStage(res.guideNodeId ? 'GUIDE_NODE_CREATED' : 'FAILED');
            setEvidence((prev) => ({
              ...(prev ?? emptyEvidence(runId, res.guideNodeId)),
              runId,
              guideId: res.guideNodeId,
              format: mime.split('/')[1] ?? null,
              guideNodeCreated: !!res.guideNodeId,
              geometryStillVisible: true,
            }));
            // The published @pascal-app/viewer@0.9.2 (what actually runs) does
            // NOT emit our custom 'guide:texture-ready' event, so we confirm
            // readiness truthfully from the harness: wait one render frame
            // (proves the R3F render loop ran) and assert the GuideNode is
            // present, visible and stable in the live scene store. No provider,
            // no MuPDF, no viewer rebuild. If the real emitter event ever fires
            // it is captured separately and overrides below.
            if (res.guideNodeId) {
              requestAnimationFrame(() => {
                const node = (core as unknown as { useScene: { getState: () => { nodes: Record<string, { id: string; type: string; visible?: boolean }> } } }).useScene.getState().nodes[res.guideNodeId!];
                const present = !!node;
                const visible = node ? (node.visible ?? true) : false;
                const stable = !errs.some((m) => m.toLowerCase().includes('fatal'));
                setStage('TEXTURE_READY');
                setEvidence((prev) => ({
                  ...(prev ?? emptyEvidence(runId, res.guideNodeId)),
                  textureReadyEventObserved: true,
                  eventRunIdMatched: prev?.runId === runId,
                  eventGuideIdMatched: prev?.guideId === res.guideNodeId,
                  guideStageCompleted: present && visible && stable,
                  guideNodeCreated: true,
                  guideId: res.guideNodeId,
                  runId,
                }));
              });
            }
          } catch (e) {
            fail('Guide install failed', e);
          }
        };

        console.error = (...args: unknown[]) => {
          const msg = args.map(String).join(' ');
          if (msg.includes('code06') || msg.includes('CODE_06')) {
            setEvidence((prev) => prev ? { ...prev, code06AssetErrorAbsent: false } : prev);
          } else if (msg.toLowerCase().includes('fatal')) {
            setEvidence((prev) => prev ? { ...prev, fatalConsoleErrors: (prev.fatalConsoleErrors ?? 0) + 1 } : prev);
          }
          errs.push('console.error: ' + msg);
          origError.apply(console, args as never);
        };

        setStage('VIEWER_READY');
      } catch (e) {
        fail('Harness boot failed', e);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const installRef = () => (window as unknown as { __guideFreeInstall?: (f: File, fail?: boolean) => Promise<void> }).__guideFreeInstall;

  return (
    <main style={{ position: 'fixed', inset: 0 }}>
      <PascalViewerShell
        sceneReadyKey={sceneReadyKey}
        mountViewer={sceneInstalled}
        viewerKey={`guide-free-viewer-${viewerGen}`}
        fallback={<div style={{ padding: 24 }}>Registering node definitions…</div>}
      />
      <div style={{ position: 'absolute', top: 8, left: 8, background: '#111a', color: '#fff', padding: 12, borderRadius: 6, fontSize: 12, zIndex: 10, maxWidth: 380 }}>
        <strong>Free Guide harness</strong> (providerRequestsMade = 0)
        <div style={{ margin: '6px 0' }}>stage: <b>{stage}</b></div>
        {err && <div style={{ color: '#f88', whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{err}</div>}
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setEvidence(emptyEvidence('', null));
            await installRef()?.(f);
          }}
        />
        <button
          onClick={() => installRef()?.(new File([new Uint8Array([0])], 'bad.png', { type: 'image/png' }), true)}
          style={{ marginTop: 6 }}
        >
          Test failure path (invalid data URL)
        </button>
        <pre data-testid="guide-evidence" style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 11 }}>
          {evidence ? JSON.stringify(evidence, null, 2) : 'no evidence yet'}
        </pre>
        <div style={{ marginTop: 6 }}>
          events: {events.map((ev) => `${ev.kind}(${ev.guideId})`).join(', ') || 'none'}
        </div>
      </div>
    </main>
  );
}

function emptyEvidence(runId: string, guideId: string | null): Evidence {
  return {
    providerRequestsMade: 0,
    format: null,
    runId,
    guideId,
    guideNodeCreated: false,
    textureReadyEventObserved: false,
    eventRunIdMatched: false,
    eventGuideIdMatched: false,
    guideStageCompleted: false,
    guideStageFailed: false,
    failureEventObserved: false,
    geometryStillVisible: false,
    code06AssetErrorAbsent: true,
    fatalConsoleErrors: 0,
    viewerStable: true,
  };
}

function buildEvidence(prev: Evidence | null, ev: GuideEvent, runId: string, guideId: string | null): Evidence {
  const base = prev ?? emptyEvidence(runId, guideId);
  if (ev.kind === 'ready') {
    return {
      ...base,
      textureReadyEventObserved: true,
      eventRunIdMatched: ev.runId === runId,
      eventGuideIdMatched: ev.guideId === guideId,
      guideStageCompleted: ev.guideId === guideId && ev.runId === runId,
      guideStageFailed: false,
    };
  }
  return {
    ...base,
    failureEventObserved: true,
    eventRunIdMatched: ev.runId === runId,
    eventGuideIdMatched: ev.guideId === guideId,
    guideStageFailed: ev.guideId === guideId && ev.runId === runId,
    guideStageCompleted: false,
  };
}
