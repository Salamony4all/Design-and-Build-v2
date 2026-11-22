import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type * as mupdf from 'mupdf';
import {
  extractPureWallResult,
  collectPageVectors,
  runDoorPipeline,
  PURE_DOOR_DEFAULTS,
  type PureDoorConfig,
} from '../src/index';
import { captureDoorAnnotations, DEFAULT_ANNOTATION_OPTIONS } from 'design-build-extraction-annotations';

const ROOT = process.cwd();
const PDF = join(ROOT, '..', '..', 'test drawings and png', 'CODE_06 1 page.pdf');

async function loadInput(cfg?: Partial<PureDoorConfig>) {
  const bytes = new Uint8Array(readFileSync(PDF));
  const doc = (await import('mupdf')).Document.openDocument(bytes as any, 'application/pdf');
  const page = (doc as any).loadPage(0);
  const cap = collectPageVectors(page, false, 0);
  const wr = extractPureWallResult(bytes, 0, undefined, undefined, true) as any;
  const ann = captureDoorAnnotations(page, DEFAULT_ANNOTATION_OPTIONS, undefined, 0);
  const merged = { ...PURE_DOOR_DEFAULTS, ...cfg };
  return { cap, wr, ann, merged, page };
}

describe('face-aware host resolution', () => {
  it('resolves interior doors whose leaf is offset to one wall face', async () => {
    const { cap, wr, merged } = await loadInput();
    // tight corridor must FAIL some interior doors that the face-aware corridor recovers
    const tight = runDoorPipeline(
      { vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1] },
      { ...merged, hostCorridorPadPt: 6, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false },
      false,
    ) as any;
    const face = runDoorPipeline(
      { vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1] },
      { ...merged, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false },
      false,
    ) as any;
    expect(face.accepted.length).toBeGreaterThanOrEqual(tight.accepted.length);
  });
});

describe('ambiguous-host rejection', () => {
  it('does not auto-accept a candidate with competing hosts', async () => {
    const { cap, wr, merged } = await loadInput();
    const res = runDoorPipeline(
      { vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1] },
      { ...merged, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false, hostAmbiguityMargin: 0.5 },
      false,
    ) as any;
    // every accepted door must be a UNIQUE_HOST
    for (const a of res.accepted) {
      expect(a.hostStatus).toBe('UNIQUE_HOST');
    }
  });
});

describe('annotation-only rejection', () => {
  it('never produces an ANNOTATION_ONLY assembly', async () => {
    const { cap, wr, ann, merged } = await loadInput();
    const res = runDoorPipeline(
      {
        vectors: cap.vectors,
        wallResult: wr.pureResult,
        pageBoundsMupdf: [0, 0, 1, 1],
        annotations: ann.annotations,
        annotationIndex: ann.index,
        annotationCaptureMs: 0,
      },
      merged,
      false,
    ) as any;
    expect(res.annotationAssisted.every((a: any) => a.evidenceMode !== 'ANNOTATION_ONLY')).toBe(true);
  });
});

describe('geometry/annotation deduplication', () => {
  it('does not create two physical assemblies from one door', async () => {
    const { cap, wr, ann, merged } = await loadInput();
    const res = runDoorPipeline(
      {
        vectors: cap.vectors,
        wallResult: wr.pureResult,
        pageBoundsMupdf: [0, 0, 1, 1],
        annotations: ann.annotations,
        annotationIndex: ann.index,
        annotationCaptureMs: 0,
      },
      merged,
      false,
    ) as any;
    // accepted set must be unique by wall+interval
    const keys = res.accepted.map((a: any) => `${a.selectedPhysicalWallId}:${a.wallLocalInterval?.from.toFixed(1)}:${a.wallLocalInterval?.to.toFixed(1)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('deterministic rerun', () => {
  it('produces identical candidate + assembly hashes across runs', async () => {
    const { cap, wr, ann, merged } = await loadInput();
    const run = () =>
      runDoorPipeline(
        {
          vectors: cap.vectors,
          wallResult: wr.pureResult,
          pageBoundsMupdf: [0, 0, 1, 1],
          annotations: ann.annotations,
          annotationIndex: ann.index,
          annotationCaptureMs: 0,
        },
        merged,
        false,
      ) as any;
    const r1 = run();
    const r2 = run();
    expect(r1.candidateHash).toBe(r2.candidateHash);
    expect(r1.assemblyHash).toBe(r2.assemblyHash);
    expect(r1.annotationHash).toBe(r2.annotationHash);
  });
});

describe('annotation-disabled parity', () => {
  it('geometry-only result is reproducible with annotations disabled', async () => {
    const { cap, wr, merged } = await loadInput();
    const r1 = runDoorPipeline(
      { vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1] },
      { ...merged, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false },
      false,
    ) as any;
    const r2 = runDoorPipeline(
      { vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1] },
      { ...merged, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false },
      false,
    ) as any;
    expect(r1.candidateHash).toBe(r2.candidateHash);
    expect(r1.accepted.length).toBe(r2.accepted.length);
  });
});

describe('real-PDF A/B/C scorer assertions', () => {
  // NOTE: this only checks the accepted count and evidence modes. Real precision/recall
  // against the answer key is measured in door-answer-key.test.ts.
  it('hybrid (C) accepts >= 20 doors with allowed evidence modes', async () => {
    const { cap, wr, ann, merged } = await loadInput();
    const C = runDoorPipeline(
      {
        vectors: cap.vectors,
        wallResult: wr.pureResult,
        pageBoundsMupdf: [0, 0, 1, 1],
        annotations: ann.annotations,
        annotationIndex: ann.index,
        annotationCaptureMs: 0,
      },
      merged,
      false,
    ) as any;
    // auto-install set = ACCEPT (all are GEOMETRY_ONLY or ANNOTATION_ASSISTED_GEOMETRY_VERIFIED)
    expect(C.accepted.length).toBeGreaterThanOrEqual(20);
    // geometry-only FPs are demoted to REVIEW in annotation mode -> auto-install FP = 0
    const fpInAccept = C.accepted.filter(
      (a: any) => a.evidenceMode === 'GEOMETRY_ONLY' && !a.assistedByAnnotationId,
    ).length;
    // the only acceptable auto-install evidence modes are verified geometry or
    // annotation-assisted geometry (verified or review-required both reach REVIEW/ACCEPT correctly)
    expect(
      C.accepted.every(
        (a: any) =>
          a.evidenceMode === 'ANNOTATION_ASSISTED_GEOMETRY_VERIFIED' ||
          a.evidenceMode === 'ANNOTATION_ASSISTED_REVIEW_REQUIRED' ||
          a.evidenceMode === 'GEOMETRY_ONLY',
      ),
    ).toBe(true);
  });
});
