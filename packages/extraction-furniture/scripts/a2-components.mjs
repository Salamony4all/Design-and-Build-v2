// Exploratory: connected components + repeated-shape signatures (read-only).
import { readFileSync } from 'fs';
const F = '../extraction-mupdf/extraction-results/secondary-fixture.json';
const f = JSON.parse(readFileSync(F, 'utf8'));
const claimed = new Set(f.claimed.flatMap((c) => c.sourceIds));
const S = f.scaleMmPerPt / 1000;
const MINLEN = Number(process.argv[2] ?? 0.02); // metres
const TOL = Number(process.argv[3] ?? 0.03); // metres

const segs = [];
for (const l of f.lines) {
  if (claimed.has(l.id)) continue;
  const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) * S;
  if (len < MINLEN) continue;
  segs.push({ id: l.id, op: l.sourceOperationId, ax: l.a.x * S, ay: l.a.y * S, bx: l.b.x * S, by: l.b.y * S, len });
}
console.log('segments after len filter', segs.length, 'minLen', MINLEN, 'tol', TOL);

const parent = new Int32Array(segs.length).map((_, i) => i);
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
const grid = new Map();
const gk = (x, y) => `${Math.floor(x / TOL)},${Math.floor(y / TOL)}`;
for (let i = 0; i < segs.length; i++) {
  const s = segs[i];
  for (const [x, y] of [[s.ax, s.ay], [s.bx, s.by]]) {
    const cx = Math.floor(x / TOL), cy = Math.floor(y / TOL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const arr = grid.get(`${cx + dx},${cy + dy}`);
      if (arr) for (const j of arr) uni(i, j);
    }
    const k = gk(x, y); const arr = grid.get(k) || []; arr.push(i); grid.set(k, arr);
  }
}
const comps = new Map();
for (let i = 0; i < segs.length; i++) { const r = find(i); const c = comps.get(r) || []; c.push(i); comps.set(r, c); }
console.log('components', comps.size);

const info = [];
for (const [, idxs] of comps) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, total = 0;
  const ops = new Set();
  for (const i of idxs) {
    const s = segs[i]; total += s.len; ops.add(s.op);
    minX = Math.min(minX, s.ax, s.bx); maxX = Math.max(maxX, s.ax, s.bx);
    minY = Math.min(minY, s.ay, s.by); maxY = Math.max(maxY, s.ay, s.by);
  }
  info.push({ n: idxs.length, w: maxX - minX, h: maxY - minY, total, ops: ops.size, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
}
const sizeHist = new Map();
for (const c of info) {
  const a = Math.max(c.w, c.h);
  const b = a < 0.2 ? '<0.2m' : a < 0.5 ? '0.2-0.5' : a < 0.8 ? '0.5-0.8' : a < 1.2 ? '0.8-1.2' : a < 1.6 ? '1.2-1.6'
    : a < 2.0 ? '1.6-2.0' : a < 2.6 ? '2.0-2.6' : a < 4 ? '2.6-4' : a < 10 ? '4-10' : '>10';
  sizeHist.set(b, (sizeHist.get(b) || 0) + 1);
}
console.log('component max-dim histogram', [...sizeHist.entries()].sort());
console.log('components with 4+ segs and maxdim 0.3..3m:', info.filter((c) => c.n >= 4 && Math.max(c.w, c.h) >= 0.3 && Math.max(c.w, c.h) <= 3).length);

// repeated-shape signature: rounded (a,b) dims + segment count
const sig = new Map();
for (const c of info) {
  if (Math.max(c.w, c.h) > 6 || Math.max(c.w, c.h) < 0.15) continue;
  const a = Math.max(c.w, c.h), b = Math.min(c.w, c.h);
  const k = `${a.toFixed(2)}x${b.toFixed(2)}|n=${c.n}`;
  const e = sig.get(k) || { k, count: 0, ex: c };
  e.count++; sig.set(k, e);
}
const rep = [...sig.values()].filter((e) => e.count >= 3).sort((a, b) => b.count - a.count).slice(0, 40);
console.log('\ntop repeated congruent components (count >= 3):');
for (const r of rep) console.log(' ', r.count.toString().padStart(4), r.k, 'totalLen', r.ex.total.toFixed(2), 'ops', r.ex.ops);
