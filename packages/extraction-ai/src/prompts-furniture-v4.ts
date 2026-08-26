/**
 * Furniture V4 — versioned, strict multipass prompt set.
 *
 * Each prompt is immutable (promptId + version). V3 (prompts-furniture-v2.ts /
 * schema-furniture-v3.ts) is retained as rollback and is NOT modified here.
 *
 * ANGLE CONVENTION (all passes): rotationDeg / longAxisDeg are measured
 * COUNTER-CLOCKWISE from positive project X in the bottom-left-origin project
 * coordinate frame (x right, y up). The AI reports the SOURCE-IMAGE long axis.
 * Catalogue metadata applies the asset-specific rotation offset later — never
 * guessed by the AI.
 *
 * EVIDENCE REQUIREMENT: every candidate/record must cite visible footprint,
 * dimensions, aspect ratio, neighbouring objects, repetition, and room context.
 * Do NOT infer furniture from room labels alone.
 *
 * REVIEW BEHAVIOUR: uncertain or contradicted items => REVIEW (not installed).
 * Invalid items => REJECT. Model confidence NEVER overrides incompatible
 * geometry (e.g. a long bed-like footprint must not be an office chair).
 */

export interface FurniturePromptV4 {
  promptId:
    | 'FURNITURE_CANDIDATE_DETECTION_V4'
    | 'FURNITURE_CLASSIFICATION_V4'
    | 'FURNITURE_PATTERN_V4'
    | 'FURNITURE_JOINERY_V4'
    | 'FURNITURE_VERIFICATION_ORIENTATION_V4'
    | 'FURNITURE_VERIFICATION_V4';
  version: '4';
  angleConvention: string;
  evidenceRequirement: string;
  reviewBehavior: string;
  inputContract: string;
  outputSchema: string;
  system: string;
  user: string;
}

const ANGLE = 'rotationDeg/longAxisDeg: degrees CCW from +X in bottom-left-origin project frame (x right, y up). Report the SOURCE-IMAGE long axis only.';
const EVIDENCE = 'Cite visible footprint, dimensions, aspect ratio, neighbours, repetition, and room context. Never classify from room labels alone.';
const REVIEW = 'Uncertain or geometry-contradicted => REVIEW. Invalid => REJECT. Confidence alone never overrides incompatible geometry.';

