'use client';

import { useEffect, useState, useMemo } from 'react';

interface AnonymousRegion {
  anonymousRegionId: string;
  openingRegionId: string;
  physicalWallId: string;
  rawIntervalUnion: { start: number; end: number };
  rawIntervalIntersection: { start: number; end: number } | null;
  constituentCandidateIds: string[];
  constituentCandidateCount: number;
  sourceSegmentIds: string[];
  frameFeatureIds: string[];
  jambFeatureIds: string[];
  wallFaceGapFeatureIds: string[];
  frameBayFeatureIds: string[];
  hostStatus: string;
  unresolvedRelationships: string[];
  closeupPath: string;
}

interface HumanDecision {
  anonymousRegionId: string;
  openingRegionId: string;
  humanVerdict: string | null;
  physicalWindowQuantity: number | null;
  humanNotes: string;
  reviewedAt: string | null;
  reviewerType: string | null;
  sourceManifestHash: string;
}

interface ReviewPayload {
  canonicalHash: string;
  anonymousRegionCount: number;
  shuffleSeedHash: string;
  regions: AnonymousRegion[];
}

const ALLOWED_VERDICTS = [
  'CONFIRMED_SINGLE_WINDOW',
  'CONFIRMED_MULTI_PANEL_WINDOW',
  'CONTAINS_MULTIPLE_SEPARATE_WINDOWS',
  'LIKELY_WINDOW',
  'DOOR_OR_OTHER_OPENING',
  'CONTINUOUS_WALL_GEOMETRY',
  'HATCH_OR_ANNOTATION',
  'FRAME_OR_PANEL_FRAGMENT',
  'DUPLICATE_REGION',
  'UNRESOLVED',
] as const;

const VERDICT_COLORS: Record<string, string> = {
  CONFIRMED_SINGLE_WINDOW: 'bg-emerald-700 border-emerald-500 text-white',
  CONFIRMED_MULTI_PANEL_WINDOW: 'bg-emerald-700 border-emerald-500 text-white',
  CONTAINS_MULTIPLE_SEPARATE_WINDOWS: 'bg-teal-700 border-teal-500 text-white',
  LIKELY_WINDOW: 'bg-blue-700 border-blue-500 text-white',
  DOOR_OR_OTHER_OPENING: 'bg-amber-700 border-amber-500 text-white',
  CONTINUOUS_WALL_GEOMETRY: 'bg-slate-600 border-slate-400 text-white',
  HATCH_OR_ANNOTATION: 'bg-slate-600 border-slate-400 text-white',
  FRAME_OR_PANEL_FRAGMENT: 'bg-orange-700 border-orange-500 text-white',
  DUPLICATE_REGION: 'bg-rose-800 border-rose-600 text-white',
  UNRESOLVED: 'bg-yellow-800 border-yellow-600 text-white',
};

function loadDecisions(): Record<string, HumanDecision> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('r132-decisions');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDecisions(decisions: Record<string, HumanDecision>) {
  localStorage.setItem('r132-decisions', JSON.stringify(decisions));
}

function evidenceUrl(name: string) {
  return `/api/r132/evidence?name=${encodeURIComponent(name)}`;
}

const LAYERS = [
  { key: 'source', label: 'Source Crop', suffix: '-source.png', type: 'img' },
  { key: 'locator', label: 'Plan Locator', suffix: '-locator.png', type: 'img' },
  { key: 'source-operations', label: 'Vector Ops', suffix: '-source-operations.svg', type: 'svg' },
  { key: 'host-wall', label: 'Host Wall', suffix: '-host-wall.svg', type: 'svg' },
  { key: 'raw-interval', label: 'Interval', suffix: '-raw-interval.svg', type: 'svg' },
  { key: 'candidates', label: 'Candidates', suffix: '-candidates.svg', type: 'svg' },
  { key: 'opening-region', label: 'Region', suffix: '-opening-region.svg', type: 'svg' },
];

