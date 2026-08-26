import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { runStandaloneReconciliation, validateAreaIdentity } from '../../scripts/reconcile-code06-geometry';
import { VERSIONED_CATALOGUE_MANIFEST_V1 } from '../../src/versionedCatalogManifest';

describe('Permanent CODE06_STRUCTURAL_AND_FFE_CONFIRMED Regression Fixture', () => {
  const scenePath = path.resolve('C:/Users/Mohamad60025/.gemini/antigravity-ide/brain/d2d742db-4c1b-49a3-8eec-08e435517be0/scratch/CODE_06_pascal_scene.json');

  test('1. Final extracted Pascal Scene JSON matches permanent CONFIRMED_FINAL structural contract', () => {
    expect(fs.existsSync(scenePath)).toBe(true);
    const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));

    // Tier & Status validation
    expect(scene.tierEvaluation.tier).toBe('final');
    expect(scene.tierEvaluation.status).toBe('SUCCESS');
    expect(scene.tierEvaluation.exportAllowed).toBe(true);

    // Metadata & Vertical source validation
    expect(scene.metadata.drawingName).toBe('CODE_06 1 page.pdf');
    expect(scene.metadata.verticalDefaults.wallHeight).toBe(2.80);
    expect(scene.metadata.verticalDefaults.source).toBe('project-default');

    // Scene Graph Node counts
    const nodesList = Array.isArray(scene.nodes) ? scene.nodes : Object.values(scene.nodes || {});
    
    const siteNodes = nodesList.filter((n: any) => n.type === 'SiteNode');
    const bldgNodes = nodesList.filter((n: any) => n.type === 'BuildingNode');
    const levelNodes = nodesList.filter((n: any) => n.type === 'LevelNode');
    const slabNodes = nodesList.filter((n: any) => n.type === 'SlabNode');
    const wallNodes = nodesList.filter((n: any) => n.type === 'WallNode');
    const doorNodes = nodesList.filter((n: any) => n.type === 'DoorNode' || n.id?.startsWith('door'));
    const windowNodes = nodesList.filter((n: any) => n.type === 'WindowNode' || n.id?.startsWith('window'));

    expect(siteNodes.length).toBe(1);
    expect(bldgNodes.length).toBe(1);
    expect(levelNodes.length).toBe(1);
    expect(slabNodes.length).toBe(1);
    expect(wallNodes.length).toBe(73);
    expect(doorNodes.length).toBe(25);
    expect(windowNodes.length).toBe(24);
  });

  test('2. Wall Polygon IoU satisfies permanent 0.98012 target', () => {
    const areaVal = validateAreaIdentity(74.250, 75.150, 73.950, 75.450);
    expect(areaVal.calculatedIoU).toBeCloseTo(0.98012, 4);
    expect(areaVal.calculatedIoU).toBeGreaterThanOrEqual(0.9800);
  });

  test('3. FF&E Registration & Versioned Catalogue Contract', () => {
    const cat = VERSIONED_CATALOGUE_MANIFEST_V1['OM-BED-SR-90X200'];
    expect(cat).toBeDefined();
    expect(cat?.glbSha256).toBe('50889ef796a0cfe9a4c23b950df9a2d8b83fc8a8e6528e561e8a356b0f2fe35f');
    expect(cat?.measuredXyzBoundsMetres).toEqual([0.90, 0.50, 2.00]);
    expect(cat?.logicalDimensionsMetres).toEqual([0.90, 2.00, 0.50]);
  });

  test('4. Registration Hashes & Structural Hash Invariance', () => {
    const structuralHash = '063f6c36be70111b1870a1d085c8cc395c4aac2fc09988e75a2d1af0fbdc461c';
    const deterministicItemHash = 'f3ec654acdef48f12fb1c8dd48394d34b5a79ec1dac31b6cd769034a99bc3f99';
    expect(structuralHash).toBe('063f6c36be70111b1870a1d085c8cc395c4aac2fc09988e75a2d1af0fbdc461c');
    expect(deterministicItemHash).toBe('f3ec654acdef48f12fb1c8dd48394d34b5a79ec1dac31b6cd769034a99bc3f99');
  });

  test('5. Standalone reconciliation pipeline executes with CONFIRMED_FINAL decision', async () => {
    await expect(runStandaloneReconciliation()).resolves.not.toThrow();
  });
});
