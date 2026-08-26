// Frozen accepted-column manifest (rectangular/square only, proven).
// Emitted from ONE consistent run; deterministic. Mirrors extraction-mupdf's
// captured-geometry entry point output shape.
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { extractColumns } from '../src/columns.ts';
import { loadUnclaimedGeometry } from '../src/fixture.ts';

const DEFAULT_COLUMN_HEIGHT_M = 3; // configurable default; not source-measured
const EV = join(process.cwd(), 'evidence');
mkdirSync(EV, { recursive: true });

const g: any = loadUnclaimedGeometry();
const cols = extractColumns(g);
const accepted = cols
  .filter((c: any) => c.verdict === 'ACCEPT' && c.footprintType === 'RECTANGULAR')
  .sort((a: any, b: any) => (a.physicalColumnId < b.physicalColumnId ? -1 : 1));

const manifest = accepted.map((c: any) => ({
  physicalColumnId: c.physicalColumnId,
  footprintType: 'RECTANGULAR',
  centreProjectM: c.centreProjectM,
  widthM: c.widthM ?? 0,
  depthM: c.depthM ?? 0,
  rotationRad: c.rotationRad,
  heightM: DEFAULT_COLUMN_HEIGHT_M,
  sourceSegmentIds: c.sourceSegmentIds,
  sourceOperationIds: c.sourceOperationIds,
  sourceHash: g.sourceHash,
  verdict: 'ACCEPT',
  verticalPropertiesStatus: 'DEFAULT_NOT_SOURCE_MEASURED',
}));

writeFileSync(join(EV, 'accepted-column-manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(EV, 'accepted-manifest-summary.json'), JSON.stringify({
  count: manifest.length,
  allRectangular: manifest.every((m) => m.footprintType === 'RECTANGULAR' && m.verdict === 'ACCEPT'),
  verticalPropertiesStatus: 'DEFAULT_NOT_SOURCE_MEASURED',
  sourceHash: g.sourceHash,
}, null, 2));
console.log('MANIFEST_WRITTEN count=' + manifest.length + ' allRectangular=' + manifest.every((m) => m.footprintType === 'RECTANGULAR'));
