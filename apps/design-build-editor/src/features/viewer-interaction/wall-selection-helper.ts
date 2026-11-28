// features/viewer-interaction/wall-selection-helper.ts
// Unified 3D raycast picking, clicked wall face detection, thin-wall analytical
// fallback, and connected wall-chain traversal for effortless wall selection.

import * as THREE from 'three';
import { sampleWallCenterline } from '../furniture/architectural-features';

export interface WallLike {
  id: string;
  type: string;
  parentId?: string | null;
  visible?: boolean;
  start?: [number, number];
  end?: [number, number];
  curveOffset?: number;
  height?: number;
  thickness?: number;
  frontSide?: string;
  backSide?: string;
  children?: string[];
  metadata?: Record<string, unknown>;
}

export interface LastClickedWallInfo {
  wallId: string;
  side: 'interior' | 'exterior';
  point: [number, number, number];
}

let lastClickedWall: LastClickedWallInfo | null = null;
const listeners = new Set<() => void>();

export function getLastClickedWall(): LastClickedWallInfo | null {
  return lastClickedWall;
}

export function setLastClickedWall(info: LastClickedWallInfo | null): void {
  lastClickedWall = info;
  for (const cb of listeners) cb();
}

export function subscribeLastClickedWall(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Determine which semantic side ('interior' | 'exterior') of a wall faces the viewer.
 * Mirrors `@pascal-app/nodes` `paint.js` front/back -> frontSide/backSide mapping.
 */
export function detectClickedWallSide(
  wall: WallLike,
  origin: { x: number; y?: number; z: number },
  hitPoint?: { x: number; y?: number; z: number },
): 'interior' | 'exterior' {
  if (!wall.start || !wall.end) return 'interior';
  const pts = sampleWallCenterline(wall, 0.35);
  let refX = (wall.start[0] + wall.end[0]) / 2;
  let refZ = (wall.start[1] + wall.end[1]) / 2;
  let ang = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);

  if (pts.length > 0) {
    const qx = hitPoint?.x ?? origin.x;
    const qz = hitPoint?.z ?? origin.z;
    let bestD2 = Infinity;
    for (const p of pts) {
      const d2 = (p.x - qx) * (p.x - qx) + (p.z - qz) * (p.z - qz);
      if (d2 < bestD2) {
        bestD2 = d2;
        refX = p.x;
        refZ = p.z;
        ang = p.angle;
      }
    }
  }

  const dx = origin.x - refX;
  const dz = origin.z - refZ;
  const localZ = -dx * Math.sin(ang) + dz * Math.cos(ang);
  const hitFace: 'front' | 'back' = localZ >= 0 ? 'front' : 'back';
  const semantic = hitFace === 'front' ? wall.frontSide : wall.backSide;
  if (semantic === 'interior' || semantic === 'exterior') return semantic;
  return hitFace === 'front' ? 'interior' : 'exterior';
}

const SKIP_PICK_TYPES = new Set(['site', 'building', 'level', 'ceiling', 'zone', 'guide']);
const DOUBLE_SIDE_HIT_MAT = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const IGNORED_OBJECT_NAMES = new Set([
  'db-selection-highlight',
  'db-spatial-mesh-frame',
  'db-contact-shadows',
  'db-capture-ceiling',
]);

const PICK_PRIORITY: Record<string, number> = {
  item: 0,
  door: 0,
  window: 0,
  column: 0,
  wall: 1,
  fence: 1,
  guide: 2,
  roof: 2,
  stair: 2,
  slab: 3,
};

const SCENE_LAYER_0 = (() => {
  const l = new THREE.Layers();
  l.set(0);
  return l;
})();

function isVisibleTree(obj: THREE.Object3D | null): boolean {
  for (let cur = obj; cur; cur = cur.parent) {
    if (!cur.visible) return false;
    if (IGNORED_OBJECT_NAMES.has(cur.name)) return false;
  }
  return true;
}

