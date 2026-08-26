// tools/diagnose-hash.mts — one-off diagnostic (deleted after use)
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractPureWallResult } from '../src/mupdf-pure';
import { canonicalAcceptedGeometryHash } from '../src/index';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PDF = path.join(ROOT, 'test drawings and png/CODE_06.pdf');
const GOLDEN = path.join(ROOT, 'apps/design-build-editor/tests/fixtures/code06-pure-mupdf-golden.json');

const data = new Uint8Array(fs.readFileSync(PDF));
const r = extractPureWallResult(data, 0);
const liveHash = canonicalAcceptedGeometryHash(r.accepted);
const golden: any = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));

console.log('liveHash   =', liveHash);
console.log('goldenHash =', golden.acceptedGeometryHash);
console.log('liveCount  =', r.accepted.length, 'goldenCount =', golden.accepted.length);

// Compare by physicalWallId
const gById = new Map(golden.accepted.map((w: any) => [w.physicalWallId, w]));
let diffs = 0;
for (const w of r.accepted) {
  const g = gById.get(w.physicalWallId);
  if (!g) { console.log('MISSING in golden:', w.physicalWallId); diffs++; continue; }
  const rnd = (n: number) => Math.round(n * 1000) / 1000;
  const same =
    rnd(w.centerline.a.x) === rnd(g.a.x) && rnd(w.centerline.a.y) === rnd(g.a.y) &&
    rnd(w.centerline.b.x) === rnd(g.b.x) && rnd(w.centerline.b.y) === rnd(g.b.y) &&
    rnd(w.thickness) === rnd(g.thickness) && rnd(w.confidence) === rnd(g.confidence);
  if (!same) {
    diffs++;
    if (diffs <= 8) console.log('DIFF', w.physicalWallId,
      'live a/b/t/c', rnd(w.centerline.a.x), rnd(w.centerline.a.y), rnd(w.centerline.b.x), rnd(w.centerline.b.y), rnd(w.thickness), rnd(w.confidence),
      '| golden', rnd(g.a.x), rnd(g.a.y), rnd(g.b.x), rnd(g.b.y), rnd(g.thickness), rnd(g.confidence));
  }
}
console.log('total diffs =', diffs);

// Recompute golden hash from golden.accepted to see if golden's stored hash is self-consistent
const rnd = (n: number) => Math.round(n * 1000) / 1000;
const goldenCanon = golden.accepted.map((w: any) =>
  [w.physicalWallId, rnd(w.a.x), rnd(w.a.y), rnd(w.b.x), rnd(w.b.y), rnd(w.thickness), rnd(w.confidence)].join(','),
).sort().join(';');
console.log('recomputed golden hash from golden.accepted =', crypto.createHash('sha256').update(goldenCanon).digest('hex').slice(0, 16));
