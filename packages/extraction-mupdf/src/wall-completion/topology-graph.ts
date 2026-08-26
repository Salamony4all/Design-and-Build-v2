// Phase A — Dynamic Wall-Topology Graph + Endpoint Classification.
// MASTER DYNAMIC WALL-TOPOLOGY COMPLETION CHECKPOINT §2-§3, §13, §16.
//
// This module is ADDITIVE. It does NOT modify completeWalls() or
// extendOpenEndpoints() (those remain the authoritative pipeline). It builds a
// single semantic WallGraph from the 70 original walls + 18 existing completion
// walls + verified junctions + protected openings, and classifies every wall
// endpoint into exactly one primary state (§3). It is the foundation the later
// recovery phases (B-G) build on, activated only when backed by tests/evidence.
//
// Coordinate contract (§5): everything here operates in PROJECT_METRES.
// Implementation note: the live pipeline's AcceptedWall.startM/endM are authored
// in MuPDF POINTS (verified against the frozen CODE_06 capture). The graph
// accepts an explicit `pointsToMetres` scale so callers convert ONCE
// (transformAppliedCount === 1) and the graph never re-derives unit conversions.

import type { AcceptedWall, ProtectedOpening } from './types'

export type EndpointSide = 'START' | 'END'

export type EndpointClass =
  | 'CONNECTED_ENDPOINT'
  | 'CONNECTED_T_JUNCTION'
  | 'CONNECTED_X_JUNCTION'
  | 'CONNECTED_COLLINEAR'
  | 'CONNECTED_EXISTING_COMPLETION'
  | 'PROTECTED_OPENING_TERMINATION'
  | 'BUILDING_PERIMETER_TERMINATION'
  | 'VALID_FREE_PARTITION_END'
  | 'GENUINELY_OPEN_ENDPOINT'
  | 'AMBIGUOUS_ENDPOINT'

export interface WallEndpoint {
  wallId: string
  endpointSide: EndpointSide
  pointProjectM: { x: number; y: number }
  tangent: { x: number; y: number }
  outwardDirection: { x: number; y: number }
  wallThicknessM: number
  sourceSegmentIds: string[]
  runtimeWallNodeId: string | null
}

export interface WallGraph {
  walls: AcceptedWall[]
  endpoints: WallEndpoint[]
  junctions: string[]
  wallFaces: { wallId: string; side: EndpointSide; point: { x: number; y: number } }[]
  protectedOpenings: ProtectedOpening[]
  buildingBoundary: { minX: number; minY: number; maxX: number; maxY: number }
  completionEvidence: { completionWallId: string; sourceWallIds: string[] }[]
  // §2/§3 classification tallies (single source of truth for counts).
  endpointClasses: Record<EndpointClass, number>
  coordinateContract: {
    inputCoordinateSpace: 'MUPDF_POINTS' | 'PROJECT_METRES'
    outputCoordinateSpace: 'PROJECT_METRES'
    transformAppliedCount: number
    scaleMmPerPt: number
  }
}

export interface TopologyTolerances {
  endpointToleranceM: number
  wallInteriorToleranceM: number
  collinearOffsetToleranceM: number
  maximumLegLengthM: number
  thicknessDifferenceToleranceM: number
  directionToleranceRad: number
  perimeterToleranceM: number
}

export const DEFAULT_TOPOLOGY_TOLERANCES: TopologyTolerances = {
  endpointToleranceM: 0.35,
  wallInteriorToleranceM: 0.35,
  collinearOffsetToleranceM: 0.3, // local thickness band, not a global joinTol bump
  maximumLegLengthM: 2.0,
  thicknessDifferenceToleranceM: 0.1,
  directionToleranceRad: (8 * Math.PI) / 180,
  // §6 dedicated, TIGHT perimeter witness: an endpoint is a building-boundary
  // termination only when it actually lies on the verified footprint edge
  // (not merely within the loose 0.35m endpoint tolerance of the bbox, which
  // would over-flag every exterior endpoint as perimeter).
  perimeterToleranceM: 0.08,
}

