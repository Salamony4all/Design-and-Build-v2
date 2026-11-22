// features/progressive-build/BuildCard.tsx
// One compact build-status card shared by the geometric and AI pipelines:
// a title, one progress bar, element counts and four plain-language steps.
// While building it can be tucked into a small pill; when the model is ready
// it shrinks to a summary with a Render shortcut.

'use client';
import React from 'react';
import { Check, ChevronDown, Loader2, Sparkles, X, AlertTriangle } from 'lucide-react';

export type BuildStepState = 'pending' | 'active' | 'done' | 'review' | 'failed';

export interface BuildStep {
  key: string;
  label: string;
  state: BuildStepState;
  /** Short count or note shown at the end of the row (e.g. "64"). */
  value?: string;
}

export interface BuildCount {
  label: string;
  value: number;
}

export interface BuildCardProps {
  status: 'running' | 'done' | 'failed';
  title: string;
  /** File name, shown under the title. */
  fileName?: string;
  /** Live detail of the current step (e.g. "Reading door swings"). */
  detail?: string;
  /** 0..1 */
  progress: number;
  elapsed?: string;
  counts: BuildCount[];
  steps: BuildStep[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCancel?: () => void;
  onRender?: () => void;
  onClose?: () => void;
  /** Extra content under the steps (review list). */
  children?: React.ReactNode;
  ariaLabel?: string;
}

function StepIcon({ state }: { state: BuildStepState }) {
  if (state === 'done') return <span className="db-bc-step__icon is-done"><Check size={11} strokeWidth={3} /></span>;
  if (state === 'active') return <span className="db-bc-step__icon is-active"><Loader2 size={12} className="db-spin" /></span>;
  if (state === 'failed') return <span className="db-bc-step__icon is-failed"><X size={11} strokeWidth={3} /></span>;
  if (state === 'review') return <span className="db-bc-step__icon is-review"><AlertTriangle size={10} strokeWidth={2.6} /></span>;
  return <span className="db-bc-step__icon" />;
}

export function BuildCard(props: BuildCardProps) {
  const pct = Math.round(Math.min(1, Math.max(0, props.progress)) * 100);
  const running = props.status === 'running';
  const countsText = props.counts
    .filter((c) => c.value > 0)
    .map((c) => `${c.value} ${c.value === 1 ? c.label.replace(/s$/, '').toLowerCase() : c.label.toLowerCase()}`)
    .join(' · ');

  if (props.collapsed) {
    return (
      <button
        type="button"
        className={`db-bc-pill is-${props.status}`}
        onClick={props.onToggleCollapse}
        aria-label={running ? `Building, ${pct}%. Show details` : 'Show build summary'}
      >
        {running ? <Loader2 size={14} className="db-spin" /> : props.status === 'done' ? <Check size={14} strokeWidth={3} /> : <AlertTriangle size={14} />}
        <span>{running ? `Building… ${pct}%` : props.title}</span>
      </button>
    );
  }

  if (props.status === 'done') {
    return (
      <aside className="db-bc is-done" aria-label={props.ariaLabel ?? 'Build summary'}>
        <div className="db-bc__head">
          <span className="db-bc__badge is-done"><Check size={14} strokeWidth={3} /></span>
          <div className="db-bc__titles">
            <h3>{props.title}</h3>
            <p>{countsText || props.fileName || 'Your 3D model is ready'}</p>
          </div>
          <button type="button" className="db-icon-btn" onClick={props.onClose ?? props.onToggleCollapse} aria-label="Hide">
            <X size={16} />
          </button>
        </div>
        {props.children}
        {props.onRender && (
          <div className="db-bc__actions">
            <button type="button" className="db-btn-primary" onClick={props.onRender}>
              <Sparkles size={14} /> Photoreal render
            </button>
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside className={`db-bc is-${props.status}`} aria-label={props.ariaLabel ?? 'Build progress'}>
      <div className="db-bc__head">
        <span className={`db-bc__badge is-${props.status}`}>
          {running ? <Loader2 size={14} className="db-spin" /> : <AlertTriangle size={14} />}
        </span>
        <div className="db-bc__titles">
          <h3>{props.title}</h3>
          <p>{[props.fileName, props.elapsed].filter(Boolean).join(' · ') || ' '}</p>
        </div>
        <button type="button" className="db-icon-btn" onClick={props.onToggleCollapse} aria-label="Minimise">
          <ChevronDown size={16} />
        </button>
      </div>

      <div className="db-bc__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${Math.max(4, pct)}%` }} />
      </div>

      {props.counts.length > 0 && (
        <div className="db-bc__counts">
          {props.counts.map((c) => (
            <div key={c.label} className="db-bc__count">
              <b>{c.value}</b>
              <span>{c.label}</span>
            </div>
          ))}
        </div>
      )}

      <ol className="db-bc__steps">
        {props.steps.map((s) => (
          <li key={s.key} className={`db-bc-step is-${s.state}`}>
            <StepIcon state={s.state} />
            <span className="db-bc-step__label">{s.label}</span>
            {s.value ? <span className="db-bc-step__value">{s.value}</span> : null}
          </li>
        ))}
      </ol>

      {props.detail && running ? <p className="db-bc__detail">{props.detail}</p> : null}

      {props.children}

      {props.onCancel && running && (
        <div className="db-bc__actions">
          <button type="button" className="db-btn-quiet" onClick={props.onCancel}>Cancel</button>
        </div>
      )}
    </aside>
  );
}

/** Combine several fine-grained stage states into one step state. */
export function combineStates(states: BuildStepState[]): BuildStepState {
  if (states.length === 0) return 'pending';
  if (states.some((s) => s === 'failed')) return 'failed';
  if (states.every((s) => s === 'done')) return 'done';
  if (states.every((s) => s === 'done' || s === 'review')) return 'review';
  if (states.some((s) => s === 'active')) return 'active';
  if (states.some((s) => s === 'done' || s === 'review')) return 'active';
  return 'pending';
}

/** Steps run in order: a step only shows as running once the ones before it are finished. */
export function sequenceSteps(steps: BuildStep[]): BuildStep[] {
  let blocked = false;
  return steps.map((s) => {
    const shown = blocked && s.state === 'active' ? { ...s, state: 'pending' as BuildStepState } : s;
    if (s.state !== 'done' && s.state !== 'review') blocked = true;
    return shown;
  });
}

/** Share of the work done: finished steps count fully, the running one half. */
export function stepProgress(steps: BuildStep[]): number {
  if (steps.length === 0) return 0;
  const score = steps.reduce((n, s) => n + (s.state === 'done' || s.state === 'review' ? 1 : s.state === 'active' ? 0.5 : 0), 0);
  return score / steps.length;
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
