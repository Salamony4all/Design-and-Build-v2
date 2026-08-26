// harness/ai-scene-install/install-guide.ts
// SHARED, provider-neutral AI Guide installer used by BOTH the V2
// (install-ai-extract) and V3 (pascal-progressive-builder) pipelines.
//
// The Guide source is the UPLOADED user image itself (a data: URL or run-scoped
// URL) — never a CODE_06 fixture, never a hardcoded guide-page.png, never a
// MuPDF asset. This keeps the standalone AI pipeline independent of the
// geometric/MuPDF importer.
//
// Coordinate alignment uses the SAME BuildingFrameContract as slab + walls
// (single building centre). When no frame is supplied, the frame is derived
// from the AI slab polygon already in the scene (bounding box -> footprint at
// the AI world origin), so the Guide stays aligned to the geometry with ONE
// transform. We never fabricate a CODE_06 offset.

import { GuideNode } from '@pascal-app/core';
import type { AnyNode } from '@pascal-app/core';
import { computeBuildingFrame, guideWorldPlacement, type BuildingFrameContract } from '../building-frame';
import type { Bounds } from 'design-build-coordinate-frame';
import { uid, addChild, aiMeta } from './helpers';
import type { SceneInstallContext } from './types';

export interface InstallGuideArgs {
  runId: string;
  fileName: string;
  frameId: string;
  /** Run-scoped Guide image URL (data: URL or server-scoped URL). */
  dataUrl: string;
  /** Authoritative AI building frame (same as slab + walls). */
  buildingFrame?: BuildingFrameContract | null;
  sourceFrame?: unknown;
  /** Where to attach the Guide node (defaults to ctx.levelId). */
  parentId?: string;
  opacity?: number;
  /** Pipeline mode for metadata (V2 rollback vs V3 progressive). */
  extractionMode?: 'v2' | 'progressive-v3';
}

export interface InstallGuideResult {
  guideNodeId: string | null;
  status: 'installed' | 'skipped-no-frame' | 'skipped-no-url';
}

/** Derive a BuildingFrameContract from the AI slab polygon or scene walls. */
function frameFromSlab(ctx: SceneInstallContext): BuildingFrameContract | null {
  const nodes = ctx.nodes as Record<string, Record<string, unknown>>;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const slab = Object.values(nodes).find((n) => (n.type as string) === 'slab') as
    | { polygon?: [number, number][]; metadata?: Record<string, unknown> }
    | undefined;
  const poly = slab?.polygon ?? [];
  if (Array.isArray(poly) && poly.length >= 3) {
    for (const p of poly) {
      if (!Array.isArray(p) || p.length < 2) continue;
      minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
    }
  }

  if (!Number.isFinite(minX)) {
    const walls = Object.values(nodes).filter((n) => (n.type as string) === 'wall') as any[];
    for (const w of walls) {
      if (Array.isArray(w.start) && Array.isArray(w.end)) {
        minX = Math.min(minX, w.start[0], w.end[0]);
        minY = Math.min(minY, w.start[1], w.end[1]);
        maxX = Math.max(maxX, w.start[0], w.end[0]);
        maxY = Math.max(maxY, w.start[1], w.end[1]);
      }
    }
  }

  if (!Number.isFinite(minX) || (maxX - minX) < 0.01 || (maxY - minY) < 0.01) return null;

  const widthM = maxX - minX;
  const depthM = maxY - minY;
  const cx = (minX + maxX) / 2;
  const cz = (minY + maxY) / 2;
  const frameId = `frame_slab_${slab?.metadata?.sourceRecordId ?? 'ai'}`;

  return {
    frameId,
    sourceHash: 'ai-slab',
    pageBoundsPt: [minX, minY, maxX, maxY],
    activeRegionPt: [minX, minY, maxX, maxY],
    buildingCentrePt: [cx, cz],
    scaleMmPerPt: 1000,
    projectOriginM: [cx, cz],
    widthM,
    depthM,
    rotation: 0,
    invertY: false,
  };
}

/**
 * Create a GuideNode from the uploaded plan image, aligned to the AI building
 * frame. Returns the node id, or a skip status when the input is unsafe.
 */
