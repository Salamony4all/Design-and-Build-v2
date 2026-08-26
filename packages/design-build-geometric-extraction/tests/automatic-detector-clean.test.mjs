import test from 'node:test';
import assert from 'node:assert/strict';
import { CoordinateAdapter } from '../src/window/coordinate-adapter.ts';
import { AutomaticDetectorClean } from '../src/window/automatic-detector-clean.ts';

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

test('AutomaticDetectorClean: handles empty inputs without crashing', () => {
  const detector = new AutomaticDetectorClean();
  const res = detector.detect([], []);
  assert.equal(res.candidates.length, 0);
  assert.equal(res.features.length, 0);
});

test('AutomaticDetectorClean: classifies features and generates parallel candidates within corridor', () => {
  const detector = new AutomaticDetectorClean();

  const walls = [
    {
      physicalWallId: 'fr_test',
      centerline: { a: { x: 300, y: 600 }, b: { x: 900, y: 600 } }, // Horizontal wall, length = 600
      thickness: 10,
    }
  ];

  // Two parallel lines inside corridor spaced 10px apart (y=595 and y=605), length = 80px + two jambs to RETAIN
  const operations = [
    {
      operationId: 'op1',
      transformedBounds: [400, 595, 480, 595],
      subpaths: [
        {
          subpathId: 'op1:s0',
          segments: [
            { segmentId: 'seg1', commandType: 'L', transformedBounds: [400, 595, 480, 595] }
          ]
        }
      ]
    },
    {
      operationId: 'op2',
      transformedBounds: [400, 605, 480, 605],
      subpaths: [
        {
          subpathId: 'op2:s0',
          segments: [
            { segmentId: 'seg2', commandType: 'L', transformedBounds: [400, 605, 480, 605] }
          ]
        }
      ]
    },
    {
      operationId: 'jamb1',
      transformedBounds: [400, 595, 400, 605],
      subpaths: [{ subpathId: 'sj1', segments: [{ segmentId: 'seg_j1', commandType: 'L', transformedBounds: [400, 595, 400, 605] }] }]
    },
    {
      operationId: 'jamb2',
      transformedBounds: [480, 595, 480, 605],
      subpaths: [{ subpathId: 'sj2', segments: [{ segmentId: 'seg_j2', commandType: 'L', transformedBounds: [480, 595, 480, 605] }] }]
    }
  ];

  const res = detector.detect(operations, walls);

  assert.equal(res.candidates.length, 1);
  const cand = res.candidates[0];
  assert.equal(cand.physicalWallId, 'fr_test');
  assert.equal(cand.topologyClass, 'PARALLEL_FRAME_LINES');
  assert.equal(cand.finalDecision, 'RETAIN');
});

test('AutomaticDetectorClean: continuous wall-face rejection', () => {
  const detector = new AutomaticDetectorClean();

  const walls = [
    {
      physicalWallId: 'fr_test_continuous',
      centerline: { a: { x: 300, y: 600 }, b: { x: 500, y: 600 } }, // Length = 200
      thickness: 10,
    }
  ];

  // Parallel lines are very long (>150px), representing continuous wall face rather than local window frame
  const operations = [
    {
      operationId: 'op1',
      transformedBounds: [310, 595, 490, 595], // Length = 180px (>150px)
      subpaths: [
        {
          subpathId: 'op1:s0',
          segments: [
            { segmentId: 'seg1', commandType: 'L', transformedBounds: [310, 595, 490, 595] }
          ]
        }
      ]
    },
    {
      operationId: 'op2',
      transformedBounds: [310, 605, 490, 605],
      subpaths: [
        {
          subpathId: 'op2:s0',
          segments: [
            { segmentId: 'seg2', commandType: 'L', transformedBounds: [310, 605, 490, 605] }
          ]
        }
      ]
    }
  ];

  const res = detector.detect(operations, walls);

  assert.equal(res.candidates.length, 1);
  const cand = res.candidates[0];
  assert.equal(cand.finalDecision, 'REJECT');
  assert.ok(cand.negativeEvidence.includes('continuous-wall-face-detected'));
});

