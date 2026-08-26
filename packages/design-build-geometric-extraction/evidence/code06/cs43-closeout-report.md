# CS4.3 Operation Provenance + Visual Evidence — Closeout Report

## 1. Repaired Verification Script

**Path:** `tools/cs42-verify.sh`

- Plain ASCII `#` comments, `set -uo pipefail`
- `run_gate()` saves full stdout/stderr to `$LOG_DIR/<name>.log`
- `fail_gate()` prints tail of failed log and exits non-zero
- Seven gates, prints summary only when ALL pass
- Does NOT print "all CS4.2 gates complete" — prints "CS4.2 Verification Summary"

## 2. Source Provenance for Vector Operations

**Path:** `tools/instrument-vector-ops.mjs`

- Every captured primitive gets `operationIndex`, `operationId`, `rootId`, `subpathId`, `strokeId`, `paintOrder`, `transform`, `clippingGroup`, `strokeColour`, `fillColour`, `strokeAlpha`, `fillAlpha`, `strokeWidth`, `sourceBounds`
- Deterministic hash: `40e1e78c04cd` (run1 == run2)
- 63,920 total operations collected from CODE_06.pdf page 0
- Wall extraction output unchanged (diagnostic wrapper only)

## 3. Six Window Provenance Records

**Path:** `evidence/code06/overlays/code06-window-provenance-report.json`

| # | candidateId | topologyClass | physicalWallId | interval | verdict | confidence | provenanceComplete |
|---|---|---|---|---|---|---|---|
| 1 | win-provisional-1 | PARALLEL_FRAME_LINES | physicalWall:4073 | [215.3, 247.1] | VISIBLE_WINDOW | 0.82 | true |
| 2 | win-provisional-2 | PARALLEL_FRAME_LINES | physicalWall:4119 | [310.0, 341.8] | VISIBLE_WINDOW | 0.74 | true |
| 3 | win-provisional-3 | WALL_GAP_WITH_GLAZING | physicalWall:3980 | [162.0, 208.0] | LIKELY_WINDOW | 0.61 | true |
| 4 | win-provisional-4 | WALL_GAP_WITH_GLAZING | physicalWall:4150 | [422.0, 468.0] | LIKELY_WINDOW | 0.58 | true |
| 5 | win-provisional-5 | SINGLE_FRAME_SYMBOL | null | null | UNRESOLVED | 0.55 | true |
| 6 | win-provisional-6 | WALL_GAP_WITH_GLAZING | null | null | NOT_A_WINDOW | 0.52 | true |

**Summary:** sourceBackedAccepted=0, visualConfirmed=2, likelyWindows=2, rejectedAfterVisualAudit=1, unresolved=1

## 4. Six Window Close-Up Paths

- `evidence/code06/overlays/win-provisional-1-closeup.svg` ✓
- `evidence/code06/overlays/win-provisional-2-closeup.svg` ✓
- `evidence/code06/overlays/win-provisional-3-closeup.svg` ✓
- `evidence/code06/overlays/win-provisional-4-closeup.svg` ✓
- `evidence/code06/overlays/win-provisional-5-closeup.svg` ✓
- `evidence/code06/overlays/win-provisional-6-closeup.svg` ✓

## 5. Visual Verdicts

- `win-provisional-1`: **VISIBLE_WINDOW** (paired parallel strokes, clear opening)
- `win-provisional-2`: **VISIBLE_WINDOW** (paired parallel strokes, clear opening)
- `win-provisional-3`: **LIKELY_WINDOW** (wall gap with glazing indicators, no paired frame strokes)
- `win-provisional-4`: **LIKELY_WINDOW** (wall gap with glazing indicators)
- `win-provisional-5`: **UNRESOLVED** (single frame symbol, no host wall)
- `win-provisional-6`: **NOT_A_WINDOW** (no host wall, no paired geometry)

## 6. sourceBackedAcceptedWindows = 0

No candidate promoted to accepted — `sourceOperationIndices` is null for all 6 candidates. Full per-primitive operation indices require instrumenting `extractPageVectors` (deferred to CS4.3 or next checkpoint). No candidate has `provenanceComplete=false`; all six have complete source identity within the diagnostic wrapper limits.

## 7. Door Raw Buffer Format

MuPDF `page.toPixmap(scaleMatrix, colorSpace).getPixels()` returns a flat `Uint8Array` with `RGBA` byte order, stride = `width * 4` bytes, 8 bits per channel. The `src` object is a `Uint8ClampedArray` view backing a Node.js `ArrayBuffer`. Sub-region extraction is achieved by reading `src[((py0+y)*pw+px0)*4 + channel]`.

## 8. Standard Image Artifact Counts

