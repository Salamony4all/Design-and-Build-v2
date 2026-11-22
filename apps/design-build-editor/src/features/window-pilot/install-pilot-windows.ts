'use client';

import { WindowNode } from '@pascal-app/core';

export type PilotWindowInstallResult = {
  anonymousRegionId: string;
  physicalWallId: string;
  livePascalWallNodeId: string | null;
  windowNodeId: string | null;
  mappingStatus: 'EXACT_RUNTIME_WALL_MAPPING' | 'FAILED_RUNTIME_HOST' | 'SKIPPED';
  widthM: number;
  /** Wall-local position written to WindowNode.position (convention verified). */
  position: [number, number, number];
  rotation: [number, number, number];
  /** World centre, computed for scene-graph audit only (NOT written to the node). */
  worldCentre: [number, number, number];
};

export type PilotWindowInstallerContext = {
  nodes: Record<string, unknown>;
  createNodes: (ops: { node: unknown; parentId?: string }[]) => void;
  onProgress?: (installed: number, total: number) => void;
};

const EXPECTED_SOURCE_HASH = 'bf59724a54e4b3e15d01c4e5011cdf6b394bbda388cfd2f87ab20e8fee9972d7';

const PILOT_DEFAULTS = {
  height: 1.2,
  sillHeightM: 0.9,
  frameThickness: 0.06,
  frameDepth: 0.07,
  columnRatios: [1],
  rowRatios: [1],
} as const;

export const PILOT_MAPPING_SOURCE_HASH = EXPECTED_SOURCE_HASH;

const AR_23 = {
  anonymousRegionId: 'AR-23',
  openingRegionId: 'or_r1.3.1_25',
  physicalWallId: 'fr65',
  pascalWallNodeId: 'wall_b2e656e4',
  widthM: 1.984903197126658,
  // Wall-local interval in METRES FROM ENDPOINT A (verified from Gate B.1 corrected mapping).
  intervalStartM: 0,
  intervalEndM: 1.984903197126658,
  // Extracted opening world geometry (Gate B.1 corrected mapping) — used by the
  // geometric host resolver so we NEVER trust the stored physicalWallId.
  worldCentre: [21.38489279150079, 0, 19.299096546295637] as [number, number, number],
  planRotationRadians: 1.5707963267948966,
};

const AR_05 = {
  anonymousRegionId: 'AR-05',
  openingRegionId: 'or_r1.3.1_12',
  physicalWallId: 'fr47',
  pascalWallNodeId: 'wall_b0e0ec20',
  widthM: 1.9828027704630318,
  intervalStartM: 0,
  intervalEndM: 1.9828027704630318,
  worldCentre: [9.277184881724025, 0, 7.7881317293312975] as [number, number, number],
  planRotationRadians: 1.5707963267948966,
};

const AR_15 = {
  anonymousRegionId: 'AR-15',
  openingRegionId: 'or_r1.3.1_6',
  physicalWallId: 'fr21',
  pascalWallNodeId: 'wall_43725ded',
  widthM: 0.9472924252953678,
  // CRITICAL: AR-15's validated interval does NOT start at endpoint A.
  // Official Gate B.1: [8.578142494248963, 9.525434919544331] -> centre 9.0518m from A.
  intervalStartM: 8.578142494248963,
  intervalEndM: 9.525434919544331,
  worldCentre: [30.861631553972458, 0, 15.84851905099643] as [number, number, number],
  planRotationRadians: 1.5707963267948966,
};

const PILOTS = [AR_23, AR_05, AR_15] as const;

/**
 * Commercial-output exclusion predicate.
 *
 * Pilot windows MUST NOT silently enter BOQ, schedules, or exports. They are
 * flagged by `status: 'HUMAN_CONFIRMED_PILOT'` and
 * `metadata.automaticPromotionAllowed: false` (set below). Downstream BOQ /
 * schedule / export stages should filter any node where this returns true.
 */
