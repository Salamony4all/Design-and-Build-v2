// Build op-runs and inspect an individual run's own geometry (isolated ASCII).
import { loadSegments } from './render.mjs';

export function buildRuns({ minLen = 0.02, opGap = 1, near = 0.6 } = {}) {
  const { segs } = loadSegments({ minLen });
  segs.sort((a, b) => a.opN - b.opN || a.ax - b.ax || a.ay - b.ay || a.bx - b.bx || a.by - b.by);
  const runs = [];
  let cur = null;
  for (const s of segs) {
    const sMinX = Math.min(s.ax, s.bx), sMaxX = Math.max(s.ax, s.bx), sMinY = Math.min(s.ay, s.by), sMaxY = Math.max(s.ay, s.by);
    if (cur && s.opN - cur.lastOp <= opGap) {
      const gx = Math.max(cur.minX - sMaxX, sMinX - cur.maxX, 0), gy = Math.max(cur.minY - sMaxY, sMinY - cur.maxY, 0);
      if (Math.hypot(gx, gy) <= near) {
        cur.segs.push(s); cur.lastOp = s.opN; cur.total += s.len;
        cur.minX = Math.min(cur.minX, sMinX); cur.maxX = Math.max(cur.maxX, sMaxX);
        cur.minY = Math.min(cur.minY, sMinY); cur.maxY = Math.max(cur.maxY, sMaxY);
        continue;
      }
    }
    cur = { segs: [s], firstOp: s.opN, lastOp: s.opN, total: s.len, minX: sMinX, maxX: sMaxX, minY: sMinY, maxY: sMaxY };
    runs.push(cur);
  }
  for (const r of runs) { r.n = r.segs.length; r.w = r.maxX - r.minX; r.h = r.maxY - r.minY; }
  return runs;
}

export function asciiRun(run, cols = 90, extra = []) {
  const pad = 0.05;
  const minX = run.minX - pad, maxX = run.maxX + pad, minY = run.minY - pad, maxY = run.maxY + pad;
  const step = (maxX - minX) / cols;
  const rows = Math.max(4, Math.round((maxY - minY) / (step * 2)));
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(' '));
  const draw = (list, ch) => {
    for (const s of list) {
      const n = Math.max(1, Math.ceil(Math.hypot(s.bx - s.ax, s.by - s.ay) / (step / 2)));
      for (let i = 0; i <= n; i++) {
        const x = s.ax + (s.bx - s.ax) * i / n, y = s.ay + (s.by - s.ay) * i / n;
        const cx = Math.floor((x - minX) / (maxX - minX) * cols), cy = Math.floor((y - minY) / (maxY - minY) * rows);
        if (cx >= 0 && cy >= 0 && cx < cols && cy < rows && (grid[cy][cx] === ' ' || ch === '#')) grid[cy][cx] = ch;
      }
    }
  };
  draw(extra, '.');
  draw(run.segs, '#');
  const out = [`run ${run.w.toFixed(2)}x${run.h.toFixed(2)} n=${run.n} at (${run.minX.toFixed(2)},${run.minY.toFixed(2)}) ops ${run.firstOp}..${run.lastOp} len=${run.total.toFixed(2)}`];
  out.push('+' + '-'.repeat(cols) + '+');
  for (const row of grid) out.push('|' + row.join('') + '|');
  out.push('+' + '-'.repeat(cols) + '+');
  return out.join('\n');
}

if ((process.argv[1] || '').endsWith('a6-inspect.mjs')) {
  const want = process.argv[2]; // e.g. "1.98x0.89"
  const idx = Number(process.argv[3] ?? 0);
  const runs = buildRuns();
  const match = runs.filter((r) => `${Math.max(r.w, r.h).toFixed(2)}x${Math.min(r.w, r.h).toFixed(2)}` === want);
  console.log(`matches for ${want}: ${match.length}`);
  const r = match[idx];
  if (!r) process.exit(0);
  const near = runs.filter((o) => o !== r && o.minX < r.maxX + 0.5 && o.maxX > r.minX - 0.5 && o.minY < r.maxY + 0.5 && o.maxY > r.minY - 0.5).flatMap((o) => o.segs);
  console.log(asciiRun(r, Number(process.argv[4] ?? 90), near));
}