function isPointInsideHostedOpening(
  wall: WallLike,
  pt: THREE.Vector3,
  nodes: Record<string, Record<string, unknown> | undefined>,
  baseElevation: number,
): boolean {
  if (!wall.start || !wall.end || !wall.children?.length) return false;
  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return false;
  const tx = dx / len;
  const tz = dz / len;
  const localX = (pt.x - wall.start[0]) * tx + (pt.z - wall.start[1]) * tz;
  const localY = pt.y - baseElevation;

  for (const childId of wall.children) {
    const child = nodes[childId];
    if (!child || (child.type !== 'door' && child.type !== 'window')) continue;
    const pos = Array.isArray(child.position) ? (child.position as number[]) : null;
    if (!pos) continue;
    const width = typeof child.width === 'number' ? child.width : 0.9;
    const height = typeof child.height === 'number' ? child.height : 2.1;
    const cx = pos[0] ?? 0;
    const cy = pos[1] ?? height / 2;
    if (
      Math.abs(localX - cx) <= width / 2 + 0.03 &&
      localY >= cy - height / 2 - 0.03 &&
      localY <= cy + height / 2 + 0.03
    ) {
      return true;
    }
  }
  return false;
}

/** Analytical 3D ray-vs-wall fallback for thin walls, glazing partitions, and oblique angles. */
export function raycastWallsAnalytical(
  ray: THREE.Ray,
  nodes: Record<string, WallLike | undefined>,
  registryNodes: Map<string, THREE.Object3D>,
  maxDistance = Infinity,
): { node: WallLike; distance: number; point: THREE.Vector3 } | null {
  let best: { node: WallLike; distance: number; point: THREE.Vector3 } | null = null;
  const pMin = new THREE.Vector3();
  const pMax = new THREE.Vector3();
  const hitPt = new THREE.Vector3();
  const box = new THREE.Box3();
  const invQuat = new THREE.Quaternion();
  const localRay = new THREE.Ray();

  for (const raw of Object.values(nodes)) {
    if (!raw || raw.type !== 'wall' || raw.visible === false || !raw.start || !raw.end) continue;
    const pts = sampleWallCenterline(raw, 0.4);
    if (pts.length < 2) continue;

    const wallObj = registryNodes.get(raw.id);
    if (wallObj && !isVisibleTree(wallObj)) continue;

    const baseY = wallObj ? wallObj.position.y : 0;
    const height = Math.max(0.2, raw.height ?? 3.0);
    const halfThick = Math.max(0.11, (raw.thickness ?? 0.2) * 0.68);
    const topY = baseY + height + 0.08;
    const bottomY = baseY - 0.05;

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const sx = b.x - a.x;
      const sz = b.z - a.z;
      const segLen = Math.hypot(sx, sz);
      if (segLen < 0.02) continue;

      const midX = (a.x + b.x) / 2;
      const midZ = (a.z + b.z) / 2;
      const yaw = -Math.atan2(sz, sx);
      invQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);

      localRay.origin.copy(ray.origin).sub(new THREE.Vector3(midX, 0, midZ)).applyQuaternion(invQuat);
      localRay.direction.copy(ray.direction).applyQuaternion(invQuat);

      box.set(
        pMin.set(-segLen / 2 - 0.03, bottomY, -halfThick),
        pMax.set(segLen / 2 + 0.03, topY, halfThick),
      );
      if (!localRay.intersectBox(box, hitPt)) continue;

      const dist = localRay.origin.distanceTo(hitPt);
      if (dist > maxDistance || dist < 0.05) continue;

      const worldHit = hitPt.clone().applyQuaternion(invQuat.clone().invert()).add(new THREE.Vector3(midX, 0, midZ));
      if (isPointInsideHostedOpening(raw, worldHit, nodes as Record<string, Record<string, unknown> | undefined>, baseY)) {
        continue;
      }

      if (!best || dist < best.distance) {
        best = { node: raw, distance: dist, point: worldHit };
      }
    }
  }

  return best;
}

