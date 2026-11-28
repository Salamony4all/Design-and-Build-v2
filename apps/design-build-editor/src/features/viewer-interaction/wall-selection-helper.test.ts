import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('design-build-simplified-viewer-shell', () => ({
  getPascalStores: () => ({}),
}));

import {
  computeWallGapClosures,
  detectClickedWallSide,
  findConnectedWallIds,
  pickSceneNodeAtPoint,
  raycastWallsAnalytical,
  type WallLike,
} from './wall-selection-helper';

function makeCamera(pos: [number, number, number], target: [number, number, number]) {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  cam.position.set(...pos);
  cam.lookAt(...target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

describe('wall-selection-helper', () => {
  it('picks visible wall mesh even when WallRenderer collision-mesh is visible=false', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera([0, 1.5, 5], [0, 1.5, 0]);

    const wallGroup = new THREE.Group();
    const visibleWall = new THREE.Mesh(
      new THREE.BoxGeometry(4, 3, 0.2),
      new THREE.MeshBasicMaterial(),
    );
    visibleWall.position.set(0, 1.5, 0);

    const invisibleCollider = new THREE.Mesh(
      new THREE.BoxGeometry(4, 3, 0.2),
      new THREE.MeshBasicMaterial(),
    );
    invisibleCollider.name = 'collision-mesh';
    invisibleCollider.visible = false;
    invisibleCollider.position.set(0, 1.5, 0);

    wallGroup.add(visibleWall, invisibleCollider);
    scene.add(wallGroup);
    scene.updateMatrixWorld(true);

    const nodes: Record<string, WallLike> = {
      w1: { id: 'w1', type: 'wall', start: [-2, 0], end: [2, 0], height: 3, thickness: 0.2, visible: true },
    };
    const registryNodes = new Map<string, THREE.Object3D>([['w1', wallGroup]]);

    const hit = pickSceneNodeAtPoint({
      ndcX: 0,
      ndcY: 0,
      camera,
      scene,
      nodes,
      registryNodes,
    });

    expect(hit).not.toBeNull();
    expect(hit?.node.id).toBe('w1');
    expect(hit?.via).toBe('mesh');
  });

  it('prefers Door/Window/Furniture within 0.32 m priority window over host Wall', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera([0, 1.5, 5], [0, 1.5, 0]);

    const wallGroup = new THREE.Group();
    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.2), new THREE.MeshBasicMaterial());
    wallMesh.position.set(0, 1.5, 0);
    wallGroup.add(wallMesh);

    const winGroup = new THREE.Group();
    const winMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 0.16), new THREE.MeshBasicMaterial());
    // Recessed 0.08 m behind wall front surface — within 0.32 m window
    winMesh.position.set(0, 1.5, -0.08);
    winGroup.add(winMesh);

    scene.add(wallGroup, winGroup);
    scene.updateMatrixWorld(true);

    const nodes: Record<string, WallLike> = {
      w1: { id: 'w1', type: 'wall', start: [-2, 0], end: [2, 0], height: 3, thickness: 0.2, visible: true },
      win1: { id: 'win1', type: 'window', parentId: 'w1', visible: true },
    };
    const registryNodes = new Map<string, THREE.Object3D>([
      ['w1', wallGroup],
      ['win1', winGroup],
    ]);

    const hit = pickSceneNodeAtPoint({
      ndcX: 0,
      ndcY: 0,
      camera,
      scene,
      nodes,
      registryNodes,
    });

    expect(hit?.node.id).toBe('win1');
  });

  it('resolves userData.wallId cladding overlays while skipping OVERLAY_LAYER=1 highlight objects', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera([0, 1.5, 5], [0, 1.5, 0]);

    const highlightMesh = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.2, 0.4), new THREE.MeshBasicMaterial());
    highlightMesh.name = 'db-selection-highlight';
    highlightMesh.layers.set(1);
    highlightMesh.position.set(0, 1.5, 0.3);

    const fluteOverlay = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.8, 0.03), new THREE.MeshBasicMaterial());
    fluteOverlay.position.set(0, 1.5, 0.12);
    fluteOverlay.userData = { architecturalLock: true, wallId: 'w_clad' };

    scene.add(highlightMesh, fluteOverlay);
    scene.updateMatrixWorld(true);

    const nodes: Record<string, WallLike> = {
      w_clad: { id: 'w_clad', type: 'wall', start: [-2, 0], end: [2, 0], height: 3, thickness: 0.2, visible: true },
    };

    const hit = pickSceneNodeAtPoint({
      ndcX: 0,
      ndcY: 0,
      camera,
      scene,
      nodes,
      registryNodes: new Map(),
    });

    expect(hit?.node.id).toBe('w_clad');
    expect(hit?.via).toBe('mesh');
  });

  it('falls back to analytical wall raycast over floor slab and excludes hosted opening cutouts', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera([0, 1.4, 5], [0, 1.4, 0]);

    const slabGroup = new THREE.Group();
    const slabMesh = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 10), new THREE.MeshBasicMaterial());
    slabMesh.position.set(0, -0.05, 0);
    slabGroup.add(slabMesh);
    scene.add(slabGroup);
    scene.updateMatrixWorld(true);

    const nodes: Record<string, WallLike & { width?: number; height?: number; position?: number[] }> = {
      slab1: { id: 'slab1', type: 'slab', visible: true },
      w_thin: {
        id: 'w_thin',
        type: 'wall',
        start: [-3, 0],
        end: [3, 0],
        height: 3.0,
        thickness: 0.08,
        visible: true,
        children: ['door_center'],
      },
      door_center: {
        id: 'door_center',
        type: 'door',
        parentId: 'w_thin',
        position: [3.0, 1.05, 0], // center of [-3..3] is 3.0 along wall
        width: 1.0,
        height: 2.1,
      },
    };
    const registryNodes = new Map<string, THREE.Object3D>([['slab1', slabGroup]]);

    // Click center -> inside hosted doorway cutout -> should NOT falsely pick w_thin
    const centerRay = new THREE.Raycaster();
    centerRay.setFromCamera(new THREE.Vector2(0, 0), camera);
    const doorCutHit = raycastWallsAnalytical(centerRay.ray, nodes, registryNodes);
    expect(doorCutHit).toBeNull();

    // Click right side of wall (x ≈ +2m, away from center doorway) -> analytical hit picks w_thin
    const rightCam = makeCamera([2.0, 1.5, 5], [2.0, 1.5, 0]);
    const sideHit = pickSceneNodeAtPoint({
      ndcX: 0,
      ndcY: 0,
      camera: rightCam,
      scene,
      nodes,
      registryNodes,
    });
    expect(sideHit?.node.id).toBe('w_thin');
    expect(sideHit?.via).toBe('analytical');
  });

  it('detectClickedWallSide respects frontSide/backSide semantic swap', () => {
    const wall: WallLike = {
      id: 'w_side',
      type: 'wall',
      start: [0, 0],
      end: [4, 0],
      frontSide: 'exterior',
      backSide: 'interior',
    };
    // Tangent along +X, local +Z front normal points toward +Z
    expect(detectClickedWallSide(wall, { x: 2, z: 3 })).toBe('exterior');
    expect(detectClickedWallSide(wall, { x: 2, z: -3 })).toBe('interior');
  });

  it('findConnectedWallIds traverses connected L/T/U corners within 0.12 m and ignores gaps', () => {
    const nodes: Record<string, WallLike> = {
      w1: { id: 'w1', type: 'wall', start: [0, 0], end: [4, 0], visible: true },
      w2: { id: 'w2', type: 'wall', start: [4.04, 0.02], end: [4, 3], visible: true },
      w3: { id: 'w3', type: 'wall', start: [4, 3], end: [0, 3], visible: true },
      w_gap: { id: 'w_gap', type: 'wall', start: [6, 0], end: [8, 0], visible: true },
      w_hidden: { id: 'w_hidden', type: 'wall', start: [0, 0], end: [0, -2], visible: false },
    };

    const chain = findConnectedWallIds(['w1'], nodes);
    expect(chain).toEqual(['w1', 'w2', 'w3']);
    expect(chain).not.toContain('w_gap');
    expect(chain).not.toContain('w_hidden');
  });

  it('skips Plan drawing (guide) in front of a wall so interior wall clicks pick the wall', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera([0, 1.65, 5], [0, 0.8, 0]);

    const guideMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    guideMesh.rotation.x = -Math.PI / 2;
    guideMesh.position.set(0, 0.01, 0);

    const wallGroup = new THREE.Group();
    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.2), new THREE.MeshBasicMaterial());
    wallMesh.position.set(0, 1.5, -1);
    wallGroup.add(wallMesh);

    scene.add(guideMesh, wallGroup);
    scene.updateMatrixWorld(true);

    const nodes: Record<string, WallLike> = {
      g1: { id: 'g1', type: 'guide', visible: true },
      w_int: { id: 'w_int', type: 'wall', start: [-3, -1], end: [3, -1], height: 3, thickness: 0.2, visible: true },
    };
    const registryNodes = new Map<string, THREE.Object3D>([
      ['g1', guideMesh],
      ['w_int', wallGroup],
    ]);

    const hit = pickSceneNodeAtPoint({ ndcX: 0, ndcY: 0, camera, scene, nodes, registryNodes });
    expect(hit?.node.id).toBe('w_int');
  });

  it('picks a hosted window via its invisible cutout proxy from both exterior (+Z) and interior (-Z) views', () => {
    const scene = new THREE.Scene();

    const wallGroup = new THREE.Group();
    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3, 0.2), new THREE.MeshBasicMaterial());
    wallMesh.position.set(-2, 1.5, 0);
    wallGroup.add(wallMesh);

    // Window root has zero-sized geometry and an invisible proud cutout child, plus FrontSide glass
    const winRoot = new THREE.Mesh(new THREE.BoxGeometry(0, 0, 0), new THREE.MeshBasicMaterial({ visible: false }));
    winRoot.position.set(0, 1.4, 0);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 1.3),
      new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
    );
    const cutout = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.5, 0.28),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    cutout.name = 'cutout';
    cutout.visible = false;
    winRoot.add(glass, cutout);

    scene.add(wallGroup, winRoot);
    scene.updateMatrixWorld(true);

    const nodes: Record<string, WallLike> = {
      w1: { id: 'w1', type: 'wall', start: [-3, 0], end: [3, 0], height: 3, thickness: 0.2, visible: true },
      win_front_back: { id: 'win_front_back', type: 'window', parentId: 'w1', visible: true },
    };
    const registryNodes = new Map<string, THREE.Object3D>([
      ['w1', wallGroup],
      ['win_front_back', winRoot],
    ]);

    const extCam = makeCamera([0, 1.4, 4], [0, 1.4, 0]);
    const extHit = pickSceneNodeAtPoint({ ndcX: 0, ndcY: 0, camera: extCam, scene, nodes, registryNodes });
    expect(extHit?.node.id).toBe('win_front_back');
    expect(cutout.visible).toBe(false);

    const intCam = makeCamera([0, 1.4, -4], [0, 1.4, 0]);
    const intHit = pickSceneNodeAtPoint({ ndcX: 0, ndcY: 0, camera: intCam, scene, nodes, registryNodes });
    expect(intHit?.node.id).toBe('win_front_back');
    expect(cutout.visible).toBe(false);
  });

  it('picks a foreground wall rather than occluded furniture behind the wall', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera([0, 1.5, 6], [0, 1.5, 0]);

    const wallGroup = new THREE.Group();
    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.2), new THREE.MeshBasicMaterial());
    wallMesh.position.set(0, 1.5, 2);
    wallGroup.add(wallMesh);

    const itemGroup = new THREE.Group();
    const itemMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1.8, 1), new THREE.MeshBasicMaterial());
    itemMesh.position.set(0, 0.9, -2);
    itemGroup.add(itemMesh);

    scene.add(wallGroup, itemGroup);
    scene.updateMatrixWorld(true);

    const nodes: Record<string, WallLike> = {
      w_front: { id: 'w_front', type: 'wall', start: [-2, 2], end: [2, 2], height: 3, thickness: 0.2, visible: true },
      item_back: { id: 'item_back', type: 'item', visible: true },
    };
    const registryNodes = new Map<string, THREE.Object3D>([
      ['w_front', wallGroup],
      ['item_back', itemGroup],
    ]);

    const hit = pickSceneNodeAtPoint({ ndcX: 0, ndcY: 0, camera, scene, nodes, registryNodes });
    expect(hit?.node.id).toBe('w_front');
  });

  it('closes collinear gaps while preserving hosted opening world positions and extends T-junctions', () => {
    const nodes: Record<string, WallLike & { position?: number[] }> = {
      w_left: {
        id: 'w_left',
        type: 'wall',
        parentId: 'lvl_1',
        start: [0, 0],
        end: [3.0, 0],
        thickness: 0.2,
        visible: true,
      },
      w_right: {
        id: 'w_right',
        type: 'wall',
        parentId: 'lvl_1',
        start: [3.6, 0],
        end: [8.0, 0],
        thickness: 0.2,
        visible: true,
        children: ['door_hosted'],
      },
      door_hosted: {
        id: 'door_hosted',
        type: 'door',
        parentId: 'w_right',
        // world x = 3.6 + 1.4 = 5.0
        position: [1.4, 1.05, 0],
      },
      w_perp: {
        id: 'w_perp',
        type: 'wall',
        parentId: 'lvl_1',
        start: [8.0, -3],
        end: [8.0, 4],
        thickness: 0.2,
        visible: true,
      },
    };

    const res = computeWallGapClosures(['w_right'], nodes);
    expect(res.wallUpdates).toHaveLength(1);
    // Start should extend west from x=3.6 to x=3.0 (w_left.end), while end=8.0 stays closed on w_perp
    expect(res.wallUpdates[0].start).toEqual([3, 0]);
    expect(res.wallUpdates[0].end).toEqual([8, 0]);
    // Hosted door position[0] must shift by +0.6 to remain at world x = 3.0 + 2.0 = 5.0
    expect(res.childUpdates).toEqual([{ id: 'door_hosted', position: [2, 1.05, 0] }]);
    expect(res.dirtyWallIds).toContain('w_right');
    expect(res.dirtyWallIds).toContain('w_left');

    // Also test T-junction extension when selected wall stops short of a perpendicular wall
    const tNodes: Record<string, WallLike> = {
      w_short: {
        id: 'w_short',
        type: 'wall',
        parentId: 'lvl_1',
        start: [0, 0],
        end: [4.2, 0],
        thickness: 0.2,
        visible: true,
      },
      w_cross: {
        id: 'w_cross',
        type: 'wall',
        parentId: 'lvl_1',
        start: [5.0, -2],
        end: [5.0, 2],
        thickness: 0.2,
        visible: true,
      },
    };
    const tRes = computeWallGapClosures(['w_short'], tNodes);
    expect(tRes.wallUpdates).toHaveLength(1);
    expect(tRes.wallUpdates[0].start).toEqual([0, 0]);
    expect(tRes.wallUpdates[0].end).toEqual([5, 0]);
  });
});
