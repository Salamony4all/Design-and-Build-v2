// Scores the production door pipeline against the hand-verified CODE_06 answer key
// (tests/fixtures/code06-doors/door-answer-key.json).
// Every door must be on the right wall, in the right place, with the right width,
// hinge end and swing side - with and without text labels.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractPureWallResult, collectPageVectors, runDoorPipeline, PURE_DOOR_DEFAULTS } from '../src/index';
import { captureDoorAnnotations, DEFAULT_ANNOTATION_OPTIONS } from 'design-build-extraction-annotations';
import { scoreDoors, type KeyDoor } from './helpers/door-scoring';

const ROOT = process.cwd();
const PDF = join(ROOT, '..', '..', 'test drawings and png', 'CODE_06 1 page.pdf');
const KEY = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'code06-doors', 'door-answer-key.json'), 'utf8'));

let hybrid: ReturnType<typeof scoreDoors>;
let geometryOnly: ReturnType<typeof scoreDoors>;
let legacy: ReturnType<typeof scoreDoors>;

beforeAll(async () => {
  const bytes = new Uint8Array(readFileSync(PDF));
  const doc = (await import('mupdf')).Document.openDocument(bytes as any, 'application/pdf');
  const page = (doc as any).loadPage(0);
  const cap = collectPageVectors(page, false, 0);
  const wr = extractPureWallResult(bytes, 0, undefined, undefined, true) as any;
  const ann = captureDoorAnnotations(page, DEFAULT_ANNOTATION_OPTIONS, undefined, 0);
  const base = { vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1] } as any;
  const scale = wr.pureResult.scaleMmPerPt;
  const walls = wr.pureResult.accepted;
  const h = runDoorPipeline(
    { ...base, annotations: ann.annotations, annotationIndex: ann.index, annotationCaptureMs: 0 },
    PURE_DOOR_DEFAULTS,
    false,
  ) as any;
  const g = runDoorPipeline(
    base,
    { ...PURE_DOOR_DEFAULTS, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false },
    false,
  ) as any;
  hybrid = scoreDoors(h.accepted, walls, KEY.doors as KeyDoor[], scale);
  geometryOnly = scoreDoors(g.accepted, walls, KEY.doors as KeyDoor[], scale);
  const l = runDoorPipeline(
    { ...base, annotations: ann.annotations, annotationIndex: ann.index, annotationCaptureMs: 0 },
    { ...PURE_DOOR_DEFAULTS, enableSymbolDetector: false },
    false,
  ) as any;
  legacy = scoreDoors(l.accepted, walls, KEY.doors as KeyDoor[], scale);
  console.log('door score (legacy):', JSON.stringify(legacy));
  console.log('door score (hybrid):', JSON.stringify(hybrid));
  console.log('door score (geometry-only):', JSON.stringify(geometryOnly));
}, 300000);

describe('CODE_06 door answer key', () => {
  it('key is self-consistent', () => {
    expect(KEY.doors.length).toBe(25);
    expect(KEY.doorCount).toBe(25);
    expect(new Set(KEY.doors.map((d: KeyDoor) => d.id)).size).toBe(25);
  });

  it('every door: right wall, right place, right width, right hinge, right swing side', () => {
    expect(hybrid.accepted).toBe(25);
    expect(hybrid.falsePositives).toBe(0);
    expect(hybrid.hostOk).toBe(25);
    expect(hybrid.placedOk).toBe(25);
    expect(hybrid.widthOk).toBe(25);
    expect(hybrid.hingeOk).toBe(25);
    expect(hybrid.swingOk).toBe(25);
  });

  it('labels are not needed: geometry-only scores the same', () => {
    expect(geometryOnly).toEqual(hybrid);
  });

  it('legacy leaf-projection path stays available as rollback', () => {
    expect(legacy.accepted).toBeGreaterThan(0);
    expect(legacy.placedOk).toBeLessThan(25);
  });
});
