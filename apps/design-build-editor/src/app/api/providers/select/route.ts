// apps/design-build-editor/app/api/providers/select/route.ts
// Choose the active model/provider per independent slot (chat / extraction /
// render). Slots are isolated — changing one never overwrites another (§4).
import { NextRequest, NextResponse } from 'next/server';
import {
  loadRegistry,
  commitRegistry,
  selectModel,
  getProvider,
  type ProviderKind,
} from 'design-build-provider-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.', code: 'invalid-input' }, { status: 400 });
  }
  const slot: ProviderKind = body?.slot === 'chat' ? 'chat' : body?.slot === 'render' ? 'render' : 'extraction';
  const providerId = body?.providerId;
  const modelId = body?.modelId;
  if (!providerId || !modelId) {
    return NextResponse.json({ error: 'providerId and modelId are required.', code: 'invalid-input' }, { status: 400 });
  }
  const state = loadRegistry();
  const provider = getProvider(state, providerId);
  if (!provider) return NextResponse.json({ error: 'Provider not found.', code: 'not-found' }, { status: 404 });
  const next = selectModel(state, slot, { providerId, modelId });
  commitRegistry(next);
  const updated = loadRegistry();
  return NextResponse.json({
    activeChatModel: updated.activeChatModel,
    activeExtractionModel: updated.activeExtractionModel,
    activeRenderProvider: updated.activeRenderProvider,
  });
}

export async function GET() {
  const state = loadRegistry();
  return NextResponse.json({
    activeChatModel: state.activeChatModel,
    activeExtractionModel: state.activeExtractionModel,
    activeRenderProvider: state.activeRenderProvider,
  });
}
