// Change Set 4 — evidence-only geometric extraction contracts (isolated).
//
// These types are self-contained for the window/door candidate extractors.
// They deliberately do NOT import from production packages
// (design-build-extraction-contracts, pascal-adapter, ...) and they do NOT
// describe Pascal WindowNodes/DoorNodes. Candidates are evidence records:
// every field must be derivable from source vector geometry, with provenance.

export type Vec2 = { x: number; y: number };

/** [minX, minY, maxX, maxY] in source PDF points. */
export type Bounds = [number, number, number, number];

export type Segment = { a: Vec2; b: Vec2 };

/** Provenance back to the raw MuPDF vector collection. */
export interface SourceRef {
  primitiveIds: string[];
  rootIds: string[];
  page: number;
}

/** A wall accepted by the (upstream, unchanged) wall extractor. */
export interface PhysicalWall {
  id: string;
  centerline: Segment;
  thickness: number; // source units (PDF pt unless the caller normalized)
  length: number; // cached len(centerline)
  source: SourceRef;
  confidence: number; // 0..1
}

/**
 * A finite interval hosted on one wall's centerline.
 * `from`/`to`/`center` are normalized parameters t ∈ [0, 1] along the
 * centerline (a → b). `width` is the absolute opening width in source units.
 */
export interface HostedInterval {
  hostWallId: string;
  from: number;
  to: number;
  center: number;
  width: number;
}

/**
 * Normalized drawing component (one symbol-ish cluster of vector geometry).
 * `points` is the polyline sample of the component's path(s); `curves` and
 * `lines` count the path operators so extractors can reason about topology
 * (e.g. a swing arc has curves ≥ 1, glazing lines have curves = 0).
 */
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
