import { describe, expect, it } from 'vitest';
import type { MuVector, Vec2 } from '../src/vector-device';
import { detectFurniture, type FurniturePiece } from '../src/furniture-blocks';
import { strokeAxis } from '../src/furniture-facing';

// 1:100 on paper: mm of building per PDF point
const SCALE = (100 * 25.4) / 72;
const pt = (m: number) => m / (SCALE / 1000);
const O = { x: 100, y: 100 };

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

/**
 * A polyline drawn in the piece's own metres (its front towards local +y), placed at
 * `at` (metres from the origin) and turned by `turn` (page radians, y down).
 */
function draw(pts: [number, number][], at: [number, number], turn: number, layer: string, closed = true): MuVector {
  const c = Math.cos(turn), s = Math.sin(turn);
  const P = pts.map(([x, y]) => ({ x: O.x + pt(at[0] + x * c - y * s), y: O.y + pt(at[1] + x * s + y * c) }));
  return vec([{ op: 'M', ...P[0] }, ...P.slice(1).map((p) => ({ op: 'L', ...p })), ...(closed ? [{ op: 'Z' }] : [])] as MuVector['commands'], layer);
}

const box = (w: number, d: number, cx = 0, cy = 0): [number, number][] => [
  [cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2], [cx + w / 2, cy + d / 2], [cx - w / 2, cy + d / 2],
];
const oval = (rx: number, ry: number, cx: number, cy: number, n = 24): [number, number][] =>
  Array.from({ length: n }, (_, k) => [cx + rx * Math.cos((k / n) * 2 * Math.PI), cy + ry * Math.sin((k / n) * 2 * Math.PI)] as [number, number]);

/** A 0.55 m chair: a back band behind (local −y), arms, and the seat in front. */
function chair(at: [number, number], turn: number, layer = 'A-FURN'): MuVector[] {
  return [
    draw(box(0.55, 0.55), at, turn, layer),
    draw([[-0.275, -0.17], [0.275, -0.17]], at, turn, layer, false),
    draw([[-0.2, -0.17], [-0.2, 0.275]], at, turn, layer, false),
    draw([[0.2, -0.17], [0.2, 0.275]], at, turn, layer, false),
  ];
}

/** A round table top as four quarter arcs (as CAD exports draw them). */
function roundTable(c: [number, number], rM: number, layer = 'A-FURN'): MuVector[] {
  const C = { x: O.x + pt(c[0]), y: O.y + pt(c[1]) };
  const r = pt(rM), k = 0.5523 * r;
  const q = [
    [{ x: C.x + r, y: C.y }, { x: C.x + r, y: C.y + k }, { x: C.x + k, y: C.y + r }, { x: C.x, y: C.y + r }],
    [{ x: C.x, y: C.y + r }, { x: C.x - k, y: C.y + r }, { x: C.x - r, y: C.y + k }, { x: C.x - r, y: C.y }],
    [{ x: C.x - r, y: C.y }, { x: C.x - r, y: C.y - k }, { x: C.x - k, y: C.y - r }, { x: C.x, y: C.y - r }],
    [{ x: C.x, y: C.y - r }, { x: C.x + k, y: C.y - r }, { x: C.x + r, y: C.y - k }, { x: C.x + r, y: C.y }],
  ];
  return q.map(([p0, p1, p2, p3]) => vec([{ op: 'M', ...p0 }, { op: 'C', p1, p2, p3 }] as MuVector['commands'], layer));
}

const at = (pieces: FurniturePiece[], x: number, y: number) =>
  pieces.reduce((best, p) => {
    const d = Math.hypot(p.center.x - (O.x + pt(x)), p.center.y - (O.y + pt(y)));
    return d < best.d ? { p, d } : best;
  }, { p: pieces[0], d: Infinity }).p;

