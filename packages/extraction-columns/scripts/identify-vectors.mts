// Vector-space identity of the dominant unmatched raster family (0.87x0.57 in
// two long rows) so its rejection can be justified structurally, not by hand.
import { loadFixture } from '../src/fixture.ts';

const fx = loadFixture();
const mm = fx.scaleMmPerPt;
const toM = (v: number) => (v * mm) / 1000;
const toPt = (v: number) => (v * 1000) / mm;
const claimed = new Set<string>();
const kindOf = new Map<string, string>();
for (const c of fx.claimed) for (const id of c.sourceIds) { claimed.add(id); kindOf.set(id, c.kind); }

function window(cx: number, cy: number, half: number) {
  const X = toPt(cx), Y = toPt(cy), Hh = toPt(half);
  const near = fx.lines.filter((l: any) => {
    const xs = [l.a.x, l.b.x], ys = [l.a.y, l.b.y];
    return Math.min(...xs) >= X - Hh && Math.max(...xs) <= X + Hh &&
           Math.min(...ys) >= Y - Hh && Math.max(...ys) <= Y + Hh;
  });
  const uniq = new Map<string, { n: number; claimed: string | null; len: number }>();
  for (const l of near) {
    const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
    if (len < 1e-6) continue;
    const a = `${l.a.x.toFixed(2)},${l.a.y.toFixed(2)}`;
    const b = `${l.b.x.toFixed(2)},${l.b.y.toFixed(2)}`;
    const k = a <= b ? `${a}|${b}` : `${b}|${a}`;
    const p = uniq.get(k);
    if (p) { p.n++; p.claimed ??= kindOf.get(l.id) ?? null; }
    else uniq.set(k, { n: 1, claimed: kindOf.get(l.id) ?? null, len: toM(len) });
  }
  return uniq;
}

for (const [label, cx, cy, half] of [
  ['FAMILY-A 0.87x0.57', 6.01, 10.27, 0.50],
  ['FAMILY-B 0.50x0.25', 17.58, 10.85, 0.35],
  ['ACCEPTED 470 column', 6.734, 7.032, 0.30],
] as Array<[string, number, number, number]>) {
  const u = window(cx, cy, half);
  const arr = [...u.entries()];
  console.log(`\n=== ${label} @(${cx},${cy}) +-${half}m : ${arr.length} unique edges ===`);
  // endpoint degree distribution tells grid vs isolated loop
  const deg = new Map<string, number>();
  for (const [k] of arr) { const [a, b] = k.split('|'); deg.set(a, (deg.get(a) ?? 0) + 1); deg.set(b, (deg.get(b) ?? 0) + 1); }
  const dh = new Map<number, number>();
  for (const v of deg.values()) dh.set(v, (dh.get(v) ?? 0) + 1);
  console.log(`   vertices=${deg.size} degreeHistogram=${JSON.stringify([...dh.entries()].sort())}`);
  console.log(`   claimedKinds=${JSON.stringify([...new Set(arr.map(([, v]) => v.claimed).filter(Boolean))])}`);
  const lens = arr.map(([, v]) => v.len).sort((a, b) => a - b);
  console.log(`   edgeLengths(m) min=${lens[0]?.toFixed(3)} med=${lens[Math.floor(lens.length / 2)]?.toFixed(3)} max=${lens[lens.length - 1]?.toFixed(3)}`);
  for (const [k, v] of arr.slice(0, 12)) {
    const [a, b] = k.split('|');
    const [ax, ay] = a.split(',').map(Number); const [bx, by] = b.split(',').map(Number);
    console.log(`     (${toM(ax).toFixed(3)},${toM(ay).toFixed(3)})->(${toM(bx).toFixed(3)},${toM(by).toFixed(3)}) len=${v.len.toFixed(3)} x${v.n}${v.claimed ? ' ' + v.claimed.toUpperCase() : ''}`);
  }
  if (arr.length > 12) console.log(`     ... ${arr.length - 12} more`);
}
