// harness/code06-staged-import.ts
// Checkpoint 2, Step 5: progressive, typed stage events + batched incremental commit.
//
// Commits the frozen CODE-06 shell in stages:
//   slab -> exterior walls -> principal internal walls -> service walls
//   -> short partitions
// Walls are committed in batches of 5-8. Every wall remains independently
// selectable (its own Pascal WallNode + registry Object3D).
//
// COMMIT MODEL (Checkpoint 2 audit):
//   - The initial shell (site/building/level/guide) is installed ONCE via
//     setScene by the host BEFORE this runs.
//   - Each stage/batch is committed via a `commitNodes(nodes, parentId)` callback
//     that the host wires to `useScene.createNodes(...)` — which maintains
//     parentId + children symmetrically (core action, mirroring the adapter).
//   - setScene is NEVER called per batch. The full 70-wall scene is never
//     installed up front.
//   - Validation runs against the LIVE useScene node map before/after each stage.
// No UI code lives here; this emits typed events that the ChatPanel subscribes to.

import type { AnyNode } from '@pascal-app/core';
import type { NodeMap, SceneTreeValidationResult } from 'design-build-pascal-adapter';
import { validateSceneTree } from 'design-build-pascal-adapter';
import type { Code06Drafts } from './build-code06-import';

export type StagePhase =
  | 'slab' | 'exterior-walls' | 'principal-internal-walls' | 'service-walls' | 'short-partitions' | 'columns' | 'windows' | 'doors';

export type StageEvent =
  | { type: 'stage-started'; phase: StagePhase; at: number; bootstrapGen: number; registryKinds: number; sceneNodes: number; dirty: number }
  | { type: 'stage-validated'; phase: StagePhase; at: number; ok: boolean; issues: number }
  | { type: 'stage-commit-progress'; phase: StagePhase; at: number; committed: number; total: number; lastWallId?: string; physicalWallId?: string }
  | { type: 'stage-completed'; phase: StagePhase; at: number; committed: number }
  | { type: 'stage-failed'; phase: StagePhase; at: number; error: string }
  | { type: 'stage-rolled-back'; phase: StagePhase; at: number }
  | { type: 'import-completed'; at: number; walls: number; dirty: number; validationOk: boolean };

export interface StagedImportHandle {
  onEvent: (fn: (e: StageEvent) => void) => () => void;
  setWindowDrafts?: (drafts: { node: AnyNode; parentId: string }[]) => void;
  setDoorDrafts?: (drafts: { node: AnyNode; parentId: string }[]) => void;
}

const BATCH = 6; // 5-8 per spec

export interface StagedImportCtx {
  drafts: Code06Drafts;
  /** Commit a set of nodes under a parent. Host wires this to useScene.createNodes. */
  commitNodes: (nodes: AnyNode[], parentId: string) => void;
  /** Read the LIVE node map + dirty count for validation. */
  getLiveNodes: () => NodeMap;
  getDirty: () => number;
  levelId: string;
  bootstrapGen: number;
  registryKinds: number;
  /** Optional: simulate a failure on the next batch (rollback test). */
  failNextBatch?: { current: boolean };
  /** Optional: notified on each committed-wall count change (for diagnostics). */
  onCommittedChange?: (committed: number, phase: StagePhase) => void;
  columnDrafts?: AnyNode[];
  onColumnsCommitted?: (count: number) => void;
  /** Progressive Window installation items */
  windowDrafts?: { node: AnyNode; parentId: string }[];
  onWindowsCommitted?: (count: number, total: number) => void;
  /** Progressive Door installation items */
  doorDrafts?: { node: AnyNode; parentId: string }[];
  onDoorsCommitted?: (count: number, total: number) => void;
  /** Flag indicating backend streaming is in progress */
  isStreaming?: { current: boolean };
}

/**
 * Classify frozen walls into visual stages via simple geometry (no AI):
 * exterior = on page-bbox perimeter; short = length < 1.6m; principal = long
 * internal; service = remaining internal.
 */
