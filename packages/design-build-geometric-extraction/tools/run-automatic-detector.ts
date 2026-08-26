// Runner for automatic window detector and full population analysis
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { AutomaticDetector } from '../src/window/automatic-detector.ts';
import { CoordinateAdapter } from '../src/window/coordinate-adapter.ts';

const ROOT = 'c:/Users/Mohamad60025/Desktop/App/Design And Build/packages/design-build-geometric-extraction';
const GOLDEN_WALLS_PATH = join(ROOT, '..', '..', 'apps/design-build-editor/tests/fixtures/code06-pure-mupdf-golden.json');
const STAGE_A_PATH = join(ROOT, 'evidence', 'code06', 'vector-lineage', 'post-instrumentation-lineage-run1.json');

const OUT_BLIND = join(ROOT, 'evidence', 'code06', 'blind-detector');
const OUT_WA = join(ROOT, 'evidence', 'code06', 'wa-audit');
mkdirSync(OUT_BLIND, { recursive: true });
mkdirSync(OUT_WA, { recursive: true });

// 1. Load inputs
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

// 2. Run blind detection
const detector = new AutomaticDetector();
const results = detector.detect(operations, walls);

// Compute canonical hash of blind output
const sortedCandIds = results.candidates.map(c => c.candidateId).sort();
const deterministicPayload = results.candidates.map(c => `${c.candidateId}:${c.extractionVerdict}:${c.panelCount || 'null'}:${c.width.toFixed(3)}`).sort().join('|');
const blindHash = createHash('sha256').update(deterministicPayload).digest('hex');

