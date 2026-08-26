import { readFileSync, writeFileSync } from 'fs';
import * as mupdf from 'mupdf';
import { createCanvas } from '@napi-rs/canvas';

async function main() {
  const pdfPath = '../../apps/design-build-editor/public/CODE_06.pdf';
  const buf = readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
  const page = doc.loadPage(0);
  
  console.log('Original bounds:', page.getBounds());
  
  // Let's try to set the CropBox to MediaBox
  try {
    page.setPageBox('CropBox', [0, 0, 2383.92, 1683.72]);
    console.log('Bounds after setPageBox:', page.getBounds());
  } catch (err) {
    console.error('setPageBox failed:', err.message);
  }
  
  const CS_SRGB = new mupdf.ColorSpace(0);
  const bounds = page.getBounds();
  const w = Math.round(bounds[2] - bounds[0]);
  const h = Math.round(bounds[3] - bounds[0]); // wait, bounds[3] - bounds[1]
  const pagePix = page.toPixmap([1, 0, 0, 1, 0, 0], CS_SRGB);
  console.log('Pixmap size after crop change:', pagePix.getWidth(), 'x', pagePix.getHeight());
}
main().catch(err => console.error(err));
