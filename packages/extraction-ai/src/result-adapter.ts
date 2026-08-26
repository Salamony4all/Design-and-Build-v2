// packages/extraction-ai/src/result-adapter.ts
// Converts legacy multipass AI result into neutral ExtractionResult without data loss.
// Integrates canonical opening alias resolver, adaptive hosting, wall topology repair,
// coordinate validation, room context, and furniture catalog dimension resolution.

import type {
  ExtractionResult,
  DocumentFrame,
  WallContract,
  SlabContract,
  FurnitureInstance,
  FurnitureFamily,
  Provenance,
  Vec2,
  ReviewItem,
  RejectedItem,
  ExtractionAudit,
} from 'design-build-extraction-contracts';
import type { StructuralSchemaType } from './schema';
import type { MultipassResult, PassRecord } from './multipass-controller';
import { normalizeOpenings, type NormalizedWall } from './opening-normalizer';
import { repairWallTopology as repairWallTopologyLegacy } from './wall-snapping';
import { repairWallTopology as repairWallTopologyV2, type TopologyWall } from './wall-topology';
import { validateAiCoordinates, type DocumentFrameLineage } from './coordinate-validator';
import { resolvePascalFurniture } from './pascal-furniture-catalog';
import { resolveFurnitureDimensions } from './furniture-dimensions';
import {
  resolveDimensionHierarchy,
  validateRoomContainment,
  detectRepetitionConsensus,
  type RoomZone,
  type FurnitureInstance as V2FurnitureInstance,
} from './room-furniture-intelligence';

export const AI_OPENING_ALIASES_V2 = process.env.AI_OPENING_ALIASES_V2 === 'true';
export const AI_OPENING_HOSTING_V2 = process.env.AI_OPENING_HOSTING_V2 === 'true';
export const AI_WALL_TOPOLOGY_V2 = process.env.AI_WALL_TOPOLOGY_V2 === 'true';
export const AI_FURNITURE_CATALOG_V2 = process.env.AI_FURNITURE_CATALOG_V2 === 'true';
export const AI_FURNITURE_SPATIAL_V2 = process.env.AI_FURNITURE_SPATIAL_V2 === 'true';
export const AI_PHASE_CONTEXT_V2 = process.env.AI_PHASE_CONTEXT_V2 === 'true';
export const AI_COORDINATE_VALIDATION_V2 = process.env.AI_COORDINATE_VALIDATION_V2 === 'true';
export const AI_ROOM_CONTEXT_V2 = process.env.AI_ROOM_CONTEXT_V2 === 'true';
export const AI_FURNITURE_REPETITION_V2 = process.env.AI_FURNITURE_REPETITION_V2 === 'true';

const AI_CONFIDENCE_DEFAULT = 0.6;

function v2(t: [number, number]): Vec2 {
  return { x: t[0], y: t[1] };
}

function prov(passId: string, type: string, note?: string): Provenance {
  return {
    sourceKind: 'gemini',
    sourcePrimitiveIds: [],
    confidence: AI_CONFIDENCE_DEFAULT,
    extractionType: type,
    ...(note ? { note } : {}),
  };
}

function toContractCategory(c: string): 'bed' | 'sanitary' | 'seating' | 'storage' | 'appliance' | 'other' {
  if (c === 'beds') return 'bed';
  if (c === 'plumbing') return 'sanitary';
  if (c === 'seating') return 'seating';
  if (c === 'storage') return 'storage';
  if (c === 'appliances') return 'appliance';
  return 'other';
}

export interface AiAdapterOptions {
  pageId?: string;
  documentFrame?: DocumentFrame;
  flags?: {
    useWallTopology?: boolean;
    useAdaptiveHosting?: boolean;
    useBroadenedAliases?: boolean;
    useFurnitureOntology?: boolean;
    useCoordinateValidation?: boolean;
    useRoomContext?: boolean;
    useRepetition?: boolean;
  };
}

function deriveFrame(shell: StructuralSchemaType | null, pageId: string): DocumentFrame {
  const boundary = shell?.floors?.[0]?.boundary;
  let maxX = 10,
    maxY = 10;
  if (boundary && boundary.length >= 3) {
    maxX = Math.max(...boundary.map((p) => p[0]));
    maxY = Math.max(...boundary.map((p) => p[1]));
  }
  return {
    pageId,
    pageBoundsPt: [0, 0, maxX, maxY],
    scaleMmPerPt: 1000,
    widthM: maxX,
    heightM: maxY,
    orientation: maxX >= maxY ? 'landscape' : 'portrait',
  };
}

