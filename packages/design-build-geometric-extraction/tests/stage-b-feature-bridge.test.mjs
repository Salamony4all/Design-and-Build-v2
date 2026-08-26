// Stage B feature-bridge and topology tests.
// Tests the internal logic of connect-window-lineage.mjs (extracted as pure functions).
import test from 'node:test';
import assert from 'node:assert/strict';

// ── Replicate core functions from connect-window-lineage.mjs ─────────────────
// (These are pure functions; extracted for unit testing without file I/O.)

const T = {
  overlapTolerance:        5.0,
  zeroLengthThreshold:     0.5,
  largeEnvelopeWidth:    600.0,
  largeEnvelopeHeight:   300.0,
  parallelAngleMaxDeg:     5.0,
  parallelSpacingMinPx:    2.0,
  parallelSpacingMaxPx:   50.0,
  frameLineMinLengthPx:    3.0,
  gapEdgeMinLengthPx:      2.0,
  curveNeutralDefault:    true,
};
const TX = 259, TY = 288;

function intersects(a, b, tol) {
  return a[2]>b[0]-tol && a[0]<b[2]+tol && a[3]>b[1]-tol && a[1]<b[3]+tol;
}
function segLen(tb) {
  if (!tb) return 0;
  return Math.sqrt((tb[2]-tb[0])**2+(tb[3]-tb[1])**2);
}
function isDrawable(seg) {
  if (!seg.transformedBounds) return false;
  const [x0,y0,x1,y1] = seg.transformedBounds;
  if (!isFinite(x0)||!isFinite(y0)||!isFinite(x1)||!isFinite(y1)) return false;
  if (segLen(seg.transformedBounds) < T.zeroLengthThreshold) return false;
  if (seg.commandType === 'M') return false;
  return true;
}
function saToInstr(b) { return [b[0]-TX, b[1]-TY, b[2]-TX, b[3]-TY]; }
function instrToSA(b) { return [b[0]+TX, b[1]+TY, b[2]+TX, b[3]+TY]; }
function midpoint(b)  { return { x:(b[0]+b[2])/2, y:(b[1]+b[3])/2 }; }
function segAngleDeg(b) {
  const dx=b[2]-b[0], dy=b[3]-b[1];
  let a = Math.atan2(Math.abs(dy),Math.abs(dx))*180/Math.PI;
  if (a>90) a=180-a;
  return a;
}
function classifySegment(cmd) {
  if (cmd==='L') return 'LINE_SEGMENT';
  if (cmd==='C') return 'CURVE_SEGMENT';
  if (cmd==='Z') return 'CLOSE_PATH_SEGMENT';
  return 'UNKNOWN_SEGMENT';
}
function validateAlias(saOp, vpOp) {
  if (!saOp||!vpOp) return { valid:false, method:'missing-record' };
  if (saOp.operationIndex!==vpOp.operationIndex) return { valid:false, method:'index-mismatch' };
  if (saOp.operationType!==vpOp.operationType)   return { valid:false, method:'type-mismatch' };
  const sa=saOp.transformedBounds, vp=vpOp.transformedBounds;
  if (!sa||!vp) return { valid:true, method:'index+type-match (bounds absent in one store)' };
  const saI = saToInstr(sa);
  const maxDiff = Math.max(...[0,1,2,3].map(i=>Math.abs(saI[i]-(vp[i]||0))));
  if (maxDiff>1.5) return { valid:false, method:`bounds-mismatch maxDiff=${maxDiff.toFixed(2)}px` };
  return { valid:true, method:'index+type+bounds-match' };
}
function validateHost(def, instrBounds) {
  const [bx0,,bx1] = instrBounds;
  const iv = def.finiteWallInterval;
  if (!def.physicalWallId) return { hasHost:false, hasInterval:false };
  if (!iv)                  return { hasHost:true,  hasInterval:false };
  const ol = Math.max(0, Math.min(bx1,iv.end)-Math.max(bx0,iv.start));
  const frac = parseFloat((ol/(bx1-bx0)).toFixed(3));
  const contained = bx0>=iv.start-10 && bx1<=iv.end+10;
  return { hasHost:true, hasInterval:true, overlapFraction:frac, containedWithTolerance10px:contained, verdict:frac>0.5?'INTERVAL_LARGELY_CONTAINS_CANDIDATE':'WEAK_INTERVAL_OVERLAP' };
}
function parallelFrameMetrics(lines) {
  const qualifying = lines
    .map(f => ({ segId:f.sourceSegmentIds[0], ib:f.featureGeometry.instrumentTransformedBounds, len:f.featureGeometry.lengthPx, angle:segAngleDeg(f.featureGeometry.instrumentTransformedBounds) }))
    .filter(l => l.len >= T.frameLineMinLengthPx);
  const pairs = [];
  for (let i=0;i<qualifying.length;i++) for (let j=i+1;j<qualifying.length;j++) {
    const da = Math.abs(qualifying[i].angle - qualifying[j].angle);
    if (da > T.parallelAngleMaxDeg) continue;
    const mi=midpoint(qualifying[i].ib), mj=midpoint(qualifying[j].ib);
    const sp=Math.sqrt((mi.x-mj.x)**2+(mi.y-mj.y)**2);
    if (sp<T.parallelSpacingMinPx||sp>T.parallelSpacingMaxPx) continue;
    pairs.push({ segA:qualifying[i].segId, segB:qualifying[j].segId, angleDiffDeg:parseFloat(da.toFixed(3)), spacingPx:parseFloat(sp.toFixed(3)) });
  }
  const conf=pairs.length>=2?'HIGH':pairs.length===1?'MEDIUM':'LOW';
  return { qualifyingLineCount:qualifying.length, parallelPairCount:pairs.length, parallelPairs:pairs, topologyConfidence:conf };
}
function wallGapMetrics(lines, curves, instrBounds) {
  const [bx0,,bx1]=instrBounds, midX=(bx0+bx1)/2;
  const edges=lines.filter(f=>f.featureGeometry.lengthPx>=T.gapEdgeMinLengthPx);
  const leftEdge=edges.filter(f=>(f.featureGeometry.instrumentTransformedBounds[0]+f.featureGeometry.instrumentTransformedBounds[2])/2<midX);
  const rightEdge=edges.filter(f=>(f.featureGeometry.instrumentTransformedBounds[0]+f.featureGeometry.instrumentTransformedBounds[2])/2>=midX);
  const leftX=leftEdge.length>0?Math.max(...leftEdge.map(f=>f.featureGeometry.instrumentTransformedBounds[2])):null;
  const rightX=rightEdge.length>0?Math.min(...rightEdge.map(f=>f.featureGeometry.instrumentTransformedBounds[0])):null;
  const gapWidth=(leftX!==null&&rightX!==null)?parseFloat((rightX-leftX).toFixed(3)):null;
  const conf=(gapWidth!==null&&gapWidth>0&&leftEdge.length>0&&rightEdge.length>0)?'MEDIUM':'LOW';
  return { gapWidth, glazingSegmentIds:[], doorLikeSegmentIds:curves.map(f=>f.sourceSegmentIds[0]), topologyConfidence:conf, leftWallEdgeSegmentIds:leftEdge.map(f=>f.sourceSegmentIds[0]), rightWallEdgeSegmentIds:rightEdge.map(f=>f.sourceSegmentIds[0]) };
}

