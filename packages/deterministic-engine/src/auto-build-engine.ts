import type { VectorPrimitive } from './router';
import { simplifyPolyline } from './compiler';
import type { GuideTraceGraph } from './guide-trace/guide-trace-types';
import type { GraphFace, RoomSeed } from './guide-trace/space-topology-validator-upgraded';
import { integrateGuideTrace } from './guide-trace/integrate';

// ─── Interfaces & Schemas ─────────────────────────────────────────────────────

export interface RawVectorStream {
  primitives: VectorPrimitive[];
  wallFaces?: Array<{ id?: string; points: [[number, number], [number, number]]; thickness?: number }>;
  openings?: Array<{ id?: string; class: string; subtype?: string; width?: number; hostWallId?: string; bbox?: number[] }>;
  spaces?: Array<{ name?: string; polygon: Array<[number, number]>; color?: string }>;
  symbols?: Array<{ class: string; bbox: number[]; confidence?: number }>;
  pageWidth?: number;
  pageHeight?: number;
  pointsPerMeter?: number;
  fileUrl?: string;
  diagnosticMode?: boolean;
  spatialGroundTruth?: any;
  /** Breakthrough guide-trace pathway: a pre-built maximal-line graph (see buildGuideTraceGraph). */
  guideTrace?: GuideTraceGraph;
  /** Room seeds (codes + positions) used to validate graph faces. */
  roomSeeds?: RoomSeed[];
  /** Pre-built graph faces (if omitted, derived from the guideTrace via planar face traversal). */
  graphFaces?: GraphFace[];
  /** Allow real (height > 0) extrusion only when topology + production gates pass. */
  allowProductionExtrusion?: boolean;
}

export interface AutoBuildWall {
  id: string;
  type: 'wall';
  start: [number, number];
  end: [number, number];
  thickness: number;
  height: number;
  children: string[];
  visible: boolean;
  metadata: Record<string, any>;
  dirty: true;
}

export interface AutoBuildSlab {
  id: string;
  type: 'slab';
  polygon: Array<[number, number]>;
  holes: Array<Array<[number, number]>>;
  elevation: number;
  autoFromWalls: boolean;
  children: string[];
  visible: boolean;
  metadata: Record<string, any>;
  dirty: true;
}

export interface AutoBuildFurniture {
  id: string;
  type: 'item';
  position: [number, 0, number];
  rotation: [0, number, 0];
  scale: [number, 1.0, number];
  sku: string;
  children: string[];
  visible: boolean;
  metadata: Record<string, any>;
  dirty: true;
  asset: {
    id: string;
    category: string;
    name: string;
    thumbnail: string;
    src: string;
    dimensions: [number, number, number];
  };
}

export interface AutoBuildOpening {
  id: string;
  type: 'door' | 'window';
  wallId?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  width: number;
  height: number;
  doorType?: string;
  windowType?: string;
  children: string[];
  visible: boolean;
  metadata: Record<string, any>;
  dirty: true;
}

export interface AutoBuildGuide {
  id: string;
  type: 'guide';
  url: string;
  position: [number, number, number]; // Negative elevation offset Y = -0.01 (or 0.002) to prevent Z-fighting
  rotation: [number, number, number];
  scale: number;
  opacity: number;
  children: string[];
  visible: boolean;
  metadata: Record<string, any>;
}

export interface AutoBuildSceneResult {
  guideNode: AutoBuildGuide;
  wallNodes: AutoBuildWall[];
  openingNodes: AutoBuildOpening[];
  slabNodes: AutoBuildSlab[];
  furnitureNodes: AutoBuildFurniture[];
  metadata: {
    totalPrimitives: number;
    filteredNoiseCount: number;
    collapsedWallCount: number;
    extractedFurnitureCount: number;
    pipeline?: string;
    traceDiagnostics?: Record<string, unknown>;
    traceDebugData?: Record<string, unknown>;
    topologyReady?: boolean;
    productionReady?: boolean;
    validationPassed?: boolean;
  };
}

// ─── Noise Isolation & Loop Closure Helpers ─────────────────────────────────────

/**
 * Calculates polygon 2D surface area using Gauss's Shoelace formula.
 */
export function calculatePolygonArea(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const p1 = polygon[i]!;
    const p2 = polygon[j]!;
    area += p1[0] * p2[1];
    area -= p2[0] * p1[1];
  }
  return Math.abs(area) / 2.0;
}

/**
 * Checks if a path is closed and has interlocking corner vertices.
 * Enforces Loop Closure Law.
 */
export function isClosedLoop(points: Array<[number, number]>, snapTolerance = 0.05): boolean {
  if (points.length < 3) return false;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  const dist = Math.hypot(end[0] - start[0], end[1] - start[1]);
  return dist <= snapTolerance;
}

// ─── Parallel Path Collapsing ───────────────────────────────────────────────────

interface LineSegment {
  p1: [number, number];
  p2: [number, number];
  length: number;
  angle: number; // in radians
  dx: number;
  dy: number;
  layer: string;
  thickness?: number;
  wallType?: string;
}

function getSlopeAngle(p1: [number, number], p2: [number, number]): number {
  let angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
  if (angle < 0) angle += Math.PI;
  if (angle >= Math.PI) angle -= Math.PI;
  return angle;
}

function perpendicularDistance(p: [number, number], seg: LineSegment): number {
  const { p1, p2, length } = seg;
  if (length < 1e-6) return Math.hypot(p[0] - p1[0], p[1] - p1[1]);
  const num = Math.abs((p2[1] - p1[1]) * p[0] - (p2[0] - p1[0]) * p[1] + p2[0] * p1[1] - p2[1] * p1[0]);
  return num / length;
}

