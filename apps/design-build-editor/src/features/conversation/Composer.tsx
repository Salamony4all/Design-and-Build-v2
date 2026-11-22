// features/conversation/Composer.tsx — start-screen cards and the bottom prompt bar.
'use client';
import React, { useRef, useState } from 'react';
import { Plus, Sparkles, ArrowUp, X, FileText, Image as ImageIcon, Upload, PenLine, Box } from 'lucide-react';
import type { AttachmentRef } from 'design-build-conversation-core';
import { attachmentRepository } from './attachment-repository';
import renderStyles from '@/features/render/RenderStudio.module.css';

export interface ComposerProps {
  compact?: boolean;
  onSend: (text: string, attachments: AttachmentRef[]) => void;
  onStartImport?: () => void;
  onStartPro?: () => void;
  /** Build a 3D model from an attached drawing. */
  onExtract?: (source: AttachmentRef, method?: 'geometric' | 'ai') => void;
  method?: 'geometric' | 'ai';
  onMethod?: (m: 'geometric' | 'ai') => void;
  /** A build or render is running. */
  busy?: boolean;
  onOpenSettings?: () => void;
  aiExtractionControls?: React.ReactNode;
  aiReady?: boolean;
  open?: boolean;
  onToggleOpen?: () => void;
  /** Kept for compatibility; snapshots are taken by the render panel now. */
  onTakeSnapshot?: () => Promise<AttachmentRef | AttachmentRef[] | null>;
  /** Opens the photoreal render panel (set once a model is built). */
  onQuickRender?: () => void;
}

function fmtSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const isPdfFile = (f: File) => f.type.includes('pdf') || /\.pdf$/i.test(f.name);

