// design-build-extraction-ai
// CAP-01: AI_COORDINATE_VALIDATION_V2 (Observation-Only)
//
// Pure, non-mutating coordinate & DocumentFrame lineage validator for AI extraction phases.
// Boundary rules:
//   - NO mutation of input entities, coordinates, scales, offsets, or frames.
//   - NO network / provider calls.
//   - NO React, useScene, Three.js, Viewer, or Editor imports.
//   - Applies ONLY when pipelineKind === 'ai'.

import type { Vec2, Vec3 } from 'design-build-extraction-contracts';

/** Feature flag for AI coordinate validation V2 (Default: false). */
export const AI_COORDINATE_VALIDATION_V2 = false;

export type SourceSpaceType = 'pdf-points' | 'pixels' | 'metric';
export type ScaleBasisType =
  | 'explicit-calibrated'
  | 'verified-dimension'
  | 'guide-calibrated'
  | 'provider-estimate'
  | 'fallback';

export type SourceOriginType = 'top-left' | 'bottom-left';
export type SourceYAxisType = 'up' | 'down';
export type WorldGroundAxisType = 'x-z' | 'x-y';

/** Authoritative DocumentFrame lineage descriptor. */
export interface DocumentFrameLineage {
  frameId: string;
  frameRevision: number;
  sourceSpace: SourceSpaceType;
  sourceWidth: number;
  sourceHeight: number;
  cropOffset: [number, number]; // [offsetX, offsetY] in source units
  cropSize: [number, number];   // [cropW, cropH] in source units
  scaleMPerSourceUnit: number;
  scaleBasis: ScaleBasisType;
  sourceOrigin: SourceOriginType;
  sourceYAxis: SourceYAxisType;
  yFlipApplied: boolean;
  yFlipOrigin?: number;
  worldGroundAxis: WorldGroundAxisType;
}

export type CoordinateFindingCode =
  | 'PHASE_FRAME_MISMATCH'
  | 'SCALE_FALLBACK_USED'
  | 'SCALE_NON_POSITIVE_OR_NON_FINITE'
  | 'SCALE_CROSS_PHASE_CONFLICT'
  | 'SCALE_IMPLAUSIBLE_DIMENSIONS'
  | 'Y_AXIS_CONFLICT'
  | 'ORIGIN_INCONSISTENT'
  | 'DOUBLE_Y_INVERSION_SUSPECTED'
  | 'CROP_INCONSISTENT'
  | 'CROP_OUTSIDE_SOURCE_BOUNDS'
  | 'NON_FINITE_COORDINATE'
  | 'OUT_OF_BOUNDS_SUBSTANTIAL'
  | 'OUT_OF_BOUNDS_EDGE_WARNING';

export interface CoordinateValidationFinding {
  severity: 'error' | 'warning' | 'info';
  code: CoordinateFindingCode;
  message: string;
  phase?: string;
  recordId?: string;
  entityType?: string;
  frameId?: string;
  comparisonFrameId?: string;
  observedValues?: Record<string, unknown>;
  expectedValues?: Record<string, unknown>;
}

export interface CoordinateValidationReviewRecord {
  id: string;
  reviewCode: 'COORDINATE_FRAME_INCONSISTENT';
  recordId?: string;
  entityType: string;
  phase: string;
  reasons: string[];
  frameId: string;
  comparisonFrameId?: string;
  observedValues?: Record<string, unknown>;
  expectedValues?: Record<string, unknown>;
  timestamp: string;
}

export interface EntityCandidateForValidation {
  id: string;
  entityType: 'wall' | 'door' | 'window' | 'slab' | 'column' | 'furniture' | 'room' | 'guide' | 'other';
  phase?: string;
  frameId?: string;
  pointsM?: Vec2[];
  centerM?: Vec2 | Vec3;
  sizeM?: [number, number] | [number, number, number];
}

export interface PhaseFrameObservation {
  phase: string;
  frame: DocumentFrameLineage;
  entities?: EntityCandidateForValidation[];
}

