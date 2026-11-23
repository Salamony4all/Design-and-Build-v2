// harness/build-live-import.ts
// Change Set 2: build Pascal drafts from a LIVE neutral ExtractionResult
// (produced by the clean design-build-extraction-mupdf provider) instead of the
// frozen fixture JSON.
//
// This REUSES the existing progressive Pascal adapter path:
//   - identical initial shell (Site/Building/Level/Guide) via createCoordinateFrame
//   - identical SlabNode + 70 WallNode drafts (one Pascal WallNode per accepted wall)
//   - identical parent/children contract via pascal-adapter replaceChildren
//   - consumed by the SAME runStagedCode06Import runner (harness/code06-staged-import.ts)
//
// Only PDF/neutral-result fields are read. No columns/windows/doors/furniture.

import {
  SiteNode, BuildingNode, LevelNode, SlabNode, WallNode, GuideNode,
} from '@pascal-app/core';
import type { AnyNode } from '@pascal-app/core';
import { createCoordinateFrame, type Bounds, type PageMetrics } from 'design-build-coordinate-frame';
import { replaceChildren, validateSceneTree, type NodeMap, type SceneTreeValidationResult } from 'design-build-pascal-adapter';
import type { ExtractionResult } from 'design-build-extraction-contracts';
import type { Code06Drafts, InitialIds } from './build-code06-import';
import { computeBuildingFrame, guideWorldPlacement } from './building-frame';

const WALL_HEIGHT = 3.0; // m (frozen gate: >=0.35 => 3.0)
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

export interface PrepareLiveDraftsOpts {
  /** Cropped guide image (dataURL) sized to the active building region. */
  guideDataUrl?: string;
}

/**
 * Build the full in-memory draft set from a live neutral ExtractionResult.
 * Mirrors prepareCode06Drafts() but sources geometry from `result` (world meters).
 *
 * GUIDE ALIGNMENT (M1): the Guide plane is placed from the SAME BuildingFrame
 * as the slab + walls — i.e. the verified active building region (ROI), NOT the
 * full PDF page. This fixes the historical "Guide not aligned with the model"
 * defect where guidePlaneTransform() used page dimensions/centre.
 */
