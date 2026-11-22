// harness/build-code06-import.ts
// Checkpoint 2: FROZEN CODE-06 wall import.
//
// Imports the APPROVED frozen extraction result (70 walls, deterministic, baked
// once from CODE_06.pdf via the pure-MuPDF pipeline — no live MuPDF at runtime,
// no Gemini, no Nano Banana). Builds Pascal nodes through the REAL zod schemas
// and the SHARED coordinate-frame package (no manual offsets, no mirrors, no ROI
// shifts).
//
// DESIGN (Checkpoint 2 audit): the builder does NOT install the complete
// 70-wall scene up front. It exposes:
//   - buildInitialShell(): 1 Site + 1 Building + 1 Level + 1 Guide  (0 slab, 0 wall)
//   - buildSlabDraft():     1 SlabNode (committed in the slab stage)
//   - wallDrafts:           70 prepared WallNode drafts (committed per batch)
// The host page installs ONLY the initial shell via setScene, then commits the
// slab and wall batches incrementally via useScene.createNodes (which maintains
// parentId + children symmetrically). This satisfies the required runtime
// sequence: initial scene -> slab stage -> wall batches -> final validation.

import {
  SiteNode, BuildingNode, LevelNode, SlabNode, WallNode, GuideNode,
} from '@pascal-app/core';
import type { AnyNode } from '@pascal-app/core';
import { createCoordinateFrame, type PageMetrics } from 'design-build-coordinate-frame';
import { replaceChildren, validateSceneTree, type NodeMap, type SceneTreeValidationResult } from 'design-build-pascal-adapter';
import frozen from '@/harness/frozen-code06-walls.json';
import { computeBuildingFrame, guideWorldPlacement } from './building-frame';

export interface Code06Drafts {
  initialShell: { nodes: NodeMap; rootNodeIds: string[]; ids: InitialIds };
  slab: { id: string; node: AnyNode };
  wallDrafts: { id: string; physicalWallId: string; node: AnyNode }[];
  pageWm: number;
  pageHm: number;
  validation: SceneTreeValidationResult; // validation of the FULL in-memory draft (pre-install)
}

export interface InitialIds {
  site: string; building: string; level: string; guide: string;
}

const WALL_HEIGHT = 3.0; // m (frozen gate: >=0.35 => 3.0)
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

/**
 * Prepare ALL drafts in memory (does NOT install into useScene). The host installs
 * only the initial shell; slab + walls are committed later, per stage/batch.
 */
export function prepareCode06Drafts(): Code06Drafts {
  const siteId = uid('site');
  const buildingId = uid('building');
  const levelId = uid('level');
  const guideId = uid('guide');
  const slabId = uid('slab');

  const metrics: PageMetrics = {
    pageBoundsPt: [frozen.pageBoundsMupdf[0], frozen.pageBoundsMupdf[1], frozen.pageBoundsMupdf[2], frozen.pageBoundsMupdf[3]],
    scaleMmPerPt: frozen.scaleMmPerPt,
    pageWidthM: frozen.pageWidthM,
    pageHeightM: frozen.pageHeightM,
  };
  const frame = createCoordinateFrame(metrics);

  // Build root shell nodes.
  let nodes: NodeMap = {};
  nodes[siteId] = SiteNode.parse({ id: siteId, name: 'CODE-06 Site', parentId: null }) as AnyNode;
  nodes[buildingId] = BuildingNode.parse({ id: buildingId, name: 'CODE-06 Building', parentId: siteId }) as AnyNode;
  nodes[levelId] = LevelNode.parse({ id: levelId, name: 'CODE-06 Level', parentId: buildingId }) as AnyNode;

  const buildingFrame = computeBuildingFrame({
    frameId: `bf_${levelId}`,
    sourceHash: 'code06-frozen',
    pageBoundsPt: metrics.pageBoundsPt,
    activeRegionPt: [306.12000274658203, 376.9199981689453, 1768.6799926757812, 1170.6000366210938],
    scaleMmPerPt: metrics.scaleMmPerPt,
  });

  const { position, scale, rotation } = guideWorldPlacement(buildingFrame);
  nodes[guideId] = GuideNode.parse({
    id: guideId, name: 'CODE-06 Guide', parentId: levelId,
    url: '/guide-code06.png?v=2',
    position,
    rotation: [rotation[0], rotation[1], rotation[2]],
    scale, opacity: 100,
    metadata: {
      buildingFrameId: buildingFrame.frameId,
      guideWidthM: buildingFrame.widthM,
      guideDepthM: buildingFrame.depthM,
      guideCentreM: position,
      invertY: false,
    },
  }) as AnyNode;

  // Initial shell: site -> building -> level -> [guide]. NO slab, NO walls yet.
  nodes = replaceChildren(nodes, siteId, [buildingId]);
  nodes = replaceChildren(nodes, buildingId, [levelId]);
  nodes = replaceChildren(nodes, levelId, [guideId]);

  const initialShell: { nodes: NodeMap; rootNodeIds: string[]; ids: InitialIds } = {
    nodes, rootNodeIds: [siteId], ids: { site: siteId, building: buildingId, level: levelId, guide: guideId },
  };

  // Slab draft (committed in the slab stage).
  const [rx0, ry0, rx1, ry1] = [306.12000274658203, 376.9199981689453, 1768.6799926757812, 1170.6000366210938];
  const sp0 = frame.toPascal(rx0, ry0);
  const sp1 = frame.toPascal(rx1, ry0);
  const sp2 = frame.toPascal(rx1, ry1);
  const sp3 = frame.toPascal(rx0, ry1);
  const slabNode = SlabNode.parse({
    id: slabId, name: 'Slab', parentId: levelId,
    polygon: [sp0, sp1, sp2, sp3],
    elevation: 0,
    materialPreset: 'parquet',
  }) as AnyNode;
  const slab = { id: slabId, node: slabNode };

  // 70 wall drafts (committed per batch). Each is independent + selectable.
  const wallDrafts: { id: string; physicalWallId: string; node: AnyNode }[] = [];
  for (const w of frozen.walls) {
    const id = uid('wall');
    const node = WallNode.parse({
      id, name: `Wall ${wallDrafts.length + 1}`, parentId: levelId,
      start: [w.a.x, w.a.y] as [number, number],
      end: [w.b.x, w.b.y] as [number, number],
      height: WALL_HEIGHT,
      thickness: w.thicknessM,
      materialPreset: 'white',
      metadata: { physicalWallId: w.physicalWallId, confidence: w.confidence, orientationRadians: w.orientationRadians },
    }) as AnyNode;
    wallDrafts.push({ id, physicalWallId: w.physicalWallId, node });
  }

  // Validate the COMPLETE in-memory draft (sanity only — not installed yet).
  const fullNodes: NodeMap = { ...nodes, [slabId]: slabNode };
  for (const w of wallDrafts) fullNodes[w.id] = w.node;
  fullNodes[levelId] = { ...fullNodes[levelId], children: [guideId, slabId, ...wallDrafts.map((w) => w.id)] } as AnyNode;
  const validation = validateSceneTree(fullNodes, { rootNodeIds: [siteId] });

  return { initialShell, slab, wallDrafts, pageWm: frozen.pageWidthM, pageHm: frozen.pageHeightM, validation };
}
