// Scores column extraction against the hand-checked CODE_06 answer key
// (tests/fixtures/code06-columns/column-answer-key.json).
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  extractPureWallResult,
  collectPageVectors,
  extractColumnsFromCapturedGeometry,
} from '../src/index';

const ROOT = process.cwd();
const PDF = join(ROOT, '..', '..', 'test drawings and png', 'CODE_06 1 page.pdf');
const KEY = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'code06-columns', 'column-answer-key.json'), 'utf8'));

/** Same line flattening the API route feeds to the legacy outline extractor. */
function flatten(vectors: any[]) {
  const lines: any[] = [];
  for (const v of vectors) {
    (v.subpaths ?? []).forEach((sp: any[], si: number) => {
      if (sp.length >= 2) lines.push({ id: `${v.id}:s${si}`, a: sp[0], b: sp[sp.length - 1], sourceOperationId: v.id });
    });
    const pts = v.points ?? [];
    for (let i = 0; i + 1 < pts.length; i++) {
      lines.push({ id: `${v.id}:L${i}`, a: pts[i], b: pts[i + 1], sourceOperationId: v.id });
      lines.push({ id: `${v.id}:seg:${i}`, a: pts[i], b: pts[i + 1], sourceOperationId: v.id });
    }
  }
  return lines;
}

function score(cols: any[], scale: number) {
  const ptPerM = 1000 / scale;
  const used = new Set<number>();
  let matched = 0;
  let sizeOk = 0;
  for (const k of KEY.columns) {
    const i = cols.findIndex(
      (c, ci) => !used.has(ci) && Math.hypot(c.centreProjectM.x * ptPerM - k.centre[0], c.centreProjectM.y * ptPerM - k.centre[1]) <= 2,
    );
    if (i < 0) continue;
    used.add(i);
    matched++;
    const c = cols[i];
    if (Math.abs(c.widthM * 1000 - k.xMm) <= 10 && Math.abs(c.depthM * 1000 - k.yMm) <= 10 && c.rotationRad === 0) sizeOk++;
  }
  return { reported: cols.length, matched, sizeOk, falsePositives: cols.length - matched };
}

let primary: ReturnType<typeof score>;
let legacyWithWalls: ReturnType<typeof score>;
let legacyNoWalls: ReturnType<typeof score>;

beforeAll(async () => {
  const bytes = new Uint8Array(readFileSync(PDF));
  const doc = (await import('mupdf')).Document.openDocument(bytes as any, 'application/pdf');
  const cap = collectPageVectors((doc as any).loadPage(0), false, 0);
  const pure = (extractPureWallResult(bytes, 0, undefined, undefined, true) as any).pureResult;
  const scale = pure.scaleMmPerPt;
  const base = { lines: flatten(cap.vectors as any[]), cubics: [], claimedSourceIds: [], scaleMmPerPt: scale, sourceHash: 'test' };
  primary = score(extractColumnsFromCapturedGeometry({ ...base, vectors: cap.vectors, walls: pure.accepted } as any), scale);
  legacyWithWalls = score(extractColumnsFromCapturedGeometry({ ...base, walls: pure.accepted } as any), scale);
  legacyNoWalls = score(extractColumnsFromCapturedGeometry(base as any), scale);
  console.log('columns (filled):', JSON.stringify(primary));
  console.log('columns (legacy + wall filter):', JSON.stringify(legacyWithWalls));
  console.log('columns (legacy, as before):', JSON.stringify(legacyNoWalls));
}, 300000);

describe('CODE_06 column answer key', () => {
  it('finds all 24 structural columns with the right size and nothing else', () => {
    expect(KEY.columns.length).toBe(24);
    expect(primary).toEqual({ reported: 24, matched: 24, sizeOk: 24, falsePositives: 0 });
  });

  it('never reports free-standing furniture squares as columns once walls are known', () => {
    expect(legacyWithWalls.falsePositives).toBe(0);
  });

  it('documents the old behaviour: tables and bedside units were reported as columns', () => {
    expect(legacyNoWalls.matched).toBe(0);
    expect(legacyNoWalls.falsePositives).toBeGreaterThan(20);
  });
});
