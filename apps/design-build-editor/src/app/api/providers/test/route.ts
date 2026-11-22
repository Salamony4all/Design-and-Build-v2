// apps/design-build-editor/app/api/providers/test/route.ts
// Test Connection (Change Set 3, §5/§6). Runs server-side only; the API key
// is NEVER returned. For Gemini-native, models.list is used. For
// OpenAI-compatible, /models is tried, else manual entry is allowed.
import { NextRequest, NextResponse } from 'next/server';
import {
  testGeminiConnection,
  testOpenAiCompatibleConnection,
  loadRegistry,
  getApiKey,
} from 'design-build-provider-registry';
import { safeBaseUrl } from '@/features/providers/request-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.', code: 'invalid-input' }, { status: 400 });
  }
  const providerType = body?.providerType === 'openai-compatible' ? 'openai-compatible' : 'gemini';
  const rawBaseUrl = body?.baseUrl ? String(body.baseUrl) : '';
  // Only public https:// addresses are called on a visitor's behalf.
  const baseUrl = rawBaseUrl ? safeBaseUrl(rawBaseUrl) ?? '' : '';
  const headers = body?.optionalHeaders && typeof body.optionalHeaders === 'object' ? body.optionalHeaders : undefined;

  // Resolve the API key server-side. Priority:
  //   1. Explicit key supplied in this request (Add mode / freshly typed).
  //   2. A stored provider's persisted key (Edit mode — client sends '' to
  //      mean "keep current", so we resolve it from the registry).
  //   3. Environment fallback (GEMINI_API_KEY / GOOGLE_API_KEY).
  // A blank key reaching Google yields HTTP 403 "unregistered callers", so we
  // must never pass an empty string to the provider SDK.
  let apiKey = body?.apiKey ? String(body.apiKey) : '';
  if (!apiKey && body?.providerId) {
    const stored = getApiKey(loadRegistry(), String(body.providerId));
    if (stored && stored !== '__SERVER_RESOLVED_FROM_ENV__') apiKey = stored;
  }
  if (!apiKey) apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';

  try {
    if (providerType === 'gemini') {
      const res = await testGeminiConnection(apiKey);
      return NextResponse.json({ ok: res.ok, error: res.error, models: res.models ?? [] });
    }
    if (!baseUrl) {
      return NextResponse.json({
        ok: false,
        error: rawBaseUrl ? 'Base URL must be a public https:// address.' : 'Base URL is required for OpenAI-compatible providers.',
      });
    }
    const res = await testOpenAiCompatibleConnection(baseUrl, apiKey, headers);
    return NextResponse.json({ ok: res.ok, error: res.error, models: res.models ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) });
  }
}
