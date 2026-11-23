// features/render/RenderStudio.tsx
// One-click photoreal render of the current 3D view. The ✨ Render button in the
// Copilot bar opens this panel: pick a look, press Render. The exact view is captured, rendered
// by the image model under a geometry lock, scored against the model's edges
// and shown with a before/after slider. Results also go to Copilot Activity.
// A fixed frame (16:9, 3:2, …) shows a viewfinder over the 3D view, and the
// render is exactly what is inside it; inside views (walk mode) tell the model
// the lens and let it close the open-top rooms with a ceiling.
'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewerHandle } from 'design-build-simplified-viewer-shell';
import {
  RENDER_FRAMES,
  RENDER_STYLES,
  RENDER_TIERS,
  frameAspect,
  isRenderFrame,
  viewfinderRect,
  type RenderFrameId,
  type RenderStyleId,
  type RenderTierId,
} from './render-presets';
import { captureViewForRender, furnitureSummary, hasRenderableScene, type FrameCrop, type PreparedView } from './capture-view';
import type { ViewArea } from '../viewer-interaction/view-navigator';
import { renderPhotoreal, renderStatus, RenderRequestError, type RenderJobResult, type RenderStage } from './render-client';
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
}

type Phase = 'form' | 'running' | 'result' | 'error';

const PREFS_KEY = 'db.render.prefs.v1';

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

