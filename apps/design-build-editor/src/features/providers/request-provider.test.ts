// Server side of the browser-held registry: the x-db-provider header.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_HEADER, readRequestProvider, safeBaseUrl } from './request-provider';

const header = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const req = (value?: string) =>
  new Request('http://localhost/api/render', value === undefined ? {} : { headers: { [PROVIDER_HEADER]: value } });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readRequestProvider', () => {
  it('reads a provider sent by the browser', () => {
    const got = readRequestProvider(req(header({ providerId: 'bprov_a', modelId: 'gemini-2.5-pro', providerType: 'gemini', apiKey: 'k1', label: 'Mine', headers: { 'x-a': '1' } })));
    expect(got).toEqual({ providerId: 'bprov_a', modelId: 'gemini-2.5-pro', providerType: 'gemini', apiKey: 'k1', label: 'Mine', headers: { 'x-a': '1' } });
  });

  it('ignores a missing, malformed, oversized or empty header', () => {
    expect(readRequestProvider(req())).toBeNull();
    expect(readRequestProvider(req('not base64 json'))).toBeNull();
    expect(readRequestProvider(req('A'.repeat(24_001)))).toBeNull();
    expect(readRequestProvider(req(header({ providerType: 'gemini' })))).toBeNull();
  });

  it('only keeps base URLs the server may call', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const base = (baseUrl: string) => readRequestProvider(req(header({ apiKey: 'k', providerType: 'openai-compatible', baseUrl })))?.baseUrl;
    expect(base('https://api.example.com/v1')).toBe('https://api.example.com/v1');
    expect(base('http://api.example.com/v1')).toBeUndefined();
    expect(base('https://169.254.169.254/latest')).toBeUndefined();
    expect(base('https://10.0.0.5/v1')).toBeUndefined();
    expect(base('http://localhost:11434/v1')).toBeUndefined();
  });
});

describe('safeBaseUrl', () => {
  it('allows a local model server only in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(safeBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    vi.stubEnv('NODE_ENV', 'production');
    expect(safeBaseUrl('http://localhost:11434/v1')).toBeUndefined();
  });

  it('refuses private networks and non-URLs', () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const u of ['https://192.168.1.10', 'https://172.20.0.1', 'https://[::1]', 'https://db.internal', 'https://printer.local', 'nonsense', '']) {
      expect(safeBaseUrl(u)).toBeUndefined();
    }
    expect(safeBaseUrl('https://generativelanguage.googleapis.com')).toBe('https://generativelanguage.googleapis.com');
  });
});
