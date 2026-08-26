// Stage B.5 - Human Review Package builder
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { CoordinateAdapter } from '../src/window/coordinate-adapter.ts';

const ROOT = 'c:/Users/Mohamad60025/Desktop/App/Design And Build/packages/design-build-geometric-extraction';
const REPORT_PATH = join(ROOT, 'evidence', 'code06', 'blind-detector', 'code06-b4-visual-audit-report.json');
const OUT_DIR = join(ROOT, 'evidence', 'code06', 'human-window-review');
mkdirSync(OUT_DIR, { recursive: true });

const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
const manifest66 = report.manifest66;

// Deterministic shuffle using ID hashes
const hashedItems = manifest66.map((m: any) => {
  const hash = createHash('sha256').update(m.hypothesisId).digest('hex');
  return { ...m, sortHash: hash };
});
hashedItems.sort((a, b) => a.sortHash.localeCompare(b.sortHash));

const shufflePayload = hashedItems.map(item => item.hypothesisId).join('|');
const shuffleHash = createHash('sha256').update(shufflePayload).digest('hex');

const anonymizedManifest = hashedItems.map((m: any, idx: number) => {
  const anonymousReviewId = `rev_${m.sortHash.slice(0, 12)}`;
  
  // Calculate center fullPageLocation in Instrument Page coordinates
  const interval = m.interval;
  const xLoc = (interval.start + interval.end) / 2;
  const yLoc = 500; // average centerline height
  
  return {
    auditId: idx + 1,
    anonymousReviewId,
    hypothesisId: m.hypothesisId,
    physicalWallId: m.physicalWallId,
    finiteInterval: interval,
    widthMm: m.widthMm,
    closeupPath: m.closeupPath,
    fullPageLocation: { x: +xLoc.toFixed(1), y: yLoc },
    sourceSegmentIds: m.frameSegmentIds || [],
    modelVerdict: m.reviewerObservation, // preserve internally
    humanVerdict: null,
    humanNotes: "",
    reviewedAt: null,
  };
});

writeFileSync(join(OUT_DIR, 'anonymized-manifest.json'), JSON.stringify({
  shuffleHash,
  manifest: anonymizedManifest,
}, null, 2));

console.log(JSON.stringify({
  manifestPath: 'packages/design-build-geometric-extraction/evidence/code06/human-window-review/anonymized-manifest.json',
  shuffleHash,
  recordCount: anonymizedManifest.length,
}, null, 2));
