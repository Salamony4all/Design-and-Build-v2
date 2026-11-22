// features/ai-extraction/components/AiExtractionControls.tsx
// Compact, Gemini-styled AI model selector rendered inline in the chat bar.
// Formats active model cleanly (e.g. Flash ⌵, Gemini 2.5 ⌵, Claude 3.7 ⌵).

'use client';
import React from 'react';
import { Sparkles, Settings2, ChevronDown } from 'lucide-react';
import type { ProviderSummary, ProviderVerificationStatus } from '../provider-runtime/types';

export interface AiExtractionControlsProps {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** All extraction-capable providers. */
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

function formatModelLabel(modelId: string | null): string {
  if (!modelId) return 'Model';
  if (modelId.includes('gemini-2.5-flash')) return 'Flash 2.5';
  if (modelId.includes('gemini-2.5-pro')) return 'Pro 2.5';
  if (modelId.includes('gemini-2.0-flash')) return 'Flash 2.0';
  if (modelId.includes('gpt-4o-mini')) return 'GPT-4o mini';
  if (modelId.includes('gpt-4o')) return 'GPT-4o';
  if (modelId.includes('claude-3-7')) return 'Claude 3.7';
  if (modelId.includes('claude-3-5')) return 'Claude 3.5';
  if (modelId.includes('llama-3.3')) return 'Llama 3.3';
  return modelId.split('/').pop()?.replace(/^models\//, '') || modelId;
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
      <span className="db-gemini-model-pill db-gemini-model-pill--loading" role="status">
        <span className="ai-dot ai-dot--untested" />
        <span className="db-gemini-model-label">Syncing…</span>
      </span>
    );
  }

  // No provider configured at all.
  if (!activeProvider) {
    return (
      <button
        type="button"
        className="db-gemini-model-pill db-gemini-model-pill--setup"
        onClick={onOpenSettings}
        title="Set up AI Provider"
      >
        <Sparkles className="w-3 h-3 text-violet-500" />
        <span className="db-gemini-model-label">Connect AI</span>
      </button>
    );
  }

  const extractionProviders = providers && providers.length > 0
    ? providers.filter((p) => p.kind === 'extraction' && p.enabled)
    : (activeProvider ? [activeProvider] : []);

  const hasMultipleProviders = extractionProviders.length > 1;
  const currentKey = activeProvider && activeModel ? `${activeProvider.id}::${activeModel}` : '';

  return (
    <div className="db-gemini-model-wrapper" aria-label="AI extraction model">
      <div className="db-gemini-model-pill" title={`Active: ${activeModel || 'Default model'}`}>
        <span className={statusDotClass(activeProvider.verificationStatus)} title={`Status: ${activeProvider.verificationStatus ?? 'UNTESTED'}`} />
        <span className="db-gemini-model-label">{formatModelLabel(activeModel)}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        <select
          className="db-gemini-model-select-overlay"
          aria-label="Select AI model"
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
      </div>
      <button
        type="button"
        className="db-gemini-settings-btn"
        title="Open AI Studio & Provider Settings"
        onClick={(e) => {
          e.stopPropagation();
          onOpenSettings();
        }}
      >
        <Settings2 className="w-3.5 h-3.5" />
      </button>
      {error && <span className="ai-extraction-controls__error" role="alert">{error}</span>}
    </div>
  );
}

export default AiExtractionControls;
