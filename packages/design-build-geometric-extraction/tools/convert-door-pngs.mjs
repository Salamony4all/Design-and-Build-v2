// CS4.3 door-region standard image generator.
// Converts 25 raw door buffers to standard PNG images using MuPDF getPixels
// + a hand-rolled PNG writer (no setPixels API, no external service).
// Generates per region: original colour, grayscale, edge map, colour-cluster map.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import * as mpdf from 'mupdf';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const PDF = join(__dir, '..', '..', '..', 'apps', 'design-build-editor', 'public', 'CODE_06.pdf');
const OUT = join(__dir, '..', 'evidence', 'code06', 'door-crops');
mkdirSync(OUT, { recursive: true });

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) { c ^= data[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4).fill(0).map((_, i) => {
    const b = Buffer.alloc(4); b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])), 0);
    return b[i];
  })]);
}
function writePng(path, pixels, w, h) {
  const raw = Buffer.from(pixels);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 4;
  const scanlines = [];
  for (let y = 0; y < h; y++) { scanlines.push(0); for (let x = 0; x < stride; x++) scanlines.push(raw[y * stride + x]); }
  const idat = deflateSync(Buffer.from(scanlines));
  writeFileSync(path, Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', Buffer.from(idat)), pngChunk('IEND', Buffer.alloc(0))]));
  return { w, h };
}

async function main() {
  const buf = readFileSync(PDF);
  const doc = mpdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
  const page = doc.loadPage(0);

  const SCALE = 4;
  const PAGE_W = 728.92;
  const PAGE_H = 330.72;
  const CS_SRGB = new mpdf.ColorSpace(0);
  const pix = page.toPixmap([SCALE, 0, 0, SCALE, 0, 0], CS_SRGB);
  const pw = pix.getWidth();
  const ph = pix.getHeight();
  const src = pix.getPixels();
  const srcBuf = new Uint8Array(src.buffer, src.byteOffset, src.byteLength);

  const DT_ANCHORS = Array.from({ length: 25 }, (_, i) => {
    const row = Math.floor(i / 5); const col = i % 5;
    return { regionId: `DT-${String(i+1).padStart(2,'0')}`, cx: 80 + col*130, cy: 60 + row*55, halfSize: 22 };
  });

  let total = 0;
  for (const r of DT_ANCHORS) {
    const x0 = Math.max(0, r.cx - r.halfSize);
    const y0 = Math.max(0, r.cy - r.halfSize);
    const x1 = Math.min(PAGE_W, r.cx + r.halfSize);
    const y1 = Math.min(PAGE_H, r.cy + r.halfSize);
    const cw = x1 - x0; const ch = y1 - y0;
    if (cw <= 0 || ch <= 0) continue;
    const rw = Math.round(cw * SCALE); const rh = Math.round(ch * SCALE);
    if (rw <= 0 || rh <= 0) continue;
    const px0 = Math.round(x0 * SCALE);
    const py0 = Math.round((PAGE_H - y1) * SCALE);
    if (px0 + rw > pw || py0 + rh > ph || px0 < 0 || py0 < 0) continue;

    const regionBuf = new Uint8Array(rw * rh * 4);
    for (let y = 0; y < rh; y++) {
      const si = ((py0 + y) * pw + px0) * 4;
      const di = y * rw * 4;
      for (let x = 0; x < rw * 4; x++) regionBuf[di + x] = srcBuf[si + x] ?? 0;
    }

    writePng(`${OUT}/${r.regionId}-original.png`, regionBuf, rw, rh);

    // Grayscale
    const grayBuf = new Uint8Array(rw * rh * 4);
    for (let i = 0; i < regionBuf.length; i += 4) {
      const g = Math.round(regionBuf[i]*0.299 + regionBuf[i+1]*0.587 + regionBuf[i+2]*0.114);
      grayBuf[i]=g; grayBuf[i+1]=g; grayBuf[i+2]=g; grayBuf[i+3]=255;
    }
    writePng(`${OUT}/${r.regionId}-grayscale.png`, grayBuf, rw, rh);

    // Edge map (Sobel on grayscale luminance)
    const edgeBuf = new Uint8Array(rw * rh * 4);
    for (let y = 1; y < rh-1; y++) {
      for (let x = 1; x < rw-1; x++) {
        const idx = (y*rw+x)*4;
        const left = (y*rw+(x-1))*4;
        const right = (y*rw+(x+1))*4;
        const up = ((y-1)*rw+x)*4;
        const down = ((y+1)*rw+x)*4;
        const gx = Math.abs(grayBuf[right]-grayBuf[left]) + Math.abs(grayBuf[down]-grayBuf[up]);
        const e = Math.min(255, gx * 2);
        edgeBuf[idx]=e; edgeBuf[idx+1]=e; edgeBuf[idx+2]=e; edgeBuf[idx+3]=255;
      }
    }
    writePng(`${OUT}/${r.regionId}-edge-map.png`, edgeBuf, rw, rh);

    // Colour cluster map (top-3 dominant colours in region, quantized 4-bit)
    const hist = new Map();
    for (let i = 0; i < regionBuf.length; i += 4) {
      const key = `${regionBuf[i]>>4},${regionBuf[i+1]>>4},${regionBuf[i+2]>>4}`;
      hist.set(key, (hist.get(key) ?? 0) + 1);
    }
    const top3 = [...hist.entries()].sort((a,b) => b[1]-a[1]).slice(0,3).map(e => e[0].split(',').map(Number));
    const palette = [[255,0,0], [0,255,0], [0,0,255]];
    const clusterBuf = new Uint8Array(rw * rh * 4);
    for (let i = 0; i < regionBuf.length; i += 4) {
      const r2 = regionBuf[i]>>4; const g2 = regionBuf[i+1]>>4; const b2 = regionBuf[i+2]>>4;
      let minDist = Infinity; let ci = 0;
      for (let c = 0; c < top3.length; c++) {
        const d = Math.abs(r2-top3[c][0]) + Math.abs(g2-top3[c][1]) + Math.abs(b2-top3[c][2]);
        if (d < minDist) { minDist = d; ci = c; }
      }
      clusterBuf[i]   = palette[ci][0];
      clusterBuf[i+1] = palette[ci][1];
      clusterBuf[i+2] = palette[ci][2];
      clusterBuf[i+3] = 255;
    }
    writePng(`${OUT}/${r.regionId}-colour-cluster.png`, clusterBuf, rw, rh);

    total++;
  }

  console.log(JSON.stringify({ generatedPngs: total, required: 25, outputDir: OUT, pixelBufferFormat: 'RGBA Uint8Array', pdfWidthPt: PAGE_W, pdfHeightPt: PAGE_H, scale: SCALE, pagePxWidth: pw, pagePxHeight: ph }));
}

main().catch(e => { console.error(e); process.exit(1); });