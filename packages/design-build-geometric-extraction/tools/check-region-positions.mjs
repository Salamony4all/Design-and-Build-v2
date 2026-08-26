import { readFileSync } from 'fs';
import { join } from 'path';

const GOLDEN = '../../apps/design-build-editor/tests/fixtures/code06-pure-mupdf-golden.json';
const MANIFEST = 'evidence/code06/phase-b-clean/blind-r1.3.2/blind-review-manifest.json';

const rawGolden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const walls = new Map((rawGolden.accepted || []).map(w => [w.physicalWallId, w]));

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const regions = manifest.regions || [];

console.log('=== Region Positions in Page Coordinates ===');
for (const r of regions) {
  const wall = walls.get(r.physicalWallId);
  if (!wall) {
    console.log(`${r.anonymousRegionId}: wall not found!`);
    continue;
  }
  const ax = wall.a.x, ay = wall.a.y;
  const bx = wall.b.x, by = wall.b.y;
  const len = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / len, uy = (by - ay) / len;
  
  const start_A = r.rawIntervalUnion.start;
  const end_A = r.rawIntervalUnion.end;
  
  const pStart_A = { x: ax + start_A * ux, y: ay + start_A * uy };
  const pEnd_A = { x: ax + end_A * ux, y: ay + end_A * uy };
  
  // Convert to MediaBox coordinates
  const pStart_media = { x: pStart_A.x / 0.75, y: pStart_A.y / 0.75 };
  const pEnd_media = { x: pEnd_A.x / 0.75, y: pEnd_A.y / 0.75 };
  
  // Convert to top-down page coordinates (CropBox relative)
  // x_page = x_media - 259
  // y_page = 1395.72 - y_media
  const pStart_page = { x: pStart_media.x - 259, y: 1395.72 - pStart_media.y };
  const pEnd_page = { x: pEnd_media.x - 259, y: 1395.72 - pEnd_media.y };
  
  console.log(`${r.anonymousRegionId}: wall=${r.physicalWallId}`);
  console.log(`  Stage A: [${pStart_A.x.toFixed(1)}, ${pStart_A.y.toFixed(1)}] to [${pEnd_A.x.toFixed(1)}, ${pEnd_A.y.toFixed(1)}]`);
  console.log(`  MediaBox: [${pStart_media.x.toFixed(1)}, ${pStart_media.y.toFixed(1)}] to [${pEnd_media.x.toFixed(1)}, ${pEnd_media.y.toFixed(1)}]`);
  console.log(`  PageCoords: [${pStart_page.x.toFixed(1)}, ${pStart_page.y.toFixed(1)}] to [${pEnd_page.x.toFixed(1)}, ${pEnd_page.y.toFixed(1)}]`);
}
