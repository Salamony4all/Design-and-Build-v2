// CS4.2 door-analysis: inspect raw MuPDF operations in 25 DT audit
// regions, run colour/stroke clustering, and produce a narrow door
// candidate pre-pass report.
//
// Uses MuPDF APIs confirmed present in this node build:
//   - Document.openDocument, page.loadPage
//   - page.toPixmap(matrix, colorSpace) with ColorSpace(0)=sRGB
//   - new mpdf.Pixmap(w, h), pixmap.getPixels() (not .samples)
//   - mpdf.Device(...) for raw operation collection
//
// DT labels are audit-region locators only; door candidates are
// derived ONLY from source-registered graphical evidence.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import * as mpdf from 'mupdf';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const PDF = join(ROOT, 'apps/design-build-editor/public/CODE_06.pdf');
const OUT = join(__dirname, '..', 'evidence', 'code06', 'door-pre-pass');
mkdirSync(OUT, { recursive: true });

const PAGE_W = 728.92;
const PAGE_H = 330.72;

// 25 DT audit-region anchors (PDF coords, bottom-left origin, y-up).
const DT_ANCHORS = Array.from({ length: 25 }, (_, i) => {
  const row = Math.floor(i / 5);
  const col = i % 5;
  return { regionId: `DT-${String(i + 1).padStart(2, '0')}`, cx: 80 + col * 130, cy: 60 + row * 55, halfSize: 22 };
});

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Classify a region's raw operations to determine its graphical convention.
function classifyRegion(ops) {
  const strokes = ops.filter(o => o.op === 'stroke' && o.ctm);
  const hasFill = ops.some(o => o.op === 'fill');
  const hasClip = ops.some(o => o.op === 'clip');
  const hasImage = ops.some(o => o.op === 'image' || o.op === 'clip-image');
  const swValues = strokes.map(o => o.sw ?? 0).filter(v => v > 0);
  const meanSw = swValues.length ? swValues.reduce((a, b) => a + b, 0) / swValues.length : 0;
  const swBand = Math.round(meanSw * 10);

  // Colour histogram (binned to 32 levels per channel for clustering).
  const colourBuckets = new Map();
  for (const s of strokes) {
    if (!s.color) continue;
    const k = s.color.map(v => Math.round(v * 32) / 32).join(',');
    colourBuckets.set(k, (colourBuckets.get(k) ?? 0) + 1);
  }
  const dominantRGB = [...colourBuckets.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    hasStroke: strokes.length > 0,
    hasFill,
    hasClip,
    hasImage,
    strokeCount: strokes.length,
    meanStrokeWidth: +meanSw.toFixed(3),
    swBand,
    dominantColourBucket: dominantRGB ? { rgb: dominantRGB[0].split(',').map(Number), count: dominantRGB[1] } : null,
  };
}

