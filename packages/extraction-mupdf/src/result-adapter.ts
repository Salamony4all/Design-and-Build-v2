// packages/extraction-mupdf/src/result-adapter.ts
// Converts the authoritative Pure MuPDF result into the neutral, serializable
// ExtractionResult contract (design-build-extraction-contracts). Framework-free:
// no React, Next, Pascal, useScene, Viewer, ChatPanel, old scene bridge.
//
// Geometry is converted via the SHARED coordinate-frame package — no duplicate
// X/Z mirror, crop, padding, ROI-relative origin, or hard-coded scale here.
// The full-page guide and every node category share one transform.

import type {
  ExtractionResult,
  DocumentFrame,
  SlabContract,
  WallContract,
  WindowContract,
  ReviewItem,
  RejectedItem,
  ReviewSummary,
  Provenance,
  ExtractionAudit,
  Vec2,
} from 'design-build-extraction-contracts';
import { createCoordinateFrame } from 'design-build-coordinate-frame';
import type { MuPdfPureResult, PurePhysicalWall } from './mupdf-pure';

const WALL_HEIGHT_M = 3.0;

function wallProvenance(w: PurePhysicalWall): Provenance {
  return {
    sourceKind: 'mupdf',
    sourcePrimitiveIds: [
      ...(w.sourceRootIds ?? []),
      ...(w.sourceSubpathIds ?? []),
      ...(w.sourceStrokeIds ?? []),
    ],
    confidence: w.confidence ?? 1,
    extractionType: 'wall',
    note: `evidence=${(w.evidenceTypes ?? []).join(',')}; connectivity=${w.connectivityClass ?? 'unknown'}`,
  };
}

/** Build the page frame + shared transform from the raw pure result. */
export function documentFrameFromPure(r: MuPdfPureResult, fileName?: string): DocumentFrame {
  const [x0, y0, x1, y1] = r.pageBoundsMupdf;
  const widthMm = (x1 - x0) * r.scaleMmPerPt;
  const heightMm = (y1 - y0) * r.scaleMmPerPt;
  return {
    pageId: fileName ?? 'page-0',
    pageBoundsPt: [x0, y0, x1, y1],
    scaleMmPerPt: r.scaleMmPerPt,
    widthM: widthMm / 1000,
    heightM: heightMm / 1000,
    orientation: widthMm >= heightMm ? 'landscape' : 'portrait',
  };
}

/**
 * Convert an authoritative pure-MuPDF result to a neutral ExtractionResult.
 * For Change Set 2 we populate: document, slab draft, walls, windows (from the
 * proven AutomaticDetectorClean pipeline), review items, provenance, audit.
 * Windows arrive as neutral WindowContract[] (world meters) produced by
 * extract-live-windows.extractLiveWindowContracts, which mirrors the wall
 * geometry (fraction-along-host-wall -> world endpoints). No second transform.
 */
