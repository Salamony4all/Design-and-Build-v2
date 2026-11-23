import { describe, expect, it } from 'vitest';
import type { MuVector, Vec2 } from '../src/vector-device';
import { detectGlassPartitions, type GlassHostWall, type GlassText } from '../src/glass-partitions';

// 1:100 on paper: mm of building per PDF point
const SCALE = 100 * 25.4 / 72;
const pt = (m: number) => m / (SCALE / 1000);

let nextId = 0;
function line(a: Vec2, b: Vec2, opts: { color?: number[]; w?: number; dashes?: number[] } = {}): MuVector {
  return {
    id: `v${nextId++}`,
    operation: 'stroke-path',
    commands: [{ op: 'M', ...a }, { op: 'L', ...b }],
    points: [a, b],
    subpaths: [[a, b]],
    bounds: [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)],
    color: opts.color ?? [0, 0, 0],
    strokeWidthPt: opts.w ?? 0.25,
    ...(opts.dashes ? { dashes: opts.dashes } : {}),
  };
}
const H = (x0: number, x1: number, y: number, o?: Parameters<typeof line>[2]) => line({ x: x0, y }, { x: x1, y }, o);
const V = (x: number, y0: number, y1: number, o?: Parameters<typeof line>[2]) => line({ x, y: y0 }, { x, y: y1 }, o);

/** A detected wall plus the two faces drawn for it. */
function wall(id: string, a: Vec2, b: Vec2, tM = 0.1): { host: GlassHostWall; faces: MuVector[] } {
  const t = pt(tM);
  const vertical = Math.abs(a.x - b.x) < 1e-6;
  const faces = vertical
    ? [V(a.x - t / 2, a.y, b.y, { w: 0.5 }), V(a.x + t / 2, a.y, b.y, { w: 0.5 })]
    : [H(a.x, b.x, a.y - t / 2, { w: 0.5 }), H(a.x, b.x, a.y + t / 2, { w: 0.5 })];
  return { host: { id, a, b, thickness: t }, faces };
}

/** Two rooms side by side: walls at x = 100 and x = 100 + 5 m, from y = 100 to y = 100 + 6 m. */
function room() {
  const x0 = 100, x1 = 100 + pt(5), y0 = 100, y1 = 100 + pt(6);
  const ws = [
    wall('w_left', { x: x0, y: y0 }, { x: x0, y: y1 }),
    wall('w_right', { x: x1, y: y0 }, { x: x1, y: y1 }),
    wall('w_top', { x: x0, y: y0 }, { x: x1, y: y0 }),
    wall('w_bottom', { x: x0, y: y1 }, { x: x1, y: y1 }),
  ];
  return { x0, x1, y0, y1, walls: ws.map((w) => w.host), vectors: ws.flatMap((w) => w.faces) };
}

const text = (s: string, x: number, y: number, h = 6): GlassText => ({ text: s, x, y, w: s.length * h * 0.5, h });
const run = (vectors: MuVector[], texts: GlassText[], walls: GlassHostWall[]) =>
  detectGlassPartitions({ vectors, texts, walls, scaleMmPerPt: SCALE });

describe('glass partitions from the drawing key', () => {
  it('builds a coloured glazed-screen line as a new glass wall between walls', () => {
    const r = room();
    const blue = [0, 0.5, 1];
    const ym = (r.y0 + r.y1) / 2;
    const vectors = [
      ...r.vectors,
      H(r.x0 + pt(0.05), r.x1 - pt(0.05), ym, { color: blue, w: 2 }),
      // the key: a sample line and its text
      H(700, 760, 600, { color: blue, w: 2 }),
    ];
    const res = run(vectors, [text('Glazed screens & door inserts', 780, 597)], r.walls);
    expect(res.styles).toHaveLength(1);
    expect(res.partitions).toHaveLength(1);
    const p = res.partitions[0]!;
    expect(p.source).toBe('legend');
    expect(p.lengthM).toBeGreaterThan(4.8);
    expect(Math.abs(p.a.y - ym)).toBeLessThan(0.5);
    // the key's own sample is no wall
    expect(res.partitions.every((q) => q.a.y < 500)).toBe(true);
  });

  it('marks a detected wall drawn in the key\'s two-line glass style', () => {
    const r = room();
    const lightBlue = [0.48, 0.69, 0.87];
    const ym = (r.y0 + r.y1) / 2;
    const s = 3.1; // 110 mm at 1:100
    const vectors = [
      ...r.vectors,
      H(r.x0, r.x1, ym - s / 2, { color: lightBlue, w: 0.72 }),
      H(r.x0, r.x1, ym + s / 2, { color: lightBlue, w: 0.72 }),
      H(700, 740, 600, { color: lightBlue, w: 0.72 }),
      H(700, 740, 600 + s, { color: lightBlue, w: 0.72 }),
    ];
    const glassWall: GlassHostWall = { id: 'w_glass', a: { x: r.x0, y: ym }, b: { x: r.x1, y: ym }, thickness: s };
    const res = run(vectors, [text('100 Double Glazed partition', 760, 598)], [...r.walls, glassWall]);
    expect(res.glassWallIds).toEqual(['w_glass']);
    expect(res.glassWalls[0]!.source).toBe('legend');
    expect(res.partitions).toHaveLength(0);
  });

  it('ignores a plain black one-line sample and glass that is not a partition', () => {
    const r = room();
    const ym = (r.y0 + r.y1) / 2;
    const vectors = [...r.vectors, H(r.x0, r.x1, ym, { w: 0.5 }), H(700, 760, 600, { w: 0.5 }), H(700, 760, 640, { color: [1, 0, 0], w: 1 })];
    const res = run(vectors, [text('New glazing', 780, 597), text('Fibreglass insulation', 780, 637)], r.walls);
    expect(res.styles).toHaveLength(0);
    expect(res.partitions).toHaveLength(0);
  });
});

