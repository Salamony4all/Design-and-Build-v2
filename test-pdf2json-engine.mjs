import fs from 'fs';
import path from 'path';
import { consolidateWalls } from './apps/editor/src/core/wall-consolidator.ts';
import { extractRoomSeeds, computeRoiFromSeeds } from './apps/editor/src/lib/topology/space-topology-extractor.ts';

const jsonPath = './tmp/pdf2json-test/CODE_06 1 page.pdf.json';
if (!fs.existsSync(jsonPath)) {
  console.error('File not found:', jsonPath);
  process.exit(1);
}

const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const page = doc.Pages[0];
const W = page.Width;
const H = page.Height;

// World page dimensions in meters (20.00m x 14.13m)
const widthM = 20.00;
const heightM = 14.13;

const scaleX = widthM / W;
const scaleY = heightM / H;

// Extract text items for room seed ROI detection
const textItems = (page.Texts || []).map(t => {
  const textStr = (t.R || []).map(r => decodeURIComponent(r.T)).join(' ');
  const xPt = t.x * scaleX * 50;
  const yPt = (H - t.y) * scaleY * 50;
  return {
    str: textStr,
    transform: [1, 0, 0, 1, xPt, yPt],
  };
});

const seeds = extractRoomSeeds(textItems, 50, heightM * 50);
const roi = computeRoiFromSeeds(seeds, widthM, heightM);

console.log(`[pdf2json] Page: ${W}x${H} -> World: ${widthM}mx${heightM}m, Seeds: ${seeds.length}, ROI:`, roi);

const candidates = [];

for (const h of page.HLines || []) {
  const x1 = h.x * scaleX;
  const y1 = h.y * scaleY;
  const x2 = (h.x + h.l) * scaleX;
  const y2 = h.y * scaleY;
  const thick = Math.max(0.10, h.w * scaleY * 0.08);

  candidates.push({
    points: [[x1, y1], [x2, y2]],
    thicknessM: thick,
    layer: 'A-WALL',
    role: 'pdf2json_hline',
  });
}

for (const v of page.VLines || []) {
  const x1 = v.x * scaleX;
  const y1 = v.y * scaleY;
  const x2 = v.x * scaleX;
  const y2 = (v.y + v.l) * scaleY;
  const thick = Math.max(0.10, v.w * scaleX * 0.08);

  candidates.push({
    points: [[x1, y1], [x2, y2]],
    thicknessM: thick,
    layer: 'A-WALL',
    role: 'pdf2json_vline',
  });
}

const consolidated = consolidateWalls(candidates, roi);
console.log(`[pdf2json Engine] Candidate Lines: ${candidates.length} -> Validated Walls: ${consolidated.walls.length}`);
console.log('Sample Wall 1:', consolidated.walls[0]);
console.log('Sample Wall 2:', consolidated.walls[1]);
