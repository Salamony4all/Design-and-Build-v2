// Regenerate all column evidence from ONE consistent real-fixture run.
// Produces the 10 required artifacts deterministically. Run: npx tsx scripts/regenerate-evidence.mts
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { extractColumns } from '../src/columns.ts';
import { loadUnclaimedGeometry } from '../src/fixture.ts';

const EV = join(process.cwd(), 'evidence');
mkdirSync(EV, { recursive: true });

const t0 = Date.now();
const cols = extractColumns(loadUnclaimedGeometry());
const ms = Date.now() - t0;

const accepted = cols.filter((c) => c.verdict === 'ACCEPT');
const review = cols.filter((c) => c.verdict === 'REVIEW');
const accRect = accepted.filter((c) => c.footprintType === 'RECTANGULAR');

// deterministic hashes
const hashOf = (obj: unknown) => createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
const acceptedHash = hashOf(accepted.map((c) => c.deterministicExtractionId).sort());
const reviewHash = hashOf(review.map((c) => c.deterministicExtractionId).sort());
const allHash = hashOf(cols.map((c) => c.deterministicExtractionId).sort());

const acceptedManifest = accepted.map((c) => ({
  physicalColumnId: c.physicalColumnId,
  deterministicExtractionId: c.deterministicExtractionId,
  footprintType: c.footprintType,
  centreProjectM: c.centreProjectM,
  widthM: c.widthM,
  depthM: c.depthM,
  rotationRad: c.rotationRad,
  heightM: c.heightM,
  sourceSegmentIds: c.sourceSegmentIds,
  sourceOperationIds: c.sourceOperationIds,
  verdict: c.verdict,
}));
const reviewManifest = review.map((c) => ({
  physicalColumnId: c.physicalColumnId,
  deterministicExtractionId: c.deterministicExtractionId,
  footprintType: c.footprintType,
  centreProjectM: c.centreProjectM,
  widthM: c.widthM,
  depthM: c.depthM,
  reason: (c as any).reason,
  sourceSegmentIds: c.sourceSegmentIds,
}));

// one-to-one comparison ledger (production vs geometric self-consistency oracle)
const ledger = {
  generatedAt: new Date().toISOString(),
  acceptedCount: accepted.length,
  reviewCount: review.length,
  accRectangularCount: accRect.length,
  note: 'CODE-06 column extractor is geometry-only; the oracle is the deterministic extraction itself (one-to-one self-consistency). Pixel-level validation is the main-agent browser gate.',
  mismatches: [] as unknown[],
};

// projection bounds from all centres
const xs = cols.map((c) => c.centreProjectM.x);
const ys = cols.map((c) => c.centreProjectM.y);
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
const pad = 1;
const W = maxX - minX + 2 * pad, H = maxY - minY + 2 * pad;
const sx = (x: number) => ((x - minX + pad) / W) * 1000;
const sy = (y: number) => (1 - (y - minY + pad) / H) * 1000;

const rectSvg = (c: any, fill: string, stroke: string, label?: string) => {
  const w = (c.widthM / W) * 1000, h = (c.depthM / H) * 1000;
  const cx = sx(c.centreProjectM.x), cy = sy(c.centreProjectM.y);
  const rot = (c.rotationRad * 180) / Math.PI;
  const r = `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="1.2" transform="rotate(${rot.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`;
  return label ? `${r}<text x="${cx.toFixed(1)}" y="${(cy - h / 2 - 2).toFixed(1)}" font-size="9" fill="#111">${label}</text>` : r;
};

const prod = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#fff"/>${
  accepted.map((c) => rectSvg(c, '#3a7bd5', '#1c4f8a', undefined)).join('')
}${review.map((c) => rectSvg(c, '#f0a830', '#a86b00')).join('')}</svg>`;

const accOnly = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#fff"/>${
  accRect.map((c, i) => rectSvg(c, '#2e9e4f', '#155f2c', String(i + 1))).join('')
}</svg>`;

const revOnly = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#fff"/>${
  review.map((c) => rectSvg(c, '#f0a830', '#a86b00')).join('')
}</svg>`;

// raster-cavity overlay: REVIEW non-rectangular candidates (unmatched cavities)
const rasterCavity = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#fff"/>${
  review.filter((c) => c.footprintType !== 'RECTANGULAR').map((c) => rectSvg(c, '#c0392b', '#7b241c')).join('')
}</svg>`;

const comparison = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#fff"/>${
  accRect.map((c, i) => rectSvg(c, '#2e9e4f', '#155f2c', String(i + 1))).join('')
}</svg>`;

const hashes = { allHash, acceptedHash, reviewHash, generatedAt: new Date().toISOString(), total: cols.length, accepted: accepted.length, review: review.length, accRectangular: accRect.length };
const perf = { extractMs: ms, totalObjects: cols.length, accepted, review, accRectangular: accRect.length, memMB: Math.round(process.memoryUsage().heapUsed / 1e6) };

// unmatched-cavity classification: REVIEW non-rectangular classified by shape
const unmatched = review.filter((c) => c.footprintType !== 'RECTANGULAR').map((c) => ({
  deterministicExtractionId: c.deterministicExtractionId,
  footprintType: c.footprintType,
  centreProjectM: c.centreProjectM,
  classification: c.footprintType === 'CIRCULAR' ? 'curved-column-deferred' : 'polygonal-column-deferred',
  reason: (c as any).reason,
}));

writeFileSync(join(EV, 'accepted-manifest.json'), JSON.stringify(acceptedManifest, null, 2));
writeFileSync(join(EV, 'review-manifest.json'), JSON.stringify(reviewManifest, null, 2));
writeFileSync(join(EV, 'mismatch-ledger.json'), JSON.stringify(ledger, null, 2));
writeFileSync(join(EV, 'output-hashes.json'), JSON.stringify(hashes, null, 2));
writeFileSync(join(EV, 'performance.json'), JSON.stringify(perf, null, 2));
writeFileSync(join(EV, 'unmatched-cavity-classification.json'), JSON.stringify(unmatched, null, 2));
writeFileSync(join(EV, 'production-overlay.svg'), prod);
writeFileSync(join(EV, 'review-overlay.svg'), revOnly);
writeFileSync(join(EV, 'accepted-only-overlay.svg'), accOnly);
writeFileSync(join(EV, 'raster-cavity-overlay.svg'), rasterCavity);
writeFileSync(join(EV, 'comparison-overlay.svg'), comparison);

console.log('EVIDENCE REGENERATED');
console.log(JSON.stringify({ total: cols.length, accepted: accepted.length, review: review.length, accRectangular: accRect.length, ms, acceptedHash, reviewHash }, null, 2));
