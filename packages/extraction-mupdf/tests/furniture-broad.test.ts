import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  collectPageVectors,
  detectFurniture,
  extractPureWallResult,
  furnitureTextsFromStructuredText,
  mupdf,
  type MuVector,
  type Vec2,
} from '../src/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// 1:100 on paper: mm of building per PDF point
const SCALE = (100 * 25.4) / 72;
const pt = (m: number) => m / (SCALE / 1000);
const O = { x: 100, y: 100 };

let nextId = 0;
function vec(
  commands: MuVector['commands'],
  layer?: string,
  extra: Partial<MuVector> = {},
): MuVector {
  const pts: Vec2[] = [];
  for (const c of commands as Array<Record<string, any>>) {
    if (c.op === 'M' || c.op === 'L') pts.push({ x: c.x, y: c.y });
    if (c.op === 'C') pts.push(c.p1, c.p2, c.p3);
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    id: `bv${nextId++}`,
    operation: 'stroke-path',
    commands,
    points: pts,
    subpaths: [pts],
    bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    color: [0, 0, 0],
    strokeWidthPt: 0.25,
    ...(layer !== undefined ? { layer } : {}),
    ...extra,
  };
}

const line = (a: Vec2, b: Vec2, layer?: string, extra?: Partial<MuVector>) =>
  vec([{ op: 'M', ...a }, { op: 'L', ...b }], layer, extra);

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  layer?: string,
  extra?: Partial<MuVector>,
): MuVector {
  const p = (dx: number, dy: number) => ({ x: O.x + pt(x + dx), y: O.y + pt(y + dy) });
  const a = p(0, 0);
  const b = p(w, 0);
  const c = p(w, h);
  const d = p(0, h);
  return vec([{ op: 'M', ...a }, { op: 'L', ...b }, { op: 'L', ...c }, { op: 'L', ...d }, { op: 'Z' }], layer, extra);
}

function oval(cx: number, cy: number, rx: number, ry: number, layer?: string, n = 20): MuVector {
  const cmds: MuVector['commands'] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const p = { x: O.x + pt(cx + rx * Math.cos(a)), y: O.y + pt(cy + ry * Math.sin(a)) };
    cmds.push(i === 0 ? { op: 'M', ...p } : { op: 'L', ...p });
  }
  cmds.push({ op: 'Z' });
  return vec(cmds, layer);
}

function chair(x: number, y: number, layer?: string): MuVector[] {
  const p = (dx: number, dy: number) => ({ x: O.x + pt(x + dx), y: O.y + pt(y + dy) });
  return [
    rect(x, y, 0.5, 0.5, layer),
    rect(x + 0.05, y + 0.12, 0.4, 0.33, layer),
    line(p(0, 0.1), p(0.5, 0.1), layer),
  ];
}

function doorSwing(hingeX: number, hingeY: number, rM: number, layer?: string): MuVector {
  const cx = O.x + pt(hingeX);
  const cy = O.y + pt(hingeY);
  const r = pt(rM);
  const k = 0.5523 * r;
  return vec(
    [
      { op: 'M', x: cx + r, y: cy },
      { op: 'C', p1: { x: cx + r, y: cy + k }, p2: { x: cx + k, y: cy + r }, p3: { x: cx, y: cy + r } },
    ],
    layer,
  );
}

