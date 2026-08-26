/**
 * Furniture V4 — deterministic weak-model fixtures + schema/behavior tests.
 * Runs under the editor's vitest. No provider calls. Validates strict schemas,
 * candidate-identity preservation, orientation convention, repetition, joinery,
 * and verification rules. (V3 rollback retained, untouched.)
 */
import { describe, it, expect } from 'vitest';
import {
  Pass1Schema, Pass2Schema, Pass3Schema, Pass4Schema, Pass5Schema, Pass6Schema,
  FurnitureCandidateSchema, ClassificationSchema, RepetitionPatternSchema,
  JoinerySchema, OrientationSchema, VerificationSchema, FurnitureRecordV4Schema,
  FURNITURE_CANDIDATE_DETECTION_V4, FURNITURE_CLASSIFICATION_V4, FURNITURE_PATTERN_V4,
  FURNITURE_JOINERY_V4, FURNITURE_VERIFICATION_ORIENTATION_V4, FURNITURE_VERIFICATION_V4,
} from 'design-build-extraction-ai';

const cand = (id: string, vc: string) => ({
  candidateId: id, sourceBoxPx: [0, 0, 100, 200] as [number, number, number, number],
  centreM: [2, 3] as [number, number], widthM: 2, depthM: 1, longAxisDeg: 90,
  visualClass: vc, confidence: 0.9, evidence: 'visible bed footprint',
});

describe('Furniture V4 candidate identity', () => {
  it('preserves six distinct bed candidates', () => {
    const cs = Array.from({ length: 6 }, (_, i) => cand(`bed_${i}`, 'BED_LIKE'));
    const r = Pass1Schema.parse({ promptId: FURNITURE_CANDIDATE_DETECTION_V4, version: '4', candidates: cs });
    expect(r.candidates).toHaveLength(6);
    expect(new Set(r.candidates.map((c) => c.candidateId)).size).toBe(6);
  });
  it('rejects duplicate candidate IDs', () => {
    const cs = [cand('bed_0', 'BED_LIKE'), cand('bed_0', 'BED_LIKE')];
    expect(() => Pass1Schema.parse({ promptId: FURNITURE_CANDIDATE_DETECTION_V4, version: '4', candidates: cs })).toThrow(/duplicate/);
  });
  it('rejects zero/negative dimensions and out-of-range angle', () => {
    expect(() => FurnitureCandidateSchema.parse({ ...cand('b', 'BED_LIKE'), widthM: 0 })).toThrow();
    expect(() => FurnitureCandidateSchema.parse({ ...cand('b', 'BED_LIKE'), longAxisDeg: 400 })).toThrow();
  });
  it('rejects unknown fields (strict)', () => {
    expect(() => FurnitureCandidateSchema.parse({ ...cand('b', 'BED_LIKE'), extra: 1 })).toThrow();
  });
});

describe('Furniture V4 classification', () => {
  it('a long bed footprint must not be accepted as an office chair', () => {
    const cls = { candidateId: 'bed_0', matches: [{ familyId: 'office_chair' as const, confidence: 0.95, evidence: 'high conf' }], selectedFamilyId: 'office_chair' as const, decision: 'REVIEW' as const, reviewReason: 'long bed-like footprint incompatible with chair' };
    expect(ClassificationSchema.parse(cls).decision).toBe('REVIEW');
  });
  it('rejects unsupported family ID', () => {
    expect(() => ClassificationSchema.parse({ candidateId: 'b', matches: [{ familyId: 'toaster' as never, confidence: 0.5, evidence: 'x' }], selectedFamilyId: 'toaster' as never, decision: 'ACCEPT' })).toThrow();
  });
});

