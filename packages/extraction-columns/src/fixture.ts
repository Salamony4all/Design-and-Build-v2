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

export interface StructuralEnvelope {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Axis-aligned envelope of the vectors already claimed by the trusted WALL
 * pipeline, in drawing units.
 *
 * This is derived purely from the immutable fixture's own claim table — it is
 * not an oracle, not an audit artifact and not an expected count. Structurally
 * it answers one architectural question: "where is the building?". Geometry
 * outside the wall envelope is titleblock, legend, north arrow, revision table
 * or dimension furniture, and can never be a structural column.
 */
export function loadStructuralEnvelope(): StructuralEnvelope | undefined {
  const f = loadFixture();
  const wallIds = new Set(f.claimed.filter((c) => c.kind === 'wall').flatMap((c) => c.sourceIds));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = 0;
  for (const l of f.lines) {
    if (!wallIds.has(l.id)) continue;
    for (const p of [l.a, l.b] as Array<{ x: number; y: number }>) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    seen++;
  }
  if (!seen) return undefined;
  return { minX, minY, maxX, maxY };
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
