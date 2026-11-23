import { describe, expect, it } from 'vitest';
import type { MuVector, Vec2 } from '../src/vector-device';
import { classifyPiece, detectFurniture, isFurnitureLayer } from '../src/furniture-blocks';

// 1:100 on paper: mm of building per PDF point
const SCALE = 100 * 25.4 / 72;
const pt = (m: number) => m / (SCALE / 1000);

let nextId = 0;
function vec(commands: MuVector['commands'], layer: string): MuVector {
  const pts: Vec2[] = [];
  for (const c of commands as Array<Record<string, any>>) {
    if (c.op === 'M' || c.op === 'L') pts.push({ x: c.x, y: c.y });
    if (c.op === 'C') pts.push(c.p1, c.p2, c.p3);
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return {
    id: `v${nextId++}`,
    operation: 'stroke-path',
    commands,
    points: pts,
    subpaths: [pts],
    bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    color: [0, 0, 0],
    strokeWidthPt: 0.25,
    layer,
  };
}
const line = (a: Vec2, b: Vec2, layer: string) => vec([{ op: 'M', ...a }, { op: 'L', ...b }], layer);
/** A rectangle drawn as one closed path, in metres from an origin in points. */
function rect(o: Vec2, x: number, y: number, w: number, h: number, layer: string) {
  const p = (dx: number, dy: number) => ({ x: o.x + pt(x + dx), y: o.y + pt(y + dy) });
  const a = p(0, 0), b = p(w, 0), c = p(w, h), d = p(0, h);
  return vec([{ op: 'M', ...a }, { op: 'L', ...b }, { op: 'L', ...c }, { op: 'L', ...d }, { op: 'Z' }], layer);
}
/** A circle as four quarter arcs, each its own path (as CAD exports draw them). */
function circle(c: Vec2, rM: number, layer: string, skipQuarter = -1): MuVector[] {
  const r = pt(rM), k = 0.5523 * r;
  const q = [
    [{ x: c.x + r, y: c.y }, { x: c.x + r, y: c.y + k }, { x: c.x + k, y: c.y + r }, { x: c.x, y: c.y + r }],
    [{ x: c.x, y: c.y + r }, { x: c.x - k, y: c.y + r }, { x: c.x - r, y: c.y + k }, { x: c.x - r, y: c.y }],
    [{ x: c.x - r, y: c.y }, { x: c.x - r, y: c.y - k }, { x: c.x - k, y: c.y - r }, { x: c.x, y: c.y - r }],
    [{ x: c.x, y: c.y - r }, { x: c.x + k, y: c.y - r }, { x: c.x + r, y: c.y - k }, { x: c.x + r, y: c.y }],
  ];
  return q.filter((_, i) => i !== skipQuarter).map(([p0, p1, p2, p3]) => vec([{ op: 'M', ...p0 }, { op: 'C', p1, p2, p3 }], layer));
}
/** A chair 0.5 m square with a seat, a back and arms drawn inside. */
function chair(o: Vec2, x: number, y: number, layer: string): MuVector[] {
  const p = (dx: number, dy: number) => ({ x: o.x + pt(x + dx), y: o.y + pt(y + dy) });
  return [
    rect(o, x, y, 0.5, 0.5, layer),
    rect(o, x + 0.05, y + 0.12, 0.4, 0.33, layer),
    line(p(0, 0.1), p(0.5, 0.1), layer),
    line(p(0.05, 0.1), p(0.05, 0.5), layer),
    line(p(0.45, 0.1), p(0.45, 0.5), layer),
    line(p(0.1, 0.25), p(0.4, 0.25), layer),
  ];
}
/** A three-seat sofa 2.0 × 0.9 m with its back and cushions drawn. */
function sofa(o: Vec2, x: number, y: number, layer: string): MuVector[] {
  const p = (dx: number, dy: number) => ({ x: o.x + pt(x + dx), y: o.y + pt(y + dy) });
  const out = [rect(o, x, y, 2.0, 0.9, layer), line(p(0, 0.2), p(2.0, 0.2), layer)];
  for (let i = 0; i < 3; i++) out.push(rect(o, x + 0.1 + i * 0.6, y + 0.25, 0.6, 0.6, layer));
  return out;
}

const O = { x: 100, y: 100 };

describe('furniture layers', () => {
  it('reads furniture, plant, sanitary and equipment layers but not joinery doors or walls', () => {
    expect(isFurnitureLayer('2D FURNITURE - intérieur')).toBe(true);
    expect(isFurnitureLayer('2D Aménagement - intérieur')).toBe(true);
    expect(isFurnitureLayer('A57 Furniture')).toBe(true);
    expect(isFurnitureLayer('VERDURE ARBRE POOL')).toBe(true);
    expect(isFurnitureLayer('A-WALL')).toBe(false);
    expect(isFurnitureLayer('FURNITURE layout_Office$0$2D Menuiserie - Aluminium')).toBe(false);
    expect(isFurnitureLayer(undefined)).toBe(false);
  });
});

describe('detectFurniture', () => {
  it('splits chairs from the round table they are pulled up to', () => {
    const c = { x: O.x + pt(2), y: O.y + pt(2) };
    // the top is trimmed where a chair is drawn over it (one quarter missing)
    const vectors = [
      ...circle(c, 0.5, 'A-FURN', 0),
      ...chair(O, 2 - 0.25, 2 + 0.35, 'A-FURN'),
      ...chair(O, 2 - 0.25, 2 - 0.85, 'A-FURN'),
    ];
    const r = detectFurniture({ vectors, scaleMmPerPt: SCALE });
    const kinds = r.pieces.map((p) => p.kind).sort();
    expect(kinds).toEqual(['seat', 'seat', 'table']);
    const table = r.pieces.find((p) => p.kind === 'table')!;
    expect(table.widthM).toBeCloseTo(1.0, 1);
    expect(r.types.find((t) => t.kind === 'seat')?.count).toBe(2);
  });

  it('sets a rug aside so the sofa on it stays a sofa', () => {
    const vectors = [...circle({ x: O.x + pt(3), y: O.y + pt(3) }, 1.3, 'A-FURN'), ...sofa(O, 2, 1.8, 'A-FURN')];
    const r = detectFurniture({ vectors, scaleMmPerPt: SCALE });
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0].kind).toBe('sofa');
    expect(r.pieces[0].widthM).toBeCloseTo(2.0, 1);
    expect(r.pieces[0].depthM).toBeCloseTo(0.9, 1);
  });

  it('ignores the same drawing on wall and door layers', () => {
    const vectors = [...chair(O, 1, 1, 'A-WALL'), ...chair(O, 3, 1, 'Menuiserie - Bois')];
    expect(detectFurniture({ vectors, scaleMmPerPt: SCALE }).pieces).toHaveLength(0);
  });

  it('counts identical pieces as one type, and keeps only what lies in the building', () => {
    const vectors = [0, 1, 2, 5].flatMap((i) => chair(O, 1 + i * 1.5, 1, 'A57 Furniture'));
    const within: [number, number, number, number] = [O.x, O.y, O.x + pt(6), O.y + pt(3)];
    const r = detectFurniture({ vectors, scaleMmPerPt: SCALE, within });
    expect(r.types).toHaveLength(1);
    expect(r.types[0]).toMatchObject({ kind: 'seat', count: 3 });
  });
});

