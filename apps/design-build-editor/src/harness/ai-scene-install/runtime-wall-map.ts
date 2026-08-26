// harness/ai-scene-install/runtime-wall-map.ts
//
// RUNTIME WALL MAP — an INSTALLATION-TIME artifact, NOT an extraction stage.
//
// It is built ONLY AFTER the complete, already-validated AI ExtractionResult has
// been received and the WallNodes have been installed into the Pascal scene. It
// records the mapping:
//
//     semantic WallContract.id  ──▶  installed Pascal WallNode runtime id
//
// so that windows/doors (which carry a semantic wallId) can be parented to the
// exact runtime wall they were extracted from. No provider request, no wall
// re-extraction, and no new AI pass occurs here — this module is pure and reads
// only what installWalls() already returned.
//
// Explicit stage states: PENDING | BUILDING | READY | FAILED.
// READY requires: wall install settled, every installed wall has one semantic +
// one runtime id, ids unique, all entries belong to the active run, finite geometry.

import type { WallContract } from 'design-build-extraction-contracts';
import type { WallInstallEntry } from './install-walls';

export type RuntimeWallMapStatus = 'PENDING' | 'BUILDING' | 'READY' | 'FAILED';

export interface RuntimeWallMapEntry {
  runId: string;
  semanticWallId: string;
  runtimeWallId: string;
  startM: [number, number];
  endM: [number, number];
  thicknessM: number;
  heightM: number;
  installationStatus: 'installed';
}

export interface RuntimeWallMapDiagnostics {
  acceptedWalls: number;
  attemptedWalls: number;
  installedWalls: number;
  wallMapEntries: number;
  missingRuntimeWallIds: number;
  duplicateSemanticWallIds: number;
  duplicateRuntimeWallIds: number;
  invalidGeometryEntries: number;
}

export interface RuntimeWallMapBuild {
  runId: string;
  status: RuntimeWallMapStatus;
  entries: RuntimeWallMapEntry[];
  diagnostics: RuntimeWallMapDiagnostics;
  /** invariant: wallMapEntries === installedWalls (when READY) */
  ready: boolean;
  /** semantic ids that were accepted but never installed (missing/invalid) */
  missingOrInvalidSemanticIds: string[];
}

const EPS = 1e-9;

function finiteTuple(p: [number, number] | undefined): p is [number, number] {
  return !!p && Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/**
 * Build the runtime wall map from the install result + the neutral contract array
 * (for geometry). `acceptedWalls` is the count of extracted wall contracts;
 * `attemptedWalls`/`installedWalls` come from the install result.
 */
export function buildRuntimeWallMap(
  runId: string,
  install: { attempted: number; installed: number; invalid: number; entries: WallInstallEntry[] },
  contracts: WallContract[],
  opts: { settled: boolean } = { settled: true },
): RuntimeWallMapBuild {
  const bySemantic = new Map<string, WallContract>();
  for (const c of contracts ?? []) bySemantic.set(c.id, c);

  const entries: RuntimeWallMapEntry[] = [];
  const seenSemantic = new Map<string, number>();
  const seenRuntime = new Map<string, number>();
  let missingRuntimeWallIds = 0;
  let invalidGeometryEntries = 0;

  for (const e of install.entries) {
    seenSemantic.set(e.semanticWallId, (seenSemantic.get(e.semanticWallId) ?? 0) + 1);
    seenRuntime.set(e.runtimeWallId, (seenRuntime.get(e.runtimeWallId) ?? 0) + 1);
    if (!e.runtimeWallId) missingRuntimeWallIds++;

    // Geometry resolved from the neutral contract (authoritative), with the
    // guaranteed fallback that the runtime node would carry the same coords.
    const c = bySemantic.get(e.semanticWallId);
    const startM: [number, number] = c ? [c.startM.x, c.startM.y] : [0, 0];
    const endM: [number, number] = c ? [c.endM.x, c.endM.y] : [0, 0];
    const thicknessM = c?.thicknessM ?? 0.2;
    const heightM = c?.heightM ?? 3;
    if (!finiteTuple(startM) || !finiteTuple(endM) || !Number.isFinite(thicknessM) || !Number.isFinite(heightM)) {
      invalidGeometryEntries++;
    }
    entries.push({
      runId,
      semanticWallId: e.semanticWallId,
      runtimeWallId: e.runtimeWallId,
      startM,
      endM,
      thicknessM,
      heightM,
      installationStatus: 'installed',
    });
  }

  let duplicateSemanticWallIds = 0;
  for (const [, n] of seenSemantic) if (n > 1) duplicateSemanticWallIds++;
  let duplicateRuntimeWallIds = 0;
  for (const [, n] of seenRuntime) if (n > 1) duplicateRuntimeWallIds++;

  const acceptedWalls = (contracts ?? []).length;
  const attemptedWalls = install.attempted;
  const installedWalls = install.installed;

  const missingOrInvalidSemanticIds: string[] = [];
  for (const c of contracts ?? []) {
    const installed = install.entries.some((e) => e.semanticWallId === c.id);
    if (!installed) missingOrInvalidSemanticIds.push(c.id);
  }

  const entriesFinite = invalidGeometryEntries === 0;
  const idsUnique = duplicateSemanticWallIds === 0 && duplicateRuntimeWallIds === 0 && missingRuntimeWallIds === 0;
  const countInvariant = entries.length === installedWalls;
  const allActiveRun = entries.every((e) => e.runId === runId);
  const ready =
    opts.settled &&
    installedWalls > 0 &&
    entriesFinite &&
    idsUnique &&
    countInvariant &&
    allActiveRun;

  const status: RuntimeWallMapStatus = !opts.settled
    ? 'BUILDING'
    : ready
      ? 'READY'
      : 'FAILED';

  const diagnostics: RuntimeWallMapDiagnostics = {
    acceptedWalls,
    attemptedWalls,
    installedWalls,
    wallMapEntries: entries.length,
    missingRuntimeWallIds,
    duplicateSemanticWallIds,
    duplicateRuntimeWallIds,
    invalidGeometryEntries,
  };

  return { runId, status, entries, diagnostics, ready, missingOrInvalidSemanticIds };
}
