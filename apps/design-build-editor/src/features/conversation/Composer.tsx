// features/conversation/Composer.tsx — Gemini-style floating pill prompt bar with 3D Camera Shutter Snapshot.
'use client';
import React, { useRef, useState } from 'react';
import { Plus, Camera, Sparkles, ArrowUp, X, FileText, Image as ImageIcon, CheckCircle2 } from 'lucide-react';
import type { AttachmentRef } from 'design-build-conversation-core';
import { attachmentRepository } from './attachment-repository';
import renderStyles from '@/features/render/RenderStudio.module.css';

export interface ComposerProps {
  compact?: boolean;
  onSend: (text: string, attachments: AttachmentRef[]) => void;
  onStartImport?: () => void;
  onStartPro?: () => void;
  /** Production Extract with an attached drawing. */
  onExtract?: (source: AttachmentRef, method?: 'geometric' | 'ai') => void;
  method?: 'geometric' | 'ai';
  onMethod?: (m: 'geometric' | 'ai') => void;
  /** Disable Extract while a run is in flight. */
  busy?: boolean;
  onOpenSettings?: () => void;
  aiExtractionControls?: React.ReactNode;
  aiReady?: boolean;
  /** Optional toggle for chat history drawer */
  open?: boolean;
  onToggleOpen?: () => void;
  /** Take a snapshot of the current 3D camera view */
  onTakeSnapshot?: () => Promise<AttachmentRef | AttachmentRef[] | null>;
  /** Opens the one-click photoreal render panel (shown once a model is built). */
  onQuickRender?: () => void;
}

function fmtSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function Composer(props: ComposerProps) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<AttachmentRef[]>([]);
  const [drag, setDrag] = useState(false);
  const [isSnapping, setIsSnapping] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const method = props.method ?? 'geometric';

  const addFiles = (files: File[]) => {
    setAttachNotice(null);
    const added: AttachmentRef[] = [];
    files.forEach((f) => {
      const isPdf = f.type.includes('pdf') || /\.pdf$/i.test(f.name);
      if (!isPdf && method === 'geometric') {
        setAttachNotice('Images require AI extraction. Switched method to AI.');
        props.onMethod?.('ai');
      }
      const id = crypto.randomUUID();
      attachmentRepository.put(id, f);
      const ref: AttachmentRef = {
        id,
        kind: isPdf ? 'pdf' : 'image',
        name: f.name,
        byteSize: f.size,
        mime: f.type || (isPdf ? 'application/pdf' : 'application/octet-stream'),
      };
      added.push(ref);
    });
    setPending((p) => [...p, ...added]);

    // Auto-trigger extraction if on landing and primary file is provided
    if (!props.compact && added.length > 0 && props.onExtract) {
      const target = added[0];
      const effectiveMethod = (target.kind === 'pdf' ? method : 'ai');
      props.onExtract(target, effectiveMethod);
    }
  };

  const removeAttachment = (id: string) => {
    attachmentRepository.remove(id);
    setPending((p) => p.filter((x) => x.id !== id));
  };

  const handleSend = () => {
    if (text.trim() || pending.length > 0) {
      props.onSend(text.trim(), pending);
      setText('');
      setPending([]);
    }
  };

  // Camera Shutter Snapshot Handler (Captures 3D View + Bundles 2D Floor Plan Guide)
  const handleSnapshot = async () => {
    if (isSnapping) return;
    setIsSnapping(true);
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 240);

    try {
      let snapshotRefs: AttachmentRef[] = [];
      if (props.onTakeSnapshot) {
        const res = await props.onTakeSnapshot();
        if (Array.isArray(res)) {
          snapshotRefs = res;
        } else if (res) {
          snapshotRefs = [res];
        }
      } else {
        // Fallback: capture main canvas element directly from DOM
        const canvas = document.querySelector('canvas');
        if (canvas) {
          const dataUrl = canvas.toDataURL('image/png');
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          const file = new File([blob], `3d-camera-view-${Date.now()}.png`, { type: 'image/png' });
          const id = crypto.randomUUID();
          attachmentRepository.put(id, file);
          snapshotRefs = [{
            id,
            kind: 'image',
            name: `3D View (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
            byteSize: file.size,
            mime: 'image/png',
          }];
        }
      }

      if (snapshotRefs.length > 0) {
        setPending((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const toAdd = snapshotRefs.filter((r) => !existingIds.has(r.id));
          return [...prev, ...toAdd];
        });
        const hasGuide = snapshotRefs.some((r) =>
          r.name.toLowerCase().includes('plan') ||
          r.name.toLowerCase().includes('drawing') ||
          r.name.toLowerCase().includes('guide')
        );
        if (!text.trim()) {
          if (hasGuide) {
            setText('Photorealistic architectural render matching this 3D perspective view, furnished with the layout, assets, and materials from the 2D floor plan drawing');
          } else {
            setText('Photoreal render of this 3D view in natural daylight');
          }
        }
      }
    } catch (e) {
      console.error('Failed to take 3D snapshot:', e);
    } finally {
      setIsSnapping(false);
    }
  };

  const primaryPdf = pending.find((a) => a.kind === 'pdf');
  const hasAttachment = pending.length > 0;
  const extractEnabled = method === 'geometric'
    ? !!primaryPdf && !props.busy
    : hasAttachment && !props.busy && (props.aiReady ?? true);

  const sendExtract = () => {
    if (method === 'geometric' && props.onExtract) {
      if (!primaryPdf) {
        setAttachNotice('Attach a PDF drawing first, then press Extract.');
        return;
      }
      props.onExtract(primaryPdf, method);
      return;
    }
    if (method === 'ai' && props.onExtract) {
      if (!hasAttachment) {
        setAttachNotice('Attach a drawing (PDF/PNG/JPEG), then press Extract.');
        return;
      }
      props.onExtract(pending[0], method);
      return;
    }
  };

  // ---- Compact Gemini-style Docked Pill Prompt Bar with Camera Shutter ----
  if (props.compact) {
    const canSubmit = !!text.trim() || pending.length > 0;
    return (
      <div className="db-gemini-composer-container">
        {/* Shutter Visual Flash Effect */}
        {showFlash && <div className="db-camera-flash-overlay" aria-hidden />}

        {/* Floating Attachment Tags if any are pending */}
        {pending.length > 0 && (
          <div className="db-gemini-pending-chips">
            {pending.map((a) => {
              const is3d = a.name.toLowerCase().includes('3d view');
              const isPlan = a.name.toLowerCase().includes('plan') || a.name.toLowerCase().includes('drawing') || a.name.toLowerCase().includes('guide');
              return (
                <div key={a.id} className="db-gemini-attach-chip">
                  {a.kind === 'pdf' ? (
                    <FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                  ) : (
                    <ImageIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  )}
                  <span className="db-gemini-attach-name">{a.name}</span>
                  {is3d && (
                    <span className="db-gemini-nano-tag">3D Scene</span>
                  )}
                  {isPlan && (
                    <span className="db-gemini-nano-tag db-gemini-nano-tag--plan">2D Plan Guide</span>
                  )}
                  <span className="db-gemini-attach-size">{fmtSize(a.byteSize)}</span>
                  <button
                    type="button"
                    className="db-gemini-chip-remove"
                    onClick={() => removeAttachment(a.id)}
                    aria-label={`Remove ${a.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* The Main Pill Bar */}
        <div className="db-gemini-pill-bar">
          {/* Left 1: Plus Attachment Button */}
          <button
            type="button"
            className="db-gemini-add-btn"
            onClick={() => fileRef.current?.click()}
            title="Attach architectural drawing (PDF/PNG)"
            aria-label="Attach drawing"
          >
            <Plus className="w-4 h-4 text-slate-700" />
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) addFiles(files);
              e.target.value = '';
            }}
          />

          {/* Left 2: Camera Shutter Snapshot Button */}
          <button
            type="button"
            className={`db-gemini-shutter-btn ${isSnapping ? 'is-snapping' : ''}`}
            onClick={handleSnapshot}
            disabled={isSnapping}
            title="Attach a snapshot of this 3D view (describe the render, then send)"
            aria-label="Capture 3D View Snapshot"
          >
            <Camera className="w-4 h-4" />
          </button>

          {/* Left 3: One-click geometry-locked photoreal render */}
          {props.onQuickRender && (
            <button
              type="button"
              className={renderStyles.composerRenderBtn}
              onClick={props.onQuickRender}
              title="Photoreal render of this exact 3D view — walls, doors and windows stay locked"
              aria-label="Photoreal render of this 3D view"
            >
              <Sparkles size={14} aria-hidden />
              <span>Render</span>
            </button>
          )}

          {/* Center: Clean auto-expanding input */}
          <input
            type="text"
            className="db-gemini-input"
            aria-label="Ask Copilot or describe design changes"
            placeholder="Ask Copilot, take a 3D snapshot, or describe render materials…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSend();
              }
            }}
          />

          {/* Right Slots: Model Dropdown Pill & Controls */}
          {props.aiExtractionControls && (
            <div className="db-gemini-model-slot">
              {props.aiExtractionControls}
            </div>
          )}

          {/* Send Action Button */}
          <button
            type="button"
            className={`db-gemini-send-btn ${canSubmit ? 'is-active' : ''}`}
            aria-label="Send prompt"
            onClick={handleSend}
            disabled={!canSubmit}
            title="Send prompt (Enter)"
          >
            <Sparkles className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ---- Landing Stage: Two Big Action Cards (Upload & PRO) ----
  return (
    <div className="db-landing-hub">
      <div className="db-landing-cards">
        {/* CARD 1: UPLOAD PLAN */}
        <div
          className={`db-landing-card db-landing-card--upload ${drag ? 'is-drag' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) addFiles(files);
          }}
          role="button"
          tabIndex={0}
        >
          <input
            ref={fileRef}
            type="file"
            hidden
            accept={method === 'geometric' ? 'application/pdf,.pdf' : 'application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg'}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) addFiles(files);
              e.target.value = '';
            }}
          />
          <div className="db-landing-card__icon-box db-landing-card__icon-box--blue">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div className="db-landing-card__body">
            <h2 className="db-landing-card__title">Upload Plan</h2>
            <p className="db-landing-card__desc">
              Upload an architectural PDF or image drawing to automatically extract walls, doors & windows into a 3D model.
            </p>
          </div>
          <div className="db-landing-card__pills" onClick={(e) => e.stopPropagation()}>
            <div className="db-method-pill" role="radiogroup" aria-label="Extraction method">
              <button
                type="button"
                className={`db-method-pill__btn ${method === 'geometric' ? 'is-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setAttachNotice(null); props.onMethod?.('geometric'); }}
              >
                Geometric (MuPDF)
              </button>
              <button
                type="button"
                className={`db-method-pill__btn ${method === 'ai' ? 'is-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setAttachNotice(null); props.onMethod?.('ai'); }}
              >
                AI (Gemini)
              </button>
            </div>
            {method === 'ai' && props.aiExtractionControls && (
              <div className="db-landing-card__ai-controls">
                {props.aiExtractionControls}
              </div>
            )}
          </div>
        </div>

        {/* CARD 2: PRO BUILD */}
        <div
          className="db-landing-card db-landing-card--pro"
          onClick={() => props.onStartPro?.()}
          role="button"
          tabIndex={0}
        >
          <div className="db-landing-card__icon-box db-landing-card__icon-box--violet">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </div>
          <div className="db-landing-card__body">
            <div className="db-landing-card__title-row">
              <h2 className="db-landing-card__title">PRO Mode</h2>
              <span className="db-pro-badge">Full Editor</span>
            </div>
            <p className="db-landing-card__desc">
              Start a new 3D project from scratch in official Pascal PRO editor with Outliner, Catalog, Inspector & 3D drafting.
            </p>
          </div>
          <div className="db-landing-card__pills">
            <span className="db-landing-card__action-label">
              Start Building <span>→</span>
            </span>
          </div>
        </div>
      </div>

      {/* Selected file preview if pending */}
      {pending.length > 0 && (
        <div className="db-landing-pending">
          <div className="db-attachments">
            {pending.map((a) => (
              <span className="db-attach-chip" key={a.id}>
                📄 {a.name}
                <span className="kind">{fmtSize(a.byteSize)}</span>
                <button aria-label={`remove ${a.name}`} onClick={() => removeAttachment(a.id)}>×</button>
              </span>
            ))}
          </div>
          <button
            className="db-btn primary db-landing-extract-btn"
            onClick={sendExtract}
            disabled={!extractEnabled}
          >
            {props.busy ? 'Extracting…' : 'Start Extraction & 3D Build →'}
          </button>
        </div>
      )}

      {/* Quick sample shortcut */}
      <div className="db-landing-sample">
        <span>Need a test drawing?</span>
        <button
          type="button"
          className="db-link"
          onClick={() => props.onStartImport?.()}
        >
          Load Sample CODE-06 Plan
        </button>
      </div>

      {attachNotice && <p className="db-method__sub" role="alert" style={{ textAlign: 'center', marginTop: 8 }}>{attachNotice}</p>}
    </div>
  );
}

export default Composer;
