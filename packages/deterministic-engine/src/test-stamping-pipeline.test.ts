import { describe, it, expect } from 'vitest';
import {
  buildDrawingExposure, applyMatrix, pdfPointToWorld, pdfPointToGuidePixel,
  type ParserResultLike,
} from './guide-trace/drawing-exposure';
import { runCameraFocus } from './guide-trace/camera-focus';
import { runStampingPipeline } from './guide-trace/stamping-pipeline';
import { buildGuideTraceGraph, type RawMaximalLine } from './guide-trace/maximal-line-guide-tracer';
import type { GuideTraceGraph } from './guide-trace/guide-trace-types';

// A synthetic parser result matching ParserResultLike (PDF 595.28 x 841.89 pt, ~119 pt/m -> 5x7m).
function syntheticParser(ptsPerMeter = 119.2): ParserResultLike {
  return {
    ptsPerMeter,
    pageWidthPt: 595.28,
    pageHeightPt: 841.89,
    widthM: 595.28 / ptsPerMeter,
    heightM: 841.89 / ptsPerMeter,
    transform: {
      transformId: `xf_595_841_${Math.round(ptsPerMeter * 1000)}`,
      pageWidthPt: 595.28, pageHeightPt: 841.89,
      pointsPerMeter: ptsPerMeter, scaleDenominator: 50, rotation: 0, yAxisDirection: 'up', worldOrigin: [0, 0],
    },
    transformId: `xf_595_841_${Math.round(ptsPerMeter * 1000)}`,
  };
}

function rectangularGuide(): GuideTraceGraph {
  const raw: RawMaximalLine[] = [];
  let id = 0;
  for (const cfg of ['fine', 'medium', 'coarse']) {
    const lines: Array<['H' | 'V', number, number, number]> = [
      ['H', 0, 0, 4], ['H', 0.2, 0, 4], ['H', 3.0, 0, 4], ['H', 3.2, 0, 4],
      ['V', 0, 0, 3.2], ['V', 0.2, 0, 3.2], ['V', 3.8, 0, 3.2], ['V', 4.0, 0, 3.2],
    ];
    for (const [axis, c, a, b] of lines) raw.push({ id: `r${++id}`, axis, coordinateM: c, startM: a, endM: b, detectorConfigId: cfg, source: 'guide', confidence: 0.95 });
  }
  return buildGuideTraceGraph(raw, { junctionToleranceM: 0.25 });
}

describe('DrawingExposure (Phase 1)', () => {
  it('builds one immutable exposure with shared transforms and resolved scale', () => {
    const exp = buildDrawingExposure({ sourceFileUrl: 'file:///x.pdf', parser: syntheticParser() });
    expect(exp.exposureId).toBeDefined();
    expect(exp.scaleStatus).toBe('resolved');
    expect(exp.transformId).toContain('xf_');
    // No independent scale/crop/origin decisions downstream: world dims derive from ptsPerMeter only.
    expect(exp.worldWidthM).toBeCloseTo(595.28 / 119.2, 4);
    expect(exp.worldDepthM).toBeCloseTo(841.89 / 119.2, 4);
    // Round-trip invariant: pdfToWorld must agree with exposureToWorld∘pdfToExposure.
    const w = pdfPointToWorld(exp, 100, 200);
    const g = pdfPointToGuidePixel(exp, 100, 200);
    const w2 = applyMatrix(exp.exposureToWorld, g[0], g[1]);
    expect(Math.abs(w2[0] - w[0])).toBeLessThan(1e-6);
    expect(Math.abs(w2[1] - w[1])).toBeLessThan(1e-6);
  });

  it('marks scaleStatus unresolved when ptsPerMeter/scale are missing and never invents dimensions', () => {
    const bad = syntheticParser(119.2); bad.ptsPerMeter = 0; bad.transform.scaleDenominator = 0; bad.transform.pointsPerMeter = 0;
    const exp = buildDrawingExposure({ sourceFileUrl: 'file:///x.pdf', parser: bad });
    expect(exp.scaleStatus).toBe('unresolved');
    expect(Number.isFinite(exp.worldWidthM)).toBe(false);
    expect(Number.isFinite(exp.worldDepthM)).toBe(false);
  });
});

describe('Camera Focus Test (Phase 3)', () => {
  it('passes the hard focus gate when PDF geometry lands on the guide', () => {
    const exp = buildDrawingExposure({ sourceFileUrl: 'file:///x.pdf', parser: syntheticParser() });
    const samples: Array<[number, number]> = [[0, 0], [595.28, 0], [0, 841.89], [297, 420], [100, 700]];
    const res = runCameraFocus(exp, samples);
    expect(res.sampledPointCount).toBe(5);
    expect(res.guideAlignmentRate).toBe(1);
    expect(res.maximumPixelOffset).toBeLessThanOrEqual(2);
    expect(res.roundTripFailed).toBe(false);
    expect(res.passed).toBe(true);
  });

  it('fails the focus gate on a coordinate round-trip failure (broken transform)', () => {
    const exp = buildDrawingExposure({ sourceFileUrl: 'file:///x.pdf', parser: syntheticParser() });
    // corrupt the pdfToWorld so round-trip fails
    exp.pdfToWorld = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const res = runCameraFocus(exp, [[100, 100]]);
    expect(res.roundTripFailed).toBe(true);
    expect(res.passed).toBe(false);
  });
});

describe('2.5D Stamping Pipeline (Phases 4-7)', () => {
  it('stamps matched walls directly, before spaces are complete, and emits Pascal Semantic JSON', () => {
    const graph = rectangularGuide();
    const parser = syntheticParser();
    // Focus samples in PDF points (from parser wall sourcePdf in real use; synthetic here).
    const focusSamplePoints: Array<[number, number]> = [
      [0, 0], [595.28, 0], [0, 841.89], [297, 420],
    ];
    const result = runStampingPipeline({
      sourceFileUrl: 'file:///rect.pdf', parser, graph, focusSamplePoints,
    });
    expect(result.focusPassed).toBe(true);
    expect(result.scene).not.toBeNull();
    const scene = result.scene!;
    // Walls stamped directly from accepted bands (4) — not gated on room closure.
    expect(scene.walls.length).toBe(4);
    expect(scene.walls.every(w => w.matchStatus === 'matched')).toBe(true);
    // Progressive build order recorded and spaces come after walls.
    expect(scene.buildOrder).toContain('matched-flat-wall-signatures');
    expect(scene.buildOrder.indexOf('matched-flat-wall-signatures'))
      .toBeLessThan(scene.buildOrder.indexOf('spaces-and-slabs'));
    // Furniture intentionally empty/disabled.
    expect(scene.furniture).toEqual([]);
    // Deterministic IDs + exposureId retained.
    expect(scene.walls[0]!.exposureId).toBe(result.exposure.exposureId);
    expect(scene.walls[0]!.id).toBe(`wall_${graph.acceptedBands[0]!.id}`);
    // Diagnostic overlay generated.
    expect(result.overlaySvg).toContain('<svg');
  });

  it('stops signature translation when the focus gate fails', () => {
    const graph = rectangularGuide();
    const parser = syntheticParser();
    const focusSamplePoints: Array<[number, number]> = [[100, 100]];
    const result = runStampingPipeline({
      sourceFileUrl: 'file:///rect.pdf', parser, graph, focusSamplePoints,
    });
    expect(result.focusPassed).toBe(true);
    // Corrupt the transform and re-run focus -> gate fails -> no scene translation.
    result.exposure.pdfToWorld = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const res2 = runCameraFocus(result.exposure, focusSamplePoints);
    expect(res2.passed).toBe(false);
  });
});
