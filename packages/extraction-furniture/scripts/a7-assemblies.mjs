// Exploratory: op-runs -> nested-assembly merge -> signature survey.
import { buildRuns } from './a6-inspect.mjs';

const runs = buildRuns({ minLen: 0.02, opGap: 1, near: 0.6 });
const MAXDIM = 3.2;
const cand = runs.filter((r) => Math.max(r.w, r.h) <= MAXDIM && Math.max(r.w, r.h) >= 0.1);
const structural = runs.length - cand.length;
console.log('runs', runs.length, 'candidates', cand.length, 'structural(dropped)', structural);

cand.sort((a, b) => (b.w * b.h) - (a.w * a.h) || a.firstOp - b.firstOp);
const absorbed = new Array(cand.length).fill(-1);
const overlapFrac = (s, big) => {
  const ix = Math.max(0, Math.min(s.maxX, big.maxX) - Math.max(s.minX, big.minX));
  const iy = Math.max(0, Math.min(s.maxY, big.maxY) - Math.max(s.minY, big.minY));
  const area = Math.max(s.w, 1e-4) * Math.max(s.h, 1e-4);
  return (ix * iy) / area;
};
for (let i = 0; i < cand.length; i++) {
  if (absorbed[i] >= 0) continue;
  for (let j = i + 1; j < cand.length; j++) {
    if (absorbed[j] >= 0) continue;
    if (overlapFrac(cand[j], cand[i]) >= 0.8) absorbed[j] = i;
  }
}
const asms = [];
for (let i = 0; i < cand.length; i++) {
  if (absorbed[i] >= 0) continue;
  const parts = [cand[i]];
  for (let j = 0; j < cand.length; j++) if (absorbed[j] === i) parts.push(cand[j]);
  const segs = parts.flatMap((p) => p.segs);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, total = 0;
  for (const s of segs) {
    total += s.len;
    minX = Math.min(minX, s.ax, s.bx); maxX = Math.max(maxX, s.ax, s.bx);
    minY = Math.min(minY, s.ay, s.by); maxY = Math.max(maxY, s.ay, s.by);
  }
  asms.push({ segs, parts: parts.length, n: segs.length, total, minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, firstOp: Math.min(...parts.map((p) => p.firstOp)) });
}
console.log('assemblies', asms.length);
const furn = asms.filter((a) => { const M = Math.max(a.w, a.h), m = Math.min(a.w, a.h); return M >= 0.3 && M <= 3.2 && m >= 0.15 && a.n >= 3; });
console.log('furniture-scale assemblies', furn.length);
const sig = new Map();
for (const a of furn) {
  const k = `${Math.max(a.w, a.h).toFixed(2)}x${Math.min(a.w, a.h).toFixed(2)}`;
  const e = sig.get(k) || { k, count: 0, ns: [], pos: [] };
  e.count++; e.ns.push(a.n); if (e.pos.length < 3) e.pos.push(`(${a.minX.toFixed(1)},${a.minY.toFixed(1)})`);
  sig.set(k, e);
}
console.log('\nassembly signatures (count>=1), sorted by count:');
for (const r of [...sig.values()].sort((a, b) => b.count - a.count).slice(0, 45)) {
  const ns = [...new Set(r.ns)].sort((a, b) => a - b);
  console.log(' ', String(r.count).padStart(3), r.k.padEnd(12), 'n=' + (ns.length > 4 ? `${ns[0]}..${ns[ns.length - 1]}` : ns.join(',')).padEnd(10), r.pos.join(' '));
}
const total = [...sig.values()].reduce((s, e) => s + e.count, 0);
console.log('total furniture-scale assemblies:', total);