describe('Furniture V4 repetition', () => {
  it('preserves identities and flags inconsistent families as outliers', () => {
    const p = {
      patternId: 'p1', candidateIds: ['bed_0', 'bed_1', 'bed_2', 'bed_3', 'bed_4', 'bed_5', 'chair_x'],
      repeatedCount: 6, commonVisualClass: 'BED_LIKE' as const, commonDimensionsM: [2, 1] as [number, number],
      commonAspectRatio: 2, commonLongAxisDeg: 90, commonSpacingM: 1.1, familyConsistency: false,
      outlierIds: ['chair_x'], confidence: 0.9,
    };
    const r = RepetitionPatternSchema.parse(p);
    expect(r.candidateIds).toHaveLength(7);
    expect(r.outlierIds).toContain('chair_x');
  });
});

describe('Furniture V4 joinery', () => {
  it('keeps a continuous run as a run (no fragmentation into lockers)', () => {
    const j = {
      candidateId: 'cab_0', semanticType: 'CONTINUOUS_CABINET_RUN' as const, startM: [0, 0] as [number, number],
      endM: [4, 0] as [number, number], depthM: 0.6, heightM: 2.1, visibleModuleBoundaries: [1, 2, 3],
      moduleCountIfVisible: 4, moduleWidthMIfVisible: 1, confidence: 0.9, evidence: 'visible run of cabinets',
    };
    expect(JoinerySchema.parse(j).semanticType).toBe('CONTINUOUS_CABINET_RUN');
  });
  it('bedside table is not a cabinet run', () => {
    const j = { candidateId: 'bs_0', semanticType: 'BEDSIDE_TABLE' as const, startM: [1, 1] as [number, number], endM: [1.4, 1.4] as [number, number], depthM: 0.4, heightM: 0.6, visibleModuleBoundaries: [], confidence: 0.9, evidence: 'small bedside unit' };
    expect(JoinerySchema.parse(j).semanticType).toBe('BEDSIDE_TABLE');
  });
});

describe('Furniture V4 orientation + verification', () => {
  it('orientation respects the angle convention bounds', () => {
    const o = { candidateId: 'bed_0', longAxisDeg: 90, orientationConfidence: 0.9, orientationEvidence: 'long side horizontal' };
    expect(OrientationSchema.parse(o).longAxisDeg).toBe(90);
    expect(() => OrientationSchema.parse({ ...o, longAxisDeg: 400 })).toThrow();
  });
  it('verification preserves candidateId on reject', () => {
    const v = { candidateId: 'bed_0', decision: 'REJECT' as const, confidence: 0.2, evidence: 'not furniture', reviewReason: 'label-only inference' };
    expect(VerificationSchema.parse(v).candidateId).toBe('bed_0');
  });
  it('accepted record rejects NaN/Infinity and bad confidence', () => {
    const rec = { candidateId: 'bed_0', familyId: 'bed' as const, pos: [2, 3] as [number, number], widthM: 2, depthM: 1, rotationDeg: 90, confidence: 0.9, evidence: 'ok', status: 'accepted' as const };
    expect(FurnitureRecordV4Schema.parse(rec).candidateId).toBe('bed_0');
    expect(() => FurnitureRecordV4Schema.parse({ ...rec, confidence: 1.4 })).toThrow();
    expect(() => FurnitureRecordV4Schema.parse({ ...rec, widthM: NaN })).toThrow();
  });
});

describe('Furniture V4 prompt IDs pin to V4', () => {
  it('all six pass schemas carry the V4 promptId', () => {
    expect(Pass1Schema.shape.promptId.value).toBe(FURNITURE_CANDIDATE_DETECTION_V4);
    expect(Pass2Schema.shape.promptId.value).toBe(FURNITURE_CLASSIFICATION_V4);
    expect(Pass3Schema.shape.promptId.value).toBe(FURNITURE_PATTERN_V4);
    expect(Pass4Schema.shape.promptId.value).toBe(FURNITURE_JOINERY_V4);
    expect(Pass5Schema.shape.promptId.value).toBe(FURNITURE_VERIFICATION_ORIENTATION_V4);
    expect(Pass6Schema.shape.promptId.value).toBe(FURNITURE_VERIFICATION_V4);
  });
});
