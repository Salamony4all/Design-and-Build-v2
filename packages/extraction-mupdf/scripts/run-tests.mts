// Standalone runner for the door-pipeline + annotation assertions (vitest hangs in
// this env due to mupdf-native worker; this gives real executed evidence).
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractPureWallResult, collectPageVectors, runDoorPipeline, PURE_DOOR_DEFAULTS } from '../src/index';
import { buildDoorProductionManifest } from '../src/mupdf-pure-doors';
import { captureDoorAnnotations, DEFAULT_ANNOTATION_OPTIONS, normalizeDoorTag } from 'design-build-extraction-annotations';
import * as mupdf from 'mupdf';

const ROOT = process.cwd();
const PDF = join(ROOT, '..', '..', 'test drawings and png', 'CODE_06 1 page.pdf');

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const bytes = new Uint8Array(readFileSync(PDF));
const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf');
const page = (doc as any).loadPage(0);
const cap = collectPageVectors(page, false, 0);
const wr = extractPureWallResult(bytes, 0, undefined, undefined, true) as any;
const ann = captureDoorAnnotations(page, DEFAULT_ANNOTATION_OPTIONS, undefined, 0);
const merged = PURE_DOOR_DEFAULTS;

console.log('=== annotation tests ===');
check('DT normalization DT-07', normalizeDoorTag('DT-07') === 'DT-07');
check('storageClassified PDF_TEXT', ann.storageClassified === 'PDF_TEXT', `(${ann.storageClassified})`);
check('recovered >= 20 anchors', ann.annotations.length >= 20, `(${ann.annotations.length})`);
check('all anchors PDF_TEXT (no OCR)', ann.annotations.every((a) => a.kind === 'PDF_TEXT'));

console.log('=== door pipeline tests ===');
const tight = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0,0,1,1] }, { ...merged, hostCorridorPadPt: 6, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false }, false) as any;
const face = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0,0,1,1] }, { ...merged, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false }, false) as any;
check('face-aware recovers >= tight', face.accepted.length >= tight.accepted.length, `(${face.accepted.length} vs ${tight.accepted.length})`);

const ambig = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0,0,1,1] }, { ...merged, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false, hostAmbiguityMargin: 0.5 }, false) as any;
check('all accepted UNIQUE_HOST', ambig.accepted.every((a: any) => a.hostStatus === 'UNIQUE_HOST'));

const C = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0,0,1,1], annotations: ann.annotations, annotationIndex: ann.index, annotationCaptureMs: 0 }, merged, false) as any;
check('no ANNOTATION_ONLY assemblies', C.annotationAssisted.every((a: any) => a.evidenceMode !== 'ANNOTATION_ONLY'));

const keys = C.accepted.map((a: any) => `${a.selectedPhysicalWallId}:${a.wallLocalInterval?.from.toFixed(1)}:${a.wallLocalInterval?.to.toFixed(1)}`);
check('accepted unique by wall+interval (no dup)', new Set(keys).size === keys.length, `(${new Set(keys).size}/${keys.length})`);

const r1 = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0,0,1,1], annotations: ann.annotations, annotationIndex: ann.index, annotationCaptureMs: 0 }, merged, false) as any;
const r2 = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0,0,1,1], annotations: ann.annotations, annotationIndex: ann.index, annotationCaptureMs: 0 }, merged, false) as any;
check('deterministic candidateHash', r1.candidateHash === r2.candidateHash, `(${r1.candidateHash} vs ${r2.candidateHash})`);
check('deterministic assemblyHash', r1.assemblyHash === r2.assemblyHash);
check('deterministic annotationHash', r1.annotationHash === r2.annotationHash);

const g1 = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0,0,1,1] }, { ...merged, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false }, false) as any;
const g2 = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0,0,1,1] }, { ...merged, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false }, false) as any;
check('annotation-disabled parity', g1.candidateHash === g2.candidateHash && g1.accepted.length === g2.accepted.length);

check('hybrid C accepted >= 20', C.accepted.length >= 20, `(${C.accepted.length})`);
check('hybrid accepted evidence valid', C.accepted.every((a: any) => ['ANNOTATION_ASSISTED_GEOMETRY_VERIFIED', 'GEOMETRY_ONLY', 'ANNOTATION_ASSISTED_REVIEW_REQUIRED'].includes(a.evidenceMode)));

// --- Door production manifest test (§1 freeze) ---
{
  const man = buildDoorProductionManifest(C as any, wr.pureResult.scaleMmPerPt, 'h');
  check('manifest accepted == 24', man.acceptedCount === 24, `(${man.acceptedCount})`);
  check('manifest review >= 1 (DR-16)', man.reviewCount >= 1, `(${man.reviewCount})`);
  check('manifest accepted no ANNOTATION_ONLY', !man.accepted.some((r: any) => r.evidenceMode === 'ANNOTATION_ONLY'));
  check('manifest accepted all UNIQUE_HOST', man.accepted.every((r: any) => r.hostStatus === 'UNIQUE_HOST'));
  check('manifest accepted all physicalGeometryVerified', man.accepted.every((r: any) => r.physicalGeometryVerified === true));
  check('manifest accepted all intervalContained', man.accepted.every((r: any) => r.intervalContained === true));
  const ids = man.accepted.map((r: any) => r.doorAssemblyId);
  check('manifest accepted unique ids', new Set(ids).size === ids.length);
  check('manifest no annotation-only in accepted', !man.accepted.some((r: any) => r.evidenceMode === 'ANNOTATION_ONLY'));
}

console.log(`\n=== TOTAL: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
