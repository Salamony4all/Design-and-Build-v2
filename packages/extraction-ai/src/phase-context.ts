// packages/extraction-ai/src/phase-context.ts
// Compact deterministic structural context for Fit-out and Loose FF&E passes.

import type { WallContract, DoorContract, WindowContract, SlabContract } from 'design-build-extraction-contracts';

export interface CompactStructuralContext {
  guideScale?: number;
  levelId: string;
  slabBoundary?: Array<[number, number]>;
  walls: Array<{
    id: string;
    start: [number, number];
    end: [number, number];
    thickness: number;
    height: number;
  }>;
  doors: Array<{
    id: string;
    wallId: string;
    position: [number, number];
    width: number;
    clearanceZone?: [number, number];
  }>;
  windows: Array<{
    id: string;
    wallId: string;
    position: [number, number];
    width: number;
  }>;
  zones?: Array<{
    id: string;
    name: string;
    boundary: Array<[number, number]>;
  }>;
}

export function compileStructuralContext(args: {
  levelId?: string;
  slab?: SlabContract;
  walls: WallContract[];
  doors?: DoorContract[];
  windows?: WindowContract[];
  zones?: Array<{ id: string; name: string; boundary: Array<{ x: number; y: number }> }>;
  guideScale?: number;
}): CompactStructuralContext {
  const { levelId = 'level_0', slab, walls, doors = [], windows = [], zones = [], guideScale } = args;

  const slabBoundary: Array<[number, number]> | undefined = slab?.polygonM?.map((p) => [p.x, p.y]);

  const compactWalls = walls.map((w) => ({
    id: w.id,
    start: [w.startM.x, w.startM.y] as [number, number],
    end: [w.endM.x, w.endM.y] as [number, number],
    thickness: w.thicknessM,
    height: w.heightM,
  }));

  const compactDoors = doors.map((d) => {
    const midX = (d.startM.x + d.endM.x) / 2;
    const midY = (d.startM.y + d.endM.y) / 2;
    const width = Math.hypot(d.endM.x - d.startM.x, d.endM.y - d.startM.y);
    return {
      id: d.id,
      wallId: d.wallId,
      position: [midX, midY] as [number, number],
      width,
      clearanceZone: [midX, midY] as [number, number],
    };
  });

  const compactWindows = windows.map((w) => {
    const midX = (w.startM.x + w.endM.x) / 2;
    const midY = (w.startM.y + w.endM.y) / 2;
    const width = Math.hypot(w.endM.x - w.startM.x, w.endM.y - w.startM.y);
    return {
      id: w.id,
      wallId: w.wallId,
      position: [midX, midY] as [number, number],
      width,
    };
  });

  const compactZones = zones.map((z) => ({
    id: z.id,
    name: z.name,
    boundary: z.boundary.map((p) => [p.x, p.y] as [number, number]),
  }));

  return {
    guideScale,
    levelId,
    slabBoundary,
    walls: compactWalls,
    doors: compactDoors,
    windows: compactWindows,
    zones: compactZones.length ? compactZones : undefined,
  };
}
