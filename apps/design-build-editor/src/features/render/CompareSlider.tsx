// features/render/CompareSlider.tsx
// Before/after slider for a render and the 3D view it came from. Both images
// share one frame (same crop), so dragging the handle shows exactly where the
// render kept or moved each wall and opening. Optional cyan model-edge overlay.
'use client';
import React, { useCallback, useRef, useState } from 'react';
import styles from './RenderStudio.module.css';

export interface CompareSliderProps {
  before: string;
  after: string;
  /** Transparent PNG of the model's edges, laid over the render when shown. */
  overlay?: string;
  showOverlay?: boolean;
  beforeLabel?: string;
  afterLabel?: string;
  /** CSS aspect-ratio of the frame, e.g. "1 / 1". */
  aspect?: string;
  className?: string;
  frameStyle?: React.CSSProperties;
}

export function CompareSlider({
  before,
  after,
  overlay,
  showOverlay,
  beforeLabel = '3D model',
  afterLabel = 'Photoreal',
  aspect,
  className,
  frameStyle,
}: CompareSliderProps) {
  const [pos, setPos] = useState(50);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromClientX = useCallback((clientX: number) => {
    const r = frame.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  }, []);

  return (
    <div
      ref={frame}
      className={`${styles.compare} ${className ?? ''}`}
      style={{ ...(aspect ? { aspectRatio: aspect } : {}), ...frameStyle }}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) setFromClientX(e.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <img className={styles.compareImg} src={after} alt={afterLabel} draggable={false} />
      {overlay && showOverlay ? <img className={styles.compareImg} src={overlay} alt="" aria-hidden draggable={false} /> : null}
      <img
        className={styles.compareImg}
        src={before}
        alt={beforeLabel}
        draggable={false}
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />
      <span className={`${styles.compareTag} ${styles.compareTagLeft}`}>{beforeLabel}</span>
      <span className={`${styles.compareTag} ${styles.compareTagRight}`}>{afterLabel}</span>
      <div
        className={styles.compareHandle}
        style={{ left: `${pos}%` }}
        role="slider"
        tabIndex={0}
        aria-label="Compare 3D model and photoreal render"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 4));
          if (e.key === 'ArrowRight') setPos((p) => Math.min(100, p + 4));
        }}
      >
        <span className={styles.compareKnob}>⟷</span>
      </div>
    </div>
  );
}

export default CompareSlider;
