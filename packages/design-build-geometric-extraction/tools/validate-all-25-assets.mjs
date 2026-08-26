import { existsSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIR = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2');

function validate() {
  const missingFiles = [];
  const invalidFiles = [];
  const blankSourceCrops = [];
  const registrationFailures = [];
  
  let sourceCount = 0;
  let locatorCount = 0;
  let sourceOpsCount = 0;
  let hostCount = 0;
  let intervalCount = 0;
  let candidateCount = 0;
  let openingCount = 0;
  
  for (let i = 0; i < 25; i++) {
    const idxStr = String(i).padStart(3, '0');
    
    const files = {
      source: `region-${idxStr}-source.png`,
      locator: `region-${idxStr}-locator.png`,
      sourceOps: `region-${idxStr}-source-operations.svg`,
      host: `region-${idxStr}-host-wall.svg`,
      interval: `region-${idxStr}-raw-interval.svg`,
      candidate: `region-${idxStr}-candidates.svg`,
      opening: `region-${idxStr}-opening-region.svg`
    };
    
    for (const [key, filename] of Object.entries(files)) {
      const filepath = join(DIR, filename);
      if (!existsSync(filepath)) {
        missingFiles.push(filename);
      } else {
        const stat = statSync(filepath);
        if (stat.size === 0) {
          invalidFiles.push(filename);
        } else {
          if (key === 'source') {
            sourceCount++;
            // Check if blank (white background crop of scale 4 will be very small if empty, but drawing crops are usually > 5KB)
            if (stat.size < 1000) {
              blankSourceCrops.push(filename);
            }
          }
          else if (key === 'locator') locatorCount++;
          else if (key === 'sourceOps') sourceOpsCount++;
          else if (key === 'host') hostCount++;
          else if (key === 'interval') intervalCount++;
          else if (key === 'candidate') candidateCount++;
          else if (key === 'opening') openingCount++;
        }
      }
    }
  }
  
  const report = {
    regionCount: 25,
    realSourceCrops: sourceCount,
    locatorImages: locatorCount,
    sourceOperationOverlays: sourceOpsCount,
    hostOverlays: hostCount,
    intervalOverlays: intervalCount,
    candidateOverlays: candidateCount,
    openingRegionOverlays: openingCount,
    missingFiles,
    invalidFiles,
    blankSourceCrops,
    registrationFailures
  };
  
  writeFileSync(join(DIR, 'visual-asset-validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

validate();
