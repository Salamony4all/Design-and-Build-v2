// Wall-completion processor — core geometry, paired-face detection, protection.
// MASTER CHECKPOINT §3-§11. Conservative: only source-proven paired faces become
// wall geometry. No PDF reopen, no vector recapture, no ColumnNodes.

import { createHash } from 'crypto';
import {
  Vec2, RawSegment, AcceptedWall, ProtectedOpening, SourceOwnershipRegistry,
  FacePair, CompletionWall, EndpointExtension, CandidateClass, WallCompletionConfig,
  DEFAULT_WALL_COMPLETION_CONFIG,
} from './types';

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

export interface WallCompletionInput {
  acceptedPhysicalWalls: AcceptedWall[];
  capturedLines: RawSegment[];
  claimedSourceIds: string[];
  acceptedWindows: ProtectedOpening[];
  acceptedDoors: ProtectedOpening[];
  annotations?: ProtectedOpening[];
  scaleMmPerPt: number;
  sourceHash: string;
  config?: Partial<WallCompletionConfig>;
}

/** §4 — register geometry already owned by trusted extractors. */
export function buildSourceOwnershipRegistry(input: WallCompletionInput): SourceOwnershipRegistry {
  const trustedWallClaimIds = input.acceptedPhysicalWalls.flatMap((w) => w.sourceSegmentIds ?? []).filter(Boolean);
  const windowClaimIds = input.acceptedWindows.map((o) => o.openingId);
  const doorClaimIds = input.acceptedDoors.map((o) => o.openingId);
  const annotationClaimIds = (input.annotations ?? []).map((o) => o.openingId);
  const claimed = new Set<string>([
    ...trustedWallClaimIds, ...windowClaimIds, ...doorClaimIds, ...annotationClaimIds,
  ]);
  const allSegs = input.capturedLines;
  const remaining = allSegs.filter((s) => !claimed.has(s.id));
  const seen = new Set<string>();
  const duplicate: string[] = [];
  for (const s of allSegs) { if (seen.has(s.id)) duplicate.push(s.id); else seen.add(s.id); }
  return {
    totalSourceVectors: allSegs.length,
    trustedWallClaimIds,
    windowClaimIds,
    doorClaimIds,
    annotationClaimIds,
    slabClaimIds: [],
    remainingUnclaimedIds: remaining.map((s) => s.id),
    duplicateClaimIds: duplicate,
    missingClaimIds: [],
  };
}