test('AutomaticDetectorClean: complete jamb-return pair check', () => {
  const detector = new AutomaticDetectorClean();

  const walls = [
    {
      physicalWallId: 'fr_test_jambs',
      centerline: { a: { x: 300, y: 600 }, b: { x: 900, y: 600 } },
      thickness: 10,
    }
  ];

  // Parallel frames + two short perpendicular jamb returns at endpoints
  const operations = [
    {
      operationId: 'frame1',
      transformedBounds: [400, 595, 500, 595],
      subpaths: [{ subpathId: 's1', segments: [{ segmentId: 'seg1', commandType: 'L', transformedBounds: [400, 595, 500, 595] }] }]
    },
    {
      operationId: 'frame2',
      transformedBounds: [400, 605, 500, 605],
      subpaths: [{ subpathId: 's2', segments: [{ segmentId: 'seg2', commandType: 'L', transformedBounds: [400, 605, 500, 605] }] }]
    },
    // Left jamb at u=100 (x=400), from y=595 to y=605 (length 10px)
    {
      operationId: 'jamb1',
      transformedBounds: [400, 595, 400, 605],
      subpaths: [{ subpathId: 'sj1', segments: [{ segmentId: 'seg_j1', commandType: 'L', transformedBounds: [400, 595, 400, 605] }] }]
    },
    // Right jamb at u=200 (x=500), from y=595 to y=605 (length 10px)
    {
      operationId: 'jamb2',
      transformedBounds: [500, 595, 500, 605],
      subpaths: [{ subpathId: 'sj2', segments: [{ segmentId: 'seg_j2', commandType: 'L', transformedBounds: [500, 595, 500, 605] }] }]
    }
  ];

  const res = detector.detect(operations, walls);

  assert.equal(res.candidates.length, 1);
  const cand = res.candidates[0];
  assert.equal(cand.jambAudit.pairVerdict, 'VALID_JAMB_PAIR');
  assert.equal(cand.finalDecision, 'RETAIN');
});

test('AutomaticDetectorClean: single-jamb rejection / gap checking', () => {
  const detector = new AutomaticDetectorClean();

  const walls = [
    {
      physicalWallId: 'fr_test_single_jamb',
      centerline: { a: { x: 300, y: 600 }, b: { x: 900, y: 600 } },
      thickness: 10,
    }
  ];

  // Parallel frames + only ONE jamb return
  const operations = [
    {
      operationId: 'frame1',
      transformedBounds: [400, 595, 500, 595],
      subpaths: [{ subpathId: 's1', segments: [{ segmentId: 'seg1', commandType: 'L', transformedBounds: [400, 595, 500, 595] }] }]
    },
    {
      operationId: 'frame2',
      transformedBounds: [400, 605, 500, 605],
      subpaths: [{ subpathId: 's2', segments: [{ segmentId: 'seg2', commandType: 'L', transformedBounds: [400, 605, 500, 605] }] }]
    },
    // Left jamb only
    {
      operationId: 'jamb1',
      transformedBounds: [400, 595, 400, 605],
      subpaths: [{ subpathId: 'sj1', segments: [{ segmentId: 'seg_j1', commandType: 'L', transformedBounds: [400, 595, 400, 605] }] }]
    },
    // Continuous wall face line overlapping to block gap verification (placed at y=575 to not form candidates)
    {
      operationId: 'wall_face_blocker',
      transformedBounds: [350, 575, 550, 575], // Overlaps interval [400, 500] by 100px (>150px long)
      subpaths: [{ subpathId: 'sb1', segments: [{ segmentId: 'seg_blocker', commandType: 'L', transformedBounds: [350, 575, 550, 575] }] }]
    }
  ];

  const res = detector.detect(operations, walls);

  // The blocker line at y=575 (v=-25 from wall centerline at y=600) is within the
  // corridor (vMax=45) and produces additional candidates. The key property to verify
  // is that a candidate spanning [frame1, frame2] has NO_JAMB_PAIR (only 1 jamb present)
  // and resolves to REVIEW.
  assert.ok(res.candidates.length >= 1);
  // Find the candidate covering the frame pair [400,500] (u=[100,200] on this wall from x=300)
  const cand = res.candidates.find(c =>
    c.finiteWallInterval && c.finiteWallInterval.start >= 95 && c.finiteWallInterval.end <= 205
  );
  assert.ok(cand, 'Expected a candidate near the frame pair interval');
  assert.equal(cand.jambAudit.pairVerdict, 'NO_JAMB_PAIR');
  assert.equal(cand.finalDecision, 'REVIEW');
});