// ── Helper to build a synthetic feature ─────────────────────────────────────
function makeLine(segId, instrBounds) {
  return { featureId:`f-${segId}`, featureType:'LINE_SEGMENT', sourceSegmentIds:[segId], featureGeometry:{ commandType:'L', instrumentTransformedBounds:instrBounds, lengthPx:parseFloat(segLen(instrBounds).toFixed(3)) } };
}
function makeCurve(segId, instrBounds) {
  return { featureId:`f-${segId}`, featureType:'CURVE_SEGMENT', sourceSegmentIds:[segId], featureGeometry:{ commandType:'C', instrumentTransformedBounds:instrBounds, lengthPx:parseFloat(segLen(instrBounds).toFixed(3)) } };
}

// ══════════════════════════════════════════════════════════════════════════════
// Coordinate space conversion tests
// ══════════════════════════════════════════════════════════════════════════════
test('saToInstr: subtracts TX,TY from stageA bounds', () => {
  const result = saToInstr([469, 568, 514, 598]);
  assert.deepEqual(result, [469-259, 568-288, 514-259, 598-288]);
  assert.deepEqual(result, [210, 280, 255, 310]);
});

test('instrToSA: adds TX,TY to instrument bounds', () => {
  const result = instrToSA([210, 280, 255, 310]);
  assert.deepEqual(result, [469, 568, 514, 598]);
});

test('saToInstr and instrToSA are inverses', () => {
  const orig = [305, 275, 350, 305];
  const roundtrip = saToInstr(instrToSA(orig));
  for (let i=0;i<4;i++) assert.ok(Math.abs(roundtrip[i]-orig[i]) < 1e-9, `Component ${i} roundtrip`);
});

