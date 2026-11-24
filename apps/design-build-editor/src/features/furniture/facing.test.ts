import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cardNormal, wrapAngle } from './card-orientation';
import { BACK, SIDE, depthAlong, edgeBands } from './stand-in-bands';

const deg = (d: number) => (d * Math.PI) / 180;
const close = (a: number, b: number) => Math.abs(wrapAngle(a - b)) < 1e-9;

describe('product photo cards', () => {
  it('face the camera when the piece has no known front', () => {
    expect(close(cardNormal(null, deg(120)), deg(120))).toBe(true);
  });

  it('stay turned with their product, swinging towards the camera by at most 45°', () => {
    // a piece facing +x, seen from in front, from its side and from behind
    expect(close(cardNormal(0, deg(20)), deg(20))).toBe(true);
    expect(close(cardNormal(0, deg(90)), deg(45))).toBe(true);
    expect(close(cardNormal(0, deg(-80)), deg(-45))).toBe(true);
    // from behind the card keeps facing its way: its back (the silhouette) is towards the camera
    expect(close(cardNormal(0, deg(180)), 0)).toBe(true);
    expect(close(cardNormal(0, deg(135)), deg(-45))).toBe(true);
    expect(close(cardNormal(deg(90), deg(-100)), deg(80))).toBe(true);
  });
});

describe('stand-in bands', () => {
  const material = new THREE.MeshBasicMaterial();
  // a 0.6 m chair at (2, 3) in plan metres, outline drawn either way round
  const square = [
    { x: 1.7, y: 2.7 },
    { x: 2.3, y: 2.7 },
    { x: 2.3, y: 3.3 },
    { x: 1.7, y: 3.3 },
  ];
  const chair = { outlineM: square, centerM: { x: 2, y: 3 }, widthM: 0.6, depthM: 0.6 };

  it('put the back of a seat behind it, whichever way its outline runs', () => {
    for (const outlineM of [square, [...square].reverse()]) {
      // facing +y (down the drawing): the back is the edge at y = 2.7, plan z −0.3 from the centre
      const bands = edgeBands({ ...chair, outlineM }, deg(90), BACK, 0.15, 0.42, 0.8, material);
      expect(bands).toHaveLength(1);
      expect(bands[0].position.z).toBeCloseTo(-0.3 + 0.075, 6);
      expect(bands[0].position.x).toBeCloseTo(0, 6);
      expect(bands[0].position.y).toBeCloseTo(0.61, 6);
    }
  });

  it('put end panels on the sides of a desk', () => {
    const desk = { outlineM: [{ x: 0, y: 0 }, { x: 1.6, y: 0 }, { x: 1.6, y: 0.8 }, { x: 0, y: 0.8 }], centerM: { x: 0.8, y: 0.4 }, widthM: 1.6, depthM: 0.8 };
    const ends = edgeBands(desk, deg(-90), SIDE, 0.03, 0, 0.71, material);
    expect(ends.map((m) => Math.round(m.position.x * 1000) / 1000).sort((a, b) => a - b)).toEqual([-0.785, 0.785]);
    expect(depthAlong(desk, deg(-90))).toBeCloseTo(0.8, 6);
  });
});
