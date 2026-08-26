// harness/ai-scene-install/install-furniture.ts
// Shared furniture -> ItemNode installer. Handles BOTH V2 FurnitureInstance
// (familyId/positionM/widthM/depthM/heightM/rotationDeg) and V3 FurnitureCandidate
// (type/pos/width/depth/height/rotation). Catalogue-constrained; unknown assets
// are skipped, never guessed.

import { ItemNode } from '@pascal-app/core';
import type { AnyNode } from '@pascal-app/core';
import { uid, addChild, postDebug, aiMeta } from './helpers';
import { lookupFurniture, furnitureAsset } from './catalogue';
import type { SceneInstallContext, FurnitureItem } from './types';

export interface InstallFurnitureOptions {
  /** V3 progressive tagging (source/extractionMode/runId/stage/sourceEntityId/frameId). */
  metaExtras?: Record<string, unknown>;
  /** When true, tag with the progressive-v3 source prefix (default behaviour). */
  progressive?: boolean;
}

/**
 * Normalize a furniture item to a flat shape the installer understands, regardless
 * of whether it came from V2 (FurnitureInstance) or V3 (FurnitureCandidate).
 */
export function normalizeFurnitureItem(item: FurnitureItem): {
  id?: string;
  familyId: string;
  x: number; y: number;
  width: number; depth: number; height: number;
  widthProvided: boolean; depthProvided: boolean; heightProvided: boolean;
  rotationDeg: number;
  zoneId?: string | null;
  confidence?: number;
} | null {
  const familyId = item.familyId ?? item.type;
  if (!familyId) return null;
  const pos = item.positionM ? [item.positionM.x, item.positionM.y] : item.pos;
  if (!pos || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return null;
  // Track whether each dimension was explicitly provided so the installer can
  // REJECT a supplied zero/negative/NaN instead of silently falling back (Step 8).
  const width = item.widthM ?? item.width;
  const depth = item.depthM ?? item.depth;
  const height = item.heightM ?? item.height;
  return {
    id: item.id,
    familyId,
    x: pos[0],
    y: pos[1],
    width: Number.isFinite(width as number) ? (width as number) : 0,
    depth: Number.isFinite(depth as number) ? (depth as number) : 0,
    height: Number.isFinite(height as number) ? (height as number) : 0,
    widthProvided: width !== undefined,
    depthProvided: depth !== undefined,
    heightProvided: height !== undefined,
    rotationDeg: item.rotationDeg ?? item.rotation ?? 0,
    zoneId: item.zoneId,
    confidence: item.confidence,
  };
}

/**
 * Install furniture items under the Level. Returns the count installed.
 * `metaExtras` carries V3 run/stage/frameId tagging; V2 callers omit it.
 */
export function installFurniture(
  ctx: SceneInstallContext,
  items: FurnitureItem[],
  opts: InstallFurnitureOptions = {},
): number {
  const created: { node: unknown; parentId: string }[] = [];
  let installed = 0;

  for (const raw of items ?? []) {
    try {
      const n = normalizeFurnitureItem(raw);
      if (!n) continue;
      const def = lookupFurniture(n.familyId);
      if (!def) {
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[AiSceneInstall:furniture] skipped unknown familyId:', n.familyId);
        }
        postDebug({ __kind: 'error', payload: { ts: Date.now(), phase: 'furniture-unknown-asset', familyId: n.familyId } });
        continue;
      }
      // Deterministic instance identity: prefer the provider/neutral record id;
      // fall back to a deterministic id derived from family + normalized geometry so
      // two instances of the same family remain DISTINCT (never collapse to familyId).
      const srcId =
        n.id ||
        `fur_${n.familyId}_${[n.x, n.y, n.width, n.depth, n.height, n.rotationDeg]
          .map((v) => Math.round((v ?? 0) * 1000))
          .join('_')}`;
      // Double-acceptance guard (spec §10): an item whose source record already has
      // an installed node is skipped, so re-accepting a review item cannot create a
      // duplicate Pascal node. Keyed on the real source id, NOT familyId.
      const alreadyInstalled = Object.values(ctx.nodes).some(
        (node) => (node as Record<string, unknown>)?.type === 'item'
          && ((node as Record<string, unknown>)?.metadata as Record<string, unknown> | undefined)?.sourceRecordId === srcId,
      );
      if (alreadyInstalled) continue;

      // Dimension handling (Step 8):
      // - explicit finite positive supplied value → keep it;
      // - explicit zero / negative / non-finite supplied value → REJECT (do not
      //   silently replace with the catalogue default);
      // - absent value (not provided) → catalogue default.
      const width = n.widthProvided && n.width > 0 ? n.width : n.widthProvided ? null : def.widthM;
      const depth = n.depthProvided && n.depth > 0 ? n.depth : n.depthProvided ? null : def.depthM;
      const height = n.heightProvided && n.height > 0 ? n.height : n.heightProvided ? null : def.heightM;
      if (width === null || depth === null || height === null || !(width > 0) || !(depth > 0) || !(height > 0)) {
        postDebug({ __kind: 'error', payload: { ts: Date.now(), phase: 'furniture-invalid-dims', familyId: n.familyId, width: n.width, depth: n.depth, height: n.height, widthProvided: n.widthProvided, depthProvided: n.depthProvided, heightProvided: n.heightProvided } });
        continue;
      }

      const id = uid('item');
      const asset = furnitureAsset(def);
      asset.dimensions = [width, height, depth];
      asset.rotation = [0, (n.rotationDeg || 0) * (Math.PI / 180), 0];
      const node = ItemNode.parse({
        id,
        name: def.label,
        parentId: ctx.levelId,
        position: [n.x, 0, n.y],
        metadata: aiMeta({
          extractionMode: opts.progressive ? 'progressive-v3' : 'v2',
          ...(opts.metaExtras ?? {}),
          familyId: n.familyId,
          sourceRecordId: srcId,
        }),
        asset,
      } as never) as AnyNode;
      created.push({ node, parentId: ctx.levelId });
      addChild(ctx.nodes, ctx.levelId, id);
      installed++;
    } catch (itemErr) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[AiSceneInstall:furniture] skipped item:', raw?.familyId ?? raw?.type, itemErr instanceof Error ? itemErr.message : String(itemErr));
      }
      postDebug({ __kind: 'error', payload: { ts: Date.now(), phase: 'furniture-item-parse', familyId: raw?.familyId ?? raw?.type, error: itemErr instanceof Error ? itemErr.message : String(itemErr) } });
    }
  }

  if (created.length > 0) ctx.createNodes(created);
  ctx.onProgress?.('furniture', installed, installed);
  return installed;
}