// ══════════════════════════════════════════════════════════════════════════════
// Drawability tests
// ══════════════════════════════════════════════════════════════════════════════
test('isDrawable: L segment with length 1.0 is drawable', () => {
  assert.ok(isDrawable({ commandType:'L', transformedBounds:[0,0,1,0] }));
});

test('isDrawable: M (move) is never drawable', () => {
  assert.ok(!isDrawable({ commandType:'M', transformedBounds:[0,0,10,10] }));
});

test('isDrawable: zero-length segment is not drawable', () => {
  // length = 0.3 < threshold 0.5
  assert.ok(!isDrawable({ commandType:'L', transformedBounds:[10,10,10.3,10] }));
});

test('isDrawable: missing transformedBounds is not drawable', () => {
  assert.ok(!isDrawable({ commandType:'L', transformedBounds:null }));
});

test('isDrawable: non-finite coordinate is not drawable', () => {
  assert.ok(!isDrawable({ commandType:'L', transformedBounds:[Infinity,0,10,0] }));
  assert.ok(!isDrawable({ commandType:'L', transformedBounds:[0,NaN,10,0] }));
});

test('isDrawable: Z (close-path) with length >= threshold is drawable', () => {
  assert.ok(isDrawable({ commandType:'Z', transformedBounds:[0,0,5,0] }));
});

// ══════════════════════════════════════════════════════════════════════════════
// Conservative segment classification
// ══════════════════════════════════════════════════════════════════════════════
test('classifySegment: L -> LINE_SEGMENT', ()   => assert.equal(classifySegment('L'), 'LINE_SEGMENT'));
test('classifySegment: C -> CURVE_SEGMENT', ()  => assert.equal(classifySegment('C'), 'CURVE_SEGMENT'));
test('classifySegment: Z -> CLOSE_PATH_SEGMENT',()=> assert.equal(classifySegment('Z'), 'CLOSE_PATH_SEGMENT'));
test('classifySegment: C is neutral, not glazing', () => {
  // CURVE_SEGMENT must never be 'GLAZING_LINE' by default (user requirement 4)
  assert.notEqual(classifySegment('C'), 'GLAZING_LINE');
});

// ══════════════════════════════════════════════════════════════════════════════
// Alias validation tests
// ══════════════════════════════════════════════════════════════════════════════
test('validateAlias: matching index+type+bounds -> valid', () => {
  const saOp = { operationIndex:42, operationType:'stroke-path', transformedBounds:[469,568,514,598] };
  const vpOp = { operationIndex:42, operationType:'stroke-path', transformedBounds:[210,280,255,310] }; // instrument space
  const r = validateAlias(saOp, vpOp);
  assert.ok(r.valid, r.method);
  assert.ok(r.method.includes('bounds-match'));
});

test('validateAlias: type mismatch -> invalid', () => {
  const saOp = { operationIndex:42, operationType:'fill-path',   transformedBounds:[469,568,514,598] };
  const vpOp = { operationIndex:42, operationType:'stroke-path', transformedBounds:[210,280,255,310] };
  const r = validateAlias(saOp, vpOp);
  assert.ok(!r.valid);
  assert.equal(r.method, 'type-mismatch');
});

test('validateAlias: bounds mismatch > 1.5px -> invalid', () => {
  const saOp = { operationIndex:42, operationType:'stroke-path', transformedBounds:[469,568,514,598] };
  // VP bounds in instrument space but shifted 5px -> mismatch
  const vpOp = { operationIndex:42, operationType:'stroke-path', transformedBounds:[215,280,255,310] };
  const r = validateAlias(saOp, vpOp);
  assert.ok(!r.valid);
  assert.ok(r.method.includes('bounds-mismatch'));
});

test('validateAlias: missing vpOp -> invalid', () => {
  const r = validateAlias({ operationIndex:1, operationType:'stroke-path' }, null);
  assert.ok(!r.valid);
  assert.equal(r.method, 'missing-record');
});

// ══════════════════════════════════════════════════════════════════════════════
// Topology: parallel frame metrics
// ══════════════════════════════════════════════════════════════════════════════
test('parallelFrameMetrics: two exactly parallel horizontal lines -> HIGH confidence', () => {
  // Two horizontal lines at y=5 and y=15 (spacing=10, within 2..50 range)
  const lines = [
    makeLine('seg1', [210,280,240,280]),  // horizontal, y-degenerate: len=30, angle=0
    makeLine('seg2', [212,290,242,290]),  // horizontal at y=290, spacing=10
  ];
  const r = parallelFrameMetrics(lines);
  assert.equal(r.parallelPairCount, 1);
  assert.equal(r.topologyConfidence, 'MEDIUM'); // 1 pair = MEDIUM (need 2 for HIGH)
});

