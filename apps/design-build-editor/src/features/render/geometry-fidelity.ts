// features/render/geometry-fidelity.ts
// Measures how well an AI render kept the geometry of the 3D view it was given.
// Both images are reduced to edge maps; the score is the share of the model's
// strong edges (walls, openings, corners) that reappear in the render within a
// small tolerance. Texture added by the render (wood grain, shadows) does not
// lower the score; a moved camera, a missing wall or a shifted window does.
// The core is pure (typed arrays in, numbers out) so it runs in unit tests.

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface FidelityReport {
  /**
   * 0..1 — share of the model's edges found in the render, reduced when the
   * render adds strong structure where the model has none (invented walls or rooms).
   */
  score: number;
  /** Share of the render's strongest edges that lie away from every model edge. */
  added: number;
  /**
   * Share of the render's strongest edges that fall in the empty background
   * around the model's silhouette — invented rooms, wings or buildings.
   * 0 when the background could not be identified.
   */
  outside: number;
  /** Recall at zero shift. */
  recallAligned: number;
  /** Share of strong render edges that lie on model edges (texture lowers this; informative only). */
  precision: number;
  /** Best global shift of the render, in analysis pixels; non-zero means the camera drifted. */
  shift: { dx: number; dy: number };
  /** Render aspect differs from the input by more than 2 %. */
  aspectMismatch: boolean;
  /** Edge pixels found in the model view (too few means the score is unreliable). */
  modelEdgePixels: number;
  /** Analysis size used. */
  width: number;
  height: number;
}

export function toGray(img: RgbaImage): Float32Array {
  const { width: w, height: h, data } = img;
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return out;
}

/** 3x3 box blur (one pass) to suppress JPEG and texture noise before the gradient. */
export function boxBlur3(g: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(g.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += g[yy * w + xx];
          n++;
        }
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

export function sobelMagnitude(g: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(g.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy =
        -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

/**
 * Keeps the strongest `keepFraction` of gradient pixels, but never pixels below
 * `minMagnitude` (so flat images produce an empty mask instead of noise).
 */
export function edgeMask(mag: Float32Array, keepFraction: number, minMagnitude: number): Uint8Array {
  const sorted = Float32Array.from(mag).sort();
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * (1 - keepFraction))));
  const thr = Math.max(minMagnitude, sorted[idx]);
  const mask = new Uint8Array(mag.length);
  for (let i = 0; i < mag.length; i++) mask[i] = mag[i] >= thr && mag[i] > 0 ? 1 : 0;
  return mask;
}

/** Square dilation by radius r (separable max filter). */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dx = -r; dx <= r && !v; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w && mask[y * w + xx]) v = 1;
      }
      tmp[y * w + x] = v;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -r; dy <= r && !v; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Share of `src` pixels that land on `targetDilated` when `src` is moved by (dx, dy). */
export function shiftedRecall(src: Uint8Array, targetDilated: Uint8Array, w: number, h: number, dx: number, dy: number): number {
  let hit = 0;
  let total = 0;
  for (let y = 0; y < h; y++) {
    const ty = y + dy;
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      const tx = x + dx;
      if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
      total++;
      if (targetDilated[ty * w + tx]) hit++;
    }
  }
  return total ? hit / total : 0;
}

// Calibrated on real Nano Banana 2 Lite renders of CODE_06 (22 Nov 2026): faithful
// renders had 4–11 % of strong edges off the model and 0 % in the background; a
// render that invented rooms on an empty lot had 36 % off the model, 35 % outside;
// furnished renders that invented a wing or a terrace had 19 % and 9.5 % outside.
/** Share of strong render edges off the model that a faithful render stays under. */
export const ADDED_OK = 0.15;
/** Share at which the render has clearly invented structure. */
export const ADDED_BAD = 0.32;
/** Furniture adds legitimate edges inside rooms: looser limits when furnishing. */
export const ADDED_OK_FURNISHED = 0.3;
export const ADDED_BAD_FURNISHED = 0.5;
/** Largest score reduction for edges off the model. */
export const ADDED_WEIGHT = 0.6;
/** Share of strong render edges in the empty background a faithful render stays under. */
export const OUTSIDE_OK = 0.04;
/** Share at which structure was clearly invented outside the model. */
export const OUTSIDE_BAD = 0.1;
/** Largest score reduction for structure outside the model. */
export const OUTSIDE_WEIGHT = 0.75;

/**
 * Silhouette of the model: pixels that differ from the background colour (the
 * median of the border pixels), dilated by `r`. `confident` is false when the
 * border is not mostly background (the building fills the frame).
 */
export function silhouetteMask(img: RgbaImage, tol = 14, r = 6): { mask: Uint8Array; confident: boolean } {
  const { width: w, height: h, data } = img;
  const border: number[][] = [[], [], []];
  const push = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    border[0].push(data[p]);
    border[1].push(data[p + 1]);
    border[2].push(data[p + 2]);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    push(0, y);
    push(w - 1, y);
  }
  const bg = border.map((c) => c.slice().sort((a, b) => a - b)[c.length >> 1]);
  let near = 0;
  for (let i = 0; i < border[0].length; i++) {
    if (Math.max(Math.abs(border[0][i] - bg[0]), Math.abs(border[1][i] - bg[1]), Math.abs(border[2][i] - bg[2])) <= tol) near++;
  }
  const raw = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < raw.length; i++, p += 4) {
    raw[i] = Math.max(Math.abs(data[p] - bg[0]), Math.abs(data[p + 1] - bg[1]), Math.abs(data[p + 2] - bg[2])) > tol ? 1 : 0;
  }
  return { mask: dilate(raw, w, h, r), confident: near / Math.max(1, border[0].length) >= 0.6 };
}

export interface FidelityOptions {
  /** Fraction of strongest model-view gradients treated as edges. */
  modelKeep?: number;
  /** Fraction of strongest render gradients treated as edges. */
  renderKeep?: number;
  /** Tolerance radius as a share of the analysis long side. */
  tolerance?: number;
  /** Largest global shift searched, in analysis pixels. */
  maxShift?: number;
  aspectMismatch?: boolean;
  /** The render was asked to add furniture (looser limit for edges inside rooms). */
  furnished?: boolean;
}

export function edgeMapOf(img: RgbaImage, keep: number): { mask: Uint8Array; mag: Float32Array } {
  const g = boxBlur3(toGray(img), img.width, img.height);
  const mag = sobelMagnitude(g, img.width, img.height);
  return { mask: edgeMask(mag, keep, 24), mag };
}

/** Both images must already have the same width and height. */
export function geometryFidelity(model: RgbaImage, render: RgbaImage, opts: FidelityOptions = {}): FidelityReport {
  if (model.width !== render.width || model.height !== render.height) {
    throw new Error('geometryFidelity: images must share one analysis size');
  }
  const w = model.width;
  const h = model.height;
  const longSide = Math.max(w, h);
  const r = Math.max(1, Math.round((opts.tolerance ?? 0.006) * longSide));
  const maxShift = opts.maxShift ?? Math.max(2, Math.round(longSide * 0.016));
  const step = Math.max(1, Math.round(maxShift / 3));

  const src = edgeMapOf(model, opts.modelKeep ?? 0.08).mask;
  const renderMag = edgeMapOf(render, 0.16).mag;
  const out = edgeMask(renderMag, opts.renderKeep ?? 0.16, 24);
  const outStrong = edgeMask(renderMag, 0.1, 40);
  const outD = dilate(out, w, h, r);
  const srcD = dilate(src, w, h, r);
  const srcWide = dilate(src, w, h, r + 1);
  let strong = 0;
  let strongOff = 0;
  for (let i = 0; i < outStrong.length; i++) {
    if (!outStrong[i]) continue;
    strong++;
    if (!srcWide[i]) strongOff++;
  }
  const added = strong ? strongOff / strong : 0;
  const sil = silhouetteMask(model, 14, Math.max(2, Math.round(0.016 * longSide)));
  let strongOutside = 0;
  if (sil.confident) {
    for (let i = 0; i < outStrong.length; i++) if (outStrong[i] && !sil.mask[i]) strongOutside++;
  }
  const outside = strong && sil.confident ? strongOutside / strong : 0;

  let modelEdgePixels = 0;
  for (let i = 0; i < src.length; i++) modelEdgePixels += src[i];
  let outPixels = 0;
  let outOnModel = 0;
  for (let i = 0; i < out.length; i++) {
    if (!out[i]) continue;
    outPixels++;
    if (srcD[i]) outOnModel++;
  }

  const recallAligned = shiftedRecall(src, outD, w, h, 0, 0);
  let best = { dx: 0, dy: 0, recall: recallAligned };
  for (let dy = -maxShift; dy <= maxShift; dy += step) {
    for (let dx = -maxShift; dx <= maxShift; dx += step) {
      if (!dx && !dy) continue;
      const rc = shiftedRecall(src, outD, w, h, dx, dy);
      // A shift must clearly beat the aligned result to count as drift.
      if (rc > best.recall + 0.03) best = { dx, dy, recall: rc };
    }
  }
  // The score starts from the aligned recall: a drifted camera is a geometry error,
  // so it is not forgiven (the best shift is only reported to explain a low score).
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const okA = opts.furnished ? ADDED_OK_FURNISHED : ADDED_OK;
  const badA = opts.furnished ? ADDED_BAD_FURNISHED : ADDED_BAD;
  const addPenalty = clamp01((added - okA) / (badA - okA)) * ADDED_WEIGHT;
  const outPenalty = clamp01((outside - OUTSIDE_OK) / (OUTSIDE_BAD - OUTSIDE_OK)) * OUTSIDE_WEIGHT;
  const score = recallAligned * (1 - addPenalty) * (1 - outPenalty) * (opts.aspectMismatch ? 0.85 : 1);
  return {
    score,
    added,
    outside,
    recallAligned,
    precision: outPixels ? outOnModel / outPixels : 0,
    shift: { dx: best.dx, dy: best.dy },
    aspectMismatch: !!opts.aspectMismatch,
    modelEdgePixels,
    width: w,
    height: h,
  };
}