export function isPilotCommercialExcluded(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;
  if (n.status !== 'HUMAN_CONFIRMED_PILOT') return false;
  const meta = (n.metadata ?? {}) as Record<string, unknown>;
  if (meta.automaticPromotionAllowed === true) return false;
  if (meta.anonymousRegionId == null && meta.pilotDefaultsUsed !== true) return false;
  return true;
}

function isWallLike(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;
  return n.type === 'wall';
}

/**
 * Geometric host resolution (user-mandated, replaces trust in stored host IDs).
 *
 * Given an opening's world centre + direction + width, evaluate EVERY live wall
 * and return the unique wall whose corridor the opening lies on, whose finite
 * segment contains the opening endpoints, and whose direction is parallel to the
 * opening. Ranking (per spec): perpendicular distance, finite-interval
 * containment, parallel-angle difference, and exterior-boundary length as a
 * tie-breaker. Returns UNIQUE_HOST | AMBIGUOUS_HOST | NO_HOST.
 *
 * The opening world geometry comes from the authoritative Gate B.1 corrected
 * mapping (projectEndpointA/B, pascalWorldCentre, planRotationRadians,
 * wallLocalIntervalMeters.width) — never from WA text and never from stored
 * runtime wall ids.
 */
type HostResolution =
  | { status: 'UNIQUE_HOST'; wallId: string; physicalWallId: string; score: number; perp: number }
  | { status: 'AMBIGUOUS_HOST'; candidates: { physicalWallId: string; perp: number }[] }
  | { status: 'NO_HOST' };

const HOST_TOL_PARALLEL = 0.12;   // rad
const HOST_TOL_PERP = 0.20;       // m beyond half-thickness
const HOST_TOL_CONTAIN = 0.05;    // m beyond interval endpoints

