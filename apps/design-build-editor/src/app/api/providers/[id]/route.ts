// apps/design-build-editor/app/api/providers/[id]/route.ts
// Edit (PUT) and remove (DELETE) a provider. Masked responses only.
import { NextRequest, NextResponse } from 'next/server';
import {
  loadRegistry,
  commitRegistry,
  editProvider,
  removeProvider,
  getProvider,
  summarize,
  type ProviderConfig,
} from 'design-build-provider-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY_PARAM = 'apiKey';

function buildPatch(input: any, existing: ProviderConfig): Partial<ProviderConfig> {
  const patch: Partial<ProviderConfig> = {
    label: input.displayName !== undefined ? String(input.displayName) : existing.label,
    providerType: input.providerType === 'openai-compatible' ? 'openai-compatible' : existing.providerType,
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : existing.enabled,
  };
  if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl === '' ? undefined : String(input.baseUrl);
  // Credential handling: only replace when a NEW non-empty key is supplied.
  // Empty/new key absent => keep the previously stored value (never echoed).
  const params = existing.parameters.map((p) => ({ ...p }));
  const keyParam = params.find((p) => p.key === KEY_PARAM);
  if (input.apiKey !== undefined && input.apiKey !== null && input.apiKey !== '') {
    if (keyParam) keyParam.value = String(input.apiKey);
    else params.push({ key: KEY_PARAM, label: 'API Key', value: String(input.apiKey), secret: true });
  }
  patch.parameters = params;
  const customModels: string[] = [];
  if (Array.isArray(input.customModels)) customModels.push(...input.customModels.map(String));
  if (input.modelId) customModels.push(String(input.modelId));
  if (customModels.length) patch.customModels = Array.from(new Set(customModels));
  return patch;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.', code: 'invalid-input' }, { status: 400 });
  }
  const state = loadRegistry();
  const existing = getProvider(state, id);
  if (!existing) return NextResponse.json({ error: 'Provider not found.', code: 'not-found' }, { status: 404 });
  const patch = buildPatch(body, existing);
  const next = editProvider(state, id, patch);
  commitRegistry(next);
  const updated = getProvider(loadRegistry(), id)!;
  return NextResponse.json({ provider: summarize(next).find((p) => p.id === id) ?? summarize({ providers: [updated], activeChatModel: null, activeExtractionModel: null, activeRenderProvider: null })[0] });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = loadRegistry();
  if (!getProvider(state, id)) return NextResponse.json({ error: 'Provider not found.', code: 'not-found' }, { status: 404 });
  commitRegistry(removeProvider(state, id));
  return NextResponse.json({ ok: true });
}
