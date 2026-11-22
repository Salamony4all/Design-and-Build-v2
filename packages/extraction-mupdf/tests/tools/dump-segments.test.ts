// TOOL: dumps de-duplicated segments (compact) for CODE_06 and each fresh PDF so wall
// detection can be prototyped offline. Skipped unless FRESH=1.
import { it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { collectPageVectors, extractPureWallResult } from '../../src/index';
import { collectSegments } from '../../src/door-symbols';

const ROOT = process.cwd();
const BASE = join(ROOT, '..', '..', 'test drawings and png');
const OUT = join(ROOT, 'tests', 'fixtures', '_fresh');

it.skipIf(process.env.FRESH !== '1')('dump segments', async () => {
  const mupdf = await import('mupdf');
  mkdirSync(OUT, { recursive: true });
  const pick: Record<string, number> = {};
  for (const kv of (process.env.FRESH_PAGES ?? '').split(',').filter(Boolean)) pick[kv.split('=')[0]!] = Number(kv.split('=')[1]);
  const files = [join(BASE, 'CODE_06 1 page.pdf')];
  const fresh = join(BASE, 'fresh');
  if (existsSync(fresh)) for (const f of readdirSync(fresh).filter((f) => f.toLowerCase().endsWith('.pdf')).sort()) files.push(join(fresh, f));
  for (const file of files) {
    const name = file.split(/[\\/]/).pop()!;
    const bytes = new Uint8Array(readFileSync(file));
    const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf') as any;
    const pageNo = pick[name] ?? 0;
    const page = doc.loadPage(pageNo);
    const pb = page.getBounds();
    const cap = collectPageVectors(page, false, pageNo);
    const segs = collectSegments(cap.vectors as any);
    let scale = 0;
    try { scale = (extractPureWallResult(bytes, pageNo, undefined, undefined, true) as any).pureResult.scaleMmPerPt; } catch { /* ignore */ }
    const r = (n: number) => Math.round(n * 100) / 100;
    const opIndex = new Map<string, number>();
    const oi = (op?: string) => (op === undefined ? -1 : (opIndex.has(op) ? opIndex.get(op)! : (opIndex.set(op, opIndex.size), opIndex.size - 1)));
    const rows = segs.map((s) => [r(s.a.x), r(s.a.y), r(s.b.x), r(s.b.y), r(s.w), (s.fill ? 1 : 0) + (s.stroke ? 2 : 0), r(s.shade ?? 0), oi(s.fillOp), r(s.fillShade ?? 1)]);
    const stem = name.replace(/\.pdf$/i, '').replace(/ /g, '_');
    writeFileSync(join(OUT, `${stem}.segs.json`), JSON.stringify({ name, page: pageNo, pageBounds: pb, scaleMmPerPt: scale, segs: rows }));
    if (!existsSync(join(OUT, `${stem}.png`))) {
      const s = Math.min(4, 5000 / Math.max(pb[2] - pb[0], pb[3] - pb[1]));
      writeFileSync(join(OUT, `${stem}.png`), page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false, true).asPNG());
    }
    console.log('SEGS', name, rows.length, 'scale', scale);
  }
}, 900000);
