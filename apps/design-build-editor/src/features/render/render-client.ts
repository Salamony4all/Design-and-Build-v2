// features/render/render-client.ts
// Browser orchestration of one photoreal render: send the prepared view to
// /api/render, score the result against the model's edges, and re-render once
// with a stricter lock (plus the edge guide) when the geometry drifted.

import { RENDER_TIERS, type RenderStyleId, type RenderTierId } from './render-presets';
import { OUTSIDE_OK, fidelityGrade, scoreRenderFidelity, type FidelityReport } from './geometry-fidelity';
import type { PreparedView } from './capture-view';

export type RenderStageKey = 'capture' | 'send' | 'render' | 'check' | 'retry' | 'done';

export interface RenderStage {
  key: RenderStageKey;
  label: string;
  /** 0..1 */
  progress: number;
}

export interface RenderJobOptions {
  style: RenderStyleId;
  tier: RenderTierId;
  furnish: boolean;
  note?: string;
  /**
   * Floor-plan reference (sent only when furnishing). Not used by the app: an
   * unaligned whole plan made the model add rooms that are outside the view.
   */
  planDataUrl?: string;
  /** Send the edge map with the first attempt too (the retry always sends it). */
  edgeGuideFirst?: boolean;
  autoRetry?: boolean;
  /** Below this score the render is retried once. */
  minScore?: number;
  signal?: AbortSignal;
  onStage?: (s: RenderStage) => void;
  /** Dev only: the server keeps input/output under .data/render-debug. */
  debugSave?: boolean;
}

export interface RenderJobResult {
  renderId: string;
  imageUrl: string;
  mimeType: string;
  view: PreparedView;
  planDataUrl?: string;
  model: string;
  modelLabel: string;
  tier: RenderTierId;
  style: RenderStyleId;
  fidelity: FidelityReport;
  attempts: number;
  elapsedMs: number;
  approxUsd: number;
}

export class RenderRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = 'RenderRequestError';
  }
}

interface ApiOk {
  ok: true;
  renderId: string;
  image: string;
  mimeType: string;
  model: string;
  modelLabel: string;
  ms: number;
}

interface ApiErr {
  ok: false;
  code: string;
  error: string;
}

export async function renderStatus(): Promise<{ ready: boolean; providerLabel: string | null }> {
  try {
    const r = await fetch('/api/render', { cache: 'no-store' });
    const j = (await r.json()) as { ready?: boolean; providerLabel?: string | null };
    return { ready: !!j.ready, providerLabel: j.providerLabel ?? null };
  } catch {
    return { ready: false, providerLabel: null };
  }
}

/** Dev only: `window.__dbRenderDryRun = true` exercises the whole flow without a model call. */
function devDryRun(): boolean {
  return process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && (window as unknown as { __dbRenderDryRun?: boolean }).__dbRenderDryRun === true;
}

/** Dev dry run: make the echoed view look "rendered" (tint, blur, grain) so the geometry check has work to do. */
async function simulateRender(url: string): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) return url;
  ctx.filter = 'sepia(0.45) saturate(1.3) contrast(1.08) blur(0.8px)';
  ctx.drawImage(img, 0, 0);
  ctx.filter = 'none';
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    d.data[i] += n;
    d.data[i + 1] += n;
    d.data[i + 2] += n;
  }
  ctx.putImageData(d, 0, 0);
  return c.toDataURL('image/jpeg', 0.9);
}