describe('classifyPiece', () => {
  const base = { family: 'furniture' as const, shape: 'rect' as const, widthM: 1.4, depthM: 0.3, busy: 1, circularity: 0.5, bandM: 0.25, fill: 0.9 };
  it('reads a screen from its label', () => {
    expect(classifyPiece({ ...base, label: 'TV 65"' })).toBe('screen');
  });
  it('drops single lines and thin arcs', () => {
    expect(classifyPiece({ ...base, depthM: 0.05, bandM: 0.05 })).toBeNull();
  });
  it('takes the kind of plant, sanitary and equipment layers', () => {
    expect(classifyPiece({ ...base, family: 'plant' })).toBe('plant');
    expect(classifyPiece({ ...base, family: 'sanitary' })).toBe('sanitary');
    expect(classifyPiece({ ...base, family: 'equipment' })).toBe('equipment');
  });
  it('tells a round chair from a round table by its drawing', () => {
    expect(classifyPiece({ ...base, shape: 'round', widthM: 0.85, depthM: 0.82, busy: 6, circularity: 1, bandM: 0.44 })).toBe('seat');
    expect(classifyPiece({ ...base, shape: 'round', widthM: 1.0, depthM: 1.0, busy: 1, circularity: 1, bandM: 0.5 })).toBe('table');
  });
  it('reads a long cushioned band as a sofa', () => {
    expect(classifyPiece({ ...base, shape: 'curved', widthM: 3.9, depthM: 1.4, busy: 1.45, bandM: 0.66, fill: 0.55 })).toBe('sofa');
  });
});