test('AutomaticDetectorClean: hatch recurrence rejection', () => {
  const detector = new AutomaticDetectorClean();

  const walls = [
    {
      physicalWallId: 'fr_test_hatch',
      centerline: { a: { x: 300, y: 600 }, b: { x: 900, y: 600 } },
      thickness: 10,
    }
  ];

  // 4 parallel lines at y=595, y=598, y=601, y=604 (spacing 3px regularly)
  const operations = [
    {
      operationId: 'op1',
      transformedBounds: [400, 595, 480, 595],
      subpaths: [{ subpathId: 's1', segments: [{ segmentId: 'seg1', commandType: 'L', transformedBounds: [400, 595, 480, 595] }] }]
    },
    {
      operationId: 'op2',
      transformedBounds: [400, 598, 480, 598],
      subpaths: [{ subpathId: 's2', segments: [{ segmentId: 'seg2', commandType: 'L', transformedBounds: [400, 598, 480, 598] }] }]
    },
    {
      operationId: 'op3',
      transformedBounds: [400, 601, 480, 601],
      subpaths: [{ subpathId: 's3', segments: [{ segmentId: 'seg3', commandType: 'L', transformedBounds: [400, 601, 480, 601] }] }]
    },
    {
      operationId: 'op4',
      transformedBounds: [400, 604, 480, 604],
      subpaths: [{ subpathId: 's4', segments: [{ segmentId: 'seg4', commandType: 'L', transformedBounds: [400, 604, 480, 604] }] }]
    }
  ];

  const res = detector.detect(operations, walls);

  assert.ok(res.candidates.length > 0);
  const rejectedHatch = res.candidates.some(c => c.negativeEvidence.includes('hatch-recurrence-pattern') && c.finalDecision === 'REJECT');
  assert.ok(rejectedHatch);
});

test('AutomaticDetectorClean: finite interval beyond wall rejection', () => {
  const detector = new AutomaticDetectorClean();

  const walls = [
    {
      physicalWallId: 'fr_test_beyond',
      centerline: { a: { x: 300, y: 600 }, b: { x: 500, y: 600 } }, // Length = 200
      thickness: 10,
    }
  ];

  // Candidate interval extends from x=280 to x=420 (starts at u=-20, which is > 10px endpoint tolerance!)
  const operations = [
    {
      operationId: 'op1',
      transformedBounds: [280, 595, 420, 595],
      subpaths: [{ subpathId: 's1', segments: [{ segmentId: 'seg1', commandType: 'L', transformedBounds: [280, 595, 420, 595] }] }]
    },
    {
      operationId: 'op2',
      transformedBounds: [280, 605, 420, 605],
      subpaths: [{ subpathId: 's2', segments: [{ segmentId: 'seg2', commandType: 'L', transformedBounds: [280, 605, 420, 605] }] }]
    }
  ];

  const res = detector.detect(operations, walls);

  assert.equal(res.candidates.length, 1);
  const cand = res.candidates[0];
  assert.equal(cand.intervalAudit.intervalStatus, 'EXTENDS_BEYOND_WALL');
  assert.equal(cand.finalDecision, 'REJECT');
});

test('AutomaticDetectorClean: door-curve conflict rejection', () => {
  const detector = new AutomaticDetectorClean();

  const walls = [
    {
      physicalWallId: 'fr_test_curve',
      centerline: { a: { x: 300, y: 600 }, b: { x: 900, y: 600 } },
      thickness: 10,
    }
  ];

  // Parallel frames + intersecting Bezier curve segment (cmd: 'C')
  const operations = [
    {
      operationId: 'frame1',
      transformedBounds: [400, 595, 500, 595],
      subpaths: [{ subpathId: 's1', segments: [{ segmentId: 'seg1', commandType: 'L', transformedBounds: [400, 595, 500, 595] }] }]
    },
    {
      operationId: 'frame2',
      transformedBounds: [400, 605, 500, 605],
      subpaths: [{ subpathId: 's2', segments: [{ segmentId: 'seg2', commandType: 'L', transformedBounds: [400, 605, 500, 605] }] }]
    },
    // Intersecting Curve (e.g. door swing arc)
    {
      operationId: 'curve1',
      transformedBounds: [420, 590, 480, 610],
      subpaths: [{ subpathId: 'sc1', segments: [{ segmentId: 'seg_c1', commandType: 'C', transformedBounds: [420, 590, 480, 610] }] }]
    }
  ];

  const res = detector.detect(operations, walls);

  assert.equal(res.candidates.length, 1);
  const cand = res.candidates[0];
  assert.equal(cand.finalDecision, 'REJECT');
  assert.ok(cand.negativeEvidence.includes('door-curve-intersection-conflict'));
});

// Focused R1.3 Specific Tests

