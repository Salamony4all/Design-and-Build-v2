// features/viewer-interaction/view-navigator.ts
// Camera moves for the 3D viewer: fit the model into the free part of the
// screen (between the header, toolbar and prompt bar), 3D and top views,
// zoom, turning around the model in 45° steps and focusing on a tapped point.
// Every move is animated, and the camera's clipping planes and zoom limits are
// kept sane so zooming in never slices through the model. The camera always
// orbits around the model; to centre it in the free part of the screen the
// lens is shifted (an off-axis view, like a tilt-shift lens) rather than the
// orbit centre being moved off the model.
// Pure Three.js: works on the live R3F camera + OrbitControls bridged out by
// the viewer shell, and on plain cameras in tests.

import * as THREE from 'three';

export type Vec3 = [number, number, number];
export interface Aabb { min: Vec3; max: Vec3 }
export interface ScreenInsets { top: number; right: number; bottom: number; left: number }
export interface ViewArea { width: number; height: number; insets: ScreenInsets }

export interface NavControls {
  target: THREE.Vector3;
  update: () => void;
  minDistance?: number;
  maxDistance?: number;
  maxPolarAngle?: number;
}

export interface NavHandle {
  camera: THREE.Camera;
  controls: NavControls | null;
  invalidate: () => void;
  gl?: unknown;
  scene?: THREE.Scene;
}

/** Orbit pose: what the camera looks at, from how far, and from which direction. */
export interface ViewPose {
  target: THREE.Vector3;
  radius: number;
  /** Polar angle from straight up (0 = top view). */
  phi: number;
  /** Azimuth around the vertical axis, from +Z towards +X. */
  theta: number;
  /** Orthographic cameras only. */
  zoom?: number;
  /** Where the orbit centre shows on screen, from the screen centre, as fractions of the canvas (+x right, +y down). */
  shift?: { x: number; y: number };
  /** Vertical field of view in degrees (perspective cameras only). */
  fov?: number;
}

export interface NavLimits {
  minDistance: number;
  maxDistance: number;
  near: number;
  far: number;
  maxPolarAngle: number;
}

/** The classic corner view: 45° around, 54.7° down from vertical. */
export const ISO_THETA = Math.PI / 4;
export const ISO_PHI = Math.acos(1 / Math.sqrt(3));
/** Almost straight down; exactly 0 would make the orbit azimuth undefined. */
export const TOP_PHI = 1e-4;
/** Never orbit below the ground. */
export const MAX_POLAR = Math.PI / 2 - 0.04;

// ---- Lenses --------------------------------------------------------------
// Focal lengths are 35 mm-equivalent and measured on the frame's diagonal, so a
// lens frames a room the same way on a tall phone, a tablet or a wide monitor.
// (A fixed vertical angle gave phones a narrow 26° slit of view.)

/** Diagonal of a 35 mm film frame, in mm. */
const FULL_FRAME_DIAGONAL = 43.27;
/** Overview lens: about what a 50° vertical view gave on a laptop. */
export const ORBIT_LENS_MM = 26;
/** Walk-mode lens: wide, like interior photography. */
export const WALK_LENS_MM = 18;
export const MIN_LENS_MM = 12;
export const MAX_LENS_MM = 70;
/** Lens steps offered by the lens button. */
export const LENS_STEPS_MM = [14, 18, 24, 35] as const;

/** Vertical field of view (degrees) of a 35 mm-equivalent lens on a frame of this aspect (width / height). */
export function lensToVFov(mm: number, aspect: number): number {
  const tanHalfDiag = FULL_FRAME_DIAGONAL / (2 * THREE.MathUtils.clamp(mm, 1, 2000));
  const tanHalfV = tanHalfDiag / Math.sqrt(1 + Math.max(aspect, 1e-3) ** 2);
  return THREE.MathUtils.radToDeg(2 * Math.atan(tanHalfV));
}

/** 35 mm-equivalent focal length of a vertical field of view on a frame of this aspect. */
export function vFovToLens(vFovDeg: number, aspect: number): number {
  const tanHalfV = Math.tan(THREE.MathUtils.degToRad(vFovDeg) / 2);
  const tanHalfDiag = tanHalfV * Math.sqrt(1 + Math.max(aspect, 1e-3) ** 2);
  return FULL_FRAME_DIAGONAL / (2 * tanHalfDiag);
}