describe('glazed screens drawn as two hairlines (no key)', () => {
  /** Two hairlines 50 mm apart across the room at mid height, leaving a 0.9 m doorway at the right. */
  function screen(opts: { gapAtEnd?: boolean; color?: number[] } = {}) {
    const r = room();
    const ym = (r.y0 + r.y1) / 2;
    const s = pt(0.05);
    const xEnd = opts.gapAtEnd === false ? r.x1 - pt(0.05) : r.x1 - pt(0.05) - pt(0.9);
    const vectors = [
      ...r.vectors,
      H(r.x0 + pt(0.05), xEnd, ym - s / 2, { color: opts.color }),
      H(r.x0 + pt(0.05), xEnd, ym + s / 2, { color: opts.color }),
    ];
    return { r, ym, vectors };
  }

  it('reads them as glass when they run wall to wall and meet a doorway', () => {
    const { r, ym, vectors } = screen();
    const res = run(vectors, [text('Meeting Room', r.x0 + 20, r.y0 + 20)], r.walls);
    expect(res.partitions).toHaveLength(1);
    expect(res.partitions[0]!.source).toBe('double-line');
    expect(Math.abs(res.partitions[0]!.a.y - ym)).toBeLessThan(0.5);
    expect(res.partitions[0]!.thicknessM).toBeCloseTo(0.05, 2);
  });

  it('does not read them without a door or doorway (lift doors, balustrades, linings)', () => {
    const { r, vectors } = screen({ gapAtEnd: false });
    expect(run(vectors, [], r.walls).partitions).toHaveLength(0);
  });

  it('does not read them in toilets (cubicle panels)', () => {
    const { r, ym, vectors } = screen();
    expect(run(vectors, [text('WC', r.x0 + 30, ym - 30)], r.walls).partitions).toHaveLength(0);
  });

  it('does not read grey or coloured hairlines (furniture, finishes)', () => {
    const { r, vectors } = screen({ color: [0.6, 0.6, 0.6] });
    expect(run(vectors, [], r.walls).partitions).toHaveLength(0);
  });

  it('does not read a worktop edge alongside a wall', () => {
    const r = room();
    const s = pt(0.05);
    const y = r.y0 + pt(0.6); // 600 mm off the top wall
    const xEnd = r.x1 - pt(0.05) - pt(0.9);
    const vectors = [...r.vectors, H(r.x0 + pt(0.05), xEnd, y - s / 2), H(r.x0 + pt(0.05), xEnd, y + s / 2)];
    expect(run(vectors, [], r.walls).partitions).toHaveLength(0);
  });

  it('does not read a stair nosing among parallel treads', () => {
    const { r, ym, vectors } = screen();
    const treads = [1, 2, 3, 4].map((i) => H(r.x0 + pt(0.05), r.x1 - pt(0.05), ym + i * pt(0.25), { w: 0.25 }));
    expect(run([...vectors, ...treads], [], r.walls).partitions).toHaveLength(0);
  });

  it('marks a thin detected wall drawn as two hairlines as glass', () => {
    const { r, ym, vectors } = screen();
    const thin: GlassHostWall = { id: 'w_thin', a: { x: r.x0 + pt(0.05), y: ym }, b: { x: r.x1 - pt(0.95), y: ym }, thickness: pt(0.05) };
    const res = run(vectors, [], [...r.walls, thin]);
    expect(res.glassWallIds).toEqual(['w_thin']);
    expect(res.glassWalls[0]!.source).toBe('double-line');
    expect(res.partitions).toHaveLength(0);
  });

  it('leaves solid partitions alone (lines further apart than a glazed frame)', () => {
    const r = room();
    const ym = (r.y0 + r.y1) / 2;
    const s = pt(0.1);
    const xEnd = r.x1 - pt(0.05) - pt(0.9);
    const vectors = [...r.vectors, H(r.x0 + pt(0.05), xEnd, ym - s / 2), H(r.x0 + pt(0.05), xEnd, ym + s / 2)];
    const solid: GlassHostWall = { id: 'w_solid', a: { x: r.x0, y: ym }, b: { x: xEnd, y: ym }, thickness: s };
    const res = run(vectors, [], [...r.walls, solid]);
    expect(res.glassWallIds).toHaveLength(0);
    expect(res.partitions).toHaveLength(0);
  });
});
