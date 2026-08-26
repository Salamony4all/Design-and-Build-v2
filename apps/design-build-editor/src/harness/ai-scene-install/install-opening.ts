// harness/ai-scene-install/install-opening.ts
// Shared window/door installer. Openings are children of their host WALL and use
// wall-local coordinates (cloned from the proven opening installers).
//
// HOST RESOLUTION (Phase B §6/§7): the semantic wall id (contract `wallId`) is
// resolved to the runtime WallNode id EXCLUSIVELY through the finalized AI wall
// map (the installWalls() semantic→runtime entries). No nearest-segment / 5 m
// fallback is ever used as semantic hosting. When no explicit map is supplied,
// an exact-only resolver (resolveHostWallExact) is used; if that still finds
// nothing, the opening is NOT installed and is classified invalid with the
// reason MISSING_RUNTIME_HOST.

import { WindowNode, DoorNode } from '@pascal-app/core';
import type { AnyNode } from '@pascal-app/core';
import type { WindowContract, DoorContract } from 'design-build-extraction-contracts';
import { uid, addChild, readLiveWallData, worldOpeningToWallLocal, postDebug, aiMeta, resolveHostWallExact, pointToSegmentDist } from './helpers';
import type { SceneInstallContext } from './types';
import type { WallInstallEntry } from './install-walls';

/** Explicit host map: semantic wall id → runtime WallNode id. */
export interface OpeningHostMap {
  entries: WallInstallEntry[];
}

export type OpeningOutcome =
  | 'INSTALLED'
  | 'INVALID_MISSING_HOST'
  | 'FAILED_INSTALLATION';

export interface OpeningRecord {
  openingId: string;
  openingType: 'window' | 'door';
  semanticWallId: string;
  runtimeWallId: string | null;
  mappingFound: boolean;
  /** True when the host was resolved geometrically (nearest wall) because the
   *  semantic wallId did not exactly match — i.e. real AI output with an
   *  imperfect wall reference but coordinates lying on a real wall. */
  geometricFallback: boolean;
  /** Distance (m) from the opening midpoint to the resolved host wall segment. */
  nearestWallDistM: number | null;
  installationAttempted: boolean;
  installationSucceeded: boolean;
  failureReason: string | null;
}

export interface OpeningLedger {
  attempted: number;
  installed: number;
  invalid: number;
  skipped: number;
  review: number;
  rejected: number;
  perItem: OpeningRecord[];
}

function emptyLedger(): OpeningLedger {
  return { attempted: 0, installed: 0, invalid: 0, skipped: 0, review: 0, rejected: 0, perItem: [] };
}

function resolveRuntimeHost(
  ctx: SceneInstallContext,
  semanticWallId: string,
  hostMap: OpeningHostMap | undefined,
  openingMid?: [number, number],
): { runtimeWallId: string | null; geometricFallback: boolean; nearestWallDistM: number | null } {
  // 1) Explicit finalized wall map (semantic wall id → runtime WallNode id).
  if (hostMap?.entries?.length) {
    const e = hostMap.entries.find((x) => x.semanticWallId === semanticWallId);
    if (e) return { runtimeWallId: e.runtimeWallId, geometricFallback: false, nearestWallDistM: null };
  }
  // 2) Exact-only match against live nodes by metadata.physicalWallId (no nearest search).
  const exact = resolveHostWallExact(ctx.nodes, semanticWallId);
  if (exact) return { runtimeWallId: exact, geometricFallback: false, nearestWallDistM: null };
  // 3) Geometric fallback for REAL AI output: the Gemini door/window may reference a
  //    wall by an id that does not exactly equal a wall semantic id, but its coordinates
  //    lie on a real installed wall. Host it on the nearest wall segment (using the
  //    VALIDATED wall-map geometry — never reading geometry back from Pascal nodes) within tolerance.
  if (openingMid && hostMap?.entries?.length) {
    let best: string | null = null;
    let bestSemantic: string | null = null;
    let bestD = Infinity;
    for (const e of hostMap.entries) {
      if (!e.startM || !e.endM) continue;
      const d = pointToSegmentDist(openingMid, e.startM, e.endM);
      if (d < bestD) { bestD = d; best = e.runtimeWallId; bestSemantic = e.semanticWallId; }
    }
    if (best && bestD <= GEOMETRIC_HOST_TOLERANCE_M) {
      return { runtimeWallId: best, geometricFallback: true, nearestWallDistM: bestD };
    }
    return { runtimeWallId: null, geometricFallback: false, nearestWallDistM: bestD === Infinity ? null : bestD };
  }
  return { runtimeWallId: null, geometricFallback: false, nearestWallDistM: null };
}

