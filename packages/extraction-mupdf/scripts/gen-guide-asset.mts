// scripts/gen-guide-asset.mts
// Generate a cropped Guide image for CODE_06 from the VERIFIED active building
// region (reuses derivePureBuildingRoi via extractPureWallResult). The crop is
// the building footprint only — not the full PDF page. No external image libs:
// renders via mupdf, crops in pure JS, encodes PNG with Node zlib.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import * as zlib from 'node:zlib';
import * as mupdf from 'mupdf';
import { extractPureWallResult } from '../src/index';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', '..');
const PDF = path.join(ROOT, 'test drawings and png/CODE_06 1 page.pdf');
const OUT = path.join(ROOT, 'apps/design-build-editor/public/guide-code06.png');

function crc32(buf: Buffer): number {
  // Node 22+ exposes zlib.crc32
  return (zlib as unknown as { crc32: (b: Buffer) => number }).crc32(buf);
}

function encodePng(rgba: Buffer, w: number, h: number): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type 6 = RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, y * w * 4 + w * 4);
  }
  const idat = zlib.deflateSync(raw);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  };
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function main() {
  const data = new Uint8Array(fs.readFileSync(PDF));
  const r = extractPureWallResult(data, 0);
  const [px0, py0, px1, py1] = r.pageBoundsMupdf;
  const [rx0, ry0, rx1, ry1] = r.activeBuildingRegionMupdf;
  const scaleMmPerPt = r.scaleMmPerPt;
  console.log('pageBoundsMupdf', r.pageBoundsMupdf);
  console.log('activeBuildingRegionMupdf', r.activeBuildingRegionMupdf);
  console.log('scaleMmPerPt', scaleMmPerPt);
  console.log('widthM', ((rx1 - rx0) * scaleMmPerPt) / 1000);
  console.log('depthM', ((ry1 - ry0) * scaleMmPerPt) / 1000);

  const doc = mupdf.Document.openDocument(data as unknown as Uint8Array, 'application/pdf');
  const page = doc.loadPage(0);
  const pageWpt = px1 - px0;
  const pageHpt = py1 - py0;
  const zoom = Math.max(1400 / pageWpt, 1400 / pageHpt);
  const matrix = mupdf.Matrix.scale(zoom, zoom);
  const pix = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, false);
  const W = pix.getWidth();
  const H = pix.getHeight();
  const stride = pix.getStride();
  const full = Buffer.from(pix.getPixels() as unknown as Uint8Array);
  console.log('rendered', W, 'x', H, 'stride', stride);

  // ROI crop (MuPDF top-left origin -> image top-left).
  const left = Math.max(0, Math.min(Math.round((rx0 - px0) * zoom), Math.round((rx1 - px0) * zoom)));
  const right = Math.min(W, Math.max(Math.round((rx0 - px0) * zoom), Math.round((rx1 - px0) * zoom)));
  const top = Math.max(0, Math.min(Math.round((ry0 - py0) * zoom), Math.round((ry1 - py0) * zoom)));
  const bottom = Math.min(H, Math.max(Math.round((ry0 - py0) * zoom), Math.round((ry1 - py0) * zoom)));
  const cw = right - left;
  const ch = bottom - top;
  console.log('crop', { left, top, cw, ch });

  const cropped = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcRow = (top + y) * stride + left * 3;
    const dstRow = y * cw * 4;
    for (let x = 0; x < cw; x++) {
      cropped[dstRow + x * 4] = full[srcRow + x * 3];
      cropped[dstRow + x * 4 + 1] = full[srcRow + x * 3 + 1];
      cropped[dstRow + x * 4 + 2] = full[srcRow + x * 3 + 2];
      cropped[dstRow + x * 4 + 3] = 255;
    }
  }
  const png = encodePng(cropped, cw, ch);
  fs.writeFileSync(OUT, png);
  console.log('wrote', OUT, png.length, 'bytes', cw, 'x', ch);
}

main();
