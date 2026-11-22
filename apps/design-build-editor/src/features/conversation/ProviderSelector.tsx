// features/conversation/ProviderSelector.tsx
// AI Studio: connect an AI provider in two steps (pick it, paste the key) and
// choose which model reads plans and which key renders.
//
// SECURITY CONTRACT (enforced everywhere here):
//  - Providers and keys are kept in this browser's storage (like BOQ Flow, see
//    features/providers/browser-provider-store) and travel to our own server
//    only inside the request that needs them. The UI itself only ever handles
//    MASKED ProviderSummary objects (hasApiKey, never the key bytes).
//  - The key is never placed in ChatPanel state, never logged, never written
//    into scene/project JSON, exports, or test evidence.
//  - Selections for chat / extraction / render are INDEPENDENT slots — changing
//    one can never overwrite another.

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Box,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { providerFetch } from '@/features/providers/browser-provider-store';

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
  storage?: 'browser' | 'server';
}

export interface ActiveSelections {
  activeChatModel: { providerId: string; modelId: string } | null;
  activeExtractionModel: { providerId: string; modelId: string } | null;
  activeRenderProvider: { providerId: string; modelId: string } | null;
}

type Capability = 'chat' | 'vision' | 'multipass-extraction' | 'image-rendering' | 'image-editing';

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
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  defaultModel: string;
  icon: string;
  note: string;
  keyUrl?: string;
  keyHint: string;
}

const PRESETS: PresetOption[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-flash',
    icon: '✦',
    note: 'Reads plans and renders. Recommended.',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'Starts with AIza…',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    icon: '◎',
    note: 'Reads plans',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'Starts with sk-…',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    icon: '◈',
    note: 'Many models, one key',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'Starts with sk-or-…',
  },
  {
    id: 'groq',
    name: 'Groq',
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    icon: '⚡',
    note: 'Fast text models',
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'Starts with gsk_…',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    type: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2-vision',
    icon: '◐',
    note: 'Runs on your computer (local app only)',
    keyHint: 'Any text; Ollama does not check it',
  },
];

function presetFor(draft: Pick<ProviderDraft, 'providerType' | 'baseUrl'>): PresetOption | undefined {
  if (draft.providerType === 'gemini') return PRESETS[0];
  return PRESETS.find((p) => p.type === draft.providerType && p.baseUrl === draft.baseUrl);
}

function draftFromPreset(p: PresetOption): ProviderDraft {
  return {
    displayName: p.name,
    providerType: p.type,
    baseUrl: p.baseUrl,
    apiKey: '',
    modelId: p.defaultModel,
    capabilities: ['chat', 'vision', 'multipass-extraction'],
    optionalHeaders: {},
    kind: 'extraction',
    customModels: [],
  };
}

function emptyDraft(): ProviderDraft {
  return draftFromPreset(PRESETS[0]);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  // Providers and keys are kept in this browser (like BOQ Flow); see browser-provider-store.
  const res = await providerFetch(url, init);
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

/** Turn a provider's raw error into one sentence a person can act on. */
function friendlyTestError(raw?: string): string {
  const msg = raw ?? '';
  if (/API_KEY_INVALID|API key not valid|invalid api key|incorrect api key|401/i.test(msg)) return 'The provider did not accept this key. Check that you copied all of it.';
  if (/PERMISSION_DENIED|403/i.test(msg)) return 'This key is not allowed to use this API. Check its permissions with the provider.';
  if (/public https/i.test(msg)) return msg;
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network|timed? ?out/i.test(msg)) return 'Could not reach the provider. Check the endpoint address.';
  if (!msg) return 'Could not connect. Check the key and try again.';
  return msg.replace(/\s+/g, ' ').slice(0, 180);
}

function mapSaveError(msg: string): string {
  if (/PROVIDER_ALREADY_EXISTS/.test(msg)) return 'A provider with this name already exists.';
  if (/Browser storage is not available/.test(msg)) return 'This browser blocks local storage, so the key cannot be kept here.';
  if (/INVALID_BASE_URL/.test(msg)) return 'The endpoint address is not valid.';
  return msg;
}

/** Keep the chosen model if the provider offers it; otherwise prefer a fast Gemini model. */
function pickModel(current: string, models: string[]): string {
  if (models.length === 0) return current;
  if (current && models.includes(current)) return current;
  return models.find((m) => /gemini-2\.5-flash$/.test(m))
    ?? models.find((m) => /flash/i.test(m) && !/image|tts|audio|live/i.test(m))
    ?? models[0];
}