export function installGuide(ctx: SceneInstallContext, args: InstallGuideArgs): InstallGuideResult {
  const dataUrl = args.dataUrl;
  if (!dataUrl) return { guideNodeId: null, status: 'skipped-no-url' };

  const levelId = args.parentId ?? ctx.levelId;
  if (!levelId) return { guideNodeId: null, status: 'skipped-no-frame' };

  // Align to the authoritative frame when supplied; otherwise derive from the
  // AI slab / walls already in the scene, or fallback to standard origin [0,0].
  const frame = args.buildingFrame ?? frameFromSlab(ctx);
  if (!frame) return { guideNodeId: null, status: 'skipped-no-frame' };

  const calibration = (args.sourceFrame as any)?.calibration ?? (args.sourceFrame as any);
  const placement = guideWorldPlacement(frame, calibration);
  const position = placement.position;
  const scale = placement.scale;
  const rotation = placement.rotation;
  const guideWidth = placement.fullImageWidthM ?? frame.widthM;
  const guideDepth = placement.fullImageDepthM ?? frame.depthM;

  const id = `guide_${uid('g')}`;
  const node = GuideNode.parse({
    id,
    name: args.fileName || 'AI Guide',
    parentId: levelId,
    url: dataUrl,
    position,
    rotation,
    scale,
    opacity: args.opacity ?? 100,
    metadata: aiMeta({
      runId: args.runId,
      stageId: 'guide',
      extractionMode: args.extractionMode ?? 'v2',
      sourceFileName: args.fileName,
      frameId: args.frameId,
      pageId: (args.sourceFrame as { pageId?: string } | undefined)?.pageId,
      sourceKind: (args.sourceFrame as { kind?: string } | undefined)?.kind,
      sourceRecordId: args.frameId || args.fileName,
      buildingFrameId: frame?.frameId,
      guideWidth,
      guideDepth,
      guideWidthM: guideWidth,
      guideDepthM: guideDepth,
      guideCentreM: position,
      calibration: calibration?.buildingRoiNormalized ? calibration : undefined,
    }),
  } as never) as AnyNode;

  ctx.createNodes([{ node, parentId: levelId }]);
  addChild(ctx.nodes, levelId, id);
  return { guideNodeId: id, status: 'installed' };
}

/**
 * Real-time Guide alignment: updates existing guide node position, scale, and
 * metric dimensions to match the 1:1 bounding footprint of scene walls/slab.
 */
export function alignGuideToBuilding(ctx: SceneInstallContext): void {
  const nodes = ctx.nodes as Record<string, any>;
  const guide = Object.values(nodes).find((n) => n?.type === 'guide');
  if (!guide || !guide.id) return;

  const frame = frameFromSlab(ctx);
  if (!frame) return;

  const calibration = (guide.metadata as any)?.calibration;
  const placement = guideWorldPlacement(frame, calibration);
  const position = placement.position;
  const scale = placement.scale;
  const rotation = placement.rotation;
  const guideWidth = placement.fullImageWidthM ?? frame.widthM;
  const guideDepth = placement.fullImageDepthM ?? frame.depthM;

  const updatedMeta = {
    ...(typeof guide.metadata === 'object' && guide.metadata !== null ? guide.metadata : {}),
    buildingFrameId: frame.frameId,
    guideWidth,
    guideDepth,
    guideWidthM: guideWidth,
    guideDepthM: guideDepth,
    guideCentreM: position,
  };

  const updatePayload = {
    id: guide.id,
    position,
    scale,
    rotation,
    metadata: updatedMeta,
  };

  if (typeof (ctx as any).updateNode === 'function') {
    (ctx as any).updateNode(guide.id, updatePayload);
  } else if (typeof (ctx as any).updateNodes === 'function') {
    (ctx as any).updateNodes([{ id: guide.id, data: updatePayload }]);
  }

  if (nodes[guide.id]) {
    nodes[guide.id].position = position;
    nodes[guide.id].scale = scale;
    nodes[guide.id].rotation = rotation;
    nodes[guide.id].metadata = updatedMeta;
  }
}

/** Shared alias used by both V2 (install-ai-extract) and V3 (pascal-progressive-builder). */
export const installGuideShared = installGuide;
