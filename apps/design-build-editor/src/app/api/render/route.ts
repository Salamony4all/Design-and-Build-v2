// app/api/render/route.ts
// Geometry-locked photoreal render. The browser sends the exact 3D view (plus an
// optional edge map and floor-plan reference); this route resolves the Gemini key
// SERVER-SIDE from the provider registry (or env), builds the geometry-lock
// prompt and returns the generated image. Keys never reach the browser or logs.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadRegistry, getProvider, getApiKey } from 'design-build-provider-registry';
import { readRequestProvider, type RequestProvider } from '@/features/providers/request-provider';
import {
  ALLOWED_RENDER_MODELS,
  RENDER_PROMPT_VERSION,
  RENDER_TIERS,
  buildGeometryLockPrompt,
  isSupportedAspect,
  modelSupportsImageSize,
  type RenderTierId,
} from '@/features/render/render-presets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const SERVER_SENTINEL = '__SERVER_RESOLVED_FROM_ENV__';
const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE_CHARS = 6_000_000; // ~4.4 MB of image bytes per image

const BodySchema = z.object({
  image: z.string().max(MAX_IMAGE_CHARS),
  edgeGuide: z.string().max(MAX_IMAGE_CHARS).optional(),
  plan: z.string().max(MAX_IMAGE_CHARS).optional(),
  style: z.enum(['daylight', 'golden-hour', 'overcast', 'dusk', 'clay']).default('daylight'),
  tier: z.enum(['fast', 'balanced', 'pro']).default('fast'),
  model: z.string().max(80).optional(),
  aspectRatio: z.string().max(8),
  viewKind: z.enum(['cutaway', 'eye-level', 'interior']).default('cutaway'),
  lensMm: z.number().min(6).max(200).optional(),
  ceiling: z.boolean().optional(),
  /** The capture already shows a plain ceiling on top of the walls. */
  ceilingInView: z.boolean().optional(),
  /** The edge guide is a line drawing made from the 3D model. */
  lineGuide: z.boolean().optional(),
  fovDeg: z.object({ h: z.number().min(1).max(179), v: z.number().min(1).max(179) }).optional(),
  pitchDeg: z.number().min(-90).max(90).optional(),
  /** Doors and windows in view, from the 3D scene (normalized to the image). */
  openings: z
    .array(
      z.object({
        kind: z.enum(['door', 'window']),
        x0: z.number().min(0).max(1),
        y0: z.number().min(0).max(1),
        x1: z.number().min(0).max(1),
        y1: z.number().min(0).max(1),
      }),
    )
    .max(60)
    .optional(),
  furnish: z.boolean().default(false),
  note: z.string().max(2000).optional(),
  strict: z.boolean().default(false),
  attempt: z.number().int().min(1).max(5).default(1),
  debugSave: z.boolean().optional(),
  /** Dev only: skip the model and echo the view back (UI testing without spend). */
  dryRun: z.boolean().optional(),
});

type Body = z.infer<typeof BodySchema>;

interface ResolvedGemini {
  apiKey: string;
  baseUrl: string;
  providerLabel: string;
}

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

function envKey(): string {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
}

/**
 * Gemini credentials in priority order: the key this browser sent with the
 * request (providers live in the user's browser), then — for local
 * development — the active render provider, the extraction provider, any other
 * Gemini provider, then the server env key.
 * A key that is out of quota (e.g. a free-tier key, which has no image quota)
 * or rejected falls through to the next one.
 */
