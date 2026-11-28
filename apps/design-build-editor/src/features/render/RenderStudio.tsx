// features/render/RenderStudio.tsx
// Renders: the one place for photoreal renders, as a chat. Each render is a card
// in the thread (the captured view while it runs, then the render with its
// geometry match, a before/after comparison, download and other looks of the
// same view); the composer under it holds the prompt and every setting (look,
// frame, quality, projection, look references, furnishing). A prompt renders
// the view in the camera, or refines the last render's view. Prompts typed in
// the main prompt bar come here too (`request`). A fixed frame (16:9, 3:2, …)
// shows a viewfinder over the 3D view, and the render is exactly what is inside
// it; inside views (walk mode) tell the model the lens and let it close the
// open-top rooms with a ceiling.
'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewerHandle } from 'design-build-simplified-viewer-shell';
import {
  MAX_LOOK_REFERENCES,
  REFERENCE_BUDGET,
  RENDER_FRAMES,
  RENDER_STYLES,
  RENDER_TIERS,
  frameAspect,
  furnishFromText,
  getRenderStyle,
  isRenderFrame,
  styleFromText,
  viewfinderRect,
  type RenderFrameId,
  type RenderStyleId,
  type RenderTierId,
} from './render-presets';
import { captureViewForRender, furnitureSummary, hasRenderableScene, type FrameCrop, type PreparedView } from './capture-view';
import type { ViewArea } from '../viewer-interaction/view-navigator';
import { lookReference, renderPhotoreal, renderStatus, RenderRequestError, type RenderJobResult, type RenderStage } from './render-client';
import { OUTSIDE_OK, fidelityGrade } from './geometry-fidelity';
import { CompareSlider } from './CompareSlider';
import styles from './RenderStudio.module.css';

export interface RenderProgressInfo {
  active: boolean;
  stage?: RenderStage;
  snapshotUrl?: string;
  modelLabel?: string;
}

export interface RenderStudioProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getViewerHandle: () => ViewerHandle | null;
  onOpenSettings?: () => void;
  onRenderProgress?: (p: RenderProgressInfo) => void;
  onRenderComplete?: (r: RenderJobResult) => void;
  /** Is the camera standing inside the model (walk mode), and with which lens. */
  getViewContext?: () => { interior: boolean; lensMm: number };
  /** Part of the 3D view not covered by the header, toolbar and prompt bar (for the viewfinder). */
  getFreeArea?: () => ViewArea;
  /**
   * The viewfinder moved or went away (canvas pixels). The page centres the
   * camera's lens on it, so the framed shot keeps a natural perspective.
   */
  onFinderChange?: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  /** Projection of the live camera: parallel for an isometric (orthographic) view. */
  getProjection?: () => Projection;
  /** Switch the camera to an isometric parallel view, or back to perspective. */
  onProjectionChange?: (p: Projection) => void;
  /** A prompt from the main prompt bar ("golden hour with oak floors"), rendered in this thread. */
  request?: { id: number; text: string } | null;
  /** The thread is folded to a bar (phones: to frame the shot). */
  onFoldChange?: (folded: boolean) => void;
}

type Projection = 'perspective' | 'parallel';

type TurnStatus = 'running' | 'done' | 'error' | 'cancelled';

/** One render in the thread: the prompt, the settings it used, and how it went. */
interface Turn {
  id: string;
  prompt: string;
  style: RenderStyleId;
  tier: RenderTierId;
  /** Rendered from an earlier render's view (a variation or a refinement). */
  sameView: boolean;
  status: TurnStatus;
  stage: RenderStage | null;
  /** The captured view, shown while the render runs. */
  snapshotUrl?: string;
  result?: RenderJobResult;
  error?: { message: string; code: string };
  /** What "Try again" runs. */
  again: { reuseView?: PreparedView; style: RenderStyleId; prompt: string };
}

type SettingsKey = 'look' | 'frame' | 'quality' | 'refs' | 'more';

const PREFS_KEY = 'db.render.prefs.v1';
/** Renders kept in the thread (each holds its images). */
const MAX_TURNS = 12;

interface Prefs {
  style: RenderStyleId;
  tier: RenderTierId;
  furnish: boolean;
  /** Crop to the building (more pixels on walls and openings) instead of the full frame. */
  frameBuilding: boolean;
  /** Render format: the screen's shape, or a fixed frame shown as a viewfinder. */
  frame: RenderFrameId;
  /** Inside views: close the open-top rooms with a plain ceiling. */
  ceiling: boolean;
}

