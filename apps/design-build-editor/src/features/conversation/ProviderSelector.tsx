// features/conversation/ProviderSelector.tsx
// Visible dynamic provider-management workflow (Change Set 3, §3–§7).
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

const ALL_CAPS = ['chat', 'vision', 'multipass-extraction', 'image-rendering', 'image-editing'] as const;
type Capability = typeof ALL_CAPS[number];

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

function emptyDraft(): ProviderDraft {
  return {
    displayName: '', providerType: 'gemini', baseUrl: '', apiKey: '',
    modelId: '', capabilities: ['multipass-extraction'], optionalHeaders: {}, kind: 'extraction',
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
  displayName: string; providerType: ProviderType; baseUrl: string; apiKey?: string; modelId: string; kind: ProviderKind; optionalHeaders: Record<string, string>;
  capabilities: Capability[]; verificationStatus: 'UNTESTED' | 'VERIFIED' | 'TEST_FAILED';
  customModels: string[];
} {
  // SECURITY/KEY-PERMANENCE: only send the key when the user typed one. When
  // the field is left blank we OMIT apiKey entirely so the server keeps the
  // previously stored credential (it must never be overwritten with an empty
  // or sentinel value on Edit).
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

// ProviderForm: owns the add/edit logic and renders ONLY the form body.
// It deliberately has NO overlay/dialog wrapper so it can be embedded inline
// inside the unified ProviderSettingsPanel (single modal) OR wrapped by
// ProviderConfigurationDialog for a standalone overlay.
export function ProviderForm({
  onClose, onSaved, editId, initial,
}: {
  onClose: () => void; onSaved: () => void; editId?: string | null;
  initial?: ProviderDraft;
}) {
  const [draft, setDraft] = useState<ProviderDraft>(initial ?? emptyDraft());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; models?: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // Masked preview of the API key (clone of CompanySettings.jsx behaviour).
  const getMaskedKeyPreview = (key: string): string => {
    if (!key) return '';
    if (key.length <= 8) return '••••';
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  };

  useEffect(() => { if (editId !== undefined || initial) { setDraft(initial ?? emptyDraft()); setTestResult(null); setErr(null); setRefreshFailed(false); } }, [editId, initial]);

  // Map server error codes to user-visible typed messages (§6).
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

  if (!open) return null;
  const set = (patch: Partial<ProviderDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleCap = (c: Capability) =>
    setDraft((d) => ({ ...d, capabilities: d.capabilities.includes(c) ? d.capabilities.filter((x) => x !== c) : [...d.capabilities, c] }));

  const testConnection = async () => {
    setTesting(true); setTestResult(null); setErr(null);
    try {
      const res = await api<{ ok: boolean; error?: string; models?: string[] }>('/api/providers/test', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerType: draft.providerType, baseUrl: draft.baseUrl, apiKey: draft.apiKey,
          providerId: editId ?? undefined,
          optionalHeaders: draft.optionalHeaders,
        }),
      });
      setTestResult(res);
      // Persist discovered models into the selectable list so the user can pick
      // from the provider's actual available models (fixes "no model selected").
      if (res.ok && res.models?.length) {
        const merged = Array.from(new Set([...(draft.customModels ?? []), ...res.models]));
        set({ customModels: merged });
        if (!draft.modelId) set({ modelId: res.models[0] });
      }
    } catch (e: any) {
      setErr(e.message);
    } finally { setTesting(false); }
  };

  // Explicit "Refresh models" — re-run discovery against the current API key and
  // repopulate the model dropdown without requiring a full connection test.
  const refreshModels = async () => {
    setTesting(true); setTestResult(null); setErr(null);
    try {
      const res = await api<{ ok: boolean; error?: string; models?: string[] }>('/api/providers/test', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerType: draft.providerType, baseUrl: draft.baseUrl, apiKey: draft.apiKey,
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
    } finally { setTesting(false); }
  };

  const save = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!draft.displayName) return;
    setSaving(true); setErr(null); setRefreshFailed(false);
    try {
      const payload = buildProviderPayload(draft, testResult);
      let savedId = editId ?? null;
      if (editId) {
        await api(`/api/providers/${editId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      } else {
        const created = await api<{ provider: { id: string } }>('/api/providers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        savedId = created.provider?.id ?? null;
      }
      // Root-cause fix: a verified extraction provider must become the ACTIVE
      // extraction selection, otherwise the landing shows "no provider
      // configured" even though the provider exists and is VERIFIED. Only auto-
      // select when the provider actually carries a model.
      if (savedId && draft.kind === 'extraction' && draft.modelId) {
        try { await api('/api/providers/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: 'extraction', providerId: savedId, modelId: draft.modelId }) }); } catch { /* selection best-effort */ }
      }
      // Refresh the list from the server BEFORE closing (§5).
      try {
        await onSaved();
        onClose();
      } catch {
        setRefreshFailed(true); // saved, but list could not refresh
      }
    } catch (e: any) {
      setErr(mapError(e.message));
    } finally { setSaving(false); }
  };

  const statusText = (() => {
    if (testResult?.ok) return 'Connected — VERIFIED';
    if (testResult) return `Test failed — ${testResult.error?.slice?.(0, 160) ?? 'connection error'}`;
    return '';
  })();

  return (
    <form onSubmit={save} className="db-provider-form">
      <h3>{editId ? 'Edit Provider' : 'Add Provider'}</h3>
          <div className="db-field"><label>Provider name</label>
            <input value={draft.displayName} onChange={(e) => set({ displayName: e.target.value })} placeholder="My Provider" /></div>
          <div className="db-field"><label>Provider type</label>
            <select value={draft.providerType} onChange={(e) => set({ providerType: e.target.value as ProviderType })}>
              <option value="gemini">Gemini native</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select></div>
          <div className="db-field"><label>Base URL</label>
            <input value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })}
              placeholder={draft.providerType === 'gemini' ? 'https://generativelanguage.googleapis.com' : 'https://api.example.com/v1'} /></div>
          <div className="db-field"><label>API key {editId ? '(leave blank to keep current)' : ''}</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => set({ apiKey: e.target.value })}
                placeholder="••••••••"
                autoComplete="new-password"
                style={{ width: '100%', paddingRight: '44px' }}
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.1rem' }}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
              >
                {showKey ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>
          <div className="db-field"><label>Model</label>
            {draft.customModels && draft.customModels.length > 0 ? (
              <select value={draft.modelId} onChange={(e) => set({ modelId: e.target.value })}>
                <option value="">— select a model —</option>
                {draft.customModels.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <p className="db-hint" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                No models loaded yet — click “↻ Refresh models from API key” to populate the list.
              </p>
            )}
            <button type="button" className="db-link" onClick={refreshModels} disabled={testing} style={{ marginTop: 4 }}>
              {testing ? 'Refreshing…' : '↻ Refresh models from API key'}
            </button>
            {draft.customModels && draft.customModels.length > 0 && (
              <div style={{ marginTop: 12, padding: 12, background: 'rgba(139, 92, 246, 0.06)', borderRadius: 10, border: '1px dashed rgba(139, 92, 246, 0.4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ✓ Verified Models List
                  </span>
                  <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'rgba(139, 92, 246, 0.12)', color: '#6d28d9', borderRadius: 20, fontWeight: 600 }}>
                    {draft.customModels.length} Models
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
                  {draft.customModels.map((m) => (
                    <span key={m}
                      onClick={() => set({ modelId: m })}
                      style={{ fontSize: '0.7rem', padding: '4px 10px', background: 'rgba(139, 92, 246, 0.08)', color: '#5b21b6', borderRadius: 8, border: `1px solid ${draft.modelId === m ? '#6d28d9' : 'rgba(139, 92, 246, 0.25)'}`, cursor: 'pointer' }}>
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="db-field"><label>Capabilities</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ALL_CAPS.map((c) => (
                <button key={c} type="button" className={`db-chip-btn ${draft.capabilities.includes(c) ? 'primary' : ''}`} onClick={() => toggleCap(c)}>{c}</button>
              ))}</div></div>
          <div className="db-dialog-actions">
            <button className="db-btn ghost" type="button" onClick={testConnection} disabled={testing}>{testing ? 'Testing…' : 'Test Connection'}</button>
            {statusText && (
              <span className={testResult?.ok ? 'db-ok' : 'db-err'} role="status">{statusText}</span>
            )}
          </div>
          {err && <p className="db-err" role="alert">{err}</p>}
          {refreshFailed && (
            <p className="db-err" role="alert">Provider saved, but the list could not be refreshed.
              <button type="button" className="db-link" onClick={() => { onSaved(); onClose(); }}>Retry Refresh</button></p>
          )}
          <div className="db-dialog-actions">
            <button className="db-btn ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="db-btn primary" type="submit" disabled={saving || !draft.displayName}>{saving ? 'Saving…' : 'Save Provider'}</button>
          </div>
        </form>
  );
}

// Standalone overlay wrapper around ProviderForm (kept for backward-compat /
// external use). The unified ProviderSettingsPanel embeds <ProviderForm> inline
// so there is only ONE modal, not a nested one.
export function ProviderConfigurationDialog({
  open, onClose, onSaved, editId, initial,
}: {
  open: boolean; onClose: () => void; onSaved: () => void; editId?: string | null;
  initial?: ProviderDraft;
}) {
  if (!open) return null;
  return (
    <div className="db-overlay" role="dialog" aria-modal="true" aria-label={editId ? 'Edit provider' : 'Add provider'}>
      <div className="db-dialog glass">
        <ProviderForm onClose={onClose} onSaved={onSaved} editId={editId} initial={initial} />
      </div>
    </div>
  );
}

export function ProviderSettingsPanel({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<ProviderSummaryView[]>([]);
  const [active, setActive] = useState<ActiveSelections>({ activeChatModel: null, activeExtractionModel: null, activeRenderProvider: null });
  // Inline editing state — the config form lives INSIDE this same modal
  // (unified provider + API configuration panel), not a nested overlay.
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editInitial, setEditInitial] = useState<ProviderDraft | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ providers: ProviderSummaryView[] } & ActiveSelections>('/api/providers');
      setProviders(data.providers ?? []);
      setActive({ activeChatModel: data.activeChatModel, activeExtractionModel: data.activeExtractionModel, activeRenderProvider: data.activeRenderProvider });
    } catch (e: any) { setErr(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const openAdd = () => { setEditId(null); setEditInitial(undefined); setEditing(true); };
  const openEdit = (p: ProviderSummaryView) => {
    setEditId(p.id);
    setEditInitial({
      displayName: p.label, providerType: p.providerType, baseUrl: p.baseUrl ?? '',
      apiKey: '', modelId: (active.activeExtractionModel?.providerId === p.id ? active.activeExtractionModel.modelId : ''),
      capabilities: ['multipass-extraction'], optionalHeaders: {}, kind: p.kind,
      customModels: p.customModels ?? [],
    });
    setEditing(true);
  };
  const remove = async (id: string) => {
    if (!confirm('Remove this provider?')) return;
    try { await api(`/api/providers/${id}`, { method: 'DELETE' }); refresh(); } catch (e: any) { setErr(e.message); }
  };
  const selectSlot = async (slot: ProviderKind, providerId: string, modelId: string) => {
    try {
      await api('/api/providers/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot, providerId, modelId }) });
      refresh();
    } catch (e: any) { setErr(e.message); }
  };

  const slotRow = (slot: ProviderKind, label: string, sel: { providerId: string; modelId: string } | null) => (
    <div className="db-slot" key={slot}>
      <span className="db-slot__label">{label}</span>
      <select aria-label={`${label} provider`} value={sel?.providerId ?? ''}
        onChange={(e) => { const p = providers.find((x) => x.id === e.target.value); if (p) selectSlot(slot, p.id, (sel?.providerId === p.id ? sel.modelId : (p.customModels?.[0] ?? ''))); }}>
        <option value="">— none —</option>
        {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <select aria-label={`${label} model`} value={sel?.modelId ?? ''}
        onChange={(e) => { if (sel) selectSlot(slot, sel.providerId, e.target.value); }}>
        <option value="">— none —</option>
        {(providers.find((p) => p.id === sel?.providerId)?.customModels ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  );

  return (
    <div className="db-overlay" role="dialog" aria-modal="true" aria-label="Provider settings">
      <div className="db-dialog db-dialog--wide glass">
        <div className="db-dialog-head"><h3>Providers</h3><button className="db-link" onClick={onClose} aria-label="Close">×</button></div>
        {err && <p className="db-err" role="alert">{err}</p>}

        {/* UPPER: API configuration (add / edit a provider) — rendered inline
            inside this single modal, NOT as a nested overlay. */}
        {editing ? (
          <div className="db-config-section">
            <ProviderForm onClose={() => setEditing(false)} onSaved={refresh} editId={editId} initial={editInitial} />
          </div>
        ) : (
          <div className="db-config-cta">
            <p className="db-note">Add a provider to configure its API key, run a connection test, and discover its models.</p>
            <button className="db-btn primary" onClick={openAdd}>＋ Add Provider</button>
          </div>
        )}

        {/* LOWER: independent slot selections (Chat / Extraction / Render), after the model/test area */}
        <div className="db-slots db-slots--lower">
          {slotRow('chat', 'Chat', active.activeChatModel)}
          {slotRow('extraction', 'Extraction', active.activeExtractionModel)}
          {slotRow('render', 'Render', active.activeRenderProvider)}
        </div>
        <p className="db-note">Selections for Chat, Extraction, and Render are independent — choosing one never overwrites another.</p>

        <ul className="db-provider-list">
          {providers.length === 0 && <li className="db-note">No providers yet. Add one above.</li>}
          {providers.map((p) => (
            <li key={p.id} className="db-provider-row">
              <span className="db-provider-name">{p.label}</span>
              <span className="db-provider-meta">{p.providerType}{p.baseUrl ? ` · ${p.baseUrl}` : ''} · {p.hasApiKey ? 'key set' : 'no key'}{p.enabled ? '' : ' · disabled'}{p.verificationStatus ? ` · ${p.verificationStatus}` : ''}</span>
              <span className="db-spacer" />
              <button className="db-chip-btn" onClick={() => openEdit(p)}>Edit</button>
              <button className="db-chip-btn db-danger" onClick={() => remove(p.id)}>Remove</button>
            </li>
          ))}
        </ul>

        <div className="db-dialog-actions">
          <button className="db-btn ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
