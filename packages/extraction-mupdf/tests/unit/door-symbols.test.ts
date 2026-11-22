// Synthetic (drawing-independent) checks of the leaf + swing-arc door symbol detector.
import { describe, expect, it } from 'vitest';
import { runDoorPipeline, PURE_DOOR_DEFAULTS } from '../../src/index';

const SCALE = 17.5; // mm per pt
const LEAF = 800 / SCALE; // 800 mm leaf in pt
type P = { x: number; y: number };
let n = 0;
const vec = (points: P[], strokeWidth = 0.5) => ({
  id: `v${n++}`,
  operation: 'stroke-path',
  commands: [],
  points,
  subpaths: [],
  bounds: [0, 0, 0, 0],
  strokeWidth,
});
/** door symbol: leaf from hinge at `leafDeg`, arc swept back to the closed position at `closedDeg` */
function door(hinge: P, closedDeg: number, leafDeg: number, r = LEAF) {
  const at = (deg: number): P => ({ x: hinge.x + r * Math.cos((deg * Math.PI) / 180), y: hinge.y + r * Math.sin((deg * Math.PI) / 180) });
  const steps = 16;
  const arc: P[] = [];
  for (let i = 0; i <= steps; i++) arc.push(at(closedDeg + ((leafDeg - closedDeg) * i) / steps));
  return [vec([hinge, at(leafDeg)]), vec(arc)];
}
const wall = (id: string, a: P, b: P, thickness = 10) => ({ physicalWallId: id, centerline: { a, b }, thickness });
const run = (vectors: any[], walls: any[]) =>
  runDoorPipeline(
    { vectors, wallResult: { accepted: walls, scaleMmPerPt: SCALE } as any, pageBoundsMupdf: [0, 0, 1000, 1000] },
    PURE_DOOR_DEFAULTS,
    false,
  );

describe('door symbol detector (synthetic)', () => {
  const H = wall('H', { x: 0, y: 100 }, { x: 600, y: 100 });
  const V = wall('V', { x: 100, y: 0 }, { x: 100, y: 100 }); // partition the open leaf lies along

  it('hosts a door drawn open at 90 degrees on the wall it closes into, not the wall the leaf lies along', () => {
    const res = run(door({ x: 100, y: 100 }, 0, -90), [H, V]);
    expect(res.accepted.length).toBe(1);
    const d = res.accepted[0]!;
    expect(d.selectedPhysicalWallId).toBe('H');
    expect(d.wallLocalInterval!.from).toBeCloseTo(100, 0);
    expect(d.wallLocalInterval!.to).toBeCloseTo(100 + LEAF, 0);
    expect(d.hingeSide).toBe('left');
    expect(d.swingDirection).toBe('outward'); // leaf on the -y side = against the +Z normal (0, 1)
  });

  it('reads hinge end and swing side for the mirrored door', () => {
    const d = run(door({ x: 100 + LEAF, y: 100 }, 180, 90), [H]).accepted[0]!;
    expect(d.hingeSide).toBe('right');
    expect(d.swingDirection).toBe('inward');
    expect(d.wallLocalInterval!.from).toBeCloseTo(100, 0);
  });

  it('handles a door drawn part-open (45 degrees)', () => {
    const res = run(door({ x: 300, y: 100 }, 0, -45), [H]);
    expect(res.accepted.length).toBe(1);
    expect(res.accepted[0]!.wallLocalInterval!.from).toBeCloseTo(300, 0);
  });

  it('merges two leaves closing onto each other into one double door', () => {
    const res = run([...door({ x: 200, y: 100 }, 0, -90), ...door({ x: 200 + 2 * LEAF, y: 100 }, 180, 270)], [H]);
    expect(res.accepted.length).toBe(1);
    expect(res.accepted[0]!.doorType).toBe('DOUBLE_SWING');
    expect(res.accepted[0]!.widthPt).toBeCloseTo(2 * LEAF, 0);
  });

  it('does not accept a leaf + arc symbol that is not in a wall (wardrobe / furniture door)', () => {
    const res = run([...door({ x: 100, y: 100 }, 0, -90), ...door({ x: 300, y: 300 }, 0, -90)], [H]);
    expect(res.accepted.length).toBe(1);
    expect(res.rejected.length).toBe(1);
  });
});