/** Horizontal field of view (degrees) for a vertical one on a frame of this aspect. */
export function hFovOf(vFovDeg: number, aspect: number): number {
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(vFovDeg) / 2) * aspect));
}

const isPerspective = (c: THREE.Camera): c is THREE.PerspectiveCamera => (c as THREE.PerspectiveCamera).isPerspectiveCamera === true;
const isOrtho = (c: THREE.Camera): c is THREE.OrthographicCamera => (c as THREE.OrthographicCamera).isOrthographicCamera === true;

export function combine(boxes: Aabb[]): Aabb | null {
  const ok = boxes.filter((b) => [...b.min, ...b.max].every((v) => Number.isFinite(v)));
  if (ok.length === 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of ok) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i]);
      max[i] = Math.max(max[i], b.max[i]);
    }
  }
  return { min, max };
}

export function boxCenter(b: Aabb): THREE.Vector3 {
  return new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
}

export function boxRadius(b: Aabb): number {
  return 0.5 * Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
}

function corners(b: Aabb): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

function placeCamera(cam: THREE.Camera, target: THREE.Vector3, radius: number, phi: number, theta: number) {
  const offset = new THREE.Vector3().setFromSpherical(new THREE.Spherical(radius, Math.max(TOP_PHI, phi), theta));
  cam.position.copy(target).add(offset);
  cam.up.set(0, 1, 0);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
}

/** Where the camera is now, as an orbit pose around the controls' target. */
export function currentPose(h: NavHandle): ViewPose {
  const cam = h.camera;
  let target: THREE.Vector3;
  if (h.controls?.target) {
    target = h.controls.target.clone();
  } else {
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    target = cam.position.clone().addScaledVector(dir, 20);
  }
  const s = new THREE.Spherical().setFromVector3(cam.position.clone().sub(target));
  return {
    target, radius: Math.max(s.radius, 1e-3), phi: s.phi, theta: s.theta,
    zoom: isOrtho(cam) ? cam.zoom : undefined, shift: lensShift(cam), fov: isPerspective(cam) ? cam.fov : undefined,
  };
}

type LensCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
const hasLens = (c: THREE.Camera): c is LensCamera => isPerspective(c) || isOrtho(c);

/** The camera's current lens shift (see ViewPose.shift). */
export function lensShift(cam: THREE.Camera): { x: number; y: number } {
  const v = hasLens(cam) ? cam.view : null;
  if (!v || !v.enabled || !v.fullWidth || !v.fullHeight) return { x: 0, y: 0 };
  return { x: -v.offsetX / v.fullWidth, y: -v.offsetY / v.fullHeight };
}

/**
 * Shift the lens so the orbit centre shows at `shift` instead of the screen
 * centre. Stored as fractions, so it stays right when the canvas resizes.
 */
export function setLensShift(cam: THREE.Camera, shift: { x: number; y: number }): void {
  if (!hasLens(cam)) return;
  if (Math.abs(shift.x) < 1e-4 && Math.abs(shift.y) < 1e-4) {
    if (cam.view?.enabled) cam.clearViewOffset();
    return;
  }
  // PerspectiveCamera.setViewOffset also sets aspect = fullWidth / fullHeight,
  // so the "full" size must keep the camera's own aspect.
  const a = isPerspective(cam) && cam.aspect > 0 ? cam.aspect : 1;
  cam.setViewOffset(a, 1, -shift.x * a, -shift.y, a, 1);
}

/**
 * The part of the screen the model may use (between the header, toolbar and
 * prompt bar): its half-size in normalised device coordinates and where its
 * centre is, as a lens shift.
 */
function freeWindow(area: ViewArea) {
  const W = Math.max(1, area.width);
  const H = Math.max(1, area.height);
  const ins = area.insets;
  let x0 = ins.left;
  let x1 = W - ins.right;
  let y0 = ins.top;
  let y1 = H - ins.bottom;
  // Keep at least 40% of the screen whatever covers it, centred on what is free.
  if (x1 - x0 < 0.4 * W) { const c = (x0 + x1) / 2; x0 = c - 0.2 * W; x1 = c + 0.2 * W; }
  if (y1 - y0 < 0.4 * H) { const c = (y0 + y1) / 2; y0 = c - 0.2 * H; y1 = c + 0.2 * H; }
  return {
    hx: (x1 - x0) / W,
    hy: (y1 - y0) / H,
    shift: { x: (x0 + x1) / 2 / W - 0.5, y: (y0 + y1) / 2 / H - 0.5 },
    W,
    H,
  };
}

