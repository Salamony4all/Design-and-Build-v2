// The face pairs of wall completion, checked against the version that works each pair
// out on its own.
//
// detectPairedFaces (src/wall-completion/core.ts) was rewritten to do each piece of
// work once per segment instead of once per pair: on a drawing with 275,000 segments
// it took 19 s, and it runs before the first walls can be sent. The rewrite must give
// the same pairs, in the same order, with the same numbers. `pairByPair` below is the
// earlier version, kept here word for word with the helpers it used.
import { describe, expect, it } from 'vitest';
import { detectPairedFaces } from '../../src/wall-completion/core';
import { DEFAULT_WALL_COMPLETION_CONFIG } from '../../src/wall-completion/types';
import type {
  AcceptedWall, CandidateClass, FacePair, ProtectedOpening, RawSegment, Vec2, WallCompletionConfig,
} from '../../src/wall-completion/types';

// ── the earlier version ──────────────────────────────────────────────────────
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const len = (a: Vec2) => Math.hypot(a.x, a.y);
const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const norm = (a: Vec2): Vec2 => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function segLength(s: RawSegment) { return dist(s.a, s.b); }
function segDir(s: RawSegment): Vec2 { return norm(sub(s.b, s.a)); }
function segMid(s: RawSegment): Vec2 { return mid(s.a, s.b); }
/** Perpendicular distance from point p to the infinite line through s. */
function distPointToSegLine(p: Vec2, s: RawSegment): number {
  const d = sub(s.b, s.a);
  const l = len(d) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(p, s.a), d) / (l * l)));
  const proj = add(s.a, scale(d, t));
  return dist(p, proj);
}
/** Projection of segment s onto its own direction axis, as [min,max] param. */
function projectOnto(s: RawSegment, axis: Vec2): [number, number] {
  const a = dot(sub(s.a, { x: 0, y: 0 }), axis);
  const b = dot(sub(s.b, { x: 0, y: 0 }), axis);
  return [Math.min(a, b), Math.max(a, b)];
}


