// Diagnostic 3: why do hatch gaps pass the oracle's RECTANGLE gate?
import { readFileSync } from 'fs';
import { join } from 'path';

const o = JSON.parse(readFileSync(join(process.cwd(), 'evidence', 'visual-oracle.json'), 'utf8'));
const objs = o.objects as any[];
const fn = ['orc_420_440_35x27', 'orc_447_1337_35x30', 'orc_1176_1242_27x29', 'orc_1176_1272_27x29',
  'orc_1176_1302_27x29', 'orc_1204_1272_34x29', 'orc_1414_422_39x45', 'orc_1414_146_88x72', 'orc_1890_79_89x97'];
console.log('=== FN candidate descriptors ===');
for (const id of fn) {
  const x = objs.find((v) => v.oracleId === id);
  if (x) console.log(`  ${id} class=${x.shapeClass} occ=${x.bboxOccupancy} iso=${x.momentIsotropy} asp=${x.aspect} corners=${x.cornerConsensus} cells=${x.cellCount} like=${x.columnLikeness} @(${x.centreProjectM.x.toFixed(2)},${x.centreProjectM.y.toFixed(2)})`);
}
console.log('\n=== matched (true column) descriptors, from ledger ===');
const led = JSON.parse(readFileSync(join(process.cwd(), 'evidence', 'mismatch-ledger.json'), 'utf8'));
const matchedIds = new Set(led.matches.filter((m: any) => m.verdict === 'ACCEPT' && m.oracleId).map((m: any) => m.oracleId));
for (const id of [...matchedIds].slice(0, 12)) {
  const x = objs.find((v) => v.oracleId === id);
  if (x) console.log(`  ${id} class=${x.shapeClass} occ=${x.bboxOccupancy} iso=${x.momentIsotropy} asp=${x.aspect} corners=${x.cornerConsensus} cells=${x.cellCount} like=${x.columnLikeness} ${x.widthM}x${x.depthM}`);
}
// size-family analysis: are FN candidates part of a repeating congruent family?
console.log('\n=== congruent-family census (all RECTANGLE/DISC oracle objects) ===');
const rd = objs.filter((v) => v.shapeClass === 'RECTANGLE' || v.shapeClass === 'DISC');
const fam = new Map<string, any[]>();
for (const x of rd) {
  const k = `${Math.round(x.widthM * 50)}_${Math.round(x.depthM * 50)}`;
  (fam.get(k) ?? fam.set(k, []).get(k)!).push(x);
}
for (const [k, arr] of [...fam.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 14)) {
  const isFN = arr.some((x) => fn.includes(x.oracleId));
  const isTrue = arr.some((x) => matchedIds.has(x.oracleId));
  console.log(`  size ${k} n=${arr.length} containsFN=${isFN} containsMatched=${isTrue} sample=${arr[0].oracleId} ${arr[0].widthM}x${arr[0].depthM} occ=${arr[0].bboxOccupancy}`);
}
