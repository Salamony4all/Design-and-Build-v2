// Diagnostic 2: envelope test + the disputed 20.63,7.03 footprint.
import { loadFixture, loadUnclaimedGeometry } from '../src/fixture.ts';
import { extractColumnReport } from '../src/columns.ts';

const fx = loadFixture();
const mm = fx.scaleMmPerPt;
const toM = (v: number) => (v * mm) / 1000;
const toPt = (v: number) => (v * 1000) / mm;
const wallIds = new Set(fx.claimed.find((c) => c.kind === 'wall')!.sourceIds);
const wl = fx.lines.filter((l: any) => wallIds.has(l.id));
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (const l of wl) for (const p of [l.a, l.b]) {
  if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
  if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
}
console.log(`wall envelope (m): x ${toM(x0).toFixed(3)}..${toM(x1).toFixed(3)}  y ${toM(y0).toFixed(3)}..${toM(y1).toFixed(3)}`);

const rep = extractColumnReport(loadUnclaimedGeometry() as any);
const acc = rep.columns.filter((c) => c.verdict === 'ACCEPT');
console.log('\naccepted vs envelope:');
for (const c of acc) {
  const inside = c.centreProjectM.x >= toM(x0) && c.centreProjectM.x <= toM(x1) &&
                 c.centreProjectM.y >= toM(y0) && c.centreProjectM.y <= toM(y1);
  if (!inside) console.log(`  OUTSIDE ${c.deterministicExtractionId} ${(c.widthM ?? 0).toFixed(3)}x${(c.depthM ?? 0).toFixed(3)} @ (${c.centreProjectM.x.toFixed(3)},${c.centreProjectM.y.toFixed(3)})`);
}
const outCount = acc.filter((c) => !(c.centreProjectM.x >= toM(x0) && c.centreProjectM.x <= toM(x1) && c.centreProjectM.y >= toM(y0) && c.centreProjectM.y <= toM(y1))).length;
console.log(`  total outside: ${outCount} / ${acc.length}`);

// exact geometry of the disputed 470 square at (20.626, 7.032)
const cx = toPt(20.626), cy = toPt(7.032), half = toPt(0.30);
const near = fx.lines.filter((l: any) => {
  const xs = [l.a.x, l.b.x], ys = [l.a.y, l.b.y];
  return Math.min(...xs) >= cx - half && Math.max(...xs) <= cx + half &&
         Math.min(...ys) >= cy - half && Math.max(...ys) <= cy + half;
});
const uniq = new Map<string, number>();
for (const l of near) {
  const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
  if (len < 1e-6) continue;
  const k = `(${toM(l.a.x).toFixed(3)},${toM(l.a.y).toFixed(3)})->(${toM(l.b.x).toFixed(3)},${toM(l.b.y).toFixed(3)})`;
  uniq.set(k, (uniq.get(k) ?? 0) + 1);
}
console.log(`\ntight window around (20.626,7.032) +-0.30m: raw=${near.length} uniq=${uniq.size}`);
for (const [k, v] of uniq) console.log(`   ${k} x${v}`);

// compare with a KNOWN-GOOD 470 column
const gx = toPt(6.734), gy = toPt(7.032);
const near2 = fx.lines.filter((l: any) => {
  const xs = [l.a.x, l.b.x], ys = [l.a.y, l.b.y];
  return Math.min(...xs) >= gx - half && Math.max(...xs) <= gx + half &&
         Math.min(...ys) >= gy - half && Math.max(...ys) <= gy + half;
});
const uniq2 = new Map<string, number>();
for (const l of near2) {
  const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
  if (len < 1e-6) continue;
  const k = `(${toM(l.a.x).toFixed(3)},${toM(l.a.y).toFixed(3)})->(${toM(l.b.x).toFixed(3)},${toM(l.b.y).toFixed(3)})`;
  uniq2.set(k, (uniq2.get(k) ?? 0) + 1);
}
console.log(`\nreference known-good 470 column (6.734,7.032): raw=${near2.length} uniq=${uniq2.size}`);
for (const [k, v] of uniq2) console.log(`   ${k} x${v}`);
