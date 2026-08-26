// features/conversation/ChatPanel.tsx
// Centred landing ChatBox → compact docked command bar. MUST NOT import: MuPDF,
// Pascal schemas, useScene, scene mutation bridges, rendering-provider HTTP.
// Emits typed ChatCommands; renders typed ChatEvents. Visual system: globals.css.

'use client';
import React, { useState } from 'react';
import type { ChatCommand, ChatEvent, AttachmentRef } from 'design-build-conversation-core';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { AttachmentGallery } from './AttachmentGallery';

export interface ChatBuildProgress {
  committed: number;
  total: number;
  stage: string;
  terminalState?: 'project-ready' | 'finalizing' | 'building' | 'idle';
}

export interface ChatPanelProps {
  docked?: boolean;
  working?: boolean;
  /** §5: extraction in flight — disables duplicate Extract submissions. */
  busy?: boolean;
  buildProgress?: ChatBuildProgress;
  onCommand: (cmd: ChatCommand) => void;
  events: ChatEvent[];
  models: { chat: string[]; extraction: string[]; render: string[] };
  activeSelection: { chat: string; extraction: string; render: string };
  onSelectModel: (slot: 'chat' | 'extraction' | 'render', id: string) => void;
  /** Open the Provider Settings panel (CRUD + per-slot selection). */
  onOpenSettings?: () => void;
  /** Direct PRO mode builder launcher. */
  onStartPro?: () => void;
  /** Direct sample loader. */
  onStartImport?: () => void;
  /** Compact AI extraction control (owned by the isolated ai-extraction feature). */
  aiExtractionControls?: React.ReactNode;
  /** AI extraction readiness (gates AI Extract only; does not affect Geometric). */
  aiReady?: boolean;
  /** Discovered extraction models for the active provider (dynamic list). */
  extractionModels?: string[];
  /** Extraction method (geometric | ai), lifted to the page so panel + pipeline switch on selection. */
  method?: 'geometric' | 'ai';
  /** Notification when the user toggles the extraction method. */
  onMethodChange?: (m: 'geometric' | 'ai') => void;
}

export function ChatPanel(props: ChatPanelProps) {
  const [open, setOpen] = useState(false);
  // Geometric is the recommended production-pure default; AI is opt-in.
  const [method, setMethod] = useState<'geometric' | 'ai'>(props.method ?? 'geometric');
  const handleMethod = (m: 'geometric' | 'ai') => { setMethod(m); props.onMethodChange?.(m); };

  const cls = ['db-chat', 'glass', props.docked ? 'docked' : 'centered', props.working ? 'working' : ''].join(' ');

  // ---- Docked compact command bar (during/after build) ----
  if (props.docked) {
    const bp = props.buildProgress;
    const lastError = [...props.events].reverse().find((e) => e.type === 'error');
    const terminal = bp?.terminalState;
    const stageLabel = terminal === 'project-ready'
      ? 'Project ready'
      : terminal === 'finalizing'
        ? 'Finalizing the live model'
        : bp ? `Building ${bp.stage} — ${bp.committed} / ${bp.total}` : 'Building…';
    return (
      <div className={cls}>
        <div className="db-chat-glow" aria-hidden />
        <div className="db-dockbar">
          <span className="db-dockbar__stage" aria-live="polite">{lastError && lastError.type === 'error' ? `⚠ ${lastError.message}` : stageLabel}</span>
          <div className="db-docked-input-cluster">
            <AttachmentGallery onAttach={(ref: AttachmentRef) => props.onCommand({ type: 'attach-reference', ref })} />
            <Composer
              compact
              onSend={(text, attachments) => props.onCommand({ type: 'send-message', text, attachments })}
            />
          </div>
          <button className="db-btn ghost" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen((v) => !v)}>{open ? '▾' : '▴'}</button>
        </div>
        {open && (
          <div className="db-chat__body">
            <MessageList events={props.events} />
          </div>
        )}
      </div>
    );
  }

  // ---- Centred landing ChatBox: Two Big Action Cards (Upload & PRO) ----
  return (
    <div className={cls}>
      <div className="db-chat-glow" aria-hidden />
      <div className="db-chat-head">
        <span className="db-spark" aria-hidden>✦</span>
        <div>
          <small>DESIGN &amp; BUILD COPILOT</small>
          <h1>What would you like to build?</h1>
        </div>
      </div>
      <div className="db-chat__body">
        <Composer
          onSend={(text, attachments) => props.onCommand({ type: 'send-message', text, attachments })}
          onExtract={(source, m) => props.onCommand({ type: 'start-extraction', source, extractor: m === 'ai' ? 'gemini' : 'mupdf' })}
          onStartPro={props.onStartPro}
          onStartImport={props.onStartImport}
          method={method}
          onMethod={handleMethod}
          busy={props.busy}
          onOpenSettings={props.onOpenSettings}
          aiExtractionControls={props.aiExtractionControls}
          aiReady={props.aiReady}
        />
      </div>
    </div>
  );
}