/** §6/§5 — detect paired parallel wall faces via spatial hashing. */
export function detectPairedFaces(
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

/** §7 — derive a completion wall centreline from an accepted face pair. */
export function deriveCompletionWall(pair: FacePair, cfg: WallCompletionConfig): CompletionWall {
  // Orient face B to match face A's direction so endpoint averaging is stable
  // regardless of how the two source segments were authored.
  const dAS_BS = dist(pair.faceAStart, pair.faceBStart);
  const dAS_BE = dist(pair.faceAStart, pair.faceBEnd);
  const bStart = dAS_BS <= dAS_BE ? pair.faceBStart : pair.faceBEnd;
  const bEnd = dAS_BS <= dAS_BE ? pair.faceBEnd : pair.faceBStart;
  const cStart = mid(pair.faceAStart, bStart);
  const cEnd = mid(pair.faceAEnd, bEnd);
  const direction = norm(sub(cEnd, cStart));
  const lengthM = dist(cStart, cEnd);
  const thicknessM = pair.perpendicularSeparationM;
  const ids = [pair.faceAId, pair.faceBId];
  const hashSrc = `${pair.faceAId}|${pair.faceBId}|${cStart.x.toFixed(4)}:${cStart.y.toFixed(4)}|${cEnd.x.toFixed(4)}:${cEnd.y.toFixed(4)}`;
  const completionWallId = `wc_${createHash('sha256').update(hashSrc).digest('hex').slice(0, 12)}`;
  const acceptedClasses: CandidateClass[] = ['MISSING_STRUCTURAL_WALL', 'MISSING_PARTITION', 'WALL_FACE_CONTINUATION', 'SOURCE_PROVEN_ENDPOINT_EXTENSION'];
  const verdict = acceptedClasses.includes(pair.candidateClassification) && pair.confidence >= 0.7 ? 'ACCEPT' : 'REVIEW';
  return {
    completionWallId,
    classification: pair.candidateClassification,
    faceA: pair.faceAId,
    faceB: pair.faceBId,
    centrelineStartProjectM: cStart,
    centrelineEndProjectM: cEnd,
    lengthM,
    thicknessM,
    direction,
    sourceSegmentIds: ids,
    sourceOperationIds: [],
    connectedWallIds: pair.connectedExistingWallIds,
    endpointJunctions: [],
    sourceEvidence: `paired-faces sep=${thicknessM.toFixed(3)}m overlap=${(pair.overlapRatio * 100).toFixed(0)}%`,
    verdict,
  };
}

/**
 * §13 — collapse collinear/overlapping completion-wall centreline candidates that
 * occupy the same location (the paired-face detector emits one candidate per
 * source segment-ID pair, so parallel double-line faces produce 8+ duplicates at
 * a single gap). Two candidates are duplicates when their centreline endpoints are
 * both within `dupTolM` (or their midpoints coincide and they are near-parallel with
 * substantial overlap). Keeps the highest-confidence / longest representative.
 */
function dedupeCompletionWalls(walls: CompletionWall[], cfg: WallCompletionConfig): CompletionWall[] {
  const dupTolM = 0.6;
  const kept: CompletionWall[] = [];
  const mid = (w: CompletionWall) => ({
    x: (w.centrelineStartProjectM.x + w.centrelineEndProjectM.x) / 2,
    y: (w.centrelineStartProjectM.y + w.centrelineEndProjectM.y) / 2,
  });
  for (const w of walls) {
    const wm = mid(w);
    const wDir = norm(sub(w.centrelineEndProjectM, w.centrelineStartProjectM));
    const isDup = kept.some((k) => {
      const km = mid(k);
      const sameSpot = dist(wm, km) < dupTolM;
      if (!sameSpot) return false;
      const kDir = norm(sub(k.centrelineEndProjectM, k.centrelineStartProjectM));
      const parallel = Math.abs(dot(wDir, kDir)) > 0.98;
      const endNear =
        (dist(w.centrelineStartProjectM, k.centrelineStartProjectM) < dupTolM &&
          dist(w.centrelineEndProjectM, k.centrelineEndProjectM) < dupTolM) ||
        (dist(w.centrelineStartProjectM, k.centrelineEndProjectM) < dupTolM &&
          dist(w.centrelineEndProjectM, k.centrelineStartProjectM) < dupTolM);
      return parallel && endNear;
    });
    if (!isDup) kept.push(w);
  }
  return kept;
}

/** Point-to-segment distance (plain, no RawSegment wrapper). */
function ptSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const l = len(d) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / (l * l)));
  const proj = add(a, scale(d, t));
  return dist(p, proj);
}

