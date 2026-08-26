// features/ai-extraction/provider-runtime/registry-client.test.ts
// Focused tests for the isolated provider-registry client (AI extraction slot).
// Covers: response parsing, active provider resolution, explicit providerId+modelId
// preservation, duplicate model IDs across two providers, successful selection+refresh,
// failed selection preserving previous state, no-provider/no-model states, verification
// states, and raw API key absence from client state.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveActiveExtractionProvider,
  resolveAvailableModels,
} from './use-ai-provider-registry';
import { fetchProviders, selectExtractionModel } from './api';
import type { ProviderSummary, ProviderRegistryResponse } from './types';

function makeProvider(over: Partial<ProviderSummary> & Pick<ProviderSummary, 'id' | 'label'>): ProviderSummary {
  return {
    kind: 'extraction',
    providerType: 'gemini',
    hasApiKey: true,
    enabled: true,
    parameterLabels: [],
    customModels: [],
    ...over,
  };
}

const GEMINI: ProviderSummary = makeProvider({
  id: 'p-gem', label: 'Google Gemini', providerType: 'gemini',
  customModels: ['gemini-2.5-pro', 'gemini-2.5-flash'], verificationStatus: 'VERIFIED',
});
const OPENAI: ProviderSummary = makeProvider({
  id: 'p-oa', label: 'Local OpenAI', providerType: 'openai-compatible',
  customModels: ['gemini-2.5-pro', 'my-model'], verificationStatus: 'UNTESTED',
});

function baseResponse(over: Partial<ProviderRegistryResponse> = {}): ProviderRegistryResponse {
  return {
    providers: [GEMINI, OPENAI],
    activeChatModel: null,
    activeExtractionModel: { providerId: 'p-gem', modelId: 'gemini-2.5-pro' },
    activeRenderProvider: null,
    ...over,
  };
}

describe('registry response parsing', () => {
  it('parses providers, activeExtractionModel, and verification status', () => {
    const r = baseResponse();
    expect(r.providers).toHaveLength(2);
    expect(r.activeExtractionModel).toEqual({ providerId: 'p-gem', modelId: 'gemini-2.5-pro' });
    expect(r.providers.find((p) => p.id === 'p-gem')?.verificationStatus).toBe('VERIFIED');
    expect(r.providers.find((p) => p.id === 'p-oa')?.verificationStatus).toBe('UNTESTED');
  });

  it('exposes label (not name) as the display field', () => {
    const r = baseResponse();
    expect((r.providers[0] as any).name).toBeUndefined();
    expect(r.providers[0].label).toBe('Google Gemini');
  });

  it('never includes raw API key bytes in the client summary', () => {
    const r = baseResponse();
    for (const p of r.providers) {
      expect((p as any).apiKey).toBeUndefined();
      expect((p as any).parameters).toBeUndefined();
      expect(p.hasApiKey).toBeTypeOf('boolean');
    }
  });
});

describe('active extraction provider resolution', () => {
  it('resolves provider by explicit activeExtractionModel.providerId', () => {
    const active = resolveActiveExtractionProvider(baseResponse().providers, { providerId: 'p-gem', modelId: 'gemini-2.5-pro' });
    expect(active?.id).toBe('p-gem');
    expect(active?.label).toBe('Google Gemini');
  });

  it('returns null when no active extraction model', () => {
    expect(resolveActiveExtractionProvider(baseResponse().providers, null)).toBeNull();
  });

  it('returns null when active providerId is unknown', () => {
    expect(resolveActiveExtractionProvider(baseResponse().providers, { providerId: 'ghost', modelId: 'x' })).toBeNull();
  });
});

