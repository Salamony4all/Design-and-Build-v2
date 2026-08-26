// harness/extract-live-windows.ts
// Change Set 2 (Gate C, live): run the REAL design-build-geometric-extraction
// window detector on the live MuPDF draw operations + the 70 page-space walls,
// and emit WindowInstallSpec[] for the geometric host resolver.
//
// Coordinate contract (validated empirically):
//   - Detector walls: 70 page-space walls from code06-pure-mupdf-golden.json
//     (points, X 312..1763 / Y 383..1165). This is the SAME page-space source
//     the canonical Gate B.1 mapping was produced against, and it matches the
//     live draw operations after we add TX/TY.
//   - Draw operations: extractPureWallResult(bytes,0,undefined,undefined,true)
//     .lineageStore.operations are in Stage-A space (offset by -TX/-TY from page
//     space). We add TX/TY to bring them into page space, matching the walls.
//   - The live MuPDF WASM is loaded ONLY here (server-side route), never in the
//     browser bundle.
//
// The 70 walls used for RENDERING come from the frozen meters fixture
// (frozen-code06-walls.json) so the structural shell matches the validated
// baseline; the detector uses the page-space golden walls so window intervals
// land in the correct coordinate frame. Both share physicalWallId, so
// installLiveWindows() resolves hosts by physicalWallId on the rendered walls.

import { readFileSync } from 'fs';
import { join } from 'path';
import { extractPureWallResult } from 'design-build-extraction-mupdf';
import {
  AutomaticDetectorClean,
} from 'design-build-geometric-extraction/src/window/automatic-detector-clean.ts';
import { CoordinateAdapter as CA } from 'design-build-geometric-extraction/src/window/coordinate-adapter.ts';

const TX = CA.TX;
const TY = CA.TY;
const MM_PER_STAGE_A_UNIT = CA.MM_PER_STAGE_A_UNIT;

const WINDOW_HEIGHT_M = 1.2;

interface DetectorWall {
  physicalWallId: string;
  thickness: number;
  centerline: { a: { x: number; y: number }; b: { x: number; y: number } };
}

export interface WindowInstallSpec {
  slotId: string;
  physicalWallId: string;
  intervalCenterM: number;
  widthM: number;
  heightM: number;
  verdict: 'ACCEPTED' | 'REVIEW' | 'REJECTED';
  note: string;
}

export interface LiveWindowExtraction {
  specs: WindowInstallSpec[];
  audit: {
    totalCandidates: number;
    accepted: number;
    review: number;
    rejected: number;
    byWall: Record<string, { accepted: number; review: number; rejected: number }>;
  };
}

/** Load the 70 page-space walls the detector runs against (canonical source). */
function loadDetectorWalls(): DetectorWall[] {
  const p = join(process.cwd(), 'tests', 'fixtures', 'code06-pure-mupdf-golden.json');
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  const accepted = raw.accepted ?? raw.walls ?? [];
  return accepted.map((w: any) => ({
    physicalWallId: w.physicalWallId,
    thickness: w.thickness ?? 10,
    centerline: {
      a: { x: w.a.x, y: w.a.y },
      b: { x: w.b.x, y: w.b.y },
    },
  }));
}

/**
 * Run the live window detector.
 * @param pdfBytes The raw PDF bytes (for the lineage draw operations).
 * @param result The live wall extraction result, containing actual wall centerlines and building region offsets.
 */
