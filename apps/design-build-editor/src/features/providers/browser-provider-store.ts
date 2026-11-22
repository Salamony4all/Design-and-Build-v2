// features/providers/browser-provider-store.ts
// Browser-held AI provider registry, the same model as BOQ Flow: providers and
// their API keys live in this browser's localStorage and travel to our own
// server only inside the request that needs them (header `x-db-provider`).
// Nothing is persisted on the server, so it works on Vercel's read-only
// filesystem and every user brings their own key.
//
// `providerFetch` is a drop-in for `fetch` used by the provider UI: it answers
// the /api/providers* calls from localStorage and forwards everything else.
// Providers kept by a local dev server (.data/provider-registry.json) are
// merged into the list so local development keeps working unchanged.

export type ProviderKind = 'chat' | 'extraction' | 'render';
export type ProviderType = 'gemini' | 'openai-compatible';
export type VerificationStatus = 'UNTESTED' | 'VERIFIED' | 'TEST_FAILED';

export interface StoredParameter {
  key: string;
  label: string;
  value: string;
  secret?: boolean;
}

export interface StoredProvider {
  id: string;
  kind: ProviderKind;
  label: string;
  providerType: ProviderType;
  baseUrl?: string;
  parameters: StoredParameter[];
  enabled: boolean;
  customModels?: string[];
  verificationStatus?: VerificationStatus;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface BrowserRegistry {
  providers: StoredProvider[];
  activeChatModel: ModelRef | null;
  activeExtractionModel: ModelRef | null;
  activeRenderProvider: ModelRef | null;
}

/** Masked view returned to the UI (same contract as GET /api/providers). */
export interface ProviderSummary {
  id: string;
  kind: ProviderKind;
  label: string;
  providerType: ProviderType;
  baseUrl?: string;
  hasApiKey: boolean;
  enabled: boolean;
  customModels?: string[];
  parameterLabels: string[];
  verificationStatus?: VerificationStatus;
  /** Where the provider lives: this browser, or a local dev server. */
  storage?: 'browser' | 'server';
}

export const STORAGE_KEY = 'db.provider-registry.v1';
export const PROVIDER_HEADER = 'x-db-provider';
const KEY_PARAM = 'apiKey';
const LOCAL_ID_PREFIX = 'bprov_';

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True in a browser; tests and the server fall through to plain fetch. */
export function hasBrowserStore(): boolean {
  return storage() !== null;
}

export function emptyRegistry(): BrowserRegistry {
  return { providers: [], activeChatModel: null, activeExtractionModel: null, activeRenderProvider: null };
}

export function loadBrowserRegistry(): BrowserRegistry {
  const s = storage();
  if (!s) return emptyRegistry();
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return emptyRegistry();
    const parsed = JSON.parse(raw) as Partial<BrowserRegistry>;
    return {
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      activeChatModel: parsed.activeChatModel ?? null,
      activeExtractionModel: parsed.activeExtractionModel ?? null,
      activeRenderProvider: parsed.activeRenderProvider ?? null,
    };
  } catch {
    return emptyRegistry();
  }
}

export function saveBrowserRegistry(state: BrowserRegistry): void {
  const s = storage();
  if (!s) throw new Error('Browser storage is not available, so providers cannot be saved.');
  s.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function isBrowserProviderId(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX);
}

function apiKeyOf(p: StoredProvider): string {
  return p.parameters.find((x) => x.key === KEY_PARAM)?.value ?? '';
}

export function toSummary(p: StoredProvider, storageKind: 'browser' | 'server' = 'browser'): ProviderSummary {
  return {
    id: p.id,
    kind: p.kind,
    label: p.label,
    providerType: p.providerType,
    ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
    hasApiKey: apiKeyOf(p).length > 0,
    enabled: p.enabled,
    ...(p.customModels ? { customModels: p.customModels } : {}),
    parameterLabels: p.parameters.filter((x) => !x.secret).map((x) => x.key),
    ...(p.verificationStatus ? { verificationStatus: p.verificationStatus } : {}),
    storage: storageKind,
  };
}

interface DraftInput {
  displayName?: string;
  label?: string;
  kind?: string;
  providerType?: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
  customModels?: unknown[];
  modelId?: string;
  verificationStatus?: string;
}

function mergedModels(input: DraftInput, base?: string[]): string[] | undefined {
  const out: string[] = [...(base ?? [])];
  if (Array.isArray(input.customModels)) out.push(...input.customModels.map(String));
  if (input.modelId) out.push(String(input.modelId));
  return out.length ? Array.from(new Set(out)) : undefined;
}

