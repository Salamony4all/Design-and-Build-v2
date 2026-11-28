import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const mockState = vi.hoisted(() => {
  const nodes: Record<string, any> = {};
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const dirtyCalls: string[] = [];
  const registryNodes = new Map<string, any>();
  return { nodes, updates, dirtyCalls, registryNodes };
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
        markDirty: (id: string) => {
          mockState.dirtyCalls.push(id);
        },
      }),
    },
    sceneRegistry: { nodes: mockState.registryNodes },
    useViewer: { getState: () => ({ bumpGeometryRevision: vi.fn() }) },
  }),
}));

import { buildCeilingCanopyMesh, buildCustomFurnitureGroup, PAD_TOP_M } from './custom-model-builder';
import {
  SLAB_CLADDING_PRESETS,
  SLAB_PAINT_PRESETS,
  STANDARD_GLASS_WALL_THICKNESS_M,
  WALL_CLADDING_PRESETS,
  WALL_DECOR_PRESETS,
  WALL_PAINT_PRESETS,
  applyArchitecturalFeaturesToScene,
  applyManualSlabTreatment,
  applyManualWallTreatment,
  classifyArchitecturalProduct,
  clearManualSlabTreatment,
  clearManualWallTreatment,
  getActiveArchitecturalFeatures,
  getManualSlabTreatment,
  getManualWallTreatment,
  resetArchitecturalFeaturesState,
  sampleWallCenterline,
  updateSlabPropertiesLive,
  updateWallPropertiesLive,
} from './architectural-features';
import { isArchitectural3DLockedPiece } from './plan-furniture';

