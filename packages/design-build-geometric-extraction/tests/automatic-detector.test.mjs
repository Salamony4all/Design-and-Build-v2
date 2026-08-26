import test from 'node:test';
import assert from 'node:assert/strict';
import { CoordinateAdapter } from '../src/window/coordinate-adapter.ts';
import { AutomaticDetector } from '../src/window/automatic-detector.ts';

test('CoordinateAdapter: forward/inverse point mapping matches expected translation', () => {
  const ptStageA = { x: 500, y: 600 };
  const ptInstr = CoordinateAdapter.pointToInstr(ptStageA.x, ptStageA.y);
  
  // Translation is [259, 288]
  assert.equal(ptInstr.x, 500 - 259);
  assert.equal(ptInstr.y, 600 - 288);
  
  const back = CoordinateAdapter.pointToStageA(ptInstr.x, ptInstr.y);
  assert.ok(Math.abs(back.x - ptStageA.x) < 1e-9);
  assert.ok(Math.abs(back.y - ptStageA.y) < 1e-9);
});

test('CoordinateAdapter: forward/inverse bounds mapping matches expected translation', () => {
  const boundsStageA = [469, 568, 514, 598];
  const boundsInstr = CoordinateAdapter.stageAToInstr(boundsStageA);
  
  assert.deepEqual(boundsInstr, [210, 280, 255, 310]);
  
  const back = CoordinateAdapter.instrToStageA(boundsInstr);
  assert.deepEqual(back, boundsStageA);
});

test('CoordinateAdapter: mm scale conversions are consistent', () => {
  // 1 Stage A unit = 17.50355553021744 mm
  const mm = 100 * CoordinateAdapter.MM_PER_STAGE_A_UNIT;
  assert.ok(Math.abs(mm - 1750.355553021744) < 1e-6);
});

test('AutomaticDetector: handles empty inputs without crashing', () => {
  const detector = new AutomaticDetector();
  const res = detector.detect([], []);
  assert.equal(res.candidates.length, 0);
  assert.equal(res.features.length, 0);
});

test('AutomaticDetector: classifies features and generates parallel candidates within corridor', () => {
  const detector = new AutomaticDetector();
  
  const walls = [
    {
      physicalWallId: 'fr_test',
      centerline: { a: { x: 300, y: 600 }, b: { x: 900, y: 600 } }, // Horizontal wall
      thickness: 10,
    }
  ];

  // Two parallel lines inside corridor spaced 10px apart (y=595 and y=605)
  const operations = [
    {
      operationId: 'op1',
      transformedBounds: [400, 595, 500, 595],
      subpaths: [
        {
          subpathId: 'op1:s0',
          segments: [
            { segmentId: 'seg1', commandType: 'L', transformedBounds: [400, 595, 500, 595] }
          ]
        }
      ]
    },
    {
      operationId: 'op2',
      transformedBounds: [400, 605, 500, 605],
      subpaths: [
        {
          subpathId: 'op2:s0',
          segments: [
            { segmentId: 'seg2', commandType: 'L', transformedBounds: [400, 605, 500, 605] }
          ]
        }
      ]
    }
  ];

  const res = detector.detect(operations, walls);
  
  // Parallel pair spacing = 10, length = 100, which qualifies!
  assert.equal(res.candidates.length, 1);
  const cand = res.candidates[0];
  assert.equal(cand.physicalWallId, 'fr_test');
  assert.equal(cand.topologyClass, 'PARALLEL_FRAME_LINES');
  assert.equal(cand.extractionVerdict, 'ACCEPTED');
  
  // Check that features were extracted
  assert.equal(res.features.length, 2);
  assert.ok(res.features.some(f => f.sourceSegmentIds.includes('seg1')));
  assert.ok(res.features.some(f => f.sourceSegmentIds.includes('seg2')));
});