function get1DOverlapRatio(seg1: LineSegment, seg2: LineSegment): number {
  const isHoriz = Math.abs(seg1.dx) >= Math.abs(seg1.dy);
  let min1: number, max1: number, min2: number, max2: number;

  if (isHoriz) {
    min1 = Math.min(seg1.p1[0], seg1.p2[0]);
    max1 = Math.max(seg1.p1[0], seg1.p2[0]);
    min2 = Math.min(seg2.p1[0], seg2.p2[0]);
    max2 = Math.max(seg2.p1[0], seg2.p2[0]);
  } else {
    min1 = Math.min(seg1.p1[1], seg1.p2[1]);
    max1 = Math.max(seg1.p1[1], seg1.p2[1]);
    min2 = Math.min(seg2.p1[1], seg2.p2[1]);
    max2 = Math.max(seg2.p1[1], seg2.p2[1]);
  }

  const overlapStart = Math.max(min1, min2);
  const overlapEnd = Math.min(max1, max2);
  const overlapLen = Math.max(0, overlapEnd - overlapStart);

  const len1 = max1 - min1;
  const len2 = max2 - min2;
  const minLen = Math.min(len1, len2);

  if (minLen < 0.01) return 0;
  return overlapLen / minLen;
}

/**
 * Parallel Path Collapsing Engine:
 * Evaluates matching line slopes and perpendicular offsets between 0.10m and 0.30m,
 * calculating the exact midpoint baseline to synthesize a 2D wall centerline.
 */
export function collapseParallelWallPaths(
  inputLines: LineSegment[],
  minThickness = 0.07,
  maxThickness = 0.45
): AutoBuildWall[] {
  // Geometry-first cleanup: no page-size assumptions, no fixed crop, no first-match pairing.
  const quant = (v: number, step = 0.005) => Math.round(v / step) * step;
  const stableId = (prefix: string, values: number[]) =>
    `${prefix}_${values.map(v => Math.round(v * 1000)).join('_')}`;
  const canonicalKey = (s: LineSegment) => {
    const a: [number, number] = [quant(s.p1[0]), quant(s.p1[1])];
    const b: [number, number] = [quant(s.p2[0]), quant(s.p2[1])];
    const first = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? a : b;
    const last = first === a ? b : a;
    return `${first[0]},${first[1]}:${last[0]},${last[1]}`;
  };

  // Remove zero-length and duplicate/reversed segments before pair search.
  const unique = new Map<string, LineSegment>();
  for (const raw of inputLines) {
    if (!Number.isFinite(raw.length) || raw.length < 0.20) continue;
    const key = canonicalKey(raw);
    const previous = unique.get(key);
    if (!previous || raw.length > previous.length) unique.set(key, raw);
  }
  const lines = [...unique.values()];

  type Candidate = {
    i: number; j: number; score: number; thickness: number;
    start: [number, number]; end: [number, number]; overlapRatio: number;
  };
  const candidates: Candidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const a = lines[i]!;
    const ux = a.dx / a.length;
    const uy = a.dy / a.length;
    const nx = -uy;
    const ny = ux;
    const a0 = a.p1[0] * ux + a.p1[1] * uy;
    const a1 = a.p2[0] * ux + a.p2[1] * uy;
    const amin = Math.min(a0, a1), amax = Math.max(a0, a1);
    const aOffset = (a.p1[0] * nx + a.p1[1] * ny + a.p2[0] * nx + a.p2[1] * ny) / 2;

    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j]!;
      const angleDiffRaw = Math.abs(a.angle - b.angle);
      const angleDiff = Math.min(angleDiffRaw, Math.PI - angleDiffRaw);
      if (angleDiff > Math.PI / 90) continue; // 2 degrees after normalization

      const b0 = b.p1[0] * ux + b.p1[1] * uy;
      const b1 = b.p2[0] * ux + b.p2[1] * uy;
      const bmin = Math.min(b0, b1), bmax = Math.max(b0, b1);
      const overlapStart = Math.max(amin, bmin);
      const overlapEnd = Math.min(amax, bmax);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      const overlapRatio = overlap / Math.max(0.001, Math.min(a.length, b.length));
      if (overlapRatio < 0.72 || overlap < 0.40) continue;

      const bOffset = (b.p1[0] * nx + b.p1[1] * ny + b.p2[0] * nx + b.p2[1] * ny) / 2;
      const thickness = Math.abs(bOffset - aOffset);
      if (thickness < minThickness || thickness > maxThickness) continue;

      const endpointOffsetDelta = Math.abs(
        (b.p1[0] * nx + b.p1[1] * ny) - (b.p2[0] * nx + b.p2[1] * ny)
      );
      const parallelScore = Math.max(0, 1 - angleDiff / (Math.PI / 90));
      const consistencyScore = Math.max(0, 1 - endpointOffsetDelta / Math.max(thickness, 0.001));
      const lengthScore = Math.min(a.length, b.length) / Math.max(a.length, b.length);
      const score = 0.45 * overlapRatio + 0.25 * parallelScore + 0.20 * consistencyScore + 0.10 * lengthScore;
      if (score < 0.78) continue;

      const centerOffset = (aOffset + bOffset) / 2;
      const start: [number, number] = [overlapStart * ux + centerOffset * nx, overlapStart * uy + centerOffset * ny];
      const end: [number, number] = [overlapEnd * ux + centerOffset * nx, overlapEnd * uy + centerOffset * ny];
      candidates.push({ i, j, score, thickness, start, end, overlapRatio });
    }
  }

  // Global greedy assignment is deterministic because candidates are sorted by evidence.
  candidates.sort((a, b) => b.score - a.score || b.overlapRatio - a.overlapRatio || a.i - b.i || a.j - b.j);
  const used = new Set<number>();
  const walls: AutoBuildWall[] = [];
  for (const c of candidates) {
    if (used.has(c.i) || used.has(c.j)) continue;
    used.add(c.i); used.add(c.j);
    let startX = c.start[0];
    let startY = c.start[1];
    let endX = c.end[0];
    let endY = c.end[1];

    // Orthogonalize near-axis walls (within ~2.3 degrees)
    if (Math.abs(startX - endX) < 0.04) {
      const midX = (startX + endX) / 2;
      startX = midX;
      endX = midX;
    }
    if (Math.abs(startY - endY) < 0.04) {
      const midY = (startY + endY) / 2;
      startY = midY;
      endY = midY;
    }

    const start: [number, number] = [Number(startX.toFixed(4)), Number(startY.toFixed(4))];
    const end: [number, number] = [Number(endX.toFixed(4)), Number(endY.toFixed(4))];
    const wallType = c.thickness < 0.14 ? 'interior_partition' : 'structural_concrete';
    walls.push({
      id: stableId('wall', [...start, ...end, c.thickness]),
      type: 'wall', start, end,
      thickness: Number(c.thickness.toFixed(3)), height: 2.8,
      children: [], visible: true,
      metadata: {
        wallType, confidence: Number(c.score.toFixed(3)),
        evidence: { parallelPair: true, overlapRatio: Number(c.overlapRatio.toFixed(3)) }
      },
      dirty: true,
    });
  }

  // Conservative topology repair with orthogonal axis preservation.
  const medianThickness = walls.length
    ? [...walls].map(w => w.thickness).sort((a, b) => a - b)[Math.floor(walls.length / 2)]!
    : 0.15;
  const snapTolerance = Math.max(0.015, Math.min(0.06, medianThickness * 0.25));
  for (const w of walls) {
    const wasVertical = Math.abs(w.start[0] - w.end[0]) < 1e-4;
    const wasHorizontal = Math.abs(w.start[1] - w.end[1]) < 1e-4;

    for (const endpoint of [w.start, w.end] as Array<[number, number]>) {
      let best: { point: [number, number]; distance: number } | undefined;
      for (const other of walls) {
        if (other === w) continue;
        const vx = other.end[0] - other.start[0], vy = other.end[1] - other.start[1];
        const len2 = vx * vx + vy * vy;
        if (len2 < 1e-9) continue;
        const t = ((endpoint[0] - other.start[0]) * vx + (endpoint[1] - other.start[1]) * vy) / len2;
        if (t < -0.02 || t > 1.02) continue;
        const clamped = Math.max(0, Math.min(1, t));
        const projected: [number, number] = [other.start[0] + clamped * vx, other.start[1] + clamped * vy];
        const distance = Math.hypot(endpoint[0] - projected[0], endpoint[1] - projected[1]);
        if (distance <= snapTolerance && (!best || distance < best.distance)) best = { point: projected, distance };
      }
      if (best) { endpoint[0] = Number(best.point[0].toFixed(4)); endpoint[1] = Number(best.point[1].toFixed(4)); }
    }

    // Preserve orthogonality post-snapping if original segment was axis-aligned
    if (wasVertical && Math.abs(w.start[0] - w.end[0]) < 0.05) {
      const avgX = Number(((w.start[0] + w.end[0]) / 2).toFixed(4));
      w.start[0] = avgX;
      w.end[0] = avgX;
    } else if (wasHorizontal && Math.abs(w.start[1] - w.end[1]) < 0.05) {
      const avgY = Number(((w.start[1] + w.end[1]) / 2).toFixed(4));
      w.start[1] = avgY;
      w.end[1] = avgY;
    }
  }
  return walls;
}