/** Lens shift that centres the orbit centre in the free part of the screen. */
export function freeAreaShift(area: ViewArea): { x: number; y: number } {
  return freeWindow(area).shift;
}

/**
 * Pose that frames `box` from direction (phi, theta) as large as it fits in the
 * free part of the screen, with the lens shifted onto the middle of the free
 * part. The orbit centre stays inside the model at half its height: it only
 * slides across the footprint to balance perspective (the near side of a box
 * looks bigger than the far side). The box's eight corners are projected and
 * the distance refined until they touch the free window (a bounding sphere
 * would leave the model small, especially on tall phone screens).
 */
export function fitPose(cam: THREE.Camera, box: Aabb, dir: { phi: number; theta: number }, area: ViewArea, fovDeg?: number): ViewPose {
  const win = freeWindow(area);
  const aspect = win.W / win.H;
  const pts = corners(box);
  const target = boxCenter(box);
  const R = Math.max(boxRadius(box), 0.25);
  const phi = Math.max(TOP_PHI, dir.phi);
  // Ground directions that move the model across the screen: right, and "up the screen".
  const right = new THREE.Vector3(Math.cos(dir.theta), 0, -Math.sin(dir.theta));
  const ahead = new THREE.Vector3(-Math.sin(dir.theta), 0, -Math.cos(dir.theta));
  const tilt = Math.max(Math.cos(phi), 0.2);
  const keepInside = () => {
    target.x = THREE.MathUtils.clamp(target.x, box.min[0], box.max[0]);
    target.z = THREE.MathUtils.clamp(target.z, box.min[2], box.max[2]);
  };

  if (isOrtho(cam)) {
    // R3F's orthographic frustum spans the canvas in CSS pixels; zoom = pixels per metre.
    const probe = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e6, 1e6);
    const radius = Math.max(R * 4, 50);
    let ax = 1e-3;
    let ay = 1e-3;
    for (let i = 0; i < 3; i++) {
      placeCamera(probe, target, radius, phi, dir.theta);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        const v = p.clone().applyMatrix4(probe.matrixWorldInverse);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
      ax = Math.max(1e-3, Math.abs(minX), Math.abs(maxX));
      ay = Math.max(1e-3, Math.abs(minY), Math.abs(maxY));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      if (Math.abs(cx) < 1e-3 && Math.abs(cy) < 1e-3) break;
      target.addScaledVector(right, cx).addScaledVector(ahead, cy / tilt);
      keepInside();
    }
    const zoom = Math.min((win.hx * win.W) / 2 / ax, (win.hy * win.H) / 2 / ay);
    return { target, radius, phi: dir.phi, theta: dir.theta, zoom, shift: win.shift };
  }

  const fov = fovDeg ?? (isPerspective(cam) ? cam.fov : 50);
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const tanH = tanV * aspect;
  const probe = new THREE.PerspectiveCamera(fov, aspect, 0.01, 1e7);
  let radius = R / Math.sin(Math.min(Math.atan(tanV), Math.atan(tanH)));
  for (let i = 0; i < 32; i++) {
    placeCamera(probe, target, radius, phi, dir.theta);
    const inv = probe.matrixWorldInverse;
    let behind = false;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.clone().applyMatrix4(inv).z > -1e-3) { behind = true; break; }
      const v = p.clone().project(probe);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    if (behind) { radius *= 1.6; continue; }
    // Balance: slide the orbit centre over the footprint so the model sits
    // evenly around the lens axis.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const before = target.clone();
    target.addScaledVector(right, cx * radius * tanH).addScaledVector(ahead, (cy * radius * tanV) / tilt);
    keepInside();
    const moved = target.distanceTo(before) > 1e-4 * R;
    // Size: the corner furthest from the axis touches the free window.
    const ax = Math.max(Math.abs(minX), Math.abs(maxX));
    const ay = Math.max(Math.abs(minY), Math.abs(maxY));
    const s = THREE.MathUtils.clamp(Math.max(ax / win.hx, ay / win.hy), 0.25, 4);
    radius *= s;
    if (Math.abs(s - 1) < 0.002 && !moved) break;
  }
  return { target, radius, phi: dir.phi, theta: dir.theta, shift: win.shift, ...(fovDeg !== undefined ? { fov: fovDeg } : {}) };
}