export function toExtractionResult(
  r: MuPdfPureResult,
  opts?: { fileName?: string; windows?: WindowContract[] },
): ExtractionResult {
  const frame = documentFrameFromPure(r, opts?.fileName);
  const cf = createCoordinateFrame({
    pageBoundsPt: frame.pageBoundsPt,
    scaleMmPerPt: frame.scaleMmPerPt,
    pageWidthM: frame.widthM,
    pageHeightM: frame.heightM,
  });

  // Slab = the full building footprint rectangle in meters (shared transform).
  const [rx0, ry0, rx1, ry1] = r.activeBuildingRegionMupdf;
  const sp0: Vec2 = (() => { const [x, y] = cf.toPascal(rx0, ry0); return { x, y }; })();
  const sp1: Vec2 = (() => { const [x, y] = cf.toPascal(rx1, ry0); return { x, y }; })();
  const sp2: Vec2 = (() => { const [x, y] = cf.toPascal(rx1, ry1); return { x, y }; })();
  const sp3: Vec2 = (() => { const [x, y] = cf.toPascal(rx0, ry1); return { x, y }; })();
  const slab: SlabContract = {
    id: 'slab_live',
    kind: 'slab',
    polygonM: [sp0, sp1, sp2, sp3],
    thicknessM: 0.3,
    elevationM: 0,
    provenance: {
      sourceKind: 'mupdf',
      sourcePrimitiveIds: [],
      confidence: 1,
      extractionType: 'slab',
      note: 'building ROI rectangle from pure MuPDF',
    },
  };

  const walls: WallContract[] = r.accepted.map((w) => {
    const [ax, az] = cf.toPascal(w.centerline.a.x, w.centerline.a.y);
    const [bx, bz] = cf.toPascal(w.centerline.b.x, w.centerline.b.y);
    return {
      id: w.physicalWallId,
      kind: 'wall',
      startM: { x: ax, y: az },
      endM: { x: bx, y: bz },
      thicknessM: (w.thickness * r.scaleMmPerPt) / 1000,
      heightM: WALL_HEIGHT_M,
      metadata: {
        physicalWallId: w.physicalWallId,
        centreline: {
          a: { x: w.centerline.a.x, y: w.centerline.a.y },
          b: { x: w.centerline.b.x, y: w.centerline.b.y },
        },
        thickness: w.thickness,
        length: w.length,
        lengthM: Math.hypot(bx - ax, bz - az),
        orientation: w.orientation,
        orientationRadians: Math.atan2(bz - az, bx - ax),
        confidence: w.confidence,
        evidenceTypes: w.evidenceTypes ?? [],
        sourceRootIds: w.sourceRootIds ?? [],
        sourceSubpathIds: w.sourceSubpathIds ?? [],
        sourceStrokeIds: w.sourceStrokeIds ?? [],
        connectivityClass: w.connectivityClass,
        perimeterContribution: w.perimeterContribution,
        provider: 'mupdf-pure',
        approvalState: 'accepted',
      },
      provenance: wallProvenance(w),
    };
  });

  const REVIEW_LIMIT = 200; // intentional cap on returned review payload
  const reviewAll: ReviewItem[] = r.review.map((w) => {
    const [ax, az] = cf.toPascal(w.centerline.a.x, w.centerline.a.y);
    const [bx, bz] = cf.toPascal(w.centerline.b.x, w.centerline.b.y);
    return {
      id: w.physicalWallId,
      kind: 'review',
      category: 'wall-pier',
      positionM: { x: (ax + bx) / 2, y: (az + bz) / 2 },
      sizeM: [Math.hypot(bx - ax, bz - az), (w.thickness * r.scaleMmPerPt) / 1000],
      reason: (w as { reviewReason?: string }).reviewReason ?? w.verdict ?? 'review',
      sourcePrimitiveIds: [
        ...(w.sourceRootIds ?? []),
        ...(w.sourceSubpathIds ?? []),
        ...(w.sourceStrokeIds ?? []),
      ],
    };
  });
  const review: ReviewItem[] = reviewAll.slice(0, REVIEW_LIMIT);
  const byReason: Record<string, number> = {};
  for (const it of reviewAll) byReason[it.reason] = (byReason[it.reason] ?? 0) + 1;
  const reviewSummary: ReviewSummary = {
    total: reviewAll.length,
    returned: review.length,
    truncated: reviewAll.length > REVIEW_LIMIT,
    limit: REVIEW_LIMIT,
    byReason,
  };
  // Complete rejected items (never truncated) — full audit trail.
  const rejectedItems: RejectedItem[] = r.rejected.map((w) => ({
    id: w.physicalWallId,
    kind: 'rejected',
    reason: (w as { rejectionReason?: string }).rejectionReason ?? w.verdict ?? 'rejected',
    sourcePrimitiveIds: [
      ...(w.sourceRootIds ?? []),
      ...(w.sourceSubpathIds ?? []),
      ...(w.sourceStrokeIds ?? []),
    ],
  }));

  const audit: ExtractionAudit = {
    generatedAt: new Date().toISOString(),
    documentFrame: frame,
    counts: {
      slab: 1,
      walls: walls.length,
      columns: 0,
      windows: 0,
      doors: 0,
      furniture: 0,
      review: reviewAll.length, // full total (749), not the capped payload
      rejected: r.rejected.length, // full total (277)
    },
    rejectedIds: r.rejected.map((w) => w.physicalWallId),
    notes: [
      `pureCandidateHash=${r.candidateHash}`,
      `scaleSource=${r.scaleSource}`,
      `genuinelyFloatingAccepted=${r.genuinelyFloatingAcceptedPhysicalWalls?.length ?? 0}`,
      `reviewReturned=${review.length}/${reviewAll.length}`,
    ],
  };

  const windows: WindowContract[] = opts?.windows
    ? (opts.windows as WindowContract[])
    : [];

  return {
    document: frame,
    slab,
    walls,
    columns: [],
    windows,
    doors: [],
    furniture: [],
    furnitureFamilies: [],
    review,
    rejectedItems,
    reviewSummary,
    audit: {
      ...audit,
      counts: {
        ...audit.counts,
        windows: windows.length,
      },
    },
    // Provider-specific evidence preserved (not discarded).
    providerEvidence: {
      kind: 'mupdf-pure',
      raw: {
        pageBoundsMupdf: r.pageBoundsMupdf,
        activeBuildingRegionMupdf: r.activeBuildingRegionMupdf,
        scaleMmPerPt: r.scaleMmPerPt,
        scaleSource: r.scaleSource,
        candidateHash: r.candidateHash,
        thicknessBands: r.thicknessBands,
        junctionCount: r.junctions.length,
        vectorOperationCount: r.vectorOperationCount,
        timings: r.timings,
        floatingAttributionBreakdown: r.floatingAttributionBreakdown,
        primitiveOwnership: r.primitiveOwnership,
        rejectionByReason: r.rejectionByReason,
        orientation: r.orientation,
        openingLedger: r.openingLedger,
        duplicateFusionLedger: r.duplicateFusionLedger,
        recall: r.recall,
      },
    },
  };
}