describe('broad layerless furniture & symbol detection', () => {
  it('detects furniture, WC, bed with pillows, X-brace wardrobe, and dashed overhead kitchen counter without CAD layers', () => {
    const wallA = line({ x: O.x, y: O.y }, { x: O.x + pt(12), y: O.y }, undefined);
    const wallB = line({ x: O.x, y: O.y }, { x: O.x, y: O.y + pt(8) }, undefined);
    const claimed = new Set([wallA.id, wallB.id]);

    const vectors: MuVector[] = [
      wallA,
      wallB,
      // 1. WC with cistern + oval bowl (no layer)
      rect(1, 0.2, 0.38, 0.65),
      rect(1.01, 0.21, 0.36, 0.16),
      oval(1.19, 0.6, 0.16, 0.23),
      // 2. Double bed with 2 pillows (no layer)
      rect(3, 0.3, 1.8, 2.0),
      rect(3.15, 0.42, 0.65, 0.35),
      rect(4.0, 0.42, 0.65, 0.35),
      // 3. Wardrobe with X-brace (no layer)
      rect(6, 0.2, 1.5, 0.6),
      line({ x: O.x + pt(6), y: O.y + pt(0.2) }, { x: O.x + pt(7.5), y: O.y + pt(0.8) }),
      line({ x: O.x + pt(7.5), y: O.y + pt(0.2) }, { x: O.x + pt(6), y: O.y + pt(0.8) }),
      // 4. Kitchen counter with dashed overhead cabinet & sink cutout
      rect(8.5, 0.2, 2.4, 0.65),
      rect(8.55, 0.22, 2.3, 0.32, undefined, { dashes: [3, 2] }),
      rect(9.3, 0.3, 0.55, 0.42),
      // 5. Door swing arc anchored at wall (should be rejected)
      doorSwing(0.05, 2.0, 0.9),
      // 6. Parallel floor hatch cluster of 10 tight lines (should be rejected)
      ...Array.from({ length: 10 }, (_, i) =>
        line({ x: O.x + pt(1), y: O.y + pt(4 + i * 0.1) }, { x: O.x + pt(3), y: O.y + pt(4 + i * 0.1) }),
      ),
      // 7. Stray unlabelled plain box (clusterCount = 1, low confidence -> should be rejected)
      rect(10, 5, 1.1, 0.8),
    ];

    const res = detectFurniture({
      vectors,
      scaleMmPerPt: SCALE,
      walls: [
        { a: { x: O.x, y: O.y }, b: { x: O.x + pt(12), y: O.y }, t: pt(0.15) },
        { a: { x: O.x, y: O.y }, b: { x: O.x, y: O.y + pt(8) }, t: pt(0.15) },
      ],
      claimedVectorIds: claimed,
    });

    const subs = new Set(res.pieces.map((p) => p.subtype));
    expect(subs.has('wc')).toBe(true);
    expect(subs.has('double-bed')).toBe(true);
    expect(subs.has('wardrobe')).toBe(true);
    expect(subs.has('kitchen-counter')).toBe(true);

    const wc = res.pieces.find((p) => p.subtype === 'wc')!;
    expect(wc.sourceMode).toBe('broad');
    expect(wc.subParts?.some((sp) => sp.role === 'cistern')).toBe(true);
    expect(wc.subParts?.some((sp) => sp.role === 'cutout')).toBe(true);

    const bed = res.pieces.find((p) => p.subtype === 'double-bed')!;
    expect(bed.subParts?.filter((sp) => sp.role === 'pillow').length).toBe(2);

    const kitchen = res.pieces.find((p) => p.subtype === 'kitchen-counter')!;
    expect(kitchen.subParts?.some((sp) => sp.role === 'overhead' && sp.dashed)).toBe(true);
    expect(kitchen.customModel).toBe(true);

    // Door swing, hatch cluster, and stray single plain box should not leak in
    expect(res.pieces.length).toBe(4);
  });

  it('splits chairs pulled up to a rectangular conference table', () => {
    const vectors: MuVector[] = [
      rect(2, 2, 2.4, 1.0, 'A-FURN'),
      ...chair(2.3, 1.55, 'A-FURN'),
      ...chair(3.4, 1.55, 'A-FURN'),
      ...chair(2.3, 2.95, 'A-FURN'),
      ...chair(3.4, 2.95, 'A-FURN'),
    ];
    const res = detectFurniture({ vectors, scaleMmPerPt: SCALE });
    expect(res.pieces.filter((p) => p.kind === 'table')).toHaveLength(1);
    expect(res.pieces.filter((p) => p.kind === 'seat')).toHaveLength(4);
    const table = res.pieces.find((p) => p.kind === 'table')!;
    expect(table.subtype).toBe('meeting-table');
    expect(table.widthM).toBeCloseTo(2.4, 1);
  });

  it('accepts recurring layerless CAD blocks even when drawn as simple outlines (rules path)', () => {
    // 4 identical simple square stools (0.42 x 0.42) with no layer
    const vectors = [0, 1, 2, 3].map((i) => rect(1 + i * 1.2, 2, 0.42, 0.42));
    // `broad: 'rules'` is the cluster rule this case was written for. The default reader asks
    // more of bare outlines than repetition (see the next case).
    const res = detectFurniture({ vectors, scaleMmPerPt: SCALE, broad: 'rules' });
    // Simple 0.42m outlines have baseKind='side-table' & clusterCount=4 -> accepted!
    expect(res.pieces).toHaveLength(4);
    expect(res.pieces[0].clusterCount).toBe(4);
    expect(res.pieces[0].sourceMode).toBe('broad');
  });

  it('does not take bare repeated outlines for furniture on repetition alone (default reader)', () => {
    // The same four squares could as well be columns, plinths or floor boxes: with nothing
    // drawn in them, no label and no furniture beside them, the reader leaves them out.
    const vectors = [0, 1, 2, 3].map((i) => rect(1 + i * 1.2, 2, 0.42, 0.42));
    const res = detectFurniture({ vectors, scaleMmPerPt: SCALE });
    expect(res.pieces).toHaveLength(0);
    expect(res.diagnostics.broad?.candidates).toBe(4);
  });
});

