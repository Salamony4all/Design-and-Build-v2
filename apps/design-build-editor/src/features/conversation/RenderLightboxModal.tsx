// features/conversation/RenderLightboxModal.tsx
// Fullscreen high-resolution lightbox inspector rendered via React Portal away from the chat.
'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, ZoomIn, ZoomOut, RotateCcw, Sparkles } from 'lucide-react';

export interface RenderLightboxModalProps {
  imageUrl: string;
  title?: string;
  onClose: () => void;
}

export function RenderLightboxModal({ imageUrl, title, onClose }: RenderLightboxModalProps) {
  const [mounted, setMounted] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setMounted(true);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = imageUrl;
    const ext = /^data:image\/png/.test(imageUrl) ? 'png' : /^data:image\/webp/.test(imageUrl) ? 'webp' : 'jpg';
    a.download = `photoreal-render-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="db-lightbox-backdrop-portal"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="4K Photorealistic Render Inspector"
    >
      {/* Top Floating Control Bar */}
      <div className="db-lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <div className="db-lightbox-title-wrap">
          <div className="db-lightbox-banana-icon">
            <span className="text-base">🍌</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-sm">{title || 'Nano Banana 4K Photoreal'}</span>
              <span className="db-lightbox-badge">4K ULTRA HD</span>
            </div>
            <span className="text-xs text-slate-400">Click anywhere outside or press Esc to close</span>
          </div>
        </div>

        <div className="db-lightbox-controls">
          <div className="db-lightbox-zoom-group">
            <button
              type="button"
              className="db-lightbox-ctrl-btn"
              onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs text-slate-200 font-mono w-12 text-center select-none font-bold">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              className="db-lightbox-ctrl-btn"
              onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))}
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="db-lightbox-ctrl-btn"
              onClick={() => setZoom(1)}
              title="Reset to 100%"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="db-lightbox-sep" />

          <button
            type="button"
            className="db-lightbox-download-btn"
            onClick={handleDownload}
            title="Download Full Resolution 4K Image"
          >
            <Download className="w-4 h-4 mr-1.5 inline" />
            Download 4K
          </button>

          {/* Prominent X Close Button */}
          <button
            type="button"
            className="db-lightbox-close-btn"
            onClick={onClose}
            title="Close Lightbox (Esc / Click Outside)"
            aria-label="Close Lightbox"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* Main Image Viewport Area (Clicking outside the image closes modal) */}
      <div className="db-lightbox-body" onClick={onClose}>
        <div
          className="db-lightbox-img-scaler"
          style={{ transform: `scale(${zoom})` }}
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={imageUrl}
            alt="Fullscreen Photorealistic Render"
            className="db-lightbox-hero-img"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

export default RenderLightboxModal;
