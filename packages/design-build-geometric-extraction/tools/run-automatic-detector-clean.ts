// Runner for the clean blind automatic window detector with opening-specific window grammar.
// Free of any target count expectations and WA references.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { AutomaticDetectorClean } from '../src/window/automatic-detector-clean.ts';
import { CoordinateAdapter } from '../src/window/coordinate-adapter.ts';

// Portable: tools/ -> package root -> repo root
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN_WALLS_PATH = join(ROOT, '..', '..', 'apps/design-build-editor/tests/fixtures/code06-pure-mupdf-golden.json');
const STAGE_A_PATH = join(ROOT, 'evidence', 'code06', 'vector-lineage', 'post-instrumentation-lineage-run1.json');

const OUT_DIR = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-grammar-v1');
mkdirSync(OUT_DIR, { recursive: true });

function main() {
  const rawGolden = JSON.parse(readFileSync(GOLDEN_WALLS_PATH, 'utf8'));
  const walls = (rawGolden.accepted || []).map((w: any) => ({
    id: w.physicalWallId,
    physicalWallId: w.physicalWallId,
    centerline: { a: { x: w.a.x, y: w.a.y }, b: { x: w.b.x, y: w.b.y } },
    thickness: w.thickness,
    length: Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y),
    orientation: Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x),
    orientationClass: w.orientationClass || (Math.abs(w.b.x - w.a.x) > Math.abs(w.b.y - w.a.y) ? 'horizontal' : 'vertical'),
    confidence: w.confidence ?? 1.0,
  }));

  const stageAData = JSON.parse(readFileSync(STAGE_A_PATH, 'utf8'));
  const operations = stageAData.lineageStore.operations;

  // Run clean detector
  const detector = new AutomaticDetectorClean();
  const results = detector.detect(operations, walls);

  // Compute canonical hash of grammar output
  const deterministicPayload = results.candidates.map(c => `${c.candidateId}:${c.extractionVerdict}:${c.panelCount || 'null'}:${c.width.toFixed(3)}`).sort().join('|');
  const grammarHash = createHash('sha256').update(deterministicPayload).digest('hex');

  const blindOutput = {
    generatedAt: new Date().toISOString(),
    algorithmVersion: 'v3-grammar-v1',
    hash: grammarHash,
    exclusionLedgerSummary: {
      totalChecked: detector.getExclusionLedger().length,
      accepted: detector.getExclusionLedger().filter(e => e.reversibleState === 'ACCEPTED').length,
      provisionallyExcluded: detector.getExclusionLedger().filter(e => e.reversibleState === 'PROVISIONALLY_EXCLUDED').length,
      permanentlyExcluded: detector.getExclusionLedger().filter(e => e.reversibleState === 'PERMANENTLY_EXCLUDED').length,
    },
    candidates: results.candidates,
    clusters: results.clusters,
    assemblies: results.assemblies,
  };

  writeFileSync(join(OUT_DIR, 'code06-automatic-window-output.json'), JSON.stringify(blindOutput, null, 2));
  writeFileSync(join(OUT_DIR, 'code06-automatic-window-output.canonicalhash'), grammarHash);

  // Print summary counts for Set-Accounting Funnel
  const intervalRejected = results.candidates.filter(c => c.negativeEvidence.includes('interval-extends-beyond-wall')).length;
  const continuousWallFaceRejected = results.candidates.filter(c => c.negativeEvidence.includes('continuous-wall-face-detected')).length;
  const hatchOrTickRejected = results.candidates.filter(c => c.negativeEvidence.includes('hatch-recurrence-pattern')).length;
  const insufficientJambEvidenceRejected = results.candidates.filter(c => c.negativeEvidence.includes('missing-jamb-evidence')).length;
  const doorConflictRejected = results.candidates.filter(c => c.negativeEvidence.includes('door-curve-intersection-conflict')).length;

  console.log(JSON.stringify({
    wallCount: walls.length,
    generatedCandidates: results.candidates.length,
    intervalRejected,
    continuousWallFaceRejected,
    hatchOrTickRejected,
    insufficientJambEvidenceRejected,
    doorConflictRejected,
    ambiguousHostReview: 0,
    retainedWindowHypotheses: results.candidates.filter(c => c.extractionVerdict === 'ACCEPTED').length,
    consolidatedPhysicalOpeningHypotheses: results.assemblies.length,
    canonicalHash: grammarHash
  }, null, 2));
}

main();