export interface CoordinateValidationInput {
  pipelineKind: 'ai' | 'mupdf' | 'manual' | string;
  baseFrame?: DocumentFrameLineage;
  phases: PhaseFrameObservation[];
  options?: CoordinateValidationOptions;
}

export interface CoordinateValidationOptions {
  enabled?: boolean;
  edgeToleranceM?: number; // small edge margin beyond frame before warning (default 0.35m)
  substantialOutOfBoundsM?: number; // distance beyond edge tolerance treated as substantial (default 1.50m)
  minPlausibleDimensionM?: number; // default 1.0m
  maxPlausibleDimensionM?: number; // default 500.0m
}

export interface CoordinateValidationResult {
  valid: boolean;
  status: 'PASSED' | 'PASSED_WITH_WARNINGS' | 'FAILED';
  findings: CoordinateValidationFinding[];
  reviewRecords: CoordinateValidationReviewRecord[];
  frameCount: number;
  entityCount: number;
  pure: true;
}

function isFiniteNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

function isFiniteVec2(pt?: Vec2 | null): boolean {
  return !!pt && isFiniteNumber(pt.x) && isFiniteNumber(pt.y);
}

/**
 * Validates coordinate frame consistency and entity bounds without modifying input data.
 */
export function validateAiCoordinates(input: CoordinateValidationInput): CoordinateValidationResult {
  // If disabled by feature flag or not AI pipeline, return neutral pass without review
  const isEnabled = input.options?.enabled ?? AI_COORDINATE_VALIDATION_V2;
  if (!isEnabled || input.pipelineKind !== 'ai') {
    return {
      valid: true,
      status: 'PASSED',
      findings: [],
      reviewRecords: [],
      frameCount: input.phases.length,
      entityCount: input.phases.reduce((sum, p) => sum + (p.entities?.length || 0), 0),
      pure: true,
    };
  }

  const findings: CoordinateValidationFinding[] = [];
  const reviewRecords: CoordinateValidationReviewRecord[] = [];
  const edgeTolM = input.options?.edgeToleranceM ?? 0.35;
  const substantialTolM = input.options?.substantialOutOfBoundsM ?? 1.50;
  const minDimM = input.options?.minPlausibleDimensionM ?? 1.0;
  const maxDimM = input.options?.maxPlausibleDimensionM ?? 500.0;

  const baseFrame = input.baseFrame || input.phases[0]?.frame;
  let totalEntities = 0;

  // 1. Frame Lineage Validation
  if (baseFrame) {
    validateSingleFrame(baseFrame, 'base', findings, minDimM, maxDimM);
  }

  // 2. Cross-Phase Frame Comparison
  for (let i = 0; i < input.phases.length; i++) {
    const phaseObs = input.phases[i];
    const { phase, frame, entities = [] } = phaseObs;
    totalEntities += entities.length;

    // Validate phase frame structure
    validateSingleFrame(frame, phase, findings, minDimM, maxDimM);

    // Compare with baseFrame
    if (baseFrame && baseFrame.frameId !== frame.frameId) {
      findings.push({
        severity: 'error',
        code: 'PHASE_FRAME_MISMATCH',
        message: `Phase "${phase}" declared frameId "${frame.frameId}", differing from base frameId "${baseFrame.frameId}".`,
        phase,
        frameId: frame.frameId,
        comparisonFrameId: baseFrame.frameId,
        observedValues: { phaseFrameId: frame.frameId },
        expectedValues: { baseFrameId: baseFrame.frameId },
      });
    }

    if (baseFrame && frame) {
      compareFrames(baseFrame, frame, phase, findings);
    }

    // 3. Entity Coordinate & Bounds Validation
    const effectiveFrame = frame || baseFrame;
    if (effectiveFrame) {
      validatePhaseEntities(entities, effectiveFrame, phase, findings, edgeTolM, substantialTolM);
    }
  }

  // 4. Map findings to Review Records
  for (const finding of findings) {
    if (finding.severity === 'error' || (finding.severity === 'warning' && finding.code !== 'OUT_OF_BOUNDS_EDGE_WARNING')) {
      reviewRecords.push({
        id: `review_coord_${reviewRecords.length + 1}`,
        reviewCode: 'COORDINATE_FRAME_INCONSISTENT',
        recordId: finding.recordId,
        entityType: finding.entityType || 'frame',
        phase: finding.phase || 'global',
        reasons: [finding.code, finding.message],
        frameId: finding.frameId || baseFrame?.frameId || 'unknown',
        comparisonFrameId: finding.comparisonFrameId,
        observedValues: finding.observedValues,
        expectedValues: finding.expectedValues,
        timestamp: new Date().toISOString(),
      });
    }
  }

  const hasErrors = findings.some((f) => f.severity === 'error');
  const hasWarnings = findings.some((f) => f.severity === 'warning');

  const status: 'PASSED' | 'PASSED_WITH_WARNINGS' | 'FAILED' = hasErrors
    ? 'FAILED'
    : hasWarnings
      ? 'PASSED_WITH_WARNINGS'
      : 'PASSED';

  return {
    valid: !hasErrors,
    status,
    findings,
    reviewRecords,
    frameCount: input.phases.length,
    entityCount: totalEntities,
    pure: true,
  };
}

