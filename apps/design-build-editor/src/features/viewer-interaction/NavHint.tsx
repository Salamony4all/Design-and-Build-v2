// features/viewer-interaction/NavHint.tsx
// One-time tips on moving around the 3D model (and, separately, on walk mode),
// worded for touch or mouse. Shown the first time; hidden after a few seconds,
// on the first drag in the 3D view, or with "Got it". Remembered in this browser.

'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Hand, X } from 'lucide-react';

const KEYS = { orbit: 'db.hint.nav.v1', walk: 'db.hint.walk.v1' } as const;

const TIPS = {
  orbit: {
    touch: ['Drag to turn', 'Pinch to zoom', 'Two fingers to move', 'Double-tap to focus'],
    mouse: ['Drag to turn', 'Scroll to zoom', 'Right-drag to move', 'Double-click to focus'],
  },
  walk: {
    touch: ['Drag to look around', 'Two fingers to move', 'Pinch for a wider lens', 'Double-tap to walk there'],
    mouse: ['Drag to look around', 'Right-drag or scroll to move', 'W A S D to walk', 'Double-click to walk there'],
  },
} as const;

function seen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function NavHint({ visible, variant = 'orbit' }: { visible: boolean; variant?: 'orbit' | 'walk' }) {
  const KEY = KEYS[variant];
  const [show, setShow] = useState(false);
  const [touch, setTouch] = useState(false);

  const hide = useCallback(() => {
    setShow(false);
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      /* private mode: the tip may show again next time */
    }
  }, [KEY]);

  useEffect(() => {
    if (!visible || seen(KEY)) return;
    setTouch(window.matchMedia('(pointer: coarse)').matches);
    const open = window.setTimeout(() => setShow(true), 900);
    const close = window.setTimeout(hide, 12000);
    // The orbit tip goes on the first drag; the walk tip stays while you try it.
    const onDown = (e: PointerEvent) => {
      if (variant === 'orbit' && (e.target as HTMLElement | null)?.tagName === 'CANVAS') hide();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.clearTimeout(open);
      window.clearTimeout(close);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [visible, hide, KEY, variant]);

  if (!show || !visible) return null;
  const tips = touch ? TIPS[variant].touch : TIPS[variant].mouse;
  return (
    <div className="db-nav-hint" role="status">
      <Hand size={15} aria-hidden />
      <span>
        {tips.map((t, i) => (
          <React.Fragment key={t}>
            {i > 0 && <span className="db-nav-hint__dot" aria-hidden> · </span>}
            {t}
          </React.Fragment>
        ))}
      </span>
      <button type="button" onClick={hide} aria-label="Got it">
        <X size={14} />
      </button>
    </div>
  );
}
