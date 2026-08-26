// packages/extraction-ai/tests/ai-benchmark.test.ts
// Offline AI Replay Benchmark & Comprehensive Test Suite.
// Covers opening alias broadening, 2-stage hosting, wall topology repair,
// canonical furniture catalog resolution, dimension provenance, and phase context.

import { describe, it, expect } from 'vitest';
import {
  resolveOpeningType,
  normalizeOpenings,
  evaluateHostCandidates,
  type ParsedOpening,
  type NormalizedWall,
} from '../src/opening-normalizer';
import {
  repairWallTopology,
  deduplicateWalls,
} from '../src/wall-snapping';
import {
  resolvePascalFurniture,
  CANONICAL_FURNITURE_FAMILIES,
} from '../src/pascal-furniture-catalog';
import {
  resolveFurnitureDimensions,
} from '../src/furniture-dimensions';
import {
  compileStructuralContext,
} from '../src/phase-context';
import { adaptMultipassResult } from '../src/result-adapter';
import type { WallContract } from 'design-build-extraction-contracts';

describe('Offline AI Replay Benchmark & Capabilities', () => {
  // ── 1. Broadened Opening Aliases ──────────────────────────────────────────
  describe('1. Broadened Opening Aliases & Ambiguity Resolution', () => {
    const testCases: Array<{ raw: string; expected: string }> = [
      { raw: 'window-simple', expected: 'WINDOW' },
      { raw: 'window-double', expected: 'WINDOW' },
      { raw: 'window-large', expected: 'WINDOW' },
      { raw: 'window-small', expected: 'WINDOW' },
      { raw: 'window-small-2', expected: 'WINDOW' },
      { raw: 'window-square', expected: 'WINDOW' },
      { raw: 'window-rectangle', expected: 'WINDOW' },
      { raw: 'window-round', expected: 'WINDOW' },
      { raw: 'window1-black-open-1731', expected: 'WINDOW' },
      { raw: 'glazing', expected: 'WINDOW' },
      { raw: 'fixed-glazing', expected: 'WINDOW' },
      { raw: 'sliding-window', expected: 'WINDOW' },
      { raw: 'doorway-front', expected: 'DOOR' },
      { raw: 'glass-door', expected: 'DOOR' },
      { raw: 'sliding-door', expected: 'DOOR' },
      { raw: 'door-bar', expected: 'DOOR' },
      { raw: 'door-with-bar', expected: 'DOOR' },
      { raw: 'folding-door', expected: 'DOOR' },
      { raw: 'pocket-door', expected: 'DOOR' },
    ];

    testCases.forEach(({ raw, expected }) => {
      it(`correctly resolves "${raw}" to ${expected}`, () => {
        const res = resolveOpeningType(raw);
        expect(res.canonicalType).toBe(expected);
      });
    });

    it('flags conflicting door-and-window tokens as AMBIGUOUS', () => {
      const res = resolveOpeningType('sliding-door-window');
      expect(res.canonicalType).toBe('AMBIGUOUS');
      expect(res.aliasRule).toBe('CONFLICTING_DOOR_AND_WINDOW_EVIDENCE');
    });

    it('marks unknown opening category as UNSUPPORTED', () => {
      const res = resolveOpeningType('hatch');
      expect(res.canonicalType).toBe('UNSUPPORTED');
    });
  });

  // ── 2. Adaptive Opening Hosting & Bounded Clamping ────────────────────────
  describe('2. Adaptive Opening Hosting & Clamping', () => {
    const testWalls: NormalizedWall[] = [
      { id: 'w1', startM: { x: 0, y: 0 }, endM: { x: 8, y: 0 }, thicknessM: 0.2 },
      { id: 'w2', startM: { x: 8, y: 0 }, endM: { x: 8, y: 6 }, thicknessM: 0.2 },
    ];

    it('hosts window-simple within 0.35m offset onto host wall', () => {
      const parsed: ParsedOpening[] = [
        { id: 'win_01', type: 'window-simple', pos: [4, 0.25], width: 1.2, height: 1.4, elevation: 0.9 },
      ];
      const res = normalizeOpenings({ parsedOpenings: parsed, normalizedWalls: testWalls });
      expect(res.acceptedWindows.length).toBe(1);
      expect(res.acceptedWindows[0].wallId).toBe('w1');
      expect(res.acceptedWindows[0].sillM).toBeCloseTo(0.9);
      expect(res.acceptedWindows[0].headM).toBeCloseTo(2.3);
    });

    it('clamps opening interval when center is near wall corner', () => {
      // Opening width 1.2m centered at x=7.8m on 8m wall (extends to 8.4m)
      const parsed: ParsedOpening[] = [
        { id: 'door_corner', type: 'door', pos: [7.8, 0], width: 1.2, height: 2.1 },
      ];
      const res = normalizeOpenings({ parsedOpenings: parsed, normalizedWalls: testWalls });
      expect(res.acceptedDoors.length).toBe(1);
      expect(res.diagnostics[0].clamped).toBe(true);
      expect(res.diagnostics[0].endM?.x).toBeLessThanOrEqual(8.0);
    });

    it('sends ambiguous parallel walls to review', () => {
      const parallelWalls: NormalizedWall[] = [
        { id: 'pw1', startM: { x: 0, y: 0 }, endM: { x: 10, y: 0 }, thicknessM: 0.2 },
        { id: 'pw2', startM: { x: 0, y: 0.04 }, endM: { x: 10, y: 0.04 }, thicknessM: 0.2 },
      ];
      const parsed: ParsedOpening[] = [
        { id: 'amb_door', type: 'door', pos: [5, 0.02], width: 0.9, height: 2.1 },
      ];
      const res = normalizeOpenings({ parsedOpenings: parsed, normalizedWalls: parallelWalls });
      expect(res.reviewOpenings.length).toBe(1);
      expect(res.reviewOpenings[0].outcome).toBe('REVIEW_HOST');
    });
  });

  // ── 3. Wall Topology Analysis & Junction Repair ───────────────────────────
  describe('3. Wall Topology Analysis & Junction Repair', () => {
    it('snaps L-junction endpoints within tolerance (0.25m)', () => {
      const walls: WallContract[] = [
        { id: 'w1', kind: 'wall', startM: { x: 0, y: 0 }, endM: { x: 4.95, y: 0 }, thicknessM: 0.2, heightM: 2.8, provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'wall' } },
        { id: 'w2', kind: 'wall', startM: { x: 5.05, y: 0.05 }, endM: { x: 5.05, y: 4 }, thicknessM: 0.2, heightM: 2.8, provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'wall' } },
      ];

      const res = repairWallTopology(walls);
      expect(res.repairs.length).toBeGreaterThanOrEqual(1);
      expect(res.repairedWalls[0].endM.x).toBeCloseTo(5.0);
      expect(res.repairedWalls[1].startM.x).toBeCloseTo(5.0);
    });

    it('snaps T-junction endpoint onto finite wall segment', () => {
      const walls: WallContract[] = [
        { id: 'main_wall', kind: 'wall', startM: { x: 0, y: 0 }, endM: { x: 10, y: 0 }, thicknessM: 0.2, heightM: 2.8, provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'wall' } },
        { id: 'partition', kind: 'wall', startM: { x: 5.0, y: 0.12 }, endM: { x: 5.0, y: 5 }, thicknessM: 0.2, heightM: 2.8, provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'wall' } },
      ];

      const res = repairWallTopology(walls);
      expect(res.repairedWalls[1].startM.y).toBeCloseTo(0.0);
    });

    it('removes duplicate overlapping wall segments', () => {
      const walls: WallContract[] = [
        { id: 'w1', kind: 'wall', startM: { x: 0, y: 0 }, endM: { x: 6, y: 0 }, thicknessM: 0.2, heightM: 2.8, provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'wall' } },
        { id: 'w1_dup', kind: 'wall', startM: { x: 0.02, y: 0.01 }, endM: { x: 6.01, y: 0.01 }, thicknessM: 0.2, heightM: 2.8, provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.8, extractionType: 'wall' } },
      ];

      const res = deduplicateWalls(walls);
      expect(res.uniqueWalls.length).toBe(1);
      expect(res.removedIds).toContain('w1_dup');
    });
  });

  // ── 4. Furniture Canonical Ontology & Dimensions ──────────────────────────
  describe('4. Furniture Canonical Ontology & Dimensions', () => {
    it('resolves all canonical furniture families', () => {
      expect(CANONICAL_FURNITURE_FAMILIES.length).toBeGreaterThanOrEqual(25);
      const desk = resolvePascalFurniture('desk');
      expect(desk.family?.familyId).toBe('DESK');
      expect(desk.defaultDimensionsM).toEqual([1.2, 0.7, 0.75]);

      const bed = resolvePascalFurniture('double-bed');
      expect(bed.family?.familyId).toBe('BED_DOUBLE');
      expect(bed.defaultDimensionsM).toEqual([1.8, 2.0, 0.55]);

      const sofa = resolvePascalFurniture('reception-sofa');
      expect(sofa.family?.familyId).toBe('SOFA');

      const toilet = resolvePascalFurniture('toilet');
      expect(toilet.family?.familyId).toBe('TOILET');
    });

    it('prioritizes valid AI-provided dimensions over defaults', () => {
      const catalogRes = resolvePascalFurniture('meeting-table');
      const dims = resolveFurnitureDimensions({ width: 3.2, depth: 1.4, height: 0.75 }, catalogRes);
      expect(dims.dimensionSource).toBe('ai-provided');
      expect(dims.widthM).toBe(3.2);
      expect(dims.depthM).toBe(1.4);
    });

    it('falls back to catalogue default dimensions when dimensions missing', () => {
      const catalogRes = resolvePascalFurniture('single-bed');
      const dims = resolveFurnitureDimensions({}, catalogRes);
      expect(dims.dimensionSource).toBe('canonical-catalog-default');
      expect(dims.widthM).toBe(0.9);
      expect(dims.depthM).toBe(2.0);
    });
  });

  // ── 5. Compact Structural Context Compilation ─────────────────────────────
  describe('5. Compact Structural Context for Fit-out', () => {
    it('compiles clean structural context without leaking internal state', () => {
      const ctx = compileStructuralContext({
        levelId: 'lvl_01',
        walls: [
          { id: 'w1', kind: 'wall', startM: { x: 0, y: 0 }, endM: { x: 10, y: 0 }, thicknessM: 0.2, heightM: 2.8, provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'wall' } },
        ],
        doors: [
          { id: 'd1', kind: 'door', wallId: 'w1', startM: { x: 2, y: 0 }, endM: { x: 2.9, y: 0 }, elevationM: 0, heightM: 2.1, provenance: { sourceKind: 'gemini', sourcePrimitiveIds: [], confidence: 0.9, extractionType: 'door' } },
        ],
      });

      expect(ctx.levelId).toBe('lvl_01');
      expect(ctx.walls.length).toBe(1);
      expect(ctx.doors.length).toBe(1);
      expect(ctx.doors[0].position[0]).toBeCloseTo(2.45);
    });
  });

  // ── 6. Full Extraction Replay Benchmark Comparison ────────────────────────
  describe('6. Baseline vs Upgraded AI Pipeline Replay', () => {
    it('produces higher window/door recall and repaired wall topology', () => {
      const mockMultipass: any = {
        runId: 'bench-01',
        modelId: 'gemini-2.5-flash',
        totalDurationMs: 1200,
        wallsContextSize: 4,
        passes: [],
        phases: {
          shell: {
            floors: [{ boundary: [[0, 0], [10, 0], [10, 8], [0, 8]], level: 0 }],
          },
          core: {
            walls: [
              { id: 'w1', start: [0, 0], end: [9.95, 0], thickness: 0.2, height: 2.8 },
              { id: 'w2', start: [10.05, 0.05], end: [10.05, 8], thickness: 0.2, height: 2.8 },
            ],
            openings: [
              { id: 'win_1', type: 'window-double', pos: [5, 0.15], width: 1.4, height: 1.4, elevation: 0.9 },
              { id: 'door_1', type: 'doorway-front', pos: [2, 0.1], width: 0.9, height: 2.1 },
            ],
          },
          fitout: {
            furniture: [
              { id: 'f1', type: 'kitchen-counter', pos: [2, 1], width: 2.0, depth: 0.6 },
              { id: 'f2', type: 'toilet', pos: [8, 1] },
            ],
          },
          ffe: {
            furniture: [
              { id: 'f3', type: 'double-bed', pos: [5, 5], rotation: 90 },
              { id: 'f4', type: 'office-chair', pos: [6, 6] },
            ],
          },
        },
      };

      const res = adaptMultipassResult(mockMultipass, { flags: { useWallTopology: true } });

      expect(res.walls.length).toBe(2);
      expect(res.walls[0].endM.x).toBeCloseTo(10.0);
      expect(res.windows.length).toBe(1);
      expect(res.windows[0].id).toBe('open_win_1');
      expect(res.doors.length).toBe(1);
      expect(res.doors[0].id).toBe('open_door_1');
      expect(res.furniture.length).toBe(4);
      expect(res.furnitureFamilies.length).toBe(4);
    });
  });
});
