import { readFileSync, writeFileSync } from 'fs';
import * as mupdf from 'mupdf';
import { createCanvas } from '@napi-rs/canvas';

async function main() {
  const pdfPath = '../../apps/design-build-editor/public/CODE_06.pdf';
  const buf = readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
  const page = doc.loadPage(0);
  
  // Set CropBox to full page
  page.setPageBox('CropBox', [0, 0, 2383.92, 1683.72]);
  
  // AR-19 coordinates
  const ax = 311.76, ay = 388.32;
  const bx = 311.76, by = 1159.32;
  const len = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / len, uy = (by - ay) / len;
  
  const start = 323.04, end = 379.8;
  const pStart_A = { x: ax + start * ux, y: ay + start * uy };
  const pEnd_A = { x: ax + end * ux, y: ay + end * uy };
  
  // Page coordinates
  const x_page = pStart_A.x / 0.75 - 259;
  const y_page_start = 1395.72 - pStart_A.y / 0.75;
  const y_page_end = 1395.72 - pEnd_A.y / 0.75;
  
  const xMin = x_page;
  const xMax = x_page;
  const yMin = Math.min(y_page_start, y_page_end);
  const yMax = Math.max(y_page_start, y_page_end);
  
  const margin = 80;
  const x0_page = xMin - margin;
  const x1_page = xMax + margin;
  const y0_page = yMin - margin;
  const y1_page = yMax + margin;
  
  const w = x1_page - x0_page;
  const h = y1_page - y0_page;
  
  const SCALE = 4;
  const pw = Math.round(w * SCALE);
  const ph = Math.round(h * SCALE);
  
  const CS_SRGB = new mupdf.ColorSpace(0);
  // Render full page at SCALE
  const pagePix = page.toPixmap([SCALE, 0, 0, SCALE, 0, 0], CS_SRGB);
  const srcW = pagePix.getWidth();
  const srcH = pagePix.getHeight();
  
  const canvas = createCanvas(pw, ph);
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(pw, ph);
  
  const pixBytes = pagePix.getPixels();
  const srcBuf = new Uint8Array(pixBytes.buffer, pixBytes.byteOffset, pixBytes.byteLength);
  const dstBuf = imgData.data;
  
  const px0 = Math.round(x0_page * SCALE);
  const py0 = Math.round(y0_page * SCALE);
  
  for (let y = 0; y < ph; y++) {
    const srcRow = (py0 + y) * srcW;
    const dstRow = y * pw;
    for (let x = 0; x < pw; x++) {
      const si = (srcRow + px0 + x) * 4;
      const di = (dstRow + x) * 4;
      dstBuf[di] = srcBuf[si] ?? 255;
      dstBuf[di + 1] = srcBuf[si + 1] ?? 255;
      dstBuf[di + 2] = srcBuf[si + 2] ?? 255;
      dstBuf[di + 3] = srcBuf[si + 3] ?? 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  writeFileSync('tools/ar19-crop-test.png', canvas.toBuffer('image/png'));
  console.log('Saved crop, width:', pw, 'height:', ph);
}
main().catch(err => console.error(err));
