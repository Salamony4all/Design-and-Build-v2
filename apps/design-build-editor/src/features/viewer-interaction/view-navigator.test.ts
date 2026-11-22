import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  ISO_PHI,
  ISO_THETA,
  TOP_PHI,
  animateTo,
  boxRadius,
  combine,
  currentPose,
  fitPose,
  navLimits,
  setLensShift,
  turnPose,
  zoomPose,
  type Aabb,
  type ViewArea,
} from './view-navigator';
import { computeFraming } from './camera-framing-service';

// CODE-06-like footprint: 40 m x 20 m, 3 m high walls.
const BOX: Aabb = { min: [0, 0, 0], max: [40, 3, 20] };
const PHONE: ViewArea = { width: 393, height: 780, insets: { top: 68, bottom: 150, left: 16, right: 16 } };
const DESKTOP: ViewArea = { width: 1440, height: 900, insets: { top: 128, bottom: 100, left: 24, right: 24 } };

function ndcBounds(fov: number, area: ViewArea, pose: ReturnType<typeof fitPose>) {
  const cam = new THREE.PerspectiveCamera(fov, area.width / area.height, 0.01, 1e6);
  cam.position.copy(pose.target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(pose.radius, pose.phi, pose.theta)));
  cam.lookAt(pose.target);
  cam.updateMatrixWorld(true);
  if (pose.shift) setLensShift(cam, pose.shift);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const x of [BOX.min[0], BOX.max[0]]) for (const y of [BOX.min[1], BOX.max[1]]) for (const z of [BOX.min[2], BOX.max[2]]) {
    const v = new THREE.Vector3(x, y, z).project(cam);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  return { minX, maxX, minY, maxY };
}

/** The free part of the screen in normalised device coordinates. */
function freeNdc(area: ViewArea) {
  return {
    x0: -1 + (2 * area.insets.left) / area.width,
    x1: 1 - (2 * area.insets.right) / area.width,
    y0: -1 + (2 * area.insets.bottom) / area.height,
    y1: 1 - (2 * area.insets.top) / area.height,
  };
}

describe('fitPose', () => {
  for (const [name, area] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
    it(`fills the free part of the ${name} screen without spilling over`, () => {
      const cam = new THREE.PerspectiveCamera(50, area.width / area.height, 0.1, 1000);
      const pose = fitPose(cam, BOX, { phi: ISO_PHI, theta: ISO_THETA }, area);
      const b = ndcBounds(50, area, pose);
      const f = freeNdc(area);
      const eps = 0.01;
      expect(b.minX).toBeGreaterThanOrEqual(f.x0 - eps);
      expect(b.maxX).toBeLessThanOrEqual(f.x1 + eps);
      expect(b.minY).toBeGreaterThanOrEqual(f.y0 - eps);
      expect(b.maxY).toBeLessThanOrEqual(f.y1 + eps);
      // Tight: the model fills the free area on at least one axis.
      const fillX = (b.maxX - b.minX) / (f.x1 - f.x0);
      const fillY = (b.maxY - b.minY) / (f.y1 - f.y0);
      expect(Math.max(fillX, fillY)).toBeGreaterThan(0.97);
    });

    it(`orbits around the middle of the model on a ${name}, never a point beside or under it`, () => {
      const cam = new THREE.PerspectiveCamera(50, area.width / area.height, 0.1, 1000);
      for (const dir of [{ phi: ISO_PHI, theta: ISO_THETA }, { phi: TOP_PHI, theta: 0 }]) {
        const pose = fitPose(cam, BOX, dir, area);
        expect(pose.target.y).toBeCloseTo(1.5, 6);
        expect(pose.target.x).toBeGreaterThanOrEqual(0);
        expect(pose.target.x).toBeLessThanOrEqual(40);
        expect(pose.target.z).toBeGreaterThanOrEqual(0);
        expect(pose.target.z).toBeLessThanOrEqual(20);
      }
    });
  }

  it('shifts the lens onto the middle of the free area', () => {
    const cam = new THREE.PerspectiveCamera(50, PHONE.width / PHONE.height, 0.1, 1000);
    const pose = fitPose(cam, BOX, { phi: ISO_PHI, theta: ISO_THETA }, PHONE);
    // Free area 68..630 px of 780: its middle is 41 px above the screen centre.
    expect(pose.shift!.y).toBeCloseTo((68 + 630) / 2 / 780 - 0.5, 6);
    expect(pose.shift!.x).toBeCloseTo(0, 6);
    // The orbit centre then shows in the middle of the free area.
    setLensShift(cam, pose.shift!);
    cam.position.copy(pose.target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(pose.radius, pose.phi, pose.theta)));
    cam.lookAt(pose.target);
    cam.updateMatrixWorld(true);
    const c = pose.target.clone().project(cam);
    expect((1 - c.y) / 2 * 780).toBeCloseTo((68 + 630) / 2, 3);
  });

  it('comes closer than a bounding-sphere fit on a phone', () => {
    const cam = new THREE.PerspectiveCamera(50, PHONE.width / PHONE.height, 0.1, 1000);
    const pose = fitPose(cam, BOX, { phi: ISO_PHI, theta: ISO_THETA }, { ...PHONE, insets: { top: 0, bottom: 0, left: 0, right: 0 } });
    const sphere = computeFraming([BOX], { mode: 'perspective', fovDeg: 50, aspect: PHONE.width / PHONE.height, near: 0.1, far: 1000 }, null, 0);
    const sphereDist = new THREE.Vector3(...sphere.cameraPositionAfter).distanceTo(new THREE.Vector3(...sphere.controlsTarget));
    expect(pose.radius).toBeLessThan(sphereDist);
  });

  it('frames the plan from above for the top view', () => {
    const cam = new THREE.PerspectiveCamera(50, DESKTOP.width / DESKTOP.height, 0.1, 1000);
    const pose = fitPose(cam, BOX, { phi: TOP_PHI, theta: 0 }, DESKTOP);
    expect(pose.phi).toBeLessThan(0.001);
    expect(pose.radius).toBeGreaterThan(10);
  });
});

