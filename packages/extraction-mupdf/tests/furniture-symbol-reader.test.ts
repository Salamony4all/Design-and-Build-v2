// Layer-free furniture reading: residual linework, plain rules, the model's word with
// the pen weighed in, and what becomes of each piece (known, unknown custom item, nothing).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  collectPageVectors,
  decideBroadPiece,
  detectFurniture,
  extractPureWallResult,
  furnitureTextsFromStructuredText,
  mupdf,
  notFurniture,
  penKey,
  predictSymbol,
  readSymbols,
  residualScene,
  SYMBOL_CLASSES,
  SYMBOL_FEATURES,
  SYMBOL_MODEL,
  SYMBOL_READER_DEFAULTS,
  type MuVector,
  type SymbolFeature,
  type SymbolModel,
  type SymbolPiece,
  type SymbolVerdict,
  type Vec2,
} from '../src/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// 1:100 on paper: mm of building per PDF point
const SCALE = (100 * 25.4) / 72;
const pt = (m: number) => m / (SCALE / 1000);

let nextId = 0;
function stroke(points: Vec2[], extra: Partial<MuVector> = {}): MuVector {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return {
    id: `sr${nextId++}`,
    operation: 'stroke-path',
    commands: points.map((p, i) => ({ op: i === 0 ? 'M' : 'L', ...p })) as MuVector['commands'],
    points,
    subpaths: [points],
    bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    color: [0, 0, 0],
    strokeWidthPt: 0.25,
    ...extra,
  };
}
const box = (x: number, y: number, w: number, h: number, extra: Partial<MuVector> = {}) =>
  stroke([{ x: pt(x), y: pt(y) }, { x: pt(x + w), y: pt(y) }, { x: pt(x + w), y: pt(y + h) }, { x: pt(x), y: pt(y + h) }, { x: pt(x), y: pt(y) }], extra);

/** Measures in SYMBOL_FEATURES order, from a few named ones. */
function measures(named: Partial<Record<SymbolFeature, number>>): number[] {
  const base: Partial<Record<SymbolFeature, number>> = { widthM: 1.2, depthM: 0.6, busy: 2.5, strokes: 6, wallGapM: 3 };
  return SYMBOL_FEATURES.map((k) => named[k] ?? base[k] ?? 0);
}

describe('residual linework', () => {
  it('names a pen by colour and weight', () => {
    expect(penKey({ color: [0, 0, 0], strokeWidthPt: 0.25 })).toBe(penKey({ color: [0, 0, 0], strokeWidthPt: 0.25 }));
    expect(penKey({ color: [1, 0, 0], strokeWidthPt: 0.25 })).not.toBe(penKey({ color: [0, 0, 0], strokeWidthPt: 0.25 }));
    expect(penKey({ color: [0, 0, 0], strokeWidthPt: 0.7 })).not.toBe(penKey({ color: [0, 0, 0], strokeWidthPt: 0.25 }));
  });

  it('leaves what no other stage explains, one stroke per subpath, the pen as its layer', () => {
    const chair = box(2, 2, 0.5, 0.5, { color: [0, 0, 1] });
    const claimed = box(4, 2, 0.5, 0.5);
    const dashed = box(6, 2, 0.6, 0.6, { dashes: [3, 2] } as Partial<MuVector>);
    const grid = stroke([{ x: pt(0), y: pt(5) }, { x: pt(12), y: pt(5) }]);
    const onDoorLayer = box(8, 2, 0.5, 0.5, { layer: 'A-DOOR' });
    const scene = residualScene({
      vectors: [chair, claimed, dashed, grid, onDoorLayer],
      scaleMmPerPt: SCALE,
      claimedVectorIds: new Set([claimed.id]),
      skipLayer: (layer) => /door/i.test(layer),
    });
    expect(scene.strokes.map((s) => s.sourceVectorId)).toEqual([chair.id]);
    expect(scene.strokes[0].layer).toBe(penKey(chair));
    expect(scene.dashed.map((s) => s.sourceVectorId)).toEqual([dashed.id]);
    expect(scene.longLines).toHaveLength(1);
    expect(scene.setAside.claimed).toBe(1);
    expect(scene.setAside.layer).toBe(1);
  });
});

