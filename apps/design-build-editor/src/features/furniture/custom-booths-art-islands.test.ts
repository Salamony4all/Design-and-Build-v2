import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const mockState = vi.hoisted(() => {
  const nodes: Record<string, any> = {};
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const registryNodes = new Map<string, any>();
  return { nodes, updates, registryNodes };
});

vi.mock('@pascal-app/core', () => ({
  ItemNode: { parse: (v: unknown) => v },
}));

vi.mock('@/harness/ai-scene-install/helpers', () => ({
  uid: (prefix: string) => `${prefix}_test`,
}));

vi.mock('design-build-simplified-viewer-shell', () => ({
  getPascalStores: () => ({
    useScene: {
      getState: () => ({
        nodes: mockState.nodes,
        updateNode: (id: string, patch: Record<string, unknown>) => {
          mockState.updates.push({ id, patch });
          mockState.nodes[id] = { ...(mockState.nodes[id] ?? {}), ...patch };
        },
        markDirty: vi.fn(),
      }),
    },
    sceneRegistry: { nodes: mockState.registryNodes },
    useViewer: { getState: () => ({ bumpGeometryRevision: vi.fn() }) },
  }),
}));

import { buildCustomFurnitureGroup, PAD_TOP_M } from './custom-model-builder';
import { applyArchitecturalFeaturesToScene } from './architectural-features';
import { matchProducts } from './match-products';
import { inferMaterialPreset, isArchitectural3DLockedPiece } from './plan-furniture';
import { buildGeometryLockPrompt } from '../render/render-presets';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const CUSTOM_ASSETS_DIR = path.join(REPO_ROOT, 'test drawings and png', 'fresh-custom');

const squareOutline = (w: number, d: number) => [
  { x: -w / 2, y: -d / 2 },
  { x: w / 2, y: -d / 2 },
  { x: w / 2, y: d / 2 },
  { x: -w / 2, y: d / 2 },
];

