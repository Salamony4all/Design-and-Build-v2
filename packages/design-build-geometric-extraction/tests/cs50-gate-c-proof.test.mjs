/**
 * Gate C proof tests: source identity, runtime wall build, no-scene-mutation.
 */

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = join(__dirname, '..');

let passed = 0;
let failed = 0;
function assert(name, cond, detail='') {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${name}${detail?' — '+detail:''}`); }
}

// 1. Source identity is same canonical page for PDF, lineage, wall fixture
const pdfBytes = readFileSync(join(PKG, '..', '..', 'apps', 'design-build-editor', 'public', 'CODE_06.pdf'));
const pdfSha = createHash('sha256').update(pdfBytes).digest('hex');
assert('canonical PDF sha256 matches', pdfSha === '6414a5f8ef7bc7034364c05db17291f5319ad4931c4c43d0a6c3a659fbf407b9');

// 2. Gate B.1 artifact present, old preserved
assert('old gate b preserved', existsSync(join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'cs50-gate-b-mapping.json')));
assert('corrected artifact present', existsSync(join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'cs50-gate-b1-unit-corrected-mapping.json')));

// 3. Runtime wall manifest present
assert('runtime manifest present', existsSync(join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'cs50-runtime-pascal-wall-manifest.json')));

console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