export interface PickNodeResult {
  node: WallLike;
  distance: number;
  point: THREE.Vector3;
  via: 'mesh' | 'analytical';
}

const raycaster = new THREE.Raycaster();
const openingRaycaster = new THREE.Raycaster();

/**
 * Raycasts hosted doors and windows using their invisible double-sided `cutout` proxy
 * meshes (which `WindowSystem` / `DoorSystem` keep `visible = false`), with an analytical
 * parent-wall opening box fallback when no `cutout` child is present.
 */
export function raycastOpeningsAnalytical(
  ray: THREE.Ray,
  nodes: Record<string, WallLike | undefined>,
  registryNodes: Map<string, THREE.Object3D>,
  maxDistance = Infinity,
): { node: WallLike; distance: number; point: THREE.Vector3 }[] {
  const results: { node: WallLike; distance: number; point: THREE.Vector3 }[] = [];
  const invQuat = new THREE.Quaternion();
  const localRay = new THREE.Ray();
  const box = new THREE.Box3();
  const pMin = new THREE.Vector3();
  const pMax = new THREE.Vector3();
  const hitPt = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);

  for (const raw of Object.values(nodes)) {
    if (!raw || (raw.type !== 'door' && raw.type !== 'window') || raw.visible === false) continue;

    let matched: { node: WallLike; distance: number; point: THREE.Vector3 } | null = null;
    const obj = registryNodes.get(raw.id);
    if (obj && isVisibleTree(obj)) {
      const cutout = obj.getObjectByName('cutout') as THREE.Mesh | undefined;
      if (cutout && cutout.isMesh && cutout.geometry) {
        const prevVis = cutout.visible;
        const prevMat = cutout.material;
        cutout.visible = true;
        cutout.material = DOUBLE_SIDE_HIT_MAT;
        try {
          cutout.updateWorldMatrix(true, false);
          openingRaycaster.ray.copy(ray);
          openingRaycaster.near = 0.05;
          openingRaycaster.far = maxDistance;
          const hits = openingRaycaster.intersectObject(cutout, false);
          if (hits.length > 0 && hits[0].distance >= 0.05 && hits[0].distance <= maxDistance) {
            matched = { node: raw, distance: hits[0].distance, point: hits[0].point.clone() };
          }
        } catch {
          /* ignore cutout raycast failure */
        } finally {
          cutout.visible = prevVis;
          cutout.material = prevMat;
        }
      }
    }

    if (!matched && raw.parentId) {
      const wall = nodes[raw.parentId];
      if (wall && wall.type === 'wall' && wall.visible !== false && wall.start && wall.end) {
        const wallObj = registryNodes.get(wall.id);
        if (!wallObj || isVisibleTree(wallObj)) {
          const dx = wall.end[0] - wall.start[0];
          const dz = wall.end[1] - wall.start[1];
          const len = Math.hypot(dx, dz);
          if (len >= 1e-4) {
            const childRec = raw as WallLike & { position?: number[]; width?: number; height?: number };
            const pos = Array.isArray(childRec.position) ? childRec.position : null;
            if (pos) {
              const width = typeof childRec.width === 'number' ? childRec.width : 0.9;
              const height = typeof childRec.height === 'number' ? childRec.height : raw.type === 'window' ? 1.4 : 2.1;
              const cx = pos[0] ?? 0;
              const cy = pos[1] ?? height / 2;
              const baseY = wallObj ? wallObj.position.y : 0;
              const halfThick = Math.max(0.12, (wall.thickness ?? 0.2) * 0.5 + 0.06);
              const tx = dx / len;
              const tz = dz / len;
              const midX = wall.start[0] + tx * cx;
              const midZ = wall.start[1] + tz * cx;
              const yaw = -Math.atan2(dz, dx);

              invQuat.setFromAxisAngle(yAxis, -yaw);
              localRay.origin.copy(ray.origin).sub(new THREE.Vector3(midX, 0, midZ)).applyQuaternion(invQuat);
              localRay.direction.copy(ray.direction).applyQuaternion(invQuat);

              box.set(
                pMin.set(-width / 2, baseY + cy - height / 2, -halfThick),
                pMax.set(width / 2, baseY + cy + height / 2, halfThick),
              );
              if (localRay.intersectBox(box, hitPt)) {
                const worldHit = hitPt
                  .clone()
                  .applyQuaternion(invQuat.clone().invert())
                  .add(new THREE.Vector3(midX, 0, midZ));
                const dist = ray.origin.distanceTo(worldHit);
                if (dist >= 0.05 && dist <= maxDistance) {
                  matched = { node: raw, distance: dist, point: worldHit };
                }
              }
            }
          }
        }
      }
    }

    if (matched) results.push(matched);
  }

  results.sort((a, b) => a.distance - b.distance);
  return results;
}

