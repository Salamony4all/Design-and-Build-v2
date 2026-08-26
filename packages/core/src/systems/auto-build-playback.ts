import useLiveTransforms from '../store/use-live-transforms';
import useScene from '../store/use-scene';
import type { AnyNodeId, AnyNode } from '../schema/types';
import { SiteNode, BuildingNode, LevelNode, GuideNode, DoorNode, WindowNode } from '../schema';
import type { AutoBuildSceneResult } from '@pascal-app/deterministic-engine';

export interface PlaybackOptions {
  intervalMs?: number; // Default 25ms (approx 40Hz updates, inside 60FPS render loop)
  onProgress?: (phase: 'walls' | 'openings' | 'slabs' | 'furniture' | 'complete', count: number, total: number) => void;
}

/**
 * High-Performance Progressive "Auto-Build" Playback & Sequencing Priority Engine:
 * 1. Structural Walls: Ripple corner-to-corner.
 * 2. Openings (Doors & Windows): Pierce into host wall centerlines.
 * 3. Floor Slabs: Drop and fit inside room enclosures.
 * 4. Furniture & Interior Assets: Pop into position as FIRST priority post-structure.
 * Runs via useLiveTransforms preview store to lock 60 FPS viewport rendering,
 * then commits scene graph to useScene once complete.
 */
export async function executeAutoBuildPlayback(
  result: AutoBuildSceneResult,
  options: PlaybackOptions = {}
): Promise<{ wallCount: number; openingCount: number; slabCount: number; furnitureCount: number }> {
  const { intervalMs = 25, onProgress } = options;
  const liveStore = useLiveTransforms.getState();

  const { guideNode, wallNodes, openingNodes = [], slabNodes, furnitureNodes } = result;

  // 0. Ensure Root Level Hierarchy (Site -> Building -> Level)
  const state = useScene.getState();
  let levelNode = Object.values(state.nodes).find(n => n.type === 'level');
  let activeLevelId: AnyNodeId | undefined = levelNode ? (levelNode.id as AnyNodeId) : undefined;

  if (!activeLevelId) {
    let siteNode = Object.values(state.nodes).find((n) => n.type === 'site');
    let siteId = siteNode?.id;
    if (!siteId) {
      const site = SiteNode.parse({ name: 'Site', children: [] });
      state.createNode(site as any);
      siteId = site.id;
    }
    let buildingNode = Object.values(state.nodes).find((n) => n.type === 'building');
    let buildingId = buildingNode?.id;
    if (!buildingId) {
      const bNode = BuildingNode.parse({ name: 'Building', children: [], position: [0, 0, 0], rotation: [0, 0, 0] });
      state.createNode(bNode as any, siteId as any);
      buildingId = bNode.id;
    }
    const lNode = LevelNode.parse({ name: 'Ground Floor', children: [], level: 0 });
    state.createNode(lNode as any, buildingId as any);
    activeLevelId = lNode.id as any;
  }

  if (guideNode && activeLevelId) {
    const validatedGuide = GuideNode.parse({
      ...guideNode,
      name: (guideNode as any).name || 'Ground Blueprint Guide',
    });
    state.createNode(validatedGuide as any, activeLevelId);
  }

  // --- Phase 1: Structural Walls (Ripple corner-to-corner) ---
  for (let i = 0; i < wallNodes.length; i++) {
    const wall = wallNodes[i]!;
    liveStore.set(wall.id, {
      position: [wall.start[0], 0, wall.start[1]],
      rotation: Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]),
    });

    onProgress?.('walls', i + 1, wallNodes.length);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  // --- Phase 2: Floor Slabs (Automatically drop inside closed structural boundaries) ---
  for (let i = 0; i < slabNodes.length; i++) {
    const slab = slabNodes[i]!;
    liveStore.set(slab.id, {
      position: [0, slab.elevation, 0],
      rotation: 0,
    });

    onProgress?.('slabs', i + 1, slabNodes.length);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  // --- Phase 3: Furniture Blocks & Loose Items (Pop into place post-structure) ---
  for (let i = 0; i < furnitureNodes.length; i++) {
    const item = furnitureNodes[i]!;
    liveStore.set(item.id, {
      position: item.position,
      rotation: item.rotation[1],
    });

    onProgress?.('furniture', i + 1, furnitureNodes.length);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  // --- Phase 4: Openings (Doors & Windows pierced into host walls) ---
  for (let i = 0; i < openingNodes.length; i++) {
    const op = openingNodes[i]!;
    liveStore.set(op.id, {
      position: op.position,
      rotation: op.rotation[1],
    });

    onProgress?.('openings', i + 1, openingNodes.length);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  // Clear live transform preview store before committing
  liveStore.clearAll();

  // --- Final Atomic Scene Commit to useScene Database ---
  const commitOps: { node: AnyNode; parentId?: AnyNodeId }[] = [];

  for (const wall of wallNodes) {
    commitOps.push({ node: wall as any, parentId: activeLevelId });
  }

  for (const op of openingNodes) {
    const parentId = (op.wallId && (state.nodes as Record<string, any>)[op.wallId] ? op.wallId : activeLevelId) as AnyNodeId;
    if (op.type === 'door') {
      const doorId = op.id && op.id.startsWith('door_') ? op.id : `door_${op.id}_${Date.now()}`;
      const doorNode = DoorNode.parse({
        id: doorId as any,
        name: doorId,
        position: op.position,
        rotation: op.rotation,
        width: op.width,
        height: op.height,
        wallId: op.wallId,
      });
      commitOps.push({ node: doorNode as any, parentId });
    } else {
      const windowId = op.id && op.id.startsWith('window_') ? op.id : `window_${op.id}_${Date.now()}`;
      const windowNode = WindowNode.parse({
        id: windowId as any,
        name: windowId,
        position: op.position,
        rotation: op.rotation,
        width: op.width,
        height: op.height,
        wallId: op.wallId,
      });
      commitOps.push({ node: windowNode as any, parentId });
    }
  }

  for (const slab of slabNodes) {
    commitOps.push({ node: slab as any, parentId: activeLevelId });
  }
  for (const item of furnitureNodes) {
    commitOps.push({ node: item as any, parentId: activeLevelId });
  }

  if (commitOps.length > 0) {
    state.createNodes(commitOps);
  }

  const totalCount = wallNodes.length + openingNodes.length + slabNodes.length + furnitureNodes.length;
  onProgress?.('complete', totalCount, totalCount);

  return {
    wallCount: wallNodes.length,
    openingCount: openingNodes.length,
    slabCount: slabNodes.length,
    furnitureCount: furnitureNodes.length,
  };
}
