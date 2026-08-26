import { describe, expect, it } from 'vitest';
import { evaluateRegressionTier, computeNearestRankPercentile, DEFAULT_FINAL_THRESHOLDS } from '../src/index';

describe('Item 2: Exact Threshold Tests for Authoritative Tier Evaluator', () => {

  const baseValidMetrics = {
    wallPolygonIoU: 0.98,
    boundaryDistanceP95Mm: 12.0,
    maxBoundaryDeviationMm: 20.0,
    roomPolygonOverlapIoU: 0.99,
    unhostedDoorsCount: 0,
    unhostedWindowsCount: 0,
  };

  it('fails when wallPolygonIoU = 0.979999 (below 0.98 threshold)', () => {
    const res = evaluateRegressionTier({ ...baseValidMetrics, wallPolygonIoU: 0.979999 });
    expect(res.allFinalGatesPassed).toBe(false);
    expect(res.exportAllowed).toBe(false);
    expect(res.status).toBe('REVIEW_REQUIRED');
    expect(res.tier).toBe('reviewable');
    expect(res.failedGates.some(g => g.metric === 'wallPolygonIoU' && g.actual === 0.979999)).toBe(true);
  });

  it('passes when wallPolygonIoU = 0.980000 (meets 0.98 threshold)', () => {
    const res = evaluateRegressionTier({ ...baseValidMetrics, wallPolygonIoU: 0.980000 });
    expect(res.allFinalGatesPassed).toBe(true);
    expect(res.exportAllowed).toBe(true);
    expect(res.status).toBe('SUCCESS');
    expect(res.tier).toBe('final');
    expect(res.failedGates.length).toBe(0);
  });

  it('passes when wallPolygonIoU = 0.980001 (above 0.98 threshold)', () => {
    const res = evaluateRegressionTier({ ...baseValidMetrics, wallPolygonIoU: 0.980001 });
    expect(res.allFinalGatesPassed).toBe(true);
    expect(res.exportAllowed).toBe(true);
    expect(res.status).toBe('SUCCESS');
    expect(res.tier).toBe('final');
  });

  it('fails when wallPolygonIoU is NaN', () => {
    const res = evaluateRegressionTier({ ...baseValidMetrics, wallPolygonIoU: NaN });
    expect(res.allFinalGatesPassed).toBe(false);
    expect(res.exportAllowed).toBe(false);
    expect(res.failedGates.some(g => g.metric === 'wallPolygonIoU')).toBe(true);
  });

  it('fails when wallPolygonIoU is Infinity', () => {
    const res = evaluateRegressionTier({ ...baseValidMetrics, wallPolygonIoU: Infinity });
    expect(res.allFinalGatesPassed).toBe(false);
    expect(res.exportAllowed).toBe(false);
    expect(res.failedGates.some(g => g.metric === 'wallPolygonIoU')).toBe(true);
  });

  it('fails when wallPolygonIoU is missing (undefined)', () => {
    const metrics: any = { ...baseValidMetrics };
    delete metrics.wallPolygonIoU;
    const res = evaluateRegressionTier(metrics);
    expect(res.allFinalGatesPassed).toBe(false);
    expect(res.exportAllowed).toBe(false);
    expect(res.failedGates.some(g => g.metric === 'wallPolygonIoU')).toBe(true);
  });

  it('fails when wallPolygonIoU is a string ("0.98")', () => {
    const res = evaluateRegressionTier({ ...baseValidMetrics, wallPolygonIoU: '0.98' as any });
    expect(res.allFinalGatesPassed).toBe(false);
    expect(res.exportAllowed).toBe(false);
    expect(res.failedGates.some(g => g.metric === 'wallPolygonIoU')).toBe(true);
  });

  it('prevents caller-supplied allGatesPassed=true from overriding evaluateRegressionTier', () => {
    const callerPayload: any = {
      ...baseValidMetrics,
      wallPolygonIoU: 0.9761, // Failing value
      allGatesPassed: true,   // Attempted caller override
      status: 'SUCCESS',      // Attempted caller override
      exportAllowed: true,    // Attempted caller override
    };

    const res = evaluateRegressionTier(callerPayload, DEFAULT_FINAL_THRESHOLDS);

    expect(res.allFinalGatesPassed).toBe(false);
    expect(res.exportAllowed).toBe(false);
    expect(res.status).toBe('REVIEW_REQUIRED');
    expect(res.tier).toBe('reviewable');
    expect(res.failedGates.length).toBe(1);
    expect(res.failedGates[0]?.actual).toBe(0.9761);
    expect(res.failedGates[0]?.required).toBe(0.98);
  });
});

describe('Deterministic Nearest Rank Percentile Tests', () => {
  it('handles N=1 array edge case', () => {
    expect(computeNearestRankPercentile([42], 50)).toBe(42);
    expect(computeNearestRankPercentile([42], 95)).toBe(42);
  });

  it('handles empty array edge case', () => {
    expect(computeNearestRankPercentile([], 95)).toBe(0);
  });

  it('computes exact 50th, 95th, 99th percentiles for sorted array', () => {
    const data = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(computeNearestRankPercentile(data, 50)).toBe(50);
    expect(computeNearestRankPercentile(data, 95)).toBe(95);
    expect(computeNearestRankPercentile(data, 99)).toBe(99);
  });
});
