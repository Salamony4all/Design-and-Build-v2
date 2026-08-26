import type { IngestionResult, VectorPrimitive, DetectedSymbol } from './router';

// ─── Schema Interfaces ───────────────────────────────────────────────────────

export interface WallPrimitive {
  id: string;
  points: [[number, number], [number, number]];
  thickness: number;
  height: number;
  curveOffset?: number;
  status?: 'pending_manual_validation' | 'validated';
}

export interface ColumnPrimitive {
  id: string;
  position: [number, number];
  radius?: number;
  height: number;
  status?: 'pending_manual_validation' | 'validated';
}

export interface FixedFixturePrimitive {
  id: string;
  path: Array<[number, number]>;
  type: string;
  status?: 'pending_manual_validation' | 'validated';
}

export interface LooseFurniturePrimitive {
  id: string;
  sku: string;
  position: [number, number];
  rotation: number;
  status?: 'pending_manual_validation' | 'validated';
}

export interface LegacyPascalPayload {
  core: {
    slabs: any[];
    ceilings: any[];
    zones?: any[];
  };
  shell: {
    walls: WallPrimitive[];
    columns: ColumnPrimitive[];
    openings: any[];
  };
  joinery: {
    fixedFixtures: FixedFixturePrimitive[];
  };
  ffe: {
    looseFurniture: LooseFurniturePrimitive[];
  };
  semanticBim?: any;
  diagnostics?: any;
}

// ─── Ramer-Douglas-Peucker (RDP) Polyline Simplification ───────────────────