/** Same mapping as the server's POST /api/providers. */
export function buildProvider(input: DraftInput, id: string): StoredProvider {
  const kind: ProviderKind = input.kind === 'chat' || input.kind === 'render' ? input.kind : 'extraction';
  const providerType: ProviderType = input.providerType === 'openai-compatible' ? 'openai-compatible' : 'gemini';
  const key = input.apiKey ? String(input.apiKey) : '';
  const p: StoredProvider = {
    id,
    kind,
    label: String(input.displayName || input.label || id),
    providerType,
    ...(input.baseUrl ? { baseUrl: String(input.baseUrl) } : {}),
    parameters: [{ key: KEY_PARAM, label: 'API Key', value: key, secret: true }],
    enabled: input.enabled !== false,
  };
  const models = mergedModels(input);
  if (models) p.customModels = models;
  if (input.verificationStatus === 'UNTESTED' || input.verificationStatus === 'VERIFIED' || input.verificationStatus === 'TEST_FAILED') {
    p.verificationStatus = input.verificationStatus;
  }
  return p;
}

/** Same rules as the server's PUT /api/providers/:id: a blank key keeps the stored one. */
export function patchProvider(existing: StoredProvider, input: DraftInput): StoredProvider {
  const params = existing.parameters.map((x) => ({ ...x }));
  if (input.apiKey) {
    const k = params.find((x) => x.key === KEY_PARAM);
    if (k) k.value = String(input.apiKey);
    else params.push({ key: KEY_PARAM, label: 'API Key', value: String(input.apiKey), secret: true });
  }
  const next: StoredProvider = {
    ...existing,
    label: input.displayName !== undefined ? String(input.displayName) : existing.label,
    providerType: input.providerType === 'openai-compatible' ? 'openai-compatible' : input.providerType === 'gemini' ? 'gemini' : existing.providerType,
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : existing.enabled,
    parameters: params,
  };
  if (input.baseUrl !== undefined) {
    if (input.baseUrl === '') delete next.baseUrl;
    else next.baseUrl = String(input.baseUrl);
  }
  const models = mergedModels(input);
  if (models) next.customModels = models;
  if (input.verificationStatus === 'UNTESTED' || input.verificationStatus === 'VERIFIED' || input.verificationStatus === 'TEST_FAILED') {
    next.verificationStatus = input.verificationStatus;
  }
  return next;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function selections(st: BrowserRegistry) {
  return {
    activeChatModel: st.activeChatModel,
    activeExtractionModel: st.activeExtractionModel,
    activeRenderProvider: st.activeRenderProvider,
  };
}

async function serverList(): Promise<{ providers: ProviderSummary[] } & ReturnType<typeof selections>> {
  try {
    const res = await fetch('/api/providers', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { providers?: ProviderSummary[] } & Partial<ReturnType<typeof selections>>;
    return {
      providers: (data.providers ?? []).map((p) => ({ ...p, storage: 'server' as const })),
      activeChatModel: data.activeChatModel ?? null,
      activeExtractionModel: data.activeExtractionModel ?? null,
      activeRenderProvider: data.activeRenderProvider ?? null,
    };
  } catch {
    return { providers: [], ...selections(emptyRegistry()) };
  }
}

type SlotKey = 'activeChatModel' | 'activeExtractionModel' | 'activeRenderProvider';

function slotKey(slot: unknown): SlotKey {
  return slot === 'chat' ? 'activeChatModel' : slot === 'render' ? 'activeRenderProvider' : 'activeExtractionModel';
}

/** This browser's providers plus any a local dev server keeps; browser selections win. */
async function mergedView(): Promise<{ providers: ProviderSummary[] } & ReturnType<typeof selections>> {
  const st = loadBrowserRegistry();
  const server = await serverList();
  const local = st.providers.map((p) => toSummary(p, 'browser'));
  const known = new Set(local.map((p) => p.id));
  const providers = [...local, ...server.providers.filter((p) => !known.has(p.id))];
  const valid = (ref: ModelRef | null) => (ref && providers.some((p) => p.id === ref.providerId) ? ref : null);
  return {
    providers,
    activeChatModel: valid(st.activeChatModel) ?? valid(server.activeChatModel),
    activeExtractionModel: valid(st.activeExtractionModel) ?? valid(server.activeExtractionModel),
    activeRenderProvider: valid(st.activeRenderProvider) ?? valid(server.activeRenderProvider),
  };
}

function parseBody(init?: RequestInit): DraftInput & Record<string, unknown> {
  try {
    return typeof init?.body === 'string' ? (JSON.parse(init.body) as DraftInput & Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Drop-in `fetch` for the provider UI. In the browser it serves the provider
 * registry from localStorage; on the server and in tests it is plain `fetch`.
 */
export async function providerFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!hasBrowserStore()) return fetch(url, init);
  const method = (init?.method ?? 'GET').toUpperCase();
  const path = url.split('?')[0];

  if (path === '/api/providers' && method === 'GET') return json(await mergedView());

  if (path === '/api/providers' && method === 'POST') {
    const body = parseBody(init);
    if (!body.displayName || !body.providerType) return json({ error: 'displayName and providerType are required.', code: 'invalid-input' }, 400);
    const st = loadBrowserRegistry();
    const id = `${LOCAL_ID_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const p = buildProvider(body, id);
    saveBrowserRegistry({ ...st, providers: [...st.providers, p] });
    return json({ provider: toSummary(p) }, 201);
  }

  const idMatch = /^\/api\/providers\/([^/]+)$/.exec(path);
  if (idMatch && idMatch[1] !== 'select' && idMatch[1] !== 'test') {
    const id = decodeURIComponent(idMatch[1]);
    if (!isBrowserProviderId(id)) return fetch(url, init); // a local dev server's provider
    const st = loadBrowserRegistry();
    const existing = st.providers.find((p) => p.id === id);
    if (!existing) return json({ error: 'Provider not found.', code: 'not-found' }, 404);
    if (method === 'DELETE') {
      const drop = (r: ModelRef | null) => (r?.providerId === id ? null : r);
      saveBrowserRegistry({
        providers: st.providers.filter((p) => p.id !== id),
        activeChatModel: drop(st.activeChatModel),
        activeExtractionModel: drop(st.activeExtractionModel),
        activeRenderProvider: drop(st.activeRenderProvider),
      });
      return json({ ok: true });
    }
    if (method === 'PUT' || method === 'PATCH') {
      const next = patchProvider(existing, parseBody(init));
      saveBrowserRegistry({ ...st, providers: st.providers.map((p) => (p.id === id ? next : p)) });
      return json({ provider: toSummary(next) });
    }
  }

  if (path === '/api/providers/select') {
    if (method === 'GET') {
      const v = await mergedView();
      return json({ activeChatModel: v.activeChatModel, activeExtractionModel: v.activeExtractionModel, activeRenderProvider: v.activeRenderProvider });
    }
    const body = parseBody(init) as { slot?: string; providerId?: string; modelId?: string };
    if (!body.providerId || !body.modelId) return json({ error: 'providerId and modelId are required.', code: 'invalid-input' }, 400);
    const st = loadBrowserRegistry();
    const next: BrowserRegistry = { ...st };
    if (isBrowserProviderId(body.providerId)) {
      if (!st.providers.some((p) => p.id === body.providerId)) return json({ error: 'Provider not found.', code: 'not-found' }, 404);
      next[slotKey(body.slot)] = { providerId: String(body.providerId), modelId: String(body.modelId) };
    } else {
      // A local dev server's provider: that server keeps the selection, as before.
      const res = await fetch(url, init);
      if (!res.ok) return res;
      next[slotKey(body.slot)] = null;
    }
    saveBrowserRegistry(next);
    const v = await mergedView();
    return json({ activeChatModel: v.activeChatModel, activeExtractionModel: v.activeExtractionModel, activeRenderProvider: v.activeRenderProvider });
  }

  if (path === '/api/providers/test' && method === 'POST') {
    // The test runs on our server (no CORS limits); add the stored key when
    // editing a browser provider and the key field was left blank.
    const body = parseBody(init) as Record<string, unknown>;
    if (!body.apiKey && typeof body.providerId === 'string' && isBrowserProviderId(body.providerId)) {
      const p = loadBrowserRegistry().providers.find((x) => x.id === body.providerId);
      if (p) {
        body.apiKey = apiKeyOf(p);
        delete body.providerId;
      }
    }
    return fetch(url, { ...init, body: JSON.stringify(body) });
  }

  return fetch(url, init);
}

export interface RequestProviderPayload {
  providerId?: string;
  modelId?: string;
  providerType?: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  label?: string;
}

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Header carrying this browser's provider (and its key) for one request. Empty
 * when the provider for the slot is kept by a local dev server instead, which
 * then uses its own registry exactly as before.
 */
export function providerRequestHeaders(slot: ProviderKind): Record<string, string> {
  if (!hasBrowserStore()) return {};
  const st = loadBrowserRegistry();
  const byId = (id?: string) => (id ? st.providers.find((x) => x.id === id) : undefined);
  const pick = (p: StoredProvider, modelId?: string): RequestProviderPayload => {
    const key = p.enabled ? apiKeyOf(p) : '';
    return {
      providerId: p.id,
      ...(modelId ? { modelId } : {}),
      providerType: p.providerType,
      ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
      ...(key ? { apiKey: key } : {}),
      headers: Object.fromEntries(p.parameters.filter((x) => !x.secret).map((x) => [x.key, x.value])),
      label: p.label,
    };
  };
  let payload: RequestProviderPayload | null = null;
  if (slot === 'render') {
    // Render needs a Gemini key: the render pick, then the extraction pick,
    // then any other Gemini provider kept in this browser.
    const p = [byId(st.activeRenderProvider?.providerId), byId(st.activeExtractionModel?.providerId), ...st.providers].find(
      (x): x is StoredProvider => !!x && x.enabled && x.providerType === 'gemini' && apiKeyOf(x).length > 0,
    );
    if (p) payload = pick(p);
  } else {
    const ref = slot === 'chat' ? st.activeChatModel ?? st.activeExtractionModel : st.activeExtractionModel;
    const p = byId(ref?.providerId);
    if (ref && p) payload = pick(p, ref.modelId);
  }
  if (!payload) return {};
  return { [PROVIDER_HEADER]: toBase64(JSON.stringify(payload)) };
}
