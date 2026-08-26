export type GeometryPolarity = 'positive_wall' | 'subtractive_void' | 'annotation_mask' | 'unknown';

export interface StructuralEdgeEvidence {
  id: string;
  sourcePdfId?: string;
  p1: [number, number]; // in normalized mm or Pascal metres
  p2: [number, number];
  layer: string;
  lineWidthPt: number;
  polarity: GeometryPolarity;
  isFilledRectangle?: boolean;
  color?: string;
}

export interface ProjectVerticalDefaults {
  defaultWallHeight: number;       // single declared default: 2.80 m (2800 mm)
  defaultDoorHeight: number;       // default 2.10 m (2100 mm)
  defaultWindowHeight: number;     // default 1.20 m (1200 mm)
  defaultWindowSill: number;       // default 0.90 m (900 mm)
  defaultSlabThickness: number;    // default 0.20 m (200 mm)
}

export const DEFAULT_PROJECT_VERTICALS: ProjectVerticalDefaults = {
  defaultWallHeight: 2.80,
  defaultDoorHeight: 2.10,
  defaultWindowHeight: 1.20,
  defaultWindowSill: 0.90,
  defaultSlabThickness: 0.20,
};

export interface RadiusReferenceBinding {
  familyId: string; // e.g. "radius_family_001"
  declaredPhysicalRadiusMm: number; // e.g. 900
  bindingSource: 'project-door-standard' | 'inferred-post-calibration';
  isKnownBeforeCalibration: boolean;
}

export interface RadiusFamily {
  familyId: string; // e.g. radius_family_001
  nominalRadiusMm: number;
  arcsCount: number;
  averageArcRadiusPdf: number;
  stdDevRadiusPdf: number;
  coefficientOfVariation: number;
  arcs: any[];
  isDominant: boolean;
  referenceBinding?: RadiusReferenceBinding;
}

export interface RadiusFamilyReport {
  candidateArcCount: number;
  families: RadiusFamily[];
  selectedFamily: RadiusFamily | null;
  selectedInlierCount: number;
  rejectedCount: number;
  averageSelectedRadiusPdf: number;
  coefficientOfVariation: number;
  resultingMmPerPdfUnit: number;
  isValid: boolean;
  errorMessage?: string;
}

export interface AuditTargetProfile {
  profileId: string;
  drawingName: string;
  expectedDoors: number;
  expectedWindows: number;
  expectedRoomsTarget: number;
  metadataOnlyScaleDenominator: number;
}

export interface DirectionalBoundaryMetrics {
  p50Mm: number;
  p95Mm: number;
  p99Mm: number;
  maximumMm: number;
}

export interface ComponentMismatchItem {
  componentId: string;
  start: [number, number];
  end: [number, number];
  lengthMm: number;
  nearestAcceptedWallId: string;
  sourceEvidenceIds: string[];
  probableCause: string;
  roomContext: string;
}

export interface ComponentRankingReport {
  topMissingSourceComponents: ComponentMismatchItem[];
  topFalseReconstructedComponents: ComponentMismatchItem[];
}

export interface LocalCorrectionRecord {
  correctionId: string;
  sourceEdgeId: string;
  oldClassification: string;
  newClassification: string;
  geometricReason: string;
  iouBefore: number;
  iouAfter: number;
  missingWallLengthMmBefore: number;
  missingWallLengthMmAfter: number;
  falseWallLengthMmBefore: number;
  falseWallLengthMmAfter: number;
  accepted: boolean;
}

export interface LocalCorrectionAcceptance {
  minimumIoUImprovement: number;             // e.g. 0.00005
  maximumFalseWallLengthIncreaseMm: number;  // e.g. 0
  mustPreserveOpenBoundaryCount: boolean;    // true
  mustPreserveSelfIntersectionCount: boolean;// true
  mustPreserveRoomIoU: boolean;              // true
  mustPreserveOpeningHosts: boolean;         // true
}

export const DEFAULT_CORRECTION_ACCEPTANCE_POLICY: LocalCorrectionAcceptance = {
  minimumIoUImprovement: 0.00005,
  maximumFalseWallLengthIncreaseMm: 0.0,
  mustPreserveOpenBoundaryCount: true,
  mustPreserveSelfIntersectionCount: true,
  mustPreserveRoomIoU: true,
  mustPreserveOpeningHosts: true,
};

export type ProposalType =
  | 'SNAP_T_JUNCTION'
  | 'TRANSLATE_LOCAL_CENTERLINE'
  | 'CLOSE_SHORT_NON_OPENING_GAP'
  | 'REMOVE_FALSE_WALL_SEGMENT'
  | 'RESTORE_MISSING_WALL_SEGMENT'
  | 'COLLAPSE_DUPLICATE_WALL';

