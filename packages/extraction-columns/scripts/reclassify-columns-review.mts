// §1 MASTER CHECKPOINT: reclassify the 28 accepted column records.
//
// Per the master checkpoint, the live visual audit showed the automatically
// installed columns were false positives (furniture-derived: bedside units,
// bed dividers, cabinets). They must be reclassified and NOT counted as
// validated Pascal nodes. We do NOT delete the extraction package or evidence.
//
// Reclassification:
//   verdict -> 'REVIEW'
//   reviewStatus -> 'REVIEW_REQUIRES_STRUCTURAL_CONFIRMATION'
//   reclassificationReason -> 'LIVE_VISUAL_AUDIT_FURNITURE_FALSE_POSITIVE_RISK'
//
// Writes a new column-review-manifest.json (the canonical REVIEW set) and also
// updates accepted-column-manifest.json in place so downstream consumers see the
// new status. The raw extraction evidence is preserved untouched.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const EVIDENCE = join(process.cwd(), 'evidence');
mkdirSync(EVIDENCE, { recursive: true });
const manifestPath = join(EVIDENCE, 'accepted-column-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as any[];

const REASON = 'LIVE_VISUAL_AUDIT_FURNITURE_FALSE_POSITIVE_RISK';
const STATUS = 'REVIEW_REQUIRES_STRUCTURAL_CONFIRMATION';

const reviewed = manifest.map((r) => ({
  ...r,
  verdict: 'REVIEW',
  reviewStatus: STATUS,
  reclassificationReason: REASON,
}));

// Canonical REVIEW manifest (this is what the runtime must treat as non-installed).
writeFileSync(join(EVIDENCE, 'column-review-manifest.json'), JSON.stringify(reviewed, null, 2));
// Update the accepted manifest in place (preserve raw evidence elsewhere).
writeFileSync(manifestPath, JSON.stringify(reviewed, null, 2));

console.log(JSON.stringify({
  total: reviewed.length,
  verdict: 'REVIEW',
  reviewStatus: STATUS,
  reason: REASON,
  installedColumnNodesTarget: 0,
}, null, 2));