// ─── Oriented Bounding Box (OBB) & Furniture Classifier ─────────────────────

export interface OBBResult {
  center: [number, number];
  width: number;
  length: number;
  rotation: number; // in radians
}

/**
 * Computes the minimum area Oriented Bounding Box (OBB) over closed asset 2D points.
 */
export function computeOrientedBoundingBox(points: Array<[number, number]>): OBBResult {
  if (points.length < 3) {
    return { center: [0, 0], width: 1.0, length: 1.0, rotation: 0 };
  }

  let minArea = Infinity;
  let bestOBB: OBBResult = { center: [0, 0], width: 1.0, length: 1.0, rotation: 0 };

  // Sample edge angles
  for (let i = 0; i < points.length; i++) {
    const nextIdx = (i + 1) % points.length;
    const p1 = points[i]!;
    const p2 = points[nextIdx]!;
    const edgeAngle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);

    const cos = Math.cos(-edgeAngle);
    const sin = Math.sin(-edgeAngle);

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const [x, y] of points) {
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }

    const dim1 = maxX - minX;
    const dim2 = maxY - minY;
    const area = dim1 * dim2;

    if (area < minArea && area > 1e-4) {
      minArea = area;
      const localCenterX = (minX + maxX) / 2;
      const localCenterY = (minY + maxY) / 2;
      // Un-rotate center
      const cosRev = Math.cos(edgeAngle);
      const sinRev = Math.sin(edgeAngle);
      const cx = localCenterX * cosRev - localCenterY * sinRev;
      const cy = localCenterX * sinRev + localCenterY * cosRev;

      const length = Math.max(dim1, dim2);
      const width = Math.min(dim1, dim2);

      bestOBB = {
        center: [Number(cx.toFixed(4)), Number(cy.toFixed(4))],
        width: Number(width.toFixed(4)),
        length: Number(length.toFixed(4)),
        rotation: Number(edgeAngle.toFixed(4)),
      };
    }
  }

  return bestOBB;
}


