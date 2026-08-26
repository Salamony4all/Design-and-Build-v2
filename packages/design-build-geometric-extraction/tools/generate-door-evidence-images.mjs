import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as mpdf from 'mupdf';
import { createCanvas } from '@napi-rs/canvas';
import { collectPageVectors } from '../../extraction-mupdf/src/vector-device.ts';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..', '..');
const PDF = join(ROOT, 'apps', 'design-build-editor', 'public', 'CODE_06.pdf');
const OUT = join(__dir, '..', 'evidence', 'code06', 'door-crops');
mkdirSync(OUT, { recursive: true });

const PAGE_W_PT = 728.92;
const PAGE_H_PT = 330.72;
const SCALE = 4;
const CS_SRGB = new mpdf.ColorSpace(0);

const DT_ANCHORS = Array.from({ length: 25 }, (_, i) => {
  const row = Math.floor(i / 5);
  const col = i % 5;
  return { regionId: `DT-${String(i + 1).padStart(2, '0')}`, cx: 80 + col * 130, cy: 60 + row * 55, halfSize: 22 };
});

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

async function main() {
  const buf = readFileSync(PDF);
  const doc = mpdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
  const page = doc.loadPage(0);

  // Render full page to Pixmap at SCALE
  const pagePix = page.toPixmap([SCALE, 0, 0, SCALE, 0, 0], CS_SRGB);
  const srcW = pagePix.getWidth();
  const srcH = pagePix.getHeight();
  const srcBytes = pagePix.getPixels();
  const srcBuf = new Uint8Array(srcBytes.buffer, srcBytes.byteOffset, srcBytes.byteLength);

  // Collect page vectors for drawing maps
  const pageVectors = collectPageVectors(page, true, 0);

  let successCount = 0;

  for (const r of DT_ANCHORS) {
    const x0 = clamp(r.cx - r.halfSize, 0, PAGE_W_PT);
    const y0 = clamp(r.cy - r.halfSize, 0, PAGE_H_PT);
    const x1 = clamp(r.cx + r.halfSize, 0, PAGE_W_PT);
    const y1 = clamp(r.cy + r.halfSize, 0, PAGE_H_PT);

    const px0 = Math.round(x0 * SCALE);
    const py0 = Math.round((PAGE_H_PT - y1) * SCALE);
    const pw = Math.round((x1 - x0) * SCALE);
    const ph = Math.round((y1 - y0) * SCALE);

    if (pw <= 0 || ph <= 0) continue;

    // 1. Original colour crop
    const canvasOrg = createCanvas(pw, ph);
    const ctxOrg = canvasOrg.getContext('2d');
    const imgData = ctxOrg.createImageData(pw, ph);
    const dstBuf = imgData.data;

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
    ctxOrg.putImageData(imgData, 0, 0);
    writeFileSync(join(OUT, `${r.regionId}-original.png`), canvasOrg.toBuffer('image/png'));

    // 2. Grayscale crop
    const canvasGray = createCanvas(pw, ph);
    const ctxGray = canvasGray.getContext('2d');
    const imgDataGray = ctxGray.createImageData(pw, ph);
    const dstBufGray = imgDataGray.data;
    for (let i = 0; i < dstBuf.length; i += 4) {
      const g = Math.round(dstBuf[i] * 0.299 + dstBuf[i + 1] * 0.587 + dstBuf[i + 2] * 0.114);
      dstBufGray[i] = g;
      dstBufGray[i + 1] = g;
      dstBufGray[i + 2] = g;
      dstBufGray[i + 3] = 255;
    }
    ctxGray.putImageData(imgDataGray, 0, 0);
    writeFileSync(join(OUT, `${r.regionId}-grayscale.png`), canvasGray.toBuffer('image/png'));

    // 3. Edge-map crop (Sobel on grayscale)
    const canvasEdge = createCanvas(pw, ph);
    const ctxEdge = canvasEdge.getContext('2d');
    const imgDataEdge = ctxEdge.createImageData(pw, ph);
    const dstBufEdge = imgDataEdge.data;
    for (let y = 1; y < ph - 1; y++) {
      for (let x = 1; x < pw - 1; x++) {
        const idx = (y * pw + x) * 4;
        const left = (y * pw + (x - 1)) * 4;
        const right = (y * pw + (x + 1)) * 4;
        const up = ((y - 1) * pw + x) * 4;
        const down = ((y + 1) * pw + x) * 4;
        const gx = Math.abs(dstBufGray[right] - dstBufGray[left]) + Math.abs(dstBufGray[down] - dstBufGray[up]);
        const e = Math.min(255, gx * 2);
        dstBufEdge[idx] = e;
        dstBufEdge[idx + 1] = e;
        dstBufEdge[idx + 2] = e;
        dstBufEdge[idx + 3] = 255;
      }
    }
    ctxEdge.putImageData(imgDataEdge, 0, 0);
    writeFileSync(join(OUT, `${r.regionId}-edge-map.png`), canvasEdge.toBuffer('image/png'));

    // 4. Colour cluster map (quantized palette)
    const hist = new Map();
    for (let i = 0; i < dstBuf.length; i += 4) {
      const key = `${dstBuf[i] >> 4},${dstBuf[i + 1] >> 4},${dstBuf[i + 2] >> 4}`;
      hist.set(key, (hist.get(key) ?? 0) + 1);
    }
    const top3 = [...hist.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(e => e[0].split(',').map(Number));
    const palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];

    const canvasCluster = createCanvas(pw, ph);
    const ctxCluster = canvasCluster.getContext('2d');
    const imgDataCluster = ctxCluster.createImageData(pw, ph);
    const dstBufCluster = imgDataCluster.data;
    for (let i = 0; i < dstBuf.length; i += 4) {
      const rVal = dstBuf[i] >> 4;
      const gVal = dstBuf[i + 1] >> 4;
      const bVal = dstBuf[i + 2] >> 4;
      let minDist = Infinity;
      let ci = 0;
      for (let c = 0; c < top3.length; c++) {
        const d = Math.abs(rVal - top3[c][0]) + Math.abs(gVal - top3[c][1]) + Math.abs(bVal - top3[c][2]);
        if (d < minDist) {
          minDist = d;
          ci = c;
        }
      }
      const col = palette[ci] ?? [255, 255, 255];
      dstBufCluster[i] = col[0];
      dstBufCluster[i + 1] = col[1];
      dstBufCluster[i + 2] = col[2];
      dstBufCluster[i + 3] = 255;
    }
    ctxCluster.putImageData(imgDataCluster, 0, 0);
    writeFileSync(join(OUT, `${r.regionId}-colour-cluster.png`), canvasCluster.toBuffer('image/png'));

    // Filter vectors within this region
    const localVectors = pageVectors.vectors.filter(v => {
      return v.bounds[0] >= x0 - 1 && v.bounds[1] >= y0 - 1 && v.bounds[2] <= x1 + 1 && v.bounds[3] <= y1 + 1;
    });

    // 5. Line/curve map (drawn on white background)
    const canvasLineCurve = createCanvas(pw, ph);
    const ctxLC = canvasLineCurve.getContext('2d');
    ctxLC.fillStyle = '#ffffff';
    ctxLC.fillRect(0, 0, pw, ph);

    const drawVector = (ctx, v, color = '#000000', width = 1) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let started = false;
      for (const cmd of v.commands) {
        if (cmd.op === 'M') {
          ctx.moveTo((cmd.x - x0) * SCALE, (y1 - cmd.y) * SCALE);
          started = true;
        } else if (cmd.op === 'L' && started) {
          ctx.lineTo((cmd.x - x0) * SCALE, (y1 - cmd.y) * SCALE);
        } else if (cmd.op === 'C' && started) {
          ctx.bezierCurveTo(
            (cmd.p1.x - x0) * SCALE, (y1 - cmd.p1.y) * SCALE,
            (cmd.p2.x - x0) * SCALE, (y1 - cmd.p2.y) * SCALE,
            (cmd.p3.x - x0) * SCALE, (y1 - cmd.p3.y) * SCALE
          );
        } else if (cmd.op === 'Z') {
          ctx.closePath();
        }
      }
      ctx.stroke();
    };

    for (const v of localVectors) {
      const hasCurves = v.commands.some(c => c.op === 'C');
      drawVector(ctxLC, v, hasCurves ? '#ef4444' : '#000000', 1.5);
    }
    writeFileSync(join(OUT, `${r.regionId}-line-curve.png`), canvasLineCurve.toBuffer('image/png'));

    // 6. Operation overlay (original image with vector paths drawn on top, color-coded and labeled)
    const canvasOverlay = createCanvas(pw, ph);
    const ctxOv = canvasOverlay.getContext('2d');
    // Draw original
    ctxOv.putImageData(imgData, 0, 0);

    // Overlay paths
    localVectors.forEach((v, index) => {
      const hasCurves = v.commands.some(c => c.op === 'C');
      // Highlight lines in blue, curves in red
      drawVector(ctxOv, v, hasCurves ? '#ef4444' : '#3b82f6', 2.0);

      // Draw text label at the first command coordinate
      const firstM = v.commands.find(c => c.op === 'M');
      if (firstM) {
        ctxOv.fillStyle = '#10b981';
        ctxOv.font = 'bold 8px monospace';
        ctxOv.fillText(`${index}`, (firstM.x - x0) * SCALE + 2, (y1 - firstM.y) * SCALE - 2);
      }
    });

    writeFileSync(join(OUT, `${r.regionId}-op-overlay.png`), canvasOverlay.toBuffer('image/png'));
    successCount++;
  }

  console.log(JSON.stringify({
    status: 'success',
    regionsGenerated: successCount,
    outputDir: OUT
  }, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
