// features/conversation/RenderResultCard.tsx
// Interactive Photorealistic Render Result Card with Before/After comparison and separate modal enlarge.
'use client';
import React, { useState } from 'react';
import { Maximize2, Download, Layers, Check, Copy, Sparkles } from 'lucide-react';
import type { RenderResult } from 'design-build-render-orchestrator';
import { CompareSlider } from '@/features/render/CompareSlider';

export interface RenderResultCardProps {
  result: RenderResult;
  onOpenLightbox?: (imgUrl: string, title: string) => void;
  onIteratePrompt?: (promptAdjustment: string) => void;
}

export function RenderResultCard({ result, onOpenLightbox, onIteratePrompt }: RenderResultCardProps) {
  const [viewMode, setViewMode] = useState<'render' | 'snapshot' | 'plan' | 'split'>('render');
  const [copied, setCopied] = useState(false);

  const previewUrl = result.previewUrl || '/nano-banana-render-sample.jpg';
  const snapshotUrl = result.snapshotUrl;
  const planUrl = result.planUrl;
  const modelLabel = result.modelLabel ?? 'Nano Banana';
  const matchPct = typeof result.fidelity === 'number' ? Math.round(result.fidelity * 100) : null;
  const fileExt = (result.mimeType ?? previewUrl).includes('png') ? 'png' : (result.mimeType ?? previewUrl).includes('webp') ? 'webp' : 'jpg';

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = previewUrl;
    a.download = `photoreal-${result.styleId ?? 'render'}-${result.renderId}.${fileExt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(previewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const currentDisplayUrl =
    viewMode === 'snapshot' && snapshotUrl
      ? snapshotUrl
      : viewMode === 'plan' && planUrl
        ? planUrl
        : previewUrl;

  const currentTitle =
    viewMode === 'snapshot'
      ? '3D View Camera Snapshot'
      : viewMode === 'plan'
        ? '2D Architectural Floor Plan Reference'
        : `${modelLabel} photoreal render`;

  const handleEnlarge = () => {
    if (viewMode === 'split') return; // the compare slider owns clicks and drags
    onOpenLightbox?.(currentDisplayUrl, currentTitle);
  };

  return (
    <div className="db-render-card">
      {/* Header with Provider Badge & Mode Toggle */}
      <div className="db-render-card__header">
        <div className="db-render-card__title-row">
          <div className="db-render-card__badge-banana">
            <span className="text-sm">🍌</span>
            <span className="font-bold text-amber-950 text-xs">{modelLabel}</span>
          </div>
          <span className="db-render-card__tag" title="Share of the model's wall, door and window edges found in the same place in the render">
            {matchPct !== null ? `Geometry match ${matchPct}%` : 'Photoreal'}
          </span>
        </div>

        {/* View Mode Switcher if snapshot or plan is available */}
        {(snapshotUrl || planUrl) && (
          <div className="db-render-mode-toggle" role="tablist">
            <button
              type="button"
              className={`db-mode-btn ${viewMode === 'render' ? 'is-active' : ''}`}
              onClick={() => setViewMode('render')}
              title="View Synthesized Photorealistic Image"
            >
              ✨ Photoreal
            </button>
            {snapshotUrl && (
              <button
                type="button"
                className={`db-mode-btn ${viewMode === 'snapshot' ? 'is-active' : ''}`}
                onClick={() => setViewMode('snapshot')}
                title="View Original 3D Snapshot"
              >
                📸 3D View
              </button>
            )}
            {planUrl && (
              <button
                type="button"
                className={`db-mode-btn ${viewMode === 'plan' ? 'is-active' : ''}`}
                onClick={() => setViewMode('plan')}
                title="View 2D Architectural Floor Plan Reference"
              >
                📐 2D Plan
              </button>
            )}
            {snapshotUrl && (
              <button
                type="button"
                className={`db-mode-btn ${viewMode === 'split' ? 'is-active' : ''}`}
                onClick={() => setViewMode('split')}
                title="Compare Side by Side"
              >
                <Layers className="w-3 h-3 inline mr-1" />
                Compare
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Image Showcase (Clicking opens separate Lightbox modal) */}
      <div className="db-render-card__viewport" onClick={handleEnlarge}>
        {viewMode === 'split' && snapshotUrl ? (
          <CompareSlider before={snapshotUrl} after={previewUrl} overlay={result.overlayUrl} showOverlay={false} frameStyle={{ height: '100%' }} />
        ) : (
          <div className="db-render-img-wrapper">
            <img
              src={currentDisplayUrl}
              alt="Architectural Visualization"
              className="db-render-img"
            />
            <div className="db-render-overlay-hint">
              <div className="db-enlarge-pill">
                <Maximize2 className="w-4 h-4 text-white" />
                <span>Enlarge in Separate Modal</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="db-render-card__footer">
        <div className="db-render-actions-left">
          <button
            type="button"
            className="db-render-act-btn db-render-act-btn--primary"
            onClick={handleEnlarge}
            title="Open high-res image in separate fullscreen modal"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Enlarge Modal</span>
          </button>
          <button
            type="button"
            className="db-render-act-btn"
            onClick={handleDownload}
            title="Download the photoreal image"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>
          <button
            type="button"
            className="db-render-act-btn"
            onClick={handleCopy}
            title="Copy Image URL"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>

        {/* Quick prompt adjustments */}
        {onIteratePrompt && (
          <div className="db-render-variations">
            <span className="db-var-label">Variations:</span>
            <button
              type="button"
              className="db-var-chip"
              onClick={() => onIteratePrompt('Change to warm golden hour sunset lighting with soft ambient shadows')}
            >
              🌅 Golden Hour
            </button>
            <button
              type="button"
              className="db-var-chip"
              onClick={() => onIteratePrompt('Add luxury polished Italian marble flooring and warm pendant lighting')}
            >
              ✨ Marble & Wood
            </button>
            <button
              type="button"
              className="db-var-chip"
              onClick={() => onIteratePrompt('Night architectural scene with warm interior lighting and soft garden illumination')}
            >
              🌙 Night Mode
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default RenderResultCard;