function resolveGeometricHost(
  ctx: PilotWindowInstallerContext,
  opening: { worldCentre: [number, number, number]; planRotationRadians: number; widthM: number },
): HostResolution {
  const cx = opening.worldCentre[0];
  const cz = opening.worldCentre[2];
  const openAxis = opening.planRotationRadians;
  const halfW = opening.widthM / 2;
  const candidates: { wallId: string; physicalWallId: string; perp: number; contain: number; score: number }[] = [];

  for (const [id, node] of Object.entries(ctx.nodes)) {
    if (!isWallLike(node)) continue;
    const n = node as Record<string, unknown>;
    const start = (n.start ?? [0, 0]) as [number, number];
    const end = (n.end ?? [0, 0]) as [number, number];
    const L = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (L < 1e-6) continue;
    const wdir = (n.orientationRadians ?? Math.atan2(end[1] - start[1], end[0] - start[0])) as number;
    // (1) wall direction parallel to opening direction
    let par = Math.abs(((wdir - openAxis) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    par = Math.min(par, 2 * Math.PI - par);
    if (par > HOST_TOL_PARALLEL) continue;
    // (2) opening centre lies on the wall corridor
    const ex = (end[0] - start[0]) / L, ez = (end[1] - start[1]) / L;
    let t = ((cx - start[0]) * ex + (cz - start[1]) * ez) / L;
    t = Math.max(0, Math.min(1, t));
    const projX = start[0] + t * L * ex, projZ = start[1] + t * L * ez;
    const perp = Math.hypot(cx - projX, cz - projZ);
    const halfT = ((n.thicknessM as number) ?? 0.2) / 2;
    if (perp > halfT + HOST_TOL_PERP) continue;
    // (3) opening endpoints project inside the finite segment
    const alongCentre = t * L;
    const startAlong = alongCentre - halfW, endAlong = alongCentre + halfW;
    const contain = Math.max(0, -startAlong, endAlong - L);
    if (contain > HOST_TOL_CONTAIN) continue;
    // (4) width fits inside wall
    if (opening.widthM > L + HOST_TOL_CONTAIN) continue;
    // ranking: prefer smallest perp + smallest containment + smaller angle; long
    // exterior walls act as a mild tie-breaker (negative contribution).
    const score = perp + par * 2 + contain * 5 - L * 0.001;
    const meta = (n.metadata ?? {}) as Record<string, unknown>;
    const phys = (meta.physicalWallId ?? meta.physical_wall_id ?? id) as string;
    candidates.push({ wallId: id, physicalWallId: phys, perp, contain, score });
  }

  if (candidates.length === 0) return { status: 'NO_HOST' };
  candidates.sort((a, b) => a.score - b.score);
  if (candidates.length === 1) {
    return { status: 'UNIQUE_HOST', wallId: candidates[0].wallId, physicalWallId: candidates[0].physicalWallId, score: candidates[0].score, perp: candidates[0].perp };
  }
  const [best, second] = candidates;
  // Accept unique only if clearly better than the runner-up.
  if (best.perp <= HOST_TOL_PERP && best.contain < 1e-6 && (second.perp > HOST_TOL_PERP || second.contain >= 1e-6 || second.physicalWallId === best.physicalWallId)) {
    return { status: 'UNIQUE_HOST', wallId: best.wallId, physicalWallId: best.physicalWallId, score: best.score, perp: best.perp };
  }
  return { status: 'AMBIGUOUS_HOST', candidates: candidates.slice(0, 3).map((c) => ({ physicalWallId: c.physicalWallId, perp: c.perp })) };
}

function readLiveWallData(node: unknown) {
  const n = node as Record<string, unknown>;
  const start = (n.start ?? [0, 0]) as [number, number];
  const end = (n.end ?? [0, 0]) as [number, number];
  return { start, end };
}

function wallAngleRad(start: [number, number], end: [number, number]) {
  return Math.atan2(end[1] - start[1], end[0] - start[0]);
}

function wallLengthM(start: [number, number], end: [number, number]) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Hosted-coordinate convention (Step 4, verified from Pascal source):
 *
 *   `WindowNode.position` is WALL-LOCAL Cartesian, in the frame of the host
 *   WallNode (parent). The wall mesh is placed at world
 *   `(start.x, 0, start.y)` with `rotation.y = -atan2(dy, dx)`
 *   (wall-system.js:571-573) and the window is rendered as a CHILD of that
 *   wall mesh (wall-renderer.js:15, window-renderer.js:20,
 *   window-system.js:43). Therefore:
 *     - local +X = along the wall from endpoint A (start) toward endpoint B
 *     - local +Y = up (world up; Y-rotation preserves Y)
 *     - local +Z = wall normal / depth (centred in thickness when 0)
 *   So a window whose validated interval is [start, end] metres FROM ENDPOINT A
 *   sits at local `[centreFromA, y, 0]` where centreFromA = (start+end)/2, with
 *   rotation `[0,0,0]` (aligned to wall). IMPORTANT: the interval is measured
 *   from endpoint A, and `start` is frequently > 0 (the opening is not anchored
 *   at the wall end) — so centreFromA must be (start+end)/2, never the bare
 *   centre-of-interval offset. See AR-15 (interval [8.578, 9.525], centre 9.052).
 *
 * We deliberately do NOT write world coordinates into `position` (that would be
 * double-transformed by the parent wall's world matrix) — see checkpoint §4.
 */
function computeWallLocalWindowTransform(
  start: [number, number],
  end: [number, number],
  intervalStartM: number,
  intervalEndM: number,
  windowCentreY: number,
): {
  localPosition: [number, number, number];
  localRotation: [number, number, number];
  worldCentre: [number, number, number];
  centreFromA: number;
} {
  const angle = wallAngleRad(start, end);
  // Centre measured FROM ENDPOINT A (wall-local +X origin). This is the only
  // convention consistent with the wall mesh's local frame (wall-system.js:667
  // worldToLocal rotates around wallStart). For intervals not anchored at A,
  // centreFromA = (start+end)/2, NOT the interval-centre offset alone.
  const centreFromA = (intervalStartM + intervalEndM) / 2;
  const d = centreFromA;
  // World centre (for reporting / scene-graph audit only).
  const worldCentre: [number, number, number] = [
    start[0] + d * Math.cos(angle),
    windowCentreY,
    start[1] + d * Math.sin(angle),
  ];
  // Wall-local position: +X along wall from endpoint A, +Y up, +Z centred in
  // wall thickness.
  const localPosition: [number, number, number] = [d, windowCentreY, 0];
  const localRotation: [number, number, number] = [0, 0, 0];
  return { localPosition, localRotation, worldCentre, centreFromA };
}

function buildWindowNodeAndContext(
  draft: typeof AR_23,
  liveId: string,
  start: [number, number],
  end: [number, number],
) {
  const windowCentreY = PILOT_DEFAULTS.sillHeightM + PILOT_DEFAULTS.height / 2;
  const { localPosition, localRotation, worldCentre, centreFromA } = computeWallLocalWindowTransform(
    start,
    end,
    draft.intervalStartM,
    draft.intervalEndM,
    windowCentreY,
  );
  const node = WindowNode.parse({
    id: `window_${draft.anonymousRegionId.toLowerCase()}_${liveId.slice(-6)}`,
    name: `${draft.anonymousRegionId} pilot window`,
    parentId: liveId,
    wallId: liveId,
    status: 'HUMAN_CONFIRMED_PILOT',
    metadata: {
      openingRegionId: draft.openingRegionId,
      anonymousRegionId: draft.anonymousRegionId,
      physicalWallId: draft.physicalWallId,
      sourceMappingHash: EXPECTED_SOURCE_HASH,
      pilotDefaultsUsed: true,
      automaticPromotionAllowed: false,
      positionSource: 'PILOT_DEFAULT_NOT_SOURCE_MEASURED',
      heightSource: 'PILOT_DEFAULT_NOT_SOURCE_MEASURED',
      verticalPropertiesStatus: 'PILOT_DEFAULT_NOT_SOURCE_MEASURED',
      windowCentreY,
      centreFromA,
      worldCentre,
    },
    width: draft.widthM,
    height: PILOT_DEFAULTS.height,
    frameThickness: PILOT_DEFAULTS.frameThickness,
    frameDepth: PILOT_DEFAULTS.frameDepth,
    columnRatios: PILOT_DEFAULTS.columnRatios,
    rowRatios: PILOT_DEFAULTS.rowRatios,
    position: localPosition,
    rotation: localRotation,
  });
  return { node, localPosition, localRotation, worldCentre };
}

export function installPilotWindows(ctx: PilotWindowInstallerContext): PilotWindowInstallResult[] {
  const results: PilotWindowInstallResult[] = [];
  const idsToCreate: { node: unknown; parentId: string }[] = [];

  for (const draft of PILOTS) {
    // Geometric host resolution: recompute the host wall from the 70-wall model
    // using the extracted opening world geometry. Never trust stored host IDs.
    const res = resolveGeometricHost(ctx, {
      worldCentre: draft.worldCentre,
      planRotationRadians: draft.planRotationRadians,
      widthM: draft.widthM,
    });

    let liveId: string | null = null;
    let resolvedPhys: string | null = null;
    if (res.status === 'UNIQUE_HOST') {
      liveId = res.wallId;
      resolvedPhys = res.physicalWallId;
    } else if (res.status === 'AMBIGUOUS_HOST') {
      // Do not install on an ambiguous host (spec §6).
      results.push({
        anonymousRegionId: draft.anonymousRegionId,
        physicalWallId: draft.physicalWallId,
        livePascalWallNodeId: null,
        windowNodeId: null,
        mappingStatus: 'FAILED_RUNTIME_HOST',
        widthM: draft.widthM,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        worldCentre: [0, 0, 0],
      });
      if (typeof console !== 'undefined') {
        console.warn(`[PilotWindowInstaller] ${draft.anonymousRegionId} AMBIGUOUS_HOST:`, res.candidates);
      }
      continue;
    }

    if (!liveId) {
      results.push({
        anonymousRegionId: draft.anonymousRegionId,
        physicalWallId: draft.physicalWallId,
        livePascalWallNodeId: null,
        windowNodeId: null,
        mappingStatus: 'FAILED_RUNTIME_HOST',
        widthM: draft.widthM,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        worldCentre: [0, 0, 0],
      });
      continue;
    }

    const wallNode = ctx.nodes[liveId];
    const { start, end } = readLiveWallData(wallNode);
    const wl = wallLengthM(start, end);
    // Validated intervals are within the finite host wall; clamp defensively.
    const draftClamped = {
      ...draft,
      intervalStartM: Math.max(0, Math.min(wl, draft.intervalStartM)),
      intervalEndM: Math.max(0, Math.min(wl, draft.intervalEndM)),
    };
    const { node: windowNode, localPosition, localRotation, worldCentre } =
      buildWindowNodeAndContext(draftClamped, liveId, start, end);

    idsToCreate.push({ node: windowNode, parentId: liveId });
    results.push({
      anonymousRegionId: draft.anonymousRegionId,
      physicalWallId: resolvedPhys ?? draft.physicalWallId,
      livePascalWallNodeId: liveId,
      windowNodeId: (windowNode as Record<string, unknown>).id as string,
      mappingStatus: 'EXACT_RUNTIME_WALL_MAPPING',
      widthM: draft.widthM,
      position: localPosition,
      rotation: localRotation,
      worldCentre,
    });
  }

  if (idsToCreate.length > 0) {
    ctx.createNodes(idsToCreate);
  }

  let installed = 0;
  for (const r of results) {
    if (r.mappingStatus === 'EXACT_RUNTIME_WALL_MAPPING') {
      installed += 1;
      if (typeof ctx.onProgress === 'function') {
        ctx.onProgress(installed, results.length);
      }
    }
  }

  // Single, consolidated debug record (no per-pilot console spam). This is a
  // dev-only diagnostic; production keeps the scene tree as the source of truth.
  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log(
      `[PilotWindowInstaller] installed ${installed}/${results.length}`,
      results.map((r) => ({
        region: r.anonymousRegionId,
        wall: r.physicalWallId,
        host: r.livePascalWallNodeId,
        window: r.windowNodeId,
        status: r.mappingStatus,
      })),
    );
  }

  return results;
}

export function getPilotInstallerStageText(installed: number, total: number): string {
  if (installed <= 0) return 'Installing confirmed windows';
  if (installed >= total) return 'Installed confirmed windows';
  return `Installing confirmed windows (${installed}/${total})`;
}

/**
 * Change Set 2 (Gate C, live): install windows detected by the REAL geometric
 * window extractor (harness/extract-live-windows.ts) instead of the hard-coded
 * pilot fixture.
 *
 * Each WindowInstallSpec already carries the detector's host physicalWallId and a
 * wall-local interval (centre + width, METERS from endpoint A). We resolve the
 * live WallNode by EXACT_RUNTIME_WALL_MAPPING (metadata.physicalWallId) — the
 * user-mandated trustless approach — then place the WindowNode via the SAME
 * validated wall-local transform used for the pilots (computeWallLocalWindowTransform).
 *
 * A geometric sanity check is applied: the spec's wall-local interval must lie
 * within the resolved host wall's finite segment (it always will, since the
 * detector interval is clipped to the host wall). This keeps the install on par
 * with walls: deterministic, source-derived, no WA text, no stored-id trust.
 */
export type LiveWindowInstallResult = {
  slotId: string;
  physicalWallId: string;
  livePascalWallNodeId: string | null;
  windowNodeId: string | null;
  mappingStatus: 'EXACT_RUNTIME_WALL_MAPPING' | 'FAILED_RUNTIME_HOST';
  widthM: number;
  position: [number, number, number];
  rotation: [number, number, number];
  worldCentre: [number, number, number];
};

/**
 * Change Set 2 (Gate C, live): install windows detected by the REAL geometric
 * window extractor (packages/extraction-mupdf window-pure.ts) instead of the
 * hard-coded pilot fixture.
 *
 * FIX (placement bug): The rendered WallNode is placed in WORLD space by its
 * `start`/`end` endpoints and carries NO child-inheriting rotation frame (see
 * harness/build-live-import.ts — it sets orientationRadians:0 and no rotation).
 * The old code wrote a WALL-LOCAL `position=[centreFromA,1.5,0]`, which Pascal
 * then read in WORLD space — so windows floated near the origin, detached from
 * their walls.
 *
 * The fix reuses the PROVEN WALL concept: a WindowContract carries WORLD-meter
 * `startM`/`endM` (produced by result-adapter via the shared coordinate-frame,
 * exactly like walls). We place the window in WORLD space — `position` is the
 * world midpoint of the opening, and `rotation.y` aligns the window frame to
 * the wall's world yaw. No reliance on inherited wall rotation. This is the
 * same world-space convention the WallNode itself uses, so windows sit exactly
 * on their assigned walls.
 */
export interface LiveWindowContract {
  id: string;
  /** selectedPhysicalWallId — the neutral accepted-wall id (NOT a Pascal runtime id). */
  wallId: string;
  /** Opening interval START, metres FROM the host wall endpoint A (wall-local +X origin). */
  intervalStartM: number;
  /** Opening interval END, metres FROM the host wall endpoint A. */
  intervalEndM: number;
  widthM: number;
  sillM?: number;
  headM?: number;
  provenance?: {
    sourceKind?: string;
    sourcePrimitiveIds?: string[];
    confidence?: number;
    extractionType?: string;
    note?: string;
  };
}

export function installLiveWindows(
  ctx: PilotWindowInstallerContext,
  windows: LiveWindowContract[],
): LiveWindowInstallResult[] {
  const results: LiveWindowInstallResult[] = [];
  const idsToCreate: { node: unknown; parentId: string }[] = [];

  for (const win of windows) {
    // Resolve the live WallNode by EXACT_RUNTIME_WALL_MAPPING: match the
    // neutral accepted-wall id (selectedPhysicalWallId) against the live node's
    // metadata.physicalWallId. Never trust stored runtime ids / WA text.
    let liveId: string | null = null;
    const targetNorm = win.wallId.replace(/^(w_|fr|wall_)/i, '');
    for (const [id, node] of Object.entries(ctx.nodes)) {
      if (!isWallLike(node)) continue;
      const meta = ((node as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>;
      const phys = (meta.physicalWallId ?? meta.physical_wall_id ?? id) as string;
      const physNorm = phys.replace(/^(w_|fr|wall_)/i, '');
      if (phys === win.wallId || id === win.wallId || (physNorm.length > 0 && physNorm === targetNorm)) {
        liveId = id;
        break;
      }
    }

    if (!liveId) {
      results.push({
        slotId: win.id,
        physicalWallId: win.wallId,
        livePascalWallNodeId: null,
        windowNodeId: null,
        mappingStatus: 'FAILED_RUNTIME_HOST',
        widthM: win.widthM,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        worldCentre: [0, 0, 0],
      });
      if (typeof console !== 'undefined') {
        console.warn(`[LiveWindowInstaller] ${win.id} NO_HOST_WALL wallId=${win.wallId}`);
      }
      continue;
    }

    const wallNode = ctx.nodes[liveId] as Record<string, unknown>;
    const { start, end } = readLiveWallData(wallNode);
    const wl = wallLengthM(start, end);
    // Clamp the wall-local interval defensively within the finite host wall.
    const intervalStartM = Math.max(0, Math.min(wl, win.intervalStartM));
    const intervalEndM = Math.max(0, Math.min(wl, win.intervalEndM));
    const sillM = win.sillM ?? PILOT_DEFAULTS.sillHeightM;
    const heightM = (win.headM ?? sillM + PILOT_DEFAULTS.height) - sillM;
    const windowCentreY = sillM + heightM / 2;

    // WALL-LOCAL placement (the renderer expects wall-local position; writing
    // world coords would double-transform under the parent wall's world matrix).
    // centreFromA is measured FROM endpoint A, not the bare interval-centre offset
    // — see computeWallLocalWindowTransform / the verified pilot convention.
    const { localPosition, localRotation, worldCentre, centreFromA } = computeWallLocalWindowTransform(
      start,
      end,
      intervalStartM,
      intervalEndM,
      windowCentreY,
    );

    const node = WindowNode.parse({
      id: `window_${win.id.replace(/[^a-zA-Z0-9_]/g, '_').slice(-12)}_${liveId.slice(-6)}`,
      name: `Window ${win.wallId} ${win.id.slice(-6)}`,
      parentId: liveId,
      wallId: liveId,
      // Production (not pilot) window: participates in BOQ / schedules / exports.
      status: 'AUTO_EXTRACTED_WINDOW',
      metadata: {
        openingRegionId: win.id,
        physicalWallId: win.wallId,
        sourceMappingHash: 'PURE_MUPDF_WINDOW_EXTRACTOR',
        sourceHash: 'PURE_MUPDF_WINDOW_EXTRACTOR',
        sourceSegmentIds: (win.provenance?.sourcePrimitiveIds ?? []) as string[],
        sourceOperationIds: (win.provenance?.sourcePrimitiveIds ?? []) as string[],
        automaticExtraction: true,
        pilotDefaultsUsed: false,
        automaticPromotionAllowed: true,
        positionSource: 'WALL_LOCAL_INTERVAL_FROM_ENDPOINT_A',
        heightSource: 'WINDOW_CONTRACT_SILL_HEAD',
        verticalPropertiesStatus: 'DEFAULT_NOT_SOURCE_MEASURED',
        windowCentreY,
        centreFromA,
        worldCentre,
        wallLocalIntervalStartM: intervalStartM,
        wallLocalIntervalEndM: intervalEndM,
      },
      width: win.widthM,
      height: heightM,
      frameThickness: PILOT_DEFAULTS.frameThickness,
      frameDepth: PILOT_DEFAULTS.frameDepth,
      columnRatios: PILOT_DEFAULTS.columnRatios,
      rowRatios: PILOT_DEFAULTS.rowRatios,
      position: localPosition,
      rotation: localRotation,
    } as never);

    idsToCreate.push({ node, parentId: liveId });

    // Append the WindowNode id to the host wall's children (Pascal scene-graph
    // convention: window is a child of its wall mesh).
    const children = (wallNode.children as string[] | undefined) ?? [];
    if (!children.includes((node as Record<string, unknown>).id as string)) {
      children.push((node as Record<string, unknown>).id as string);
      wallNode.children = children;
    }

    results.push({
      slotId: win.id,
      physicalWallId: win.wallId,
      livePascalWallNodeId: liveId,
      windowNodeId: (node as Record<string, unknown>).id as string,
      mappingStatus: 'EXACT_RUNTIME_WALL_MAPPING',
      widthM: win.widthM,
      position: localPosition,
      rotation: localRotation,
      worldCentre,
    });
  }

  if (idsToCreate.length > 0) {
    ctx.createNodes(idsToCreate as never);
  }

  let installed = 0;
  for (const r of results) {
    if (r.mappingStatus === 'EXACT_RUNTIME_WALL_MAPPING') installed += 1;
  }
  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log(
      `[LiveWindowInstaller] installed ${installed}/${results.length}`,
      results.map((r) => ({ slot: r.slotId, wall: r.physicalWallId, host: r.livePascalWallNodeId, window: r.windowNodeId, status: r.mappingStatus })),
    );
  }
  return results;
}