/** Smallest difference between two angles, degrees. */
const off = (a: number | undefined, b: number) => {
  if (a === undefined) return Infinity;
  const d = Math.abs((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  return (d * 180) / Math.PI;
};

describe('furniture facing', () => {
  it('turns chairs pulled up to a round table towards it', () => {
    const d = 0.5 + 0.1 + 0.275;
    const vectors = [
      ...roundTable([3, 3], 0.5),
      ...chair([3, 3 - d], 0), // north, front down
      ...chair([3, 3 + d], Math.PI), // south, front up
      ...chair([3 + d, 3], Math.PI / 2), // east, front left
      ...chair([3 - d, 3], -Math.PI / 2), // west, front right
    ];
    const r = detectFurniture({ vectors, scaleMmPerPt: SCALE });
    expect(r.pieces.filter((p) => p.kind === 'seat')).toHaveLength(4);
    expect(off(at(r.pieces, 3, 3 - d).facing, Math.PI / 2)).toBeLessThan(5);
    expect(off(at(r.pieces, 3, 3 + d).facing, -Math.PI / 2)).toBeLessThan(5);
    expect(off(at(r.pieces, 3 + d, 3).facing, Math.PI)).toBeLessThan(5);
    expect(off(at(r.pieces, 3 - d, 3).facing, 0)).toBeLessThan(5);
    expect(at(r.pieces, 3, 3 - d).facingBy).toBe('table');
    // the table itself has no front
    expect(at(r.pieces, 3, 3).facing).toBeUndefined();
  });

  it('reads a lone chair from its drawing: the seat is in front of the back band', () => {
    const turn = 0.6;
    const r = detectFurniture({ vectors: chair([2, 2], turn), scaleMmPerPt: SCALE });
    expect(r.pieces).toHaveLength(1);
    expect(off(r.pieces[0].facing, Math.PI / 2 + turn)).toBeLessThan(3);
    expect(r.pieces[0].facingBy).toBe('shape');
  });

  it('turns a desk to the chair drawn at it, and gives a table with chairs on both sides no front', () => {
    const vectors = [
      draw(box(1.6, 0.8), [2, 2], 0, 'A-FURN'),
      ...chair([2, 2 + 0.4 + 0.05 + 0.275], Math.PI), // the user's chair, below the desk, facing up
      draw(box(1.6, 0.8), [6, 2], 0, 'A-FURN'),
      ...chair([6, 2 + 0.4 + 0.05 + 0.275], Math.PI),
      ...chair([6, 2 - 0.4 - 0.05 - 0.275], 0),
    ];
    const r = detectFurniture({ vectors, scaleMmPerPt: SCALE });
    const desk = at(r.pieces, 2, 2);
    expect(desk.kind).toBe('desk');
    expect(off(desk.facing, Math.PI / 2)).toBeLessThan(3);
    expect(desk.facingBy).toBe('chair');
    expect(off(at(r.pieces, 2, 2.725).facing, -Math.PI / 2)).toBeLessThan(3);
    expect(at(r.pieces, 6, 2).facing).toBeUndefined();
  });

  it('turns a WC away from its cistern and the wall behind it', () => {
    const turn = Math.PI / 2; // front towards page −x
    const layer = 'A71 Sanitary Fixtures';
    const vectors = [draw(box(0.38, 0.15, 0, -0.295), [2, 2], turn, layer), draw(oval(0.19, 0.28, 0, 0.06), [2, 2], turn, layer), draw(oval(0.12, 0.17, 0, 0.09), [2, 2], turn, layer)];
    // the wall behind the cistern (page +x side)
    const wx = O.x + pt(2 + 0.37 + 0.02 + 0.05);
    const walls = [{ a: { x: wx, y: O.y + pt(1) }, b: { x: wx, y: O.y + pt(3) }, t: pt(0.1) }];
    const r = detectFurniture({ vectors, scaleMmPerPt: SCALE, walls });
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0].kind).toBe('sanitary');
    expect(off(r.pieces[0].facing, Math.PI)).toBeLessThan(3);
    // and from its drawing alone, with no wall
    const alone = detectFurniture({ vectors, scaleMmPerPt: SCALE });
    expect(off(alone.pieces[0].facing, Math.PI)).toBeLessThan(3);
    expect(alone.pieces[0].facingBy).toBe('shape');
  });

  it('stands a cabinet with its back to the wall', () => {
    const vectors = [draw(box(1.2, 0.6), [2, 2], 0, 'A57 Fixed Joinery')];
    const wy = O.y + pt(2 - 0.3 - 0.03 - 0.05);
    const walls = [{ a: { x: O.x + pt(0.5), y: wy }, b: { x: O.x + pt(3.5), y: wy }, t: pt(0.1) }];
    const r = detectFurniture({ vectors, scaleMmPerPt: SCALE, walls });
    expect(r.pieces[0].kind).toBe('joinery');
    expect(off(r.pieces[0].facing, Math.PI / 2)).toBeLessThan(3);
    expect(r.pieces[0].facingBy).toBe('wall');
    // a plain cabinet with nothing around it does not tell which way it faces
    expect(detectFurniture({ vectors, scaleMmPerPt: SCALE }).pieces[0].facing).toBeUndefined();
  });

  it('turns a curved sofa into its curve', () => {
    const c = [4, 4];
    const arc = (r: number, from: number, to: number, n = 16): [number, number][] =>
      Array.from({ length: n + 1 }, (_, k) => {
        const a = from + ((to - from) * k) / n;
        return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as [number, number];
      });
    const outer = arc(2.0, Math.PI, 1.5 * Math.PI);
    const inner = arc(1.4, 1.5 * Math.PI, Math.PI);
    const vectors = [draw([...outer, ...inner], [0, 0], 0, 'A-FURN')];
    for (const a of [1.125, 1.25, 1.375].map((k) => k * Math.PI)) {
      vectors.push(draw([[c[0] + 1.4 * Math.cos(a), c[1] + 1.4 * Math.sin(a)], [c[0] + 2.0 * Math.cos(a), c[1] + 2.0 * Math.sin(a)]], [0, 0], 0, 'A-FURN', false));
    }
    const r = detectFurniture({ vectors, scaleMmPerPt: SCALE });
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0].kind).toBe('sofa');
    // the arc's centre lies down and to the right of the band
    expect(off(r.pieces[0].facing, Math.PI / 4)).toBeLessThan(10);
  });

  it('gives plants no front', () => {
    const r = detectFurniture({ vectors: roundTable([2, 2], 0.4, 'VERDURE'), scaleMmPerPt: SCALE });
    expect(r.pieces[0].kind).toBe('plant');
    expect(r.pieces[0].facing).toBeUndefined();
  });

  it('finds the direction a symbol is drawn square to', () => {
    const v = draw(box(1.2, 0.6), [2, 2], 0.3, 'A-FURN');
    const lines = [(v.commands as Array<Record<string, number>>).filter((c) => 'x' in c).map((c) => ({ x: c.x, y: c.y }))];
    lines[0].push(lines[0][0]);
    expect(strokeAxis(lines)).toBeCloseTo(0.3, 2);
  });
});
