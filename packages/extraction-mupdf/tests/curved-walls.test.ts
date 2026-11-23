import { describe, expect, it } from 'vitest';
import type { MuVector } from '../src/vector-device';
import { curvedBandUnder, curvedWallPieces, detectCurvedWalls, mergeIntervals } from '../src/curved-walls';

// 1:50 on paper: mm of building per PDF point
const SCALE = 50 * 25.4 / 72;
const M_PER_PT = SCALE / 1000;
const pt = (m: number) => m / M_PER_PT;
const deg = (d: number) => (d * Math.PI) / 180;

type Cmd = { op: string; [k: string]: unknown };

/** A circular arc as CAD exports it: cubic Béziers of at most 90 degrees. */
function arcCommands(cx: number, cy: number, r: number, a0: number, a1: number, move = true): Cmd[] {
  const cmds: Cmd[] = [];
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / deg(90) - 1e-9));
  const at = (t: number) => ({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  if (move) cmds.push({ op: 'M', ...at(a0) });
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    const k = (4 / 3) * Math.tan((t1 - t0) / 4) * r;
    const p0 = at(t0), p3 = at(t1);
    cmds.push({
      op: 'C',
      p1: { x: p0.x - k * Math.sin(t0), y: p0.y + k * Math.cos(t0) },
      p2: { x: p3.x + k * Math.sin(t1), y: p3.y - k * Math.cos(t1) },
      p3,
    });
  }
  return cmds;
}

/** A polyline through points (arcs flattened into straight lines, as some exporters do). */
function polyCommands(pts: { x: number; y: number }[]): Cmd[] {
  return [{ op: 'M', ...pts[0]! }, ...pts.slice(1).map((p) => ({ op: 'L', ...p }))];
}

/** Smooth Béziers through points (Catmull-Rom), as CAD exports ovals and splines. */
function splineCommands(pts: { x: number; y: number }[]): Cmd[] {
  const cmds: Cmd[] = [{ op: 'M', ...pts[0]! }];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    cmds.push({
      op: 'C',
      p1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      p2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p3: p2,
    });
  }
  return cmds;
}

/** Points along an ellipse's centreline, offset sideways by `off` (page points). */
function ellipseFace(cx: number, cy: number, a: number, b: number, t0: number, t1: number, off: number, n: number) {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const x = cx + a * Math.cos(t), y = cy + b * Math.sin(t);
    const tx = -a * Math.sin(t), ty = b * Math.cos(t), l = Math.hypot(tx, ty);
    out.push({ x: x + (ty / l) * off, y: y - (tx / l) * off });
  }
  return out;
}

const arcPoints = (cx: number, cy: number, r: number, a0: number, a1: number, stepDeg: number) => {
  const n = Math.max(1, Math.round(Math.abs(a1 - a0) / deg(stepDeg)));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = a0 + ((a1 - a0) * i) / n;
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
  });
};

/** Pascal (wall-curve.ts): the arc of a wall from start, end and curveOffset. */
function pascalArc(p: { start: { x: number; y: number }; end: { x: number; y: number }; curveOffset: number }) {
  const dx = p.end.x - p.start.x, dy = p.end.y - p.start.y, L = Math.hypot(dx, dy);
  const nx = -dy / L, ny = dx / L, mx = (p.start.x + p.end.x) / 2, my = (p.start.y + p.end.y) / 2;
  const s = p.curveOffset;
  const mid = { x: mx - nx * s, y: my - ny * s };
  if (Math.abs(s) < 1e-9) return { mid, centre: null as null | { x: number; y: number }, R: Infinity };
  const as = Math.abs(s), R = (L * L) / (8 * as) + as / 2, sign = Math.sign(s);
  return { mid, centre: { x: mx + nx * (R - as) * sign, y: my + ny * (R - as) * sign }, R };
}

