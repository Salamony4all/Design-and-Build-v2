// packages/extraction-ai/src/model-runtime.ts
// §8 — ONE clean internal interface with two provider adapters.
// Request/transport shapes preserve the legacy payloads EXACTLY:
//  - Gemini native: @google/genai generateContent([prompt, { inlineData }])
//    (legacy executePass; no temperature; provider-default params).
//  - OpenAI-compatible: POST {base}/chat/completions with a single user message
//    [text, image_url(data URL)] and max_tokens: 4096 (legacy executePassOpenAI).
// §2 — NO hard-coded model fallback. modelId is REQUIRED.

import { GoogleGenAI } from '@google/genai';

export interface ModelRequest {
  prompt: string;
  imageBase64: string;
  imageMimeType: string;
  modelId: string;
  signal?: AbortSignal;
}

export interface ModelResponse {
  text: string;
}

export interface AiModelRuntime {
  readonly providerType: 'gemini' | 'openai-compatible';
  generate(request: ModelRequest): Promise<ModelResponse>;
}

/** Server-side resolved provider runtime. NEVER serialized to the browser. */
export interface ProviderRuntime {
  providerId: string;
  providerType: 'gemini' | 'openai-compatible';
  baseUrl?: string;
  /** Resolved credential (server-side only). */
  apiKey: string;
  /** Extra headers for custom providers (names+values stay server-side). */
  headers?: Record<string, string>;
}

export class AiConfigurationError extends Error {
  public code: 'AI_MODEL_NOT_CONFIGURED' | 'AI_MODEL_UNAVAILABLE' | 'AI_PROVIDER_NOT_CONFIGURED';
  constructor(code: 'AI_MODEL_NOT_CONFIGURED' | 'AI_MODEL_UNAVAILABLE' | 'AI_PROVIDER_NOT_CONFIGURED', message: string) {
    super(message);
    this.code = code;
    this.name = 'AiConfigurationError';
  }
}

/** Legacy /api/extract google-vs-openai branch detection, preserved verbatim. */
export function isGoogleEndpoint(baseUrl: string | undefined | null): boolean {
  return (
    !baseUrl ||
    baseUrl.trim() === '' ||
    baseUrl.includes('googleapis.com') ||
    baseUrl.includes('generativelanguage')
  );
}

/** Legacy GOOGLE_MODEL_MAP from apps/editor/src/app/api/extract/route.ts —
 *  friendly-name mapping preserved. NOTE: legacy fell back to 'gemma-4-31b-it'
 *  when model was empty; per §2 the clean runtime REQUIRES an explicit model
 *  (AI_MODEL_NOT_CONFIGURED) — documented EXPECTED_SECURITY/BEHAVIOR change. */
export const GOOGLE_MODEL_MAP: Record<string, string> = {
  'gemma-4-31b': 'gemma-4-31b-it',
  'gemma-4-31b-it': 'gemma-4-31b-it',
  'gemma-4-26b': 'gemma-4-26b-a4b-it',
  'gemini-2.5-series': 'gemini-2.5-flash',
};

// ── Native Gemini adapter (legacy executePass transport) ──────────────────────
export class GeminiRequestAdapter implements AiModelRuntime {
  readonly providerType = 'gemini' as const;
  private readonly runtime: ProviderRuntime;
  constructor(runtime: ProviderRuntime) {
    this.runtime = runtime;
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    if (!req.modelId) throw new AiConfigurationError('AI_MODEL_NOT_CONFIGURED', 'No model selected for the active extraction provider.');
    const modelId = GOOGLE_MODEL_MAP[req.modelId] || req.modelId;
    const ai = new GoogleGenAI({ apiKey: this.runtime.apiKey });
    let response;
    try {
      response = await ai.models.generateContent({
        model: modelId,
        contents: [
          req.prompt,
          { inlineData: { data: req.imageBase64, mimeType: req.imageMimeType } },
        ],
        ...(req.signal ? { config: { abortSignal: req.signal } } : {}),
      });
    } catch (e: any) {
      if (e && (e.status === 404 || /no longer available|not found/i.test(String(e.message)))) {
        throw new AiConfigurationError('AI_MODEL_UNAVAILABLE', `Model '${modelId}' is unavailable on this provider. Choose another model from the provider's model list.`);
      }
      throw e;
    }
    const text = response.text;
    if (!text) throw new Error('Empty response from AI model.');
    return { text };
  }
}

// ── OpenAI-compatible adapter (legacy executePassOpenAI transport) ────────────
export class OpenAiCompatibleRequestAdapter implements AiModelRuntime {
  readonly providerType = 'openai-compatible' as const;
  private readonly runtime: ProviderRuntime;
  constructor(runtime: ProviderRuntime) {
    this.runtime = runtime;
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    if (!req.modelId) throw new AiConfigurationError('AI_MODEL_NOT_CONFIGURED', 'No model selected for the active extraction provider.');
    if (!this.runtime.baseUrl) throw new AiConfigurationError('AI_PROVIDER_NOT_CONFIGURED', 'OpenAI-compatible provider requires a Base URL.');
    const base = this.runtime.baseUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.runtime.apiKey}`,
        'Content-Type': 'application/json',
        ...(this.runtime.headers ?? {}),
      },
      signal: req.signal,
      body: JSON.stringify({
        model: req.modelId,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: req.prompt },
              {
                type: 'image_url',
                image_url: { url: `data:${req.imageMimeType};base64,${req.imageBase64}` },
              },
            ],
          },
        ],
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      if (res.status === 404) {
        throw new AiConfigurationError('AI_MODEL_UNAVAILABLE', `Model '${req.modelId}' is unavailable on this provider (${res.status}). Choose another model.`);
      }
      throw new Error(`OpenAI-compatible API error (${res.status}): ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    const text: string | undefined = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from OpenAI-compatible model.');
    return { text };
  }
}

export function createModelRuntime(runtime: ProviderRuntime): AiModelRuntime {
  return runtime.providerType === 'gemini'
    ? new GeminiRequestAdapter(runtime)
    : new OpenAiCompatibleRequestAdapter(runtime);
}
