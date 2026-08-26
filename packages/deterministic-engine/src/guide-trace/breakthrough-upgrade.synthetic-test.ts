import { buildGuideTraceGraph } from './maximal-line-guide-tracer';
import { AutoBuildEngine } from './auto-build-engine-upgraded';
import type { RawMaximalLine } from './guide-trace-types';

const raw: RawMaximalLine[] = [];
let id = 0;
for (const cfg of ['fine', 'medium', 'coarse']) {
  for (const [axis, c, a, b] of [
    ['H', 0, 0, 4], ['H', .2, 0, 4], ['H', 3, 0, 4], ['H', 3.2, 0, 4],
    ['V', 0, 0, 3.2], ['V', .2, 0, 3.2], ['V', 3.8, 0, 3.2], ['V', 4, 0, 3.2],
  ] as Array<['H'|'V', number, number, number]>) {
    raw.push({ id: `r${++id}`, axis, coordinateM: c, startM: a, endM: b, detectorConfigId: cfg, source: 'guide', confidence: .95 });
  }
}
const graph = buildGuideTraceGraph(raw, { junctionToleranceM: .25 });
console.log(JSON.stringify(graph.metrics));
if (graph.metrics.wallBandCount !== 4) throw new Error('Expected four wall bands');
const output = AutoBuildEngine.processGuideTrace({
  guideTrace: graph,
  graphFaces: [{ id: 'face_1', polygon: [[.1,.1],[3.9,.1],[3.9,3.1],[.1,3.1]], boundaryBandIds: graph.acceptedBands.map(b => b.id), areaM2: 11.4, signedAreaM2: 11.4, orientation: 'ccw', vertexCount: 4, virtualClosureEdgeCount: 0, containedSeedIds: ['seed_1'] }],
  roomSeeds: [{ id: 'seed_1', code: 'R-1', label: 'ROOM', point: [2, 1.5] }],
  diagnosticMode: true,
});
if (output.wallNodes.some(w => w.height !== 0)) throw new Error('Diagnostic walls must remain flat');
if (!output.validation.passed) throw new Error('Expected topology validation to pass');
