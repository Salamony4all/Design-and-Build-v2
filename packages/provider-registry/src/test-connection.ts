// packages/provider-registry/src/test-connection.ts
// §7 / §11 — provider connectivity + model discovery. For Google Gemini,
// models.list is used during Test Connection / model refresh. For
// OpenAI-compatible providers, use the provider's /models endpoint when
// available, or fall back to manual model entry. Model discovery does NOT
// block migration when the user already supplied an explicit working model.
// NEVER force Google models.list on a custom OpenAI-compatible provider.

import { GoogleGenAI } from '@google/genai';

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
  /** Discovered generateContent-capable models (Gemini) or available models (OpenAI). */
  models?: string[];
}

export async function testGeminiConnection(apiKey: string): Promise<TestConnectionResult> {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const pager = await ai.models.list();
    const all: any[] = [];
    for await (const m of pager) all.push(m);
    const list = all
      .map((m: any) => String(m.name ?? '').replace(/^models\//, ''))
      .filter((name: string) => name.length > 0)
      // Keep generation-capable models. The SDK exposes this under
      // `supportedActions` (not `supportedGenerationMethods`, which is the raw
      // REST field). Fall back to a name heuristic when the field is absent.
      .filter((name: string, _i: number, _arr: string[]) => {
        const m: any = all.find((x: any) => String(x.name ?? '').replace(/^models\//, '') === name);
        const actions: string[] = m?.supportedActions ?? m?.supportedGenerationMethods ?? [];
        if (actions.length) return actions.includes('generateContent');
        return /gemini/i.test(name);
      });
    return { ok: true, models: list };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) };
  }
}

export async function testOpenAiCompatibleConnection(
  baseUrl: string,
  apiKey: string,
  headers?: Record<string, string>,
): Promise<TestConnectionResult> {
  try {
    const base = baseUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, ...(headers ?? {}) },
    });
    if (!res.ok) {
      // Many OpenAI-compatible servers don't implement /models — that's fine;
      // the user can enter a model manually.
      return { ok: false, error: `models endpoint returned ${res.status} (manual model entry still allowed)` };
    }
    const data = await res.json();
    const models = (data.data ?? []).map((m: any) => m.id);
    return { ok: true, models };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) + ' (manual model entry still allowed)' };
  }
}