export const FURNITURE_PROMPTS_V4: FurniturePromptV4[] = [
  {
    promptId: 'FURNITURE_CANDIDATE_DETECTION_V4',
    version: '4',
    angleConvention: ANGLE,
    evidenceRequirement: EVIDENCE,
    reviewBehavior: REVIEW,
    inputContract: 'sourceImage (PNG/JPEG), drawingScaleMmPerPt, pageBoundsPt',
    outputSchema: 'Pass1Schema: { promptId, version, candidates: [FurnitureCandidate] }',
    system:
      'You detect visible furniture footprints in an architectural plan. You do NOT choose a Pascal family yet. ' +
      'Every visibly distinct object — including every repeated one — receives its OWN candidateId. ' +
      'Six visible beds => six candidateIds. Never collapse repeats by family.',
    user:
      'Detect every visible furniture footprint. For each, return candidateId, sourceBoxPx, optional contextBoxPx, ' +
      'centreM, widthM, depthM, longAxisDeg, visualClass (BED_LIKE|CHAIR_LIKE|TABLE_LIKE|SOFA_LIKE|STORAGE_LIKE|' +
      'CABINET_RUN_LIKE|SANITARY_FIXTURE_LIKE|APPLIANCE_LIKE|UNKNOWN), confidence, evidence. ' + EVIDENCE + ' ' + ANGLE,
  },
  {
    promptId: 'FURNITURE_CLASSIFICATION_V4',
    version: '4',
    angleConvention: ANGLE,
    evidenceRequirement: EVIDENCE,
    reviewBehavior: REVIEW,
    inputContract: 'sourceImage + candidate crops from Pass 1',
    outputSchema: 'Pass2Schema: { promptId, version, classifications: [Classification] }',
    system:
      'You classify each candidate using crop + context + dimensions + aspect ratio + room context + neighbours. ' +
      'Return ranked family matches and a decision (ACCEPT|REVIEW|REJECT_NOT_FURNITURE). ' +
      'A long rectangular bed-like footprint with repeated arrangement must not become an office_chair.',
    user:
      'For each candidateId return matches:[{familyId,confidence,evidence}], selectedFamilyId, decision, reviewReason. ' +
      EVIDENCE + ' ' + ANGLE + ' ' + REVIEW,
  },
  {
    promptId: 'FURNITURE_PATTERN_V4',
    version: '4',
    angleConvention: ANGLE,
    evidenceRequirement: EVIDENCE,
    reviewBehavior: REVIEW,
    inputContract: 'candidate dimensions + longAxis + classifications',
    outputSchema: 'Pass3Schema: { promptId, version, patterns: [RepetitionPattern] }',
    system:
      'Analyze repeated visual layouts. Preserve candidate identities. Do NOT invent an object merely to complete a pattern. ' +
      'Send inconsistent family classifications to review.',
    user:
      'Return patterns with patternId, candidateIds, repeatedCount, common* fields, familyConsistency, outlierIds, confidence. ' +
      'For a six-bed reference: preserve six bed-like candidates, compare footprints/long-axis, flag inconsistent families. ' + EVIDENCE,
  },
  {
    promptId: 'FURNITURE_JOINERY_V4',
    version: '4',
    angleConvention: ANGLE,
    evidenceRequirement: EVIDENCE,
    reviewBehavior: REVIEW,
    inputContract: 'candidate crops flagged STORAGE_LIKE / CABINET_RUN_LIKE',
    outputSchema: 'Pass4Schema: { promptId, version, joinery: [Joinery] }',
    system:
      'Distinguish fixed joinery from loose furniture. A continuous cabinet run stays a run — do NOT fragment into tiny lockers. ' +
      'Bedside tables are NOT cabinet runs. Only report module divisions that are visibly present.',
    user:
      'For each fixed candidate return semanticType (CONTINUOUS_CABINET_RUN|CONNECTED_CABINET_MODULES|INDIVIDUAL_LOCKER|' +
      'BEDSIDE_TABLE|WARDROBE|KITCHEN_CABINET|COUNTER|SHELF|UNKNOWN_FIXED_JOINERY), startM, endM, depthM, heightM, ' +
      'visibleModuleBoundaries, optional moduleCountIfVisible, moduleWidthMIfVisible, confidence, evidence, reviewReason. ' + EVIDENCE,
  },
  {
    promptId: 'FURNITURE_VERIFICATION_ORIENTATION_V4',
    version: '4',
    angleConvention: ANGLE,
    evidenceRequirement: EVIDENCE,
    reviewBehavior: REVIEW,
    inputContract: 'candidate crops + longAxis estimates',
    outputSchema: 'Pass5Schema: { promptId, version, orientations: [Orientation] }',
    system: 'Report each candidate long axis and optional facing under the single angle convention. Do not guess asset intrinsics.',
    user: 'For each candidateId return longAxisDeg, optional semanticFacingDegIfVisible, orientationConfidence, orientationEvidence. ' + ANGLE,
  },
  {
    promptId: 'FURNITURE_VERIFICATION_V4',
    version: '4',
    angleConvention: ANGLE,
    evidenceRequirement: EVIDENCE,
    reviewBehavior: REVIEW,
    inputContract: 'all prior pass outputs + source image',
    outputSchema: 'Pass6Schema: { promptId, version, verifications: [Verification] }',
    system:
      'Independently verify each item against the source. Checks: visible, box/centre correct, dimensions plausible, visual ' +
      'class correct, family plausible, long axis correct, not duplicated, not inferred from a label, pattern membership ' +
      'plausible, fixed-vs-loose correct. Corrections preserve candidateId.',
    user:
      'For each candidateId return decision (ACCEPT|CORRECT|REVIEW|REJECT), optional correctedFamilyId, ' +
      'correctedDimensionsM, correctedLongAxisDeg, confidence, evidence, reviewReason. ' + EVIDENCE + ' ' + REVIEW,
  },
];

export function getFurniturePromptV4(id: FurniturePromptV4['promptId']): FurniturePromptV4 {
  const p = FURNITURE_PROMPTS_V4.find((x) => x.promptId === id);
  if (!p) throw new Error(`Unknown V4 furniture prompt: ${id}`);
  return p;
}
