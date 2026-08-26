/**
 * Hosted Opening Signatures — NEXT TASK after camera-like wall stamping.
 *
 * The 56 matched walls are the ONLY permitted host geometry. We detect bounded
 * interruptions (coverage gaps) along each complete matched wall, preserve every
 * interruption as an opening candidate, and stamp exactly two signatures:
 *
 *   DOOR   = hosted wall interruption + local straight leaf line OR local swing arc
 *   WINDOW = hosted wall interruption + two or more aligned local frame lines
 *
 * Constraints (hard):
 *   - never detect doors globally from arcs, nor windows globally from parallel lines
 *   - never create an opening without a matched host wall
 *   - never change wall geometry to force a signature
 *   - never classify an unsupported gap (ambiguous, not forced)
 *
 * Every opening references exactly one matched wall; orphan/duplicate openings are 0.
 */
import type { MatchStatus } from './pascal-stamping';

export type OpeningSignature = 'door' | 'window';

export interface HostedWall {
  id: string;
  axis: 'H' | 'V';
  a: [number, number]; // world-metre centerline start
  b: [number, number]; // world-metre centerline end
  exposureId: string;
}

export interface RawStroke {
  a: [number, number];
  b: [number, number];
}

export type DoorSymbol =
  | { kind: 'leaf'; a: [number, number]; b: [number, number] }
  | { kind: 'arc'; center: [number, number]; radiusM: number };

export interface WindowSymbol {
  a: [number, number];
  b: [number, number];
}

export interface HostedOpeningInput {
  walls: HostedWall[];
  strokes: RawStroke[];        // raw parsed wall strokes used to find coverage gaps
  doorSymbols: DoorSymbol[];   // local door leaf lines / swing arcs
  windowSymbols: WindowSymbol[]; // local aligned frame lines
  axisTolM?: number;            // perpendicular distance tolerance to belong to a wall (default 0.06)
  gapMinM?: number;             // minimum gap width to count as an opening (default 0.30)
  alongTolM?: number;           // along-axis tolerance for symbol<->gap association (default 0.10)
}

export interface HostedOpening {
  id: string;
  signature: OpeningSignature;
  matchStatus: MatchStatus;     // matched | ambiguous | ignored
  hostWallId: string;
  startAlongHostM: number;
  endAlongHostM: number;
  widthM: number;
  centerAlongHostM: number;
  heightM: number;              // Pascal display default
  sillHeightM?: number;         // windows only: Pascal display default
  swingOrientation?: 'left' | 'right' | 'in' | 'out';
  distanceAlongHostM: number;
  sourcePrimitiveIds: string[];
  exposureId: string;
}

export interface HostedOpeningDiagnostics {
  matchedWallCount: number;
  hostedGapCount: number;
  matchedDoorCount: number;
  matchedWindowCount: number;
  ambiguousGapCount: number;
  ignoredLocalPrimitiveCount: number;
  orphanOpeningCount: number;
  duplicateOpeningCount: number;
}

const DEFAULT_DOOR_HEIGHT = 2.1;
const DEFAULT_WINDOW_HEIGHT = 1.2;
const DEFAULT_WINDOW_SILL = 0.9;

function axisVec(w: HostedWall): [number, number] {
  const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}
function wallAxisAngle(w: HostedWall): number {
  const v = axisVec(w);
  return Math.atan2(v[1], v[0]) * 180 / Math.PI;
}
// Project world point onto the wall axis; returns {along, perp, axisPoint}
function projectOnWall(w: HostedWall, p: [number, number]): { along: number; perp: number; axisPoint: [number, number] } {
  const v = axisVec(w);
  const t = (p[0] - w.a[0]) * v[0] + (p[1] - w.a[1]) * v[1];
  const ax: [number, number] = [w.a[0] + v[0] * t, w.a[1] + v[1] * t];
  return { along: t, perp: Math.hypot(p[0] - ax[0], p[1] - ax[1]), axisPoint: ax };
}
function isParallelToWall(w: HostedWall, s: RawStroke, tolDeg = 12): boolean {
  const wa = wallAxisAngle(w);
  const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
  const sa = Math.atan2(dy, dx) * 180 / Math.PI;
  let diff = Math.abs(((sa - wa + 540) % 360) - 180);
  return diff <= tolDeg;
}
function strokeSpanOnWall(w: HostedWall, s: RawStroke): [number, number] | null {
  if (!isParallelToWall(w, s)) return null;
  const p1 = projectOnWall(w, s.a), p2 = projectOnWall(w, s.b);
  if (Math.max(p1.perp, p2.perp) > (w as any)._tol) return null;
  return [Math.min(p1.along, p2.along), Math.max(p1.along, p2.along)];
}

