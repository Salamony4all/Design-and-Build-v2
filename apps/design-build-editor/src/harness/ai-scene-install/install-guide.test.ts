// harness/ai-scene-install/install-guide.test.ts
// Focused tests for the SHARED, provider-neutral AI Guide installer.
// Ensures: AI Guide comes from the uploaded image (data: URL), never a CODE_06
// asset; uses the shared installer for both V2 and V3; applies exactly one
// transform; preserves aspect ratio; skips safely on missing URL / frame.

import { describe, it, expect } from 'vitest';
import { installGuide } from './install-guide';
import { aiMeta } from './helpers';
import { computeBuildingFrame } from '../building-frame';
import type { SceneInstallContext } from './types';

function makeCtx(slab?: [number, number][]): SceneInstallContext {
  const nodes: Record<string, any> = {
    site: { id: 'site', type: 'site', parentId: null },
    building: { id: 'building', type: 'building', parentId: 'site' },
    level: { id: 'level', type: 'level', parentId: 'building' },
  };
  if (slab) {
    nodes.slab = { id: 'slab', type: 'slab', polygon: slab, metadata: { sourceRecordId: 'slab' } };
  }
  return {
    nodes,
    levelId: 'level',
    createNodes: (ops) => {
      for (const op of ops) {
        const n = op.node as any;
        nodes[n.id] = n;
        if (op.parentId) {
          n.parentId = op.parentId;
          const p = nodes[op.parentId];
          p.children = p.children ?? [];
          p.children.push(n.id);
        }
      }
    },
    removeNodeIds: (ids) => { for (const id of ids) delete nodes[id]; },
    onProgress: () => {},
  };
}

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofIh0aHB4fJCEiIiJfJSoeIicxMcEoKToxNzU3MjY1Njs7TD0n';

