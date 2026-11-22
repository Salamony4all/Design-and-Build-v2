// The CODE_06 windows (24 of 24, matched to the WA-tagged openings by visual audit) are
// frozen here so later work on walls or windows cannot change them unnoticed.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractPureWallResult, collectPageVectors, runWindowPipeline, PURE_WINDOW_DEFAULTS } from '../src/index';

const ROOT = process.cwd();
const PDF = join(ROOT, '..', '..', 'test drawings and png', 'CODE_06 1 page.pdf');
const GOLDEN = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'code06-windows', 'window-golden.json'), 'utf8'));

describe('CODE_06 windows', () => {
  it('stay the 24 verified windows on the legacy walls', async () => {
    const mupdf = await import('mupdf');
    const bytes = new Uint8Array(readFileSync(PDF));
    const wr = (extractPureWallResult(bytes, 0, undefined, undefined, true) as any).pureResult;
    expect(wr.wallEngine).toBe('legacy');
    const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf') as any;
    const page = doc.loadPage(0);
    const cap = collectPageVectors(page, false, 0);
    const res = runWindowPipeline({ vectors: cap.vectors, wallResult: wr, pageBoundsMupdf: page.getBounds() } as any, PURE_WINDOW_DEFAULTS, false) as any;
    const got = res.accepted.map((r: any) => ({ wall: r.selectedPhysicalWallId, from: r.wallLocalInterval.from, to: r.wallLocalInterval.to }));
    expect(got).toHaveLength(GOLDEN.windows.length);
    for (const g of GOLDEN.windows) {
      const hit = got.find((w: any) => w.wall === g.wall && Math.abs(w.from - g.from) <= 0.05 && Math.abs(w.to - g.to) <= 0.05);
      expect(hit, `${g.wall} ${g.from}-${g.to}`).toBeDefined();
    }
  }, 120000);
});
