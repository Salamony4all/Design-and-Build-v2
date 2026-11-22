// TOOL: prints the scale estimate for CODE_06 and every PDF in the fresh folder.
// Skipped unless FRESH=1. FRESH_PAGES="name.pdf=3" picks a page (default 0).
import { it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { collectPageVectors } from '../../src/index';
import { collectSegments } from '../../src/door-symbols';
import { estimateScale, textsFromStructuredTextJson, parseDimensionMm } from '../../src/scale-detection';

const ROOT = process.cwd();
const BASE = join(ROOT, '..', '..', 'test drawings and png');

it.skipIf(process.env.FRESH !== '1')('scale survey', async () => {
  const mupdf = await import('mupdf');
  const pick: Record<string, number> = {};
  for (const kv of (process.env.FRESH_PAGES ?? '').split(',').filter(Boolean)) pick[kv.split('=')[0]!] = Number(kv.split('=')[1]);
  const files = [join(BASE, 'CODE_06 1 page.pdf')];
  const fresh = join(BASE, 'fresh');
  if (existsSync(fresh)) for (const f of readdirSync(fresh).filter((f) => f.toLowerCase().endsWith('.pdf')).sort()) files.push(join(fresh, f));
  for (const file of files) {
    const name = file.split(/[\\/]/).pop()!;
    const doc = mupdf.Document.openDocument(new Uint8Array(readFileSync(file)) as any, 'application/pdf') as any;
    const pageNo = pick[name] ?? 0;
    const page = doc.loadPage(pageNo);
    const pb = page.getBounds();
    const t0 = Date.now();
    const texts = textsFromStructuredTextJson(page.toStructuredText('preserve-whitespace').asJSON());
    const cap = collectPageVectors(page, false, pageNo);
    const est = estimateScale(texts, collectSegments(cap.vectors as any), pb[2] - pb[0], pb[3] - pb[1]);
    const dims = texts.filter((t) => parseDimensionMm(t.text) !== null);
    console.log('SCALE', JSON.stringify({ name, page: pageNo, texts: texts.length, dimTexts: dims.length, sample: dims.slice(0, 5).map((d) => d.text), est, ms: Date.now() - t0 }));
  }
}, 900000);
