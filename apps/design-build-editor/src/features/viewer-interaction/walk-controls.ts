// features/viewer-interaction/walk-controls.ts
// Walk mode for the 3D viewer: stand inside the model at eye height and look
// around like a photographer. One finger (or the mouse) turns the view, two
// fingers drag the floor to move and pinch to change the lens, right-drag or
// the wheel moves on a computer, W A S D walk, and a double tap walks to that
// spot (a floor) or up to it (a wall). The orbit controls are switched off
// meanwhile. Pure Three.js + DOM.

import * as THREE from 'three';
import { MAX_LENS_MM, MIN_LENS_MM, type Aabb } from './view-navigator';

/** Camera height above the floor, like a person holding a camera. */
export const EYE_HEIGHT = 1.6;
export const MAX_PITCH = THREE.MathUtils.degToRad(80);
/** A tilt this close to level snaps to level when you let go: verticals stay vertical, as in architectural photographs. */
export const LEVEL_SNAP = THREE.MathUtils.degToRad(3);
const WALK_SPEED = 1.4;
const RUN_SPEED = 3.5;
/** Distance kept from a wall when a double tap walks up to it. */
const WALL_STANDOFF = 0.9;

/** Yaw (0 looks along −Z, positive turns left) and pitch (positive looks up) of a view direction. */
export function yawPitchFromDirection(dir: THREE.Vector3): { yaw: number; pitch: number } {
  const d = dir.clone().normalize();
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) };
}

export function directionFromYawPitch(yaw: number, pitch: number): THREE.Vector3 {
  const c = Math.cos(pitch);
  return new THREE.Vector3(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}

/** Camera orientation for a yaw and pitch (no roll). */
export function quaternionFromYawPitch(yaw: number, pitch: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
}

/** Keeps a walking position over the model's footprint (grown by `margin`) and at eye height above the floor. */
export function clampToArea(p: THREE.Vector3, box: Aabb | null, floorY: number, margin = 1.5): THREE.Vector3 {
  const out = p.clone();
  if (box) {
    out.x = THREE.MathUtils.clamp(out.x, box.min[0] - margin, box.max[0] + margin);
    out.z = THREE.MathUtils.clamp(out.z, box.min[2] - margin, box.max[2] + margin);
  }
  out.y = floorY + EYE_HEIGHT;
  return out;
}

/**
 * Where a double tap takes you: onto that spot of a floor, or up to a wall (or
 * anything upright), stopping just in front of it and facing it.
 */
export function walkTargetFor(
  hit: { point: THREE.Vector3; normal: THREE.Vector3 | null },
  from: THREE.Vector3,
  floorY: number,
): { position: THREE.Vector3; face: boolean } {
  if (hit.normal && hit.normal.y > 0.7) {
    return { position: new THREE.Vector3(hit.point.x, floorY + EYE_HEIGHT, hit.point.z), face: false };
  }
  const back = new THREE.Vector3(from.x - hit.point.x, 0, from.z - hit.point.z);
  const len = back.length();
  if (len < 1e-3) return { position: new THREE.Vector3(from.x, floorY + EYE_HEIGHT, from.z), face: true };
  back.multiplyScalar(Math.min(WALL_STANDOFF, len) / len);
  return { position: new THREE.Vector3(hit.point.x + back.x, floorY + EYE_HEIGHT, hit.point.z + back.z), face: true };
}

/** Scene probes used to choose where to stand. */
export interface SpaceProbe {
  /** Distance to the first obstacle along a ray, or null when nothing is hit within `far`. */
  cast(origin: THREE.Vector3, dir: THREE.Vector3, far: number): number | null;
  /** Height of the first surface met going straight down at (x, z), or null. */
  topAt(x: number, z: number): number | null;
}

const RING = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);

/** Open distance around a point at eye height, in eight directions (yaw 0, 45°, …). */
export function openDistances(probe: SpaceProbe, p: THREE.Vector3, far = 25): number[] {
  return RING.map((yaw) => probe.cast(p, directionFromYawPitch(yaw, 0), far) ?? far);
}

/** Gap kept to the wall behind you when standing back, and the longest step back. */
const STAND_BACK_GAP = 0.6;
const MAX_STAND_BACK = 4;

/**
 * Where to stand when walk mode starts: near `start`, not inside a wall, across
 * the middle of the room or corridor found there, facing the original way when
 * there is room ahead (otherwise down the longest open direction), and backed
 * up towards the wall behind, as an interior photographer stands, so a wide
 * lens takes in the room instead of a close-up of the far wall.
 */
