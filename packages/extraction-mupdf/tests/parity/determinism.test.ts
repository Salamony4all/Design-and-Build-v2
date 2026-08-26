// packages/extraction-mupdf/tests/parity/determinism.test.ts
// Determinism: run live extraction twice → identical accepted geometry + hash.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractPureWallResult } from '../../src/mupdf-pure';
import { canonicalAcceptedGeometryHash } from '../../src/index';

const ROOT = path.resolve(__dirname, '../../../../');
const PDF = path.join(ROOT, 'test drawings and png/CODE_06.pdf');

function accepted() {
  const data = new Uint8Array(fs.readFileSync(PDF));
  const r = extractPureWallResult(data, 0);
  return { accepted: r.accepted, hash: canonicalAcceptedGeometryHash(r.accepted) };
}

describe('determinism (CODE_06)', () => {
  const a = accepted();
  const b = accepted();
  it('identical accepted geometry hash across runs', () => {
    expect(a.hash).toBe(b.hash);
    expect(a.accepted.length).toBe(b.accepted.length);
  });
  it('identical ROI + scale across runs', () => {
    const r1 = extractPureWallResult(new Uint8Array(fs.readFileSync(PDF)), 0);
    const r2 = extractPureWallResult(new Uint8Array(fs.readFileSync(PDF)), 0);
    expect(r1.activeBuildingRegionMupdf.map((n) => Math.round(n))).toEqual(r2.activeBuildingRegionMupdf.map((n) => Math.round(n)));
    expect(r1.scaleMmPerPt).toBe(r2.scaleMmPerPt);
  });
});
