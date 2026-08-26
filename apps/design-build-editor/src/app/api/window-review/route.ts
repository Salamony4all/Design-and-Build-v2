import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..', 'packages', 'design-build-geometric-extraction');
const OUT_DIR = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'human-review-r1.3.2');

function ensureDir() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
}

function manifestHash() {
  const path = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'blind-review-manifest.json');
  const data = readFileSync(path, 'utf8');
  return createHash('sha256').update(data).digest('hex');
}

export async function GET() {
  ensureDir();
  const manifestPath = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'blind-review-manifest.json');
  const decisionsPath = join(OUT_DIR, 'human-review-decisions.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  let decisions: any[] = [];
  if (existsSync(decisionsPath)) {
    decisions = JSON.parse(readFileSync(decisionsPath, 'utf8'));
  }
  return NextResponse.json({ manifest, decisions, sourceManifestHash: manifestHash() });
}

export async function POST(request: Request) {
  ensureDir();
  const body = await request.json().catch(() => ({ decisions: [] }));
  const incoming = Array.isArray(body.decisions) ? body.decisions : [];
  const requiredAuditFields = ['anonymousRegionId', 'openingRegionId', 'humanVerdict', 'physicalWindowQuantity', 'humanNotes', 'reviewedAt', 'reviewerType', 'sourceManifestHash'];
  for (const d of incoming) {
    for (const field of requiredAuditFields) {
      if (!(field in d)) {
        return NextResponse.json({ error: `missing ${field}`, status: 'invalid' }, { status: 400 });
      }
    }
    if (d.reviewerType !== 'HUMAN') {
      return NextResponse.json({ error: `invalid reviewerType=${d.reviewerType}`, status: 'invalid' }, { status: 400 });
    }
    if (d.sourceManifestHash !== manifestHash()) {
      return NextResponse.json({ error: 'stale manifest hash', status: 'invalid' }, { status: 400 });
    }
  }
  const decisionsPath = join(OUT_DIR, 'human-review-decisions.json');
  writeFileSync(decisionsPath, JSON.stringify(incoming, null, 2));
  return NextResponse.json({ saved: incoming.length, status: 'ok' });
}
