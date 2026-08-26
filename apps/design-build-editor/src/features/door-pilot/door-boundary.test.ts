import { describe, it, expect } from 'vitest';
import {
  selectDoorInstallerInput,
  selectEligibleDoors,
  isInstallationEligible,
  type BoundaryDoorManifest,
  type RuntimeWallMap,
} from './door-boundary';

/**
 * Regression fixture modelling the exact CODE_06 route response shape after the
 * 25-door restore: 25 accepted (mix of ANNOTATION_ASSISTED_GEOMETRY_VERIFIED and
 * ANNOTATION_ASSISTED_REVIEW_REQUIRED, none self-flagged), 11 review records with
 * reason AUDIT_GRANULARITY_CONFLICT that *reference* accepted assemblies via
 * relatedAcceptedAssemblyId, 202 diagnostic review candidates, and 63 rejected.
 *
 * The critical invariant: a candidate review record that references an accepted
 * assembly must NOT cause that accepted door to be dropped from the installer.
 */
function buildFixture() {
  const accepted: BoundaryDoorManifest['accepted'] = [];
  // 25 accepted doors across 25 distinct physical walls.
  for (let i = 0; i < 25; i += 1) {
    accepted.push({
      doorAssemblyId: `door-${String(i).padStart(3, '0')}`,
      selectedPhysicalWallId: `wall-${i}`,
      wallLocalInterval: { startM: 0.5 + (i % 3) * 0.2, endM: 0.9 + (i % 3) * 0.2 },
      widthM: 0.9,
      // None are self-flagged non-installable -> all 25 eligible.
      automaticInstallationAllowed: true,
      evidenceMode: i % 2 === 0 ? 'ANNOTATION_ASSISTED_GEOMETRY_VERIFIED' : 'ANNOTATION_ASSISTED_REVIEW_REQUIRED',
    });
  }

  const review: BoundaryDoorManifest['review'] = [];
  // 11 AUDIT_GRANULARITY_CONFLICT records that reference accepted assemblies.
  for (let i = 0; i < 11; i += 1) {
    review.push({
      doorAssemblyId: `review-audit-${i}`,
      reviewReason: 'AUDIT_GRANULARITY_CONFLICT',
      automaticInstallationAllowed: false,
      relatedAcceptedAssemblyId: `door-${i}`,
    });
  }
  // 202 diagnostic review candidates (no relatedAcceptedAssemblyId).
  for (let i = 0; i < 202; i += 1) {
    review.push({
      doorAssemblyId: `review-diag-${i}`,
      reviewReason: 'EXTRACTION_CANDIDATE',
      automaticInstallationAllowed: false,
    });
  }

  const rejected = Array.from({ length: 63 }, (_, i) => ({ doorAssemblyId: `rej-${i}` }));

  return { accepted, review, rejected } as BoundaryDoorManifest;
}

function buildWallMap(accepted: BoundaryDoorManifest['accepted']): RuntimeWallMap {
  const map: RuntimeWallMap = {};
  for (const d of accepted ?? []) {
    const wid = d.selectedPhysicalWallId;
    if (wid !== undefined) {
      map[wid] = { liveNodeId: `live-${wid}`, type: 'wall' };
    }
  }
  return map;
}

describe('door route-to-installer boundary (25-door restore)', () => {
  const manifest = buildFixture();
  const wallMap = buildWallMap(manifest.accepted);

  it('preserves all 25 accepted doors through the boundary', () => {
    const res = selectDoorInstallerInput(manifest, wallMap);
    expect(res.accepted).toBe(25);
    expect(res.installationEligible).toBe(25);
    expect(res.mapped).toBe(25);
    expect(res.failedMapping).toBe(0);
    expect(res.installerInput).toBe(25);
  });

  it('does not exclude a door merely because a review record references it', () => {
    // door-000..door-010 are referenced by the 11 AUDIT_GRANULARITY_CONFLICT records.
    const eligibleIds = selectEligibleDoors(manifest).map((d) => d.doorAssemblyId);
    for (let i = 0; i < 11; i += 1) {
      expect(eligibleIds).toContain(`door-${String(i).padStart(3, '0')}`);
    }
    expect(eligibleIds).toHaveLength(25);
  });

  it('excludes only doors self-flagged non-installable', () => {
    expect(isInstallationEligible({ doorAssemblyId: 'a', automaticInstallationAllowed: false })).toBe(false);
    expect(isInstallationEligible({ doorAssemblyId: 'a', automaticInstallationAllowed: true })).toBe(true);
    expect(isInstallationEligible({ doorAssemblyId: 'a' })).toBe(true); // undefined => eligible
  });

  it('keeps review-only records out of the installer input', () => {
    const res = selectDoorInstallerInput(manifest, wallMap);
    // No installer door id may match a review id.
    const reviewIds = new Set((manifest.review ?? []).map((r) => r.doorAssemblyId));
    for (const d of res.installerDoors) {
      expect(reviewIds.has(d.doorAssemblyId)).toBe(false);
    }
    // The 11 audit references + 202 diagnostics + 63 rejected never appear.
    expect(res.installerInput).not.toBe(11 + 202 + 63);
    expect(res.installerInput).toBe(25);
  });

  it('fails explicitly (and only) when a runtime host is missing', () => {
    const partialMap: RuntimeWallMap = {};
    // Only the first 20 walls exist in the runtime map.
    for (const d of manifest.accepted ?? []) {
      const wid = d.selectedPhysicalWallId;
      if (wid !== undefined && Number(d.doorAssemblyId.split('-')[1]) < 20) {
        partialMap[wid] = { liveNodeId: `live-${wid}`, type: 'wall' };
      }
    }
    const res = selectDoorInstallerInput(manifest, partialMap);
    expect(res.mapped).toBe(20);
    expect(res.failedMapping).toBe(5);
    expect(res.failureReasons).toHaveLength(5);
    expect(res.failureReasons.every((f) => f.reason === 'MISSING_RUNTIME_HOST')).toBe(true);
    // No record disappears without a reason: eligible count is still 25.
    expect(res.installationEligible).toBe(25);
  });

  it('rejects duplicate accepted ids explicitly when no runtime host exists', () => {
    const dupManifest: BoundaryDoorManifest = {
      accepted: [
        { doorAssemblyId: 'door-000', selectedPhysicalWallId: 'wall-0' },
        { doorAssemblyId: 'door-000', selectedPhysicalWallId: 'wall-0' },
      ],
    };
    // No wall map -> both fail mapping; the duplication is visible in failureReasons.
    const res = selectDoorInstallerInput(dupManifest, {});
    expect(res.installationEligible).toBe(2);
    expect(res.failedMapping).toBe(2);
    expect(res.failureReasons.filter((f) => f.doorAssemblyId === 'door-000')).toHaveLength(2);
  });

  it('produces a coherent, lossless boundary (no unexplained record loss)', () => {
    const res = selectDoorInstallerInput(manifest, wallMap);
    // eligible (25) == mapped (25) + failedMapping (0) by construction.
    expect(res.installationEligible).toBe(res.mapped + res.failedMapping);
    expect(res.failureReasons).toHaveLength(res.failedMapping);
  });
});
