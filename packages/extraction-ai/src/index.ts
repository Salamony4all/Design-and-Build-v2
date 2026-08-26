// design-build-extraction-ai
// Clean migration of the ACTIVE legacy Gemini Multipass pipeline
// (apps/editor gemini-pipeline.ts + ChatBox.runBimPipeline topology), behind a
// neutral provider interface. Boundary rules (§8):
//   - NO React, ChatPanel, Pascal, useScene, Three.js, Viewer imports.
//   - NO imports from apps/editor (dependency-boundary test enforced).
//   - Never mutates Pascal; returns neutral results + typed events only.

export {
  getShellPrompt,
  getCorePrompt,
  getFitoutPrompt,
  getFFEPrompt,
  CATALOG_SLUGS,
  MATERIALS,
} from './prompts';
export { getWindowDetectionPromptV4, WINDOW_DETECTION_V4_VERSION, WINDOW_V4_CATALOG_SLUGS } from './prompts-window-v4';
export { AI_WINDOWS_V4, AI_FURNITURE_V4 } from './multipass-controller';

export {
  resolvePascalFurniture,
  CANONICAL_FURNITURE_FAMILIES,
  type CanonicalFurnitureFamily,
  type FurnitureCategory,
  type FurnitureResolutionResult,
} from './pascal-furniture-catalog';
export {
  resolveFurnitureDimensions,
  type DimensionSource as LegacyDimensionSource,
  type ResolvedFurnitureDimensions,
} from './furniture-dimensions';
export {
  normalizeOpenings,
  resolveOpeningType,
  evaluateHostCandidates,
  type CanonicalOpeningType,
  type OpeningOutcome,
  type ParsedOpening,
  type NormalizedWall,
  type OpeningNormalizerInput,
  type OpeningTypeResolution,
  type HostCandidate,
  type OpeningDiagnostic,
  type OpeningNormalizerResult,
} from './opening-normalizer';
export {
  repairWallTopology as repairWallTopologyLegacy,
  deduplicateWalls,
  DEFAULT_WALL_TOPOLOGY_CONFIG,
  type JunctionType,
  type WallTopologyConfig,
  type WallRepairRecord,
  type WallTopologyAnalysisResult,
} from './wall-snapping';
export {
  compileStructuralContext,
  type CompactStructuralContext,
} from './phase-context';
export { sanitizeFurniture } from './furniture-spatial';
export { getFurnitureDetectionPrompt, getFurnitureVerificationPrompt } from './prompts-furniture-v2';

export { StructuralSchema, type StructuralSchemaType } from './schema';
export { parseAIResponse } from './parser';

export {
  type ModelRequest,
  type ModelResponse,
  type AiModelRuntime,
  type ProviderRuntime,
  AiConfigurationError,
  isGoogleEndpoint,
  GOOGLE_MODEL_MAP,
  GeminiRequestAdapter,
  OpenAiCompatibleRequestAdapter,
  createModelRuntime,
} from './model-runtime';

export {
  type PassId,
  type MultipassRequest,
  type MultipassEvent,
  type MultipassEventType,
  type PassRecord,
  type MultipassResult,
  MultipassCancelledError,
  runMultipass,
} from './multipass-controller';

export {
  adaptMultipassResult,
  type AiAdapterOptions,
  AI_FURNITURE_SPATIAL_V2,
  AI_PHASE_CONTEXT_V2,
} from './result-adapter';

// ── Coordinate Validation V2 (Observation-Only) ──
export {
  validateAiCoordinates,
  AI_COORDINATE_VALIDATION_V2,
  type DocumentFrameLineage,
  type SourceSpaceType,
  type ScaleBasisType,
  type SourceOriginType,
  type SourceYAxisType,
  type WorldGroundAxisType,
  type CoordinateFindingCode,
  type CoordinateValidationFinding,
  type CoordinateValidationReviewRecord,
  type EntityCandidateForValidation,
  type PhaseFrameObservation,
  type CoordinateValidationInput,
  type CoordinateValidationOptions,
  type CoordinateValidationResult,
} from './coordinate-validator';

