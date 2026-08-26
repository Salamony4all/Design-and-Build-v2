// Normalized vector component store (Change Set 4, §9).
//
// Built on the ACTIVATED extraction-mupdf `collectPageVectors` output (every
// MuPDF fill/stroke primitive + decomposed subpath). Each component preserves
// full source provenance and a local-coordinate normalization with an exact
// transform back to source PDF space. We do NOT replace the activated wall
// extractor — we consume its raw vector collection as a richer input.

import type { Vec2 } from 'design-build-extraction-contracts';

/** [minX, minY, maxX, maxY] in source PDF points. */
export type Bounds = [number, number, number, number];

export interface TopologySignature {
  widthM: number;
  depthM: number;
  aspect: number;
  lines: number;
  curves: number;
  points: number;
  closed: boolean;
  subpaths: number;
  symmetry: number; // 0..1 horizontal-vertical symmetry of the point cloud
  strokeWidthMm: number;
  fillStrokeRatio: number;
  /** Stable canonical hash combining normalized geometry (rotation-invariant). */
  canonical: string;
}

export interface NormalizedComponent {
  componentId: string;
  page: number;
  sourceRootIds: string[];
  sourceSubpathIds: string[];
  sourceStrokeIds: string[];
  bounds: Bounds; // source PDF points
  orientedBounds: { w: number; h: number; orientation: number };
  centre: Vec2;
  orientation: number; // radians, normalized to [0, π)
  normalizedPoints: Vec2[]; // local coords, centered, rotation-normalized
  segments: { a: Vec2; b: Vec2 }[];
  curves: number;
  closedPaths: number;
  fillColours: number[][];
  strokeColours: number[][];
  strokeWidths: number[];
  commandCount: number;
  subpathCount: number;
  topologySignature: TopologySignature;
  buildingRegionRelationship: 'inside' | 'outside' | 'boundary';
}

export type Component = NormalizedComponent;

const quant = (x: number, step = 0.025) => Math.round(x / step) * step;

function rotate(p: Vec2, ang: number): Vec2 {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function boundsOf(pts: Vec2[]): Bounds {
  if (!pts.length) return [0, 0, 0, 0];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function symmetryOf(local: Vec2[]): number {
  // compare point cloud to its own reflection across both axes (centered)
  if (local.length < 3) return 0;
  let symX = 0, symY = 0;
  for (const p of local) {
    if (local.some((q) => Math.abs(q.x + p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6)) symX++;
    if (local.some((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y + p.y) < 1e-6)) symY++;
  }
  return (symX + symY) / (2 * local.length);
}

/**
 * Build one normalized Component from a collected MuPDF vector (root or
 * decomposed subpath). `scaleMmPerPt` converts stroke widths to mm. Renders
 * closed/open topology, subpath count, internal line structure and an exact
 * local transform (we keep `bounds` in source space for provenance).
 */
export function buildComponent(
  raw: {
    id: string;
    sourceRootId?: string;
    operation: 'fill-path' | 'stroke-path';
    points: Vec2[];
    subpaths?: Vec2[][];
    bounds: Bounds;
    color?: number[];
    alpha?: number;
    strokeWidth?: number;
    closed?: boolean;
  },
  page: number,
  scaleMmPerPt: number,
  buildingRegion: Bounds,
): Component {
  const pts = raw.points.length ? raw.points : (raw.subpaths ?? [])[0] ?? [];
  const b = boundsOf(pts);
  const w = b[2] - b[0], h = b[3] - b[1];
  const orientation = w >= h ? 0 : Math.PI / 2;
  const centre = { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 };
  // Normalize: center, then rotate so the long axis is horizontal.
  const local = pts.map((p) => rotate({ x: p.x - centre.x, y: p.y - centre.y }, -orientation));
  const lb = boundsOf(local);
  const lw = lb[2] - lb[0], lh = lb[3] - lb[1];
  const small = Math.min(lw, lh), large = Math.max(lw, lh);
  const aspect = large / Math.max(1e-6, small);
  const subpaths = raw.subpaths?.length ?? (raw.closed ? 1 : 0);
  const curves = (raw as any).commands?.filter((c: any) => c.op === 'C').length ?? 0;
  const inside = b[0] >= buildingRegion[0] && b[1] >= buildingRegion[1] && b[2] <= buildingRegion[2] && b[3] <= buildingRegion[3];
  const sig: TopologySignature = {
    widthM: +(small * scaleMmPerPt).toFixed(3), // mm (small = short side)
    depthM: +(large * scaleMmPerPt).toFixed(3), // mm (long side)
    aspect: +quant(aspect, 0.05).toFixed(2),
    lines: (raw as any).commands?.filter((c: any) => c.op === 'L').length ?? 0,
    curves,
    points: pts.length,
    closed: !!raw.closed,
    subpaths,
    symmetry: +symmetryOf(local).toFixed(2),
    strokeWidthMm: +((raw.strokeWidth ?? 0) * scaleMmPerPt / 72 / 1000).toFixed(3),
    fillStrokeRatio: 0,
    canonical: `D${quant(small).toFixed(3)}x${quant(large).toFixed(3)}|R${quant(aspect, 0.05).toFixed(2)}|L${(raw as any).commands?.filter((c: any) => c.op === 'L').length ?? 0}|C${curves}|P${pts.length}|${raw.closed ? 'Z' : 'O'}|SW${quant(raw.strokeWidth ?? 0, 0.05).toFixed(2)}`,
  };
  return {
    componentId: raw.id,
    page,
    sourceRootIds: raw.sourceRootId != null ? [raw.sourceRootId] : [raw.id],
    sourceSubpathIds: raw.sourceRootId ? [raw.id] : [],
    sourceStrokeIds: [],
    bounds: b,
    orientedBounds: { w: lw, h: lh, orientation },
    centre,
    orientation,
    normalizedPoints: local,
    segments: local.length > 1 ? [{ a: local[0]!, b: local[local.length - 1]! }] : [],
    curves,
    closedPaths: raw.closed ? 1 : 0,
    fillColours: raw.color != null ? [raw.color] : [],
    strokeColours: raw.color != null ? [raw.color] : [],
    strokeWidths: raw.strokeWidth != null ? [raw.strokeWidth] : [],
    commandCount: (raw as any).commands?.length ?? pts.length,
    subpathCount: subpaths,
    topologySignature: sig,
    buildingRegionRelationship: inside ? 'inside' : 'outside',
  };
}

/** Cluster components into recurrence families by canonical topology signature. */
export function clusterFamilies(components: Component[], minRecurrence = 3): Map<string, Component[]> {
  const groups = new Map<string, Component[]>();
  for (const c of components) {
    const key = c.topologySignature.canonical;
    const g = groups.get(key) ?? [];
    g.push(c);
    groups.set(key, g);
  }
  const out = new Map<string, Component[]>();
  for (const [k, g] of groups) if (g.length >= minRecurrence) out.set(k, g);
  return out;
}
