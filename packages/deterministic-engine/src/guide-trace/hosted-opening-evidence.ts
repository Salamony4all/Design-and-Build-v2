/**
 * PRESERVE LOCAL NON-WALL VECTOR EVIDENCE (next task after hosted-opening core).
 *
 * The 56 matched walls and the 41 hosted gaps are the ONLY permitted host geometry
 * (frozen). We do NOT rely on parser.openings. Instead we audit the normalized raw
 * primitive stream (line / polyline / arc / curve / closed_path) preserved by the
 * parser, and inside a scale-aware search window around each hosted gap we extract:
 *
 *   - local door-leaf lines   -> DOOR signature
 *   - local swing arcs        -> DOOR signature
 *   - aligned frame lines     -> WINDOW signature
 *
 * All coordinates go through the frozen DrawingExposure.pdfToWorld so evidence and
 * gaps share one space. detectHostedOpenings() itself is FROZEN and only called.
 * Unmatched gaps stay ambiguous (never force-classified).
 */
import type { DrawingExposure } from './drawing-exposure';
import { pdfPointToWorld } from './drawing-exposure';
import { detectHostedOpenings, type HostedWall, type RawStroke, type DoorSymbol, type WindowSymbol } from './hosted-openings';

// Local structural mirror of the parser's preserved raw primitive (line/polyline/arc/
// curve/closed_path). Defined here so the engine stays self-contained (no cross-package
// relative import into apps/editor). Fields must match PdfRawPrimitive in pdf-vector-parser.
export interface RawPrimitiveEvidence {
  id: string;
  kind: 'line' | 'polyline' | 'arc' | 'curve' | 'closed_path';
  pointsPt: Array<[number, number]>;
  lineWidthPt: number;
  hasCurves: boolean;
  layer?: string;
  role?: string;
  sourcePathId: string;
  excludedFromWallReason: string;
}

export interface GapPrimitiveAudit {
  gapHostWallId: string;
  gapStartM: number;
  gapEndM: number;
  gapWidthM: number;
  primitives: Array<{
    primitiveId: string;
    kind: RawPrimitiveEvidence["kind"];
    lengthM: number;
    orientationDeg: number;
    distanceToGapM: number;
    sourcePathId: string;
    excludedFromWallReason: string;
    role: 'door-leaf' | 'swing-arc' | 'window-frame' | 'unrelated';
  }>;
}

export interface LocalGapEvidenceResult {
  openings: ReturnType<typeof detectHostedOpenings>['openings'];
  diagnostics: ReturnType<typeof detectHostedOpenings>['diagnostics'];
  audit: GapPrimitiveAudit[];
  rawLocalLineCount: number;   // line + polyline primitives near gaps
  rawLocalCurveCount: number;  // arc + curve primitives near gaps
  gapsWithLeafEvidence: number;
  gapsWithArcEvidence: number;
  gapsWithFrameEvidence: number;
}

function toWorld(exp: DrawingExposure, pts: Array<[number, number]>): Array<[number, number]> {
  return pts.map(([x, y]) => pdfPointToWorld(exp, x, y));
}
function segLen(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
function orientationDeg(a: [number, number], b: [number, number]): number {
  return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
}
function pointSegDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 === 0) return segLen(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return segLen(p, [a[0] + t * dx, a[1] + t * dy]);
}

