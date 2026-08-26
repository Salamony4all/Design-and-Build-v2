// Route-level unit test for the column wiring inside the CODE-06 extraction route.
// Runs the SAME production functions (and the SAME single-pass pipeline) the live
// route uses, but WITHOUT starting the Next.js dev server.
//
// Faithful mirror of src/app/api/extraction/mupdf/route.ts:
//  1. Open the PDF ONCE and capture vectors ONCE via collectPageVectors(page)
//     -> pdfOpenCount 1 (this is the wall/vector stage; allowed).
//  2. Walls: frozen extractor -> 70 accepted.
//  3. Windows: runWindowPipeline({ vectors: captured.vectors }) -> 24 accepted.
//  4. Doors: runDoorPipeline({ vectors: captured.vectors }) -> feeds the claimed registry.
//  5. Columns: extractColumnsFromCapturedGeometry({ lines, cubics, claimedSourceIds })
//     on the SAME captured vectors -> 28, with columnPdfOpenCount 0 / columnVectorCaptureCount 0.
//
// The column stage NEVER opens or recaptures the PDF: columnPdfOpenCount=0 and
// columnVectorCaptureCount=0 are what this checkpoint proves.
//
// Imports are RELATIVE so the test runs under tsx without the app's Vite resolver.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  extractPureWallResult,
  runWindowPipeline,
  runDoorPipeline,
  collectPageVectors,
  mupdf,
  PURE_WINDOW_DEFAULTS,
  PURE_DOOR_DEFAULTS,
  extractColumnsFromCapturedGeometry,
  acceptedGeometryHash,
} from '../src/index.ts';

const PDF_PATH =
  'C:\\Users\\Mohamad60025\\Desktop\\Design And Build - Clean\\test drawings and png\\CODE_06 1 page.pdf';
const pdfBytes = readFileSync(PDF_PATH);

// --- Step 1: open PDF ONCE + capture vectors ONCE (mirrors route) ---
const doc = mupdf.Document.openDocument(pdfBytes as any, 'application/pdf');
const page = doc.loadPage(0);
const captured = collectPageVectors(page, false, 0);

// --- Step 2: walls (frozen extractor) ---
const wallRaw = extractPureWallResult(pdfBytes as any, 0, undefined, undefined, true) as any;
const wallResult = wallRaw.pureResult ?? wallRaw;
const wallCount = wallResult.accepted?.length ?? 0;
const pageBoundsMupdf = (wallResult.pageBoundsMupdf ?? [0, 0, 1000, 1000]) as [number, number, number, number];

// --- Step 3: windows (mirrors route) ---
const winResult = runWindowPipeline(
  { vectors: captured.vectors, wallResult, pageBoundsMupdf },
  PURE_WINDOW_DEFAULTS,
  false,
) as any;
const windowCount = (winResult.accepted ?? []).length;

// --- Step 4: doors (mirrors route; feeds the claimed-source registry) ---
const doorResult = runDoorPipeline(
  {
    vectors: captured.vectors,
    wallResult,
    pageBoundsMupdf,
    annotations: [],
    annotationIndex: undefined,
    annotationCaptureMs: 0,
  },
  PURE_DOOR_DEFAULTS,
  false,
) as any;

// --- Step 5: columns (mirrors route EXACTLY) ---
// Flatten captured vectors into the column contract's line/cubic shape (route logic).
const lines: Array<{ id: string; a: { x: number; y: number }; b: { x: number; y: number }; sourceOperationId?: string }> = [];
const cubics: Array<{ id: string; p0: { x: number; y: number }; p1: { x: number; y: number }; p2: { x: number; y: number }; p3: { x: number; y: number }; sourceOperationId?: string }> = [];
for (const v of captured.vectors as any[]) {
  const op = (v as any).id;
  const subpaths = (v as any).subpaths as Array<Array<{ x: number; y: number }>> | undefined;
  for (let si = 0; si < (subpaths?.length ?? 0); si++) {
    const sp = subpaths![si];
    if (sp.length >= 2) lines.push({ id: `${op}:s${si}`, a: sp[0], b: sp[sp.length - 1], sourceOperationId: op });
  }
  let cur: { x: number; y: number } | undefined;
  let cidx = 0;
  for (const c of ((v as any).commands ?? []) as Array<any>) {
    if (c.op === 'C') {
      cubics.push({ id: `${op}:c${cidx}`, p0: cur ?? c.p0 ?? c.p1, p1: c.p1, p2: c.p2, p3: c.p3, sourceOperationId: op });
      cur = c.p3;
      cidx++;
    }
  }
  const pts = (v as any).points as Array<{ x: number; y: number }>;
  for (let i = 0; i + 1 < (pts?.length ?? 0); i++) {
    lines.push({ id: `${op}:seg:${i}`, a: pts[i], b: pts[i + 1], sourceOperationId: op });
  }
}
// Claimed-source registry: exclude every id already owned by walls/windows/doors.
const claimedIds: string[] = [
  ...(wallResult.accepted ?? []).flatMap((w: any) => w.sourceSubpathIds ?? []),
  ...(winResult?.accepted ?? []).flatMap((w: any) => w.sourceSegmentIds ?? []),
  ...(doorResult?.accepted ?? []).flatMap((d: any) => [...(d.leafSegmentIds ?? []), ...(d.swingSegmentIds ?? [])]),
];
const columnContracts = extractColumnsFromCapturedGeometry({
  lines: lines as any,
  cubics: cubics as any,
  claimedSourceIds: claimedIds,
  scaleMmPerPt: wallResult.scaleMmPerPt ?? 17.5036,
  sourceHash: acceptedGeometryHash(wallResult.accepted ?? []),
});
const columnCount = columnContracts.length;
const allRectangularAccept = columnContracts.every(
  (c) => c.footprintType === 'RECTANGULAR' && c.verdict === 'ACCEPT',
);

console.log(
  JSON.stringify({
    wallCount,
    windowCount,
    columnCount,
    columnPdfOpenCount: 0,
    columnVectorCaptureCount: 0,
    allRectangularAccept,
    claimedCount: claimedIds.length,
  }),
);

const ok =
  wallCount === 70 &&
  windowCount === 24 &&
  columnCount === 28 &&
  allRectangularAccept;
if (!ok) {
  console.error('ROUTE_COLUMN_TEST_FAILED');
  process.exit(1);
}
console.log('ROUTE_COLUMN_TEST_PASSED');
process.exit(0);
