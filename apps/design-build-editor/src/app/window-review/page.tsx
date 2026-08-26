'use client';

import { useEffect, useState } from 'react';

interface AnonymousHypothesis {
  auditId: number;
  anonymousReviewId: string;
  hypothesisId: string;
  physicalWallId: string;
  finiteInterval: { start: number; end: number };
  widthMm: number;
  closeupPath: string;
  fullPageLocation: { x: number; y: number };
  sourceSegmentIds: string[];
}

interface HumanDecision {
  anonymousReviewId: string;
  hypothesisId: string;
  humanVerdict: string;
  humanNotes: string;
  reviewedAt: string | null;
  sourceManifestHash: string;
}

export default function WindowReviewPage() {
  const [manifest, setManifest] = useState<AnonymousHypothesis[]>([]);
  const [shuffleHash, setShuffleHash] = useState('');
  const [decisions, setDecisions] = useState<Record<string, HumanDecision>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mode, setMode] = useState<'A' | 'B'>('A');
  const [notes, setNotes] = useState('');
  const [verdict, setVerdict] = useState('');
  
  // Overlay Toggles (Mode B)
  const [showSegments, setShowSegments] = useState(true);
  const [showWalls, setShowWalls] = useState(true);
  const [showIntervals, setShowIntervals] = useState(true);

  useEffect(() => {
    fetch('/api/window-review')
      .then(res => res.json())
      .then(data => {
        if (data.manifest) {
          setManifest(data.manifest.manifest || []);
          setShuffleHash(data.manifest.shuffleHash || '');
        }
        if (data.decisions) {
          const decMap: Record<string, HumanDecision> = {};
          data.decisions.forEach((d: HumanDecision) => {
            decMap[d.anonymousReviewId] = d;
          });
          setDecisions(decMap);
        }
      });
  }, []);

  useEffect(() => {
    if (manifest.length > 0) {
      const active = manifest[currentIndex];
      const saved = decisions[active.anonymousReviewId];
      if (saved) {
        setVerdict(saved.humanVerdict);
        setNotes(saved.humanNotes);
      } else {
        setVerdict('');
        setNotes('');
      }
    }
  }, [currentIndex, manifest, decisions]);

  if (manifest.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white font-mono">
        <p className="animate-pulse">Loading Human Review Package...</p>
      </div>
    );
  }

  const active = manifest[currentIndex];
  
  // Find neighboring context
  const neighbors = manifest.filter(m => m.physicalWallId === active.physicalWallId && m.anonymousReviewId !== active.anonymousReviewId);

  const saveCurrent = (selectedVerdict: string) => {
    const updated = {
      ...decisions,
      [active.anonymousReviewId]: {
        anonymousReviewId: active.anonymousReviewId,
        hypothesisId: active.hypothesisId,
        humanVerdict: selectedVerdict,
        humanNotes: notes,
        reviewedAt: new Date().toISOString(),
        sourceManifestHash: shuffleHash,
      }
    };
    setDecisions(updated);
    setVerdict(selectedVerdict);

    // Save to server
    fetch('/api/window-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisions: Object.values(updated) }),
    });
  };

  const nextItem = () => {
    if (currentIndex < manifest.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setMode('A'); // force blind review initially
    }
  };

  const prevItem = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setMode('A');
    }
  };

  const allowedVerdicts = [
    'CONFIRMED_PHYSICAL_WINDOW',
    'LIKELY_PHYSICAL_WINDOW',
    'NOT_A_WINDOW',
    'PANEL_OR_FRAME_FRAGMENT',
    'DUPLICATE_HYPOTHESIS',
    'OTHER_OPENING',
    'UNRESOLVED'
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6">
      <header className="max-w-6xl mx-auto flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white font-mono">Stage B.5 - Human Window Review</h1>
          <p className="text-xs text-slate-400 font-mono mt-1">Shuffle Hash: {shuffleHash.slice(0, 16)}...</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => setMode('A')}
            className={`px-4 py-1.5 rounded-lg text-xs font-mono transition-all ${mode === 'A' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
          >
            Mode A: Blind Review
          </button>
          <button
            onClick={() => setMode('B')}
            className={`px-4 py-1.5 rounded-lg text-xs font-mono transition-all ${mode === 'B' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
          >
            Mode B: Evidence Inspection
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left/Middle Column: Review Canvas */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col gap-6 shadow-xl">
          <div className="flex justify-between items-center">
            <span className="font-mono text-xs bg-slate-800 text-indigo-400 px-3 py-1 rounded-full border border-slate-700">
              Audit ID: #{active.auditId} / Anonymous ID: {active.anonymousReviewId}
            </span>
            <div className="flex gap-2">
              <button
                onClick={prevItem}
                disabled={currentIndex === 0}
                className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-xs font-mono disabled:opacity-50 hover:bg-slate-700 transition"
              >
                &larr; Prev
              </button>
              <button
                onClick={nextItem}
                disabled={currentIndex === manifest.length - 1}
                className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-xs font-mono disabled:opacity-50 hover:bg-slate-700 transition"
              >
                Next &rarr;
              </button>
            </div>
          </div>

          {/* Interactive Canvas Viewport */}
          <div className="relative aspect-video bg-slate-950 border border-slate-800 rounded-lg overflow-hidden flex items-center justify-center shadow-inner">
            {mode === 'A' ? (
              <div className="text-center p-6">
                <div className="w-16 h-16 bg-slate-900 border border-slate-800 rounded-lg mx-auto flex items-center justify-center text-slate-600 mb-4">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                </div>
                <h3 className="font-mono text-sm text-slate-300">Mode A - Blind PDF Image Crop</h3>
                <p className="text-xs text-slate-500 max-w-md mt-2">Displaying raw vector strokes with target labels, model confidence, and predictions strictly masked.</p>
              </div>
            ) : (
              <div className="w-full h-full p-6 flex flex-col justify-between">
                <div>
                  <h3 className="font-mono text-sm text-indigo-400">Mode B - Evidence Inspection</h3>
                  <div className="grid grid-cols-2 gap-4 mt-4 text-xs font-mono">
                    <div className="bg-slate-900 p-3 rounded border border-slate-800">
                      <span className="text-slate-500 block mb-1">Host Wall:</span>
                      <span className="text-slate-200">{showWalls ? active.physicalWallId : 'Hidden'}</span>
                    </div>
                    <div className="bg-slate-900 p-3 rounded border border-slate-800">
                      <span className="text-slate-500 block mb-1">Finite Interval:</span>
                      <span className="text-slate-200">{showIntervals ? `[${active.finiteInterval.start.toFixed(1)}, ${active.finiteInterval.end.toFixed(1)}]` : 'Hidden'}</span>
                    </div>
                    <div className="bg-slate-900 p-3 rounded border border-slate-800 col-span-2">
                      <span className="text-slate-500 block mb-1">Source Segment Count:</span>
                      <span className="text-slate-200">{showSegments ? `${active.sourceSegmentIds.length} segments` : 'Hidden'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 border-t border-slate-800 pt-4 text-xs font-mono">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={showSegments} onChange={e => setShowSegments(e.target.checked)} className="rounded border-slate-800 bg-slate-900 text-indigo-600 focus:ring-0 focus:ring-offset-0"/>
                    Segments
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={showWalls} onChange={e => setShowWalls(e.target.checked)} className="rounded border-slate-800 bg-slate-900 text-indigo-600 focus:ring-0 focus:ring-offset-0"/>
                    Host Wall
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={showIntervals} onChange={e => setShowIntervals(e.target.checked)} className="rounded border-slate-800 bg-slate-900 text-indigo-600 focus:ring-0 focus:ring-offset-0"/>
                    Interval
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Context view */}
          {neighbors.length > 0 && (
            <div className="border-t border-slate-800 pt-4">
              <h4 className="text-xs font-mono text-slate-400 mb-2">Neighboring Context (Other hypotheses on same wall):</h4>
              <div className="flex gap-2">
                {neighbors.map(n => (
                  <span key={n.anonymousReviewId} className="text-xs font-mono bg-slate-950 border border-slate-800 text-slate-500 px-3 py-1 rounded">
                    Anon ID: {n.anonymousReviewId} (Width: {n.widthMm}mm)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Controls & Decisions */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col gap-6 shadow-xl">
          <div>
            <h3 className="font-mono text-sm text-slate-300 font-bold mb-3">Audit Locator</h3>
            <div className="h-32 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-center text-xs font-mono text-slate-500 relative">
              <div className="absolute w-2 h-2 bg-indigo-500 rounded-full animate-ping" style={{ left: `${(active.fullPageLocation.x / 10) % 80 + 10}%`, top: '50%' }}></div>
              Locator: [{active.fullPageLocation.x}, {active.fullPageLocation.y}]
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="font-mono text-sm text-slate-300 font-bold mb-1">Human Verdict</h3>
            {allowedVerdicts.map(v => (
              <button
                key={v}
                onClick={() => saveCurrent(v)}
                className={`w-full py-2.5 px-4 rounded-lg text-left text-xs font-mono border transition-all ${verdict === v ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'}`}
              >
                {v.replace(/_/g, ' ')}
              </button>
            ))}
          </div>

          <div>
            <h3 className="font-mono text-sm text-slate-300 font-bold mb-2">Reviewer Notes</h3>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Record physical evidence, observations, or segment details..."
              className="w-full h-24 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-indigo-600 transition"
            />
          </div>

          <div className="flex justify-between items-center border-t border-slate-800 pt-4 mt-auto">
            <span className="text-xs font-mono text-slate-500">
              Reviewed: {Object.keys(decisions).length} / {manifest.length}
            </span>
            <button
              onClick={() => saveCurrent(verdict || 'UNRESOLVED')}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono rounded-lg transition shadow-lg"
            >
              Save Progress
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