async function postRender(
  view: PreparedView,
  o: RenderJobOptions,
  attempt: number,
  strict: boolean,
  withEdges: boolean,
): Promise<ApiOk> {
  const res = await fetch('/api/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: o.signal,
    body: JSON.stringify({
      image: view.dataUrl,
      ...(withEdges ? { edgeGuide: view.edgeGuideUrl } : {}),
      ...(o.furnish && o.planDataUrl ? { plan: o.planDataUrl } : {}),
      style: o.style,
      tier: o.tier,
      aspectRatio: view.aspect.label,
      viewKind: view.viewKind,
      furnish: o.furnish,
      note: o.note,
      strict,
      attempt,
      ...(o.debugSave ? { debugSave: true } : {}),
      ...(devDryRun() ? { dryRun: true } : {}),
    }),
  });
  const j = (await res.json().catch(() => ({ ok: false, code: 'RENDER_BAD_RESPONSE', error: `Render failed (${res.status}).` }))) as ApiOk | ApiErr;
  if (!res.ok || !j.ok) {
    const e = j as ApiErr;
    throw new RenderRequestError(e.error || `Render failed (${res.status}).`, e.code || 'RENDER_FAILED', res.status);
  }
  if (j.model === 'dry-run') j.image = await simulateRender(j.image);
  return j;
}

/** Eases towards `cap` while the model works, so the bar keeps moving honestly. */
function pacer(o: RenderJobOptions, from: number, cap: number, etaSec: number, label: string) {
  const t0 = performance.now();
  const id = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    const p = from + (cap - from) * (1 - Math.exp(-t / Math.max(2, etaSec * 0.6)));
    o.onStage?.({ key: 'render', label, progress: p });
  }, 250);
  return () => clearInterval(id);
}

export async function renderPhotoreal(view: PreparedView, o: RenderJobOptions): Promise<RenderJobResult> {
  const tier = RENDER_TIERS[o.tier];
  const t0 = performance.now();
  const minScore = o.minScore ?? 0.6;
  let attempts = 0;
  let best: { api: ApiOk; fidelity: FidelityReport } | null = null;

  const run = async (strict: boolean, withEdges: boolean, base: number, cap: number) => {
    attempts++;
    o.onStage?.({ key: 'send', label: `Sending your exact view to ${tier.modelLabel}…`, progress: base });
    const stop = pacer(o, base, cap, tier.etaSec, strict ? 'Re-rendering with a stricter geometry lock…' : `Rendering photoreal with ${tier.modelLabel}…`);
    let api: ApiOk;
    try {
      api = await postRender(view, o, attempts, strict, withEdges);
    } finally {
      stop();
    }
    o.onStage?.({ key: 'check', label: 'Checking walls, doors and windows against your model…', progress: cap + 0.03 });
    const fidelity = await scoreRenderFidelity(view.dataUrl, api.image, { furnished: o.furnish });
    if (!best || fidelity.score > best.fidelity.score) best = { api, fidelity };
    return fidelity;
  };

  const first = await run(false, !!o.edgeGuideFirst, 0.1, 0.78);
  // Structure outside the model is a hard geometry error, whatever the score.
  if ((o.autoRetry ?? true) && (first.score < minScore || first.outside > OUTSIDE_OK) && !o.signal?.aborted) {
    o.onStage?.({
      key: 'retry',
      label:
        first.outside > OUTSIDE_OK
          ? 'The render added structure outside your model — re-rendering with a stricter lock…'
          : `Geometry match ${Math.round(first.score * 100)}% — re-rendering with a stricter lock…`,
      progress: 0.82,
    });
    try {
      await run(true, true, 0.82, 0.95);
    } catch (e) {
      // Keep the first result if the retry fails for any reason other than a cancel.
      if (o.signal?.aborted) throw e;
    }
  }

  const b = best as unknown as { api: ApiOk; fidelity: FidelityReport };
  o.onStage?.({ key: 'done', label: `Done — geometry match ${Math.round(b.fidelity.score * 100)}% (${fidelityGrade(b.fidelity.score)})`, progress: 1 });
  return {
    renderId: b.api.renderId,
    imageUrl: b.api.image,
    mimeType: b.api.mimeType,
    view,
    planDataUrl: o.furnish ? o.planDataUrl : undefined,
    model: b.api.model,
    modelLabel: b.api.modelLabel,
    tier: o.tier,
    style: o.style,
    fidelity: b.fidelity,
    attempts,
    elapsedMs: Math.round(performance.now() - t0),
    approxUsd: b.api.model === 'dry-run' ? 0 : tier.approxUsd * attempts,
  };
}