describe('custom booths, wardrobes, kitchen islands, customized materials & wall artworks', () => {
  it('verifies downloaded JPEG reference assets exist and are valid JPEGs', () => {
    const jpegs = [
      'kitchen-island-waterfall.jpg',
      'wall-artwork-abstract.jpg',
      'wall-artwork-gallery.jpg',
      'custom-wardrobe-fluted.jpg',
      'custom-booth-banquette.jpg',
      'custom-sofa-furniture.jpg',
      'custom-material-interior.jpg',
    ];
    for (const file of jpegs) {
      const p = path.join(CUSTOM_ASSETS_DIR, file);
      expect(fs.existsSync(p)).toBe(true);
      const buf = fs.readFileSync(p);
      expect(buf[0]).toBe(0xff);
      expect(buf[1]).toBe(0xd8);
      expect(buf.length).toBeGreaterThan(5000);
    }
  });

  it('builds 3D locked models for booth, full-height wardrobe (with glass doors), waterfall island, wall art & customized PBR materials', () => {
    // 1. Acoustic dining booth (high back shroud + vertical channel ribs + booth table)
    const booth = buildCustomFurnitureGroup({
      v: 1,
      kind: 'sofa',
      subtype: 'booth',
      shape: 'l-shape',
      widthM: 2.4,
      depthM: 1.5,
      heightM: 1.32,
      angle: 0,
      centerM: { x: 0, y: 0 },
      outlineM: squareOutline(2.4, 1.5),
      tint: '#D5CBB9',
      accentTint: '#5D3F2E',
      materialPreset: 'boucle',
    });
    expect(booth.userData.architecturalLock).toBe(true);
    expect(booth.children.length).toBeGreaterThanOrEqual(10);
    expect(new THREE.Box3().setFromObject(booth).max.y).toBeCloseTo(1.32, 1);

    // 2. Full-height wardrobe with smoked glass doors + interior shelves & bar pulls
    const wardrobe = buildCustomFurnitureGroup({
      v: 1,
      kind: 'storage',
      subtype: 'wardrobe',
      shape: 'rect',
      widthM: 2.4,
      depthM: 0.6,
      heightM: 2.35,
      angle: 0,
      centerM: { x: 0, y: 0 },
      outlineM: squareOutline(2.4, 0.6),
      tint: '#5D3F2E',
      accentTint: '#8A6D46',
      materialPreset: 'fluted-wood',
      glassDoors: true,
    });
    expect(wardrobe.userData.architecturalLock).toBe(true);
    expect(new THREE.Box3().setFromObject(wardrobe).max.y).toBeCloseTo(2.35, 1);
    expect(wardrobe.children.length).toBeGreaterThanOrEqual(12);

    // 3. Waterfall marble kitchen island with fluted apron & customized stone roughness
    const island = buildCustomFurnitureGroup({
      v: 1,
      kind: 'joinery',
      subtype: 'island',
      shape: 'rect',
      widthM: 2.8,
      depthM: 1.1,
      heightM: 0.9,
      angle: 0,
      centerM: { x: 0, y: 0 },
      outlineM: squareOutline(2.8, 1.1),
      tint: '#75533A',
      accentTint: '#8A6D46',
      tertiaryTint: '#ECE8DF',
      materialPreset: 'marble',
    });
    expect(island.userData.architecturalLock).toBe(true);
    expect(new THREE.Box3().setFromObject(island).max.y).toBeGreaterThan(0.95); // mixer tap rises above 0.9m slab
    const hasStoneMat = island.children.some(
      (ch) => ((ch as THREE.Mesh).material as THREE.MeshStandardMaterial)?.roughness === 0.24,
    );
    expect(hasStoneMat).toBe(true);

    // 4. Framed wall artwork mounted off the floor
    const art = buildCustomFurnitureGroup({
      v: 1,
      kind: 'screen',
      subtype: 'wall-art',
      shape: 'rect',
      widthM: 1.8,
      depthM: 0.08,
      heightM: 1.15,
      angle: 0,
      centerM: { x: 0, y: 0 },
      outlineM: squareOutline(1.8, 0.08),
    });
    expect(art.userData.architecturalLock).toBe(true);
    const artBox = new THREE.Box3().setFromObject(art);
    expect(artBox.min.y).toBeGreaterThan(0.8);
    expect(artBox.max.y).toBeGreaterThan(PAD_TOP_M * 40);

    expect(isArchitectural3DLockedPiece({ kind: 'sofa', subtype: 'booth', customModel: true, heightM: 1.32 })).toBe(true);
    expect(isArchitectural3DLockedPiece({ kind: 'storage', subtype: 'wardrobe', customModel: true, heightM: 2.3 })).toBe(true);
    expect(isArchitectural3DLockedPiece({ kind: 'joinery', subtype: 'island', customModel: true, heightM: 0.9 })).toBe(true);
    expect(isArchitectural3DLockedPiece({ kind: 'screen', subtype: 'wall-art', customModel: true, heightM: 1.15 })).toBe(true);
  });

  it('matches BOQ custom booths, wardrobes & islands and infers custom PBR presets cleanly', () => {
    const pieces = [
      { id: 'pc_booth', typeId: 'tb', kind: 'sofa', subtype: 'booth', shape: 'l-shape', widthM: 2.4, depthM: 1.5 },
      { id: 'pc_wrd', typeId: 'tw', kind: 'storage', subtype: 'wardrobe', shape: 'rect', widthM: 2.4, depthM: 0.6 },
      { id: 'pc_isl', typeId: 'ti', kind: 'joinery', subtype: 'island', shape: 'rect', widthM: 2.8, depthM: 1.1 },
    ];
    const products = [
      {
        id: 'FAB-BTH-01',
        description: 'Custom High-Back Upholstered Acoustic Dining Booth in Boucle Wool 2400x1500x1320 mm',
        qty: 1,
        subtype: 'booth',
      },
      {
        id: 'FAB-WRD-01',
        description: 'Bespoke Full-Height Fluted Walnut Veneer & Smoked Glass Wardrobe 2400x600x2400 mm',
        qty: 1,
        subtype: 'wardrobe',
      },
      {
        id: 'FAB-ISL-01',
        description: 'Custom Waterfall Calacatta Marble Kitchen Island 2800x1100x900 mm',
        qty: 1,
        subtype: 'island',
      },
    ];
    const matched = matchProducts(pieces, products);
    expect(matched.byPiece.pc_booth).toBe('FAB-BTH-01');
    expect(matched.byPiece.pc_wrd).toBe('FAB-WRD-01');
    expect(matched.byPiece.pc_isl).toBe('FAB-ISL-01');

    expect(inferMaterialPreset(products[0])).toBe('boucle');
    expect(inferMaterialPreset(products[1])).toBe('fluted-wood');
    expect(inferMaterialPreset(products[2])).toBe('marble');
  });

  it('mounts BOQ FAB-ART-01 wall artworks onto interior walls & emits wall-artwork render lock rules', () => {
    const threeScene = new THREE.Scene();
    const probe = new THREE.Object3D();
    threeScene.add(probe);
    mockState.registryNodes.clear();
    mockState.registryNodes.set('wall_1', probe);
    for (const k of Object.keys(mockState.nodes)) delete mockState.nodes[k];

    mockState.nodes.wall_1 = {
      id: 'wall_1',
      type: 'wall',
      start: [0, 0],
      end: [5, 0],
      height: 3.0,
      thickness: 0.2,
      visible: true,
    };

    const res = applyArchitecturalFeaturesToScene([], [
      {
        id: 'art_1',
        code: 'FAB-ART-01',
        architecturalRole: 'wall-artwork',
        qty: 1,
        description: 'Bespoke Framed Large-Format Sculptural Relief Gallery Wall Artwork 1800x60x1200 mm',
        category: 'Feature Wall / Wall Artwork',
        dims: { w: 1.8, d: 0.06, h: 1.2 },
        finishes: [
          { role: 'Canvas', name: 'Warm Plaster Relief', hex: '#DDD4C3' },
          { role: 'Frame', name: 'Brushed Bronze PVD', hex: '#8A6D46' },
        ],
      },
    ]);

    expect(res.handledProductIds.has('art_1')).toBe(true);
    expect(res.state.wallArtworks.length).toBe(1);
    expect(res.state.wallArtworks[0].style).toBe('sculptural-relief');
    const archGroup = threeScene.getObjectByName('architectural-features');
    expect(archGroup?.getObjectByName('wall-artworks')?.userData.architecturalLock).toBe(true);

    const prompt = buildGeometryLockPrompt({
      style: 'daylight',
      viewKind: 'interior',
      furnish: true,
      withEdgeGuide: true,
      withPlan: false,
      lineGuide: true,
      furniture: {
        standIns: 2,
        products: [
          {
            label: 'FAB-ISL-01 Waterfall Marble Kitchen Island',
            colour: 'brown',
            kinds: ['joinery'],
            count: 1,
            architecturalLock: true,
          },
        ],
      },
      architectural: {
        wallArtworks: [
          {
            label: 'FAB-ART-01 Sculptural Relief Wall Artwork',
            style: 'sculptural-relief',
            widthM: 1.8,
            heightM: 1.2,
            frameName: 'brushed bronze frame',
            imageIndex: 3,
          },
        ],
      },
    });
    expect(prompt).toContain('Preserve the exact framed/sculptural wall artwork(s)');
    expect(prompt).toContain('WALL ARTWORKS (FRAMED / SCULPTURAL');
    expect(prompt).toContain('match artwork composition & palette from image 3');
    expect(prompt).toContain('waterfall kitchen islands');
  });
});