/** Segment-segment intersection (excludes shared endpoints). */
function segmentIntersects(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

/**
 * §8 — close open corners identified by two genuinely-adjacent wall ends whose
 * connecting gap is short (≤ cfg.maxAutoExtensionM). For each corner we emit the
 * gap as a 90°-axis-aligned "L": two axis-aligned legs (each continuing one wall
 * straight along its OWN direction) meeting at a shared corner point. Every emitted
 * segment is horizontal or vertical (0°/90°), never a diagonal. This restores the
 * safe short-corner behaviour (no doubling of inner walls, windows/doors preserved)
 * while guaranteeing the extensions are axis-aligned as requested.
 * Returns centreline segments to be added as SOURCE_PROVEN_ENDPOINT_EXTENSION.
 */
function extendOpenEndpoints(
  walls: AcceptedWall[],
  protectedOpenings: ProtectedOpening[],
  cfg: WallCompletionConfig,
): { a: Vec2; b: Vec2; lenM: number; connectedWallIds: string[] }[] {
  const joinTol = cfg.joinTolM; // already in the coordinate unit (route passes point-scale)
  const eps: { p: Vec2; outward: Vec2; dir: Vec2; wallId: string }[] = [];
  for (const w of walls) {
    const a = w.startM, b = w.endM;
    const dir = norm(sub(b, a));
    if (a && b) {
      eps.push({ p: a, outward: scale(dir, -1), dir, wallId: w.physicalWallId });
      eps.push({ p: b, outward: dir, dir, wallId: w.physicalWallId });
    }
  }
  const open = eps.filter((e) =>
    !eps.some((o) => o !== e && o.wallId !== e.wallId && dist(e.p, o.p) < joinTol));
  // Protected openings: world centres (meters) -> coordinate unit (points).
  const s2u = cfg.scaleMmPerPt / 1000;
  const openings = protectedOpenings.map((o) => ({
    p: { x: o.worldCentre.x / s2u, y: o.worldCentre.y / s2u },
    halfW: o.widthM / 2 / s2u,
  }));
  const out: { a: Vec2; b: Vec2; lenM: number; connectedWallIds: string[] }[] = [];
  const seen = new Set<string>();
  // Candidate corner: e and f are opposite-orientation (perpendicular) open ends,
  // each other's NEAREST such end (no long diagonal across the plan).
  const nearest: Map<typeof open[number], typeof open[number] | null> = new Map();
  for (const e of open) {
    let best: (typeof open)[number] | null = null;
    let bestD = Infinity;
    for (const f of open) {
      if (f === e || f.wallId === e.wallId) continue;
      const par = Math.abs(dot(e.dir, f.dir));
      if (par >= 0.5) continue; // only opposite-orientation walls form a corner
      const d = dist(e.p, f.p);
      if (d < bestD) { bestD = d; best = f; }
    }
    nearest.set(e, best);
  }
  for (const e of open) {
    const f = nearest.get(e) ?? null;
    if (!f || nearest.get(f) !== e) continue; // must be mutual nearest
    const lenM = dist(e.p, f.p);
    if (lenM < 0.2 || lenM > cfg.maxAutoExtensionM) continue;
    const ef = norm(sub(f.p, e.p));
    const fe = scale(ef, -1);
    if (dot(e.outward, ef) < -0.2 || dot(f.outward, fe) < -0.2) continue; // not facing the gap
    if (openings.some((o) => ptSegDist(o.p, e.p, f.p) < o.halfW + 2.0)) continue; // never seal opening
    if (walls.some((w) => segmentIntersects(e.p, f.p, w.startM, w.endM))) continue; // don't cross walls
    const key = [e.wallId, f.wallId, e.p.x.toFixed(2), e.p.y.toFixed(2), f.p.x.toFixed(2), f.p.y.toFixed(2)]
      .sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    // Emit the gap as a 90° axis-aligned L: a corner point C reached by extending
    // each wall straight along its OWN axis. Pick C so both legs are orthogonal.
    const c = cornerPoint(e.p, e.dir, f.p, f.dir);
    out.push({ a: e.p, b: c, lenM: dist(e.p, c), connectedWallIds: [e.wallId, f.wallId] });
    out.push({ a: f.p, b: c, lenM: dist(f.p, c), connectedWallIds: [e.wallId, f.wallId] });
  }
  return out;
}

/** §8 — corner point for a 90° axis-aligned L. dirE/dirF are the (perpendicular)
 * wall axis directions at the two open ends. We extend each wall straight along
 * its OWN axis; the corner is where those two orthogonal lines meet, which keeps
 * both legs horizontal/vertical (never diagonal). */
function cornerPoint(e: Vec2, dirE: Vec2, f: Vec2, dirF: Vec2): Vec2 {
  // dirE/dirF are unit, perpendicular. If dirE is horizontal, C shares e.y with f;
  // if dirE is vertical, C shares e.x with f. dirF decides the complementary coord.
  const eHorizontal = Math.abs(dirE.x) > Math.abs(dirE.y);
  if (eHorizontal) {
    return { x: f.x, y: e.y };
  }
  return { x: e.x, y: f.y };
}

/** §13 — orchestrator: build the finalized wall network. */
export function completeWalls(input: WallCompletionInput): {
  registry: SourceOwnershipRegistry;
  facePairs: FacePair[];
  completionWalls: CompletionWall[];
  finalized: import('./types').FinalizedWallNetwork;
} {
  const cfg = { ...DEFAULT_WALL_COMPLETION_CONFIG, ...(input.config ?? {}) };
  const registry = buildSourceOwnershipRegistry(input);
  const claimed = new Set<string>([
    ...registry.trustedWallClaimIds, ...registry.windowClaimIds, ...registry.doorClaimIds, ...registry.annotationClaimIds,
  ]);
  const unclaimed = input.capturedLines.filter((s) => !claimed.has(s.id));
  const protectedOpenings: ProtectedOpening[] = [
    ...input.acceptedWindows, ...input.acceptedDoors, ...(input.annotations ?? []),
  ].filter((o) => o.protectionStatus !== 'UNRESOLVED');

  const facePairs = detectPairedFaces(unclaimed, cfg, protectedOpenings, input.acceptedPhysicalWalls);
  const completionWallsRaw = facePairs
    .filter((p) => ['MISSING_STRUCTURAL_WALL', 'MISSING_PARTITION', 'WALL_FACE_CONTINUATION'].includes(p.candidateClassification))
    .map((p) => deriveCompletionWall(p, cfg));

  // §13 de-duplicate: collinear/overlapping centreline candidates at the same
  // location (different source segment IDs) collapse into one completion wall.
  const completionWalls = dedupeCompletionWalls(completionWallsRaw, cfg);

  const partitionCompletions = completionWalls.filter((w) => w.classification === 'MISSING_PARTITION');

  // §8 — bridge open endpoints across gaps (single-line missing walls the paired
  // face detector cannot see). Emitted as SOURCE_PROVEN_ENDPOINT_EXTENSION.
  const bridges = extendOpenEndpoints(input.acceptedPhysicalWalls, protectedOpenings, cfg);
  const bridgeWalls: CompletionWall[] = bridges.map((br) => {
    const hashSrc = `bridge|${br.a.x.toFixed(3)}:${br.a.y.toFixed(3)}|${br.b.x.toFixed(3)}:${br.b.y.toFixed(3)}`;
    const completionWallId = `wc_${createHash('sha256').update(hashSrc).digest('hex').slice(0, 12)}`;
    const direction = norm(sub(br.b, br.a));
    return {
      completionWallId,
      classification: 'SOURCE_PROVEN_ENDPOINT_EXTENSION' as CandidateClass,
      faceA: br.connectedWallIds[0],
      faceB: br.connectedWallIds[1] ?? br.connectedWallIds[0],
      centrelineStartProjectM: br.a,
      centrelineEndProjectM: br.b,
      lengthM: br.lenM,
      thicknessM: 0.2,
      direction,
      sourceSegmentIds: [],
      sourceOperationIds: [],
      connectedWallIds: br.connectedWallIds,
      endpointJunctions: br.connectedWallIds,
      sourceEvidence: `endpoint-bridge len=${br.lenM.toFixed(2)}m`,
      verdict: 'ACCEPT' as const,
    };
  });
  const allCompletionWalls = [...completionWalls, ...bridgeWalls];

  const finalizedPhysicalWalls: AcceptedWall[] = [
    ...input.acceptedPhysicalWalls,
    ...allCompletionWalls.map((w) => ({
      physicalWallId: w.completionWallId,
      startM: w.centrelineStartProjectM,
      endM: w.centrelineEndProjectM,
      thicknessM: w.thicknessM,
      sourceSegmentIds: w.sourceSegmentIds,
    })),
  ];

  const finalizedTopologyHash = createHash('sha256')
    .update(JSON.stringify(finalizedPhysicalWalls.map((w) => [w.physicalWallId, w.startM, w.endM])))
    .digest('hex');
  const wallCompletionHash = createHash('sha256')
    .update(JSON.stringify(completionWalls.map((w) => [w.completionWallId, w.classification, w.verdict])))
    .digest('hex');

  const finalized = {
    originalWalls: input.acceptedPhysicalWalls,
    completionWalls: allCompletionWalls,
    partitionCompletions,
    endpointExtensions: bridgeWalls.map((w) => ({
      physicalWallId: w.connectedWallIds[0],
      endpointSide: 'A' as const,
      originalEndpoint: w.centrelineStartProjectM,
      proposedFinalEndpoint: w.centrelineEndProjectM,
      extensionLengthM: w.lengthM,
      thicknessCompatibility: 1,
      hatchContinuation: false,
      nearestJunction: w.connectedWallIds[1] ?? null,
      openingConflict: false,
      furnitureConflict: false,
      classification: w.classification,
      confidence: 0.85,
    })),
    junctions: [],
    protectedOpenings,
    finalizedPhysicalWalls,
    rawWallCount: input.acceptedPhysicalWalls.length,
    finalizedWallCount: finalizedPhysicalWalls.length,
    finalizedTopologyHash,
    wallCompletionHash,
    rawGeometryHash: input.sourceHash,
    rawEvidenceHash: input.sourceHash,
  };
  return { registry, facePairs, completionWalls: allCompletionWalls, finalized };
}
