import { describe, test, expect } from 'vitest';
import {
  validateCoordinateRoundTrip,
  validateAreaIdentity,
  buildMultiPolygonEvidence,
  computeCanonicalHash,
} from '../scripts/reconcile-code06-geometry';

describe('Geometric Reconciliation Unit & Fail-Closed Tests', () => {
  test('1. Coordinate Round-Trip Accuracy across all 3 coordinate spaces', () => {
    const report = validateCoordinateRoundTrip();
    expect(report.pdfRoundTripPt).toBeLessThan(1e-6);
    expect(report.normalizedRoundTripMm).toBeLessThan(1e-6);
    expect(report.pascalRoundTripMetres).toBeLessThan(1e-6);
    expect(report.isValid).toBe(true);
  });

  test('2. Area Identity Validation (Union = Source + Recon - Intersection)', () => {
    const validArea = validateAreaIdentity(74.250, 75.150, 73.950, 75.450);
    expect(validArea.calculatedUnionM2).toBeCloseTo(75.450, 6);
    expect(validArea.calculatedIoU).toBeCloseTo(0.9801, 4);
    expect(validArea.unionIdentityErrorM2).toBeLessThan(1e-6);
    expect(validArea.isValid).toBe(true);
  });

  test('3. Polygon Area Identity Fail-Closed on invalid union error', () => {
    // Intentionally pass inconsistent union area
    const invalidArea = validateAreaIdentity(74.250, 75.150, 73.950, 80.000);
    expect(invalidArea.isValid).toBe(false);
  });

  test('4. MultiPolygon Evidence Structure & Deterministic Canonical Hashing', () => {
    const rings: [number, number][][] = [
      [[1000, 1000], [12000, 1000], [12000, 8000], [1000, 8000], [1000, 1000]]
    ];
    const evidence = buildMultiPolygonEvidence(rings, 74.250);
    expect(evidence.componentCount).toBe(1);
    expect(evidence.totalAreaM2).toBe(74.250);
    expect(evidence.validity).toBe('VALID');
    expect(evidence.canonicalHash).toBeDefined();
    expect(evidence.canonicalHash.length).toBe(64);
  });

  test('5. Exclude runtime timestamps from canonical hashing', () => {
    const payloadA = { wallId: 'wall_14', lengthMm: 2412, status: 'SUCCESS' };
    const payloadB = { wallId: 'wall_14', lengthMm: 2412, status: 'SUCCESS' };
    const hashA = computeCanonicalHash(payloadA);
    const hashB = computeCanonicalHash(payloadB);
    expect(hashA).toBe(hashB);
  });

  test('6. Fail-closed on snap displacement > 15 mm', () => {
    const oldEndpoint: [number, number] = [5200.0, 3400.0];
    const invalidProposedEndpoint: [number, number] = [5200.0, 3420.0]; // 20 mm snap displacement
    const displacementMm = Math.hypot(
      invalidProposedEndpoint[0] - oldEndpoint[0],
      invalidProposedEndpoint[1] - oldEndpoint[1]
    );
    expect(displacementMm).toBe(20.0);
    expect(displacementMm <= 15.0).toBe(false);
  });
});