describe('plain rules', () => {
  it('lets a furnished-looking piece through', () => {
    expect(notFurniture(measures({}))).toBeNull();
  });

  it('drops slivers, unless a label beside them names furniture', () => {
    const thin = measures({ depthM: 0.05 });
    expect(notFurniture(thin)).toBe('sliver');
    expect(notFurniture(thin, { label: 'WALL ART' })).toBeNull();
  });

  it('drops tags: a bare outline around text, or a small symbol around a number', () => {
    expect(notFurniture(measures({ busy: 1, strokes: 1, textInside: 1 }), { insideText: 'STORE' })).toBe('tag');
    expect(notFurniture(measures({ widthM: 0.4, depthM: 0.38, textInside: 1 }), { insideText: 'DT 03' })).toBe('tag');
    // text that names furniture is a label, and letters in a furnished piece are not a tag
    expect(notFurniture(measures({ busy: 1, strokes: 1, textInside: 1 }), { insideText: 'SOFA' })).toBeNull();
    expect(notFurniture(measures({ widthM: 0.6, depthM: 0.6, textInside: 1 }), { insideText: 'WM' })).toBeNull();
  });

  it('drops columns, walled cells, shafts and stairs', () => {
    expect(notFurniture(measures({ widthM: 0.5, depthM: 0.5, wallOverlap: 0.5 }))).toBe('column');
    expect(notFurniture(measures({ widthM: 1.9, depthM: 1.5, wallSides: 4 }))).toBe('walled space');
    expect(notFurniture(measures({ widthM: 2, depthM: 1.6, crossed: 1, busy: 4 }))).toBe('shaft');
    expect(notFurniture(measures({ widthM: 3, depthM: 1.1, parallelRun: 12 }))).toBe('stair or hatching');
    // a braced wardrobe is crossed too, but shallow
    expect(notFurniture(measures({ widthM: 1.5, depthM: 0.6, crossed: 1, busy: 1.8 }))).toBeNull();
  });
});

/** A one-tree forest: busy linework is furniture (0.9), plain linework less so (0.5), bare outlines not (0.1). */
function toyModel(context?: SymbolModel['context']): SymbolModel {
  const busy = SYMBOL_FEATURES.indexOf('busy');
  const leaf = (p: number) => new Float32Array([1 - p, p, 0, 0, 0, 0]);
  const none = new Float32Array(6);
  return {
    version: 'toy',
    classes: [...SYMBOL_CLASSES],
    features: [...SYMBOL_FEATURES],
    trees: [{
      feature: new Int8Array([busy, -1, busy, -1, -1]),
      threshold: new Float32Array([1.5, 0, 3, 0, 0]),
      left: new Int16Array([1, -1, 3, -1, -1]),
      right: new Int16Array([2, -1, 4, -1, -1]),
      value: [none, leaf(0.1), none, leaf(0.5), leaf(0.9)],
    }],
    ...(context ? { context } : {}),
  };
}

function piece(x: number, y: number, w: number, d: number, busy: number, pen: string): SymbolPiece {
  const v = box(x, y, w, d);
  const outline = v.points.slice(0, 4);
  return {
    outline, hull: outline, center: { x: pt(x + w / 2), y: pt(y + d / 2) }, widthM: w, depthM: d, angle: 0,
    areaM2: w * d, perimM: 2 * (w + d), inkM: busy * 2 * (w + d), fill: 1, solidity: 1, circularity: 0.7, corners: 4,
    busy, bandM: d, shape: 'rect', isTop: false, lines: [v.points], vectors: [{ ...v, layer: pen }], pen,
  };
}