/**
 * Raycasts the live 3D scene and resolves the best selectable node under `(ndcX, ndcY)`.
 * Solves `WallRenderer`'s invisible `collision-mesh` (`visible={false}`) while keeping
 * higher priority for Doors, Windows, and Furniture within `0.32 m`.
 */
export function pickSceneNodeAtPoint(args: {
  ndcX: number;
  ndcY: number;
  camera: THREE.Camera;
  scene: THREE.Scene;
  nodes: Record<string, WallLike | undefined>;
  registryNodes: Map<string, THREE.Object3D>;
}): PickNodeResult | null {
  const { ndcX, ndcY, camera, scene, nodes, registryNodes } = args;
  camera.updateMatrixWorld();

  const reverseMap = new Map<THREE.Object3D, string>();
  for (const [id, obj] of registryNodes.entries()) {
    reverseMap.set(obj, id);
  }

  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  let intersections: THREE.Intersection[];
  try {
    intersections = raycaster.intersectObjects(scene.children, true);
  } catch {
    intersections = [];
  }

  const resolved: { node: WallLike; distance: number; point: THREE.Vector3 }[] = [];
  const byIdIndex = new Map<string, number>();

  for (const hit of intersections) {
    const obj = hit.object;
    if (!(obj as THREE.Mesh).isMesh) continue;
    if (!obj.layers.test(SCENE_LAYER_0)) continue;
    if (!isVisibleTree(obj)) continue;

    let resolvedNode: WallLike | undefined;
    for (let cur: THREE.Object3D | null = obj; cur; cur = cur.parent) {
      const explicitWallId = typeof cur.userData?.wallId === 'string' ? cur.userData.wallId : undefined;
      if (explicitWallId && nodes[explicitWallId]?.type === 'wall') {
        resolvedNode = nodes[explicitWallId];
        break;
      }
      const regId = reverseMap.get(cur);
      if (regId && nodes[regId]) {
        let candidate = nodes[regId]!;
        if ((candidate.type === 'roof-segment' || candidate.type === 'stair-segment') && candidate.parentId) {
          const parent = nodes[candidate.parentId];
          if (parent) candidate = parent;
        }
        if (SKIP_PICK_TYPES.has(candidate.type)) continue;
        resolvedNode = candidate;
        break;
      }
    }

    if (!resolvedNode || byIdIndex.has(resolvedNode.id)) continue;
    byIdIndex.set(resolvedNode.id, resolved.length);
    resolved.push({ node: resolvedNode, distance: hit.distance, point: hit.point.clone() });
  }

  const openingHits = raycastOpeningsAnalytical(raycaster.ray, nodes, registryNodes, Infinity);
  for (const oh of openingHits) {
    const idx = byIdIndex.get(oh.node.id);
    if (idx === undefined) {
      byIdIndex.set(oh.node.id, resolved.length);
      resolved.push(oh);
    } else if (oh.distance < resolved[idx].distance) {
      resolved[idx] = oh;
    }
  }
  resolved.sort((a, b) => a.distance - b.distance);

  let bestMesh: { node: WallLike; distance: number; point: THREE.Vector3 } | null = null;
  if (resolved.length > 0) {
    const firstDist = resolved[0].distance;
    const windowCutoff = firstDist + 0.32;
    const inWindow = resolved.filter((r) => r.distance <= windowCutoff);
    inWindow.sort((a, b) => {
      const pa = PICK_PRIORITY[a.node.type] ?? 2;
      const pb = PICK_PRIORITY[b.node.type] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.distance - b.distance;
    });
    bestMesh = inWindow[0];
  }

  const wallCutoff =
    bestMesh && bestMesh.node.type !== 'slab'
      ? Math.max(0.05, bestMesh.distance - 0.15)
      : bestMesh
        ? bestMesh.distance + 0.08
        : Infinity;
  const analytical = raycastWallsAnalytical(raycaster.ray, nodes, registryNodes, wallCutoff);
  if (analytical) {
    return { ...analytical, via: 'analytical' };
  }

  return bestMesh ? { ...bestMesh, via: 'mesh' } : null;
}

