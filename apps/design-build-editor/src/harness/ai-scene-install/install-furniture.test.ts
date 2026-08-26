// apps/design-build-editor/src/harness/ai-scene-install/install-furniture.test.ts
// Furniture instance-identity + dimension fallback fixes (checkpoint Step 7-8).
// Pure installer behaviour against the real Pascal core schema. No provider, no MuPDF.

import { describe, it, expect } from 'vitest';
import type { SceneInstallContext } from './types';
import { installFurniture } from './index';

function makeCtx(): SceneInstallContext & { nodes: Record<string, any> } {
  const nodes: Record<string, any> = { lvl1: { id: 'lvl1', type: 'level', name: 'Level', children: [] as string[] } };
  return {
    nodes,
    levelId: 'lvl1',
    createNodes(ops: { node: unknown; parentId?: string }[]) {
      for (const op of ops) {
        const n = op.node as any;
        nodes[n.id] = n;
        if (op.parentId && nodes[op.parentId]) {
          const ch = Array.isArray(nodes[op.parentId].children) ? (nodes[op.parentId].children as string[]) : [];
          if (!ch.includes(n.id)) ch.push(n.id);
          nodes[op.parentId].children = ch;
        }
      }
    },
    removeNodeIds(ids: string[]) { for (const id of ids) delete nodes[id]; },
    onProgress: () => {},
  } as SceneInstallContext & { nodes: Record<string, any> };
}

const META = { progressive: false, metaExtras: { source: 'ai-extract', extractionMode: 'v2', runId: 'run-1', stage: 'furniture' } };

// 6 beds of the SAME family but DISTINCT provider ids → all must install.
describe('furniture instance identity (Step 7)', () => {
  it('installs all six same-family beds when each has a distinct source id', () => {
    const ctx = makeCtx();
    const beds = Array.from({ length: 6 }, (_, i) => ({
      id: `bed_${i + 1}`,
      familyId: 'catalog:double-bed',
      positionM: { x: 1 + i, y: 1 },
      rotationDeg: 0,
      widthM: 1.8,
      depthM: 2.0,
      heightM: 0.55,
    }));
    const installed = installFurniture(ctx as any, beds as any, META as any);
    const itemNodes = Object.values(ctx.nodes).filter((n: any) => n.type === 'item');
    expect(installed).toBe(6);
    expect(itemNodes.length).toBe(6);
    // every node has a distinct sourceRecordId (keyed on provider id, not family)
    const ids = new Set(itemNodes.map((n: any) => n.metadata.sourceRecordId));
    expect(ids.size).toBe(6);
    expect([...ids]).toEqual(['bed_1', 'bed_2', 'bed_3', 'bed_4', 'bed_5', 'bed_6']);
  });

  it('does not collapse two instances that share a family but differ in geometry', () => {
    const ctx = makeCtx();
    const items = [
      { id: 'a', familyId: 'catalog:cabinet', positionM: { x: 1, y: 1 }, widthM: 0.9, depthM: 0.5, heightM: 0.9 },
      { id: 'b', familyId: 'catalog:cabinet', positionM: { x: 2, y: 1 }, widthM: 0.9, depthM: 0.5, heightM: 0.9 },
    ];
    const installed = installFurniture(ctx as any, items as any, META as any);
    expect(installed).toBe(2);
  });

  it('dedup guard skips a re-accepted item with the SAME source id (no duplicate)', () => {
    const ctx = makeCtx();
    const item = { id: 'dup', familyId: 'catalog:cabinet', positionM: { x: 1, y: 1 }, widthM: 0.9, depthM: 0.5, heightM: 0.9 };
    installFurniture(ctx as any, [item] as any, META as any);
    const again = installFurniture(ctx as any, [item] as any, META as any);
    expect(again).toBe(0); // same sourceRecordId already installed
    const itemNodes = Object.values(ctx.nodes).filter((n: any) => n.type === 'item');
    expect(itemNodes.length).toBe(1);
  });
});

describe('furniture dimension fallbacks (Step 8)', () => {
  it('preserves supplied finite positive dimensions', () => {
    const ctx = makeCtx();
    installFurniture(ctx as any, [{ id: 'x', familyId: 'catalog:double-bed', positionM: { x: 1, y: 1 }, widthM: 1.8, depthM: 2.0, heightM: 0.55 }] as any, META as any);
    const node: any = Object.values(ctx.nodes).find((n: any) => n.type === 'item');
    expect(node.asset.dimensions).toEqual([1.8, 0.55, 2.0]); // [w, h, d]
  });

  it('falls back to catalogue defaults when width/depth/height are absent', () => {
    const ctx = makeCtx();
    installFurniture(ctx as any, [{ id: 'x', familyId: 'catalog:cabinet', positionM: { x: 1, y: 1 } }] as any, META as any);
    const node: any = Object.values(ctx.nodes).find((n: any) => n.type === 'item');
    // cabinet catalogue: widthM .9, depthM .5, heightM .9
    expect(node.asset.dimensions).toEqual([0.9, 0.9, 0.5]);
  });

  it('rejects a non-positive (zero) width rather than silently replacing it', () => {
    const ctx = makeCtx();
    const installed = installFurniture(ctx as any, [{ id: 'z', familyId: 'catalog:cabinet', positionM: { x: 1, y: 1 }, widthM: 0, depthM: 0.5, heightM: 0.9 }] as any, META as any);
    expect(installed).toBe(0);
    expect(Object.values(ctx.nodes).filter((n: any) => n.type === 'item').length).toBe(0);
  });

  it('rejects a negative depth', () => {
    const ctx = makeCtx();
    const installed = installFurniture(ctx as any, [{ id: 'n', familyId: 'catalog:cabinet', positionM: { x: 1, y: 1 }, widthM: 0.9, depthM: -0.5, heightM: 0.9 }] as any, META as any);
    expect(installed).toBe(0);
  });

  it('rejects a non-finite (NaN) height', () => {
    const ctx = makeCtx();
    const installed = installFurniture(ctx as any, [{ id: 'nan', familyId: 'catalog:cabinet', positionM: { x: 1, y: 1 }, widthM: 0.9, depthM: 0.5, heightM: Number.NaN }] as any, META as any);
    expect(installed).toBe(0);
  });

  it('supports six same-family items with different dimensions as distinct instances', () => {
    const ctx = makeCtx();
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `cab_${i + 1}`,
      familyId: 'catalog:kitchen-counter', // widthM 2.0 depthM .6 heightM .9
      positionM: { x: 1 + i, y: 1 },
      widthM: 2.0 + i * 0.1,
      depthM: 0.6,
      heightM: 0.9,
    }));
    const installed = installFurniture(ctx as any, items as any, META as any);
    expect(installed).toBe(6);
    const nodes = Object.values(ctx.nodes).filter((n: any) => n.type === 'item') as any[];
    expect(nodes[0].asset.dimensions[0]).toBeCloseTo(2.0, 5);
    expect(nodes[5].asset.dimensions[0]).toBeCloseTo(2.5, 5);
  });
});
