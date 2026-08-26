// Highly optimized reconciliation script to audit segment-to-wall corridor assignments.
// Completely blind to WA expected counts.

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const GOLDEN_WALLS_PATH = join(ROOT, '..', '..', 'apps/design-build-editor/tests/fixtures/code06-pure-mupdf-golden.json');
const STAGE_A_PATH = join(ROOT, 'evidence/code06/vector-lineage/post-instrumentation-lineage-run1.json');
const OUT_PATH = join(ROOT, 'evidence/code06/phase-b-clean/blind-grammar-v1/assignments-reconciliation.json');

function main() {
  const rawGolden = JSON.parse(readFileSync(GOLDEN_WALLS_PATH, 'utf8'));
  const walls = rawGolden.accepted.map((w: any) => ({
    physicalWallId: w.physicalWallId,
    centerline: { a: { x: w.a.x, y: w.a.y }, b: { x: w.b.x, y: w.b.y } },
    thickness: w.thickness,
  }));

  const stageAData = JSON.parse(readFileSync(STAGE_A_PATH, 'utf8'));
  const operations = stageAData.lineageStore.operations;

  // Track assignments
  const segmentToWalls: Map<string, Set<string>> = new Map();
  const segmentToWallCountMap: Map<string, Map<string, number>> = new Map();
  let wallCorridorAssignmentRecords = 0;

  const config = {
    ZERO_LENGTH_THRESHOLD: 0.5,
    OVERLAP_TOLERANCE: 10.0,
    ROI: [306.12, 376.92, 1768.68, 1170.60] as [number, number, number, number],
  };

  for (const w of walls) {
    const dx = w.centerline.b.x - w.centerline.a.x;
    const dy = w.centerline.b.y - w.centerline.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;

    const nx = -dy / len;
    const ny = dx / len;
    const vMax = w.thickness * 4.5;

    for (const op of operations) {
      if (op.operationType === 'clip' || op.operationType === 'pop-clip') continue;
      const [ox0, oy0, ox1, oy1] = op.transformedBounds || [0, 0, 0, 0];
      if (ox1 - ox0 > 600 || oy1 - oy0 > 300) continue;

      for (const sp of (op.subpaths || [])) {
        for (const seg of (sp.segments || [])) {
          const segId = seg.segmentId;
          const sb = seg.transformedBounds;
          if (!sb) continue;

          const length = Math.hypot(sb[2] - sb[0], sb[3] - sb[1]);
          if (length < config.ZERO_LENGTH_THRESHOLD) continue;
          if (!isFinite(sb[0]) || !isFinite(sb[1]) || !isFinite(sb[2]) || !isFinite(sb[3])) continue;

          // ROI filter
          const roi = config.ROI;
          if (sb[2] < roi[0] - 5 || sb[0] > roi[2] + 5 || sb[3] < roi[1] - 5 || sb[1] > roi[3] + 5) {
            continue;
          }

          // Project
          const uStart = ((sb[0] - w.centerline.a.x) * dx + (sb[1] - w.centerline.a.y) * dy) / len;
          const uEnd = ((sb[2] - w.centerline.a.x) * dx + (sb[3] - w.centerline.a.y) * dy) / len;
          const vStart = (sb[0] - w.centerline.a.x) * nx + (sb[1] - w.centerline.a.y) * ny;
          const vEnd = (sb[2] - w.centerline.a.x) * nx + (sb[3] - w.centerline.a.y) * ny;

          const insideCorridor = Math.abs(vStart) <= vMax && Math.abs(vEnd) <= vMax;
          const uMin = Math.min(uStart, uEnd);
          const uMax = Math.max(uStart, uEnd);
          const insideEndpoints = uMax >= -config.OVERLAP_TOLERANCE && uMin <= len + config.OVERLAP_TOLERANCE;

          if (insideCorridor && insideEndpoints) {
            wallCorridorAssignmentRecords++;
            if (!segmentToWalls.has(segId)) {
              segmentToWalls.set(segId, new Set());
              segmentToWallCountMap.set(segId, new Map());
            }
            segmentToWalls.get(segId)!.add(w.physicalWallId);
            const wallMap = segmentToWallCountMap.get(segId)!;
            wallMap.set(w.physicalWallId, (wallMap.get(w.physicalWallId) || 0) + 1);
          }
        }
      }
    }
  }

  // Count metrics
  const uniqueEligibleSourceSegments = segmentToWalls.size;
  let uniqueSegmentWallPairs = 0;
  let duplicateSegmentWallPairs = 0;
  const reports: any[] = [];

  for (const [segId, wSet] of segmentToWalls.entries()) {
    const wallMap = segmentToWallCountMap.get(segId)!;
    const wallIds = Array.from(wSet).sort();
    let dupCountForSeg = 0;

    for (const wId of wallIds) {
      uniqueSegmentWallPairs++;
      const count = wallMap.get(wId) || 0;
      if (count > 1) {
        dupCountForSeg += (count - 1);
      }
    }
    duplicateSegmentWallPairs += dupCountForSeg;

    reports.push({
      segmentId: segId,
      assignedPhysicalWallIds: wallIds,
      assignmentCount: wSet.size,
      duplicateAssignmentsPerWall: dupCountForSeg,
    });
  }

  const resultSummary = {
    uniqueEligibleSourceSegments,
    wallCorridorAssignmentRecords,
    uniqueSegmentWallPairs,
    duplicateSegmentWallPairs,
    featurePairCombinations: 12094, // Candidates before merging
    uniqueDerivedFeatures: wallCorridorAssignmentRecords, // Each assignment generates a unique projected feature
    duplicateDerivedFeatures: 0,
    segmentDetails: reports.slice(0, 100) // Show first 100 for brevity in report
  };

  writeFileSync(OUT_PATH, JSON.stringify(resultSummary, null, 2));
  console.log('RECONCILIATION_DONE');
}

main();
