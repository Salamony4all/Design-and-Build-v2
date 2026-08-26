// features/ai-extraction/provider-runtime/use-ai-provider-registry.ts
// Hook owning AI extraction provider-registry state: loading, refresh,
// selection mutation, errors, and synchronization status. This is the ONLY
// place that knows the provider API contract for the extraction slot.
// page.tsx / Composer do NOT own these details.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchProviders, selectExtractionModel } from './api';
import type {
  AiProviderRegistryView,
  ModelRef,
  ProviderSummary,
} from './types';

const EMPTY_VIEW: AiProviderRegistryView = {
  providers: [],
  activeExtractionModel: null,
  extractionProviders: [],
  loading: true,
  refreshing: false,
  error: null,
  lastUpdatedAt: null,
};

/**
 * Resolve the active extraction provider summary from the registry response.
 * Explicit pair: match activeExtractionModel.providerId against providers.
 */
export function resolveActiveExtractionProvider(
  providers: ProviderSummary[],
  active: ModelRef | null,
): ProviderSummary | null {
  if (!active?.providerId) return null;
  return providers.find((p) => p.id === active.providerId) ?? null;
}

/**
 * Available models for the explicitly selected extraction provider.
 * Uses customModels from the matched provider only — never inferred globally.
 */
export function resolveAvailableModels(
  provider: ProviderSummary | null,
): string[] {
  if (!provider?.customModels) return [];
  return provider.customModels;
}

export interface AiReadiness {
  canRunAiExtraction: boolean;
  blockingReason: string | null;
}

/**
 * Pure readiness derivation (no React) so it is unit-testable and the hook
 * stays a thin wrapper. Drives AI Extract gating without affecting Geometric.
 */
export function deriveAiExtractionReadiness(
  view: AiProviderRegistryView,
  activeProvider: ProviderSummary | null,
  availableModels: string[],
): AiReadiness {
  if (view.loading) return { canRunAiExtraction: false, blockingReason: 'Synchronizing provider registry' };
  if (view.error && !activeProvider) return { canRunAiExtraction: false, blockingReason: `Provider registry unavailable: ${view.error}` };
  if (!activeProvider) return { canRunAiExtraction: false, blockingReason: 'No AI extraction provider configured' };
  if (availableModels.length === 0) return { canRunAiExtraction: false, blockingReason: 'No models available for this provider' };
  const model = view.activeExtractionModel?.modelId;
  if (!model || !availableModels.includes(model)) return { canRunAiExtraction: false, blockingReason: 'No active model selected' };
  return { canRunAiExtraction: true, blockingReason: null };
}

export interface UseAiProviderRegistry {
  view: AiProviderRegistryView;
  /** The active extraction provider summary, or null. */
  activeProvider: ProviderSummary | null;
  /** Models for the active extraction provider. */
  availableModels: string[];
  /** Derived readiness for AI extraction (single source of truth for gating). */
  canRunAiExtraction: boolean;
  /** Human-readable reason extraction is blocked, or null when ready. */
  blockingReason: string | null;
  /** Trigger a GET /api/providers refresh. */
  refresh: () => Promise<void>;
  /** Persist an explicit providerId+modelId pair, then re-confirm from server. */
  select: (providerId: string, modelId: string) => Promise<void>;
  /** Open the existing ProviderSettingsPanel (host callback). */
  openSettings: () => void;
}

export function useAiProviderRegistry(onOpenSettings: () => void): UseAiProviderRegistry {
  const [view, setView] = useState<AiProviderRegistryView>(EMPTY_VIEW);
  const viewRef = useRef<AiProviderRegistryView>(EMPTY_VIEW);
  viewRef.current = view;

  const apply = useCallback((next: ProviderRegistryLike) => {
    const providers = next.providers ?? [];
    const extractionProviders = providers.filter((p) => p.kind === 'extraction');
    setView((prev) => ({
      ...prev,
      providers,
      activeExtractionModel: next.activeExtractionModel ?? null,
      extractionProviders,
      loading: false,
      refreshing: false,
      lastUpdatedAt: new Date().toISOString(),
    }));
  }, []);

  const refresh = useCallback(async () => {
    setView((prev) => ({ ...prev, refreshing: true, error: null }));
    try {
      const data = await fetchProviders();
      apply(data);
    } catch (e) {
      setView((prev) => ({
        ...prev,
        refreshing: false,
        error: e instanceof Error ? e.message : 'Failed to load providers',
      }));
    }
  }, [apply]);

  const select = useCallback(
    async (providerId: string, modelId: string) => {
      // Preserve the previous server-confirmed selection so a failed mutation
      // never leaves the UI reporting an unconfirmed state.
      const previous = viewRef.current;
      try {
        await selectExtractionModel(providerId, modelId);
        // Re-confirm from server before rendering.
        const data = await fetchProviders();
        apply(data);
      } catch (e) {
        // Restore previous view; surface the error; do NOT report success.
        setView({
          ...previous,
          refreshing: false,
          error: e instanceof Error ? e.message : 'Failed to update selection',
        });
      }
    },
    [apply],
  );

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeProvider = useMemo(
    () => resolveActiveExtractionProvider(view.providers, view.activeExtractionModel),
    [view.providers, view.activeExtractionModel],
  );
  const availableModels = useMemo(
    () => resolveAvailableModels(activeProvider),
    [activeProvider],
  );

  // Single readiness derivation for AI extraction gating (pure, testable).
  const { canRunAiExtraction, blockingReason } = useMemo(
    () => deriveAiExtractionReadiness(view, activeProvider, availableModels),
    [view, activeProvider, availableModels],
  );

  return {
    view,
    activeProvider,
    availableModels,
    canRunAiExtraction,
    blockingReason,
    refresh,
    select,
    openSettings: onOpenSettings,
  };
}

// Local alias to avoid importing the server response type name directly.
type ProviderRegistryLike = {
  providers?: ProviderSummary[];
  activeExtractionModel?: ModelRef | null;
};
