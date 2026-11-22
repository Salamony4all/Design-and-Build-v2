// TOOL: runs the whole deterministic pipeline on every PDF in
// "test drawings and png/fresh" and dumps results + a page render for a visual audit.
// Skipped unless FRESH=1. Optional FRESH_PAGES="name.pdf=3,other.pdf=0" to pick pages.
import { it } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  extractPureWallResult,
  collectPageVectors,
  runDoorPipeline,
  runWindowPipeline,
  extractColumnsFromCapturedGeometry,
  PURE_DOOR_DEFAULTS,
  PURE_WINDOW_DEFAULTS,
} from '../../src/index';

const ROOT = process.cwd();
// FRESH_DIR picks another folder under "test drawings and png" (default "fresh")
const DIR = join(ROOT, '..', '..', 'test drawings and png', process.env.FRESH_DIR ?? 'fresh');
const OUT = join(ROOT, 'tests', 'fixtures', '_fresh');

it.skipIf(process.env.FRESH !== '1')('fresh drawings', async () => {
  const mupdf = await import('mupdf');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, '.gitignore'), '*\n');
  const pick: Record<string, number> = {};
  for (const kv of (process.env.FRESH_PAGES ?? '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    pick[k!] = Number(v);
  }
  const only = process.env.FRESH_ONLY;
  const summary: any[] = [];
  for (const name of readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.pdf')).sort()) {
    if (only && name !== only) continue;
    const row: any = { name };
    try {
      const bytes = new Uint8Array(readFileSync(join(DIR, name)));
      const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf') as any;
      const pages = doc.countPages();
      row.pages = pages;
      let pageNo = pick[name];
      if (pageNo === undefined) {
        // auto: among the first 40 pages, the one titled like a floor plan with most text hits
        let best = -1;
        let bestScore = -1;
        const hints: string[] = [];
        for (let i = 0; i < Math.min(pages, 40); i++) {
          const text = String(doc.loadPage(i).toStructuredText('preserve-whitespace').asText() ?? '');
          const m = text.match(/(GROUND|FIRST|1ST|LEVEL 1)?\s*FLOOR\s*PLAN|GA PLAN|GENERAL ARRANGEMENT/gi) ?? [];
          const bad = /CEILING|ROOF PLAN|DEMOLITION|ELECTRICAL|FRAMING|SLAB/i.test(text) ? 0.5 : 1;
          const score = m.length * bad;
          hints.push(`${i}:${m.length}`);
          if (score > bestScore) { bestScore = score; best = i; }
        }
        row.pageHints = hints.join(' ');
        pageNo = Math.max(0, best);
      }
      row.page = pageNo;
      const page = doc.loadPage(pageNo);
      const pb = page.getBounds();
      row.pageSizePt = [Math.round(pb[2] - pb[0]), Math.round(pb[3] - pb[1])];
      const t0 = Date.now();
      const cap = collectPageVectors(page, false, pageNo);
      row.vectors = cap.vectors.length;
      const scene: any = { name, page: pageNo, pageBounds: pb };
      let pure: any;
      try {
        pure = (extractPureWallResult(bytes, pageNo, undefined, undefined, true) as any).pureResult;
        row.scaleMmPerPt = pure.scaleMmPerPt;
        row.walls = pure.accepted.length;
        row.wallReview = (pure.review ?? []).length;
        row.wallEngine = pure.wallEngine;
        row.wallEngineNote = pure.wallEngineNote;
        scene.scaleMmPerPt = pure.scaleMmPerPt;
        scene.walls = pure.accepted.map((w: any) => ({ id: w.physicalWallId, a: w.centerline.a, b: w.centerline.b, t: w.thickness }));
      } catch (e) {
        row.wallError = String(e).slice(0, 200);
      }
      if (pure) {
        const base = { vectors: cap.vectors, wallResult: pure, pageBoundsMupdf: pb } as any;
        const iv = (a: any) => ({ wall: a.selectedPhysicalWallId, from: a.wallLocalInterval?.from, to: a.wallLocalInterval?.to });
        try {
          const win = runWindowPipeline(base, PURE_WINDOW_DEFAULTS, false) as any;
          row.windows = (win.accepted ?? []).length;
          row.windowReview = (win.review ?? []).length;
          scene.windows = (win.accepted ?? []).map(iv);
        } catch (e) { row.windowError = String(e).slice(0, 200); }
        try {
          const door = runDoorPipeline(base, PURE_DOOR_DEFAULTS, false) as any;
          row.doors = (door.accepted ?? []).length;
          row.doorReview = (door.review ?? []).length;
          row.doorSymbolsNoWall = (door.rejected ?? []).length;
          row.doorPath = (door.accepted ?? []).some((a: any) => a.closedJamb) ? 'symbol' : 'legacy-fallback';
          scene.doors = (door.accepted ?? []).map((a: any) => ({ ...iv(a), type: a.doorType, hingeSide: a.hingeSide, swing: a.swingDirection, hinge: a.hinge, closed: a.closedJamb }));
          scene.doorSymbolsNoWall = (door.rejected ?? []).filter((a: any) => a.hinge).map((a: any) => ({ hinge: a.hinge, closed: a.closedJamb }));
        } catch (e) { row.doorError = String(e).slice(0, 200); }
        try {
          const cols = extractColumnsFromCapturedGeometry({ lines: [], cubics: [], claimedSourceIds: [], scaleMmPerPt: pure.scaleMmPerPt, sourceHash: 'fresh', vectors: cap.vectors, walls: pure.accepted } as any) as any[];
          row.columns = cols.length;
          scene.columns = cols.map((c) => ({ c: c.centreProjectM, w: c.widthM, d: c.depthM, r: c.rotationRad }));
        } catch (e) { row.columnError = String(e).slice(0, 200); }
      }
      // Diagnostic: door symbols found when the TRUE scale is supplied by hand
      // (FRESH_SCALE="name.pdf=17.64"), independent of scale inference and walls.
      const trueScale = Number(((process.env.FRESH_SCALE ?? '').split(',').find((kv) => kv.startsWith(`${name}=`)) ?? '').split('=')[1]);
      if (trueScale > 0) {
        const { collectSegments, detectDoorSymbols } = await import('../../src/door-symbols');
        const syms = detectDoorSymbols(collectSegments(cap.vectors as any), trueScale, { minLeafMm: 500, maxLeafMm: 1500, hostCorridorPadPt: 18 });
        row.trueScaleMmPerPt = trueScale;
        row.doorSymbolsAtTrueScale = syms.length;
        scene.symbolsTrue = syms.map((s) => ({ hinge: s.hinge, closed: s.closed, free: s.free }));
      }
      row.ms = Date.now() - t0;
      const longest = Math.max(pb[2] - pb[0], pb[3] - pb[1]);
      const s = Math.min(4, 5000 / longest);
      scene.renderScale = s;
      const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false, true);
      const stem = name.replace(/\.pdf$/i, '');
      writeFileSync(join(OUT, `${stem}.png`), pix.asPNG());
      writeFileSync(join(OUT, `${stem}.json`), JSON.stringify(scene));
    } catch (e) {
      row.error = String(e).slice(0, 300);
    }
    summary.push(row);
    console.log('FRESH', JSON.stringify(row));
  }
  writeFileSync(join(OUT, '_summary.json'), JSON.stringify(summary, null, 1));
}, 1800000);
