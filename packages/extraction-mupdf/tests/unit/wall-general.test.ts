import { describe, expect, it } from 'vitest';
import { detectWallsGeneral } from '../../src/wall-general';
import { collectSegments, detectDoorSymbols, hostDoorSymbols } from '../../src/door-symbols';

// Synthetic sheet at 1:50 on A1 (17.64 mm per pt): one 5 m x 4 m room with 200 mm hollow
// double-line walls, a 900 mm door in the bottom wall drawn as leaf + quarter arc, and a
// second room sharing the right wall whose door sits in a splayed corner (no wall on the
// opening's own line).
const S = 17.64;
const mm = (v: number) => v / S;

type P = { x: number; y: number };
const stroke = (pts: P[], w = 0.5) => ({
  id: `v${Math.random().toString(36).slice(2)}`,
  operation: 'stroke-path',
  points: pts,
  subpaths: [pts],
  commands: [{ op: 'M', ...pts[0]! }, ...pts.slice(1).map((p) => ({ op: 'L', ...p }))],
  strokeWidthPt: w,
  strokeWidth: w,
  color: [0, 0, 0],
});
const arc = (c: P, r: number, a0: number, a1: number, w = 0.25) => {
  const pts: P[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = a0 + ((a1 - a0) * i) / 16;
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return stroke(pts, w);
};

function sheet() {
  const o = { x: 100, y: 100 };
  const W = mm(5000), H = mm(4000), t = mm(200), door = mm(900), x0 = mm(1500);
  const v: any[] = [];
  const P = (x: number, y: number): P => ({ x: o.x + x, y: o.y + y });
  // top, left, right walls: outer and inner faces
  v.push(stroke([P(0, 0), P(W, 0)]), stroke([P(t, t), P(W - t, t)]));
  v.push(stroke([P(0, 0), P(0, H)]), stroke([P(t, t), P(t, H - t)]));
  v.push(stroke([P(W, 0), P(W, H)]), stroke([P(W - t, t), P(W - t, H - t)]));
  // bottom wall drawn stopping at the door jambs
  v.push(stroke([P(0, H), P(x0, H)]), stroke([P(t, H - t), P(x0, H - t)]));
  v.push(stroke([P(x0 + door, H), P(W, H)]), stroke([P(x0 + door, H - t), P(W - t, H - t)]));
  v.push(stroke([P(x0, H - t), P(x0, H)]), stroke([P(x0 + door, H - t), P(x0 + door, H)]));
  // door: hinge on the wall centreline at the left jamb, leaf open 90 deg into the room
  const hinge = P(x0, H - t / 2);
  v.push(stroke([hinge, { x: hinge.x, y: hinge.y - door }], 0.25));
  v.push(arc(hinge, door, -Math.PI / 2, 0));
  return { vectors: v, hinge, closed: { x: hinge.x + door, y: hinge.y }, W, H, t, o };
}

describe('general wall detector', () => {
  it('finds a hollow-walled room and runs the wall on through its door', () => {
    const { vectors, hinge, W, t } = sheet();
    const segs = collectSegments(vectors as any);
    const symbols = detectDoorSymbols(segs, S, { minLeafMm: 500, maxLeafMm: 1500, hostCorridorPadPt: 18 });
    expect(symbols).toHaveLength(1);
    expect(Math.hypot(symbols[0]!.hinge.x - hinge.x, symbols[0]!.hinge.y - hinge.y)).toBeLessThan(0.5);
    const openings = symbols.map((s) => ({ a: s.hinge, b: s.closed, leaf: { a: s.hinge, b: s.free } }));
    const walls = detectWallsGeneral(segs, S, undefined, { openings });
    // four walls, each about 200 mm thick; the bottom one spans the door
    expect(walls).toHaveLength(4);
    for (const w of walls) expect(w.thickness * S).toBeGreaterThan(180);
    for (const w of walls) expect(w.thickness * S).toBeLessThan(220);
    const bottom = walls.find((w) => Math.abs(w.a.y - w.b.y) < 0.5 && w.a.y > hinge.y - t)!;
    expect(bottom).toBeDefined();
    expect(bottom.length).toBeGreaterThan(W - 2 * t);
    expect(walls.some((w) => w.kind === 'opening')).toBe(false);
    // a single room: every wall has a face to the outside
    expect(walls.every((w) => w.exterior)).toBe(true);
    // and the door is hosted inside that wall
    const hosted = hostDoorSymbols(symbols, walls.map((w) => ({ physicalWallId: w.id, centerline: { a: w.a, b: w.b }, thickness: w.thickness })), segs, {
      minLeafMm: 500, maxLeafMm: 1500, hostCorridorPadPt: 18,
    });
    expect(hosted[0]!.hostStatus).toBe('UNIQUE_HOST');
    expect(hosted[0]!.physicalWallId).toBe(bottom.id);
    expect(hosted[0]!.inWallGap).toBe(false);
  });

  it('ignores a door leaf drawn as a narrow rectangle', () => {
    const { vectors, hinge } = sheet();
    const leafT = mm(45);
    vectors.push(stroke([{ x: hinge.x + leafT, y: hinge.y }, { x: hinge.x + leafT, y: hinge.y - mm(900) }], 0.25));
    const segs = collectSegments(vectors as any);
    const symbols = detectDoorSymbols(segs, S, { minLeafMm: 500, maxLeafMm: 1500, hostCorridorPadPt: 18 });
    const openings = symbols.map((s) => ({ a: s.hinge, b: s.closed, leaf: { a: s.hinge, b: s.free } }));
    const walls = detectWallsGeneral(segs, S, undefined, { openings });
    expect(walls).toHaveLength(4);
  });

  it('gives a door across a splayed corner its own header wall', () => {
    const { vectors, W, H, t, o } = sheet();
    // remove nothing; add a second room to the right whose entrance is a 45 deg splay
    // between the end of its top wall and the end of its left wall stub
    const P = (x: number, y: number) => ({ x: o.x + x, y: o.y + y });
    const W2 = mm(3000), splay = mm(900) / Math.SQRT2;
    vectors.push(stroke([P(W, 0), P(W + W2, 0)]), stroke([P(W, t), P(W + W2 - t, t)]));
    vectors.push(stroke([P(W + W2, 0), P(W + W2, H)]), stroke([P(W + W2 - t, t), P(W + W2 - t, H - t)]));
    vectors.push(stroke([P(W, H), P(W + W2, H)]), stroke([P(W + t, H - t), P(W + W2 - t, H - t)]));
    // door hinged at the bottom of the shared wall's inner face, closing diagonally
    // onto a short stub; leaf open into the room
    const hinge = P(W + t, H - t - splay * 2);
    const closed = { x: hinge.x + splay, y: hinge.y + splay };
    const lx = closed.x - hinge.x, ly = closed.y - hinge.y, r = Math.hypot(lx, ly);
    const free = { x: hinge.x + ly, y: hinge.y - lx };
    vectors.push(stroke([hinge, free], 0.25));
    const a0 = Math.atan2(free.y - hinge.y, free.x - hinge.x), a1 = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
    vectors.push(arc(hinge, r, a0, a1 < a0 ? a1 + 2 * Math.PI : a1));
    const segs = collectSegments(vectors as any);
    const symbols = detectDoorSymbols(segs, S, { minLeafMm: 500, maxLeafMm: 1500, hostCorridorPadPt: 18 });
    const openings = symbols.map((s) => ({ a: s.hinge, b: s.closed, leaf: { a: s.hinge, b: s.free } }));
    const walls = detectWallsGeneral(segs, S, undefined, { openings });
    // the wall the two rooms share looks out of neither
    const shared = walls.filter((w) => w.kind !== 'opening' && Math.abs(w.a.x - w.b.x) < 0.5 && Math.abs(w.a.x - (o.x + W - t / 2)) < t);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.every((w) => !w.exterior)).toBe(true);
    const headers = walls.filter((w) => w.kind === 'opening');
    expect(headers).toHaveLength(1);
    const h = headers[0]!;
    expect(Math.abs(h.length - r)).toBeLessThan(1);
    const hosted = hostDoorSymbols(symbols, walls.map((w) => ({ physicalWallId: w.id, centerline: { a: w.a, b: w.b }, thickness: w.thickness })), segs, {
      minLeafMm: 500, maxLeafMm: 1500, hostCorridorPadPt: 18,
    });
    expect(hosted.every((x) => x.hostStatus === 'UNIQUE_HOST')).toBe(true);
  });

  // windows: the same room with a 1200 mm window in its top wall, x = 2000..3200 mm
  const windowSheet = (style: 'gap' | 'broken' | 'header') => {
    const base = sheet();
    const { o, W, t } = base;
    const w0 = mm(2000), w1 = mm(3200);
    const P = (x: number, y: number): P => ({ x: o.x + x, y: o.y + y });
    // the top wall's two faces are the first two strokes: redraw them stopping at the jambs
    const v: any[] = base.vectors.slice(2);
    v.push(stroke([P(0, 0), P(w0, 0)]), stroke([P(t, t), P(w0, t)]));
    v.push(stroke([P(w1, 0), P(W, 0)]), stroke([P(w1, t), P(W - t, t)]));
    v.push(stroke([P(w0, 0), P(w0, t)]), stroke([P(w1, 0), P(w1, t)]));
    if (style === 'gap') {
      // glass: two lines inside the wall, jamb to jamb
      v.push(stroke([P(w0, mm(85)), P(w1, mm(85))], 0.18), stroke([P(w0, mm(115)), P(w1, mm(115))], 0.18));
    } else {
      // sill and frame drawn lighter across the opening where the faces stop
      v.push(stroke([P(w0, 0), P(w1, 0)], 0.18), stroke([P(w0, t), P(w1, t)], 0.18));
      if (style === 'broken') v.push(stroke([P(w0, mm(100)), P(w1, mm(100))], 0.18));
    }
    return { vectors: v, o, W, t, w0, w1 };
  };
  const topWindows = (vectors: any[], o: P, t: number) => {
    const segs = collectSegments(vectors as any);
    const symbols = detectDoorSymbols(segs, S, { minLeafMm: 500, maxLeafMm: 1500, hostCorridorPadPt: 18 });
    const openings = symbols.map((s) => ({ a: s.hinge, b: s.closed, leaf: { a: s.hinge, b: s.free } }));
    const walls = detectWallsGeneral(segs, S, undefined, { openings });
    const top = walls.filter((w) => Math.abs(w.a.y - w.b.y) < 0.5 && Math.abs(w.a.y - (o.y + t / 2)) < t);
    return { walls, top };
  };

  it('runs a wall on through a window drawn as a gap with glass in it', () => {
    const { vectors, o, W, t, w0, w1 } = windowSheet('gap');
    const { walls, top } = topWindows(vectors, o, t);
    expect(walls).toHaveLength(4);
    expect(top).toHaveLength(1);
    expect(top[0]!.length).toBeGreaterThan(W - 2 * t);
    const win = top[0]!.windows ?? [];
    expect(win).toHaveLength(1);
    const x = Math.min(top[0]!.a.x, top[0]!.b.x) - o.x;
    expect(Math.abs(x + win[0]!.from - w0) * S).toBeLessThan(30);
    expect(Math.abs(x + win[0]!.to - w1) * S).toBeLessThan(30);
  });

  it('finds a window where the faces stop and lighter lines carry on across it', () => {
    const { vectors, o, t, w0, w1 } = windowSheet('broken');
    const { top } = topWindows(vectors, o, t);
    expect(top).toHaveLength(1);
    const win = top[0]!.windows ?? [];
    expect(win).toHaveLength(1);
    expect(Math.abs(win[0]!.to - win[0]!.from - (w1 - w0)) * S).toBeLessThan(30);
    // no window in the other walls
    expect(topWindows(vectors, o, t).walls.filter((w) => w.windows?.length)).toHaveLength(1);
  });

  it('takes lines over an opening for a window only in an outside wall', () => {
    // outside wall, faces stopping under lighter lines: a window (frame drawn on the faces)
    const out = windowSheet('header');
    expect(topWindows(out.vectors, out.o, out.t).top[0]!.windows ?? []).toHaveLength(1);
    // the same opening in a wall shared with a second room beyond it: a header over a
    // passage, not a window
    const { vectors, o, W, t } = out;
    const P = (x: number, y: number) => ({ x: o.x + x, y: o.y + y });
    const D = mm(3000);
    vectors.push(stroke([P(0, -D), P(W, -D)]), stroke([P(t, -D + t), P(W - t, -D + t)]));
    vectors.push(stroke([P(0, -D), P(0, 0)]), stroke([P(t, -D + t), P(t, 0)]));
    vectors.push(stroke([P(W, -D), P(W, 0)]), stroke([P(W - t, -D + t), P(W - t, 0)]));
    const shared = topWindows(vectors, o, t).top;
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.every((w) => !w.windows?.length)).toBe(true);
  });
});
