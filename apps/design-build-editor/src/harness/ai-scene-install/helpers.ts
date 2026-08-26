// harness/ai-scene-install/helpers.ts
// Shared Pascal 0.9.2 scene-geometry + identity helpers used by BOTH the V2
// (install-ai-extract.ts) and V3 (pascal-progressive-builder.ts) installers.
// Cloned from the proven install-ai-extract.ts logic — do NOT diverge.

/** Stable-enough unique id with the required Pascal template-literal prefix. */
export const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

/** Debug sink (temporary). Guarded so it never throws in the installer. */
export function postDebug(payload: unknown): void {
  fetch('/api/ai-debug', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export function normalizeMaterial(preset?: string): string {
  if (!preset) return 'library:preset-white';
  const p = preset.toLowerCase();
  if (p === 'glass') return 'library:preset-glass';
  if (p === 'metal') return 'library:preset-metal';
  if (p.includes('wood') || p === 'parquet') return 'library:wall-parquet1';
  if (p.includes('marble')) return 'library:wall-marble1';
  if (p.includes('granite')) return 'library:wall-granite1';
  if (p.includes('plaster') || p === 'white') return 'library:preset-white';
  if (preset.startsWith('library:')) return preset;
  const knownIds = [
    'preset-glass', 'preset-metal', 'preset-white', 'wall-wood1', 'wall-wood2',
    'wall-wood3', 'wall-wood4', 'wall-wood5', 'wall-granite1', 'wall-marble1',
    'wall-marble2', 'wall-parquet1', 'wall-parquet2', 'wall-wallpaper1',
    'wall-wallpaper2', 'wall-wallpaper3',
  ];
  if (knownIds.includes(preset)) return `library:${preset}`;
  if (knownIds.includes(`preset-${preset}`)) return `library:preset-${preset}`;
  return 'library:preset-white';
}

// ── Convex hull + polygon area (for the AI slab fallback) ──
export function computeConvexHull(points: [number, number][]): [number, number][] {
  const pts = points.map((p) => [...p] as [number, number]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 1) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const pt of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const pt = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, pt) <= 0) upper.pop();
    upper.push(pt);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function computePolygonArea(points: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

// ── Wall geometry helpers (cloned from the proven opening installers) ──
export function isWallLike(node: unknown): boolean {
  return !!node && (node as Record<string, unknown>).type === 'wall';
}
export function readLiveWallData(node: unknown): { start: [number, number]; end: [number, number] } | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as Record<string, unknown>;
  const cand = (n.start ?? n.startM ?? (n.geometry as Record<string, unknown> | undefined)?.start ?? (n.geometry as Record<string, unknown> | undefined)?.startM) as [number, number] | undefined;
  const candEnd = (n.end ?? n.endM ?? (n.geometry as Record<string, unknown> | undefined)?.end ?? (n.geometry as Record<string, unknown> | undefined)?.endM) as [number, number] | undefined;
  if (!cand || !candEnd) return null;
  return { start: cand, end: candEnd };
}
export function wallAngleRad(start: [number, number], end: [number, number]) {
  return Math.atan2(end[1] - start[1], end[0] - start[0]);
}
export function wallLengthM(start: [number, number], end: [number, number]) {
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}
export function pointToSegmentDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Resolve the live WallNode by EXACT_RUNTIME_WALL_MAPPING (metadata.physicalWallId). */
export function resolveHostWall(nodes: Record<string, unknown>, physicalWallId: string): string | null {
  for (const [id, node] of Object.entries(nodes)) {
    if (!isWallLike(node)) continue;
    const meta = ((node as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>;
    const phys = (meta.physicalWallId ?? meta.physical_wall_id ?? id) as string;
    if (phys === physicalWallId) return id;
  }
  const target = nodes[physicalWallId] as Record<string, unknown> | undefined;
  if (target && isWallLike(target)) {
    const ts = readLiveWallData(target);
    if (!ts) return null;
    const tm = [(ts.start[0] + ts.end[0]) / 2, (ts.start[1] + ts.end[1]) / 2] as [number, number];
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, node] of Object.entries(nodes)) {
      if (!isWallLike(node)) continue;
      const geom = readLiveWallData(node);
      if (!geom) continue;
      const d = pointToSegmentDist(tm, geom.start, geom.end);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (best && bestD < 5) return best;
  }
  return null;
}

/**
 * EXACT-ONLY wall resolver — used as the fallback when no explicit finalized
 * wall-map is supplied. Matches by metadata.physicalWallId and NEVER performs a
 * nearest-segment search (the 5 m fallback is intentionally excluded from
 * semantic host resolution, per Phase B §6/§7). Returns null when no exact
 * match exists so the caller can classify the opening as invalid/skipped.
 */
export function resolveHostWallExact(nodes: Record<string, unknown>, physicalWallId: string): string | null {
  for (const [id, node] of Object.entries(nodes)) {
    if (!isWallLike(node)) continue;
    const meta = ((node as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>;
    const phys = (meta.physicalWallId ?? meta.physical_wall_id ?? id) as string;
    if (phys === physicalWallId) return id;
  }
  return null;
}

/** Project a world-space opening segment onto its host wall → wall-local interval. */
export function worldOpeningToWallLocal(
  hostStart: [number, number],
  hostEnd: [number, number],
  openingStart: [number, number],
  openingEnd: [number, number],
  centreY: number,
): { localPosition: [number, number, number]; localRotation: [number, number, number]; worldCentre: [number, number, number]; centreFromA: number } {
  const angle = wallAngleRad(hostStart, hostEnd);
  const L = wallLengthM(hostStart, hostEnd) || 1e-6;
  const ex = (hostEnd[0] - hostStart[0]) / L;
  const ez = (hostEnd[1] - hostStart[1]) / L;
  const proj = (p: [number, number]) => {
    const t = Math.max(0, Math.min(1, ((p[0] - hostStart[0]) * ex + (p[1] - hostStart[1]) * ez) / L));
    return t * L;
  };
  const a = proj(openingStart);
  const b = proj(openingEnd);
  const centreFromA = (a + b) / 2;
  const worldCentre: [number, number, number] = [
    hostStart[0] + centreFromA * Math.cos(angle),
    centreY,
    hostStart[1] + centreFromA * Math.sin(angle),
  ];
  return { localPosition: [centreFromA, centreY, 0], localRotation: [0, 0, 0], worldCentre, centreFromA };
}

/** Append a child id to a parent's `children` array (Pascal 0.9.2 requirement). */
export function addChild(nodes: Record<string, unknown>, parentId: string, childId: string): void {
  const parent = nodes[parentId] as Record<string, unknown> | undefined;
  if (!parent) return;
  const children = Array.isArray(parent.children) ? (parent.children as string[]) : [];
  if (!children.includes(childId)) {
    children.push(childId);
    parent.children = children;
  }
}

/**
 * Required metadata on EVERY AI-created Pascal node (spec §7):
 *   extractionProvider: "PURE_AI"
 *   automaticExtraction: true
 *   runId, stageId, sourceRecordId  (when known)
 */
export function aiMeta(opts: {
  runId?: string;
  stage?: string;
  stageId?: string;
  sourceRecordId?: string;
  extractionMode?: 'v2' | 'progressive-v3';
  [k: string]: unknown;
} = {}): Record<string, unknown> {
  const { runId, stage, stageId, sourceRecordId, extractionMode, ...rest } = opts;
  // Callers pass `stage` (BuildStage); normalise to the canonical `stageId` key.
  const finalStageId = stageId ?? stage;
  const out: Record<string, unknown> = {
    source: 'ai-extract',
    extractionProvider: 'PURE_AI',
    automaticExtraction: true,
    ...(runId ? { runId } : {}),
    ...(finalStageId ? { stageId: finalStageId } : {}),
    ...(sourceRecordId ? { sourceRecordId } : {}),
    ...(extractionMode ? { extractionMode } : {}),
    ...rest,
  };
  // JSON-safe normalization: Pascal's node metadata schema (z.json()) rejects
  // `undefined`. Strip any undefined leaves so a node with no sourceFrame
  // (e.g. the free Guide harness) does not fail GuideNode.parse.
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}
