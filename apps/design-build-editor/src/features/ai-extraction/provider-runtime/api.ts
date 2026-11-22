// features/ai-extraction/provider-runtime/api.ts
// Thin client for the provider registry. In the browser the registry (and the
// keys) live in localStorage — see features/providers/browser-provider-store;
// on the server and in tests these calls go to the HTTP API. No server-only
// provider-registry code is imported here. Types are local (type-only) and
// derived from the GET /api/providers response contract.

import type {
  ProviderRegistryResponse,
  SelectModelRequest,
  ModelRef,
} from './types';

import { providerFetch } from '../../providers/browser-provider-store';

const PROVIDERS_URL = '/api/providers';
const SELECT_URL = '/api/providers/select';

async function getJson<T>(url: string): Promise<T> {
  const res = await providerFetch(url, { method: 'GET', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await providerFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** GET /api/providers — masked provider list + active selections. */
export async function fetchProviders(): Promise<ProviderRegistryResponse> {
  return getJson<ProviderRegistryResponse>(PROVIDERS_URL);
}

/** POST /api/providers/select — persist an explicit providerId+modelId pair. */
export async function selectExtractionModel(
  providerId: string,
  modelId: string,
): Promise<{ activeChatModel: ModelRef | null; activeExtractionModel: ModelRef | null; activeRenderProvider: ModelRef | null }> {
  const body: SelectModelRequest = { slot: 'extraction', providerId, modelId };
  return postJson(SELECT_URL, body);
}