describe('navLimits', () => {
  it('keeps the near plane close so zooming in never slices the model', () => {
    const lim = navLimits(BOX, 80);
    expect(lim.near).toBeLessThanOrEqual(0.1);
    expect(lim.far).toBeGreaterThan(lim.maxDistance);
    expect(lim.minDistance).toBeLessThanOrEqual(2);
    expect(lim.maxDistance).toBeGreaterThanOrEqual(80 * 3);
    expect(lim.maxPolarAngle).toBeLessThan(Math.PI / 2);
  });

  it('the old sphere framing no longer puts the near plane inside the model', () => {
    const sol = computeFraming([BOX], { mode: 'perspective', fovDeg: 50, aspect: 393 / 780, near: 0.1, far: 1000 }, null, 0.15);
    expect(sol.near).toBeLessThanOrEqual(0.1);
    expect(sol.far).toBeGreaterThan(boxRadius(BOX) * 4);
  });
});

describe('turn and zoom', () => {
  const base = { target: new THREE.Vector3(), radius: 50, phi: ISO_PHI, theta: THREE.MathUtils.degToRad(44) };

  it('turns in 45° steps that line up with the building', () => {
    expect(THREE.MathUtils.radToDeg(turnPose(base, 1).theta)).toBeCloseTo(90, 5);
    expect(THREE.MathUtils.radToDeg(turnPose(base, -1).theta)).toBeCloseTo(0, 5);
    expect(THREE.MathUtils.radToDeg(turnPose({ ...base, theta: ISO_THETA }, 1).theta)).toBeCloseTo(90, 5);
  });

  it('turns the plan in 90° steps in top view', () => {
    expect(THREE.MathUtils.radToDeg(turnPose({ ...base, phi: TOP_PHI, theta: 0 }, 1).theta)).toBeCloseTo(90, 5);
  });

  it('zooms within the limits', () => {
    expect(zoomPose(base, 0.5, { minDistance: 1, maxDistance: 100 }).radius).toBe(25);
    expect(zoomPose(base, 0.001, { minDistance: 1, maxDistance: 100 }).radius).toBe(1);
    expect(zoomPose(base, 10, { minDistance: 1, maxDistance: 100 }).radius).toBe(100);
  });
});

describe('animateTo', () => {
  it('lands exactly on the pose and moves the orbit target with it', async () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(10, 10, 10);
    const controls = { target: new THREE.Vector3(), update: () => camera.lookAt(controls.target) };
    let frames = 0;
    const h = { camera, controls, invalidate: () => { frames++; } };
    const to = { target: new THREE.Vector3(20, 1.5, 10), radius: 60, phi: ISO_PHI, theta: ISO_THETA };
    await animateTo(h, to, 0);
    const p = currentPose(h);
    expect(p.target.distanceTo(to.target)).toBeLessThan(1e-6);
    expect(p.radius).toBeCloseTo(60, 5);
    expect(p.phi).toBeCloseTo(ISO_PHI, 5);
    expect(p.theta).toBeCloseTo(ISO_THETA, 5);
    expect(frames).toBeGreaterThan(0);
  });
});

describe('combine', () => {
  it('ignores boxes with non-finite numbers', () => {
    expect(combine([{ min: [0, 0, 0], max: [1, 1, 1] }, { min: [NaN, 0, 0], max: [5, 5, 5] }])).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
    expect(combine([])).toBeNull();
  });
});