/** BFS across visible walls sharing start/end endpoints within `0.12 m`. */
export function findConnectedWallIds(
  seedIds: readonly string[],
  nodes: Record<string, WallLike | undefined>,
  maxChain = 24,
): string[] {
  const walls = Object.values(nodes).filter(
    (w): w is WallLike & { start: [number, number]; end: [number, number] } =>
      Boolean(w && w.type === 'wall' && w.visible !== false && Array.isArray(w.start) && Array.isArray(w.end)),
  );
  const byId = new Map(walls.map((w) => [w.id, w]));
  const result: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const id of seedIds) {
    if (byId.has(id) && !visited.has(id)) {
      visited.add(id);
      queue.push(id);
      result.push(id);
    }
  }

  const nearPt = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.12;

  while (queue.length > 0 && result.length < maxChain) {
    const curId = queue.shift()!;
    const cur = byId.get(curId);
    if (!cur) continue;
    for (const candidate of walls) {
      if (visited.has(candidate.id)) continue;
      const connected =
        nearPt(cur.start, candidate.start) ||
        nearPt(cur.start, candidate.end) ||
        nearPt(cur.end, candidate.start) ||
        nearPt(cur.end, candidate.end);
      if (connected) {
        visited.add(candidate.id);
        queue.push(candidate.id);
        result.push(candidate.id);
        if (result.length >= maxChain) break;
      }
    }
  }

  return result;
}

export interface WallGapClosureResult {
  wallUpdates: { id: string; start: [number, number]; end: [number, number] }[];
  childUpdates: { id: string; position: [number, number, number] }[];
  dirtyWallIds: string[];
}