export default function BlindReviewPage() {
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [decisions, setDecisions] = useState<Record<string, HumanDecision>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [activeLayer, setActiveLayer] = useState('source');
  const [verdict, setVerdict] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [quantity, setQuantity] = useState<number | ''>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imgKey, setImgKey] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/window-review')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(data => {
        const manifest = data.manifest as ReviewPayload | undefined;
        if (!manifest) throw new Error('missing manifest');
        setPayload(manifest);
        const saved = loadDecisions();
        setDecisions(saved);
        setOrder(manifest.regions.map(r => r.anonymousRegionId));
        setLoading(false);
      })
      .catch(err => { setError(`Failed to load manifest: ${err.message}`); setLoading(false); });
  }, []);

  const active = useMemo(() => {
    if (!payload || index >= order.length) return null;
    return payload.regions.find(r => r.anonymousRegionId === order[index]) || null;
  }, [payload, order, index]);

  useEffect(() => {
    setImgKey(k => k + 1);
    setImgLoaded(false);
    setImgError(null);
  }, [active]);

  useEffect(() => {
    if (!payload || order.length === 0 || !active) return;
    const saved = decisions[active.anonymousRegionId];
    if (saved) {
      setVerdict(saved.humanVerdict);
      setNotes(saved.humanNotes || '');
      setQuantity(saved.physicalWindowQuantity ?? 1);
    } else {
      setVerdict(null);
      setNotes('');
      setQuantity(1);
    }
  }, [index, order, payload, decisions, active]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-300 font-mono text-sm">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          Loading blind review package...
        </div>
      </div>
    );
  }

  if (error || !payload || !active) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white font-mono p-4">
        <div className="text-center">
          <p className="text-red-400 font-bold mb-2">Review package unavailable</p>
          <p className="text-xs text-slate-500">{error ?? 'No active region'}</p>
        </div>
      </div>
    );
  }

  const commitDecision = (selected: string | null, newNotes?: string, newQty?: number | '') => {
    if (!active) return;
    const d: HumanDecision = {
      anonymousRegionId: active.anonymousRegionId,
      openingRegionId: active.openingRegionId,
      humanVerdict: selected,
      physicalWindowQuantity:
        selected === 'CONTAINS_MULTIPLE_SEPARATE_WINDOWS' ? (typeof (newQty ?? quantity) === 'number' ? (newQty ?? quantity) as number : null)
        : selected === 'CONFIRMED_SINGLE_WINDOW' || selected === 'CONFIRMED_MULTI_PANEL_WINDOW' ? 1
        : null,
      humanNotes: newNotes ?? notes,
      reviewedAt: new Date().toISOString(),
      reviewerType: 'HUMAN',
      sourceManifestHash: payload.shuffleSeedHash,
    };
    const next = { ...decisions, [active.anonymousRegionId]: d };
    setDecisions(next);
    setVerdict(selected);
    saveDecisions(next);
    fetch('/api/window-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisions: Object.values(next) }),
    }).catch(() => {});
  };

  const clearDecision = () => {
    if (!active) return;
    const next = { ...decisions };
    delete next[active.anonymousRegionId];
    setDecisions(next);
    setVerdict(null);
    setNotes('');
    setQuantity(1);
    saveDecisions(next);
    fetch('/api/window-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisions: Object.values(next) }),
    }).catch(() => {});
  };

  const match = active.closeupPath.match(/region-(\d+)/);
  const idxStr = match ? match[1] : '000';
  const layerDef = LAYERS.find(l => l.key === activeLayer) ?? LAYERS[0];
  const layerUrl = evidenceUrl(`region-${idxStr}${layerDef.suffix}`);
  const nextRegion = index + 1 < order.length ? payload.regions.find(r => r.anonymousRegionId === order[index + 1]) : null;
  const nextMatch = nextRegion?.closeupPath.match(/region-(\d+)/);
  const nextIdxStr = nextMatch ? nextMatch[1] : null;

  const reviewedCount = Object.keys(decisions).length;
  const progressPct = Math.round((reviewedCount / payload.anonymousRegionCount) * 100);

  return (
    <div className="min-h-screen overflow-y-auto bg-slate-950 text-slate-100 font-sans">
      {nextIdxStr && (
        <img src={evidenceUrl(`region-${nextIdxStr}-source.png`)} style={{ display: 'none' }} alt="" aria-hidden />
      )}

      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-sm font-bold font-mono text-white whitespace-nowrap">R1.3.2 Blind Review</h1>
            <span className="font-mono text-xs text-indigo-300 bg-indigo-950 px-2 py-0.5 rounded border border-indigo-800">
              {active.anonymousRegionId}
            </span>
            {verdict && (
              <span className={`text-xs font-mono px-2 py-0.5 rounded border ${VERDICT_COLORS[verdict] ?? 'bg-slate-700 border-slate-600 text-white'}`}>
                {verdict.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-slate-400">{reviewedCount}/{payload.anonymousRegionCount}</span>
            <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <button
              onClick={() => setIndex(i => Math.max(0, i - 1))}
              disabled={index === 0}
              className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs font-mono disabled:opacity-40 hover:bg-slate-700 transition-colors"
            >
              ← Prev
            </button>
            <span className="font-mono text-xs text-slate-400">{index + 1}/{order.length}</span>
            <button
              onClick={() => setIndex(i => Math.min(order.length - 1, i + 1))}
              disabled={index === order.length - 1}
              className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs font-mono disabled:opacity-40 hover:bg-slate-700 transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3 flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5 bg-slate-900 border border-slate-800 rounded-xl p-2">
            {LAYERS.map(l => (
              <button
                key={l.key}
                onClick={() => setActiveLayer(l.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                  activeLayer === l.key
                    ? 'bg-indigo-600 border-indigo-500 text-white font-bold shadow'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <span className="font-mono text-xs text-indigo-400">{layerDef.label}</span>
              <span className="font-mono text-xs text-slate-500">region-{idxStr}{layerDef.suffix}</span>
            </div>
            <div className="p-3 bg-slate-950 flex items-center justify-center min-h-[300px] relative">
              {!imgLoaded && !imgError && (
                <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    Loading evidence...
                  </div>
                </div>
              )}
              {imgError && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center font-mono text-xs">
                    <p className="text-red-400 font-bold mb-1">Asset load failed</p>
                    <p className="text-slate-500">{imgError}</p>
                    <p className="text-slate-600 mt-1">{layerUrl}</p>
                  </div>
                </div>
              )}
              <img
                key={`${imgKey}-${activeLayer}`}
                src={layerUrl}
                alt={`${active.anonymousRegionId} ${layerDef.label}`}
                className="max-w-full max-h-[65vh] object-contain rounded select-none"
                style={{ display: imgLoaded ? 'block' : 'none', imageRendering: 'auto' }}
                onLoad={() => setImgLoaded(true)}
                onError={() => {
                  setImgLoaded(false);
                  setImgError(`404: region-${idxStr}${layerDef.suffix}`);
                }}
              />
            </div>
          </div>

          <details className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <summary className="px-4 py-3 text-xs font-mono text-indigo-400 cursor-pointer hover:text-indigo-300 font-semibold select-none">
              Technical diagnostics ▸
            </summary>
            <div className="px-4 pb-4 pt-2">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs font-mono">
                {[
                  ['Region ID', active.anonymousRegionId],
                  ['Host Wall', active.physicalWallId],
                  ['Union', `[${active.rawIntervalUnion.start.toFixed(1)}, ${active.rawIntervalUnion.end.toFixed(1)}]`],
                  ['Intersection', active.rawIntervalIntersection ? `[${active.rawIntervalIntersection.start.toFixed(1)}, ${active.rawIntervalIntersection.end.toFixed(1)}]` : '—'],
                  ['Candidates', String(active.constituentCandidateCount)],
                  ['Segments', String(active.sourceSegmentIds.length)],
                  ['Frames', String(active.frameFeatureIds.length)],
                  ['Jambs', String(active.jambFeatureIds.length)],
                  ['Gaps', String(active.wallFaceGapFeatureIds.length)],
                  ['Bays', String(active.frameBayFeatureIds.length)],
                  ['Host Status', active.hostStatus || '—'],
                  ['Asset Idx', idxStr],
                ].map(([k, v]) => (
                  <div key={k} className="bg-slate-950 rounded p-2 border border-slate-800">
                    <span className="text-slate-500 block mb-0.5 text-[10px]">{k}</span>
                    <span className="text-slate-200">{v}</span>
                  </div>
                ))}
              </div>
              {active.constituentCandidateIds.length > 0 && (
                <div className="mt-2 bg-slate-950 rounded p-2 border border-slate-800">
                  <span className="text-slate-500 block mb-1 text-[10px] font-mono">Constituent Candidate IDs</span>
                  <div className="flex flex-wrap gap-1">
                    {active.constituentCandidateIds.map(id => (
                      <span key={id} className="text-[10px] font-mono bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">{id}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>
        </div>

        <div className="flex flex-col gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
            <h3 className="font-mono text-xs text-slate-400 mb-2 font-semibold">Human Verdict</h3>
            <div className="flex flex-col gap-1.5">
              {ALLOWED_VERDICTS.map(v => {
                const isActive = verdict === v;
                return (
                  <button
                    key={v}
                    onClick={() => commitDecision(v)}
                    className={`w-full py-2 px-3 rounded-lg text-left text-xs font-mono border transition-all ${
                      isActive
                        ? `${VERDICT_COLORS[v] ?? 'bg-indigo-600 border-indigo-500 text-white'} font-bold shadow-md`
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {isActive ? '✓ ' : ''}{v.replace(/_/g, ' ')}
                  </button>
                );
              })}
            </div>
          </div>

          {verdict === 'CONTAINS_MULTIPLE_SEPARATE_WINDOWS' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <h3 className="font-mono text-xs text-slate-400 mb-2 font-semibold">Physical Window Count</h3>
              <input
                type="number"
                min={2}
                value={quantity}
                onChange={e => {
                  const v = e.target.value === '' ? '' : Number(e.target.value);
                  setQuantity(v);
                  commitDecision(verdict, notes, v);
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm font-mono text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
            <h3 className="font-mono text-xs text-slate-400 mb-2 font-semibold">Reviewer Notes</h3>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => commitDecision(verdict, notes)}
              className="w-full h-28 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs font-mono text-white placeholder-slate-700 focus:border-indigo-500 focus:outline-none resize-none"
              placeholder="Optional notes..."
            />
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => commitDecision(verdict, notes)}
              className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-mono font-bold rounded-xl transition-colors shadow"
            >
              Save Progress
            </button>
            <button
              onClick={clearDecision}
              disabled={!verdict}
              className="w-full py-2.5 bg-slate-800 hover:bg-rose-900 text-slate-300 hover:text-rose-300 text-xs font-mono rounded-xl border border-slate-700 hover:border-rose-700 transition-colors disabled:opacity-30"
            >
              Clear Decision
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
            <h3 className="font-mono text-xs text-slate-400 mb-2 font-semibold">Session Progress</h3>
            <div className="flex flex-col gap-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">Reviewed</span>
                <span className="text-emerald-400">{reviewedCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Remaining</span>
                <span className="text-slate-300">{payload.anonymousRegionCount - reviewedCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total</span>
                <span className="text-slate-300">{payload.anonymousRegionCount}</span>
              </div>
              <div className="mt-2 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-slate-500 text-right">{progressPct}%</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
