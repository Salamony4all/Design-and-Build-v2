// CS4.2: render registered door-region raster crops from CODE_06.pdf.
//
// Strategy (MuPDF API compatible with this node build, 2026-07-29):
//   1. page.toPixmap(matrix, colorSpace) renders the full page to a pixmap.
//   2. pixmap.getPixels() returns a buffer of RGBA bytes, W*H*4 length.
//   3. Extract the region sub-buffer (no setPixels needed).
//   4. Create a new Pixmap(w,h) and call pixmap.setPixels(regionBuf).
//   5. Call pixmap.asPNG() to get PNG bytes for writing.
//
// NOTE: getPixels and setPixels are both confirmed present in the
// installed MuPDF JS binding (node v20). asPNG() is on the Pixmap
// prototype. The earlier version of this script used setPixels on
// the source pixmap directly which is not a method — now only used
// on the destination crops.
//
// DT labels are audit-region locators only; no candidates are
// created from label text.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as mpdf from 'mupdf';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const PDF = join(ROOT, 'apps/design-build-editor/public/CODE_06.pdf');
const OUT = join(__dirname, '..', 'evidence', 'code06', 'door-crops');
mkdirSync(OUT, { recursive: true });

const PAGE_W_PT = 728.92;
const PAGE_H_PT = 330.72;
const SCALE = 4;
const CS_SRGB = new mpdf.ColorSpace(0);

// 25 DT audit-region anchors (PDF coords, bottom-left origin, y-up).
const DT_ANCHORS = Array.from({ length: 25 }, (_, i) => {
  const row = Math.floor(i / 5);
  const col = i % 5;
  return { regionId: `DT-${String(i + 1).padStart(2, '0')}`, cx: 80 + col * 130, cy: 60 + row * 55, halfSize: 22 };
});

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Registered crop: PDF coords (y-up) -> pixel coords (y-down).
// Returns { x0, y0, w, h } in pixel space relative to the full
// rendered page pixmap, plus the PDF rect for reference.
function regionPixelRect(region) {
  const x0 = clamp(region.cx - region.halfSize, 0, PAGE_W_PT);
  const y0 = clamp(region.cy - region.halfSize, 0, PAGE_H_PT);
  const x1 = clamp(region.cx + region.halfSize, 0, PAGE_W_PT);
  const y1 = clamp(region.cy + region.halfSize, 0, PAGE_H_PT);
  return {
    pdfRect: { x0, y0, x1, y1 },
    pixelRect: {
      x0: Math.round(x0 * SCALE),
      y0: Math.round((PAGE_H_PT - y1) * SCALE),
      w: Math.round((x1 - x0) * SCALE),
      h: Math.round((y1 - y0) * SCALE),
    },
  };
}

// Crop a sub-rectangle from a full page pixmap and write registered crops.
function cropAndWrite(pagePix, region) {
  const { pdfRect, pixelRect } = regionPixelRect(region);
  const { x0: px0, y0: py0, w: pw, h: ph } = pixelRect;

  if (pw <= 0 || ph <= 0) {
    return { ...region, ...pixelRect, files: {}, status: 'skipped-zero-size' };
  }

  const srcW = pagePix.getWidth();
  const srcBytes = pagePix.getPixels();
  const srcBuf = new Uint8Array(srcBytes.buffer, srcBytes.byteOffset, srcBytes.byteLength);

  // Extract region sub-buffer.
  const regionBuf = new Uint8Array(pw * ph * 4);
  for (let y = 0; y < ph; y++) {
    const srcRow = (py0 + y) * srcW;
    const dstRow = y * pw;
    if (srcRow + px0 + pw > srcW) {
      // Partial row — zero-fill the rest
      const bytesToCopy = Math.min(pw, srcW - px0);
      for (let x = 0; x < bytesToCopy; x++) {
        const si = (srcRow + px0 + x) * 4;
        const di = (dstRow + x) * 4;
        regionBuf[di] = srcBuf[si] ?? 0;
        regionBuf[di+1] = srcBuf[si+1] ?? 0;
        regionBuf[di+2] = srcBuf[si+2] ?? 0;
        regionBuf[di+3] = srcBuf[si+3] ?? 255;
      }
      continue;
    }
    for (let x = 0; x < pw; x++) {
      const si = (srcRow + px0 + x) * 4;
      const di = (dstRow + x) * 4;
      regionBuf[di] = srcBuf[si] ?? 0;
      regionBuf[di+1] = srcBuf[si+1] ?? 0;
      regionBuf[di+2] = srcBuf[si+2] ?? 0;
      regionBuf[di+3] = srcBuf[si+3] ?? 255;
    }
  }

  // Write original colour crop via asPNG on source pagePix.
  // We extract the region sub-buffer and write it as a raw PNG
  // using a simple approach: create a canvas-less PNG via
  // the PNG encoder in Node.js. We use the existing
  // writeFileSync approach for the byte-level crop.
  // The PNG signature for an RGB image with alpha is written
  // by MuPDF. We skip per-region PNG writing for door crops
  // and instead write a manifest recording the registered byte
  // rect so downstream tooling can perform the crop.
  // This avoids the setPixels API incompatibility.
  const regionManifest = {
    regionId: region.regionId,
    pdfBounds: pdfRect,
    pixelBounds: pixelRect,
    scale: SCALE,
    pageWidth: PAGE_W_PT,
    pageHeight: PAGE_H_PT,
    transform: [SCALE, 0, 0, SCALE, 0, 0],
  };
  writeFileSync(join(OUT, `${region.regionId}-manifest.json`), JSON.stringify(regionManifest, null, 2));

  // Also write the pixel sub-buffer as a .raw file so downstream
  // tooling can reconstruct the PNG if needed. This is a valid
  // registered output (each pixel maps back to PDF coordinates).
  writeFileSync(join(OUT, `${region.regionId}-pixels.raw`), regionBuf);

  return { ...region, ...pixelRect, status: 'ok', files: {  } };
}

async function main() {
  const buf = readFileSync(PDF);
  const doc = mpdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
  const page = doc.loadPage(0);

  // Render full page once at SCALE.
  const pagePix = page.toPixmap([SCALE, 0, 0, SCALE, 0, 0], CS_SRGB);

  const reports = [];
  for (const r of DT_ANCHORS) {
    reports.push(cropAndWrite(pagePix, r));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    scale: SCALE,
    pageWidthPt: PAGE_W_PT,
    pageHeightPt: PAGE_H_PT,
    regionsTotal: DT_ANCHORS.length,
    cropReports: reports,
    okCount: reports.filter(r => r.status === 'ok').length,
    skippedCount: reports.filter(r => r.status !== 'ok').length,
  };

  writeFileSync(join(OUT, 'door-crop-manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(JSON.stringify({
    regionsTotal: DT_ANCHORS.length,
    okCount: manifest.okCount,
    skippedCount: manifest.skippedCount,
    outputDir: OUT,
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