export function findStandingSpot(
  probe: SpaceProbe,
  start: THREE.Vector3,
  yaw: number,
  box: Aabb | null,
  floorY: number,
): { position: THREE.Vector3; yaw: number } {
  const far = 25;
  const eye = floorY + EYE_HEIGHT;
  const candidates: THREE.Vector3[] = [clampToArea(start, box, floorY, 0)];
  for (const r of [0.75, 1.5, 2.5]) {
    for (const a of RING) candidates.push(clampToArea(new THREE.Vector3(start.x - Math.sin(a) * r, eye, start.z - Math.cos(a) * r), box, floorY, 0));
  }
  let best: { p: THREE.Vector3; score: number } | null = null;
  for (const c of candidates) {
    const top = probe.topAt(c.x, c.z);
    if (top !== null && top > floorY + 0.3) continue; // inside a wall, column or piece of furniture
    const clearance = Math.min(3, ...openDistances(probe, c, far));
    const score = clearance - 0.25 * c.distanceTo(candidates[0]);
    if (!best || score > best.score) best = { p: c, score };
  }
  const p = (best?.p ?? candidates[0]).clone();
  // Centre across the room or corridor (only between walls on both sides).
  const centre = (dirA: THREE.Vector3) => {
    const a = probe.cast(p, dirA, far);
    const b = probe.cast(p, dirA.clone().negate(), far);
    if (a === null || b === null) return;
    p.addScaledVector(dirA, THREE.MathUtils.clamp((a - b) / 2, -3, 3));
  };
  centre(new THREE.Vector3(1, 0, 0));
  centre(new THREE.Vector3(0, 0, 1));
  const top = probe.topAt(p.x, p.z);
  const position = top !== null && top > floorY + 0.3 ? (best?.p ?? candidates[0]).clone() : p;
  // Facing: keep the user's heading when there is room ahead.
  let face = yaw;
  const ahead = probe.cast(position, directionFromYawPitch(yaw, 0), far) ?? far;
  if (ahead < 2.5) {
    const d = openDistances(probe, position, far);
    const max = Math.max(...d);
    let bestTurn = Infinity;
    d.forEach((dist, i) => {
      if (dist < max * 0.85) return;
      const turn = Math.abs(Math.atan2(Math.sin(RING[i] - yaw), Math.cos(RING[i] - yaw)));
      if (turn < bestTurn) {
        bestTurn = turn;
        face = RING[i];
      }
    });
  }
  // Back up towards the wall behind (not onto low furniture in between).
  const backDir = directionFromYawPitch(face + Math.PI, 0);
  const back = probe.cast(position, backDir, far);
  if (back !== null && back > STAND_BACK_GAP + 0.2) {
    const step = Math.min(back - STAND_BACK_GAP, MAX_STAND_BACK);
    for (const f of [1, 0.75, 0.5, 0.25]) {
      const q = clampToArea(position.clone().addScaledVector(backDir, step * f), box, floorY, 0);
      const t = probe.topAt(q.x, q.z);
      if (t === null || t <= floorY + 0.3) {
        position.copy(q);
        break;
      }
    }
  }
  return { position, yaw: face };
}

/** Probes the live 3D scene (visible meshes only). */
export function sceneProbe(root: THREE.Object3D): SpaceProbe {
  const ray = new THREE.Raycaster();
  const visible = (o: THREE.Object3D | null): boolean => {
    for (let n = o; n; n = n.parent) if (!n.visible) return false;
    return true;
  };
  const first = (): THREE.Intersection | null => {
    try {
      for (const hit of ray.intersectObjects(root.children, true)) {
        if ((hit.object as THREE.Mesh).isMesh && visible(hit.object)) return hit;
      }
    } catch {
      /* unreadable geometry: treat as open */
    }
    return null;
  };
  return {
    cast(origin, dir, far) {
      ray.set(origin, dir.clone().normalize());
      ray.near = 0.05;
      ray.far = far;
      return first()?.distance ?? null;
    },
    topAt(x, z) {
      ray.set(new THREE.Vector3(x, 80, z), new THREE.Vector3(0, -1, 0));
      ray.near = 0;
      ray.far = 160;
      return first()?.point.y ?? null;
    },
  };
}