export function adaptMultipassResult(
  multipass: MultipassResult,
  opts: AiAdapterOptions = {}
): ExtractionResult {
  const { shell, core, fitout, ffe } = multipass.phases;
  const pageId = opts.pageId ?? `ai-run-${multipass.runId}`;
  const document = opts.documentFrame ?? deriveFrame(shell, pageId);

  const useWallTopology = opts.flags?.useWallTopology ?? AI_WALL_TOPOLOGY_V2;
  const useCoordVal = opts.flags?.useCoordinateValidation ?? AI_COORDINATE_VALIDATION_V2;
  const useFurnitureOntology = opts.flags?.useFurnitureOntology ?? AI_FURNITURE_CATALOG_V2;
  const useRoomContext = opts.flags?.useRoomContext ?? AI_ROOM_CONTEXT_V2;
  const useRepetition = opts.flags?.useRepetition ?? AI_FURNITURE_REPETITION_V2;

  const extraReviewItems: ReviewItem[] = [];

  // ── 1. Coordinate Validation V2 (Observation-Only) ──
  if (useCoordVal) {
    const baseLineage: DocumentFrameLineage = {
      frameId: `frame_${pageId}`,
      frameRevision: 1,
      sourceSpace: 'pdf-points',
      sourceWidth: document.widthM,
      sourceHeight: document.heightM,
      cropOffset: [0, 0],
      cropSize: [document.widthM, document.heightM],
      scaleMPerSourceUnit: document.scaleMmPerPt / 1000,
      scaleBasis: 'explicit-calibrated',
      sourceOrigin: 'bottom-left',
      sourceYAxis: 'up',
      yFlipApplied: false,
      worldGroundAxis: 'x-z',
    };

    const coordResult = validateAiCoordinates({
      pipelineKind: 'ai',
      baseFrame: baseLineage,
      phases: [
        {
          phase: 'core',
          frame: baseLineage,
          entities: (core?.walls ?? []).map((w, i) => ({
            id: w.id || `wall_${i}`,
            entityType: 'wall',
            pointsM: [v2(w.start), v2(w.end)],
          })),
        },
      ],
      options: { enabled: true },
    });

    for (const rec of coordResult.reviewRecords) {
      extraReviewItems.push({
        id: rec.id,
        kind: 'review',
        category: 'unknown',
        positionM: { x: (rec.observedValues as any)?.pt?.x ?? 0, y: (rec.observedValues as any)?.pt?.y ?? 0 },
        sizeM: [1, 1],
        reason: `Coordinate validation: ${rec.reasons.join('; ')}`,
        sourcePrimitiveIds: [rec.recordId || 'coord_rec'],
      });
    }
  }

  // ── 2. Raw Walls (core pass) ──
  const rawWalls: WallContract[] = (core?.walls ?? []).map((w, i) => ({
    id: w.id || `ai_wall_${i + 1}`,
    kind: 'wall',
    startM: v2(w.start),
    endM: v2(w.end),
    thicknessM: w.thickness ?? 0.2,
    heightM: w.height ?? 2.8,
    provenance: prov('core', 'wall'),
    metadata: { ...(w.material ? { material: w.material } : {}), aiPass: 'core' },
  }));

  // ── 3. Wall Topology Repair ──
  let walls: WallContract[] = rawWalls;
  let wallRepairsCount = 0;
  let duplicatesRemovedCount = 0;

  if (useWallTopology) {
    // V2 Conservative wall topology
    const topWalls: TopologyWall[] = rawWalls.map((w) => ({
      id: w.id,
      start: [w.startM.x, w.startM.y],
      end: [w.endM.x, w.endM.y],
      thickness: w.thicknessM,
      height: w.heightM,
      provenance: w.provenance,
      metadata: w.metadata,
    }));

    const v2Result = repairWallTopologyV2(topWalls, { enabled: true });
    walls = v2Result.walls.map((tw) => ({
      id: tw.id,
      kind: 'wall',
      startM: { x: tw.start[0], y: tw.start[1] },
      endM: { x: tw.end[0], y: tw.end[1] },
      thicknessM: tw.thickness ?? 0.2,
      heightM: tw.height ?? 2.8,
      provenance: tw.provenance ?? prov('core', 'wall'),
      metadata: tw.metadata,
    }));

    wallRepairsCount = v2Result.lJunctionsRepaired + v2Result.tJunctionsRepaired + v2Result.collinearMerged;
    duplicatesRemovedCount = v2Result.duplicatesRemoved;

    for (const rr of v2Result.reviewRecords) {
      extraReviewItems.push({
        id: rr.id,
        kind: 'review',
        category: 'unknown',
        positionM: { x: 0, y: 0 },
        sizeM: [0.2, 0.2],
        reason: rr.description,
        sourcePrimitiveIds: [rr.wallId],
      });
    }
  }

  // ── 4. Openings (core pass) → Deterministic Host-Normalized Window/Door Contracts ──
  const normalizedWalls: NormalizedWall[] = walls.map((w) => ({
    id: w.id,
    startM: w.startM,
    endM: w.endM,
    thicknessM: w.thicknessM,
  }));

  const openingResult = normalizeOpenings({
    parsedOpenings: (core?.openings ?? []) as never,
    normalizedWalls,
    documentFrame: document,
  });
  const windows = openingResult.acceptedWindows;
  const doors = openingResult.acceptedDoors;

  for (const ro of openingResult.reviewOpenings) {
    extraReviewItems.push({
      id: `review_opening_${ro.sourceId}`,
      kind: 'review',
      category: 'opening',
      positionM: ro.normalizedPosition ?? { x: ro.AIPosition?.[0] ?? 0, y: ro.AIPosition?.[1] ?? 0 },
      sizeM: [0.9, 0.2],
      reason: `Opening host review (${ro.rawType || ro.category}): ${ro.reason || 'uncertain host'}`,
      sourcePrimitiveIds: [ro.sourceId],
    });
  }

  // ── 5. Slab (first shell floor) ──
  const floor0 = shell?.floors?.[0];
  const slab: SlabContract | undefined = floor0
    ? {
        id: floor0.id || 'ai_slab_1',
        kind: 'slab',
        polygonM: floor0.boundary.map(v2),
        thicknessM: 0.3,
        elevationM: floor0.level ?? 0,
        provenance: prov('shell', 'slab', floor0.material ? `material:${floor0.material}` : undefined),
      }
    : undefined;

  // ── 6. Rooms & Zones ──
  const rooms: RoomZone[] = (shell?.zones ?? []).map((z, idx) => ({
    id: z.id || `zone_${idx + 1}`,
    name: z.name || `Zone ${idx + 1}`,
    category: 'generic',
    polygon: (z.boundary ?? []).map((p) => [p[0], p[1]]),
    confidence: 0.8,
  }));

  // ── 7. Furniture (fitout + ffe passes) ──
  let rawFurnitureList: V2FurnitureInstance[] = [];

  const extractRawFurniture = (items: StructuralSchemaType['furniture'], aiPass: 'fitout' | 'ffe') => {
    (items ?? []).forEach((f, i) => {
      const catalogRes = resolvePascalFurniture(f.type);
      const dims = useFurnitureOntology
        ? resolveDimensionHierarchy({
            aiWidthM: f.width,
            aiDepthM: f.depth,
          })
        : resolveFurnitureDimensions(f, catalogRes);

      rawFurnitureList.push({
        id: f.id || `ai_${aiPass}_${i + 1}`,
        family: catalogRes.slug,
        position: [f.pos[0], 0, f.pos[1]],
        rotation: [0, (f.rotation ?? 0) * (Math.PI / 180), 0],
        dimensions: {
          widthM: dims.widthM,
          depthM: dims.depthM,
          heightM: dims.heightM,
        },
      });
    });
  };

  extractRawFurniture(fitout?.furniture ?? [], 'fitout');
  extractRawFurniture(ffe?.furniture ?? [], 'ffe');

  // Repetition consensus adjustment
  if (useRepetition && rawFurnitureList.length > 0) {
    const repRes = detectRepetitionConsensus(rawFurnitureList);
    rawFurnitureList = repRes.repairedInstances;
  }

  // Room containment checks
  if (useRoomContext && rooms.length > 0) {
    for (const item of rawFurnitureList) {
      const cRes = validateRoomContainment(item, rooms);
      if (!cRes.valid && cRes.conflict) {
        extraReviewItems.push({
          id: cRes.conflict.id,
          kind: 'review',
          category: 'unknown',
          positionM: { x: item.position[0], y: item.position[2] },
          sizeM: [item.dimensions.widthM, item.dimensions.depthM],
          reason: cRes.conflict.description,
          sourcePrimitiveIds: [item.id],
        });
      }
    }
  }

  const furnitureAll: FurnitureInstance[] = [];
  const famMap = new Map<string, FurnitureFamily>();

  for (const item of rawFurnitureList) {
    const catalogRes = resolvePascalFurniture(item.family);
    const familyId = `catalog:${catalogRes.slug}`;

    if (!famMap.has(familyId)) {
      famMap.set(familyId, {
        familyId,
        label: catalogRes.label,
        defaultWidthM: item.dimensions.widthM,
        defaultDepthM: item.dimensions.depthM,
        defaultHeightM: item.dimensions.heightM ?? 0.8,
        category: toContractCategory(catalogRes.category),
      });
    }

    furnitureAll.push({
      id: item.id,
      kind: 'furniture',
      familyId,
      positionM: { x: item.position[0], y: item.position[2] },
      rotationDeg: item.rotation ? item.rotation[1] * (180 / Math.PI) : 0,
      widthM: item.dimensions.widthM,
      depthM: item.dimensions.depthM,
      heightM: item.dimensions.heightM ?? 0.8,
      provenance: prov('fitout', 'furniture'),
    });
  }

  // ── 8. Diagnostics / Evidence ──
  const passSummaries = multipass.passes.map((p: PassRecord) => ({
    passId: p.passId,
    order: p.order,
    status: p.status,
    durationMs: p.durationMs,
    tolerated: p.tolerated,
    ...(p.error ? { error: p.error } : {}),
  }));

  const providerEvidence: Record<string, unknown> = {
    kind: 'gemini-multipass',
    modelId: multipass.modelId,
    runId: multipass.runId,
    passes: passSummaries,
    wallsContextSize: multipass.wallsContextSize,
    totalDurationMs: multipass.totalDurationMs,
    projectInfo: shell?.projectInfo ?? core?.projectInfo ?? null,
    zones: shell?.zones ?? [],
    ceilings: shell?.ceilings ?? [],
    openings: core?.openings ?? [],
    wallMaterials: (core?.walls ?? []).map((w) => w.material ?? null),
    floorMaterial: floor0?.material ?? null,
    wallRepairs: wallRepairsCount,
    wallDuplicatesRemoved: duplicatesRemovedCount,
    rawPhases: { shell, core, fitout, ffe },
  };

  const rawOpeningPos = new Map<string, [number, number]>();
  for (const o of (core?.openings ?? []) as Array<{ id?: string; pos?: [number, number] }>) {
    if (o.id && o.pos) rawOpeningPos.set(o.id, o.pos);
  }

  const openingReview: ReviewItem[] = openingResult.reviewOpenings.map((d) => ({
    id: `open_${d.sourceId}`,
    kind: 'review',
    category: 'opening',
    positionM: (() => {
      const p = rawOpeningPos.get(d.sourceId);
      return p ? { x: p[0], y: p[1] } : { x: 0, y: 0 };
    })(),
    sizeM: [0.9, 2.1],
    reason: d.reason ?? 'ambiguous host wall',
    sourcePrimitiveIds: [d.sourceId],
  }));

  const openingRejected: RejectedItem[] = openingResult.rejectedOpenings.map((d) => ({
    id: `open_${d.sourceId}`,
    kind: 'rejected',
    category: 'opening',
    positionM: (() => {
      const p = rawOpeningPos.get(d.sourceId);
      return p ? { x: p[0], y: p[1] } : { x: 0, y: 0 };
    })(),
    sizeM: [0.9, 2.1],
    reason: d.reason ?? 'unsupported or no host',
    sourcePrimitiveIds: [d.sourceId],
  }));

  const review: ReviewItem[] = [...openingReview, ...extraReviewItems];
  const rejected: RejectedItem[] = [...openingRejected];

  const audit: ExtractionAudit = {
    generatedAt: new Date().toISOString(),
    documentFrame: document,
    counts: {
      slab: slab ? 1 : 0,
      walls: walls.length,
      columns: 0,
      windows: windows.length,
      doors: doors.length,
      furniture: furnitureAll.length,
      review: review.length,
      rejected: rejected.length,
    },
    rejectedIds: rejected.map((r) => r.id),
    notes: [
      `openings normalized: windows=${windows.length}, doors=${doors.length}`,
      `wall topology: ${wallRepairsCount} repairs applied`,
    ],
  };

  return {
    document,
    slab,
    walls,
    columns: [],
    windows,
    doors,
    furniture: furnitureAll,
    furnitureFamilies: Array.from(famMap.values()),
    review,
    rejectedItems: rejected,
    audit,
    providerEvidence,
  };
}
