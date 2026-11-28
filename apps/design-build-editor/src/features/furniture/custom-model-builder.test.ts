import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PAD_TOP_M,
  buildCustomFurnitureGroup,
  disposeObject3D,
  recipeSignature,
  sanitizeOutline,
  type CustomModelRecipe,
} from './custom-model-builder';

function rectOutline(cx: number, cy: number, w: number, d: number) {
  return [
    { x: cx - w / 2, y: cy - d / 2 },
    { x: cx + w / 2, y: cy - d / 2 },
    { x: cx + w / 2, y: cy + d / 2 },
    { x: cx - w / 2, y: cy + d / 2 },
  ];
}

function lShapeOutline(cx: number, cy: number) {
  return [
    { x: cx - 1.5, y: cy - 1.2 },
    { x: cx + 1.5, y: cy - 1.2 },
    { x: cx + 1.5, y: cy - 0.3 },
    { x: cx - 0.4, y: cy - 0.3 },
    { x: cx - 0.4, y: cy + 1.2 },
    { x: cx - 1.5, y: cy + 1.2 },
  ];
}

function boxOf(obj: THREE.Object3D) {
  const b = new THREE.Box3().setFromObject(obj);
  const s = new THREE.Vector3();
  b.getSize(s);
  return { min: b.min, max: b.max, size: s };
}

function meshCount(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) n++;
  });
  return n;
}

const baseRecipe = (overrides: Partial<CustomModelRecipe>): CustomModelRecipe => ({
  v: 1,
  kind: 'seat',
  shape: 'rect',
  widthM: 0.6,
  depthM: 0.6,
  heightM: 0.45,
  angle: 0,
  centerM: { x: 2, y: 3 },
  outlineM: rectOutline(2, 3, 0.6, 0.6),
  ...overrides,
});