export interface SnapTJunctionPayload {
  stemWallId: string;
  hostWallId: string;
  oldEndpointMm: [number, number];
  proposedEndpointMm: [number, number];
  displacementMm: number;
  evidenceIds: string[];
  affectedMismatchComponentIds?: string[];
  projectedHostPointMm?: [number, number];
  stemAngleDegrees?: number;
  hostAngleDegrees?: number;
  intersectionAngleDegrees?: number;
}

export interface TranslateLocalCenterlinePayload {
  wallId: string;
  oldStartMm: [number, number];
  oldEndMm: [number, number];
  newStartMm: [number, number];
  newEndMm: [number, number];
  translationMm: number;
  facePairIds: string[];
}

export interface CloseShortNonOpeningGapPayload {
  wallAId: string;
  wallBId: string;
  gapStartMm: [number, number];
  gapEndMm: [number, number];
  gapLengthMm: number;
  sourceEvidenceIds: string[];
}

export interface RemoveFalseWallSegmentPayload {
  wallId: string;
  unsupportedLengthMm: number;
  nearestSourceDistanceMm: number;
  relatedEvidenceIds: string[];
}

export interface RestoreMissingWallSegmentPayload {
  sourceComponentId: string;
  proposedStartMm: [number, number];
  proposedEndMm: [number, number];
  proposedThicknessMm: number;
  pairedFaceIds: string[];
}

export interface CollapseDuplicateWallPayload {
  retainedWallId: string;
  removedWallId: string;
  separationMm: number;
  overlapRatio: number;
  retainedEvidenceScore: number;
  removedEvidenceScore: number;
}

export interface LocalCorrectionProposal {
  proposalId: string;
  type: ProposalType;
  targetComponentId: string;
  payload:
    | SnapTJunctionPayload
    | TranslateLocalCenterlinePayload
    | CloseShortNonOpeningGapPayload
    | RemoveFalseWallSegmentPayload
    | RestoreMissingWallSegmentPayload
    | CollapseDuplicateWallPayload;
  confidenceScore: number;
}

export interface ComponentProposalDiagnostic {
  componentId: string;
  type: 'missing' | 'false';
  startMm: [number, number];
  endMm: [number, number];
  lengthMm: number;
  roomContext: string;
  nearestWallId: string;
  relatedEvidenceIds: string[];
  probableCause: string;
  generatedProposalIds: string[];
  noProposalReason?: string;
}

export interface OpeningHostProof {
  id: string;
  parentId: string;
  wallId: string;
  hostStart: [number, number];
  hostEnd: [number, number];
  projectedParam: number;
  position: [number, number];
  width: number;
  height: number;
  sillHeight?: number;
  sourceEvidenceIds: string[];
  hostValidationResult: 'VALID' | 'OUT_OF_BOUNDS' | 'UNHOSTED' | 'OVERLAPPING';
}

export interface OpeningHostReport {
  validWallIdReferences: number;
  invalidWallIdReferences: number;
  openingsBeyondHostEndpoints: number;
  overlappingOpenings: number;
  unhostedOpenings: number;
  proofs: OpeningHostProof[];
  isValid: boolean;
}

export interface WallGraphItem {
  id: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  thickness: number;
  height: number;
}

export interface WallGraph {
  walls: WallGraphItem[];
  revision: number;
}

export interface RoomGraph {
  rooms: { id: string; polygon: [number, number][]; holes: [number, number][][] }[];
  revision: number;
}

export interface RevisionState {
  wallGraphRevision: number;
  wallPolygonRevision: number;
  roomGraphRevision: number;
  openingHostRevision: number;
  regressionInputRevision: number;
}

export interface CorrectionLedgerEntryMetrics {
  wallPolygonIoU: number;
  missingWallLengthMm: number;
  falseWallLengthMm: number;
  sourceToReconstructionP95Mm: number;
  reconstructionToSourceP95Mm: number;
  roomIoU: number;
  openBoundaries: number;
  selfIntersectingRooms: number;
  validDoorHosts: number;
  validWindowHosts: number;
}

export interface MultiPolygonEvidence {
  outerRings: [number, number][][];
  holes: [number, number][][][];
  winding: ('CW' | 'CCW')[];
  validity: 'VALID' | 'INVALID';
  componentCount: number;
  totalAreaM2: number;
  canonicalHash: string;
}

export interface LedgerReconciliationRecord {
  reconciliationStatus: 'CONFIRMED' | 'CORRECTED' | 'INVALIDATED' | 'UNRELATED';
  recomputedMismatchComponentIds: string[];
  spatialAssociationDistanceMm: number;
  provenanceValid: boolean;
  notes: string;
}

