// Exploratory: basic statistics of the unclaimed geometry (read-only).
import { readFileSync } from 'fs';
const F = '../extraction-mupdf/extraction-results/secondary-fixture.json';
const f = JSON.parse(readFileSync(F, 'utf8'));
const claimed = new Set(f.claimed.flatMap((c) => c.sourceIds));
const lines = f.lines.filter((l) => !claimed.has(l.id));
const cubics = f.cubics.filter((c) => !claimed.has(c.id));
const S = f.scaleMmPerPt / 1000; // metres per pt

let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const lenHist = new Map();
const ops = new Map();
let degenerate = 0;
for (const l of lines) {
  for (const p of [l.a, l.b]) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) * S;
  if (len < 1e-6) degenerate++;
  const bucket = len < 0.01 ? '<1cm' : len < 0.05 ? '1-5cm' : len < 0.1 ? '5-10cm' : len < 0.3 ? '0.1-0.3m'
    : len < 0.6 ? '0.3-0.6m' : len < 1 ? '0.6-1m' : len < 2 ? '1-2m' : len < 5 ? '2-5m' : '>5m';
  lenHist.set(bucket, (lenHist.get(bucket) || 0) + 1);
  const o = ops.get(l.sourceOperationId) || { n: 0 };
  o.n++; ops.set(l.sourceOperationId, o);
}
console.log('unclaimed lines', lines.length, 'cubics', cubics.length, 'degenerate', degenerate);
console.log('bbox pt', { minX: +minX.toFixed(1), minY: +minY.toFixed(1), maxX: +maxX.toFixed(1), maxY: +maxY.toFixed(1) });
console.log('bbox m ', { w: +((maxX - minX) * S).toFixed(2), h: +((maxY - minY) * S).toFixed(2) });
console.log('length histogram', [...lenHist.entries()].sort((a, b) => b[1] - a[1]));
console.log('distinct sourceOperationIds', ops.size);
const perOp = [...ops.values()].map((o) => o.n).sort((a, b) => a - b);
const q = (p) => perOp[Math.floor(perOp.length * p)];
console.log('segments-per-op quantiles p10/p50/p90/p99/max', q(0.1), q(0.5), q(0.9), q(0.99), perOp[perOp.length - 1]);
const opSizeHist = new Map();
for (const n of perOp) { const b = n === 1 ? '1' : n <= 3 ? '2-3' : n <= 8 ? '4-8' : n <= 20 ? '9-20' : n <= 50 ? '21-50' : n <= 200 ? '51-200' : '>200'; opSizeHist.set(b, (opSizeHist.get(b) || 0) + 1); }
console.log('op size histogram', [...opSizeHist.entries()]);
