// apps/design-build-editor/app/api/providers/route.ts
// Provider registry CRUD boundary (Change Set 3, §3–§7).
// All responses are MASKED ProviderSummary views — the API key is never
// serialized to the client. Writes persist server-side only.

import { NextRequest, NextResponse } from 'next/server';
import {
  loadRegistry,
  commitRegistry,
  addProvider,
  getProvider,
  summarize,
  type ProviderConfig,
  type ProviderKind,
  type ProviderType,
  type ProviderVerificationStatus,
} from 'design-build-provider-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY_PARAM = 'apiKey';

function ok(json: unknown, status = 200) {
  return NextResponse.json(json, { status });
}

/** Build a ProviderConfig from a client create/edit draft. The API key is
 *  stored server-side (never echoed back). A sentinel value means "resolve
 *  from the server environment" and is preserved across edits. */
function buildConfig(input: any, id: string): ProviderConfig {
  const kind: ProviderKind = input.kind === 'chat' || input.kind === 'render' ? input.kind : 'extraction';
  const providerType: ProviderType = input.providerType === 'openai-compatible' ? 'openai-compatible' : 'gemini';
  const parameters: { key: string; label: string; value: string; secret?: boolean }[] = [];
  if (input.apiKey !== undefined && input.apiKey !== null && input.apiKey !== '') {
    parameters.push({ key: KEY_PARAM, label: 'API Key', value: String(input.apiKey), secret: true });
  } else {
    // preserve the server-resolved sentinel if no new key supplied
    parameters.push({ key: KEY_PARAM, label: 'API Key', value: '__SERVER_RESOLVED_FROM_ENV__', secret: true });
  }
  const out: ProviderConfig = {
    id,
    kind,
    label: String(input.displayName || input.label || id),
    providerType,
    ...(input.baseUrl ? { baseUrl: String(input.baseUrl) } : {}),
    parameters,
    enabled: input.enabled !== false,
  };
  const customModels: string[] = [];
  if (Array.isArray(input.customModels)) customModels.push(...input.customModels.map(String));
  if (input.modelId) customModels.push(String(input.modelId));
  if (customModels.length) out.customModels = Array.from(new Set(customModels));
  if (input.verificationStatus === 'UNTESTED' || input.verificationStatus === 'VERIFIED' || input.verificationStatus === 'TEST_FAILED') {
    out.verificationStatus = input.verificationStatus as ProviderVerificationStatus;
  }
  return out;
}

// GET /api/providers — masked list + active selections
export async function GET() {
  const state = loadRegistry();
  return ok({
    providers: summarize(state),
    activeChatModel: state.activeChatModel,
    activeExtractionModel: state.activeExtractionModel,
    activeRenderProvider: state.activeRenderProvider,
  });
}

// POST /api/providers — create
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.', code: 'invalid-input' }, { status: 400 });
  }
  if (!body?.displayName || !body?.providerType) {
    return NextResponse.json({ error: 'displayName and providerType are required.', code: 'invalid-input' }, { status: 400 });
  }
  const state = loadRegistry();
  const id = `prov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const config = buildConfig(body, id);
  const next = addProvider(state, config);
  commitRegistry(next);
  const created = getProvider(next, id)!;
  return ok({ provider: summarize(next).find((p) => p.id === id) ?? summarize({ providers: [created], activeChatModel: null, activeExtractionModel: null, activeRenderProvider: null })[0] }, 201);
}
