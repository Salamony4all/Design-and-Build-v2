import { describe, expect, it } from 'vitest';
import {
  composeDepthMapPixels,
  composeDepthMeshGuidePixels,
  dilate,
  edgeMask,
  fidelityGrade,
  geometryFidelity,
  gridLineMask,
  linearizeSrgbDepth,
  modelLineMask,
  type RgbaImage,
} from './geometry-fidelity';

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

describe('depth-weighted & 3D mesh-framed guides', () => {
  const imgOf = (width: number, height: number, paint: (x: number, y: number) => [number, number, number]): RgbaImage => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b] = paint(x, y);
        data.set([r, g, b, 255], (y * width + x) * 4);
      }
    }
    return { width, height, data };
  };

  it('extracts Z-occluded steel-blue grid lines cleanly and ignores white background', () => {
    const grid = imgOf(6, 4, (x, y) => {
      if (y === 2) return [30, 58, 95]; // steel-blue 3D grid line
      if (x === 4 && y === 0) return [240, 242, 245]; // below threshold noise
      return [255, 255, 255];
    });
    const mask = gridLineMask(grid);
    expect(mask[2 * 6 + 0]).toBe(1);
    expect(mask[2 * 6 + 5]).toBe(1);
    expect(mask[0 * 6 + 4]).toBe(0);
    expect(mask[1 * 6 + 3]).toBe(0);
  });

  it('weights near edges darker/thicker than far edges and keeps edges above steel-blue mesh lines', () => {
    const width = 16;
    const height = 16;
    const edge = new Uint8Array(width * height);
    const grid = new Uint8Array(width * height);
    edge[4 * width + 4] = 1; // near foreground edge
    edge[4 * width + 12] = 1; // far background edge
    grid[4 * width + 4] = 1; // coincident grid pixel must not overwrite edge
    grid[10 * width + 8] = 1; // open floor grid pixel

    const depth = imgOf(width, height, (x) => {
      if (x < 8) return [230, 230, 230]; // near (<5 m)
      return [40, 40, 40]; // far (>9 m)
    });

    const px = composeDepthMeshGuidePixels(edge, grid, depth, width, height);
    const rgbAt = (x: number, y: number) => {
      const p = (y * width + x) * 4;
      return [px[p], px[p + 1], px[p + 2]];
    };

    const nearPx = rgbAt(4, 4);
    const nearNbrPx = rgbAt(5, 4); // dilated around near edge
    const farPx = rgbAt(12, 4);
    const farNbrPx = rgbAt(13, 4); // far edge not 3x3 near-dilated
    const gridPx = rgbAt(8, 10);

    expect(nearPx[0]).toBeLessThan(farPx[0]);
    expect(nearNbrPx).toEqual([10, 14, 24]);
    expect(farNbrPx[0]).toBeGreaterThan(220);
    expect(gridPx[2]).toBeGreaterThan(gridPx[0] + 20);
  });

  it('normalizes linear camera-space metric Z-depth monotonically (near bright > mid > far dark)', () => {
    const pass = imgOf(4, 1, (x) => {
      if (x === 0) return [230, 230, 230];
      if (x === 1) return [130, 130, 130];
      if (x === 2) return [30, 30, 30];
      return [0, 0, 0];
    });
    const px = composeDepthMapPixels(pass);
    expect(px[0]).toBeGreaterThan(px[4]);
    expect(px[4]).toBeGreaterThan(px[8]);
    expect(px[8]).toBeGreaterThan(px[12]);
    expect(px[3]).toBe(255);
    expect(px[15]).toBe(255);
  });

  it('linearizes sRGB GPU fog-depth bytes into distinct near/mid/far tiers', () => {
    const srgb = imgOf(5, 1, (x) => {
      if (x === 0) return [245, 245, 245]; // near foreground
      if (x <= 2) return [186, 186, 186]; // 50%-linear midground in sRGB
      if (x === 3) return [90, 90, 90]; // far background
      return [5, 5, 5]; // sky/backdrop
    });
    const lin = linearizeSrgbDepth(srgb);
    expect(lin.data[0]).toBeGreaterThanOrEqual(165);
    expect(lin.data[8]).toBeGreaterThanOrEqual(85);
    expect(lin.data[8]).toBeLessThan(165);
    expect(lin.data[12]).toBeLessThan(85);
    expect(lin.data[16]).toBe(5);
    expect(lin.data[3]).toBe(255);

    const edge = new Uint8Array([1, 0, 1, 1, 0]);
    const px = composeDepthMeshGuidePixels(edge, null, lin, 5, 1);
    expect(px[0]).toBeLessThan(px[8]);
    expect(px[8]).toBeLessThan(px[12]);
  });
});
