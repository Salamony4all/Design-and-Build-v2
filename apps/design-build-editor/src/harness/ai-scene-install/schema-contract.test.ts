// apps/design-build-editor/src/harness/ai-scene-install/schema-contract.test.ts
// §2 — Real Pascal schema-contract test. Uses the ACTUAL installed @pascal-app/core
// schema (via the real-schema alias), NOT the passthrough stub. Proves the drafts the
// V3 installers build satisfy the real node schemas (guide/slab/wall/window/door/item).
import { describe, it, expect } from 'vitest';
import { GuideNode, SlabNode, WallNode, WindowNode, DoorNode, ItemNode } from '@pascal-app/core';

describe('§2 real Pascal schema contracts', () => {
  it('guide node parses (url + scale)', () => {
    const n = GuideNode.parse({ id: 'g1', name: 'Guide', url: 'data:image/png;base64,AAA', scale: 100, parentId: 'lvl' });
    expect(n.id).toBe('g1');
    expect(n.type).toBe('guide');
  });

  it('slab node parses (polygon + thickness)', () => {
    const n = SlabNode.parse({ id: 's1', name: 'Slab', parentId: 'lvl', polygon: [[0, 0], [5, 0], [5, 5], [0, 5]], thickness: 0.2 });
    expect(n.id).toBe('s1');
    expect(n.type).toBe('slab');
  });

  it('wall node parses (start/end/thickness/height)', () => {
    const n = WallNode.parse({ id: 'w1', name: 'Wall', parentId: 'lvl', start: [0, 0], end: [5, 0], thickness: 0.2, height: 3 });
    expect(n.id).toBe('w1');
    expect(n.type).toBe('wall');
  });

  it('window node parses (host wall + wall-local position)', () => {
    const n = WindowNode.parse({ id: 'win1', name: 'Window', parentId: 'w1', wallId: 'w1', width: 1, height: 1.2, position: [2, 1, 0], rotation: [0, 0, 0] });
    expect(n.id).toBe('win1');
    expect(n.type).toBe('window');
  });

  it('door node parses (host wall + wall-local position)', () => {
    const n = DoorNode.parse({ id: 'd1', name: 'Door', parentId: 'w1', wallId: 'w1', width: 0.9, height: 2.1, position: [2, 1, 0], rotation: [0, 0, 0] });
    expect(n.id).toBe('d1');
    expect(n.type).toBe('door');
  });

  it('item node parses (asset + position)', () => {
    const n = ItemNode.parse({ id: 'i1', name: 'Sofa', parentId: 'lvl', position: [2, 0, 2], asset: { id: 'catalog:reception-sofa', dimensions: [2, 0.8, 0.9], rotation: [0, 0, 0] } });
    expect(n.id).toBe('i1');
    expect(n.type).toBe('item');
  });
});
