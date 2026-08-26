/**
 * R1.3.1 Group-Level Visual Evidence Generator
 *
 * Reads the R1.3.1 accounting report and produces:
 * - groups-overview.svg
 * - multi-candidate-groups-overview.svg
 * - retained-topology-summary.svg
 * - region-000.svg .. region-024.svg (one per opening-region hypothesis)
 *
 * Produces deterministic output from canonical inputs only.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.1', 'r13.1-accounting-report.json');
const OUT_DIR = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.1', 'group-evidence');
mkdirSync(OUT_DIR, { recursive: true });

const report = JSON.parse(readFileSync(REPORT, 'utf8'));
const regions = report.openingRegionConsolidation.regions || [];
const cands = JSON.parse(
  readFileSync(
    join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.1', 'code06-automatic-window-output.json'),
    'utf8'
  )
).candidates;

const byId = new Map(cands.map(c => [c.candidateId, c]));

const PAGE_W = 1600;
const PAGE_H = 1200;
const PADDING = 40;
const COLORS = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svgHeader(w = PAGE_W, h = PAGE_H) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="11">`;
}

function svgFooter() {
  return '</svg>';
}

function text(x, y, content, attrs = {}) {
  const a = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
  return `<text x="${x}" y="${y}" ${a}>${esc(content)}</text>`;
}

function rect(x, y, w, h, attrs = {}) {
  const a = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${a} />`;
}

function line(x1, y1, x2, y2, attrs = {}) {
  const a = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${a} />`;
}

function scaleX(u, wallStart, wallEnd, x0, width) {
  const norm = (u - wallStart) / Math.max(wallEnd - wallStart, 1e-9);
  return x0 + norm * width;
}

function regionBar(region, x0, y0, width, barHeight = 18) {
  const ids = region.constituentCandidateIds || [];
  const candidates = ids.map(id => byId.get(id)).filter(Boolean);
  if (!candidates.length) return '';
  const wall = candidates[0];
  const wallStart = wall.finiteWallInterval?.start ?? 0;
  const wallEnd = wall.finiteWallInterval?.end ?? 1;
  const unionStart = region.intervalUnion?.start ?? wallStart;
  const unionEnd = region.intervalUnion?.end ?? wallEnd;
  let out = '';
  out += text(x0, y0 - 4, `${region.openingRegionId} | ${region.physicalWallId} | ${candidates.length} candidates`, {
    fill: '#111827',
    'font-weight': 'bold'
  });
  const trackY = y0 + 2;
  out += rect(x0, trackY, width, barHeight, { fill: '#e5e7eb', stroke: '#9ca3af', rx: '2' });
  const u0 = scaleX(unionStart, wallStart, wallEnd, x0, width);
  const u1 = scaleX(unionEnd, wallStart, wallEnd, x0, width);
  out += rect(Math.min(u0, u1), trackY + 2, Math.max(u1 - u0, 1), barHeight - 4, {
    fill: '#93c5fd',
    stroke: '#2563eb',
    'stroke-width': '1',
    rx: '2'
  });
  for (let i = 0; i < candidates.length && i < 12; i++) {
    const c = candidates[i];
    const cStart = c.finiteWallInterval?.start ?? wallStart;
    const cEnd = c.finiteWallInterval?.end ?? wallEnd;
    const x = scaleX(cStart, wallStart, wallEnd, x0, width);
    const x2 = scaleX(cEnd, wallStart, wallEnd, x0, width);
    out += rect(x, trackY + 4, Math.max(x2 - x, 1), barHeight - 8, {
      fill: COLORS[i % COLORS.length],
      fillOpacity: '0.7',
      stroke: '#1f2937',
      'stroke-width': '1',
      rx: '1'
    });
  }
  out += text(x0, trackY + barHeight + 12, [
    `union=${unionStart.toFixed(1)}-${unionEnd.toFixed(1)}`,
    `evidence=${(region.evidenceTypes || []).join(', ') || 'n/a'}`,
    region.unresolvedRelationships?.length ? `unresolved=${region.unresolvedRelationships.length}` : ''
  ].filter(Boolean).join(' | '), { fill: '#374151' });
  return out;
}

function buildOverview(svgFilename, title, filter) {
  const filtered = regions.filter(filter);
  const width = PAGE_W - PADDING * 2;
  const rowHeight = 58;
  const headerHeight = 40;
  let y = PADDING;
  let body = svgHeader(PAGE_W, PAGE_H);
  body += rect(0, 0, PAGE_W, PAGE_H, { fill: '#ffffff' });
  body += text(PADDING, 24, title, { fill: '#111827', 'font-size': '16', 'font-weight': 'bold' });
  body += text(PADDING, 38, `regions=${filtered.length} | canonicalHash=65026dba38da6224ea35c83a304b757975a81face29dfe93795a4a8c70717301 | R1.3.1`, {
    fill: '#6b7280'
  });
  y = headerHeight;
  for (const region of filtered) {
    if (y + rowHeight > PAGE_H - PADDING) break;
    body += regionBar(region, PADDING, y, width, 18);
    y += rowHeight;
  }
  body += svgFooter();
  writeFileSync(join(OUT_DIR, svgFilename), body);
}

buildOverview('groups-overview.svg', 'R1.3.1 Opening-Region Overview', () => true);
buildOverview('multi-candidate-groups-overview.svg', 'R1.3.1 Multi-Candidate Groups', r => (r.constituentCandidateIds?.length || 0) > 1);
buildOverview('singletons-overview.svg', 'R1.3.1 Singleton Groups', r => (r.constituentCandidateIds?.length || 0) <= 1);

const topoRegions = regions.slice(0, 24);
let topoSvg = svgHeader(PAGE_W, PAGE_H);
topoSvg += rect(0, 0, PAGE_W, PAGE_H, { fill: '#ffffff' });
topoSvg += text(PADDING, 24, 'R1.3.1 Topology Summary — host wall distribution', {
  fill: '#111827', 'font-size': '16', 'font-weight': 'bold'
});
const wallCounts = new Map();
for (const r of topoRegions) {
  wallCounts.set(r.physicalWallId, (wallCounts.get(r.physicalWallId) || 0) + 1);
}
const entries = Array.from(wallCounts.entries()).sort((a, b) => b[1] - a[1]);
const cols = 6;
const cellW = (PAGE_W - PADDING * 2) / cols;
let ty = 60;
let tx = PADDING;
let col = 0;
for (const [wall, count] of entries) {
  if (col >= cols) { ty += 36; tx = PADDING; col = 0; }
  topoSvg += rect(tx, ty, cellW - 8, 24, { fill: '#dbeafe', stroke: '#2563eb', rx: '3' });
  topoSvg += text(tx + 6, ty + 15, `${wall} (${count})`, { fill: '#1e40af' });
  tx += cellW; col++;
}
topoSvg += text(PADDING, ty + 40, `Total retained regions: ${topoRegions.length}`, { fill: '#374151' });
topoSvg += svgFooter();
writeFileSync(join(OUT_DIR, 'retained-topology-summary.svg'), topoSvg);

function computeSummary(candidates) {
  let frameCount = 0;
  let jambCount = 0;
  let gapCount = 0;
  let bayCount = 0;
  for (const c of candidates) {
    if (c.frameLineAudits) frameCount += c.frameLineAudits.length;
    if (c.jambAudit?.pairVerdict === 'VALID_JAMB_PAIR') jambCount++;
    if (c.wallFaceGapAudit?.verdict === 'VALID_SOURCE_WALL_FACE_GAP') gapCount++;
    if (c.frameBayAudit?.verdict === 'VERIFIED_FRAME_BAY') bayCount++;
  }
  return { frameCount, jambCount, gapCount, bayCount };
}

for (let i = 0; i < regions.length; i++) {
  const r = regions[i];
  const ids = r.constituentCandidateIds || [];
  const candidates = ids.map(id => byId.get(id)).filter(Boolean);
  const width = PAGE_W - PADDING * 2;
  const x0 = PADDING;
  let y = PADDING;
  let body = svgHeader(PAGE_W, PAGE_H);
  body += rect(0, 0, PAGE_W, PAGE_H, { fill: '#ffffff' });
  body += text(x0, 20, `${r.openingRegionId} | wall ${r.physicalWallId} | ${candidates.length} candidates`, {
    fill: '#111827', 'font-size': '14', 'font-weight': 'bold'
  });
  body += text(x0, 34, `intervalUnion=${(r.intervalUnion?.start ?? 0).toFixed(2)}-${(r.intervalUnion?.end ?? 0).toFixed(2)} | evidence=${(r.evidenceTypes || []).join(', ') || 'n/a'}`, {
    fill: '#6b7280'
  });
  y = 54;
  const summary = computeSummary(candidates);
  body += text(x0, y, `Frame features: ${summary.frameCount} | jamb features: ${summary.jambCount} | gaps: ${summary.gapCount} | bays: ${summary.bayCount}`, { fill: '#374151' });
  y += 20;
  for (const c of candidates) {
    if (y + 80 > PAGE_H) break;
    const color = COLORS[candidates.indexOf(c) % COLORS.length];
    body += rect(x0, y, width, 70, { fill: '#f9fafb', stroke: '#e5e7eb', rx: '4' });
    body += text(x0 + 8, y + 14, c.candidateId, { fill: color, 'font-weight': 'bold' });
    body += text(x0 + 8, y + 28, `host=${c.physicalWallId} | interval=${c.finiteWallInterval?.start?.toFixed(2)}-${c.finiteWallInterval?.end?.toFixed(2)}`, { fill: '#374151' });
    body += text(x0 + 8, y + 42, `decision=${c.finalDecision} | evidence=${(c.positiveEvidence || []).join(', ') || 'none'}`, { fill: '#374151' });
    body += text(x0 + 8, y + 58, `negative=${(c.negativeEvidence || []).join(', ') || 'none'}`, { fill: '#b91c1c' });
    y += 82;
  }
  body += svgFooter();
  writeFileSync(join(OUT_DIR, `region-${String(i).padStart(3, '0')}.svg`), body);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  checkpoint: 'R1.3.1',
  mode: 'group-level-consolidation',
  totalGroups: regions.length,
  files: [
    'groups-overview.svg',
    'multi-candidate-groups-overview.svg',
    'singletons-overview.svg',
    'retained-topology-summary.svg',
    ...Array.from({ length: regions.length }).map((_, i) => `region-${String(i).padStart(3, '0')}.svg`)
  ]
};
writeFileSync(join(OUT_DIR, 'group-evidence-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ groups: regions.length, filesWritten: manifest.files.length, outDir: OUT_DIR }, null, 2));
