// design-build-conversation-core
// Typed command/event contract between ChatPanel (UI) and services behind it.
// ChatPanel emits commands and displays events. Must NOT import MuPDF, Pascal,
// Three, or any extraction/rendering implementation.

import type { ProgressiveExtractionEvent, ExtractionResult } from 'design-build-extraction-contracts';
import type { RenderRequest, RenderResult, RenderIterationRequest } from 'design-build-render-orchestrator';
import type { ProviderRegistryState } from 'design-build-provider-registry';

export type ChatCommand =
  | { type: 'send-message'; text: string; attachments: AttachmentRef[] }
  | { type: 'set-provider'; slot: 'chat' | 'extraction' | 'render'; providerId: string; modelId: string }
  | { type: 'attach-reference'; ref: AttachmentRef }
  | { type: 'start-extraction'; source: AttachmentRef; extractor: 'mupdf' | 'gemini' }
  | { type: 'cancel-extraction' }
  | { type: 'start-render'; request: RenderRequest }
  | { type: 'iterate-render'; renderId: string; request: RenderIterationRequest }
  | { type: 'start-frozen-import'; source: 'code06' }
  | { type: 'export'; kind: 'boq' | 'moodboard' | 'scene-json'; payload?: unknown }
  | { type: 'clear-conversation' };

// Progressive frozen-import build events (Checkpoint 2). Neutral, no Pascal
// internals — the ChatPanel only renders these; it never triggers scene mutation.
export type ImportStage =
  | 'slab' | 'exterior-walls' | 'principal-internal-walls' | 'service-walls' | 'short-partitions' | 'columns' | 'import';

export type ProgressiveImportEvent =
  | { type: 'import-stage-started'; phase: ImportStage; committed: number; total: number }
  | { type: 'import-stage-progress'; phase: ImportStage; committed: number; total: number; lastWallPhysicalId: string }
  | { type: 'import-stage-completed'; phase: ImportStage; committed: number }
  | { type: 'import-completed'; walls: number; dirty: number; validationOk: boolean };

export type ChatEvent =
  | { type: 'message'; role: 'user' | 'assistant'; text: string; id: string }
  | { type: 'attachment-added'; ref: AttachmentRef }
  | { type: 'extraction-progress'; event: ProgressiveExtractionEvent }
  | { type: 'extraction-complete'; result: ExtractionResult }
  | { type: 'import-progress'; event: ProgressiveImportEvent }
  | { type: 'render-started'; renderId: string }
  | { type: 'render-progress'; renderId: string; progress: number; message?: string }
  | { type: 'render-complete'; result: RenderResult }
  | { type: 'export-ready'; kind: 'boq' | 'moodboard' | 'scene-json'; url: string }
  | { type: 'error'; message: string }
  | { type: 'provider-state'; state: ProviderRegistryState };

export interface AttachmentRef {
  id: string;
  kind: 'pdf' | 'image';
  name: string;
  url?: string;
  byteSize?: number;
  /** MIME type reported by the browser file picker (e.g. application/pdf). */
  mime?: string;
  /** Base64 data URL of the file bytes (set by the Composer for local runs). */
  dataUrl?: string;
}

export interface MessageModel {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments: AttachmentRef[];
  createdAt: string;
}

export interface ConversationPort {
  dispatch(cmd: ChatCommand): void;
  subscribe(handler: (ev: ChatEvent) => void): () => void;
}
