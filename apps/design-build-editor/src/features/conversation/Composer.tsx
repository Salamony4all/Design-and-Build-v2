// features/conversation/Composer.tsx — landing two-card selector + compact docked bar.
// Attachment bytes live in the clean attachment repository (File/Blob) — React
// state holds ONLY metadata (AttachmentRef). No duplicate Base64 copies.
'use client';
import React, { useRef, useState } from 'react';
import type { AttachmentRef } from 'design-build-conversation-core';
import { attachmentRepository } from './attachment-repository';

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
}

const METHODS = [
  { id: 'geometric', label: 'Geometric (MuPDF)', sub: 'Precise vector-based architectural extraction.' },
  { id: 'ai', label: 'AI (Gemini)', sub: 'Multimodal neural vision extraction.' },
] as const;

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

    // Auto-trigger extraction if primary file is provided
    if (added.length > 0 && props.onExtract) {
      const target = added[0];
      const effectiveMethod = (target.kind === 'pdf' ? method : 'ai');
      props.onExtract(target, effectiveMethod);
    }
  };

  const removeAttachment = (id: string) => {
    attachmentRepository.remove(id);
    setPending((p) => p.filter((x) => x.id !== id));
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

  // ---- Compact docked prompt bar (Post-Upload / In-Session) ----
  if (props.compact) {
    return (
      <div className="db-composer db-composer--compact">
        <textarea
          aria-label="Describe styling, materials, or furniture for rendering"
          className="db-textarea"
          placeholder="Describe furniture look & feel, materials, lighting or ask copilot…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (text.trim()) {
                props.onSend(text.trim(), pending);
                setText('');
                setPending([]);
              }
            }
          }}
        />
        {method === 'ai' && props.aiExtractionControls && (
          <div className="db-composer-ai-controls">
            {props.aiExtractionControls}
          </div>
        )}
        <button
          className="db-btn primary"
          aria-label="Send"
          onClick={() => {
            if (text.trim()) {
              props.onSend(text.trim(), pending);
              setText('');
              setPending([]);
            }
          }}
        >
          Send ✦
        </button>
      </div>
    );
  }

  // ---- Landing Stage: Two Big Prominent Cards (Upload & PRO) ----
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

