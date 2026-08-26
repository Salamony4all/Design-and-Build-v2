# FFE Vision Quality Log (Change Set 4 + 4.1, §15)

Iteration discipline per §15. Each entry records rule changes, counts, false
positives/negatives, and the canonical hash. We do **not** tune to the expected
count (24 beds); we record what source-backed geometry yields.

## Iteration 1 — naive primitive→family (REJECTED)

- **Rule:** feed every filled `collectPageVectors` root as a furniture component;
  run `discoverFurnitureFamilies` (recurnce ≥ 3).
- **Result:** `familyCount = 24`, but `bedFamilies = 0`. Families were wall hatch
  fills / door swings (tiny degenerate bounds, `D0x0`). Dim gates failed because
  component bounds were in PDF points but passed as mm (`unitsPerMeter=1000`).
- **False positives:** wall-mass + swing arcs clustered as "furniture".
- **Status:** SUPERSEDED_BY_CORRECTED_RUNNER
- **Canonical hash:** `f1d0ea4d…` (invalid input units).

## Iteration 2 — points→mm conversion (REJECTED)

- **Rule change:** convert component bounds PDF points → mm (×5.14) before family
  discovery; load real oracle (24).
- **Result:** `bedFamilies = 0` still. Signatures collapsed to `W=0.025mm` — because
  I was feeding **decomposed subpaths** (zero-width slivers), not root paths, and
  excluding stroke-paths (beds drawn as stroked rectangles were dropped).
- **False negatives:** all real furniture (stroked) excluded.
- **Status:** SUPERSEDED_BY_CORRECTED_RUNNER

## Iteration 3 — connected-component grouping pre-pass (REJECTED as bed source)

- **Rule change:** union-find over root primitives by bounding-box proximity
  (GAP = 28 pt ≈ 144 mm); merge into composite furniture symbols; filter to
  furniture envelope (0.25–3.6 m, ratio ≤ 4); run recurrence clustering.
- **Real geometry finding:** CODE-06's linework is a **connected mesh**. GAP = 28 pt
  merges 63,811 of 63,826 primitives into **2 giant blobs** (n = 36,243 and
  n = 27,568). Only 3 tiny groups (n ≤ 6) survive — none recurs ≥ 3 as a bed.
  `familyCount = 0`, `acceptedBeds = 0`.
- **Root cause:** CODE-06 draws beds as composite symbols embedded in the wall
  linework mesh — there is **no single closed bed-shaped primitive** (0 roots in the
  bed-size box: 146–260 × 331–480 pt). The v0.4 package assumed clean closed
  rectangles, which this drawing does not provide.
- **Honest verdict:** pure-primitive recurrence / region grouping **cannot
  reconstruct 24 discrete beds** from CODE-06. Forcing the count would violate §14
  ("expected count must not force the detector") and §15.
- **Canonical hash (locked, deterministic):** `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`
  (identical on run1 and run2 → determinism satisfied, §19).
- **Status:** SUPERSEDED_BY_CORRECTED_RUNNER

## Iteration 4 — corrected CS4.1 runner (AUTHORITATIVE)

- **Baseline:** corrected runner loads `ai_post_result.json` directly (16 records)
  instead of relying on pure-primitive bed detection.
- **Authoritative AI counts:** 12 single beds, 2 toilets, 1 bathtub, 1 square shower
  (catalog:single-bed/catalog:toilet/catalog:bathtub/catalog:shower-square).
- **Scope split:** loose-ffe = 12 beds; sanitary fixtures = 4.
- **Deterministic hash:** `54f82e61dac7c9025422f69a7caa1a25ead180153ac5b49ddcaa3d494a46791e`
  (run1 == run2).
- **Geometry status:** CURRENT_GLOBAL_GROUPING_METHOD_FAILED for discrete bed
  reconstruction from pure primitives; AI-guided ROI search is the active path.
- **Window extraction:** 72 candidates generated against 70-wall host network.
- **Door extraction:** 0 candidates generated; diagnosis pending CODE-06-specific
  pre-pass.
- **Status:** PARTIAL_EVIDENCE_REVIEW_REQUIRED for FF&E and windows; NOT_REACHED
  for doors.

## Determinism (§19)

- legacy pure-geometry hash: `4f53cda18c…0212b945` (run1 == run2).
- corrected evidence hash: `54f82e61dac7c9025422f69a7caa1a25ead180153ac5b49ddcaa3d494a46791e`
  (authoritative run1 == run2). Identical AI input, reconciliation, window
  candidates, door candidates, and complete evidence package. **Deterministic.**