/** Zoom range, clipping planes and tilt limit for a model of this size. */
export function navLimits(box: Aabb, fitRadius: number): NavLimits {
  const R = Math.max(boxRadius(box), 0.5);
  const maxDistance = Math.max(fitRadius * 3, R * 6, 40);
  return {
    minDistance: THREE.MathUtils.clamp(R * 0.04, 0.3, 2),
    maxDistance,
    // A near plane far in front of the camera slices the model when you zoom in.
    near: THREE.MathUtils.clamp(R / 500, 0.02, 0.1),
    far: Math.max(1000, maxDistance + R * 4 + 200),
    maxPolarAngle: MAX_POLAR,
  };
}

export function applyLimits(h: NavHandle, lim: NavLimits): void {
  const ctl = h.controls;
  if (ctl) {
    ctl.minDistance = lim.minDistance;
    ctl.maxDistance = lim.maxDistance;
    ctl.maxPolarAngle = lim.maxPolarAngle;
  }
  const cam = h.camera;
  if (isPerspective(cam)) {
    cam.near = lim.near;
    cam.far = lim.far;
    cam.updateProjectionMatrix();
  } else if (isOrtho(cam)) {
    cam.near = -lim.far;
    cam.far = lim.far;
    cam.updateProjectionMatrix();
  }
}

/** Turn around the target. Snaps to the 45° grid (90° in top view) so views line up with the building. */
export function turnPose(p: ViewPose, dir: 1 | -1): ViewPose {
  const step = p.phi < 0.1 ? Math.PI / 2 : Math.PI / 4;
  const k = Math.round((p.theta + dir * step) / step);
  let theta = k * step;
  if (Math.abs(theta - p.theta) < 1e-3) theta += dir * step;
  return { ...p, target: p.target.clone(), theta };
}

export function zoomPose(p: ViewPose, factor: number, lim?: Pick<NavLimits, 'minDistance' | 'maxDistance'> | null): ViewPose {
  if (p.zoom !== undefined) return { ...p, target: p.target.clone(), zoom: THREE.MathUtils.clamp(p.zoom / factor, 0.05, 5000) };
  const radius = THREE.MathUtils.clamp(p.radius * factor, lim?.minDistance ?? 0.3, lim?.maxDistance ?? 1e5);
  return { ...p, target: p.target.clone(), radius };
}

/** Move the orbit centre to a point and come closer, keeping the viewing angle. */
export function focusPose(p: ViewPose, point: THREE.Vector3, modelRadius: number, lim?: Pick<NavLimits, 'minDistance'> | null): ViewPose {
  const close = Math.max(modelRadius * 0.45, 6);
  return { ...p, target: point.clone(), radius: Math.max(Math.min(p.radius, close), lim?.minDistance ?? 0.3) };
}

/** The first visible surface under a screen point (with its world-space normal), or the ground under it. */
export function pickSurface(
  h: NavHandle,
  clientX: number,
  clientY: number,
  maxDistance = Infinity,
): { point: THREE.Vector3; normal: THREE.Vector3 | null } | null {
  const el = (h.gl as { domElement?: HTMLCanvasElement } | undefined)?.domElement;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, h.camera);
  if (h.scene) {
    const visible = (o: THREE.Object3D | null): boolean => {
      for (let n = o; n; n = n.parent) if (!n.visible) return false;
      return true;
    };
    try {
      for (const hit of ray.intersectObjects(h.scene.children, true)) {
        if (hit.distance > maxDistance) break;
        if ((hit.object as THREE.Mesh).isMesh && visible(hit.object)) {
          const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
          // Faces seen from behind (thin planes): flip towards the camera.
          if (normal && normal.dot(ray.ray.direction) > 0) normal.negate();
          return { point: hit.point.clone(), normal };
        }
      }
    } catch {
      /* fall back to the ground */
    }
  }
  const ground = new THREE.Vector3();
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ground) ? { point: ground, normal: new THREE.Vector3(0, 1, 0) } : null;
}

