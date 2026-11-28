// features/render/render-client.ts
// Browser orchestration of one photoreal render: send the prepared view to
// /api/render, score the result against the model's edges, and re-render once
// with a stricter lock (plus the edge guide) when the geometry drifted.

import { RENDER_TIERS, getRenderStyle, referencePlan, spotsWhere, whereInView, type RenderStyleId, type RenderTierId } from './render-presets';
import { OUTSIDE_OK, fidelityGrade, loadImage, scoreRenderFidelity, type FidelityReport } from './geometry-fidelity';
import type { PreparedView } from './capture-view';
import { providerRequestHeaders } from '@/features/providers/browser-provider-store';
import { productRef } from '@/features/furniture/product-refs';

/** Window event fired after each finished render (detail: RenderJobResult). */
export const RENDER_COMPLETE_EVENT = 'db:render-complete';

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
  /**
   * Look references (JPEG data URLs): pictures whose materials, colours and mood the
   * render follows. As many go as the tier takes; product pictures fill the rest.
   */
  looks?: readonly string[];
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
  /** Look references sent with the render. */
  looks?: number;
}

/** What the render route needs to turn the stand-ins in view into furniture and products. */
interface RenderFurniture {
  standIns: number;
  products: {
    label: string;
    colour: string;
    kinds: string[];
    count: number;
    where: string;
    photo: boolean;
    architecturalLock?: boolean;
    finishes?: readonly { role: string; code?: string; name: string; hex: string }[];
    image?: string;
  }[];
  /** Stand-ins without a product, by kind. */
  plain: { kind: string; count: number; where: string }[];
  /** Stand-ins seen through glass. */
  behindGlass: number;
}

interface RenderArchitectural {
  ceilings: {
    label: string;
    code?: string;
    shape: string;
    style: string;
    where?: string;
    widthM: number;
    depthM: number;
    dropM: number;
    finishes?: readonly { role: string; code?: string; name: string; hex: string }[];
    image?: string;
  }[];
  wallCladdings: {
    label: string;
    code?: string;
    style: string;
    curved: boolean;
    where?: string;
    colourHex: string;
    finishes?: readonly { role: string; code?: string; name: string; hex: string }[];
    image?: string;
  }[];
  glazingExecutions: {
    label: string;
    code?: string;
    style: string;
    curved: boolean;
    where?: string;
    frameName: string;
    finishes?: readonly { role: string; code?: string; name: string; hex: string }[];
    image?: string;
  }[];
  wallArtworks?: {
    label: string;
    code?: string;
    style: string;
    where?: string;
    widthM: number;
    heightM: number;
    frameName: string;
    finishes?: readonly { role: string; code?: string; name: string; hex: string }[];
    image?: string;
  }[];
  slabFinishes?: {
    slabId?: string;
    label: string;
    description: string;
    colourHex: string;
  }[];
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
        if (/^https?:\/\//i.test(url)) {
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

/**
 * A picture the client picked as a look reference, as a JPEG data URL of at most
 * `maxSide` px (enough for materials and mood; keeps the request small). Null when
 * the file is not a readable picture.
 */
export async function lookReference(file: Blob, maxSide = 768): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height, 1));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The stand-ins in view, named by product (with pictures for the main ones, up to `maxPictures`). */
async function furnitureForRender(
  view: PreparedView,
  maxPictures: number,
): Promise<{ request: RenderFurniture; shown: NonNullable<RenderJobResult['products']> } | null> {
  const f = view.furniture;
  if (!f || f.standIns <= 0) return null;
  const request: RenderFurniture = {
    standIns: f.standIns,
    products: [],
    plain: (f.plain ?? []).slice(0, 8).map((k) => ({ kind: k.kind, count: k.count, where: spotsWhere(k.spots, k.count).slice(0, 240) })),
    behindGlass: f.behindGlass ?? 0,
  };
  const shown: NonNullable<RenderJobResult['products']> = [];
  let pictures = 0;
  for (const g of f.products.slice(0, 12)) {
    const ref = productRef(g.productId);
    if (!ref) continue;
    const image = pictures < maxPictures ? await productPicture(ref.imageUrl) : undefined;
    if (image) pictures++;
    const where = (g.spots?.length ? spotsWhere(g.spots, g.count) : whereInView(g)).slice(0, 240);
    request.products.push({
      label: ref.label,
      colour: ref.colour.name,
      kinds: g.kinds,
      count: g.count,
      where,
      photo: g.photo,
      ...(g.architecturalLock ? { architecturalLock: true } : {}),
      ...(ref.finishes?.length ? { finishes: ref.finishes } : {}),
      ...(image ? { image } : {}),
    });
    shown.push({ id: ref.id, label: ref.label, colour: ref.colour.hex, count: g.count, withPicture: !!image });
  }
  return { request, shown };
}