function distPointToSegment2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { dist: number; cx: number; cz: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-10) {
    return { dist: Math.hypot(px - ax, pz - az), cx: ax, cz: az, t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return { dist: Math.hypot(px - cx, pz - cz), cx, cz, t };
}

/**
 * Computes geometry patches to close endpoint gaps or extend open wall ends
 * to the nearest visible wall intersection on the same level within `maxGapM`.
 * Preserves hosted door/window world coordinates when a wall's `start` shifts.
 */
export function computeWallGapClosures(
  wallIds: readonly string[],
  nodes: Record<string, WallLike | undefined>,
  maxGapM = 1.8,
): WallGapClosureResult {
  const walls = Object.values(nodes).filter(
    (w): w is WallLike & { start: [number, number]; end: [number, number] } =>
      Boolean(
        w &&
          w.type === 'wall' &&
          w.visible !== false &&
          Array.isArray(w.start) &&
          Array.isArray(w.end) &&
          Math.abs(w.curveOffset ?? 0) <= 0.03 &&
          Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]) >= 0.05,
      ),
  );
  const byId = new Map(walls.map((w) => [w.id, w]));
  const selectedSet = new Set(wallIds);
  const wallUpdates: WallGapClosureResult['wallUpdates'] = [];
  const childUpdates: WallGapClosureResult['childUpdates'] = [];
  const dirtySet = new Set<string>();

  for (const wallId of wallIds) {
    const w = byId.get(wallId);
    if (!w) continue;

    let nextStart: [number, number] = [w.start[0], w.start[1]];
    let nextEnd: [number, number] = [w.end[0], w.end[1]];
    const candidates = walls.filter(
      (other) => other.id !== w.id && (!w.parentId || !other.parentId || other.parentId === w.parentId),
    );
    const hasChildren = Boolean(w.children?.length);

    for (const which of ['start', 'end'] as const) {
      const p: [number, number] = which === 'start' ? w.start : w.end;
      const otherEnd: [number, number] = which === 'start' ? w.end : w.start;
      const outX = p[0] - otherEnd[0];
      const outZ = p[1] - otherEnd[1];
      const outLen = Math.hypot(outX, outZ);
      if (outLen < 0.05) continue;
      const dirX = outX / outLen;
      const dirZ = outZ / outLen;

      // Skip already-closed endpoints
      let alreadyClosed = false;
      for (const other of candidates) {
        if (
          Math.hypot(other.start[0] - p[0], other.start[1] - p[1]) <= 0.03 ||
          Math.hypot(other.end[0] - p[0], other.end[1] - p[1]) <= 0.03
        ) {
          alreadyClosed = true;
          break;
        }
        const segDist = distPointToSegment2D(p[0], p[1], other.start[0], other.start[1], other.end[0], other.end[1]).dist;
        if (segDist <= Math.max(0.03, (other.thickness ?? 0.2) * 0.5 + 0.02)) {
          alreadyClosed = true;
          break;
        }
      }
      if (alreadyClosed) continue;

      let bestTarget: [number, number] | null = null;
      let bestScore = Infinity;
      let bestOtherId: string | null = null;

      const consider = (tx: number, tz: number, score: number, otherId: string) => {
        if (score < bestScore) {
          bestScore = score;
          bestTarget = [tx, tz];
          bestOtherId = otherId;
        }
      };

      const projectIfHosted = (tx: number, tz: number, align: number): [number, number] => {
        if (!hasChildren || align >= 0.998) return [tx, tz];
        const s = Math.max(0, (tx - p[0]) * dirX + (tz - p[1]) * dirZ);
        return [p[0] + dirX * s, p[1] + dirZ * s];
      };

      for (const other of candidates) {
        // (a) Endpoint snap
        for (const qSide of ['start', 'end'] as const) {
          const q = qSide === 'start' ? other.start : other.end;
          const qOpp = qSide === 'start' ? other.end : other.start;
          const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d <= 0.005 || d > maxGapM) continue;
          const ux = (q[0] - p[0]) / d;
          const uz = (q[1] - p[1]) / d;
          const align = ux * dirX + uz * dirZ;
          if (align < 0.65) continue;

          let tx = q[0];
          let tz = q[1];
          if (selectedSet.has(other.id)) {
            const oLen = Math.hypot(q[0] - qOpp[0], q[1] - qOpp[1]);
            if (oLen >= 0.05) {
              const oDirX = (q[0] - qOpp[0]) / oLen;
              const oDirZ = (q[1] - qOpp[1]) / oLen;
              const oppAlign = oDirX * -ux + oDirZ * -uz;
              if (oppAlign >= 0.65) {
                tx = (p[0] + q[0]) / 2;
                tz = (p[1] + q[1]) / 2;
              }
            }
          }
          const [px, pz] = projectIfHosted(tx, tz, align);
          consider(px, pz, d * (1.15 - 0.15 * align), other.id);
        }

        // (b) Ray-segment T-junction intersection (segment extended by 0.06 m at ends)
        const odx = other.end[0] - other.start[0];
        const odz = other.end[1] - other.start[1];
        const oLen = Math.hypot(odx, odz);
        if (oLen >= 0.05) {
          const otx = odx / oLen;
          const otz = odz / oLen;
          const ax = other.start[0] - otx * 0.06;
          const az = other.start[1] - otz * 0.06;
          const bx = other.end[0] + otx * 0.06;
          const bz = other.end[1] + otz * 0.06;
          const sx = bx - ax;
          const sz = bz - az;
          const det = dirZ * sx - dirX * sz;
          if (Math.abs(det) > 1e-6) {
            const apx = ax - p[0];
            const apz = az - p[1];
            const t = (apx * -sz - apz * -sx) / det;
            const s = (dirX * apz - dirZ * apx) / det;
            if (t > 0.005 && t <= maxGapM && s >= 0 && s <= 1) {
              consider(p[0] + dirX * t, p[1] + dirZ * t, t, other.id);
            }
          }
        }

        // (c) Close orthogonal projection
        const proj = distPointToSegment2D(p[0], p[1], other.start[0], other.start[1], other.end[0], other.end[1]);
        if (proj.dist > 0.005 && proj.dist <= Math.min(0.45, maxGapM)) {
          const ux = (proj.cx - p[0]) / proj.dist;
          const uz = (proj.cz - p[1]) / proj.dist;
          const align = ux * dirX + uz * dirZ;
          if (align >= 0.5) {
            const [px, pz] = projectIfHosted(proj.cx, proj.cz, align);
            consider(px, pz, proj.dist * 1.1, other.id);
          }
        }
      }

      if (bestTarget && bestOtherId) {
        if (which === 'start') {
          if (Math.hypot(nextEnd[0] - bestTarget[0], nextEnd[1] - bestTarget[1]) >= 0.15) {
            nextStart = [Math.round(bestTarget[0] * 10000) / 10000, Math.round(bestTarget[1] * 10000) / 10000];
            dirtySet.add(w.id);
            dirtySet.add(bestOtherId);
          }
        } else {
          if (Math.hypot(bestTarget[0] - nextStart[0], bestTarget[1] - nextStart[1]) >= 0.15) {
            nextEnd = [Math.round(bestTarget[0] * 10000) / 10000, Math.round(bestTarget[1] * 10000) / 10000];
            dirtySet.add(w.id);
            dirtySet.add(bestOtherId);
          }
        }
      }
    }

    if (
      nextStart[0] !== w.start[0] ||
      nextStart[1] !== w.start[1] ||
      nextEnd[0] !== w.end[0] ||
      nextEnd[1] !== w.end[1]
    ) {
      wallUpdates.push({ id: w.id, start: nextStart, end: nextEnd });
      if ((nextStart[0] !== w.start[0] || nextStart[1] !== w.start[1]) && w.children?.length) {
        const ndx = nextEnd[0] - nextStart[0];
        const ndz = nextEnd[1] - nextStart[1];
        const nLen = Math.hypot(ndx, ndz);
        if (nLen > 1e-4) {
          const ntx = ndx / nLen;
          const ntz = ndz / nLen;
          const shift = (w.start[0] - nextStart[0]) * ntx + (w.start[1] - nextStart[1]) * ntz;
          for (const childId of w.children) {
            const child = nodes[childId] as (WallLike & { position?: number[] }) | undefined;
            if (!child || (child.type !== 'door' && child.type !== 'window')) continue;
            const pos = Array.isArray(child.position) ? child.position : null;
            if (!pos) continue;
            childUpdates.push({
              id: childId,
              position: [Math.round(((pos[0] ?? 0) + shift) * 10000) / 10000, pos[1] ?? 0, pos[2] ?? 0],
            });
          }
        }
      }
    }
  }

  return {
    wallUpdates,
    childUpdates,
    dirtyWallIds: Array.from(dirtySet),
  };
}