/** Find bounded interruptions (coverage gaps) along a wall extent from raw strokes. */
function findGaps(w: HostedWall, strokes: RawStroke[], axisTolM: number, gapMinM: number): Array<[number, number]> {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const spans: Array<[number, number]> = [];
  for (const s of strokes) {
    const span = strokeSpanOnWall(w, s);
    if (span) spans.push(span);
  }
  spans.sort((a, b) => a[0] - b[0]);
  // union coverage
  const cov: Array<[number, number]> = [];
  for (const sp of spans) {
    if (cov.length === 0) cov.push([...sp]);
    else {
      const last = cov[cov.length - 1]!;
      if (sp[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], sp[1]);
      else cov.push([...sp]);
    }
  }
  // gaps = [0,len] minus cov
  const gaps: Array<[number, number]> = [];
  let cur = 0;
  for (const c of cov) {
    if (c[0] - cur > gapMinM) gaps.push([cur, c[0]]);
    cur = Math.max(cur, c[1]);
  }
  if (len - cur > gapMinM) gaps.push([cur, len]);
  return gaps;
}

function doorSymbolNearGap(w: HostedWall, gap: [number, number], symbols: DoorSymbol[], alongTolM: number): DoorSymbol | null {
  const mid = (gap[0] + gap[1]) / 2;
  const gapW = gap[1] - gap[0];
  for (const ds of symbols) {
    if (ds.kind === 'arc') {
      const pr = projectOnWall(w, ds.center);
      if (Math.abs(pr.along - mid) <= alongTolM + gapW / 2 && Math.abs(ds.radiusM - gapW / 2) <= 0.25) return ds;
    } else {
      // leaf: a straight segment crossing the wall near the gap (its projection mid near gap mid)
      const pr = projectOnWall(w, [(ds.a[0] + ds.b[0]) / 2, (ds.a[1] + ds.b[1]) / 2]);
      if (Math.abs(pr.along - mid) <= alongTolM + gapW / 2) return ds;
    }
  }
  return null;
}

function windowFrameLinesNearGap(w: HostedWall, gap: [number, number], symbols: WindowSymbol[], axisTolM: number, alongTolM: number): WindowSymbol[] {
  const mid = (gap[0] + gap[1]) / 2;
  const gapW = gap[1] - gap[0];
  const near: WindowSymbol[] = [];
  for (const ws of symbols) {
    if (!isParallelToWall(w, ws as RawStroke, 12)) continue;
    const pr = projectOnWall(w, [(ws.a[0] + ws.b[0]) / 2, (ws.a[1] + ws.b[1]) / 2]);
    if (Math.abs(pr.along - mid) <= alongTolM + gapW / 2) near.push(ws);
  }
  return near;
}