async function architecturalForRender(view: PreparedView, remainingPictures: number): Promise<RenderArchitectural | undefined> {
  const a = view.architectural;
  if (!a) return undefined;
  let rem = Math.max(0, remainingPictures);
  const takeImg = async (url?: string) => {
    if (rem <= 0 || !url) return undefined;
    const img = await productPicture(url);
    if (img) rem--;
    return img;
  };
  const ceilings = [];
  for (const c of a.ceilings.slice(0, 4)) {
    const image = await takeImg(c.imageUrl);
    ceilings.push({
      label: c.label,
      ...(c.code ? { code: c.code } : {}),
      shape: c.shape,
      style: c.style,
      where: spotsWhere([{ x: c.x, y: c.y, ...(typeof c.distM === 'number' ? { distM: c.distM } : {}) }]),
      widthM: c.widthM,
      depthM: c.depthM,
      dropM: c.dropM,
      ...(c.finishes?.length ? { finishes: c.finishes } : {}),
      ...(image ? { image } : {}),
    });
  }
  const wallCladdings = [];
  for (const w of a.wallCladdings.slice(0, 6)) {
    const image = await takeImg(w.imageUrl);
    wallCladdings.push({
      label: w.label,
      ...(w.code ? { code: w.code } : {}),
      style: w.style,
      curved: w.curved,
      where: spotsWhere(w.spots, w.spots.length).slice(0, 120),
      colourHex: w.colourHex,
      ...(w.finishes?.length ? { finishes: w.finishes } : {}),
      ...(image ? { image } : {}),
    });
  }
  const glazingExecutions = [];
  for (const g of a.glazingExecutions.slice(0, 4)) {
    const image = await takeImg(g.imageUrl);
    glazingExecutions.push({
      label: g.label,
      ...(g.code ? { code: g.code } : {}),
      style: g.style,
      curved: g.curved,
      where: spotsWhere(g.spots, g.spots.length).slice(0, 120),
      frameName: g.frameName,
      ...(g.finishes?.length ? { finishes: g.finishes } : {}),
      ...(image ? { image } : {}),
    });
  }
  const wallArtworks = [];
  for (const aw of (a.wallArtworks ?? []).slice(0, 4)) {
    const image = await takeImg(aw.imageUrl);
    wallArtworks.push({
      label: aw.label,
      ...(aw.code ? { code: aw.code } : {}),
      style: aw.style,
      where: spotsWhere(aw.spots, aw.spots.length).slice(0, 120),
      widthM: aw.widthM,
      heightM: aw.heightM,
      frameName: aw.frameName,
      ...(aw.finishes?.length ? { finishes: aw.finishes } : {}),
      ...(image ? { image } : {}),
    });
  }
  const slabFinishes = (a.slabFinishes ?? []).map((s) => ({
    slabId: s.slabId,
    label: s.label,
    description: s.description,
    colourHex: s.colourHex,
  }));
  if (!ceilings.length && !wallCladdings.length && !glazingExecutions.length && !wallArtworks.length && !slabFinishes.length) return undefined;
  return {
    ceilings,
    wallCladdings,
    glazingExecutions,
    ...(wallArtworks.length ? { wallArtworks } : {}),
    ...(slabFinishes.length ? { slabFinishes } : {}),
  };
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

/** Dev only: `window.__dbRenderDryRun = true` or `?renderDryRun=1` exercises the whole flow without a model call. */
function devDryRun(): boolean {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return false;
  if ((window as unknown as { __dbRenderDryRun?: boolean }).__dbRenderDryRun === true) return true;
  try {
    return new URLSearchParams(window.location.search).get('renderDryRun') === '1';
  } catch {
    return false;
  }
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
  architectural: RenderArchitectural | undefined,
  looks: readonly string[],
): Promise<ApiOk> {
  const res = await fetch('/api/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...providerRequestHeaders('render') },
    signal: o.signal,
    body: JSON.stringify({
      image: view.dataUrl,
      ...(withEdges ? { edgeGuide: view.edgeGuideUrl } : {}),
      ...(withEdges && view.depthGuideUrl ? { depthGuide: view.depthGuideUrl } : {}),
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
      ...(withEdges && view.meshFramedGuide ? { meshFramedGuide: true } : {}),
      ...(withEdges && view.depthRangeM ? { depthRangeM: view.depthRangeM } : {}),
      ...(view.parallel ? { parallel: true } : {}),
      furnish: o.furnish,
      ...(furniture ? { furniture } : {}),
      ...(architectural ? { architectural } : {}),
      ...(looks.length ? { looks } : {}),
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
  // Each tier takes so many reference pictures: the client's looks first, then products.
  // A white presentation model takes no looks.
  const lookUrls = getRenderStyle(o.style).materials ? [] : (o.looks ?? []).filter((u) => /^data:image\/(png|jpeg|webp);base64,/i.test(u));
  const productsInView = view.furniture?.products.length ?? 0;
  const plan = referencePlan(o.tier, lookUrls.length, productsInView);
  const looks = lookUrls.slice(0, plan.looks);
  const furniture = await furnitureForRender(view, plan.products);
  const usedFurniturePics = furniture?.shown.filter((s) => s.withPicture).length ?? 0;
  const architectural = await architecturalForRender(view, Math.max(0, plan.products - usedFurniturePics));

  const run = async (strict: boolean, withEdges: boolean, base: number, cap: number) => {
    attempts++;
    o.onStage?.({ key: 'send', label: `Sending your exact view to ${tier.modelLabel}…`, progress: base });
    const stop = pacer(o, base, cap, tier.etaSec, strict ? 'Re-rendering with a stricter geometry lock…' : `Rendering photoreal with ${tier.modelLabel}…`);
    let api: ApiOk;
    try {
      api = await postRender(view, o, attempts, strict, withEdges, furniture?.request, architectural, looks);
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

  // The model's own line drawing goes from the start, for every view: its lines are the
  // clay model's true edges (wall corners, tops, openings), which the image model must
  // trace. A picture's edge map (no model lines) only goes with the stricter retry.
  const first = await run(false, !!o.edgeGuideFirst || !!view.lineGuide, 0.1, 0.78);
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
    ...(looks.length ? { looks: looks.length } : {}),
  };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(RENDER_COMPLETE_EVENT, { detail: result }));
  return result;
}
