// features/ai-extraction/components/AiExtractionControls.tsx
// Compact, registry-driven AI extraction control rendered inline in the chat
// composer. It owns NO fetching/persistence — those live in the
// useAiProviderRegistry hook. It shows a small provider glyph + a single model
// dropdown (the "dropdownlist in the chat box" the user asked for) plus a tiny
// verification dot. It never shows raw API keys.

'use client';
import React from 'react';
import type { ProviderSummary, ProviderVerificationStatus } from '../provider-runtime/types';

export interface AiExtractionControlsProps {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** All extraction-capable providers (lets the user pick one on the landing). */
  providers: ProviderSummary[];
  activeProvider: ProviderSummary | null;
  activeModel: string | null;
  availableModels: string[];
  onSelectModel: (providerId: string, modelId: string) => void;
  onOpenSettings: () => void;
}

function statusDotClass(s: ProviderVerificationStatus | undefined): string {
  if (s === 'VERIFIED') return 'ai-dot ai-dot--ok';
  if (s === 'TEST_FAILED') return 'ai-dot ai-dot--fail';
  return 'ai-dot ai-dot--untested';
}

// Small provider glyph — Gemini for native, a generic chip otherwise.
function ProviderGlyph({ provider }: { provider: ProviderSummary | null }) {
  const isGemini = provider?.providerType === 'gemini';
  return (
    <span className="ai-glyph" aria-hidden="true" title={isGemini ? 'Gemini' : 'AI provider'}>
      {isGemini ? '✦' : '◈'}
    </span>
  );
}

export function AiExtractionControls(props: AiExtractionControlsProps) {
  const {
    loading,
    error,
    providers,
    activeProvider,
    activeModel,
    availableModels,
    onSelectModel,
    onOpenSettings,
  } = props;

  // Registry still loading.
  if (loading) {
    return (
      <span className="ai-extraction-controls ai-extraction-controls--inline" role="status" aria-live="polite">
        <ProviderGlyph provider={null} />
        <span className="ai-extraction-controls__sync">syncing…</span>
      </span>
    );
  }

  // No provider configured at all → tiny setup chip (no big card).
  if (!activeProvider) {
    return (
      <span className="ai-extraction-controls ai-extraction-controls--inline">
        <ProviderGlyph provider={null} />
        <button type="button" className="ai-setup-chip" onClick={onOpenSettings}>
          Set up AI
        </button>
      </span>
    );
  }

  // Provider present but no models discovered.
  if (availableModels.length === 0) {
    return (
      <span className="ai-extraction-controls ai-extraction-controls--inline">
        <ProviderGlyph provider={activeProvider} />
        <span className="ai-extraction-controls__sync">no models</span>
        <button type="button" className="ai-setup-chip" onClick={onOpenSettings}>Configure</button>
      </span>
    );
  }

  // Compact: glyph + dynamic multi-provider model dropdown + status dot.
  const extractionProviders = providers && providers.length > 0
    ? providers.filter((p) => p.kind === 'extraction' && p.enabled)
    : (activeProvider ? [activeProvider] : []);

  const hasMultipleProviders = extractionProviders.length > 1;
  const currentKey = activeProvider && activeModel ? `${activeProvider.id}::${activeModel}` : '';

  return (
    <span className="ai-extraction-controls ai-extraction-controls--inline" aria-label="AI extraction model">
      <ProviderGlyph provider={activeProvider} />
      <select
        className="ai-model-select"
        aria-label="extraction model"
        value={currentKey}
        onChange={(e) => {
          const val = e.target.value;
          if (val.includes('::')) {
            const [pId, mId] = val.split('::');
            if (pId && mId) onSelectModel(pId, mId);
          }
        }}
      >
        {extractionProviders.map((p) => {
          const pModels = (p.customModels && p.customModels.length > 0) ? p.customModels : availableModels;
          if (hasMultipleProviders) {
            return (
              <optgroup key={p.id} label={p.label || (p.providerType === 'gemini' ? 'Google Gemini' : 'AI Provider')}>
                {pModels.map((m) => (
                  <option key={`${p.id}::${m}`} value={`${p.id}::${m}`}>
                    {m}
                  </option>
                ))}
              </optgroup>
            );
          }
          return pModels.map((m) => (
            <option key={`${p.id}::${m}`} value={`${p.id}::${m}`}>
              {m}
            </option>
          ));
        })}
      </select>
      <span className={statusDotClass(activeProvider.verificationStatus)} title={activeProvider.verificationStatus ?? 'UNTESTED'} />
      <button
        type="button"
        className="ai-settings-gear-btn"
        title="Open AI Provider Settings"
        onClick={(e) => {
          e.stopPropagation();
          onOpenSettings();
        }}
      >
        ⚙️
      </button>
      {error && <span className="ai-extraction-controls__error" role="alert">{error}</span>}
    </span>
  );
}

export default AiExtractionControls;
