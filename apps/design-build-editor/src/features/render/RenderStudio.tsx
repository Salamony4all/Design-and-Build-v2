// features/render/RenderStudio.tsx
// One-click photoreal render of the current 3D view. The ✨ Render button in the
// Copilot bar opens this panel: pick a look, press Render. The exact view is captured, rendered
// by the image model under a geometry lock, scored against the model's edges
// and shown with a before/after slider. Results also go to Copilot Activity.
'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewerHandle } from 'design-build-simplified-viewer-shell';
import { RENDER_STYLES, RENDER_TIERS, type RenderStyleId, type RenderTierId } from './render-presets';
import { captureViewForRender, hasRenderableScene, type PreparedView } from './capture-view';
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
}

type Phase = 'form' | 'running' | 'result' | 'error';

const PREFS_KEY = 'db.render.prefs.v1';

interface Prefs {
  style: RenderStyleId;
  tier: RenderTierId;
  furnish: boolean;
  /** Crop to the building (more pixels on walls and openings) instead of the full frame. */
  frameBuilding: boolean;
}

export function loadRenderPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return {
      style: RENDER_STYLES.some((s) => s.id === p.style) ? (p.style as RenderStyleId) : 'daylight',
      tier: p.tier && p.tier in RENDER_TIERS ? p.tier : 'fast',
      furnish: !!p.furnish,
      frameBuilding: p.frameBuilding !== false,
    };
  } catch {
    return { style: 'daylight', tier: 'fast', furnish: false, frameBuilding: true };
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

export function RenderStudio({ open, onOpenChange, getViewerHandle, onOpenSettings, onRenderProgress, onRenderComplete }: RenderStudioProps) {
  const setOpen = onOpenChange;
  const [phase, setPhase] = useState<Phase>('form');
  const [prefs, setPrefs] = useState<Prefs>({ style: 'daylight', tier: 'fast', furnish: false, frameBuilding: true });
  const [note, setNote] = useState('');
  const [stage, setStage] = useState<RenderStage | null>(null);
  const [result, setResult] = useState<RenderJobResult | null>(null);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [status, setStatus] = useState<{ ready: boolean; providerLabel: string | null } | null>(null);
  const [showLines, setShowLines] = useState(false);
  const [large, setLarge] = useState(false);
  const [noScene, setNoScene] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setPrefs(loadRenderPrefs()), []);
  useEffect(() => savePrefs(prefs), [prefs]);

  useEffect(() => {
    if (!open) return;
    setNoScene(!hasRenderableScene(getViewerHandle()));
    void renderStatus().then(setStatus);
  }, [open, getViewerHandle]);

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
        const view = opts?.reuseView ?? (await captureViewForRender(getViewerHandle(), { frameBuilding: prefs.frameBuilding }));
        const res = await renderPhotoreal(view, {
          style,
          tier: prefs.tier,
          furnish: prefs.furnish,
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
    [prefs, note, getViewerHandle, onRenderProgress, onRenderComplete, result],
  );

  const tier = RENDER_TIERS[prefs.tier];
  const pct = Math.round((stage?.progress ?? 0) * 100);
  const grade = result ? fidelityGrade(result.fidelity.score) : null;
  const settingsHint = error && /PROVIDER_NOT_CONFIGURED|RATE_LIMIT|AUTH|MODEL_UNAVAILABLE/.test(error.code);

  return (
    <>
      {open && (
        <section className={styles.panel} role="dialog" aria-label="Photoreal render">
          <header className={styles.head}>
            <div>
              <strong>Photoreal render</strong>
              <small>Your exact view · walls, doors &amp; windows stay locked</small>
            </div>
            <button type="button" className={styles.iconBtn} onClick={() => setOpen(false)} aria-label="Close" disabled={phase === 'running'}>
              ✕
            </button>
          </header>

          {phase === 'form' && (
            <div className={styles.body}>
              {noScene && <p className={styles.warn}>Build or load a model first — there is nothing in the 3D view yet.</p>}
              {status && !status.ready && (
                <p className={styles.warn}>
                  No Gemini key is set up for rendering.{' '}
                  {onOpenSettings && (
                    <button type="button" className={styles.linkBtn} onClick={onOpenSettings}>
                      Open provider settings
                    </button>
                  )}
                </p>
              )}

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

              <button type="button" className={styles.primary} onClick={() => void run()} disabled={noScene || (status ? !status.ready : false)}>
                Render this view
              </button>
              <p className={styles.meta}>
                {tier.modelLabel} · {tier.imageSize} · about {tier.etaSec}s · ~${tier.approxUsd.toFixed(2)}
                {status?.providerLabel ? ` · ${status.providerLabel}` : ''}
              </p>
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