function pairByPair(
  unclaimed: RawSegment[],
  cfg: WallCompletionConfig,
  protectedOpenings: ProtectedOpening[],
  existingWalls: AcceptedWall[],
): FacePair[] {
  const cell = cfg.cellSizeM;
  const grid = new Map<string, RawSegment[]>();
  const cellKey = (p: Vec2) => `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
  for (const s of unclaimed) {
    const k = cellKey(segMid(s));
    const arr = grid.get(k) ?? [];
    arr.push(s);
    grid.set(k, arr);
  }
  const pairs: FacePair[] = [];
  const seenPairs = new Set<string>();
  for (const s of unclaimed) {
    const sm = segMid(s);
    const sk = cellKey(sm);
    const [cx, cy] = sk.split(':').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const arr = grid.get(`${cx + dx}:${cy + dy}`);
      if (!arr) continue;
      for (const t of arr) {
        if (t.id <= s.id) continue; // dedupe unordered pairs deterministically
        const key = `${s.id}|${t.id}`;
        if (seenPairs.has(key)) continue;
        const ds = segDir(s), dt = segDir(t);
        const ang = Math.acos(Math.max(-1, Math.min(1, Math.abs(dot(ds, dt)))));
        if (ang > cfg.maxAngleDiffRad) continue;
        const sep = distPointToSegLine(segMid(t), s); // approx perpendicular separation
        if (sep < cfg.minSeparationM || sep > cfg.maxSeparationM) continue;
        if (segLength(s) < cfg.minFaceLengthM || segLength(t) < cfg.minFaceLengthM) continue;
        const axis = ds;
        const [a0, a1] = projectOnto(s, axis);
        const [b0, b1] = projectOnto(t, axis);
        const ovStart = Math.max(a0, b0), ovEnd = Math.min(a1, b1);
        const ov = Math.max(0, ovEnd - ovStart);
        const shorter = Math.min(a1 - a0, b1 - b0) || 1;
        const ratio = ov / shorter;
        if (ratio < cfg.maxOverlapRatio) continue;
        const epCompat = endpointCompatibility(s, t, axis);
        const thickConsist = 1 - Math.min(1, Math.abs(segLength(s) - segLength(t)) / (segLength(s) + 1e-6));
        let classification: CandidateClass = 'MISSING_STRUCTURAL_WALL';
        let confidence = 0.5 + 0.2 * ratio + 0.15 * epCompat + 0.15 * thickConsist;
        // §5/§6 filters — reject furniture/annotation double-line outlines and
        // the double faces of already-accepted walls; require connectivity.
        const onExistingWall = (faceCollinearWithWall(s, existingWalls) && faceCollinearWithWall(t, existingWalls))
          ? connectedExistingWallIds([s, t], existingWalls)
          : [];
        const closedLoop = isClosedFurnitureLoop(s, t, cfg); // compact closed rectangle
        const nearDoor = protectedOpenings.some((o) => o.openingType === 'DOOR' && segNearOpening([s, t], o, sep));
        const nearWin = protectedOpenings.some((o) => o.openingType === 'WINDOW' && segNearOpening([s, t], o, sep));
        if (onExistingWall.length > 0) continue; // faces belong to an accepted wall
        const connected = connectedExistingWallIds([s, t], existingWalls); // endpoint/junction connectivity
        if (closedLoop) { classification = 'FURNITURE_GEOMETRY'; confidence = Math.max(0, confidence - 0.4); }
        else if (nearDoor) classification = 'VERIFIED_DOOR_OPENING';
        else if (nearWin) classification = 'VERIFIED_WINDOW_OPENING';
        else if (sep > 0.18) classification = 'MISSING_PARTITION';
        else classification = 'MISSING_STRUCTURAL_WALL';
        // Connectivity gating: a genuinely missing wall must touch the existing
        // network (endpoint near an existing wall end or junction), otherwise it
        // is a floating pair and stays REVIEW (§5: geometric continuity required).
        // Opening/furniture classifications are not overridden by this gate.
        const isGenuineWall =
          classification === 'MISSING_STRUCTURAL_WALL' ||
          classification === 'MISSING_PARTITION';
        if (connected.length === 0 && isGenuineWall) {
          classification = 'WALL_JUNCTION'; // REVIEW: unconnected, not auto-accepted
          confidence = Math.min(confidence, 0.6);
        }
        seenPairs.add(key);
        pairs.push({
          faceAId: s.id, faceBId: t.id,
          faceAStart: s.a, faceAEnd: s.b, faceBStart: t.a, faceBEnd: t.b,
          faceALengthM: segLength(s), faceBLengthM: segLength(t),
          angleDifferenceRad: ang, perpendicularSeparationM: sep,
          projectedOverlapM: ov, overlapRatio: ratio,
          endpointCompatibility: epCompat, thicknessConsistency: thickConsist,
          hatchEvidence: false, pocheEvidence: false,
          sourceLineageCompatibility: 1,
          connectedExistingWallIds: connected, nearbyFurnitureFamily: closedLoop,
          nearbyDoorEvidence: nearDoor, nearbyWindowEvidence: nearWin,
          candidateClassification: classification, confidence: Math.min(1, confidence),
        });
      }
    }
  }
  return pairs;
}

function endpointCompatibility(s: RawSegment, t: RawSegment, axis: Vec2): number {
  const sp = [s.a, s.b].map((p) => dot(p, axis));
  const tp = [t.a, t.b].map((p) => dot(p, axis));
  const sMin = Math.min(...sp), sMax = Math.max(...sp);
  const tMin = Math.min(...tp), tMax = Math.max(...tp);
  const ov = Math.max(0, Math.min(sMax, tMax) - Math.max(sMin, tMin));
  const shorter = Math.min(sMax - sMin, tMax - tMin) || 1;
  return ov / shorter;
}

function connectedExistingWallIds(faces: RawSegment[], walls: AcceptedWall[]): string[] {
  const out = new Set<string>();
  for (const f of faces) {
    for (const w of walls) {
      const ends = [w.startM, w.endM];
      for (const e of ends) {
        if (dist(e, f.a) < 0.25 || dist(e, f.b) < 0.25) out.add(w.physicalWallId);
      }
    }
  }
  return [...out];
}

/** True when a face line is collinear with (and near) an existing wall centreline
 *  — i.e. this face is one of that wall's own drawn double-line faces. Used to
 *  SKIP re-pairing a wall's own faces as a "missing" wall. */
function faceCollinearWithWall(s: RawSegment, walls: AcceptedWall[]): boolean {
  const sm = segMid(s);
  for (const w of walls) {
    const wl: RawSegment = { id: w.physicalWallId, a: w.startM, b: w.endM };
    const d = distPointToSegLine(sm, wl);
    if (d > w.thicknessM + 0.08) continue;
    // require substantial overlap along the wall axis
    const axis = segDir(wl);
    const [s0, s1] = projectOnto(s, axis);
    const [w0, w1] = projectOnto(wl, axis);
    const ov = Math.max(0, Math.min(s1, w1) - Math.max(s0, w0));
    const shorter = Math.min(s1 - s0, w1 - w0) || 1;
    if (ov / shorter > 0.5) return true;
  }
  return false;
}

function segNearOpening(faces: RawSegment[], o: ProtectedOpening, sep: number): boolean {
  const om = o.worldCentre;
  return faces.some((f) => distPointToSegLine(om, f) < sep + o.widthM / 2 + 0.2);
}

/**
 * §5/§6 — reject compact closed furniture / annotation outlines. A genuine wall
 * face pair is long and open (its two endpoints are far apart, i.e. the segment
 * span is large). A bed/cabinet double-line outline is a short closed loop:
 * both face endpoints are close to each other (a compact rectangle). Reject when
 * both endpoints of each face are within a small radius of the other face's
 * endpoints — i.e. the pair forms a closed quadrilateral rather than an open run.
 */
function isClosedFurnitureLoop(s: RawSegment, t: RawSegment, cfg: WallCompletionConfig): boolean {
  const r = Math.max(0.6, cfg.minFaceLengthM * 0.75); // closed-loop tolerance
  const endsS = [s.a, s.b];
  const endsT = [t.a, t.b];
  // Both S-ends must be near T-ends (closed rectangle), AND the span must be short.
  const sSpan = dist(s.a, s.b);
  const closeCount = endsS.reduce(
    (acc, p) => acc + (endsT.some((q) => dist(p, q) < r) ? 1 : 0),
    0,
  );
  return sSpan < cfg.minFaceLengthM * 2.5 && closeCount >= 2;
}


// ── drawings to compare on ───────────────────────────────────────────────────

/** A small repeatable random source. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Line work as a drawing has it, at the given size of one unit (1 for metres; the app
 * passes page points, where everything is tens of times larger): double lines of walls
 * and partitions, small closed outlines of furniture, hatching and text strokes too
 * short to be a face, several segments under one id, segments along walls already
 * found, and doors and windows that some pairs fall on. A real sheet has a few hundred
 * walls and far fewer openings, however many segments it has: `maxWalls` keeps to that.
 */
function drawing(seed: number, unit: number, count: number, maxWalls = 400, extent = 40) {
  const rnd = random(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * rnd();
  const size = extent * unit;
  const segs: RawSegment[] = [];
  const walls: AcceptedWall[] = [];
  const openings: ProtectedOpening[] = [];
  let id = 0;
  const nextId = () => (rnd() < 0.08 ? `op${Math.floor(between(0, 30))}:cL` : `op${id++}:L${Math.floor(between(0, 4))}`);
  const along = (o: Vec2, angle: number, d: number): Vec2 => ({ x: o.x + Math.cos(angle) * d, y: o.y + Math.sin(angle) * d });

  for (let k = 0; k < count; k++) {
    const o = { x: between(0, size), y: between(0, size) };
    const angle = (Math.floor(between(0, 4)) * Math.PI) / 2 + between(-0.06, 0.06);
    const kind = rnd();
    if (kind < 0.45) {
      // hatching and text: far too short
      segs.push({ id: nextId(), a: o, b: along(o, between(0, Math.PI * 2), between(0, 0.6) * unit) });
    } else if (kind < 0.5) {
      segs.push({ id: nextId(), a: o, b: { x: o.x, y: o.y } }); // a point
    } else {
      // a double line: two faces a little apart, the second shifted and turned a little
      const length = between(0.5, 6) * unit;
      const gap = between(0.02, 0.36) * unit;
      const normal = angle + Math.PI / 2;
      const a = o;
      const b = along(a, angle, length);
      const shift = between(-0.3, 0.3) * length;
      const c = along(along(a, normal, gap), angle, shift);
      const d = along(c, angle + between(-0.1, 0.1), length * between(0.5, 1.2));
      segs.push({ id: nextId(), a, b }, { id: nextId(), a: c, b: d });
      if (rnd() < 0.3) {
        // closed like a piece of furniture: the two ends joined
        segs.push({ id: nextId(), a, b: c }, { id: nextId(), a: b, b: d });
      }
      const centre = along(along(a, angle, length / 2), normal, gap / 2);
      if (rnd() < 0.2 && walls.length < maxWalls) {
        // a wall already found, on this double line or ending at it
        const onIt = rnd() < 0.5;
        walls.push({
          physicalWallId: `w${walls.length % 37}`,
          startM: onIt ? along(a, normal, gap / 2) : along(a, angle + Math.PI, between(0, 2) * unit),
          endM: onIt ? along(b, normal, gap / 2) : along(a, angle, between(0, 0.2) * unit),
          thicknessM: between(0.1, 0.3) * unit,
        });
      }
      if (rnd() < 0.08 && openings.length < maxWalls / 4) {
        openings.push({
          openingId: `o${openings.length}`,
          openingType: rnd() < 0.5 ? 'DOOR' : 'WINDOW',
          worldStart: a,
          worldEnd: b,
          worldCentre: centre,
          widthM: between(0.6, 1.5) * unit,
          confidence: 'VERIFIED',
          protectionStatus: 'VERIFIED_OPENING',
        });
      }
    }
  }
  return { segs, walls, openings };
}

const classes = (pairs: FacePair[]) =>
  pairs.reduce<Record<string, number>>((m, p) => ((m[p.candidateClassification] = (m[p.candidateClassification] ?? 0) + 1), m), {});

describe('wall completion: face pairs', () => {
  it('finds the same pairs as pair by pair, in metres', () => {
    const cfg = DEFAULT_WALL_COMPLETION_CONFIG;
    const seen: Record<string, number> = {};
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { segs, walls, openings } = drawing(seed, 1, 2500);
      const expected = pairByPair(segs, cfg, openings, walls);
      const found = detectPairedFaces(segs, cfg, openings, walls);
      expect(found.length).toBe(expected.length);
      expect(found).toEqual(expected);
      expect(JSON.stringify(found)).toBe(JSON.stringify(expected));
      for (const [k, v] of Object.entries(classes(found))) seen[k] = (seen[k] ?? 0) + v;
    }
    // the drawings reach every kind of pair, so every branch is compared
    for (const kind of ['MISSING_STRUCTURAL_WALL', 'MISSING_PARTITION', 'FURNITURE_GEOMETRY', 'WALL_JUNCTION', 'VERIFIED_DOOR_OPENING', 'VERIFIED_WINDOW_OPENING']) {
      expect(seen[kind] ?? 0, kind).toBeGreaterThan(0);
    }
  });

  it('finds the same pairs as pair by pair, in page points as the app passes them', () => {
    // the route passes page points and widens only the join distances, as here
    const cfg: WallCompletionConfig = { ...DEFAULT_WALL_COMPLETION_CONFIG, joinTolM: 0.35 / 0.0229, maxAutoExtensionM: 2.0 / 0.0229 };
    for (const seed of [11, 12, 13]) {
      const { segs, walls, openings } = drawing(seed, 1, 4000);
      const scaled = (p: Vec2): Vec2 => ({ x: p.x * 3.7, y: p.y * 3.7 });
      const big = segs.map((s) => ({ ...s, a: scaled(s.a), b: scaled(s.b) }));
      const bigWalls = walls.map((w) => ({ ...w, startM: scaled(w.startM), endM: scaled(w.endM) }));
      const expected = pairByPair(big, cfg, openings, bigWalls);
      expect(detectPairedFaces(big, cfg, openings, bigWalls)).toEqual(expected);
    }
  });

  it('leaves out the pairs that are an existing wall\'s own faces, as before', () => {
    const { segs, walls, openings } = drawing(21, 1, 2500);
    const withWalls = detectPairedFaces(segs, DEFAULT_WALL_COMPLETION_CONFIG, openings, walls);
    const without = detectPairedFaces(segs, DEFAULT_WALL_COMPLETION_CONFIG, openings, []);
    expect(without.length).toBeGreaterThan(withWalls.length);
    expect(withWalls).toEqual(pairByPair(segs, DEFAULT_WALL_COMPLETION_CONFIG, openings, walls));
    expect(without).toEqual(pairByPair(segs, DEFAULT_WALL_COMPLETION_CONFIG, openings, []));
  });

  it('agrees on odd input: nothing, one segment, the same id twice, coordinates that are not numbers', () => {
    const cfg = DEFAULT_WALL_COMPLETION_CONFIG;
    const wall: AcceptedWall = { physicalWallId: 'w', startM: { x: -2, y: 0 }, endM: { x: 0, y: 0 }, thicknessM: 0.2 };
    const seg = (id: string, ax: number, ay: number, bx: number, by: number): RawSegment => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by } });
    const cases: RawSegment[][] = [
      [],
      [seg('a', 0, 0, 0, 5)],
      [seg('a', 0, 0, 0, 5), seg('b', 0.15, 0, 0.15, 5)],
      [seg('x', 0, 0, 0, 5), seg('y', 0.15, 0, 0.15, 5), seg('x', 0, 0.2, 0, 5.2), seg('y', 0.15, 0.1, 0.15, 5.1)],
      [seg('a', Number.NaN, 0, 0, 5), seg('b', 0.15, 0, 0.15, Number.NaN), seg('c', 0, 0, 0, 5), seg('d', 0.15, 0, 0.15, 5)],
      [seg('a', -0.4, -3, -0.4, 3), seg('b', -0.55, -3, -0.55, 3), seg('c', 1e9, 0, 1e9, 5), seg('d', 1e9 + 0.15, 0, 1e9 + 0.15, 5)],
    ];
    for (const segs of cases) {
      expect(detectPairedFaces(segs, cfg, [], [wall])).toEqual(pairByPair(segs, cfg, [], [wall]));
    }
    expect(detectPairedFaces(cases[2]!, cfg, [], [wall])).toHaveLength(1);
    expect(detectPairedFaces(cases[3]!, cfg, [], [wall])).toHaveLength(1); // one pair per pair of ids
  });

  it('stays quick on a drawing with very many segments', () => {
    // about 100,000 segments and 300 walls, spread as over a sheet: pair by pair this took far longer
    const { segs, walls, openings } = drawing(31, 1, 60000, 300, 1200);
    const t = Date.now();
    const found = detectPairedFaces(segs, DEFAULT_WALL_COMPLETION_CONFIG, openings, walls);
    const ms = Date.now() - t;
    expect(segs.length).toBeGreaterThan(90000);
    expect(found.length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(10000);
  });
});
