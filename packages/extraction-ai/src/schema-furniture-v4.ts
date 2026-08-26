/**
 * Furniture V4 — strict runtime schemas for the progressive multipass furniture
 * pipeline (Requirement: FURNITURE_PROGRESSIVE_MULTIPASS_V4_READY_FOR_LIVE_EVALUATION).
 *
 * Design rules (from directive):
 *  - Every pass returns strict JSON validated by the matching schema.
 *  - Candidate IDENTITY is preserved: every visible repeated object gets its own
 *    candidate ID. Six beds => six candidates. Never collapse by family.
 *  - ORIENTATION convention: rotationDeg is measured COUNTER-CLOCKWISE from
 *    positive project X in the bottom-left-origin project coordinate frame.
 *    The AI reports the source-image long axis; asset intrinsics are applied later.
 *  - REPETITION: patterns preserve individual candidate identities; do NOT invent
 *    extra objects merely to complete a pattern.
 *  - JOINERY: continuous cabinet runs stay runs; do NOT fragment into tiny lockers;
 *    bedside tables are NOT cabinet runs.
 *  - VERIFICATION: uncertain => REVIEW; invalid => REJECT; confidence alone is
 *    never sufficient to override incompatible geometry.
 *
 * Rejection (returns parse failure => dropped at adapter boundary):
 *  malformed JSON, duplicate/missing candidate IDs, unsupported family IDs,
 *  NaN/Infinity, zero/negative dimensions, invalid coordinates/confidence/angle,
 *  unknown fields under .strict().
 *
 * V3 (schema-furniture-v3.ts) is retained as rollback and is NOT modified here.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------
const BBoxPx = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const Conf = z.number().min(0).max(1).finite();
const Angle = z.number().min(-360).max(360).finite(); // degrees CCW from +X
const M = z.number().positive().max(50).finite(); // metres
const Coord = z.number().finite(); // project coordinate (can be 0 / negative)

export const VISUAL_CLASS = z.enum([
  'BED_LIKE', 'CHAIR_LIKE', 'TABLE_LIKE', 'SOFA_LIKE', 'STORAGE_LIKE',
  'CABINET_RUN_LIKE', 'SANITARY_FIXTURE_LIKE', 'APPLIANCE_LIKE', 'UNKNOWN',
]);

export const FIXED_JOINERY = z.enum([
  'CONTINUOUS_CABINET_RUN', 'CONNECTED_CABINET_MODULES', 'INDIVIDUAL_LOCKER',
  'BEDSIDE_TABLE', 'WARDROBE', 'KITCHEN_CABINET', 'COUNTER', 'SHELF',
  'UNKNOWN_FIXED_JOINERY',
]);

export const PASCAL_FAMILY = z.enum([
  'bed', 'bedside_table', 'office_chair', 'dining_chair', 'desk', 'table',
  'sofa', 'wardrobe', 'locker', 'cabinet_run', 'cabinet_module', 'fixed_joinery',
  'sanitary', 'appliance', 'unknown',
]);

// ---------------------------------------------------------------------------
// PASS 1: candidate detection (no family selected yet)
// ---------------------------------------------------------------------------
export const FurnitureCandidateSchema = z.object({
  candidateId: z.string().min(1),
  sourceBoxPx: BBoxPx,
  contextBoxPx: BBoxPx.optional(),
  centreM: z.tuple([Coord, Coord]),
  widthM: M,
  depthM: M,
  longAxisDeg: Angle,
  visualClass: VISUAL_CLASS,
  confidence: Conf,
  evidence: z.string().min(1),
}).strict();
export const Pass1Schema = z.object({
  promptId: z.literal('FURNITURE_CANDIDATE_DETECTION_V4'),
  version: z.literal('4'),
  candidates: z.array(FurnitureCandidateSchema).refine(
    (cs) => new Set(cs.map((c) => c.candidateId)).size === cs.length,
    { message: 'duplicate candidateId' },
  ),
}).strict();

// ---------------------------------------------------------------------------
// PASS 2: classification
// ---------------------------------------------------------------------------
export const ClassMatchSchema = z.object({
  familyId: PASCAL_FAMILY,
  confidence: Conf,
  evidence: z.string().min(1),
}).strict();
export const ClassificationSchema = z.object({
  candidateId: z.string().min(1),
  matches: z.array(ClassMatchSchema).min(1),
  selectedFamilyId: PASCAL_FAMILY,
  decision: z.enum(['ACCEPT', 'REVIEW', 'REJECT_NOT_FURNITURE']),
  reviewReason: z.string().optional(),
}).strict();
export const Pass2Schema = z.object({
  promptId: z.literal('FURNITURE_CLASSIFICATION_V4'),
  version: z.literal('4'),
  classifications: z.array(ClassificationSchema),
}).strict();

// ---------------------------------------------------------------------------
// PASS 3: repetition analysis
// ---------------------------------------------------------------------------
export const RepetitionPatternSchema = z.object({
  patternId: z.string().min(1),
  candidateIds: z.array(z.string().min(1)),
  repeatedCount: z.number().int().nonnegative(),
  commonVisualClass: VISUAL_CLASS.optional(),
  commonDimensionsM: z.tuple([M, M]).optional(),
  commonAspectRatio: z.number().positive().finite().optional(),
  commonLongAxisDeg: Angle.optional(),
  commonSpacingM: z.number().positive().finite().optional(),
  familyConsistency: z.boolean(),
  outlierIds: z.array(z.string().min(1)),
  confidence: Conf,
}).strict();
export const Pass3Schema = z.object({
  promptId: z.literal('FURNITURE_PATTERN_V4'),
  version: z.literal('4'),
  patterns: z.array(RepetitionPatternSchema),
}).strict();

// ---------------------------------------------------------------------------
// PASS 4: fixed joinery
// ---------------------------------------------------------------------------
export const JoinerySchema = z.object({
  candidateId: z.string().min(1),
  semanticType: FIXED_JOINERY,
  startM: z.tuple([Coord, Coord]),
  endM: z.tuple([Coord, Coord]),
  depthM: M,
  heightM: M,
  visibleModuleBoundaries: z.array(z.number().finite()),
  moduleCountIfVisible: z.number().int().nonnegative().optional(),
  moduleWidthMIfVisible: M.optional(),
  confidence: Conf,
  evidence: z.string().min(1),
  reviewReason: z.string().optional(),
}).strict();
export const Pass4Schema = z.object({
  promptId: z.literal('FURNITURE_JOINERY_V4'),
  version: z.literal('4'),
  joinery: z.array(JoinerySchema),
}).strict();

// ---------------------------------------------------------------------------
// PASS 5: orientation
// ---------------------------------------------------------------------------
export const OrientationSchema = z.object({
  candidateId: z.string().min(1),
  longAxisDeg: Angle,
  semanticFacingDegIfVisible: Angle.optional(),
  orientationConfidence: Conf,
  orientationEvidence: z.string().min(1),
}).strict();
export const Pass5Schema = z.object({
  promptId: z.literal('FURNITURE_VERIFICATION_ORIENTATION_V4'),
  version: z.literal('4'),
  orientations: z.array(OrientationSchema),
}).strict();

// ---------------------------------------------------------------------------
// PASS 6: independent verification
// ---------------------------------------------------------------------------
export const VerificationSchema = z.object({
  candidateId: z.string().min(1),
  decision: z.enum(['ACCEPT', 'CORRECT', 'REVIEW', 'REJECT']),
  correctedFamilyId: PASCAL_FAMILY.optional(),
  correctedDimensionsM: z.tuple([M, M]).optional(),
  correctedLongAxisDeg: Angle.optional(),
  confidence: Conf,
  evidence: z.string().min(1),
  reviewReason: z.string().optional(),
}).strict();
export const Pass6Schema = z.object({
  promptId: z.literal('FURNITURE_VERIFICATION_V4'),
  version: z.literal('4'),
  verifications: z.array(VerificationSchema),
}).strict();

// ---------------------------------------------------------------------------
// Aggregated accepted record (adapter output toward Pascal furniture install)
// ---------------------------------------------------------------------------
export const FurnitureRecordV4Schema = z.object({
  candidateId: z.string().min(1),
  familyId: PASCAL_FAMILY,
  pos: z.tuple([Coord, Coord]),
  widthM: M,
  depthM: M,
  rotationDeg: Angle,
  confidence: Conf,
  evidence: z.string().min(1),
  status: z.enum(['accepted', 'review', 'rejected']),
  reviewReason: z.string().optional(),
}).strict();

export type FurnitureCandidateV4 = z.infer<typeof FurnitureCandidateSchema>;
export type FurnitureRecordV4 = z.infer<typeof FurnitureRecordV4Schema>;