function resolveGeminiCandidates(fromBrowser: RequestProvider | null = null): ResolvedGemini[] {
  const out: ResolvedGemini[] = [];
  const seenKeys = new Set<string>();
  // The browser's own key first (keys live in the user's browser, like BOQ Flow).
  if (fromBrowser?.apiKey && fromBrowser.providerType === 'gemini') {
    out.push({
      apiKey: fromBrowser.apiKey,
      baseUrl: (fromBrowser.baseUrl || DEFAULT_GEMINI_BASE).replace(/\/+$/, ''),
      providerLabel: fromBrowser.label || 'Your Gemini key',
    });
    seenKeys.add(fromBrowser.apiKey);
  }
  const state = loadRegistry();
  const order = [
    fromBrowser?.apiKey ? undefined : fromBrowser?.providerId,
    state.activeRenderProvider?.providerId,
    state.activeExtractionModel?.providerId,
    ...state.providers.filter((p) => p.providerType === 'gemini').map((p) => p.id),
  ].filter((x): x is string => !!x);
  for (const id of [...new Set(order)]) {
    const p = getProvider(state, id);
    if (!p || !p.enabled || p.providerType !== 'gemini') continue;
    const stored = getApiKey(state, id);
    const apiKey = stored && stored !== SERVER_SENTINEL ? stored : envKey();
    if (!apiKey || seenKeys.has(apiKey)) continue;
    seenKeys.add(apiKey);
    out.push({ apiKey, baseUrl: (p.baseUrl || DEFAULT_GEMINI_BASE).replace(/\/+$/, ''), providerLabel: p.label });
  }
  const k = envKey();
  if (k && !seenKeys.has(k)) out.push({ apiKey: k, baseUrl: DEFAULT_GEMINI_BASE, providerLabel: 'Gemini (server env)' });
  return out;
}

/** Google answers an invalid key with 400 "API key not valid", a revoked or restricted one with 401/403. */
function keyRejected(r: { status: number; json: GeminiResponse }): boolean {
  return r.status === 401 || r.status === 403 || (r.status === 400 && /api key not valid|api_key_invalid/i.test(upstreamMessage(r.json)));
}

