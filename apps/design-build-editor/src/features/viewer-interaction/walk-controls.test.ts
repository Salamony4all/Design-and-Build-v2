import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  DOUBLE_TAP_MS,
  EYE_HEIGHT,
  LEVEL_SNAP,
  WalkControls,
  clampToArea,
  directionFromYawPitch,
  findStandingSpot,
  quaternionFromYawPitch,
  walkTargetFor,
  yawPitchFromDirection,
  type WalkHost,
} from './walk-controls';
import type { Aabb } from './view-navigator';

const BOX: Aabb = { min: [0, -0.3, 0], max: [30, 3, 20] };

function fakeHost(over: Partial<WalkHost> = {}) {
  const camera = new THREE.PerspectiveCamera(70, 393 / 780, 0.05, 1000);
  const glides: { position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];
  let lens = 18;
  const dom = { clientHeight: 780, clientWidth: 393 } as unknown as HTMLElement;
  const host: WalkHost = {
    getCamera: () => camera,
    dom,
    invalidate: () => {},
    getLens: () => lens,
    setLens: (mm) => { lens = mm; },
    area: () => BOX,
    floorY: () => 0,
    pick: () => null,
    glide: (to) => {
      glides.push(to);
      camera.position.copy(to.position);
      camera.quaternion.copy(to.quaternion);
      camera.updateMatrixWorld();
      return Promise.resolve();
    },
    ...over,
  };
  return { host, camera, glides, lens: () => lens };
}

describe('walk mode maths', () => {
  it('turns view directions into yaw and pitch and back', () => {
    for (const [yaw, pitch] of [[0, 0], [1.2, 0.3], [-2.5, -0.6], [Math.PI / 2, 0]]) {
      const d = directionFromYawPitch(yaw, pitch);
      const yp = yawPitchFromDirection(d);
      expect(yp.pitch).toBeCloseTo(pitch, 9);
      expect(Math.cos(yp.yaw - yaw)).toBeCloseTo(1, 9);
      // And a camera with that orientation looks that way.
      const cam = new THREE.PerspectiveCamera();
      cam.quaternion.copy(quaternionFromYawPitch(yaw, pitch));
      const look = new THREE.Vector3();
      cam.getWorldDirection(look);
      expect(look.distanceTo(d)).toBeLessThan(1e-9);
    }
  });

  it('keeps you over the model, at eye height', () => {
    const p = clampToArea(new THREE.Vector3(-10, 9, 50), BOX, 0);
    expect(p.x).toBeCloseTo(-1.5, 9);
    expect(p.z).toBeCloseTo(21.5, 9);
    expect(p.y).toBeCloseTo(EYE_HEIGHT, 9);
  });

  it('walks onto a floor, or up to a wall and stops in front of it', () => {
    const from = new THREE.Vector3(5, EYE_HEIGHT, 5);
    const onFloor = walkTargetFor({ point: new THREE.Vector3(10, 0, 8), normal: new THREE.Vector3(0, 1, 0) }, from, 0);
    expect(onFloor.face).toBe(false);
    expect(onFloor.position.toArray()).toEqual([10, EYE_HEIGHT, 8]);
    const toWall = walkTargetFor({ point: new THREE.Vector3(15, 1.2, 5), normal: new THREE.Vector3(-1, 0, 0) }, from, 0);
    expect(toWall.face).toBe(true);
    expect(toWall.position.x).toBeCloseTo(14.1, 9);
    expect(toWall.position.z).toBeCloseTo(5, 9);
  });
});