function classifyWalls(drafts: Code06Drafts) {
  const eps = 0.4;
  const { pageWm, pageHm } = drafts;
  const buckets: Record<string, number[]> = { exterior: [], principal: [], service: [], short: [] };
  drafts.wallDrafts.forEach((w, i) => {
    const node = w.node as unknown as { start: [number, number]; end: [number, number] };
    const [ax, az] = node.start; const [bx, bz] = node.end;
    const len = Math.hypot(bx - ax, bz - az);
    const onPerimeter =
      Math.min(ax, bx) <= eps || Math.min(az, bz) <= eps ||
      Math.max(ax, bx) >= pageWm - eps || Math.max(az, bz) >= pageHm - eps;
    if (len < 1.6) buckets.short.push(i);
    else if (onPerimeter) buckets.exterior.push(i);
    else if (len >= 4.5) buckets.principal.push(i);
    else buckets.service.push(i);
  });
  const seen = new Set<number>();
  const ordered: { phase: StagePhase; idx: number[] }[] = [
    { phase: 'exterior-walls', idx: buckets.exterior },
    { phase: 'principal-internal-walls', idx: buckets.principal },
    { phase: 'service-walls', idx: buckets.service },
    { phase: 'short-partitions', idx: buckets.short },
  ];
  for (const o of ordered) o.idx = o.idx.filter((i) => (seen.has(i) ? false : (seen.add(i), true)));
  return ordered.filter((o) => o.idx.length > 0);
}