function validateSingleFrame(
  frame: DocumentFrameLineage,
  phaseName: string,
  findings: CoordinateValidationFinding[],
  minDimM: number,
  maxDimM: number
) {
  // Scale checks
  if (!isFiniteNumber(frame.scaleMPerSourceUnit) || frame.scaleMPerSourceUnit <= 0) {
    findings.push({
      severity: 'error',
      code: 'SCALE_NON_POSITIVE_OR_NON_FINITE',
      message: `Phase "${phaseName}" scaleMPerSourceUnit (${frame.scaleMPerSourceUnit}) must be finite and > 0.`,
      phase: phaseName,
      frameId: frame.frameId,
      observedValues: { scale: frame.scaleMPerSourceUnit },
    });
  } else if (frame.scaleBasis === 'fallback') {
    findings.push({
      severity: 'warning',
      code: 'SCALE_FALLBACK_USED',
      message: `Phase "${phaseName}" is using uncalibrated fallback scale basis. Accuracy is uncertified.`,
      phase: phaseName,
      frameId: frame.frameId,
      observedValues: { scaleBasis: frame.scaleBasis, scale: frame.scaleMPerSourceUnit },
    });
  }

  // Dimension sanity check in meters
  if (isFiniteNumber(frame.scaleMPerSourceUnit) && frame.scaleMPerSourceUnit > 0) {
    const widthM = (frame.cropSize?.[0] || frame.sourceWidth) * frame.scaleMPerSourceUnit;
    const heightM = (frame.cropSize?.[1] || frame.sourceHeight) * frame.scaleMPerSourceUnit;

    if (widthM < minDimM || widthM > maxDimM || heightM < minDimM || heightM > maxDimM) {
      findings.push({
        severity: 'warning',
        code: 'SCALE_IMPLAUSIBLE_DIMENSIONS',
        message: `Phase "${phaseName}" calculated physical dimensions (${widthM.toFixed(2)}m x ${heightM.toFixed(2)}m) outside expected range [${minDimM}m, ${maxDimM}m].`,
        phase: phaseName,
        frameId: frame.frameId,
        observedValues: { widthM, heightM },
        expectedValues: { minDimM, maxDimM },
      });
    }
  }

  // Crop checks
  const [ox, oy] = frame.cropOffset || [0, 0];
  const [cw, ch] = frame.cropSize || [frame.sourceWidth, frame.sourceHeight];

  if (!isFiniteNumber(ox) || !isFiniteNumber(oy) || ox < 0 || oy < 0) {
    findings.push({
      severity: 'error',
      code: 'CROP_INCONSISTENT',
      message: `Phase "${phaseName}" crop offset [${ox}, ${oy}] is invalid or negative.`,
      phase: phaseName,
      frameId: frame.frameId,
      observedValues: { cropOffset: [ox, oy] },
    });
  }

  if (!isFiniteNumber(cw) || !isFiniteNumber(ch) || cw <= 0 || ch <= 0) {
    findings.push({
      severity: 'error',
      code: 'CROP_INCONSISTENT',
      message: `Phase "${phaseName}" crop size [${cw}, ${ch}] must be finite and positive.`,
      phase: phaseName,
      frameId: frame.frameId,
      observedValues: { cropSize: [cw, ch] },
    });
  }

  if (isFiniteNumber(ox) && isFiniteNumber(cw) && isFiniteNumber(frame.sourceWidth)) {
    if (ox + cw > frame.sourceWidth + 1e-2) {
      findings.push({
        severity: 'error',
        code: 'CROP_OUTSIDE_SOURCE_BOUNDS',
        message: `Phase "${phaseName}" horizontal crop extent (${ox + cw}) exceeds source width (${frame.sourceWidth}).`,
        phase: phaseName,
        frameId: frame.frameId,
        observedValues: { cropExtentX: ox + cw, sourceWidth: frame.sourceWidth },
      });
    }
  }

  if (isFiniteNumber(oy) && isFiniteNumber(ch) && isFiniteNumber(frame.sourceHeight)) {
    if (oy + ch > frame.sourceHeight + 1e-2) {
      findings.push({
        severity: 'error',
        code: 'CROP_OUTSIDE_SOURCE_BOUNDS',
        message: `Phase "${phaseName}" vertical crop extent (${oy + ch}) exceeds source height (${frame.sourceHeight}).`,
        phase: phaseName,
        frameId: frame.frameId,
        observedValues: { cropExtentY: oy + ch, sourceHeight: frame.sourceHeight },
      });
    }
  }

  // Inversion / axis check
  if (frame.sourceOrigin === 'bottom-left' && frame.sourceYAxis === 'up' && frame.yFlipApplied) {
    findings.push({
      severity: 'error',
      code: 'DOUBLE_Y_INVERSION_SUSPECTED',
      message: `Phase "${phaseName}" declared bottom-left origin with Y-up, but marked yFlipApplied=true (suspected double inversion).`,
      phase: phaseName,
      frameId: frame.frameId,
      observedValues: {
        sourceOrigin: frame.sourceOrigin,
        sourceYAxis: frame.sourceYAxis,
        yFlipApplied: frame.yFlipApplied,
      },
    });
  }
}

