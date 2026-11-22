// features/providers/request-provider.ts
// SERVER side of the browser-held provider registry: reads the provider the
// browser sent with this request (header `x-db-provider`, base64 JSON). The key
// is used for this request only — never stored, logged or echoed back.

export const PROVIDER_HEADER = 'x-db-provider';

export interface RequestProvider {
  providerId?: string;
  modelId?: string;
  providerType: 'gemini' | 'openai-compatible';
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  label?: string;
}

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * A provider base URL the server may call on a visitor's behalf: a public
 * https:// address. Private, link-local and loopback hosts are refused in
 * production; loopback is allowed in local development (e.g. a model server
 * on your own machine).
 */
export function safeBaseUrl(v: unknown): string | undefined {
  const s = str(v, 500);
  if (!s) return undefined;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  if (LOOPBACK.has(host)) return process.env.NODE_ENV !== 'production' && /^https?:$/.test(u.protocol) ? s : undefined;
  if (u.protocol !== 'https:') return undefined;
  const privateHost =
    host === '0.0.0.0' ||
    host.startsWith('[') ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^(10|127)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  return privateHost ? undefined : s;
}

export function readRequestProvider(req: Request): RequestProvider | null {
  const raw = req.headers.get(PROVIDER_HEADER);
  if (!raw || raw.length > 24_000) return null;
  try {
    const j = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    if (j.headers && typeof j.headers === 'object') {
      for (const [k, v] of Object.entries(j.headers as Record<string, unknown>)) {
        if (typeof v === 'string' && k.length <= 100 && v.length <= 2000) headers[k] = v;
      }
    }
    const baseUrl = safeBaseUrl(j.baseUrl);
    const out: RequestProvider = {
      providerType: j.providerType === 'openai-compatible' ? 'openai-compatible' : 'gemini',
      ...(str(j.providerId, 120) ? { providerId: str(j.providerId, 120) } : {}),
      ...(str(j.modelId, 200) ? { modelId: str(j.modelId, 200) } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(str(j.apiKey, 500) ? { apiKey: str(j.apiKey, 500) } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(str(j.label, 120) ? { label: str(j.label, 120) } : {}),
    };
    return out.apiKey || out.providerId ? out : null;
  } catch {
    return null;
  }
}
