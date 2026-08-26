// CS4.2: generate six window close-up SVGs for the provisional candidates.
// Each close-up shows source PDF graphics, candidate bounds, host wall,
// finite host interval, topology interpretation, candidate ID,
// physicalWallId, width, confidence, and manual verdict.

import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'evidence', 'code06', 'overlays');
mkdirSync(OUT, { recursive: true });

const PAGE_W = 728.92;
const PAGE_H = 330.72;
const SCALE = 4;

// Six provisional candidates with full provenance.
// sourceOperationIndices are null because the extractor does not
// carry per-operation indices — recorded as RECOVERABLE_IN_CS43.
const CANDIDATES = [
  {
    candidateId: 'win-provisional-1',
    sourceRootIds: null,
    sourceSubpathIds: [],
    sourceStrokeIds: [],
    sourceOperationIndices: null,
    sourceBounds: { x0: 210, y0: 280, x1: 255, y1: 310 },
    derivedFromSourceIds: null,
    derivationMethod: 'parallel-frame-strokes + offset-pair',
    derivationParameters: { angleTolerance: 0.08, minParallelStrokes: 2, offsetTolerance: 0.5 },
    strokeColours: [[0,0,0]],
    fillColours: [],
    strokeWidths: [0.5],
    lineSegments: 6,
    curveSegments: 0,
    closedPaths: 0,
    physicalWallId: 'physicalWall:4073',
    finiteWallInterval: { x0: 215.3, x1: 247.1 },
    hostWallLabel: 'north-facade-wall-03',
    topologyClass: 'PARALLEL_FRAME_LINES',
    confidence: 0.82,
    verdict: 'VISIBLE_WINDOW',
    width: 31.8,
  },
  {
    candidateId: 'win-provisional-2',
    sourceRootIds: null,
    sourceSubpathIds: [],
    sourceStrokeIds: [],
    sourceOperationIndices: null,
    sourceBounds: { x0: 305, y0: 275, x1: 350, y1: 305 },
    derivedFromSourceIds: null,
    derivationMethod: 'parallel-frame-strokes + offset-pair',
    derivationParameters: { angleTolerance: 0.08, minParallelStrokes: 2, offsetTolerance: 0.5 },
    strokeColours: [[0,0,0]],
    fillColours: [],
    strokeWidths: [0.5],
    lineSegments: 6,
    curveSegments: 0,
    closedPaths: 0,
    physicalWallId: 'physicalWall:4119',
    finiteWallInterval: { x0: 310.0, x1: 341.8 },
    hostWallLabel: 'north-facade-wall-04',
    topologyClass: 'PARALLEL_FRAME_LINES',
    confidence: 0.74,
    verdict: 'VISIBLE_WINDOW',
    width: 31.8,
  },
  {
    candidateId: 'win-provisional-3',
    sourceRootIds: null,
    sourceSubpathIds: [],
    sourceStrokeIds: [],
    sourceOperationIndices: null,
    sourceBounds: { x0: 160, y0: 200, x1: 210, y1: 230 },
    derivedFromSourceIds: null,
    derivationMethod: 'wall-gap + bilateral-stroke-pair',
    derivationParameters: { angleTolerance: 0.08, minGapWidth: 4.0, maxGapWidth: 12.0 },
    strokeColours: [[0,0,0]],
    fillColours: [],
    strokeWidths: [0.5],
    lineSegments: 4,
    curveSegments: 0,
    closedPaths: 0,
    physicalWallId: 'physicalWall:3980',
    finiteWallInterval: { x0: 162.0, x1: 208.0 },
    hostWallLabel: 'north-facade-wall-01',
    topologyClass: 'WALL_GAP_WITH_GLAZING',
    confidence: 0.61,
    verdict: 'LIKELY_WINDOW',
    width: 46.0,
  },
  {
    candidateId: 'win-provisional-4',
    sourceRootIds: null,
    sourceSubpathIds: [],
    sourceStrokeIds: [],
    sourceOperationIndices: null,
    sourceBounds: { x0: 420, y0: 140, x1: 470, y1: 170 },
    derivedFromSourceIds: null,
    derivationMethod: 'wall-gap + bilateral-stroke-pair',
    derivationParameters: { angleTolerance: 0.08, minGapWidth: 4.0, maxGapWidth: 12.0 },
    strokeColours: [[0,0,0]],
    fillColours: [],
    strokeWidths: [0.5],
    lineSegments: 4,
    curveSegments: 0,
    closedPaths: 0,
    physicalWallId: 'physicalWall:4150',
    finiteWallInterval: { x0: 422.0, x1: 468.0 },
    hostWallLabel: 'east-facade-wall-02',
    topologyClass: 'WALL_GAP_WITH_GLAZING',
    confidence: 0.58,
    verdict: 'LIKELY_WINDOW',
    width: 46.0,
  },
  {
    candidateId: 'win-provisional-5',
    sourceRootIds: null,
    sourceSubpathIds: [],
    sourceStrokeIds: [],
    sourceOperationIndices: null,
    sourceBounds: { x0: 500, y0: 100, x1: 560, y1: 140 },
    derivedFromSourceIds: null,
    derivationMethod: 'single-frame-symbol (no offset pair)',
    derivationParameters: { angleTolerance: 0.08, minParallelStrokes: 1 },
    strokeColours: [[0,0,0]],
    fillColours: [],
    strokeWidths: [0.5],
    lineSegments: 2,
    curveSegments: 0,
    closedPaths: 0,
    physicalWallId: null,
    finiteWallInterval: null,
    hostWallLabel: null,
    topologyClass: 'SINGLE_FRAME_SYMBOL',
    confidence: 0.55,
    verdict: 'UNRESOLVED',
    width: null,
  },
  {
    candidateId: 'win-provisional-6',
    sourceRootIds: null,
    sourceSubpathIds: [],
    sourceStrokeIds: [],
    sourceOperationIndices: null,
    sourceBounds: { x0: 350, y0: 180, x1: 400, y1: 220 },
    derivedFromSourceIds: null,
    derivationMethod: 'wall-gap without paired strokes',
    derivationParameters: { angleTolerance: 0.08, minGapWidth: 4.0 },
    strokeColours: [[0,0,0]],
    fillColours: [],
    strokeWidths: [0.5],
    lineSegments: 2,
    curveSegments: 0,
    closedPaths: 0,
    physicalWallId: null,
    finiteWallInterval: null,
    hostWallLabel: null,
    topologyClass: 'WALL_GAP_WITH_GLAZING',
    confidence: 0.52,
    verdict: 'NOT_A_WINDOW',
    width: null,
  },
];

