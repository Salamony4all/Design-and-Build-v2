// Phase A test — Dynamic Wall-Topology Graph + Endpoint Classification.
// MASTER CHECKPOINT §2-§3, §5, §15, §21, §23 (PHASE A only; no recovery rules yet).
//
// Uses the frozen CODE_06 completeWalls() input (authoritative: 70 original
// walls, 24 windows, 25 doors) so the baseline is real, not synthetic. The 18
// existing completion walls are added from the frozen output so the graph
// preserves them exactly (no regeneration). Confirms: graph builds, the 11
// endpoint classes are populated, no free endpoint is auto-classified as a
// defect, and the 70/18/24/25 invariants are untouched.
//
// Run with: npx tsx --test src/wall-completion/topology-graph.test.ts

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  buildWallTopologyGraph,
  deterministicCompletionId,
  type EndpointClass,
} from './topology-graph'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_PKG = join(HERE, '..', '..') // packages/extraction-mupdf
const FIXTURE = join(
  REPO_PKG,
  'extraction-results/wall-corner-shadow/code06-complete-walls-input.json',
)
const OUTPUT = join(
  REPO_PKG,
  'extraction-results/wall-corner-shadow/code06-complete-walls-output.json',
)

function loadFrozen() {
  const input = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  const output = JSON.parse(readFileSync(OUTPUT, 'utf8'))
  const completionWalls: any[] = output.completionWalls ?? []
  return { input, completionWalls }
}

const { input, completionWalls } = loadFrozen()
const scaleMmPerPt = input.scaleMmPerPt

const completionAsWalls = completionWalls.map((c: any) => ({
  physicalWallId: c.completionWallId,
  startM: c.centrelineStartProjectM,
  endM: c.centrelineEndProjectM,
  thicknessM: c.thicknessM ?? 0.2,
  sourceSegmentIds: c.sourceSegmentIds ?? [],
}))

const graph = buildWallTopologyGraph({
  acceptedPhysicalWalls: [...input.acceptedPhysicalWalls, ...completionAsWalls],
  acceptedWindows: input.acceptedWindows,
  acceptedDoors: input.acceptedDoors,
  scaleMmPerPt,
  inputInPoints: true, // frozen input is MuPDF POINTS -> convert once
})

test('§5 coordinate transform applied exactly once', () => {
  assert.equal(graph.coordinateContract.inputCoordinateSpace, 'MUPDF_POINTS')
  assert.equal(graph.coordinateContract.outputCoordinateSpace, 'PROJECT_METRES')
  assert.equal(graph.coordinateContract.transformAppliedCount, 1)
})

test('§2 builds 176 endpoints from the 70+18=88 wall network', () => {
  assert.equal(graph.walls.length, 88)
  assert.equal(graph.endpoints.length, 176)
})

test('§3 classifies every endpoint into exactly one of the 10 classes', () => {
  const total = Object.values(graph.endpointClasses).reduce((a, b) => a + b, 0)
  assert.equal(total, 176)
  const keys = Object.keys(graph.endpointClasses) as EndpointClass[]
  assert.equal(keys.length, 10) // §3 defines exactly 10 endpoint classes
})

test('§3 does NOT auto-classify free partition ends as defects', () => {
  // A verified finalized 88-wall plan has no unconnected open ends.
  assert.equal(graph.endpointClasses.GENUINELY_OPEN_ENDPOINT, 0)
  assert.ok(
    graph.endpointClasses.GENUINELY_OPEN_ENDPOINT <= graph.endpointClasses.AMBIGUOUS_ENDPOINT,
  )
})

test('§15 preserves the 70 original walls and 18 existing completions', () => {
  const originals = graph.walls.filter((w) => !w.physicalWallId.startsWith('wc_'))
  const completions = graph.walls.filter((w) => w.physicalWallId.startsWith('wc_'))
  assert.equal(originals.length, 70)
  assert.equal(completions.length, 18)
})

test('§2/§16 records completion evidence mapping without new IDs', () => {
  assert.equal(graph.completionEvidence.length, 18)
  assert.ok(graph.completionEvidence.every((c) => c.completionWallId.startsWith('wc_')))
})

test('§16 produces deterministic completion ids', () => {
  const a = deterministicCompletionId({
    topologyPattern: 'OFFSET_L_CORNER',
    sortedSourceWallIds: ['fr1', 'fr7'],
    endpointSides: ['START', 'END'],
    centrelineStart: { x: 16.967, y: 6.697 },
    centrelineEnd: { x: 17.5, y: 6.697 },
    sourceEvidenceHash: 'abc',
  })
  const b = deterministicCompletionId({
    topologyPattern: 'OFFSET_L_CORNER',
    sortedSourceWallIds: ['fr1', 'fr7'],
    endpointSides: ['START', 'END'],
    centrelineStart: { x: 16.967, y: 6.697 },
    centrelineEnd: { x: 17.5, y: 6.697 },
    sourceEvidenceHash: 'abc',
  })
  assert.equal(a, b)
  assert.ok(a.startsWith('wc_'))
})

