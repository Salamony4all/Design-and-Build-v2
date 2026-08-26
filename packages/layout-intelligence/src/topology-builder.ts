import type { RoomGraph, RoomNode, DoorConnection } from './room-graph';

export interface WallPrimitive {
  id: string;
  points: [[number, number], [number, number]];
  thickness: number;
  height: number;
  curveOffset?: number;
  status?: string;
  type?: string;
}

export interface IngestionResult {
  track: 'vector' | 'raster';
  vectorPrimitives: any[];
  detectedSymbols: any[];
  tables: any[];
  confidence: number;
}

export interface LegacyPascalPayload {
  core: {
    slabs: any[];
    ceilings: any[];
    zones?: any[];
  };
  shell: {
    walls: WallPrimitive[];
    columns: any[];
    openings: any[];
  };
  joinery: {
    fixedFixtures: any[];
  };
  ffe: {
    looseFurniture: any[];
  };
  semanticBim?: any;
  diagnostics?: any;
}

// ─── Geometric Utility Functions ─────────────────────────────────────────────

export function getDistance(p1: [number, number], p2: [number, number]): number {
  return Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
}

export function isPointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]![0], yi = polygon[i]![1];
    const xj = polygon[j]![0], yj = polygon[j]![1];
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function getPolygonArea(polygon: Array<[number, number]>): number {
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i]!;
    const [x2, y2] = polygon[(i + 1) % n]!;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

export function getPolygonCentroid(polygon: Array<[number, number]>): [number, number] {
  let cx = 0, cy = 0;
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i]!;
    const [x2, y2] = polygon[(i + 1) % n]!;
    const factor = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * factor;
    cy += (y1 + y2) * factor;
    area += factor;
  }
  if (area === 0) return polygon[0] || [0, 0];
  area = area / 2;
  cx = cx / (6 * area);
  cy = cy / (6 * area);
  return [cx, cy];
}

