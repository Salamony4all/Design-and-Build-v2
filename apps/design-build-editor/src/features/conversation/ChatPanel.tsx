// features/conversation/ChatPanel.tsx
// Start screen (upload a plan or start from scratch), then a bottom prompt bar
// with an activity drawer. Build progress lives in the build card (top right);
// renders live in the Renders thread (the prompt bar shows a render's progress
// while that thread is closed, and opens it on a tap).
// MUST NOT import: MuPDF, Pascal schemas, useScene, scene mutation bridges, rendering-provider HTTP.

'use client';
import React, { useEffect, useState } from 'react';
import { Sparkles, MessageSquare, PanelLeftClose, PanelLeft, AlertTriangle, X } from 'lucide-react';
import type { ChatCommand, ChatEvent, AttachmentRef } from 'design-build-conversation-core';
import { MessageList } from './MessageList';
import { Composer } from './Composer';

export interface ChatBuildProgress {
  committed: number;
  total: number;
  stage: string;
  terminalState?: 'project-ready' | 'finalizing' | 'building' | 'idle';
}

export interface ChatRenderProgress {
  isRendering: boolean;
  progress: number;
  stageName: string;
  snapshotUrl?: string;
  renderId?: string;
  modelLabel?: string;
}

export interface ChatExtractionProgress {
  isExtracting: boolean;
  pipeline: 'geometric' | 'ai';
  stageText: string;
  progressPercent: number;
  fileName?: string;
}

export interface ChatPanelProps {
  docked?: boolean;
  working?: boolean;
  /** §5: extraction in flight — disables duplicate Extract submissions. */
  busy?: boolean;
  buildProgress?: ChatBuildProgress;
  renderProgress?: ChatRenderProgress;
  extractionProgress?: ChatExtractionProgress;
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
  /** Take a 3D camera view snapshot for Nano Banana render */
  onTakeSnapshot?: () => Promise<AttachmentRef | AttachmentRef[] | null>;
  /** Opens the photoreal render panel (set once a model is built). */
  onQuickRender?: () => void;
  /** Opens the Renders thread (from the render progress strip). */
  onOpenRenders?: () => void;
  /** The Activity drawer opened or closed. */
  onDrawerChange?: (open: boolean) => void;
}

export function ChatPanel(props: ChatPanelProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { onDrawerChange } = props;
  useEffect(() => {
    onDrawerChange?.(drawerOpen);
  }, [drawerOpen, onDrawerChange]);
  const [dismissedError, setDismissedError] = useState(-1);
  const [method, setMethod] = useState<'geometric' | 'ai'>(props.method ?? 'geometric');
  const handleMethod = (m: 'geometric' | 'ai') => { setMethod(m); props.onMethodChange?.(m); };

  const ep = props.extractionProgress;
  const rp = props.renderProgress;

  const visibleMessagesCount = props.events.filter(
    (e) => e.type === 'message' || e.type === 'error' || e.type === 'render-complete',
  ).length;

  // ---- Docked: activity drawer on the left + prompt bar at the bottom ----
  if (props.docked) {
    // Show an error only while it is the latest thing that happened.
    let errorIndex = -1;
    for (let i = props.events.length - 1; i >= 0; i--) {
      const t = props.events[i].type;
      if (t === 'error') { errorIndex = i; break; }
      if (t === 'message' || t === 'render-complete') break;
    }
    const errorEvent = errorIndex >= 0 && errorIndex !== dismissedError ? props.events[errorIndex] : null;
    const isBusy = props.busy || ep?.isExtracting || rp?.isRendering;
    const renderPercent = Math.min(100, Math.max(3, Math.round((rp?.progress || 0) * 100)));

    return (
      <>
        <aside
          className={`db-gemini-left-drawer ${drawerOpen ? 'is-open' : 'is-collapsed'}`}
          aria-label="Activity"
        >
          <div className="db-left-drawer__header">
            <div className="db-left-drawer__title">
              <span className="db-left-drawer__icon-badge"><Sparkles size={15} /></span>
              <span>
                <b>Activity</b>
                <small>Messages and renders</small>
              </span>
              {visibleMessagesCount > 0 && <span className="db-badge-count">{visibleMessagesCount}</span>}
            </div>
            <button
              type="button"
              className="db-drawer-close-btn"
              onClick={() => setDrawerOpen(false)}
              title="Close"
              aria-label="Close activity"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>

          <div className="db-left-drawer__body">
            <MessageList
              events={props.events}
              onIteratePrompt={(text) => props.onCommand({ type: 'send-message', text, attachments: [] })}
            />
          </div>
        </aside>

        <div className={`db-gemini-dock-root ${isBusy ? 'is-working' : ''}`}>
          {rp?.isRendering && (
            <button
              type="button"
              className="db-render-strip"
              role="status"
              aria-live="polite"
              onClick={props.onOpenRenders}
              disabled={!props.onOpenRenders}
              title="Open Renders"
            >
              <Sparkles size={14} className="db-render-strip__icon" aria-hidden />
              <span className="db-render-strip__text">{rp.stageName || 'Rendering your view…'}</span>
              <span className="db-render-strip__pct">{renderPercent}%</span>
              <span className="db-render-strip__bar" aria-hidden><span style={{ width: `${renderPercent}%` }} /></span>
            </button>
          )}

          {errorEvent && errorEvent.type === 'error' && (
            <div className="db-error-strip" role="alert">
              <AlertTriangle size={14} aria-hidden />
              <span>{errorEvent.message}</span>
              <button type="button" onClick={() => setDismissedError(errorIndex)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          )}

          <div className="db-gemini-capsule-wrapper">
            <button
              type="button"
              className={`db-gemini-drawer-toggle ${drawerOpen ? 'is-active' : ''}`}
              onClick={() => setDrawerOpen((v) => !v)}
              title={drawerOpen ? 'Close activity' : 'Activity: messages and renders'}
              aria-label={drawerOpen ? 'Close activity' : 'Open activity'}
            >
              {drawerOpen ? <PanelLeft size={16} /> : <MessageSquare size={16} />}
              {visibleMessagesCount > 0 && !drawerOpen && <span className="db-capsule-unread-dot" />}
            </button>

            <Composer
              compact
              onSend={(text, attachments) => props.onCommand({ type: 'send-message', text, attachments })}
              onExtract={(source, m) => props.onCommand({ type: 'start-extraction', source, extractor: m === 'ai' ? 'gemini' : 'mupdf' })}
              method={method}
              onMethod={handleMethod}
              open={drawerOpen}
              onToggleOpen={() => setDrawerOpen((v) => !v)}
              onQuickRender={props.onQuickRender}
              busy={isBusy}
            />
          </div>
        </div>
      </>
    );
  }

  // ---- Centred landing ChatBox: Two Big Action Cards (Upload & PRO) ----
  const cls = ['db-chat', 'glass', 'centered', props.working ? 'working' : ''].join(' ');
  return (
    <div className={cls}>
      <div className="db-chat-glow" aria-hidden />
      <div className="db-chat-head">
        <div>
          <h1>What would you like to build?</h1>
          <p>Turn a floor plan into a 3D model in seconds, then render it photoreal.</p>
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
          busy={props.busy || ep?.isExtracting || rp?.isRendering}
          onOpenSettings={props.onOpenSettings}
          aiExtractionControls={props.aiExtractionControls}
          aiReady={props.aiReady}
          onTakeSnapshot={props.onTakeSnapshot}
        />
      </div>
    </div>
  );
}

export default ChatPanel;
