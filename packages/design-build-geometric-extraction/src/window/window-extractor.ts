// Change Set 4 — evidence-only WINDOW candidate extractor (isolated).
//
// A window candidate exists ONLY when the drawing shows:
//   1. parallel frame/glazing evidence: >= 2 near-parallel straight strokes,
//      mutually offset (two distinct lines, not one collinear run),
//   2. a host wall whose centerline is near-parallel to those strokes and
//      whose corridor (thickness band) contains them  -> hostWallId,
//   3. a FINITE hosted interval along that wall centerline (t in [0,1]),
//   4. plausible width (along wall) and depth (across wall),
//   5. NO hinge / leaf / swing evidence (curves reject the component), and
//   6. no furniture/annotation topology (closed multi-loop blobs, dense
//      point clouds, strokes far from any wall).
//
// This module emits candidates + verdicts + reasons. It never constructs
// production Pascal WindowNodes.

import type {
  Component,
  HostedInterval,
  PhysicalWall,
  Segment,
  Verdict,
} from '../shared/contracts.ts';
import {
  angleDiff,
  clamp01,
  len,
  midpoint,
  pointLineDistance,
  polylineSegments,
  project,
} from '../shared/geometry.ts';

export interface WindowCandidate {
  id: string;
  hostWallId: string | null;
  interval: HostedInterval | null;
  sourceIds: string[];
  confidence: number;
  verdict: Verdict;
  reasons: string[];
}

export interface WindowOptions {
  /** max angle (rad) between frame strokes, and stroke↔wall. */
  angleTolerance: number;
  /** host corridor half-band as a multiple of wall thickness. */
  wallBandFactor: number;
  /** minimum count of parallel frame/glazing strokes. */
  minParallelStrokes: number;
  /** plausible width range as multiples of wall thickness. */
  minWidthFactor: number;
  maxWidthFactor: number;
  /** max perpendicular extent (depth) as a multiple of wall thickness. */
  maxDepthFactor: number;
  /** components with more sampled points than this are annotation/furniture. */
  maxPoints: number;
  /** ignore strokes shorter than this (source units). */
  minStrokeLength: number;
}

export const WINDOW_DEFAULTS: WindowOptions = {
  angleTolerance: 0.06,
  wallBandFactor: 1.6,
  minParallelStrokes: 2,
  minWidthFactor: 0.9,
  maxWidthFactor: 18,
  maxDepthFactor: 1.8,
  maxPoints: 40,
  minStrokeLength: 1,
};

/** True when the component topology can only be annotation/furniture, never a window. */
function isFurnitureOrAnnotation(c: Component, o: WindowOptions): boolean {
  if (c.points.length > o.maxPoints) return true; // dense symbol / text outline
  return false;
}

function parallelGroup(segs: Segment[], tol: number): Segment[] {
  // largest mutually near-parallel subset (greedy around each seed)
  let best: Segment[] = [];
  for (const seed of segs) {
    const group = segs.filter((s) => angleDiff(seed, s) <= tol);
    if (group.length > best.length) best = group;
  }
  return best;
}

/** At least two strokes in the group must be genuinely offset (frame + glazing). */
function hasOffsetPair(group: Segment[], minGap: number): boolean {
  for (let i = 0; i < group.length; i++)
    for (let j = i + 1; j < group.length; j++)
      if (pointLineDistance(midpoint(group[j]!), group[i]!) > minGap) return true;
  return false;
}

