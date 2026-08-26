// Renders captured vectors + optional highlight boxes to a standalone SVG/HTML.
// Used to build the evidence overlays. Reads the immutable fixture read-only.
import { readFileSync, writeFileSync } from 'fs';

export function loadSegments({ minLen = 0, dedupe = true } = {}) {
  const F = '../extraction-mupdf/extraction-results/secondary-fixture.json';
  const f = JSON.parse(readFileSync(F, 'utf8'));
  const claimed = new Set(f.claimed.flatMap((c) => c.sourceIds));
  const S = f.scaleMmPerPt / 1000;
  const seen = new Set();
  const segs = [];
  for (const l of f.lines) {
    if (claimed.has(l.id)) continue;
    const ax = l.a.x * S, ay = l.a.y * S, bx = l.b.x * S, by = l.b.y * S;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < minLen) continue;
    if (dedupe) {
      const r = (v) => Math.round(v * 1000);
      const k1 = `${r(ax)},${r(ay)},${r(bx)},${r(by)}`, k2 = `${r(bx)},${r(by)},${r(ax)},${r(ay)}`;
      if (seen.has(k1) || seen.has(k2)) continue;
      seen.add(k1);
    }
    segs.push({ id: l.id, opN: Number(String(l.sourceOperationId).replace(/\D/g, '')), ax, ay, bx, by, len });
  }
  return { segs, scale: S, sourceHash: f.sourceHash };
}

/** boxes: [{minX,minY,maxX,maxY,stroke,label,labelColor}] ; markers: [{x,y,color,r}] */
export function renderSvg({ segs, boxes = [], markers = [], links = [], title = '', pxPerM = 34, view = null, segStroke = '#111', bg = '#fff', legend = [] }) {
  const vb = view || { minX: 0, minY: 0, maxX: 41.8, maxY: 29.5 };
  const W = (vb.maxX - vb.minX) * pxPerM, H = (vb.maxY - vb.minY) * pxPerM;
  const X = (x) => ((x - vb.minX) * pxPerM).toFixed(2);
  const Y = (y) => ((y - vb.minY) * pxPerM).toFixed(2);
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}">`);
  parts.push(`<rect width="100%" height="100%" fill="${bg}"/>`);
  parts.push(`<g stroke="${segStroke}" stroke-width="0.6" opacity="0.55">`);
  for (const s of segs) {
    if (s.ax < vb.minX - 1 && s.bx < vb.minX - 1) continue;
    if (s.ax > vb.maxX + 1 && s.bx > vb.maxX + 1) continue;
    if (s.ay < vb.minY - 1 && s.by < vb.minY - 1) continue;
    if (s.ay > vb.maxY + 1 && s.by > vb.maxY + 1) continue;
    parts.push(`<line x1="${X(s.ax)}" y1="${Y(s.ay)}" x2="${X(s.bx)}" y2="${Y(s.by)}"/>`);
  }
  parts.push('</g>');
  for (const l of links) parts.push(`<line x1="${X(l.x1)}" y1="${Y(l.y1)}" x2="${X(l.x2)}" y2="${Y(l.y2)}" stroke="${l.stroke || '#f0f'}" stroke-width="1.4"/>`);
  for (const b of boxes) {
    parts.push(`<rect x="${X(b.minX)}" y="${Y(b.minY)}" width="${((b.maxX - b.minX) * pxPerM).toFixed(2)}" height="${((b.maxY - b.minY) * pxPerM).toFixed(2)}" fill="${b.fill || 'none'}" stroke="${b.stroke || '#e00'}" stroke-width="${b.sw || 1.6}"/>`);
    if (b.label) parts.push(`<text x="${X(b.minX)}" y="${(Number(Y(b.minY)) - 2).toFixed(2)}" font-family="monospace" font-size="${b.fs || 8}" fill="${b.labelColor || b.stroke || '#e00'}">${b.label}</text>`);
  }
  for (const m of markers) parts.push(`<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="${m.r || 3}" fill="${m.color || '#08f'}" fill-opacity="0.85"/>`);
  if (title) parts.push(`<text x="8" y="16" font-family="monospace" font-size="13" fill="#000">${title}</text>`);
  legend.forEach((l, i) => {
    parts.push(`<rect x="8" y="${24 + i * 16}" width="12" height="10" fill="${l.color}"/>`);
    parts.push(`<text x="26" y="${33 + i * 16}" font-family="monospace" font-size="11" fill="#000">${l.text}</text>`);
  });
  parts.push('</svg>');
  return parts.join('\n');
}

export function writeSvg(path, svg) { writeFileSync(path, svg); return path; }