export function runStagedCode06Import(ctx: StagedImportCtx): StagedImportHandle {
  const listeners = new Set<(e: StageEvent) => void>();
  const emit = (e: StageEvent) => listeners.forEach((l) => l(e));
  const at = () => Date.now();
  const rootIds = [ctx.drafts.initialShell.rootNodeIds[0]];
  let liveWindowDrafts = ctx.windowDrafts ?? [];
  let liveDoorDrafts = ctx.doorDrafts ?? [];

  let winDone = false;
  let doorDone = false;

  async function processWindowDrafts(drafts: { node: AnyNode; parentId: string }[]) {
    if (winDone || drafts.length === 0) return;
    winDone = true;
    const phase: StagePhase = 'windows';
    emit({ type: 'stage-started', phase, at: at(), bootstrapGen: ctx.bootstrapGen, registryKinds: ctx.registryKinds, sceneNodes: Object.keys(ctx.getLiveNodes()).length, dirty: ctx.getDirty() });
    let winCommitted = 0;
    const WIN_BATCH = 4;
    for (let i = 0; i < drafts.length; i += WIN_BATCH) {
      const batch = drafts.slice(i, i + WIN_BATCH);
      for (const op of batch) {
        try {
          const live = ctx.getLiveNodes();
          const targetParent = live[op.parentId] ? op.parentId : ctx.levelId;
          ctx.commitNodes([op.node], targetParent);
        } catch (err) {
          console.warn('[staged import] window commit error:', err);
        }
      }
      winCommitted += batch.length;
      ctx.onWindowsCommitted?.(winCommitted, drafts.length);
      emit({
        type: 'stage-commit-progress', phase, at: at(),
        committed: winCommitted, total: drafts.length,
        lastWallId: batch[batch.length - 1].parentId,
      });
      await tick(110);
    }
    emit({ type: 'stage-completed', phase, at: at(), committed: drafts.length });
    await tick(110);
  }

  async function processDoorDrafts(drafts: { node: AnyNode; parentId: string }[]) {
    if (doorDone || drafts.length === 0) return;
    doorDone = true;
    const phase: StagePhase = 'doors';
    emit({ type: 'stage-started', phase, at: at(), bootstrapGen: ctx.bootstrapGen, registryKinds: ctx.registryKinds, sceneNodes: Object.keys(ctx.getLiveNodes()).length, dirty: ctx.getDirty() });
    let doorCommitted = 0;
    const DOOR_BATCH = 4;
    for (let i = 0; i < drafts.length; i += DOOR_BATCH) {
      const batch = drafts.slice(i, i + DOOR_BATCH);
      for (const op of batch) {
        try {
          const live = ctx.getLiveNodes();
          const targetParent = live[op.parentId] ? op.parentId : ctx.levelId;
          ctx.commitNodes([op.node], targetParent);
        } catch (err) {
          console.warn('[staged import] door commit error:', err);
        }
      }
      doorCommitted += batch.length;
      ctx.onDoorsCommitted?.(doorCommitted, drafts.length);
      emit({
        type: 'stage-commit-progress', phase, at: at(),
        committed: doorCommitted, total: drafts.length,
        lastWallId: batch[batch.length - 1].parentId,
      });
      await tick(110);
    }
    emit({ type: 'stage-completed', phase, at: at(), committed: drafts.length });
    await tick(110);
  }

  (async () => {
    const stages = classifyWalls(ctx.drafts);
    try {
      // --- 1. SLAB STAGE (Foundation) ---
      {
        const phase: StagePhase = 'slab';
        emit({ type: 'stage-started', phase, at: at(), bootstrapGen: ctx.bootstrapGen, registryKinds: ctx.registryKinds, sceneNodes: Object.keys(ctx.getLiveNodes()).length, dirty: ctx.getDirty() });
        const pre = validateSceneTree(ctx.getLiveNodes(), { rootNodeIds: rootIds });
        emit({ type: 'stage-validated', phase, at: at(), ok: pre.ok, issues: pre.issues.length });
        ctx.commitNodes([ctx.drafts.slab.node], ctx.levelId);
        emit({ type: 'stage-completed', phase, at: at(), committed: 1 });
        await tick(160);
      }

      // --- 2. WALL STAGES (Structural Envelope & Partitions) ---
      let globalBatch = 0;
      let globalCommitted = 0;
      for (const { phase, idx } of stages) {
        emit({ type: 'stage-started', phase, at: at(), bootstrapGen: ctx.bootstrapGen, registryKinds: ctx.registryKinds, sceneNodes: Object.keys(ctx.getLiveNodes()).length, dirty: ctx.getDirty() });
        const pre = validateSceneTree(ctx.getLiveNodes(), { rootNodeIds: rootIds });
        emit({ type: 'stage-validated', phase, at: at(), ok: pre.ok, issues: pre.issues.length });

        for (let i = 0; i < idx.length; i += BATCH) {
          if (ctx.failNextBatch?.current) {
            ctx.failNextBatch.current = false;
            emit({ type: 'stage-failed', phase, at: at(), error: `simulated batch failure @${phase}#${globalBatch}` });
            emit({ type: 'stage-rolled-back', phase, at: at() });
            globalBatch++;
            continue;
          }
          const batchIdx = idx.slice(i, i + BATCH);
          const batchNodes = batchIdx.map((j) => ctx.drafts.wallDrafts[j].node);
          ctx.commitNodes(batchNodes, ctx.levelId);
          const committedThisBatch = batchIdx.length;
          globalCommitted += committedThisBatch;
          ctx.onCommittedChange?.(globalCommitted, phase);
          const last = batchIdx[batchIdx.length - 1];
          emit({
            type: 'stage-commit-progress', phase, at: at(),
            committed: globalCommitted, total: idx.length,
            lastWallId: ctx.drafts.wallDrafts[last].id,
            physicalWallId: ctx.drafts.wallDrafts[last].physicalWallId,
          });
          const post = validateSceneTree(ctx.getLiveNodes(), { rootNodeIds: rootIds });
          if (!post.ok) emit({ type: 'stage-validated', phase, at: at(), ok: false, issues: post.issues.length });
          globalBatch++;
          await tick(95);
        }
        emit({ type: 'stage-completed', phase, at: at(), committed: idx.length });
        await tick(95);
      }

      // --- 3. COLUMN STAGE (if applicable) ---
      const columnNodes = ctx.columnDrafts ?? [];
      if (columnNodes.length > 0) {
        const phase: StagePhase = 'columns';
        emit({ type: 'stage-started', phase, at: at(), bootstrapGen: ctx.bootstrapGen, registryKinds: ctx.registryKinds, sceneNodes: Object.keys(ctx.getLiveNodes()).length, dirty: ctx.getDirty() });
        const pre = validateSceneTree(ctx.getLiveNodes(), { rootNodeIds: rootIds });
        emit({ type: 'stage-validated', phase, at: at(), ok: pre.ok, issues: pre.issues.length });
        ctx.commitNodes(columnNodes, ctx.levelId);
        ctx.onColumnsCommitted?.(columnNodes.length);
        emit({ type: 'stage-completed', phase, at: at(), committed: columnNodes.length });
        await tick(95);
      }

      // --- 4. WINDOWS STAGE (Progressive Glazing) ---
      let waitWin = 0;
      while (liveWindowDrafts.length === 0 && waitWin < 40) {
        await tick(50);
        waitWin++;
      }
      if (liveWindowDrafts.length > 0) {
        await processWindowDrafts(liveWindowDrafts);
      }

      // --- 5. DOORS STAGE (Progressive Door Assemblies & Swings) ---
      let waitDoor = 0;
      while (liveDoorDrafts.length === 0 && waitDoor < 40) {
        await tick(50);
        waitDoor++;
      }
      if (liveDoorDrafts.length > 0) {
        await processDoorDrafts(liveDoorDrafts);
      }

      const finalVal = validateSceneTree(ctx.getLiveNodes(), { rootNodeIds: rootIds });
      emit({ type: 'import-completed', at: at(), walls: ctx.drafts.wallDrafts.length, dirty: ctx.getDirty(), validationOk: finalVal.ok });
    } catch (e) {
      emit({ type: 'stage-failed', phase: 'exterior-walls', at: at(), error: e instanceof Error ? e.message : String(e) });
    }
  })();

  return {
    onEvent: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    setWindowDrafts: (drafts) => {
      liveWindowDrafts = drafts;
    },
    setDoorDrafts: (drafts) => {
      liveDoorDrafts = drafts;
    },
  };
}