export function runLocalGapEvidence(
  res: { rawPrimitives: RawPrimitiveEvidence[]; walls: any[] },
  exp: DrawingExposure,
  hosts: HostedWall[],
  strokes: RawStroke[],
): LocalGapEvidenceResult {
  // First pass: detect the 41 hosted gaps (frozen detector, no symbols yet).
  const firstPass = detectHostedOpenings({ walls: hosts, strokes, doorSymbols: [], windowSymbols: [] });
  const gaps = firstPass.openings; // each carries hostWallId, startAlongHostM, endAlongHostM, widthM

  const doorSymbols: DoorSymbol[] = [];
  const windowSymbols: WindowSymbol[] = [];
  const audit: GapPrimitiveAudit[] = [];
  const claimed = new Set<string>(); // each primitive assigned to exactly one gap

  let rawLocalLineCount = 0;
  let rawLocalCurveCount = 0;
  let gapsWithLeafEvidence = 0;
  let gapsWithArcEvidence = 0;
  let gapsWithFrameEvidence = 0;

  // Precompute world coords for every raw primitive ONCE (avoids 41× remapping).
  const primWorld = res.rawPrimitives.map(p => ({
    id: p.id, kind: p.kind, hasCurves: p.hasCurves, pointsPt: p.pointsPt,
    sourcePathId: p.sourcePathId, excludedFromWallReason: p.excludedFromWallReason,
    wpts: toWorld(exp, p.pointsPt),
  }));

  for (const g of gaps) {
    const host = hosts.find(h => h.id === g.hostWallId)!;
    const vx = host.b[0] - host.a[0], vy = host.b[1] - host.a[1];
    const L = Math.hypot(vx, vy) || 1; const ux = vx / L, uy = vy / L;
    const p0: [number, number] = [host.a[0] + ux * g.startAlongHostM, host.a[1] + uy * g.startAlongHostM];
    const p1: [number, number] = [host.a[0] + ux * g.endAlongHostM, host.a[1] + uy * g.endAlongHostM];
    const W = g.widthM;
    const R = W / 2 + 0.2; // tight scale-aware search window around the gap
    const hostAngle = Math.atan2(uy, ux) * 180 / Math.PI;
    // gap-width-aware length gate: a real leaf/frame spans roughly the opening
    const lenLo = Math.max(0.35, W * 0.6), lenHi = W * 1.5 + 0.15;
    let leafHere = false, arcHere = false, frameHere = false;
    const primAudit: GapPrimitiveAudit['primitives'] = [];

    for (const pw of primWorld) {
      if (pw.kind === 'closed_path') continue; // keep-out: closed CAD boxes are not local opening evidence
      const wpts = pw.wpts;
      // min distance from primitive vertices to gap segment
      let minD = Infinity;
      for (const wp of wpts) minD = Math.min(minD, pointSegDist(wp, p0, p1));
      if (minD > R) continue; // unrelated local primitive (outside window)

      const lengthM = wpts.length >= 2 ? wpts.slice(1).reduce((s, p, i) => s + segLen(wpts[i]!, p), 0) : 0;
      const a0 = wpts[0]!, a1 = wpts[wpts.length - 1]!;
      const orient = orientationDeg(a0, a1);
      let diff = Math.abs(((orient - hostAngle + 540) % 360) - 180);
      const parallel = diff <= 12;
      const perp = diff >= 78;
      // perpendicular extent of the primitive relative to the wall centerline
      const perpExtent = Math.max(pointSegDist(a0, host.a, host.b), pointSegDist(a1, host.a, host.b));
      // distance of the primitive's midpoint from the wall centerline plane
      const midPerp = pointSegDist([(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2], host.a, host.b);

      let role: 'door-leaf' | 'swing-arc' | 'window-frame' | 'unrelated' = 'unrelated';
      if (pw.hasCurves || pw.kind === 'curve') {
        // swing arc candidate
        const cx = wpts.reduce((s, p) => s + p[0], 0) / wpts.length;
        const cy = wpts.reduce((s, p) => s + p[1], 0) / wpts.length;
        const rad = wpts.reduce((s, p) => s + segLen(p, [cx, cy]), 0) / wpts.length;
        if (rad >= 0.3 && rad <= 1.6) {
          if (!claimed.has(pw.id)) { doorSymbols.push({ kind: 'arc', center: [cx, cy], radiusM: rad }); claimed.add(pw.id); arcHere = true; role = 'swing-arc'; }
          else role = 'swing-arc';
        }
      } else if (pw.kind === 'line' && perp && lengthM >= lenLo && lengthM <= lenHi && perpExtent >= 0.10 && midPerp <= 0.25) {
        // door leaf: short segment crossing the wall at the gap, length ≈ opening width,
        // centered on the wall and straddling the wall thickness.
        if (!claimed.has(pw.id)) { doorSymbols.push({ kind: 'leaf', a: a0, b: a1 }); claimed.add(pw.id); leafHere = true; role = 'door-leaf'; }
        else role = 'door-leaf';
      } else if ((pw.kind === 'line' || pw.kind === 'polyline') && parallel && lengthM >= lenLo && lengthM <= lenHi && midPerp <= 0.45) {
        // window frame line: short segment parallel to the host, ≈ opening width, just
        // inside/outside the wall plane near the gap.
        if (!claimed.has(pw.id)) { windowSymbols.push({ a: a0, b: a1 }); claimed.add(pw.id); frameHere = true; role = 'window-frame'; }
        else role = 'window-frame';
      }

      if (pw.kind === 'line' || pw.kind === 'polyline') rawLocalLineCount++;
      else rawLocalCurveCount++;

      if (role !== 'unrelated') primAudit.push({
        primitiveId: pw.id, kind: pw.kind, lengthM: +lengthM.toFixed(3),
        orientationDeg: +orient.toFixed(1), distanceToGapM: +minD.toFixed(3),
        sourcePathId: pw.sourcePathId, excludedFromWallReason: pw.excludedFromWallReason, role,
      });
    }

    if (leafHere) gapsWithLeafEvidence++;
    if (arcHere) gapsWithArcEvidence++;
    if (frameHere) gapsWithFrameEvidence++;
    audit.push({
      gapHostWallId: g.hostWallId, gapStartM: g.startAlongHostM, gapEndM: g.endAlongHostM,
      gapWidthM: g.widthM, primitives: primAudit,
    });
  }

  // Final pass: classify gaps with the extracted local evidence (frozen detector).
  const { openings, diagnostics } = detectHostedOpenings({ walls: hosts, strokes, doorSymbols, windowSymbols });

  return { openings, diagnostics, audit, rawLocalLineCount, rawLocalCurveCount, gapsWithLeafEvidence, gapsWithArcEvidence, gapsWithFrameEvidence };
}
