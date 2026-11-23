// packages/extraction-mupdf/src/index.ts
// Public surface of the clean, framework-free Pure MuPDF extraction package.
import type { MuPdfPureResult, PurePhysicalWall, MuPdfLineageAuditResult } from './mupdf-pure';
export { extractPureWallResult } from './mupdf-pure';
import { toExtractionResult } from './result-adapter';
import { extractionProvider, extractBuildingFromPdf, mupdfExtractionProvider } from './provider';
import {
  acceptedGeometryHash,
  acceptedEvidenceHash,
  canonicalWallRecords,
  type CanonicalWallRecord,
} from './canonical-hash';

export { extractColumnsFromPdf, extractColumnsFromCapturedGeometry } from './column-integration';
export type { ColumnContract, ColumnExtractionInput } from './column-integration';
export {
  completeWalls,
  detectPairedFaces,
  deriveCompletionWall,
  buildSourceOwnershipRegistry,
} from './wall-completion/core';
export type {
  WallCompletionInput,
} from './wall-completion/core';
export type {
  SourceOwnershipRegistry,
  FacePair,
  CompletionWall,
  EndpointExtension,
  FinalizedWallNetwork,
  ProtectedOpening,
  AcceptedWall,
  RawSegment,
  Vec2,
  CandidateClass,
  GapClass,
  WallCompletionConfig,
} from './wall-completion/types';
export { DEFAULT_WALL_COMPLETION_CONFIG } from './wall-completion/types';
export type { MuPdfPureResult, PurePhysicalWall, PureWallConfig, PureCandidate, MuPdfLineageAuditResult } from './mupdf-pure';
export { extractPureWindowResult, PURE_WINDOW_DEFAULTS, runWindowPipeline } from './mupdf-pure-windows';
export type {
  MuPdfPureWindowResult,
  MuPdfWindowLineageAuditResult,
  PureWindowConfig,
  PureWindowCandidate,
  PureOpeningRegion,
  WindowVerdict,
  HostStatus,
  SourceSegment,
  HostEvaluation,
  WindowGeometryInput,
} from './mupdf-pure-windows';
export { extractPureDoorResult, runDoorPipeline, PURE_DOOR_DEFAULTS, buildDoorProductionManifest } from './mupdf-pure-doors';
export type {
  MuPdfPureDoorResult,
  DoorAssembly,
  DoorPrimitive,
  DoorVerdict as DoorVerdictType,
  DoorType as DoorTypeType,
  DoorHostStatus,
  DoorEvidenceMode,
  PureDoorConfig,
  DoorGeometryInput,
  DoorProductionManifest,
  AcceptedDoorManifestRecord,
  ReviewDoorManifestRecord,
} from './mupdf-pure-doors';
export type { LineageStore, PaintedOperationLineage, SubpathLineage, SegmentLineage, MuVector } from './vector-device';
export { collectPageVectors } from './vector-device';
export { detectCurvedWalls, curvedWallPieces, curvedBandUnder, CURVED_WALL_DEFAULTS } from './curved-walls';
export type { CurvedWallConfig, CurvedWallSegment, CurvedWallPiece, CurvedPod, CurvedPodDoor, CurvedWallResult, CurvedWallKind } from './curved-walls';
export { detectGlassPartitions, alongWalls, GLASS_DEFAULTS } from './glass-partitions';
export { detectFurniture, classifyPiece, isFurnitureLayer, furnitureFamily, furnitureTextsFromStructuredText, FURNITURE_DEFAULTS } from './furniture-blocks';
export type { FurnitureConfig, FurnitureFamily, FurnitureKind, FurniturePiece, FurnitureResult, FurnitureShape, FurnitureText, FurnitureType } from './furniture-blocks';
export type { GlassConfig, GlassHostWall, GlassPartition, GlassResult, GlassSource, GlassStyle, GlassText } from './glass-partitions';
import * as mupdf from 'mupdf';
export { mupdf };
export { toExtractionResult, documentFrameFromPure } from './result-adapter';
export { extractionProvider, extractBuildingFromPdf, mupdfExtractionProvider } from './provider';
export type { MuPdfExtractionOptions } from './provider';
export {
  acceptedGeometryHash,
  acceptedEvidenceHash,
  canonicalWallRecords,
  archiveCanonicalInputs,
  lineageStoreHash,
  type CanonicalWallRecord,
} from './canonical-hash';

/**
 * Backward-compatible alias. Previously this rounded (id,a,b,thickness,confidence)
 * and concatenated with ';'. The documented canonical form (canonical-hash.ts)
 * uses endpoint-order normalization + stable JSON + sha256 over UTF-8 and is the
 * single source of truth for parity. Kept as an alias so callers don't break.
 */
export function canonicalAcceptedGeometryHash(accepted: PurePhysicalWall[]): string {
  return acceptedGeometryHash(accepted);
}
export function canonicalAcceptedEvidenceHash(accepted: PurePhysicalWall[]): string {
  return acceptedEvidenceHash(accepted);
}

/** Summarized audit for parity tests / diagnostics (no raw geometry). */
export function summarizePureResult(r: MuPdfPureResult) {
  return {
    pageBounds: r.pageBoundsMupdf,
    buildingRoi: r.activeBuildingRegionMupdf,
    scaleMmPerPt: r.scaleMmPerPt,
    scaleSource: r.scaleSource,
    acceptedWallCount: r.accepted.length,
    reviewCount: r.review.length,
    rejectedCount: r.rejected.length,
    genuinelyFloatingAccepted: r.genuinelyFloatingAcceptedPhysicalWalls?.length ?? 0,
    floatingAccepted: r.floatingAccepted.length,
    thicknessBands: r.thicknessBands,
    junctionCount: r.junctions.length,
    candidateHash: r.candidateHash,
    acceptedGeometryHash: acceptedGeometryHash(r.accepted),
    acceptedEvidenceHash: acceptedEvidenceHash(r.accepted),
    vectorOperationCount: r.vectorOperationCount,
    timings: r.timings,
  };
}

export const GEOMETRIC_EXTRACTION_PROVIDER = {
  FROZEN_CODE06: 'frozen-code06',
  LIVE_MUPDF: 'live-mupdf',
} as const;
export type GeometricProvider = (typeof GEOMETRIC_EXTRACTION_PROVIDER)[keyof typeof GEOMETRIC_EXTRACTION_PROVIDER];

export { extractBuildingFromPdf as default };