describe('the model and the pen', () => {
  const scene = residualScene({ vectors: [], scaleMmPerPt: SCALE });

  it('reads a forest: the mean of the leaves the measures fall in', () => {
    const model = toyModel();
    expect(predictSymbol(model, measures({ busy: 4 }))[1]).toBeCloseTo(0.9, 5);
    expect(predictSymbol(model, measures({ busy: 2 }))[1]).toBeCloseTo(0.5, 5);
    expect(predictSymbol(model, measures({ busy: 1 }))[0]).toBeCloseTo(0.9, 5);
  });

  it('ships a trained forest in step with the reader', () => {
    expect(SYMBOL_MODEL.trees.length).toBeGreaterThan(10);
    expect(SYMBOL_MODEL.classes).toEqual([...SYMBOL_CLASSES]);
    expect(SYMBOL_MODEL.features).toEqual([...SYMBOL_FEATURES]);
    expect(SYMBOL_MODEL.context).toBeDefined();
    const p = predictSymbol(SYMBOL_MODEL, measures({}));
    expect(p.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 2);
  });

  it('weighs a piece with the other pieces of its pen', () => {
    // four doubtful pieces: one drawn in the pen of three sure ones, three in a pen that draws only bare outlines
    const pieces = [
      piece(0, 0, 1.6, 0.8, 4, 'furniture pen'), piece(5, 0, 1.2, 0.7, 4, 'furniture pen'), piece(10, 0, 2.0, 0.9, 4, 'furniture pen'),
      piece(15, 0, 1.4, 0.75, 2, 'furniture pen'),
      piece(0, 8, 1.0, 0.5, 1, 'other pen'), piece(5, 8, 1.3, 0.6, 1, 'other pen'), piece(10, 8, 1.7, 0.65, 1, 'other pen'),
      piece(15, 8, 1.45, 0.72, 2, 'other pen'),
    ];
    const alone = readSymbols(pieces, scene, [], toyModel());
    expect(alone[3].p).toBeCloseTo(alone[7].p, 5);
    const withPen = readSymbols(pieces, scene, [], toyModel({ bias: 0, own: 1, pen: 2, shrink: 3 }));
    expect(withPen[3].ownP).toBeCloseTo(0.5, 5);
    expect(withPen[3].penP).toBeGreaterThan(withPen[7].penP);
    expect(withPen[3].p).toBeGreaterThan(0.6);
    expect(withPen[7].p).toBeLessThan(0.4);
  });

  it('shares one answer between the copies of a block and sees who stands beside whom', () => {
    const pieces = [piece(0, 0, 1.6, 0.8, 4, 'a'), piece(1.8, 0, 0.5, 0.5, 2, 'a'), piece(20, 0, 0.5, 0.5, 2, 'a')];
    const v = readSymbols(pieces, scene, [], toyModel());
    expect(v[1].copy).toBe(v[2].copy);
    expect(v[1].repeats).toBe(1);
    expect(v[1].p).toBeCloseTo(v[2].p, 5);
    expect(v[1].besideP).toBeCloseTo(0.9, 5);
    expect(v[2].besideP).toBe(0);
  });

  it('never asks the model about a piece a rule dropped', () => {
    const v = readSymbols([piece(0, 0, 1.2, 0.05, 4, 'a')], scene, [], toyModel());
    expect(v[0].rejected).toBe('sliver');
    expect(v[0].p).toBe(0);
  });
});

describe('what becomes of a piece', () => {
  const verdict = (over: Partial<SymbolVerdict>): SymbolVerdict => ({
    x: [], rejected: null, probs: [], ownP: 0.5, penP: 0.5, p: 0.5, besideP: 0, family: 'furniture', repeats: 0, copy: 0, plain: false, ...over,
  });
  const some = { classified: true, grammar: false, named: false, thin: false };

  it('keeps nothing a rule dropped', () => {
    expect(decideBroadPiece({ ...some, verdict: verdict({ rejected: 'tag', p: 0 }) })).toBeNull();
  });

  it('keeps a known kind on the model\'s word', () => {
    expect(decideBroadPiece({ ...some, verdict: verdict({ p: 0.8 }) })).toBe('known');
    expect(decideBroadPiece({ ...some, verdict: verdict({ p: 0.55 }) })).toBeNull();
  });

  it('lets the grammar\'s own parts or a label vouch for a piece the model doubts', () => {
    expect(decideBroadPiece({ ...some, grammar: true, verdict: verdict({ p: 0.2 }) })).toBe('known');
    expect(decideBroadPiece({ ...some, named: true, verdict: verdict({ p: 0.2 }) })).toBe('known');
    expect(decideBroadPiece({ ...some, named: true, verdict: verdict({ p: 0.02 }) })).toBeNull();
  });

  it('asks more of a bare single outline, and less of a piece beside a sure one', () => {
    const cfg = SYMBOL_READER_DEFAULTS;
    const between = (cfg.minFamilyP + cfg.minAloneP) / 2;
    expect(decideBroadPiece({ ...some, verdict: verdict({ p: between, plain: true }) })).toBeNull();
    expect(decideBroadPiece({ ...some, verdict: verdict({ p: between, plain: true, repeats: 2 }) })).toBe('known');
    const leaning = (cfg.minBesideP + cfg.minFamilyP) / 2;
    expect(decideBroadPiece({ ...some, verdict: verdict({ p: leaning }) })).toBeNull();
    expect(decideBroadPiece({ ...some, verdict: verdict({ p: leaning, besideP: 0.9 }) })).toBe('known');
    expect(decideBroadPiece({ ...some, verdict: verdict({ p: leaning, besideP: 0.9, plain: true, repeats: 3 }) })).toBeNull();
  });

  it('keeps furniture no kind fits as an unknown custom item', () => {
    expect(decideBroadPiece({ ...some, classified: false, verdict: verdict({ p: 0.9 }) })).toBe('custom');
    expect(decideBroadPiece({ ...some, classified: false, verdict: verdict({ p: 0.62 }) })).toBeNull();
    // too thin to stand as a piece of its own; a kind that fits is kept all the same
    expect(decideBroadPiece({ ...some, classified: false, thin: true, verdict: verdict({ p: 0.9 }) })).toBeNull();
    expect(decideBroadPiece({ ...some, thin: true, verdict: verdict({ p: 0.9 }) })).toBe('known');
  });
});