function getSqSegDist(p: [number, number], p1: [number, number], p2: [number, number]): number {
  let x = p1[0];
  let y = p1[1];
  let dx = p2[0] - x;
  let dy = p2[1] - y;

  const lenSq = dx * dx + dy * dy;
  if (lenSq > 1e-6) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / lenSq;
    if (t > 1) {
      x = p2[0];
      y = p2[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/**
 * Simplifies a polyline by reducing points based on distance thresholds.
 */
export function simplifyPolyline(points: Array<[number, number]>, epsilon: number): Array<[number, number]> {
  if (points.length <= 2) return points;

  let maxSqDist = 0;
  let index = 0;
  const end = points.length - 1;

  const pStart = points[0]!;
  const pEnd = points[end]!;

  for (let i = 1; i < end; i++) {
    const pI = points[i]!;
    const sqDist = getSqSegDist(pI, pStart, pEnd);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }

  if (maxSqDist > epsilon * epsilon) {
    const results1 = simplifyPolyline(points.slice(0, index + 1), epsilon);
    const results2 = simplifyPolyline(points.slice(index), epsilon);
    return results1.slice(0, results1.length - 1).concat(results2);
  }

  return [pStart, pEnd];
}

// ─── Cross-Reference Spatial Compiler ────────────────────────────────────────

export class CrossReferenceCompiler {
  /**
   * Aligns horizontal grids (X, Y) with vertical sections to resolve heights.
   */
  public alignGridAndLevels(
    horizontalIntersections: Array<[number, number]>,
    verticalSections: Array<{ gridRef: string; elevation: number }>
  ): { ffl: number; ceilingHeight: number } {
    // Standard alignment coordinates: matching drawing references
    let baseElevation = 0.0;
    let ceilingElevation = 2.8;

    // Align vertical levels from drawing sheets
    const levelSection = verticalSections.find(s => s.gridRef === 'FFL' || s.gridRef === '1FL');
    if (levelSection) {
      baseElevation = levelSection.elevation;
    }

    const ceilingSection = verticalSections.find(s => s.gridRef === 'CEILING' || s.gridRef === 'CLG');
    if (ceilingSection) {
      ceilingElevation = ceilingSection.elevation;
    }

    return {
      ffl: baseElevation,
      ceilingHeight: Math.round((ceilingElevation - baseElevation) * 1000) / 1000
    };
  }

  /**
   * Compile raw primitives into Pascal Payload, applying FFL alignment,
   * curve simplification, and confidence checking.
   */
  public compile(
    ingestResult: IngestionResult,
    gridAlignment?: { ffl: number; ceilingHeight: number },
    aiShellData?: any,
    aiCoreData?: any
  ): LegacyPascalPayload {
    const ffl = gridAlignment?.ffl ?? 0.0;
    const height = gridAlignment?.ceilingHeight ?? 2.8;
    const pageWidth = ingestResult.pageWidth || 1000;
    const pageHeight = ingestResult.pageHeight || 800;
    const ppm = ingestResult.pointsPerMeter || 50.0;

    // Filter out abnormally large symbols (YOLO hallucinations) from all checks and loops
    if (ingestResult.detectedSymbols) {
      ingestResult.detectedSymbols = ingestResult.detectedSymbols.filter(sym => {
        const [x, y, w, d] = sym.bbox;
        return w <= 4.0 && d <= 4.0;
      });
    }

    // --- STAGE 3: OCR Semantics ---
    const ocrKeywords: string[] = [];
    if (ingestResult.track === 'vector') {
      ingestResult.vectorPrimitives.forEach(p => {
        if (p.type === 'text' && p.text) {
          ocrKeywords.push(p.text.toLowerCase());
        }
      });
    }
    const hasDormitoryOcr = ocrKeywords.some(kw => kw.includes('dormitory') || kw.includes('6 bed') || kw.includes('bed unit'));
    const hasBedOcr = ocrKeywords.some(kw => kw.includes('bed'));

    // --- STAGE 2: Object Recognition & Prioritization ---
    const detectedFurniture = ingestResult.detectedSymbols || [];
    const isFurnitureInRect = (x: number, y: number, buffer: number = 0.5) => {
      return detectedFurniture.some(sym => {
        // Only check actual furniture classes for proximity checks (exclude windows, doors, stairs, columns)
        const isFurn = ['chair', 'desk', 'sofa', 'table', 'bed', 'single-bed', 'double-bed', 'bedside-table', 'side-table', 'couch-medium', 'closet', 'cabinet', 'locker'].includes(sym.class);
        if (!isFurn) return false;

        const [fx, fy, fw, fd] = sym.bbox;
        return x >= fx - fw/2 - buffer && x <= fx + fw/2 + buffer &&
               y >= fy - fd/2 - buffer && y <= fy + fd/2 + buffer;
      });
    };

    // --- STAGE 4: Repetition & Special Pascal Rule ---
    let isDormitoryLayout = hasDormitoryOcr;
    const beds = detectedFurniture.filter(sym => ['bed', 'single-bed', 'double-bed'].includes(sym.class));
    if (beds.length >= 3) {
      // Check X alignment
      const sortedByX = [...beds].sort((a, b) => a.bbox[0] - b.bbox[0]);
      let xAlignedCount = 1;
      let lastX = sortedByX[0]!.bbox[0];
      for (let i = 1; i < sortedByX.length; i++) {
        const diffX = sortedByX[i]!.bbox[0] - lastX;
        if (diffX >= 1.5 && diffX <= 2.2) { // ~1.8m spacing
          xAlignedCount++;
        }
        lastX = sortedByX[i]!.bbox[0];
      }

      // Check Y alignment
      const sortedByY = [...beds].sort((a, b) => a.bbox[1] - b.bbox[1]);
      let yAlignedCount = 1;
      let lastY = sortedByY[0]!.bbox[1];
      for (let i = 1; i < sortedByY.length; i++) {
        const diffY = sortedByY[i]!.bbox[1] - lastY;
        if (diffY >= 1.5 && diffY <= 2.2) { // ~1.8m spacing
          yAlignedCount++;
        }
        lastY = sortedByY[i]!.bbox[1];
      }

      if (xAlignedCount >= 3 || yAlignedCount >= 3 || hasBedOcr) {
        isDormitoryLayout = true;
      }
    }

    const roomType = isDormitoryLayout ? "Dormitory" : "Standard Layout";

    // Resolve slabs first
    const slabs = (aiShellData && aiShellData.floors && aiShellData.floors.length > 0)
      ? aiShellData.floors.map((f: any, idx: number) => ({
          id: f.id || `slab_${idx}`,
          boundary: f.boundary,
          level: f.level ?? ffl
        }))
      : (ingestResult.track === 'vector' && ingestResult.vectorPrimitives.some(p => p.layer === 'A-SLAB' || p.layer === 'I-SLAB'))
        ? ingestResult.vectorPrimitives
            .filter(p => (p.layer === 'A-SLAB' || p.layer === 'I-SLAB') && p.points && p.points.length > 2)
            .map((p, idx) => ({
              id: `slab_vector_${idx}`,
              boundary: p.points,
              level: ffl
            }))
        : [{
            id: 'slab_base_01',
            boundary: [[0.0, 0.0], [pageWidth / ppm, 0.0], [pageWidth / ppm, pageHeight / ppm], [0.0, pageHeight / ppm]],
            level: ffl
          }];

    if (slabs.length === 0) {
      slabs.push({
        id: 'slab_base_01',
        boundary: [[0.0, 0.0], [pageWidth / ppm, 0.0], [pageWidth / ppm, pageHeight / ppm], [0.0, pageHeight / ppm]],
        level: ffl
      });
    }

    // Calculate slab bounding box
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    slabs.forEach((slab: any) => {
      slab.boundary.forEach((pt: any) => {
        if (pt[0] < minX) minX = pt[0];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[1] > maxY) maxY = pt[1];
      });
    });

    const hasRealSlab = minX !== Infinity && slabs[0]?.id !== 'slab_base_01';
    const pad = 2.5; 
    const bbox = {
      minX: minX - pad,
      maxX: maxX + pad,
      minY: minY - pad,
      maxY: maxY + pad
    };

    // --- STAGE 1: Wall Candidate Generation ---
    const rawWalls: any[] = [];
    const columns: ColumnPrimitive[] = [];
    const fixedFixtures: FixedFixturePrimitive[] = [];
    const looseFurniture: LooseFurniturePrimitive[] = [];

    const confidenceThreshold = 0.85;

    if (ingestResult.track === 'vector') {
      ingestResult.vectorPrimitives.forEach((prim, idx) => {
        if (prim.layer === 'A-WALL' || prim.layer === 'I-WALL') {
          if (prim.type === 'line' && prim.points) {
            const p1 = prim.points[0]!;
            const p2 = prim.points[1]!;
            const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
            if (len < 0.5) return;

            if (hasRealSlab) {
              const isInside = (p1[0] >= bbox.minX && p1[0] <= bbox.maxX && p1[1] >= bbox.minY && p1[1] <= bbox.maxY) ||
                               (p2[0] >= bbox.minX && p2[0] <= bbox.maxX && p2[1] >= bbox.minY && p2[1] <= bbox.maxY);
              if (!isInside) return;
            }

            let confidence = prim.confidence || 0.9;
            const evidence: string[] = ["vector_layer"];

            // Global grid alignment check (orthogonal walls)
            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
            const isOrthogonal = angle < 5 || angle > 175 || (angle > 85 && angle < 95);
            if (isOrthogonal) {
              confidence += 0.05;
              evidence.push("orthogonal_grid");
            }

            rawWalls.push({
              id: `wall_${idx}`,
              points: [p1, p2],
              thickness: prim.layer === 'A-WALL' ? 0.25 : 0.15,
              height: height,
              confidence,
              evidence,
              source: "vector" as const
            });
          } else if (prim.type === 'curve' && prim.points) {
            const controlPoints = prim.controlPoints || prim.points;
            const simplified = simplifyPolyline(controlPoints, 0.05);
            
            const p1 = prim.points[0]!;
            const p2 = prim.points[1]!;
            const curveOffset = controlPoints.length > 2 
              ? Math.sqrt(getSqSegDist(controlPoints[Math.floor(controlPoints.length / 2)]!, p1, p2)) 
              : 0.1;

            if (hasRealSlab) {
              const isInside = (p1[0] >= bbox.minX && p1[0] <= bbox.maxX && p1[1] >= bbox.minY && p1[1] <= bbox.maxY) ||
                               (p2[0] >= bbox.minX && p2[0] <= bbox.maxX && p2[1] >= bbox.minY && p2[1] <= bbox.maxY);
              if (!isInside) return;
            }

            rawWalls.push({
              id: `wall_${idx}`,
              points: [p1, p2],
              thickness: 0.15,
              height: height,
              curveOffset,
              confidence: prim.confidence || 0.85,
              evidence: ["vector_curve"],
              source: "vector" as const
            });
          }
        } else if (prim.type === 'text' && prim.text && prim.position) {
          const textLower = prim.text.toLowerCase();
          const pos = prim.position;

          if (hasRealSlab) {
            const isInside = pos[0] >= bbox.minX && pos[0] <= bbox.maxX && pos[1] >= bbox.minY && pos[1] <= bbox.maxY;
            if (!isInside) return;
          }

          const status = prim.confidence < confidenceThreshold ? 'pending_manual_validation' : undefined;

          if (textLower.includes('chair')) {
            looseFurniture.push({
              id: `furniture_text_${idx}`,
              sku: 'sku-chair',
              position: pos,
              rotation: 0,
              status
            });
          } else if (textLower.includes('desk')) {
            looseFurniture.push({
              id: `furniture_text_${idx}`,
              sku: 'sku-desk',
              position: pos,
              rotation: 0,
              status
            });
          } else if (textLower.includes('bed')) {
            looseFurniture.push({
              id: `furniture_text_${idx}`,
              sku: 'sku-bed',
              position: pos,
              rotation: 0,
              status
            });
          } else if (textLower.includes('sofa') || textLower.includes('couch')) {
            looseFurniture.push({
              id: `furniture_text_${idx}`,
              sku: 'sku-sofa',
              position: pos,
              rotation: 0,
              status
            });
          } else if (textLower.includes('table')) {
            looseFurniture.push({
              id: `furniture_text_${idx}`,
              sku: 'sku-table',
              position: pos,
              rotation: 0,
              status
            });
          } else if (textLower.includes('cabinet') || textLower.includes('locker') || textLower.includes('wardrobe') || textLower.includes('cupboard') || textLower.includes('closet')) {
            looseFurniture.push({
              id: `furniture_text_${idx}`,
              sku: 'sku-closet',
              position: pos,
              rotation: 0,
              status
            });
          } else if (textLower.includes('toilet')) {
            fixedFixtures.push({
              id: `joinery_text_${idx}`,
              type: 'toilet',
              path: [
                [pos[0] - 0.25, pos[1] - 0.35],
                [pos[0] + 0.25, pos[1] - 0.35],
                [pos[0] + 0.25, pos[1] + 0.35],
                [pos[0] - 0.25, pos[1] + 0.35]
              ],
              status
            });
          } else if (textLower.includes('sink')) {
            fixedFixtures.push({
              id: `joinery_text_${idx}`,
              type: 'sink-cabinet',
              path: [
                [pos[0] - 0.3, pos[1] - 0.3],
                [pos[0] + 0.3, pos[1] - 0.3],
                [pos[0] + 0.3, pos[1] + 0.3],
                [pos[0] - 0.3, pos[1] + 0.3]
              ],
              status
            });
          }
        }
      });

      if (ingestResult.detectedSymbols) {
        ingestResult.detectedSymbols.forEach((sym, idx) => {
          const isLowConfidence = sym.confidence < confidenceThreshold;
          const status = isLowConfidence ? 'pending_manual_validation' : undefined;
          const [x, y, w, d, angle] = sym.bbox;

          if (hasRealSlab) {
            if (x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY) return;
          }

          if (sym.class === 'column' || sym.class === 'pillar') {
            columns.push({
              id: `column_vector_${idx}`,
              position: [x, y],
              radius: w / 2,
              height: height,
              status
            });
          } else if (['chair', 'desk', 'sofa', 'table', 'bed', 'single-bed', 'double-bed', 'bedside-table', 'side-table', 'couch-medium', 'closet', 'cabinet', 'locker'].includes(sym.class)) {
            looseFurniture.push({
              id: `furniture_vector_${idx}`,
              sku: `PASCAL-SKU-${sym.class.toUpperCase()}`,
              position: [x, y] as [number, number],
              rotation: angle,
              status
            });
          } else {
            fixedFixtures.push({
              id: `joinery_vector_${idx}`,
              type: sym.class,
              path: [
                [x - w / 2, y - d / 2],
                [x + w / 2, y - d / 2],
                [x + w / 2, y + d / 2],
                [x - w / 2, y + d / 2]
              ],
              status
            });
          }
        });
      }
    } else {
      // Raster Track
      const rasterWalls = (aiCoreData && aiCoreData.walls) ? aiCoreData.walls : (ingestResult.rasterWalls || []);

      rasterWalls.forEach((w: any, idx: number) => {
        const p1 = w.start;
        const p2 = w.end;
        if (hasRealSlab) {
          const isInside = (p1[0] >= bbox.minX && p1[0] <= bbox.maxX && p1[1] >= bbox.minY && p1[1] <= bbox.maxY) ||
                           (p2[0] >= bbox.minX && p2[0] <= bbox.maxX && p2[1] >= bbox.minY && p2[1] <= bbox.maxY);
          if (!isInside) return;
        }

        let confidence = w.confidence || 0.8;
        const evidence: string[] = ["raster_detection"];

        // Global grid alignment check (orthogonal)
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
        const isOrthogonal = angle < 5 || angle > 175 || (angle > 85 && angle < 95);
        if (isOrthogonal) {
          confidence += 0.05;
          evidence.push("orthogonal_grid");
        }

        rawWalls.push({
          id: w.id || `wall_raster_${idx}`,
          points: [p1, p2],
          thickness: w.thickness || 0.2,
          height: w.height || height,
          confidence,
          evidence,
          source: "raster" as const
        });
      });

      ingestResult.detectedSymbols.forEach((sym, idx) => {
        const isLowConfidence = sym.confidence < confidenceThreshold;
        const status = isLowConfidence ? 'pending_manual_validation' : undefined;
        const [x, y, w, d, angle] = sym.bbox;

        if (hasRealSlab) {
          if (x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY) return;
        }

        if (sym.class === 'column' || sym.class === 'pillar') {
          columns.push({
            id: `col_${idx}`,
            position: [x, y],
            radius: w / 2,
            height: height,
            status
          });
        } else if (['chair', 'desk', 'sofa', 'table', 'bed', 'single-bed', 'double-bed', 'bedside-table', 'side-table', 'couch-medium', 'closet', 'cabinet', 'locker'].includes(sym.class)) {
          looseFurniture.push({
            id: `ffe_${idx}`,
            sku: `PASCAL-SKU-${sym.class.toUpperCase()}`,
            position: [x, y],
            rotation: angle,
            status
          });
        } else {
          fixedFixtures.push({
            id: `joinery_${idx}`,
            type: sym.class,
            path: [
              [x - w / 2, y - d / 2],
              [x + w / 2, y - d / 2],
              [x + w / 2, y + d / 2],
              [x - w / 2, y + d / 2]
            ],
            status
          });
        }
      });
    }

    // --- STAGE 1 (cont): Evaluate Wall Candidate Connections & Penalties ---
    const evaluatedWalls: any[] = [];
    rawWalls.forEach(wall => {
      const p1 = wall.points[0];
      const p2 = wall.points[1];
      const midX = (p1[0] + p2[0]) / 2;
      const midY = (p1[1] + p2[1]) / 2;
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);

      let conf = wall.confidence;

      // 1. Connection check: is either endpoint connected to other walls?
      let hasConnections = false;
      let connCount = 0;
      rawWalls.forEach(other => {
        if (other.id === wall.id) return;
        const op1 = other.points[0];
        const op2 = other.points[1];
        const connects = Math.hypot(p1[0] - op1[0], p1[1] - op1[1]) < 0.15 ||
                         Math.hypot(p1[0] - op2[0], p1[1] - op2[1]) < 0.15 ||
                         Math.hypot(p2[0] - op1[0], p2[1] - op1[1]) < 0.15 ||
                         Math.hypot(p2[0] - op2[0], p2[1] - op2[1]) < 0.15;
        if (connects) {
          hasConnections = true;
          connCount++;
        }
      });

      if (hasConnections) {
        conf += 0.05 * Math.min(3, connCount);
        wall.evidence.push(`connected_to_walls_${connCount}`);
      } else {
        // Floating line penalty
        conf -= 0.20;
        wall.evidence.push("floating_line");
      }

      // 2. Isolated short segment penalty
      if (len < 0.8 && !hasConnections) {
        conf -= 0.15;
        wall.evidence.push("isolated_short_segment");
      }

      // 3. Dense furniture cluster wall suppression (Stage 2)
      const insideCluster = isFurnitureInRect(midX, midY, 0.4);
      if (insideCluster) {
        conf -= 0.25;
        wall.evidence.push("inside_furniture_cluster");
      }

      // 4. Special Pascal Rule (Stage 4)
      if (isDormitoryLayout) {
        const isThin = wall.thickness < 0.12;
        const isShort = len < 2.0;
        const isNearBed = isFurnitureInRect(midX, midY, 0.8);
        if (isThin || (isShort && isNearBed)) {
          conf -= 0.35;
          wall.evidence.push("dormitory_divider_candidate");
        }
      }

      wall.confidence = Math.max(0.0, Math.min(1.0, conf));
      evaluatedWalls.push(wall);
    });

    // --- STAGE 9: Scene Graph Safety ---
    const safeWalls = evaluatedWalls.filter(w => {
      return w.confidence >= 0.50;
    }).map(w => {
      const isUncertain = w.confidence < 0.90;
      return {
        ...w,
        status: isUncertain ? 'pending_manual_validation' as const : undefined
      };
    });

    // --- STAGE 5: Wall Cluster Cleanup ---
    const consolidatedWalls = consolidateDoubleWalls(safeWalls);

    // Heuristic Wall Healing & Lintel Logic
    const { healedWalls, openings } = healWallsAndExtractOpenings(consolidatedWalls);

    // Filter abnormally long segments
    const finalWalls = healedWalls.filter((w: any) => {
      const p1 = w.points[0];
      const p2 = w.points[1];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      return len <= 18.0;
    });

    // --- STAGE 6: Room Reasoning (BIM Sanity Validation) ---
    const reasonableWalls = finalWalls.filter((w: any) => {
      if (isDormitoryLayout) {
        const p1 = w.points[0];
        const p2 = w.points[1];
        const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        
        const isInternalShort = len < 3.0 && w.thickness < 0.2;
        if (isInternalShort) {
          const midX = (p1[0] + p2[0]) / 2;
          const midY = (p1[1] + p2[1]) / 2;
          if (isFurnitureInRect(midX, midY, 1.2)) {
            return false;
          }
        }
      }
      return true;
    });

    // Ceilings and Zones
    const ceilings = (aiShellData && aiShellData.ceilings && aiShellData.ceilings.length > 0)
      ? aiShellData.ceilings.map((c: any, idx: number) => ({
          id: c.id || `ceiling_${idx}`,
          boundary: c.boundary,
          level: c.level ?? ffl,
          height: c.height ?? height
        }))
      : [{
          id: 'ceiling_base_01',
          boundary: [[0.0, 0.0], [pageWidth / ppm, 0.0], [pageWidth / ppm, pageHeight / ppm], [0.0, pageHeight / ppm]],
          level: ffl,
          height: height
        }];

    const zones = (aiShellData && aiShellData.zones) ? aiShellData.zones : [];

    // --- STAGE 7: Phase Classification ---
    const shellWalls = reasonableWalls.filter((w: any) => w.thickness >= 0.18);
    const corePartitions = reasonableWalls.filter((w: any) => w.thickness < 0.18);

    const legacyPayload: LegacyPascalPayload = {
      core: { slabs, ceilings, zones },
      shell: { walls: reasonableWalls, columns, openings },
      joinery: { fixedFixtures },
      ffe: { looseFurniture }
    };

    // --- STAGE 10: Output Format (Semantic BIM + Diagnostics) ---
    const semanticBim = {
      shell: {
        walls: shellWalls
      },
      core: {
        partitions: corePartitions
      },
      joinery: {
        doors: openings.filter((o: any) => o.type === 'door'),
        windows: openings.filter((o: any) => o.type === 'window'),
        wardrobes: fixedFixtures.filter((f: any) => f.type === 'closet' || f.type === 'locker' || f.type === 'wardrobe')
      },
      ffe: {
        beds: looseFurniture.filter((f: any) => f.sku.toLowerCase().includes('bed')),
        tables: looseFurniture.filter((f: any) => f.sku.toLowerCase().includes('table') || f.sku.toLowerCase().includes('desk')),
        chairs: looseFurniture.filter((f: any) => f.sku.toLowerCase().includes('chair'))
      },
      diagnostics: {
        roomType,
        confidence: ingestResult.confidence,
        warnings: isDormitoryLayout ? ["Dormitory rule applied: suppressed potential thin privacy dividers/curtains from becoming walls."] : []
      }
    };

    return {
      ...legacyPayload,
      semanticBim,
      diagnostics: semanticBim.diagnostics
    };
  }
}

function consolidateDoubleWalls(walls: any[]): any[] {
  const consolidatedWalls: any[] = [];
  const mergedIndices = new Set<number>();

  for (let i = 0; i < walls.length; i++) {
    if (mergedIndices.has(i)) continue;

    const w1 = walls[i]!;
    if (!w1 || !w1.points || w1.points.length < 2) continue;

    const p1a = w1.points[0] as [number, number];
    const p1b = w1.points[1] as [number, number];
    if (!p1a || !p1b) continue;

    const [p1ax, p1ay] = p1a;
    const [p1bx, p1by] = p1b;

    const v1: [number, number] = [p1bx - p1ax, p1by - p1ay];
    const len1 = Math.hypot(v1[0], v1[1]);
    if (len1 < 1e-3) continue;
    const u1: [number, number] = [v1[0] / len1, v1[1] / len1];

    let merged = false;

    // Look for a parallel double-wall twin
    for (let j = i + 1; j < walls.length; j++) {
      if (mergedIndices.has(j)) continue;

      const w2 = walls[j]!;
      if (!w2 || !w2.points || w2.points.length < 2) continue;

      const p2a = w2.points[0] as [number, number];
      const p2b = w2.points[1] as [number, number];
      if (!p2a || !p2b) continue;

      const [p2ax, p2ay] = p2a;
      const [p2bx, p2by] = p2b;
      const v2: [number, number] = [p2bx - p2ax, p2by - p2ay];
      const len2 = Math.hypot(v2[0], v2[1]);
      if (len2 < 1e-3) continue;
      const u2: [number, number] = [v2[0] / len2, v2[1] / len2];

      // 1. Parallel check (dot product close to 1 or -1)
      const dot = Math.abs(u1[0] * u2[0] + u1[1] * u2[1]);
      if (dot < 0.97) continue; // Not parallel

      // 2. Midpoint distance check
      const m1: [number, number] = [(p1ax + p1bx) / 2, (p1ay + p1by) / 2];
      const m2: [number, number] = [(p2ax + p2bx) / 2, (p2ay + p2by) / 2];

      // Midpoint-to-line distance
      const cross = Math.abs((m1[0] - p2ax) * (p2by - p2ay) - (m1[1] - p2ay) * (p2bx - p2ax));
      const dist = cross / len2;

      // Double-wall thickness is typically between 0.1m and 0.45m
      if (dist < 0.1 || dist > 0.45) continue;

      // 3. Overlap check along direction
      const dMid = Math.hypot(m1[0] - m2[0], m1[1] - m2[1]);
      if (dMid > (len1 + len2) * 0.45) continue; // Too far apart along length

      // Parallel twin found! Merge them into a centerline wall
      mergedIndices.add(j);
      merged = true;

      // Project w1 endpoints onto w2 line
      const projA = projectPointToLine(p1a, p2a, p2b);
      const projB = projectPointToLine(p1b, p2a, p2b);

      const startPt: [number, number] = [(p1ax + projA[0]) / 2, (p1ay + projA[1]) / 2];
      const endPt: [number, number] = [(p1bx + projB[0]) / 2, (p1by + projB[1]) / 2];

      consolidatedWalls.push({
        ...w1,
        id: `wall_merged_${i}`,
        points: [startPt, endPt],
        thickness: Math.max(0.12, Math.min(0.40, dist)),
      });
      break;
    }

    if (!merged) {
      consolidatedWalls.push(w1);
    }
  }

  return consolidatedWalls;
}

function projectPointToLine(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;

  const ab: [number, number] = [bx - ax, by - ay];
  const lenSq = ab[0] * ab[0] + ab[1] * ab[1];
  if (lenSq < 1e-6) return a;
  const ap: [number, number] = [px - ax, py - ay];
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / lenSq));
  return [ax + t * ab[0], ay + t * ab[1]];
}

