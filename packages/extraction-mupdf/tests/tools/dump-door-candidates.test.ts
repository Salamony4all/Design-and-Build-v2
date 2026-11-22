// One-off TOOL (not a regression test). Dumps what the door pipeline produces on
// CODE_06 plus a page render, so a human/agent can build the door answer key.
// Skipped unless DUMP_DOORS=1.  Run:
//   set DUMP_DOORS=1 && vitest run tests/tools/dump-door-candidates.test.ts
import { it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  extractPureWallResult,
  collectPageVectors,
  runDoorPipeline,
  PURE_DOOR_DEFAULTS,
} from '../../src/index';
import { extractDoorPrimitives } from '../../src/mupdf-pure-doors';
import { captureDoorAnnotations, DEFAULT_ANNOTATION_OPTIONS } from 'design-build-extraction-annotations';

const ROOT = process.cwd();
const PDF = join(ROOT, '..', '..', 'test drawings and png', 'CODE_06 1 page.pdf');
const OUT = join(ROOT, 'tests', 'fixtures', 'code06-doors');

it.skipIf(process.env.DUMP_DOORS !== '1')('dump door candidates', async () => {
  const mupdf = await import('mupdf');
  const bytes = new Uint8Array(readFileSync(PDF));
  const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf');
  const page = (doc as any).loadPage(0);
  const cap = collectPageVectors(page, false, 0);
  const wr = extractPureWallResult(bytes, 0, undefined, undefined, true) as any;
  const ann = captureDoorAnnotations(page, DEFAULT_ANNOTATION_OPTIONS, undefined, 0);
  const prim = extractDoorPrimitives(cap.vectors, wr.pureResult.accepted, wr.pureResult.scaleMmPerPt, PURE_DOOR_DEFAULTS);
  const leafById = new Map(prim.leaves.map((l: any) => [l.id, l]));
  const swingById = new Map(prim.swings.map((l: any) => [l.id, l]));

  const run = (useAnn: boolean) =>
    runDoorPipeline(
      {
        vectors: cap.vectors,
        wallResult: wr.pureResult,
        pageBoundsMupdf: [0, 0, 1, 1],
        ...(useAnn ? { annotations: ann.annotations, annotationIndex: ann.index, annotationCaptureMs: 0 } : {}),
      } as any,
      useAnn
        ? PURE_DOOR_DEFAULTS
        : { ...PURE_DOOR_DEFAULTS, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false },
      false,
    ) as any;

  const slim = (a: any) => ({
    id: a.doorAssemblyId,
    type: a.doorType,
    verdict: a.verdict,
    evidenceMode: a.evidenceMode,
    hostStatus: a.hostStatus,
    wall: a.selectedPhysicalWallId,
    interval: a.wallLocalInterval,
    widthMm: a.widthMm,
    hinge: a.hinge,
    swingDirection: a.swingDirection,
    annotation: a.assistedByAnnotationId,
    leaves: a.leafSegmentIds.map((id: string) => leafById.get(id)).filter(Boolean).map((l: any) => ({ a: l.a, b: l.b })),
    swings: a.swingSegmentIds.map((id: string) => swingById.get(id)).filter(Boolean).map((l: any) => ({ a: l.a, b: l.b, control: l.control, kind: l.kind })),
    negativeEvidence: a.negativeEvidence,
  });

  const geo = run(false);
  const hyb = run(true);
  const pb = page.getBounds();
  const out = {
    pdf: 'CODE_06 1 page.pdf',
    pageBounds: pb,
    scaleMmPerPt: wr.pureResult.scaleMmPerPt,
    walls: wr.pureResult.accepted.map((w: any) => ({ id: w.physicalWallId, a: w.centerline.a, b: w.centerline.b, thicknessPt: w.thicknessPt ?? w.thickness })),
    annotations: ann.annotations.map((x: any) => ({ id: x.id, text: x.text, centre: x.centre ?? x.center ?? x.bounds })),
    geometryOnly: { accepted: geo.accepted.map(slim), reviewCount: geo.review.length, rejectedCount: geo.rejected.length },
    hybrid: { accepted: hyb.accepted.map(slim), review: hyb.review.map(slim), rejectedCount: hyb.rejected.length },
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, '_pipeline-dump.json'), JSON.stringify(out));
  const pix = page.toPixmap(mupdf.Matrix.scale(3, 3), mupdf.ColorSpace.DeviceRGB, false, true);
  writeFileSync(join(OUT, '_page.png'), pix.asPNG());
}, 600000);
