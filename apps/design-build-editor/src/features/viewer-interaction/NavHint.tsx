// features/viewer-interaction/NavHint.tsx
// One-time tip on how to move around the 3D model, worded for touch or mouse.
// Shown the first time a model is ready; hidden after a few seconds, on the
// first drag in the 3D view, or with "Got it". Remembered in this browser.

'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Hand, X } from 'lucide-react';

const KEY = 'db.hint.nav.v1';

function seen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function NavHint({ visible }: { visible: boolean }) {
  const [show, setShow] = useState(false);
  const [touch, setTouch] = useState(false);

  const hide = useCallback(() => {
    setShow(false);
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      /* private mode: the tip may show again next time */
    }
  }, []);

  useEffect(() => {
    if (!visible || seen()) return;
    setTouch(window.matchMedia('(pointer: coarse)').matches);
    const open = window.setTimeout(() => setShow(true), 900);
    const close = window.setTimeout(hide, 12000);
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'CANVAS') hide();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.clearTimeout(open);
      window.clearTimeout(close);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [visible, hide]);

  if (!show || !visible) return null;
  const tips = touch
    ? ['Drag to turn', 'Pinch to zoom', 'Two fingers to move', 'Double-tap to focus']
    : ['Drag to turn', 'Scroll to zoom', 'Right-drag to move', 'Double-click to focus'];
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