type TestResult = { ok: boolean; error?: string; models?: string[] };

// Add / edit a provider: pick it, paste the key, Connect. Details are under "More options".
export function ProviderForm({
  onClose,
  onSaved,
  editId,
  initial,
}: {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  editId?: string | null;
  initial?: ProviderDraft;
}) {
  const [draft, setDraft] = useState<ProviderDraft>(initial ?? emptyDraft());
  const [busy, setBusy] = useState<'idle' | 'connecting' | 'saving' | 'refreshing'>('idle');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    setDraft(initial ?? emptyDraft());
    setTestResult(null);
    setErr(null);
  }, [editId, initial]);

  const set = (patch: Partial<ProviderDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const preset = presetFor(draft);

  const choosePreset = (p: PresetOption) => {
    setErr(null);
    setTestResult(null);
    setDraft((d) => ({ ...draftFromPreset(p), apiKey: d.apiKey }));
  };

  const testKey = async (d: ProviderDraft): Promise<TestResult> =>
    api<TestResult>('/api/providers/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerType: d.providerType,
        baseUrl: d.baseUrl,
        apiKey: d.apiKey,
        providerId: editId ?? undefined,
        optionalHeaders: d.optionalHeaders,
      }),
    });

  const save = async (d: ProviderDraft, result: TestResult | null) => {
    const payload = buildProviderPayload({ ...d, displayName: d.displayName.trim() || preset?.name || 'AI provider' }, result);
    let savedId = editId ?? null;
    if (editId) {
      await api(`/api/providers/${editId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    } else {
      const created = await api<{ provider: { id: string } }>('/api/providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      savedId = created.provider?.id ?? null;
    }
    if (savedId && d.modelId) {
      try {
        await api('/api/providers/select', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slot: 'extraction', providerId: savedId, modelId: d.modelId }),
        });
      } catch {
        /* the provider is saved; the model can be picked under Models */
      }
    }
    await onSaved();
    onClose();
  };

  /** Connect = check the key, learn the models, save and use it. */
  const connect = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!editId && !draft.apiKey.trim()) {
      setErr('Paste your API key first.');
      return;
    }
    setBusy('connecting');
    setErr(null);
    setTestResult(null);
    try {
      const res = await testKey(draft);
      setTestResult(res);
      if (!res.ok) {
        setErr(friendlyTestError(res.error));
        return;
      }
      const models = Array.from(new Set([...(draft.customModels ?? []), ...(res.models ?? [])]));
      const next = { ...draft, customModels: models, modelId: pickModel(draft.modelId, models) };
      setDraft(next);
      setBusy('saving');
      await save(next, res);
    } catch (e2) {
      setErr(mapSaveError(e2 instanceof Error ? e2.message : String(e2)));
    } finally {
      setBusy('idle');
    }
  };

  /** Save without checking the key (for endpoints that cannot be reached from here). */
  const saveWithoutCheck = async () => {
    setBusy('saving');
    setErr(null);
    try {
      await save(draft, testResult);
    } catch (e2) {
      setErr(mapSaveError(e2 instanceof Error ? e2.message : String(e2)));
    } finally {
      setBusy('idle');
    }
  };

  const refreshModels = async () => {
    setBusy('refreshing');
    setErr(null);
    try {
      const res = await testKey(draft);
      setTestResult(res);
      if (res.ok && res.models?.length) {
        const models = Array.from(new Set([...(draft.customModels ?? []), ...res.models]));
        set({ customModels: models, modelId: pickModel(draft.modelId, models) });
      } else {
        setErr(res.ok ? 'The provider returned no models. Type a model name instead.' : friendlyTestError(res.error));
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy('idle');
    }
  };

  const working = busy !== 'idle';
  const models = draft.customModels ?? [];

  return (
    <form onSubmit={connect} className="db-ais-form">
      <div className="db-ais-form__head">
        <button type="button" className="db-icon-btn" onClick={onClose} aria-label="Back to providers">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h3>{editId ? `Edit ${draft.displayName || 'provider'}` : 'Connect an AI provider'}</h3>
          <p>{editId ? 'Change the key or the model. Leave the key empty to keep the current one.' : 'Pick a provider, paste your API key, and you are ready.'}</p>
        </div>
      </div>

      {!editId && (
        <fieldset className="db-ais-step">
          <legend><span>1</span> Provider</legend>
          <div className="db-ais-presets" role="radiogroup" aria-label="Provider">
            {PRESETS.map((p) => {
              const on = preset?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`db-ais-preset ${on ? 'is-on' : ''}`}
                  onClick={() => choosePreset(p)}
                >
                  <span className="db-ais-preset__icon" aria-hidden>{p.icon}</span>
                  <span className="db-ais-preset__text">
                    <b>{p.name}</b>
                    <small>{p.note}</small>
                  </span>
                  {on && <Check size={15} className="db-ais-preset__check" aria-hidden />}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <fieldset className="db-ais-step">
        <legend><span>{editId ? 1 : 2}</span> API key</legend>
        <div className="db-ais-key">
          <KeyRound size={16} aria-hidden />
          <input
            type={showKey ? 'text' : 'password'}
            value={draft.apiKey}
            onChange={(e) => { set({ apiKey: e.target.value }); setErr(null); }}
            placeholder={editId ? 'Leave empty to keep the current key' : preset?.keyHint ?? 'Paste your key'}
            autoComplete="off"
            spellCheck={false}
            aria-label="API key"
            autoFocus={!editId}
          />
          <button type="button" className="db-icon-btn" onClick={() => setShowKey((s) => !s)} aria-label={showKey ? 'Hide key' : 'Show key'}>
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <p className="db-ais-key__note">
          <ShieldCheck size={13} aria-hidden /> Kept in this browser only and sent only with your own requests.
          {preset?.keyUrl && (
            <a href={preset.keyUrl} target="_blank" rel="noreferrer">
              Get a {preset.name} key <ExternalLink size={12} aria-hidden />
            </a>
          )}
        </p>
      </fieldset>

      <details className="db-ais-more" open={more || !!editId} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
        <summary>More options</summary>
        <div className="db-ais-more__grid">
          <label>
            <span>Name</span>
            <input type="text" value={draft.displayName} onChange={(e) => set({ displayName: e.target.value })} placeholder={preset?.name ?? 'My provider'} />
          </label>
          <label>
            <span>Model for reading plans</span>
            {models.length > 0 ? (
              <select value={draft.modelId} onChange={(e) => set({ modelId: e.target.value })}>
                {!models.includes(draft.modelId) && draft.modelId && <option value={draft.modelId}>{draft.modelId}</option>}
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input type="text" value={draft.modelId} onChange={(e) => set({ modelId: e.target.value })} placeholder="e.g. gemini-2.5-flash" />
            )}
          </label>
          <div className="db-ais-more__row">
            <button type="button" className="db-btn-quiet" onClick={refreshModels} disabled={working}>
              <RefreshCw size={13} className={busy === 'refreshing' ? 'db-spin' : ''} /> {models.length ? `Refresh models (${models.length})` : 'Find models with this key'}
            </button>
          </div>
          <label>
            <span>API format</span>
            <select value={draft.providerType} onChange={(e) => set({ providerType: e.target.value as ProviderType })}>
              <option value="gemini">Google Gemini</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </label>
          <label>
            <span>Endpoint</span>
            <input type="text" value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder={draft.providerType === 'gemini' ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com/v1'} />
          </label>
        </div>
      </details>

      {err && (
        <div className="db-ais-alert" role="alert">
          <AlertCircle size={16} aria-hidden />
          <span>{err}</span>
        </div>
      )}
      {testResult?.ok && busy !== 'idle' && (
        <div className="db-ais-ok" role="status">
          <Check size={16} aria-hidden /> Key works. Saving…
        </div>
      )}

      <div className="db-ais-form__foot">
        {err && testResult && !testResult.ok ? (
          <button type="button" className="db-link" onClick={saveWithoutCheck} disabled={working}>Save anyway</button>
        ) : <span />}
        <div className="db-ais-form__buttons">
          <button type="button" className="db-btn-ghost" onClick={onClose} disabled={working}>Cancel</button>
          <button type="submit" className="db-btn-primary" disabled={working}>
            {busy === 'connecting' ? <><Loader2 size={15} className="db-spin" /> Checking the key…</>
              : busy === 'saving' ? <><Loader2 size={15} className="db-spin" /> Saving…</>
                : editId ? 'Save' : 'Connect'}
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

// AI Studio dialog
export function ProviderSettingsPanel({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<ProviderSummaryView[]>([]);
  const [active, setActive] = useState<ActiveSelections>({
    activeChatModel: null,
    activeExtractionModel: null,
    activeRenderProvider: null,
  });
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<'providers' | 'roles'>('providers');
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editInitial, setEditInitial] = useState<ProviderDraft | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testStatusMap, setTestStatusMap] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ providers: ProviderSummaryView[] } & ActiveSelections>('/api/providers');
      setProviders(data.providers ?? []);
      setActive({
        activeChatModel: data.activeChatModel,
        activeExtractionModel: data.activeExtractionModel,
        activeRenderProvider: data.activeRenderProvider,
      });
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose]);

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
    if (confirmRemove !== id) {
      setConfirmRemove(id);
      window.setTimeout(() => setConfirmRemove((c) => (c === id ? null : c)), 4000);
      return;
    }
    setConfirmRemove(null);
    try {
      await api(`/api/providers/${id}`, { method: 'DELETE' });
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const testProviderQuick = async (p: ProviderSummaryView) => {
    setTestingId(p.id);
    try {
      const res = await api<TestResult>('/api/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerType: p.providerType, baseUrl: p.baseUrl, providerId: p.id }),
      });
      setTestStatusMap((prev) => ({
        ...prev,
        [p.id]: { ok: res.ok, message: res.ok ? `Working · ${res.models?.length ?? 0} models` : friendlyTestError(res.error) },
      }));
    } catch (e) {
      setTestStatusMap((prev) => ({ ...prev, [p.id]: { ok: false, message: e instanceof Error ? e.message : String(e) } }));
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const renderRoleCard = (
    slot: ProviderKind,
    title: string,
    description: string,
    icon: React.ReactNode,
    currentSelection: { providerId: string; modelId: string } | null,
    candidates: ProviderSummaryView[],
    showModel: boolean,
  ) => {
    const selectedProvider = providers.find((p) => p.id === currentSelection?.providerId);
    const availableModels = selectedProvider?.customModels ?? [];
    return (
      <div className="db-ais-role" key={slot}>
        <div className="db-ais-role__head">
          <span className="db-ais-role__icon" aria-hidden>{icon}</span>
          <div>
            <h4>{title}</h4>
            <p>{description}</p>
          </div>
        </div>
        <div className="db-ais-role__fields">
          <label>
            <span>Provider</span>
            <select
              aria-label={`${title} provider`}
              value={currentSelection?.providerId ?? ''}
              onChange={(e) => {
                const p = providers.find((x) => x.id === e.target.value);
                if (p) selectSlot(slot, p.id, currentSelection?.providerId === p.id ? currentSelection.modelId : p.customModels?.[0] ?? 'default');
              }}
            >
              <option value="">{slot === 'render' ? 'Automatic (first Gemini key)' : 'Choose a provider'}</option>
              {candidates.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          {showModel && (
            <label>
              <span>Model</span>
              <select
                aria-label={`${title} model`}
                value={currentSelection?.modelId ?? ''}
                disabled={!currentSelection?.providerId || availableModels.length === 0}
                onChange={(e) => { if (currentSelection) selectSlot(slot, currentSelection.providerId, e.target.value); }}
              >
                {availableModels.length === 0 && <option value={currentSelection?.modelId ?? ''}>{currentSelection?.modelId || 'No models found yet'}</option>}
                {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
    );
  };

  const geminiProviders = providers.filter((p) => p.providerType === 'gemini');

  return (
    <div className="db-overlay" role="dialog" aria-modal="true" aria-label="AI Studio" onMouseDown={(e) => { if (e.target === e.currentTarget && !editing) onClose(); }}>
      <div className="db-dialog db-ais glass">
        <div className="db-ais__head">
          <div>
            <h3>AI Studio</h3>
            <p>Your AI provider reads plans with AI and renders photoreal images. Keys stay in this browser.</p>
          </div>
          <button className="db-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {err && (
          <div className="db-ais-alert db-ais-alert--top" role="alert">
            <AlertCircle size={16} aria-hidden />
            <span>{err}</span>
          </div>
        )}

        {editing ? (
          <div className="db-ais__body">
            <ProviderForm onClose={() => setEditing(false)} onSaved={refresh} editId={editId} initial={editInitial} />
          </div>
        ) : (
          <>
            {providers.length > 0 && (
              <div className="db-ais__tabs" role="tablist">
                <button type="button" role="tab" aria-selected={activeTab === 'providers'} className={activeTab === 'providers' ? 'is-on' : ''} onClick={() => setActiveTab('providers')}>
                  Providers <span className="db-ais__count">{providers.length}</span>
                </button>
                <button type="button" role="tab" aria-selected={activeTab === 'roles'} className={activeTab === 'roles' ? 'is-on' : ''} onClick={() => setActiveTab('roles')}>
                  Models
                </button>
                <span className="db-ais__spacer" />
                <button type="button" className="db-btn-quiet" onClick={openAdd}>
                  <Plus size={14} /> Add provider
                </button>
              </div>
            )}

            {activeTab === 'providers' && (
              <div className="db-ais__body">
                {!loaded ? (
                  <div className="db-ais-empty"><Loader2 size={22} className="db-spin" /></div>
                ) : providers.length === 0 ? (
                  <div className="db-ais-empty">
                    <span className="db-ais-empty__icon" aria-hidden>✦</span>
                    <h4>No AI provider yet</h4>
                    <p>Add your Google Gemini key to read plans with AI and to render photoreal images. Precise PDF reading works without it.</p>
                    <button type="button" className="db-btn-primary" onClick={openAdd}>
                      <Plus size={15} /> Connect a provider
                    </button>
                  </div>
                ) : (
                  <ul className="db-ais-list">
                    {providers.map((p) => {
                      const isGemini = p.providerType === 'gemini';
                      const quickTest = testStatusMap[p.id];
                      const readsPlans = active.activeExtractionModel?.providerId === p.id ? active.activeExtractionModel.modelId : null;
                      const status = quickTest ? (quickTest.ok ? 'ok' : 'fail') : p.verificationStatus === 'VERIFIED' ? 'ok' : p.verificationStatus === 'TEST_FAILED' ? 'fail' : 'unknown';
                      return (
                        <li key={p.id} className="db-ais-card">
                          <span className={`db-ais-card__avatar ${isGemini ? 'is-gemini' : ''}`} aria-hidden>{isGemini ? '✦' : '◈'}</span>
                          <div className="db-ais-card__main">
                            <div className="db-ais-card__title">
                              <b>{p.label}</b>
                              <span className={`db-ais-status is-${status}`}>
                                {status === 'ok' ? 'Working' : status === 'fail' ? 'Key not accepted' : 'Not checked'}
                              </span>
                            </div>
                            <p>
                              {isGemini ? 'Google Gemini' : 'OpenAI-compatible'}
                              {' · '}
                              {p.hasApiKey ? (p.storage === 'server' ? 'key on this computer' : 'key saved in this browser') : 'no key'}
                              {readsPlans ? ` · reads plans with ${readsPlans}` : ''}
                            </p>
                            {quickTest && !quickTest.ok && <p className="db-ais-card__error">{quickTest.message}</p>}
                          </div>
                          <div className="db-ais-card__actions">
                            <button type="button" className="db-btn-quiet" onClick={() => testProviderQuick(p)} disabled={testingId === p.id} title="Check that the key works">
                              {testingId === p.id ? <Loader2 size={13} className="db-spin" /> : <Check size={13} />} Test
                            </button>
                            <button type="button" className="db-icon-btn" onClick={() => openEdit(p)} aria-label={`Edit ${p.label}`} title="Edit">
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              className={`db-icon-btn is-danger ${confirmRemove === p.id ? 'is-confirm' : ''}`}
                              onClick={() => remove(p.id)}
                              aria-label={confirmRemove === p.id ? `Confirm removing ${p.label}` : `Remove ${p.label}`}
                              title={confirmRemove === p.id ? 'Click again to remove' : 'Remove'}
                            >
                              {confirmRemove === p.id ? <span className="db-ais-confirm">Remove?</span> : <Trash2 size={15} />}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {activeTab === 'roles' && (
              <div className="db-ais__body db-ais-roles">
                {renderRoleCard(
                  'extraction',
                  'Reading plans with AI',
                  'Used when you choose AI on the start screen.',
                  <Layers size={18} />,
                  active.activeExtractionModel,
                  providers,
                  true,
                )}
                {renderRoleCard(
                  'render',
                  'Photoreal renders',
                  'Needs a Google Gemini key. The render panel picks the image model.',
                  <Box size={18} />,
                  active.activeRenderProvider,
                  geminiProviders,
                  false,
                )}
              </div>
            )}

            <div className="db-ais__foot">
              <span><ShieldCheck size={14} aria-hidden /> Keys stay in this browser and are sent only with your own requests.</span>
              <button type="button" className="db-btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
