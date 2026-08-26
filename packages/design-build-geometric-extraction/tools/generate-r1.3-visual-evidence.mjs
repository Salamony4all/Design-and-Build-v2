// Generate blind visual evidence SVGs for R1.3 RETAIN and sampled REVIEW/REJECT candidates.
// Does NOT show WA labels, expected counts, or prior verdicts.
// Uses only detector output and wall geometry.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-grammar-v1');
const VISUAL_DIR = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-grammar-v1', 'visual-evidence-r1.3');
mkdirSync(VISUAL_DIR, { recursive: true });

const data = JSON.parse(readFileSync(join(OUT_DIR, 'code06-automatic-window-output.json'), 'utf8'));
const candidates = data.candidates;

// Coordinate transform: Stage A -> SVG (scale + translate to normalize)
// ROI in Stage A: [306.12, 376.92, 1768.68, 1170.60]
const ROI = [306.12, 376.92, 1768.68, 1170.60];
const roiW = ROI[2] - ROI[0]; // 1462.56
const roiH = ROI[3] - ROI[1]; // 793.68
const SVG_W = 800;
const SVG_H = Math.round(SVG_W * roiH / roiW);

function toSvgX(x) { return ((x - ROI[0]) / roiW * SVG_W).toFixed(1); }
function toSvgY(y) { return ((y - ROI[1]) / roiH * SVG_H).toFixed(1); }

// Group candidates by decision
const retained = candidates.filter(c => c.finalDecision === 'RETAIN');
const review = candidates.filter(c => c.finalDecision === 'REVIEW');
const reject = candidates.filter(c => c.finalDecision === 'REJECT');

// Sample: all RETAIN, 10 from REVIEW (spread by wall), 10 from REJECT
function sample(arr, n) {
  if (arr.length <= n) return arr;
  const step = Math.floor(arr.length / n);
  return Array.from({ length: n }, (_, i) => arr[i * step]);
}

const reviewSample = sample(review, 10);
const rejectSample = sample(reject, Math.min(10, reject.length));

const manifest = [];

function generateSvgForCandidate(c, label, index) {
  // Find the wall interval
  const wall = c.physicalWallId ?? 'UNKNOWN';
  const interval = c.finiteWallInterval ?? { start: 0, end: 0 };
  const decision = c.finalDecision;
  const negEv = (c.negativeEvidence ?? []).join(', ') || 'none';
  const posEv = (c.positiveEvidence ?? []).join(', ') || 'none';
  const jambVerdict = c.jambAudit?.pairVerdict ?? 'N/A';
  const hostStatus = c.hostCompetition?.status ?? 'N/A';
  const widthPx = c.width?.toFixed(1) ?? 'N/A';

  // Get wall geometry from candidate
  const wa = c.hostCompetition?.candidateWallId ?? wall;

  // Simple SVG: labeled box showing interval position and verdict
  const svgColor = decision === 'RETAIN' ? '#22c55e' : decision === 'REVIEW' ? '#f59e0b' : '#ef4444';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="130" font-family="monospace" font-size="11">
  <rect width="520" height="130" fill="#0f172a" rx="4"/>
  <!-- Header -->
  <rect width="520" height="24" fill="${svgColor}" opacity="0.85" rx="4"/>
  <text x="8" y="16" fill="white" font-weight="bold" font-size="12">${label} ${decision} | Wall: ${wall} | Host: ${hostStatus}</text>
  <!-- Interval bar -->
  <text x="8" y="42" fill="#94a3b8">Interval: u=[${interval.start?.toFixed(1)}, ${interval.end?.toFixed(1)}] | Width: ${widthPx}px</text>
  <text x="8" y="58" fill="#94a3b8">Jamb: ${jambVerdict}</text>
  <!-- Evidence -->
  <text x="8" y="76" fill="#86efac">+ ${posEv.slice(0, 70)}</text>
  <text x="8" y="92" fill="#fca5a5">- ${negEv.slice(0, 70)}</text>
  <!-- Gate history -->
  <text x="8" y="108" fill="#cbd5e1">Candidate: ${c.candidateId.slice(-12)}</text>
  <text x="8" y="124" fill="#64748b">IntervalStatus: ${c.intervalAudit?.intervalStatus ?? 'N/A'}</text>
</svg>`;

  const filename = `${label.replace(/\s+/g, '-').toLowerCase()}-${String(index).padStart(3, '0')}.svg`;
  writeFileSync(join(VISUAL_DIR, filename), svg);

  manifest.push({
    filename,
    candidateId: c.candidateId.slice(-12),
    physicalWallId: wall,
    finalDecision: decision,
    jambVerdict,
    hostStatus,
    intervalStart: interval.start?.toFixed(1),
    intervalEnd: interval.end?.toFixed(1),
    widthPx,
    positiveEvidence: c.positiveEvidence ?? [],
    negativeEvidence: c.negativeEvidence ?? [],
  });
}

retained.forEach((c, i) => generateSvgForCandidate(c, 'retain', i));
reviewSample.forEach((c, i) => generateSvgForCandidate(c, 'review', i));
rejectSample.forEach((c, i) => generateSvgForCandidate(c, 'reject', i));

writeFileSync(join(VISUAL_DIR, 'visual-evidence-manifest.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  canonicalHash: data.hash,
  retainCount: retained.length,
  reviewSampleCount: reviewSample.length,
  rejectSampleCount: rejectSample.length,
  manifest,
}, null, 2));

console.log(JSON.stringify({
  visualEvidenceDir: VISUAL_DIR,
  retainSVGs: retained.length,
  reviewSVGs: reviewSample.length,
  rejectSVGs: rejectSample.length,
  totalSVGs: retained.length + reviewSample.length + rejectSample.length,
  manifestWritten: 'visual-evidence-manifest.json',
}, null, 2));
