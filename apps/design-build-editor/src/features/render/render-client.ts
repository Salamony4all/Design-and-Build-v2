// features/render/render-client.ts
// Browser orchestration of one photoreal render: send the prepared view to
// /api/render, score the result against the model's edges, and re-render once
// with a stricter lock (plus the edge guide) when the geometry drifted.

import { RENDER_TIERS, whereInView, type RenderStyleId, type RenderTierId } from './render-presets';
import { OUTSIDE_OK, fidelityGrade, loadImage, scoreRenderFidelity, type FidelityReport } from './geometry-fidelity';
import type { PreparedView } from './capture-view';
import { providerRequestHeaders } from '@/features/providers/browser-provider-store';
import { productRef } from '@/features/furniture/product-refs';

/** Window event fired after each finished render (detail: RenderJobResult). */
export const RENDER_COMPLETE_EVENT = 'db:render-complete';

/** Product pictures sent with one render (the most numerous products in view first). */
const MAX_PRODUCT_PICTURES = 4;

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
  /** Interior views: close the open-top rooms with a plain ceiling (default on). */
  ceiling?: boolean;
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
  /** BOQ Flow products shown in the view (their stand-ins were rendered as them). */
  products?: { id: string; label: string; colour: string; count: number; withPicture: boolean }[];
}

/** What the render route needs to turn the stand-ins in view into furniture and products. */
interface RenderFurniture {
  standIns: number;
  products: { label: string; colour: string; kinds: string[]; count: number; where: string; image?: string }[];
}

const pictureCache = new Map<string, Promise<string | undefined>>();

/**
 * A product picture as a small JPEG data URL: inline pictures (as BOQ Flow sends
 * them) are used as they are, links are fetched when the host allows it.
 */
function productPicture(url: string | undefined): Promise<string | undefined> {
  if (!url) return Promise.resolve(undefined);
  let job = pictureCache.get(url);
  if (!job) {
    job = (async () => {
      let objectUrl: string | null = null;
      try {
        let src = url;
        if (/^https:\/\//i.test(url)) {
          const r = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(8000) });
          const blob = r.ok ? await r.blob() : null;
          if (!blob || !blob.type.startsWith('image/')) return undefined;
          src = objectUrl = URL.createObjectURL(blob);
        } else if (!/^data:image\/(png|jpeg|webp);base64,/i.test(url)) {
          return undefined;
        }
        const img = await loadImage(src);
        const scale = Math.min(1, 512 / Math.max(img.width, img.height, 1));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        const ctx = c.getContext('2d');
        if (!ctx) return undefined;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.85);
      } catch {
        return undefined;
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    })();
    pictureCache.set(url, job);
  }
  return job;
}

/** The stand-ins in view, named by product (with pictures for the main ones). */
async function furnitureForRender(view: PreparedView): Promise<{ request: RenderFurniture; shown: NonNullable<RenderJobResult['products']> } | null> {
  const f = view.furniture;
  if (!f || f.standIns <= 0) return null;
  const request: RenderFurniture = { standIns: f.standIns, products: [] };
  const shown: NonNullable<RenderJobResult['products']> = [];
  let pictures = 0;
  for (const g of f.products.slice(0, 12)) {
    const ref = productRef(g.productId);
    if (!ref) continue;
    const image = pictures < MAX_PRODUCT_PICTURES ? await productPicture(ref.imageUrl) : undefined;
    if (image) pictures++;
    request.products.push({ label: ref.label, colour: ref.colour.name, kinds: g.kinds, count: g.count, where: whereInView(g), ...(image ? { image } : {}) });
    shown.push({ id: ref.id, label: ref.label, colour: ref.colour.hex, count: g.count, withPicture: !!image });
  }
  return { request, shown };
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
    const r = await fetch('/api/render', { cache: 'no-store', headers: providerRequestHeaders('render') });
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
  furniture: RenderFurniture | undefined,
): Promise<ApiOk> {
  const res = await fetch('/api/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...providerRequestHeaders('render') },
    signal: o.signal,
    body: JSON.stringify({
      image: view.dataUrl,
      ...(withEdges ? { edgeGuide: view.edgeGuideUrl } : {}),
      ...(o.furnish && o.planDataUrl ? { plan: o.planDataUrl } : {}),
      style: o.style,
      tier: o.tier,
      aspectRatio: view.aspect.label,
      viewKind: view.viewKind,
      ...(view.viewKind === 'interior'
        ? {
            lensMm: view.lensMm,
            ceiling: o.ceiling !== false,
            ceilingInView: !!view.ceilingInView,
            ...(view.openings ? { openings: view.openings } : {}),
            ...(view.fovDeg ? { fovDeg: view.fovDeg } : {}),
            ...(typeof view.pitchDeg === 'number' ? { pitchDeg: view.pitchDeg } : {}),
          }
        : {}),
      ...(withEdges && view.lineGuide ? { lineGuide: true } : {}),
      furnish: o.furnish,
      ...(furniture ? { furniture } : {}),
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
  const furniture = await furnitureForRender(view);

  const run = async (strict: boolean, withEdges: boolean, base: number, cap: number) => {
    attempts++;
    o.onStage?.({ key: 'send', label: `Sending your exact view to ${tier.modelLabel}…`, progress: base });
    const stop = pacer(o, base, cap, tier.etaSec, strict ? 'Re-rendering with a stricter geometry lock…' : `Rendering photoreal with ${tier.modelLabel}…`);
    let api: ApiOk;
    try {
      api = await postRender(view, o, attempts, strict, withEdges, furniture?.request);
    } finally {
      stop();
    }
    o.onStage?.({ key: 'check', label: 'Checking walls, doors and windows against your model…', progress: cap + 0.03 });
    // Inside a room a ceiling (and its lights) may close the open top: looser
    // limit for new edges, and no empty background to guard.
    const interior = view.viewKind === 'interior';
    const fidelity = await scoreRenderFidelity(view.dataUrl, api.image, { furnished: o.furnish || interior || !!furniture, ignoreOutside: interior });
    if (!best || fidelity.score > best.fidelity.score) best = { api, fidelity };
    return fidelity;
  };

  // Inside views send the model's own line drawing from the start: a room seen
  // with an ultra-wide lens is where image models most often redraw walls.
  const first = await run(false, !!o.edgeGuideFirst || (view.viewKind === 'interior' && !!view.lineGuide), 0.1, 0.78);
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
  const result: RenderJobResult = {
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
    ...(furniture?.shown.length ? { products: furniture.shown } : {}),
  };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(RENDER_COMPLETE_EVENT, { detail: result }));
  return result;
}
