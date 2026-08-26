export interface RoomNode {
  id: string;
  polygon: Array<[number, number]>;
  centroid: [number, number];
  area: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  aspectRatio: number; // width/height or length/width
  enclosedFurnitureIds: string[];
  enclosedFixtureIds: string[];
  enclosedOcrText: string[];
  type: string;
  confidence: number;
}

export interface DoorConnection {
  doorId: string;
  room1Id: string;
  room2Id: string; // 'exterior' if it connects to the outside
}

export interface RoomGraph {
  rooms: RoomNode[];
  connections: DoorConnection[];
  adjacencyMatrix: Record<string, string[]>;
  circulationPaths: string[]; // roomIds that act as circulation corridors
}
