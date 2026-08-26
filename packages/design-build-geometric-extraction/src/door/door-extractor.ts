// Change Set 4 — evidence-only DOOR candidate extractor (isolated).
//
// A door candidate exists ONLY when the drawing shows:
//   1. a LEAF: closed slender rectangle component (curves = 0, 4–6 corners),
//   2. a SWING ARC: separate component with curve evidence (curves >= 1)
//      whose endpoint meets a leaf corner -> that meeting point is the HINGE,
//   3. a host wall near the hinge -> hostWallId + FINITE hosted interval,
//   4. plausible opening width (leaf length vs wall thickness),
//   5. handedness where resolvable from wall direction x leaf direction,
//   6. NO window topology (pure parallel strokes carry no arc, so they never
//      enter) and NO furniture (closed blobs without a hinge-mated arc never
//      pair up).
//
// This module emits candidates + verdicts + reasons. It never constructs
// production Pascal DoorNodes.

import type {
  Component,
  HostedInterval,
  PhysicalWall,
  Vec2,
  Verdict,
} from '../shared/contracts.ts';
import {
  boundsSize,
  clamp01,
  len,
  pointLineDistance,
  project,
} from '../shared/geometry.ts';

export interface DoorSwing {
  hinge: Vec2;
  radius: number;
  sweepRadians: number;
  arcComponentId: string;
}

export interface DoorCandidate {
  id: string;
  hostWallId: string | null;
  interval: HostedInterval | null;
  swing: DoorSwing | null;
  handed: 'left' | 'right' | 'unknown';
  sourceIds: string[];
  confidence: number;
  verdict: Verdict;
  reasons: string[];
}

export interface DoorOptions {
  /** hinge↔leaf-corner mating distance as a fraction of leaf length. */
  hingeMateFactor: number;
  /** host band around wall centerline, multiple of thickness. */
  hostBandFactor: number;
  /** plausible opening width as multiples of wall thickness. */
  minWidthFactor: number;
  maxWidthFactor: number;
  /** leaf slenderness: long side / short side must exceed this. */
  minLeafAspect: number;
  /** minimum arc sweep (rad) to count as a swing (rejects tick marks). */
  minSweepRadians: number;
}

export const DOOR_DEFAULTS: DoorOptions = {
  hingeMateFactor: 0.25,
  hostBandFactor: 2.2,
  minWidthFactor: 1.5,
  maxWidthFactor: 14,
  minLeafAspect: 3,
  minSweepRadians: Math.PI / 6,
};

const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);

/** Closed slender rectangle-ish component = door leaf (filled/stroked rect). */
function isLeaf(c: Component, o: DoorOptions): boolean {
  if (!c.closed || c.curves > 0) return false;
  if (c.points.length < 4 || c.points.length > 6) return false;
  const { w, h } = boundsSize(c.bounds);
  const long = Math.max(w, h);
  const short = Math.max(Math.min(w, h), 1e-6);
  return long / short >= o.minLeafAspect;
}

/** Arc-bearing component = potential swing. */
function isArc(c: Component): boolean {
  return c.curves >= 1 && c.points.length >= 3;
}

function leafLength(c: Component): number {
  const { w, h } = boundsSize(c.bounds);
  return Math.max(w, h);
}

/** Corner of the leaf closest to `p`. */
function nearestCorner(leaf: Component, p: Vec2): { corner: Vec2; d: number } {
  let corner = leaf.points[0]!;
  let d = Infinity;
  for (const q of leaf.points) {
    const dd = dist(p, q);
    if (dd < d) {
      d = dd;
      corner = q;
    }
  }
  return { corner, d };
}

/** Leaf corner farthest from `p` — the true hinge (arc center) end. */
function farthestCorner(leaf: Component, p: Vec2): Vec2 {
  let corner = leaf.points[0]!;
  let d = -1;
  for (const q of leaf.points) {
    const dd = dist(p, q);
    if (dd > d) {
      d = dd;
      corner = q;
    }
  }
  return corner;
}