/**
 * Classifies furniture footprint by minimum-area boundary dimensions.
 */
export function classifyFurnitureFootprint(width: number, length: number): { sku: string; category: string; name: string } {
  const maxDim = Math.max(width, length);
  const minDim = Math.min(width, length);
  const area = width * length;

  if (maxDim >= 1.8 && minDim >= 1.4) {
    return { sku: 'BED_KING_001', category: 'Bedroom', name: 'King Size Bed' };
  } else if (maxDim >= 1.7 && minDim >= 0.8) {
    return { sku: 'BED_SINGLE_001', category: 'Bedroom', name: 'Single Bed' };
  } else if (maxDim >= 0.9 && minDim <= 0.65 && area < 1.2) {
    return { sku: 'WARDROBE_RUN_001', category: 'Storage', name: 'Wardrobe Joinery' };
  } else if (maxDim >= 1.2 && minDim >= 0.6) {
    return { sku: 'DESK_EXEC_001', category: 'Office', name: 'Executive Desk' };
  } else if (maxDim <= 0.85 && minDim <= 0.85) {
    return { sku: 'CHAIR_ARM_001', category: 'Seating', name: 'Armchair' };
  }

  return { sku: 'GENERIC_ITEM_001', category: 'Furniture', name: 'Interior Asset' };
}

/**
 * Space-Topology Based Architectural Extractor:
 * Derives 100% clean structural walls, floor slabs, openings, and furniture
 * directly from closed room space polygons instead of raw line stroke noise.
 */
export function extractFromSpaceTopology(
  spaces: Array<{ name?: string; polygon: Array<[number, number]>; color?: string }>,
  openings?: Array<{ id?: string; class: string; subtype?: string; width?: number; hostWallId?: string; bbox?: number[] }>,
  symbols?: Array<{ class: string; bbox: number[]; confidence?: number }>,
  spatialGroundTruth?: any,
  diagnosticMode = true,
): { wallNodes: AutoBuildWall[]; slabNodes: AutoBuildSlab[]; openingNodes: AutoBuildOpening[]; furnitureNodes: AutoBuildFurniture[]; metrics: Record<string, any> } {
  const wallNodes: AutoBuildWall[] = [];
  const slabNodes: AutoBuildSlab[] = [];
  const openingNodes: AutoBuildOpening[] = [];
  const furnitureNodes: AutoBuildFurniture[] = [];

  const edgeMap = new Map<string, { start: [number, number]; end: [number, number]; count: number }>();

  // 1. Phase 1: Flat Colored Space Polygons
  for (let i = 0; i < spaces.length; i++) {
    const sp = spaces[i]!;
    const poly = sp.polygon;
    if (!poly || poly.length < 3) continue;

    const polyCx = Math.round(poly.reduce((s, p) => s + p[0], 0) / poly.length * 1000);
    const polyCy = Math.round(poly.reduce((s, p) => s + p[1], 0) / poly.length * 1000);
    slabNodes.push({
      id: `slab_space_${i + 1}_${polyCx}_${polyCy}`,
      type: 'slab',
      polygon: poly.map(p => [Number(p[0].toFixed(4)), Number(p[1].toFixed(4))]),
      holes: [],
      elevation: 0.005,
      autoFromWalls: false,
      children: [],
      visible: true,
      metadata: {
        name: sp.name || `Room ${i + 1}`,
        color: sp.color || '#4E79A7',
        flatRegion: true,
      },
      dirty: true,
    });

    // Extract Boundary Edges
    for (let k = 0; k < poly.length; k++) {
      const p1 = poly[k]!;
      const p2 = poly[(k + 1) % poly.length]!;
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (len < 0.35) continue; // Skip tiny notches

      const k1 = `${Math.round(p1[0] * 20)},${Math.round(p1[1] * 20)}`;
      const k2 = `${Math.round(p2[0] * 20)},${Math.round(p2[1] * 20)}`;
      const key = k1 < k2 ? `${k1}_${k2}` : `${k2}_${k1}`;

      const existing = edgeMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        edgeMap.set(key, { start: p1, end: p2, count: 1 });
      }
    }
  }

  // Phase 1 Validation Gate Checks
  const roomsExpected = spatialGroundTruth?.roomsExpected ?? spaces.length;
  const roomsDetected = spatialGroundTruth?.roomsDetected ?? spaces.length;
  const roomClosureRate = spatialGroundTruth?.roomClosureRate ?? (roomsExpected > 0 ? (roomsDetected / roomsExpected) * 100 : 0);
  const seedCollisionCount = spatialGroundTruth?.seedCollisionCount ?? 0;
  const spaceOverlapCount = spatialGroundTruth?.spaceOverlapCount ?? 0;
  const largestRoomPercent = spatialGroundTruth?.largestRoomPercent ?? 0;

  // Strict Hard Validation Gates: roomsDetected == roomsExpected, seedCollisionCount == 0, spaceOverlapCount == 0
  const phase1Passed = (roomsDetected === roomsExpected && roomsExpected > 0) &&
                        seedCollisionCount === 0 &&
                        spaceOverlapCount === 0;

  let boundaryCount = 0;
  let partitionsGenerated = 0;
  let unsupportedWallCount = 0;
  let wallsWithoutSpaces = 0;

  // Phase 2: Required Boundaries (ONLY generated if Phase 1 Validation Passes!)
  if (phase1Passed) {
    let wallIdx = 1;
    for (const [edgeKey, edge] of edgeMap) {
      boundaryCount++;
      const wallId = `boundary_space_${wallIdx++}_${edgeKey.replace(/[^a-z0-9]/gi, '_')}`;

      // Color coding: Green = Exterior, Blue = Partition, Yellow = Unresolved
      let boundaryType = 'unresolved';
      let color = '#FFEB3B'; // Yellow = unresolved
      let thickness = 0.08;

      if (edge.count === 2) {
        boundaryType = 'interior_partition';
        color = '#2196F3'; // Blue = partition
        thickness = 0.08;
        partitionsGenerated++;
      } else if (edge.count === 1) {
        boundaryType = 'exterior_boundary';
        color = '#4CAF50'; // Green = exterior wall
        thickness = 0.12;
      } else {
        unsupportedWallCount++;
      }

      wallNodes.push({
        id: wallId,
        type: 'wall',
        start: [Number(edge.start[0].toFixed(4)), Number(edge.start[1].toFixed(4))],
        end: [Number(edge.end[0].toFixed(4)), Number(edge.end[1].toFixed(4))],
        thickness,
        height: diagnosticMode ? 0 : (thickness > 0.35 ? 3.0 : 2.8),
        children: [],
        visible: true,
        metadata: {
          boundaryType,
          color,
          centerlineOnly: true,
          wallType: boundaryType,
        },
        dirty: true,
      });
    }
  } else {
    console.info(`[AutoBuild] Phase 1 Space Validation Failed: roomsDetected(${roomsDetected}) vs expected(${roomsExpected}), seedCollisions(${seedCollisionCount}), largestRoom(${largestRoomPercent}%). Halting before Phase 2 boundary generation.`);
  }

  // Phase 4: Hosted Openings (Doors / Windows)
  let doorsDetected = 0;
  let windowsDetected = 0;
  if (phase1Passed && openings && openings.length > 0) {
    for (let i = 0; i < openings.length; i++) {
      const op = openings[i]!;
      const isDoor = op.class === 'door';
      if (isDoor) doorsDetected++; else windowsDetected++;

      const prefix = isDoor ? 'door' : 'window';
      const opId = op.id && op.id.startsWith(prefix) ? op.id : `${prefix}_${i + 1}_${Date.now()}`;
      const w = op.width || (isDoor ? 0.9 : 1.2);
      const bbox = op.bbox || [0, 0, w, 2.1, 0];

      openingNodes.push({
        id: opId,
        type: isDoor ? 'door' : 'window',
        wallId: op.hostWallId,
        position: [Number((bbox[0] ?? 0).toFixed(4)), 0, Number((bbox[1] ?? 0).toFixed(4))],
        rotation: [0, (bbox[4] ?? 0) * (Math.PI / 180), 0],
        width: Number(w.toFixed(3)),
        height: isDoor ? 2.1 : 1.4,
        doorType: isDoor ? 'hinged' : undefined,
        windowType: !isDoor ? 'fixed' : undefined,
        children: [],
        visible: true,
        metadata: {},
        dirty: true,
      });
    }
  }

  const metrics = {
    roomsDetected,
    roomsExpected,
    roomClosureRate,
    seedCollisionCount,
    spaceOverlapCount,
    largestRoomPercent,
    boundaryCount,
    unsupportedWallCount,
    wallsWithoutSpaces,
    partitionsGenerated,
    doorsDetected,
    windowsDetected,
    phase1Passed,
  };

  return { wallNodes, slabNodes, openingNodes, furnitureNodes, metrics };
}