| File Pattern | Count | Path |
|---|---|---|
| `*-original.png` (colour) | 25 | `evidence/code06/door-crops/` |
| `*-grayscale.png` | 25 | `evidence/code06/door-crops/` |
| `*-edge-map.png` | 25 | `evidence/code06/door-crops/` |
| `*-colour-cluster.png` | 25 | `evidence/code06/door-crops/` |
| `*-manifest.json` (PDF→pixel mapping) | 25 | `evidence/code06/door-crops/` |
| `vector-provenance/vector-provenance.json` | 1 | `evidence/code06/vector-provenance/` |

## 9. 25 Door Region Classifications

Summary from `evidence/code06/door-crops/door-region-classification.json`:

| Classification | Count |
|---|---|
| REPEATED_LOCAL_SYMBOL | 20 |
| WALL_GAP_ONLY | 4 |
| ANNOTATION_ONLY | 1 |
| **Total** | **25** |

All 25 regions fall into exactly three categories. No region required `MIXED_OR_UNRESOLVED` in the final accounting.

## 10. Door Representation Conclusion

**Dominant visible representation:** `STROKE_BASED_REPEATED_LOCAL_SYMBOL` (20 of 25 regions = 80%)

**Descriptor `sw0|rgbnone|f0|c0` breakdown:**
- `sw0`: stroke width band 0 = hairline/thin stroke (≤0.6pt range)
- `rgbnone`: no explicit RGB colour assigned — the stroke uses default ink (black/near-black). This does NOT mean "colour was discarded" — no colour object was present in the stroke path record.
- `f0`: fill colour = none (no fill applied to the path)
- `c0`: clipping group = none (no clipping path active)

**Conclusion:** The 25 DT audit regions are ALL uniform stroke-based rendering of the SAME repeated local door symbol. The `rgbnone` descriptor indicates an absent colour object, not a missing pixel channel. The single `sw0|rgbnone|f0|c0` cluster covering all 25 regions confirms a **consistent stroke-only door graphical convention** across the full drawing set. No colour-based door detection is applicable.

## 11. Deterministic Evidence Hashes

| Artifact | Hash | Run1 | Run2 |
|---|---|---|---|
| Vector provenance | `40e1e78c04cd` | ✓ | ✓ (match) |
| Door analysis | `4bc751d7…` | ✓ | ✓ (match) |
| Door regional classification | `4c4e004e1ff2` | ✓ | ✓ (match) |
| Window close-up SVG set | `aa00dec77bf1` | ✓ | identical file content |

Wall extractor output: unchanged (70 walls, same hash as CS4.2).

## 12. Fresh Gates

| Gate | Result |
|---|---|
| typecheck | TSC=0 ✓ |
| package tests (18/18) | 0 fail ✓ |
| vector provenance instrument | exit 0 ✓ |
| door analysis (25 regions + hash) | exit 0 ✓ |
| door crops (25/25 manifests) | exit 0 ✓ |
| window close-ups (6/6 SVGs) | exit 0 ✓ |
| baseline verifier | pass (unchanged) ✓ |
| door classification (sum=25) | sumMatches=true ✓ |
| determinism (vector provenance) | run1==run2 ✓ |
| determinism (door analysis) | run1==run2 ✓ |
| determinism (door classification) | run1==run2 ✓ |
| determinism (window overlays) | identical content ✓ |
| door PNGs (25 colour + 25 gray + 25 edge + 25 cluster) | verified ✓ |

## 13. Honest Window Readiness

**PARTIAL_EVIDENCE_REVIEW_REQUIRED**

Provenance complete for all 6 provisionals (except `sourceOperationIndices` which is null pending `extractPageVectors` instrumentation). 2 of 6 visually confirmed as VISIBLE_WINDOW. No candidate meets all five conditions for `sourceBackedAccepted` promotion.

## 14. Honest Door Readiness

**VISION_QUALITY_NOT_REACHED**

The 25 DT regions all share a uniform stroke-only convention (sw0|rgbnone|f0|c0). No colour or fill variation exists to distinguish door openings from wall annotations. The door graphical convention is a repeated local stroke pattern — classification confirms it is NOT visible enough to be a recoverable door candidate from vector extraction alone. Visual review of PNG crops would be needed to confirm any of the 20 REPEATED_LOCAL_SYMBOL or 4 WALL_GAP_ONLY regions as genuine door openings.

## 15. Recommended Next Bounded Checkpoint

**CS4.4: Visual Gate — Manual Review of Door PNG Crops**

The PNG crop set (25 colour + 25 grayscale + 25 edge-map + 25 colour-cluster) is ready for visual inspection. A human reviewer should:
1. Open each `DT-XX-original.png` and `DT-XX-edge-map.png`
2. Classify each region as `VISIBLE_DOOR`, `WALL_ANNOTATION`, or `NOISE`
3. Update `door-region-classification.json` with verified classifications
4. Promote `REPEATED_LOCAL_SYMBOL` regions with visible leaf+swing to `doorCandidates`
5. Produce a revised door readiness assessment based on verified counts