export function extractWindowCandidates(
  components: Component[],
  walls: PhysicalWall[],
  o: WindowOptions = WINDOW_DEFAULTS,
): WindowCandidate[] {
  const out: WindowCandidate[] = [];

  for (const c of components) {
    // (5) hinge/leaf/swing evidence disqualifies immediately — doors own curves.
    if (c.curves > 0) continue;
    if (c.lines < o.minParallelStrokes) continue;
    if (c.points.length < 4) continue;
    if (isFurnitureOrAnnotation(c, o)) continue;

    const segs = polylineSegments(c.points, c.closed).filter(
      (s) => len(s) >= o.minStrokeLength,
    );
    if (segs.length < o.minParallelStrokes) continue;

    // (1) parallel frame/glazing strokes
    const group = parallelGroup(segs, o.angleTolerance);
    if (group.length < o.minParallelStrokes) continue;
    if (!hasOffsetPair(group, Math.max(c.strokeWidth * 0.5, 0.05))) continue;

    const reasons: string[] = ['parallel-frame-glazing-strokes'];
    const sourceIds = c.source.primitiveIds ?? [c.id];

    // (1.5) capture source provenance so accepted/review candidates
    // always retain traceability back to MuPDF primitive IDs when
    // source identity is available.
    const sourceRootIds = c.source.rootIds ?? c.source.primitiveIds ?? null;

    // (2) host wall: near-parallel + inside thickness corridor
    let host: PhysicalWall | undefined;
    let hostDist = Infinity;
    const probe = group[0]!;
    for (const w of walls) {
      if (angleDiff(probe, w.centerline) > o.angleTolerance) continue;
      const d = pointLineDistance(midpoint(probe), w.centerline);
      if (d < hostDist) {
        host = w;
        hostDist = d;
      }
    }
    if (!host || hostDist > host.thickness * o.wallBandFactor) {
      // Closed rects with no parallel host wall are leaf/furniture topology,
      // not frame/glazing evidence — drop silently instead of reporting.
      if (c.closed) continue;
      // Open window-like strokes with no hosting wall are REJECTED, not floated.
      out.push({
        id: `window:${c.id}`,
        hostWallId: null,
        interval: null,
        sourceIds,
        confidence: 0.2,
        verdict: 'rejected',
        reasons: [...reasons, 'no-host-wall'],
      });
      continue;
    }
    reasons.push('host-wall-corridor');

    // (3) finite interval along the wall centerline, t in [0,1]
    const ts = group.flatMap((s) => [
      project(s.a, host.centerline),
      project(s.b, host.centerline),
    ]);
    const rawFrom = Math.min(...ts);
    const rawTo = Math.max(...ts);
    const from = clamp01(rawFrom);
    const to = clamp01(rawTo);
    if (!(to > from) || rawTo <= 0 || rawFrom >= 1) {
      out.push({
        id: `window:${c.id}`,
        hostWallId: host.id,
        interval: null,
        sourceIds,
        confidence: 0.25,
        verdict: 'rejected',
        reasons: [...reasons, 'no-finite-host-interval'],
      });
      continue;
    }
    reasons.push('finite-host-interval');

    // (4) plausible width along the wall + depth across the wall
    const width = (to - from) * host.length;
    const depth = Math.max(
      ...group.flatMap((s) => [
        pointLineDistance(s.a, host.centerline),
        pointLineDistance(s.b, host.centerline),
      ]),
    );
    const widthOk =
      width >= host.thickness * o.minWidthFactor &&
      width <= host.thickness * o.maxWidthFactor;
    const depthOk = depth <= host.thickness * o.maxDepthFactor;
    if (widthOk) reasons.push('plausible-width');
    else reasons.push('implausible-width');
    if (depthOk) reasons.push('plausible-depth');
    else reasons.push('implausible-depth');

    const interval: HostedInterval = {
      hostWallId: host.id,
      from,
      to,
      center: (from + to) / 2,
      width,
    };
    const accepted = widthOk && depthOk;
    out.push({
      id: `window:${c.id}`,
      hostWallId: host.id,
      interval,
      sourceIds,
      confidence: accepted ? Math.min(0.9, 0.6 + 0.08 * group.length) : 0.5,
      verdict: accepted ? 'accepted' : 'review',
      reasons,
    });
  }

  return dedupeByInterval(out);
}

function dedupeByInterval(xs: WindowCandidate[]): WindowCandidate[] {
  const used = new Set<string>();
  return xs.filter((x) => {
    if (!x.interval) return true;
    const k = `${x.interval.hostWallId}:${Math.round(x.interval.center * 100)}`;
    if (used.has(k)) return false;
    used.add(k);
    return true;
  });
}
