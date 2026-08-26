// CS4 recurrence-first furniture family extractor (isolated — self-contained contracts).
// Signature is rotation-invariant (small x large side), so 0°/90° instances hash identically.

export type Vec2 = { x: number; y: number };
export type Bounds = [number, number, number, number];
export interface SourceRef { primitiveIds: string[]; rootIds: string[]; page: number }
export interface Component {
  id: string;
  bounds: Bounds;
  points: Vec2[];
  closed: boolean;
  curves: number;
  lines: number;
  strokeWidth: number;
  source: SourceRef;
}
export type Verdict = 'accepted' | 'review' | 'rejected';

export const boundsSize = (b: Bounds) => ({ w: b[2] - b[0], h: b[3] - b[1] });

export interface FurnitureInstance {
  id: string;
  familyId: string;
  center: Vec2;
  orientation: number;
  width: number;
  depth: number;
  sourceIds: string[];
  confidence: number;
  verdict: Verdict;
}

export type ProposedClass = 'bed' | 'wardrobe' | 'desk' | 'table' | 'chair' | 'generic-item';

export interface FurnitureFamily {
  id: string;
  signature: string;
  instances: FurnitureInstance[];
  recurrence: number;
  proposedClass: ProposedClass;
  classConfidence: number;
  catalogueStatus: 'unmatched' | 'review' | 'matched';
}

export interface DiscoveryOptions {
  /** Drawing units per meter (1000 for mm fixtures, 1 for meter-space input). */
  unitsPerMeter?: number;
  /** Minimum instances before a signature group becomes a family. */
  minRecurrence?: number;
}

const q = (x: number, step = 0.025) => Math.round(x / step) * step;

export function canonicalSignature(c: Component, unitsPerMeter = 1): string {
  const z = boundsSize(c.bounds);
  const small = Math.min(z.w, z.h) / unitsPerMeter;
  const large = Math.max(z.w, z.h) / unitsPerMeter;
  const ratio = large / Math.max(0.001, small);
  return `D${q(small)}x${q(large)}|R${q(ratio, 0.05)}|L${c.lines}|C${c.curves}|P${c.points.length}|${c.closed ? 'Z' : 'O'}|SW${q(c.strokeWidth, 0.05)}`;
}

/**
 * Geometry-only class proposal. Deliberately conservative:
 *  - bed: closed rect, aspect 1.65-2.9 AND plausible bed dims (short side 0.7-1.85 m, long side 1.7-2.35 m)
 *  - desk: only when dims are plausible desk dims — NOT every elongated rectangle
 *  - everything else without a plausible dim envelope stays 'generic-item'
 */
export function propose(c: Component, unitsPerMeter = 1): { value: ProposedClass; confidence: number } {
  const z = boundsSize(c.bounds);
  const small = Math.min(z.w, z.h) / unitsPerMeter;
  const large = Math.max(z.w, z.h) / unitsPerMeter;
  const r = large / Math.max(0.001, small);
  if (!c.closed || small <= 0) return { value: 'generic-item', confidence: 0.15 };

  // Bed: aspect + closed + plausible bed dimensions (covers single 0.9x2.0 through king 1.8x2.1).
  if (r >= 1.65 && r <= 2.9 && small >= 0.7 && small <= 1.85 && large >= 1.7 && large <= 2.35) {
    return { value: 'bed', confidence: 0.68 };
  }
  // Wardrobe: long shallow closed run, or narrow-depth elongated casegood.
  if ((r > 3.1 && small >= 0.35 && small <= 0.85) || (small >= 0.35 && small < 0.7 && large >= 1.2 && large <= 3.0 && r >= 2.2)) {
    return { value: 'wardrobe', confidence: 0.42 };
  }
  // Chair: near-square small footprint.
  if (r < 1.35 && small >= 0.4 && large <= 0.9) {
    return { value: 'chair', confidence: 0.45 };
  }
  // Desk: plausible desk envelope only (short 0.5-1.1 m, long 1.2-2.4 m, moderate aspect).
  if (r >= 1.35 && r <= 2.6 && small >= 0.5 && small <= 1.1 && large >= 1.2 && large <= 2.4 && large < 1.7) {
    return { value: 'desk', confidence: 0.5 };
  }
  // Elongated work surface that is too long/wide to be a bed or desk.
  if (r < 1.35 && (c.curves >= 4 || (large >= 0.9 && large <= 2.0))) {
    return { value: 'table', confidence: 0.38 };
  }
  return { value: 'generic-item', confidence: 0.25 };
}

export function discoverFurnitureFamilies(cs: Component[], opts: DiscoveryOptions = {}): FurnitureFamily[] {
  const unitsPerMeter = opts.unitsPerMeter ?? 1;
  const minRecurrence = opts.minRecurrence ?? 3;
  const groups = new Map<string, Component[]>();
  for (const c of cs) {
    const z = boundsSize(c.bounds);
    if (!c.closed || c.points.length < 4 || Math.min(z.w, z.h) <= 0 || c.curves > 20) continue;
    const s = canonicalSignature(c, unitsPerMeter);
    const g = groups.get(s) ?? [];
    g.push(c);
    groups.set(s, g);
  }
  // Deterministic family numbering: sort groups by recurrence desc then signature.
  const sorted = [...groups.entries()]
    .filter(([, items]) => items.length >= minRecurrence)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  let n = 0;
  const out: FurnitureFamily[] = [];
  for (const [s, itemsRaw] of sorted) {
    const items = [...itemsRaw].sort((a, b) => a.id.localeCompare(b.id));
    const id = `ffe-family-${String(++n).padStart(3, '0')}`;
    const instances = items.map((c, i) => {
      const z = boundsSize(c.bounds);
      const confidence = Math.min(0.96, 0.62 + Math.min(0.22, items.length * 0.025) + Math.min(0.1, (c.lines + c.curves) * 0.005));
      return {
        id: `${id}:${i + 1}`,
        familyId: id,
        center: { x: (c.bounds[0] + c.bounds[2]) / 2, y: (c.bounds[1] + c.bounds[3]) / 2 },
        orientation: z.w >= z.h ? 0 : Math.PI / 2,
        width: z.w,
        depth: z.h,
        sourceIds: c.source.primitiveIds,
        confidence,
        verdict: 'accepted' as const,
      };
    });
    const proposed = propose(items[0]!, unitsPerMeter);
    out.push({
      id, signature: s, instances, recurrence: instances.length,
      proposedClass: proposed.value, classConfidence: proposed.confidence,
      catalogueStatus: 'review',
    });
  }
  return out;
}
