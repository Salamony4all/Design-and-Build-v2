// Parameter sweep: how (opGap, near) affect recovery of canonical block signatures.
import { loadSegments } from './render.mjs';

const { segs: ALL } = loadSegments({ minLen: 0.02 });
ALL.sort((a, b) => a.opN - b.opN || a.ax - b.ax || a.ay - b.ay || a.bx - b.bx || a.by - b.by);

function runsFor(opGap, near) {
  const runs = [];
  let cur = null;
  for (const s of ALL) {
    const sMinX = Math.min(s.ax, s.bx), sMaxX = Math.max(s.ax, s.bx), sMinY = Math.min(s.ay, s.by), sMaxY = Math.max(s.ay, s.by);
    if (cur && s.opN - cur.lastOp <= opGap) {
      const gx = Math.max(cur.minX - sMaxX, sMinX - cur.maxX, 0), gy = Math.max(cur.minY - sMaxY, sMinY - cur.maxY, 0);
      if (Math.hypot(gx, gy) <= near) {
        cur.segs.push(s); cur.lastOp = s.opN;
        cur.minX = Math.min(cur.minX, sMinX); cur.maxX = Math.max(cur.maxX, sMaxX);
        cur.minY = Math.min(cur.minY, sMinY); cur.maxY = Math.max(cur.maxY, sMaxY);
        continue;
      }
    }
    cur = { segs: [s], firstOp: s.opN, lastOp: s.opN, minX: sMinX, maxX: sMaxX, minY: sMinY, maxY: sMaxY };
    runs.push(cur);
  }
  for (const r of runs) { r.n = r.segs.length; r.w = r.maxX - r.minX; r.h = r.maxY - r.minY; }
  return runs;
}
const KEY = (r) => `${Math.max(r.w, r.h).toFixed(2)}x${Math.min(r.w, r.h).toFixed(2)}`;
const WATCH = ['1.98x0.89', '1.98x1.41', '0.47x0.47', '1.04x0.89', '0.32x0.30', '1.98x1.98', '1.98x1.89'];
console.log(['opGap', 'near', 'runs', ...WATCH].map((s) => String(s).padStart(10)).join(''));
for (const opGap of [1, 2, 4]) {
  for (const near of [0.005, 0.02, 0.03, 0.06, 0.12, 0.3]) {
    const runs = runsFor(opGap, near);
    const counts = new Map();
    for (const r of runs) { const k = KEY(r); counts.set(k, (counts.get(k) || 0) + 1); }
    console.log([opGap, near, runs.length, ...WATCH.map((w) => counts.get(w) || 0)].map((s) => String(s).padStart(10)).join(''));
  }
}
