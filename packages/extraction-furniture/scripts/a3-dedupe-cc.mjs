// Exploratory: dedupe, component structure, big-component inspection (read-only).
import { readFileSync } from 'fs';
const F = '../extraction-mupdf/extraction-results/secondary-fixture.json';
const f = JSON.parse(readFileSync(F, 'utf8'));
const claimed = new Set(f.claimed.flatMap((c) => c.sourceIds));
const S = f.scaleMmPerPt / 1000;
const MINLEN = Number(process.argv[2] ?? 0.02);
const TOL = Number(process.argv[3] ?? 0.012);

const seen = new Map();
let dupes = 0;
const segs = [];
for (const l of f.lines) {
  if (claimed.has(l.id)) continue;
  const ax = l.a.x * S, ay = l.a.y * S, bx = l.b.x * S, by = l.b.y * S;
  const len = Math.hypot(bx - ax, by - ay);
  if (len < MINLEN) continue;
  const r = (v) => Math.round(v * 1000);
  const k1 = `${r(ax)},${r(ay)},${r(bx)},${r(by)}`, k2 = `${r(bx)},${r(by)},${r(ax)},${r(ay)}`;
  if (seen.has(k1) || seen.has(k2)) { dupes++; continue; }
  seen.set(k1, 1);
  segs.push({ id: l.id, op: l.sourceOperationId, opN: Number(String(l.sourceOperationId).replace(/\D/g, '')), ax, ay, bx, by, len });
}
console.log('kept', segs.length, 'dupes dropped', dupes);

const parent = new Int32Array(segs.length).map((_, i) => i);
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
const grid = new Map();
for (let i = 0; i < segs.length; i++) {
  const s = segs[i];
  for (const [x, y] of [[s.ax, s.ay], [s.bx, s.by]]) {
    const cx = Math.floor(x / TOL), cy = Math.floor(y / TOL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const arr = grid.get(`${cx + dx},${cy + dy}`); if (arr) for (const j of arr) uni(i, j);
    }
    const k = `${cx},${cy}`; const arr = grid.get(k) || []; arr.push(i); grid.set(k, arr);
  }
}
const comps = new Map();
for (let i = 0; i < segs.length; i++) { const r = find(i); const c = comps.get(r) || []; c.push(i); comps.set(r, c); }
const info = [];
for (const [root, idxs] of comps) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, total = 0, opMin = Infinity, opMax = -Infinity;
  for (const i of idxs) {
    const s = segs[i]; total += s.len;
    minX = Math.min(minX, s.ax, s.bx); maxX = Math.max(maxX, s.ax, s.bx);
    minY = Math.min(minY, s.ay, s.by); maxY = Math.max(maxY, s.ay, s.by);
    opMin = Math.min(opMin, s.opN); opMax = Math.max(opMax, s.opN);
  }
  info.push({ root, n: idxs.length, w: maxX - minX, h: maxY - minY, total, minX, minY, maxX, maxY, opMin, opMax });
}
info.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
console.log('components', info.length);
console.log('\nLARGEST 15 components:');
for (const c of info.slice(0, 15)) console.log(`  n=${String(c.n).padStart(5)} ${c.w.toFixed(2)}x${c.h.toFixed(2)} at (${c.minX.toFixed(1)},${c.minY.toFixed(1)}) totalLen=${c.total.toFixed(1)} ops=${c.opMin}..${c.opMax}`);
const mid = info.filter((c) => Math.max(c.w, c.h) >= 0.3 && Math.max(c.w, c.h) <= 3.2 && c.n >= 3);
console.log('\nfurniture-scale components (0.3-3.2m, n>=3):', mid.length);
const sig = new Map();
for (const c of mid) {
  const a = Math.max(c.w, c.h), b = Math.min(c.w, c.h);
  const k = `${a.toFixed(2)}x${b.toFixed(2)}|n=${c.n}`;
  const e = sig.get(k) || { k, count: 0, samples: [] };
  e.count++; if (e.samples.length < 3) e.samples.push(`(${c.minX.toFixed(1)},${c.minY.toFixed(1)})`);
  sig.set(k, e);
}
console.log('\nrepeated furniture-scale shapes (count>=2):');
for (const r of [...sig.values()].filter((e) => e.count >= 2).sort((a, b) => b.count - a.count).slice(0, 30)) console.log(' ', String(r.count).padStart(3), r.k, r.samples.join(' '));
console.log('\nsingleton furniture-scale shapes sample (first 25):');
for (const c of mid.filter((x) => sig.get(`${Math.max(x.w, x.h).toFixed(2)}x${Math.min(x.w, x.h).toFixed(2)}|n=${x.n}`).count === 1).slice(0, 25))
  console.log(`  n=${String(c.n).padStart(4)} ${c.w.toFixed(2)}x${c.h.toFixed(2)} at (${c.minX.toFixed(1)},${c.minY.toFixed(1)}) len=${c.total.toFixed(1)}`);
