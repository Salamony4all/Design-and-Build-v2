// harness/ai-scene-install/structural-validation.ts
// Phase B §10 — STRUCTURAL RUNTIME VALIDATION.
//
// Validates the ACTUAL Pascal scene AFTER slab/walls/windows/doors settle. This
// is a pure read-only audit over the live nodes + the finalized wall map + the
// opening install ledgers. It MUST fail when:
//   - an installed window/door lacks a valid runtime host wall;
//   - the wall map contains duplicate or missing identities;
//   - Pascal node metadata fails a basic schema check;
//   - stale CODE_06 nodes remain in a fresh standalone AI project;
//   - a fatal Viewer error exists;
//   - accepted objects silently disappeared without review/invalid accounting.
// It MAY pass with review records present (review is a legitimate terminal state).

import type { RuntimeWallMapBuild } from './runtime-wall-map';
import type { OpeningLedger } from './install-opening';

export type StructuralStatus =
  | 'PASSED'
  | 'PASSED_WITH_REVIEW'
  | 'FAILED';

export interface StructuralValidationResult {
  status: StructuralStatus;
  guideReady: boolean;
  slabNodeValid: boolean;
  acceptedWallCount: number;
  installedWallCount: number;
  wallMapStatus: string;
  wallMapValid: boolean;
  acceptedWindowCount: number;
  installedWindowCount: number;
  acceptedDoorCount: number;
  installedDoorCount: number;
  orphanWindowCount: number;
  orphanDoorCount: number;
  duplicateSemanticIds: number;
  metadataSchemaFailures: number;
  staleRunNodes: number;
  staleCode06Nodes: number;
  fatalViewerErrors: number;
  reviewCount: number;
  failures: string[];
}

export interface StructuralValidationInput {
  nodes: Record<string, unknown>;
  runId: string | null;
  guideNodeId: string | null;
  slabPresent: boolean;
  wallMap: RuntimeWallMapBuild | null;
  windowLedger: OpeningLedger | null;
  doorLedger: OpeningLedger | null;
  /** accepted counts from the extraction result (provider-normalized). */
  acceptedWindows: number;
  acceptedDoors: number;
  /** accepted wall count from the extraction result. */
  acceptedWalls: number;
  fatalViewerErrors?: number;
  /** review items surfaced by the AI pipeline (legitimate terminal state). */
  reviewCount?: number;
}

function isWallLike(node: unknown): boolean {
  return !!node && (node as Record<string, unknown>).type === 'wall';
}

/** Minimal Pascal metadata schema check: object, has an id-derived source tag or record id. */
function metadataSchemaOk(node: Record<string, unknown>): boolean {
  const meta = (node.metadata ?? {}) as Record<string, unknown>;
  if (typeof meta !== 'object' || meta === null) return false;
  // A valid AI/Pascal node metadata must carry an extraction signal or a source.
  const hasSignal =
    'sourceRecordId' in meta ||
    'physicalWallId' in meta ||
    'extractionProvider' in meta ||
    'source' in meta ||
    'runId' in meta;
  return hasSignal;
}