function compareFrames(
  base: DocumentFrameLineage,
  target: DocumentFrameLineage,
  phaseName: string,
  findings: CoordinateValidationFinding[]
) {
  // Scale comparison
  if (isFiniteNumber(base.scaleMPerSourceUnit) && isFiniteNumber(target.scaleMPerSourceUnit)) {
    const scaleRatio = target.scaleMPerSourceUnit / base.scaleMPerSourceUnit;
    if (Math.abs(scaleRatio - 1.0) > 0.01) {
      findings.push({
        severity: 'error',
        code: 'SCALE_CROSS_PHASE_CONFLICT',
        message: `Phase "${phaseName}" scale (${target.scaleMPerSourceUnit}) differs from base scale (${base.scaleMPerSourceUnit}) by ${((scaleRatio - 1) * 100).toFixed(1)}%.`,
        phase: phaseName,
        frameId: target.frameId,
        comparisonFrameId: base.frameId,
        observedValues: { targetScale: target.scaleMPerSourceUnit, baseScale: base.scaleMPerSourceUnit },
      });
    }
  }

  // Origin comparison
  if (base.sourceOrigin !== target.sourceOrigin) {
    findings.push({
      severity: 'error',
      code: 'ORIGIN_INCONSISTENT',
      message: `Phase "${phaseName}" sourceOrigin (${target.sourceOrigin}) contradicts base sourceOrigin (${base.sourceOrigin}).`,
      phase: phaseName,
      frameId: target.frameId,
      comparisonFrameId: base.frameId,
      observedValues: { targetOrigin: target.sourceOrigin },
      expectedValues: { baseOrigin: base.sourceOrigin },
    });
  }

  // Y-Axis comparison
  if (base.sourceYAxis !== target.sourceYAxis) {
    findings.push({
      severity: 'error',
      code: 'Y_AXIS_CONFLICT',
      message: `Phase "${phaseName}" sourceYAxis (${target.sourceYAxis}) contradicts base sourceYAxis (${base.sourceYAxis}).`,
      phase: phaseName,
      frameId: target.frameId,
      comparisonFrameId: base.frameId,
      observedValues: { targetYAxis: target.sourceYAxis },
      expectedValues: { baseYAxis: base.sourceYAxis },
    });
  }

  // Crop offset comparison
  const [bx, by] = base.cropOffset || [0, 0];
  const [tx, ty] = target.cropOffset || [0, 0];
  if (Math.abs(bx - tx) > 1e-2 || Math.abs(by - ty) > 1e-2) {
    findings.push({
      severity: 'error',
      code: 'CROP_INCONSISTENT',
      message: `Phase "${phaseName}" crop offset [${tx}, ${ty}] differs from base crop offset [${bx}, ${by}].`,
      phase: phaseName,
      frameId: target.frameId,
      comparisonFrameId: base.frameId,
      observedValues: { targetCropOffset: [tx, ty] },
      expectedValues: { baseCropOffset: [bx, by] },
    });
  }
}