export interface WalkHost {
  getCamera(): THREE.PerspectiveCamera | null;
  dom: HTMLElement;
  invalidate(): void;
  getLens(): number;
  setLens(mm: number): void;
  /** Walking area: the model's box. */
  area(): Aabb | null;
  floorY(): number;
  /** First surface under a screen point, with its world-space normal. */
  pick(clientX: number, clientY: number): { point: THREE.Vector3; normal: THREE.Vector3 | null } | null;
  /** Every user move: stop any glide in progress. */
  onUserMove?(): void;
  /** Animated move (shared with the navigator so moves cancel each other). */
  glide(to: { position: THREE.Vector3; quaternion: THREE.Quaternion }, ms: number): Promise<void>;
}

interface PointerInfo { x: number; y: number; type: string; buttons: number }

/** Longest gap between the first release and the second press of a double tap. */
export const DOUBLE_TAP_MS = 300;

/** When the input happened (falls back to now for synthetic events). */
function eventTime(e: Event): number {
  return e.timeStamp > 0 ? e.timeStamp : performance.now();
}

export class WalkControls {
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  private active = false;
  private pointers = new Map<number, PointerInfo>();
  private pinch: { d0: number; lens0: number; cx: number; cy: number } | null = null;
  private down: { x: number; y: number; t: number; moved: boolean; multi: boolean } | null = null;
  private lastTap: { x: number; y: number; t: number } | null = null;
  private keys = new Set<string>();
  private raf = 0;
  private lastFrame = 0;

  constructor(private host: WalkHost) {}

  get enabled(): boolean {
    return this.active;
  }

  start(pose: { position: THREE.Vector3; yaw: number; pitch: number }): void {
    this.position.copy(pose.position);
    this.yaw = pose.yaw;
    this.pitch = pose.pitch;
    if (this.active) return;
    this.active = true;
    const d = this.host.dom;
    d.addEventListener('pointerdown', this.onDown);
    d.addEventListener('pointermove', this.onMove);
    d.addEventListener('pointerup', this.onUp);
    d.addEventListener('pointercancel', this.onUp);
    d.addEventListener('wheel', this.onWheel, { passive: false });
    d.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    const d = this.host.dom;
    d.removeEventListener('pointerdown', this.onDown);
    d.removeEventListener('pointermove', this.onMove);
    d.removeEventListener('pointerup', this.onUp);
    d.removeEventListener('pointercancel', this.onUp);
    d.removeEventListener('wheel', this.onWheel);
    d.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.pointers.clear();
    this.pinch = null;
    this.keys.clear();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Picks up where the camera is now (after a glide, or one cut short). */
  syncFromCamera(): void {
    const cam = this.host.getCamera();
    if (!cam) return;
    this.position.copy(cam.position);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const yp = yawPitchFromDirection(dir);
    this.yaw = yp.yaw;
    this.pitch = yp.pitch;
  }

  apply(): void {
    const cam = this.host.getCamera();
    if (!cam) return;
    cam.position.copy(this.position);
    cam.quaternion.copy(quaternionFromYawPitch(this.yaw, this.pitch));
    cam.updateMatrixWorld();
    this.host.invalidate();
  }

  /** Turns the view by screen-pixel drags: the scene follows the finger. */
  look(dx: number, dy: number): void {
    const cam = this.host.getCamera();
    const h = Math.max(1, this.host.dom.clientHeight);
    const k = THREE.MathUtils.degToRad(cam?.fov ?? 60) / h;
    this.yaw += dx * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * k, -MAX_PITCH, MAX_PITCH);
    this.apply();
  }

  /** Moves over the floor, relative to where the camera faces (metres). */
  moveBy(forward: number, right: number): void {
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const next = this.position.clone().addScaledVector(f, forward).addScaledVector(r, right);
    this.position.copy(clampToArea(next, this.host.area(), this.host.floorY()));
    this.apply();
  }

  /** Animated turn (toolbar / Q E keys). */
  turn(delta: number): Promise<void> {
    this.syncFromCamera();
    this.yaw += delta;
    return this.host.glide({ position: this.position.clone(), quaternion: quaternionFromYawPitch(this.yaw, this.pitch) }, 420);
  }

