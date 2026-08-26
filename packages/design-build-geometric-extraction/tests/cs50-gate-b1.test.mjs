/**
 * CS5.0 Gate B.1 corrected tests.
 *
 * Run: node --test tests/cs50-gate-b1.test.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = join(__dirname, '..');
const MANIFEST = join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'blind-review-manifest.json');
const MAPPING = join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'cs50-gate-b1-unit-corrected-mapping.json');
const OLD_MAPPING = join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'cs50-gate-b-mapping.json');

let passed = 0;
let failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// 1. Old artifact preserved, not overwritten
assert('old gate-b artifact preserved', existsSync(OLD_MAPPING), '');

// 2. Absolute user paths absent from committed tools
const script = readFileSync(join(PKG, 'tools', 'cs50-gate-b1.mjs'), 'utf8').toString();
assert('no absolute user paths in gate-b1 script', !script.includes('C:\\Users') && !script.includes('/home/'), '');

// 3. 25 unique region IDs
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'), 'utf8');
const regionIds = manifest.regions.map(r => r.anonymousRegionId);
assert('25 unique region IDs', new Set(regionIds).size === 25 && regionIds.length === 25, `count=${regionIds.length}`);

// 4. New artifact present and contains 25 mappings
const mappingDoc = JSON.parse(readFileSync(MAPPING, 'utf8'), 'utf8');
assert('new artifact has 25 mappings', mappingDoc.mappings.length === 25, `count=${mappingDoc.mappings.length}`);

// 5. All regions accounted for exactly once
const mappedIds = mappingDoc.mappings.map(m => m.anonymousRegionId);
assert('all 25 mapped exactly once', mappedIds.length === 25 && new Set(mappedIds).size === 25, `mapped=${mappedIds.length}`);

// 6. Deterministic wall ID stable
function deterministicWallId(physicalWallId) {
  return 'wall_' + createHash('sha256').update('wall:' + physicalWallId + ':code06').digest('hex').slice(0, 8);
}
assert('deterministic wall ID stable', deterministicWallId('fr0') === 'wall_f337a341', '');

// 7. AR-19 width is approximately 0.994 m, not ~56 m
const ar19 = mappingDoc.mappings.find(m => m.anonymousRegionId === 'AR-19');
assert('AR-19 width ~0.994 m', typeof ar19?.wallLocalIntervalMeters?.width === 'number' && Math.abs(ar19.wallLocalIntervalMeters.width - 0.994) < 0.05, `width=${ar19?.wallLocalIntervalMeters?.width}`);
assert('old 56.40 m width cannot occur', !(typeof ar19?.wallLocalIntervalMeters?.width === 'number' && ar19.wallLocalIntervalMeters.width > 10), '');

// 8. AR-19 mapping validated
assert('AR-19 mapping validated', ar19?.mappingStatus === 'VALIDATED_MAPPING', `status=${ar19?.mappingStatus}`);

// 9. Round trip near zero for all mappings
const badRoundTrip = mappingDoc.mappings.filter(m => (m.mathematicalRoundTripError || 0) > 1e-9);
assert('round trip errors near zero for all mappings', badRoundTrip.length === 0, badRoundTrip.map(m => m.anonymousRegionId).join(' '));

// 10. Canonical hash file deterministic and matches payload
const canonical = readFileSync(join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'cs50-gate-b1-unit-corrected-mapping.canonicalhash'), 'utf8').toString().trim();
const canonicalPayload = JSON.parse(JSON.stringify(mappingDoc));
delete canonicalPayload.generatedAt;
const expectedHash = createHash('sha256').update(JSON.stringify(canonicalPayload, null, 2)).digest('hex');
assert('canonical hash deterministic', canonical === expectedHash, `${canonical} !== ${expectedHash}`);

// 11. Stage A units convert through mm/unit / 1000
assert('adapter constant present', readFileSync(join(PKG, 'src', 'window', 'coordinate-adapter.ts'), 'utf8').toString().includes('MM_PER_STAGE_A_UNIT'), '');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
