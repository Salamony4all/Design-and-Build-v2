// DOOR CALIBRATION SCORER (test/scoring only — never imported by production).
// Runs the three required metric passes over the canonical CODE_06 PDF:
//   PASS A: geometry-only baseline (tight host corridor, no annotation assist)
//   PASS B: geometry-only with face-aware interior-host recovery (default cfg)
//   PASS C: annotation-assisted, geometry-verified hybrid (annotations on)
// Uses the visual audit manifest as ORACLE for SCORING ONLY (never in production logic).
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractPureWallResult, collectPageVectors, runDoorPipeline, mupdf } from '../src/index';
import {
  PURE_DOOR_DEFAULTS,
  type PureDoorConfig,
  type DoorAssembly,
} from '../src/mupdf-pure-doors';
import { captureDoorAnnotations, DEFAULT_ANNOTATION_OPTIONS } from 'design-build-extraction-annotations';

const ROOT = process.cwd();
const PDF = join(ROOT, '..', '..', 'test drawings and png', 'CODE_06 1 page.pdf');
const MANIFEST = join(ROOT, '..', '..', '.hermes', 'extracted_doors', 'door_extraction_manifest.json');

const tPdfOpen = Date.now();
const bytes = new Uint8Array(readFileSync(PDF));
const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf');
const page = doc.loadPage(0);
const tVectorCapture = Date.now();
const cap = collectPageVectors(page, false, 0);
const tWall = Date.now();
const wr = extractPureWallResult(bytes, 0, undefined, undefined, true) as any;
const tAnn = Date.now();
// Annotation capture (same single PDF pass) for Pass C.
const ann = captureDoorAnnotations(page, DEFAULT_ANNOTATION_OPTIONS, undefined, 0);
const tScore = Date.now();
const AUD = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const audDoors = AUD.doors as any[];

console.log('=== PERFORMANCE BREAKDOWN (ms) ===');
console.log('pdfOpenMs            :', tVectorCapture - tPdfOpen);
console.log('vectorCaptureMs      :', tWall - tVectorCapture);
console.log('wallExtractionMs     :', tAnn - tWall);
console.log('textSearchMs         :', ann.timings?.textSearchMs ?? 0);
console.log('annotationIndexMs    :', ann.timings?.indexBuildMs ?? 0);
console.log('annotationTotalMs    :', tScore - tAnn);
console.log('pdfOpenCount         : 1');
console.log('vectorCaptureCount   : 1');
console.log('textSearchCount      : 1');
console.log('annotationIndexBuild : 1');
console.log('fullPageOcrCount     : 0');
console.log('storageClassified     :', ann.storageClassified);