function tick(ms = 85) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Build the EXACT physicalWallId -> live Pascal WallNode id map from the LIVE
 * scene node map. This is derived directly from wall creation (the adapter
 * stamps physicalWallId into each WallNode's metadata), NOT from proximity
 * matching. Required before any window is installed.
 */
export interface WallIdentityMap {
  map: Record<string, string>;
  mapEntries: number;
  missingPhysicalWallIds: string[];
  duplicatePhysicalWallIds: string[];
  nonWallTargets: string[];
}

export function buildWallIdentityMap(liveNodes: NodeMap): WallIdentityMap {
  const map: Record<string, string> = {};
  const duplicatePhysicalWallIds: string[] = [];
  const nonWallTargets: string[] = [];
  for (const node of Object.values(liveNodes)) {
    if (!node || node.type !== 'wall') continue;
    const meta = ((node as unknown as { metadata?: Record<string, unknown> }).metadata ?? {}) as Record<string, unknown>;
    const phys = (meta.physicalWallId ?? meta.physical_wall_id) as string | undefined;
    if (!phys) {
      nonWallTargets.push(node.id);
      continue;
    }
    if (map[phys] && map[phys] !== node.id) {
      if (!duplicatePhysicalWallIds.includes(phys)) duplicatePhysicalWallIds.push(phys);
    }
    map[phys] = node.id;
  }
  const mapEntries = Object.keys(map).length;
  const missingPhysicalWallIds = Object.values(liveNodes)
    .filter((n) => n && n.type === 'wall' && !((n as unknown as { metadata?: Record<string, unknown> }).metadata ?? {})?.physicalWallId)
    .map((n) => n.id);
  return { map, mapEntries, missingPhysicalWallIds, duplicatePhysicalWallIds, nonWallTargets };
}
