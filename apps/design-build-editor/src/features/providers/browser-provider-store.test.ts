// Browser-held provider registry: keys live in localStorage and travel only
// inside the request that needs them (header x-db-provider).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROVIDER_HEADER,
  STORAGE_KEY,
  loadBrowserRegistry,
  providerFetch,
  providerRequestHeaders,
} from './browser-provider-store';
import { readRequestProvider } from './request-provider';

const FAKE_KEY = 'test-key-not-real-123';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const serverProvider = {
  id: 'prov_server1',
  kind: 'extraction',
  label: 'Dev server Gemini',
  providerType: 'gemini',
  hasApiKey: true,
  enabled: true,
  parameterLabels: [],
};

let serverFetch: ReturnType<typeof vi.fn>;

function post(url: string, body: unknown, method = 'POST') {
  return providerFetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function addBrowserProvider(extra: Record<string, unknown> = {}) {
  const res = await post('/api/providers', { displayName: 'My Gemini', providerType: 'gemini', kind: 'extraction', apiKey: FAKE_KEY, modelId: 'gemini-2.5-pro', ...extra });
  expect(res.status).toBe(201);
  return ((await res.json()) as { provider: { id: string } }).provider.id;
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: memoryStorage() });
  serverFetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/providers') {
      return new Response(JSON.stringify({ providers: [serverProvider], activeChatModel: null, activeExtractionModel: null, activeRenderProvider: null }), { status: 200 });
    }
    if (url === '/api/providers/select') {
      return new Response(JSON.stringify({ activeChatModel: null, activeExtractionModel: JSON.parse(String(init?.body)), activeRenderProvider: null }), { status: 200 });
    }
    if (url === '/api/providers/test') return new Response(JSON.stringify({ ok: true, models: ['m1'] }), { status: 200 });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', serverFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('providerFetch (browser registry)', () => {
  it('creates providers in this browser and never returns the key', async () => {
    const id = await addBrowserProvider();
    expect(id.startsWith('bprov_')).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(FAKE_KEY);

    const res = await providerFetch('/api/providers');
    const text = await res.text();
    expect(text).not.toContain(FAKE_KEY);
    const list = JSON.parse(text) as { providers: Array<{ id: string; storage: string; hasApiKey: boolean }> };
    expect(list.providers.map((p) => [p.id, p.storage])).toEqual([
      [id, 'browser'],
      ['prov_server1', 'server'],
    ]);
    expect(list.providers[0].hasApiKey).toBe(true);
    expect(serverFetch).not.toHaveBeenCalledWith('/api/providers', expect.objectContaining({ method: 'POST' }));
  });

  it('keeps a browser provider selection here and forwards a dev server one', async () => {
    const id = await addBrowserProvider();
    let r = await post('/api/providers/select', { slot: 'extraction', providerId: id, modelId: 'gemini-2.5-pro' });
    expect(((await r.json()) as { activeExtractionModel: unknown }).activeExtractionModel).toEqual({ providerId: id, modelId: 'gemini-2.5-pro' });
    expect(serverFetch.mock.calls.some(([u, i]) => u === '/api/providers/select' && i?.method === 'POST')).toBe(false);

    r = await post('/api/providers/select', { slot: 'extraction', providerId: 'prov_server1', modelId: 'gemini-2.5-flash' });
    expect(r.ok).toBe(true);
    expect(serverFetch.mock.calls.some(([u, i]) => u === '/api/providers/select' && i?.method === 'POST')).toBe(true);
    expect(loadBrowserRegistry().activeExtractionModel).toBeNull();
  });

  it('edits keep the stored key when left blank, and delete clears selections', async () => {
    const id = await addBrowserProvider();
    await post('/api/providers/select', { slot: 'extraction', providerId: id, modelId: 'gemini-2.5-pro' });
    await post(`/api/providers/${id}`, { displayName: 'Renamed', apiKey: '' }, 'PUT');
    let p = loadBrowserRegistry().providers[0];
    expect(p.label).toBe('Renamed');
    expect(p.parameters.find((x) => x.key === 'apiKey')?.value).toBe(FAKE_KEY);

    await post(`/api/providers/${id}`, { apiKey: 'replacement-key-456' }, 'PUT');
    p = loadBrowserRegistry().providers[0];
    expect(p.parameters.find((x) => x.key === 'apiKey')?.value).toBe('replacement-key-456');

    await providerFetch(`/api/providers/${id}`, { method: 'DELETE' });
    expect(loadBrowserRegistry().providers).toHaveLength(0);
    expect(loadBrowserRegistry().activeExtractionModel).toBeNull();
  });

  it('test connection sends the stored key for a browser provider edited with a blank key', async () => {
    const id = await addBrowserProvider();
    await post('/api/providers/test', { providerType: 'gemini', apiKey: '', providerId: id });
    const [, init] = serverFetch.mock.calls.find(([u]) => u === '/api/providers/test')!;
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sent.apiKey).toBe(FAKE_KEY);
    expect(sent.providerId).toBeUndefined();
  });
});

describe('providerRequestHeaders', () => {
  it('sends the selected provider and its key, readable by the server', async () => {
    const id = await addBrowserProvider();
    await post('/api/providers/select', { slot: 'extraction', providerId: id, modelId: 'gemini-2.5-pro' });
    const h = providerRequestHeaders('extraction');
    expect(Object.keys(h)).toEqual([PROVIDER_HEADER]);
    const got = readRequestProvider(new Request('http://localhost/api/extraction/ai', { method: 'POST', headers: h }));
    expect(got).toMatchObject({ providerId: id, modelId: 'gemini-2.5-pro', providerType: 'gemini', apiKey: FAKE_KEY, label: 'My Gemini' });
  });

  it('render uses a Gemini key even when extraction is on another provider type', async () => {
    const oa = await addBrowserProvider({ displayName: 'OpenAI-ish', providerType: 'openai-compatible', baseUrl: 'https://api.example.com/v1', apiKey: 'oa-key' });
    await addBrowserProvider({ displayName: 'Gemini for renders', apiKey: 'gem-key' });
    await post('/api/providers/select', { slot: 'extraction', providerId: oa, modelId: 'gpt-x' });
    const got = readRequestProvider(new Request('http://localhost/api/render', { headers: providerRequestHeaders('render') }));
    expect(got).toMatchObject({ providerType: 'gemini', apiKey: 'gem-key', label: 'Gemini for renders' });
  });

  it('sends nothing when the provider lives on a dev server or there is no browser', async () => {
    expect(providerRequestHeaders('extraction')).toEqual({});
    await post('/api/providers/select', { slot: 'extraction', providerId: 'prov_server1', modelId: 'gemini-2.5-flash' });
    expect(providerRequestHeaders('extraction')).toEqual({});
    vi.unstubAllGlobals();
    expect(providerRequestHeaders('render')).toEqual({});
  });

  it('passes straight through to fetch outside the browser', async () => {
    vi.unstubAllGlobals();
    const f = vi.fn(async () => new Response('{"providers":[]}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await providerFetch('/api/providers', { method: 'GET' });
    expect(f).toHaveBeenCalledWith('/api/providers', { method: 'GET' });
  });
});
