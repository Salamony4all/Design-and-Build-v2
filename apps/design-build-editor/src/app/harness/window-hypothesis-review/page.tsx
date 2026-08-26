'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const PascalViewerShell = dynamic(
  () => import('design-build-simplified-viewer-shell').then((m) => m.PascalViewerShell),
  { ssr: false },
);

type Pilot = {
  anonymousRegionId: string;
  openingRegionId: string;
  physicalWallId: string;
  runtimePascalWallNodeId: string;
  intervalStartM: number;
  intervalEndM: number;
  widthM: number;
  worldStart: { x: number; z: number };
  worldEnd: { x: number; z: number };
  worldCentre: { x: number; z: number };
  planRotationRadians: number;
  mappingStatus: string;
};

async function loadPilots(): Promise<Pilot[]> {
  const res = await fetch('/api/harness/window-hypothesis-review');
  if (!res.ok) throw new Error(`review API failed: ${res.status}`);
  const data = await res.json();
  const pilots = (data.pilots ?? []) as Pilot[];
  return pilots.filter(p => p.mappingStatus === 'VALIDATED_MAPPING');
}

export default function ReviewPage() {
  const [queryMode, setQueryMode] = useState(false);
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setQueryMode(params.get('pascalPilot') === 'true');
  }, []);

  useEffect(() => {
    if (!queryMode) return;
    let dead = false;
    (async () => {
      try {
        const items = await loadPilots();
        if (!dead) setPilots(items);
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { dead = true; };
  }, [queryMode]);

  const active = pilots[activeIndex] ?? null;

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <PascalViewerShell />
      {queryMode && (
        <div style={{ position: 'absolute', top: 8, left: 8, background: '#000c', color: '#fff', padding: '8px 10px', borderRadius: 8, fontSize: 12, zIndex: 20 }}>
          Gate C pilot — pilots={pilots.length} active={active?.anonymousRegionId ?? 'none'}
        </div>
      )}
      {error ? (
        <div style={{ position: 'absolute', top: 8, right: 8, background: '#f00c', color: '#fff', padding: '8px 10px', borderRadius: 8, zIndex: 20 }}>API: {error}</div>
      ) : null}
      {overlayError ? (
        <div style={{ position: 'absolute', bottom: 8, left: 8, background: '#f00c', color: '#fff', padding: '8px 10px', borderRadius: 8, zIndex: 20 }}>Overlay: {overlayError}</div>
      ) : null}
    </div>
  );
}