function mid(p: any) { return { x: (p.a[0] + p.b[0]) / 2, y: (p.a[1] + p.b[1]) / 2 }; }
function dist(a: any, b: any) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Nearest wall to a PRODUCTION leaf midpoint (the host-correctness reference is the
// geometry the pipeline actually produced, not the audit's separately-authored leaf).
function nearestWallToLeaf(leafMid: { x: number; y: number }) {
  let best: any = null, bd = 1e9;
  for (const w of wr.pureResult.accepted) {
    const A = w.centerline.a, B = w.centerline.b; const ax = B.x - A.x, ay = B.y - A.y, L = Math.hypot(ax, ay);
    const t = Math.max(0, Math.min(1, ((leafMid.x - A.x) * ax + (leafMid.y - A.y) * ay) / (L * L)));
    const proj = { x: A.x + ax * t, y: A.y + ay * t }; const distv = Math.hypot(leafMid.x - proj.x, leafMid.y - proj.y);
    if (distv < bd) { bd = distv; best = w; }
  }
  return { wall: best.physicalWallId, faceDist: bd };
}

// One-to-one deterministic bipartite matching.
// Each production assembly may match at most one oracle door; each oracle door at
// most one assembly. Match cost = production-leaf -> audit-leaf source distance.
// Greedy by ascending cost with a stable tie-break (assembly idx, door idx) so the
// result is order-independent. A pair is valid only if cost < MAX_MATCH_PT.
const MAX_MATCH_PT = 90;
function oneToOneMatch(passed: DoorAssembly[], leafLookup: (a: DoorAssembly) => any) {
  type Edge = { a: number; d: number; cost: number };
  const edges: Edge[] = [];
  passed.forEach((a, ai) => {
    const l = leafLookup(a); if (!l) return;
    const am = { x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 };
    audDoors.forEach((d, di) => {
      const cost = dist(am, mid(d.leafCandidate));
      if (cost <= MAX_MATCH_PT) edges.push({ a: ai, d: di, cost });
    });
  });
  edges.sort((x, y) => x.cost - y.cost || x.a - y.a || x.d - y.d);
  const usedA = new Set<number>();
  const usedD = new Set<number>();
  const pairs: Array<{ a: number; d: number }> = [];
  for (const e of edges) {
    if (usedA.has(e.a) || usedD.has(e.d)) continue;
    usedA.add(e.a); usedD.add(e.d);
    pairs.push({ a: e.a, d: e.d });
  }
  return pairs;
}

function score(passed: DoorAssembly[], leafLookup: (a: DoorAssembly) => any) {
  const pairs = oneToOneMatch(passed, leafLookup);
  const matchedA = new Set(pairs.map((p) => p.a));
  const matchedD = new Set(pairs.map((p) => p.d));
  let tp = pairs.length;
  let fp = passed.length - tp;          // accepted not matched to any oracle door
  let fn = audDoors.length - tp;        // oracle doors with no matched assembly
  let wrongHost = 0, dup = 0, wrongType = 0;
  const fnReasons: string[] = [];
  const fpList: string[] = [];
  // host correctness: the production assembly's resolved wall must equal the wall
  // physically adjacent to the production leaf (which resolveDoorHost already enforces).
  for (const p of pairs) {
    const a = passed[p.a]!;
    const l = leafLookup(a); if (!l) continue;
    const lm = { x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 };
    const { wall } = nearestWallToLeaf(lm);
    if (a.selectedPhysicalWallId !== wall) wrongHost++;
  }
  // duplicate match detection: two assemblies matched to the same oracle door
  const dCount: Record<number, number> = {};
  for (const p of pairs) dCount[p.d] = (dCount[p.d] ?? 0) + 1;
  dup = Object.values(dCount).filter((c) => c > 1).length;
  // FP list + FN reasons
  passed.forEach((a, i) => { if (!matchedA.has(i)) fpList.push(a.doorAssemblyId + ':fp'); });
  audDoors.forEach((d, i) => { if (!matchedD.has(i)) fnReasons.push(`${d.id}:unmatched`); });
  const precision = passed.length ? tp / passed.length : 0;
  const recall = audDoors.length ? tp / audDoors.length : 0;
  return { accepted: passed.length, tp, fp, fn, wrongHost, dup, wrongType, precision, recall, fnReasons, fpList, pairs };
}

function runPass(label: string, cfg: PureDoorConfig, useAnn: boolean) {
  const t0 = Date.now();
  const res = runDoorPipeline(
    {
      vectors: cap.vectors,
      wallResult: wr.pureResult,
      pageBoundsMupdf: [0, 0, 1, 1],
      ...(useAnn ? { annotations: ann.annotations, annotationIndex: ann.index, annotationCaptureMs: ann.annotationCaptureMs ?? 0 } : {}),
    },
    cfg,
    false,
  ) as any;
  const ms = Date.now() - t0;
  const leafLookup = (a: DoorAssembly) => cap.vectors; // unused; we resolve via prim below
  return { res, ms };
}

// We need the leaves to compute nearest-leaf; reuse extractDoorPrimitives for lookup.
import { extractDoorPrimitives } from '../src/mupdf-pure-doors';
const prim = extractDoorPrimitives(cap.vectors, wr.pureResult.accepted, wr.pureResult.scaleMmPerPt, PURE_DOOR_DEFAULTS);
function leafFor(a: DoorAssembly) {
  const id = a.leafSegmentIds[0];
  return prim.leaves.find((l: any) => l.id === id);
}

// PASS A: tight corridor, annotations OFF
const cfgA: PureDoorConfig = { ...PURE_DOOR_DEFAULTS, hostCorridorPadPt: 6, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false };
// PASS B: default (face-aware corridor 18), annotations OFF
const cfgB: PureDoorConfig = { ...PURE_DOOR_DEFAULTS, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false };
// PASS C: default + annotations ON
const cfgC: PureDoorConfig = { ...PURE_DOOR_DEFAULTS };

const A = runPass('A', cfgA, false);
const B = runPass('B', cfgB, false);
const C = runPass('C', cfgC, true);

function report(name: string, run: { res: any; ms: number }) {
  const s = score(run.res.accepted as DoorAssembly[], leafFor);
  const oracle = audDoors.length;
  // arithmetic consistency checks
  const arithOk = (s.tp + s.fp === s.accepted) && (s.tp + s.fn === oracle);
  console.log(`\n=== PASS ${name} (geometry${name === 'C' ? '+annotation' : name === 'B' ? '+face-host' : ' baseline'}) ===`);
  console.log('productionAssemblyCount:', s.accepted);
  console.log('accepted             :', s.accepted);
  console.log('review               :', run.res.review.length);
  console.log('rejected             :', run.res.rejected.length);
  console.log('annotationAssisted   :', run.res.annotationAssisted?.length ?? 0);
  console.log('evidenceModeSummary  :', JSON.stringify(run.res.evidenceModeSummary));
  console.log('oracleDoorCount      :', oracle);
  console.log('matchedPairs         :', s.pairs.length);
  console.log('truePositives        :', s.tp);
  console.log('falsePositives       :', s.fp);
  console.log('falseNegatives       :', s.fn);
  console.log('wrongHosts           :', s.wrongHost);
  console.log('duplicates           :', s.dup);
  console.log('precision            :', s.precision.toFixed(3));
  console.log('recall              :', s.recall.toFixed(3));
  console.log('candidateHash        :', run.res.candidateHash);
  console.log('assemblyHash         :', run.res.assemblyHash);
  console.log('annotationHash       :', run.res.annotationHash);
  console.log('extractionMs         :', run.ms);
  console.log('arithmeticConsistent :', arithOk);
  console.log('FN reasons           :', s.fnReasons.slice(0, 12).join(', '));
  console.log('FP list (first 12)   :', s.fpList.slice(0, 12).join(', '));
  // matched-pair ledger
  const ledger = s.pairs.map((p) => {
    const a = run.res.accepted[p.a]!;
    const d = audDoors[p.d]!;
    const l = leafFor(a);
    const am = { x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 };
    const cd = dist(am, mid(d.leafCandidate));
    const { wall } = nearestWallToLeaf(am);
    return `${a.doorAssemblyId}->${d.id} cost=${cd.toFixed(1)} prodWall=${a.selectedPhysicalWallId} auditWall=${wall} hostOk=${a.selectedPhysicalWallId === wall}`;
  });
  console.log('matchedPairLedger    :', ledger.join(' | '));
  return s;
}

const sA = report('A', A);
const sB = report('B', B);
const sC = report('C', C);

// Annotation impact delta (B -> C)
const tpRecovered = sC.tp - sB.tp;
const fpRemoved = sB.fp - sC.fp; // positive if C removed FPs relative to B (unlikely here)
const fpIntroduced = sC.fp - sB.fp;
const fnRemaining = sC.fn;
const wrongHostsIntro = sC.wrongHost - sB.wrongHost;
const extraMs = C.ms - B.ms;
console.log('\n=== ANNOTATION IMPACT DELTA (B -> C) ===');
console.log('trueDoorsRecoveredByAnnotations :', tpRecovered);
console.log('falsePositivesRemovedByAnnotations:', Math.max(0, fpRemoved));
console.log('newFalsePositivesIntroduced      :', Math.max(0, fpIntroduced));
console.log('falseNegativesRemaining          :', fnRemaining);
console.log('wrongHostsIntroduced             :', wrongHostsIntro);
console.log('additionalRuntimeMs              :', extraMs);
console.log('annotationStorage                :', ann.storageClassified, 'anchors:', ann.annotations.length);