export function extractLiveWindows(
  pdfBytesOrLineage: Uint8Array | any,
  result?: import('design-build-extraction-contracts').ExtractionResult,
): LiveWindowExtraction {
  let walls: DetectorWall[];
  let tx = TX;
  let ty = TY;

  if (result && Array.isArray(result.walls) && result.walls.length > 0) {
    // Resolve walls dynamically from the actual wall extraction result
    walls = result.walls.map((w: any) => {
      const meta = w.metadata || {};
      const centerline = meta.centreline || meta.centerline || {
        a: { x: 0, y: 0 },
        b: { x: 0, y: 0 },
      };
      return {
        physicalWallId: w.id,
        thickness: meta.thickness ?? 10,
        centerline: {
          a: { x: centerline.a?.x ?? 0, y: centerline.a?.y ?? 0 },
          b: { x: centerline.b?.x ?? 0, y: centerline.b?.y ?? 0 },
        },
      };
    });

    // Resolve building ROI offset dynamically
    const rawEvidence = (result.providerEvidence as any)?.raw || {};
    const activeRegion = rawEvidence.activeBuildingRegionMupdf || [];
    if (activeRegion[0] !== undefined) tx = activeRegion[0];
    if (activeRegion[1] !== undefined) ty = activeRegion[1];
  } else {
    // Fallback to the code06 golden fixture
    walls = loadDetectorWalls();
  }

  // Retrieve lineage operations either from the pre-computed lineageStore or by extracting them now
  let rawOps: any[];
  if (pdfBytesOrLineage instanceof Uint8Array) {
    const lineage = extractPureWallResult(pdfBytesOrLineage, 0, undefined, undefined, true) as any;
    rawOps = lineage.lineageStore?.operations ?? [];
  } else {
    rawOps = pdfBytesOrLineage?.operations ?? [];
  }

  // Live draw operations (Stage-A space) -> page space (add tx/ty).
  const ops = rawOps.map((o: any) => ({
    ...o,
    transformedBounds: [
      o.transformedBounds[0] + tx,
      o.transformedBounds[1] + ty,
      o.transformedBounds[2] + tx,
      o.transformedBounds[3] + ty,
    ] as [number, number, number, number],
  }));

  const detector = new AutomaticDetectorClean();
  const { candidates, assemblies } = detector.detect(ops, walls);

  const specs: WindowInstallSpec[] = [];
  const byWall: LiveWindowExtraction['audit']['byWall'] = {};
  let accepted = 0;
  let review = 0;
  let rejected = 0;
  for (const c of candidates) {
    const verdict = c.extractionVerdict as 'ACCEPTED' | 'REVIEW' | 'REJECTED';
    if (verdict === 'ACCEPTED') accepted++;
    else if (verdict === 'REVIEW') review++;
    else rejected++;
    const pw = c.physicalWallId ?? '__NO_HOST__';
    byWall[pw] = byWall[pw] ?? { accepted: 0, review: 0, rejected: 0 };
    byWall[pw][verdict === 'ACCEPTED' ? 'accepted' : verdict === 'REVIEW' ? 'review' : 'rejected']++;
  }

  // Tuning (Gate C, live): consume the detector's ASSEMBLY stage (RETAIN +
  // UNIQUE_HOST) — the same output the canonical mapping was built from — rather
  // than the raw ACCEPTED candidates (which over-accepts narrow stroke noise).
  // Position/width come straight from the assembly (stage-A units -> metres).
  // Collapse location-duplicate assemblies (same wall + rounded centre) keeping
  // the widest, mirroring the canonical merge/cluster stage.
  const seen = new Map<string, WindowInstallSpec>();
  for (const a of assemblies) {
    const pw = a.physicalWallId;
    if (!pw || !a.finiteOpeningInterval) continue;
    const startM = (a.finiteOpeningInterval.start * MM_PER_STAGE_A_UNIT) / 1000;
    const endM = (a.finiteOpeningInterval.end * MM_PER_STAGE_A_UNIT) / 1000;
    if (!(endM > startM + 0.01)) continue; // degenerate/collapsed interval
    const intervalCenterM = (startM + endM) / 2;
    const widthM = (a.physicalWidthMm ?? 0) / 1000;
    if (widthM < 0.35) continue; // below real opening size
    const key = `${pw}@${intervalCenterM.toFixed(1)}`;
    const candidate: WindowInstallSpec = {
      slotId: a.physicalWindowHypothesisId,
      physicalWallId: pw,
      intervalCenterM,
      widthM,
      heightM: WINDOW_HEIGHT_M,
      verdict: 'ACCEPTED',
      note: `auto-window width=${(widthM * 1000).toFixed(0)}mm host=${pw}`,
    };
    const prev = seen.get(key);
    if (!prev || widthM > prev.widthM) seen.set(key, candidate);
  }
  for (const s of seen.values()) specs.push(s);

  return { specs, audit: { totalCandidates: candidates.length, accepted, review, rejected, byWall } };
}

/**
 * Change Set 2 (Gate C, live) — production window extraction.
 *
 * Reuses OUR PROVEN detector (AutomaticDetectorClean R1.3 — the same code that
 * yields the canonical window set) and converts its RETAIN + UNIQUE_HOST
 * assemblies into neutral WindowContract[] (world meters) for the pipeline.
 *
 * COORDINATE METHOD (unit-independent, mirrors the wall package): the assembly's
 * opening interval is expressed as a FRACTION t along the host wall centerline
 * (PDF-point units, exactly as the detector projected it). We then lerp the
 * host WallNode's WORLD-meter startM/endM by that fraction. This places every
 * window in true world space on its assigned wall — no inherited-rotation
 * dependency, no second coordinate system, no Stage-A/PDF scale ambiguity.
 */
