// FALSE-NEGATIVE SWEEP — render-space search for column-like ink islands that
// production did NOT report.
//
// Independent of both the vector extractor and the cavity oracle: it works only
// on the rendered raster of the real PDF. It scans the structural envelope for
// closed, compact, isolated ink outlines matching the physical column size band,
// then subtracts everything production already reported. Whatever remains is a
// candidate miss and is written to evidence/fn-sweep.json for review.
//
// EVIDENCE ONLY — never imported by src/.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as mupdfjs from 'mupdf';
import { extractColumnReport } from '../src/columns.ts';
import { loadUnclaimedGeometry, loadStructuralEnvelope, loadFixture } from '../src/fixture.ts';

const ROOT = join(process.cwd(), '..', '..');
const PDF = join(ROOT, 'test drawings and png', 'CODE_06 1 page.pdf');
const OUT = join(process.cwd(), 'evidence');
mkdirSync(OUT, { recursive: true });

const DPI = Number(process.argv[2] ?? 150);
const INK = Number(process.argv[3] ?? 240);
const fx = loadFixture();
const mm = fx.scaleMmPerPt;
const mToPt = (v: number) => (v * 1000) / mm;
const ptToM = (v: number) => (v * mm) / 1000;

const env = loadStructuralEnvelope()!;
const report = extractColumnReport(loadUnclaimedGeometry() as any, { structuralEnvelope: env });

const scale = DPI / 72;
const bytes = new Uint8Array(readFileSync(PDF));
const doc = (mupdfjs as any).Document.openDocument(bytes, 'application/pdf');
const page = doc.loadPage(0);
const pix = page.toPixmap((mupdfjs as any).Matrix.scale(scale, scale), (mupdfjs as any).ColorSpace.DeviceGray, false, true);
const W = pix.getWidth(), H = pix.getHeight();
const g = pix.getPixels();
console.log(`render ${W}x${H} @${DPI}dpi ink<${INK}`);

const ink = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) ink[i] = g[i] < INK ? 1 : 0;

// restrict to the structural envelope
const ex0 = Math.max(0, Math.floor(env.minX * scale));
const ey0 = Math.max(0, Math.floor(env.minY * scale));
const ex1 = Math.min(W - 1, Math.ceil(env.maxX * scale));
const ey1 = Math.min(H - 1, Math.ceil(env.maxY * scale));

// exterior flood inside the envelope window, then enclosed cavities
const seen = new Uint8Array(W * H);
const st: number[] = [];
for (let x = ex0; x <= ex1; x++) for (const y of [ey0, ey1]) { const i = y * W + x; if (!ink[i] && !seen[i]) { seen[i] = 1; st.push(i); } }
for (let y = ey0; y <= ey1; y++) for (const x of [ex0, ex1]) { const i = y * W + x; if (!ink[i] && !seen[i]) { seen[i] = 1; st.push(i); } }
while (st.length) {
  const c = st.pop()!;
  const cx = c % W, cy = (c / W) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < ex0 || ny < ey0 || nx > ex1 || ny > ey1) continue;
    const n = ny * W + nx;
    if (!ink[n] && !seen[n]) { seen[n] = 1; st.push(n); }
  }
}

