// features/viewer-interaction/camera-framing-service.ts
//
// Reusable HOST-APP camera-framing service for the Design Build Editor.
//
// This is a clean-app capability, NOT a fixture workaround. It frames the
// committed Pascal building (slab + walls + future columns/windows/doors/
// items) inside the official Pascal Viewer's camera, without moving, rotating,
// mirroring, rescaling or offsetting the building geometry.
//
// Design rules (per master task):
//   - No Pascal internals imported here.
//   - No node_modules patches.
//   - No hard-coded CODE-06 camera coordinates.
//   - Only world-space bounds of building objects drive the framing.
//   - Guide plane, grid, controls, cameras and UI helpers are EXCLUDED from
//     the bounds computation (the host passes only building-object AABBs).
//
// The service is pure: it takes inputs and returns a `FramingSolution`. The
// host wires it to the live R3F camera + OrbitControls and applies the result.

import * as THREE from 'three';

export type CameraMode = 'perspective' | 'orthographic';

export interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

export interface CameraParams {
  mode: CameraMode;
  /** Vertical field of view in degrees (perspective). */
  fovDeg: number;
  /** Horizontal field of view in degrees (perspective, optional override). */
  aspect: number;
  /** Current near/far planes (used as a floor; solution may widen them). */
  near: number;
  far: number;
  /** Orthographic half-extents / zoom (ortho mode). */
  zoom?: number;
}

export interface FramingSolution {
  buildingBounds: Aabb;
  buildingCenter: [number, number, number];
  boundingSphereRadius: number;
  cameraPositionBefore: [number, number, number] | null;
  cameraPositionAfter: [number, number, number];
  controlsTarget: [number, number, number];
  near: number;
  far: number;
  viewportAspect: number;
  framingPadding: number;
  visibleBuildingObjectCount: number;
}

const DEG2RAD = Math.PI / 180;

/** Combine a list of object AABBs into one world-space AABB. */
export function combineAabbs(boxes: Aabb[]): Aabb | null {
  if (boxes.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let i = 0; i < 3; i++) {
      if (b.min[i] < min[i]) min[i] = b.min[i];
      if (b.max[i] > max[i]) max[i] = b.max[i];
    }
  }
  return { min, max };
}

/**
 * Compute a framing solution that fits `boxes` into the camera view with
 * `padding` (fraction, e.g. 0.15 = 15% visual padding).
 */
export function computeFraming(
  boxes: Aabb[],
  camera: CameraParams,
  cameraPositionBefore: [number, number, number] | null,
  padding = 0.15,
): FramingSolution {
  const combined = combineAabbs(boxes);
  const visibleCount = boxes.length;
  if (!combined) {
    // Nothing to frame — return a neutral identity-ish solution.
    const center: [number, number, number] = [0, 0, 0];
    return {
      buildingBounds: { min: center, max: center },
      buildingCenter: center,
      boundingSphereRadius: 1,
      cameraPositionBefore,
      cameraPositionAfter: cameraPositionBefore ?? [10, 10, 10],
      controlsTarget: center,
      near: camera.near,
      far: camera.far,
      viewportAspect: camera.aspect,
      framingPadding: padding,
      visibleBuildingObjectCount: 0,
    };
  }

  const center: [number, number, number] = [
    (combined.min[0] + combined.max[0]) / 2,
    (combined.min[1] + combined.max[1]) / 2,
    (combined.min[2] + combined.max[2]) / 2,
  ];
  const sizeX = combined.max[0] - combined.min[0];
  const sizeY = combined.max[1] - combined.min[1];
  const sizeZ = combined.max[2] - combined.min[2];
  const boundingSphereRadius = 0.5 * Math.hypot(sizeX, sizeY, sizeZ);

  const aspect = camera.aspect > 0 ? camera.aspect : 1;
  const pad = Math.min(0.4, Math.max(0, padding)); // clamp 0..40%
  // Effective sphere the camera must contain (with padding).
  const effRadius = boundingSphereRadius * (1 + pad);

  let position: [number, number, number];
  let near = camera.near;
  let far = camera.far;

  if (camera.mode === 'perspective') {
    const vFov = camera.fovDeg * DEG2RAD;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    // Distance so the sphere fits both vertical and horizontal FOV.
    const distV = effRadius / Math.sin(vFov / 2);
    const distH = effRadius / Math.sin(hFov / 2);
    const distance = Math.max(distV, distH);
    // Approach direction: keep a clean, symmetric isometric 3/4 view (from +x,+y,+z).
    const dir = new THREE.Vector3(1, 1, 1).normalize();
    const camPos = new THREE.Vector3(center[0], center[1], center[2]).add(
      dir.multiplyScalar(distance),
    );
    position = [camPos.x, camPos.y, camPos.z];
    // Keep the near plane close to the camera. Putting it just in front of the
    // model (distance - radius) sliced the model as soon as the user zoomed in.
    near = Math.min(0.1, Math.max(0.02, boundingSphereRadius / 500));
    far = Math.max(1000, distance * 3 + effRadius * 4 + 200);
  } else {
    // Orthographic: derive zoom + half-extents from project bounds.
    const halfW = (sizeX / 2) * (1 + pad);
    const halfH = (sizeY / 2) * (1 + pad);
    // Distance just needs to clear the depth; keep modest.
    const distance = Math.max(sizeZ, boundingSphereRadius) + 50;
    const dir = new THREE.Vector3(1, 1, 1).normalize();
    const camPos = new THREE.Vector3(center[0], center[1], center[2]).add(
      dir.multiplyScalar(distance),
    );
    position = [camPos.x, camPos.y, camPos.z];
    near = -boundingSphereRadius * 2 - 100;
    far = distance + boundingSphereRadius * 2 + 100;
  }

  return {
    buildingBounds: combined,
    buildingCenter: center,
    boundingSphereRadius,
    cameraPositionBefore,
    cameraPositionAfter: position,
    controlsTarget: center,
    near,
    far,
    viewportAspect: aspect,
    framingPadding: pad,
    visibleBuildingObjectCount: visibleCount,
  };
}

/**
 * Apply a framing solution to a live R3F camera + OrbitControls.
 * `applyFn` is supplied by the host (so this module stays framework-agnostic
 * and Pascal-free). It receives the resolved numbers and performs the
 * assignment + invalidate on the actual THREE objects.
 */
export function describeApply(sol: FramingSolution): string {
  return [
    `center=(${sol.buildingCenter.map((n) => n.toFixed(2)).join(',')})`,
    `radius=${sol.boundingSphereRadius.toFixed(2)}`,
    `cam=(${sol.cameraPositionAfter.map((n) => n.toFixed(2)).join(',')})`,
    `target=(${sol.controlsTarget.map((n) => n.toFixed(2)).join(',')})`,
    `near=${sol.near.toFixed(2)} far=${sol.far.toFixed(2)}`,
    `objects=${sol.visibleBuildingObjectCount}`,
  ].join(' ');
}

/** Frame only the supplied building-object AABBs (used by Fit Selection). */
export function frameSelectionBoxes(
  boxes: Aabb[],
  camera: CameraParams,
  cameraPositionBefore: [number, number, number] | null,
  padding = 0.18,
): FramingSolution {
  return computeFraming(boxes, camera, cameraPositionBefore, padding);
}
