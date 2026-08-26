// harness/ai-scene-install/install-walls.ts
// Shared wall installer (V3 progressive stage 3). Builds 3D WallNodes from the
// AI WallContract array and parents them under the Level. Each wall is tagged
// with `physicalWallId` (the contract id — the SEMANTIC wall id) so openings
// resolve their host through the finalized wall map (§6), not a nearest-wall
// search. Single geometry implementation — no duplication of the wall-local
// transforms used by openings (§6).
//
// Returns the semantic→runtime wall mapping so the orchestrator can build the
// FINALIZED AI WALL MAP from ACTUAL installed nodes (never from the extracted
// payload alone). The runtime id is known the instant WallNode.parse succeeds —
// we do NOT re-search Viewer nodes later.

import { WallNode } from '@pascal-app/core';
import type { AnyNode } from '@pascal-app/core';
import type { WallContract } from 'design-build-extraction-contracts';
import { uid, addChild, normalizeMaterial, postDebug, aiMeta } from './helpers';
import type { SceneInstallContext } from './types';

export interface WallInstallEntry {
  /** Semantic wall id (the neutral ExtractionResult wall id). */
  semanticWallId: string;
  /** Runtime Pascal WallNode id assigned at install time. */
  runtimeWallId: string;
  /** Validated world-metre geometry (carried so openings can host geometrically). */
  startM: [number, number];
  endM: [number, number];
}

export interface WallInstallResult {
  attempted: number;
  installed: number;
  invalid: number;
  entries: WallInstallEntry[];
}

export function installWalls(
  ctx: SceneInstallContext,
  walls: WallContract[],
  metaExtras?: Record<string, unknown>,
): WallInstallResult {
  const created: { node: unknown; parentId: string }[] = [];
  const entries: WallInstallEntry[] = [];
  let attempted = 0;
  let invalid = 0;
  for (const w of walls ?? []) {
    attempted++;
    try {
      const id = uid('wall');
      const start: [number, number] = w.startM
        ? [w.startM.x, w.startM.y]
        : Array.isArray((w as any).start)
          ? [(w as any).start[0], (w as any).start[1]]
          : [0, 0];
      const end: [number, number] = w.endM
        ? [w.endM.x, w.endM.y]
        : Array.isArray((w as any).end)
          ? [(w as any).end[0], (w as any).end[1]]
          : [0, 0];
      const node = WallNode.parse({
        id,
        name: `Wall ${w.id}`,
        parentId: ctx.levelId,
        start,
        end,
        thickness: w.thicknessM || (w as any).thickness || 0.2,
        height: w.heightM || (w as any).height || 3,
        frontSide: 'interior',
        backSide: 'exterior',
        materialPreset: normalizeMaterial((w.metadata as { material?: string } | undefined)?.material ?? 'white'),
        metadata: aiMeta({
          ...(metaExtras ?? {}),
          physicalWallId: w.id, // semantic wall id (contract id)
          sourceRecordId: w.id,
        }),
      } as never) as AnyNode;
      created.push({ node, parentId: ctx.levelId });
      addChild(ctx.nodes, ctx.levelId, id);
      entries.push({ semanticWallId: w.id, runtimeWallId: id, startM: start, endM: end });
    } catch (e) {
      invalid++;
      postDebug({ __kind: 'error', payload: { ts: Date.now(), phase: 'wall-parse', wallId: w?.id, error: e instanceof Error ? e.message : String(e) } });
    }
  }
  if (created.length) ctx.createNodes(created);
  ctx.onProgress?.('walls', entries.length, entries.length);
  return { attempted, installed: entries.length, invalid, entries };
}
