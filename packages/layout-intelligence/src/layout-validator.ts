import type { RoomGraph, RoomNode } from './room-graph';
import type { WallPrimitive } from './topology-builder';
import { getDistance } from './topology-builder';

export interface ValidationError {
  type: string;
  message: string;
  roomId?: string;
  itemId?: string;
}

export class LayoutValidator {
  /**
   * Run full validation suite on the current layout.
   */
  public validate(
    graph: RoomGraph,
    walls: WallPrimitive[],
    furniture: any[],
    openings: any[]
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // 1. Check isolated rooms (no door connections)
    graph.rooms.forEach(room => {
      // Find connections for this room
      const roomConns = graph.connections.filter(c => c.room1Id === room.id || c.room2Id === room.id);
      if (roomConns.length === 0 && room.type !== 'Corridor') {
        errors.push({
          type: 'ISOLATED_ROOM',
          message: `Room "${room.id}" of type "${room.type}" has no doors and is completely isolated.`,
          roomId: room.id
        });
      }
    });

    // 2. Check room-furniture consistency (e.g., toilets, beds)
    graph.rooms.forEach(room => {
      const roomFurniture = furniture.filter(f => room.enclosedFurnitureIds.includes(f.id));
      
      if (room.type === 'Bedroom' || room.type === 'Dormitory') {
        const beds = roomFurniture.filter(f => f.type && f.type.includes('bed'));
        if (beds.length === 0) {
          errors.push({
            type: 'MISSING_FURNITURE',
            message: `Room "${room.id}" classified as "${room.type}" has no beds.`,
            roomId: room.id
          });
        }
      }

      if (room.type === 'Toilet' || room.type === 'Shower') {
        // Toilet/Shower should not contain office desks or beds
        const inappropriate = roomFurniture.filter(f => f.type && (f.type.includes('bed') || f.type.includes('desk') || f.type.includes('table')));
        inappropriate.forEach(item => {
          errors.push({
            type: 'INCONSISTENT_FURNITURE',
            message: `Sanitary room "${room.id}" contains inappropriate furniture item: "${item.type}" (${item.id}).`,
            roomId: room.id,
            itemId: item.id
          });
        });
      }

      if (room.type === 'Corridor') {
        // Corridors should not contain large furniture like beds or dining tables blocking passage
        const blockers = roomFurniture.filter(f => f.type && (f.type.includes('bed') || f.type.includes('table')));
        blockers.forEach(item => {
          errors.push({
            type: 'CIRCULATION_BLOCK',
            message: `Corridor "${room.id}" has circulation blocked by furniture item: "${item.type}".`,
            roomId: room.id,
            itemId: item.id
          });
        });
      }
    });

    // 3. Check blocked doors (circulation validity)
    const doors = openings.filter(o => o.type === 'door');
    doors.forEach(door => {
      const doorPos = door.pos || door.position;
      if (!doorPos) return;

      // Check if any furniture is within 0.75m of the door
      furniture.forEach(item => {
        const itemPos = item.pos || item.position;
        if (itemPos) {
          const dist = getDistance(doorPos, itemPos);
          if (dist < 0.75) {
            errors.push({
              type: 'BLOCKED_DOOR',
              message: `Circulation path near door at [${doorPos[0].toFixed(2)}, ${doorPos[1].toFixed(2)}] is obstructed by furniture item "${item.type}" (${item.id}).`,
              itemId: item.id
            });
          }
        }
      });

      // Check if any wall blocks the door (distance check to wall midpoints, excluding parent wall)
      walls.forEach(wall => {
        if (wall.id === door.wallId) return; // ignore parent wall

        const p1 = wall.points[0];
        const p2 = wall.points[1];
        const mid: [number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        const dist = getDistance(doorPos, mid);
        if (dist > 0.05 && dist < 0.5) {
          errors.push({
            type: 'BLOCKED_DOOR_WALL',
            message: `Circulation path near door at [${doorPos[0].toFixed(2)}, ${doorPos[1].toFixed(2)}] is obstructed by wall segment (${wall.id}).`
          });
        }
      });
    });

    return errors;
  }
}