export function validateStructuralScene(input: StructuralValidationInput): StructuralValidationResult {
  const nodes = input.nodes ?? {};
  const all = Object.values(nodes);
  const failures: string[] = [];

  // ── guide ──
  const guideReady = !!input.guideNodeId && all.some((n) => (n as Record<string, unknown>).id === input.guideNodeId && (n as Record<string, unknown>).type === 'guide');

  // ── slab ──
  const slabNodeValid = input.slabPresent && all.some((n) => (n as Record<string, unknown>).type === 'slab');

  // ── walls ──
  const installedWallCount = all.filter(isWallLike).length;
  const wallMapStatus = input.wallMap?.status ?? 'MISSING';
  const wallMapValid = !!input.wallMap && input.wallMap.ready === true && input.wallMap.diagnostics.duplicateSemanticWallIds === 0 && input.wallMap.diagnostics.duplicateRuntimeWallIds === 0 && input.wallMap.diagnostics.missingRuntimeWallIds === 0;

  // ── windows / doors ──
  const installedWindows = all.filter((n) => (n as Record<string, unknown>).type === 'window');
  const installedDoors = all.filter((n) => (n as Record<string, unknown>).type === 'door');
  const orphanWindows = installedWindows.filter((w) => {
    const parentId = (w as Record<string, unknown>).parentId as string | undefined;
    const parent = parentId ? (nodes[parentId] as Record<string, unknown> | undefined) : undefined;
    return !parent || !isWallLike(parent) || ((parent.metadata as Record<string, unknown> | undefined)?.physicalWallId == null && (parent.metadata as Record<string, unknown> | undefined)?.semanticWallId == null);
  }).length;
  const orphanDoors = installedDoors.filter((d) => {
    const parentId = (d as Record<string, unknown>).parentId as string | undefined;
    const parent = parentId ? (nodes[parentId] as Record<string, unknown> | undefined) : undefined;
    return !parent || !isWallLike(parent) || ((parent.metadata as Record<string, unknown> | undefined)?.physicalWallId == null && (parent.metadata as Record<string, unknown> | undefined)?.semanticWallId == null);
  }).length;

  // ── duplicate semantic ids (within the wall map) ──
  const duplicateSemanticIds = input.wallMap?.diagnostics.duplicateSemanticWallIds ?? 0;

  // ── metadata schema failures ──
  let metadataSchemaFailures = 0;
  for (const n of all) {
    const nn = n as Record<string, unknown>;
    if (nn.type === 'wall' || nn.type === 'window' || nn.type === 'door' || nn.type === 'slab' || nn.type === 'guide') {
      if (!metadataSchemaOk(nn)) metadataSchemaFailures++;
    }
  }

  // ── stale run nodes (AI nodes from a different run than the active one) ──
  let staleRunNodes = 0;
  for (const n of all) {
    const nn = n as Record<string, unknown>;
    const meta = (nn.metadata ?? {}) as Record<string, unknown>;
    const runId = meta.runId as string | undefined;
    const prov = meta.extractionProvider as string | undefined;
    if (prov === 'PURE_AI' && runId && input.runId && runId !== input.runId) staleRunNodes++;
  }

  // ── stale CODE_06 nodes (fresh standalone AI project must not contain nodes
  //    whose EXTRACTION SOURCE is CODE_06 / frozen-code06). A guide node whose
  //    uploaded file merely happened to be named like "guide-code06.png" is NOT a
  //    stale CODE_06 scene — only an explicit code06 source/kind metadata is. ──
  let staleCode06Nodes = 0;
  for (const n of all) {
    const nn = n as Record<string, unknown>;
    const meta = (nn.metadata ?? {}) as Record<string, unknown>;
    const src = (meta.source as string | undefined) ?? (meta.sourceKind as string | undefined) ?? '';
    if (src === 'code06' || src === 'frozen-code06') staleCode06Nodes++;
  }

  const fatalViewerErrors = input.fatalViewerErrors ?? 0;
  const reviewCount = input.reviewCount ?? 0;

  // ── fail conditions ──
  if (!guideReady) failures.push('guide-not-ready');
  if (!slabNodeValid) failures.push('slab-missing');
  if (wallMapStatus !== 'READY' || !wallMapValid) failures.push('wall-map-invalid');
  if (orphanWindows > 0) failures.push('orphan-windows');
  if (orphanDoors > 0) failures.push('orphan-doors');
  if (duplicateSemanticIds > 0) failures.push('duplicate-semantic-ids');
  if (metadataSchemaFailures > 0) failures.push('metadata-schema');
  if (staleRunNodes > 0) failures.push('stale-run-nodes');
  if (staleCode06Nodes > 0) failures.push('stale-code06-nodes');
  if (fatalViewerErrors > 0) failures.push('fatal-viewer-errors');

  // accepted objects silently disappeared without review/invalid accounting
  const winInstalled = input.windowLedger?.installed ?? installedWindows.length;
  const winInvalid = input.windowLedger?.invalid ?? 0;
  const doorInstalled = input.doorLedger?.installed ?? installedDoors.length;
  const doorInvalid = input.doorLedger?.invalid ?? 0;
  if (input.acceptedWindows > 0 && winInstalled + winInvalid + reviewCount < input.acceptedWindows) {
    failures.push('windows-disappeared');
  }
  if (input.acceptedDoors > 0 && doorInstalled + doorInvalid + reviewCount < input.acceptedDoors) {
    failures.push('doors-disappeared');
  }

  const status: StructuralStatus =
    failures.length === 0
      ? (reviewCount > 0 ? 'PASSED_WITH_REVIEW' : 'PASSED')
      : 'FAILED';

  return {
    status,
    guideReady,
    slabNodeValid,
    acceptedWallCount: input.acceptedWalls,
    installedWallCount,
    wallMapStatus,
    wallMapValid,
    acceptedWindowCount: input.acceptedWindows,
    installedWindowCount: winInstalled,
    acceptedDoorCount: input.acceptedDoors,
    installedDoorCount: doorInstalled,
    orphanWindowCount: orphanWindows,
    orphanDoorCount: orphanDoors,
    duplicateSemanticIds,
    metadataSchemaFailures,
    staleRunNodes,
    staleCode06Nodes,
    fatalViewerErrors,
    reviewCount,
    failures,
  };
}
