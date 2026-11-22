// features/conversation/ProviderSelector.tsx
// Modern AI Studio & Provider Management interface with rich aesthetics,
// preset templates, interactive model discovery, and role assignment.
//
// SECURITY CONTRACT (enforced everywhere here):
//  - The browser only ever receives MASKED ProviderSummary objects (hasApiKey,
//    never the key bytes). API keys are typed into password fields, POSTed to
//    the server, stored server-side, and never returned.
//  - The key is never placed in ChatPanel state, never logged, never written
//    into scene/project JSON, exports, or test evidence.
//  - Selections for chat / extraction / render are INDEPENDENT slots — changing
//    one can never overwrite another.

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Key,
  Globe,
  Bot,
  Eye,
  EyeOff,
  Layers,
  Cpu,
  Check,
  X,
  ShieldCheck,
  Activity,
  Sliders,
  Server,
  Zap,
  Lock,
  MessageSquare,
  Box,
  ChevronRight,
} from 'lucide-react';

export type ProviderType = 'gemini' | 'openai-compatible';
export type ProviderKind = 'chat' | 'extraction' | 'render';

export interface ProviderSummaryView {
  id: string;
  kind: ProviderKind;
  label: string;
  providerType: ProviderType;
  baseUrl?: string;
  hasApiKey: boolean;
  enabled: boolean;
  customModels?: string[];
  parameterLabels?: string[];
  verificationStatus?: 'UNTESTED' | 'VERIFIED' | 'TEST_FAILED';
}

export interface ActiveSelections {
  activeChatModel: { providerId: string; modelId: string } | null;
  activeExtractionModel: { providerId: string; modelId: string } | null;
  activeRenderProvider: { providerId: string; modelId: string } | null;
}

const ALL_CAPS = [
  { id: 'chat', label: 'Chat Copilot', icon: MessageSquare, desc: 'Conversational assistant' },
  { id: 'vision', label: 'Vision Reasoning', icon: Eye, desc: 'Visual inspection' },
  { id: 'multipass-extraction', label: 'BIM Extraction', icon: Layers, desc: 'Structural extraction' },
  { id: 'image-rendering', label: '3D Rendering', icon: Box, desc: 'Photorealistic textures' },
  { id: 'image-editing', label: 'Image Editing', icon: Edit3, desc: 'Spatial refinement' },
] as const;

type Capability = (typeof ALL_CAPS)[number]['id'];

export interface ProviderDraft {
  displayName: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  capabilities: Capability[];
  optionalHeaders: Record<string, string>;
  kind: ProviderKind;
  customModels?: string[];
}

interface PresetOption {
  name: string;
  type: ProviderType;
  baseUrl: string;
  defaultModel: string;
  capabilities: Capability[];
  icon: string;
  description: string;
}

const PRESETS: PresetOption[] = [
  {
    name: 'Google Gemini (Native)',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-flash',
    capabilities: ['chat', 'vision', 'multipass-extraction'],
    icon: '✦',
    description: 'Official Google AI API for high-speed multi-modal reasoning',
  },
  {
    name: 'OpenAI (v1)',
    type: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    capabilities: ['chat', 'vision', 'multipass-extraction'],
    icon: '⚡',
    description: 'Standard OpenAI API endpoint',
  },
  {
    name: 'OpenRouter AI',
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    capabilities: ['chat', 'vision', 'multipass-extraction'],
    icon: '🌐',
    description: 'Universal gateway for Claude, Llama, and Mistral models',
  },
  {
    name: 'Groq Cloud',
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    capabilities: ['chat', 'multipass-extraction'],
    icon: '🚀',
    description: 'Ultra-low latency LPU inference',
  },
  {
    name: 'Local Ollama',
    type: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2-vision',
    capabilities: ['chat', 'vision', 'multipass-extraction'],
    icon: '🦙',
    description: 'Self-hosted local models without cloud egress',
  },
];

