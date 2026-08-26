// features/ai-extraction/index.ts
// Public surface of the isolated AI extraction feature. The landing Composer
// and page.tsx import ONLY from here — they never reach into provider-runtime
// internals or the server provider-registry implementation.

export { useAiProviderRegistry, resolveActiveExtractionProvider, resolveAvailableModels, deriveAiExtractionReadiness } from './provider-runtime/use-ai-provider-registry';
export { fetchProviders, selectExtractionModel } from './provider-runtime/api';
export { AiExtractionControls } from './components/AiExtractionControls';
export type {
  AiProviderRegistryView,
  ModelRef,
  ProviderSummary,
  ProviderType,
  ProviderKind,
  ProviderVerificationStatus,
  ProviderRegistryResponse,
  SelectModelRequest,
} from './provider-runtime/types';
export type { UseAiProviderRegistry } from './provider-runtime/use-ai-provider-registry';
export type { AiExtractionControlsProps } from './components/AiExtractionControls';
