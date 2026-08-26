// features/ai-extraction/provider-runtime/types.ts
// Frontend types derived ONLY from the GET /api/providers safe summary contract.
// The server never returns raw API keys — ProviderSummary exposes `hasApiKey`
// (boolean presence) only. See packages/provider-registry/src/registry.ts
// (toSummary) for the authoritative server shape.

export type ProviderType = 'gemini' | 'openai-compatible';
export type ProviderKind = 'chat' | 'extraction' | 'render';
export type ProviderVerificationStatus = 'UNTESTED' | 'VERIFIED' | 'TEST_FAILED';

/** Masked provider view returned by GET /api/providers. Mirrors server ProviderSummary. */
export interface ProviderSummary {
  id: string;
  kind: ProviderKind;
  /** The API uses `label` (NOT `name`) for the display name. */
  label: string;
  providerType: ProviderType;
  baseUrl?: string;
  hasApiKey: boolean;
  enabled: boolean;
  customModels?: string[];
  parameterLabels: string[];
  verificationStatus?: ProviderVerificationStatus;
}

/** Explicit provider+model pair. Never inferred from a model string. */
export interface ModelRef {
  providerId: string;
  modelId: string;
}

/** Response body of GET /api/providers. */
export interface ProviderRegistryResponse {
  providers: ProviderSummary[];
  activeChatModel: ModelRef | null;
  activeExtractionModel: ModelRef | null;
  activeRenderProvider: ModelRef | null;
}

/** Selection mutation request body for POST /api/providers/select. */
export interface SelectModelRequest {
  slot: ProviderKind;
  providerId: string;
  modelId: string;
}

/** Single-source-of-truth view consumed by the landing AI controls. */
export interface AiProviderRegistryView {
  providers: ProviderSummary[];
  activeExtractionModel: ModelRef | null;
  /** Providers eligible for the extraction slot (kind === 'extraction'), per registry. */
  extractionProviders: ProviderSummary[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdatedAt: string | null;
}