function runPdfFurniture(relPath: string) {
  const full = path.join(REPO_ROOT, relPath);
  const bytes = new Uint8Array(fs.readFileSync(full));
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const page = doc.loadPage(0);
  const cap = collectPageVectors(page, false, 0);
  const wallRaw = extractPureWallResult(bytes, 0, undefined, undefined, true);
  const pure = wallRaw.pureResult;
  const accepted = pure.accepted ?? [];
  const xs = accepted.flatMap((w) => [w.centerline.a.x, w.centerline.b.x]);
  const ys = accepted.flatMap((w) => [w.centerline.a.y, w.centerline.b.y]);
  const m = 1 / (pure.scaleMmPerPt / 1000);
  const within: [number, number, number, number] | undefined =
    accepted.length >= 4
      ? [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m]
      : undefined;
  const claimed = new Set<string>();
  for (const w of accepted) {
    for (const id of w.sourceRootIds ?? []) claimed.add(String(id).split(':')[0]);
    for (const id of w.sourceSubpathIds ?? []) claimed.add(String(id).split(':')[0]);
    for (const id of w.sourceStrokeIds ?? []) claimed.add(String(id).split(':')[0]);
  }
  const texts = furnitureTextsFromStructuredText(page.toStructuredText('preserve-whitespace').asJSON());
  const walls = accepted
    .filter((w) => w?.centerline?.a && w?.centerline?.b)
    .map((w) => ({ a: w.centerline.a, b: w.centerline.b, t: w.thickness }));
  const result = detectFurniture({
    vectors: cap.vectors,
    scaleMmPerPt: pure.scaleMmPerPt,
    within,
    texts,
    walls,
    claimedVectorIds: claimed,
  });
  page.destroy();
  doc.destroy();
  return result;
}

describe('real architectural PDFs: broad + layered furniture extraction', () => {
  it('extracts furniture from layerless CODE_06.pdf without exploding on wall/hatch clutter', () => {
    const r = runPdfFurniture('test drawings and png/CODE_06.pdf');
    expect(r.pieces.length).toBeGreaterThanOrEqual(5);
    expect(r.pieces.length).toBeLessThanOrEqual(450);
    expect(r.pieces.every((p) => p.sourceMode === 'broad')).toBe(true);
    expect(r.diagnostics.ms).toBeLessThan(3000);
  });

  it('extracts furniture from layerless lambeth-cat-b-gf.pdf', () => {
    const r = runPdfFurniture('test drawings and png/fresh-glass/lambeth-cat-b-gf.pdf');
    expect(r.pieces.length).toBeGreaterThanOrEqual(10);
    expect(r.pieces.length).toBeLessThanOrEqual(800);
    expect(r.pieces.every((p) => p.sourceMode === 'broad')).toBe(true);
    expect(r.diagnostics.ms).toBeLessThan(4000);
  });

  it('preserves layered accuracy and enriches subtypes on kapiti-dwelling-govt-nz.pdf', () => {
    const r = runPdfFurniture('test drawings and png/fresh/kapiti-dwelling-govt-nz.pdf');
    expect(r.pieces.length).toBeGreaterThanOrEqual(10);
    expect(r.layers.length).toBeGreaterThanOrEqual(2);
    expect(r.pieces.some((p) => p.kind === 'sanitary')).toBe(true);
    expect(r.pieces.some((p) => p.subtype)).toBe(true);
  });

  it('extracts office furniture cleanly on carlow-proposed-interior.pdf and fitout-fusion-partitions.pdf', () => {
    const carlow = runPdfFurniture('test drawings and png/fresh-glass/carlow-proposed-interior.pdf');
    expect(carlow.pieces.length).toBeGreaterThanOrEqual(10);
    const fusion = runPdfFurniture('test drawings and png/fresh-glass/fitout-fusion-partitions.pdf');
    expect(fusion.pieces.length).toBeGreaterThanOrEqual(10);
  });

  it('preserves fbo-lounge.pdf extraction when fixture is present', () => {
    const full = path.join(REPO_ROOT, 'tmp/fbo-lounge.pdf');
    if (!fs.existsSync(full)) return;
    const fbo = runPdfFurniture('tmp/fbo-lounge.pdf');
    expect(fbo.pieces.length).toBeGreaterThanOrEqual(20);
    expect(fbo.pieces.some((p) => p.facing !== undefined)).toBe(true);
  });
});