describe('WalkControls', () => {
  it('looks around with the scene following the finger, and never flips over', () => {
    const { host, camera } = fakeHost();
    const w = new WalkControls(host);
    w.position.set(5, EYE_HEIGHT, 5);
    w.look(100, 0);
    // Dragging right turns the view left (yaw grows) by about the angle the finger covered.
    expect(w.yaw).toBeCloseTo(THREE.MathUtils.degToRad(70) * (100 / 780), 9);
    w.look(0, 100000);
    expect(w.pitch).toBeLessThanOrEqual(THREE.MathUtils.degToRad(80) + 1e-9);
    expect(camera.position.toArray()).toEqual([5, EYE_HEIGHT, 5]);
  });

  it('walks relative to where it faces and stays inside the model', () => {
    const { host } = fakeHost();
    const w = new WalkControls(host);
    w.position.set(5, EYE_HEIGHT, 5);
    w.yaw = 0; // facing -Z
    w.moveBy(2, 0);
    expect(w.position.z).toBeCloseTo(3, 9);
    w.moveBy(0, 1); // right = +X
    expect(w.position.x).toBeCloseTo(6, 9);
    w.moveBy(1000, 0);
    expect(w.position.z).toBeCloseTo(-1.5, 9);
  });

  it('double-tap target glides there, facing the wall', async () => {
    const pick = () => ({ point: new THREE.Vector3(5, 1.4, -0.1), normal: new THREE.Vector3(0, 0, 1) });
    const { host, glides, camera } = fakeHost({ pick });
    camera.position.set(5, EYE_HEIGHT, 8);
    camera.quaternion.copy(quaternionFromYawPitch(Math.PI / 2, 0.2));
    camera.updateMatrixWorld();
    const w = new WalkControls(host);
    await w.goTo(100, 100);
    expect(glides).toHaveLength(1);
    expect(glides[0].position.z).toBeCloseTo(0.8, 9);
    expect(w.pitch).toBe(0);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(glides[0].quaternion);
    expect(look.z).toBeLessThan(-0.99);
  });

  it('walks on one tap on a touch screen, and ignores taps while it walks there', async () => {
    const pick = vi.fn(() => ({ point: new THREE.Vector3(10, 0, 8), normal: new THREE.Vector3(0, 1, 0) }));
    let finish: () => void = () => {};
    const glides: unknown[] = [];
    const { host } = fakeHost({
      pick,
      glide: (to) => {
        glides.push(to);
        return new Promise<void>((r) => { finish = r; });
      },
    });
    const w = new WalkControls(host) as unknown as { active: boolean; onDown: (e: unknown) => void; onUp: (e: unknown) => void };
    w.active = true;
    const ev = (id: number, timeStamp: number) => ({ pointerId: id, clientX: 200, clientY: 440, pointerType: 'touch', buttons: 0, timeStamp });
    w.onDown(ev(1, 1000));
    w.onUp(ev(1, 1150));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(glides).toHaveLength(1);
    // A second tap while gliding there is not a second walk.
    w.onDown(ev(2, 1300));
    w.onUp(ev(2, 1400));
    expect(pick).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    // A long press is not a tap.
    w.onDown(ev(3, 3000));
    w.onUp(ev(3, 3600));
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('walks on a quick double click with a mouse, by input time, and not on two slow clicks', async () => {
    const pick = vi.fn(() => ({ point: new THREE.Vector3(10, 0, 8), normal: new THREE.Vector3(0, 1, 0) }));
    const { host, glides } = fakeHost({ pick });
    const w = new WalkControls(host) as unknown as { active: boolean; onDown: (e: unknown) => void; onUp: (e: unknown) => void };
    w.active = true;
    const ev = (id: number, timeStamp: number) => ({ pointerId: id, clientX: 200, clientY: 440, pointerType: 'mouse', buttons: 0, timeStamp });
    // Second press 200 ms after the first release (presses of 150 ms, as a busy computer reports them).
    w.onDown(ev(1, 1000));
    w.onUp(ev(1, 1150));
    expect(pick).toHaveBeenCalledTimes(0);
    w.onDown(ev(2, 1350));
    w.onUp(ev(2, 1500));
    await Promise.resolve();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(glides).toHaveLength(1);
    // A longer pause than DOUBLE_TAP_MS: two single clicks.
    w.onDown(ev(3, 3000));
    w.onUp(ev(3, 3100));
    w.onDown(ev(4, 3100 + DOUBLE_TAP_MS + 50));
    w.onUp(ev(4, 3100 + DOUBLE_TAP_MS + 120));
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('walks with the on-screen stick, faster the further it is tilted, and stops when let go', () => {
    const { host, camera } = fakeHost();
    camera.position.set(5, EYE_HEIGHT, 10);
    camera.quaternion.copy(quaternionFromYawPitch(0, 0));
    camera.updateMatrixWorld();
    const frames: FrameRequestCallback[] = [];
    const g = globalThis as unknown as { requestAnimationFrame?: (cb: FrameRequestCallback) => number };
    const prevRaf = g.requestAnimationFrame;
    g.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    try {
      const w = new WalkControls(host);
      (w as unknown as { active: boolean }).active = true;
      w.setStick(1, 0);
      frames.shift()?.(100); // 0.1 s at full tilt, facing −Z
      const full = 10 - w.position.z;
      expect(full).toBeGreaterThan(0.15);
      w.setStick(0.5, 0);
      frames.shift()?.(200);
      expect(10 - full - w.position.z).toBeCloseTo(full / 2, 6);
      w.setStick(0, 0);
      const z = w.position.z;
      frames.shift()?.(300);
      expect(w.position.z).toBe(z);
      expect(frames).toHaveLength(0);
    } finally {
      g.requestAnimationFrame = prevRaf;
      now.mockRestore();
    }
  });

  it('snaps a nearly level view to level', () => {
    expect(LEVEL_SNAP).toBeLessThan(0.1);
  });
});

describe('findStandingSpot', () => {
  // A 10 m x 6 m room (x 0..10, z 0..6) with 0.2 m walls, 3 m high.
  const walls: Aabb[] = [
    { min: [-0.2, 0, -0.2], max: [10.2, 3, 0] },
    { min: [-0.2, 0, 6], max: [10.2, 3, 6.2] },
    { min: [-0.2, 0, 0], max: [0, 3, 6] },
    { min: [10, 0, 0], max: [10.2, 3, 6] },
  ];
  const probe = {
    cast(o: THREE.Vector3, d: THREE.Vector3, far: number): number | null {
      const ray = new THREE.Ray(o, d.clone().normalize());
      let best: number | null = null;
      for (const w of walls) {
        const hit = ray.intersectBox(new THREE.Box3(new THREE.Vector3(...w.min), new THREE.Vector3(...w.max)), new THREE.Vector3());
        if (!hit) continue;
        const dist = hit.distanceTo(o);
        if (dist > 1e-6 && dist <= far && (best === null || dist < best)) best = dist;
      }
      return best;
    },
    topAt(x: number, z: number): number | null {
      for (const w of walls) if (x >= w.min[0] && x <= w.max[0] && z >= w.min[2] && z <= w.max[2]) return 3;
      return 0;
    },
  };
  const room: Aabb = { min: [-0.2, 0, -0.2], max: [10.2, 3, 6.2] };

  it('moves off a wall to the middle of the room, then stands back to take it in', () => {
    // Facing -Z: centred across the room (x 5), backed up to 0.6 m from the wall behind (z 6).
    const r = findStandingSpot(probe, new THREE.Vector3(-0.1, 0, 3), 0, room, 0);
    expect(r.position.x).toBeCloseTo(5, 1);
    expect(r.position.z).toBeCloseTo(5.4, 1);
    expect(r.position.y).toBeCloseTo(EYE_HEIGHT, 9);
  });

  it('does not back up onto low furniture', () => {
    // A sofa (0.8 m high) fills z 4.5..6 behind: the full and 3/4 steps land on it, half a step does not.
    const sofa = { ...probe, topAt: (x: number, z: number) => (z > 4.5 ? 0.8 : probe.topAt(x, z)) };
    const r = findStandingSpot(sofa, new THREE.Vector3(5, 0, 3), 0, room, 0);
    expect(r.position.z).toBeCloseTo(4.2, 1);
  });

  it('faces down the room when a wall is right ahead', () => {
    // Heading towards -Z (a wall 3 m away is fine, so keep it)…
    expect(findStandingSpot(probe, new THREE.Vector3(5, 0, 3), 0, room, 0).yaw).toBe(0);
    // …but in a corridor-like spot facing a wall, turn along the long side (±X).
    const narrow = findStandingSpot(
      { ...probe, cast: (o, d, far) => { const v = probe.cast(o, d, far); return Math.abs(d.z) > 0.9 ? Math.min(v ?? far, 1) : v; } },
      new THREE.Vector3(5, 0, 3), 0, room, 0,
    );
    expect(Math.abs(Math.sin(narrow.yaw))).toBeCloseTo(1, 6);
  });
});
