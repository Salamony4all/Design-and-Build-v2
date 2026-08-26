import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const MONO_ROOT = join(__dir, '..', '..', '..', '..', '..', '..', '..');
const EVIDENCE_ROOT = join(MONO_ROOT, 'packages', 'design-build-geometric-extraction', 'evidence', 'code06', 'phase-b-clean');
const ALLOWED_SUFFIXES = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return NextResponse.json({ error: 'invalid asset name' }, { status: 400 });
  }
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  if (!ALLOWED_SUFFIXES.includes(ext)) {
    return NextResponse.json({ error: 'unsupported asset type' }, { status: 400 });
  }
  const searchPaths = [
    join(EVIDENCE_ROOT, 'blind-r1.3.1', 'group-evidence', name),
    join(EVIDENCE_ROOT, 'blind-grammar-v1', 'visual-evidence-r1.3', name),
    join(EVIDENCE_ROOT, 'blind-r1.3.2', name),
    join(EVIDENCE_ROOT, 'blind-r1.3.1', name),
  ];
  let matched = null;
  for (const p of searchPaths) {
    if (existsSync(p)) { matched = p; break; }
  }
  if (!matched) {
    return NextResponse.json({ error: 'asset not found', name, searchPaths }, { status: 404 });
  }
  const data = readFileSync(matched);
  const type =
    ext === '.svg' ? 'image/svg+xml' :
    ext === '.png' ? 'image/png' :
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
    'image/webp';
  return new NextResponse(data, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
}