// ─── Primary 2.5D Auto-Build Engine Pipeline ─────────────────────────────────

export class AutoBuildEngine {
  /**
   * Processes raw vector stream and builds 2.5D scene primitives.
   */
  public static processVectorStream(stream: RawVectorStream): AutoBuildSceneResult {
    const { primitives, wallFaces, openings, spaces, symbols, fileUrl = '/blueprint_guide.pdf' } = stream;

    const wallNodes: AutoBuildWall[] = [];
    const openingNodes: AutoBuildOpening[] = [];
    const slabNodes: AutoBuildSlab[] = [];
    const furnitureNodes: AutoBuildFurniture[] = [];
    let noiseCount = 0;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

    let diagnosticMetrics: Record<string, any> = {};

    // A. Priority 1: Space-Topology Based Extractor (Clean Room Spaces + Deduplicated Wall Edges)
    if (spaces && spaces.length > 0) {
      const spaceRes = extractFromSpaceTopology(
        spaces,
        openings,
        symbols,
        stream.spatialGroundTruth,
        stream.diagnosticMode ?? true,
      );
      wallNodes.push(...spaceRes.wallNodes);
      slabNodes.push(...spaceRes.slabNodes);
      openingNodes.push(...spaceRes.openingNodes);
      furnitureNodes.push(...spaceRes.furnitureNodes);
      diagnosticMetrics = spaceRes.metrics;

      for (const s of spaceRes.slabNodes) {
        for (const pt of s.polygon) {
          minX = Math.min(minX, pt[0]);
          maxX = Math.max(maxX, pt[0]);
          minZ = Math.min(minZ, pt[1]);
          maxZ = Math.max(maxZ, pt[1]);
        }
      }
    } else if (wallFaces && wallFaces.length > 0) {
      // B. Priority 2: Pre-Extracted Parallel Wall Face Pairs
      for (let i = 0; i < wallFaces.length; i++) {
        const w = wallFaces[i]!;
        const p1 = w.points[0];
        const p2 = w.points[1];
        if (p1 && p2) {
          minX = Math.min(minX, p1[0], p2[0]);
          maxX = Math.max(maxX, p1[0], p2[0]);
          minZ = Math.min(minZ, p1[1], p2[1]);
          maxZ = Math.max(maxZ, p1[1], p2[1]);

          wallNodes.push({
            id: w.id || `wall_${i + 1}_${Math.round(p1[0] * 1000)}_${Math.round(p1[1] * 1000)}`,
            type: 'wall',
            start: [Number(p1[0].toFixed(4)), Number(p1[1].toFixed(4))],
            end: [Number(p2[0].toFixed(4)), Number(p2[1].toFixed(4))],
            thickness: Number((w.thickness || 0.15).toFixed(3)),
            height: 2.8,
            children: [],
            visible: true,
            metadata: {},
            dirty: true,
          });
        }
      }

      if (openings && openings.length > 0) {
        for (let i = 0; i < openings.length; i++) {
          const op = openings[i]!;
          const isDoor = op.class === 'door';
          const prefix = isDoor ? 'door' : 'window';
          const opId = op.id && op.id.startsWith(prefix) ? op.id : `${prefix}_${i + 1}_${Math.round((op.bbox?.[0] ?? i) * 1000)}_${Math.round((op.bbox?.[1] ?? i) * 1000)}`;
          const w = op.width || (isDoor ? 0.9 : 1.2);
          const bbox = op.bbox || [0, 0, w, 2.1, 0];
          openingNodes.push({
            id: opId,
            type: isDoor ? 'door' : 'window',
            wallId: op.hostWallId,
            position: [Number((bbox[0] ?? 0).toFixed(4)), isDoor ? 0 : 0.9, Number((bbox[1] ?? 0).toFixed(4))],
            rotation: [0, (bbox[4] ?? 0) * (Math.PI / 180), 0],
            width: Number(w.toFixed(3)),
            height: isDoor ? 2.1 : 1.4,
            doorType: isDoor ? 'hinged' : undefined,
            windowType: !isDoor ? 'fixed' : undefined,
            children: [],
            visible: true,
            metadata: {},
            dirty: true,
          });
        }
      }

      if (spaces && spaces.length > 0) {
        for (let i = 0; i < spaces.length; i++) {
          const sp = spaces[i]!;
          if (sp.polygon && sp.polygon.length >= 3) {
            slabNodes.push({
              id: `slab_space_${i + 1}_${Math.round(sp.polygon[0]?.[0] ?? i * 7) * 1000}_${Math.round(sp.polygon[0]?.[1] ?? i * 11) * 1000}`,
              type: 'slab',
              polygon: sp.polygon.map(p => [Number(p[0].toFixed(4)), Number(p[1].toFixed(4))]),
              holes: [],
              elevation: 0,
              autoFromWalls: false,
              children: [],
              visible: true,
              metadata: { name: sp.name || `Room ${i + 1}` },
              dirty: true,
            });
          }
        }
      }

      if (symbols && symbols.length > 0) {
        for (let i = 0; i < symbols.length; i++) {
          const sym = symbols[i]!;
          const bbox = sym.bbox || [0, 0, 1, 1, 0];
          const info = classifyFurnitureFootprint(bbox[2] ?? 1, bbox[3] ?? 1);
          furnitureNodes.push({
            id: `item_symbol_${i + 1}_${Math.round((bbox[0] ?? i) * 1000)}_${Math.round((bbox[1] ?? i) * 1000)}`,
            type: 'item',
            position: [Number((bbox[0] ?? 0).toFixed(4)), 0, Number((bbox[1] ?? 0).toFixed(4))],
            rotation: [0, (bbox[4] ?? 0) * (Math.PI / 180), 0],
            scale: [Number((bbox[2] ?? 1).toFixed(3)), 1.0, Number((bbox[3] ?? 1).toFixed(3))],
            sku: info.sku,
            children: [],
            visible: true,
            metadata: {},
            dirty: true,
            asset: {
              id: info.sku.toLowerCase(),
              category: info.category,
              name: info.name,
              thumbnail: `/thumbnails/${info.sku.toLowerCase()}.png`,
              src: `/models/${info.sku.toLowerCase()}.glb`,
              dimensions: [bbox[2] || 1, 1.0, bbox[3] || 1],
            },
          });
        }
      }
    } else {
      // B. Raw Vector Stream Noise Filtering & Spatial Fallback Engine
      const docW = stream.pageWidth || 20;
      const docH = stream.pageHeight || 20;

      const structuralPrimitives: VectorPrimitive[] = [];
      const assetPrimitives: VectorPrimitive[] = [];

      for (const prim of primitives) {
        if (prim.type === 'text' || prim.text) {
          noiseCount++;
          continue;
        }

        if (prim.points) {
          let isMarginNoise = false;
          for (const pt of prim.points) {
            minX = Math.min(minX, pt[0]);
            maxX = Math.max(maxX, pt[0]);
            minZ = Math.min(minZ, pt[1]);
            maxZ = Math.max(maxZ, pt[1]);

            // Outer 1.5% page border filter
            if (
              pt[0] < docW * 0.015 ||
              pt[0] > docW * 0.985 ||
              pt[1] < docH * 0.015 ||
              pt[1] > docH * 0.985
            ) {
              isMarginNoise = true;
              break;
            }
          }
          if (isMarginNoise) {
            noiseCount++;
            continue;
          }
        }

        const layerUpper = (prim.layer || '').toUpperCase();

        // Discard text, annotation, title block, and grid layers
        if (
          layerUpper.includes('TEXT') ||
          layerUpper.includes('DIM') ||
          layerUpper.includes('ANNO') ||
          layerUpper.includes('TITLE') ||
          layerUpper.includes('BORDER') ||
          layerUpper.includes('GRID')
        ) {
          noiseCount++;
          continue;
        }

        const isExplicitWall = layerUpper.includes('WALL') || layerUpper.includes('STR') || layerUpper.includes('CONC');
        const isExplicitFurn = layerUpper.includes('FURN') || layerUpper.includes('ITEM') || layerUpper.includes('EQUIP');

        if (isExplicitWall) {
          structuralPrimitives.push(prim);
        } else if (isExplicitFurn) {
          assetPrimitives.push(prim);
        } else {
          // Only include unclassified paths if long enough to be structural lines (> 0.40m)
          if (prim.points && prim.points.length >= 2) {
            const p1 = prim.points[0]!;
            const p2 = prim.points[prim.points.length - 1]!;
            const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
            if (len >= 0.40) {
              structuralPrimitives.push(prim);
              if (prim.points.length >= 3) assetPrimitives.push(prim);
            } else {
              noiseCount++;
            }
          }
        }
      }

      const wallLines: LineSegment[] = [];
      const rasterWallLines: LineSegment[] = [];

      for (const prim of structuralPrimitives) {
        if (prim.points && prim.points.length >= 2) {
          const isRaster = (prim.layer || '').toUpperCase() === 'WALL';
          for (let k = 0; k < prim.points.length - 1; k++) {
            const p1 = prim.points[k]!;
            const p2 = prim.points[k + 1]!;
            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const length = Math.hypot(dx, dy);
            if (length < 0.10) continue; // min 0.10m (doorstep width)

            const seg: LineSegment = {
              p1, p2, length,
              angle: getSlopeAngle(p1, p2),
              dx, dy,
              layer: prim.layer || 'UNCLASSIFIED',
              thickness: (prim as any).thickness,
              wallType: (prim as any).wallType,
            };
            if (isRaster) {
              rasterWallLines.push(seg);
            } else {
              wallLines.push(seg);
            }
          }
        }
      }

      // ── Raster Wall Deduplication ────────────────────────────────────────────────
      // Raster scanning at 1px step produces the inner + outer edge of each thick wall
      // as two parallel lines ~wall-thickness apart. Merge pairs within 0.12m axis offset
      // into a single centered WallNode to avoid double-extruded walls.
      const dedupedRaster: LineSegment[] = [];
      const usedR = new Set<number>();
      for (let ri = 0; ri < rasterWallLines.length; ri++) {
        if (usedR.has(ri)) continue;
        const s1 = rasterWallLines[ri]!;
        let merged = false;
        for (let rj = ri + 1; rj < rasterWallLines.length; rj++) {
          if (usedR.has(rj)) continue;
          const s2 = rasterWallLines[rj]!;
          const angDiff = Math.abs(s1.angle - s2.angle);
          const isParallel = angDiff < 0.087 || Math.abs(angDiff - Math.PI) < 0.087;
          if (!isParallel) continue;
          const d1 = perpendicularDistance(s2.p1, s1);
          const d2 = perpendicularDistance(s2.p2, s1);
          const avgD = (d1 + d2) / 2;
          if (avgD > 0 && avgD < 0.12) {
            // Synthesize midpoint centerline
            dedupedRaster.push({
              p1: [(s1.p1[0] + s2.p1[0]) / 2, (s1.p1[1] + s2.p1[1]) / 2],
              p2: [(s1.p2[0] + s2.p2[0]) / 2, (s1.p2[1] + s2.p2[1]) / 2],
              length: s1.length,
              angle: s1.angle,
              dx: s1.dx,
              dy: s1.dy,
              layer: 'WALL',
              thickness: s1.thickness,
              wallType: s1.wallType,
            });
            usedR.add(ri); usedR.add(rj);
            merged = true;
            break;
          }
        }
        if (!merged) dedupedRaster.push(s1);
        usedR.add(ri);
      }

      // Direct centerline extrusion for raster-scanned walls
      for (const seg of dedupedRaster) {
        const isPartition = seg.wallType === 'interior_partition' || (seg.layer || '').toUpperCase().includes('PRTN') || (seg.thickness && seg.thickness <= 0.12);
        const thickness = seg.thickness || (isPartition ? 0.10 : 0.25);
        wallNodes.push({
          id: `wall_${wallNodes.length + 1}_${Date.now()}`,
          type: 'wall',
          start: [Number(seg.p1[0].toFixed(4)), Number(seg.p1[1].toFixed(4))],
          end: [Number(seg.p2[0].toFixed(4)), Number(seg.p2[1].toFixed(4))],
          thickness,
          height: 2.8,
          children: [],
          visible: true,
          metadata: { wallType: seg.wallType || (isPartition ? 'interior_partition' : 'structural_concrete') },
          dirty: true,
        });
      }

      // Paired face collapse for vector/CAD primitives
      const collapsed = collapseParallelWallPaths(wallLines);
      wallNodes.push(...collapsed);

      // ── Outlier Wall Suppression ────────────────────────────────────────────
      // Remove walls whose midpoint is > 2.5m from the median wall midpoint cluster.
      // This eliminates isolated title block box outlines that sneak through zone detection.
      if (wallNodes.length > 4) {
        const mids = wallNodes.map(w => [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2] as [number, number]);
        const sortedX = mids.map(m => m[0]).sort((a, b) => a - b);
        const sortedZ = mids.map(m => m[1]).sort((a, b) => a - b);
        const medX = sortedX[Math.floor(sortedX.length / 2)]!;
        const medZ = sortedZ[Math.floor(sortedZ.length / 2)]!;
        const maxOutlierDist = Math.max(docW, docH) * 0.45; // 45% of drawing size
        const filtered = wallNodes.filter((w, i) => {
          const mid = mids[i]!;
          return Math.hypot(mid[0] - medX, mid[1] - medZ) <= maxOutlierDist;
        });
        // Only apply filter if it doesn't remove too many walls (safety check)
        if (filtered.length >= wallNodes.length * 0.5) {
          wallNodes.length = 0;
          wallNodes.push(...filtered);
        }
      }

      // Floor Slab generation from closed wall loops
      const wallPoints: Array<[number, number]> = [];
      for (const w of wallNodes) wallPoints.push(w.start, w.end);
      const simplifiedWallLoop = simplifyPolyline(wallPoints, 0.1);
      if (isClosedLoop(simplifiedWallLoop)) {
        slabNodes.push({
          id: `slab_auto_${Date.now()}`,
          type: 'slab',
          polygon: simplifiedWallLoop,
          holes: [],
          elevation: 0,
          autoFromWalls: true,
          children: [],
          visible: true,
          metadata: {},
          dirty: true,
        });
      }

      // Furniture classification from closed asset loops
      for (const prim of assetPrimitives) {
        if (!prim.points || prim.points.length < 3 || !isClosedLoop(prim.points)) {
          noiseCount++;
          continue;
        }
        const area = calculatePolygonArea(prim.points);
        if (area < 0.35 || area > 6.0) {
          noiseCount++;
          continue;
        }

        const obb = computeOrientedBoundingBox(prim.points);
        const info = classifyFurnitureFootprint(obb.width, obb.length);
        furnitureNodes.push({
          id: `item_auto_${furnitureNodes.length + 1}_${Date.now()}`,
          type: 'item',
          position: [obb.center[0], 0, obb.center[1]],
          rotation: [0, obb.rotation, 0],
          scale: [obb.length, 1.0, obb.width],
          sku: info.sku,
          children: [],
          visible: true,
          metadata: {},
          dirty: true,
          asset: {
            id: info.sku.toLowerCase(),
            category: info.category,
            name: info.name,
            thumbnail: `/thumbnails/${info.sku.toLowerCase()}.png`,
            src: `/models/${info.sku.toLowerCase()}.glb`,
            dimensions: [obb.length, 1.0, obb.width],
          },
        });
      }
    }

    const computedW = isFinite(maxX - minX) && (maxX - minX) > 0 ? (maxX - minX) : 20;
    const computedH = isFinite(maxZ - minZ) && (maxZ - minZ) > 0 ? (maxZ - minZ) : 20;
    const guideW = stream.pageWidth || computedW;
    const guideH = stream.pageHeight || computedH;
    const centerX = guideW / 2;
    const centerZ = guideH / 2;

    // Native Ground Blueprint Guide Node Creation (1:1 World Origin Alignment)
    const guideNode: AutoBuildGuide = {
      id: `guide_${Math.round(guideW * 1000)}_${Math.round(guideH * 1000)}`,
      type: 'guide',
      url: fileUrl,
      position: [centerX, 0.002, centerZ],
      rotation: [0, 0, 0],
      scale: 1.0,
      opacity: 60,
      children: [],
      visible: true,
      metadata: {
        guideWidth: guideW,
        guideDepth: guideH,
        opacityUnit: 'percent',
        extractionVersion: 'geometry-v2',
      },
    };

    // Architectural-shell extraction mode: never infer furniture from geometry alone.
    furnitureNodes.length = 0;

    // ─── Breakthrough Guide-Trace Pathway (additive, highest-priority override) ───
    // If a maximal-line guide trace graph was supplied, the planar face-traversal / graph
    // validation path is authoritative and replaces the unordered wall-endpoint slab logic above.
    if (stream.guideTrace) {
      const trace = integrateGuideTrace({
        guideTrace: stream.guideTrace,
        graphFaces: stream.graphFaces,
        roomSeeds: stream.roomSeeds ?? [],
        diagnosticMode: stream.diagnosticMode ?? true,
        allowProductionExtrusion: stream.allowProductionExtrusion ?? false,
      });
      return {
        guideNode,
        wallNodes: trace.wallNodes,
        openingNodes: trace.openingNodes,
        slabNodes: trace.slabNodes,
        furnitureNodes: [],
        metadata: {
          totalPrimitives: primitives ? primitives.length : 0,
          filteredNoiseCount: noiseCount,
          collapsedWallCount: trace.wallNodes.length,
          extractedFurnitureCount: 0,
          pipeline: 'guide-trace-graph',
          traceDiagnostics: trace.diagnostics as unknown as Record<string, unknown>,
          traceDebugData: trace.debugData as unknown as Record<string, unknown>,
          topologyReady: trace.diagnostics.topologyReady,
          productionReady: trace.diagnostics.productionReady,
          validationPassed: trace.validation.passed,
        },
      };
    }

    return {
      guideNode,
      wallNodes,
      openingNodes,
      slabNodes,
      furnitureNodes,
      metadata: {
        totalPrimitives: primitives ? primitives.length : 0,
        filteredNoiseCount: noiseCount,
        collapsedWallCount: wallNodes.length,
        extractedFurnitureCount: furnitureNodes.length,
        ...diagnosticMetrics,
      },
    };
  }

  /**
   * Legacy Engine Delegation (REFERENCE ONLY):
   * Sidelined geometric double-line path consolidation utility.
   */
  public static runLegacyV10Diagnostic(primitives: VectorPrimitive[]) {
    console.warn('[Legacy Engine] Diagnostic mode invoked (sidelined from core auto-build pipeline).');
    return { status: 'diagnostic_only', primitiveCount: primitives.length };
  }
}
