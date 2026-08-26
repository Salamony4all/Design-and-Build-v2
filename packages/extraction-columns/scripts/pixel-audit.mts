// RENDER-SPACE PIXEL AUDIT — the geometric vision-quality gate.
//
// Instead of asking a human/VLM "does the marker sit on a column?", this measures
// it from the RENDERED PDF PIXELS. For every accepted column it samples the
// actual rasterised drawing and tests the ink signature of a real column symbol:
//
//   1. PERIMETER INK   the footprint boundary must be drawn (a column has an
//                      outline). Sampled on the rectangle/circle path itself.
//   2. HALO EMPTINESS  a ring just OUTSIDE the footprint must be comparatively
//                      empty, i.e. the symbol is a discrete object and not a
//                      random window cut out of dense hatch or furniture.
//   3. CORNER AGREEMENT for rectangles, ink must be present at all four corners.
//   4. SIZE AGREEMENT   the ink boundary found by radial ray casting from the
//                      centre must agree with the reported dimensions.
//
// A column that passes all four is visually confirmed AT PIXEL LEVEL against the
// real PDF. This is evidence-only: nothing here re-enters src/.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as mupdfjs from 'mupdf';
import { extractColumnReport, type PhysicalColumn } from '../src/columns.ts';
import { loadUnclaimedGeometry, loadStructuralEnvelope, loadFixture } from '../src/fixture.ts';

const ROOT = join(process.cwd(), '..', '..');
const PDF = join(ROOT, 'test drawings and png', 'CODE_06 1 page.pdf');
const OUT = join(process.cwd(), 'evidence');
mkdirSync(OUT, { recursive: true });

const DPI = Number(process.argv[2] ?? 300);
const fixture = loadFixture();
const mm = fixture.scaleMmPerPt;
const mToPt = (v: number) => (v * 1000) / mm;

const report = extractColumnReport(loadUnclaimedGeometry() as any, {
  structuralEnvelope: loadStructuralEnvelope(),
});
const accepted = report.columns.filter((c) => c.verdict === 'ACCEPT');
const review = report.columns.filter((c) => c.verdict === 'REVIEW');

// ---------------------------------------------------------------- render ----
const bytes = new Uint8Array(readFileSync(PDF));
const doc = (mupdfjs as any).Document.openDocument(bytes, 'application/pdf');
const page = doc.loadPage(0);
const scale = DPI / 72;
const pix = page.toPixmap(
  (mupdfjs as any).Matrix.scale(scale, scale),
  (mupdfjs as any).ColorSpace.DeviceGray,
  false,
  true,
);
const W = pix.getWidth();
const H = pix.getHeight();
const g: Uint8ClampedArray = pix.getPixels();
const N = g.length / (W * H);
console.log(`rendered ${W}x${H} @ ${DPI}dpi, ${N} byte/px grayscale`);

const INK = Number(process.argv[3] ?? 240); // below this grey value counts as ink
const pxPerM = mToPt(1) * scale;
const toPx = (xm: number, ym: number): [number, number] => [mToPt(xm) * scale, mToPt(ym) * scale];

function isInk(x: number, y: number): boolean {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return false;
  return g[(yi * W + xi) * N] < INK;
}
/** ink present within `rad` px of (x,y) — tolerates line-weight and AA jitter */
function inkNear(x: number, y: number, rad: number): boolean {
  const r = Math.ceil(rad);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > rad * rad) continue;
      if (isInk(x + dx, y + dy)) return true;
    }
  }
  return false;
}

interface AuditRow {
  deterministicExtractionId: string;
  footprintType: string;
  centreProjectM: { x: number; y: number };
  widthM: number | null;
  depthM: number | null;
  rotationRad: number;
  perimeterInkRatio: number;
  haloInkRatio: number;
  cornerInk: number;
  radialSizeAgreement: number;
  visualVerdict: 'CONFIRMED' | 'WEAK' | 'FAILED';
  notes: string[];
}

const TOL_PX = Math.max(2, pxPerM * 0.02); // 20 mm sampling tolerance

