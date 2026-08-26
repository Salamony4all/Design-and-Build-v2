// IMMUTABLE shared captured-vector fixture loader.
// READ-ONLY. Specialists MUST NOT reopen the PDF or depend on expected counts.
import { readFileSync } from 'fs';
import { join } from 'path';

export interface CapturedGeometry {
  segments: any[];
  curves: any[];
  mmPerUnit: number;
  sourceHash: string;
}
export interface SecondaryFixture {
  meta: { source: string; scaleMmPerPt: number; sourceHash: string };
  scaleMmPerPt: number;
  sourceHash: string;
  lines: any[];
  cubics: any[];
  claimed: { kind: string; sourceIds: string[] }[];
}

const FIXTURE = join(
  process.cwd(), '..', 'extraction-mupdf', 'extraction-results', 'secondary-fixture.json',
);

export function loadFixture(): SecondaryFixture {
  return JSON.parse(readFileSync(FIXTURE, 'utf8'));
}

/** Build a CapturedGeometry, excluding any segment/curve claimed by walls/doors. */
export function loadUnclaimedGeometry(): CapturedGeometry {
  const f = loadFixture();
  const claimed = new Set(f.claimed.flatMap((c) => c.sourceIds));
  const segments = f.lines
    .filter((l) => !claimed.has(l.id))
    .map((l) => ({ id: l.id, a: l.a, b: l.b, sourceOperationId: l.sourceOperationId, claimedBy: undefined }));
  const curves = f.cubics
    .filter((c) => !claimed.has(c.id))
    .map((c) => ({ id: c.id, p0: c.p0, p1: c.p1, p2: c.p2, p3: c.p3, sourceOperationId: c.sourceOperationId, claimedBy: undefined }));
  return { segments, curves, mmPerUnit: f.scaleMmPerPt, sourceHash: f.sourceHash };
}
