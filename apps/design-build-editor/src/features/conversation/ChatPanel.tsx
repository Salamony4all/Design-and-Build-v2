// features/conversation/ChatPanel.tsx
// Centred landing ChatBox → Smooth Left Drawer + Floating Pill Prompt Bar with Motivating Holographic Progress Visualizer.
// MUST NOT import: MuPDF, Pascal schemas, useScene, scene mutation bridges, rendering-provider HTTP.

'use client';
import React, { useState } from 'react';
import {
  Sparkles,
  Loader2,
  Cpu,
  Bot,
  MessageSquare,
  PanelLeftClose,
  PanelLeft,
  Check,
  Zap,
  Layers,
  Box,
  Compass,
  Scan,
  Activity,
} from 'lucide-react';
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
}

export function ChatPanel(props: ChatPanelProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [method, setMethod] = useState<'geometric' | 'ai'>(props.method ?? 'geometric');
  const handleMethod = (m: 'geometric' | 'ai') => { setMethod(m); props.onMethodChange?.(m); };

  const ep = props.extractionProgress;
  const rp = props.renderProgress;
  const bp = props.buildProgress;

  const visibleMessagesCount = props.events.filter(
    (e) => e.type === 'message' || e.type === 'error' || e.type === 'render-complete',
  ).length;

  // ---- Docked Mode (Floating Pill Bar + Sleek Left Drawer) ----
  if (props.docked) {
    const lastError = [...props.events].reverse().find((e) => e.type === 'error');
    const terminal = bp?.terminalState;

    let stageLabel = 'Active session';
    if (ep?.isExtracting) {
      stageLabel = `⚙️ ${ep.pipeline === 'geometric' ? 'MuPDF' : 'AI'} Extraction: ${ep.stageText} (${Math.round(ep.progressPercent)}%)`;
    } else if (rp?.isRendering) {
      stageLabel = `✨ Rendering: ${rp.stageName} (${Math.round(rp.progress * 100)}%)`;
    } else if (terminal === 'project-ready') {
      stageLabel = '3D Model Ready';
    } else if (terminal === 'finalizing') {
      stageLabel = 'Finalizing the live model';
    } else if (bp) {
      stageLabel = `Building ${bp.stage} (${bp.committed}/${bp.total})`;
    }

    const isBusy = props.busy || ep?.isExtracting || rp?.isRendering;
    const progressPercent = Math.min(100, Math.max(5, Math.round(ep?.progressPercent || 0)));
    const renderPercent = Math.min(100, Math.max(5, Math.round((rp?.progress || 0) * 100)));

    // Milestone calculation for Geometric / AI extraction
    const currentStep = progressPercent < 25 ? 1 : progressPercent < 60 ? 2 : progressPercent < 85 ? 3 : 4;
    const renderStep = renderPercent < 8 ? 1 : renderPercent < 80 ? 2 : renderPercent < 100 ? 3 : 4;

    return (
      <>
        {/* =========================================================================
            SLEEK LEFT SIDEBAR DRAWER (Never covers central 3D building view)
            ========================================================================= */}
        <aside
          className={`db-gemini-left-drawer ${drawerOpen ? 'is-open' : 'is-collapsed'}`}
          aria-label="Copilot Conversation & Render Activity"
        >
          <div className="db-left-drawer__header">
            <div className="flex items-center gap-2">
              <div className="db-left-drawer__icon-badge">
                <Sparkles className="w-4 h-4 text-violet-600" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-xs text-slate-800">Copilot Activity</span>
                <span className="text-[10.5px] text-slate-500 font-medium">History &amp; Renders</span>
              </div>
              {visibleMessagesCount > 0 && (
                <span className="db-badge-count ml-1">{visibleMessagesCount}</span>
              )}
            </div>

            <button
              type="button"
              className="db-drawer-close-btn"
              onClick={() => setDrawerOpen(false)}
              title="Collapse Left Drawer"
              aria-label="Collapse Left Drawer"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          <div className="db-left-drawer__body">
            <MessageList
              events={props.events}
              onIteratePrompt={(text) => props.onCommand({ type: 'send-message', text, attachments: [] })}
            />
          </div>
        </aside>

        {/* =========================================================================
            BOTTOM FLOATING GEMINI PROMPT CAPSULE & MOTIVATING HOLOGRAPHIC PROGRESS
            ========================================================================= */}
        <div className={`db-gemini-dock-root ${isBusy ? 'is-working' : ''}`}>
          {/* =========================================================================
              MOTIVATING HIGH-TECH EXTRACTION PROGRESS CARD
              ========================================================================= */}
          {ep?.isExtracting && (
            <div className="db-hologram-progress-card">
              <div className="db-holo-card-glow" aria-hidden />

              {/* Header with live orbital radar & status */}
              <div className="db-holo-header">
                <div className="db-holo-header-left">
                  <div className="db-holo-orbital-core">
                    <div className="db-holo-orbital-ring" />
                    <div className="db-holo-orbital-pulse" />
                    {ep.pipeline === 'geometric' ? (
                      <Cpu className="w-4 h-4 text-cyan-500 z-10 animate-pulse" />
                    ) : (
                      <Bot className="w-4 h-4 text-violet-500 z-10 animate-pulse" />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-slate-900 tracking-tight">
                        {ep.pipeline === 'geometric' ? 'Geometric MuPDF Extractor' : 'AI Gemini Progressive Engine'}
                      </span>
                      <span className="db-holo-chip-active">
                        <Zap className="w-2.5 h-2.5 inline mr-1 text-amber-500" />
                        SYNTHESIS ACTIVE
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 font-medium truncate max-w-[320px]">
                      {ep.fileName ? `Source: ${ep.fileName}` : 'Parsing architectural vector blueprint'}
                    </span>
                  </div>
                </div>

                <div className="db-holo-header-right">
                  <span className="db-holo-percentage">{progressPercent}%</span>
                </div>
              </div>

              {/* 4-Stage Visual Milestones Stepper */}
              <div className="db-holo-milestones-row">
                <div className={`db-holo-step ${currentStep >= 1 ? 'is-active' : ''} ${currentStep > 1 ? 'is-done' : ''}`}>
                  <div className="db-holo-step-dot">
                    {currentStep > 1 ? <Check className="w-2.5 h-2.5 text-white" /> : <span>1</span>}
                  </div>
                  <span className="db-holo-step-label">📐 Vectors</span>
                </div>
                <div className="db-holo-step-connector" />

                <div className={`db-holo-step ${currentStep >= 2 ? 'is-active' : ''} ${currentStep > 2 ? 'is-done' : ''}`}>
                  <div className="db-holo-step-dot">
                    {currentStep > 2 ? <Check className="w-2.5 h-2.5 text-white" /> : <span>2</span>}
                  </div>
                  <span className="db-holo-step-label">🧱 3D Walls</span>
                </div>
                <div className="db-holo-step-connector" />

                <div className={`db-holo-step ${currentStep >= 3 ? 'is-active' : ''} ${currentStep > 3 ? 'is-done' : ''}`}>
                  <div className="db-holo-step-dot">
                    {currentStep > 3 ? <Check className="w-2.5 h-2.5 text-white" /> : <span>3</span>}
                  </div>
                  <span className="db-holo-step-label">🚪 Openings</span>
                </div>
                <div className="db-holo-step-connector" />

                <div className={`db-holo-step ${currentStep >= 4 ? 'is-active' : ''} ${progressPercent === 100 ? 'is-done' : ''}`}>
                  <div className="db-holo-step-dot">
                    {progressPercent === 100 ? <Check className="w-2.5 h-2.5 text-white" /> : <span>4</span>}
                  </div>
                  <span className="db-holo-step-label">🏛️ Pascal 3D</span>
                </div>
              </div>

              {/* Aurora Laser Progress Bar */}
              <div className="db-holo-progress-track">
                <div
                  className="db-holo-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                >
                  <div className="db-holo-laser-head" />
                </div>
              </div>

              {/* Bottom Live Telemetry & Micro-Metrics */}
              <div className="db-holo-footer">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Activity className="w-3 h-3 text-cyan-600 animate-pulse flex-shrink-0" />
                  <span className="db-holo-stage-description truncate">
                    {ep.stageText || 'Generating calibrated 3D geometry & spatial hierarchy…'}
                  </span>
                </div>

                <div className="db-holo-hud-badges">
                  <span className="db-hud-badge">⚡ Sub-mm Alignment</span>
                  <span className="db-hud-badge">Pascal v0.9.2</span>
                </div>
              </div>
            </div>
          )}

          {/* =========================================================================
              MOTIVATING NANO BANANA PHOTOREAL RENDERING PROGRESS CARD
              ========================================================================= */}
          {rp?.isRendering && (
            <div className="db-hologram-progress-card db-hologram-progress-card--banana">
              <div className="db-holo-card-glow db-holo-card-glow--gold" aria-hidden />

              <div className="db-holo-header">
                <div className="db-holo-header-left">
                  <div className="db-holo-orbital-core db-holo-orbital-core--banana">
                    <div className="db-holo-orbital-ring db-holo-orbital-ring--banana" />
                    <span className="text-base z-10 animate-bounce">🍌</span>
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-amber-950 tracking-tight">
                        {rp.modelLabel ?? 'Nano Banana'} · Photoreal render
                      </span>
                      <span className="db-holo-chip-active db-holo-chip-active--banana">
                        <Sparkles className="w-2.5 h-2.5 inline mr-1 text-amber-600" />
                        GEOMETRY-LOCKED
                      </span>
                    </div>
                    <span className="text-[11px] text-amber-800 font-medium">
                      {rp.stageName || 'Your exact 3D view, re-skinned photoreal'}
                    </span>
                  </div>
                </div>

                <div className="db-holo-header-right">
                  <span className="db-holo-percentage db-holo-percentage--banana">{renderPercent}%</span>
                </div>
              </div>

              {/* 4-Stage Photoreal Synthesis Stepper */}
              <div className="db-holo-milestones-row">
                <div className={`db-holo-step db-holo-step--banana ${renderStep >= 1 ? 'is-active' : ''} ${renderStep > 1 ? 'is-done' : ''}`}>
                  <div className="db-holo-step-dot">
                    {renderStep > 1 ? <Check className="w-2.5 h-2.5 text-white" /> : <span>1</span>}
                  </div>
                  <span className="db-holo-step-label">📸 Capture</span>
                </div>
                <div className="db-holo-step-connector db-holo-step-connector--banana" />

                <div className={`db-holo-step db-holo-step--banana ${renderStep >= 2 ? 'is-active' : ''} ${renderStep > 2 ? 'is-done' : ''}`}>
                  <div className="db-holo-step-dot">
                    {renderStep > 2 ? <Check className="w-2.5 h-2.5 text-white" /> : <span>2</span>}
                  </div>
                  <span className="db-holo-step-label">✨ Render</span>
                </div>
                <div className="db-holo-step-connector db-holo-step-connector--banana" />

                <div className={`db-holo-step db-holo-step--banana ${renderStep >= 3 ? 'is-active' : ''} ${renderStep > 3 ? 'is-done' : ''}`}>
                  <div className="db-holo-step-dot">
                    {renderStep > 3 ? <Check className="w-2.5 h-2.5 text-white" /> : <span>3</span>}
                  </div>
                  <span className="db-holo-step-label">📐 Geometry check</span>
                </div>
                <div className="db-holo-step-connector db-holo-step-connector--banana" />

                <div className={`db-holo-step db-holo-step--banana ${renderStep >= 4 ? 'is-active' : ''} ${renderPercent === 100 ? 'is-done' : ''}`}>
                  <div className="db-holo-step-dot">
                    {renderPercent === 100 ? <Check className="w-2.5 h-2.5 text-white" /> : <span>4</span>}
                  </div>
                  <span className="db-holo-step-label">✅ Done</span>
                </div>
              </div>

              {/* Gold Aurora Progress Bar */}
              <div className="db-holo-progress-track db-holo-progress-track--banana">
                <div
                  className="db-holo-progress-fill db-holo-progress-fill--banana"
                  style={{ width: `${renderPercent}%` }}
                >
                  <div className="db-holo-laser-head db-holo-laser-head--banana" />
                </div>
              </div>

              <div className="db-holo-footer">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Sparkles className="w-3 h-3 text-amber-600 animate-spin flex-shrink-0" />
                  <span className="db-holo-stage-description text-amber-900 truncate">
                    {rp.stageName || 'Synthesizing photorealistic architectural visualization…'}
                  </span>
                </div>

                <div className="db-holo-hud-badges">
                  <span className="db-hud-badge db-hud-badge--banana">HDR Lighting</span>
                  <span className="db-hud-badge db-hud-badge--banana">Ray Traced</span>
                </div>
              </div>
            </div>
          )}

          {/* Main Gemini-style Capsule Row */}
          <div className="db-gemini-capsule-wrapper">
            {/* Left Drawer Toggle Icon Button */}
            <button
              type="button"
              className={`db-gemini-drawer-toggle ${drawerOpen ? 'is-active' : ''}`}
              onClick={() => setDrawerOpen((v) => !v)}
              title={drawerOpen ? 'Hide Left Drawer Panel' : 'Open Copilot Activity Drawer'}
              aria-label="Toggle Left Drawer"
            >
              {drawerOpen ? <PanelLeft className="w-4 h-4 text-violet-600" /> : <MessageSquare className="w-4 h-4 text-slate-700" />}
              {visibleMessagesCount > 0 && !drawerOpen && (
                <span className="db-capsule-unread-dot" />
              )}
            </button>

            {/* Integrated Prompt Composer */}
            <Composer
              compact
              onSend={(text, attachments) => props.onCommand({ type: 'send-message', text, attachments })}
              aiExtractionControls={props.aiExtractionControls}
              open={drawerOpen}
              onToggleOpen={() => setDrawerOpen((v) => !v)}
              onTakeSnapshot={props.onTakeSnapshot}
              onQuickRender={props.onQuickRender}
              busy={isBusy}
            />
          </div>

          {/* Sub-prompt Disclaimer / Telemetry */}
          <div className="db-gemini-sub-meta">
            <span className={`db-gemini-status-dot ${ep?.isExtracting ? 'is-extracting' : rp?.isRendering ? 'is-rendering' : ''}`} />
            <span className="db-gemini-status-text">
              {lastError && lastError.type === 'error' ? `⚠ ${lastError.message}` : stageLabel}
            </span>
            <span className="db-gemini-meta-sep">•</span>
            <span className="db-gemini-disclaimer-text">Design &amp; Build Copilot</span>
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