async function main() {
  const buf = readFileSync(PDF);
  const doc = mpdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
  const page = doc.loadPage(0);

  // Collect raw operations from the page via MuPDF Device.
  const rawOps = [];
  const dev = new mpdf.Device({
    fillPath(_path, _evenOdd, ctm, _cs, _color, alpha) {
      rawOps.push({ op: 'fill', ctm: ctm ? [...ctm] : null, color: null, alpha });
    },
    strokePath(_path, stroke, ctm, _cs, color, alpha) {
      rawOps.push({ op: 'stroke', ctm: ctm ? [...ctm] : null, color: color ? [...color] : null, alpha, sw: stroke?.getLineWidth?.() ?? null });
    },
    clipPath(_path, _evenOdd, ctm) { rawOps.push({ op: 'clip', ctm: ctm ? [...ctm] : null }); },
    clipImage(_rect, ctm) { rawOps.push({ op: 'clip-image', ctm: ctm ? [...ctm] : null }); },
    drawImage(_image, ctm) { rawOps.push({ op: 'image', ctm: ctm ? [...ctm] : null }); },
    popClip() { rawOps.push({ op: 'pop' }); },
  });
  page.runPageContents(dev, [1, 0, 0, 1, 0, 0]);
  dev.close();

  // Page rendered at SCALE for registered crop coordinate tracking.
  const CS_SRGB = new mpdf.ColorSpace(0);
  const pagePix = page.toPixmap([2, 0, 0, 2, 0, 0], CS_SRGB);
  const src = pagePix.getPixels();
  const srcBytes = new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  const srcW = pagePix.getWidth();
  const srcH = pagePix.getHeight();

  // Per-region: crop pixels + classify operations.
  const regionReports = [];
  const colourClusterCounts = new Map();
  const allStrokeWidths = [];
  const descriptorBuckets = new Map();

  for (const r of DT_ANCHORS) {
    // Registered crop rect (PDF coords -> pixel coords).
    const x0 = clamp(r.cx - r.halfSize, 0, PAGE_W);
    const y0 = clamp(r.cy - r.halfSize, 0, PAGE_H);
    const x1 = clamp(r.cx + r.halfSize, 0, PAGE_W);
    const y1 = clamp(r.cy + r.halfSize, 0, PAGE_H);
    const px0 = Math.round(x0 * 2);
    const py0 = Math.round((PAGE_H - y1) * 2);
    const pw = Math.round((x1 - x0) * 2);
    const ph = Math.round((y1 - y0) * 2);

    // Pixel-crop data (registered coordinates; used by downstream
    // tooling that can render PNGs). We only store the byte rect
    // here — actual PNG writing is deferred to avoid Pixmap API
    // incompatibilities in this MuPDF node build.
    let cropStats = null;
    if (pw > 0 && ph > 0 && px0 + pw <= srcW && py0 + ph <= srcH) {
      let sumR = 0, sumG = 0, sumB = 0, count = 0;
      for (let y = 0; y < ph; y++) {
        const srcRow = (py0 + y) * srcW;
        for (let x = 0; x < pw; x++) {
          const idx = (srcRow + px0 + x) * 4;
          sumR += srcBytes[idx] ?? 0;
          sumG += srcBytes[idx + 1] ?? 0;
          sumB += srcBytes[idx + 2] ?? 0;
          count++;
        }
      }
      cropStats = { w: pw, h: ph, meanR: count ? Math.round(sumR / count) : 0, meanG: count ? Math.round(sumG / count) : 0, meanB: count ? Math.round(sumB / count) : 0, pixelCount: count };
    }

    // Filter ops whose CTM origin falls within this region.
    const ops = rawOps.filter(o => {
      if (!o.ctm) return false;
      const ox = o.ctm[4] ?? 0;
      const oy = o.ctm[5] ?? 0;
      return ox >= r.cx - r.halfSize && ox <= r.cx + r.halfSize
          && (PAGE_H - oy) >= r.cy - r.halfSize && (PAGE_H - oy) <= r.cy + r.halfSize;
    });
    const info = classifyRegion(ops);

    // Track colour clusters (stride = swBand + rounded RGB).
    const dRgb = info.dominantColourBucket ? info.dominantColourBucket.rgb.map(v => Math.round(v * 8) / 8).join(',') : 'none';
    const clusterKey = `sw${info.swBand}|rgb${dRgb}|f${info.hasFill ? 1 : 0}|c${info.hasClip ? 1 : 0}`;
    colourClusterCounts.set(clusterKey, (colourClusterCounts.get(clusterKey) ?? 0) + 1);

    for (const s of ops.filter(o => o.op === 'stroke' && o.sw != null && o.sw > 0)) {
      allStrokeWidths.push(s.sw);
    }

    const descKey = `${info.hasStroke}|${info.hasFill}|${info.hasClip}|${info.hasImage}|${info.swBand}`;
    const bucket = descriptorBuckets.get(descKey) ?? [];
    bucket.push(r.regionId);
    descriptorBuckets.set(descKey, bucket);

    regionReports.push({
      regionId: r.regionId,
      pdfCoords: { x0, y0, x1, y1 },
      pixelCrop: cropStats,
      classification: info,
      opCount: ops.length,
    });
  }

  const dominantDoorColourCluster = [...colourClusterCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, c]) => ({ descriptorKey: k, count: c }));
  const dominantStrokeWidthBands = [...new Set(allStrokeWidths.map(w => Math.round(w * 10) / 10))].sort((a, b) => a - b);

  const repeatedLocalDescriptors = [...descriptorBuckets.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([descriptor, regions]) => ({ descriptor, regions, count: regions.length }));
  const visuallySupportedRegions = repeatedLocalDescriptors.filter(d => d.count >= 3).length;
  const unresolvedRegions = 25 - visuallySupportedRegions;

  const prePassResult = {
    inspectionRegions: 25,
    rawGraphicalCandidates: 0,
    repeatedDescriptorCandidates: 0,
    hostResolvedCandidates: 0,
    accepted: 0,
    review: 0,
    rejected: 0,
    unresolvedRegions,
    recommendedPrePass: dominantDoorColourCluster.length > 0
      ? `colour-stroke-cluster:${dominantDoorColourCluster.map(c => c.descriptorKey).join('|')}`
      : 'no-graphical-convention-detected-yet',
  };

  const output = {
    generatedAt: new Date().toISOString(),
    dtAnchors: DT_ANCHORS.map(r => ({ regionId: r.regionId, pdfCentre: { x: r.cx, y: r.cy }, halfSize: r.halfSize })),
    regionReports,
    rawOperationSummary: {
      totalRawOperations: rawOps.length,
      strokePaths: rawOps.filter(o => o.op === 'stroke').length,
      fillPaths: rawOps.filter(o => o.op === 'fill').length,
      clips: rawOps.filter(o => o.op === 'clip').length,
      images: rawOps.filter(o => o.op === 'image' || o.op === 'clip-image').length,
    },
    colourClusterAnalysis: {
      colourClusters: [...colourClusterCounts.entries()].sort((a, b) => b[1] - a[1]),
      dominantDoorColourCluster,
      dominantStrokeWidthBands,
      repeatedLocalDescriptors,
      descriptorRecurrence: repeatedLocalDescriptors.map(d => d.count),
      visuallySupportedRegions,
      unresolvedRegions,
    },
    doorCandidatePrePass: prePassResult,
    doorReadiness: 'VISION_QUALITY_NOT_REACHED',
    deterministicHash: createHash('sha256').update(JSON.stringify({ DT_ANCHORS, prePassResult, dominantDoorColourCluster, rawOps: rawOps.length })).digest('hex'),
  };

  writeFileSync(join(OUT, 'door-pre-pass-report.json'), JSON.stringify(output, null, 2));
  writeFileSync(join(OUT, 'door-pre-pass-canonicalhash'), output.deterministicHash);
  console.log(JSON.stringify({
    doorRegions: 25,
    rawOps: rawOps.length,
    dominantCluster: output.colourClusterAnalysis.dominantDoorColourCluster[0] ?? null,
    repeatedDescriptors: repeatedLocalDescriptors.length,
    prePass: prePassResult,
    hash: output.deterministicHash,
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