export type FidelityGrade = 'good' | 'fair' | 'poor';

export function fidelityGrade(score: number): FidelityGrade {
  if (score >= 0.72) return 'good';
  if (score >= 0.55) return 'fair';
  return 'poor';
}

// ---------------------------------------------------------------------------
// Browser helpers (only call these in the browser)
// ---------------------------------------------------------------------------

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

/** Draws `img` into a w x h canvas (cover fit) and returns its pixels. */
export function rasterize(img: CanvasImageSource & { width: number; height: number }, w: number, h: number): RgbaImage {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const d = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}

/** Scores a render against the model view it was made from (both as URLs). */
export async function scoreRenderFidelity(
  modelUrl: string,
  renderUrl: string,
  opts: { analysisLongSide?: number; furnished?: boolean } = {},
): Promise<FidelityReport> {
  const analysisLongSide = opts.analysisLongSide ?? 384;
  const [a, b] = await Promise.all([loadImage(modelUrl), loadImage(renderUrl)]);
  const ra = a.width / a.height;
  const rb = b.width / b.height;
  const w = ra >= 1 ? analysisLongSide : Math.round(analysisLongSide * ra);
  const h = ra >= 1 ? Math.round(analysisLongSide / ra) : analysisLongSide;
  return geometryFidelity(rasterize(a, w, h), rasterize(b, w, h), {
    aspectMismatch: Math.abs(rb / ra - 1) > 0.02,
    furnished: opts.furnished,
  });
}

/**
 * Transparent PNG with the model's edges drawn in `color` — laid over a render
 * it shows at a glance whether walls and openings stayed in place.
 */
export function edgeOverlayDataUrl(img: RgbaImage, color: [number, number, number] = [0, 200, 255], keep = 0.08): string {
  const { mask } = edgeMapOf(img, keep);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const out = ctx.createImageData(img.width, img.height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (!mask[i]) continue;
    out.data[p] = color[0];
    out.data[p + 1] = color[1];
    out.data[p + 2] = color[2];
    out.data[p + 3] = 235;
  }
  ctx.putImageData(out, 0, 0);
  return c.toDataURL('image/png');
}

/** Dark-on-white edge map of the view, sent to the model as a geometry guide. */
export function edgeGuideDataUrl(img: RgbaImage, keep = 0.1): string {
  const { mask } = edgeMapOf(img, keep);
  const thick = dilate(mask, img.width, img.height, img.width > 900 ? 1 : 0);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const out = ctx.createImageData(img.width, img.height);
  for (let i = 0, p = 0; i < thick.length; i++, p += 4) {
    const v = thick[i] ? 20 : 255;
    out.data[p] = v;
    out.data[p + 1] = v;
    out.data[p + 2] = v;
    out.data[p + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return c.toDataURL('image/png');
}
