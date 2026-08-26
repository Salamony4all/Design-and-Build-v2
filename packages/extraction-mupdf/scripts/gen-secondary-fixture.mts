// Regenerates packages/extraction-mupdf/extraction-results/secondary-fixture.json
// — the IMMUTABLE shared captured-vector fixture consumed by
// design-build-extraction-columns/src/fixture.ts and
// design-build-extraction-furniture/src/fixture.ts.
//
// Deterministic: same canonical PDF -> byte-stable geometry. Run from this dir:
//   npx tsx gen-secondary-fixture.mts
//
// We mirror the live mupdf route's single-pass open -> capture -> run pattern so
// the produced `lines`/`cubics`/`claimed` are internally consistent (the fixture
// loader derives the structural envelope purely from its own claim table).
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import mupdf from 'mupdf';
import {
  collectPageVectors,
  extractPureWallResult,
  runWindowPipeline,
  runDoorPipeline,
  PURE_WINDOW_DEFAULTS,
  PURE_DOOR_DEFAULTS,
  acceptedGeometryHash,
} from '../src/index.ts';

const PDF = join(process.cwd(), '..', '..', 'test drawings and png', 'CODE_06 1 page.pdf');
const OUT_DIR = join(process.cwd(), 'extraction-results');
const OUT = join(OUT_DIR, 'secondary-fixture.json');

type Vec2 = { x: number; y: number };

function main() {
  const bytes = new Uint8Array(readFileSync(PDF));
  const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf');
  const page = doc.loadPage(0);
  const captured = collectPageVectors(page, true, 0);

  const wallRaw = extractPureWallResult(bytes, 0, undefined, undefined, true) as any;
  const wallResult = wallRaw.pureResult;

  const pageBoundsMupdf: [number, number, number, number] = (() => {
    const b = page.getBounds() as unknown as number[];
    return [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0];
  })();

  const winResult = runWindowPipeline(
    { vectors: captured.vectors, wallResult, pageBoundsMupdf },
    PURE_WINDOW_DEFAULTS,
    false,
  ) as any;
  const doorResult = runDoorPipeline(
    { vectors: captured.vectors, wallResult, pageBoundsMupdf },
  ) as any;

  // --- lines: one entry per consecutive point pair in every MuVector (id scheme
  //     matches collectWindowSourceSegments: `${v.id}:seg:${i}`) ---
  const lines: any[] = [];
  const cubics: any[] = [];
  for (const v of captured.vectors) {
    const pts = (v.points ?? []) as Vec2[];
    for (let i = 0; i + 1 < pts.length; i++) {
      lines.push({
        id: `${v.id}:seg:${i}`,
        a: { x: pts[i]!.x, y: pts[i]!.y },
        b: { x: pts[i + 1]!.x, y: pts[i + 1]!.y },
        sourceOperationId: v.sourceRootId ?? v.id,
      });
    }
    // cubics: C commands carry control points p0..p3
    for (const cmd of v.commands ?? []) {
      if (cmd.op === 'C' && Array.isArray(cmd.points) && cmd.points.length >= 6) {
        const p = cmd.points as number[];
        cubics.push({
          id: `${v.id}:cubic:${cmd.index ?? cubics.length}`,
          p0: { x: p[0], y: p[1] },
          p1: { x: p[2], y: p[3] },
          p2: { x: p[4], y: p[5] },
          p3: { x: p[6], y: p[7] },
          sourceOperationId: v.sourceRootId ?? v.id,
        });
      }
    }
  }

  // Walls expose `sourceSubpathIds` (`v0:s0`); the fixture line id scheme is
  // `${v.id}:seg:${i}` (matches collectWindowSourceSegments). Map subpath ->
  // first-segment so wall claims intersect the line set for the envelope.
  const wallIds = (wallResult.accepted ?? []).flatMap((w: any) => {
    const ids: string[] = [];
    for (const s of w.sourceSubpathIds ?? w.sourceSegmentIds ?? []) {
      ids.push(String(s).replace(/:s(\d+)$/, ':seg:$1'));
    }
    return ids;
  });
  const claimed: { kind: string; sourceIds: string[] }[] = [
    { kind: 'wall', sourceIds: wallIds },
    {
      kind: 'window',
      sourceIds: (winResult.accepted ?? []).flatMap((w: any) => w.sourceSegmentIds ?? []),
    },
    {
      kind: 'door',
      sourceIds: (doorResult.accepted ?? []).flatMap(
        (d: any) => d.sourceSegmentIds ?? d.sourceOperationIds ?? [],
      ),
    },
  ];

  const scaleMmPerPt = wallResult.scaleMmPerPt;
  const sourceHash = acceptedGeometryHash(wallResult.accepted);

  const fixture = {
    meta: { source: 'CODE_06 1 page.pdf', scaleMmPerPt, sourceHash },
    scaleMmPerPt,
    sourceHash,
    lines,
    cubics,
    claimed,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(fixture, null, 2));
  console.log(
    `Wrote ${OUT}\n  lines=${lines.length} cubics=${cubics.length} ` +
      `walls=${claimed[0].sourceIds.length} windows=${claimed[1].sourceIds.length} ` +
      `doors=${claimed[2].sourceIds.length} scaleMmPerPt=${scaleMmPerPt} sourceHash=${sourceHash}`,
  );
}

main();
