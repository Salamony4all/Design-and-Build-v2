// TOILET-PARTITION HOST-COMPETITION REGRESSION TESTS (§10).
// General synthetic geometry only — NO canonical CODE-06 wall IDs or door IDs.
// Mirrors run-tests.mts execution (vitest hangs on mupdf-native in this env).
import { scoreDoorHostCandidates, resolveDoorHost, PURE_DOOR_DEFAULTS } from '../src/mupdf-pure-doors';
import type { DoorAssembly, PurePhysicalWall, Vec2 } from '../src/mupdf-pure-doors';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

// Build a synthetic wall along the X axis from (0,0) to (L,0), thickness t.
function wall(id: string, a: Vec2, b: Vec2, t = 8): PurePhysicalWall {
  return {
    physicalWallId: id,
    centerline: { a, b },
    thickness: t,
    startM: { x: a.x, y: a.y }, endM: { x: b.x, y: b.y },
    orientationRadians: 0,
    confidence: 1,
    sourceSegmentIds: [],
    sourceOperationIds: [],
  } as unknown as PurePhysicalWall;
}

// A cubicle: corridor-facing entrance partition (frE) along X at y=0, and a
// perpendicular rear divider (frR) along Y at x=20, and a short side-return (frS).
const frE = wall('frE', { x: 0, y: 0 }, { x: 40, y: 0 }, 8);
const frR = wall('frR', { x: 20, y: 0 }, { x: 20, y: 24 }, 8);
const frS = wall('frS', { x: 40, y: 0 }, { x: 40, y: 10 }, 8);

function makeAssembly(leaf: { a: Vec2; b: Vec2 }, widthPt: number): DoorAssembly {
  return {
    doorAssemblyId: 'd1', doorType: 'SINGLE_SWING', hostStatus: 'NO_HOST',
    widthPt, widthMm: widthPt * 13.13,
    leafSegmentIds: [], swingSegmentIds: [], sourceOperationIds: [],
    positiveEvidence: [], negativeEvidence: [], verdict: 'ACCEPT', evidenceMode: 'GEOMETRY_ONLY',
  } as DoorAssembly;
}

const cfg = PURE_DOOR_DEFAULTS;

// 1. door between two close parallel partitions: hinge on correct wall wins.
{
  const w1 = wall('w1', { x: 0, y: 0 }, { x: 60, y: 0 }, 8);
  const w2 = wall('w2', { x: 0, y: 30 }, { x: 60, y: 30 }, 8);
  const leaf = { a: { x: 10, y: 4 }, b: { x: 22, y: 4 } };
  const hinge = leaf.a;
  const centre = { x: 16, y: 4 };
  const leafDir = { x: leaf.b.x - leaf.a.x, y: leaf.b.y - leaf.a.y };
  const cands = scoreDoorHostCandidates(makeAssembly(leaf, 12), centre, hinge, leafDir, [w1, w2], cfg);
  check('parallel: correct wall (w1) scores highest', cands[0].physicalWallId === 'w1', JSON.stringify(cands.map(c=>c.physicalWallId)));
}

// 2. door near a perpendicular cubicle divider: hinge must be on the entrance partition.
{
  const leaf = { a: { x: 18, y: 4 }, b: { x: 20, y: 18 } };
  const hinge = leaf.a;
  const centre = { x: 19, y: 11 };
  const leafDir = { x: leaf.b.x - leaf.a.x, y: leaf.b.y - leaf.a.y };
  const cands = scoreDoorHostCandidates(makeAssembly(leaf, 14), centre, hinge, leafDir, [frE, frR, frS], cfg);
  const best = cands[0];
  check('perpendicular divider: entrance partition frE wins', best.physicalWallId === 'frE', best.physicalWallId);
  check('perpendicular divider: short return frS penalized (not best)', best.physicalWallId !== 'frS');
}

// 3. hinge close to correct wall but leaf midpoint close to wrong wall.
{
  const leaf = { a: { x: 5, y: 4 }, b: { x: 25, y: 26 } };
  const hinge = leaf.a;
  const centre = { x: 15, y: 15 };
  const leafDir = { x: leaf.b.x - leaf.a.x, y: leaf.b.y - leaf.a.y };
  const cands = scoreDoorHostCandidates(makeAssembly(leaf, 14), centre, hinge, leafDir, [frE, frR], cfg);
  check('hinge-primary: frE (hinge wall) beats frR (midpoint wall)', cands[0].physicalWallId === 'frE', cands[0].physicalWallId);
}

// 4. door at a partition junction: resolved (UNIQUE or AMBIGUOUS), not NO_HOST.
{
  const wA = wall('wA', { x: 0, y: 0 }, { x: 40, y: 0 }, 8);
  const wB = wall('wB', { x: 40, y: 0 }, { x: 40, y: 40 }, 8);
  const leaf = { a: { x: 38, y: 6 }, b: { x: 40, y: 18 } };
  const hinge = leaf.a;
  const centre = { x: 39, y: 12 };
  const leafDir = { x: leaf.b.x - leaf.a.x, y: leaf.b.y - leaf.a.y };
  const a = makeAssembly(leaf, 14);
  resolveDoorHost(a, centre, [wA, wB], cfg, hinge, leafDir);
  check('junction: host is UNIQUE or AMBIGUOUS (resolved, not NO_HOST)', a.hostStatus !== 'NO_HOST', a.hostStatus);
}

// 5. insufficient host-score margin -> AMBIGUOUS_HOST -> REVIEW.
{
  const wA = wall('wA', { x: 0, y: 0 }, { x: 40, y: 0 }, 8);
  const wB = wall('wB', { x: 0, y: 0.5 }, { x: 40, y: 0.5 }, 8);
  const leaf = { a: { x: 20, y: 4 }, b: { x: 32, y: 4 } };
  const hinge = leaf.a;
  const centre = { x: 26, y: 4 };
  const leafDir = { x: leaf.b.x - leaf.a.x, y: leaf.b.y - leaf.a.y };
  const a = makeAssembly(leaf, 14);
  resolveDoorHost(a, centre, [wA, wB], cfg, hinge, leafDir);
  check('insufficient margin: AMBIGUOUS_HOST', a.hostStatus === 'AMBIGUOUS_HOST', a.hostStatus);
  check('insufficient margin: verdict REVIEW', a.verdict === 'REVIEW', a.verdict);
}

// 6. inward vs outward swing doors resolve identically (host independent of swing dir).
{
  const leaf = { a: { x: 10, y: 4 }, b: { x: 22, y: 4 } };
  const cands = scoreDoorHostCandidates(makeAssembly(leaf, 12), { x: 16, y: 4 }, leaf.a, { x: 12, y: 0 }, [frE, frR], cfg);
  check('swing-independent: frE still wins', cands[0].physicalWallId === 'frE', cands[0].physicalWallId);
}

// 7. reversed wall direction: host must be the same wall regardless of A->B order.
{
  const wRev = wall('wRev', { x: 40, y: 0 }, { x: 0, y: 0 }, 8);
  const leaf = { a: { x: 10, y: 4 }, b: { x: 22, y: 4 } };
  const cands = scoreDoorHostCandidates(makeAssembly(leaf, 12), { x: 16, y: 4 }, leaf.a, { x: 12, y: 0 }, [frE, wRev], cfg);
  check('reversed direction: frE and wRev both acceptable', cands.some(c=>c.physicalWallId==='frE') && cands.some(c=>c.physicalWallId==='wRev'));
}

console.log(`\n=== HOST COMPETITION TESTS: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
