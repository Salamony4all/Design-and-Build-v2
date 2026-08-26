// harness/finalized-wall-map.ts
// M2 — FINALIZED RUNTIME WALL MAP.
//
// Builds ONE authoritative wall map from the staged Pascal drafts (70 original
// + accepted completion walls) and verifies its topology. It is PURE read-only
// bookkeeping over geometry that `prepareLiveDrafts` + the wall-completion
// installer have ALREADY placed in the shared BuildingFrame — it does NOT
// recompute or shift any coordinates, so M1's guide/slab/wall alignment is
// untouched.
//
// Verification gate (required by M2 LIVE ACCEPTANCE):
//   duplicateWallIds: 0
//   missingRuntimeWalls: 0
//   nonWallTargets: 0

export interface FinalizedWallEntry {
  /** The live Pascal WallNode id used during installation. */
  liveWallNodeId: string;
  /** Original source wall id (the neutral ExtractionResult wall id) — null for completion walls. */
  sourceWallId: string | null;
  /** The physical wall id from the extraction contract (world/plan stable). */
  physicalWallId: string;
  /** Present only for completion (inferred) walls; null for original 70. */
  completionWallId: string | null;
  /** Original (pre-completion) wall this completion wall closes against — informational. */
  closesOriginalWallId: string | null;
  finalizedStart: [number, number];
  finalizedEnd: [number, number];
  finalizedLengthM: number;
  finalizedDirection: number; // radians, atan2(dy, dx)
  finalizedOrigin: [number, number];
  isCompletion: boolean;
}

export interface WallMapVerification {
  duplicateWallIds: number;
  missingRuntimeWalls: number;
  nonWallTargets: number;
  /** runtime node ids seen more than once */
  duplicateIds: string[];
  /** entries whose node type was not 'wall' */
  nonWallEntries: string[];
  pass: boolean;
}

export interface WallMapBuild {
  originalWalls: number;
  completionWalls: number;
  finalizedWalls: number;
  entries: FinalizedWallEntry[];
  verification: WallMapVerification;
  pass: boolean;
}

/** Minimal wall-draft shape (mirrors Code06Drafts.wallDrafts items). */
export interface WallDraftLike {
  id: string;
  physicalWallId: string;
  node: {
    id?: string;
    type?: string;
    start?: [number, number] | { x: number; y: number };
    end?: [number, number] | { x: number; y: number };
    metadata?: {
      physicalWallId?: string;
      completionWallId?: string | null;
      closesOriginalWallId?: string | null;
      extractionSource?: string;
    };
  };
}

function pt2(p: [number, number] | { x: number; y: number } | undefined): [number, number] {
  if (!p) return [0, 0];
  if (Array.isArray(p)) return [p[0], p[1]];
  return [p.x, p.y];
}

function len(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function dir(a: [number, number], b: [number, number]): number {
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

/**
 * Build the finalized wall map from the combined wall drafts (originals first,
 * then accepted completion walls). `originalCount` is the number of original
 * walls (used to label `isCompletion` and to detect missing runtime originals).
 */
export function buildFinalizedWallMap(
  wallDrafts: WallDraftLike[],
  originalCount: number,
): WallMapBuild {
  const entries: FinalizedWallEntry[] = [];
  let missingRuntimeWalls = 0;

  wallDrafts.forEach((d, idx) => {
    const node = d.node;
    const liveId = node.id ?? d.id;
    const start = pt2(node.start);
    const end = pt2(node.end);
    const md = node.metadata ?? {};
    const isCompletion =
      md.extractionSource === 'WALL_COMPLETION' || !!md.completionWallId || idx >= originalCount;

    if (node.type && node.type !== 'wall') {
      missingRuntimeWalls++; // counted via verification.nonWallTargets below too
    }

    entries.push({
      liveWallNodeId: liveId,
      sourceWallId: isCompletion ? null : d.physicalWallId,
      physicalWallId: md.physicalWallId ?? d.physicalWallId,
      completionWallId: md.completionWallId ?? (isCompletion ? d.physicalWallId : null),
      closesOriginalWallId: md.closesOriginalWallId ?? null,
      finalizedStart: start,
      finalizedEnd: end,
      finalizedLengthM: len(start, end),
      finalizedDirection: dir(start, end),
      finalizedOrigin: start,
      isCompletion,
    });
  });

  const verification = verifyWallMap(entries, wallDrafts, originalCount);
  return {
    originalWalls: originalCount,
    completionWalls: Math.max(0, wallDrafts.length - originalCount),
    finalizedWalls: entries.length,
    entries,
    verification,
    pass: verification.pass,
  };
}

export function verifyWallMap(
  entries: FinalizedWallEntry[],
  wallDrafts: WallDraftLike[],
  originalCount: number,
): WallMapVerification {
  const seen = new Map<string, number>();
  const duplicateIds: string[] = [];
  const nonWallEntries: string[] = [];

  for (const e of entries) {
    const id = e.liveWallNodeId;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [id, n] of seen) if (n > 1) duplicateIds.push(id);

  for (let i = 0; i < wallDrafts.length; i++) {
    const node = wallDrafts[i].node;
    if (node.type && node.type !== 'wall') nonWallEntries.push(node.id ?? wallDrafts[i].id);
  }

  // Missing runtime walls: an original source wall whose live node never made it
  // into the finalized map (e.g. filtered out, or id collision lost it).
  const mappedLive = new Set(entries.map((e) => e.liveWallNodeId));
  let missing = 0;
  for (let i = 0; i < Math.min(originalCount, wallDrafts.length); i++) {
    const liveId = wallDrafts[i].node.id ?? wallDrafts[i].id;
    if (!mappedLive.has(liveId)) missing++;
  }

  const duplicateWallIds = duplicateIds.length;
  const nonWallTargets = nonWallEntries.length;
  const pass =
    duplicateWallIds === 0 && nonWallTargets === 0 && missing === 0;

  return { duplicateWallIds, missingRuntimeWalls: missing, nonWallTargets, duplicateIds, nonWallEntries, pass };
}
