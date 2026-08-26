// §19 — unit tests for the wall-completion processor (synthetic, deterministic).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPairedFaces, deriveCompletionWall, buildSourceOwnershipRegistry, completeWalls,
} from './core';
import { DEFAULT_WALL_COMPLETION_CONFIG } from './types';
import type { RawSegment, AcceptedWall, ProtectedOpening } from './types';
import type { WallCompletionInput } from './core';

const seg = (id: string, ax: number, ay: number, bx: number, by: number): RawSegment => ({
  id, a: { x: ax, y: ay }, b: { x: bx, y: by },
});

// A short stub wall ending at (0,0) so a vertical face pair at x=0/0.15, y∈[0,5]
// is connected to the existing network (realistic missing-wall scenario).
const connectingWall: AcceptedWall = {
  physicalWallId: 'wConn', startM: { x: -2, y: 0 }, endM: { x: 0, y: 0 }, thicknessM: 0.2,
};

test('detects a paired parallel wall face as a missing structural wall', () => {
  const faces: RawSegment[] = [
    seg('fa', 0, 0, 0, 5),
    seg('fb', 0.15, 0, 0.15, 5),
  ];
  const pairs = detectPairedFaces(faces, DEFAULT_WALL_COMPLETION_CONFIG, [], [connectingWall]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].candidateClassification, 'MISSING_STRUCTURAL_WALL');
  assert.ok(Math.abs(pairs[0].perpendicularSeparationM - 0.15) < 1e-6);
  assert.ok(pairs[0].overlapRatio > 0.9);
});

test('rejects parallel but unrelated opposing runs (large separation)', () => {
  const faces: RawSegment[] = [seg('fa', 0, 0, 0, 5), seg('fb', 4.0, 0, 4.0, 5)];
  const pairs = detectPairedFaces(faces, DEFAULT_WALL_COMPLETION_CONFIG, [], [connectingWall]);
  assert.equal(pairs.length, 0);
});

test('rejects a single short fragment (below min face length)', () => {
  const faces: RawSegment[] = [seg('fa', 0, 0, 0, 0.3), seg('fb', 0.1, 0, 0.1, 0.3)];
  const pairs = detectPairedFaces(faces, DEFAULT_WALL_COMPLETION_CONFIG, [], [connectingWall]);
  assert.equal(pairs.length, 0);
});

test('classifies a wider separation as MISSING_PARTITION', () => {
  const faces: RawSegment[] = [seg('fa', 0, 0, 0, 5), seg('fb', 0.22, 0, 0.22, 5)];
  const pairs = detectPairedFaces(faces, DEFAULT_WALL_COMPLETION_CONFIG, [], [connectingWall]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].candidateClassification, 'MISSING_PARTITION');
});

test('rejects a face pair overlapping a verified window opening', () => {
  const faces: RawSegment[] = [seg('fa', 0, 0, 0, 5), seg('fb', 0.15, 0, 0.15, 5)];
  const win: ProtectedOpening = {
    openingId: 'w1', openingType: 'WINDOW', worldStart: { x: 0, y: 2 }, worldEnd: { x: 0.15, y: 2.5 },
    worldCentre: { x: 0.075, y: 2.25 }, widthM: 0.5, confidence: 'VERIFIED',
    protectionStatus: 'VERIFIED_OPENING',
  };
  const pairs = detectPairedFaces(faces, DEFAULT_WALL_COMPLETION_CONFIG, [win], []);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].candidateClassification, 'VERIFIED_WINDOW_OPENING');
});

test('derives a midline completion wall id deterministically', () => {
  const faces: RawSegment[] = [seg('fa', 0, 0, 0, 5), seg('fb', 0.15, 0, 0.15, 5)];
  const pairs = detectPairedFaces(faces, DEFAULT_WALL_COMPLETION_CONFIG, [], [connectingWall]);
  const w = deriveCompletionWall(pairs[0], DEFAULT_WALL_COMPLETION_CONFIG);
  assert.ok(w.completionWallId.startsWith('wc_'));
  assert.ok(Math.abs(w.thicknessM - 0.15) < 1e-6);
  assert.ok(w.lengthM > 4.9);
  assert.equal(w.verdict, 'ACCEPT');
});

