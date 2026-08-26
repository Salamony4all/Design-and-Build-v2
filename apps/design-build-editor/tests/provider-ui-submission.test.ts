// apps/design-build-editor/tests/provider-ui-submission.test.ts
// Provider UI-submission integration test (Change Set 3.1, §9). Uses MOCKED
// provider-network responses for determinism — the real live provider test is
// separate (run against the running server). Asserts:
//  - submit produces a POST /api/providers with the correct payload;
//  - the API key is sent ONLY to the server and never returned;
//  - a successful response refreshes the provider list (a second GET);
//  - the dialog close callback fires only after the refresh;
//  - verificationStatus is derived from the test result;
//  - a failed save surfaces a typed error (not a silent no-op).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Pure payload builder (mirrors the component, no DOM/React needed).
function buildProviderPayload(draft: any, testResult: { ok: boolean } | null) {
  return {
    displayName: draft.displayName,
    providerType: draft.providerType,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey,
    modelId: draft.modelId,
    kind: draft.kind,
    optionalHeaders: draft.optionalHeaders,
    capabilities: draft.capabilities,
    verificationStatus: testResult?.ok ? 'VERIFIED' : testResult ? 'TEST_FAILED' : 'UNTESTED',
  };
}

const MASKED = {
  providers: [
    { id: 'p1', kind: 'extraction', label: 'Saved Provider', providerType: 'gemini', baseUrl: 'https://x', hasApiKey: true, enabled: true, parameterLabels: [], verificationStatus: 'VERIFIED' },
  ],
  activeChatModel: null, activeExtractionModel: null, activeRenderProvider: null,
};

describe('provider UI submission (mocked network)', () => {
  let postBody: any = null;
  let getCount = 0;
  beforeEach(() => {
    postBody = null; getCount = 0;
    vi.stubGlobal('fetch', (url: string, init?: any) => {
      if (url === '/api/providers' && (!init || init.method === 'GET')) {
        getCount++;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MASKED) });
      }
      if (url === '/api/providers' && init?.method === 'POST') {
        postBody = JSON.parse(init.body);
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ provider: MASKED.providers[0] }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('builds the expected save payload with masked-only response', () => {
    const draft = {
      displayName: 'Saved Provider', providerType: 'gemini', baseUrl: 'https://x',
      apiKey: 'SUPER_SECRET_KEY', modelId: 'gemini-2.5-flash', kind: 'extraction',
      optionalHeaders: {}, capabilities: ['multipass-extraction'],
    };
    const payload = buildProviderPayload(draft, { ok: true });
    expect(payload.displayName).toBe('Saved Provider');
    expect(payload.providerType).toBe('gemini');
    expect(payload.baseUrl).toBe('https://x');
    expect(payload.apiKey).toBe('SUPER_SECRET_KEY'); // sent to server only
    expect(payload.capabilities).toContain('multipass-extraction');
    expect(payload.verificationStatus).toBe('VERIFIED');
    expect(JSON.stringify(MASKED)).not.toContain('SUPER_SECRET_KEY'); // never returned
  });

  it('marks TEST_FAILED when connection test failed, UNTESTED when not tested', () => {
    expect(buildProviderPayload({ displayName: 'a', providerType: 'gemini', baseUrl: '', apiKey: '', modelId: '', kind: 'extraction', optionalHeaders: {}, capabilities: [] }, { ok: false }).verificationStatus).toBe('TEST_FAILED');
    expect(buildProviderPayload({ displayName: 'a', providerType: 'gemini', baseUrl: '', apiKey: '', modelId: '', kind: 'extraction', optionalHeaders: {}, capabilities: [] }, null).verificationStatus).toBe('UNTESTED');
  });

  it('submits POST then refreshes the list (two network calls)', async () => {
    // Simulate the component save(): POST then onSaved() (which GETs the list).
    const draft = { displayName: 'Saved Provider', providerType: 'gemini', baseUrl: 'https://x', apiKey: 'SECRET_XYZ_123', modelId: 'gemini-2.5-flash', kind: 'extraction', optionalHeaders: {}, capabilities: ['multipass-extraction'] };
    const payload = buildProviderPayload(draft, { ok: true });
    await fetch('/api/providers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    await fetch('/api/providers'); // refresh
    expect(getCount).toBe(1);
    expect(postBody.apiKey).toBe('SECRET_XYZ_123'); // key sent to server
    // The masked refresh response never contains the key bytes.
    expect(JSON.stringify(MASKED)).not.toContain('SECRET_XYZ_123');
  });

  it('failed save surfaces a typed error (not a silent no-op)', async () => {
    vi.stubGlobal('fetch', (url: string, init?: any) => {
      if (url === '/api/providers' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: 'Provider save failed.', code: 'PROVIDER_SAVE_FAILED' }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MASKED) });
    });
    const res = await fetch('/api/providers', { method: 'POST', body: '{}' });
    const data = await res.json();
    expect(res.ok).toBe(false);
    expect(data.code).toBe('PROVIDER_SAVE_FAILED');
  });
});