export function prepareLiveDrafts(result: ExtractionResult, opts?: PrepareLiveDraftsOpts): Code06Drafts {
  const siteId = uid('site');
  const buildingId = uid('building');
  const levelId = uid('level');
  const guideId = uid('guide');
  const slabId = uid('slab');

  const doc = result.document;
  const metrics: PageMetrics = {
    pageBoundsPt: doc.pageBoundsPt,
    scaleMmPerPt: doc.scaleMmPerPt,
    pageWidthM: doc.widthM,
    pageHeightM: doc.heightM,
  };
  const frame = createCoordinateFrame(metrics);
  const pageWm = doc.widthM;
  const pageHm = doc.heightM;

  // ── Authoritative building frame (reused by slab + walls via activeRegion) ──
  const roi = (result.providerEvidence as { raw?: { activeBuildingRegionMupdf?: Bounds } } | undefined)?.raw?.activeBuildingRegionMupdf;
  const buildingFrame = roi
    ? computeBuildingFrame({
        frameId: `bf_${levelId}`,
        sourceHash: (result.audit as { documentFrame?: { pageId?: string } } | undefined)?.documentFrame?.pageId ?? '',
        pageBoundsPt: doc.pageBoundsPt,
        activeRegionPt: roi,
        scaleMmPerPt: doc.scaleMmPerPt,
      })
    : null;

  const docLabel = doc.pageId && doc.pageId !== 'page-0' ? doc.pageId.replace(/\.pdf$/i, '') : 'Project';

  let nodes: NodeMap = {};
  nodes[siteId] = SiteNode.parse({ id: siteId, name: `${docLabel} Site`, parentId: null }) as AnyNode;
  nodes[buildingId] = BuildingNode.parse({ id: buildingId, name: `${docLabel} Building`, parentId: siteId }) as AnyNode;
  nodes[levelId] = LevelNode.parse({ id: levelId, name: 'Level 1', parentId: buildingId }) as AnyNode;

  if (buildingFrame) {
    const { position, scale, rotation } = guideWorldPlacement(buildingFrame);
    nodes[guideId] = GuideNode.parse({
      id: guideId, name: `${docLabel} Guide`, parentId: levelId,
      url: opts?.guideDataUrl ?? '/guide-code06.png',
      position,
      rotation: [rotation[0], rotation[1], rotation[2]],
      scale, opacity: 100,
      metadata: {
        buildingFrameId: buildingFrame.frameId,
        guideWidthM: buildingFrame.widthM,
        guideDepthM: buildingFrame.depthM,
        guideCentreM: position,
        invertY: buildingFrame.invertY ?? false,
      },
    }) as AnyNode;
  } else {
    // Fallback: legacy page-frame guide (no ROI available).
    const gp = frame.guidePlaneTransform();
    const fullScale = pageWm / 10;
    nodes[guideId] = GuideNode.parse({
      id: guideId, name: `${docLabel} Guide`, parentId: levelId,
      url: opts?.guideDataUrl ?? 'asset://code06/guide-page.png',
      position: gp.position,
      rotation: [0, (gp.rotationDeg * Math.PI) / 180, 0],
      scale: fullScale, opacity: 0.25,
      metadata: {
        invertY: false,
        guideWidthM: pageWm,
        guideDepthM: pageHm,
        guideCentreM: gp.position,
      },
    }) as AnyNode;
  }

  nodes = replaceChildren(nodes, siteId, [buildingId]);
  nodes = replaceChildren(nodes, buildingId, [levelId]);
  nodes = replaceChildren(nodes, levelId, [guideId]);

  const initialShell: { nodes: NodeMap; rootNodeIds: string[]; ids: InitialIds } = {
    nodes, rootNodeIds: [siteId], ids: { site: siteId, building: buildingId, level: levelId, guide: guideId },
  };

  // Slab draft from the neutral SlabContract (world meters polygon).
  const rawPoly = result.slab?.polygonM ?? [[0, 0], [pageWm, 0], [pageWm, pageHm], [0, pageHm]];
  const slabPolygon = rawPoly.map((p): [number, number] =>
    Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y],
  );
  const slabNode = SlabNode.parse({
    id: slabId, name: 'Slab', parentId: levelId,
    polygon: slabPolygon,
    elevation: 0,
    materialPreset: 'parquet',
  }) as AnyNode;
  const slab = { id: slabId, node: slabNode };

  // 70 wall drafts (one independent Pascal WallNode per accepted wall).
  const wallDrafts: { id: string; physicalWallId: string; node: AnyNode }[] = [];
  for (const w of result.walls) {
    const id = uid('wall');
    // glass partitions and glazed screens read from the drawing get the glass finish
    const glass = (w.metadata as { glass?: boolean } | undefined)?.glass === true;
    const node = WallNode.parse({
      id, name: `${glass ? 'Glass partition' : 'Wall'} ${wallDrafts.length + 1}`, parentId: levelId,
      start: [w.startM.x, w.startM.y] as [number, number],
      end: [w.endM.x, w.endM.y] as [number, number],
      height: WALL_HEIGHT,
      thickness: w.thicknessM,
      ...(glass ? { material: { preset: 'glass' as const } } : { materialPreset: 'white' }),
      metadata: {
        physicalWallId: w.id,
        confidence: w.provenance.confidence,
        orientationRadians: 0,
        ...(glass ? { wallClassification: 'GLASS_PARTITION' } : {}),
      },
    }) as AnyNode;
    wallDrafts.push({ id, physicalWallId: w.id, node });
  }

  const fullNodes: NodeMap = { ...nodes, [slabId]: slabNode };
  for (const w of wallDrafts) fullNodes[w.id] = w.node;
  fullNodes[levelId] = { ...fullNodes[levelId], children: [guideId, slabId, ...wallDrafts.map((w) => w.id)] } as AnyNode;
  const validation = validateSceneTree(fullNodes, { rootNodeIds: [siteId] });

  return { initialShell, slab, wallDrafts, pageWm, pageHm, validation };
}
