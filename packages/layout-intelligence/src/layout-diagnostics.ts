import type { RoomGraph } from './room-graph';
import type { ValidationError } from './layout-validator';

export interface LayoutDiagnosticReport {
  roomType: string;
  confidence: number;
  warnings: string[];
  topologyIssues: string[];
}

export class LayoutDiagnostics {
  /**
   * Generates overall diagnostics for the layout extraction.
   */
  public generate(
    graph: RoomGraph,
    validationErrors: ValidationError[]
  ): LayoutDiagnosticReport {
    // 1. Determine dominant room type
    let roomType = 'Standard Layout';
    const hasDormitory = graph.rooms.some(r => r.type === 'Dormitory');
    if (hasDormitory) {
      roomType = 'Dormitory';
    } else if (graph.rooms.length > 0) {
      // Find most common type
      const counts: Record<string, number> = {};
      graph.rooms.forEach(r => {
        counts[r.type] = (counts[r.type] || 0) + 1;
      });
      let maxCount = 0;
      for (const [type, count] of Object.entries(counts)) {
        if (count > maxCount) {
          maxCount = count;
          roomType = type;
        }
      }
    }

    // 2. Average confidence score
    let totalConfidence = 0;
    graph.rooms.forEach(r => {
      totalConfidence += r.confidence;
    });
    const confidence = graph.rooms.length > 0 
      ? Math.round((totalConfidence / graph.rooms.length) * 100) / 100
      : 0.90;

    // 3. Collect warnings
    const warnings: string[] = [];
    const topologyIssues: string[] = [];

    validationErrors.forEach(err => {
      if (err.type === 'CIRCULATION_BLOCK' || err.type === 'BLOCKED_DOOR' || err.type === 'BLOCKED_DOOR_WALL') {
        warnings.push(err.message);
      } else if (err.type === 'ISOLATED_ROOM') {
        topologyIssues.push(err.message);
      } else {
        warnings.push(err.message);
      }
    });

    return {
      roomType,
      confidence,
      warnings,
      topologyIssues
    };
  }
}