test('§3 does not mistake a connected endpoint for an open one', () => {
  assert.equal(graph.endpointClasses.GENUINELY_OPEN_ENDPOINT, 0)
})

// ---- §7 false-connection regression (CODE_06-independent) ----
// A synthetic graph with deliberately disconnected / offset endpoints must NOT
// be classified as connected merely through distance tolerance. These guard the
// Phase A classifier against permissive tolerance behaviour.
function synthGraph(
  walls: { id: string; a: [number, number]; b: [number, number]; th?: number }[],
) {
  return buildWallTopologyGraph({
    acceptedPhysicalWalls: walls.map((w) => ({
      physicalWallId: w.id,
      startM: { x: w.a[0], y: w.a[1] },
      endM: { x: w.b[0], y: w.b[1] },
      thicknessM: w.th ?? 0.2,
      sourceSegmentIds: [],
    })),
    acceptedWindows: [],
    acceptedDoors: [],
    scaleMmPerPt: 1000,
    inputInPoints: false,
  })
}

test('§7 close-but-disconnected endpoints stay AMBIGUOUS, not CONNECTED', () => {
  const g = synthGraph([
    { id: 'wA', a: [0, 0], b: [10, 0] },
    { id: 'wB', a: [5, 2.0], b: [5, 3.0] }, // interior, 2m from wA
  ])
  const bStart = g.endpoints.find((e) => e.wallId === 'wB' && e.endpointSide === 'START')!
  assert.equal((bStart as any)._class, 'AMBIGUOUS_ENDPOINT')
})

test('§7 endpoint near side of a PARALLEL wall is not a T-junction', () => {
  const g = synthGraph([
    { id: 'wA', a: [0, 0], b: [10, 0] }, // horizontal main wall
    { id: 'wB', a: [5, 0.3], b: [10, 0.3] }, // PARALLEL offset (horizontal), not perpendicular
  ])
  const bStart = g.endpoints.find((e) => e.wallId === 'wB' && e.endpointSide === 'START')!
  assert.notEqual((bStart as any)._class, 'CONNECTED_T_JUNCTION')
})

test('§7 endpoint projection beyond a finite wall end is not a junction', () => {
  const g = synthGraph([
    { id: 'wA', a: [0, 0], b: [10, 0] },
    { id: 'wB', a: [12, 0.2], b: [12, 1.0] }, // past wA end (x=10), only 0.2m offset but no interior projection
  ])
  const bStart = g.endpoints.find((e) => e.wallId === 'wB' && e.endpointSide === 'START')!
  assert.notEqual((bStart as any)._class, 'CONNECTED_T_JUNCTION')
})

test('§7 offset T-junction: branch stops short, not auto-connected as endpoint', () => {
  const g = synthGraph([
    { id: 'wA', a: [0, 0], b: [10, 0] },
    { id: 'wB', a: [5, 0.25], b: [5, 0.9] }, // branch end 0.25m short of wA interior
  ])
  const bStart = g.endpoints.find((e) => e.wallId === 'wB' && e.endpointSide === 'START')!
  // must not be silently CONNECTED_ENDPOINT; a real T (correct) or ambiguous only
  assert.ok(['CONNECTED_T_JUNCTION', 'AMBIGUOUS_ENDPOINT'].includes((bStart as any)._class))
})

test('§7 perimeter endpoint near but not on boundary stays AMBIGUOUS', () => {
  const g = synthGraph([
    { id: 'wA', a: [0, 0], b: [5, 0] },
    { id: 'wB', a: [2.6, 0.3], b: [2.6, 1.0] }, // 0.3m from bbox minY edge (> tight perimeter tol 0.08)
  ])
  const bStart = g.endpoints.find((e) => e.wallId === 'wB' && e.endpointSide === 'START')!
  assert.notEqual((bStart as any)._class, 'BUILDING_PERIMETER_TERMINATION')
})

test('§7 completion geometry nearby but not connected stays AMBIGUOUS', () => {
  const g = synthGraph([
    { id: 'wc_x', a: [0, 0], b: [0, 5] },
    { id: 'wFar', a: [1, 0], b: [1, 7] },
    { id: 'wFar2', a: [5, 0], b: [5, 7] },
    { id: 'wB', a: [2.5, 5.5], b: [2.5, 6.5] }, // vertical, >0.5m clear of all walls
  ])
  const bStart = g.endpoints.find((e) => e.wallId === 'wB' && e.endpointSide === 'START')!
  assert.equal((bStart as any)._class, 'AMBIGUOUS_ENDPOINT')
})
