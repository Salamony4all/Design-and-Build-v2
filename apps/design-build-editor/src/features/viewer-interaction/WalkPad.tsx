// features/viewer-interaction/WalkPad.tsx
// On-screen stick for walk mode on touch screens: push it to walk (the further,
// the faster), let go to stop. Looking around stays a drag on the 3D view, and a
// tap on the floor still walks there.

'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';

/** How far the knob travels from the centre (px). */
const REACH = 40;

export function WalkPad({ onStick }: { onStick: (fwd: number, side: number) => void }) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<number | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);

  const follow = useCallback(
    (clientX: number, clientY: number) => {
      const el = baseRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let dx = clientX - (r.left + r.width / 2);
      let dy = clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > REACH) {
        dx = (dx / d) * REACH;
        dy = (dy / d) * REACH;
      }
      setKnob({ x: dx, y: dy });
      onStick(-dy / REACH, dx / REACH);
    },
    [onStick],
  );

  const release = useCallback(() => {
    pointerRef.current = null;
    setKnob(null);
    onStick(0, 0);
  }, [onStick]);

  // Leaving walk mode with a finger on the stick must not keep walking.
  useEffect(() => () => onStick(0, 0), [onStick]);

  return (
    <div
      ref={baseRef}
      className={`db-walkpad ${knob ? 'is-active' : ''}`}
      role="group"
      aria-label="Walk: push the stick to move, let go to stop"
      onPointerDown={(e) => {
        if (pointerRef.current !== null) return;
        pointerRef.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* capture is a nicety */
        }
        e.preventDefault();
        e.stopPropagation();
        follow(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== pointerRef.current) return;
        e.preventDefault();
        follow(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (e.pointerId === pointerRef.current) release();
      }}
      onPointerCancel={(e) => {
        if (e.pointerId === pointerRef.current) release();
      }}
      onLostPointerCapture={(e) => {
        if (e.pointerId === pointerRef.current) release();
      }}
    >
      <span className="db-walkpad__ring" aria-hidden />
      <span
        className="db-walkpad__knob"
        aria-hidden
        style={knob ? { transform: `translate(${knob.x}px, ${knob.y}px)`, transition: 'none' } : undefined}
      />
    </div>
  );
}

export default WalkPad;
