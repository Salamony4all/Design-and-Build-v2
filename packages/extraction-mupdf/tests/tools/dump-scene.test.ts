// One-off TOOL: dumps accepted walls, windows and doors for CODE_06 so they can be
// overlaid on the page render and audited by eye. Skipped unless DUMP_DOORS=1.
import { it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  extractPureWallResult,
  collectPageVectors,
  runDoorPipeline,
  runWindowPipeline,
  PURE_DOOR_DEFAULTS,
  PURE_WINDOW_DEFAULTS,
} from '../../src/index';

const ROOT = process.cwd();
const PDF = join(ROOT, '..', '..', 'test drawings and png', process.env.DUMP_PDF ?? 'CODE_06 1 page.pdf');
const OUT = join(ROOT, 'tests', 'fixtures', 'code06-doors');

it.skipIf(process.env.DUMP_DOORS !== '1')('dump scene', async () => {
  const mupdf = await import('mupdf');
  const bytes = new Uint8Array(readFileSync(PDF));
  const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf');
  const page = (doc as any).loadPage(0);
  const cap = collectPageVectors(page, false, 0);
  const wr = extractPureWallResult(bytes, 0, undefined, undefined, true) as any;
  const pure = wr.pureResult;
  const base = { vectors: cap.vectors, wallResult: pure, pageBoundsMupdf: page.getBounds() } as any;
  const win = runWindowPipeline(base, PURE_WINDOW_DEFAULTS, false) as any;
  const door = runDoorPipeline(base, PURE_DOOR_DEFAULTS, false) as any;
  const iv = (a: any) => ({ wall: a.selectedPhysicalWallId, from: a.wallLocalInterval?.from, to: a.wallLocalInterval?.to });
  const out = {
    scaleMmPerPt: pure.scaleMmPerPt,
    walls: pure.accepted.map((w: any) => ({ id: w.physicalWallId, a: w.centerline.a, b: w.centerline.b, t: w.thickness })),
    wallReview: (pure.review ?? []).length,
    wallRejected: (pure.rejected ?? []).length,
    windows: (win.accepted ?? []).map((a: any) => ({ id: a.openingRegionId, ...iv(a) })),
    windowReview: (win.review ?? []).map((a: any) => ({ id: a.openingRegionId, ...iv(a) })),
    doors: (door.accepted ?? []).map((a: any) => ({ id: a.doorAssemblyId, ...iv(a), hingeSide: a.hingeSide, swing: a.swingDirection })),
  };
  // columns: same flattening + claimed-source registry as the API route
  const { extractColumnsFromCapturedGeometry } = await import('../../src/index');
  const lines: any[] = [];
  const cubics: any[] = [];
  for (const v of cap.vectors as any[]) {
    const op = v.id;
    (v.subpaths ?? []).forEach((sp: any[], si: number) => {
      if (sp.length >= 2) lines.push({ id: `${op}:s${si}`, a: sp[0], b: sp[sp.length - 1], sourceOperationId: op });
    });
    let cur: any;
    let cidx = 0;
    for (const c of (v.commands ?? []) as any[]) {
      if (c.op === 'M') cur = c.p0 ?? c.p1;
      else if (c.op === 'L') cur = c.p1;
      else if (c.op === 'C') {
        cubics.push({ id: `${op}:c${cidx}`, p0: cur ?? c.p0 ?? c.p1, p1: c.p1, p2: c.p2, p3: c.p3, sourceOperationId: op });
        cur = c.p3;
        cidx++;
      }
    }
    const pts = v.points ?? [];
    for (let i = 0; i + 1 < pts.length; i++) {
      lines.push({ id: `${op}:L${i}`, a: pts[i], b: pts[i + 1], sourceOperationId: op });
      lines.push({ id: `${op}:seg:${i}`, a: pts[i], b: pts[i + 1], sourceOperationId: op });
    }
  }
  const claimedIds = [
    ...pure.accepted.flatMap((w: any) => w.sourceSubpathIds ?? []),
    ...(win.accepted ?? []).flatMap((w: any) => w.sourceSegmentIds ?? []),
    ...(door.accepted ?? []).flatMap((d: any) => [...(d.leafSegmentIds ?? []), ...(d.swingSegmentIds ?? [])]),
  ];
  let columns: any[] = [];
  try {
    columns = extractColumnsFromCapturedGeometry({ lines, cubics, claimedSourceIds: claimedIds, scaleMmPerPt: pure.scaleMmPerPt, sourceHash: 'dump' } as any) as any[];
  } catch (e) {
    console.log('column extraction failed:', String(e));
  }
  (out as any).columns = columns;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  (out as any).fills = (cap.vectors as any[])
    .filter((v) => v.operation === 'fill-path' && !(v.color ?? []).every((c: number) => c > 0.97))
    .map((v) => ({
      id: v.id, root: v.sourceRootId, color: (v.color ?? []).map((c: number) => Math.round(c * 100) / 100), alpha: v.alpha,
      cmds: (v.commands ?? []).map((c: any) => c.op).join('').slice(0, 24),
      sub: (v.subpaths ?? []).length,
      pts: (v.points ?? []).slice(0, 8).map((p: any) => [r1(p.x), r1(p.y)]),
      n: (v.points ?? []).length,
    }));
  console.log('columns', columns.length);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, '_scene-dump.json'), JSON.stringify(out));
  console.log('walls', out.walls.length, 'windows', out.windows.length, 'windowReview', out.windowReview.length, 'doors', out.doors.length);
}, 600000);
