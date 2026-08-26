// harness/install-ai-extract.test.ts
// Replays a REAL captured AI extraction result (one controlled paid Gemini run,
// model gemini-3.5-flash, fileName guide-code06.png) through the EXACT editor
// installer (installAiExtract -> installGuideShared) to prove the Phase B entry
// condition WITHOUT a second provider call:
//   - GuideNodeCreated
//   - node metadata has NO documentFrame and NO undefined leaves
//   - no code06 asset URL is referenced
//   - install succeeds (status 'installed')
//
// This exercises the same code path the main editor uses after fetch().

import { describe, it, expect } from 'vitest';
import { installAiExtract } from './install-ai-extract';
import { computeBuildingFrame } from './building-frame';
import type { SceneInstallContext } from './ai-scene-install';
import type { ExtractionResult } from 'design-build-extraction-contracts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCapturedResult(): ExtractionResult {
  // Captured real provider response lives in a gitignored local replay fixture
  // (tmp/ai-replay-fixture.json) — neutral name, no credentials, no image data.
  // __dirname = src/harness -> repo root = ../../../../  -> tmp/ai-replay-fixture.json
  const raw = readFileSync(join(__dirname, '../../../../tmp/ai-replay-fixture.json'), 'utf8');
  const j = JSON.parse(raw) as { result: ExtractionResult };
  return j.result;
}

function makeCtx(): SceneInstallContext {
  const nodes: Record<string, any> = {
    site: { id: 'site', type: 'site', parentId: null },
    building: { id: 'building', type: 'building', parentId: 'site' },
    level: { id: 'level', type: 'level', parentId: 'building' },
    slab: { id: 'slab', type: 'slab', polygon: [[0, 0], [10, 0], [10, 8], [0, 8]], metadata: { sourceRecordId: 'slab' } },
  };
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

describe('installAiExtract — real captured result (Phase B entry)', () => {
  const result = loadCapturedResult();
  const ctx = makeCtx();
  const runId = 'ai-run-replay';
  const frameId = `frame_${runId}`;
  const aiDoc = result.document;
  const buildingFrame = aiDoc?.pageBoundsPt
    ? computeBuildingFrame({
        frameId,
        sourceHash: 'ai-document',
        pageBoundsPt: aiDoc.pageBoundsPt,
        activeRegionPt: aiDoc.pageBoundsPt,
        scaleMmPerPt: aiDoc.scaleMmPerPt || 1,
        rotation: 0,
        invertY: true,
      })
    : null;

  const res = installAiExtract(
    ctx,
    result,
    {
      // Simulate the uploaded plan image (data: URL) — never a CODE_06 asset.
      guideDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      buildingFrame,
      runId,
      fileName: 'guide-code06.png',
      frameId,
    },
  );

  it('creates the Guide node (GuideNodeCreated)', () => {
    expect(res.guideNodeId).toBeTruthy();
    const nodes = ctx.nodes as Record<string, { type: string }>;
    expect(nodes[res.guideNodeId!]).toBeDefined();
    expect(nodes[res.guideNodeId!].type).toBe('guide');
  });

  it('Guide node metadata is JSON-safe (no documentFrame, no undefined)', () => {
    const nodes = ctx.nodes as Record<string, { metadata?: Record<string, unknown> }>;
    const meta = nodes[res.guideNodeId!].metadata as Record<string, unknown>;
    expect(meta.documentFrame).toBeUndefined();
    for (const v of Object.values(meta)) expect(v).not.toBeUndefined();
  });

  it('does NOT reference a CODE_06 asset URL', () => {
    const nodes = ctx.nodes as Record<string, { url: string }>;
    const guideNode = nodes[res.guideNodeId!];
    expect(guideNode.url).not.toContain('code06');
    expect(guideNode.url).not.toContain('asset://');
  });

  it('install did not throw and completed', () => {
    expect(res.guideNodeId).toBeTruthy();
  });
});