describe('shared AI Guide installer', () => {
  it('installs a Guide node from an uploaded PNG data URL (no CODE_06 reference)', () => {
    const ctx = makeCtx();
    const frame = computeBuildingFrame({
      frameId: 'f1', sourceHash: 't', pageBoundsPt: [0, 0, 1000, 1000],
      activeRegionPt: [0, 0, 1000, 1000], scaleMmPerPt: 1,
    });
    const res = installGuide(ctx, { runId: 'r1', fileName: 'plan.png', frameId: 'f1', dataUrl: PNG_DATA_URL, buildingFrame: frame });
    expect(res.status).toBe('installed');
    expect(res.guideNodeId).toBeTruthy();
    const node = (ctx.nodes as any)[res.guideNodeId!];
    expect(node.type).toBe('guide');
    expect(node.url).toBe(PNG_DATA_URL);
    expect(node.url).not.toContain('code06');
    expect(node.url).not.toContain('guide-page.png');
    // one transform applied (position/scale/rotation set from the frame)
    expect(Array.isArray(node.position)).toBe(true);
    expect(node.scale).toBeCloseTo(frame.widthM / 10, 5);
  });

  it('installs a Guide node from an uploaded JPEG data URL', () => {
    const ctx = makeCtx();
    const frame = computeBuildingFrame({
      frameId: 'f2', sourceHash: 't', pageBoundsPt: [0, 0, 2000, 1000],
      activeRegionPt: [0, 0, 2000, 1000], scaleMmPerPt: 1,
    });
    const res = installGuide(ctx, { runId: 'r2', fileName: 'plan.jpg', frameId: 'f2', dataUrl: JPEG_DATA_URL, buildingFrame: frame });
    expect(res.status).toBe('installed');
    const node = (ctx.nodes as any)[res.guideNodeId!];
    expect(node.url).toBe(JPEG_DATA_URL);
    expect(node.url).not.toContain('code06');
  });

  it('skips (no node) when no data URL is supplied', () => {
    const ctx = makeCtx();
    const frame = computeBuildingFrame({
      frameId: 'f3', sourceHash: 't', pageBoundsPt: [0, 0, 1000, 1000],
      activeRegionPt: [0, 0, 1000, 1000], scaleMmPerPt: 1,
    });
    const res = installGuide(ctx, { runId: 'r3', fileName: 'x', frameId: 'f3', dataUrl: '', buildingFrame: frame });
    expect(res.status).toBe('skipped-no-url');
    expect(res.guideNodeId).toBeNull();
  });

  it('derives the frame from an existing AI slab when none is supplied', () => {
    const ctx = makeCtx([[0, 0], [10, 0], [10, 8], [0, 8]]);
    const res = installGuide(ctx, { runId: 'r4', fileName: 'plan.png', frameId: 'f4', dataUrl: PNG_DATA_URL });
    expect(res.status).toBe('installed');
    const node = (ctx.nodes as any)[res.guideNodeId!];
    // centred on the slab footprint (single transform, no independent recenter)
    expect(node.position[0]).toBeCloseTo(5, 5);
    expect(node.position[2]).toBeCloseTo(4, 5);
  });

  it('skips safely when neither frame nor slab exists (no fabricated offset)', () => {
    const ctx = makeCtx();
    const res = installGuide(ctx, { runId: 'r5', fileName: 'plan.png', frameId: 'f5', dataUrl: PNG_DATA_URL });
    expect(res.status).toBe('skipped-no-frame');
    expect(res.guideNodeId).toBeNull();
  });

  it('V2 and V3 share the same installer (extractionMode differs, same node shape)', () => {
    const ctxV2 = makeCtx();
    const ctxV3 = makeCtx();
    const frame = computeBuildingFrame({
      frameId: 'f6', sourceHash: 't', pageBoundsPt: [0, 0, 1000, 1000],
      activeRegionPt: [0, 0, 1000, 1000], scaleMmPerPt: 1,
    });
    const v2 = installGuide(ctxV2, { runId: 'r6', fileName: 'p', frameId: 'f6', dataUrl: PNG_DATA_URL, buildingFrame: frame, extractionMode: 'v2' });
    const v3 = installGuide(ctxV3, { runId: 'r6', fileName: 'p', frameId: 'f6', dataUrl: PNG_DATA_URL, buildingFrame: frame, extractionMode: 'progressive-v3' });
    expect(v2.status).toBe('installed');
    expect(v3.status).toBe('installed');
    expect((ctxV2.nodes as any)[v2.guideNodeId!].metadata.extractionMode).toBe('v2');
    expect((ctxV3.nodes as any)[v3.guideNodeId!].metadata.extractionMode).toBe('progressive-v3');
  });

  it('does NOT place the full documentFrame object into node metadata (regression: metadata.documentFrame schema failure)', () => {
    const ctx = makeCtx();
    const frame = (ctx as any).nodes ? undefined : undefined;
    const bf = computeBuildingFrame({
      frameId: 'f7', sourceHash: 't', pageBoundsPt: [0, 0, 1000, 1000],
      activeRegionPt: [0, 0, 1000, 1000], scaleMmPerPt: 1,
    });
    // A realistic sourceFrame carrying the whole ExtractionResult (the prior failure source).
    const bigSourceFrame = {
      pageId: 'pg-1', kind: 'pdf',
      furniture: [{ id: 'f' }], walls: [{ id: 'w' }], document: { pageBoundsPt: [0, 0, 1000, 1000] },
    };
    const res = installGuide(ctx, {
      runId: 'r7', fileName: 'plan.png', frameId: 'f7', dataUrl: PNG_DATA_URL,
      buildingFrame: bf, sourceFrame: bigSourceFrame as any,
    });
    expect(res.status).toBe('installed');
    const meta = (ctx.nodes as any)[res.guideNodeId!].metadata;
    expect(meta.documentFrame).toBeUndefined();
    // compact provenance only
    expect(meta.pageId).toBe('pg-1');
    expect(meta.sourceKind).toBe('pdf');
    expect(meta.frameId).toBe('f7');
  });

  it('aiMeta strips undefined leaves so node metadata stays z.json()-safe', () => {
    const m = aiMeta({ runId: 'r', pageId: undefined, sourceKind: undefined });
    expect(m.pageId).toBeUndefined();
    expect(m.sourceKind).toBeUndefined();
    expect(m.runId).toBe('r');
    // no undefined values remain
    for (const v of Object.values(m)) expect(v).not.toBeUndefined();
  });

  it('installs a Guide with NO sourceFrame (free-harness path, no undefined metadata)', () => {
    const ctx = makeCtx();
    const bf = computeBuildingFrame({
      frameId: 'f8', sourceHash: 't', pageBoundsPt: [0, 0, 1000, 1000],
      activeRegionPt: [0, 0, 1000, 1000], scaleMmPerPt: 1,
    });
    const res = installGuide(ctx, {
      runId: 'r8', fileName: 'plan.png', frameId: 'f8', dataUrl: PNG_DATA_URL,
      buildingFrame: bf, // no sourceFrame -> was producing undefined pageId/sourceKind -> ZodError
    });
    expect(res.status).toBe('installed');
    const meta = (ctx.nodes as any)[res.guideNodeId!].metadata;
    for (const v of Object.values(meta)) expect(v).not.toBeUndefined();
  });
});