function emptyDraft(): ProviderDraft {
  return {
    displayName: '',
    providerType: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: '',
    modelId: '',
    capabilities: ['chat', 'multipass-extraction'],
    optionalHeaders: {},
    kind: 'extraction',
    customModels: [],
  };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `${res.status}`);
  return data as T;
}

function buildProviderPayload(
  draft: ProviderDraft,
  testResult: { ok: boolean } | null,
): {
  displayName: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  kind: ProviderKind;
  optionalHeaders: Record<string, string>;
  capabilities: Capability[];
  verificationStatus: 'UNTESTED' | 'VERIFIED' | 'TEST_FAILED';
  customModels: string[];
} {
  const payload: ReturnType<typeof buildProviderPayload> = {
    displayName: draft.displayName,
    providerType: draft.providerType,
    baseUrl: draft.baseUrl,
    modelId: draft.modelId,
    kind: draft.kind,
    optionalHeaders: draft.optionalHeaders,
    capabilities: draft.capabilities,
    verificationStatus: testResult?.ok ? 'VERIFIED' : testResult ? 'TEST_FAILED' : 'UNTESTED',
    customModels: draft.customModels ?? [],
  };
  if (draft.apiKey && draft.apiKey.trim().length > 0) payload.apiKey = draft.apiKey.trim();
  return payload;
}

