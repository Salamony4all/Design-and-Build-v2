// Diagnostic: inspect specific disputed locations from the mismatch ledger.
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadFixture } from '../src/fixture.ts';

const fx = loadFixture();
const mm = fx.scaleMmPerPt;
const toM = (v: number) => (v * mm) / 1000;
const toPt = (v: number) => (v * 1000) / mm;
const claimed = new Set<string>();
const wall = new Set<string>();
for (const c of fx.claimed) { for (const id of c.sourceIds) { claimed.add(id); if (c.kind === 'wall') wall.add(id); } }

const targets: Array<[string, number, number, number]> = [
  ['UNMATCHED-ACC col_40ec08dc', 17.837873, 3.410043, 0.45],
  ['UNMATCHED-ACC col_0889f2ca', 20.62619, 7.032228, 0.55],
  ['FN orc 0.35x0.27', 9.693188, 11.09244, 0.5],
  ['FN orc 0.27x0.29 (x3 stack)', 17.213188, 19.42244, 0.7],
  ['FN orc 0.39x0.45', 19.653188, 11.00244, 0.6],
  ['FN orc 0.88x0.72', 19.898188, 8.37744, 0.8],
  ['FN DISC 0.89x0.97', 24.663188, 7.83244, 0.9],
  ['REF real column 470', 6.734, 7.032, 0.5],
];

for (const [label, cxM, cyM, halfM] of targets) {
  const cx = toPt(cxM), cy = toPt(cyM), half = toPt(halfM);
  const near = fx.lines.filter((l: any) => {
    const xs = [l.a.x, l.b.x], ys = [l.a.y, l.b.y];
    return Math.min(...xs) >= cx - half && Math.max(...xs) <= cx + half &&
           Math.min(...ys) >= cy - half && Math.max(...ys) <= cy + half;
  });
  const uniq = new Map<string, { count: number; claimed: boolean; wall: boolean; lenM: number }>();
  for (const l of near) {
    const k = `${l.a.x.toFixed(2)},${l.a.y.toFixed(2)}->${l.b.x.toFixed(2)},${l.b.y.toFixed(2)}`;
    const rk = `${l.b.x.toFixed(2)},${l.b.y.toFixed(2)}->${l.a.x.toFixed(2)},${l.a.y.toFixed(2)}`;
    const key = uniq.has(rk) ? rk : k;
    const prev = uniq.get(key);
    const lenM = toM(Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y));
    if (prev) { prev.count++; prev.claimed ||= claimed.has(l.id); prev.wall ||= wall.has(l.id); }
    else uniq.set(key, { count: 1, claimed: claimed.has(l.id), wall: wall.has(l.id), lenM });
  }
  const nonDeg = [...uniq.entries()].filter(([, v]) => v.lenM > 0.001);
  console.log(`\n=== ${label} @(${cxM.toFixed(2)},${cyM.toFixed(2)}) half=${halfM}m ===`);
  console.log(`   raw=${near.length} uniqueGeom=${uniq.size} nonDegenerate=${nonDeg.length} wallClaimed=${nonDeg.filter(([, v]) => v.wall).length}`);
  for (const [k, v] of nonDeg.slice(0, 14)) {
    const [p, q] = k.split('->');
    const [ax, ay] = p.split(',').map(Number); const [bx, by] = q.split(',').map(Number);
    console.log(`     (${toM(ax).toFixed(3)},${toM(ay).toFixed(3)})->(${toM(bx).toFixed(3)},${toM(by).toFixed(3)}) len=${v.lenM.toFixed(3)}m x${v.count}${v.wall ? ' WALL' : ''}${v.claimed && !v.wall ? ' CLAIMED' : ''}`);
  }
  if (nonDeg.length > 14) console.log(`     ... ${nonDeg.length - 14} more`);
}