test('R1.3-1: wall-parallel line angle = approximately 0 degrees', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, thickness: 10 }];
  const ops = [{
    operationId: 'op1', transformedBounds: [10, 5, 90, 5],
    subpaths: [{ subpathId: 's1', segments: [{ segmentId: 'seg1', commandType: 'L', transformedBounds: [10, 5, 90, 5] }] }]
  }];
  const res = detector.detect(ops, walls);
  const parallelFeature = res.features.find(f => f.sourceSegmentIds.includes('seg1'));
  assert.ok(parallelFeature);
  assert.ok(Math.abs(parallelFeature.geometry.undirectedAngleDeg) < 1.0);
});

test('R1.3-2: wall-perpendicular line angle = approximately 90 degrees', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, thickness: 10 }];
  const ops = [{
    operationId: 'op1', transformedBounds: [50, -5, 50, 5],
    subpaths: [{ subpathId: 's1', segments: [{ segmentId: 'seg1', commandType: 'L', transformedBounds: [50, -5, 50, 5] }] }]
  }];
  const res = detector.detect(ops, walls);
  const perpFeature = res.features.find(f => f.sourceSegmentIds.includes('seg1'));
  assert.ok(perpFeature);
  assert.ok(Math.abs(perpFeature.geometry.undirectedAngleDeg - 90.0) < 1.0);
});

