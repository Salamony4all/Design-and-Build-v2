// Identify the unmatched raster candidates: print a high-resolution ink map of
// each representative so its symbol can be recognised from its shape.
import { readFileSync } from 'fs';
import { join } from 'path';
import * as mupdfjs from 'mupdf';
import { loadFixture } from '../src/fixture.ts';

const ROOT = join(process.cwd(), '..', '..');
const PDF = join(ROOT, 'test drawings and png', 'CODE_06 1 page.pdf');
const fx = loadFixture();
const mm = fx.scaleMmPerPt;
const mToPt = (v: number) => (v * 1000) / mm;
const DPI = 300, scale = DPI / 72;
const bytes = new Uint8Array(readFileSync(PDF));
const doc = (mupdfjs as any).Document.openDocument(bytes, 'application/pdf');
const page = doc.loadPage(0);
const pix = page.toPixmap((mupdfjs as any).Matrix.scale(scale, scale), (mupdfjs as any).ColorSpace.DeviceGray, false, true);
const W = pix.getWidth(), H = pix.getHeight();
const g = pix.getPixels();
const val = (x: number, y: number) => {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return 255;
  return g[yi * W + xi];
};
const toPx = (xm: number, ym: number): [number, number] => [mToPt(xm) * scale, mToPt(ym) * scale];

function map(label: string, cx: number, cy: number, half: number, step: number) {
  console.log(`\n=== ${label} @(${cx.toFixed(2)},${cy.toFixed(2)}) +-${half}m step ${step}m ===`);
  for (let dy = -half; dy <= half + 1e-9; dy += step) {
    let row = '';
    for (let dx = -half; dx <= half + 1e-9; dx += step) {
      const [px, py] = toPx(cx + dx, cy + dy);
      const v = val(px, py);
      row += v < 100 ? '#' : v < 240 ? 'x' : '.';
    }
    console.log(`   ${dy.toFixed(2).padStart(5)} ${row}`);
  }
}

// dominant unmatched family (24x): 0.874 x 0.571 in two long rows
map('UNMATCHED-FAMILY-A 0.87x0.57', 6.01, 10.27, 0.85, 0.045);
// stacked 0.496 x 0.252 family (10x)
map('UNMATCHED-FAMILY-B 0.50x0.25 stack', 17.58, 10.85, 0.9, 0.05);
// isolated 0.378x0.437
map('UNMATCHED-C 0.38x0.44', 19.66, 11.00, 0.6, 0.04);
// reference: a CONFIRMED accepted column
map('REFERENCE accepted 695 column', 13.9423, 12.2153, 0.6, 0.04);
