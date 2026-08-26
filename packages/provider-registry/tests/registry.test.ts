// packages/provider-registry/tests/registry.test.ts
// §11 — provider registry CRUD + masked summaries + secret isolation.

import { describe, it, expect } from 'vitest';
import {
  createEmptyRegistry,
  addProvider,
  editProvider,
  removeProvider,
  selectModel,
  getApiKey,
  getResolvedParameters,
  toSummary,
  type ProviderConfig,
} from '../src/registry';

function makeProvider(id: string, kind: 'extraction' | 'chat' | 'render' = 'extraction'): ProviderConfig {
  return {
    id,
    kind,
    label: `Provider ${id}`,
    providerType: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    enabled: true,
    parameters: [
      { key: 'apiKey', label: 'API Key', value: 'SECRET_VALUE_123', secret: true },
      { key: 'org', label: 'Org', value: 'acme' },
    ],
  };
}

describe('provider registry', () => {
  it('adds, edits, selects and removes with independent slots', () => {
    let s = createEmptyRegistry();
    s = addProvider(s, makeProvider('p1', 'extraction'));
    s = addProvider(s, makeProvider('p2', 'chat'));
    expect(s.providers.length).toBe(2);

    s = selectModel(s, 'extraction', { providerId: 'p1', modelId: 'gemini-2.5-flash' });
    s = selectModel(s, 'chat', { providerId: 'p2', modelId: 'gemini-2.5-pro' });
    expect(s.activeExtractionModel).toEqual({ providerId: 'p1', modelId: 'gemini-2.5-flash' });
    expect(s.activeChatModel?.modelId).toBe('gemini-2.5-pro');

    s = editProvider(s, 'p1', { label: 'Renamed' });
    expect(getApiKey(s, 'p1')).toBe('SECRET_VALUE_123');

    s = removeProvider(s, 'p1');
    expect(s.providers.length).toBe(1);
    expect(s.activeExtractionModel).toBeNull(); // selection cleared on remove
    expect(s.activeChatModel?.providerId).toBe('p2'); // other slot untouched
  });

  it('masks secrets in client summaries', () => {
    let s = addProvider(createEmptyRegistry(), makeProvider('p1'));
    const summary = toSummary(s.providers[0]);
    expect(summary.hasApiKey).toBe(true);
    expect((summary as any).parameters).toBeUndefined();
    // The secret value must never appear in the masked object
    expect(JSON.stringify(summary).includes('SECRET_VALUE_123')).toBe(false);
    expect(getResolvedParameters(s, 'p1').org).toBe('acme'); // non-secret visible server-side
    expect(getResolvedParameters(s, 'p1').apiKey).toBeUndefined(); // secret excluded from params map
  });
});
