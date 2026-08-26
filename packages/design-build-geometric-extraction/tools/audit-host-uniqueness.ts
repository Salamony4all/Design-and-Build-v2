// Script to audit host wall uniqueness and competitor scores for all 126 candidates.
// Completely blind to WA expected counts.

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const BLIND_OUTPUT_PATH = join(ROOT, 'evidence/code06/phase-b-clean/blind-grammar-v1/code06-automatic-window-output.json');
const OUT_PATH = join(ROOT, 'evidence/code06/phase-b-clean/blind-grammar-v1/host-uniqueness-audit.json');

function main() {
  const data = JSON.parse(readFileSync(BLIND_OUTPUT_PATH, 'utf8'));
  const candidates = data.candidates;

  const auditRecords: any[] = [];

  for (const cA of candidates) {
    const [ax0, ay0, ax1, ay1] = cA.generatedBounds;
    const scoreA = cA.sourceFeatureIds.length;

    const consideredHosts: string[] = [cA.physicalWallId];
    let bestHostScore = scoreA;
    let secondBestHostScore = 0;

    // Find competitors
    for (const cB of candidates) {
      if (cA.candidateId === cB.candidateId) continue;
      if (cA.physicalWallId === cB.physicalWallId) continue;

      const [bx0, by0, bx1, by1] = cB.generatedBounds;
      const xOverlap = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
      const yOverlap = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));

      if (xOverlap > 0 && yOverlap > 0) {
        consideredHosts.push(cB.physicalWallId);
        const scoreB = cB.sourceFeatureIds.length;
        if (scoreB > secondBestHostScore) {
          secondBestHostScore = scoreB;
        }
      }
    }

    const selectionMargin = bestHostScore - secondBestHostScore;
    let hostStatus = 'UNIQUE_HOST';
    if (consideredHosts.length > 1) {
      if (selectionMargin < 2) {
        hostStatus = 'AMBIGUOUS_HOST_REVIEW';
      }
    }

    auditRecords.push({
      candidateId: cA.candidateId,
      selectedPhysicalWallId: cA.physicalWallId,
      consideredHosts: Array.from(new Set(consideredHosts)).sort(),
      bestHostScore,
      secondBestHostScore,
      selectionMargin,
      hostStatus,
    });
  }

  writeFileSync(OUT_PATH, JSON.stringify(auditRecords, null, 2));
  console.log('HOST_UNIQUENESS_AUDIT_DONE');
}

main();