const blindOutput = {
  generatedAt: new Date().toISOString(),
  algorithmVersion: 'v2',
  hash: blindHash,
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

writeFileSync(join(OUT_BLIND, 'code06-automatic-window-output.json'), JSON.stringify(blindOutput, null, 2));
writeFileSync(join(OUT_BLIND, 'code06-automatic-window-output.canonicalhash'), blindHash);

// 3. Reconcile WA References post-detection
// The 6 base coordinates of Unit 1 WA labels in Stage A space:
const baseWa = [
  { id: 'WA-01', x: 130, y: 69 },
  { id: 'WA-02', x: 237, y: 69 },
  { id: 'WA-03', x: 345, y: 69 },
  { id: 'WA-04', x: 399, y: 69 },
  { id: 'WA-05', x: 509, y: 69 },
  { id: 'WA-06', x: 620, y: 69 }
];

// Unit offsets in Stage A space (derived from sector oracle anchors)
const offsets = [
  { unit: 1, dx: 0, dy: 0 },
  { unit: 2, dx: -4.20, dy: 484.56 },
  { unit: 3, dx: 800.27, dy: -8.16 },
  { unit: 4, dx: 778.07, dy: 489.96 }
];

// Build 24 WA reference coordinates in Instrument Page Space
const waReferences: any[] = [];
for (const offset of offsets) {
  for (const base of baseWa) {
    const waId = `wa-${offset.unit}-${base.id.toLowerCase()}`;
    const xStageA = base.x + offset.dx;
    const yStageA = base.y + offset.dy;
    const instrPoint = CoordinateAdapter.pointToInstr(xStageA, yStageA);
    waReferences.push({
      waId,
      unit: offset.unit,
      originalText: base.id,
      stageACoords: { x: xStageA, y: yStageA },
      instrumentCoords: instrPoint,
    });
  }
}

// Match physical assemblies to WA references (distance < 50px)
const matchedWa = new Set();
const matchedAssemblies = new Set();
const waMatches: any[] = [];

for (const wa of waReferences) {
  let bestDist = Infinity;
  let bestAssembly: any = null;

  for (const ass of results.assemblies) {
    // Reconstruct assembly midpoint in Instrument space
    const w = walls.find(wall => wall.physicalWallId === ass.physicalWallId);
    if (!w) continue;
    const ax = w.centerline.a.x;
    const ay = w.centerline.a.y;
    const bx = w.centerline.b.x;
    const by = w.centerline.b.y;
    const wallLen = Math.hypot(bx - ax, by - ay);
    const dx = (bx - ax) / wallLen;
    const dy = (by - ay) / wallLen;

    const uMid = (ass.finiteOpeningInterval.start + ass.finiteOpeningInterval.end) / 2;
    const midXStageA = ax + uMid * dx;
    const midYStageA = ay + uMid * dy;
    const midInstr = CoordinateAdapter.pointToInstr(midXStageA, midYStageA);

    const dist = Math.hypot(midInstr.x - wa.instrumentCoords.x, midInstr.y - wa.instrumentCoords.y);
    if (dist < bestDist && dist < 50.0) {
      bestDist = dist;
      bestAssembly = ass;
    }
  }

  // Fallback: match based on X/Y overlap within same wall region
  if (!bestAssembly) {
    for (const ass of results.assemblies) {
      const w = walls.find(wall => wall.physicalWallId === ass.physicalWallId);
      if (!w) continue;
      // Convert assembly bounds to Instrument space and check X overlap
      const ax = w.centerline.a.x;
      const bx = w.centerline.b.x;
      const uMid = (ass.finiteOpeningInterval.start + ass.finiteOpeningInterval.end) / 2;
      const midXStageA = ax + uMid * ((bx - ax) / Math.hypot(bx - ax, w.centerline.b.y - w.centerline.a.y));
      const midXInstr = midXStageA - CoordinateAdapter.TX;

      const dist = Math.abs(midXInstr - wa.instrumentCoords.x);
      if (dist < bestDist && dist < 45.0) {
        bestDist = dist;
        bestAssembly = ass;
      }
    }
  }

  if (bestAssembly && bestDist < 50.0) {
    matchedWa.add(wa.waId);
    matchedAssemblies.add(bestAssembly.physicalWindowHypothesisId);
    waMatches.push({
      waId: wa.waId,
      assemblyId: bestAssembly.physicalWindowHypothesisId,
      distancePx: +bestDist.toFixed(2),
    });
    bestAssembly.waReferencesNearby.push(wa.waId);
  }
}

// Complete the WA reconciliation report
const waReport = {
  generatedAt: new Date().toISOString(),
  waReferenceCount: waReferences.length,
  physicalAssemblyCount: results.assemblies.length,
  totalPanelCount: results.assemblies.reduce((sum, a) => sum + (a.panelCount || 0), 0),
  referencesMatchedToAssemblies: matchedWa.size,
  assembliesWithMultipleReferences: results.assemblies.filter(a => a.waReferencesNearby.length > 1).map(a => a.physicalWindowHypothesisId),
  referencesWithoutAssembly: waReferences.filter(wa => !matchedWa.has(wa.waId)).map(wa => ({ id: wa.waId, unit: wa.unit, coords: wa.instrumentCoords })),
  assembliesWithoutReference: results.assemblies.filter(a => !matchedAssemblies.has(a.physicalWindowHypothesisId)).map(a => a.physicalWindowHypothesisId),
  matches: waMatches,
};

writeFileSync(join(OUT_WA, 'code06-wa-reconciliation-report.json'), JSON.stringify(waReport, null, 2));

// 4. Calibration against the six manual audit fixtures
const fixtures = [
  { id: 'win-1', bounds: [210, 280, 255, 310], obs: 'VISIBLE_WINDOW' },
  { id: 'win-2', bounds: [305, 275, 350, 305], obs: 'VISIBLE_WINDOW' },
  { id: 'win-3', bounds: [160, 200, 210, 230], obs: 'LIKELY_WINDOW' },
  { id: 'win-4', bounds: [420, 140, 470, 170], obs: 'LIKELY_WINDOW' },
  { id: 'win-5', bounds: [500, 100, 560, 140], obs: 'UNRESOLVED' },
  { id: 'win-6', bounds: [350, 180, 400, 220], obs: 'NOT_A_WINDOW' },
];

const calibration = fixtures.map(fix => {
  // Find automatic candidate overlapping this fixture's bounds
  let bestOverlap = 0;
  let matchedCand: any = null;

  for (const c of results.candidates) {
    const ab = c.generatedBounds;
    const fb = fix.bounds;

    const w = walls.find(wall => wall.physicalWallId === c.physicalWallId);
    const isVertical = w ? w.orientationClass === 'vertical' : false;

    let match = false;
    let overlapMetric = 0;

    if (isVertical) {
      const yOverlap = Math.max(0, Math.min(ab[3], fb[3]) - Math.max(ab[1], fb[1]));
      const xCenterDiff = Math.abs((ab[0] + ab[2])/2 - (fb[0] + fb[2])/2);
      if (yOverlap > 2.0 && xCenterDiff < 70.0) {
        match = true;
        overlapMetric = yOverlap;
      }
    } else {
      const xOverlap = Math.max(0, Math.min(ab[2], fb[2]) - Math.max(ab[0], fb[0]));
      const yCenterDiff = Math.abs((ab[1] + ab[3])/2 - (fb[1] + fb[3])/2);
      if (xOverlap > 2.0 && yCenterDiff < 70.0) {
        match = true;
        overlapMetric = xOverlap;
      }
    }

    if (match && overlapMetric > bestOverlap) {
      bestOverlap = overlapMetric;
      matchedCand = c;
    }
  }

  const redis = matchedCand !== null;
  return {
    auditFixtureId: fix.id,
    automaticallyRediscovered: redis,
    automaticCandidateId: matchedCand ? matchedCand.candidateId : null,
    centreDelta: matchedCand ? +Math.hypot(
      (matchedCand.generatedBounds[0] + matchedCand.generatedBounds[2])/2 - (fix.bounds[0] + fix.bounds[2])/2,
      (matchedCand.generatedBounds[1] + matchedCand.generatedBounds[3])/2 - (fix.bounds[1] + fix.bounds[3])/2
    ).toFixed(2) : null,
    boundsOverlap: +bestOverlap.toFixed(2),
    topologyAgreement: matchedCand ? matchedCand.topologyClass === 'PARALLEL_FRAME_LINES' : false,
    hostAgreement: matchedCand ? matchedCand.physicalWallId !== null : false,
    verdictAgreement: matchedCand ? (matchedCand.reviewerObservation === fix.obs) : false,
  };
});

// 5. Generate close-up SVGs for accepted assemblies
results.assemblies.forEach((ass, index) => {
  const w = walls.find(wall => wall.physicalWallId === ass.physicalWallId);
  if (!w) return;

  const ax = w.centerline.a.x - CoordinateAdapter.TX;
  const ay = w.centerline.a.y - CoordinateAdapter.TY;
  const bx = w.centerline.b.x - CoordinateAdapter.TX;
  const by = w.centerline.b.y - CoordinateAdapter.TY;

  const uStart = ass.finiteOpeningInterval.start;
  const uEnd = ass.finiteOpeningInterval.end;
  const dx = (bx - ax) / Math.hypot(bx - ax, by - ay);
  const dy = (by - ay) / Math.hypot(bx - ax, by - ay);

  const x0 = ax + uStart * dx;
  const y0 = ay + uStart * dy;
  const x1 = ax + uEnd * dx;
  const y1 = ay + uEnd * dy;

  // Render assembly close-up SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" font-family="monospace" font-size="10">
    <rect width="400" height="200" fill="#f8fafc" stroke="#e2e8f0"/>
    <text x="10" y="20" font-weight="bold" font-size="12">${ass.physicalWindowHypothesisId}</text>
    <text x="10" y="35">Wall: ${ass.physicalWallId} | Width: ${ass.physicalWidthMm.toFixed(0)} mm</text>
    <text x="10" y="50">Interval: [${uStart.toFixed(2)} - ${uEnd.toFixed(2)}] | Panels: ${ass.panelCount || 'UNRESOLVED'}</text>
    <text x="10" y="65">WA label match: ${ass.waReferencesNearby.join(', ') || 'none'}</text>
    <!-- Wall centerline -->
    <line x1="${(50 + ax/4).toFixed(1)}" y1="${(120 + ay/4).toFixed(1)}" x2="${(50 + bx/4).toFixed(1)}" y2="${(120 + by/4).toFixed(1)}" stroke="#cbd5e1" stroke-width="6" stroke-linecap="round"/>
    <!-- Window centerline -->
    <line x1="${(50 + x0/4).toFixed(1)}" y1="${(120 + y0/4).toFixed(1)}" x2="${(50 + x1/4).toFixed(1)}" y2="${(120 + y1/4).toFixed(1)}" stroke="#16a34a" stroke-width="4" stroke-linecap="round"/>
  </svg>`;

  writeFileSync(join(OUT_WA, `assembly-${index + 1}-closeup.svg`), svg);
});

// Write Vision Quality Summary
const summaryMd = `# Window Vision Quality Summary
*Blind Automatic Detector Review*

- **Algorithm Version**: \`v2\`
- **Bridge Deterministic Hash (preservation)**: \`41d75c3f27285ca178caf4837ab38bdb7010f73f1717df846cd8ac9b93fabd51\`
- **Automatic Funnel**:
  - Raw candidates generated: ${results.candidates.length}
  - Unique physical assemblies: ${results.assemblies.length}
  - Total glazing panels: ${waReport.totalPanelCount}
  - WA labels matched: ${matchedWa.size} / 24
- **Calibration agreement**:
${JSON.stringify(calibration, null, 2)}
`;

writeFileSync(join(OUT_WA, 'code06-vision-quality-summary.md'), summaryMd);

console.log(JSON.stringify({
  blindHash,
  totalCandidates: results.candidates.length,
  assemblies: results.assemblies.length,
  waMatches: matchedWa.size,
  calibration,
}, null, 2));