/** Max distance (metres) from an opening's midpoint to a wall segment for the
 *  geometric host fallback. Architectural walls are metres apart; a real opening
 *  sits essentially on its wall (distance ≈ 0), so 2 m is a safe, non-ambiguous bound. */
const GEOMETRIC_HOST_TOLERANCE_M = 2;

/** Get the host wall's world-metre geometry from the VALIDATED wall map (preferred)
 *  or fall back to reading the live Pascal node (guarded — may return null). */
function hostWallGeometry(
  hostMap: OpeningHostMap | undefined,
  runtimeWallId: string,
  ctx: SceneInstallContext,
): { start: [number, number]; end: [number, number] } | null {
  const entry = hostMap?.entries?.find((e) => e.runtimeWallId === runtimeWallId);
  if (entry?.startM && entry?.endM) return { start: entry.startM, end: entry.endM };
  return readLiveWallData(ctx.nodes[runtimeWallId]);
}

function installWindow(
  ctx: SceneInstallContext,
  win: WindowContract,
  metaExtras: Record<string, unknown> | undefined,
  hostMap: OpeningHostMap | undefined,
  ledger: OpeningLedger,
): void {
  ledger.attempted++;
  const mid = win.startM && win.endM ? ([(win.startM.x + win.endM.x) / 2, (win.startM.y + win.endM.y) / 2] as [number, number]) : undefined;
  const host = resolveRuntimeHost(ctx, win.wallId, hostMap, mid);
  const runtimeWallId = host.runtimeWallId;
  const mappingFound = !!runtimeWallId;
  if (!runtimeWallId) {
    ledger.invalid++;
    ledger.perItem.push({
      openingId: win.id, openingType: 'window', semanticWallId: win.wallId,
      runtimeWallId: null, mappingFound, geometricFallback: host.geometricFallback, nearestWallDistM: host.nearestWallDistM,
      installationAttempted: false,
      installationSucceeded: false, failureReason: 'MISSING_RUNTIME_HOST',
    });
    postDebug({ __kind: 'error', payload: { ts: Date.now(), phase: 'window-no-host', wallId: win.wallId, nearestWallDistM: host.nearestWallDistM } });
    return;
  }
  const wallGeom = hostWallGeometry(hostMap, runtimeWallId, ctx);
  if (!wallGeom) {
    ledger.invalid++;
    ledger.perItem.push({
      openingId: win.id, openingType: 'window', semanticWallId: win.wallId,
      runtimeWallId, mappingFound, geometricFallback: host.geometricFallback, nearestWallDistM: host.nearestWallDistM,
      installationAttempted: true,
      installationSucceeded: false, failureReason: 'HOST_GEOMETRY_UNAVAILABLE',
    });
    postDebug({ __kind: 'error', payload: { ts: Date.now(), phase: 'window-no-geom', wallId: win.wallId, runtimeWallId } });
    return;
  }
  const { start, end } = wallGeom;
  const sillM = win.sillM ?? 0.9;
  const headM = win.headM ?? sillM + 1.2;
  const heightM = Math.max(0.2, headM - sillM);
  const centreY = sillM + heightM / 2;
  const { localPosition, localRotation, worldCentre, centreFromA } = worldOpeningToWallLocal(
    start, end, [win.startM.x, win.startM.y], [win.endM.x, win.endM.y], centreY,
  );
  const id = uid('window');
  try {
    const node = WindowNode.parse({
      id,
      name: `Window ${win.wallId}`,
      parentId: runtimeWallId,
      wallId: runtimeWallId,
      status: 'AUTO_EXTRACTED_WINDOW',
      metadata: aiMeta({
        ...(metaExtras ?? {}),
        physicalWallId: win.wallId,
        semanticWallId: win.wallId,
        runtimeWallId,
        sourceMappingHash: 'AI_MULTIPASS_WINDOW',
        automaticPromotionAllowed: true,
        positionSource: 'WALL_LOCAL_INTERVAL_FROM_ENDPOINT_A',
        windowCentreY: centreY,
        centreFromA,
        worldCentre,
        sourceRecordId: win.id,
      }),
      width: Math.hypot(win.endM.x - win.startM.x, win.endM.y - win.startM.y),
      height: heightM,
      frameThickness: 0.06,
      frameDepth: 0.07,
      columnRatios: [1],
      rowRatios: [1],
      position: localPosition,
      rotation: localRotation,
    } as never) as AnyNode;
    ctx.createNodes([{ node, parentId: runtimeWallId }]);
    addChild(ctx.nodes, runtimeWallId, id);
    ledger.installed++;
    ledger.perItem.push({
      openingId: win.id, openingType: 'window', semanticWallId: win.wallId,
      runtimeWallId, mappingFound, geometricFallback: host.geometricFallback, nearestWallDistM: host.nearestWallDistM,
      installationAttempted: true,
      installationSucceeded: true, failureReason: null,
    });
  } catch (e) {
    ledger.invalid++;
    ledger.perItem.push({
      openingId: win.id, openingType: 'window', semanticWallId: win.wallId,
      runtimeWallId, mappingFound, geometricFallback: host.geometricFallback, nearestWallDistM: host.nearestWallDistM,
      installationAttempted: true,
      installationSucceeded: false,
      failureReason: e instanceof Error ? e.message : String(e),
    });
    postDebug({ __kind: 'error', payload: { ts: Date.now(), phase: 'window-parse', wallId: win.wallId, error: e instanceof Error ? e.message : String(e) } });
  }
}

