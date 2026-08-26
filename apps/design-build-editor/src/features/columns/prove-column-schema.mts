// Proof: the installed @pascal-app/core 0.9.2 ColumnNode schema accepts every
// frozen accepted-column contract. Run with the app's tsx so the correct core
// (0.9.2) resolves. No browser / dev server required.
import { ColumnNode } from '@pascal-app/core';
import { readFileSync } from 'fs';
import { join } from 'path';

const MANIFEST = join(
  process.cwd(), '..', '..', 'packages', 'extraction-columns', 'evidence', 'accepted-column-manifest.json',
);
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

let ok = 0;
const failures: string[] = [];
for (const m of manifest) {
  try {
    const node = ColumnNode.parse({
      id: `column_${m.physicalColumnId}`,
      parentId: 'level_root',
      type: 'column',
      position: [m.centreProjectM.x, m.heightM / 2, m.centreProjectM.y],
      rotation: m.rotationRad,
      crossSection: Math.abs(m.widthM - m.depthM) < 0.02 ? 'square' : 'rectangular',
      width: m.widthM,
      depth: m.depthM,
      height: m.heightM,
      radius: Math.min(m.widthM, m.depthM) / 2,
      style: 'faceted',
      metadata: {
        physicalColumnId: m.physicalColumnId,
        sourceHash: m.sourceHash,
        sourceSegmentIds: m.sourceSegmentIds,
        sourceOperationIds: m.sourceOperationIds,
        automaticExtraction: true,
        verticalPropertiesStatus: m.verticalPropertiesStatus,
      },
    });
    if (node.type !== 'column' || !String(node.id).startsWith('column_')) throw new Error('bad node shape');
    ok++;
  } catch (e) {
    failures.push(`${m.physicalColumnId}: ${(e as Error).message}`);
  }
}

console.log('COLUMN_SCHEMA_PROOF count=' + manifest.length + ' parsed=' + ok + ' failures=' + failures.length);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('COLUMN_SCHEMA_OK');