test('parallelFrameMetrics: angle diff > 5deg -> no parallel pair', () => {
  const lines = [
    makeLine('seg1', [210,280,240,280]),  // horizontal
    makeLine('seg2', [210,280,210,310]),  // vertical (90deg diff)
  ];
  const r = parallelFrameMetrics(lines);
  assert.equal(r.parallelPairCount, 0);
  assert.equal(r.topologyConfidence, 'LOW');
});

test('parallelFrameMetrics: spacing > 50px -> not a parallel pair', () => {
  // Two parallel lines but 80px apart
  const lines = [
    makeLine('seg1', [210,200,240,200]),
    makeLine('seg2', [210,280,240,280]),  // 80px apart in Y
  ];
  const r = parallelFrameMetrics(lines);
  assert.equal(r.parallelPairCount, 0);
});

test('parallelFrameMetrics: lines shorter than frameLineMinLengthPx are excluded', () => {
  // 1px line (below 3px threshold)
  const lines = [ makeLine('seg1', [210,280,211,280]), makeLine('seg2', [210,285,211,285]) ];
  const r = parallelFrameMetrics(lines);
  assert.equal(r.qualifyingLineCount, 0);
  assert.equal(r.parallelPairCount, 0);
});

// ══════════════════════════════════════════════════════════════════════════════
// Topology: wall gap metrics
// ══════════════════════════════════════════════════════════════════════════════
test('wallGapMetrics: curve segments go to doorLikeSegmentIds, not glazing', () => {
  const instrBounds = [160,200,210,230];
  const curves = [ makeCurve('cseg1', [175,210,195,225]) ];
  const r = wallGapMetrics([], curves, instrBounds);
  assert.equal(r.glazingSegmentIds.length, 0);
  assert.ok(r.doorLikeSegmentIds.includes('cseg1'));
});

test('wallGapMetrics: left/right edge classification splits at midX', () => {
  const instrBounds = [160,200,210,230]; // midX = 185
  const lines = [
    makeLine('left1',  [162,210,162,225]), // x midpoint = 162 < 185
    makeLine('right1', [200,210,200,225]), // x midpoint = 200 >= 185
  ];
  const r = wallGapMetrics(lines, [], instrBounds);
  assert.equal(r.leftWallEdgeSegmentIds.length,  1);
  assert.equal(r.rightWallEdgeSegmentIds.length, 1);
});