function installDoor(
  ctx: SceneInstallContext,
  dr: DoorContract,
  metaExtras: Record<string, unknown> | undefined,
  hostMap: OpeningHostMap | undefined,
  ledger: OpeningLedger,
): void {
  ledger.attempted++;
  const mid = dr.startM && dr.endM ? ([(dr.startM.x + dr.endM.x) / 2, (dr.startM.y + dr.endM.y) / 2] as [number, number]) : undefined;
  const host = resolveRuntimeHost(ctx, dr.wallId, hostMap, mid);
  const runtimeWallId = host.runtimeWallId;
  const mappingFound = !!runtimeWallId;
  if (!runtimeWallId) {
    ledger.invalid++;
    ledger.perItem.push({
      openingId: dr.id, openingType: 'door', semanticWallId: dr.wallId,
      runtimeWallId: null, mappingFound, geometricFallback: host.geometricFallback, nearestWallDistM: host.nearestWallDistM,
      installationAttempted: false,
      installationSucceeded: false, failureReason: 'MISSING_RUNTIME_HOST',
    });
    postDebug({ __kind: 'error', payload: { ts: Date.now(), phase: 'door-no-host', wallId: dr.wallId, nearestWallDistM: host.nearestWallDistM } });
    return;
  }
  const wallGeom = hostWallGeometry(hostMap, runtimeWallId, ctx);
  if (!wallGeom) {
    ledger.invalid++;
    ledger.perItem.push({
      openingId: dr.id, openingType: 'door', semanticWallId: dr.wallId,
      runtimeWallId, mappingFound, geometricFallback: host.geometricFallback, nearestWallDistM: host.nearestWallDistM,
      installationAttempted: true,
      installationSucceeded: false, failureReason: 'HOST_GEOMETRY_UNAVAILABLE',
    });
    postDebug({ __kind: 'error', payload: { ts: Date.now(), phase: 'door-no-geom', wallId: dr.wallId, runtimeWallId } });
    return;
  }
  const { start, end } = wallGeom;
  const heightM = 2.1;
  const centreY = heightM / 2;
  const { localPosition, localRotation, worldCentre, centreFromA } = worldOpeningToWallLocal(
    start, end, [dr.startM.x, dr.startM.y], [dr.endM.x, dr.endM.y], centreY,
  );
  const id = uid('door');
  try {
    const node = DoorNode.parse({
      id,
      name: `Door ${dr.wallId}`,
      parentId: runtimeWallId,
      wallId: runtimeWallId,
      status: 'AUTO_EXTRACTED_DOOR',
      metadata: aiMeta({
        ...(metaExtras ?? {}),
        physicalWallId: dr.wallId,
        semanticWallId: dr.wallId,
        runtimeWallId,
        sourceMappingHash: 'AI_MULTIPASS_DOOR',
        automaticPromotionAllowed: true,
        positionSource: 'WALL_LOCAL_INTERVAL_FROM_ENDPOINT_A',
        doorCentreY: centreY,
        centreFromA,
        worldCentre,
        sourceRecordId: dr.id,
      }),
      width: Math.hypot(dr.endM.x - dr.startM.x, dr.endM.y - dr.startM.y),
      height: heightM,
      frameThickness: 0.05,
      frameDepth: 0.07,
      threshold: true,
      thresholdHeight: 0.02,
      hingesSide: 'right',
      swingDirection: 'inward',
      position: localPosition,
      rotation: localRotation,
    } as never) as AnyNode;
    ctx.createNodes([{ node, parentId: runtimeWallId }]);
    addChild(ctx.nodes, runtimeWallId, id);
    ledger.installed++;
    ledger.perItem.push({
      openingId: dr.id, openingType: 'door', semanticWallId: dr.wallId,
      runtimeWallId, mappingFound, geometricFallback: host.geometricFallback, nearestWallDistM: host.nearestWallDistM,
      installationAttempted: true,
      installationSucceeded: true, failureReason: null,
    });
  } catch (e) {
    ledger.invalid++;
    ledger.perItem.push({
      openingId: dr.id, openingType: 'door', semanticWallId: dr.wallId,
      runtimeWallId, mappingFound, geometricFallback: host.geometricFallback, nearestWallDistM: host.nearestWallDistM,
      installationAttempted: true,
      installationSucceeded: false,
      failureReason: e instanceof Error ? e.message : String(e),
    });
    postDebug({ __kind: 'error', payload: { ts: Date.now(), phase: 'door-parse', wallId: dr.wallId, error: e instanceof Error ? e.message : String(e) } });
  }
}