function healWallsAndExtractOpenings(walls: any[]): { healedWalls: any[], openings: any[] } {
  const healedWalls: any[] = [];
  const openings: any[] = [];
  const mergedIndices = new Set<number>();

  for (let i = 0; i < walls.length; i++) {
    if (mergedIndices.has(i)) continue;

    let wCurrent = walls[i]!;
    if (!wCurrent || !wCurrent.points || wCurrent.points.length < 2) continue;

    let currentStart = wCurrent.points[0] as [number, number];
    let currentEnd = wCurrent.points[1] as [number, number];

    let healed = true;
    while (healed) {
      healed = false;
      const [csx, csy] = currentStart;
      const [cex, cey] = currentEnd;

      const v1 = [cex - csx, cey - csy];
      const len1 = Math.hypot(v1[0] as number, v1[1] as number);
      if (len1 < 1e-3) break;
      const u1 = [v1[0] as number / len1, v1[1] as number / len1];

      // Look for a collinear neighboring wall segment that continues after a gap
      for (let j = 0; j < walls.length; j++) {
        if (i === j || mergedIndices.has(j)) continue;

        const wNext = walls[j]!;
        if (!wNext || !wNext.points || wNext.points.length < 2) continue;

        const p2a = wNext.points[0] as [number, number];
        const p2b = wNext.points[1] as [number, number];
        if (!p2a || !p2b) continue;

        const [p2ax, p2ay] = p2a;
        const [p2bx, p2by] = p2b;

        const v2 = [p2bx - p2ax, p2by - p2ay];
        const len2 = Math.hypot(v2[0] as number, v2[1] as number);
        if (len2 < 1e-3) continue;
        const u2 = [v2[0] as number / len2, v2[1] as number / len2];

        // 1. Check if parallel
        const dot = Math.abs((u1[0] as number) * (u2[0] as number) + (u1[1] as number) * (u2[1] as number));
        if (dot < 0.96) continue;

        // 2. Check if collinear (distance of p2a to line wCurrent is very small)
        const cross = Math.abs((p2ax - csx) * (u1[1] as number) - (p2ay - csy) * (u1[0] as number));
        if (cross > 0.15) continue; // Not collinear

        // 3. Measure the gap distance between the segments
        const projStart1 = csx * (u1[0] as number) + csy * (u1[1] as number);
        const projEnd1 = cex * (u1[0] as number) + cey * (u1[1] as number);
        const projStart2 = p2ax * (u1[0] as number) + p2ay * (u1[1] as number);
        const projEnd2 = p2bx * (u1[0] as number) + p2by * (u1[1] as number);

        // Sort projections to identify gap
        const min1 = Math.min(projStart1, projEnd1);
        const max1 = Math.max(projStart1, projEnd1);
        const min2 = Math.min(projStart2, projEnd2);
        const max2 = Math.max(projStart2, projEnd2);

        // Gap distance
        let gap = 0;
        let gapStartProj = 0;
        let gapEndProj = 0;

        if (max1 < min2) {
          gap = min2 - max1;
          gapStartProj = max1;
          gapEndProj = min2;
        } else if (max2 < min1) {
          gap = min1 - max2;
          gapStartProj = max2;
          gapEndProj = min1;
        } else {
          continue; // They overlap, no gap (handled by double-wall merge or already connected)
        }

        // Typical window/door width ranges in buildings are between 0.6m and 2.8m
        if (gap >= 0.6 && gap <= 2.8) {
          // Found collinear gap! Heal the wall by merging them
          mergedIndices.add(j);
          healed = true;

          // Compute healed endpoints
          const globalMin = Math.min(min1, min2);
          const globalMax = Math.max(max1, max2);
          
          const newStart: [number, number] = [csx + (globalMin - min1) * (u1[0] as number), csy + (globalMin - min1) * (u1[1] as number)];
          const newEnd: [number, number] = [csx + (globalMax - min1) * (u1[0] as number), csy + (globalMax - min1) * (u1[1] as number)];
          
          // Re-calculate local gap points for the opening
          const gapStartPt: [number, number] = [csx + (gapStartProj - min1) * (u1[0] as number), csy + (gapStartProj - min1) * (u1[1] as number)];
          const gapEndPt: [number, number] = [csx + (gapEndProj - min1) * (u1[0] as number), csy + (gapEndProj - min1) * (u1[1] as number)];

          // Create the opening
          const type = gap < 1.15 ? 'door' : 'window';
          openings.push({
            id: `opening_${i}_${j}`,
            type,
            wallId: wCurrent.id,
            pos: [(gapStartPt[0] + gapEndPt[0]) / 2, (gapStartPt[1] + gapEndPt[1]) / 2] as [number, number],
            width: gap,
            height: type === 'door' ? 2.1 : 1.2,
            elevation: type === 'door' ? 0.0 : 0.9,
            thickness: wCurrent.thickness
          });

          // Update current segment to be the healed one so we can chain multiple heals!
          currentStart = newStart;
          currentEnd = newEnd;
          wCurrent = {
            ...wCurrent,
            points: [newStart, newEnd]
          };
          break;
        }
      }
    }
    healedWalls.push(wCurrent);
  }
  return { healedWalls, openings };
}