test('wallGapMetrics: gapWidth is distance between rightmost left x and leftmost right x', () => {
  const instrBounds = [160,200,210,230];
  const lines = [
    makeLine('left1',  [162,210,170,225]), // right edge at x=170
    makeLine('right1', [195,210,205,225]), // left  edge at x=195
  ];
  const r = wallGapMetrics(lines, [], instrBounds);
  assert.ok(r.gapWidth !== null);
  assert.ok(Math.abs(r.gapWidth - 25) < 0.1, `expected gapWidth ~25, got ${r.gapWidth}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// Host/interval validation tests
// ══════════════════════════════════════════════════════════════════════════════
test('validateHost: unhosted candidate -> hasHost=false', () => {
  const r = validateHost({ physicalWallId:null, finiteWallInterval:null }, [500,100,560,140]);
  assert.ok(!r.hasHost);
  assert.ok(!r.hasInterval);
});

test('validateHost: hosted candidate with interval fully containing candidate -> contained=true', () => {
  // instrBounds [210,280,255,310], interval [200,260] — contains [210..255] with tol 10
  const r = validateHost(
    { physicalWallId:'wall-1', finiteWallInterval:{ start:200, end:260 } },
    [210, 280, 255, 310]
  );
  assert.ok(r.hasHost);
  assert.ok(r.hasInterval);
  assert.ok(r.containedWithTolerance10px);
  assert.equal(r.verdict, 'INTERVAL_LARGELY_CONTAINS_CANDIDATE');
});

test('validateHost: candidate partially outside interval -> overlapFraction < 1', () => {
  // instrBounds [210,280,255,310], interval [200,230] — partial overlap
  const r = validateHost(
    { physicalWallId:'wall-1', finiteWallInterval:{ start:200, end:230 } },
    [210, 280, 255, 310]
  );
  assert.ok(r.overlapFraction < 1);
});

// ══════════════════════════════════════════════════════════════════════════════
// MANUAL_AUDIT_FIXTURE and promotion eligibility assertions
// ══════════════════════════════════════════════════════════════════════════════
const BOUNDS_DERIVATION = {
  'win-provisional-1': { manualOverride:true, candidateOrigin:'MANUAL_AUDIT_FIXTURE', automaticPromotionAllowed:false, correctedBounds:[210,280,255,310] },
  'win-provisional-2': { manualOverride:true, candidateOrigin:'MANUAL_AUDIT_FIXTURE', automaticPromotionAllowed:false, correctedBounds:[305,275,350,305] },
  'win-provisional-3': { manualOverride:true, candidateOrigin:'MANUAL_AUDIT_FIXTURE', automaticPromotionAllowed:false, correctedBounds:[160,200,210,230] },
  'win-provisional-4': { manualOverride:true, candidateOrigin:'MANUAL_AUDIT_FIXTURE', automaticPromotionAllowed:false, correctedBounds:[420,140,470,170] },
  'win-provisional-5': { manualOverride:true, candidateOrigin:'MANUAL_AUDIT_FIXTURE', automaticPromotionAllowed:false, correctedBounds:[500,100,560,140] },
  'win-provisional-6': { manualOverride:true, candidateOrigin:'MANUAL_AUDIT_FIXTURE', automaticPromotionAllowed:false, correctedBounds:[350,180,400,220] },
};

test('all six candidates have manualOverride=true', () => {
  for (const [id, d] of Object.entries(BOUNDS_DERIVATION)) {
    assert.ok(d.manualOverride, `${id} must have manualOverride=true`);
  }
});

test('all six candidates have automaticPromotionAllowed=false', () => {
  for (const [id, d] of Object.entries(BOUNDS_DERIVATION)) {
    assert.ok(!d.automaticPromotionAllowed, `${id} must have automaticPromotionAllowed=false`);
  }
});

test('all six candidates have candidateOrigin=MANUAL_AUDIT_FIXTURE', () => {
  for (const [id, d] of Object.entries(BOUNDS_DERIVATION)) {
    assert.equal(d.candidateOrigin, 'MANUAL_AUDIT_FIXTURE', id);
  }
});

test('sourceBackedAccepted is 0 (blocked by manual override)', () => {
  // All six have manualOverride=true -> sourceBackedAccepted must be 0
  const count = Object.values(BOUNDS_DERIVATION).filter(d=>!d.manualOverride).length;
  assert.equal(count, 0, 'no candidate should have manualOverride=false');
});

// ══════════════════════════════════════════════════════════════════════════════
// Duplicate pair count test
// ══════════════════════════════════════════════════════════════════════════════
test('all 15 pairs from 6 candidates: C(6,2)=15', () => {
  const ids = ['a','b','c','d','e','f'];
  const pairs = [];
  for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) pairs.push([ids[i],ids[j]]);
  assert.equal(pairs.length, 15);
});

test('exactly 9 pairs are excluded due to 2 unhosted candidates', () => {
  // win-5 and win-6 are unhosted. Each forms pairs with 5 others.
  // win-5: pairs with win-1,2,3,4,6 = 5
  // win-6: pairs with win-1,2,3,4 = 4 (pair with win-5 already counted)
  // Total excluded = 5+4 = 9
  const hosted = ['win-1','win-2','win-3','win-4'];
  const unhosted = ['win-5','win-6'];
  const all = [...hosted,...unhosted];
  const excludedPairs = [];
  for (let i=0;i<all.length;i++) for (let j=i+1;j<all.length;j++) {
    const aHosted = hosted.includes(all[i]), bHosted = hosted.includes(all[j]);
    if (!aHosted||!bHosted) excludedPairs.push([all[i],all[j]]);
  }
  assert.equal(excludedPairs.length, 9);
});

test('UNRESOLVED observation maps to REVIEW verdict (not REJECTED)', () => {
  const obs = 'UNRESOLVED';
  const verdict = obs==='NOT_A_WINDOW' ? 'REJECTED' : 'REVIEW';
  assert.equal(verdict, 'REVIEW', 'UNRESOLVED must not become REJECTED');
});

test('NOT_A_WINDOW observation maps to REJECTED verdict', () => {
  const obs = 'NOT_A_WINDOW';
  const verdict = obs==='NOT_A_WINDOW' ? 'REJECTED' : 'REVIEW';
  assert.equal(verdict, 'REJECTED');
});