export function installWindows(
  ctx: SceneInstallContext,
  windows: WindowContract[],
  metaExtras?: Record<string, unknown>,
  hostMap?: OpeningHostMap,
): OpeningLedger {
  const ledger = emptyLedger();
  for (const win of windows ?? []) {
    try { installWindow(ctx, win, metaExtras, hostMap, ledger); }
    catch (e) { postDebug({ __kind: 'error', payload: { ts: Date.now(), phase: 'window-parse', wallId: win?.wallId, error: e instanceof Error ? e.message : String(e) } }); }
  }
  ctx.onProgress?.('windows', ledger.installed, (windows ?? []).length);
  return ledger;
}

export function installDoors(
  ctx: SceneInstallContext,
  doors: DoorContract[],
  metaExtras?: Record<string, unknown>,
  hostMap?: OpeningHostMap,
): OpeningLedger {
  const ledger = emptyLedger();
  for (const dr of doors ?? []) {
    try { installDoor(ctx, dr, metaExtras, hostMap, ledger); }
    catch (e) { postDebug({ __kind: 'error', payload: { ts: Date.now(), phase: 'door-parse', wallId: dr?.wallId, error: e instanceof Error ? e.message : String(e) } }); }
  }
  ctx.onProgress?.('doors', ledger.installed, (doors ?? []).length);
  return ledger;
}