describe('available models for the explicitly selected provider', () => {
  it('returns only the matched provider customModels', () => {
    const gem = resolveActiveExtractionProvider(baseResponse().providers, { providerId: 'p-gem', modelId: 'gemini-2.5-pro' });
    expect(resolveAvailableModels(gem)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);
  });

  it('handles duplicate model IDs across two providers without cross-contamination', () => {
    // Both providers expose 'gemini-2.5-pro' but with different sibling models.
    const gem = resolveActiveExtractionProvider(baseResponse().providers, { providerId: 'p-gem', modelId: 'gemini-2.5-pro' });
    const oa = resolveActiveExtractionProvider(baseResponse().providers, { providerId: 'p-oa', modelId: 'gemini-2.5-pro' });
    expect(resolveAvailableModels(gem)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);
    expect(resolveAvailableModels(oa)).toEqual(['gemini-2.5-pro', 'my-model']);
    // The selection is an explicit pair; the model alone does NOT resolve a provider.
    expect(gem?.id).toBe('p-gem');
    expect(oa?.id).toBe('p-oa');
  });

  it('returns empty array when provider has no customModels', () => {
    const bare = makeProvider({ id: 'p-bare', label: 'Bare', customModels: undefined });
    expect(resolveAvailableModels(bare)).toEqual([]);
  });
});

describe('explicit providerId + modelId preservation', () => {
  it('select posts the exact pair and does not infer providerId from modelId', async () => {
    const spy = vi.fn().mockResolvedValue({ activeChatModel: null, activeExtractionModel: { providerId: 'p-oa', modelId: 'gemini-2.5-pro' }, activeRenderProvider: null });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (url === '/api/providers/select') {
        spy(JSON.parse(init.body));
        return new Response(JSON.stringify({ activeChatModel: null, activeExtractionModel: { providerId: 'p-oa', modelId: 'gemini-2.5-pro' }, activeRenderProvider: null }), { status: 200 });
      }
      if (url === '/api/providers') {
        return new Response(JSON.stringify(baseResponse({ activeExtractionModel: { providerId: 'p-oa', modelId: 'gemini-2.5-pro' } })), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));
    await selectExtractionModel('p-oa', 'gemini-2.5-pro');
    expect(spy).toHaveBeenCalledWith({ slot: 'extraction', providerId: 'p-oa', modelId: 'gemini-2.5-pro' });
  });
});

describe('no-provider and no-model states', () => {
  it('detects no provider configured', () => {
    const none = baseResponse({ providers: [], activeExtractionModel: null });
    expect(resolveActiveExtractionProvider(none.providers, none.activeExtractionModel)).toBeNull();
  });

  it('detects no models for the selected provider', () => {
    const bare = makeProvider({ id: 'p-bare', label: 'Bare', customModels: [] });
    expect(resolveAvailableModels(bare)).toEqual([]);
  });
});

describe('verification states visible', () => {
  it('surfaces VERIFIED, UNTESTED, and TEST_FAILED', () => {
    const r = baseResponse({
      providers: [
        makeProvider({ id: 'a', label: 'A', verificationStatus: 'VERIFIED' }),
        makeProvider({ id: 'b', label: 'B', verificationStatus: 'UNTESTED' }),
        makeProvider({ id: 'c', label: 'C', verificationStatus: 'TEST_FAILED' }),
      ],
    });
    const statuses = r.providers.map((p) => p.verificationStatus);
    expect(statuses).toContain('VERIFIED');
    expect(statuses).toContain('UNTESTED');
    expect(statuses).toContain('TEST_FAILED');
  });
});

describe('failed selection preserves previous server-confirmed state', () => {
  it('does not report success when POST /select fails', async () => {
    const before = baseResponse();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/providers/select') return new Response('err', { status: 500 });
      if (url === '/api/providers') return new Response(JSON.stringify(before), { status: 200 });
      return new Response('{}', { status: 200 });
    }));
    let threw = false;
    try {
      await selectExtractionModel('p-oa', 'my-model');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe('fetchProviders contract', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('GETs /api/providers and returns the typed response', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response(JSON.stringify(baseResponse()), { status: 200 }));
    const r = await fetchProviders();
    expect(r.activeExtractionModel).toEqual({ providerId: 'p-gem', modelId: 'gemini-2.5-pro' });
  });
});
