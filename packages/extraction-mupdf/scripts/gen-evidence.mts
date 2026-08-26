// VISUAL EVIDENCE GENERATOR (test/evidence only — never imported by production).
// Renders the canonical CODE_06 page with deterministic overlay layers:
//   cyan   = DT annotation anchors (PDF_TEXT)
//   green  = accepted physical door assemblies
//   amber  = review assemblies
//   red    = false positives (accepted not matched to an oracle door)
//   yellow = missed oracle doors (no matched assembly)
//   purple = wrong/ambiguous host
// Emits evidence.html (PDF embedded + SVG overlay) and a JSON ledger.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { extractPureWallResult, collectPageVectors, runDoorPipeline, mupdf, PURE_DOOR_DEFAULTS, extractDoorPrimitives } from '../src/index';
import { captureDoorAnnotations, DEFAULT_ANNOTATION_OPTIONS } from 'design-build-extraction-annotations';
import { extractDoorPrimitives as edp } from '../src/mupdf-pure-doors';

const ROOT = process.cwd();
const PDF = join(ROOT, '..', '..', 'test drawings and png', 'CODE_06 1 page.pdf');
const MAN = join(ROOT, '..', '..', '.hermes', 'extracted_doors', 'door_extraction_manifest.json');
const OUT = join(ROOT, 'scripts', 'evidence');

const bytes = new Uint8Array(readFileSync(PDF));
const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf');
const page = doc.loadPage(0);
const pb = page.getBounds() as any; // [x0,y0,x1,y1]
const W = pb[2] - pb[0], H = pb[3] - pb[1];

const cap = collectPageVectors(page, false, 0);
const wr = extractPureWallResult(bytes, 0, undefined, undefined, true) as any;
const AUD = JSON.parse(readFileSync(MAN, 'utf8'));
const ann = captureDoorAnnotations(page, DEFAULT_ANNOTATION_OPTIONS, undefined, 0);
const res = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: pb, annotations: ann.annotations, annotationIndex: ann.index, annotationCaptureMs: 0 }, PURE_DOOR_DEFAULTS, false) as any;
const prim = edp(cap.vectors, wr.pureResult.accepted, wr.pureResult.scaleMmPerPt, PURE_DOOR_DEFAULTS);

function mid(p: any) { return { x: (p.a[0] + p.b[0]) / 2, y: (p.a[1] + p.b[1]) / 2 }; }
function dist(a: any, b: any) { return Math.hypot(a.x - b.x, a.y - b.y); }

// one-to-one match (production leaf geometry)
type Edge = { a: number; d: number; cost: number };
const edges: Edge[] = [];
res.accepted.forEach((a: any, ai: number) => {
  const id = a.leafSegmentIds[0]; const l = prim.leaves.find((x: any) => x.id === id); if (!l) return;
  const am = { x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 };
  (AUD.doors as any[]).forEach((d, di) => { const c = dist(am, mid(d.leafCandidate)); if (c <= 90) edges.push({ a: ai, d: di, cost: c }); });
});
edges.sort((x, y) => x.cost - y.cost || x.a - y.a || x.d - y.d);
const usedA = new Set<number>(), usedD = new Set<number>();
const matchedA = new Set<number>(), matchedD = new Set<number>();
for (const e of edges) { if (usedA.has(e.a) || usedD.has(e.d)) continue; usedA.add(e.a); usedD.add(e.d); matchedA.add(e.a); matchedD.add(e.d); }

const svgShapes: string[] = [];
// annotation anchors cyan
for (const a of ann.annotations) {
  const [x, y] = a.centrePdf;
  svgShapes.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="none" stroke="cyan" stroke-width="1.5"/><text x="${(x+8).toFixed(1)}" y="${(y+4).toFixed(1)}" fill="cyan" font-size="8">${a.normalizedText}</text>`);
}
// accepted on correct host -> green; FP -> red; wrong host -> purple
res.accepted.forEach((a: any, i: number) => {
  const id = a.leafSegmentIds[0]; const l = prim.leaves.find((x: any) => x.id === id); if (!l) return;
  const x = (l.a.x + l.b.x) / 2, y = (l.a.y + l.b.y) / 2;
  const isFp = !matchedA.has(i);
  const color = isFp ? 'red' : 'green';
  svgShapes.push(`<rect x="${(x-7).toFixed(1)}" y="${(y-7).toFixed(1)}" width="14" height="14" fill="none" stroke="${color}" stroke-width="2"/><text x="${(x+10).toFixed(1)}" y="${(y-8).toFixed(1)}" fill="${color}" font-size="7">${a.doorAssemblyId}</text>`);
});
// missed oracle doors yellow
(AUD.doors as any[]).forEach((d, i) => { if (matchedD.has(i)) return; const lm = mid(d.leafCandidate); svgShapes.push(`<circle cx="${lm.x.toFixed(1)}" cy="${lm.y.toFixed(1)}" r="9" fill="none" stroke="yellow" stroke-width="2"/><text x="${(lm.x+11).toFixed(1)}" y="${(lm.y+4).toFixed(1)}" fill="yellow" font-size="8">${d.id} MISS</text>`); });
// review amber (outline only)
for (const a of res.review) {
  const id = a.leafSegmentIds?.[0]; if (!id) continue; const l = prim.leaves.find((x: any) => x.id === id); if (!l) continue;
  const x = (l.a.x + l.b.x) / 2, y = (l.a.y + l.b.y) / 2;
  svgShapes.push(`<rect x="${(x-6).toFixed(1)}" y="${(y-6).toFixed(1)}" width="12" height="12" fill="none" stroke="orange" stroke-width="1" stroke-dasharray="3 2"/>`);
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>CODE_06 Door Extraction Evidence</title>
<style>body{font-family:monospace;background:#111;color:#eee}svg{background:#fff} .legend span{display:inline-block;margin-right:14px}</style></head>
<body><h2>CODE_06 Door Extraction — Hybrid (Pass C) Visual Evidence</h2>
<div class="legend"><span style="color:cyan">○ DT anchor</span><span style="color:green">▢ accepted</span><span style="color:orange">▢ review</span><span style="color:red">▢ false positive</span><span style="color:yellow">○ missed oracle</span></div>
<object data="file://${PDF}" type="application/pdf" width="${W}" height="${H}" style="position:absolute;top:60px;left:0"></object>
<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="position:absolute;top:60px;left:0;pointer-events:none;opacity:0.9">${svgShapes.join('\n')}</svg>
</body></html>`;

import { mkdirSync } from 'fs';
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'evidence.html'), html);
writeFileSync(join(OUT, 'ledger.json'), JSON.stringify({
  pageBounds: pb, width: W, height: H,
  annotations: ann.annotations.map((a: any) => ({ id: a.annotationId, text: a.normalizedText, centre: a.centrePdf })),
  accepted: res.accepted.map((a: any) => ({ id: a.doorAssemblyId, wall: a.selectedPhysicalWallId, evidenceMode: a.evidenceMode, hostStatus: a.hostStatus, interval: a.wallLocalInterval })),
  reviewCount: res.review.length,
  matchedCount: matchedA.size,
  missedDoors: (AUD.doors as any[]).map((d, i) => i).filter((i) => !matchedD.has(i)).map((i) => (AUD.doors as any[])[i].id),
}, null, 2));
console.log('evidence written to', join(OUT, 'evidence.html'));
console.log('annotations:', ann.annotations.length, 'accepted:', res.accepted.length, 'matched:', matchedA.size, 'missed:', (AUD.doors as any[]).length - matchedD.size);
