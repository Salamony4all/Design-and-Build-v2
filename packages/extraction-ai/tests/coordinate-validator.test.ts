import { describe, it, expect } from 'vitest';
import {
  validateAiCoordinates,
  AI_COORDINATE_VALIDATION_V2,
  type DocumentFrameLineage,
  type CoordinateValidationInput,
} from '../src/coordinate-validator';

const BASE_VALID_FRAME: DocumentFrameLineage = {
  frameId: 'frame_code06_main',
  frameRevision: 1,
  sourceSpace: 'pdf-points',
  sourceWidth: 595.28,
  sourceHeight: 841.89,
  cropOffset: [0, 0],
  cropSize: [595.28, 841.89],
  scaleMPerSourceUnit: 0.02, // 1:50 at 72 dpi ≈ 0.02m / pt
  scaleBasis: 'explicit-calibrated',
  sourceOrigin: 'bottom-left',
  sourceYAxis: 'up',
  yFlipApplied: false,
  worldGroundAxis: 'x-z',
};

describe('AI Coordinate Validation V2 (CAP-01: Observation-Only)', () => {
  it('1. Passes cleanly for coherent frame and in-bounds entities', () => {
    const input: CoordinateValidationInput = {
      pipelineKind: 'ai',
      baseFrame: { ...BASE_VALID_FRAME },
      phases: [
        {
          phase: 'shell',
          frame: { ...BASE_VALID_FRAME },
          entities: [
            {
              id: 'wall_1',
              entityType: 'wall',
              pointsM: [
                { x: 1.0, y: 1.0 },
                { x: 5.0, y: 1.0 },
              ],
            },
            {
              id: 'slab_1',
              entityType: 'slab',
              pointsM: [
                { x: 0.5, y: 0.5 },
                { x: 8.0, y: 0.5 },
                { x: 8.0, y: 12.0 },
                { x: 0.5, y: 12.0 },
              ],
            },
          ],
        },
        {
          phase: 'fitout',
          frame: { ...BASE_VALID_FRAME },
          entities: [
            {
              id: 'door_1',
              entityType: 'door',
              pointsM: [
                { x: 2.0, y: 1.0 },
                { x: 2.9, y: 1.0 },
              ],
            },
            {
              id: 'furniture_1',
              entityType: 'furniture',
              centerM: { x: 4.0, y: 6.0 },
              sizeM: [1.6, 2.0],
            },
          ],
        },
      ],
      options: { enabled: true },
    };

    const result = validateAiCoordinates(input);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('PASSED');
    expect(result.findings).toHaveLength(0);
    expect(result.reviewRecords).toHaveLength(0);
    expect(result.pure).toBe(true);
  });

  it('2. Fallback scale produces warning and SCALE_FALLBACK_USED review record', () => {
    const fallbackFrame: DocumentFrameLineage = {
      ...BASE_VALID_FRAME,
      scaleBasis: 'fallback',
    };

    const input: CoordinateValidationInput = {
      pipelineKind: 'ai',
      phases: [{ phase: 'shell', frame: fallbackFrame, entities: [] }],
      options: { enabled: true },
    };

    const result = validateAiCoordinates(input);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('PASSED_WITH_WARNINGS');
    expect(result.findings.some((f) => f.code === 'SCALE_FALLBACK_USED')).toBe(true);
    expect(result.reviewRecords.some((r) => r.reasons.includes('SCALE_FALLBACK_USED'))).toBe(true);
  });

  it('3. Detects cross-phase scale mismatch (>1%)', () => {
    const alteredFrame: DocumentFrameLineage = {
      ...BASE_VALID_FRAME,
      scaleMPerSourceUnit: 0.025, // 25% larger
    };

    const input: CoordinateValidationInput = {
      pipelineKind: 'ai',
      baseFrame: BASE_VALID_FRAME,
      phases: [
        { phase: 'shell', frame: BASE_VALID_FRAME },
        { phase: 'fitout', frame: alteredFrame },
      ],
      options: { enabled: true },
    };

    const result = validateAiCoordinates(input);
    expect(result.valid).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.findings.some((f) => f.code === 'SCALE_CROSS_PHASE_CONFLICT')).toBe(true);
  });

  it('4. Detects zero, negative, NaN, or infinite scale', () => {
    const badFrames = [
      { ...BASE_VALID_FRAME, scaleMPerSourceUnit: 0 },
      { ...BASE_VALID_FRAME, scaleMPerSourceUnit: -0.02 },
      { ...BASE_VALID_FRAME, scaleMPerSourceUnit: Number.NaN },
      { ...BASE_VALID_FRAME, scaleMPerSourceUnit: Number.POSITIVE_INFINITY },
    ];

    for (const frame of badFrames) {
      const input: CoordinateValidationInput = {
        pipelineKind: 'ai',
        phases: [{ phase: 'shell', frame }],
        options: { enabled: true },
      };
      const result = validateAiCoordinates(input);
      expect(result.valid).toBe(false);
      expect(result.findings.some((f) => f.code === 'SCALE_NON_POSITIVE_OR_NON_FINITE')).toBe(true);
    }
  });

  it('5. Detects crop outside source bounds', () => {
    const oobCropFrame: DocumentFrameLineage = {
      ...BASE_VALID_FRAME,
      cropOffset: [100, 100],
      cropSize: [550, 800], // 100 + 550 = 650 > 595.28 sourceWidth
    };

    const input: CoordinateValidationInput = {
      pipelineKind: 'ai',
      phases: [{ phase: 'shell', frame: oobCropFrame }],
      options: { enabled: true },
    };

    const result = validateAiCoordinates(input);
    expect(result.valid).toBe(false);
    expect(result.findings.some((f) => f.code === 'CROP_OUTSIDE_SOURCE_BOUNDS')).toBe(true);
  });

  it('6. Detects cross-phase crop offset mismatch', () => {
    const shiftedFrame: DocumentFrameLineage = {
      ...BASE_VALID_FRAME,
      cropOffset: [20, 30],
    };

    const input: CoordinateValidationInput = {
      pipelineKind: 'ai',
      baseFrame: BASE_VALID_FRAME,
      phases: [
        { phase: 'shell', frame: BASE_VALID_FRAME },
        { phase: 'fitout', frame: shiftedFrame },
      ],
      options: { enabled: true },
    };

    const result = validateAiCoordinates(input);
    expect(result.valid).toBe(false);
    expect(result.findings.some((f) => f.code === 'CROP_INCONSISTENT')).toBe(true);
  });

  it('7. Detects Y-axis conflict between phases', () => {
    const yDownFrame: DocumentFrameLineage = {
      ...BASE_VALID_FRAME,
      sourceYAxis: 'down',
    };

    const input: CoordinateValidationInput = {
      pipelineKind: 'ai',
      baseFrame: BASE_VALID_FRAME,
      phases: [
        { phase: 'shell', frame: BASE_VALID_FRAME },
        { phase: 'fitout', frame: yDownFrame },
      ],
      options: { enabled: true },
    };

    const result = validateAiCoordinates(input);
    expect(result.valid).toBe(false);
    expect(result.findings.some((f) => f.code === 'Y_AXIS_CONFLICT')).toBe(true);
  });

  it('8. Detects suspected double Y-inversion', () => {
    const doubleInvertFrame: DocumentFrameLineage = {
      ...BASE_VALID_FRAME,
      sourceOrigin: 'bottom-left',
      sourceYAxis: 'up',
      yFlipApplied: true, // Contradiction: already bottom-left + up, but marked flip applied
    };

    const input: CoordinateValidationInput = {
      pipelineKind: 'ai',
      phases: [{ phase: 'shell', frame: doubleInvertFrame }],
      options: { enabled: true },
    };

    const result = validateAiCoordinates(input);
    expect(result.valid).toBe(false);
    expect(result.findings.some((f) => f.code === 'DOUBLE_Y_INVERSION_SUSPECTED')).toBe(true);
  });

  it('9. Detects source-origin conflict', () => {
    const topLeftFrame: DocumentFrameLineage = {
      ...BASE_VALID_FRAME,
      sourceOrigin: 'top-left',
    };

    const input: CoordinateValidationInput = {
      pipelineKind: 'ai',
      baseFrame: BASE_VALID_FRAME,
      phases: [
        { phase: 'shell', frame: BASE_VALID_FRAME },
        { phase: 'fitout', frame: topLeftFrame },
      ],
      options: { enabled: true },
    };

    const result = validateAiCoordinates(input);
    expect(result.valid).toBe(false);
    expect(result.findings.some((f) => f.code === 'ORIGIN_INCONSISTENT')).toBe(true);
  });

  it('10. Detects non-finite Wall endpoint', () => {
    const input: CoordinateValidationInput = {
      pipelineKind: 'ai',
      phases: [
        {
          phase: 'shell',
          frame: BASE_VALID_FRAME,
          entities: [
            {
              id: 'wall_corrupted',
              entityType: 'wall',
              pointsM: [
                { x: 1.0, y: 1.0 },
                { x: Number.NaN, y: 5.0 },
              ],
            },
          ],
        },
      ],
      options: { enabled: true },
    };

    const result = validateAiCoordinates(input);
    expect(result.valid).toBe(false);
    expect(result.findings.some((f) => f.code === 'NON_FINITE_COORDINATE')).toBe(true);
  });

  it('11. Detects out-of-bounds Door and Furniture substantially outside bounds', () => {
    const input: CoordinateValidationInput = {
      pipelineKind: 'ai',
      phases: [
        {
          phase: 'fitout',
          frame: BASE_VALID_FRAME, // ~11.9m x ~16.8m in meters
          entities: [
            {
              id: 'door_oob',
              entityType: 'door',
              pointsM: [{ x: 25.0, y: 5.0 }], // Exceeds ~11.9m width by >13m
            },
            {
              id: 'furniture_oob',
              entityType: 'furniture',
              centerM: { x: -5.0, y: 5.0 }, // Negative coordinate exceeds tolerance
            },
          ],
        },
      ],
      options: { enabled: true, edgeToleranceM: 0.35, substantialOutOfBoundsM: 1.5 },
    };

    const result = validateAiCoordinates(input);
    expect(result.valid).toBe(false);
    const oobFindings = result.findings.filter((f) => f.code === 'OUT_OF_BOUNDS_SUBSTANTIAL');
    expect(oobFindings.length).toBeGreaterThanOrEqual(2);
  });

  it('12. Distinguishes small edge tolerance (warning only) from substantial violation', () => {
    const input: CoordinateValidationInput = {
      pipelineKind: 'ai',
      phases: [
        {
          phase: 'shell',
          frame: BASE_VALID_FRAME, // ~11.9056m x ~16.8378m
          entities: [
            {
              id: 'wall_edge_touch',
              entityType: 'wall',
              pointsM: [
                { x: 1.0, y: 1.0 },
                { x: 12.05, y: 1.0 }, // Over by ~0.14m (within 0.35m edge tolerance)
              ],
            },
          ],
        },
      ],
      options: { enabled: true, edgeToleranceM: 0.35 },
    };

    const result = validateAiCoordinates(input);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('PASSED_WITH_WARNINGS');
    expect(result.findings.some((f) => f.code === 'OUT_OF_BOUNDS_EDGE_WARNING')).toBe(true);
    expect(result.findings.some((f) => f.code === 'OUT_OF_BOUNDS_SUBSTANTIAL')).toBe(false);
  });

  it('13. Frame-ID mismatch produces PHASE_FRAME_MISMATCH', () => {
    const input: CoordinateValidationInput = {
      pipelineKind: 'ai',
      baseFrame: BASE_VALID_FRAME,
      phases: [
        {
          phase: 'fitout',
          frame: { ...BASE_VALID_FRAME, frameId: 'frame_unrelated_alt_doc' },
        },
      ],
      options: { enabled: true },
    };

    const result = validateAiCoordinates(input);
    expect(result.valid).toBe(false);
    expect(result.findings.some((f) => f.code === 'PHASE_FRAME_MISMATCH')).toBe(true);
  });

  it('14. Purity guarantee: input object is completely unmutated', () => {
    const originalInput: CoordinateValidationInput = {
      pipelineKind: 'ai',
      baseFrame: { ...BASE_VALID_FRAME },
      phases: [
        {
          phase: 'shell',
          frame: { ...BASE_VALID_FRAME },
          entities: [
            {
              id: 'wall_1',
              entityType: 'wall',
              pointsM: [
                { x: 1.0, y: 1.0 },
                { x: 5.0, y: 1.0 },
              ],
            },
          ],
        },
      ],
      options: { enabled: true },
    };

    const inputSnapshot = JSON.stringify(originalInput);
    validateAiCoordinates(originalInput);
    const postValidationSnapshot = JSON.stringify(originalInput);

    expect(postValidationSnapshot).toBe(inputSnapshot);
  });

  it('15. Feature flag OFF produces no behavior change and neutral pass', () => {
    const invalidInput: CoordinateValidationInput = {
      pipelineKind: 'ai',
      phases: [
        {
          phase: 'shell',
          frame: { ...BASE_VALID_FRAME, scaleMPerSourceUnit: -10 },
        },
      ],
      options: { enabled: false }, // explicitly disabled
    };

    const result = validateAiCoordinates(invalidInput);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('PASSED');
    expect(result.findings).toHaveLength(0);
    expect(result.reviewRecords).toHaveLength(0);
  });

  it('16. Non-AI pipelineKind returns neutral pass without modifying records', () => {
    const mupdfInput: CoordinateValidationInput = {
      pipelineKind: 'mupdf',
      phases: [
        {
          phase: 'shell',
          frame: { ...BASE_VALID_FRAME, scaleMPerSourceUnit: 0 },
        },
      ],
      options: { enabled: true },
    };

    const result = validateAiCoordinates(mupdfInput);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('PASSED');
    expect(result.findings).toHaveLength(0);
  });
});