export function distanceToSegment(p: [number, number], s1: [number, number], s2: [number, number]): number {
  const [px, py] = p;
  const [x1, y1] = s1;
  const [x2, y2] = s2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return getDistance(p, s1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ─── Topology Builder ────────────────────────────────────────────────────────

export class TopologyBuilder {
  private snapTolerance = 0.35; // meters

  public build(payload: LegacyPascalPayload): RoomGraph {
    const rawWalls = payload.shell.walls || [];
    const snappedWalls = this.snapWallJunctions(rawWalls);
    
    // Build Graph vertices and adjacency
    const { vertices, edges, vertexMap } = this.buildPlanarGraph(snappedWalls);
    
    // Find closed enclosures (polygons)
    const roomPolygons = this.extractMinimalCycles(vertices, edges);
    
    // Map room polygons to RoomNodes
    const rooms: RoomNode[] = roomPolygons.map((poly, idx) => {
      const area = getPolygonArea(poly);
      const centroid = getPolygonCentroid(poly);
      
      // Calculate bounding box and aspect ratio
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      poly.forEach(([x, y]) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      });
      const width = maxX - minX;
      const depth = maxY - minY;
      const aspectRatio = depth !== 0 ? width / depth : 1.0;

      const roomId = `room_${idx + 1}`;
      
      // Find enclosed furniture and fixtures
      const enclosedFurnitureIds: string[] = [];
      const ffeList = payload.ffe?.looseFurniture || [];
      ffeList.forEach((item) => {
        const pos = item.pos || item.position;
        if (pos && isPointInPolygon(pos, poly)) {
          enclosedFurnitureIds.push(item.id);
        }
      });

      const enclosedFixtureIds: string[] = [];
      const fixtureList = payload.joinery?.fixedFixtures || [];
      fixtureList.forEach((fix) => {
        // use path centroid or first point
        const pt = fix.path && fix.path[0] ? fix.path[0] : null;
        if (pt && isPointInPolygon(pt, poly)) {
          enclosedFixtureIds.push(fix.id);
        }
      });

      // Find enclosed OCR texts (text primitives in compiler output / vector primitives)
      const enclosedOcrText: string[] = [];
      // Slabs/ceilings/zones can contain annotations. Let's also check if we can inspect vector text from payload
      if (payload.semanticBim?.diagnostics?.ocrText) {
        // If passed down
      }

      return {
        id: roomId,
        polygon: poly,
        centroid,
        area,
        bounds: { minX, maxX, minY, maxY },
        aspectRatio,
        enclosedFurnitureIds,
        enclosedFixtureIds,
        enclosedOcrText,
        type: 'Unclassified',
        confidence: 0.5
      };
    });

    // Map doors to connections
    const connections: DoorConnection[] = [];
    const openings = payload.shell.openings || [];
    const doors = openings.filter(o => o.type === 'door');

    doors.forEach((door, dIdx) => {
      const doorPos = door.pos || door.position;
      if (!doorPos) return;

      // Find rooms touching this door
      const touchingRooms: string[] = [];
      rooms.forEach(room => {
        // Check if doorPos is near any segment of the room polygon
        const poly = room.polygon;
        let isNear = false;
        for (let i = 0; i < poly.length; i++) {
          const s1 = poly[i]!;
          const s2 = poly[(i + 1) % poly.length]!;
          const dist = distanceToSegment(doorPos, s1, s2);
          if (dist < 0.4) {
            isNear = true;
            break;
          }
        }
        if (isNear) {
          touchingRooms.push(room.id);
        }
      });

      const r1 = touchingRooms[0] || 'exterior';
      const r2 = touchingRooms[1] || 'exterior';
      connections.push({
        doorId: door.id || `door_${dIdx}`,
        room1Id: r1,
        room2Id: r2
      });
    });

    // Build Adjacency Matrix
    const adjacencyMatrix: Record<string, string[]> = {};
    rooms.forEach(r => {
      adjacencyMatrix[r.id] = [];
    });

    connections.forEach(conn => {
      const { room1Id, room2Id } = conn;
      if (room1Id !== 'exterior' && room2Id !== 'exterior') {
        if (!adjacencyMatrix[room1Id]!.includes(room2Id)) adjacencyMatrix[room1Id]!.push(room2Id);
        if (!adjacencyMatrix[room2Id]!.includes(room1Id)) adjacencyMatrix[room2Id]!.push(room1Id);
      }
    });

    // Find shared walls for physical adjacency (even without doors)
    for (let i = 0; i < rooms.length; i++) {
      const r1 = rooms[i]!;
      for (let j = i + 1; j < rooms.length; j++) {
        const r2 = rooms[j]!;
        if (this.shareWallSegment(r1.polygon, r2.polygon)) {
          if (!adjacencyMatrix[r1.id]!.includes(r2.id)) adjacencyMatrix[r1.id]!.push(r2.id);
          if (!adjacencyMatrix[r2.id]!.includes(r1.id)) adjacencyMatrix[r2.id]!.push(r1.id);
        }
      }
    }

    return {
      rooms,
      connections,
      adjacencyMatrix,
      circulationPaths: []
    };
  }

  private snapWallJunctions(walls: WallPrimitive[]): WallPrimitive[] {
    const endpoints: [number, number][] = [];
    walls.forEach(w => {
      endpoints.push([...w.points[0]] as [number, number]);
      endpoints.push([...w.points[1]] as [number, number]);
    });

    // Group endpoints by proximity
    const groups: [number, number][][] = [];
    endpoints.forEach(pt => {
      let matchedGroup = groups.find(g => getDistance(pt, g[0]!) < this.snapTolerance);
      if (matchedGroup) {
        matchedGroup.push(pt);
      } else {
        groups.push([pt]);
      }
    });

    // Compute averaged snapped coordinates for each group
    const snappedCoordsMap = new Map<string, [number, number]>();
    groups.forEach(group => {
      let sumX = 0, sumY = 0;
      group.forEach(pt => {
        sumX += pt[0];
        sumY += pt[1];
      });
      const avgX = sumX / group.length;
      const avgY = sumY / group.length;
      const avgPt: [number, number] = [avgX, avgY];
      
      group.forEach(pt => {
        snappedCoordsMap.set(`${pt[0].toFixed(4)},${pt[1].toFixed(4)}`, avgPt);
      });
    });

    return walls.map(w => {
      const p1Key = `${w.points[0][0].toFixed(4)},${w.points[0][1].toFixed(4)}`;
      const p2Key = `${w.points[1][0].toFixed(4)},${w.points[1][1].toFixed(4)}`;
      const sp1 = snappedCoordsMap.get(p1Key) || w.points[0];
      const sp2 = snappedCoordsMap.get(p2Key) || w.points[1];
      return {
        ...w,
        points: [sp1, sp2]
      };
    });
  }

  private buildPlanarGraph(walls: WallPrimitive[]) {
    const vertexMap = new Map<string, [number, number]>();
    const edges: Array<[number, number]> = [];

    const getVertexIdx = (pt: [number, number]): number => {
      const key = `${pt[0].toFixed(3)},${pt[1].toFixed(3)}`;
      let matches = Array.from(vertexMap.keys()).findIndex(k => {
        const parts = k.split(',').map(Number);
        const x = parts[0] ?? 0;
        const y = parts[1] ?? 0;
        return Math.hypot(x - pt[0], y - pt[1]) < 0.01;
      });

      if (matches !== -1) {
        return matches;
      }
      const idx = vertexMap.size;
      vertexMap.set(key, pt);
      return idx;
    };

    walls.forEach(w => {
      const u = getVertexIdx(w.points[0]);
      const v = getVertexIdx(w.points[1]);
      if (u !== v) {
        // Avoid duplicate edges
        const exists = edges.some(([a, b]) => (a === u && b === v) || (a === v && b === u));
        if (!exists) {
          edges.push([u, v]);
        }
      }
    });

    return {
      vertices: Array.from(vertexMap.values()),
      edges,
      vertexMap
    };
  }

  private extractMinimalCycles(vertices: Array<[number, number]>, edges: Array<[number, number]>): Array<Array<[number, number]>> {
    const n = vertices.length;
    const adjacencyList: Array<Array<{ to: number; angle: number; edgeIdx: number }>> = Array.from({ length: n }, () => []);
    
    edges.forEach(([u, v], edgeIdx) => {
      const dx1 = vertices[v]![0] - vertices[u]![0];
      const dy1 = vertices[v]![1] - vertices[u]![1];
      const angle1 = Math.atan2(dy1, dx1);
      adjacencyList[u]!.push({ to: v, angle: angle1, edgeIdx });

      const dx2 = vertices[u]![0] - vertices[v]![0];
      const dy2 = vertices[u]![1] - vertices[v]![1];
      const angle2 = Math.atan2(dy2, dx2);
      adjacencyList[v]!.push({ to: u, angle: angle2, edgeIdx });
    });

    // Sort neighbors counter-clockwise
    adjacencyList.forEach(neighbors => {
      neighbors.sort((a, b) => a.angle - b.angle);
    });

    const visitedHalfEdges = new Set<string>();
    const roomPolygons: Array<Array<[number, number]>> = [];

    // Traverse graph using the left-hand / CCW rule to extract loops
    for (let u = 0; u < n; u++) {
      const neighbors = adjacencyList[u]!;
      for (const nbr of neighbors) {
        const v = nbr.to;
        const key = `${u}->${v}`;
        if (visitedHalfEdges.has(key)) continue;

        // Trace cycle
        const cycle: number[] = [u];
        let curr = u;
        let nextNode = v;
        let limit = edges.length * 2;
        let ok = true;

        while (nextNode !== u && limit-- > 0) {
          cycle.push(nextNode);
          const keyNext = `${curr}->${nextNode}`;
          visitedHalfEdges.add(keyNext);

          // Find angle of incoming edge (nextNode -> curr)
          const currCoords = vertices[curr]!;
          const nextCoords = vertices[nextNode]!;
          const inAngle = Math.atan2(currCoords[1] - nextCoords[1], currCoords[0] - nextCoords[0]);

          // Find the neighbor of nextNode that is immediately CCW from inAngle
          const nbrs = adjacencyList[nextNode]!;
          let bestIdx = -1;
          
          // Since neighbors are sorted, find the first index whose angle is > inAngle
          let idx = nbrs.findIndex(nb => nb.angle > inAngle);
          if (idx === -1) {
            // wrap around to the first neighbor
            bestIdx = 0;
          } else {
            bestIdx = idx;
          }

          const chosenNbr = nbrs[bestIdx];
          if (!chosenNbr) {
            ok = false;
            break;
          }

          curr = nextNode;
          nextNode = chosenNbr.to;
        }

        if (ok && nextNode === u && cycle.length >= 3) {
          visitedHalfEdges.add(`${curr}->${nextNode}`);
          const polyPoints = cycle.map(idx => vertices[idx]!);
          
          // Calculate signed area.
          let signedArea = 0;
          for (let i = 0; i < polyPoints.length; i++) {
            const [x1, y1] = polyPoints[i]!;
            const [x2, y2] = polyPoints[(i + 1) % polyPoints.length]!;
            signedArea += x1 * y2 - x2 * y1;
          }
          signedArea /= 2;

          // Positive signed area (CCW) represents an interior room polygon.
          // Negative signed area (CW) represents the exterior boundary.
          if (signedArea > 0.5 && signedArea < 500) {
            roomPolygons.push(polyPoints);
          }
        }
      }
    }

    return roomPolygons;
  }

  private shareWallSegment(poly1: Array<[number, number]>, poly2: Array<[number, number]>): boolean {
    // Check if they share any edge (points are close)
    for (let i = 0; i < poly1.length; i++) {
      const p1a = poly1[i]!;
      const p1b = poly1[(i + 1) % poly1.length]!;
      
      for (let j = 0; j < poly2.length; j++) {
        const p2a = poly2[j]!;
        const p2b = poly2[(j + 1) % poly2.length]!;

        // Check if endpoints of the segments match or overlap
        const matchDirect = getDistance(p1a, p2b) < 0.15 && getDistance(p1b, p2a) < 0.15;
        const matchReverse = getDistance(p1a, p2a) < 0.15 && getDistance(p1b, p2b) < 0.15;
        if (matchDirect || matchReverse) {
          return true;
        }
      }
    }
    return false;
  }
}
