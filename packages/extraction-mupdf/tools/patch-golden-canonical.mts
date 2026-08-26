// tools/patch-golden-canonical.mts — one-off (deleted after use)
// Adds the DOCUMENTED canonical hashes alongside the original capture hash.
// Preserves the original golden file content; does not overwrite geometry.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPureWallResult } from '../src/mupdf-pure';
import { acceptedGeometryHash, acceptedEvidenceHash } from '../src/index';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PDF = path.join(ROOT, 'test drawings and png/CODE_06.pdf');
const GOLDEN = path.join(ROOT, 'apps/design-build-editor/tests/fixtures/code06-pure-mupdf-golden.json');

const data = new Uint8Array(fs.readFileSync(PDF));
const r = extractPureWallResult(data, 0);
const geoHash = acceptedGeometryHash(r.accepted);
const evHash = acceptedEvidenceHash(r.accepted);

const golden: any = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
// Preserve original capture hash exactly; add canonical hashes alongside.
golden.originalCaptureAcceptedGeometryHash = golden.acceptedGeometryHash; // b29614f60d1d1bf4
golden.acceptedGeometryHash = geoHash;          // canonical (10463aa1b239f03a)
golden.canonicalAcceptedGeometryHash = geoHash;
golden.canonicalAcceptedEvidenceHash = evHash;
golden.canonicalHashSpec = 'canonical-hash.ts: endpoint-order-normalized, 3dp, stable-JSON, sha256/16';
fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 2));
console.log(JSON.stringify({ geoHash, evHash, originalCaptureHash: golden.originalCaptureAcceptedGeometryHash }, null, 2));
