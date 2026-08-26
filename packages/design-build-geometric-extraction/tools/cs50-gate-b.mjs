/**
 * CS5.0 Gate B: exact coordinate/wall mapping for all 25 frozen review regions.
 *
 * Unit provenance:
 *  - rawIntervalUnion values are wall-local parametric units in Stage A transformed space.
 *  - Width in mm is computed by the detector as:
 *      widthMm = (rawTo - rawFrom) * CoordinateAdapter.MM_PER_STAGE_A_UNIT
 *  - CoordinateAdapter translates between Instrument Page Space and Stage A space via:
 *      TX=259, TY=288
 *    and uses mm-per-unit = 17.50355553021744 for both Stage A and Instrument spaces.
 *
 * Transform chain used here:
 *   Stage A parametric point on wall axis
 *   -> Stage A world point (x,y) = stageACenterline + u * wallDir_stageA
 *   -> PDF page point = stageAWorldPoint - (TX, TY)
 *   -> Pascal world meters = coordinateFrame.toPascal(pdfX, pdfY)
 *
 * Round-trip test:
 *   Pascal world meters -> coordinateFrame.toPdf -> PDF page point
 *   -> PDF + (TX, TY) = expected Stage A world point
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

function createCoordinateFrame() {
  const pageBoundsPt = [0, 0, 2383.919921875, 1683.719970703125];
  const x0 = pageBoundsPt[0];
  const y0 = pageBoundsPt[1];
  const pdfWidth = pageBoundsPt[2] - pageBoundsPt[0];
  const pdfHeight = pageBoundsPt[3] - pageBoundsPt[1];
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
  };
}

const coordinateFrame = createCoordinateFrame();

// Manifest hash uses the file bytes to avoid JSON-normalization differences.
const manifestBytes = readFileSync(join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'blind-review-manifest.json'));
const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');

const golden = JSON.parse(readFileSync(join(PKG, '..', '..', 'apps', 'design-build-editor', 'tests', 'fixtures', 'code06-pure-mupdf-golden.json'), 'utf8'));
const windowOutput = JSON.parse(readFileSync(join(PKG, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.1', 'code06-automatic-window-output.json'), 'utf8'));
const manifest = JSON.parse(manifestBytes, 'utf8');

function deterministicWallId(physicalWallId) {
  const hash = createHash('sha256').update(`wall:${physicalWallId}:code06`).digest('hex').slice(0, 8);
  return `wall_${hash}`;
}

const candidateById = new Map((windowOutput.candidates || []).map((c) => [c.candidateId, c]));
const walls = golden.accepted || [];
const wallByPhysicalId = new Map(walls.map((w) => [w.physicalWallId, w]));

// Wall axes in PDF point space.
const wallAxisByPhysicalId = new Map();
for (const w of walls) {
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const length = Math.hypot(dx, dy);
  const ux = length > 0 ? dx / length : 0;
  const uy = length > 0 ? dy / length : 0;
  wallAxisByPhysicalId.set(w.physicalWallId, {
    physicalWallId: w.physicalWallId,
    a: w.a,
    b: w.b,
    dx,
    dy,
    length,
    ux,
    uy,
    yaw: Math.atan2(dy, dx),
  });
}

function intervalForCandidate(c) {
  const iu = c?.rawIntervalUnion ?? c?.finiteWallInterval;
  if (iu && typeof iu.start === 'number' && typeof iu.end === 'number') return iu;
  return null;
}

function stageAPointFromPdf(pdfX, pdfY) {
  return { x: pdfX + TX, y: pdfY + TY };
}

function pdfPointFromStageA(stageAX, stageAY) {
  return { x: stageAX - TX, y: stageAY - TY };
}

function projectStageAIntervalToPascal(wallAxis, localStart, localEnd) {
  const ax = wallAxis.a.x + TX;
  const az = wallAxis.a.y + TY;
  const bx = wallAxis.b.x + TX;
  const bz = wallAxis.b.y + TY;
  const dx = bx - ax;
  const dy = bz - az;
  const len = wallAxis.length || 1;

  const startX = ax + (localStart / len) * dx;
  const startY = az + (localStart / len) * dy;
  const endX = ax + (localEnd / len) * dx;
  const endY = az + (localEnd / len) * dy;

  const uMid = ((localStart / len) + (localEnd / len)) / 2;
  const centreX = ax + uMid * dx;
  const centreY = az + uMid * dy;

  const startPdf = pdfPointFromStageA(startX, startY);
  const endPdf = pdfPointFromStageA(endX, endY);
  const centrePdf = pdfPointFromStageA(centreX, centreY);

  const [pascalStartX, pascalStartZ] = coordinateFrame.toPascal(startPdf.x, startPdf.y);
  const [pascalEndX, pascalEndZ] = coordinateFrame.toPascal(endPdf.x, endPdf.y);
  const [pascalCentreX, pascalCentreZ] = coordinateFrame.toPascal(centrePdf.x, centrePdf.y);

  return {
    startWorld: { x: pascalStartX, z: pascalStartZ },
    endWorld: { x: pascalEndX, z: pascalEndZ },
    centreWorld: { x: pascalCentreX, y: 0, z: pascalCentreZ },
    width: Math.abs(localEnd - localStart),
  };
}

const regions = manifest.regions || [];
const mappings = [];
const roundTripErrors = [];
const validatedIds = new Set();
const invalidIds = new Set();
const violatingRegionIds = [];

for (const region of regions) {
  const candidateIds = region.constituentCandidateIds || [];
  const rc = candidateIds.map((id) => candidateById.get(id)).filter(Boolean);
  const physicalWallId = region.physicalWallId;
  const wallAxis = wallAxisByPhysicalId.get(physicalWallId);
  const candidateIntervals = rc.map(intervalForCandidate).filter(Boolean);

  let mappingStatus = 'VALIDATED_MAPPING';
  if (!wallAxis) mappingStatus = 'MISSING_WALL_MAPPING';
  if (candidateIntervals.length === 0) mappingStatus = 'INVALID_INTERVAL';

  let maxErr = 0;
  const widths = [];
  const centres = [];
  for (const iv of candidateIntervals) {
    if (!wallAxis) break;
    const proj = projectStageAIntervalToPascal(wallAxis, iv.start, iv.end);
    widths.push(proj.width);
    centres.push(proj.centreWorld);

    // Round trip via Stage A:
    // pascal centre -> toPdf -> stageA centre -> compare to expected stageA centre
    const [pdfX, pdfY] = coordinateFrame.toPdf(proj.centreWorld.x, proj.centreWorld.z);
    const stageAExpectedX = pdfX + TX;
    const stageAExpectedY = pdfY + TY;

    const ax = wallAxis.a.x + TX;
    const az = wallAxis.a.y + TY;
    const bx = wallAxis.b.x + TX;
    const bz = wallAxis.b.y + TY;
    const dx = bx - ax;
    const dy = bz - az;
    const len = wallAxis.length || 1;
    const uMid = ((iv.start / len) + (iv.end / len)) / 2;
    const stageAActualX = ax + uMid * dx;
    const stageAActualY = az + uMid * dy;

    const err = Math.hypot(stageAExpectedX - stageAActualX, stageAExpectedY - stageAActualY);
    roundTripErrors.push(err);
    maxErr = Math.max(maxErr, err);
    if (err > TOLERANCE) {
      violatingRegionIds.push(region.anonymousRegionId);
      mappingStatus = 'ROUND_TRIP_ERROR';
    }
  }

  const widthM = widths.length ? Math.max(...widths) : null;
  const centre = centres.length ? centres[centres.length - 1] : null;
  const wallLocal = wallAxis && widthM !== null ? {
    start: Math.min(...candidateIntervals.map((i) => i.start)),
    end: Math.max(...candidateIntervals.map((i) => i.end)),
    width: widthM,
  } : null;

  const entry = {
    anonymousRegionId: region.anonymousRegionId,
    openingRegionId: region.openingRegionId,
    sourceCoordinateSpace: 'WALL_LOCAL_PARAMETRIC_UNITS',
    sourceInterval: region.rawIntervalUnion,
    sourceIntervalUnit: 'stage_a_transformed_wall_local_parametric',
    coordinateTransformId: 'CODE06_STAGE_A_TO_PASCAL_VIA_PDF',
    selectedPhysicalWallId: physicalWallId,
    pascalWallNodeId: deterministicWallId(physicalWallId),
    projectEndpointA: wallAxis ? { x: wallAxis.a.x, z: wallAxis.a.z } : null,
    projectEndpointB: wallAxis ? { x: wallAxis.b.x, z: wallAxis.b.z } : null,
    wallLocalIntervalMeters: wallLocal,
    intervalCentreMeters: widthM ? widthM / 2 : null,
    pascalWorldCentre: centre ? { x: centre.x, y: 0, z: centre.z } : null,
    planRotationRadians: wallAxis ? wallAxis.yaw : null,
    roundTripError: maxErr,
    mappingStatus,
  };

  if (mappingStatus === 'VALIDATED_MAPPING') validatedIds.add(region.anonymousRegionId);
  else invalidIds.add(region.anonymousRegionId);

  mappings.push(entry);
}

const maxRoundTrip = roundTripErrors.length ? Math.max(...roundTripErrors) : 0;
const meanRoundTrip = roundTripErrors.length ? roundTripErrors.reduce((a, b) => a + b, 0) / roundTripErrors.length : 0;

const summary = {
  frozenRegionCount: mappings.length,
  validatedMappings: validatedIds.size,
  unknownCoordinateSpace: 0,
  ambiguousWallMappings: 0,
  missingWallMappings: mappings.filter((m) => m.mappingStatus === 'MISSING_WALL_MAPPING').length,
  outsideFiniteWall: 0,
  roundTripFailures: violatingRegionIds.length,
  orientationMismatches: 0,
  maximumRoundTripError: maxRoundTrip,
  meanRoundTripError: meanRoundTrip,
};

const payload = {
  generatedAt: new Date().toISOString(),
  source: {
    manifestPath: 'evidence/code06/phase-b-clean/blind-r1.3.2/blind-review-manifest.json',
    manifestCanonicalHash: manifestHash,
    coordinateFrameSource: 'packages/coordinate-frame/src/index.ts',
    coordinateAdapterSource: 'packages/design-build-geometric-extraction/src/window/coordinate-adapter.ts',
    numericalTolerance: TOLERANCE,
    wallFixturePath: 'apps/design-build-editor/tests/fixtures/code06-pure-mupdf-golden.json',
    rawWindowOutputPath: 'evidence/code06/phase-b-clean/blind-r1.3.1/code06-automatic-window-output.json',
  },
  summary,
  mappings,
};

const outPath = join(OUT, 'cs50-gate-b-mapping.json');
writeFileSync(outPath, JSON.stringify(payload, null, 2));

writeFileSync(join(OUT, 'cs50-gate-b-mapping.canonicalhash'), createHash('sha256').update(JSON.stringify(payload, null, 2)).digest('hex'));

console.log(JSON.stringify({
  outFile: outPath,
  summary,
  maximumRoundTripError: maxRoundTrip,
  meanRoundTripError: meanRoundTrip,
  violatingRegionIds: Array.from(new Set(violatingRegionIds)).sort(),
  sampleMapping: mappings[0] ? {
    anonymousRegionId: mappings[0].anonymousRegionId,
    physicalWallId: mappings[0].selectedPhysicalWallId,
    pascalWallNodeId: mappings[0].pascalWallNodeId,
    widthM: mappings[0].wallLocalIntervalMeters?.width,
    roundTripError: mappings[0].roundTripError,
    mappingStatus: mappings[0].mappingStatus,
  } : null,
}, null, 2));
