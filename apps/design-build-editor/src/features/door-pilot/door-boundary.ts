'use client';

/**
 * Pure client-side boundary between the route door manifest and the Pascal
 * DoorNode installer.
 *
 * This is the single source of truth for "which accepted doors reach the
 * installer". It deliberately does NOT touch extraction, geometry thresholds,
 * or hinge/swing behavior.
 *
 * Eligibility rule (the boundary fix): a door is withheld from auto-install
 * ONLY when it is itself flagged non-installable by the extractor
 * (`automaticInstallationAllowed === false`). Candidate-level review records
 * that merely *reference* an accepted assembly via `relatedAcceptedAssemblyId`
 * must NOT drop the accepted door — the extractor already chose that assembly as
 * the install target. Excluding it would discard a valid door.
 */

export type BoundaryAcceptedDoor = {
  doorAssemblyId: string;
  selectedPhysicalWallId?: string;
  wallLocalInterval?: { startM: number; endM: number };
  widthM?: number;
  automaticInstallationAllowed?: boolean;
  evidenceMode?: string;
  [key: string]: unknown;
};

export type BoundaryReviewRecord = {
  doorAssemblyId?: string;
  automaticInstallationAllowed?: boolean;
  relatedAcceptedAssemblyId?: string;
  reviewReason?: string;
  [key: string]: unknown;
};

export type BoundaryDoorManifest = {
  accepted?: BoundaryAcceptedDoor[];
  review?: BoundaryReviewRecord[];
  rejected?: unknown[];
  diagnostics?: unknown[];
};

export type RuntimeWallEntry = { liveNodeId: string; type: 'wall' | string };

export type RuntimeWallMap = Record<string, RuntimeWallEntry>;

export type DoorBoundaryFailure = { doorAssemblyId: string; reason: string };

export type DoorBoundaryResult = {
  accepted: number;
  installationEligible: number;
  mapped: number;
  failedMapping: number;
  installerInput: number;
  failureReasons: DoorBoundaryFailure[];
  /** The eligible accepted doors (installation input), for downstream mapping. */
  installerDoors: BoundaryAcceptedDoor[];
};

/** A door is installation-eligible when it is not itself flagged non-installable. */
export function isInstallationEligible(door: BoundaryAcceptedDoor): boolean {
  return door.automaticInstallationAllowed !== false;
}

/** The accepted doors that should reach the installer (eligibility only). */
export function selectEligibleDoors(manifest: BoundaryDoorManifest): BoundaryAcceptedDoor[] {
  const accepted = manifest.accepted ?? [];
  return accepted.filter(isInstallationEligible);
}

/**
 * Full route-to-installer boundary.
 *
 * @param manifest        route door manifest (2-category: accepted + review).
 * @param runtimeWallMap  finalized runtime wall map: physicalWallId -> live node.
 */
export function selectDoorInstallerInput(
  manifest: BoundaryDoorManifest,
  runtimeWallMap: RuntimeWallMap,
): DoorBoundaryResult {
  const accepted = manifest.accepted ?? [];
  const eligible = selectEligibleDoors(manifest);

  const failureReasons: DoorBoundaryFailure[] = [];
  let mapped = 0;
  let failedMapping = 0;

  for (const d of eligible) {
    const wallId = d.selectedPhysicalWallId;
    const host = wallId !== undefined ? runtimeWallMap[wallId] : undefined;
    if (host && host.type === 'wall') {
      mapped += 1;
    } else {
      failedMapping += 1;
      failureReasons.push({
        doorAssemblyId: d.doorAssemblyId,
        reason: 'MISSING_RUNTIME_HOST',
      });
    }
  }

  return {
    accepted: accepted.length,
    installationEligible: eligible.length,
    mapped,
    failedMapping,
    installerInput: eligible.length,
    failureReasons,
    installerDoors: eligible,
  };
}
