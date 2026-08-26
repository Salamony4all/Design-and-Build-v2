// harness/build-capability-scene.ts
// Section 4: Pascal capability harness. Builds a static scene through the
// REAL Pascal zod schemas (schema.parse — no hand-rolled node objects):
//   Site > Building > Level > Slab + 4 Walls + Window + Door + Column
//   (native ColumnNode) + Item + Guide.
// Every node goes through <Schema>.parse so zod defaults (~60 fields on
// column) are applied exactly as the official editor does.

import {
  SiteNode, BuildingNode, LevelNode, SlabNode, WallNode, WindowNode,
  DoorNode, ColumnNode, ItemNode, GuideNode,
} from '@pascal-app/core';
import type { AnyNode } from '@pascal-app/core';

export interface CapabilityScene {
  nodes: Record<string, AnyNode>;
  rootNodeIds: string[];
  ids: {
    site: string; building: string; level: string; slab: string;
    walls: string[]; window: string; door: string; column: string;
    item: string; guide: string;
  };
}

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

/** 8m x 6m room, wall height 3m, thickness 0.2m; column at 2,2; guide plane. */
export function buildCapabilityScene(): CapabilityScene {
  const siteId = uid('site');
  const buildingId = uid('building');
  const levelId = uid('level');
  const slabId = uid('slab');
  const wallIds = [uid('wall'), uid('wall'), uid('wall'), uid('wall')];
  const windowId = uid('window');
  const doorId = uid('door');
  const columnId = uid('column');
  const itemId = uid('item');
  const guideId = uid('guide');

  const W = 8; // room width (X)
  const D = 6; // room depth (Z)
  const H = 3; // wall height
  const T = 0.2; // wall thickness

  const site = SiteNode.parse({ id: siteId, name: 'Harness Site', parentId: null });
  const building = BuildingNode.parse({ id: buildingId, name: 'Harness Building', parentId: siteId });
  const level = LevelNode.parse({ id: levelId, name: 'Level 1', parentId: buildingId });

  const slab = SlabNode.parse({
    id: slabId, name: 'Slab', parentId: levelId,
    polygon: [ [0, 0], [W, 0], [W, D], [0, D] ],
  });

  const wallDefs: [[number, number], [number, number]][] = [
    [[0, 0], [W, 0]],
    [[W, 0], [W, D]],
    [[W, D], [0, D]],
    [[0, D], [0, 0]],
  ];
  const walls = wallDefs.map(([start, end], i) => WallNode.parse({
    id: wallIds[i], name: `Wall ${i + 1}`, parentId: levelId,
    start, end, height: H, thickness: T,
  }));

  const windowNode = WindowNode.parse({
    id: windowId, name: 'Window', parentId: wallIds[0],
    wallId: wallIds[0], position: [W / 2, 1.0, 0],
  });

  const door = DoorNode.parse({
    id: doorId, name: 'Door', parentId: wallIds[2],
    wallId: wallIds[2], position: [W / 2, 0, D],
  });

  // Native ColumnNode — the capability the old checkout lacked (core 0.6.0).
  const column = ColumnNode.parse({
    id: columnId, name: 'Column', parentId: levelId,
    position: [2, 0, 2], rotation: 0,
  });

  const item = ItemNode.parse({
    id: itemId, name: 'Item', parentId: levelId,
    position: [4, 0, 3],
    asset: {
      id: 'harness-box', category: 'furniture', name: 'Harness Box',
      thumbnail: 'asset://harness/box-thumb.png', src: 'asset://harness/box.glb',
      dimensions: [1, 1, 1], source: 'library',
    },
  });

  const guide = GuideNode.parse({
    id: guideId, name: 'Guide', parentId: levelId,
    url: 'asset://harness/guide-page.png', // full-page guide image in real usage
  });

  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [site, building, level, slab, ...walls, windowNode, door, column, item, guide]
      .map((n) => [n.id, n as AnyNode]),
  );

  // CRITICAL (Pascal 0.9.2): rendering traverses each parent's `children`
  // array — parentId alone is NOT enough. Per viewer/index.js: "Unreachable
  // nodes (the parent doesn't list them in `children`) never render — every
  // renderer enumerates the parent's `children` array — so no system will
  // ever build them or clear their [dirty] mark." Wire the tree explicitly:
  (nodes[siteId] as { children: string[] }).children = [buildingId];
  (nodes[buildingId] as { children: string[] }).children = [levelId];
  (nodes[levelId] as { children: string[] }).children = [
    slabId, ...wallIds, columnId, itemId, guideId,
  ];
  (nodes[wallIds[0]] as { children: string[] }).children = [windowId]; // wall-hosted window
  (nodes[wallIds[2]] as { children: string[] }).children = [doorId];   // wall-hosted door

  return {
    nodes,
    rootNodeIds: [siteId],
    ids: {
      site: siteId, building: buildingId, level: levelId, slab: slabId,
      walls: wallIds, window: windowId, door: doorId, column: columnId,
      item: itemId, guide: guideId,
    },
  };
}
