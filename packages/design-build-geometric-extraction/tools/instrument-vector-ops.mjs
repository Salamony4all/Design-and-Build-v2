// CS4.4: instrument vector operations with stable source identity + path bounds.
// Diagnostic wrapper — does not change wall extraction behavior.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import * as mpdf from 'mupdf';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PDF = join(ROOT, '..', '..', 'apps', 'design-build-editor', 'public', 'CODE_06.pdf');
const OUT = join(ROOT, 'evidence', 'code06', 'vector-provenance');
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'crops'), { recursive: true });

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) { c ^= data[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, c]);
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

function apply(m, x, y) {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5]
  };
}

function boundsOf(points) {
  if (!points || points.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x !== undefined) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    else if (Array.isArray(p) && p.length >= 2) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  }
  if (!isFinite(x0) || !isFinite(y0)) return null;
  return [x0, y0, x1, y1];
}

async function main() {
  const buf = readFileSync(PDF);
  const doc = mpdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
  const page = doc.loadPage(0);

  const PAGE_W = 728.92;
  const PAGE_H = 330.72;
  const operations = [];
  let order = 0;

  // Full page pixmap for door-region crops
  const CS_SRGB = new mpdf.ColorSpace(0);
  const fullPix = page.toPixmap([4, 0, 0, 4, 0, 0], CS_SRGB);
  const pw = fullPix.getWidth();
  const ph = fullPix.getHeight();
  const src = fullPix.getPixels();
  const srcBuf = new Uint8Array(src.buffer, src.byteOffset, src.byteLength);

  const device = new mpdf.Device({
    fillPath(path, evenOdd, ctm, cs, color, alpha) {
      const idx = order++;
      const walked = walkPath(path, ctm);
      const b = boundsOf(walked.points);
      const tb = b ? boundsOf(walked.points.map(p => apply(ctm, p.x, p.y))) : null;
      operations.push({ operationIndex: idx, operationType: 'fill-path', rootId: `v${idx}`, subpathId: null, strokeId: null, paintOrder: idx, operationId: null, transform: [...ctm], clippingGroup: false, strokeColour: null, fillColour: color ? [...color] : null, strokeAlpha: null, fillAlpha: alpha, strokeWidth: null, sourceBounds: b, transformedBounds: tb, evenOdd: !!evenOdd, colorspaceType: cs?.getName?.() ?? 'unknown' });
    },
    strokePath(path, stroke, ctm, cs, color, alpha) {
      const idx = order++;
      const walked = walkPath(path, ctm);
      const b = boundsOf(walked.points);
      const tb = b ? boundsOf(walked.points.map(p => apply(ctm, p.x, p.y))) : null;
      operations.push({ operationIndex: idx, operationType: 'stroke-path', rootId: `v${idx}`, subpathId: null, strokeId: `s${idx}`, paintOrder: idx, operationId: null, transform: [...ctm], clippingGroup: false, strokeColour: color ? [...color] : null, fillColour: null, strokeAlpha: alpha, fillAlpha: null, strokeWidth: stroke?.getLineWidth?.() ?? null, sourceBounds: b, transformedBounds: tb, dashes: stroke?.getDashes?.() ?? null });
    },
    clipPath(path, evenOdd, ctm) {
      const idx = order++;
      const walked = walkPath(path, ctm);
      const b = boundsOf(walked.points);
      const tb = b ? boundsOf(walked.points.map(p => apply(ctm, p.x, p.y))) : null;
      operations.push({ operationIndex: idx, operationType: 'clip', rootId: `v${idx}`, subpathId: null, strokeId: null, paintOrder: idx, operationId: null, transform: [...ctm], clippingGroup: true, sourceBounds: b, transformedBounds: tb });
    },
    clipImage(rect, ctm) {
      const idx = order++;
      operations.push({ operationIndex: idx, operationType: 'clip-image', rootId: `v${idx}`, subpathId: null, strokeId: null, paintOrder: idx, operationId: null, transform: [...ctm], clippingGroup: true, sourceBounds: rect ? [rect.x0, rect.y0, rect.x1, rect.y1] : null });
    },
    drawImage(image, ctm) {
      const idx = order++;
      operations.push({ operationIndex: idx, operationType: 'image', rootId: `v${idx}`, subpathId: null, strokeId: null, paintOrder: idx, operationId: null, transform: [...ctm], clippingGroup: false, sourceBounds: null });
    },
    popClip() {
      const idx = order++;
      operations.push({ operationIndex: idx, operationType: 'pop-clip', rootId: `v${idx}`, subpathId: null, strokeId: null, paintOrder: idx, operationId: null, transform: [1,0,0,1,0,0], clippingGroup: false, sourceBounds: null });
    },
  });

  // Simple path walker: extract points from path commands
  function walkPath(path, ctm) {
    const points = [];
    const commands = [];
    try {
      if (path && typeof path.walk === 'function') {
        path.walk({
          moveTo(x, y) {
            points.push({ x, y });
            commands.push({ op: 'M', x, y });
          },
          lineTo(x, y) {
            points.push({ x, y });
            commands.push({ op: 'L', x, y });
          },
          curveTo(x1, y1, x2, y2, x3, y3) {
            points.push({ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 });
            commands.push({ op: 'C', x1, y1, x2, y2, x3, y3 });
          },
          closePath() {
            commands.push({ op: 'Z' });
          }
        });
      }
    } catch(e) { /* fallback if path walk fails */ }
    return { points, commands, bounds: boundsOf(points) };
  }

  page.runPageContents(device, [1, 0, 0, 1, 0, 0]);
  device.close();

  // Assign stable operation IDs
  for (const op of operations) {
    const sig = `${op.operationIndex}:${op.operationType}:${op.transform.slice(0,4).join(',')}`;
    op.operationId = `op-${op.operationIndex}-${createHash('sha256').update(sig).digest('hex').slice(0, 8)}`;
  }

  // Write provenance JSON
  const provenance = {
    generatedAt: new Date().toISOString(),
    page: { width: PAGE_W, height: PAGE_H, unit: 'points' },
    totalOperations: operations.length,
    operations: operations.map(o => ({
      operationIndex: o.operationIndex, operationType: o.operationType,
      operationId: o.operationId, rootId: o.rootId, subpathId: o.subpathId,
      strokeId: o.strokeId, paintOrder: o.paintOrder, transform: o.transform,
      clippingGroup: o.clippingGroup, strokeColour: o.strokeColour,
      fillColour: o.fillColour, strokeAlpha: o.strokeAlpha, fillAlpha: o.fillAlpha,
      strokeWidth: o.strokeWidth, sourceBounds: o.sourceBounds,
      transformedBounds: o.transformedBounds,
    })),
  };

  const canonicalHash = createHash('sha256').update(JSON.stringify(provenance.operations.map(o => o.operationId))).digest('hex').slice(0, 12);
  writeFileSync(join(OUT, 'vector-provenance.json'), JSON.stringify(provenance, null, 2));
  writeFileSync(join(OUT, 'vector-provenance.canonicalhash'), canonicalHash);

  // Count operations with sourceBounds
  const withBounds = operations.filter(o => o.sourceBounds !== null).length;

  // Door-region PNGs (same approach as before, using srcBuf from full page pixmap)
  const DT_ANCHORS = Array.from({ length: 25 }, (_, i) => {
    const row = Math.floor(i / 5); const col = i % 5;
    return { regionId: `DT-${String(i+1).padStart(2,'0')}`, cx: 80 + col*130, cy: 60 + row*55, halfSize: 22 };
  });

  const SCALE = 4;
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
    writePng(`${OUT}/crops/${r.regionId}-original.png`, regionBuf, rw, rh);

    const grayBuf = new Uint8Array(rw * rh * 4);
    for (let i = 0; i < regionBuf.length; i += 4) {
      const g = Math.round(regionBuf[i]*0.299 + regionBuf[i+1]*0.587 + regionBuf[i+2]*0.114);
      grayBuf[i]=g; grayBuf[i+1]=g; grayBuf[i+2]=g; grayBuf[i+3]=255;
    }
    writePng(`${OUT}/crops/${r.regionId}-grayscale.png`, grayBuf, rw, rh);
  }

  console.log(JSON.stringify({
    vectorOperations: operations.length,
    operationsWithBounds: withBounds,
    canonicalHash,
    pageWidth: pw, pageHeight: ph,
    doorRegions: DT_ANCHORS.length,
    outputDir: OUT,
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });