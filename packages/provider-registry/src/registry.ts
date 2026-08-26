// design-build-provider-registry
// Server-side persisted provider management (§3, §11). Preserves the working
// provider capabilities: add / edit / remove / test-connection, custom Base
// URL, API key, selected model, custom model ID, provider-specific headers,
// Gemini-native + OpenAI-compatible branches, THREE independent active
// selections (chat / extraction / render). Persistence is a JSON file on the
// server (never shipped to the browser). API keys stay server-side; the client
// only ever receives a masked ProviderSummary.

export type ProviderKind = 'chat' | 'extraction' | 'render';
export type ProviderType = 'gemini' | 'openai-compatible';

export interface ProviderParameter {
  key: string;
  label: string;
  value: string;
  secret?: boolean;
}

export type ProviderVerificationStatus = 'UNTESTED' | 'VERIFIED' | 'TEST_FAILED';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  providerType: ProviderType;
  baseUrl?: string;
  parameters: ProviderParameter[];
  enabled: boolean;
  customModels?: string[];
  /** Surfaces the last connection-test outcome to the UI (never a secret). */
  verificationStatus?: ProviderVerificationStatus;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface ProviderRegistryState {
  providers: ProviderConfig[];
  activeChatModel: ModelRef | null;
  activeExtractionModel: ModelRef | null;
  activeRenderProvider: ModelRef | null;
}

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
  verificationStatus?: ProviderVerificationStatus;
}

const KEY_PARAM = 'apiKey';

export function createEmptyRegistry(): ProviderRegistryState {
  return { providers: [], activeChatModel: null, activeExtractionModel: null, activeRenderProvider: null };
}

export function addProvider(state: ProviderRegistryState, p: ProviderConfig): ProviderRegistryState {
  return { ...state, providers: [...state.providers.filter((x) => x.id !== p.id), p] };
}

export function editProvider(state: ProviderRegistryState, id: string, patch: Partial<ProviderConfig>): ProviderRegistryState {
  return { ...state, providers: state.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

export function removeProvider(state: ProviderRegistryState, id: string): ProviderRegistryState {
  return {
    ...state,
    providers: state.providers.filter((p) => p.id !== id),
    activeChatModel: state.activeChatModel?.providerId === id ? null : state.activeChatModel,
    activeExtractionModel: state.activeExtractionModel?.providerId === id ? null : state.activeExtractionModel,
    activeRenderProvider: state.activeRenderProvider?.providerId === id ? null : state.activeRenderProvider,
  };
}

export function selectModel(state: ProviderRegistryState, slot: ProviderKind, ref: ModelRef | null): ProviderRegistryState {
  if (slot === 'chat') return { ...state, activeChatModel: ref };
  if (slot === 'extraction') return { ...state, activeExtractionModel: ref };
  return { ...state, activeRenderProvider: ref };
}

export function getProvider(state: ProviderRegistryState, id: string): ProviderConfig | undefined {
  return state.providers.find((p) => p.id === id);
}

/** Server-only: resolves the secret API key. Never returned to the client. */
export function getApiKey(state: ProviderRegistryState, providerId: string): string | undefined {
  return getProvider(state, providerId)?.parameters.find((p) => p.key === KEY_PARAM)?.value;
}

/** Resolves all non-secret parameters + headers for server-side runtime use. */
export function getResolvedParameters(state: ProviderRegistryState, providerId: string): Record<string, string> {
  const p = getProvider(state, providerId);
  if (!p) return {};
  const out: Record<string, string> = {};
  for (const param of p.parameters) {
    if (param.secret) continue; // server resolves secrets separately
    out[param.key] = param.value;
  }
  return out;
}

/** Masked view for the client: key presence only, never the key bytes. */
export function toSummary(p: ProviderConfig): ProviderSummary {
  return {
    id: p.id,
    kind: p.kind,
    label: p.label,
    providerType: p.providerType,
    ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
    hasApiKey: p.parameters.some((x) => x.key === KEY_PARAM && x.value.length > 0),
    enabled: p.enabled,
    ...(p.customModels ? { customModels: p.customModels } : {}),
    parameterLabels: p.parameters.filter((x) => !x.secret).map((x) => x.key),
    ...(p.verificationStatus ? { verificationStatus: p.verificationStatus } : {}),
  };
}

export function summarize(state: ProviderRegistryState): ProviderSummary[] {
  return state.providers.map(toSummary);
}
