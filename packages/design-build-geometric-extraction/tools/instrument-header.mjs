// CS4.4: instrument vector operations with stable source identity + path bounds.
// Diagnostic wrapper — does not change wall extraction behavior.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import * as mpdf from 'mupdf';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PDF = join(ROOT, '..', '..', '..', 'apps', 'design-build-editor', 'public', 'CODE_06.pdf');
const OUT = join(ROOT, 'evidence', 'code06', 'vector-provenance');
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'crops'), { recursive: true });