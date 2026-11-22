// Regression check for the general wall detector on real drawings drawn in styles the
// fill-based wall stages cannot read. The PDFs are third-party samples kept out of git
// ("test drawings and png/fresh"); the test is skipped where they are absent.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { collectPageVectors, extractPureWallResult, runDoorPipeline, PURE_DOOR_DEFAULTS } from '../src/index';

const DIR = join(process.cwd(), '..', '..', 'test drawings and png', 'fresh');

async function run(file: string, page: number) {
  const mupdf = await import('mupdf');
  const bytes = new Uint8Array(readFileSync(join(DIR, file)));
  const pure = (extractPureWallResult(bytes, page, undefined, undefined, true) as any).pureResult;
  const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf') as any;
  const pg = doc.loadPage(page);
  const cap = collectPageVectors(pg, false, page);
  const doors = runDoorPipeline({ vectors: cap.vectors, wallResult: pure, pageBoundsMupdf: pg.getBounds() } as any, PURE_DOOR_DEFAULTS, false) as any;
  return { pure, doors };
}

describe('general wall detector on fresh drawings', () => {
  it.skipIf(!existsSync(join(DIR, 'lanl-a1001-example.pdf')))('LANL hollow-wall plan: every door has a wall', async () => {
    const { pure, doors } = await run('lanl-a1001-example.pdf', 0);
    expect(pure.wallEngine).toBe('general');
    expect(pure.accepted.length).toBeGreaterThanOrEqual(200);
    expect(doors.accepted.length).toBeGreaterThanOrEqual(68);
    expect(doors.rejected.length).toBe(0);
  }, 120000);

  it.skipIf(!existsSync(join(DIR, 'nist-reference-building.pdf')))('NIST enlarged plans: only toilet-stall doors lack a wall', async () => {
    const { pure, doors } = await run('nist-reference-building.pdf', 10);
    expect(pure.wallEngine).toBe('general');
    expect(pure.accepted.length).toBeGreaterThanOrEqual(180);
    expect(doors.accepted.length).toBeGreaterThanOrEqual(40);
    expect(doors.rejected.length).toBeLessThanOrEqual(15);
  }, 120000);
});