const pxPerM = mToPt(1) * scale;
const MIN_M = 0.22, MAX_M = 1.3;
interface Cand { cxM: number; cyM: number; wM: number; hM: number; occ: number; cells: number }
const cands: Cand[] = [];
const vis = new Uint8Array(W * H);
for (let y = ey0; y <= ey1; y++) {
  for (let x = ex0; x <= ex1; x++) {
    const s = y * W + x;
    if (ink[s] || seen[s] || vis[s]) continue;
    const cells: number[] = [];
    st.length = 0; st.push(s); vis[s] = 1;
    let bx0 = x, by0 = y, bx1 = x, by1 = y;
    let overflow = false;
    while (st.length) {
      const c = st.pop()!;
      cells.push(c);
      const ccx = c % W, ccy = (c / W) | 0;
      if (ccx < bx0) bx0 = ccx; if (ccx > bx1) bx1 = ccx;
      if (ccy < by0) by0 = ccy; if (ccy > by1) by1 = ccy;
      if ((bx1 - bx0) / pxPerM > MAX_M * 1.5 || (by1 - by0) / pxPerM > MAX_M * 1.5) { overflow = true; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = ccx + dx, ny = ccy + dy;
        if (nx < ex0 || ny < ey0 || nx > ex1 || ny > ey1) continue;
        const n = ny * W + nx;
        if (!ink[n] && !seen[n] && !vis[n]) { vis[n] = 1; st.push(n); }
      }
    }
    if (overflow) continue;
    const bw = (bx1 - bx0 + 1) / pxPerM, bh = (by1 - by0 + 1) / pxPerM;
    if (Math.min(bw, bh) < MIN_M || Math.max(bw, bh) > MAX_M) continue;
    const occ = cells.length / ((bx1 - bx0 + 1) * (by1 - by0 + 1));
    if (occ < 0.82) continue;                      // must be a solid convex void
    if (Math.max(bw, bh) / Math.min(bw, bh) > 2.6) continue;
    cands.push({
      cxM: ptToM((bx0 + bx1 + 1) / 2 / scale),
      cyM: ptToM((by0 + by1 + 1) / 2 / scale),
      wM: bw, hM: bh, occ, cells: cells.length,
    });
  }
}
console.log(`raster column-like cavities in envelope: ${cands.length}`);

// subtract production output
const MATCH_M = 0.35;
const unmatched = cands.filter((c) =>
  !report.columns.some((p) => Math.hypot(p.centreProjectM.x - c.cxM, p.centreProjectM.y - c.cyM) <= MATCH_M));
const matchedAcc = cands.filter((c) =>
  report.columns.some((p) => p.verdict === 'ACCEPT' && Math.hypot(p.centreProjectM.x - c.cxM, p.centreProjectM.y - c.cyM) <= MATCH_M));

console.log(`matched by production: ${cands.length - unmatched.length}  (accept-matched ${matchedAcc.length})`);
console.log(`UNMATCHED raster candidates: ${unmatched.length}`);
const buckets = new Map<string, number>();
for (const u of unmatched) {
  const k = `${(Math.round(u.wM * 20) / 20).toFixed(2)}x${(Math.round(u.hM * 20) / 20).toFixed(2)}`;
  buckets.set(k, (buckets.get(k) ?? 0) + 1);
}
console.log('unmatched size buckets:', [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20));
for (const u of unmatched.slice(0, 30)) {
  console.log(`   ${u.wM.toFixed(3)}x${u.hM.toFixed(3)}m occ=${u.occ.toFixed(2)} @(${u.cxM.toFixed(2)},${u.cyM.toFixed(2)})`);
}

writeFileSync(join(OUT, 'fn-sweep.json'), JSON.stringify({
  method: 'render-space enclosed-cavity sweep of the real PDF inside the structural envelope',
  renderDpi: DPI, inkThreshold: INK,
  gates: { minSideM: MIN_M, maxSideM: MAX_M, minOccupancy: 0.82, maxAspect: 2.6, matchRadiusM: MATCH_M },
  rasterCandidates: cands.length,
  matchedByProduction: cands.length - unmatched.length,
  unmatchedCount: unmatched.length,
  unmatched: unmatched.map((u) => ({
    centreProjectM: { x: round4(u.cxM), y: round4(u.cyM) },
    widthM: round4(u.wM), depthM: round4(u.hM), occupancy: round4(u.occ), cells: u.cells,
  })),
}, null, 2));
function round4(v: number) { return Math.round(v * 1e4) / 1e4; }
console.log('wrote evidence/fn-sweep.json');