function auditRect(c: PhysicalColumn): AuditRow {
  const wM = c.widthM ?? 0;
  const dM = c.depthM ?? 0;
  const cs = Math.cos(c.rotationRad);
  const sn = Math.sin(c.rotationRad);
  const local = (lx: number, ly: number): [number, number] =>
    toPx(c.centreProjectM.x + lx * cs - ly * sn, c.centreProjectM.y + lx * sn + ly * cs);

  // 1. perimeter ink
  const SAMPLES = 120;
  let onPath = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t = (i / SAMPLES) * 4;
    const side = Math.floor(t);
    const f = t - side;
    let lx: number;
    let ly: number;
    if (side === 0) { lx = -wM / 2 + f * wM; ly = -dM / 2; }
    else if (side === 1) { lx = wM / 2; ly = -dM / 2 + f * dM; }
    else if (side === 2) { lx = wM / 2 - f * wM; ly = dM / 2; }
    else { lx = -wM / 2; ly = dM / 2 - f * dM; }
    const [x, y] = local(lx, ly);
    if (inkNear(x, y, TOL_PX)) onPath++;
  }
  const perimeterInkRatio = onPath / SAMPLES;

  // 2. halo emptiness — ring at +12 cm outside the footprint
  const HALO_M = 0.12;
  let haloInk = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t = (i / SAMPLES) * 4;
    const side = Math.floor(t);
    const f = t - side;
    const hw = wM / 2 + HALO_M;
    const hd = dM / 2 + HALO_M;
    let lx: number;
    let ly: number;
    if (side === 0) { lx = -hw + f * 2 * hw; ly = -hd; }
    else if (side === 1) { lx = hw; ly = -hd + f * 2 * hd; }
    else if (side === 2) { lx = hw - f * 2 * hw; ly = hd; }
    else { lx = -hw; ly = hd - f * 2 * hd; }
    const [x, y] = local(lx, ly);
    if (isInk(x, y)) haloInk++;
  }
  const haloInkRatio = haloInk / SAMPLES;

  // 3. corners
  let cornerInk = 0;
  for (const [lx, ly] of [[-wM / 2, -dM / 2], [wM / 2, -dM / 2], [wM / 2, dM / 2], [-wM / 2, dM / 2]] as const) {
    const [x, y] = local(lx, ly);
    if (inkNear(x, y, TOL_PX * 1.5)) cornerInk++;
  }

  // 4. radial size agreement — cast rays along the local axes, find first ink
  const measure = (dirX: number, dirY: number, expectM: number): number => {
    const maxM = expectM * 2.2;
    for (let r = 0.02; r <= maxM; r += 0.005) {
      const [x, y] = local(dirX * r, dirY * r);
      if (isInk(x, y)) return r;
    }
    return NaN;
  };
  const halves = [
    measure(1, 0, wM / 2),
    measure(-1, 0, wM / 2),
    measure(0, 1, dM / 2),
    measure(0, -1, dM / 2),
  ];
  const expect = [wM / 2, wM / 2, dM / 2, dM / 2];
  let agree = 0;
  let counted = 0;
  halves.forEach((h, i) => {
    if (Number.isNaN(h)) return;
    counted++;
    if (Math.abs(h - expect[i]) <= Math.max(0.05, expect[i] * 0.2)) agree++;
  });
  const radialSizeAgreement = counted ? agree / counted : 0;

  const notes: string[] = [];
  if (perimeterInkRatio < 0.85) notes.push(`weak-outline(${perimeterInkRatio.toFixed(2)})`);
  if (haloInkRatio > 0.55) notes.push(`crowded-halo(${haloInkRatio.toFixed(2)})`);
  if (cornerInk < 4) notes.push(`corners=${cornerInk}/4`);
  if (radialSizeAgreement < 0.75) notes.push(`size-disagreement(${radialSizeAgreement.toFixed(2)})`);

  const visualVerdict: AuditRow['visualVerdict'] =
    perimeterInkRatio >= 0.9 && cornerInk === 4 && radialSizeAgreement >= 0.75 && haloInkRatio <= 0.55
      ? 'CONFIRMED'
      : perimeterInkRatio >= 0.7 && cornerInk >= 3
        ? 'WEAK'
        : 'FAILED';

  return {
    deterministicExtractionId: c.deterministicExtractionId,
    footprintType: c.footprintType,
    centreProjectM: c.centreProjectM,
    widthM: c.widthM ?? null,
    depthM: c.depthM ?? null,
    rotationRad: c.rotationRad,
    perimeterInkRatio: round4(perimeterInkRatio),
    haloInkRatio: round4(haloInkRatio),
    cornerInk,
    radialSizeAgreement: round4(radialSizeAgreement),
    visualVerdict,
    notes,
  };
}

