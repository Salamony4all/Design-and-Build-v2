// harness/ai-scene-install/install-slab.ts
// Shared slab installer. Prefers the AI slab polygon (authoritative floor
// footprint); falls back to a convex hull of wall endpoints.

import { SlabNode } from '@pascal-app/core';
import type { AnyNode } from '@pascal-app/core';
import type { Vec2, SlabContract } from 'design-build-extraction-contracts';
import { uid, addChild, computeConvexHull, computePolygonArea, normalizeMaterial, postDebug, aiMeta } from './helpers';
import type { SceneInstallContext } from './types';

export function installSlab(
  ctx: SceneInstallContext,
  slab: SlabContract | undefined,
  walls: { startM: Vec2; endM: Vec2 }[] = [],
  metaExtras?: Record<string, unknown>,
): number {
  let slabPolygon: [number, number][] = (slab?.polygonM ?? [])
    .map((p: Vec2) => [p.x, p.y] as [number, number])
    .filter((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (slabPolygon.length < 3) {
    const wallPts: [number, number][] = [];
    for (const w of walls) {
      if (w?.startM && w?.endM) {
        wallPts.push([w.startM.x, w.startM.y]);
        wallPts.push([w.endM.x, w.endM.y]);
      }
    }
    if (wallPts.length === 0 && ctx.nodes) {
      const sceneWalls = Object.values(ctx.nodes).filter((n) => (n as any)?.type === 'wall') as any[];
      for (const w of sceneWalls) {
        if (Array.isArray(w.start) && Array.isArray(w.end)) {
          wallPts.push([w.start[0], w.start[1]]);
          wallPts.push([w.end[0], w.end[1]]);
        }
      }
    }
    if (wallPts.length >= 4) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of wallPts) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (Number.isFinite(minX) && maxX > minX && maxY > minY) {
        const hull = computeConvexHull(wallPts);
        if (hull.length >= 3 && Math.abs(computePolygonArea(hull)) >= 1) {
          slabPolygon = hull;
        } else {
          const pad = 0.2;
          slabPolygon = [
            [minX - pad, minY - pad],
            [maxX + pad, minY - pad],
            [maxX + pad, maxY + pad],
            [minX - pad, maxY + pad],
          ];
        }
      }
    }
  }
  if (slabPolygon.length < 3) return 0;
  try {
    const id = uid('slab');
    const node = SlabNode.parse({
      id,
      name: 'AI Floor Slab',
      parentId: ctx.levelId,
      metadata: aiMeta({ ...(metaExtras ?? {}), sourceRecordId: (slab as { id?: string } | undefined)?.id ?? 'slab' }),
      polygon: slabPolygon,
      elevation: (slab?.elevationM as number) ?? 0,
      materialPreset: normalizeMaterial((slab as { material?: string } | undefined)?.material ?? 'parquet'),
    } as never) as AnyNode;
    ctx.createNodes([{ node, parentId: ctx.levelId }]);
    addChild(ctx.nodes, ctx.levelId, id);
    ctx.onProgress?.('slab', 1, 1);
    return 1;
  } catch (e) {
    postDebug({ __kind: 'error', payload: { ts: Date.now(), phase: 'slab-parse', error: e instanceof Error ? e.message : String(e) } });
    return 0;
  }
}
