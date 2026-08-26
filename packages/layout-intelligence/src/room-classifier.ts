import type { RoomNode, RoomGraph } from './room-graph';

export class RoomClassifier {
  public classify(room: RoomNode, graph: RoomGraph, allLooseFurniture: any[], allFixedFixtures: any[], allOcrText: any[]): { type: string; confidence: number } {
    const scores = {
      Dormitory: 0,
      Bedroom: 0,
      Office: 0,
      "Meeting Room": 0,
      Reception: 0,
      Classroom: 0,
      Storage: 0,
      Kitchen: 0,
      Pantry: 0,
      "Locker Room": 0,
      Toilet: 0,
      Shower: 0,
      Corridor: 0
    };

    // 1. Gather OCR texts inside or near the room bounds
    const roomTexts = allOcrText
      .filter(t => {
        const pos = t.position || t.pos;
        if (!pos) return false;
        // Check if inside room polygon
        return this.isPointInPolygon(pos, room.polygon);
      })
      .map(t => (t.text || '').toLowerCase());

    // 2. Count furniture types in the room
    const furniture = allLooseFurniture.filter(f => room.enclosedFurnitureIds.includes(f.id));
    const fixtures = allFixedFixtures.filter(f => room.enclosedFixtureIds.includes(f.id));

    const bedsCount = furniture.filter(f => {
      const sku = (f.sku || '').toLowerCase();
      return sku.includes('bed');
    }).length;

    const desksCount = furniture.filter(f => {
      const sku = (f.sku || '').toLowerCase();
      return sku.includes('desk') || sku.includes('table');
    }).length;

    const chairsCount = furniture.filter(f => {
      const sku = (f.sku || '').toLowerCase();
      return sku.includes('chair');
    }).length;

    const toiletCount = fixtures.filter(f => (f.type || '').toLowerCase().includes('toilet')).length;
    const sinkCount = fixtures.filter(f => (f.type || '').toLowerCase().includes('sink')).length;
    const showerCount = fixtures.filter(f => (f.type || '').toLowerCase().includes('shower')).length;
    const lockerCount = furniture.filter(f => {
      const sku = (f.sku || '').toLowerCase();
      return sku.includes('locker') || sku.includes('closet') || sku.includes('wardrobe');
    }).length;

    // 3. Heuristics based on OCR (Strong semantic signal)
    roomTexts.forEach(text => {
      if (text.includes('dormitory') || text.includes('6 bed') || text.includes('bed unit')) {
        scores.Dormitory += 10.0;
      } else if (text.includes('bedroom') || text.includes('bed')) {
        scores.Bedroom += 5.0;
        scores.Dormitory += 2.0; // bed unit
      } else if (text.includes('office') || text.includes('workstation')) {
        scores.Office += 5.0;
      } else if (text.includes('meeting') || text.includes('conf') || text.includes('boardroom')) {
        scores["Meeting Room"] += 5.0;
      } else if (text.includes('reception') || text.includes('lobby') || text.includes('waiting')) {
        scores.Reception += 5.0;
      } else if (text.includes('class') || text.includes('lecture') || text.includes('study')) {
        scores.Classroom += 5.0;
      } else if (text.includes('store') || text.includes('storage') || text.includes('utility') || text.includes('pvc')) {
        scores.Storage += 5.0;
      } else if (text.includes('kitchen') || text.includes('canteen')) {
        scores.Kitchen += 5.0;
      } else if (text.includes('pantry')) {
        scores.Pantry += 5.0;
      } else if (text.includes('locker') || text.includes('lockers')) {
        scores["Locker Room"] += 5.0;
      } else if (text.includes('toilet') || text.includes('wc') || text.includes('restroom') || text.includes('powder')) {
        scores.Toilet += 5.0;
      } else if (text.includes('shower') || text.includes('bath')) {
        scores.Shower += 5.0;
      } else if (text.includes('corridor') || text.includes('hall') || text.includes('passage') || text.includes('lobby')) {
        scores.Corridor += 5.0;
      }
    });

    // 4. Heuristics based on Furniture (Repetition & Semantics)
    if (bedsCount >= 3) {
      scores.Dormitory += 8.0;
    } else if (bedsCount > 0) {
      scores.Bedroom += 4.0;
    }

    if (toiletCount > 0) {
      scores.Toilet += 6.0;
    }
    if (showerCount > 0) {
      scores.Shower += 6.0;
    }
    if (toiletCount > 0 && showerCount > 0) {
      scores.Toilet += 2.0;
      scores.Shower += 2.0;
    }

    if (lockerCount >= 4) {
        scores["Locker Room"] += 4.0;
        scores.Dormitory += 2.0; // dorms have many lockers
      } else if (lockerCount > 0) {
      scores.Storage += 2.0;
    }

    if (desksCount >= 1 && chairsCount >= 8) {
        scores["Meeting Room"] += 4.0;
      } else if (desksCount >= 4 && chairsCount >= 4) {
      scores.Office += 3.0;
      scores.Classroom += 2.0;
    }

    // 5. Geometry Heuristics (Area, Aspect Ratio)
    const area = room.area;
    const ratio = room.aspectRatio;

    // Small rooms are likely toilets/showers/storage
    if (area < 4.0) {
      scores.Toilet += 1.5;
      scores.Shower += 1.5;
      scores.Storage += 1.0;
      scores.Pantry += 1.0;
    }

    // Long narrow rooms are likely Corridors
    if (ratio > 2.8 || ratio < 0.36) {
      scores.Corridor += 3.0;
    }

    // 6. Graph Topology Heuristics
    const neighbors = graph.adjacencyMatrix[room.id] || [];
    if (neighbors.length >= 4) {
      scores.Corridor += 2.0; // Central corridor connects many rooms
    }

    // Sort to find best class
    let bestClass = 'Office';
    let maxScore = -1;

    for (const [cls, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        bestClass = cls;
      }
    }

    // Calculate confidence score (normalized)
    let confidence = 0.5;
    if (maxScore > 0) {
      // mapping max score to 0.5 - 0.99 range
      confidence = Math.min(0.99, 0.5 + (maxScore / 15) * 0.49);
    } else {
      // Default classes based purely on area/aspect ratio
      if (area < 4.0) {
        bestClass = 'Toilet';
      } else if (ratio > 3.0 || ratio < 0.33) {
        bestClass = 'Corridor';
      } else if (bedsCount > 0) {
        bestClass = 'Bedroom';
      } else {
        bestClass = 'Office';
      }
      confidence = 0.6;
    }

    return {
      type: bestClass,
      confidence: Math.round(confidence * 100) / 100
    };
  }

  private isPointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
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
}