// ── Scene Diffing V2 (User-Edit Protection) ──
export {
  computeAiSceneDiff,
  AI_SCENE_DIFF_V2,
  type DiffableNode,
  type UserEditConflictRecord,
  type SceneDiffPlan,
  type SceneDiffInput,
} from './scene-diff';

// ── Staggered Installation V2 (Frame Yielding & Invalidation Batching) ──
export {
  planStaggeredInstallation,
  sortNodesTopologically,
  batchDirtyInvalidations,
  AI_STAGGERED_INSTALL_V2,
  NODE_TYPE_INSTALL_ORDER,
  type StaggeredBatchOptions,
  type NodeBatch,
  type StaggeredInstallationPlan,
  type InvalidationBatchResult,
} from './staggered-installer';

// ── Opening Intelligence V2 (Aliases & Adaptive Hosting) ──
export {
  resolveOpeningSubtype,
  scoreAdaptiveWallHost,
  AI_OPENING_ALIASES_V2,
  AI_OPENING_HOSTING_V2,
  AI_OPENING_GAP_EVIDENCE_V2,
  type DoorSubtype,
  type WindowSubtype,
  type WallCandidate,
  type GapEvidence,
  type HostScoringInput,
  type HostScoringResult,
} from './opening-intelligence';

// ── Wall Topology V2 (Conservative Junction Repair) ──
export {
  repairWallTopology,
  AI_WALL_TOPOLOGY_V2,
  type TopologyWall,
  type WallTopologyOptions,
  type WallTopologyResult,
} from './wall-topology';

// ── Room & Furniture Intelligence V2 (Containment, 7-Tier Dimension, Repetition) ──
export {
  resolveDimensionHierarchy,
  validateRoomContainment,
  detectRepetitionConsensus,
  isPointInPolygon,
  AI_ROOM_CONTEXT_V2,
  AI_FURNITURE_CATALOG_V2,
  AI_FURNITURE_REPETITION_V2,
  AI_JOINERY_CONTEXT_V2,
  DIMENSION_PRIORITY_WEIGHT,
  type RoomCategory,
  type RoomZone,
  type DimensionSource,
  type FurnitureDimensionInput,
  type ResolvedDimensions,
  type FurnitureInstance,
  type ContainmentValidationResult,
  type RepetitionGroup,
} from './room-furniture-intelligence';

// ── Furniture spatial decision (V2 + V3) ──
export {
  sanitizeFurnitureV3,
  assignZone,
  type FurnitureLike,
  type FurnitureDecision,
  type FurnitureAudit,
  type FurnitureCandidate,
  type FurnitureV3Result,
} from './furniture-spatial';

// ── Progressive Pure AI V3 (staged build scaffold) ──
export {
  type BuildStage,
  type ProgressiveBuildEvent,
  type ProgressiveEventClass,
  type FurnitureEvidence,
  validateEvent,
} from './progressive-types';
export { runProgressivePureAI, type ProgressiveRequest } from './progressive-controller';
export {
  FurniturePassSchema,
  FurnitureEvidenceSchema,
} from './schema-furniture-v3';
// Furniture V4 (strict multipass) — versioned, separate from V3 (rollback retained).
export {
  Pass1Schema, Pass2Schema, Pass3Schema, Pass4Schema, Pass5Schema, Pass6Schema,
  FurnitureCandidateSchema, ClassificationSchema, RepetitionPatternSchema,
  JoinerySchema, OrientationSchema, VerificationSchema, FurnitureRecordV4Schema,
  VISUAL_CLASS, FIXED_JOINERY, PASCAL_FAMILY,
  type FurnitureCandidateV4, type FurnitureRecordV4,
} from './schema-furniture-v4';
export {
  FURNITURE_CANDIDATE_DETECTION_V4, FURNITURE_CLASSIFICATION_V4, FURNITURE_PATTERN_V4,
  FURNITURE_JOINERY_V4, FURNITURE_VERIFICATION_ORIENTATION_V4, FURNITURE_VERIFICATION_V4,
} from './prompts-furniture-v4-constants';
export { FURNITURE_PROMPTS_V4, getFurniturePromptV4 } from './prompts-furniture-v4';
export {
  structuralStagesFromResult,
  makeEvent,
  type SourceFrame,
} from './structural-adapter';