/** The first visible surface under a screen point, or the ground under it. */
export function pickPoint(h: NavHandle, clientX: number, clientY: number, maxDistance = Infinity): THREE.Vector3 | null {
  return pickSurface(h, clientX, clientY, maxDistance)?.point ?? null;
}

let animToken = 0;

/** Stop any camera move in progress (e.g. when the user starts dragging). */
export function cancelViewAnimation(): void {
  animToken++;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Free camera move (walk mode): position in a straight line, orientation along the shortest turn, lens and lens shift eased. */
export function animateFree(
  h: Pick<NavHandle, 'camera' | 'invalidate'>,
  to: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov?: number; shift?: { x: number; y: number } },
  ms = 520,
  onFrame?: () => void,
): Promise<void> {
  const my = ++animToken;
  const cam = h.camera;
  const p0 = cam.position.clone();
  const q0 = cam.quaternion.clone();
  const fov0 = isPerspective(cam) ? cam.fov : undefined;
  const s0 = lensShift(cam);
  const s1 = to.shift ?? s0;
  const apply = (e: number) => {
    cam.position.lerpVectors(p0, to.position, e);
    cam.quaternion.slerpQuaternions(q0, to.quaternion, e);
    if (isPerspective(cam) && fov0 !== undefined && to.fov !== undefined) cam.fov = fov0 + (to.fov - fov0) * e;
    if (s1.x !== s0.x || s1.y !== s0.y) setLensShift(cam, { x: s0.x + (s1.x - s0.x) * e, y: s0.y + (s1.y - s0.y) * e });
    else if (isPerspective(cam)) cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    onFrame?.();
    h.invalidate();
  };
  const duration = prefersReducedMotion() || typeof requestAnimationFrame !== 'function' ? 0 : ms;
  if (duration <= 0) {
    apply(1);
    return Promise.resolve();
  }
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (now: number) => {
      if (my !== animToken) { resolve(); return; }
      const t = Math.min(1, (now - start) / duration);
      apply(easeInOutCubic(t));
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Glide to a pose: target moves straight, distance on a log scale, angles along the short way round. */
export function animateTo(h: NavHandle, to: ViewPose, ms = 480): Promise<void> {
  const my = ++animToken;
  const cam = h.camera;
  const ctl = h.controls;
  const from = currentPose(h);
  const dTheta = Math.atan2(Math.sin(to.theta - from.theta), Math.cos(to.theta - from.theta));
  const fromZoom = isOrtho(cam) ? cam.zoom : 1;
  const fromShift = from.shift ?? { x: 0, y: 0 };
  const toShift = to.shift ?? fromShift;
  const fromFov = isPerspective(cam) ? cam.fov : undefined;
  const toFov = isPerspective(cam) && to.fov !== undefined ? to.fov : fromFov;
  const apply = (e: number) => {
    const target = from.target.clone().lerp(to.target, e);
    const radius = from.radius * Math.pow(to.radius / from.radius, e);
    const phi = from.phi + (to.phi - from.phi) * e;
    const theta = from.theta + dTheta * e;
    cam.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(radius, Math.max(TOP_PHI, phi), theta)));
    cam.up.set(0, 1, 0);
    if (isOrtho(cam) && to.zoom !== undefined) {
      cam.zoom = fromZoom + (to.zoom - fromZoom) * e;
      cam.updateProjectionMatrix();
    }
    const fovMoves = isPerspective(cam) && fromFov !== undefined && toFov !== undefined && toFov !== fromFov;
    if (fovMoves) cam.fov = fromFov + (toFov - fromFov) * e;
    if (toShift.x !== fromShift.x || toShift.y !== fromShift.y) {
      setLensShift(cam, { x: fromShift.x + (toShift.x - fromShift.x) * e, y: fromShift.y + (toShift.y - fromShift.y) * e });
    } else if (fovMoves) {
      (cam as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
    if (ctl) {
      ctl.target.copy(target);
      ctl.update();
    } else {
      cam.lookAt(target);
    }
    cam.updateMatrixWorld();
    h.invalidate();
  };
  const duration = prefersReducedMotion() || typeof requestAnimationFrame !== 'function' ? 0 : ms;
  if (duration <= 0) {
    apply(1);
    return Promise.resolve();
  }
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (now: number) => {
      if (my !== animToken) { resolve(); return; }
      const t = Math.min(1, (now - start) / duration);
      apply(easeInOutCubic(t));
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}
