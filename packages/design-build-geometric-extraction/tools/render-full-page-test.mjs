import { readFileSync, writeFileSync } from 'fs';
import * as mupdf from 'mupdf';
import { createCanvas } from '@napi-rs/canvas';
import { join } from 'path';

async function main() {
  const pdfPath = '../../apps/design-build-editor/public/CODE_06.pdf';
  const buf = readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
  const page = doc.loadPage(0);
  const CS_SRGB = new mupdf.ColorSpace(0);
  const pagePix = page.toPixmap([1, 0, 0, 1, 0, 0], CS_SRGB);
  
  const w = pagePix.getWidth();
  const h = pagePix.getHeight();
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(w, h);
  
  const pixBytes = pagePix.getPixels();
  const srcBuf = new Uint8Array(pixBytes.buffer, pixBytes.byteOffset, pixBytes.byteLength);
  const dstBuf = imgData.data;
  
  for (let i = 0; i < dstBuf.length; i++) {
    dstBuf[i] = srcBuf[i];
  }
  ctx.putImageData(imgData, 0, 0);
  writeFileSync('tools/code06-full-page.png', canvas.toBuffer('image/png'));
  console.log('Done rendering, width:', w, 'height:', h);
}
main().catch(err => console.error(err));