describe('custom-model-builder', () => {
  it('sanitizes degenerate and duplicate vertices safely', () => {
    expect(sanitizeOutline([{ x: 0, y: 0 }, { x: 0.0001, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.0001 }])).toEqual([]);
    const clean = sanitizeOutline([
      { x: 0, y: 0 },
      { x: 0.0005, y: 0.0005 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(clean).toHaveLength(4);
  });

  it('builds thin coloured pads when pad=true', () => {
    const g = buildCustomFurnitureGroup(baseRecipe({ pad: true, tint: '#c0504d' }));
    const b = boxOf(g);
    expect(b.max.y).toBeCloseTo(PAD_TOP_M, 2);
    expect(meshCount(g)).toBe(1);
    disposeObject3D(g);
  });

  it('builds compact chairs with 4 legs, seat pan and backrest', () => {
    const g = buildCustomFurnitureGroup(baseRecipe({ kind: 'seat', subtype: 'chair', facing: Math.PI / 2 }));
    const b = boxOf(g);
    expect(meshCount(g)).toBe(6); // 4 legs + seat + backrest
    expect(b.max.y).toBeCloseTo(0.82, 2);
    disposeObject3D(g);
  });

  it('builds sofas and L-sofas with plinth, base, cushion sub-parts, back and arms', () => {
    const g = buildCustomFurnitureGroup(
      baseRecipe({
        kind: 'sofa',
        subtype: 'l-sofa',
        shape: 'l-shape',
        widthM: 3.0,
        depthM: 2.4,
        facing: Math.PI / 4,
        outlineM: lShapeOutline(2, 3),
        subParts: [
          { role: 'cushion', outlineM: rectOutline(1.2, 2.2, 0.7, 0.7) },
          { role: 'cushion', outlineM: rectOutline(2.1, 2.2, 0.7, 0.7) },
        ],
      }),
    );
    expect(meshCount(g)).toBeGreaterThanOrEqual(5);
    const b = boxOf(g);
    expect(b.max.y).toBeGreaterThan(0.7);
    disposeObject3D(g);
  });

  it('builds span-aware tables: single stem, 4-leg rect, and twin-pedestal long conference tables', () => {
    const small = buildCustomFurnitureGroup(baseRecipe({ kind: 'table', subtype: 'side-table', widthM: 0.5, depthM: 0.5, heightM: 0.5, outlineM: rectOutline(2, 3, 0.5, 0.5) }));
    expect(meshCount(small)).toBe(3); // top + stem + base
    expect(boxOf(small).max.y).toBeCloseTo(0.5, 2);
    disposeObject3D(small);

    const med = buildCustomFurnitureGroup(baseRecipe({ kind: 'table', subtype: 'dining-table', widthM: 1.8, depthM: 0.9, heightM: 0.74, outlineM: rectOutline(2, 3, 1.8, 0.9) }));
    expect(meshCount(med)).toBe(5); // top + 4 corner legs
    disposeObject3D(med);

    const long = buildCustomFurnitureGroup(baseRecipe({ kind: 'table', subtype: 'meeting-table', widthM: 3.2, depthM: 1.2, heightM: 0.74, outlineM: rectOutline(2, 3, 3.2, 1.2) }));
    expect(meshCount(long)).toBe(6); // top + 2 pedestals + 2 feet + rail
    disposeObject3D(long);
  });

  it('builds desks, reception counters, and beds with pillows', () => {
    const rec = buildCustomFurnitureGroup(baseRecipe({ kind: 'desk', subtype: 'reception-counter', widthM: 3.0, depthM: 0.9, heightM: 1.06, facing: Math.PI / 2, outlineM: rectOutline(2, 3, 3.0, 0.9) }));
    expect(boxOf(rec).max.y).toBeGreaterThan(1.0);
    disposeObject3D(rec);

    const bed = buildCustomFurnitureGroup(
      baseRecipe({
        kind: 'bed',
        subtype: 'double-bed',
        widthM: 2.0,
        depthM: 1.8,
        heightM: 0.52,
        facing: 0,
        outlineM: rectOutline(2, 3, 2.0, 1.8),
        subParts: [
          { role: 'pillow', outlineM: rectOutline(1.25, 2.55, 0.35, 0.65) },
          { role: 'pillow', outlineM: rectOutline(1.25, 3.45, 0.35, 0.65) },
        ],
      }),
    );
    expect(meshCount(bed)).toBe(5); // frame + mattress + headboard + 2 pillows
    expect(boxOf(bed).max.y).toBeCloseTo(1.05, 2);
    disposeObject3D(bed);
  });

  it('builds kitchen counters with elevated dashed overhead cabinets (> 1.4m) and sink cutouts', () => {
    const kitchen = buildCustomFurnitureGroup(
      baseRecipe({
        kind: 'joinery',
        subtype: 'kitchen-counter',
        widthM: 2.6,
        depthM: 0.65,
        heightM: 0.9,
        outlineM: rectOutline(2, 3, 2.6, 0.65),
        subParts: [
          { role: 'overhead', dashed: true, outlineM: rectOutline(2, 2.84, 2.4, 0.32) },
          { role: 'cutout', outlineM: rectOutline(2.2, 3, 0.5, 0.4) },
        ],
      }),
    );
    const b = boxOf(kitchen);
    expect(b.max.y).toBeCloseTo(2.15, 2);
    expect(meshCount(kitchen)).toBe(5); // plinth + carcass + cap + overhead + cutout
    disposeObject3D(kitchen);
  });

  it('builds sanitary fixtures (WC, basin, bathtub, shower) with distinct geometry', () => {
    const wc = buildCustomFurnitureGroup(
      baseRecipe({
        kind: 'sanitary',
        subtype: 'wc',
        widthM: 0.65,
        depthM: 0.38,
        heightM: 0.8,
        outlineM: rectOutline(2, 3, 0.65, 0.38),
        subParts: [
          { role: 'cistern', outlineM: rectOutline(1.78, 3, 0.18, 0.36) },
          { role: 'cutout', outlineM: rectOutline(2.08, 3, 0.38, 0.32) },
        ],
      }),
    );
    expect(boxOf(wc).max.y).toBeCloseTo(0.8, 2);
    expect(meshCount(wc)).toBe(3);
    disposeObject3D(wc);

    const shower = buildCustomFurnitureGroup(
      baseRecipe({
        kind: 'sanitary',
        subtype: 'shower',
        widthM: 1.0,
        depthM: 1.0,
        heightM: 2.0,
        facing: Math.PI / 2,
        outlineM: rectOutline(2, 3, 1.0, 1.0),
      }),
    );
    expect(boxOf(shower).max.y).toBeCloseTo(2.05, 2);
    disposeObject3D(shower);

    const basin = buildCustomFurnitureGroup(
      baseRecipe({
        kind: 'sanitary',
        subtype: 'basin',
        widthM: 0.6,
        depthM: 0.48,
        heightM: 0.85,
        facing: Math.PI / 2,
        outlineM: rectOutline(2, 3, 0.6, 0.48),
        subParts: [{ role: 'cutout', outlineM: rectOutline(2, 3, 0.44, 0.32) }],
      }),
    );
    expect(meshCount(basin)).toBe(4); // base + rim + bowl + tap
    disposeObject3D(basin);

    const tub = buildCustomFurnitureGroup(
      baseRecipe({
        kind: 'sanitary',
        subtype: 'bathtub',
        widthM: 1.7,
        depthM: 0.75,
        heightM: 0.55,
        outlineM: rectOutline(2, 3, 1.7, 0.75),
        subParts: [{ role: 'cutout', outlineM: rectOutline(2, 3, 1.45, 0.55) }],
      }),
    );
    expect(meshCount(tub)).toBe(2);
    disposeObject3D(tub);
  });

  it('produces deterministic recipe signatures across sub-parts and tints', () => {
    const r1 = baseRecipe({ kind: 'sanitary', subtype: 'wc', subParts: [{ role: 'cistern', outlineM: rectOutline(1.8, 3, 0.2, 0.35) }] });
    const r2 = baseRecipe({ kind: 'sanitary', subtype: 'wc', subParts: [{ role: 'cistern', outlineM: rectOutline(1.8, 3, 0.2, 0.35) }] });
    const r3 = baseRecipe({ kind: 'sanitary', subtype: 'basin' });
    expect(recipeSignature(r1)).toBe(recipeSignature(r2));
    expect(recipeSignature(r1)).not.toBe(recipeSignature(r3));
  });
});