describe('3D architectural lock for kiosks, slats, ceilings & wall/glazing treatments', () => {
  it('builds full-height 3D retail kiosk with vitrine, central fluted column, and open slat screen (never flat 2D pads)', () => {
    const outline = [
      { x: -1.1, y: -0.4 },
      { x: 1.1, y: -0.4 },
      { x: 1.1, y: 0.4 },
      { x: -1.1, y: 0.4 },
    ];
    const kiosk = buildCustomFurnitureGroup({
      v: 1,
      kind: 'joinery',
      subtype: 'retail-kiosk',
      shape: 'curved',
      widthM: 2.2,
      depthM: 0.8,
      heightM: 1.22,
      angle: 0,
      centerM: { x: 0, y: 0 },
      outlineM: outline,
      tint: '#7c563a',
      accentTint: '#8c6f47',
    });
    expect(kiosk.userData.architecturalLock).toBe(true);
    const box = new THREE.Box3().setFromObject(kiosk);
    expect(box.max.y).toBeGreaterThan(1.1);
    expect(box.max.y).toBeGreaterThan(PAD_TOP_M * 10);

    const col = buildCustomFurnitureGroup({
      v: 1,
      kind: 'joinery',
      subtype: 'feature-column',
      shape: 'round',
      widthM: 1.38,
      depthM: 1.38,
      heightM: 3.0,
      angle: 0,
      centerM: { x: 0, y: 0 },
      outlineM: outline,
    });
    expect(col.userData.architecturalLock).toBe(true);
    expect(new THREE.Box3().setFromObject(col).max.y).toBeCloseTo(3.0, 1);

    const screen = buildCustomFurnitureGroup({
      v: 1,
      kind: 'screen',
      subtype: 'slat-screen',
      shape: 'curved',
      widthM: 3.2,
      depthM: 0.14,
      heightM: 2.5,
      angle: 0,
      centerM: { x: 0, y: 0 },
      outlineM: outline,
    });
    expect(screen.userData.architecturalLock).toBe(true);
    // Individual vertical louvers + top/bottom tracks
    expect(screen.children.length).toBeGreaterThanOrEqual(8);
  });

  it('marks retail kiosks, counters, feature columns & slat screens as 3D-locked against 2D photo flattening', () => {
    expect(isArchitectural3DLockedPiece({ kind: 'joinery', subtype: 'retail-kiosk', customModel: true, heightM: 1.2 })).toBe(true);
    expect(isArchitectural3DLockedPiece({ kind: 'screen', subtype: 'slat-screen', customModel: true, heightM: 2.5 })).toBe(true);
    expect(isArchitectural3DLockedPiece({ kind: 'seat', subtype: 'armchair', customModel: false, heightM: 0.45 })).toBe(false);
  });

  it('builds 3D suspended rotunda canopy mesh positioned at ceiling level with radial slats and cove', () => {
    const canopy = buildCeilingCanopyMesh({
      id: 'az_1',
      shape: 'round',
      centerM: { x: 26.5, y: 18.6 },
      widthM: 8.6,
      depthM: 8.6,
      radiusM: 4.3,
      innerRadiiM: [1.4],
      outlineM: [],
      wallTopM: 3.0,
      dropM: 0.28,
      style: 'slatted-ring',
    });
    expect(canopy.userData.architecturalLock).toBe(true);
    expect(canopy.userData.ceilingStyle).toBe('slatted-ring');
    expect(canopy.children.length).toBeGreaterThanOrEqual(45);
    const box = new THREE.Box3().setFromObject(canopy);
    expect(box.max.y).toBeCloseTo(3.0, 1);
    expect(box.min.y).toBeCloseTo(2.72, 1);
  });

  it('classifies BOQ wall cladding, specialty glazing & ceiling lines accurately and samples curved walls', () => {
    const fluted = classifyArchitecturalProduct({
      code: 'WC-FLT-01',
      description: 'Autex Fluted Timber / Slatted Acoustic Wall Panel',
      category: 'Partitions & Wall Cladding',
      finishes: [{ role: 'Timber Slat', name: 'Natural Oak', hex: '#C29D6E' }],
    });
    expect(fluted?.role).toBe('wall-cladding');
    expect(fluted?.claddingStyle).toBe('fluted-wood');

    const reededGlass = classifyArchitecturalProduct({
      code: 'PT-GLS-03',
      description: 'Saint-Gobain Frosted / Fluted Decorative Glass Partition',
      category: 'Partitions & Wall Cladding',
      finishes: [{ role: 'Frame', name: 'Brushed Bronze', hex: '#8A6D46' }],
    });
    expect(reededGlass?.role).toBe('glazing-partition');
    expect(reededGlass?.glazingStyle).toBe('fluted-glass');

    const canopySpec = classifyArchitecturalProduct({
      code: 'FAB-CLG-01',
      description: 'Suspended Circular Slatted Timber & Bronze Feature Ceiling Canopy',
      category: 'Feature Ceiling',
    });
    expect(canopySpec?.role).toBe('ceiling-feature');
    expect(canopySpec?.ceilingStyle).toBe('slatted-ring');

    const curvedSamples = sampleWallCenterline({
      id: 'w1',
      type: 'wall',
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1.0,
    });
    expect(curvedSamples.length).toBeGreaterThan(4);
    expect(curvedSamples.some((p) => Math.abs(p.z) > 0.5)).toBe(true);
  });

  it('binds WC-FLT-01, PT-GLS-03, and FAB-CLG-01 onto live curved walls & Three.js architectural group', () => {
    const threeScene = new THREE.Scene();
    const probeObj = new THREE.Object3D();
    threeScene.add(probeObj);
    mockState.registryNodes.clear();
    mockState.registryNodes.set('w_solid', probeObj);
    mockState.updates.length = 0;
    for (const k of Object.keys(mockState.nodes)) delete mockState.nodes[k];

    mockState.nodes.w_solid = {
      id: 'w_solid',
      type: 'wall',
      start: [0, 0],
      end: [4, 0],
      curveOffset: 0.9,
      height: 3.0,
      thickness: 0.15,
      visible: true,
      materialPreset: 'plaster',
      metadata: { wallClassification: 'CURVED_WALL' },
    };
    mockState.nodes.w_glass = {
      id: 'w_glass',
      type: 'wall',
      start: [6, 0],
      end: [10, 0],
      curveOffset: 0.85,
      height: 2.8,
      thickness: 0.06,
      visible: true,
      materialPreset: 'glass',
      metadata: { wallClassification: 'POD_GLAZING', podId: 'pod-1' },
    };

    const res = applyArchitecturalFeaturesToScene(
      [
        {
          id: 'az_rotunda',
          kind: 'rotunda-canopy',
          shape: 'round',
          centerM: { x: 2, y: 0 },
          widthM: 6.4,
          depthM: 6.4,
          radiusM: 3.2,
          innerRadiiM: [1.1],
          outlineM: [],
          label: 'Main Rotunda Canopy',
        },
      ],
      [
        {
          id: 'p_fluted',
          qty: 1,
          code: 'WC-FLT-01',
          description: 'Fluted Timber Wall Cladding',
          category: 'Partitions & Wall Cladding',
          finishes: [{ role: 'Primary', name: 'Natural Oak', hex: '#C29D6E' }],
        },
        {
          id: 'p_glazing',
          qty: 1,
          code: 'PT-GLS-03',
          description: 'Frosted / Fluted Decorative Glass Partition',
          category: 'Partitions & Wall Cladding',
          finishes: [{ role: 'Frame', name: 'Brushed Bronze', hex: '#8A6D46' }],
        },
        {
          id: 'p_ceiling',
          qty: 1,
          code: 'FAB-CLG-01',
          description: 'Suspended Circular Slatted Timber & Bronze Feature Ceiling Canopy',
          category: 'Feature Ceiling',
          customZoneId: 'az_rotunda',
        },
      ],
    );

    expect(res.handledProductIds.has('p_fluted')).toBe(true);
    expect(res.handledProductIds.has('p_glazing')).toBe(true);
    expect(res.handledProductIds.has('p_ceiling')).toBe(true);

    expect(mockState.nodes.w_solid.materialPreset).toBeUndefined();
    expect(mockState.nodes.w_solid.metadata?.architecturalTreatment?.role).toBe('wall-cladding');
    expect(mockState.nodes.w_solid.metadata?.architecturalTreatment?.style).toBe('fluted-wood');

    expect(mockState.nodes.w_glass.materialPreset).toBeUndefined();
    expect(mockState.nodes.w_glass.metadata?.architecturalTreatment?.role).toBe('glazing-partition');
    expect(mockState.nodes.w_glass.metadata?.architecturalTreatment?.style).toBe('fluted-glass');

    expect(res.state.ceilings.length).toBe(1);
    expect(res.state.ceilings[0].code).toBe('FAB-CLG-01');
    expect(res.state.ceilings[0].style).toBe('slatted-ring');

    const archGroup = threeScene.getObjectByName('architectural-features');
    expect(archGroup).toBeTruthy();
    expect(archGroup?.userData.architecturalLock).toBe(true);
    expect((archGroup?.children.length ?? 0)).toBeGreaterThanOrEqual(3);
  });

  it('exposes wall cladding & decor presets and applies/clears manual wall treatments with Pascal precedence overrides', () => {
    resetArchitecturalFeaturesState();
    const threeScene = new THREE.Scene();
    const probeObj = new THREE.Object3D();
    threeScene.add(probeObj);
    mockState.registryNodes.clear();
    mockState.registryNodes.set('w_manual', probeObj);
    mockState.updates.length = 0;
    for (const k of Object.keys(mockState.nodes)) delete mockState.nodes[k];

    mockState.nodes.w_manual = {
      id: 'w_manual',
      type: 'wall',
      start: [0, 0],
      end: [5, 0],
      height: 3.0,
      thickness: 0.2,
      visible: true,
      materialPreset: 'plaster',
      interiorMaterialPreset: 'plaster',
      exteriorMaterialPreset: 'concrete',
      slots: { interior: 'plaster', exterior: 'concrete' },
      metadata: {},
    };

    expect(WALL_CLADDING_PRESETS.some((p) => p.id === 'fluted-oak')).toBe(true);
    expect(WALL_CLADDING_PRESETS.some((p) => p.id === 'veneer-brass')).toBe(true);
    expect(WALL_DECOR_PRESETS.some((d) => d.id === 'backlit-mirror')).toBe(true);
    expect(WALL_DECOR_PRESETS.some((d) => d.id === 'wall-sconces')).toBe(true);

    let invalidated = 0;
    applyManualWallTreatment(
      ['w_manual'],
      {
        claddingPreset: 'fluted-oak',
        side: 'interior',
        skirting: true,
        crown: true,
        chairRail: true,
        ledCove: true,
        decorKind: 'framed-canvas',
        decorTitle: 'Abstract Gallery Print',
        decorImageUrl: 'data:image/png;base64,iVBORw0KGgo=',
      },
      () => {
        invalidated++;
      },
    );

    expect(invalidated).toBe(1);
    const wAfter = mockState.nodes.w_manual;
    // Pascal material precedence requires clearing slots & *MaterialPreset on treated sides
    expect(wAfter.slots?.interior).toBeUndefined();
    expect(wAfter.slots?.exterior).toBe('concrete');
    expect(wAfter.interiorMaterialPreset).toBeUndefined();
    expect(wAfter.interiorMaterial?.properties?.color).toBe('#C29D6E');
    expect(wAfter.skirting?.enabled).toBe(true);
    expect(wAfter.skirting?.profile).toBe('base-modern');
    expect(wAfter.crown?.enabled).toBe(true);
    expect(wAfter.crown?.profile).toBe('crown-cove');
    expect(wAfter.chairRail?.enabled).toBe(true);
    expect(wAfter.chairRail?.profile).toBe('rail-stepped');

    const stored = getManualWallTreatment('w_manual');
    expect(stored.claddingPreset).toBe('fluted-oak');
    expect(stored.decorKind).toBe('framed-canvas');
    expect(stored.ledCove).toBe(true);

    const state = getActiveArchitecturalFeatures();
    expect(state.wallCladdings.some((c) => c.productId === 'manual-wall-w_manual')).toBe(true);
    expect(state.wallArtworks.some((a) => a.productId === 'manual-art-w_manual' && a.label === 'Abstract Gallery Print')).toBe(true);

    const manualGroup = threeScene.getObjectByName('architectural-features')?.getObjectByName('manual-wall-treatments');
    expect(manualGroup).toBeTruthy();
    expect(manualGroup?.getObjectByName('wall-cladding-flutes')).toBeTruthy();
    expect(manualGroup?.getObjectByName('wall-led-cove')).toBeTruthy();
    expect(manualGroup?.getObjectByName('wall-artworks')).toBeTruthy();

    applyManualWallTreatment(['w_manual'], { claddingPreset: 'veneer-brass', side: 'both', decorKind: 'backlit-mirror' });
    expect(threeScene.getObjectByName('manual-wall-treatments')?.getObjectByName('wall-decor-backlit-mirror')).toBeTruthy();

    applyManualWallTreatment(['w_manual'], { decorKind: 'wall-sconces' });
    expect(threeScene.getObjectByName('manual-wall-treatments')?.getObjectByName('wall-decor-wall-sconces')).toBeTruthy();

    clearManualWallTreatment(['w_manual'], () => {
      invalidated++;
    });
    expect(invalidated).toBe(2);
    expect(mockState.nodes.w_manual.materialPreset).toBe('plaster');
    expect(mockState.nodes.w_manual.skirting?.enabled).toBe(false);
    expect(mockState.nodes.w_manual.crown?.enabled).toBe(false);
    expect(mockState.nodes.w_manual.chairRail?.enabled).toBe(false);
    expect(getManualWallTreatment('w_manual')).toEqual({});
    expect(getActiveArchitecturalFeatures().wallCladdings.filter((c) => c.productId === 'manual-wall-w_manual')).toHaveLength(0);
    expect(getActiveArchitecturalFeatures().wallArtworks.filter((a) => a.productId === 'manual-art-w_manual')).toHaveLength(0);
  });

  it('binds BOQ Flow arch_walls custom targets for wall cladding and wall artwork onto solid straight walls', () => {
    const threeScene = new THREE.Scene();
    const probeObj = new THREE.Object3D();
    threeScene.add(probeObj);
    mockState.registryNodes.clear();
    mockState.registryNodes.set('w_straight', probeObj);
    for (const k of Object.keys(mockState.nodes)) delete mockState.nodes[k];

    mockState.nodes.w_straight = {
      id: 'w_straight',
      type: 'wall',
      start: [0, 0],
      end: [6, 0],
      height: 3.0,
      thickness: 0.2,
      visible: true,
      children: [],
      materialPreset: 'plaster',
      metadata: {},
    };

    const res = applyArchitecturalFeaturesToScene([], [
      {
        id: 'custom-arch_walls-clad',
        qty: 1,
        customZoneId: 'arch_walls',
        typeId: 'arch_walls',
        architecturalRole: 'wall-cladding',
        code: 'WC-WOD-01',
        description: 'Custom Quarter-Cut Veneer Wall Cladding — bronze inlay',
        category: 'Custom Fabrication',
        finishes: [{ role: 'Veneer', name: 'Walnut Veneer', hex: '#875F3F' }],
      },
      {
        id: 'custom-arch_walls-art',
        qty: 1,
        customZoneId: 'arch_walls',
        typeId: 'arch_walls',
        architecturalRole: 'wall-artwork',
        code: 'FAB-ART-01',
        description: 'Commissioned Framed Gallery Artwork',
        category: 'Custom Fabrication',
      },
    ]);

    expect(res.handledProductIds.has('custom-arch_walls-clad')).toBe(true);
    expect(res.handledProductIds.has('custom-arch_walls-art')).toBe(true);
    expect(res.state.wallCladdings.some((c) => c.productId === 'custom-arch_walls-clad')).toBe(true);
    expect(res.state.wallArtworks.some((a) => a.productId === 'custom-arch_walls-art')).toBe(true);
  });

  it('supports real-time single-sided wall painting, fluted glass partition conversion, and live dimensions', () => {
    const threeScene = new THREE.Scene();
    const probeObj = new THREE.Object3D();
    threeScene.add(probeObj);
    mockState.registryNodes.clear();
    mockState.registryNodes.set('w_a', probeObj);
    mockState.dirtyCalls.length = 0;
    for (const k of Object.keys(mockState.nodes)) delete mockState.nodes[k];

    mockState.nodes.w_a = {
      id: 'w_a',
      type: 'wall',
      start: [0, 0],
      end: [4, 0],
      height: 3.0,
      thickness: 0.2,
      visible: true,
      slots: { interior: 'plaster', lowerInterior: 'tile', exterior: 'concrete' },
      metadata: {},
    };
    mockState.nodes.w_b = {
      id: 'w_b',
      type: 'wall',
      start: [4.03, 0.01],
      end: [4, 3],
      height: 3.0,
      thickness: 0.2,
      visible: true,
      metadata: {},
    };
    mockState.nodes.w_far = {
      id: 'w_far',
      type: 'wall',
      start: [10, 10],
      end: [14, 10],
      height: 3.0,
      thickness: 0.2,
      visible: true,
      metadata: {},
    };

    expect(WALL_PAINT_PRESETS.length).toBeGreaterThanOrEqual(6);

    applyManualWallTreatment(['w_a'], {
      surfaceMode: 'paint',
      paintHex: '#8C9B8E',
      paintSheen: 'satin',
      side: 'interior',
    });

    const wPainted = mockState.nodes.w_a;
    expect(wPainted.slots?.interior).toBeUndefined();
    expect(wPainted.slots?.lowerInterior).toBeUndefined();
    expect(wPainted.slots?.exterior).toBe('concrete');
    expect(wPainted.material).toBeUndefined();
    expect(wPainted.exteriorMaterial).toBeUndefined();
    expect(wPainted.interiorMaterial?.properties?.color).toBe('#8C9B8E');
    expect(wPainted.interiorMaterial?.properties?.roughness).toBe(0.42);
    expect(
      getActiveArchitecturalFeatures().wallCladdings.some(
        (c) => c.productId === 'manual-wall-w_a' && c.style === 'painted-plaster' && c.colourHex === '#8C9B8E',
      ),
    ).toBe(true);

    applyManualWallTreatment(['w_a'], {
      surfaceMode: 'fluted-glass',
      accentHex: '#8a6d46',
    });

    expect(
      getActiveArchitecturalFeatures().glazingExecutions.some(
        (g) => g.productId === 'manual-glass-w_a' && g.style === 'fluted-glass' && g.frameHex === '#8a6d46',
      ),
    ).toBe(true);
    const mullions = threeScene.getObjectByName('manual-wall-treatments')?.getObjectByName('glazing-mullions');
    expect(mullions).toBeTruthy();
    expect(mullions?.children.some((c) => c.userData?.wallId === 'w_a')).toBe(true);

    mockState.dirtyCalls.length = 0;
    updateWallPropertiesLive(['w_a'], { height: 4.2, thickness: 0.32, visible: false });
    expect(mockState.nodes.w_a.height).toBe(4.2);
    expect(mockState.nodes.w_a.thickness).toBe(0.32);
    expect(mockState.nodes.w_a.visible).toBe(false);
    expect(mockState.dirtyCalls).toContain('w_a');
    expect(mockState.dirtyCalls).toContain('w_b');
    expect(mockState.dirtyCalls).not.toContain('w_far');
  });

  it('slims block walls to standard 0.024m glass thickness and restores solid thickness on paint/clear', () => {
    const threeScene = new THREE.Scene();
    const probeObj = new THREE.Object3D();
    threeScene.add(probeObj);
    mockState.registryNodes.clear();
    mockState.registryNodes.set('w_block', probeObj);
    for (const k of Object.keys(mockState.nodes)) delete mockState.nodes[k];

    mockState.nodes.w_block = {
      id: 'w_block',
      type: 'wall',
      start: [0, 0],
      end: [5, 0],
      height: 3.0,
      thickness: 0.22,
      visible: true,
      metadata: {},
    };

    applyManualWallTreatment(['w_block'], { surfaceMode: 'clear-glass', accentHex: '#2f3237' });
    expect(mockState.nodes.w_block.thickness).toBe(STANDARD_GLASS_WALL_THICKNESS_M);
    expect(getManualWallTreatment('w_block').savedSolidThicknessM).toBe(0.22);

    applyManualWallTreatment(['w_block'], { surfaceMode: 'paint', paintHex: '#8C9B8E' });
    expect(mockState.nodes.w_block.thickness).toBe(0.22);
    expect(getManualWallTreatment('w_block').savedSolidThicknessM).toBeUndefined();

    applyManualWallTreatment(['w_block'], { surfaceMode: 'fluted-glass' });
    expect(mockState.nodes.w_block.thickness).toBe(STANDARD_GLASS_WALL_THICKNESS_M);

    clearManualWallTreatment(['w_block']);
    expect(mockState.nodes.w_block.thickness).toBe(0.22);
  });

  it('supports slab paint/flooring finishes (FrontSide MRT-safe), elevation edits, and reset to parquet', () => {
    const threeScene = new THREE.Scene();
    const probeObj = new THREE.Object3D();
    threeScene.add(probeObj);
    mockState.registryNodes.clear();
    mockState.registryNodes.set('slab_main', probeObj);
    for (const k of Object.keys(mockState.nodes)) delete mockState.nodes[k];

    mockState.nodes.slab_main = {
      id: 'slab_main',
      type: 'slab',
      polygon: [[0, 0], [8, 0], [8, 6], [0, 6]],
      elevation: 0.05,
      visible: true,
      materialPreset: 'parquet',
      slots: { surface: 'library:parquet', side: 'library:concrete' },
      metadata: {},
    };

    expect(SLAB_PAINT_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(SLAB_CLADDING_PRESETS.length).toBeGreaterThanOrEqual(6);

    applyManualSlabTreatment(['slab_main'], {
      surfaceMode: 'cladding',
      claddingPreset: 'herringbone-walnut',
      primaryHex: '#684836',
    });

    const afterClad = mockState.nodes.slab_main;
    expect(afterClad.slots?.surface).toBeUndefined();
    expect(afterClad.slots?.side).toBeUndefined();
    expect(afterClad.material?.properties?.color).toBe('#684836');
    expect(afterClad.material?.properties?.side).toBeUndefined();
    expect(getManualSlabTreatment('slab_main').claddingPreset).toBe('herringbone-walnut');
    expect(getActiveArchitecturalFeatures().slabFinishes?.some((f) => f.slabId === 'slab_main')).toBe(true);

    updateSlabPropertiesLive(['slab_main'], { elevation: 0.12 });
    expect(mockState.nodes.slab_main.elevation).toBe(0.12);

    clearManualSlabTreatment(['slab_main']);
    expect(mockState.nodes.slab_main.materialPreset).toBe('parquet');
    expect(mockState.nodes.slab_main.material).toBeUndefined();
    expect(getManualSlabTreatment('slab_main')).toEqual({});
    expect(getActiveArchitecturalFeatures().slabFinishes).toHaveLength(0);
  });
});