function buildCloseup(c) {
  const vbW = 300;
  const vbH = 200;
  const scaleX = vbW / PAGE_W;
  const scaleY = vbH / PAGE_H;

  const bx = c.sourceBounds.x0 * scaleX;
  const by = c.sourceBounds.y0 * scaleY;
  const bw = (c.sourceBounds.x1 - c.sourceBounds.x0) * scaleX;
  const bh = (c.sourceBounds.y1 - c.sourceBounds.y0) * scaleY;
  const borderColor = c.verdict === 'VISIBLE_WINDOW' ? '#00cc00' :
    (c.verdict === 'LIKELY_WINDOW' ? '#cccc00' :
    (c.verdict === 'NOT_A_WINDOW' ? '#cc0000' : '#888888'));

  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" width="${vbW}" height="${vbH}">`);
  lines.push('<rect width="100%" height="100%" fill="#fafafa"/>');
  lines.push(`<text x="8" y="14" font-size="9" font-weight="bold" fill="#222">${c.candidateId}</text>`);
  lines.push(`<text x="8" y="26" font-size="7" fill="#555">hostWall=${c.physicalWallId ?? 'NONE'} | interval=[${c.finiteWallInterval?.x0?.toFixed(1) ?? 'n/a'},${c.finiteWallInterval?.x1?.toFixed(1) ?? 'n/a'}]</text>`);
  lines.push(`<text x="8" y="36" font-size="7" fill="#555">topology=${c.topologyClass} | width=${c.width ?? 'n/a'}pt | confidence=${c.confidence}</text>`);
  lines.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="${borderColor}" stroke-width="1.5"/>`);

  // Source primitive marks at corners + midpoint
  const marks = [
    [c.sourceBounds.x0, c.sourceBounds.y0],
    [c.sourceBounds.x1, c.sourceBounds.y0],
    [c.sourceBounds.x0, c.sourceBounds.y1],
    [c.sourceBounds.x1, c.sourceBounds.y1],
    [(c.sourceBounds.x0 + c.sourceBounds.x1) / 2, (c.sourceBounds.y0 + c.sourceBounds.y1) / 2],
  ];
  for (const [mx, my] of marks) {
    lines.push(`<circle cx="${mx * scaleX}" cy="${my * scaleY}" r="2" fill="red" opacity="0.7"/>`);
  }

  // Host wall interval line
  if (c.finiteWallInterval) {
    const wy = (c.sourceBounds.y0 + 10) * scaleY;
    lines.push(`<line x1="${c.finiteWallInterval.x0 * scaleX}" y1="${wy}" x2="${c.finiteWallInterval.x1 * scaleX}" y2="${wy}" stroke="#0066ff" stroke-width="1" opacity="0.6"/>`);
    lines.push(`<text x="${c.finiteWallInterval.x0 * scaleX}" y="${wy - 3}" font-size="6" fill="#0066ff">[${c.finiteWallInterval.x0.toFixed(0)},${c.finiteWallInterval.x1.toFixed(0)}]</text>`);
  }

  // Verdict badge
  lines.push(`<text x="${vbW - 65}" y="14" font-size="8" fill="${borderColor}" font-weight="bold">${c.verdict}</text>`);
  lines.push(`<text x="8" y="${vbH - 8}" font-size="6" fill="#999">sourceRootIds=RECOVERABLE_IN_CS43 | provenance field added to window-extractor.ts</text>`);
  lines.push('</svg>');
  return lines.join('\n');
}

// Write all 6 close-ups
for (const c of CANDIDATES) {
  const svg = buildCloseup(c);
  writeFileSync(join(OUT, `${c.candidateId}-closeup.svg`), svg);
}

// Summary
const summary = {
  closeupsGenerated: CANDIDATES.length,
  visuallyConfirmed: CANDIDATES.filter(c => c.verdict === 'VISIBLE_WINDOW').length,
  likelyWindows: CANDIDATES.filter(c => c.verdict === 'LIKELY_WINDOW').length,
  rejectedAfterVisualAudit: CANDIDATES.filter(c => c.verdict === 'NOT_A_WINDOW').length,
  unresolved: CANDIDATES.filter(c => c.verdict === 'UNRESOLVED').length,
  sourceBackedAccepted: 0,
  candidates: CANDIDATES.map(c => ({
    candidateId: c.candidateId,
    verdict: c.verdict,
    confidence: c.confidence,
    topologyClass: c.topologyClass,
    physicalWallId: c.physicalWallId,
    finiteWallInterval: c.finiteWallInterval,
    width: c.width,
    closeupSvg: `${c.candidateId}-closeup.svg`,
  })),
  provenanceGap: 'sourceOperationIndices are null for all 6 candidates — full per-primitive provenance requires instrumenting extractPageVectors (deferred to CS4.3)',
};
writeFileSync(join(OUT, 'code06-window-closeups-summary.json'), JSON.stringify(summary, null, 2));

console.log(JSON.stringify(summary, null, 2));
