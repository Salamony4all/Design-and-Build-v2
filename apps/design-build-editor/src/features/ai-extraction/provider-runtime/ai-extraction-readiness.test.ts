// features/ai-extraction/provider-runtime/ai-extraction-readiness.test.ts
// Narrow integration tests for the AI extraction readiness + explicit-pair logic
// that the Composer/page host rely on. No DOM rendering (RTL not a dependency).

import { describe, it, expect } from 'vitest';
import {
  resolveActiveExtractionProvider,
  resolveAvailableModels,
  deriveAiExtractionReadiness,
} from './use-ai-provider-registry';
import type { AiProviderRegistryView, ProviderSummary } from './types';

function provider(over: Partial<ProviderSummary> & Pick<ProviderSummary, 'id' | 'label'>): ProviderSummary {
  return {
    kind: 'extraction', providerType: 'gemini', hasApiKey: true, enabled: true,
    parameterLabels: [], customModels: [], ...over,
  };
}

const GEM = provider({ id: 'p-gem', label: 'Google Gemini', customModels: ['gemini-2.5-pro', 'gemini-2.5-flash'], verificationStatus: 'VERIFIED' });
const OA = provider({ id: 'p-oa', label: 'Local OpenAI', providerType: 'openai-compatible', customModels: ['gemini-2.5-pro', 'my-model'], verificationStatus: 'UNTESTED' });

function view(over: Partial<AiProviderRegistryView> = {}): AiProviderRegistryView {
  return {
    providers: [GEM, OA],
    activeExtractionModel: { providerId: 'p-gem', modelId: 'gemini-2.5-pro' },
    extractionProviders: [GEM, OA],
    loading: false,
    refreshing: false,
    error: null,
    lastUpdatedAt: null,
    ...over,
  };
}

describe('explicit providerId/modelId resolution', () => {
  it('resolves the active provider by explicit providerId (not model string)', () => {
    const v = view({ activeExtractionModel: { providerId: 'p-oa', modelId: 'gemini-2.5-pro' } });
    const active = resolveActiveExtractionProvider(v.providers, v.activeExtractionModel);
    expect(active?.id).toBe('p-oa');
    expect(active?.label).toBe('Local OpenAI');
  });

  it('duplicate model IDs across two providers keep distinct provider IDs', () => {
    const gemModel = resolveActiveExtractionProvider([GEM, OA], { providerId: 'p-gem', modelId: 'gemini-2.5-pro' });
    const oaModel = resolveActiveExtractionProvider([GEM, OA], { providerId: 'p-oa', modelId: 'gemini-2.5-pro' });
    expect(gemModel?.id).toBe('p-gem');
    expect(oaModel?.id).toBe('p-oa');
    // Models come only from the explicitly selected provider.
    expect(resolveAvailableModels(gemModel)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);
    expect(resolveAvailableModels(oaModel)).toEqual(['gemini-2.5-pro', 'my-model']);
  });
});

describe('readiness gating (AI Extract only)', () => {
  it('loading state disables AI extraction', () => {
    const r = deriveAiExtractionReadiness(view({ loading: true }), GEM, GEM.customModels!);
    expect(r.canRunAiExtraction).toBe(false);
    expect(r.blockingReason).toMatch(/Synchronizing/);
  });

  it('no active provider disables AI extraction', () => {
    const v = view({ activeExtractionModel: null, providers: [] });
    const r = deriveAiExtractionReadiness(v, null, []);
    expect(r.canRunAiExtraction).toBe(false);
    expect(r.blockingReason).toMatch(/No AI extraction provider/);
  });

  it('no models for the provider disables AI extraction', () => {
    const bare = provider({ id: 'p-bare', label: 'Bare', customModels: [] });
    const v = view({ providers: [bare], activeExtractionModel: { providerId: 'p-bare', modelId: 'x' } });
    const r = deriveAiExtractionReadiness(v, bare, []);
    expect(r.canRunAiExtraction).toBe(false);
    expect(r.blockingReason).toMatch(/No models/);
  });

  it('registry fetch failure with no provider disables AI extraction', () => {
    const v = view({ error: 'network down', activeExtractionModel: null, providers: [] });
    const r = deriveAiExtractionReadiness(v, null, []);
    expect(r.canRunAiExtraction).toBe(false);
    expect(r.blockingReason).toMatch(/registry unavailable/);
  });

  it('ready when provider + valid active model present', () => {
    const v = view({ activeExtractionModel: { providerId: 'p-gem', modelId: 'gemini-2.5-flash' } });
    const active = resolveActiveExtractionProvider(v.providers, v.activeExtractionModel);
    const r = deriveAiExtractionReadiness(v, active, resolveAvailableModels(active));
    expect(r.canRunAiExtraction).toBe(true);
    expect(r.blockingReason).toBeNull();
  });
});

describe('verification status is surfaced (not blocking)', () => {
  it('UNTESTED provider can still be ready if it has a valid model', () => {
    const v = view({ activeExtractionModel: { providerId: 'p-oa', modelId: 'my-model' } });
    const active = resolveActiveExtractionProvider(v.providers, v.activeExtractionModel);
    const r = deriveAiExtractionReadiness(v, active, resolveAvailableModels(active));
    expect(r.canRunAiExtraction).toBe(true);
  });
});
