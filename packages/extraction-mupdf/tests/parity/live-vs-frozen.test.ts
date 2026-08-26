// packages/extraction-mupdf/tests/parity/live-vs-frozen.test.ts
// Live-versus-frozen parity test (Change Set 2, §11).
// Runs the live clean extractor against CODE_06.pdf and compares to the
// archived golden result. No fake percentages, no fabricated numbers.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractPureWallResult } from '../../src/mupdf-pure';
import { canonicalAcceptedGeometryHash, canonicalAcceptedEvidenceHash, summarizePureResult } from '../../src/index';
import type { PurePhysicalWall } from '../../src/mupdf-pure';

const ROOT = path.resolve(__dirname, '../../../../');
const PDF = path.join(ROOT, 'test drawings and png/CODE_06.pdf');
const GOLDEN = path.join(ROOT, 'apps/design-build-editor/tests/fixtures/code06-pure-mupdf-golden.json');

const TOL_PT = 1.0; // PDF-point tolerance for endpoint comparison (≈0.35mm)

function near(a: number, b: number, t = TOL_PT) { return Math.abs(a - b) <= t; }

function runLive(): PurePhysicalWall[] {
  const data = new Uint8Array(fs.readFileSync(PDF));
  const r = extractPureWallResult(data, 0);
  return r.accepted;
}

function loadGolden(): any {
  return JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
}

describe('live-vs-frozen parity (CODE_06)', () => {
  const live = runLive();
  const golden = loadGolden();

  it('frozen accepted count = 70', () => {
    expect(golden.acceptedWallCount).toBe(70);
  });

  it('live accepted count = 70', () => {
    expect(live.length).toBe(70);
  });

  it('genuinely floating accepted = 0 (live)', () => {
    // recompute from raw result to avoid relying on summary field
    const r = extractPureWallResult(new Uint8Array(fs.readFileSync(PDF)), 0);
    expect(r.genuinelyFloatingAcceptedPhysicalWalls.length).toBe(0);
  });

  it('no missing / unexpected walls by physicalWallId', () => {
    const gIds = new Set(golden.accepted.map((w: any) => w.physicalWallId));
    const lIds = new Map(live.map((w) => [w.physicalWallId, w]));
    const missing = [...gIds].filter((id) => !lIds.has(id));
    const unexpected = [...lIds.keys()].filter((id) => !gIds.has(id));
    expect(missing).toEqual([]);
    expect(unexpected).toEqual([]);
  });

  it('geometry matches within tolerance per physical wall', () => {
    const gById = new Map(golden.accepted.map((w: any) => [w.physicalWallId, w]));
    expect(live.length).toBe(gById.size);
    for (const w of live) {
      const g = gById.get(w.physicalWallId);
      expect(g).toBeDefined();
      expect(near(w.centerline.a.x, g.a.x) && near(w.centerline.a.y, g.a.y)).toBe(true);
      expect(near(w.centerline.b.x, g.b.x) && near(w.centerline.b.y, g.b.y)).toBe(true);
      expect(near(w.thickness, g.thickness, 0.5)).toBe(true);
      expect(near(w.confidence, g.confidence, 0.001)).toBe(true);
    }
  });

  it('canonical accepted-geometry hash matches golden (documented canonical form)', () => {
    const liveHash = canonicalAcceptedGeometryHash(live);
    expect(liveHash).toBe(golden.canonicalAcceptedGeometryHash);
    // The original non-canonical capture hash must be preserved in the golden.
    expect(golden.originalCaptureAcceptedGeometryHash).toBe('b29614f60d1d1bf4');
  });

  it('canonical evidence hash matches golden AND differs from geometry hash', () => {
    const geo = canonicalAcceptedGeometryHash(live);
    const ev = canonicalAcceptedEvidenceHash(live);
    expect(ev).toBe(golden.canonicalAcceptedEvidenceHash);
    // The two hashes must come from distinct canonical inputs, not a copy.
    expect(ev).not.toBe(geo);
  });

  it('ROI + scale identical', () => {
    const r = extractPureWallResult(new Uint8Array(fs.readFileSync(PDF)), 0);
    const s = summarizePureResult(r);
    expect(s.buildingRoi.map((n) => Math.round(n))).toEqual(golden.activeBuildingRegionMupdf.map((n: number) => Math.round(n)));
    expect(near(s.scaleMmPerPt, golden.scaleMmPerPt, 0.001)).toBe(true);
    expect(s.candidateHash).toBe(golden.candidateHash);
  });
});
