// Clean Window Detector Contracts - R1.3 corrected.
// Blind to WA labels, target counts, manual bounds, and prior verdicts.

export type FinalDecision = 'RETAIN' | 'REVIEW' | 'REJECT';
export type HostStatus = 'UNIQUE_HOST' | 'AMBIGUOUS_HOST_REVIEW' | 'NO_HOST';

export interface ExclusionRecord {
  segmentId: string;
  commandType: string;
  bounds: [number, number, number, number];
  reason: string;
  reversibleState: 'PROVISIONALLY_EXCLUDED' | 'PERMANENTLY_EXCLUDED' | 'ACCEPTED';
}

export interface GateTransition {
  state: 'GENERATED' | 'HOSTED' | 'INTERVAL_VALID' | 'TOPOLOGY_SUPPORTED' | 'DEDUPLICATED' | 'REVIEWED' | 'FINALIZED';
  verdict: 'ACCEPTED' | 'REVIEW' | 'REJECTED' | 'UNRESOLVED';
  timestamp: string;
  reason: string;
}

export interface IntervalValidationResult {
  wallLength: number;
  rawIntervalFrom: number;
  rawIntervalTo: number;
  clippedIntervalFrom: number;
  clippedIntervalTo: number;
  endpointTolerance: number;
  coverageFraction: number;
  intervalStatus:
  | 'VALID_INSIDE_FINITE_WALL'
  | 'VALID_WITH_ENDPOINT_TOLERANCE'
  | 'EXTENDS_BEYOND_WALL'
  | 'INVALID_REVERSED_INTERVAL'
  | 'INVALID_ZERO_WIDTH'
  | 'AMBIGUOUS_AT_JUNCTION';
}

export interface FrameLineAudit {
  totalSourceLength: number;
  lengthInsideCandidateInterval: number;
  extensionBefore: number;
  extensionAfter: number;
  hostWallCoverageFraction: number;
  finalRole:
  | 'LOCAL_FRAME_FEATURE'
  | 'CONTINUOUS_WALL_FACE'
  | 'POSSIBLE_JAMB'
  | 'POSSIBLE_PANEL_DIVIDER'
  | 'SHORT_MARK_OR_TICK'
  | 'UNRESOLVED';
}

export interface JambPairRecord {
  leftJambFeatureId: string | null;
  rightJambFeatureId: string | null;
  separation: number;
  endpointErrors: [number, number];
  angleErrors: [number, number];
  styleCompatibility: boolean;
  pairVerdict: 'VALID_JAMB_PAIR' | 'INVALID_JAMB_PAIR' | 'NO_JAMB_PAIR';
}

export interface WallFaceGapRecord {
  leftWallFaceFeatureId: string | null;
  rightWallFaceFeatureId: string | null;
  leftEndpointError: number;
  rightEndpointError: number;
  gapWidth: number;
  verdict: 'VALID_SOURCE_WALL_FACE_GAP' | 'NO_SOURCE_WALL_FACE_GAP';
}

export interface FrameBayRecord {
  supportingFeatureIds: string[];
  verdict: 'VERIFIED_FRAME_BAY' | 'NO_VERIFIED_FRAME_BAY';
}

export interface HostAlternative {
  physicalWallId: string;
  candidateId: string;
  sharedSourceSegmentCount: number;
  boundsOverlapFraction: number;
  wallNormalOffsetScore: number;
}

export interface HostCompetitionRecord {
  status: HostStatus;
  selectedPhysicalWallId: string | null;
  consideredHosts: HostAlternative[];
  selectionMargin: number | null;
  reason: string;
}

export interface MergeEvidenceRecord {
  constituentCandidateIds: string[];
  constituentDecisions: FinalDecision[];
  allPositiveEvidence: string[];
  allNegativeEvidence: string[];
  fatalConflictCandidateIds: string[];
  conflictRelationship:
  | 'SAME_SOURCE_GEOMETRY'
  | 'SPATIALLY_ADJACENT_UNRELATED'
  | 'PANEL_OR_FRAME_FRAGMENT'
  | 'COMPETING_HOST_ASSIGNMENT'
  | 'UNRESOLVED';
  mergeResolution: 'SAFE_MERGE' | 'KEEP_SEPARATE' | 'REVIEW_REQUIRED' | 'REJECT_MERGE';
  finalDecision: FinalDecision;
  finalDecisionReasons: string[];
}

export interface AutomaticFeature {
  featureId: string;
  sourceOperationIds: string[];
  sourceSubpathIds: string[];
  sourceSegmentIds: string[];
  geometry: {
    commandType: string;
    uStart: number;
    uEnd: number;
    vStart: number;
    vEnd: number;
    undirectedAngleDeg: number;
    wallNormalOffsetPx: number;
    lengthPx: number;
  };
  featureType: 'LINE_SEGMENT' | 'CURVE_SEGMENT' | 'CLOSE_PATH_SEGMENT' | 'UNKNOWN';
  derivationRule: string;
  confidence: number;
}

export interface AutomaticCandidate {
  candidateId: string;
  generatedBounds: [number, number, number, number];
  sourceFeatureIds: string[];
  sourceOperationIds: string[];
  sourceSubpathIds: string[];
  sourceSegmentIds: string[];
  topologyClass: 'PARALLEL_FRAME_LINES' | 'WALL_GAP_WITH_GLAZING' | 'SINGLE_FRAME_SYMBOL' | 'UNKNOWN';
  physicalWallId: string | null;
  hostAmbiguity: 'UNIQUE' | 'AMBIGUOUS' | 'NO_HOST';
  hostCompetition?: HostCompetitionRecord;
  finiteWallInterval: { start: number; end: number } | null;
  displayClippedInterval?: { start: number; end: number } | null;
  width: number;
  widthMm: number;
  panelCount: number | null;
  confidence: number;
  positiveEvidence: string[];
  negativeEvidence: string[];
  gateHistory: GateTransition[];
  reviewerRecommendation: 'PROMOTE' | 'REVIEW' | 'REJECT';
  reviewerObservation: string;
  extractionVerdict: 'ACCEPTED' | 'REVIEW' | 'REJECTED';
  finalDecision?: FinalDecision;
  finalDecisionReasons?: string[];
  candidateOrigin: 'AUTOMATIC_SOURCE_DERIVATION';
  manualOverride: boolean;
  automaticPromotionAllowed: boolean;
  intervalAudit?: IntervalValidationResult;
  frameLineAudits?: FrameLineAudit[];
  jambAudit?: JambPairRecord;
  wallFaceGapAudit?: WallFaceGapRecord;
  frameBayAudit?: FrameBayRecord;
  hatchPatternDetails?: string;
  mergeEvidence?: MergeEvidenceRecord;
}

export interface PhysicalWindowAssembly {
  physicalWindowHypothesisId: string;
  physicalWallId: string;
  finiteOpeningInterval: { start: number; end: number };
  physicalWidth: number;
  physicalWidthMm: number;
  panelCount: number | null;
  candidateIdsMerged: string[];
  sourceFeatureIds: string[];
  externalAnchorIds: string[];
  evidenceStatus?: 'BLIND_PHYSICAL_OPENING_HYPOTHESIS';
}

export interface DuplicateCluster {
  clusterId: string;
  candidateIds: string[];
  physicalWallId: string;
  mergedInterval: { start: number; end: number };
  selectedRepresentative: string;
  mergedSourceFeatureIds: string[];
  panelCount: number | null;
  mergeReason: string;
  mergeEvidence?: MergeEvidenceRecord;
}
