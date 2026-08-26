import type { RoomNode } from './room-graph';
import { getDistance } from './topology-builder';

export interface SemanticFurniture {
  id: string;
  sku: string;
  type: string; // e.g. bed_single, bed_double, wardrobe, locker, desk, chair
  position: [number, number];
  rotation: number; // in radians
  size: [number, number]; // width, depth (or length)
  confidence: number;
  status?: string;
}

export class FurnitureIntelligence {
  /**
   * Processes raw loose furniture and refines classifications, sizes, orientations, and confidence.
   */
  public process(
    looseFurniture: any[],
    fixedFixtures: any[],
    rooms: RoomNode[]
  ): SemanticFurniture[] {
    return looseFurniture.map((item, idx) => {
      const skuLower = (item.sku || '').toLowerCase();
      const pos = item.pos || item.position || [0, 0];
      const rotation = item.rotation || 0; // in radians
      
      // Determine which room this item is in
      const room = rooms.find(r => {
        return r.enclosedFurnitureIds.includes(item.id);
      });
      const roomType = room ? room.type : 'Standard Layout';

      let type = 'chair';
      let size: [number, number] = [0.6, 0.6];
      let confidence = item.confidence || 0.85;

      // 1. Bed Classification
      if (skuLower.includes('bed')) {
        // Default to single
        type = 'bed_single';
        size = [0.9, 1.9]; // width 0.9m, length 1.9m

        if (skuLower.includes('double') || skuLower.includes('king') || skuLower.includes('queen')) {
          type = 'bed_double';
          size = [1.6, 2.0];
        } else if (skuLower.includes('bunk') || skuLower.includes('bunkbed')) {
          type = 'bunk_bed';
          size = [0.9, 1.9];
        } else if (roomType === 'Bedroom' && !skuLower.includes('single')) {
          // If in a standard bedroom, default to double bed if it looks large
          type = 'bed_double';
          size = [1.6, 2.0];
        }

        // Repetition check: beds in a Dormitory are single beds or bunk beds
        if (roomType === 'Dormitory') {
          type = skuLower.includes('bunk') ? 'bunk_bed' : 'bed_single';
          size = [0.9, 1.9];
        }
      } 
      // 2. Storage Classification (Wardrobe, Locker, Cabinet)
      else if (skuLower.includes('closet') || skuLower.includes('cabinet') || skuLower.includes('locker') || skuLower.includes('wardrobe')) {
        if (roomType === 'Dormitory' || roomType === 'Locker Room') {
          type = 'locker';
          size = [0.5, 0.5];
        } else if (roomType === 'Bedroom') {
          type = 'wardrobe';
          size = [1.0, 0.6];
        } else {
          type = 'cabinet';
          size = [0.8, 0.45];
        }
      } 
      // 3. Desk and Table Classification
      else if (skuLower.includes('desk') || skuLower.includes('table')) {
        if (roomType === 'Reception') {
          type = 'reception_desk';
          size = [1.8, 0.8];
        } else if (skuLower.includes('meeting') || skuLower.includes('board') || roomType === 'Meeting Room') {
          type = 'table';
          size = [2.4, 1.2]; // Larger conference table
        } else {
          type = 'desk';
          size = [1.2, 0.7];
        }
      }
      // 4. Seating Classification (Chair)
      else if (skuLower.includes('chair') || skuLower.includes('stool')) {
        type = 'chair';
        size = [0.6, 0.6];
      }
      // 5. Sanitary Classification (Sink, Toilet, Shower)
      else if (skuLower.includes('toilet')) {
        type = 'toilet';
        size = [0.5, 0.7];
      } else if (skuLower.includes('sink')) {
        type = 'sink';
        size = [0.6, 0.55];
      } else if (skuLower.includes('shower')) {
        type = 'shower';
        size = [0.9, 0.9];
      }

      return {
        id: item.id || `furniture_${idx}`,
        sku: item.sku,
        type,
        position: pos as [number, number],
        rotation,
        size,
        confidence,
        status: item.status
      };
    });
  }
}