function parseDataUrl(s: string | undefined): { mimeType: string; data: string } | null {
  if (!s) return null;
  const m = DATA_URL.exec(s);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  inline_data?: { mime_type: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: Record<string, number>;
  error?: { code?: number; message?: string; status?: string };
}

async function generate(
  g: ResolvedGemini,
  model: string,
  parts: GeminiPart[],
  imageConfig: Record<string, string>,
  modalities: string[],
  signal: AbortSignal,
): Promise<{ status: number; json: GeminiResponse }> {
  const res = await fetch(`${g.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': g.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: modalities, imageConfig },
    }),
    signal,
  });
  const json = (await res.json().catch(() => ({}))) as GeminiResponse;
  return { status: res.status, json };
}

function upstreamMessage(j: GeminiResponse): string {
  return (j.error?.message ?? '').replace(/\s+/g, ' ').slice(0, 300);
}

async function saveDebug(id: string, body: Body, prompt: string, out: { mimeType: string; data: string } | null, meta: Record<string, unknown>) {
  const dir = path.join(process.cwd(), '.data', 'render-debug');
  await fs.mkdir(dir, { recursive: true });
  const write = (name: string, d: { data: string } | null) => (d ? fs.writeFile(path.join(dir, `${id}-${name}`), Buffer.from(d.data, 'base64')) : Promise.resolve());
  const ext = (m?: string) => (m === 'image/png' ? 'png' : m === 'image/webp' ? 'webp' : 'jpg');
  const inp = parseDataUrl(body.image);
  await Promise.all([
    write(`input.${ext(inp?.mimeType)}`, inp),
    write('edges.png', parseDataUrl(body.edgeGuide)),
    write('plan.jpg', parseDataUrl(body.plan)),
    write(`output.${ext(out?.mimeType)}`, out),
    fs.writeFile(path.join(dir, `${id}-meta.json`), JSON.stringify({ ...meta, prompt }, null, 2)),
  ]);
}

export async function GET(req: NextRequest) {
  const c = resolveGeminiCandidates(readRequestProvider(req));
  return NextResponse.json({
    ready: c.length > 0,
    providerLabel: c[0]?.providerLabel ?? null,
    tiers: Object.values(RENDER_TIERS).map(({ id, label, modelLabel, approxUsd, etaSec, imageSize }) => ({ id, label, modelLabel, approxUsd, etaSec, imageSize })),
    promptVersion: RENDER_PROMPT_VERSION,
  });
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return fail(400, 'RENDER_BAD_REQUEST', e instanceof z.ZodError ? 'Invalid render request.' : 'Request body must be JSON.');
  }
  const view = parseDataUrl(body.image);
  if (!view) return fail(400, 'RENDER_BAD_REQUEST', 'The 3D view must be a PNG, JPEG or WebP data URL.');
  if (!isSupportedAspect(body.aspectRatio)) return fail(400, 'RENDER_BAD_REQUEST', `Unsupported aspect ratio ${body.aspectRatio}.`);
  const edge = parseDataUrl(body.edgeGuide);
  const plan = body.furnish ? parseDataUrl(body.plan) : null;

  const tier = RENDER_TIERS[body.tier as RenderTierId];
  const model = body.model && ALLOWED_RENDER_MODELS.has(body.model) ? body.model : tier.model;

  if (body.dryRun && process.env.NODE_ENV !== 'production') {
    return NextResponse.json({
      ok: true,
      renderId: `dryrun_${Date.now().toString(36)}`,
      image: body.image,
      mimeType: view.mimeType,
      model: 'dry-run',
      modelLabel: 'Dry run (no model call)',
      tier: tier.id,
      providerLabel: 'dev',
      aspectRatio: body.aspectRatio,
      ms: 0,
      attempt: body.attempt,
      promptVersion: RENDER_PROMPT_VERSION,
      prompt: buildGeometryLockPrompt({
        style: body.style, viewKind: body.viewKind, furnish: body.furnish, withEdgeGuide: !!edge,
        withPlan: !!plan, note: body.note, strict: body.strict, lensMm: body.lensMm, ceiling: body.ceiling,
        ceilingInView: body.ceilingInView, lineGuide: body.lineGuide && !!edge, fovDeg: body.fovDeg, pitchDeg: body.pitchDeg,
        openings: body.openings,
      }),
    });
  }

  const candidates = resolveGeminiCandidates(readRequestProvider(req));
  if (!candidates.length) {
    return fail(412, 'RENDER_PROVIDER_NOT_CONFIGURED', 'No Gemini key yet. Add your Gemini provider in AI Studio — it is kept in this browser.');
  }

  const prompt = buildGeometryLockPrompt({
    style: body.style,
    viewKind: body.viewKind,
    furnish: body.furnish,
    withEdgeGuide: !!edge,
    withPlan: !!plan,
    note: body.note,
    strict: body.strict,
    lensMm: body.lensMm,
    ceiling: body.ceiling,
    ceilingInView: body.ceilingInView,
    lineGuide: body.lineGuide && !!edge,
    fovDeg: body.fovDeg,
    pitchDeg: body.pitchDeg,
    openings: body.openings,
  });

  // Images first, in the order the prompt numbers them; the instruction last.
  const parts: GeminiPart[] = [{ inlineData: view }];
  if (edge) parts.push({ inlineData: edge });
  if (plan) parts.push({ inlineData: plan });
  parts.push({ text: prompt });

  const baseImageConfig: Record<string, string> = { aspectRatio: body.aspectRatio };
  if (tier.imageSize && modelSupportsImageSize(model)) baseImageConfig.imageSize = tier.imageSize;

  const started = Date.now();
  const signal = AbortSignal.timeout(110_000);
  let resp: { status: number; json: GeminiResponse } | null = null;
  let g: ResolvedGemini = candidates[0];
  const skipped: string[] = [];
  try {
    for (const cand of candidates) {
      g = cand;
      let imageConfig = { ...baseImageConfig };
      let modalities = ['IMAGE'];
      for (let i = 0; i < 3; i++) {
        resp = await generate(g, model, parts, imageConfig, modalities, signal);
        if (resp.status === 200) break;
        const msg = upstreamMessage(resp.json).toLowerCase();
        if (resp.status === 400 && imageConfig.imageSize && /image_?size/.test(msg)) {
          imageConfig = { aspectRatio: body.aspectRatio };
          continue;
        }
        if (resp.status === 400 && modalities.length === 1 && /modalit/.test(msg)) {
          modalities = ['TEXT', 'IMAGE'];
          continue;
        }
        if ([500, 502, 503, 504].includes(resp.status) && i === 0) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        break;
      }
      if (!resp || resp.status === 200) break;
      // Out of quota (free-tier keys have none for image models) or rejected: try the next key.
      const quota = resp.status === 429 && /quota|billing|exceeded/i.test(upstreamMessage(resp.json));
      if (!(quota || keyRejected(resp))) break;
      const um = upstreamMessage(resp.json);
      const why = resp.status !== 429 ? 'key rejected' : /spend/i.test(um) ? 'monthly spend cap reached' : /free.?tier|limit: ?0/i.test(um) ? 'free tier, no image quota' : 'quota used up';
      skipped.push(`${g.providerLabel} (${why})`);
    }
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return fail(504, 'RENDER_TIMEOUT', timeout ? 'The image model took too long. Try again or pick the Fast quality.' : 'Could not reach the image model.');
  }
  if (!resp) return fail(502, 'RENDER_UPSTREAM', 'No response from the image model.');

  if (resp.status !== 200) {
    const msg = upstreamMessage(resp.json);
    if (keyRejected(resp)) return fail(502, 'RENDER_AUTH', 'The Gemini key was rejected. Check it in AI Studio.');
    if (resp.status === 404) return fail(502, 'RENDER_MODEL_UNAVAILABLE', `Model ${model} is not available for this key.`);
    if (resp.status === 429) {
      const tried = skipped.length ? ` Tried: ${skipped.join(', ')}.` : '';
      return fail(429, 'RENDER_RATE_LIMIT', `Gemini quota or rate limit reached — image models need a billing-enabled key.${tried} ${msg}`.trim());
    }
    return fail(502, 'RENDER_UPSTREAM', `Image model error (${resp.status}). ${msg}`.trim());
  }

  const cand = resp.json.candidates?.[0];
  const outParts = cand?.content?.parts ?? [];
  const imgPart = outParts.find((p) => p.inlineData?.data || p.inline_data?.data);
  const out = imgPart
    ? imgPart.inlineData
      ? { mimeType: imgPart.inlineData.mimeType || 'image/png', data: imgPart.inlineData.data }
      : { mimeType: imgPart.inline_data!.mime_type || 'image/png', data: imgPart.inline_data!.data }
    : null;
  const text = outParts.map((p) => p.text).filter(Boolean).join(' ').slice(0, 500) || undefined;
  const ms = Date.now() - started;
  const renderId = `render_${started.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  if (body.debugSave && process.env.NODE_ENV !== 'production') {
    await saveDebug(renderId, body, prompt, out, {
      model, tier: tier.id, style: body.style, aspectRatio: body.aspectRatio, viewKind: body.viewKind,
      furnish: body.furnish, strict: body.strict, attempt: body.attempt, ms, finishReason: cand?.finishReason,
      usage: resp.json.usageMetadata, text, promptVersion: RENDER_PROMPT_VERSION, provider: g.providerLabel, skipped,
    }).catch(() => undefined);
  }

  if (!out) {
    const reason = resp.json.promptFeedback?.blockReason ?? cand?.finishReason ?? 'NO_IMAGE';
    return fail(422, 'RENDER_NO_IMAGE', `The model returned no image (${reason}).${text ? ` It said: ${text}` : ''}`);
  }

  return NextResponse.json({
    ok: true,
    renderId,
    image: `data:${out.mimeType};base64,${out.data}`,
    mimeType: out.mimeType,
    model,
    modelLabel: model === tier.model ? tier.modelLabel : model,
    tier: tier.id,
    providerLabel: g.providerLabel,
    ...(skipped.length ? { skippedProviders: skipped } : {}),
    aspectRatio: body.aspectRatio,
    ms,
    attempt: body.attempt,
    promptVersion: RENDER_PROMPT_VERSION,
    usage: resp.json.usageMetadata ?? null,
    text,
  });
}
