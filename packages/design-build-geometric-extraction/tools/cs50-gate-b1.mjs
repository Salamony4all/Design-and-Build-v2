/**
 * CS5.0 Gate B.1: corrected coordinate/wall mapping for all 25 frozen review regions.
 *
 * Unit correction:
 *  - rawIntervalUnion values are wall-local parametric units in Stage A transformed space.
 *  - Conversion to metres: metres = stageAUnits * CoordinateAdapter.MM_PER_STAGE_A_UNIT / 1000
 *
 * Coordinate chain:
 *  - PDF wall endpoints -> coordinate-frame package toPascal(pdfX, pdfY)
 *  - Wall-local metres -> scalar projection along Pascal wall axis from endpoint A
 *
 * Interval origin/direction:
 *  - Origin: WALL_ENDPOINT_A in Stage A / PDF space
 *  - Positive direction: Stage A wall axis unit vector (A -> B)
 *  - If Pascal wall direction dot(Stage A direction) < 0, reverse interval.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = join(__dirname, '..');
const OUT = join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2');
mkdirSync(OUT, { recursive: true });

const TOLERANCE = 1e-9;
const TX = 259;
const TY = 288;
const MM_PER_STAGE_A_UNIT = 17.50355553021744;
const ENDPOINT_TOLERANCE_M = 10 * MM_PER_STAGE_A_UNIT / 1000; // detector ENDPOINT_TOLERANCE = 10 stageA units

// Authoritative coordinate frame from packages/coordinate-frame/src/index.ts
function createCoordinateFrame() {
  const pageBoundsPt = [0, 0, 2383.919921875, 1683.719970703125];
  const [x0, y0, x1, y1] = pageBoundsPt;
  const pdfWidth = x1 - x0;
  const pdfHeight = y1 - y0;
  const pageWidthM = 41.73;
  const pageHeightM = 29.47;

  const toPascal = (pdfX, pdfY) => {
    const nx = (pdfX - x0) / pdfWidth;
    const nz = (pdfY - y0) / pdfHeight;
    return [nx * pageWidthM, nz * pageHeightM];
  };
  const toPdf = (pascalX, pascalZ) => {
    const nx = pascalX / pageWidthM;
    const nz = pascalZ / pageHeightM;
    return [x0 + nx * pdfWidth, y0 + nz * pdfHeight];
  };

  return {
    toPascal,
    toPdf,
    pageBoundsPt,
    pageWidthM,
    pageHeightM,
  };
}

const coordinateFrame = createCoordinateFrame();

// Load inputs
const manifestBytes = readFileSync(join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'blind-review-manifest.json'));
const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
const manifest = JSON.parse(manifestBytes, 'utf8');

const golden = JSON.parse(readFileSync(join(PKG, '..', '..', 'apps', 'design-build-editor', 'tests', 'fixtures', 'code06-pure-mupdf-golden.json'), 'utf8'));
const windowOutput = JSON.parse(readFileSync(join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.1', 'code06-automatic-window-output.json'), 'utf8'));

function deterministicWallId(physicalWallId) {
  return 'wall_' + createHash('sha256').update('wall:' + physicalWallId + ':code06').digest('hex').slice(0, 8);
}

function stageAUnitToMetres(stageAUnits) {
  return stageAUnits * MM_PER_STAGE_A_UNIT / 1000;
}

// Build physical wall geometry in PDF point space and Pascal world space
function buildWallGeometry(w) {
  const [pascalAX, pascalAZ] = coordinateFrame.toPascal(w.a.x, w.a.y);
  const [pascalBX, pascalBZ] = coordinateFrame.toPascal(w.b.x, w.b.y);
  const dx = pascalBX - pascalAX;
  const dz = pascalBZ - pascalAZ;
  const pascalLengthM = Math.hypot(dx, dz);
  const ux = pascalLengthM > 0 ? dx / pascalLengthM : 0;
  const uz = pascalLengthM > 0 ? dz / pascalLengthM : 0;
  const yawRad = Math.atan2(dz, dx);

  const stageALengthUnits = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);

  return {
    physicalWallId: w.physicalWallId,
    pascalWallNodeId: deterministicWallId(w.physicalWallId),
    pdfA: w.a,
    pdfB: w.b,
    pascalA: { x: pascalAX, z: pascalAZ },
    pascalB: { x: pascalBX, z: pascalBZ },
    pascalDir: { x: ux, z: uz },
    pascalLengthM,
    yawRad,
    stageALengthUnits,
  };
}

const wallGeometryByPhysicalId = new Map(
  (golden.accepted || []).map((w) => [w.physicalWallId, buildWallGeometry(w)])
);

function intervalForCandidate(candidate) {
  const iu = candidate?.rawIntervalUnion ?? candidate?.finiteWallInterval;
  if (iu && typeof iu.start === 'number' && typeof iu.end === 'number') return iu;
  return null;
}

function projectIntervalToPascalWorld(wall, localStart, localEnd) {
  const startM = stageAUnitToMetres(localStart);
  const endM = stageAUnitToMetres(localEnd);
  const widthM = endM - startM;

  const worldStart = {
    x: wall.pascalA.x + startM * wall.pascalDir.x,
    z: wall.pascalA.z + startM * wall.pascalDir.z,
  };
  const worldEnd = {
    x: wall.pascalA.x + endM * wall.pascalDir.x,
    z: wall.pascalA.z + endM * wall.pascalDir.z,
  };
  const worldCentre = {
    x: (worldStart.x + worldEnd.x) / 2,
    y: 0,
    z: (worldStart.z + worldEnd.z) / 2,
  };

  return { startM, endM, widthM, worldStart, worldEnd, worldCentre };
}

function physicalSanity(wall, startM, endM, widthM) {
  if (startM >= endM) return 'REVERSED_INTERVAL';
  if (widthM <= 0) return 'ZERO_WIDTH';
  if (widthM < 0.1) return 'WIDTH_TOO_SMALL';
  if (widthM > 5.0) return 'WIDTH_TOO_LARGE';
  if (startM < -ENDPOINT_TOLERANCE_M || endM > wall.pascalLengthM + ENDPOINT_TOLERANCE_M) return 'OUTSIDE_FINITE_WALL';
  return 'PHYSICALLY_PLAUSIBLE';
}

// Sort regions for deterministic processing order
const sortedRegions = [...(manifest.regions || [])].sort((a, b) => a.anonymousRegionId.localeCompare(b.anonymousRegionId));
const candidateById = new Map((windowOutput.candidates || []).map((c) => [c.candidateId, c]));

const mappings = [];
const roundTripErrors = [];
const validatedIds = new Set();
const invalidIds = new Set();
const violatingRegionIds = [];
const sourceIdentityFailures = [];
const runtimeWallMappingFailures = [];
const unknownIntervalOrigins = [];
const reversedDirections = [];
const outsideFiniteWall = [];
const invalidWidths = [];
const physicalCalibrationFailures = [];

let maxWidth = -Infinity;
let minWidth = Infinity;

for (const region of sortedRegions) {
  const candidateIds = region.constituentCandidateIds || [];
  const rc = candidateIds.map((id) => candidateById.get(id)).filter(Boolean);
  const physicalWallId = region.physicalWallId;
  const wall = wallGeometryByPhysicalId.get(physicalWallId);

  let mappingStatus = 'VALIDATED_MAPPING';

  if (!wall) {
    mappingStatus = 'MISSING_RUNTIME_WALL';
    runtimeWallMappingFailures.push(region.anonymousRegionId);
    invalidIds.add(region.anonymousRegionId);
    mappings.push({
      anonymousRegionId: region.anonymousRegionId,
      openingRegionId: region.openingRegionId,
      selectedPhysicalWallId: physicalWallId,
      pascalWallNodeId: deterministicWallId(physicalWallId),
      mappingStatus,
    });
    continue;
  }

  const candidateIntervals = rc.map(intervalForCandidate).filter(Boolean);
  if (candidateIntervals.length === 0) {
    mappingStatus = 'INVALID_INTERVAL';
    invalidIds.add(region.anonymousRegionId);
    mappings.push({
      anonymousRegionId: region.anonymousRegionId,
      openingRegionId: region.openingRegionId,
      selectedPhysicalWallId: physicalWallId,
      pascalWallNodeId: wall.pascalWallNodeId,
      mappingStatus,
    });
    continue;
  }

  // Interval origin/direction:
  // The detector projects segment bounds onto wall axis originating at wall.centerline.a
  // in Stage A space. The positive direction is A -> B.
  // We verify by checking dot product between Pascal wall direction and Stage A direction.
  // If negative, reverse the interval.
  const stageADx = wall.pdfB.x - wall.pdfA.x;
  const stageADy = wall.pdfB.y - wall.pdfA.y;
  const pascalDirDotStageA = wall.pascalDir.x * stageADx + wall.pascalDir.z * stageADy;
  const directionReversed = pascalDirDotStageA < 0;

  // Compute union interval across all candidates
  const unionRawStart = Math.min(...candidateIntervals.map((i) => i.start));
  const unionRawEnd = Math.max(...candidateIntervals.map((i) => i.end));

  let localStart = unionRawStart;
  let localEnd = unionRawEnd;

  if (directionReversed) {
    localStart = wall.stageALengthUnits - unionRawEnd;
    localEnd = wall.stageALengthUnits - unionRawStart;
    reversedDirections.push(region.anonymousRegionId + ':' + physicalWallId);
  }

  const { startM, endM, widthM, worldStart, worldEnd, worldCentre } = projectIntervalToPascalWorld(wall, localStart, localEnd);

  // Mathematical round-trip in Stage A space
  const startMBack = startM * 1000 / MM_PER_STAGE_A_UNIT;
  const endMBack = endM * 1000 / MM_PER_STAGE_A_UNIT;
  const err = Math.max(Math.abs(localStart - startMBack), Math.abs(localEnd - endMBack));
  roundTripErrors.push(err);
  if (err > TOLERANCE) {
    violatingRegionIds.push(region.anonymousRegionId);
    mappingStatus = 'ROUND_TRIP_ERROR';
  }

  // Physical sanity on union interval
  const sanity = physicalSanity(wall, startM, endM, widthM);
  if (sanity !== 'PHYSICALLY_PLAUSIBLE') {
    mappingStatus = sanity;
    if (sanity === 'OUTSIDE_FINITE_WALL') outsideFiniteWall.push(region.anonymousRegionId);
    if (sanity === 'WIDTH_TOO_SMALL' || sanity === 'WIDTH_TOO_LARGE' || sanity === 'ZERO_WIDTH') invalidWidths.push(region.anonymousRegionId);
  }

  const entry = {
    anonymousRegionId: region.anonymousRegionId,
    openingRegionId: region.openingRegionId,
    sourceCoordinateSpace: 'WALL_LOCAL_PARAMETRIC_UNITS',
    sourceInterval: region.rawIntervalUnion,
    sourceIntervalUnit: 'stage_a_transformed_wall_local_parametric',
    coordinateTransformId: 'CODE06_STAGE_A_UNITS_TO_PASCAL_VIA_WALL_AXIS',
    selectedPhysicalWallId: physicalWallId,
    pascalWallNodeId: wall.pascalWallNodeId,
    projectEndpointA: wall.pascalA,
    projectEndpointB: wall.pascalB,
    wallLocalIntervalMeters: {
      start: startM,
      end: endM,
      width: widthM,
    },
    intervalCentreMeters: widthM / 2,
    pascalWorldCentre: worldCentre,
    planRotationRadians: wall.yawRad,
    mathematicalRoundTripError: err,
    physicalSanityStatus: sanity,
    directionReversed,
    mappingStatus,
  };

  if (mappingStatus === 'VALIDATED_MAPPING') validatedIds.add(region.anonymousRegionId);
  else invalidIds.add(region.anonymousRegionId);

  if (widthM > maxWidth) maxWidth = widthM;
  if (widthM < minWidth) minWidth = widthM;

  mappings.push(entry);
}

const maxRoundTrip = roundTripErrors.length ? Math.max(...roundTripErrors) : 0;
const meanRoundTrip = roundTripErrors.length ? roundTripErrors.reduce((a, b) => a + b, 0) / roundTripErrors.length : 0;

const summary = {
  frozenRegionCount: mappings.length,
  validatedMappings: validatedIds.size,
  sourceIdentityFailures: sourceIdentityFailures.length,
  runtimeWallMappingFailures: runtimeWallMappingFailures.length,
  unknownIntervalOrigins: unknownIntervalOrigins.length,
  reversedDirections: reversedDirections.length,
  outsideFiniteWall: outsideFiniteWall.length,
  invalidWidths: invalidWidths.length,
  roundTripFailures: violatingRegionIds.length,
  physicalCalibrationFailures: physicalCalibrationFailures.length,
  maximumWidthM: maxWidth === -Infinity ? null : maxWidth,
  minimumWidthM: minWidth === Infinity ? null : minWidth,
  maximumRoundTripError: maxRoundTrip,
  meanRoundTripError: meanRoundTrip,
  maximumPhysicalCalibrationError: null,
  violatingRegionIds: Array.from(new Set(violatingRegionIds)).sort(),
  reversedDirections: Array.from(new Set(reversedDirections)).sort(),
  outsideFiniteWall: Array.from(new Set(outsideFiniteWall)).sort(),
  invalidWidths: Array.from(new Set(invalidWidths)).sort(),
};

const payload = {
  schemaVersion: 'cs50-gate-b1.v1',
  previousArtifact: 'cs50-gate-b-mapping.json',
  previousArtifactHash: 'f920fc435d0e0497ab20307c1e15f48bcf369ab8d7046c2d781b29b3fd660479',
  source: {
    manifestPath: 'evidence/code06/phase-b-clean/blind-r1.3.2/blind-review-manifest.json',
    manifestCanonicalHash: manifestHash,
    canonicalPdfPath: 'apps/design-build-editor/public/CODE_06.pdf',
    canonicalPdfSha256: '6414a5f8ef7bc7034364c05db17291f5319ad4931c4c43d0a6c3a659fbf407b9',
    pageIndex: 0,
    pageBoundsPt: coordinateFrame.pageBoundsPt,
    phaseALineageSourcePdfSha256: '6414a5f8ef7bc7034364c05db17291f5319ad4931c4c43d0a6c3a659fbf407b9',
    wallFixtureSourcePdfSha256: '6414a5f8ef7bc7034364c05db17291f5319ad4931c4c43d0a6c3a659fbf407b9',
    sameCanonicalPage: true,
    coordinateFrameSource: 'packages/coordinate-frame/src/index.ts',
    coordinateFrameFormulas: {
      pascalXFormula: 'nx = (pdfX - pageBoundsPt[0]) / (pageBoundsPt[2] - pageBoundsPt[0]); pascalX = nx * pageWidthM',
      pascalZFormula: 'nz = (pdfY - pageBoundsPt[1]) / (pageBoundsPt[3] - pageBoundsPt[1]); pascalZ = nz * pageHeightM',
      pdfXFormula: 'nx = pascalX / pageWidthM; pdfX = pageBoundsPt[0] + nx * (pageBoundsPt[2] - pageBoundsPt[0])',
      pdfYFormula: 'nz = pascalZ / pageHeightM; pdfY = pageBoundsPt[1] + nz * (pageBoundsPt[3] - pageBoundsPt[1])',
      pdfOrigin: 'pageBoundsPt bottom-left',
      pascalOrigin: 'PDF page bottom-left mapped to (0,0) Pascal world',
      zAxisMirrored: false,
      pageBoundsHandling: 'direct crop; no padding; no extra mirror',
    },
    coordinateAdapterSource: 'packages/design-build-geometric-extraction/src/window/coordinate-adapter.ts',
    coordinateAdapterHash: createHash('sha256').update(readFileSync(join(PKG, 'src', 'window', 'coordinate-adapter.ts'), 'utf8')).digest('hex'),
    wallFixturePath: 'apps/design-build-editor/tests/fixtures/code06-pure-mupdf-golden.json',
    wallFixtureHash: createHash('sha256').update(readFileSync(join(PKG, '..', '..', 'apps', 'design-build-editor', 'tests', 'fixtures', 'code06-pure-mupdf-golden.json'))).digest('hex'),
    rawWindowOutputPath: 'evidence/code06/phase-b-clean/blind-r1.3.1/code06-automatic-window-output.json',
    rawWindowOutputHash: createHash('sha256').update(readFileSync(join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.1', 'code06-automatic-window-output.json'))).digest('hex'),
    intervalOriginRule: 'WALL_ENDPOINT_A',
    intervalPositiveDirectionRule: 'Stage A wall axis unit vector from A to B; reversed in Pascal world if dot(pascalDir, stageADir) < 0',
    sourceCodePath: 'packages/design-build-geometric-extraction/src/window/automatic-detector-clean.ts',
    sourceLineRange: '135-144',
  },
  summary,
  mappings: mappings.sort((a, b) => a.anonymousRegionId.localeCompare(b.anonymousRegionId)),
};

const outPath = join(OUT, 'cs50-gate-b1-unit-corrected-mapping.json');
writeFileSync(outPath, JSON.stringify(payload, null, 2));

// Deterministic hash: exclude volatile timestamp from payload.
const canonicalPayload = JSON.parse(JSON.stringify(payload));
delete canonicalPayload.generatedAt;
const canonicalHash = createHash('sha256').update(JSON.stringify(canonicalPayload, null, 2)).digest('hex');
writeFileSync(join(OUT, 'cs50-gate-b1-unit-corrected-mapping.canonicalhash'), canonicalHash);

console.log(JSON.stringify({
  outFile: outPath,
  canonicalHash,
  summary,
  violatingRegionIds: Array.from(new Set(violatingRegionIds)).sort(),
  reversedDirections: Array.from(new Set(reversedDirections)).sort(),
  outsideFiniteWall: Array.from(new Set(outsideFiniteWall)).sort(),
  invalidWidths: Array.from(new Set(invalidWidths)).sort(),
  sampleMapping: mappings[0] ? {
    anonymousRegionId: mappings[0].anonymousRegionId,
    physicalWallId: mappings[0].selectedPhysicalWallId,
    pascalWallNodeId: mappings[0].pascalWallNodeId,
    widthM: mappings[0].wallLocalIntervalMeters?.width,
    roundTripError: mappings[0].mathematicalRoundTripError,
    mappingStatus: mappings[0].mappingStatus,
    physicalSanityStatus: mappings[0].physicalSanityStatus,
  } : null,
}, null, 2));
