// features/progressive-build/BuildStageRow.tsx
'use client';
import React from 'react';

export interface StageView {
  key: string;
  name: string;
  status: 'pending' | 'active' | 'done' | 'review' | 'failed';
  committed: number;
  total: number;
}

export function BuildStageRow({ stage }: { stage: StageView }) {
  const cls = stage.status === 'done' ? 'done' : stage.status === 'active' ? 'active'
    : stage.status === 'review' ? 'review' : stage.status === 'failed' ? 'failed' : '';
  const count = stage.total > 0
    ? `${stage.committed} / ${stage.total}`
    : stage.status === 'done' ? 'done' : stage.status === 'active' ? 'running…' : '—';
  return (
    <div className="db-stage-row">
      <span className={`db-stage-dot ${cls}`} aria-hidden />
      <span className="db-stage-meta">
        <span className="name">{stage.name}</span>
        <span className="count">{count}</span>
      </span>
    </div>
  );
}
