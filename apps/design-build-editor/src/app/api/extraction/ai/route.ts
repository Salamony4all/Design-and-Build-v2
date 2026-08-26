// apps/design-build-editor/app/api/extraction/ai/route.ts
// Clean AI (Gemini Multipass) extraction boundary (Change Set 3, §13).
// Never mutates Pascal. Never imports apps/editor at runtime. Resolves the
// active EXTRACTION provider server-side from the persisted registry
// (design-build-provider-registry) — the API key is NEVER sent to the client.
// Accepts PDF/PNG/JPEG; PDFs are rendered to an image (page 1) exactly as the
// legacy pdf-to-image step, then the provider-agnostic multipass controller
// runs. Returns the neutral ExtractionResult + typed multipass events.

import { NextRequest, NextResponse } from 'next/server';
import mupdf from 'mupdf';
import {
  loadRegistry,
  getProvider,
  getApiKey,
  getResolvedParameters,
  summarize,
} from 'design-build-provider-registry';
import {
  createModelRuntime,
  AiConfigurationError,
  GOOGLE_MODEL_MAP,
  runMultipass,
  MultipassCancelledError,
  type MultipassEvent,
} from 'design-build-extraction-ai';
import { adaptMultipassResult } from 'design-build-extraction-ai';
import {
  addAttachment,
  getActiveAttachments,
  createEmptyRepository,
  kindFromMime,
} from 'design-build-attachment-service';
import type { ProviderRuntime } from 'design-build-extraction-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 25 * 1024 * 1024;

type ApiError = { error: string; code: string; detail?: string };

function fail(code: string, message: string, status: number, detail?: string) {
  return NextResponse.json({ error: message, code, detail } as ApiError, { status });
}

/** Resolve a server-side ProviderRuntime from the persisted registry. */
function resolveRuntime(): { runtime: ProviderRuntime; providerId: string; modelId: string } | ApiError {
  const state = loadRegistry();
  const sel = state.activeExtractionModel;
  if (!sel) {
    return { error: 'No extraction provider/model selected. Open Settings → Providers and pick an extraction model.',
      code: 'AI_MODEL_NOT_CONFIGURED' } as ApiError;
  }
  const provider = getProvider(state, sel.providerId);
  if (!provider || !provider.enabled) {
    return { error: 'Selected extraction provider is missing or disabled.',
      code: 'AI_PROVIDER_NOT_CONFIGURED' } as ApiError;
  }
  // Resolve credential SERVER-SIDE only. A stored sentinel means "resolve from
  // the server environment" — the key is never persisted to disk or sent to
  // the browser.
  const storedKey = getApiKey(state, sel.providerId);
  const apiKey =
    storedKey && storedKey !== '__SERVER_RESOLVED_FROM_ENV__'
      ? storedKey
      : (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '');
  if (!apiKey) {
    return { error: 'Selected extraction provider has no API key configured (set one in Settings → Providers or the GEMINI_API_KEY env var).',
      code: 'AI_PROVIDER_NOT_CONFIGURED' } as ApiError;
  }
  // Model id: explicit selection; GOOGLE_MODEL_MAP friendly-name resolution only
  // (§2: NO silent fallback to an arbitrary model).
  const modelId = GOOGLE_MODEL_MAP[sel.modelId] || sel.modelId;
  if (!modelId) {
    return { error: 'Selected extraction model is empty. Choose a model explicitly.',
      code: 'AI_MODEL_NOT_CONFIGURED' } as ApiError;
  }
  const params = getResolvedParameters(state, sel.providerId);
  const rt: ProviderRuntime = {
    providerId: sel.providerId,
    providerType: provider.providerType,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    apiKey,
    ...(Object.keys(params).length ? { headers: params } : {}),
  };
  return { runtime: rt, providerId: sel.providerId, modelId };
}

/** Render a PDF page-1 to PNG bytes at 2x scale, matching legacy pdf-to-image. */
function renderPdfPageToBytes(bytes: Uint8Array): { png: Uint8Array; mime: string } {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const page = doc.loadPage(0);
  const pix = page.toPixmap(mupdf.Matrix.scale(2.0, 2.0), mupdf.ColorSpace.DeviceRGB, false, true);
  return { png: new Uint8Array(pix.asPNG()), mime: 'image/png' };
}

/** Read PNG/JPEG pixel dimensions from raw bytes (no full decode). */
function readImageDimensions(bytes: Uint8Array): { width: number; height: number } {
  try {
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      // PNG: IHDR width/height at byte offsets 16/20 (big-endian).
      const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      if (width > 0 && height > 0) return { width, height };
    }
    if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      // JPEG: scan for SOF0..SOF15 (excluding C4/C8/CC).
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = (bytes[i + 5] << 8) | bytes[i + 6];
          const width = (bytes[i + 7] << 8) | bytes[i + 8];
          if (width > 0 && height > 0) return { width, height };
        }
        const len = (bytes[i + 2] << 8) | bytes[i + 3];
        i += 2 + len;
      }
    }
  } catch {
    /* fall through to default */
  }
  return { width: 1600, height: 1200 };
}