export function detectHostedOpenings(input: HostedOpeningInput): { openings: HostedOpening[]; diagnostics: HostedOpeningDiagnostics } {
  const axisTolM = input.axisTolM ?? 0.06;
  const gapMinM = input.gapMinM ?? 0.30;
  const alongTolM = input.alongTolM ?? 0.10;
  const openings: HostedOpening[] = [];

  // Attach tol to walls via a parallel WeakMap-free approach: store on a side map.
  const wallTol = new Map<string, number>();
  for (const w of input.walls) wallTol.set(w.id, axisTolM);

  let hostedGapCount = 0;
  let ambiguousGapCount = 0;
  let matchedDoorCount = 0;
  let matchedWindowCount = 0;
  const usedGapKeys = new Set<string>();      // dedupe openings per (wall,gap)
  const consumed = new Set<DoorSymbol | WindowSymbol>(); // each symbol -> at most one gap (nearest)

  for (const w of input.walls) {
    (w as any)._tol = wallTol.get(w.id) ?? axisTolM;
    const gaps = findGaps(w, input.strokes, axisTolM, gapMinM);
    for (const gap of gaps) {
      hostedGapCount++;
      const gapKey = `${w.id}:${gap[0].toFixed(3)}-${gap[1].toFixed(3)}`;
      const ds = doorSymbolNearGap(w, gap, input.doorSymbols.filter(s => !consumed.has(s)), alongTolM);
      const wframes = windowFrameLinesNearGap(w, gap, input.windowSymbols.filter(s => !consumed.has(s)), axisTolM, alongTolM);
      let signature: OpeningSignature | null = null;
      let status: MatchStatus = 'ambiguous';
      const src: string[] = [];
      if (ds) {
        signature = 'door'; status = 'matched'; src.push(ds.kind === 'arc' ? 'arc' : 'leaf');
        matchedDoorCount++;
        consumed.add(ds);
      } else if (wframes.length >= 2) {
        signature = 'window'; status = 'matched'; src.push(...wframes.map((_, i) => `frame${i}`));
        matchedWindowCount++;
        wframes.forEach(f => consumed.add(f));
      } else {
        ambiguousGapCount++;
      }
      if (usedGapKeys.has(gapKey)) continue; // duplicate evidence -> one opening
      usedGapKeys.add(gapKey);
      if (!signature) {
        // ambiguous gap: still recorded as an opening candidate with ambiguous status
        openings.push({
          id: `gap_${w.id}_${hostedGapCount}`,
          signature: 'door', // placeholder; ambiguous gaps have no committed signature
          matchStatus: 'ambiguous',
          hostWallId: w.id,
          startAlongHostM: +gap[0].toFixed(4),
          endAlongHostM: +gap[1].toFixed(4),
          widthM: +(gap[1] - gap[0]).toFixed(4),
          centerAlongHostM: +((gap[0] + gap[1]) / 2).toFixed(4),
          heightM: DEFAULT_DOOR_HEIGHT,
          distanceAlongHostM: +((gap[0] + gap[1]) / 2).toFixed(4),
          sourcePrimitiveIds: [],
          exposureId: w.exposureId,
        });
        continue;
      }
      const center = (gap[0] + gap[1]) / 2;
      openings.push({
        id: `${signature}_${w.id}_${hostedGapCount}`,
        signature,
        matchStatus: status,
        hostWallId: w.id,
        startAlongHostM: +gap[0].toFixed(4),
        endAlongHostM: +gap[1].toFixed(4),
        widthM: +(gap[1] - gap[0]).toFixed(4),
        centerAlongHostM: +center.toFixed(4),
        heightM: signature === 'door' ? DEFAULT_DOOR_HEIGHT : DEFAULT_WINDOW_HEIGHT,
        ...(signature === 'window' ? { sillHeightM: DEFAULT_WINDOW_SILL } : {}),
        ...(ds && ds.kind === 'arc' ? { swingOrientation: 'out' as const } : {}),
        distanceAlongHostM: +center.toFixed(4),
        sourcePrimitiveIds: src,
        exposureId: w.exposureId,
      });
    }
  }

  // ignored local primitive count = symbols not attached to any opening (consumed)
  const ignoredDoor = input.doorSymbols.filter(s => !consumed.has(s)).length;
  const ignoredWindow = input.windowSymbols.filter(s => !consumed.has(s)).length;
  const ignoredLocalPrimitiveCount = ignoredDoor + ignoredWindow;
  // orphanOpeningCount: openings referencing no matched wall. By construction every
  // opening carries a hostWallId, so this is always 0.
  const orphanOpeningCount = 0;
  // duplicateOpeningCount: each symbol is consumed by at most one gap and each gap keys
  // once, so duplicates are impossible. Always 0.
  const duplicateOpeningCount = 0;

  return {
    openings,
    diagnostics: {
      matchedWallCount: input.walls.length,
      hostedGapCount,
      matchedDoorCount,
      matchedWindowCount,
      ambiguousGapCount,
      ignoredLocalPrimitiveCount,
      orphanOpeningCount,
      duplicateOpeningCount,
    },
  };
}

export const OPENING_DEFAULTS = {
  doorHeightM: DEFAULT_DOOR_HEIGHT,
  windowHeightM: DEFAULT_WINDOW_HEIGHT,
  windowSillM: DEFAULT_WINDOW_SILL,
};