// ProviderForm: Rich and intuitive Add / Edit workflow
export function ProviderForm({
  onClose,
  onSaved,
  editId,
  initial,
}: {
  onClose: () => void;
  onSaved: () => void;
  editId?: string | null;
  initial?: ProviderDraft;
}) {
  const [draft, setDraft] = useState<ProviderDraft>(initial ?? emptyDraft());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; models?: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (editId !== undefined || initial) {
      setDraft(initial ?? emptyDraft());
      setTestResult(null);
      setErr(null);
      setRefreshFailed(false);
    }
  }, [editId, initial]);

  function mapError(msg: string): string {
    if (/PROVIDER_ALREADY_EXISTS/.test(msg)) return 'A provider with this name already exists.';
    if (/PROVIDER_VALIDATION_FAILED/.test(msg)) return 'Provider validation failed. Check the name, type, and Base URL.';
    if (/INVALID_BASE_URL/.test(msg)) return 'The Base URL is invalid.';
    if (/PROVIDER_CONNECTION_FAILED/.test(msg)) return 'Provider connection failed. Verify the Base URL and API key.';
    if (/PROVIDER_SAVE_FAILED/.test(msg)) return 'Could not save the provider (server error).';
    if (/PROVIDER_LIST_REFRESH_FAILED/.test(msg)) return 'Provider saved, but the list could not be refreshed.';
    if (/MODEL_NOT_CONFIGURED/.test(msg)) return 'No model configured. Enter or select a model.';
    return msg;
  }

  const set = (patch: Partial<ProviderDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const applyPreset = (p: PresetOption) => {
    set({
      displayName: draft.displayName ? draft.displayName : p.name.split(' (')[0],
      providerType: p.type,
      baseUrl: p.baseUrl,
      capabilities: p.capabilities,
      modelId: p.defaultModel,
    });
  };

  const toggleCap = (c: Capability) =>
    setDraft((d) => ({
      ...d,
      capabilities: d.capabilities.includes(c) ? d.capabilities.filter((x) => x !== c) : [...d.capabilities, c],
    }));

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setErr(null);
    try {
      const res = await api<{ ok: boolean; error?: string; models?: string[] }>('/api/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerType: draft.providerType,
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey,
          providerId: editId ?? undefined,
          optionalHeaders: draft.optionalHeaders,
        }),
      });
      setTestResult(res);
      if (res.ok && res.models?.length) {
        const merged = Array.from(new Set([...(draft.customModels ?? []), ...res.models]));
        set({ customModels: merged });
        if (!draft.modelId) set({ modelId: res.models[0] });
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setTesting(false);
    }
  };

  const refreshModels = async () => {
    setTesting(true);
    setTestResult(null);
    setErr(null);
    try {
      const res = await api<{ ok: boolean; error?: string; models?: string[] }>('/api/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerType: draft.providerType,
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey,
          providerId: editId ?? undefined,
          optionalHeaders: draft.optionalHeaders,
        }),
      });
      if (res.ok && res.models?.length) {
        const merged = Array.from(new Set([...(draft.customModels ?? []), ...res.models]));
        set({ customModels: merged });
        if (!draft.modelId) set({ modelId: res.models[0] });
        setTestResult(res);
      } else {
        setTestResult(res);
        setErr(res.error ? `Model refresh: ${res.error}` : 'No models returned by the provider.');
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setTesting(false);
    }
  };

  const save = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!draft.displayName) return;
    setSaving(true);
    setErr(null);
    setRefreshFailed(false);
    try {
      const payload = buildProviderPayload(draft, testResult);
      let savedId = editId ?? null;
      if (editId) {
        await api(`/api/providers/${editId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        const created = await api<{ provider: { id: string } }>('/api/providers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        savedId = created.provider?.id ?? null;
      }
      if (savedId && draft.kind === 'extraction' && draft.modelId) {
        try {
          await api('/api/providers/select', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ slot: 'extraction', providerId: savedId, modelId: draft.modelId }),
          });
        } catch {
          /* best effort */
        }
      }
      try {
        await onSaved();
        onClose();
      } catch {
        setRefreshFailed(true);
      }
    } catch (e: any) {
      setErr(mapError(e.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="db-modern-form">
      {/* Header bar with Back button */}
      <div className="db-form-header">
        <button type="button" className="db-back-btn" onClick={onClose} aria-label="Back to providers list">
          <X className="w-4 h-4" />
          <span>Back to Providers</span>
        </button>
        <div className="db-form-title-wrap">
          <h3 className="db-form-title">
            <span className="db-sparkle-icon"><Sparkles className="w-4 h-4 text-violet-500" /></span>
            {editId ? 'Edit AI Provider' : 'Configure New AI Provider'}
          </h3>
          <p className="db-form-desc">
            Connect an LLM or multi-modal vision provider with API credentials and model routing.
          </p>
        </div>
      </div>

      {/* Preset Quick-Fill Bar */}
      {!editId && (
        <div className="db-presets-container">
          <span className="db-presets-label">
            <Zap className="w-3.5 h-3.5 text-amber-500" /> Quick Presets:
          </span>
          <div className="db-preset-pills">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className={`db-preset-pill ${draft.baseUrl === p.baseUrl ? 'is-selected' : ''}`}
                onClick={() => applyPreset(p)}
                title={p.description}
              >
                <span>{p.icon}</span>
                <span>{p.name.split(' (')[0]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="db-form-grid">
        {/* Row 1: Name & Type */}
        <div className="db-input-group">
          <label className="db-label">
            <span>Provider Display Name</span>
            <span className="db-required-mark">*</span>
          </label>
          <div className="db-input-box">
            <input
              type="text"
              value={draft.displayName}
              onChange={(e) => set({ displayName: e.target.value })}
              placeholder="e.g. Google Gemini Pro Production"
              required
              className="db-text-input"
            />
          </div>
        </div>

        <div className="db-input-group">
          <label className="db-label">Provider Protocol / API Format</label>
          <div className="db-select-box">
            <select
              value={draft.providerType}
              onChange={(e) => set({ providerType: e.target.value as ProviderType })}
              className="db-select-input"
            >
              <option value="gemini">Google Gemini Native SDK / REST</option>
              <option value="openai-compatible">OpenAI-Compatible (v1 Chat/Vision)</option>
            </select>
          </div>
        </div>

        {/* Row 2: Base URL */}
        <div className="db-input-group db-input-group--full">
          <label className="db-label">
            <Globe className="w-3.5 h-3.5 text-blue-500 inline mr-1" />
            <span>Endpoint Base URL</span>
          </label>
          <div className="db-input-box">
            <input
              type="text"
              value={draft.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
              placeholder={
                draft.providerType === 'gemini'
                  ? 'https://generativelanguage.googleapis.com'
                  : 'https://api.openai.com/v1'
              }
              className="db-text-input"
            />
          </div>
        </div>

        {/* Row 3: API Key */}
        <div className="db-input-group db-input-group--full">
          <div className="flex justify-between items-center mb-1">
            <label className="db-label mb-0">
              <Key className="w-3.5 h-3.5 text-emerald-500 inline mr-1" />
              <span>API Key Credentials</span>
              {editId && <span className="db-optional-tag">(leave blank to keep current key)</span>}
            </label>
            <span className="db-security-badge">
              <ShieldCheck className="w-3 h-3 text-emerald-600" />
              <span>Encrypted Server-Side Only</span>
            </span>
          </div>
          <div className="db-input-box db-input-box--key">
            <Lock className="db-field-lead-icon w-4 h-4 text-slate-400" />
            <input
              type={showKey ? 'text' : 'password'}
              value={draft.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              placeholder={editId ? '•••••••••••••••• (Unchanged)' : 'Enter API Key (e.g. AIzaSy...)'}
              autoComplete="new-password"
              className="db-text-input db-text-input--key"
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="db-eye-toggle"
              aria-label={showKey ? 'Hide key' : 'Show key'}
              title={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Row 4: Model Discovery & Selection */}
        <div className="db-input-group db-input-group--full">
          <div className="flex justify-between items-center mb-1">
            <label className="db-label mb-0">
              <Bot className="w-3.5 h-3.5 text-violet-500 inline mr-1" />
              <span>Active Model Selection</span>
            </label>
            <button
              type="button"
              className="db-refresh-models-btn"
              onClick={refreshModels}
              disabled={testing}
            >
              <RefreshCw className={`w-3 h-3 ${testing ? 'animate-spin' : ''}`} />
              <span>{testing ? 'Discovering Models…' : 'Discover Models from Key'}</span>
            </button>
          </div>

          <div className="db-model-selection-card">
            {draft.customModels && draft.customModels.length > 0 ? (
              <div className="space-y-2">
                <div className="db-select-box">
                  <select
                    value={draft.modelId}
                    onChange={(e) => set({ modelId: e.target.value })}
                    className="db-select-input font-medium"
                  >
                    <option value="">— Choose from {draft.customModels.length} Discovered Models —</option>
                    {draft.customModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="db-model-chips-scroll">
                  <div className="db-model-chips-header">
                    <span>Verified Models ({draft.customModels.length})</span>
                    <span className="text-xs text-slate-400">Click to select</span>
                  </div>
                  <div className="db-model-chips-grid">
                    {draft.customModels.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => set({ modelId: m })}
                        className={`db-model-chip ${draft.modelId === m ? 'is-active' : ''}`}
                      >
                        {draft.modelId === m && <Check className="w-3 h-3 text-violet-600 inline mr-1" />}
                        <span>{m}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="db-empty-models-notice">
                <Bot className="w-5 h-5 text-slate-400 mb-1" />
                <p>No models discovered yet.</p>
                <span>Enter your API key and click <b>“Discover Models”</b> or type a manual model ID below.</span>
                <div className="db-manual-model-input mt-2">
                  <input
                    type="text"
                    value={draft.modelId}
                    onChange={(e) => set({ modelId: e.target.value })}
                    placeholder="Manual Model ID (e.g. gemini-2.5-flash)"
                    className="db-text-input"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 5: Capabilities */}
        <div className="db-input-group db-input-group--full">
          <label className="db-label">
            <Sliders className="w-3.5 h-3.5 text-blue-500 inline mr-1" />
            <span>Supported Capabilities</span>
          </label>
          <div className="db-capabilities-grid">
            {ALL_CAPS.map((c) => {
              const Icon = c.icon;
              const isChecked = draft.capabilities.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCap(c.id)}
                  className={`db-cap-tile ${isChecked ? 'is-checked' : ''}`}
                >
                  <div className="db-cap-tile__icon">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="db-cap-tile__text">
                    <span className="db-cap-tile__name">{c.label}</span>
                    <span className="db-cap-tile__desc">{c.desc}</span>
                  </div>
                  <div className="db-cap-tile__check">
                    {isChecked ? <CheckCircle2 className="w-4 h-4 text-violet-600" /> : <div className="db-cap-empty-circle" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Real-time Connection Test Feedback */}
      {testResult && (
        <div className={`db-test-banner ${testResult.ok ? 'is-success' : 'is-error'}`}>
          {testResult.ok ? (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div>
                <b className="text-emerald-800 text-sm">Connection Verified Successfully</b>
                <p className="text-xs text-emerald-700 m-0">
                  Endpoint responded with {testResult.models?.length ?? 0} active models available.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
              <div>
                <b className="text-rose-800 text-sm">Connection Test Failed</b>
                <p className="text-xs text-rose-700 m-0">
                  {testResult.error || 'Could not verify connection. Check Base URL and API key.'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="db-test-banner is-error" role="alert">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span className="text-xs text-rose-800 font-medium">{err}</span>
        </div>
      )}

      {refreshFailed && (
        <div className="db-test-banner is-error" role="alert">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span className="text-xs text-rose-800">
            Provider was saved, but the list could not be refreshed.{' '}
            <button
              type="button"
              className="underline font-bold ml-1 text-rose-900"
              onClick={() => {
                onSaved();
                onClose();
              }}
            >
              Retry
            </button>
          </span>
        </div>
      )}

      {/* Form Action Footer */}
      <div className="db-form-footer">
        <button
          type="button"
          className="db-btn-secondary"
          onClick={testConnection}
          disabled={testing}
        >
          <Activity className={`w-4 h-4 ${testing ? 'animate-spin text-blue-500' : ''}`} />
          <span>{testing ? 'Testing Connection…' : 'Test Connection'}</span>
        </button>
        <div className="flex items-center gap-2">
          <button type="button" className="db-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="db-btn-primary"
            disabled={saving || !draft.displayName}
          >
            {saving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Saving Provider…</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>{editId ? 'Update Provider' : 'Save & Activate'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}

// Standalone overlay dialog
export function ProviderConfigurationDialog({
  open,
  onClose,
  onSaved,
  editId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editId?: string | null;
  initial?: ProviderDraft;
}) {
  if (!open) return null;
  return (
    <div className="db-overlay" role="dialog" aria-modal="true" aria-label={editId ? 'Edit provider' : 'Add provider'}>
      <div className="db-dialog db-dialog--wide glass">
        <ProviderForm onClose={onClose} onSaved={onSaved} editId={editId} initial={initial} />
      </div>
    </div>
  );
}

// Main Unified Modal
export function ProviderSettingsPanel({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<ProviderSummaryView[]>([]);
  const [active, setActive] = useState<ActiveSelections>({
    activeChatModel: null,
    activeExtractionModel: null,
    activeRenderProvider: null,
  });
  const [activeTab, setActiveTab] = useState<'providers' | 'roles'>('providers');
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editInitial, setEditInitial] = useState<ProviderDraft | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testStatusMap, setTestStatusMap] = useState<Record<string, { ok: boolean; message: string }>>({});

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ providers: ProviderSummaryView[] } & ActiveSelections>('/api/providers');
      setProviders(data.providers ?? []);
      setActive({
        activeChatModel: data.activeChatModel,
        activeExtractionModel: data.activeExtractionModel,
        activeRenderProvider: data.activeRenderProvider,
      });
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openAdd = () => {
    setEditId(null);
    setEditInitial(undefined);
    setEditing(true);
  };

  const openEdit = (p: ProviderSummaryView) => {
    setEditId(p.id);
    setEditInitial({
      displayName: p.label,
      providerType: p.providerType,
      baseUrl: p.baseUrl ?? '',
      apiKey: '',
      modelId:
        active.activeExtractionModel?.providerId === p.id
          ? active.activeExtractionModel.modelId
          : p.customModels?.[0] ?? '',
      capabilities: ['multipass-extraction', 'chat'],
      optionalHeaders: {},
      kind: p.kind,
      customModels: p.customModels ?? [],
    });
    setEditing(true);
  };

  const remove = async (id: string) => {
    if (!confirm('Are you sure you want to remove this provider?')) return;
    try {
      await api(`/api/providers/${id}`, { method: 'DELETE' });
      refresh();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const testProviderQuick = async (p: ProviderSummaryView) => {
    setTestingId(p.id);
    try {
      const res = await api<{ ok: boolean; error?: string; models?: string[] }>('/api/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerType: p.providerType,
          baseUrl: p.baseUrl,
          providerId: p.id,
        }),
      });
      setTestStatusMap((prev) => ({
        ...prev,
        [p.id]: {
          ok: res.ok,
          message: res.ok ? `Verified (${res.models?.length ?? 0} models)` : res.error || 'Failed',
        },
      }));
      refresh();
    } catch (e: any) {
      setTestStatusMap((prev) => ({
        ...prev,
        [p.id]: { ok: false, message: e.message },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const selectSlot = async (slot: ProviderKind, providerId: string, modelId: string) => {
    try {
      await api('/api/providers/select', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slot, providerId, modelId }),
      });
      refresh();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const renderRoleCard = (
    slot: ProviderKind,
    title: string,
    description: string,
    icon: React.ReactNode,
    currentSelection: { providerId: string; modelId: string } | null,
  ) => {
    const selectedProvider = providers.find((p) => p.id === currentSelection?.providerId);
    const availableModels = selectedProvider?.customModels ?? [];

    return (
      <div className="db-role-assignment-card" key={slot}>
        <div className="db-role-card-header">
          <div className="db-role-icon-box">{icon}</div>
          <div className="db-role-info">
            <h4 className="db-role-title">{title}</h4>
            <p className="db-role-desc">{description}</p>
          </div>
          {currentSelection?.providerId ? (
            <span className="db-active-pill">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Active
            </span>
          ) : (
            <span className="db-unassigned-pill">Unassigned</span>
          )}
        </div>

        <div className="db-role-selectors">
          <div className="db-role-select-group">
            <label className="text-xs text-slate-500 font-semibold mb-1 block">Assigned Provider</label>
            <div className="db-select-box">
              <select
                aria-label={`${title} provider`}
                value={currentSelection?.providerId ?? ''}
                onChange={(e) => {
                  const p = providers.find((x) => x.id === e.target.value);
                  if (p) {
                    const fallbackModel = p.customModels?.[0] ?? '';
                    selectSlot(slot, p.id, currentSelection?.providerId === p.id ? currentSelection.modelId : fallbackModel);
                  } else {
                    selectSlot(slot, '', '');
                  }
                }}
                className="db-select-input"
              >
                <option value="">— Select Provider —</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.providerType})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="db-role-select-group">
            <label className="text-xs text-slate-500 font-semibold mb-1 block">Active Model</label>
            <div className="db-select-box">
              <select
                aria-label={`${title} model`}
                value={currentSelection?.modelId ?? ''}
                disabled={!currentSelection?.providerId || availableModels.length === 0}
                onChange={(e) => {
                  if (currentSelection) selectSlot(slot, currentSelection.providerId, e.target.value);
                }}
                className="db-select-input"
              >
                <option value="">
                  {availableModels.length === 0 ? '— No models discovered —' : '— Select Model —'}
                </option>
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="db-overlay" role="dialog" aria-modal="true" aria-label="AI Studio & Provider Settings">
      <div className="db-dialog db-dialog--ultra-wide glass">
        {/* Main Modal Header */}
        <div className="db-dialog-head">
          <div className="flex items-center gap-3">
            <div className="db-header-icon-glow">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-slate-900 m-0">AI Studio & Model Providers</h3>
                <span className="db-badge-count">{providers.length} Connected</span>
              </div>
              <p className="text-xs text-slate-500 m-0 mt-0.5">
                Manage LLM API endpoints, credentials, model discovery, and multi-agent role routing.
              </p>
            </div>
          </div>
          <button className="db-close-circle-btn" onClick={onClose} aria-label="Close dialog">
            <X className="w-4 h-4" />
          </button>
        </div>

        {err && (
          <div className="db-test-banner is-error mx-6 mt-3" role="alert">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span className="text-xs text-rose-800 font-medium">{err}</span>
          </div>
        )}

        {/* If in edit/add mode, show the inline form */}
        {editing ? (
          <div className="db-modal-body-form">
            <ProviderForm
              onClose={() => setEditing(false)}
              onSaved={refresh}
              editId={editId}
              initial={editInitial}
            />
          </div>
        ) : (
          <>
            {/* Tab Navigation */}
            <div className="db-modal-tabs">
              <button
                type="button"
                className={`db-modal-tab ${activeTab === 'providers' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('providers')}
              >
                <Server className="w-4 h-4" />
                <span>Configured Providers ({providers.length})</span>
              </button>
              <button
                type="button"
                className={`db-modal-tab ${activeTab === 'roles' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('roles')}
              >
                <Sliders className="w-4 h-4" />
                <span>Role Routing & Slots</span>
              </button>
              <div className="flex-1" />
              <button type="button" className="db-add-provider-btn" onClick={openAdd}>
                <Plus className="w-4 h-4" />
                <span>Add Provider</span>
              </button>
            </div>

            {/* Modal Body: Providers Tab */}
            {activeTab === 'providers' && (
              <div className="db-tab-content">
                {providers.length === 0 ? (
                  <div className="db-empty-providers-hero">
                    <div className="db-hero-icon-box">
                      <Bot className="w-8 h-8 text-violet-500" />
                    </div>
                    <h4 className="text-base font-bold text-slate-800 mb-1">No AI Providers Configured</h4>
                    <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
                      Connect Google Gemini, OpenAI, or local Ollama endpoints to enable multi-pass architectural floor plan extraction and 3D generation.
                    </p>
                    <button type="button" className="db-btn-primary mx-auto" onClick={openAdd}>
                      <Plus className="w-4 h-4" />
                      <span>Add First Provider</span>
                    </button>
                  </div>
                ) : (
                  <div className="db-providers-grid">
                    {providers.map((p) => {
                      const isGemini = p.providerType === 'gemini';
                      const quickTest = testStatusMap[p.id];
                      const isTesting = testingId === p.id;

                      return (
                        <div key={p.id} className="db-provider-card">
                          <div className="db-provider-card__head">
                            <div className="flex items-center gap-2.5">
                              <div className={`db-provider-avatar ${isGemini ? 'is-gemini' : 'is-custom'}`}>
                                {isGemini ? '✦' : '◈'}
                              </div>
                              <div>
                                <h4 className="db-provider-card__title">{p.label}</h4>
                                <span className="db-provider-card__type">
                                  {isGemini ? 'Google Gemini Native' : 'OpenAI-Compatible'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {p.verificationStatus === 'VERIFIED' ? (
                                <span className="db-status-pill is-verified" title="Connection verified">
                                  <span className="db-dot-pulse" /> Verified
                                </span>
                              ) : p.verificationStatus === 'TEST_FAILED' ? (
                                <span className="db-status-pill is-failed" title="Connection test failed">
                                  Failed
                                </span>
                              ) : (
                                <span className="db-status-pill is-untested" title="Not tested">
                                  Untested
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="db-provider-card__meta">
                            <div className="db-meta-row">
                              <Globe className="w-3.5 h-3.5 text-slate-400" />
                              <span className="db-meta-text truncate" title={p.baseUrl}>
                                {p.baseUrl || 'Default Endpoint'}
                              </span>
                            </div>
                            <div className="db-meta-row">
                              <Key className="w-3.5 h-3.5 text-slate-400" />
                              <span className="db-meta-text">
                                {p.hasApiKey ? (
                                  <span className="text-emerald-700 font-medium flex items-center gap-1">
                                    <ShieldCheck className="w-3 h-3 text-emerald-600" /> Key Configured (Masked)
                                  </span>
                                ) : (
                                  <span className="text-amber-600">No Key Stored</span>
                                )}
                              </span>
                            </div>
                          </div>

                          {/* Discovered Models Tags */}
                          <div className="db-provider-card__models">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Discovered Models ({p.customModels?.length ?? 0})
                              </span>
                            </div>
                            <div className="db-model-pill-cloud">
                              {p.customModels && p.customModels.length > 0 ? (
                                p.customModels.slice(0, 4).map((m) => (
                                  <span key={m} className="db-mini-model-pill">
                                    {m}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-slate-400 italic">No models cached yet</span>
                              )}
                              {p.customModels && p.customModels.length > 4 && (
                                <span className="db-mini-model-pill is-more">
                                  +{p.customModels.length - 4} more
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Quick test result message */}
                          {quickTest && (
                            <div className={`db-quick-test-note ${quickTest.ok ? 'is-ok' : 'is-err'}`}>
                              {quickTest.ok ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                              <span>{quickTest.message}</span>
                            </div>
                          )}

                          {/* Card Actions Footer */}
                          <div className="db-provider-card__actions">
                            <button
                              type="button"
                              className="db-card-action-btn"
                              onClick={() => testProviderQuick(p)}
                              disabled={isTesting}
                              title="Test live connection to this provider"
                            >
                              <Activity className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin text-blue-500' : ''}`} />
                              <span>{isTesting ? 'Pinging…' : 'Ping'}</span>
                            </button>
                            <button
                              type="button"
                              className="db-card-action-btn"
                              onClick={() => openEdit(p)}
                              title="Edit provider configuration"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              className="db-card-action-btn is-danger"
                              onClick={() => remove(p.id)}
                              title="Remove provider"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Remove</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Modal Body: Role Routing Tab */}
            {activeTab === 'roles' && (
              <div className="db-tab-content">
                <div className="db-role-routing-notice">
                  <Sliders className="w-4 h-4 text-violet-500 flex-shrink-0" />
                  <span>
                    Selections for <b>Chat</b>, <b>Extraction</b>, and <b>Render</b> operate independently. Assigning a model to one role never alters another.
                  </span>
                </div>
                <div className="space-y-3.5">
                  {renderRoleCard(
                    'chat',
                    'Chat Copilot & Architectural Q&A',
                    'Real-time assistant for drafting, queries, and BIM element adjustment.',
                    <MessageSquare className="w-5 h-5 text-blue-500" />,
                    active.activeChatModel,
                  )}
                  {renderRoleCard(
                    'extraction',
                    'Structural & Geometric AI Extraction',
                    'Multi-pass vision engine cross-checking walls, windows, doors, and furniture layout.',
                    <Layers className="w-5 h-5 text-violet-500" />,
                    active.activeExtractionModel,
                  )}
                  {renderRoleCard(
                    'render',
                    'Photorealistic 3D Rendering',
                    'Texture synthesis, photorealistic rendering, and architectural visualization.',
                    <Box className="w-5 h-5 text-emerald-500" />,
                    active.activeRenderProvider,
                  )}
                </div>
              </div>
            )}

            {/* Modal Global Footer */}
            <div className="db-dialog-footer">
              <div className="text-xs text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-slate-400" />
                <span>Credentials securely persisted via Provider Registry</span>
              </div>
              <button type="button" className="db-btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