export async function POST(req: NextRequest) {
  let imageBytes: Uint8Array;
  let mimeType: string;
  let fileName = 'upload';

  try {
    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return fail('invalid-input', 'No file field in multipart upload.', 400);
      }
      fileName = file.name || fileName;
      const raw = new Uint8Array(await file.arrayBuffer());
      if (file.type === 'application/pdf') {
        const { png } = renderPdfPageToBytes(raw);
        imageBytes = png; mimeType = 'image/png';
      } else if (file.type === 'image/png' || file.type === 'image/jpeg') {
        imageBytes = raw; mimeType = file.type;
      } else {
        return fail('unsupported-input', `Unsupported mime: ${file.type}`, 415);
      }
    } else if (contentType.includes('application/json')) {
      const json = await req.json();
      const att = json?.attachment;
      if (att?.bytes && Array.isArray(att.bytes)) {
        const raw = Uint8Array.from(att.bytes);
        // Default PNG attachments to image/png — Gemini rejects
        // application/octet-stream for inline image data. Detect by magic
        // bytes (PNG = 89 50 4E 47); only honour an explicit att.mimeType.
        const looksPng = raw.length > 4 && raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47;
        const m = att.mimeType || (looksPng ? 'image/png' : 'application/octet-stream');
        if (m === 'application/pdf') {
          const { png } = renderPdfPageToBytes(raw);
          imageBytes = png; mimeType = 'image/png';
        } else {
          imageBytes = raw; mimeType = m;
        }
        fileName = att.fileName || fileName;
      } else {
        return fail('invalid-input', 'JSON body must carry attachment.bytes.', 400);
      }
    } else {
      return fail('invalid-input', 'Expected multipart/form-data or application/json.', 415);
    }
  } catch (e) {
    return fail('invalid-input', 'Could not read request body.', 400, e instanceof Error ? e.message : String(e));
  }

  if (!imageBytes || imageBytes.length === 0) {
    return fail('empty-document', 'Empty document.', 400);
  }
  if (imageBytes.length > MAX_BYTES) {
    return fail('unsupported-input', 'Document exceeds 25 MB.', 413);
  }

  const resolved = resolveRuntime();
  if ('code' in resolved) {
    const status = resolved.code === 'AI_MODEL_NOT_CONFIGURED' ? 400 : 409;
    return fail(resolved.code, resolved.error, status);
  }

  const repo = createEmptyRepository();
  const ref = addAttachment(repo, {
    id: 'primary', name: fileName, mimeType, kind: kindFromMime(mimeType), enabled: true,
  });
  const active = getActiveAttachments(ref);
  if (active.length === 0) {
    return fail('no-active-attachment', 'No active attachment provided.', 400);
  }

  const base64 = Buffer.from(imageBytes).toString('base64');
  const runId = `ai-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const events: MultipassEvent[] = [];

  // Source image dimensions (for versioned passes like window V4). Reads PNG
  // IHDR or JPEG SOF; falls back to a sane default if undecodable.
  const imageDims = readImageDimensions(imageBytes);

  // Bridge provider runtime → AiModelRuntime adapter.
  const modelRuntime = createModelRuntime(resolved.runtime);

  try {
    const multipass = await runMultipass(
      modelRuntime,
      { runId, imageBase64: base64, imageMimeType: mimeType, modelId: resolved.modelId, signal: controller.signal, imageWidthPx: imageDims.width, imageHeightPx: imageDims.height },
      (e) => events.push(e),
    );
    const result = adaptMultipassResult(multipass, { pageId: fileName });
    return NextResponse.json({ ok: true, runId, fileName, modelId: resolved.modelId, events, result }, { status: 200 });
  } catch (e: any) {
    if (e instanceof MultipassCancelledError) {
      return fail('extraction-cancelled', 'Extraction was cancelled.', 499);
    }
    if (e instanceof AiConfigurationError) {
      const status = e.code === 'AI_MODEL_NOT_CONFIGURED' ? 400 : 409;
      return fail(e.code, e.message, status);
    }
    if (/no longer available|not found|404/i.test(String(e.message))) {
      return fail('AI_MODEL_UNAVAILABLE',
        `Model '${resolved.modelId}' is unavailable on the selected provider. Choose another model in Settings → Providers.`,
        409);
    }
    if (/api key|unauthorized|401|403|permission|connection|ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(String(e.message))) {
      return fail('AI_PROVIDER_CONNECTION_FAILED',
        `Provider connection failed: ${String(e.message).slice(0, 200)}. Check the Base URL / API key in Settings → Providers.`,
        502);
    }
    return fail('extraction-failure', 'AI extraction failed.', 500, e.message);
  }
}

/** GET returns only the masked provider summaries (never secrets). */
export async function GET() {
  const state = loadRegistry();
  return NextResponse.json({ providers: summarize(state), activeExtractionModel: state.activeExtractionModel });
}