export function Composer(props: ComposerProps) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<AttachmentRef[]>([]);
  const [drag, setDrag] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const method = props.method ?? 'geometric';

  const toRefs = (files: File[]): AttachmentRef[] => files.map((f) => {
    const pdf = isPdfFile(f);
    const id = crypto.randomUUID();
    attachmentRepository.put(id, f);
    return {
      id,
      kind: pdf ? 'pdf' : 'image',
      name: f.name,
      byteSize: f.size,
      mime: f.type || (pdf ? 'application/pdf' : 'application/octet-stream'),
    };
  });

  /** Images can only be read by AI; switch and say so. */
  const methodFor = (ref: AttachmentRef): 'geometric' | 'ai' => {
    if (ref.kind === 'pdf') return method;
    if (method !== 'ai') {
      setNotice('Images are read with AI, so AI is selected.');
      props.onMethod?.('ai');
    }
    return 'ai';
  };

  const addFiles = (files: File[]) => {
    setNotice(null);
    const added = toRefs(files);
    if (!props.compact && added.length > 0 && props.onExtract) {
      // Start screen: building starts as soon as a drawing is chosen.
      const target = added[0];
      const m = methodFor(target);
      if (m === 'ai' && props.aiReady === false) {
        setPending((p) => [...p, ...added]);
        setNotice('Connect an AI provider first (AI Studio, top right), then press Build.');
        return;
      }
      props.onExtract(target, m);
      return;
    }
    setPending((p) => [...p, ...added]);
  };

  const removeAttachment = (id: string) => {
    attachmentRepository.remove(id);
    setPending((p) => p.filter((x) => x.id !== id));
  };

  const drawing = pending.find((a) => a.kind === 'pdf') ?? pending[0];

  const buildFromPending = () => {
    if (!drawing || !props.onExtract || props.busy) return;
    props.onExtract(drawing, methodFor(drawing));
    setPending([]);
    setText('');
  };

  const handleSend = () => {
    if (drawing && props.onExtract) { buildFromPending(); return; }
    if (text.trim()) {
      props.onSend(text.trim(), []);
      setText('');
    }
  };

  // ---- Bottom prompt bar ----
  if (props.compact) {
    const canSubmit = (!!drawing && !props.busy) || !!text.trim();
    const placeholder = drawing
      ? 'Press Build to make a 3D model of this plan'
      : props.onQuickRender
        ? 'Describe a render, e.g. golden hour with oak floors'
        : 'Upload a plan with + to start';
    return (
      <div className="db-gemini-composer-container">
        {pending.length > 0 && (
          <div className="db-gemini-pending-chips">
            {pending.map((a) => (
              <div key={a.id} className="db-gemini-attach-chip">
                {a.kind === 'pdf' ? <FileText size={14} aria-hidden /> : <ImageIcon size={14} aria-hidden />}
                <span className="db-gemini-attach-name">{a.name}</span>
                <span className="db-gemini-attach-size">{fmtSize(a.byteSize)}</span>
                <button type="button" className="db-gemini-chip-remove" onClick={() => removeAttachment(a.id)} aria-label={`Remove ${a.name}`}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="db-gemini-pill-bar">
          <button
            type="button"
            className="db-gemini-add-btn"
            onClick={() => fileRef.current?.click()}
            title="Upload a new plan (PDF or image)"
            aria-label="Upload a new plan"
          >
            <Plus size={17} />
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) addFiles(files.slice(0, 1));
              e.target.value = '';
            }}
          />

          {props.onQuickRender && !drawing && (
            <button
              type="button"
              className={renderStyles.composerRenderBtn}
              onClick={props.onQuickRender}
              title="Photoreal render of this exact 3D view: walls, doors and windows stay locked"
              aria-label="Photoreal render of this 3D view"
            >
              <Sparkles size={14} aria-hidden />
              <span>Render</span>
            </button>
          )}

          <input
            type="text"
            className="db-gemini-input"
            aria-label="Message"
            placeholder={placeholder}
            value={text}
            disabled={!!drawing}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSend();
              }
            }}
          />

          {drawing ? (
            <button
              type="button"
              className="db-gemini-build-btn"
              onClick={buildFromPending}
              disabled={props.busy}
              title="Build a 3D model from this plan (replaces the current model)"
            >
              <Box size={15} aria-hidden />
              <span>Build</span>
            </button>
          ) : (
            <button
              type="button"
              className={`db-gemini-send-btn ${canSubmit ? 'is-active' : ''}`}
              aria-label="Send"
              onClick={handleSend}
              disabled={!canSubmit}
              title="Send (Enter)"
            >
              <ArrowUp size={17} />
            </button>
          )}
        </div>
        {notice && <p className="db-composer-notice" role="status">{notice}</p>}
      </div>
    );
  }

  // ---- Start screen: upload a plan, or start from scratch ----
  return (
    <div className="db-landing-hub">
      <div className="db-landing-cards">
        <div
          className={`db-landing-card db-landing-card--upload ${drag ? 'is-drag' : ''}`}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) addFiles(files.slice(0, 1));
          }}
          role="button"
          tabIndex={0}
          aria-label="Upload a floor plan"
        >
          <input
            ref={fileRef}
            type="file"
            hidden
            accept={method === 'geometric' ? 'application/pdf,.pdf' : 'application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg'}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) addFiles(files.slice(0, 1));
              e.target.value = '';
            }}
          />
          <div className="db-landing-card__icon-box db-landing-card__icon-box--blue">
            <Upload size={26} strokeWidth={2.2} />
          </div>
          <div className="db-landing-card__body">
            <h2 className="db-landing-card__title">Upload a floor plan</h2>
            <p className="db-landing-card__desc">
              {drag ? 'Drop it here' : 'Drop a PDF here or click to choose. Walls, doors and windows become a 3D model.'}
            </p>
          </div>
          <div className="db-landing-card__pills" onClick={(e) => e.stopPropagation()}>
            <div className="db-method-pill" role="radiogroup" aria-label="How to read the plan">
              <button
                type="button"
                role="radio"
                aria-checked={method === 'geometric'}
                className={`db-method-pill__btn ${method === 'geometric' ? 'is-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setNotice(null); props.onMethod?.('geometric'); }}
              >
                Precise
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={method === 'ai'}
                className={`db-method-pill__btn ${method === 'ai' ? 'is-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setNotice(null); props.onMethod?.('ai'); }}
              >
                AI
              </button>
            </div>
            {method === 'ai' && props.aiExtractionControls && (
              <div className="db-landing-card__ai-controls">{props.aiExtractionControls}</div>
            )}
          </div>
          <p className="db-landing-card__hint">
            {method === 'geometric'
              ? 'Exact geometry from CAD PDFs. No AI key needed.'
              : 'Reads scans and images too, using your AI key.'}
          </p>
        </div>

        <div
          className="db-landing-card db-landing-card--pro"
          onClick={() => props.onStartPro?.()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onStartPro?.(); } }}
          role="button"
          tabIndex={0}
          aria-label="Start from scratch in the PRO editor"
        >
          <div className="db-landing-card__icon-box db-landing-card__icon-box--violet">
            <PenLine size={26} strokeWidth={2.2} />
          </div>
          <div className="db-landing-card__body">
            <div className="db-landing-card__title-row">
              <h2 className="db-landing-card__title">Start from scratch</h2>
              <span className="db-pro-badge">PRO</span>
            </div>
            <p className="db-landing-card__desc">
              Draw walls, doors and windows yourself in the full 3D editor.
            </p>
          </div>
          <div className="db-landing-card__pills">
            <span className="db-landing-card__action-label">
              Open the editor <span aria-hidden>→</span>
            </span>
          </div>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="db-landing-pending">
          <div className="db-attachments">
            {pending.map((a) => (
              <span className="db-attach-chip" key={a.id}>
                <FileText size={13} aria-hidden /> {a.name}
                <span className="kind">{fmtSize(a.byteSize)}</span>
                <button aria-label={`Remove ${a.name}`} onClick={() => removeAttachment(a.id)}>×</button>
              </span>
            ))}
          </div>
          <button
            className="db-btn-primary"
            onClick={buildFromPending}
            disabled={!drawing || props.busy || (method === 'ai' && props.aiReady === false)}
          >
            {props.busy ? 'Building…' : 'Build 3D model'}
          </button>
        </div>
      )}

      <div className="db-landing-sample">
        <span>No drawing at hand?</span>
        <button type="button" className="db-link" onClick={() => props.onStartImport?.()}>
          Try the sample plan
        </button>
      </div>

      {notice && <p className="db-composer-notice" role="status">{notice}</p>}
    </div>
  );
}

export default Composer;