/** Angle at `hinge` between the leaf free end and the arc strike end. */
function sweepAt(hinge: Vec2, freeEnd: Vec2, strike: Vec2): number {
  const a0 = Math.atan2(freeEnd.y - hinge.y, freeEnd.x - hinge.x);
  const a1 = Math.atan2(strike.y - hinge.y, strike.x - hinge.x);
  let d = Math.abs(a1 - a0);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

export function extractDoorCandidates(
  components: Component[],
  walls: PhysicalWall[],
  o: DoorOptions = DOOR_DEFAULTS,
): DoorCandidate[] {
  const out: DoorCandidate[] = [];
  const leaves = components.filter((c) => isLeaf(c, o));
  const arcs = components.filter(isArc);
  const usedLeaves = new Set<string>();

  for (const arc of arcs) {
    // (1)+(2) mate an arc endpoint with a leaf corner (the leaf FREE end);
    // the hinge (arc center) is the opposite leaf corner.
    const ends: Vec2[] = [arc.points[0]!, arc.points[arc.points.length - 1]!];
    let mated:
      | { leaf: Component; freeEnd: Vec2; strike: Vec2 }
      | undefined;
    let matedD = Infinity;
    for (const leaf of leaves) {
      if (usedLeaves.has(leaf.id)) continue;
      const tol = leafLength(leaf) * o.hingeMateFactor;
      for (let e = 0; e < ends.length; e++) {
        const { d, corner } = nearestCorner(leaf, ends[e]!);
        if (d <= tol && d < matedD) {
          matedD = d;
          mated = { leaf, freeEnd: corner, strike: ends[1 - e]! };
        }
      }
    }
    if (!mated) continue; // lone arc: annotation/dimension — not door evidence

    const { leaf, freeEnd, strike } = mated;
    const hinge = farthestCorner(leaf, freeEnd);
    const width = leafLength(leaf);
    const sweep = sweepAt(hinge, freeEnd, strike);
    const sourceIds = [
      ...leaf.source.primitiveIds,
      ...arc.source.primitiveIds,
    ];
    const reasons: string[] = ['leaf-rect', 'hinge-mated-arc'];
    if (sweep < o.minSweepRadians) {
      reasons.push('sweep-too-small');
      out.push({
        id: `door:${leaf.id}+${arc.id}`,
        hostWallId: null,
        interval: null,
        swing: null,
        handed: 'unknown',
        sourceIds,
        confidence: 0.2,
        verdict: 'rejected',
        reasons,
      });
      continue;
    }
    reasons.push('swing-arc');
    usedLeaves.add(leaf.id);

    // (3) host wall near the hinge
    let host: PhysicalWall | undefined;
    let hostDist = Infinity;
    for (const w of walls) {
      const d = pointLineDistance(hinge, w.centerline);
      if (d < hostDist) {
        host = w;
        hostDist = d;
      }
    }
    const swing: DoorSwing = {
      hinge,
      radius: width,
      sweepRadians: sweep,
      arcComponentId: arc.id,
    };
    if (!host || hostDist > host.thickness * o.hostBandFactor) {
      out.push({
        id: `door:${leaf.id}+${arc.id}`,
        hostWallId: null,
        interval: null,
        swing,
        handed: 'unknown',
        sourceIds,
        confidence: 0.3,
        verdict: 'rejected',
        reasons: [...reasons, 'no-host-wall'],
      });
      continue;
    }
    reasons.push('host-wall-proximity');

    // finite interval: hinge t, extended toward the strike side of the wall
    const tHinge = project(hinge, host.centerline);
    const tStrike = project(strike, host.centerline);
    const span = width / Math.max(host.length, 1e-9);
    let from: number;
    let to: number;
    if (pointLineDistance(strike, host.centerline) <= host.thickness * o.hostBandFactor) {
      from = clamp01(Math.min(tHinge, tStrike));
      to = clamp01(Math.max(tHinge, tStrike));
    } else {
      // strike swings away from the wall — extend interval along leaf direction
      const dir = tStrike >= tHinge ? 1 : -1;
      from = clamp01(Math.min(tHinge, tHinge + dir * span));
      to = clamp01(Math.max(tHinge, tHinge + dir * span));
    }
    if (!(to > from)) {
      out.push({
        id: `door:${leaf.id}+${arc.id}`,
        hostWallId: host.id,
        interval: null,
        swing,
        handed: 'unknown',
        sourceIds,
        confidence: 0.3,
        verdict: 'rejected',
        reasons: [...reasons, 'no-finite-host-interval'],
      });
      continue;
    }
    reasons.push('finite-host-interval');

    // (4) plausible opening width
    const widthOk =
      width >= host.thickness * o.minWidthFactor &&
      width <= host.thickness * o.maxWidthFactor;
    reasons.push(widthOk ? 'plausible-opening-width' : 'implausible-opening-width');

    // (5) handedness: sign of cross(wall direction, hinge->arc-midpoint)
    const wd = {
      x: host.centerline.b.x - host.centerline.a.x,
      y: host.centerline.b.y - host.centerline.a.y,
    };
    const mid = arc.points[Math.floor(arc.points.length / 2)]!;
    const hv = { x: mid.x - hinge.x, y: mid.y - hinge.y };
    const cross = wd.x * hv.y - wd.y * hv.x;
    const handed: DoorCandidate['handed'] =
      Math.abs(cross) < 1e-9 || len(host.centerline) < 1e-9
        ? 'unknown'
        : cross > 0
          ? 'left'
          : 'right';
    if (handed !== 'unknown') reasons.push(`handed-${handed}`);

    const interval: HostedInterval = {
      hostWallId: host.id,
      from,
      to,
      center: (from + to) / 2,
      width: (to - from) * host.length,
    };
    out.push({
      id: `door:${leaf.id}+${arc.id}`,
      hostWallId: host.id,
      interval,
      swing,
      handed,
      sourceIds,
      confidence: widthOk ? 0.9 : 0.55,
      verdict: widthOk ? 'accepted' : 'review',
      reasons,
    });
  }

  return dedupeByInterval(out);
}

function dedupeByInterval(xs: DoorCandidate[]): DoorCandidate[] {
  const used = new Set<string>();
  return xs.filter((x) => {
    if (!x.interval) return true;
    const k = `${x.interval.hostWallId}:${Math.round(x.interval.center * 100)}`;
    if (used.has(k)) return false;
    used.add(k);
    return true;
  });
}