  /** Double tap: walk to a floor spot, or up to a wall and face it. */
  async goTo(clientX: number, clientY: number): Promise<void> {
    const hit = this.host.pick(clientX, clientY);
    if (!hit) return;
    this.syncFromCamera();
    const floorY = this.host.floorY();
    const t = walkTargetFor(hit, this.position, floorY);
    const position = clampToArea(t.position, this.host.area(), floorY);
    if (t.face) {
      const yp = yawPitchFromDirection(new THREE.Vector3(hit.point.x - position.x, 0, hit.point.z - position.z));
      this.yaw = yp.yaw;
      this.pitch = 0;
    }
    const ms = THREE.MathUtils.clamp(position.distanceTo(this.position) * 140, 380, 1100);
    this.position.copy(position);
    await this.host.glide({ position, quaternion: quaternionFromYawPitch(this.yaw, this.pitch) }, ms);
  }

  private metresPerPixel(): number {
    const cam = this.host.getCamera();
    const h = Math.max(1, this.host.dom.clientHeight);
    // Drag speed of a floor ~3 m away.
    return (2 * 3 * Math.tan(THREE.MathUtils.degToRad(cam?.fov ?? 60) / 2)) / h;
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.active) return;
    if (this.pointers.size === 0) {
      this.host.onUserMove?.();
      this.syncFromCamera();
    }
    try {
      this.host.dom.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType, buttons: e.buttons });
    if (this.pointers.size === 1) {
      this.down = { x: e.clientX, y: e.clientY, t: eventTime(e), moved: false, multi: false };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), lens0: this.host.getLens(), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      if (this.down) this.down.multi = true;
    }
  };

  private onMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!this.active || !prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) this.down.moved = true;
    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      // Pinch out zooms in (longer lens), pinch in widens the view.
      this.host.setLens(THREE.MathUtils.clamp((this.pinch.lens0 * d) / this.pinch.d0, MIN_LENS_MM, MAX_LENS_MM));
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const mpp = this.metresPerPixel();
      // Drag the floor: pulling it towards you walks forward.
      this.moveBy((cy - this.pinch.cy) * mpp, -(cx - this.pinch.cx) * mpp);
      this.pinch.cx = cx;
      this.pinch.cy = cy;
      return;
    }
    const moveButtons = (e.buttons & 2) !== 0 || (e.buttons & 4) !== 0;
    if (prev.type === 'mouse' && moveButtons) {
      const mpp = this.metresPerPixel();
      this.moveBy(dy * mpp, -dx * mpp);
    } else {
      this.look(dx, dy);
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    try {
      this.host.dom.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size > 0) return;
    const d = this.down;
    this.down = null;
    if (!d) return;
    if (d.moved || d.multi) {
      // Let go near level: straighten up.
      if (Math.abs(this.pitch) < LEVEL_SNAP && this.pitch !== 0) {
        this.pitch = 0;
        this.apply();
      }
      this.lastTap = null;
      return;
    }
    // Input time, not handler time: a busy frame must not split a double tap.
    const now = eventTime(e);
    if (now - d.t > 350) { this.lastTap = null; return; }
    const lt = this.lastTap;
    // Double tap: the second press starts soon after the first release, close to it.
    if (lt && d.t - lt.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 30) {
      this.lastTap = null;
      void this.goTo(e.clientX, e.clientY);
    } else {
      this.lastTap = { x: e.clientX, y: e.clientY, t: now };
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.active) return;
    e.preventDefault();
    this.host.onUserMove?.();
    if (this.pointers.size === 0) this.syncFromCamera();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const delta = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl + wheel: change the lens.
      this.host.setLens(THREE.MathUtils.clamp(this.host.getLens() * Math.exp(-delta * 0.004), MIN_LENS_MM, MAX_LENS_MM));
      return;
    }
    this.moveBy(-delta * 0.004, 0);
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k !== 'w' && k !== 'a' && k !== 's' && k !== 'd' && k !== 'shift') return;
    if (k !== 'shift') e.preventDefault();
    if (this.keys.size === 0) {
      this.host.onUserMove?.();
      this.syncFromCamera();
    }
    this.keys.add(k);
    if (!this.raf) {
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  private tick = (now: number): void => {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const fwd = (this.keys.has('w') ? 1 : 0) - (this.keys.has('s') ? 1 : 0);
    const side = (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0);
    if (!this.active || (fwd === 0 && side === 0)) {
      this.raf = 0;
      return;
    }
    const speed = (this.keys.has('shift') ? RUN_SPEED : WALK_SPEED) * dt;
    const n = Math.hypot(fwd, side);
    this.moveBy((fwd / n) * speed, (side / n) * speed);
    this.raf = requestAnimationFrame(this.tick);
  };
}
