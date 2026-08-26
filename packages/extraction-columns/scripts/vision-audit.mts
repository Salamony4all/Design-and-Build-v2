// VISION AUDIT COMPOSITOR — burns production column markers directly onto the
// rendered CODE-06 page so the extraction can be judged visually against the
// real drawing.
//
// EVIDENCE ONLY. Nothing here feeds back into src/. The PDF is rasterised for
// review; no vectors are captured and no geometry re-enters the extractor.
//
// Usage:
//   tsx scripts/vision-audit.mts [dpi] [cropName xMin yMin xMax yMax]   (metres)

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as mupdfjs from 'mupdf';
import { extractColumnReport, type PhysicalColumn } from '../src/columns.ts';
import { loadUnclaimedGeometry, loadStructuralEnvelope, loadFixture } from '../src/fixture.ts';

const ROOT = join(process.cwd(), '..', '..');
const PDF = join(ROOT, 'test drawings and png', 'CODE_06 1 page.pdf');
const OUT = join(process.cwd(), 'evidence');
mkdirSync(OUT, { recursive: true });

const DPI = Number(process.argv[2] ?? 120);
const cropName = process.argv[3];
const crop = cropName ? process.argv.slice(4, 8).map(Number) : null; // metres

const fixture = loadFixture();
const mm = fixture.scaleMmPerPt;
const mToPt = (v: number) => (v * 1000) / mm;

const geo = loadUnclaimedGeometry();
const envelope = loadStructuralEnvelope();
const report = extractColumnReport(geo as any, { structuralEnvelope: envelope });
const accepted = report.columns.filter((c) => c.verdict === 'ACCEPT');
const review = report.columns.filter((c) => c.verdict === 'REVIEW');

// ------------------------------------------------------------- render -------
const bytes = new Uint8Array(readFileSync(PDF));
const doc = (mupdfjs as any).Document.openDocument(bytes, 'application/pdf');
const page = doc.loadPage(0);
const scale = DPI / 72;

// Crop is implemented with an explicit Pixmap + DrawDevice: page.toPixmap()'s
// 5th argument is `usage` (a string), NOT a clip box.
let pix: any;
let originPtX = 0;
let originPtY = 0;
if (crop) {
  originPtX = mToPt(crop[0]);
  originPtY = mToPt(crop[1]);
  const x1 = mToPt(crop[2]);
  const y1 = mToPt(crop[3]);
  const bboxPx = [0, 0, Math.ceil((x1 - originPtX) * scale), Math.ceil((y1 - originPtY) * scale)];
  pix = new (mupdfjs as any).Pixmap((mupdfjs as any).ColorSpace.DeviceRGB, bboxPx, false);
  pix.clear(255);
  const m = (mupdfjs as any).Matrix.concat(
    (mupdfjs as any).Matrix.translate(-originPtX, -originPtY),
    (mupdfjs as any).Matrix.scale(scale, scale),
  );
  const dev = new (mupdfjs as any).DrawDevice((mupdfjs as any).Matrix.identity, pix);
  page.run(dev, m);
  dev.close();
} else {
  pix = page.toPixmap(
    (mupdfjs as any).Matrix.scale(scale, scale),
    (mupdfjs as any).ColorSpace.DeviceRGB,
    false,
    true,
  );
}
const W = pix.getWidth();
const H = pix.getHeight();
const px: Uint8ClampedArray = pix.getPixels(); // RGB, 3 bytes/px (alpha=false)
const N = px.length / (W * H);

// metres -> pixel
const toPx = (xm: number, ym: number): [number, number] => [
  (mToPt(xm) - originPtX) * scale,
  (mToPt(ym) - originPtY) * scale,
];

function setPx(x: number, y: number, r: number, g: number, b: number, a = 1) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
  const i = (yi * W + xi) * N;
  px[i] = Math.round(px[i] * (1 - a) + r * a);
  px[i + 1] = Math.round(px[i + 1] * (1 - a) + g * a);
  px[i + 2] = Math.round(px[i + 2] * (1 - a) + b * a);
}
function line(x0: number, y0: number, x1: number, y1: number, c: [number, number, number], w = 2) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    for (let dy = -(w >> 1); dy <= w >> 1; dy++) for (let dx = -(w >> 1); dx <= w >> 1; dx++) setPx(x + dx, y + dy, c[0], c[1], c[2]);
  }
}
function rectOutline(cx: number, cy: number, wM: number, dM: number, rot: number, c: [number, number, number], lw = 2) {
  const hw = wM / 2, hd = dM / 2;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const corners: Array<[number, number]> = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => {
    const [pxm, pym] = [cx + x * cs - y * sn, cy + x * sn + y * cs];
    return toPx(pxm, pym);
  });
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    line(a[0], a[1], b[0], b[1], c, lw);
  }
}
function circleOutline(cxm: number, cym: number, rM: number, c: [number, number, number], lw = 2) {
  const steps = 48;
  let prev: [number, number] | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const p = toPx(cxm + rM * Math.cos(t), cym + rM * Math.sin(t));
    if (prev) line(prev[0], prev[1], p[0], p[1], c, lw);
    prev = p;
  }
}
function crossHair(cxm: number, cym: number, c: [number, number, number], sizePx = 9, lw = 2) {
  const [x, y] = toPx(cxm, cym);
  line(x - sizePx, y, x + sizePx, y, c, lw);
  line(x, y - sizePx, x, y + sizePx, c, lw);
}

const GREEN: [number, number, number] = [0, 200, 90];
const ORANGE: [number, number, number] = [255, 140, 30];
const BLUE: [number, number, number] = [40, 140, 255];
const PURPLE: [number, number, number] = [180, 80, 220];
const RED: [number, number, number] = [235, 40, 60];

for (const c of accepted) {
  rectOutline(c.centreProjectM.x, c.centreProjectM.y, (c.widthM ?? 0.3) + 0.06, (c.depthM ?? 0.3) + 0.06, c.rotationRad, GREEN, 3);
  crossHair(c.centreProjectM.x, c.centreProjectM.y, GREEN, 7, 2);
}
for (const c of review) {
  const col = c.footprintType === 'CIRCULAR' ? BLUE : c.footprintType === 'POLYGONAL' ? PURPLE : ORANGE;
  if (c.footprintType === 'CIRCULAR' && c.radiusM) circleOutline(c.centreProjectM.x, c.centreProjectM.y, c.radiusM + 0.03, col, 2);
  else rectOutline(c.centreProjectM.x, c.centreProjectM.y, (c.widthM ?? 0.3) + 0.05, (c.depthM ?? 0.3) + 0.05, c.rotationRad, col, 2);
}

// oracle FN candidates (if the ledger exists) in red
try {
  const led = JSON.parse(readFileSync(join(OUT, 'mismatch-ledger.json'), 'utf8'));
  for (const o of led.falseNegativeCandidates ?? []) {
    circleOutline(o.centreProjectM.x, o.centreProjectM.y, 0.32, RED, 3);
  }
} catch { /* ledger not generated yet */ }

// re-pack to a pixmap-compatible buffer and save
const outName = cropName ? `vision-${cropName}.png` : 'vision-audit-full.png';
writeFileSync(join(OUT, outName), Buffer.from(pix.asPNG()));
console.log(`wrote evidence/${outName} ${W}x${H} (dpi ${DPI})`);
console.log(`accepted=${accepted.length} review=${review.length} stats=${JSON.stringify(report.stats)}`);