test('source-ownership registry: no duplicate or missing claim ids for disjoint inputs', () => {
  const walls: AcceptedWall[] = [{ physicalWallId: 'w1', startM: { x: 0, y: 0 }, endM: { x: 1, y: 0 }, thicknessM: 0.2, sourceSegmentIds: ['s1'] }];
  const input: WallCompletionInput = {
    acceptedPhysicalWalls: walls,
    capturedLines: [seg('s1', 0, 0, 1, 0), seg('s2', 5, 5, 6, 5)],
    claimedSourceIds: ['s1'],
    acceptedWindows: [], acceptedDoors: [],
    scaleMmPerPt: 17.5, sourceHash: 'abc',
  };
  const reg = buildSourceOwnershipRegistry(input);
  assert.equal(reg.duplicateClaimIds.length, 0);
  assert.equal(reg.missingClaimIds.length, 0);
  assert.ok(reg.trustedWallClaimIds.includes('s1'));
  assert.ok(reg.remainingUnclaimedIds.includes('s2'));
});

test('finalized network combines 70 trusted walls with completion walls', () => {
  const walls: AcceptedWall[] = Array.from({ length: 70 }, (_, i) => ({
    physicalWallId: `w${i}`, startM: { x: i, y: 0 }, endM: { x: i, y: 1 }, thicknessM: 0.2,
  }));
  // One wall connects to the completion pair at (0,10).
  walls[0] = { physicalWallId: 'w0', startM: { x: 0, y: 10 }, endM: { x: 0, y: 9 }, thicknessM: 0.2 };
  const faces: RawSegment[] = [seg('fa', 0, 10, 0, 15), seg('fb', 0.15, 10, 0.15, 15)];
  const input: WallCompletionInput = {
    acceptedPhysicalWalls: walls,
    capturedLines: faces,
    claimedSourceIds: [],
    acceptedWindows: [], acceptedDoors: [],
    scaleMmPerPt: 17.5, sourceHash: '8c825b31b7758856',
  };
  const { finalized } = completeWalls(input);
  assert.equal(finalized.rawWallCount, 70);
  assert.equal(finalized.finalizedWallCount, 71);
  assert.equal(finalized.rawGeometryHash, '8c825b31b7758856');
  assert.equal(finalized.finalizedTopologyHash.length, 64);
});

test('de-duplicates collinear overlapping completion candidates at the same gap (8 -> 1)', () => {
  const walls: AcceptedWall[] = Array.from({ length: 70 }, (_, i) => ({
    physicalWallId: `w${i}`, startM: { x: i, y: 0 }, endM: { x: i, y: 1 }, thicknessM: 0.2,
  }));
  walls[0] = { physicalWallId: 'w0', startM: { x: 0, y: 10 }, endM: { x: 0, y: 9 }, thicknessM: 0.2 };
  // 8 parallel double-line pairs occupying the SAME location (distinct IDs).
  const faces: RawSegment[] = [];
  for (let k = 0; k < 8; k++) {
    faces.push(seg(`fa${k}`, 0, 10, 0, 15));
    faces.push(seg(`fb${k}`, 0.15, 10, 0.15, 15));
  }
  const input: WallCompletionInput = {
    acceptedPhysicalWalls: walls,
    capturedLines: faces,
    claimedSourceIds: [],
    acceptedWindows: [], acceptedDoors: [],
    scaleMmPerPt: 17.5, sourceHash: '8c825b31b7758856',
  };
  const { finalized } = completeWalls(input);
  assert.equal(finalized.rawWallCount, 70);
  assert.equal(finalized.finalizedWallCount, 71); // 8 duplicates collapsed to 1
  assert.equal(finalized.completionWalls.length, 1);
});
