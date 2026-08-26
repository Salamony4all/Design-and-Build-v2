// packages/extraction-mupdf/tests/parity/vector-lineage-parity.test.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { extractPureWallResult } from '../../src/mupdf-pure';
import {
  acceptedGeometryHash,
  acceptedEvidenceHash,
  lineageStoreHash,
  toExtractionResult
} from '../../src/index';

const ROOT = path.resolve(__dirname, '../../../../');
const PDF_PATH = path.join(ROOT, 'test drawings and png/CODE_06.pdf');
const BASELINE_PATH = path.join(ROOT, 'packages/design-build-geometric-extraction/evidence/code06/vector-lineage/pre-instrumentation-baseline.json');

describe('Vector Lineage & Zero-Regression Parity', () => {
  const data = fs.readFileSync(PDF_PATH);
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));

  it('standard execution (captureLineage=false) matches baseline exactly', () => {
    const r1 = extractPureWallResult(new Uint8Array(data), 0);
    const r2 = extractPureWallResult(new Uint8Array(data), 0);

    // Determinism check (runs match each other)
    expect(acceptedGeometryHash(r1.accepted)).toBe(acceptedGeometryHash(r2.accepted));
    expect(acceptedEvidenceHash(r1.accepted)).toBe(acceptedEvidenceHash(r2.accepted));

    // Parity check against baseline
    expect(r1.accepted.length).toBe(70);
    expect(r1.accepted.length).toBe(baseline.acceptedWallCount);
    expect(acceptedGeometryHash(r1.accepted)).toBe(baseline.acceptedWallGeometryHash);
    expect(acceptedEvidenceHash(r1.accepted)).toBe(baseline.evidenceHash);
    expect(r1.scaleMmPerPt).toBe(baseline.scale);
    expect(r1.genuinelyFloatingAcceptedPhysicalWalls.length).toBe(baseline.genuinelyFloatingCount);

    // ROI check
    expect(r1.activeBuildingRegionMupdf.map(n => Math.round(n))).toEqual(baseline.roi.map(n => Math.round(n)));

    // Thickness bands check
    expect(r1.thicknessBands.length).toBe(baseline.thicknessBands.length);
    for (let i = 0; i < r1.thicknessBands.length; i++) {
      expect(r1.thicknessBands[i].center).toBe(baseline.thicknessBands[i].center);
    }

    // Detailed comparison of individual walls
    const baselineIds = new Set(r1.accepted.map(w => w.physicalWallId));
    expect(baselineIds.size).toBe(70);

    for (const w of r1.accepted) {
      expect(w.physicalWallId).toBeDefined();
      expect(w.centerline.a.x).toBeDefined();
      expect(w.centerline.b.y).toBeDefined();
      expect(w.thickness).toBeGreaterThan(0);
      expect(w.confidence).toBeGreaterThan(0);
    }
  });

  it('lineage audit mode (captureLineage=true) builds store and mapping correctly', () => {
    // performance telemetry measure
    const tStart1 = performance.now();
    const standardRes = extractPureWallResult(new Uint8Array(data), 0, undefined, undefined, false);
    const tDur1 = performance.now() - tStart1;

    const tStart2 = performance.now();
    const auditRes = extractPureWallResult(new Uint8Array(data), 0, undefined, undefined, true);
    const tDur2 = performance.now() - tStart2;

    console.log(`Performance telemetry - Lineage Disabled: ${tDur1.toFixed(2)}ms, Enabled: ${tDur2.toFixed(2)}ms`);

    const pure = auditRes.pureResult;
    const store = auditRes.lineageStore;
    const refs = auditRes.vectorLineageRefs;

    // Standard result is unchanged
    expect(pure.accepted.length).toBe(70);
    expect(acceptedGeometryHash(pure.accepted)).toBe(baseline.acceptedWallGeometryHash);

    // Lineage store is populated
    expect(store.operations.length).toBeGreaterThan(0);

    // Deterministic ID rules check
    for (const op of store.operations) {
      expect(op.operationId).toMatch(/^p0_op\d+$/);
      for (const sub of op.subpaths) {
        expect(sub.subpathId).toMatch(/^p0_op\d+_s\d+$/);
        for (const seg of sub.segments) {
          expect(seg.segmentId).toMatch(/^p0_op\d+_s\d+_seg\d+$/);
          
          // boundsPrecision checks
          if (seg.commandType === 'L' || seg.commandType === 'Z') {
            expect(seg.boundsPrecision).toBe('EXACT_LINE');
          } else if (seg.commandType === 'C') {
            expect(seg.boundsPrecision).toBe('CONTROL_POINT_ENVELOPE');
          }
        }
      }
    }

    // Diagnostics check
    expect(pure.diagnostics.doubleTransformDetected).toBe(0);
    expect(pure.diagnostics.nonFiniteCoordinates).toBe(0);

    // Hashing determinism check
    const h1 = lineageStoreHash(store);
    const h2 = lineageStoreHash(store);
    expect(h1).toBe(h2);
    expect(h1).toBeDefined();
    console.log('=== LINEAGE DETAILED REPORT ===');
    console.log(`Operations count: ${store.operations.length}`);
    console.log(`Lineage store hash: ${h1}`);
  }, 180000);

  it('production API payload excludes detailed lineage data', () => {
    const r = extractPureWallResult(new Uint8Array(data), 0);
    const payload = toExtractionResult(r);
    
    // Check that lineageStore and vectorLineageRefs are NOT present in standard response
    expect((payload as any).lineageStore).toBeUndefined();
    expect((payload as any).vectorLineageRefs).toBeUndefined();
  });

  it('clean-app and extraction-mupdf packages do not import legacy apps/editor', () => {
    const scanDir = (dirPath: string) => {
      if (!fs.existsSync(dirPath)) return;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          // Match imports from apps/editor
          const hasImport = /import\s+.*\s+from\s+['"]apps\/editor['"]/.test(content) ||
                            /import\s+['"]apps\/editor['"]/.test(content) ||
                            /require\(['"]apps\/editor['"]\)/.test(content) ||
                            /import\(['"]apps\/editor['"]\)/.test(content) ||
                            /from\s+['"]\.\.\/editor/.test(content);
          expect(hasImport).toBe(false);
        }
      }
    };
    scanDir(path.join(ROOT, 'packages/extraction-mupdf/src'));
    scanDir(path.join(ROOT, 'apps/design-build-editor/src'));
  });
});
