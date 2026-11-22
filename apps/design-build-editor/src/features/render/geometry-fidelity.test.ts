import { describe, expect, it } from 'vitest';
import { dilate, edgeMask, fidelityGrade, geometryFidelity, modelLineMask, type RgbaImage } from './geometry-fidelity';

const W = 240;
const H = 180;

type Rect = [number, number, number, number]; // x, y, w, h

/** White sheet with dark "walls" — a stand-in for a top-down model view. */
function sheet(rects: Rect[], opts: { dx?: number; dy?: number; noise?: number; seed?: number; tint?: boolean } = {}): RgbaImage {
  const data = new Uint8ClampedArray(W * H * 4);
  let s = opts.seed ?? 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      // Floor: light, optionally "wood" tinted with fine grain noise.
      let v = opts.tint ? 214 : 245;
      if (opts.noise) v += (rnd() - 0.5) * opts.noise;
      let r = v;
      let g = v;
      let b = opts.tint ? v - 30 : v;
      for (const [rx, ry, rw, rh] of rects) {
        const xx = x - (opts.dx ?? 0);
        const yy = y - (opts.dy ?? 0);
        if (xx >= rx && xx < rx + rw && yy >= ry && yy < ry + rh) {
          r = g = b = opts.tint ? 92 : 60;
        }
      }
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

// Outer walls of a two-room plan, an internal wall with a door gap, a window gap.
const PLAN: Rect[] = [
  [20, 20, 200, 8],
  [20, 152, 80, 8],
  [130, 152, 90, 8], // window gap 100..130 in the bottom wall
  [20, 20, 8, 140],
  [212, 20, 8, 140],
  [120, 28, 8, 60],
  [120, 110, 8, 42], // door gap 88..110 in the internal wall
];

describe('geometryFidelity', () => {
  it('scores an identical image ~1', () => {
    const a = sheet(PLAN);
    const r = geometryFidelity(a, sheet(PLAN));
    expect(r.score).toBeGreaterThan(0.97);
    expect(r.shift).toEqual({ dx: 0, dy: 0 });
    expect(r.modelEdgePixels).toBeGreaterThan(200);
  });

  it('ignores new materials and texture when the walls stay put', () => {
    const r = geometryFidelity(sheet(PLAN), sheet(PLAN, { tint: true, noise: 18, seed: 7 }));
    expect(r.outside).toBeLessThan(0.04);
    expect(r.score).toBeGreaterThan(0.85);
    expect(fidelityGrade(r.score)).toBe('good');
  });

  it('flags a shifted camera', () => {
    const r = geometryFidelity(sheet(PLAN), sheet(PLAN, { dx: 9, dy: 6 }));
    expect(r.score).toBeLessThan(0.5);
    expect(r.shift.dx !== 0 || r.shift.dy !== 0).toBe(true);
    expect(fidelityGrade(r.score)).toBe('poor');
  });

  it('drops when walls go missing', () => {
    const missing = PLAN.filter((_, i) => i !== 5 && i !== 6 && i !== 4); // internal wall and right wall gone
    const r = geometryFidelity(sheet(PLAN), sheet(missing));
    expect(r.score).toBeLessThan(0.8);
    expect(r.score).toBeGreaterThan(0.3);
  });

  it('barely moves when a small gap is filled (the line overlay is the check for that)', () => {
    // Recall measures what the render kept, not what it added: a filled 30 px gap
    // only loses the two short gap-end edges.
    const closed = [...PLAN, [100, 152, 30, 8] as Rect];
    const same = geometryFidelity(sheet(PLAN), sheet(PLAN)).score;
    const r = geometryFidelity(sheet(PLAN), sheet(closed));
    expect(r.score).toBeLessThanOrEqual(same);
    expect(r.score).toBeGreaterThan(0.9);
  });

  it('penalises invented structure where the model is empty', () => {
    // The render keeps every model wall but adds a second "building" in the empty corner.
    const invented: Rect[] = [...PLAN, [150, 40, 50, 6], [150, 40, 6, 50], [150, 84, 50, 6], [194, 40, 6, 50], [170, 40, 4, 50]];
    const r = geometryFidelity(sheet(PLAN.slice(0, 3)), sheet([...PLAN.slice(0, 3), ...invented.slice(7)]));
    expect(r.recallAligned).toBeGreaterThan(0.9);
    expect(r.added).toBeGreaterThan(0.3);
    expect(r.outside).toBeGreaterThan(0.14);
    expect(r.score).toBeLessThan(0.4);
  });

  it('returns 0 with no model edges instead of noise', () => {
    const blank = sheet([]);
    const r = geometryFidelity(blank, sheet(PLAN));
    expect(r.modelEdgePixels).toBe(0);
    expect(r.score).toBe(0);
  });

  it('rejects mismatched analysis sizes', () => {
    const a = sheet(PLAN);
    expect(() => geometryFidelity(a, { width: 10, height: 10, data: new Uint8ClampedArray(400) })).toThrow();
  });
});

describe('mask helpers', () => {
  it('dilates by a square radius', () => {
    const m = new Uint8Array(25);
    m[12] = 1;
    const d = dilate(m, 5, 5, 1);
    expect(Array.from(d).reduce((a, b) => a + b, 0)).toBe(9);
  });

  it('keeps nothing below the magnitude floor', () => {
    const mag = new Float32Array([0, 1, 2, 3, 100]);
    expect(Array.from(edgeMask(mag, 0.5, 50))).toEqual([0, 0, 0, 0, 1]);
  });
});

describe('modelLineMask (edges of the 3D model from flat passes)', () => {
  const w = 40;
  const h = 30;
  const flat = (paint: (x: number, y: number) => [number, number, number]): RgbaImage => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b] = paint(x, y);
        data.set([r, g, b, 255], (y * w + x) * 4);
      }
    }
    return { width: w, height: h, data };
  };

  it('finds a corner (orientation change) and a wall end in front of a parallel wall (object change), nothing else', () => {
    // Two wall faces meet at x = 20 (different normals); a parallel wall end (same
    // normal, another object) covers x 5..9, y 5..24 on the left face.
    const normals = flat((x) => (x < 20 ? [128, 128, 255] : [255, 128, 128]));
    const ids = flat((x, y) => (x >= 5 && x < 10 && y >= 5 && y < 25 ? [200, 40, 40] : x < 20 ? [40, 200, 40] : [40, 40, 200]));
    const m = modelLineMask(normals, ids);
    const at = (x: number, y: number) => m[y * w + x];
    expect(at(19, 15)).toBe(1); // corner between the two faces
    expect(at(4, 15)).toBe(1); // left side of the wall end
    expect(at(9, 15)).toBe(1); // right side of the wall end
    expect(at(7, 4)).toBe(1); // top of the wall end
    expect(at(14, 15)).toBe(0); // flat wall face
    expect(at(30, 10)).toBe(0);
    expect(at(7, 15)).toBe(0); // inside the wall end
  });

  it('ignores small colour noise (no shading or texture lines)', () => {
    const normals = flat((x, y) => [128 + ((x + y) % 3), 128, 255 - ((x * y) % 4)]);
    const ids = flat(() => [40, 200, 40]);
    expect(modelLineMask(normals, ids).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('rejects passes of different sizes', () => {
    expect(() => modelLineMask({ width: 2, height: 2, data: new Uint8ClampedArray(16) }, { width: 3, height: 2, data: new Uint8ClampedArray(24) })).toThrow();
  });
});