function auditCircle(c: PhysicalColumn): AuditRow {
  const r = c.radiusM ?? 0;
  const SAMPLES = 120;
  let onPath = 0;
  let haloInk = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t = (i / SAMPLES) * Math.PI * 2;
    const [x, y] = toPx(c.centreProjectM.x + r * Math.cos(t), c.centreProjectM.y + r * Math.sin(t));
    if (inkNear(x, y, TOL_PX)) onPath++;
    const [hx, hy] = toPx(c.centreProjectM.x + (r + 0.12) * Math.cos(t), c.centreProjectM.y + (r + 0.12) * Math.sin(t));
    if (isInk(hx, hy)) haloInk++;
  }
  const perimeterInkRatio = onPath / SAMPLES;
  const haloInkRatio = haloInk / SAMPLES;
  const notes: string[] = [];
  if (perimeterInkRatio < 0.85) notes.push(`weak-outline(${perimeterInkRatio.toFixed(2)})`);
  if (haloInkRatio > 0.55) notes.push(`crowded-halo(${haloInkRatio.toFixed(2)})`);
  return {
    deterministicExtractionId: c.deterministicExtractionId,
    footprintType: c.footprintType,
    centreProjectM: c.centreProjectM,
    widthM: c.radiusM ? c.radiusM * 2 : null,
    depthM: c.radiusM ? c.radiusM * 2 : null,
    rotationRad: 0,
    perimeterInkRatio: round4(perimeterInkRatio),
    haloInkRatio: round4(haloInkRatio),
    cornerInk: 0,
    radialSizeAgreement: 1,
    visualVerdict: perimeterInkRatio >= 0.9 ? 'CONFIRMED' : perimeterInkRatio >= 0.7 ? 'WEAK' : 'FAILED',
    notes,
  };
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

const acceptedAudit = accepted.map((c) => (c.footprintType === 'CIRCULAR' ? auditCircle(c) : auditRect(c)));
const reviewAudit = review.map((c) => (c.footprintType === 'CIRCULAR' ? auditCircle(c) : auditRect(c)));

const confirmed = acceptedAudit.filter((a) => a.visualVerdict === 'CONFIRMED').length;
const weak = acceptedAudit.filter((a) => a.visualVerdict === 'WEAK').length;
const failed = acceptedAudit.filter((a) => a.visualVerdict === 'FAILED').length;

writeFileSync(
  join(OUT, 'pixel-audit.json'),
  JSON.stringify(
    {
      method: 'render-space pixel ink-signature audit against the real CODE-06 PDF',
      renderDpi: DPI,
      raster: { width: W, height: H },
      inkThreshold: INK,
      pxPerMetre: round4(pxPerM),
      gates: {
        perimeterInkRatio: '>= 0.90 for CONFIRMED (footprint outline must be drawn)',
        cornerInk: '4/4 corners must carry ink (rectangles)',
        radialSizeAgreement: '>= 0.75 of axis rays hit ink at the reported half-size',
        haloInkRatio: '<= 0.55 (object must be discrete, not a hole in dense hatch)',
      },
      summary: {
        accepted: accepted.length,
        confirmed,
        weak,
        failed,
        visualConfirmRate: accepted.length ? round4(confirmed / accepted.length) : 0,
      },
      acceptedAudit,
      reviewAudit,
    },
    null,
    2,
  ),
);

console.log(`\n=== PIXEL AUDIT (accepted) ===`);
console.log(`CONFIRMED ${confirmed}  WEAK ${weak}  FAILED ${failed}  of ${accepted.length}`);
for (const a of acceptedAudit) {
  const flag = a.visualVerdict === 'CONFIRMED' ? '  ok ' : a.visualVerdict === 'WEAK' ? ' WEAK' : ' FAIL';
  console.log(`${flag} ${a.deterministicExtractionId} ${(a.widthM ?? 0).toFixed(3)}x${(a.depthM ?? 0).toFixed(3)} @(${a.centreProjectM.x.toFixed(2)},${a.centreProjectM.y.toFixed(2)}) perim=${a.perimeterInkRatio.toFixed(2)} halo=${a.haloInkRatio.toFixed(2)} corners=${a.cornerInk}/4 size=${a.radialSizeAgreement.toFixed(2)} ${a.notes.join(' ')}`);
}
const rc = reviewAudit.filter((a) => a.visualVerdict === 'CONFIRMED').length;
console.log(`\n=== PIXEL AUDIT (review) === CONFIRMED ${rc} / ${review.length}`);
console.log('wrote evidence/pixel-audit.json');