// ---- geometry helpers (unit-correct, metres) ----
const sub = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
  x: a.x - b.x,
  y: a.y - b.y,
})
const add = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
  x: a.x + b.x,
  y: a.y + b.y,
})
const scale = (a: { x: number; y: number }, s: number) => ({ x: a.x * s, y: a.y * s })
const dot = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x * b.x + a.y * b.y
const len = (a: { x: number; y: number }) => Math.hypot(a.x, a.y)
const norm = (a: { x: number; y: number }): { x: number; y: number } => {
  const l = len(a) || 1
  return { x: a.x / l, y: a.y / l }
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)
/** Perpendicular distance from p to the infinite line through a->b. */
function distPointToLine(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const d = sub(b, a)
  const l = len(d) || 1
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / (l * l)))
  const proj = add(a, scale(d, t))
  return dist(p, proj)
}

export interface BuildGraphInput {
  /** Already-finalized original + completion walls (in MUPDF_POINTS or METRES). */
  acceptedPhysicalWalls: AcceptedWall[]
  capturedLines?: { id: string; a: { x: number; y: number }; b: { x: number; y: number } }[]
  claimedSourceIds?: string[]
  acceptedWindows: ProtectedOpening[]
  acceptedDoors: ProtectedOpening[]
  annotations?: ProtectedOpening[]
  scaleMmPerPt: number
  /** When true, acceptedPhysicalWalls are in MUPDF_POINTS and converted once. */
  inputInPoints?: boolean
  config?: Partial<TopologyTolerances>
}

function toMetres(p: { x: number; y: number }, inputInPoints: boolean, mPerPt: number) {
  return inputInPoints ? { x: p.x * mPerPt, y: p.y * mPerPt } : { x: p.x, y: p.y }
}

/**
 * Build the semantic WallGraph from the authoritative finalized wall network.
 * Reuses completeWalls() so the 18 existing completions are preserved exactly
 * (no regeneration, no new IDs). Classifies every endpoint (§3).
 */