function readPdf(relPath: string, pageIndex = 0) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(REPO_ROOT, relPath)));
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const page = doc.loadPage(pageIndex);
  const cap = collectPageVectors(page, false, pageIndex);
  const pure = extractPureWallResult(bytes, pageIndex, undefined, undefined, true).pureResult;
  const accepted = (pure.accepted ?? []).filter((w) => w?.centerline?.a && w?.centerline?.b);
  const xs = accepted.flatMap((w) => [w.centerline.a.x, w.centerline.b.x]);
  const ys = accepted.flatMap((w) => [w.centerline.a.y, w.centerline.b.y]);
  const m = 1 / (pure.scaleMmPerPt / 1000);
  const within: [number, number, number, number] | undefined = accepted.length >= 4 ? [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m] : undefined;
  const claimed = new Set<string>();
  for (const w of accepted as Array<{ sourceRootIds?: string[]; sourceSubpathIds?: string[]; sourceStrokeIds?: string[] }>) {
    for (const id of [...(w.sourceRootIds ?? []), ...(w.sourceSubpathIds ?? []), ...(w.sourceStrokeIds ?? [])]) claimed.add(String(id).split(':')[0]);
  }
  const texts = furnitureTextsFromStructuredText(page.toStructuredText('preserve-whitespace').asJSON());
  const walls = accepted.map((w) => ({ a: w.centerline.a, b: w.centerline.b, t: w.thickness }));
  const result = detectFurniture({ vectors: cap.vectors, scaleMmPerPt: pure.scaleMmPerPt, within, texts, walls, claimedVectorIds: claimed });
  page.destroy();
  doc.destroy();
  return result;
}
const has = (relPath: string) => fs.existsSync(path.join(REPO_ROOT, relPath));

describe('layer-free drawings', () => {
  it('reads the beds, chairs and sanitary ware of CODE_06 and little else', () => {
    const r = readPdf('test drawings and png/CODE_06.pdf');
    expect(r.diagnostics.broad?.model).toBe(SYMBOL_MODEL.version);
    expect(r.pieces.filter((p) => p.kind === 'bed').length).toBeGreaterThanOrEqual(15);
    expect(r.pieces.filter((p) => p.kind === 'sanitary').length).toBeGreaterThanOrEqual(6);
    expect(r.pieces.length).toBeGreaterThanOrEqual(60);
    expect(r.pieces.length).toBeLessThanOrEqual(160);
    // every piece carries the model's trust in it, and its page vectors as root ids
    expect(r.pieces.every((p) => typeof p.furnitureP === 'number' && p.vectorIds.every((id) => !id.includes(':')))).toBe(true);
    // unknown custom items, if any, are built from their own outline
    expect(r.pieces.filter((p) => p.kind === 'unknown').every((p) => p.customModel === true && p.sourceMode === 'broad')).toBe(true);
  });

  it('does not furnish a partition setting-out plan with its dimension lines and tags', () => {
    const rel = 'test drawings and png/fresh-glass/lambeth-cat-b-1f.pdf';
    if (!has(rel)) return;
    const r = readPdf(rel);
    expect(r.diagnostics.broad?.candidates ?? 0).toBeGreaterThan(200);
    expect(r.pieces.length).toBeLessThanOrEqual(25);
  });

  it('reads nothing off a sheet that is no floor plan at the scale given', () => {
    const vectors = [0, 1, 2, 3, 4, 5].map((i) => box(0.2 * i, 0.1, 0.15, 0.1));
    const r = detectFurniture({ vectors, scaleMmPerPt: SCALE });
    expect(r.pieces).toHaveLength(0);
    expect(r.diagnostics.broad?.skipped).toBe('scale');
  });
});