export function loadRenderPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return {
      style: RENDER_STYLES.some((s) => s.id === p.style) ? (p.style as RenderStyleId) : 'daylight',
      tier: p.tier && p.tier in RENDER_TIERS ? p.tier : 'fast',
      furnish: !!p.furnish,
      frameBuilding: p.frameBuilding !== false,
      frame: isRenderFrame(p.frame) ? p.frame : 'screen',
      ceiling: p.ceiling !== false,
    };
  } catch {
    return { style: 'daylight', tier: 'fast', furnish: false, frameBuilding: true, frame: 'screen', ceiling: true };
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

const DEV_DEBUG_SAVE = process.env.NODE_ENV !== 'production';

/** Words in a prompt that name a look ("golden hour", "at night", "clay model"). */
const LOOK_WORDS = /golden|sunset|sunrise|warm sun|night|dusk|evening|blue hour|overcast|cloud|soft light|diffuse|clay|white model|massing|maquette|daylight|daytime/i;

/** The look a prompt asks for, or null when it names none. */
function lookFromPrompt(text: string): RenderStyleId | null {
  return LOOK_WORDS.test(text) ? styleFromText(text) : null;
}

/** Where the camera stands and looks (to tell whether the view moved since the last render). */
function poseKey(h: ViewerHandle | null): string {
  const cam = (h as unknown as { camera?: { position?: { x: number; y: number; z: number }; quaternion?: { x: number; y: number; z: number; w: number } } } | null)?.camera;
  if (!cam?.position || !cam.quaternion) return '';
  const r = (v: number, k: number) => Math.round(v * k);
  const p = cam.position;
  const q = cam.quaternion;
  return [r(p.x, 50), r(p.y, 50), r(p.z, 50), r(q.x, 200), r(q.y, 200), r(q.z, 200), r(q.w, 200)].join(',');
}

function downloadDataUrl(url: string, mime: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.${mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const turnId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function isPhone(): boolean {
  try {
    return window.matchMedia('(max-width: 720px)').matches;
  } catch {
    return false;
  }
}

export function RenderStudio({
  open,
  onOpenChange,
  getViewerHandle,
  onOpenSettings,
  onRenderProgress,
  onRenderComplete,
  getViewContext,
  getFreeArea,
  onFinderChange,
  getProjection,
  onProjectionChange,
  request,
  onFoldChange,
}: RenderStudioProps) {
  const setOpen = onOpenChange;
  const [prefs, setPrefs] = useState<Prefs>({ style: 'daylight', tier: 'fast', furnish: false, frameBuilding: true, frame: 'screen', ceiling: true });
  const [viewCtx, setViewCtx] = useState<{ interior: boolean; lensMm: number }>({ interior: false, lensMm: 0 });
  const [projection, setProjection] = useState<Projection>('perspective');
  /** Folded to a bar (header and composer) so the viewfinder gets the screen. */
  const [folded, setFolded] = useState(false);
  /** Viewfinder rectangle, in canvas pixels (left/top relative to the canvas). */
  const [finder, setFinder] = useState<{ x: number; y: number; w: number; h: number; cw: number; ch: number; left: number; top: number } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const [note, setNote] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<{ ready: boolean; providerLabel: string | null } | null>(null);
  const [settings, setSettings] = useState<SettingsKey | null>(null);
  /** The render shown large, with either model lines or the depth+mesh overlay active. */
  const [large, setLarge] = useState<{ id: string; overlay: 'none' | 'lines' | 'depth-mesh' } | null>(null);
  const [noScene, setNoScene] = useState(false);
  /** Furniture placed from the drawing (and BOQ Flow products on it): the render shows that, not AI furniture. */
  const [drawn, setDrawn] = useState<{ pieces: number; products: number }>({ pieces: 0, products: 0 });
  /** Look references: pictures whose materials, colours and mood the render follows (kept while the page is open). */
  const [looks, setLooks] = useState<{ id: string; url: string; name: string }[]>([]);
  const [lookError, setLookError] = useState<string | null>(null);
  const lookInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Camera pose of the last captured view, and whether the camera has moved since. */
  const lastPoseRef = useRef('');
  const [moved, setMoved] = useState(false);
  /** The user's own pick of what the next prompt renders (null: decided by whether the camera moved). */
  const [targetPick, setTargetPick] = useState<'last' | 'current' | null>(null);

  const running = turns.some((t) => t.status === 'running');
  const lastDone = [...turns].reverse().find((t) => t.status === 'done' && t.result)?.result ?? null;
  const target: 'last' | 'current' = !lastDone ? 'current' : targetPick ?? (moved ? 'current' : 'last');

  const fold = useCallback(
    (v: boolean) => {
      setFolded(v);
      onFoldChange?.(v);
    },
    [onFoldChange],
  );

  const addLooks = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setLookError(null);
    const room = MAX_LOOK_REFERENCES - looks.length;
    const picked = [...files].slice(0, Math.max(0, room));
    const added: { id: string; url: string; name: string }[] = [];
    for (const f of picked) {
      const url = await lookReference(f);
      if (url) added.push({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, url, name: f.name });
    }
    if (added.length < picked.length) setLookError('Some files were not pictures we can read (use JPEG, PNG or WebP).');
    else if (files.length > picked.length) setLookError(`Up to ${MAX_LOOK_REFERENCES} look references.`);
    if (added.length) setLooks((old) => [...old, ...added].slice(0, MAX_LOOK_REFERENCES));
  }, [looks.length]);

  useEffect(() => setPrefs(loadRenderPrefs()), []);
  useEffect(() => savePrefs(prefs), [prefs]);

  useEffect(() => {
    if (!open) return;
    // A fixed frame on a phone: start folded so the viewfinder has room.
    if (loadRenderPrefs().frame !== 'screen' && isPhone()) fold(true);
    setNoScene(!hasRenderableScene(getViewerHandle()));
    setDrawn(furnitureSummary());
    void renderStatus().then(setStatus);
    setViewCtx(getViewContext?.() ?? { interior: false, lensMm: 0 });
    setProjection(getProjection?.() ?? 'perspective');
    const id = window.setInterval(() => {
      const c = getViewContext?.();
      if (c) setViewCtx((old) => (old.interior === c.interior && Math.round(old.lensMm) === Math.round(c.lensMm) ? old : c));
      const p = getProjection?.();
      if (p) setProjection(p);
      if (lastPoseRef.current) {
        const now = poseKey(getViewerHandle());
        setMoved(!!now && now !== lastPoseRef.current);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [open, getViewerHandle, getViewContext, getProjection, fold]);

  // Viewfinder: the largest frame of the chosen format in the free part of the
  // 3D view, clear of this panel. The render is exactly what is inside it.
  const measureFinder = useCallback(() => {
    const aspect = frameAspect(prefs.frame);
    const canvas = (getViewerHandle()?.gl as { domElement?: HTMLCanvasElement } | undefined)?.domElement;
    if (!open || !aspect || !canvas || !getFreeArea || large) {
      setFinder(null);
      return;
    }
    const area = getFreeArea();
    const cr = canvas.getBoundingClientRect();
    let x0 = area.insets.left;
    let x1 = area.width - area.insets.right;
    let y0 = area.insets.top;
    let y1 = area.height - area.insets.bottom;
    const pr = panelRef.current?.getBoundingClientRect();
    if (pr && pr.width > 0) {
      const l = pr.left - cr.left;
      const r = pr.right - cr.left;
      const t = pr.top - cr.top;
      const b = pr.bottom - cr.top;
      if (pr.width > area.width * 0.55) {
        // A sheet across the screen: above it when it sits low, below it when it sits high.
        if ((t + b) / 2 > area.height / 2) y1 = Math.min(y1, t - 10);
        else y0 = Math.max(y0, b + 10);
      } else if ((l + r) / 2 > area.width / 2) x1 = Math.min(x1, l - 12);
      else x0 = Math.max(x0, r + 12);
    }
    const rect = viewfinderRect({ x0, y0, x1, y1 }, aspect.ratio);
    setFinder(rect ? { ...rect, cw: cr.width, ch: cr.height, left: cr.left, top: cr.top } : null);
  }, [open, prefs.frame, large, getFreeArea, getViewerHandle]);

  useEffect(() => {
    measureFinder();
    if (!open) return;
    const onResize = () => measureFinder();
    window.addEventListener('resize', onResize);
    let ro: ResizeObserver | null = null;
    if (panelRef.current && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measureFinder());
      ro.observe(panelRef.current);
    }
    const settle = window.setTimeout(measureFinder, 320);
    return () => {
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
      window.clearTimeout(settle);
    };
  }, [open, measureFinder, folded, settings]);

  // Tell the page where the viewfinder is (it re-centres the lens on it).
  const finderKey = open && finder ? `${Math.round(finder.x)},${Math.round(finder.y)},${Math.round(finder.w)},${Math.round(finder.h)}` : '';
  useEffect(() => {
    if (!onFinderChange) return;
    if (!finderKey) {
      onFinderChange(null);
      return;
    }
    const [x, y, w, h] = finderKey.split(',').map(Number);
    onFinderChange({ x, y, w, h });
  }, [finderKey, onFinderChange]);
  useEffect(() => () => onFinderChange?.(null), [onFinderChange]);

  const frameCrop = useCallback((): FrameCrop | null => {
    const aspect = frameAspect(prefs.frame);
    if (!aspect || !finder) return null;
    return {
      aspect,
      rect: { x0: finder.x / finder.cw, y0: finder.y / finder.ch, x1: (finder.x + finder.w) / finder.cw, y1: (finder.y + finder.h) / finder.ch },
    };
  }, [prefs.frame, finder]);

  const pickFrame = (frame: RenderFrameId) => {
    setPrefs((p) => ({ ...p, frame }));
    // On a phone, fold the thread so the viewfinder has room.
    if (frame !== 'screen' && isPhone()) {
      setSettings(null);
      fold(true);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !open) return;
      if (large) setLarge(null);
      else if (settings) setSettings(null);
      else setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, large, settings, setOpen]);

  // New renders and their progress stay in sight at the bottom of the thread.
  const lastTurn = turns[turns.length - 1];
  const scrollKey = lastTurn ? `${turns.length}:${lastTurn.status}:${Math.round((lastTurn.stage?.progress ?? 0) * 20)}` : '';
  useEffect(() => {
    const el = threadRef.current;
    if (!el || !scrollKey) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [scrollKey, folded]);

  const run = useCallback(
    async (opts: { reuseView?: PreparedView; style?: RenderStyleId; prompt?: string } = {}) => {
      if (abortRef.current) return;
      const prompt = (opts.prompt ?? '').trim();
      const style = opts.style ?? lookFromPrompt(prompt) ?? prefs.style;
      if (style !== prefs.style) setPrefs((p) => ({ ...p, style }));
      const tierId = prefs.tier;
      const tier = RENDER_TIERS[tierId];
      const id = turnId();
      const ac = new AbortController();
      abortRef.current = ac;
      setSettings(null);
      setTargetPick(null);
      const patch = (p: Partial<Turn>) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
      const first: RenderStage = { key: 'capture', label: opts.reuseView ? 'Using the same view…' : 'Capturing your exact 3D view…', progress: 0.03 };
      setTurns((ts) =>
        [
          ...ts,
          {
            id,
            prompt,
            style,
            tier: tierId,
            sameView: !!opts.reuseView,
            status: 'running' as const,
            stage: first,
            snapshotUrl: opts.reuseView?.dataUrl,
            again: { reuseView: opts.reuseView, style, prompt },
          },
        ].slice(-MAX_TURNS),
      );
      const report = (s: RenderStage, snapshotUrl?: string) => {
        patch(snapshotUrl ? { stage: s, snapshotUrl } : { stage: s });
        onRenderProgress?.({ active: true, stage: s, snapshotUrl, modelLabel: tier.modelLabel });
      };
      try {
        report(first, opts.reuseView?.dataUrl);
        const ctx = getViewContext?.() ?? { interior: false, lensMm: 0 };
        let view = opts.reuseView;
        if (!view) {
          view = await captureViewForRender(getViewerHandle(), {
            frameBuilding: prefs.frameBuilding && !ctx.interior,
            frame: frameCrop(),
            viewKind: ctx.interior ? 'interior' : undefined,
            lensMm: ctx.interior ? ctx.lensMm : undefined,
            ceiling: ctx.interior ? prefs.ceiling : undefined,
          });
          lastPoseRef.current = poseKey(getViewerHandle());
          setMoved(false);
        }
        const captured = view;
        report({ key: 'capture', label: 'Your view is captured', progress: 0.06 }, captured.dataUrl);
        const res = await renderPhotoreal(captured, {
          style,
          tier: tierId,
          // Drawn furniture is rendered as it stands; the AI adds none of its own.
          furnish: (prefs.furnish || furnishFromText(prompt)) && furnitureSummary().pieces === 0,
          ceiling: prefs.ceiling,
          note: prompt,
          looks: looks.map((l) => l.url),
          signal: ac.signal,
          onStage: (s) => report(s, captured.dataUrl),
          debugSave: DEV_DEBUG_SAVE,
        });
        patch({ status: 'done', stage: null, result: res });
        // Show the finished render (a folded thread opens on it).
        setFolded(false);
        onFoldChange?.(false);
        onRenderComplete?.(res);
      } catch (e) {
        if (ac.signal.aborted) patch({ status: 'cancelled', stage: null });
        else {
          patch({
            status: 'error',
            stage: null,
            error: {
              message: e instanceof Error ? e.message : String(e),
              code: e instanceof RenderRequestError ? e.code : 'RENDER_FAILED',
            },
          });
          setFolded(false);
          onFoldChange?.(false);
        }
      } finally {
        abortRef.current = null;
        onRenderProgress?.({ active: false });
      }
    },
    [prefs, looks, getViewerHandle, onRenderProgress, onRenderComplete, getViewContext, frameCrop, onFoldChange],
  );

  const blocked = noScene || (status ? !status.ready : false);
  /** What a prompt renders now: the user's pick, else the last render's view unless the camera has moved since. */
  const targetNow = (): 'last' | 'current' => {
    if (!lastDone) return 'current';
    if (targetPick) return targetPick;
    const now = poseKey(getViewerHandle());
    return lastPoseRef.current && now && now !== lastPoseRef.current ? 'current' : 'last';
  };
  const submit = () => {
    if (running || blocked) return;
    const prompt = note.trim();
    void run({ prompt, reuseView: targetNow() === 'last' && lastDone ? lastDone.view : undefined });
    setNote('');
    if (noteRef.current) noteRef.current.style.height = '';
  };

  // A prompt from the main prompt bar: a follow-up keeps the last render's view
  // unless the camera has moved since, as in this thread.
  // A request made before this panel mounted (it remounts after the PRO editor) is not run again.
  const handledRequest = useRef(request?.id ?? 0);
  const targetNowRef = useRef(targetNow);
  targetNowRef.current = targetNow;
  useEffect(() => {
    if (!open || !request || request.id === handledRequest.current) return;
    handledRequest.current = request.id;
    if (abortRef.current || blocked) {
      setNote(request.text);
      return;
    }
    void run({ prompt: request.text, reuseView: targetNowRef.current() === 'last' && lastDone ? lastDone.view : undefined });
  }, [open, request, run, blocked, lastDone]);

  const tier = RENDER_TIERS[prefs.tier];
  const look = getRenderStyle(prefs.style);
  const frame = RENDER_FRAMES.find((f) => f.id === prefs.frame) ?? RENDER_FRAMES[0];
  const lensLabel = viewCtx.interior && viewCtx.lensMm ? `${Math.round(viewCtx.lensMm)} mm` : null;
  const budget = REFERENCE_BUDGET[prefs.tier];
  const clayLook = !!look.materials;
  const moreLooks = Object.values(RENDER_TIERS)
    .filter((t) => REFERENCE_BUDGET[t.id].looks > budget.looks)
    .map((t) => `${t.label} takes ${REFERENCE_BUDGET[t.id].looks}`)
    .join(', ');
  const lookNote = !looks.length
    ? null
    : clayLook
      ? 'Not used for the white Clay model.'
      : looks.length > budget.looks
        ? `${tier.label} uses the first ${budget.looks === 1 ? 'one' : budget.looks}${moreLooks ? `; ${moreLooks}` : ''}.`
        : null;
  const doneCount = turns.filter((t) => t.status === 'done').length;
  const runningTurn = turns.find((t) => t.status === 'running') ?? null;
  const runningPct = Math.round((runningTurn?.stage?.progress ?? 0) * 100);
  const largeTurn = large ? turns.find((t) => t.id === large.id && t.result) ?? null : null;
  const placeholder = lastDone ? (target === 'last' ? 'Change it, e.g. oak floor' : 'Describe this view') : 'Describe it, e.g. oak floor';

  const chip = (key: SettingsKey, label: React.ReactNode, title: string) => (
    <button
      type="button"
      className={`${styles.chip} ${settings === key ? styles.chipOn : ''}`}
      onClick={() => setSettings((s) => (s === key ? null : key))}
      aria-expanded={settings === key}
      title={title}
    >
      {label}
    </button>
  );

  return (
    <>
      {open && finder && (
        <div
          className={styles.viewfinder}
          style={{ left: finder.left + finder.x, top: finder.top + finder.y, width: finder.w, height: finder.h }}
          aria-hidden
        >
          <span className={styles.vfLabel}>
            {prefs.frame}
            {lensLabel ? ` · ${lensLabel}` : ''}
          </span>
        </div>
      )}
      {open && (
        <section ref={panelRef} className={`${styles.panel} ${folded ? styles.folded : ''}`} role="dialog" aria-label="Renders">
          <header className={styles.head}>
            <button
              type="button"
              className={styles.headMain}
              onClick={() => fold(!folded)}
              aria-expanded={!folded}
              title={folded ? 'Show the renders' : 'Fold to frame the shot'}
            >
              <span className={styles.headTitle}>
                Renders
                {doneCount > 0 && <span className={styles.count}>{doneCount}</span>}
              </span>
              <small>
                {folded && runningTurn
                  ? `${runningTurn.stage?.label ?? 'Rendering…'} ${runningPct}%`
                  : `${viewCtx.interior ? `Inside view${lensLabel ? ` · ${lensLabel} lens` : ''}` : 'Your exact view'} · walls, doors & windows stay locked`}
              </small>
            </button>
            <div className={styles.headBtns}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => fold(!folded)}
                aria-label={folded ? 'Show the renders' : 'Fold to frame the shot'}
                title={folded ? 'Show the renders' : 'Fold to frame the shot'}
              >
                {folded ? '▴' : '▾'}
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setOpen(false)}
                aria-label="Close"
                title={running ? 'Close (the render goes on; its progress shows in the prompt bar)' : 'Close'}
              >
                ✕
              </button>
            </div>
            {folded && runningTurn && (
              <span className={styles.headBar} aria-hidden>
                <span style={{ width: `${Math.max(3, runningPct)}%` }} />
              </span>
            )}
          </header>

          {!folded && (
            <div className={styles.thread} ref={threadRef} role="log" aria-live="polite" aria-label="Renders so far">
              {turns.length === 0 && (
                <div className={styles.intro}>
                  <p>
                    Frame your shot in the 3D view, pick a look, then <b>Render</b>. Every render stays here: try other looks of the same view,
                    or describe what to change.
                  </p>
                  {drawn.pieces > 0 && (
                    <p className={styles.furnished}>
                      <span aria-hidden>🪑</span>
                      <span>
                        {drawn.products > 0
                          ? `Furnished with ${drawn.products} product${drawn.products === 1 ? '' : 's'} from BOQ Flow`
                          : 'Furniture from the drawing'}{' '}
                        <small>({drawn.pieces} pieces, rendered where the drawing places them)</small>
                      </span>
                    </p>
                  )}
                </div>
              )}
              {turns.map((t) => (
                <TurnCard
                  key={t.id}
                  turn={t}
                  busy={running}
                  onCancel={() => abortRef.current?.abort()}
                  onAgain={() => void run(t.again)}
                  onLook={(style) => t.result && void run({ reuseView: t.result.view, style, prompt: t.prompt })}
                  onEnlarge={() => setLarge({ id: t.id, overlay: 'none' })}
                  onOpenSettings={onOpenSettings}
                />
              ))}
            </div>
          )}

          <footer className={styles.composer}>
            {noScene && <p className={styles.warn}>Build a model first: the 3D view is empty.</p>}
            {status && !status.ready && (
              <p className={styles.warn}>
                Rendering uses your own Gemini key.{' '}
                {onOpenSettings && (
                  <button type="button" className={styles.linkBtn} onClick={onOpenSettings}>
                    Add it in AI Studio
                  </button>
                )}
              </p>
            )}

            {settings && (
              <div className={styles.sheet} role="group" aria-label="Render settings">
                {settings === 'look' && (
                  <div className={styles.styleGrid}>
                    {RENDER_STYLES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`${styles.styleChip} ${prefs.style === s.id ? styles.active : ''}`}
                        onClick={() => {
                          setPrefs((p) => ({ ...p, style: s.id }));
                          setSettings(null);
                        }}
                        title={s.hint}
                      >
                        <span className={styles.styleIcon} aria-hidden>{s.icon}</span>
                        <span>{s.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                {settings === 'frame' && (
                  <>
                    <div className={styles.frameRow} role="radiogroup" aria-label="Frame">
                      {RENDER_FRAMES.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          role="radio"
                          aria-checked={prefs.frame === f.id}
                          className={`${styles.frameChip} ${prefs.frame === f.id ? styles.active : ''}`}
                          onClick={() => pickFrame(f.id)}
                          title={f.hint}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <p className={styles.hint}>
                      {prefs.frame === 'screen'
                        ? 'What you see, cropped to the nearest format. A fixed frame shows a viewfinder over the 3D view.'
                        : finder
                          ? 'Move the view to frame your shot: the render is exactly what is inside the frame.'
                          : 'Not enough room for the frame: fold the renders or turn the phone.'}
                    </p>
                  </>
                )}

                {settings === 'quality' && (
                  <>
                    <div className={styles.segment} role="radiogroup" aria-label="Quality">
                      {Object.values(RENDER_TIERS).map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="radio"
                          aria-checked={prefs.tier === t.id}
                          className={`${styles.segBtn} ${prefs.tier === t.id ? styles.active : ''}`}
                          onClick={() => setPrefs((p) => ({ ...p, tier: t.id }))}
                          title={`${t.modelLabel} · ${t.imageSize ?? ''}`}
                        >
                          <span>{t.label}</span>
                          <small>~${t.approxUsd.toFixed(2)}</small>
                        </button>
                      ))}
                    </div>
                    {prefs.tier === 'fast' && drawn.products > 0 && (
                      <p className={styles.hint}>
                        Products render truest on{' '}
                        <button type="button" className={styles.linkBtn} onClick={() => setPrefs((p) => ({ ...p, tier: 'balanced' }))}>
                          Balanced
                        </button>
                        : it takes up to {REFERENCE_BUDGET.balanced.products} product photos (Fast {REFERENCE_BUDGET.fast.products}).
                      </p>
                    )}
                    <p className={styles.meta}>
                      {tier.modelLabel} · {tier.imageSize} · about {tier.etaSec}s · ~${tier.approxUsd.toFixed(2)}
                      {status?.providerLabel ? ` · ${status.providerLabel}` : ''}
                    </p>
                  </>
                )}

                {settings === 'refs' && (
                  <>
                    <p className={styles.hint}>Pictures of materials and mood the render follows, never their layout.</p>
                    <div className={styles.lookRow}>
                      {looks.map((l, i) => (
                        <figure key={l.id} className={`${styles.lookThumb} ${i >= budget.looks || clayLook ? styles.lookIdle : ''}`} title={l.name}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={l.url} alt={`Look reference ${i + 1}`} />
                          <button
                            type="button"
                            className={styles.lookRemove}
                            onClick={() => setLooks((old) => old.filter((x) => x.id !== l.id))}
                            aria-label={`Remove look reference ${i + 1}`}
                          >
                            ✕
                          </button>
                        </figure>
                      ))}
                      {looks.length < MAX_LOOK_REFERENCES && (
                        <button type="button" className={styles.lookAdd} onClick={() => lookInputRef.current?.click()}>
                          <span aria-hidden>＋</span>
                          <small>Add picture</small>
                        </button>
                      )}
                    </div>
                    {lookNote && <p className={styles.hint}>{lookNote}</p>}
                    {lookError && <p className={styles.warn}>{lookError}</p>}
                  </>
                )}

                {settings === 'more' && (
                  <>
                    {drawn.pieces > 0 ? (
                      <p className={styles.furnished}>
                        <span aria-hidden>🪑</span>
                        <span>
                          {drawn.products > 0
                            ? `Furnished with ${drawn.products} product${drawn.products === 1 ? '' : 's'} from BOQ Flow`
                            : 'Furniture from the drawing'}{' '}
                          <small>({drawn.pieces} pieces, rendered where the drawing places them)</small>
                        </span>
                      </p>
                    ) : (
                      <label className={styles.toggle}>
                        <input type="checkbox" checked={prefs.furnish} onChange={(e) => setPrefs((p) => ({ ...p, furnish: e.target.checked }))} />
                        <span className={styles.switch} aria-hidden />
                        <span>
                          Furnish rooms <small>(AI-placed furniture; walls stay locked)</small>
                        </span>
                      </label>
                    )}
                    {viewCtx.interior && (
                      <label className={styles.toggle}>
                        <input type="checkbox" checked={prefs.ceiling} onChange={(e) => setPrefs((p) => ({ ...p, ceiling: e.target.checked }))} />
                        <span className={styles.switch} aria-hidden />
                        <span>
                          Add a ceiling <small>(plain, on top of the walls: the model has none)</small>
                        </span>
                      </label>
                    )}
                    {!viewCtx.interior && prefs.frame === 'screen' && (
                      <label className={styles.toggle}>
                        <input
                          type="checkbox"
                          checked={prefs.frameBuilding}
                          onChange={(e) => setPrefs((p) => ({ ...p, frameBuilding: e.target.checked }))}
                        />
                        <span className={styles.switch} aria-hidden />
                        <span>
                          Frame the building <small>(same angle, more detail on walls &amp; openings)</small>
                        </span>
                      </label>
                    )}
                  </>
                )}
              </div>
            )}

            <div className={styles.chips} role="toolbar" aria-label="Render settings">
              {chip('look', <><span aria-hidden>{look.icon}</span> {look.label}</>, 'Look: light and mood')}
              {chip('frame', <>⛶ {frame.label}</>, 'Frame: the shape of the render')}
              {chip('quality', <>{tier.label} · ~${tier.approxUsd.toFixed(2)}</>, `Quality: ${tier.modelLabel}`)}
              {onProjectionChange && !viewCtx.interior && (
                <button
                  type="button"
                  className={`${styles.chip} ${projection === 'parallel' ? styles.chipOn : ''}`}
                  onClick={() => {
                    const p: Projection = projection === 'parallel' ? 'perspective' : 'parallel';
                    setProjection(p);
                    onProjectionChange(p);
                  }}
                  aria-pressed={projection === 'parallel'}
                  title={projection === 'parallel' ? 'Isometric: parallel, every edge stays true. Tap for perspective.' : 'Perspective, as you see it. Tap for an isometric view.'}
                >
                  {projection === 'parallel' ? '◇ Isometric' : '◇ Perspective'}
                </button>
              )}
              {chip('refs', <>🖼 {looks.length ? `${looks.length} reference${looks.length === 1 ? '' : 's'}` : 'References'}</>, 'Look references: materials and mood')}
              {chip('more', <>⚙ More</>, 'Furnishing, ceiling and framing')}
            </div>

            {lastDone && (
              <div className={styles.target} role="radiogroup" aria-label="What to render">
                <button
                  type="button"
                  role="radio"
                  aria-checked={target === 'last'}
                  className={`${styles.targetBtn} ${target === 'last' ? styles.targetOn : ''}`}
                  onClick={() => setTargetPick('last')}
                  title="Render the last render's view again, with your changes"
                >
                  ↻ Same view as the last
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={target === 'current'}
                  className={`${styles.targetBtn} ${target === 'current' ? styles.targetOn : ''}`}
                  onClick={() => setTargetPick('current')}
                  title="Render the view in the camera now"
                >
                  📷 This view{moved ? ' (moved)' : ''}
                </button>
              </div>
            )}

            <div className={styles.inputRow}>
              <textarea
                ref={noteRef}
                className={styles.input}
                rows={1}
                maxLength={400}
                aria-label="Describe the render"
                placeholder={placeholder}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  // Grows with the text up to four lines, then scrolls.
                  const el = e.target;
                  el.style.height = '';
                  el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
                  el.style.overflowY = el.scrollHeight > 96 ? 'auto' : 'hidden';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <button type="button" className={styles.send} onClick={submit} disabled={running || blocked} title="Render (Enter)">
                {running ? (
                  <>
                    <span className={styles.spinner} aria-hidden /> {runningPct}%
                  </>
                ) : (
                  <>
                    <span aria-hidden>✨</span> Render
                  </>
                )}
              </button>
            </div>
            <input
              ref={lookInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={(e) => {
                void addLooks(e.target.files);
                e.target.value = '';
              }}
            />
          </footer>
        </section>
      )}

      {largeTurn?.result && large && (
        <div className={styles.lightbox} role="dialog" aria-label="Render comparison" onClick={() => setLarge(null)}>
          <div className={styles.lightboxInner} onClick={(e) => e.stopPropagation()}>
            <CompareSlider
              before={largeTurn.result.view.dataUrl}
              after={largeTurn.result.imageUrl}
              overlay={
                large.overlay === 'depth-mesh' && largeTurn.result.view.depthMeshOverlayUrl
                  ? largeTurn.result.view.depthMeshOverlayUrl
                  : largeTurn.result.view.edgeOverlayUrl
              }
              showOverlay={large.overlay !== 'none'}
              aspect={`${largeTurn.result.view.width} / ${largeTurn.result.view.height}`}
              className={styles.compareLarge}
              frameStyle={{ width: `min(100%, calc((100vh - 140px) * ${(largeTurn.result.view.width / largeTurn.result.view.height).toFixed(4)}))` }}
            />
            <div className={styles.lightboxBar}>
              <div className={styles.row}>
                <label className={styles.inlineToggle}>
                  <input
                    type="checkbox"
                    checked={large.overlay === 'lines'}
                    onChange={(e) => setLarge((l) => (l ? { ...l, overlay: e.target.checked ? 'lines' : 'none' } : l))}
                  />
                  Show model lines
                </label>
                {largeTurn.result.view.depthMeshOverlayUrl && (
                  <label className={styles.inlineToggle}>
                    <input
                      type="checkbox"
                      checked={large.overlay === 'depth-mesh'}
                      onChange={(e) => setLarge((l) => (l ? { ...l, overlay: e.target.checked ? 'depth-mesh' : 'none' } : l))}
                    />
                    Show depth &amp; mesh
                  </label>
                )}
              </div>
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => {
                    const r = largeTurn.result;
                    if (r) downloadDataUrl(r.imageUrl, r.mimeType, `photoreal-${r.style}-${r.renderId}`);
                  }}
                >
                  Download
                </button>
                <button type="button" className={styles.secondary} onClick={() => setLarge(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** One render in the thread: its prompt, then the render as it runs, finishes or fails. */
function TurnCard({
  turn: t,
  busy,
  onCancel,
  onAgain,
  onLook,
  onEnlarge,
  onOpenSettings,
}: {
  turn: Turn;
  busy: boolean;
  onCancel: () => void;
  onAgain: () => void;
  onLook: (style: RenderStyleId) => void;
  onEnlarge: () => void;
  onOpenSettings?: () => void;
}) {
  const look = getRenderStyle(t.style);
  const tier = RENDER_TIERS[t.tier];
  const r = t.result;
  const pct = Math.round((t.stage?.progress ?? 0) * 100);
  const grade = r ? fidelityGrade(r.fidelity.score) : null;
  const settingsHint = t.error && /PROVIDER_NOT_CONFIGURED|RATE_LIMIT|AUTH|MODEL_UNAVAILABLE/.test(t.error.code);
  return (
    <article className={styles.turn}>
      {t.prompt && <p className={styles.prompt}>{t.prompt}</p>}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span>
            {look.icon} {look.label} · {tier.label}
            {t.sameView ? ' · same view' : ''}
          </span>
          {r && (
            <span
              className={`${styles.badge} ${grade === 'good' ? styles.good : grade === 'fair' ? styles.fair : styles.poor}`}
              title="Share of your model's wall, door and window edges found in the same place in the render"
            >
              {Math.round(r.fidelity.score * 100)}% match
            </span>
          )}
        </div>

        {t.status === 'running' && (
          <>
            <div className={styles.pending} aria-live="polite">
              {t.snapshotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.pendingImg} src={t.snapshotUrl} alt="Your view, being rendered" />
              ) : (
                <div className={styles.pendingBlank} />
              )}
              <div className={styles.pendingOverlay}>
                <div className={styles.progressTrack}>
                  <div className={styles.progressFill} style={{ width: `${Math.max(3, pct)}%` }} />
                </div>
                <div className={styles.progressRow}>
                  <span>{t.stage?.label ?? 'Starting…'}</span>
                  <span>{pct}%</span>
                </div>
              </div>
            </div>
            <div className={styles.cardActions}>
              <button type="button" className={styles.secondary} onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        )}

        {t.status === 'done' && r && (
          <>
            <button type="button" className={styles.shot} onClick={onEnlarge} aria-label="Enlarge and compare with the 3D model">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.imageUrl} alt={`Render: ${look.label}`} style={{ aspectRatio: `${r.view.width} / ${r.view.height}` }} />
              <span className={styles.shotHint} aria-hidden>⤢ Compare</span>
            </button>
            {r.fidelity.outside > OUTSIDE_OK && <p className={styles.warn}>This render added structure outside your model: try again for a clean match.</p>}
            {(r.fidelity.shift.dx !== 0 || r.fidelity.shift.dy !== 0) && (
              <p className={styles.warn}>The camera shifted slightly in this render: try again for a tighter match.</p>
            )}
            <div className={styles.cardActions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => downloadDataUrl(r.imageUrl, r.mimeType, `photoreal-${r.style}-${r.renderId}`)}
              >
                Download
              </button>
              <button type="button" className={styles.secondary} onClick={onEnlarge}>
                Compare
              </button>
              <button type="button" className={styles.secondary} onClick={onAgain} disabled={busy} title="Render this view again with the same look">
                Again
              </button>
            </div>
            <div className={styles.variations} role="group" aria-label="Other looks of this view">
              {RENDER_STYLES.filter((s) => s.id !== t.style).map((s) => (
                <button key={s.id} type="button" className={styles.miniChip} onClick={() => onLook(s.id)} disabled={busy} title={`${s.label}, same view`}>
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
            <p className={styles.meta}>
              {r.modelLabel} · {(r.elapsedMs / 1000).toFixed(1)}s
              {r.attempts > 1 ? ` · ${r.attempts} attempts` : ''} · ~${r.approxUsd.toFixed(2)}
              {r.looks ? ` · ${r.looks} look reference${r.looks === 1 ? '' : 's'}` : ''}
            </p>
          </>
        )}

        {t.status === 'error' && t.error && (
          <>
            <p className={styles.error}>{t.error.message}</p>
            <div className={styles.cardActions}>
              <button type="button" className={styles.primary} onClick={onAgain} disabled={busy}>
                Try again
              </button>
              {settingsHint && onOpenSettings && (
                <button type="button" className={styles.secondary} onClick={onOpenSettings}>
                  AI Studio
                </button>
              )}
            </div>
          </>
        )}

        {t.status === 'cancelled' && (
          <p className={styles.meta}>
            Cancelled.{' '}
            <button type="button" className={styles.linkBtn} onClick={onAgain} disabled={busy}>
              Render it again
            </button>
          </p>
        )}
      </div>
    </article>
  );
}

export default RenderStudio;
