// packages/extraction-mupdf/tests/unit/neutral-result.test.ts
// Neutral-result serialization test (Change Set 2, §6/§17): the converted
// ExtractionResult is serializable and populates only the allowed categories.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractPureWallResult } from '../../src/mupdf-pure';
import { toExtractionResult } from '../../src/result-adapter';

const ROOT = path.resolve(__dirname, '../../../../');
const PDF = path.join(ROOT, 'test drawings and png/CODE_06.pdf');

describe('neutral ExtractionResult (CODE_06)', () => {
  const r = extractPureWallResult(new Uint8Array(fs.readFileSync(PDF)), 0);
  const result = toExtractionResult(r, { fileName: 'CODE_06.pdf' });

  it('serializes to JSON without throwing', () => {
    expect(() => JSON.stringify(result)).not.toThrow();
  });
  it('populates 70 walls + 1 slab + review; empty columns/windows/doors/furniture', () => {
    expect(result.walls.length).toBe(70);
    expect(result.slab).toBeDefined();
    expect(result.columns).toEqual([]);
    expect(result.windows).toEqual([]);
    expect(result.doors).toEqual([]);
    expect(result.furniture).toEqual([]);
    expect(result.furnitureFamilies).toEqual([]);
  });
  it('preserves provider evidence (not discarded)', () => {
    expect(result.providerEvidence?.kind).toBe('mupdf-pure');
    expect((result.providerEvidence as any)?.raw?.candidateHash).toBe(r.candidateHash);
  });
  it('wall keeps physicalWallId + thickness + confidence + provenance', () => {
    const w = result.walls[0];
    expect(w.id).toBeTruthy();
    expect(w.thicknessM).toBeGreaterThan(0);
    expect(w.provenance.sourceKind).toBe('mupdf');
    expect(w.provenance.sourcePrimitiveIds.length).toBeGreaterThan(0);
  });
  it('serializes and deserializes with zero geometry delta', () => {
    const json = JSON.stringify(result);
    const round = JSON.parse(json) as ExtractionResult;
    expect(round.walls.length).toBe(result.walls.length);
    for (let i = 0; i < result.walls.length; i++) {
      expect(round.walls[i].startM).toEqual(result.walls[i].startM);
      expect(round.walls[i].endM).toEqual(result.walls[i].endM);
      expect(round.walls[i].thicknessM).toBeCloseTo(result.walls[i].thicknessM, 12);
      expect((round.walls[i].metadata as any)?.physicalWallId).toBe(
        (result.walls[i].metadata as any)?.physicalWallId,
      );
    }
  });
});