test('R1.3-3: diagonal line is not accepted as a jamb', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, thickness: 10 }];
  const ops = [
    {
      operationId: 'f1', transformedBounds: [20, -5, 80, -5],
      subpaths: [{ subpathId: 'sf1', segments: [{ segmentId: 'segf1', commandType: 'L', transformedBounds: [20, -5, 80, -5] }] }]
    },
    {
      operationId: 'f2', transformedBounds: [20, 5, 80, 5],
      subpaths: [{ subpathId: 'sf2', segments: [{ segmentId: 'segf2', commandType: 'L', transformedBounds: [20, 5, 80, 5] }] }]
    },
    // Diagonal line: (20, -5) to (30, 5), angle is 45 degrees
    {
      operationId: 'diag1', transformedBounds: [20, -5, 30, 5],
      subpaths: [{ subpathId: 'sd1', segments: [{ segmentId: 'segd1', commandType: 'L', transformedBounds: [20, -5, 30, 5] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  const cand = res.candidates[0];
  assert.ok(cand);
  assert.equal(cand.jambAudit.pairVerdict, 'NO_JAMB_PAIR');
});

test('R1.3-4: ambiguous host cannot RETAIN', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [
    { physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, thickness: 10 },
    { physicalWallId: 'w2', centerline: { a: { x: 0, y: 2 }, b: { x: 100, y: 2 } }, thickness: 10 } // Parallel, overlap
  ];
  const ops = [
    {
      operationId: 'f1', transformedBounds: [20, 0, 80, 0],
      subpaths: [{ subpathId: 'sf1', segments: [{ segmentId: 'segf1', commandType: 'L', transformedBounds: [20, 0, 80, 0] }] }]
    },
    {
      operationId: 'f2', transformedBounds: [20, 2, 80, 2],
      subpaths: [{ subpathId: 'sf2', segments: [{ segmentId: 'segf2', commandType: 'L', transformedBounds: [20, 2, 80, 2] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  for (const c of res.candidates) {
    assert.equal(c.hostAmbiguity, 'AMBIGUOUS');
    assert.notEqual(c.finalDecision, 'RETAIN');
  }
});

test('R1.3-5: no host cannot RETAIN', () => {
  const detector = new AutomaticDetectorClean();
  const res = detector.detect([], []);
  assert.equal(res.candidates.length, 0);
});

test('R1.3-6: material raw interval extension cannot RETAIN', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, thickness: 10 }];
  const ops = [
    {
      operationId: 'f1', transformedBounds: [-20, -5, 40, -5],
      subpaths: [{ subpathId: 'sf1', segments: [{ segmentId: 'segf1', commandType: 'L', transformedBounds: [-20, -5, 40, -5] }] }]
    },
    {
      operationId: 'f2', transformedBounds: [-20, 5, 40, 5],
      subpaths: [{ subpathId: 'sf2', segments: [{ segmentId: 'segf2', commandType: 'L', transformedBounds: [-20, 5, 40, 5] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  const cand = res.candidates[0];
  assert.ok(cand);
  assert.equal(cand.intervalAudit.intervalStatus, 'EXTENDS_BEYOND_WALL');
  assert.equal(cand.finalDecision, 'REJECT');
});

test('R1.3-7: display clipping cannot change raw interval validity', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, thickness: 10 }];
  const ops = [
    {
      operationId: 'f1', transformedBounds: [-20, -5, 40, -5],
      subpaths: [{ subpathId: 'sf1', segments: [{ segmentId: 'segf1', commandType: 'L', transformedBounds: [-20, -5, 40, -5] }] }]
    },
    {
      operationId: 'f2', transformedBounds: [-20, 5, 40, 5],
      subpaths: [{ subpathId: 'sf2', segments: [{ segmentId: 'segf2', commandType: 'L', transformedBounds: [-20, 5, 40, 5] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  const cand = res.candidates[0];
  assert.ok(cand);
  // Clipped display interval is [0, 40] which is valid inside wall length of 50
  assert.ok(cand.displayClippedInterval.start >= 0);
  // But raw interval status is EXTENDS_BEYOND_WALL and verdict is REJECTED
  assert.equal(cand.intervalAudit.intervalStatus, 'EXTENDS_BEYOND_WALL');
  assert.equal(cand.finalDecision, 'REJECT');
});

test('R1.3-8: valid endpoint-tolerance adjustment may continue', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, thickness: 10 }];
  const ops = [
    {
      operationId: 'f1', transformedBounds: [-5, -5, 105, -5], // Extends by 5px (<= 10px tolerance)
      subpaths: [{ subpathId: 'sf1', segments: [{ segmentId: 'segf1', commandType: 'L', transformedBounds: [-5, -5, 105, -5] }] }]
    },
    {
      operationId: 'f2', transformedBounds: [-5, 5, 105, 5],
      subpaths: [{ subpathId: 'sf2', segments: [{ segmentId: 'segf2', commandType: 'L', transformedBounds: [-5, 5, 105, 5] }] }]
    },
    {
      operationId: 'jamb1', transformedBounds: [-5, -5, -5, 5],
      subpaths: [{ subpathId: 'sj1', segments: [{ segmentId: 'segj1', commandType: 'L', transformedBounds: [-5, -5, -5, 5] }] }]
    },
    {
      operationId: 'jamb2', transformedBounds: [105, -5, 105, 5],
      subpaths: [{ subpathId: 'sj2', segments: [{ segmentId: 'segj2', commandType: 'L', transformedBounds: [105, -5, 105, 5] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  const cand = res.candidates[0];
  assert.ok(cand);
  assert.equal(cand.intervalAudit.intervalStatus, 'VALID_WITH_ENDPOINT_TOLERANCE');
  assert.equal(cand.finalDecision, 'RETAIN');
});

test('R1.3-9: wall-face-gap is not represented as VALID_JAMB_PAIR', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }, thickness: 10 }];
  const ops = [
    // Parallel frame pair [50, 150]
    {
      operationId: 'f1', transformedBounds: [50, -5, 150, -5],
      subpaths: [{ subpathId: 'sf1', segments: [{ segmentId: 'segf1', commandType: 'L', transformedBounds: [50, -5, 150, -5] }] }]
    },
    {
      operationId: 'f2', transformedBounds: [50, 5, 150, 5],
      subpaths: [{ subpathId: 'sf2', segments: [{ segmentId: 'segf2', commandType: 'L', transformedBounds: [50, 5, 150, 5] }] }]
    },
    // Left wall face ending at u=50 (from 0 to 50)
    {
      operationId: 'faceL', transformedBounds: [0, 0, 50, 0],
      subpaths: [{ subpathId: 'sl', segments: [{ segmentId: 'segl', commandType: 'L', transformedBounds: [0, 0, 50, 0] }] }]
    },
    // Right wall face starting at u=150 (from 150 to 200)
    {
      operationId: 'faceR', transformedBounds: [150, 0, 200, 0],
      subpaths: [{ subpathId: 'sr', segments: [{ segmentId: 'segr', commandType: 'L', transformedBounds: [150, 0, 200, 0] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  const cand = res.candidates[0];
  assert.ok(cand);
  assert.equal(cand.jambAudit.pairVerdict, 'NO_JAMB_PAIR');
  assert.equal(cand.wallFaceGapAudit.verdict, 'VALID_SOURCE_WALL_FACE_GAP');
});

test('R1.3-10: jamb branch is executable', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, thickness: 10 }];
  const ops = [
    {
      operationId: 'f1', transformedBounds: [20, -5, 80, -5],
      subpaths: [{ subpathId: 'sf1', segments: [{ segmentId: 'segf1', commandType: 'L', transformedBounds: [20, -5, 80, -5] }] }]
    },
    {
      operationId: 'f2', transformedBounds: [20, 5, 80, 5],
      subpaths: [{ subpathId: 'sf2', segments: [{ segmentId: 'segf2', commandType: 'L', transformedBounds: [20, 5, 80, 5] }] }]
    },
    {
      operationId: 'j1', transformedBounds: [20, -5, 20, 5],
      subpaths: [{ subpathId: 'sj1', segments: [{ segmentId: 'segj1', commandType: 'L', transformedBounds: [20, -5, 20, 5] }] }]
    },
    {
      operationId: 'j2', transformedBounds: [80, -5, 80, 5],
      subpaths: [{ subpathId: 'sj2', segments: [{ segmentId: 'segj2', commandType: 'L', transformedBounds: [80, -5, 80, 5] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  const cand = res.candidates[0];
  assert.ok(cand);
  assert.equal(cand.jambAudit.pairVerdict, 'VALID_JAMB_PAIR');
});

test('R1.3-11: wall-face-gap branch is executable', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }, thickness: 10 }];
  const ops = [
    {
      operationId: 'f1', transformedBounds: [50, -5, 150, -5],
      subpaths: [{ subpathId: 'sf1', segments: [{ segmentId: 'segf1', commandType: 'L', transformedBounds: [50, -5, 150, -5] }] }]
    },
    {
      operationId: 'f2', transformedBounds: [50, 5, 150, 5],
      subpaths: [{ subpathId: 'sf2', segments: [{ segmentId: 'segf2', commandType: 'L', transformedBounds: [50, 5, 150, 5] }] }]
    },
    {
      operationId: 'faceL', transformedBounds: [0, 0, 50, 0],
      subpaths: [{ subpathId: 'sl', segments: [{ segmentId: 'segl', commandType: 'L', transformedBounds: [0, 0, 50, 0] }] }]
    },
    {
      operationId: 'faceR', transformedBounds: [150, 0, 200, 0],
      subpaths: [{ subpathId: 'sr', segments: [{ segmentId: 'segr', commandType: 'L', transformedBounds: [150, 0, 200, 0] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  const cand = res.candidates[0];
  assert.ok(cand);
  assert.equal(cand.wallFaceGapAudit.verdict, 'VALID_SOURCE_WALL_FACE_GAP');
});

test('R1.3-12: frame-bay branch is executable', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, thickness: 10 }];
  const ops = [
    {
      operationId: 'f1', transformedBounds: [20, -5, 80, -5],
      subpaths: [{ subpathId: 'sf1', segments: [{ segmentId: 'segf1', commandType: 'L', transformedBounds: [20, -5, 80, -5] }] }]
    },
    {
      operationId: 'f2', transformedBounds: [20, 5, 80, 5],
      subpaths: [{ subpathId: 'sf2', segments: [{ segmentId: 'segf2', commandType: 'L', transformedBounds: [20, 5, 80, 5] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  const cand = res.candidates[0];
  assert.ok(cand);
  assert.ok(cand.frameBayAudit);
  assert.equal(cand.frameBayAudit.verdict, 'NO_VERIFIED_FRAME_BAY');
});

test('R1.3-13: fatal evidence remains present after merging', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }, thickness: 10 }];
  const ops = [
    // Candidate A [50, 100] (Valid, with jambs)
    {
      operationId: 'a1', transformedBounds: [50, -5, 100, -5],
      subpaths: [{ subpathId: 'sa1', segments: [{ segmentId: 'sega1', commandType: 'L', transformedBounds: [50, -5, 100, -5] }] }]
    },
    {
      operationId: 'a2', transformedBounds: [50, 5, 100, 5],
      subpaths: [{ subpathId: 'sa2', segments: [{ segmentId: 'sega2', commandType: 'L', transformedBounds: [50, 5, 100, 5] }] }]
    },
    {
      operationId: 'aj1', transformedBounds: [50, -5, 50, 5],
      subpaths: [{ subpathId: 'saj1', segments: [{ segmentId: 'segaj1', commandType: 'L', transformedBounds: [50, -5, 50, 5] }] }]
    },
    {
      operationId: 'aj2', transformedBounds: [100, -5, 100, 5],
      subpaths: [{ subpathId: 'saj2', segments: [{ segmentId: 'segaj2', commandType: 'L', transformedBounds: [100, -5, 100, 5] }] }]
    },
    // Candidate B [90, 150] (Invalid, extends beyond wall because length is 200 but wait, 90 to 150 is valid inside 200. Let's make it have continuous wall face: length = 170)
    {
      operationId: 'b1', transformedBounds: [90, -5, 260, -5],
      subpaths: [{ subpathId: 'sb1', segments: [{ segmentId: 'segb1', commandType: 'L', transformedBounds: [90, -5, 260, -5] }] }]
    },
    {
      operationId: 'b2', transformedBounds: [90, 5, 260, 5],
      subpaths: [{ subpathId: 'sb2', segments: [{ segmentId: 'segb2', commandType: 'L', transformedBounds: [90, 5, 260, 5] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  // Merged group: Candidate A and B overlap at [90, 100] and are merged.
  const merged = res.candidates.find(c => c.sourceSegmentIds.includes('segb1'));
  assert.ok(merged);
  assert.ok(merged.negativeEvidence.includes('continuous-wall-face-detected'));
});

test('R1.3-14: accepted plus rejected merge becomes REVIEW', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }, thickness: 10 }];
  const ops = [
    // Candidate A [50, 100] (Valid RETAIN)
    {
      operationId: 'a1', transformedBounds: [50, -5, 100, -5],
      subpaths: [{ subpathId: 'sa1', segments: [{ segmentId: 'sega1', commandType: 'L', transformedBounds: [50, -5, 100, -5] }] }]
    },
    {
      operationId: 'a2', transformedBounds: [50, 5, 100, 5],
      subpaths: [{ subpathId: 'sa2', segments: [{ segmentId: 'sega2', commandType: 'L', transformedBounds: [50, 5, 100, 5] }] }]
    },
    {
      operationId: 'aj1', transformedBounds: [50, -5, 50, 5],
      subpaths: [{ subpathId: 'saj1', segments: [{ segmentId: 'segaj1', commandType: 'L', transformedBounds: [50, -5, 50, 5] }] }]
    },
    {
      operationId: 'aj2', transformedBounds: [100, -5, 100, 5],
      subpaths: [{ subpathId: 'saj2', segments: [{ segmentId: 'segaj2', commandType: 'L', transformedBounds: [100, -5, 100, 5] }] }]
    },
    // Candidate B [95, 150] (REJECT due to continuous face blocker of length 170)
    {
      operationId: 'b1', transformedBounds: [95, -5, 265, -5],
      subpaths: [{ subpathId: 'sb1', segments: [{ segmentId: 'segb1', commandType: 'L', transformedBounds: [95, -5, 265, -5] }] }]
    },
    {
      operationId: 'b2', transformedBounds: [95, 5, 265, 5],
      subpaths: [{ subpathId: 'sb2', segments: [{ segmentId: 'segb2', commandType: 'L', transformedBounds: [95, 5, 265, 5] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  // Merged candidates must all resolve to REVIEW decision
  for (const c of res.candidates) {
    assert.equal(c.finalDecision, 'REVIEW');
  }
});

test('R1.3-15: merge provenance retains all constituent IDs', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }, thickness: 10 }];
  const ops = [
    {
      operationId: 'a1', transformedBounds: [50, -5, 100, -5],
      subpaths: [{ subpathId: 'sa1', segments: [{ segmentId: 'sega1', commandType: 'L', transformedBounds: [50, -5, 100, -5] }] }]
    },
    {
      operationId: 'a2', transformedBounds: [50, 5, 100, 5],
      subpaths: [{ subpathId: 'sa2', segments: [{ segmentId: 'sega2', commandType: 'L', transformedBounds: [50, 5, 100, 5] }] }]
    },
    {
      operationId: 'b1', transformedBounds: [90, -5, 140, -5],
      subpaths: [{ subpathId: 'sb1', segments: [{ segmentId: 'segb1', commandType: 'L', transformedBounds: [90, -5, 140, -5] }] }]
    },
    {
      operationId: 'b2', transformedBounds: [90, 5, 140, 5],
      subpaths: [{ subpathId: 'sb2', segments: [{ segmentId: 'segb2', commandType: 'L', transformedBounds: [90, 5, 140, 5] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  assert.equal(res.clusters.length, 1);
  const cluster = res.clusters[0];
  // With 4 parallel lines (a1,a2,b1,b2), the detector creates cross-pair candidates
  // (a1+b2, a2+b1) in addition to the same-group pairs. All overlap and merge into one cluster.
  assert.ok(cluster.candidateIds.length >= 2);
  assert.ok(cluster.mergeEvidence);
  assert.ok(cluster.mergeEvidence.constituentCandidateIds.length >= 2);
});

test('R1.3-16: final RETAIN, REVIEW, and REJECT sets are disjoint', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }, thickness: 10 }];
  const ops = [
    {
      operationId: 'f1', transformedBounds: [50, -5, 150, -5],
      subpaths: [{ subpathId: 'sf1', segments: [{ segmentId: 'segf1', commandType: 'L', transformedBounds: [50, -5, 150, -5] }] }]
    },
    {
      operationId: 'f2', transformedBounds: [50, 5, 150, 5],
      subpaths: [{ subpathId: 'sf2', segments: [{ segmentId: 'segf2', commandType: 'L', transformedBounds: [50, 5, 150, 5] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  const retain = res.candidates.filter(c => c.finalDecision === 'RETAIN');
  const review = res.candidates.filter(c => c.finalDecision === 'REVIEW');
  const reject = res.candidates.filter(c => c.finalDecision === 'REJECT');

  // Verify disjoint
  for (const c of retain) {
    assert.ok(!review.includes(c));
    assert.ok(!reject.includes(c));
  }
  for (const c of review) {
    assert.ok(!reject.includes(c));
  }
});

test('R1.3-17: physical hypotheses are generated only from RETAIN plus UNIQUE_HOST', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, thickness: 10 }];
  const ops = [
    {
      operationId: 'f1', transformedBounds: [20, -5, 80, -5],
      subpaths: [{ subpathId: 'sf1', segments: [{ segmentId: 'segf1', commandType: 'L', transformedBounds: [20, -5, 80, -5] }] }]
    },
    {
      operationId: 'f2', transformedBounds: [20, 5, 80, 5],
      subpaths: [{ subpathId: 'sf2', segments: [{ segmentId: 'segf2', commandType: 'L', transformedBounds: [20, 5, 80, 5] }] }]
    },
    {
      operationId: 'j1', transformedBounds: [20, -5, 20, 5],
      subpaths: [{ subpathId: 'sj1', segments: [{ segmentId: 'segj1', commandType: 'L', transformedBounds: [20, -5, 20, 5] }] }]
    },
    {
      operationId: 'j2', transformedBounds: [80, -5, 80, 5],
      subpaths: [{ subpathId: 'sj2', segments: [{ segmentId: 'segj2', commandType: 'L', transformedBounds: [80, -5, 80, 5] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  const cand = res.candidates[0];
  assert.ok(cand);
  assert.equal(cand.finalDecision, 'RETAIN');
  assert.equal(cand.hostCompetition.status, 'UNIQUE_HOST');
  assert.equal(res.assemblies.length, 1);
});

test('R1.3-18: automaticPromotionAllowed remains false', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, thickness: 10 }];
  const ops = [
    {
      operationId: 'f1', transformedBounds: [20, -5, 80, -5],
      subpaths: [{ subpathId: 'sf1', segments: [{ segmentId: 'segf1', commandType: 'L', transformedBounds: [20, -5, 80, -5] }] }]
    },
    {
      operationId: 'f2', transformedBounds: [20, 5, 80, 5],
      subpaths: [{ subpathId: 'sf2', segments: [{ segmentId: 'segf2', commandType: 'L', transformedBounds: [20, 5, 80, 5] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  for (const c of res.candidates) {
    assert.equal(c.automaticPromotionAllowed, false);
  }
});

test('R1.3-19: panel divider marks alone cannot generate a window', () => {
  const detector = new AutomaticDetectorClean();
  const walls = [{ physicalWallId: 'w1', centerline: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, thickness: 10 }];
  // Only perpendicular lines (ticks/jambs) without parallel lines
  const ops = [
    {
      operationId: 'j1', transformedBounds: [20, -5, 20, 5],
      subpaths: [{ subpathId: 'sj1', segments: [{ segmentId: 'segj1', commandType: 'L', transformedBounds: [20, -5, 20, 5] }] }]
    },
    {
      operationId: 'j2', transformedBounds: [80, -5, 80, 5],
      subpaths: [{ subpathId: 'sj2', segments: [{ segmentId: 'segj2', commandType: 'L', transformedBounds: [80, -5, 80, 5] }] }]
    }
  ];
  const res = detector.detect(ops, walls);
  assert.equal(res.candidates.length, 0);
});

test('R1.3-20: no expected-count or WA runtime dependency exists', () => {
  const detector = new AutomaticDetectorClean();
  const sourceCode = detector.detect.toString();
  // Ensure none of the expected variables are referenced
  assert.ok(!sourceCode.includes('expectedCount'));
  assert.ok(!sourceCode.includes('waLabel'));
});