function validatePhaseEntities(
  entities: EntityCandidateForValidation[],
  frame: DocumentFrameLineage,
  phaseName: string,
  findings: CoordinateValidationFinding[],
  edgeTolM: number,
  substantialTolM: number
) {
  const maxMWidth = (frame.cropSize?.[0] || frame.sourceWidth) * frame.scaleMPerSourceUnit;
  const maxMHeight = (frame.cropSize?.[1] || frame.sourceHeight) * frame.scaleMPerSourceUnit;

  for (const entity of entities) {
    const pointsToCheck: Vec2[] = [];

    if (entity.pointsM) {
      pointsToCheck.push(...entity.pointsM);
    }
    if (entity.centerM) {
      const c = entity.centerM;
      pointsToCheck.push({ x: c.x, y: 'z' in c ? (c.z as number) : c.y });
    }

    for (let idx = 0; idx < pointsToCheck.length; idx++) {
      const pt = pointsToCheck[idx];

      if (!isFiniteVec2(pt)) {
        findings.push({
          severity: 'error',
          code: 'NON_FINITE_COORDINATE',
          message: `Entity "${entity.id}" (${entity.entityType}) in phase "${phaseName}" contains non-finite coordinate [${pt?.x}, ${pt?.y}].`,
          phase: phaseName,
          recordId: entity.id,
          entityType: entity.entityType,
          frameId: frame.frameId,
          observedValues: { pt, index: idx },
        });
        continue;
      }

      // Check bounds in meters
      const xMinViol = -pt.x;
      const yMinViol = -pt.y;
      const xMaxViol = pt.x - maxMWidth;
      const yMaxViol = pt.y - maxMHeight;

      const maxViolationM = Math.max(0, xMinViol, yMinViol, xMaxViol, yMaxViol);

      if (maxViolationM > 0) {
        if (maxViolationM <= edgeTolM) {
          findings.push({
            severity: 'warning',
            code: 'OUT_OF_BOUNDS_EDGE_WARNING',
            message: `Entity "${entity.id}" (${entity.entityType}) slightly exceeds frame bounds by ${maxViolationM.toFixed(2)}m (within edge tolerance ${edgeTolM}m).`,
            phase: phaseName,
            recordId: entity.id,
            entityType: entity.entityType,
            frameId: frame.frameId,
            observedValues: { pt, maxViolationM, frameBoundsM: [maxMWidth, maxMHeight] },
          });
        } else {
          findings.push({
            severity: 'error',
            code: 'OUT_OF_BOUNDS_SUBSTANTIAL',
            message: `Entity "${entity.id}" (${entity.entityType}) substantially exceeds frame bounds by ${maxViolationM.toFixed(2)}m (exceeds tolerance ${edgeTolM}m).`,
            phase: phaseName,
            recordId: entity.id,
            entityType: entity.entityType,
            frameId: frame.frameId,
            observedValues: { pt, maxViolationM, frameBoundsM: [maxMWidth, maxMHeight] },
          });
        }
      }
    }
  }
}
