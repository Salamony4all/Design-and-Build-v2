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
});
