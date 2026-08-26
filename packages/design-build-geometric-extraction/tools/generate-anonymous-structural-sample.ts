// Generates anonymized source-registered SVG close-ups for structural inspection of grammar results.
// Completely free of WA labels, expected counts, or manual audit verdicts.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = 'c:/Users/Mohamad60025/Desktop/App/Design And Build/packages/design-build-geometric-extraction';
const BLIND_OUTPUT_PATH = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-grammar-v1', 'code06-automatic-window-output.json');
const OUT_DIR = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-grammar-v1', 'closeups');
mkdirSync(OUT_DIR, { recursive: true });

function main() {
  const data = JSON.parse(readFileSync(BLIND_OUTPUT_PATH, 'utf8'));
  const candidates = data.candidates;

  const samples: { type: string; candidate: any; description: string }[] = [];

  // 1. Every retained high-evidence hypothesis (up to 5 for layout cleanliness)
  const acceptedHigh = candidates.filter((c: any) => c.extractionVerdict === 'ACCEPTED' && c.positiveEvidence.includes('valid-jamb-pair'));
  acceptedHigh.slice(0, 5).forEach((c: any, idx: number) => {
    samples.push({
      type: `retained-high-evidence-${idx + 1}`,
      candidate: c,
      description: `Retained High-Evidence Hypothesis: ${c.candidateId} (Jamb pair verified)`
    });
  });

  // 2. Rejected continuous wall faces
  const continuousRejected = candidates.filter((c: any) => c.negativeEvidence.includes('continuous-wall-face-detected'));
  continuousRejected.slice(0, 3).forEach((c: any, idx: number) => {
    samples.push({
      type: `rejected-continuous-face-${idx + 1}`,
      candidate: c,
      description: `Rejected Continuous Wall Face: ${c.candidateId}`
    });
  });

  // 3. Rejected hatch patterns
  const hatchRejected = candidates.filter((c: any) => c.negativeEvidence.includes('hatch-recurrence-pattern'));
  hatchRejected.slice(0, 2).forEach((c: any, idx: number) => {
    samples.push({
      type: `rejected-hatch-pattern-${idx + 1}`,
      candidate: c,
      description: `Rejected Hatch Pattern: ${c.candidateId}`
    });
  });

  // 4. Invalid finite intervals
  const intervalRejected = candidates.filter((c: any) => c.negativeEvidence.includes('interval-extends-beyond-wall'));
  intervalRejected.slice(0, 3).forEach((c: any, idx: number) => {
    samples.push({
      type: `rejected-invalid-interval-${idx + 1}`,
      candidate: c,
      description: `Rejected Invalid Finite Interval: ${c.candidateId}`
    });
  });

  const list: any[] = [];

  for (const s of samples) {
    const c = s.candidate;
    const [x0, y0, x1, y1] = c.generatedBounds;
    const w = x1 - x0;
    const h = y1 - y0;

    const pad = 20;
    const viewW = w + pad * 2;
    const viewH = h + pad * 2;

    const strokeColor = c.extractionVerdict === 'ACCEPTED' ? '#00cc00' : '#cc0000';

    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0 - pad} ${y0 - pad} ${viewW} ${viewH}" width="300" height="200">`,
      `  <rect x="${x0 - pad}" y="${y0 - pad}" width="${viewW}" height="${viewH}" fill="#f9f9f9" stroke="#ddd" stroke-width="1"/>`,
      `  <text x="${x0}" y="${y0 - 5}" font-size="7" font-family="monospace" fill="#222" font-weight="bold">${s.description}</text>`,
      `  <text x="${x0}" y="${y1 + 10}" font-size="6" font-family="monospace" fill="#999">ID: ${c.candidateId} | Wall: ${c.physicalWallId}</text>`,
      `  <rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-dasharray="${c.extractionVerdict === 'ACCEPTED' ? 'none' : '3,3'}"/>`,
      `  <text x="${x0 + 4}" y="${y0 + 12}" font-size="6" font-family="monospace" fill="${strokeColor}">Verdict: ${c.extractionVerdict} | Width: ${c.width.toFixed(1)}pt</text>`,
      `</svg>`
    ].join('\n');

    const fileName = `sample-${s.type}.svg`;
    writeFileSync(join(OUT_DIR, fileName), svg);
    list.push({
      type: s.type,
      candidateId: c.candidateId,
      wallId: c.physicalWallId,
      svgPath: `evidence/code06/phase-b-clean/blind-grammar-v1/closeups/${fileName}`
    });
  }

  writeFileSync(join(OUT_DIR, 'sample-list.json'), JSON.stringify(list, null, 2));
  console.log('Generated anonymous structural sample closeups for window grammar:', list.length);
}

main();
