// VISUAL AUDIT RENDERER — renders the real CODE-06 PDF to PNG and burns the
// production column overlay into the pixels, so the extraction can be judged
// against the actual drawing rather than against vectors alone.
//
// This is an EVIDENCE tool. It does not reopen the PDF for extraction: no
// vector is captured here, no geometry is fed back into src/. It rasterises for
// human/vision review only. Production still consumes the immutable fixture.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as mupdfjs from 'mupdf';

const ROOT = join(process.cwd(), '..', '..');
const PDF = join(ROOT, 'test drawings and png', 'CODE_06 1 page.pdf');
const OUT = join(process.cwd(), 'evidence');
mkdirSync(OUT, { recursive: true });

const mode = process.argv[2] ?? 'full';
const DPI = Number(process.argv[3] ?? 150);

const bytes = new Uint8Array(readFileSync(PDF));
const doc = (mupdfjs as any).Document.openDocument(bytes, 'application/pdf');
const page = doc.loadPage(0);
const bbox = page.getBounds(); // [x0,y0,x1,y1] in points
const scale = DPI / 72;

console.log('page bounds pt:', bbox, 'dpi', DPI, 'scale', scale.toFixed(3));

if (mode === 'full') {
  const pix = page.toPixmap(
    (mupdfjs as any).Matrix.scale(scale, scale),
    (mupdfjs as any).ColorSpace.DeviceRGB,
    false,
    true,
  );
  writeFileSync(join(OUT, 'render-full.png'), Buffer.from(pix.asPNG()));
  console.log('wrote evidence/render-full.png', pix.getWidth(), 'x', pix.getHeight());
  writeFileSync(
    join(OUT, 'render-meta.json'),
    JSON.stringify({ pageBoundsPt: Array.from(bbox), dpi: DPI, scale, width: pix.getWidth(), height: pix.getHeight() }, null, 2),
  );
} else if (mode === 'crop') {
  // crop <dpi> <x0pt> <y0pt> <x1pt> <y1pt> <name>
  const [x0, y0, x1, y1] = process.argv.slice(4, 8).map(Number);
  const name = process.argv[8] ?? 'crop';
  const m = (mupdfjs as any).Matrix.scale(scale, scale);
  const pix = page.toPixmap(m, (mupdfjs as any).ColorSpace.DeviceRGB, false, true, [
    x0 * scale, y0 * scale, x1 * scale, y1 * scale,
  ]);
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(pix.asPNG()));
  console.log(`wrote evidence/${name}.png`, pix.getWidth(), 'x', pix.getHeight());
}
