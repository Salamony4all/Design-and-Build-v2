// Close the false-negative loop: for every unmatched raster candidate, report
// what production DID with the geometry at that location (which ledger entry,
// which reason). A true FN is a location production never even considered.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { extractColumnReport } from '../src/columns.ts';
import { loadUnclaimedGeometry, loadStructuralEnvelope } from '../src/fixture.ts';

const OUT = join(process.cwd(), 'evidence');
const sweep = JSON.parse(readFileSync(join(OUT, 'fn-sweep.json'), 'utf8'));
const rep = extractColumnReport(loadUnclaimedGeometry() as any, { structuralEnvelope: loadStructuralEnvelope() });

const R = 0.6;
const rows = sweep.unmatched.map((u: any) => {
  const near = rep.rejected
    .map((r) => ({ r, d: Math.hypot(r.centreProjectM.x - u.centreProjectM.x, r.centreProjectM.y - u.centreProjectM.y) }))
    .filter((x) => x.d <= R)
    .sort((a, b) => a.d - b.d);
  return {
    centreProjectM: u.centreProjectM,
    widthM: u.widthM,
    depthM: u.depthM,
    nearestRejections: near.slice(0, 3).map((x) => ({
      distanceM: Math.round(x.d * 1e4) / 1e4,
      reason: x.r.reason,
      sizeM: [Math.round(x.r.widthM * 1e3) / 1e3, Math.round(x.r.depthM * 1e3) / 1e3],
      edges: x.r.edgeCount,
      verts: x.r.vertexCount,
    })),
    consideredByProduction: near.length > 0,
  };
});

const considered = rows.filter((r: any) => r.consideredByProduction).length;
console.log(`unmatched raster candidates: ${rows.length}`);
console.log(`  considered & explicitly rejected by production: ${considered}`);
console.log(`  never considered (true blind spots): ${rows.length - considered}`);

const reasonHist = new Map<string, number>();
for (const r of rows) {
  const k = r.nearestRejections[0]?.reason.replace(/\([^)]*\)/g, '(..)') ?? 'NOT-CONSIDERED';
  reasonHist.set(k, (reasonHist.get(k) ?? 0) + 1);
}
console.log('\nnearest-rejection reason histogram:');
for (const [k, v] of [...reasonHist.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${v.toString().padStart(3)}  ${k}`);

console.log('\nsample detail:');
for (const r of rows.slice(0, 8)) {
  console.log(`  ${r.widthM.toFixed(2)}x${r.depthM.toFixed(2)} @(${r.centreProjectM.x.toFixed(2)},${r.centreProjectM.y.toFixed(2)})`);
  for (const n of r.nearestRejections) console.log(`      d=${n.distanceM.toFixed(3)} ${n.sizeM[0]}x${n.sizeM[1]} e=${n.edges} v=${n.verts} :: ${n.reason}`);
  if (!r.nearestRejections.length) console.log('      (no production candidate within 0.6 m)');
}

writeFileSync(join(OUT, 'fn-resolution.json'), JSON.stringify({
  method: 'each unmatched raster cavity mapped to the nearest production rejection within 0.6 m',
  unmatchedCount: rows.length,
  consideredAndRejected: considered,
  neverConsidered: rows.length - considered,
  reasonHistogram: Object.fromEntries([...reasonHist.entries()].sort((a, b) => b[1] - a[1])),
  rows,
}, null, 2));
console.log('\nwrote evidence/fn-resolution.json');