let seq = 0;
function stroke(commands: Cmd[], widthPt: number, color: number[] = [0, 0, 0]): MuVector {
  const points = commands.flatMap((c) => (c.op === 'C' ? [c.p1, c.p2, c.p3] : c.op === 'Z' ? [] : [{ x: c.x, y: c.y }])) as { x: number; y: number }[];
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return {
    id: `v${seq++}`,
    operation: 'stroke-path',
    commands,
    points,
    subpaths: [points],
    bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    color,
    strokeWidthPt: widthPt,
  };
}

const C = { x: 600, y: 600 };

describe('curved walls from drawing arcs', () => {
  it('finds a round pod with its door gap from two heavy concentric faces', () => {
    const a0 = 0.5, a1 = 0.5 + deg(300);
    const vectors = [
      stroke(arcCommands(C.x, C.y, pt(2.5), a0, a1), 1.4),
      stroke(arcCommands(C.x, C.y, pt(2.7), a0, a1), 1.4),
    ];
    const r = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE });
    expect(r.pods).toHaveLength(1);
    expect(r.pods[0]!.enclosedDeg).toBeGreaterThan(297);
    expect(r.pods[0]!.enclosedDeg).toBeLessThan(303);
    expect(r.pods[0]!.radiusM).toBeCloseTo(2.6, 2);
    expect(r.segments.length).toBeGreaterThan(0);
    for (const s of r.segments) {
      expect(s.kind).toBe('solid');
      expect(s.podId).toBe('pod_1');
      expect(s.thicknessM).toBeCloseTo(0.2, 2);
    }
  });

  it('reads two thin faces a few centimetres apart as glass, also across angle zero', () => {
    const vectors = [
      stroke(arcCommands(C.x, C.y, pt(4.0), -0.5, 0.55), 0.3),
      stroke(arcCommands(C.x, C.y, pt(4.05), -0.5, 0.55), 0.3),
    ];
    const r = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE });
    expect(r.pods).toHaveLength(0);
    expect(r.segments).toHaveLength(1);
    const s = r.segments[0]!;
    expect(s.kind).toBe('glass');
    expect(s.thicknessM).toBeCloseTo(0.05, 2);
    expect(s.a1 - s.a0).toBeCloseTo(1.05, 2);
    expect(s.lengthM).toBeCloseTo(4.025 * 1.05, 1);
  });

  it('builds a solid wall from a dark filled band (CMYK black)', () => {
    const r0 = pt(3), r1 = pt(3.15);
    const outer = arcCommands(C.x, C.y, r1, 0, deg(90));
    const inner = arcCommands(C.x, C.y, r0, deg(90), 0, false);
    const commands: Cmd[] = [...outer, { op: 'L', x: C.x, y: C.y + r0 }, ...inner, { op: 'Z' }];
    const v = stroke(commands, 0, [0, 0, 0, 1]);
    v.operation = 'fill-path';
    delete v.strokeWidthPt;
    const r = detectCurvedWalls({ vectors: [v], scaleMmPerPt: SCALE });
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]!.kind).toBe('solid');
    expect(r.segments[0]!.thicknessM).toBeCloseTo(0.15, 2);
  });

  it('ignores door swings, grey furniture and faces too far apart', () => {
    const vectors = [
      // door: swing arc + leaf
      stroke(arcCommands(C.x, C.y, pt(0.9), 0, deg(90)), 0.25),
      stroke([{ op: 'M', x: C.x, y: C.y }, { op: 'L', x: C.x + pt(0.9), y: C.y }], 0.5),
      // grey curved sofa outline 20 cm apart
      stroke(arcCommands(C.x + 400, C.y, pt(2.0), 0, deg(120)), 0.5, [0.6, 0.6, 0.6]),
      stroke(arcCommands(C.x + 400, C.y, pt(2.2), 0, deg(120)), 0.5, [0.6, 0.6, 0.6]),
      // black concentric lines a metre apart (seat and back of a long bench)
      stroke(arcCommands(C.x, C.y + 500, pt(3.0), 0, deg(90)), 1.2),
      stroke(arcCommands(C.x, C.y + 500, pt(4.0), 0, deg(90)), 1.2),
    ];
    const r = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE });
    expect(r.segments).toHaveLength(0);
    expect(r.pods).toHaveLength(0);
  });

  it('keeps the widest face pair when a wall has an extra finish line', () => {
    const vectors = [
      stroke(arcCommands(C.x, C.y, pt(5.0), 0, deg(60)), 1.2),
      stroke(arcCommands(C.x, C.y, pt(5.02), 0, deg(60)), 0.3),
      stroke(arcCommands(C.x, C.y, pt(5.2), 0, deg(60)), 1.2),
    ];
    const r = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE });
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]!.thicknessM).toBeCloseTo(0.2, 2);
  });

  it('cuts arcs into Pascal walls whose sagitta rebuilds the same circle, with or without a y flip', () => {
    const a0 = 0.5, a1 = 0.5 + deg(300);
    const vectors = [
      stroke(arcCommands(C.x, C.y, pt(2.5), a0, a1), 1.4),
      stroke(arcCommands(C.x, C.y, pt(2.7), a0, a1), 1.4),
    ];
    const { segments } = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE });
    for (const flip of [1, -1]) {
      const toPascal = (x: number, y: number): [number, number] => [x * M_PER_PT - 3, flip * y * M_PER_PT + 7];
      const [ccx, ccz] = toPascal(C.x, C.y);
      const pieces = curvedWallPieces(segments, toPascal, 90);
      expect(pieces.length).toBeGreaterThanOrEqual(4);
      let total = 0;
      for (const p of pieces) {
        // Pascal (wall-curve.ts): normal = (-dy, dx)/L, centre = mid + normal * (R - |s|) * sign(s)
        const dx = p.end.x - p.start.x, dy = p.end.y - p.start.y, L = Math.hypot(dx, dy);
        const s = p.curveOffset, as = Math.abs(s);
        expect(as).toBeLessThanOrEqual(L / 2);
        const R = (L * L) / (8 * as) + as / 2;
        const nx = -dy / L, ny = dx / L, sign = Math.sign(s) || 1;
        const cx = (p.start.x + p.end.x) / 2 + nx * (R - as) * sign;
        const cz = (p.start.y + p.end.y) / 2 + ny * (R - as) * sign;
        expect(R).toBeCloseTo(2.6, 3);
        expect(cx).toBeCloseTo(ccx, 3);
        expect(cz).toBeCloseTo(ccz, 3);
        expect(p.thicknessM).toBeCloseTo(0.2, 2);
        total += p.lengthM;
      }
      expect(total).toBeCloseTo(2.6 * deg(300), 1);
    }
  });

  it('spots straight walls that only copy a curved wall', () => {
    const vectors = [
      stroke(arcCommands(C.x, C.y, pt(8.0), 0, deg(40)), 1.2),
      stroke(arcCommands(C.x, C.y, pt(8.2), 0, deg(40)), 1.2),
    ];
    const { segments } = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE });
    expect(segments).toHaveLength(1);
    const on = (t: number, r: number) => ({ x: C.x + pt(r) * Math.cos(t), y: C.y + pt(r) * Math.sin(t) });
    const tol = pt(0.1);
    // a short chord along the band
    expect(curvedBandUnder(on(deg(10), 8.1), on(deg(14), 8.1), segments, tol)).not.toBeNull();
    // a radial wall meeting the curve, and a wall running past it
    expect(curvedBandUnder(on(deg(20), 7.0), on(deg(20), 8.1), segments, tol)).toBeNull();
    expect(curvedBandUnder(on(deg(60), 8.1), on(deg(70), 8.1), segments, tol)).toBeNull();
  });

  it('reads a pod drawn with arcs flattened into short straight lines', () => {
    const a0 = 0.5, a1 = 0.5 + deg(300);
    const vectors = [
      stroke(polyCommands(arcPoints(C.x, C.y, pt(2.5), a0, a1, 5)), 1.4),
      stroke(polyCommands(arcPoints(C.x, C.y, pt(2.7), a0, a1, 5)), 1.4),
    ];
    const r = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE });
    expect(r.diagnostics.polylineArcs).toBe(2);
    expect(r.pods).toHaveLength(1);
    expect(r.pods[0]!.enclosedDeg).toBeGreaterThan(295);
    expect(r.segments.every((s) => s.kind === 'solid' && Math.abs(s.thicknessM - 0.2) < 0.01)).toBe(true);
  });

  it('does not take an octagon or a chamfered outline for a curve', () => {
    const oct = (r: number) => [...arcPoints(C.x, C.y, pt(r), 0, deg(360), 45)];
    const vectors = [stroke(polyCommands(oct(2.5)), 1.4), stroke(polyCommands(oct(2.7)), 1.4)];
    const r = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE });
    expect(r.segments).toHaveLength(0);
  });

  it('reads an oval wall drawn with spline faces and builds it as a chain of arcs', () => {
    const A = pt(4), B = pt(2.5), half = pt(0.1);
    const vectors = [
      stroke(splineCommands(ellipseFace(C.x, C.y, A, B, 0.2, 2.6, -half, 16)), 1.4),
      stroke(splineCommands(ellipseFace(C.x, C.y, A, B, 0.2, 2.6, half, 16)), 1.4),
    ];
    const r = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE });
    const free = r.segments.filter((s) => s.source === 'free-form');
    expect(free).toHaveLength(1);
    expect(r.segments).toHaveLength(1);
    expect(free[0]!.kind).toBe('solid');
    expect(free[0]!.thicknessM).toBeCloseTo(0.2, 2);
    const toM = (p: { x: number; y: number }) => ({ x: p.x * M_PER_PT, y: p.y * M_PER_PT });
    const truth = ellipseFace(C.x, C.y, A, B, 0.1, 2.7, 0, 600).map(toM);
    const drawn = ellipseFace(C.x, C.y, A, B, 0.2, 2.6, 0, 400).map(toM);
    let truthLen = 0;
    for (let i = 1; i < drawn.length; i++) truthLen += Math.hypot(drawn[i]!.x - drawn[i - 1]!.x, drawn[i]!.y - drawn[i - 1]!.y);
    const pieces = curvedWallPieces(r.segments, (x, y) => [x * M_PER_PT, y * M_PER_PT]);
    expect(pieces.length).toBeGreaterThan(1);
    const near = (p: { x: number; y: number }) => Math.min(...truth.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
    for (const p of pieces) {
      expect(near(p.start)).toBeLessThan(0.02);
      expect(near(p.end)).toBeLessThan(0.02);
      // the arc Pascal builds passes through the drawn centreline in the middle too
      expect(near(pascalArc(p).mid)).toBeLessThan(0.025);
    }
    const total = pieces.reduce((s, p) => s + p.lengthM, 0);
    expect(total).toBeGreaterThan(truthLen * 0.95);
  });

  it('reads thin spline faces a few centimetres apart as glass', () => {
    const vectors = [
      stroke(splineCommands(ellipseFace(C.x, C.y, pt(5), pt(3), 0.3, 1.6, -pt(0.025), 12)), 0.3),
      stroke(splineCommands(ellipseFace(C.x, C.y, pt(5), pt(3), 0.3, 1.6, pt(0.025), 12)), 0.3),
    ];
    const r = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE });
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]!.kind).toBe('glass');
    expect(r.segments[0]!.thicknessM).toBeCloseTo(0.05, 2);
  });

  it('ignores a basin or bowl outline (small, tight double oval)', () => {
    const vectors = [
      stroke(splineCommands(ellipseFace(C.x, C.y, pt(0.3), pt(0.22), 0, deg(360), 0, 16)), 0.5),
      stroke(splineCommands(ellipseFace(C.x, C.y, pt(0.3), pt(0.22), 0, deg(360), pt(0.03), 16)), 0.5),
      stroke(splineCommands(ellipseFace(C.x + 300, C.y, pt(0.45), pt(0.3), 0, deg(360), 0, 16)), 1.2),
      stroke(splineCommands(ellipseFace(C.x + 300, C.y, pt(0.45), pt(0.3), 0, deg(360), pt(0.1), 16)), 1.2),
    ];
    const r = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE });
    expect(r.segments).toHaveLength(0);
  });

  it('keeps glass that only touches a solid wall on the same ring', () => {
    // inner thin face all round; heavy outer face over the solid part, thin outer face over the glass
    const vectors = [
      stroke(arcCommands(C.x, C.y, pt(2.5), 0, deg(300)), 0.3),
      stroke(arcCommands(C.x, C.y, pt(2.6), deg(60), deg(200)), 1.4),
      stroke(arcCommands(C.x, C.y, pt(2.55), deg(195), deg(260)), 0.3),
    ];
    const r = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE });
    const solid = r.segments.filter((s) => s.kind === 'solid');
    // (the inner line also runs on alone: on this pod-sized ring it closes the ring as glass)
    const glass = r.segments.filter((s) => s.kind === 'glass' && s.source === 'faces');
    expect(solid).toHaveLength(1);
    expect(glass).toHaveLength(1);
    expect((glass[0]!.a1 - glass[0]!.a0) / deg(1)).toBeGreaterThan(55);
  });

  it('closes a pod ring with its single lines and leaves the door gap open', () => {
    const vectors = [
      // glass: two thin faces over 200 degrees
      stroke(arcCommands(C.x, C.y, pt(2.5), 0, deg(200)), 0.3),
      stroke(arcCommands(C.x, C.y, pt(2.55), 0, deg(200)), 0.3),
      // solid back drawn as one heavy line on the inner face, round to 300 degrees
      stroke(arcCommands(C.x, C.y, pt(2.5), deg(200), deg(300)), 1.4),
      // 300-360: the door, no line
    ];
    const r = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE, }, { podMinCoverDeg: 180 });
    expect(r.pods).toHaveLength(1);
    const single = r.segments.filter((s) => s.source === 'single-line');
    expect(single).toHaveLength(1);
    expect(single[0]!.kind).toBe('solid');
    expect(single[0]!.podId).toBe('pod_1');
    // the wall lies outside the line, like the pod's other walls
    expect(single[0]!.radiusM).toBeGreaterThan(2.5);
    expect(r.pods[0]!.enclosedDeg).toBeGreaterThan(296);
    expect(r.pods[0]!.enclosedDeg).toBeLessThan(304);
  });

  it('drops straight walls that copy a free-form wall', () => {
    const A = pt(4), B = pt(2.5), half = pt(0.1);
    const vectors = [
      stroke(splineCommands(ellipseFace(C.x, C.y, A, B, 0.2, 2.6, -half, 16)), 1.4),
      stroke(splineCommands(ellipseFace(C.x, C.y, A, B, 0.2, 2.6, half, 16)), 1.4),
    ];
    const { segments } = detectCurvedWalls({ vectors, scaleMmPerPt: SCALE });
    const c = ellipseFace(C.x, C.y, A, B, 1.0, 1.05, 0, 1);
    expect(curvedBandUnder(c[0]!, c[1]!, segments, pt(0.1))).not.toBeNull();
    expect(curvedBandUnder({ x: C.x, y: C.y }, { x: C.x + 50, y: C.y }, segments, pt(0.1))).toBeNull();
  });

  it('merges angle intervals inside one turn', () => {
    const merged = mergeIntervals([[0.2, 0.5], [0.4, 1.0]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]![0]).toBeCloseTo(0.2, 9);
    expect(merged[0]![1]).toBeCloseTo(1.0, 9);
    const wrapped = mergeIntervals([[-0.3, 0.3]]);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]![1] - wrapped[0]![0]).toBeCloseTo(0.6, 9);
    expect(mergeIntervals([[0, 7]])).toEqual([[0, Math.PI * 2]]);
  });
});
