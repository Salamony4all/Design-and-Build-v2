// Wall-completion processor — shared types (MASTER CHECKPOINT §3-§14).
//
// Runs AFTER the trusted 70-wall extractor and BEFORE Pascal WallNode creation.
// Consumes already-captured vectors (never reopens the PDF, never recaptures).
// Produces a separate finalized wall-topology result that completes only
// source-proven wall boundaries — never ColumnNodes, never furniture, never
// protected openings, never corridor crossings.

export interface Vec2 {
  x: number;
  y: number;
}

export interface AcceptedWall {
  physicalWallId: string;
  startM: Vec2;
  endM: Vec2;
  thicknessM: number;
  /** Optional: the source segment ids the trusted detector already owns. */
  sourceSegmentIds?: string[];
}

export interface RawSegment {
  id: string;
  a: Vec2;
  b: Vec2;
  sourceOperationId?: string;
}

export interface ProtectedOpening {
  openingId: string;
  openingType: 'WINDOW' | 'DOOR' | 'CIRCULATION' | 'STAIR';
  selectedPhysicalWallId?: string;
  worldStart: Vec2;
  worldEnd: Vec2;
  worldCentre: Vec2;
  widthM: number;
  confidence: 'VERIFIED' | 'PROBABLE' | 'CIRCULATION' | 'UNRESOLVED';
  protectionStatus: 'VERIFIED_OPENING' | 'PROBABLE_OPENING' | 'CIRCULATION_OPENING' | 'UNRESOLVED';
}

/** §4 source-ownership registry result. */
export interface SourceOwnershipRegistry {
  totalSourceVectors: number;
  trustedWallClaimIds: string[];
  windowClaimIds: string[];
  doorClaimIds: string[];
  annotationClaimIds: string[];
  slabClaimIds: string[];
  remainingUnclaimedIds: string[];
  duplicateClaimIds: string[];
  missingClaimIds: string[];
}

/** §6 per face-pair evaluation. */
export interface FacePair {
  faceAId: string;
  faceBId: string;
  faceAStart: Vec2;
  faceAEnd: Vec2;
  faceBStart: Vec2;
  faceBEnd: Vec2;
  faceALengthM: number;
  faceBLengthM: number;
  angleDifferenceRad: number;
  perpendicularSeparationM: number;
  projectedOverlapM: number;
  overlapRatio: number;
  endpointCompatibility: number; // 0..1
  thicknessConsistency: number; // 0..1
  hatchEvidence: boolean;
  pocheEvidence: boolean;
  sourceLineageCompatibility: number; // 0..1
  connectedExistingWallIds: string[];
  nearbyFurnitureFamily: boolean;
  nearbyDoorEvidence: boolean;
  nearbyWindowEvidence: boolean;
  candidateClassification: CandidateClass;
  confidence: number; // 0..1
}

export type CandidateClass =
  | 'MISSING_STRUCTURAL_WALL'
  | 'MISSING_PARTITION'
  | 'WALL_FACE_CONTINUATION'
  | 'SOURCE_PROVEN_ENDPOINT_EXTENSION'
  | 'VERIFIED_DOOR_OPENING'
  | 'PROBABLE_DOOR_OPENING'
  | 'VERIFIED_WINDOW_OPENING'
  | 'CORRIDOR_OR_CIRCULATION_OPENING'
  | 'FURNITURE_GEOMETRY'
  | 'SANITARY_GEOMETRY'
  | 'ANNOTATION_GEOMETRY'
  | 'WALL_JUNCTION'
  | 'AMBIGUOUS';

/** §7 derived centreline. */
export interface CompletionWall {
  completionWallId: string; // wc_<hash>
  classification: CandidateClass;
  faceA: string;
  faceB: string;
  centrelineStartProjectM: Vec2;
  centrelineEndProjectM: Vec2;
  lengthM: number;
  thicknessM: number;
  direction: Vec2;
  sourceSegmentIds: string[];
  sourceOperationIds: string[];
  connectedWallIds: string[];
  endpointJunctions: string[];
  sourceEvidence: string;
  verdict: 'ACCEPT' | 'REVIEW';
}

/** §8 endpoint undershoot evaluation. */
export interface EndpointExtension {
  physicalWallId: string;
  endpointSide: 'A' | 'B';
  originalEndpoint: Vec2;
  proposedFinalEndpoint: Vec2;
  extensionLengthM: number;
  thicknessCompatibility: number;
  hatchContinuation: boolean;
  nearestJunction: string | null;
  openingConflict: boolean;
  furnitureConflict: boolean;
  classification: CandidateClass;
  confidence: number;
}

/** §11 gap ledger entry. */
export interface GapLedgerEntry {
  gapId: string;
  relatedWallIds: string[];
  gapStartProjectM: Vec2;
  gapEndProjectM: Vec2;
  gapWidthM: number;
  faceAContinues: boolean;
  faceBContinues: boolean;
  hatchContinues: boolean;
  thicknessCompatible: boolean;
  connectedJunction: boolean;
  doorOverlap: boolean;
  windowOverlap: boolean;
  probableDoorOverlap: boolean;
  circulationConflict: boolean;
  furnitureConflict: boolean;
  finalClassification: GapClass;
  decisionReason: string;
}

export type GapClass =
  | 'WALL_FRAGMENTATION_GAP'
  | 'MISSING_INDEPENDENT_PARTITION'
  | 'SOURCE_PROVEN_ENDPOINT_UNDERSHOOT'
  | 'VERIFIED_DOOR_OPENING'
  | 'PROBABLE_DOOR_OPENING'
  | 'VERIFIED_WINDOW_OPENING'
  | 'CORRIDOR_OPENING'
  | 'STAIR_OPENING'
  | 'INTENTIONAL_ROOM_OPENING'
  | 'WALL_JUNCTION'
  | 'FURNITURE_GEOMETRY'
  | 'AMBIGUOUS';

/** §13 finalized wall network. */
export interface FinalizedWallNetwork {
  originalWalls: AcceptedWall[];
  completionWalls: CompletionWall[];
  partitionCompletions: CompletionWall[];
  endpointExtensions: EndpointExtension[];
  junctions: string[];
  protectedOpenings: ProtectedOpening[];
  finalizedPhysicalWalls: AcceptedWall[];
  rawWallCount: number;
  finalizedWallCount: number;
  finalizedTopologyHash: string;
  wallCompletionHash: string;
  rawGeometryHash: string;
  rawEvidenceHash: string;
}

export interface WallCompletionConfig {
  /** Acceptable wall thickness band (m) for a valid face pair. */
  minSeparationM: number;
  maxSeparationM: number;
  minFaceLengthM: number;
  maxOverlapRatio: number; // required overlap ratio threshold
  maxAngleDiffRad: number;
  maxAutoExtensionM: number;
  joinTolM: number; // endpoint join tolerance (open-endpoint detection)
  scaleMmPerPt: number; // PDF points -> mm scale (for unit-correct opening checks)
  cellSizeM: number;
}

export const DEFAULT_WALL_COMPLETION_CONFIG: WallCompletionConfig = {
  minSeparationM: 0.05,
  maxSeparationM: 0.30,
  minFaceLengthM: 0.80,
  maxOverlapRatio: 0.60,
  maxAngleDiffRad: (5 * Math.PI) / 180,
  maxAutoExtensionM: 1.50,
  joinTolM: 0.35,
  scaleMmPerPt: 1,
  cellSizeM: 1.0,
};
