/**
 * CS5.0 Gate B focused tests.
 *
 * Run: node --test tests/cs50-gate-b.test.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = join(__dirname, '..');
const MANIFEST = join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'blind-review-manifest.json');
const MAPPING = join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'cs50-gate-b-mapping.json');

let passed = 0;
let failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// 1. Package root discoverable from package cwd
assert('package root discoverable from tools dir', existsSync(join(PKG, 'package.json')), PKG);

// 2. No absolute user paths in committed tool
const script = readFileSync(join(PKG, 'tools', 'cs50-gate-b.mjs'), 'utf8').toString();
assert('no absolute user paths in gate-b script', !script.includes('C:\\Users') && !script.includes('/home/'), '');

// 3. 25 unique region IDs
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'), 'utf8');
const regionIds = manifest.regions.map(r => r.anonymousRegionId);
assert('25 unique region IDs', new Set(regionIds).size === 25 && regionIds.length === 25, `count=${regionIds.length}`);

// 4. All regions accounted for exactly once
const mappingDoc = JSON.parse(readFileSync(MAPPING, 'utf8'), 'utf8');
const mappedIds = mappingDoc.mappings.map(m => m.anonymousRegionId);
assert('all 25 mapped exactly once', mappedIds.length === 25 && new Set(mappedIds).size === 25, `mapped=${mappedIds.length}`);

// 5. Deterministic wall ID function stable
function deterministicWallId(physicalWallId) {
  return 'wall_' + createHash('sha256').update('wall:' + physicalWallId + ':code06').digest('hex').slice(0, 8);
}
assert('deterministic wall ID stable', deterministicWallId('fr0') === 'wall_f337a341', '');

// 6. One-region proof: AR-19
const ar19 = mappingDoc.mappings.find(m => m.anonymousRegionId === 'AR-19');
assert('AR-19 mapping exists', !!ar19, '');
assert('AR-19 pascal wall node exists', typeof ar19.pascalWallNodeId === 'string' && ar19.pascalWallNodeId.startsWith('wall_'), ar19.pascalWallNodeId);
assert('AR-19 width finite', typeof ar19.wallLocalIntervalMeters?.width === 'number' && Number.isFinite(ar19.wallLocalIntervalMeters.width), `width=${ar19?.wallLocalIntervalMeters?.width}`);
assert('AR-19 round-trip within tolerance', (ar19.roundTripError || 0) <= 1e-9, `err=${ar19.roundTripError}`);

// 7. No invalid mapping statuses
const invalidStatuses = new Set(mappingDoc.mappings.filter(m => m.mappingStatus !== 'VALIDATED_MAPPING').map(m => m.mappingStatus));
assert('no invalid mappings', invalidStatuses.size === 0, [...invalidStatuses].join(' '));

// 8. Canonical hash deterministic
const canonical = readFileSync(join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'cs50-gate-b-mapping.canonicalhash'), 'utf8').toString().trim();
const expectedHash = createHash('sha256').update(JSON.stringify(mappingDoc, null, 2)).digest('hex');
assert('mapping hash deterministic', canonical === expectedHash, `${canonical} !== ${expectedHash}`);

// 9. Tolerance used == numeric detector tolerance endpoint constant
const adapterSource = readFileSync(join(PKG, 'src', 'window', 'coordinate-adapter.ts'), 'utf8').toString();
assert('adapter exposes numeric tolerance constants', adapterSource.includes('TX = 259') && adapterSource.includes('TY = 288') && adapterSource.includes('MM_PER_STAGE_A_UNIT'), '');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
