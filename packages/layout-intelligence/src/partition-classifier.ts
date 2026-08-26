import type { WallPrimitive } from './topology-builder';
import type { RoomNode } from './room-graph';
import { getDistance, distanceToSegment } from './topology-builder';

export class PartitionClassifier {
  /**
   * Classify wall primitives into structural, partition, privacy partitions, curtains, or screens.
   */
  public classifyPartitions(
    walls: WallPrimitive[],
    rooms: RoomNode[],
    looseFurniture: any[],
    isDormitoryLayout: boolean
  ): WallPrimitive[] {
    // 1. Map all room polygon boundary segments
    const roomBoundarySegments = new Set<string>();
    rooms.forEach(room => {
      const poly = room.polygon;
      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i]!;
        const p2 = poly[(i + 1) % poly.length]!;
        const key1 = `${p1[0].toFixed(2)},${p1[1].toFixed(2)}->${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
        const key2 = `${p2[0].toFixed(2)},${p2[1].toFixed(2)}->${p1[0].toFixed(2)},${p1[1].toFixed(2)}`;
        roomBoundarySegments.add(key1);
        roomBoundarySegments.add(key2);
      }
    });

    // 2. Classify each wall
    return walls.map(wall => {
      const p1 = wall.points[0];
      const p2 = wall.points[1];
      const length = getDistance(p1, p2);
      const isThick = wall.thickness >= 0.18;
      
      // Check if this wall matches any room boundary segment
      let liesOnRoomBoundary = false;
      for (const segKey of roomBoundarySegments) {
        const [saStr, sbStr] = segKey.split('->');
        const [sax, say] = saStr!.split(',').map(Number);
        const [sbx, sby] = sbStr!.split(',').map(Number);
        
        // Check if wall endpoints lie on the boundary segment (distance check)
        const d1 = distanceToSegment(p1, [sax!, say!], [sbx!, sby!]);
        const d2 = distanceToSegment(p2, [sax!, say!], [sbx!, sby!]);
        if (d1 < 0.15 && d2 < 0.15) {
          liesOnRoomBoundary = true;
          break;
        }
      }

      let type = 'partition_wall';
      
      if (isThick) {
        type = 'structural_wall';
      } else if (!liesOnRoomBoundary) {
        // Floating wall / dead end. Check if it's a privacy partition.
        const isThin = wall.thickness <= 0.12;
        const isShort = length <= 2.2;
        
        // Check if placed between beds (spacing and proximity to beds)
        const beds = looseFurniture.filter(f => (f.sku || '').toLowerCase().includes('bed'));
        let isNearBeds = false;
        let isBetweenBeds = false;

        const midPoint: [number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];

        beds.forEach(bed => {
          const bedPos = bed.pos || bed.position;
          if (bedPos && getDistance(midPoint, bedPos) < 1.8) {
            isNearBeds = true;
          }
        });

        // Spacing check: if there are multiple beds and this wall segment divides them
        if (beds.length >= 2) {
          let leftBedCount = 0;
          let rightBedCount = 0;
          
          // Compute wall line: ax + by + c = 0
          const dx = p2[0] - p1[0];
          const dy = p2[1] - p1[1];
          const a = -dy;
          const b = dx;
          const c = -(a * p1[0] + b * p1[1]);

          beds.forEach(bed => {
            const bedPos = bed.pos || bed.position;
            if (bedPos) {
              const val = a * bedPos[0] + b * bedPos[1] + c;
              if (val > 0) leftBedCount++;
              else if (val < 0) rightBedCount++;
            }
          });

          if (leftBedCount > 0 && rightBedCount > 0 && isNearBeds) {
            isBetweenBeds = true;
          }
        }

        if (isDormitoryLayout || isNearBeds || isBetweenBeds || isThin || isShort) {
          type = 'privacy_partition';
          
          // Curtains are usually very thin or specified in OCR
          if (wall.thickness <= 0.05) {
            type = 'curtain';
          } else if (length < 1.0) {
            type = 'screen';
          }
        }
      }

      return {
        ...wall,
        type
      };
    });
  }
}
