// Exploratory: op-run clustering (CAD blocks are emitted as contiguous operation runs).
import { readFileSync } from 'fs';
const F = '../extraction-mupdf/extraction-results/secondary-fixture.json';
const f = JSON.parse(readFileSync(F, 'utf8'));
const claimed = new Set(f.claimed.flatMap((c) => c.sourceIds));
const S = f.scaleMmPerPt / 1000;
const MINLEN = Number(process.argv[2] ?? 0.02);
const OPGAP = Number(process.argv[3] ?? 1);   // allowed gap in op index
const NEAR = Number(process.argv[4] ?? 0.6);  // allowed spatial jump (m)

const seen = new Set();
const segs = [];
for (const l of f.lines) {
  if (claimed.has(l.id)) continue;
  const ax = l.a.x * S, ay = l.a.y * S, bx = l.b.x * S, by = l.b.y * S;
  const len = Math.hypot(bx - ax, by - ay);
  if (len < MINLEN) continue;
  const r = (v) => Math.round(v * 1000);
  const k1 = `${r(ax)},${r(ay)},${r(bx)},${r(by)}`, k2 = `${r(bx)},${r(by)},${r(ax)},${r(ay)}`;
  if (seen.has(k1) || seen.has(k2)) continue;
  seen.add(k1);
  segs.push({ id: l.id, opN: Number(String(l.sourceOperationId).replace(/\D/g, '')), ax, ay, bx, by, len });
}
segs.sort((a, b) => a.opN - b.opN || (a.ax - b.ax) || (a.ay - b.ay));
console.log('segments', segs.length);

// chain into runs
const runs = [];
let cur = null;
for (const s of segs) {
  const sMinX = Math.min(s.ax, s.bx), sMaxX = Math.max(s.ax, s.bx), sMinY = Math.min(s.ay, s.by), sMaxY = Math.max(s.ay, s.by);
  if (cur && s.opN - cur.lastOp <= OPGAP) {
    const gapX = Math.max(cur.minX - sMaxX, sMinX - cur.maxX, 0);
    const gapY = Math.max(cur.minY - sMaxY, sMinY - cur.maxY, 0);
    if (Math.hypot(gapX, gapY) <= NEAR) {
      cur.n++; cur.total += s.len; cur.lastOp = s.opN; cur.ids.push(s.id);
      cur.minX = Math.min(cur.minX, sMinX); cur.maxX = Math.max(cur.maxX, sMaxX);
      cur.minY = Math.min(cur.minY, sMinY); cur.maxY = Math.max(cur.maxY, sMaxY);
      continue;
    }
  }
  cur = { n: 1, total: s.len, firstOp: s.opN, lastOp: s.opN, minX: sMinX, maxX: sMaxX, minY: sMinY, maxY: sMaxY, ids: [s.id] };
  runs.push(cur);
}
console.log('runs', runs.length);
const furn = runs.filter((r) => {
  const a = Math.max(r.maxX - r.minX, r.maxY - r.minY), b = Math.min(r.maxX - r.minX, r.maxY - r.minY);
  return a >= 0.25 && a <= 3.2 && b >= 0.1 && r.n >= 3;
});
console.log('furniture-scale runs', furn.length);
const sig = new Map();
for (const r of furn) {
  const a = Math.max(r.maxX - r.minX, r.maxY - r.minY), b = Math.min(r.maxX - r.minX, r.maxY - r.minY);
  const k = `${a.toFixed(2)}x${b.toFixed(2)}|n=${r.n}`;
  const e = sig.get(k) || { k, count: 0, samples: [] };
  e.count++; if (e.samples.length < 4) e.samples.push(`(${r.minX.toFixed(1)},${r.minY.toFixed(1)})`);
  sig.set(k, e);
}
console.log('\nrepeated runs (count>=2), top 45:');
for (const r of [...sig.values()].filter((e) => e.count >= 2).sort((a, b) => b.count - a.count).slice(0, 45))
  console.log(' ', String(r.count).padStart(3), r.k.padEnd(22), r.samples.join(' '));
// dimension-only signature (ignore segment count) to catch block variants
const dsig = new Map();
for (const r of furn) {
  const a = Math.max(r.maxX - r.minX, r.maxY - r.minY), b = Math.min(r.maxX - r.minX, r.maxY - r.minY);
  const k = `${a.toFixed(1)}x${b.toFixed(1)}`;
  dsig.set(k, (dsig.get(k) || 0) + 1);
}
console.log('\ntop dimension classes:');
for (const [k, v] of [...dsig.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log('  ', String(v).padStart(3), k);