function downloadDataUrl(url: string, mime: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.${mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
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
}: RenderStudioProps) {
  const setOpen = onOpenChange;
  const [phase, setPhase] = useState<Phase>('form');
  const [prefs, setPrefs] = useState<Prefs>({ style: 'daylight', tier: 'fast', furnish: false, frameBuilding: true, frame: 'screen', ceiling: true });
  const [viewCtx, setViewCtx] = useState<{ interior: boolean; lensMm: number }>({ interior: false, lensMm: 0 });
  /** Phones: fold the panel to a slim bar so the viewfinder gets the screen. */
  const [compact, setCompact] = useState(false);
  /** Viewfinder rectangle, in canvas pixels (left/top relative to the canvas). */
  const [finder, setFinder] = useState<{ x: number; y: number; w: number; h: number; cw: number; ch: number; left: number; top: number } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [note, setNote] = useState('');
  const [stage, setStage] = useState<RenderStage | null>(null);
  const [result, setResult] = useState<RenderJobResult | null>(null);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [status, setStatus] = useState<{ ready: boolean; providerLabel: string | null } | null>(null);
  const [showLines, setShowLines] = useState(false);
  const [large, setLarge] = useState(false);
  const [noScene, setNoScene] = useState(false);
  /** Furniture placed from the drawing (and BOQ Flow products on it): the render shows that, not AI furniture. */
  const [drawn, setDrawn] = useState<{ pieces: number; products: number }>({ pieces: 0, products: 0 });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setPrefs(loadRenderPrefs()), []);
  useEffect(() => savePrefs(prefs), [prefs]);

  useEffect(() => {
    if (!open) return;
    // A fixed frame on a phone: start folded so the viewfinder has room.
    try {
      if (loadRenderPrefs().frame !== 'screen' && window.matchMedia('(max-width: 720px)').matches) setCompact(true);
    } catch {
      /* no matchMedia */
    }
    setNoScene(!hasRenderableScene(getViewerHandle()));
    setDrawn(furnitureSummary());
    void renderStatus().then(setStatus);
    setViewCtx(getViewContext?.() ?? { interior: false, lensMm: 0 });
    const id = window.setInterval(() => {
      const c = getViewContext?.();
      if (c) setViewCtx((old) => (old.interior === c.interior && Math.round(old.lensMm) === Math.round(c.lensMm) ? old : c));
    }, 500);
    return () => window.clearInterval(id);
  }, [open, getViewerHandle, getViewContext]);

  // Viewfinder: the largest frame of the chosen format in the free part of the
  // 3D view, clear of this panel. The render is exactly what is inside it.
  const measureFinder = useCallback(() => {
    const aspect = frameAspect(prefs.frame);
    const canvas = (getViewerHandle()?.gl as { domElement?: HTMLCanvasElement } | undefined)?.domElement;
    if (!open || !aspect || !canvas || !getFreeArea || (phase !== 'form' && phase !== 'running')) {
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
      const b = pr.bottom - cr.top;
      if (pr.width > area.width * 0.55) y0 = Math.max(y0, b + 10);
      else if ((l + r) / 2 > area.width / 2) x1 = Math.min(x1, l - 12);
      else x0 = Math.max(x0, r + 12);
    }
    const rect = viewfinderRect({ x0, y0, x1, y1 }, aspect.ratio);
    setFinder(rect ? { ...rect, cw: cr.width, ch: cr.height, left: cr.left, top: cr.top } : null);
  }, [open, prefs.frame, phase, getFreeArea, getViewerHandle]);

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
  }, [open, measureFinder, compact]);

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
    // On a phone, fold the panel so the viewfinder has room.
    try {
      if (frame !== 'screen' && window.matchMedia('(max-width: 720px)').matches) setCompact(true);
    } catch {
      /* no matchMedia */
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (large) setLarge(false);
      else if (open && phase !== 'running') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase, large, setOpen]);

  const run = useCallback(
    async (opts?: { reuseView?: PreparedView; style?: RenderStyleId }) => {
      const style = opts?.style ?? prefs.style;
      if (opts?.style) setPrefs((p) => ({ ...p, style }));
      const tier = RENDER_TIERS[prefs.tier];
      const ac = new AbortController();
      abortRef.current = ac;
      setError(null);
      setPhase('running');
      const report = (s: RenderStage, snapshotUrl?: string) => {
        setStage(s);
        onRenderProgress?.({ active: true, stage: s, snapshotUrl, modelLabel: tier.modelLabel });
      };
      try {
        report({ key: 'capture', label: 'Capturing your exact 3D view…', progress: 0.03 });
        const ctx = getViewContext?.() ?? { interior: false, lensMm: 0 };
        const view =
          opts?.reuseView ??
          (await captureViewForRender(getViewerHandle(), {
            frameBuilding: prefs.frameBuilding && !ctx.interior,
            frame: frameCrop(),
            viewKind: ctx.interior ? 'interior' : undefined,
            lensMm: ctx.interior ? ctx.lensMm : undefined,
            ceiling: ctx.interior ? prefs.ceiling : undefined,
          }));
        const res = await renderPhotoreal(view, {
          style,
          tier: prefs.tier,
          // Drawn furniture is rendered as it stands; the AI adds none of its own.
          furnish: prefs.furnish && furnitureSummary().pieces === 0,
          ceiling: prefs.ceiling,
          note,
          signal: ac.signal,
          onStage: (s) => report(s, view.dataUrl),
          debugSave: DEV_DEBUG_SAVE,
        });
        setResult(res);
        setShowLines(false);
        setPhase('result');
        onRenderComplete?.(res);
      } catch (e) {
        if (ac.signal.aborted) {
          setPhase(result ? 'result' : 'form');
        } else {
          setError({
            message: e instanceof Error ? e.message : String(e),
            code: e instanceof RenderRequestError ? e.code : 'RENDER_FAILED',
          });
          setPhase('error');
        }
      } finally {
        abortRef.current = null;
        onRenderProgress?.({ active: false });
      }
    },
    [prefs, note, getViewerHandle, onRenderProgress, onRenderComplete, result, getViewContext, frameCrop],
  );

  const tier = RENDER_TIERS[prefs.tier];
  const pct = Math.round((stage?.progress ?? 0) * 100);
  const grade = result ? fidelityGrade(result.fidelity.score) : null;
  const settingsHint = error && /PROVIDER_NOT_CONFIGURED|RATE_LIMIT|AUTH|MODEL_UNAVAILABLE/.test(error.code);

  const lensLabel = viewCtx.interior && viewCtx.lensMm ? `${Math.round(viewCtx.lensMm)} mm` : null;
  const showCompact = compact && phase === 'form';

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
        <section ref={panelRef} className={`${styles.panel} ${showCompact ? styles.compact : ''}`} role="dialog" aria-label="Photoreal render">
          <header className={styles.head}>
            <div>
              <strong>Photoreal render</strong>
              <small>
                {viewCtx.interior ? `Inside view${lensLabel ? ` · ${lensLabel} lens` : ''}` : 'Your exact view'} · walls, doors &amp; windows stay locked
              </small>
            </div>
            <div className={styles.headBtns}>
              {phase === 'form' && (
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => setCompact((c) => !c)}
                  aria-label={showCompact ? 'Show all render options' : 'Fold the panel to frame the shot'}
                  title={showCompact ? 'Show all options' : 'Fold the panel to frame the shot'}
                >
                  {showCompact ? '▾' : '▴'}
                </button>
              )}
              <button type="button" className={styles.iconBtn} onClick={() => setOpen(false)} aria-label="Close" disabled={phase === 'running'}>
                ✕
              </button>
            </div>
          </header>

          {phase === 'form' && (
            <div className={styles.body}>
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

              <div className={styles.label}>Frame</div>
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
              {prefs.frame !== 'screen' && (
                <p className={styles.hint}>
                  {finder ? 'Move the view to frame your shot: the render is exactly what is inside the frame.' : 'Not enough room for the frame: fold the panel or turn the phone.'}
                </p>
              )}

              {!showCompact && (
              <>
              <div className={styles.label}>Look</div>
              <div className={styles.styleGrid}>
                {RENDER_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`${styles.styleChip} ${prefs.style === s.id ? styles.active : ''}`}
                    onClick={() => setPrefs((p) => ({ ...p, style: s.id }))}
                    title={s.hint}
                  >
                    <span className={styles.styleIcon} aria-hidden>{s.icon}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>

              <div className={styles.label}>Quality</div>
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
                  <input
                    type="checkbox"
                    checked={prefs.furnish}
                    onChange={(e) => setPrefs((p) => ({ ...p, furnish: e.target.checked }))}
                  />
                  <span className={styles.switch} aria-hidden />
                  <span>
                    Furnish rooms <small>(AI-placed furniture; walls stay locked)</small>
                  </span>
                </label>
              )}

              {viewCtx.interior && (
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={prefs.ceiling}
                    onChange={(e) => setPrefs((p) => ({ ...p, ceiling: e.target.checked }))}
                  />
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

              <textarea
                className={styles.note}
                rows={2}
                maxLength={400}
                placeholder="Optional: e.g. polished concrete floors, black window frames"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void run();
                }}
              />
              </>
              )}

              <button type="button" className={styles.primary} onClick={() => void run()} disabled={noScene || (status ? !status.ready : false)}>
                Render this view
              </button>
              {!showCompact && (
                <p className={styles.meta}>
                  {tier.modelLabel} · {tier.imageSize} · about {tier.etaSec}s · ~${tier.approxUsd.toFixed(2)}
                  {status?.providerLabel ? ` · ${status.providerLabel}` : ''}
                </p>
              )}
            </div>
          )}

          {phase === 'running' && (
            <div className={styles.body}>
              <div className={styles.progress} aria-live="polite">
                <div className={styles.progressTrack}>
                  <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                </div>
                <div className={styles.progressRow}>
                  <span>{stage?.label ?? 'Starting…'}</span>
                  <span>{pct}%</span>
                </div>
              </div>
              <button type="button" className={styles.secondary} onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            </div>
          )}

          {phase === 'error' && error && (
            <div className={styles.body}>
              <p className={styles.error}>{error.message}</p>
              <div className={styles.row}>
                <button type="button" className={styles.primary} onClick={() => void run()}>
                  Try again
                </button>
                {settingsHint && onOpenSettings && (
                  <button type="button" className={styles.secondary} onClick={onOpenSettings}>
                    Provider settings
                  </button>
                )}
                <button type="button" className={styles.secondary} onClick={() => setPhase('form')}>
                  Back
                </button>
              </div>
            </div>
          )}

          {phase === 'result' && result && (
            <div className={styles.body}>
              <CompareSlider
                before={result.view.dataUrl}
                after={result.imageUrl}
                overlay={result.view.edgeOverlayUrl}
                showOverlay={showLines}
                aspect={`${result.view.width} / ${result.view.height}`}
              />
              <div className={styles.resultRow}>
                <span
                  className={`${styles.badge} ${grade === 'good' ? styles.good : grade === 'fair' ? styles.fair : styles.poor}`}
                  title="Share of your model's wall, door and window edges found in the same place in the render"
                >
                  Geometry match {Math.round(result.fidelity.score * 100)}%
                </span>
                <label className={styles.inlineToggle}>
                  <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} />
                  Show model lines
                </label>
              </div>
              {result.fidelity.outside > OUTSIDE_OK && (
                <p className={styles.warn}>This render added structure outside your model — regenerate for a clean match.</p>
              )}
              {(result.fidelity.shift.dx !== 0 || result.fidelity.shift.dy !== 0) && (
                <p className={styles.warn}>The camera shifted slightly in this render — regenerate for a tighter match.</p>
              )}
              <p className={styles.meta}>
                {result.modelLabel} · {(result.elapsedMs / 1000).toFixed(1)}s
                {result.attempts > 1 ? ` · ${result.attempts} attempts` : ''} · ~${result.approxUsd.toFixed(2)}
              </p>
              <div className={styles.label}>Try another look (same view)</div>
              <div className={styles.styleRow}>
                {RENDER_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`${styles.miniChip} ${result.style === s.id ? styles.active : ''}`}
                    onClick={() => void run({ reuseView: result.view, style: s.id })}
                    title={s.label}
                  >
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => downloadDataUrl(result.imageUrl, result.mimeType, `photoreal-${result.style}-${result.renderId}`)}
                >
                  Download
                </button>
                <button type="button" className={styles.secondary} onClick={() => void run({ reuseView: result.view })}>
                  Regenerate
                </button>
                <button type="button" className={styles.secondary} onClick={() => setLarge(true)}>
                  Enlarge
                </button>
                <button type="button" className={styles.secondary} onClick={() => setPhase('form')}>
                  New view
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {large && result && (
        <div className={styles.lightbox} role="dialog" aria-label="Render comparison" onClick={() => setLarge(false)}>
          <div className={styles.lightboxInner} onClick={(e) => e.stopPropagation()}>
            <CompareSlider
              before={result.view.dataUrl}
              after={result.imageUrl}
              overlay={result.view.edgeOverlayUrl}
              showOverlay={showLines}
              aspect={`${result.view.width} / ${result.view.height}`}
              className={styles.compareLarge}
              frameStyle={{ width: `min(100%, calc((100vh - 140px) * ${(result.view.width / result.view.height).toFixed(4)}))` }}
            />
            <div className={styles.lightboxBar}>
              <label className={styles.inlineToggle}>
                <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} />
                Show model lines
              </label>
              <button type="button" className={styles.secondary} onClick={() => setLarge(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default RenderStudio;