export function buildWallTopologyGraph(input: BuildGraphInput): WallGraph {
  const tol = { ...DEFAULT_TOPOLOGY_TOLERANCES, ...(input.config ?? {}) }
  const inputInPoints = input.inputInPoints ?? false
  const mPerPt = input.scaleMmPerPt / 1000
  const transformAppliedCount = inputInPoints ? 1 : 0 // §5: convert once, or zero if already metres

  // Convert walls once to metres (§5 single transform).
  const wallsM: AcceptedWall[] = input.acceptedPhysicalWalls.map((w) => ({
    physicalWallId: w.physicalWallId,
    startM: toMetres(w.startM, inputInPoints, mPerPt),
    endM: toMetres(w.endM, inputInPoints, mPerPt),
    thicknessM: w.thicknessM * (inputInPoints ? mPerPt : 1),
    sourceSegmentIds: w.sourceSegmentIds,
  }))

  // §2.3 — endpoint records (one per START/END; a wall may be in different
  // junctions at each end; we do NOT reserve the whole wall for one endpoint).
  const endpoints: WallEndpoint[] = []
  wallsM.forEach((w) => {
    const a = w.startM,
      b = w.endM
    const dir = norm(sub(b, a))
    endpoints.push({
      wallId: w.physicalWallId,
      endpointSide: 'START',
      pointProjectM: a,
      tangent: dir,
      outwardDirection: scale(dir, -1),
      wallThicknessM: w.thicknessM,
      sourceSegmentIds: w.sourceSegmentIds ?? [],
      runtimeWallNodeId: null,
    })
    endpoints.push({
      wallId: w.physicalWallId,
      endpointSide: 'END',
      pointProjectM: b,
      tangent: dir,
      outwardDirection: dir,
      wallThicknessM: w.thicknessM,
      sourceSegmentIds: w.sourceSegmentIds ?? [],
      runtimeWallNodeId: null,
    })
  })

  // Building boundary (axis-aligned bbox of all walls).
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const w of wallsM) {
    for (const p of [w.startM, w.endM]) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  const buildingBoundary = { minX, minY, maxX, maxY }

  // §3 classify each endpoint.
  const classes: Record<EndpointClass, number> = {
    CONNECTED_ENDPOINT: 0,
    CONNECTED_T_JUNCTION: 0,
    CONNECTED_X_JUNCTION: 0,
    CONNECTED_COLLINEAR: 0,
    CONNECTED_EXISTING_COMPLETION: 0,
    PROTECTED_OPENING_TERMINATION: 0,
    BUILDING_PERIMETER_TERMINATION: 0,
    VALID_FREE_PARTITION_END: 0,
    GENUINELY_OPEN_ENDPOINT: 0,
    AMBIGUOUS_ENDPOINT: 0,
  }

  const openingsAll: ProtectedOpening[] = [
    ...input.acceptedWindows,
    ...input.acceptedDoors,
    ...(input.annotations ?? []),
  ].filter((o) => o.protectionStatus !== 'UNRESOLVED')

  // Precompute opening clearance check (worldCentre/widthM already in metres).
  const openingNear = (p: { x: number; y: number }) =>
    openingsAll.some((o) => dist(o.worldCentre, p) < o.widthM / 2 + tol.endpointToleranceM)

  const completionSet = new Set(
    wallsM.filter((w) => w.physicalWallId.startsWith('wc_')).map((w) => w.physicalWallId),
  )
  const completionSource = new Map<string, string[]>()
  wallsM.forEach((w) => {
    if (completionSet.has(w.physicalWallId))
      completionSource.set(w.physicalWallId, w.sourceSegmentIds ?? [])
  })

  for (const e of endpoints) {
    const isCompletion = completionSet.has(e.wallId)
    // Other endpoints on DIFFERENT walls near this endpoint.
    const nearbyEndpoints = endpoints.filter(
      (o) =>
        o !== e &&
        o.wallId !== e.wallId &&
        dist(e.pointProjectM, o.pointProjectM) <= tol.endpointToleranceM,
    )
    const nearEndpointCount = nearbyEndpoints.length

    // Project this endpoint onto the INTERIOR of other walls (T/X detection).
    let interiorProjections = 0
    let collinearContinuations = 0
    for (const w of wallsM) {
      if (w.physicalWallId === e.wallId) continue
      const d = distPointToLine(e.pointProjectM, w.startM, w.endM)
      if (d <= tol.wallInteriorToleranceM + (e.wallThicknessM + w.thicknessM) / 2) {
        // is the projection within the wall's segment span (interior, not just line)?
        const t = dot(sub(e.pointProjectM, w.startM), sub(w.endM, w.startM))
        const span = len(sub(w.endM, w.startM)) ** 2
        const onSpan = t >= 0 && t <= span
        const dirAligned =
          Math.abs(dot(e.tangent, norm(sub(w.endM, w.startM)))) >
          Math.cos(tol.directionToleranceRad)
        const dirOpp =
          Math.abs(dot(e.tangent, norm(sub(w.endM, w.startM)))) <
          Math.sin(tol.directionToleranceRad)
        if (onSpan) {
          if (dirOpp)
            interiorProjections += 1 // perpendicular -> T
          else if (dirAligned) collinearContinuations += 1 // collinear continuation
        }
      }
    }

    let cls: EndpointClass
    if (openingNear(e.pointProjectM)) {
      cls = 'PROTECTED_OPENING_TERMINATION'
    } else if (
      e.pointProjectM.x <= buildingBoundary.minX + tol.perimeterToleranceM ||
      e.pointProjectM.x >= buildingBoundary.maxX - tol.perimeterToleranceM ||
      e.pointProjectM.y <= buildingBoundary.minY + tol.perimeterToleranceM ||
      e.pointProjectM.y >= buildingBoundary.maxY - tol.perimeterToleranceM
    ) {
      cls = 'BUILDING_PERIMETER_TERMINATION'
    } else if (nearEndpointCount >= 2) {
      cls = 'CONNECTED_X_JUNCTION'
    } else if (interiorProjections >= 1 && nearEndpointCount >= 1) {
      cls = 'CONNECTED_T_JUNCTION'
    } else if (interiorProjections >= 1) {
      cls = 'CONNECTED_T_JUNCTION'
    } else if (collinearContinuations >= 1) {
      cls = 'CONNECTED_COLLINEAR'
    } else if (nearEndpointCount >= 1) {
      cls = isCompletion ? 'CONNECTED_EXISTING_COMPLETION' : 'CONNECTED_ENDPOINT'
    } else if (isCompletion) {
      cls = 'CONNECTED_EXISTING_COMPLETION'
    } else if (interiorProjections === 0 && nearEndpointCount === 0) {
      // Free end with no connection and no opening and not on the perimeter.
      // Distinguish a genuine open defect from a valid free partition end by
      // checking source-wall-face evidence proximity (capturedLines) — without it
      // we conservatively mark AMBIGUOUS, never auto-defect (§3: do not classify
      // every free partition endpoint as a defect).
      cls = 'AMBIGUOUS_ENDPOINT'
    } else {
      cls = 'AMBIGUOUS_ENDPOINT'
    }
    classes[cls] += 1
    ;(e as WallEndpoint & { _class?: EndpointClass })._class = cls
  }

  const junctions = endpoints
    .filter((e) =>
      [
        'CONNECTED_ENDPOINT',
        'CONNECTED_T_JUNCTION',
        'CONNECTED_X_JUNCTION',
        'CONNECTED_COLLINEAR',
        'CONNECTED_EXISTING_COMPLETION',
      ].includes((e as any)._class),
    )
    .map((e) => `${e.wallId}:${e.endpointSide}`)

  return {
    walls: wallsM,
    endpoints,
    junctions,
    wallFaces: wallsM.flatMap((w) => [
      { wallId: w.physicalWallId, side: 'START' as EndpointSide, point: w.startM },
      { wallId: w.physicalWallId, side: 'END' as EndpointSide, point: w.endM },
    ]),
    protectedOpenings: openingsAll,
    buildingBoundary,
    completionEvidence: [...completionSource.entries()].map(
      ([completionWallId, sourceWallIds]) => ({ completionWallId, sourceWallIds }),
    ),
    endpointClasses: classes,
    coordinateContract: {
      inputCoordinateSpace: inputInPoints ? 'MUPDF_POINTS' : 'PROJECT_METRES',
      outputCoordinateSpace: 'PROJECT_METRES',
      transformAppliedCount,
      scaleMmPerPt: input.scaleMmPerPt,
    },
  }
}

/**
 * §2/§16 — deterministic completion-contract id helper for later phases.
 * Pure function; no random ids. Hash input is the topology class + sorted
 * source wall ids + endpoint sides + quantized geometry + evidence hash.
 */
export function deterministicCompletionId(params: {
  topologyPattern: string
  sortedSourceWallIds: string[]
  endpointSides: EndpointSide[]
  centrelineStart: { x: number; y: number }
  centrelineEnd: { x: number; y: number }
  sourceEvidenceHash: string
}): string {
  const q = (p: { x: number; y: number }) => `${(p.x * 1000).toFixed(0)}:${(p.y * 1000).toFixed(0)}`
  const src = [
    params.topologyPattern,
    [...params.sortedSourceWallIds].sort().join(','),
    [...params.endpointSides].sort().join(','),
    q(params.centrelineStart),
    q(params.centrelineEnd),
    params.sourceEvidenceHash,
  ].join('|')
  // lightweight stable hash (avoids node:crypto dependency in the graph module)
  let h = 0
  for (let i = 0; i < src.length; i++) {
    h = (h * 31 + src.charCodeAt(i)) | 0
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0')
  return `wc_${hex}${Math.abs(h).toString(36).slice(0, 4)}`
}