export interface CorrectionLedgerEntry {
  correctionId: string;
  proposalType: ProposalType;
  ruleId: string;
  mismatchComponentIds: string[];
  graphDefectIds: string[];
  affectedWallIds: string[];
  proposedWallIds: string[];
  affectedEvidenceIds: string[];
  geometryRevisionBefore: number;
  geometryRevisionAfter: number;
  before: CorrectionLedgerEntryMetrics;
  after: CorrectionLedgerEntryMetrics;
  accepted: boolean;
  rollbackPerformed: boolean;
  status: 'ACCEPTED' | 'REJECTED' | 'SKIPPED';
  rejectionReason?: string;
  skipReason?: string;
  reconciliationRecord?: LedgerReconciliationRecord;
}

export type ConvergenceStopReason =
  | 'FINAL_TIER_REACHED'
  | 'NO_MISMATCH_COMPONENTS'
  | 'NO_PROPOSALS_GENERATED'
  | 'NO_PROPOSALS_ACCEPTED'
  | 'MAXIMUM_ITERATIONS_REACHED'
  | 'TOPOLOGY_REGRESSION'
  | 'OPENING_HOST_REGRESSION'
  | 'INVALID_REVISION_STATE';

export interface ConvergenceOptions {
  maximumIterations?: number; // default 20
  minimumIoUImprovement?: number; // default 0.00005
  maximumFalseWallLengthIncreaseMm?: number; // default 0
  preserveRoomTopology?: boolean; // true
  preserveOpeningHosts?: boolean; // true
}

export interface ConvergenceSummary {
  iterations: number;
  proposedCorrectionCount: number;
  evaluatedCorrectionCount: number;
  acceptedCorrectionCount: number;
  rejectedCorrectionCount: number;
  skippedCorrectionCount: number;
  rollbackCount: number;
  stopReason: ConvergenceStopReason;
  wallIoUBefore: number;
  wallIoUAfter: number;
  missingWallLengthBeforeMm: number;
  missingWallLengthAfterMm: number;
  falseWallLengthBeforeMm: number;
  falseWallLengthAfterMm: number;
  finalTier: RegressionTier;
  exportAllowed: boolean;
  ledger: CorrectionLedgerEntry[];
}

export interface RawRegressionEvidence {
  sourceWallAreaM2: number;
  reconstructedWallAreaM2: number;
  intersectionAreaM2: number;
  unionAreaM2: number;
  boundarySampleCount: number;
  sampleSpacingMm: number;
  roomMatchingPairsCount: number;
  unmatchedSourceComponentsCount: number;
  unmatchedReconstructedComponentsCount: number;
  sourceToReconstruction: DirectionalBoundaryMetrics;
  reconstructionToSource: DirectionalBoundaryMetrics;
  missingWallLengthMm: number;
  falseWallLengthMm: number;
  missingComponentCount: number;
  falseComponentCount: number;
  componentRanking: ComponentRankingReport;
  openingHostReport: OpeningHostReport;
}

export interface RegressionThresholds {
  wallPolygonIoU: number;            // 0.98
  boundaryDistanceP95Mm: number;     // 15.0
  maxBoundaryDeviationMm: number;   // 30.0
  roomPolygonOverlapIoU: number;     // 0.98
  roomCentroidErrorMm: number;       // 20.0
  roomAreaErrorPercent: number;      // 1.0
  openRoomBoundariesCount: number;   // 0
  selfIntersectingRoomsCount: number; // 0
  unhostedDoorsCount: number;        // 0
  unhostedWindowsCount: number;      // 0
}

export const DEFAULT_FINAL_THRESHOLDS: RegressionThresholds = {
  wallPolygonIoU: 0.98,
  boundaryDistanceP95Mm: 15.0,
  maxBoundaryDeviationMm: 30.0,
  roomPolygonOverlapIoU: 0.98,
  roomCentroidErrorMm: 20.0,
  roomAreaErrorPercent: 1.0,
  openRoomBoundariesCount: 0,
  selfIntersectingRoomsCount: 0,
  unhostedDoorsCount: 0,
  unhostedWindowsCount: 0,
};

export interface FailedGate {
  metric: string;
  actual: any;
  required: number;
}

export type RegressionTier = 'diagnostic' | 'reviewable' | 'final';
export type RegressionStatus = 'SUCCESS' | 'REVIEW_REQUIRED' | 'FAILED';

export interface TierEvaluationResult {
  tier: RegressionTier;
  status: RegressionStatus;
  allFinalGatesPassed: boolean;
  exportAllowed: boolean;
  failedGates: FailedGate[];
}

export interface RegressionMetrics {
  wallPolygonIoU: number;
  boundaryDistanceP95Mm: number;
  maxBoundaryDeviationMm: number;
  roomPolygonOverlapIoU: number;
  roomCentroidErrorMm: number;
  roomAreaErrorPercent: number;
  openRoomBoundariesCount: number;
  selfIntersectingRoomsCount: number;
  unhostedDoorsCount: number;
  unhostedWindowsCount: number;
  detectedDoorsCount: number;
  detectedWindowsCount: number;
  rawEvidence: RawRegressionEvidence;
  tierEvaluation: TierEvaluationResult;
}
