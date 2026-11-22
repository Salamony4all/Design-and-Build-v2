// Regression check for windows found by the general wall detector on real drawings of
// different scales and drafting styles: hatched walls with sash windows drawn as bands
// of their own (1:100), filled walls with a double glass line (1:100), heavy faces broken
// at the window with lighter frame and glass lines (1/4" and 1/8" US plans). Every window
// listed was checked on an overlay of the page. The PDFs are third-party samples kept out
// of git ("test drawings and png/fresh-windows"); the test is skipped where they are absent.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { collectPageVectors, extractPureWallResult, runWindowPipeline, PURE_WINDOW_DEFAULTS } from '../src/index';

const DIR = join(process.cwd(), '..', '..', 'test drawings and png', 'fresh-windows');

async function windowCentres(file: string, page: number) {
  const mupdf = await import('mupdf');
  const bytes = new Uint8Array(readFileSync(join(DIR, file)));
  const pure = (extractPureWallResult(bytes, page, undefined, undefined, true) as any).pureResult;
  const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf') as any;
  const pg = doc.loadPage(page);
  const cap = collectPageVectors(pg, false, page);
  const res = runWindowPipeline({ vectors: cap.vectors, wallResult: pure, pageBoundsMupdf: pg.getBounds() } as any, PURE_WINDOW_DEFAULTS, false) as any;
  const walls = new Map<string, any>(pure.accepted.map((w: any) => [w.physicalWallId, w]));
  const centres = res.accepted.map((r: any) => {
    const w = walls.get(r.selectedPhysicalWallId);
    const { a, b } = w.centerline;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const m = (r.wallLocalInterval.from + r.wallLocalInterval.to) / 2;
    return { x: a.x + ((b.x - a.x) * m) / L, y: a.y + ((b.y - a.y) * m) / L };
  });
  return { engine: pure.wallEngine, centres };
}

const has = (centres: Array<{ x: number; y: number }>, [x, y]: number[]) => centres.some((c) => Math.hypot(c.x - x!, c.y - y!) <= 3);

describe('windows found by the general wall detector', () => {
  it.skipIf(!existsSync(join(DIR, 'uk-reith-house-1to100.pdf')))('Reith house 1:100: all 9 windows, nothing else', async () => {
    const { engine, centres } = await windowCentres('uk-reith-house-1to100.pdf', 0);
    expect(engine).toBe('general');
    const truth = [[311.6, 404.8], [392.9, 468.4], [481.2, 245.7], [500.5, 468.4], [636.2, 468.4], [738.5, 468.4], [767.8, 245.7], [818.4, 293.9], [818.4, 393.2]];
    for (const p of truth) expect(has(centres, p), `${p}`).toBe(true);
    expect(centres).toHaveLength(truth.length);
  }, 120000);

  it.skipIf(!existsSync(join(DIR, 'us-nist-house-1-4in.pdf')))('NIST house 1/4": the 8 windows of the floor plan', async () => {
    const { engine, centres } = await windowCentres('us-nist-house-1-4in.pdf', 1);
    expect(engine).toBe('general');
    const truth = [[294.5, 376.8], [294.5, 603.7], [391.9, 245.4], [423.3, 695.4], [692.2, 695.4], [765.2, 245.4], [1053.3, 695.4], [1062.5, 245.4]];
    for (const p of truth) expect(has(centres, p), `${p}`).toBe(true);
    // one more is read in the enlarged partial plan on the same sheet
    expect(centres.length).toBeLessThanOrEqual(truth.length + 1);
  }, 120000);

  it.skipIf(!existsSync(join(DIR, 'uk-gov-a011-1to100.pdf')))('filled-wall flats 1:100: windows where the fill stops', async () => {
    const { centres } = await windowCentres('uk-gov-a011-1to100.pdf', 0);
    for (const p of [[452.0, 382.6], [452.0, 467.7], [495.9, 200.4]]) expect(has(centres, p), `${p}`).toBe(true);
    expect(centres.length).toBeLessThanOrEqual(4);
  }, 120000);

  it.skipIf(!existsSync(join(DIR, 'us-nist-multifamily-1-8in.pdf')))('NIST multifamily 1/8": about 20 windows per floor plan', async () => {
    const { centres } = await windowCentres('us-nist-multifamily-1-8in.pdf', 4);
    for (const p of [[379.3, 325.3], [437.4, 264.8], [875.1, 857.0], [1259.3, 1761.3], [983.5, 1232.5]]) expect(has(centres, p), `${p}`).toBe(true);
    expect(centres.length).toBeGreaterThanOrEqual(37);
    expect(centres.length).toBeLessThanOrEqual(41);
  }, 120000);
});
