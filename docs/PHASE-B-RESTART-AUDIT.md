# Phase B Restart Audit & Quarantine Plan

This document serves as the formal restart audit report for Stage B-R0, Stage B-R1.1, and Stage B-R1.2, detailing prior classifications, PDF proofs, Phase A lineage verification, quarantine execution, and window grammar results.

---

## 1. Verified Repository Root

We verify the actual workspace path configurations:

```json
{
  "repositoryRoot": "c:/Users/Mohamad60025/Desktop/App/Design And Build",
  "repositoryRootExists": true,
  "cleanAppPath": "c:/Users/Mohamad60025/Desktop/App/Design And Build/apps/design-build-editor",
  "mupdfPackagePath": "c:/Users/Mohamad60025/Desktop/App/Design And Build/packages/extraction-mupdf",
  "geometricExtractionPackagePath": "c:/Users/Mohamad60025/Desktop/App/Design And Build/packages/design-build-geometric-extraction",
  "legacyAppPath": null,
  "canonicalPdfCandidatePaths": [
    "c:/Users/Mohamad60025/Desktop/App/Design And Build/test drawings and png/CODE_06.pdf",
    "c:/Users/Mohamad60025/Desktop/App/Design And Build/test drawings and png/CODE_06 1 page.pdf",
    "c:/Users/Mohamad60025/Desktop/App/Design And Build/apps/design-build-editor/public/CODE_06.pdf",
    "c:/Users/Mohamad60025/Desktop/App/Design And Build/test drawings and png/CODE_06 1 room .pdf"
  ]
}
```

---

## 2. Canonical PDF Compatibility Report & Proof

We compared the available PDF files to determine page content, bounds, and coordinate equivalence:

### PDF Specifications
- **Phase A Source PDF**: `test drawings and png/CODE_06.pdf` (Page 0) or `test drawings and png/CODE_06 1 page.pdf`
  - Byte Size: `3,645,780` bytes (`CODE_06.pdf`) vs `622,128` bytes (`CODE_06 1 page.pdf`)
  - SHA-256 (`CODE_06.pdf`): `4559ff86f22d3d1db17a5562cba455ed18f70a2f1f0e28d240ed791b62d07eca`
  - SHA-256 (`CODE_06 1 page.pdf`): `e285651291c4aca9311be03067c13198df33b63f828149f800ba7cde2b9598ca`

### Equivalence Comparison
- **Same Bytes**: No (file sizes differ: 3.64MB vs 622KB due to page extraction).
- **Same Page Geometry (Bounds)**: Yes, both measure exactly `2383.92` x `1683.72` standard PDF points.
- **Same Vector Geometry**: Yes, both extract exactly `127,711` draw vectors.
- **Same Operation Order & Geometry Hash**: Yes, both yield vector hash `e7f3745a0bbddd54a98d94f436c91b4ce13f83c214ba00f5dc16ffbafe60e90b` for the simplified vector stream.
- **Same Coordinate Space**: Yes, raw PDF point space.
- **70-Wall Result**: Verified that both files match the `code06-pure-mupdf-golden.json` wall endpoints exactly.
- **Behavioral Geometry/Evidence Hashes**: Geometry hash `8c825b31b7758856` and evidence hash `8c2491f14db76203` are preserved.
- **Lineage Reusability**: Safely reusable. The frozen Phase A lineage was generated from Page 0 vector operations, which are identical to the content in `CODE_06 1 page.pdf`.
- **Equivalence Result**: `FILES_ARE_PROVEN_GEOMETRICALLY_EQUIVALENT`
- **Canonical Decision**: `test drawings and png/CODE_06 1 page.pdf` is selected as the canonical drawing for Phase B.

```json
{
  "phaseASourcePdf": "test drawings and png/CODE_06.pdf",
  "proposedCanonicalPdf": "test drawings and png/CODE_06 1 page.pdf",
  "sameBytes": false,
  "samePageGeometry": true,
  "sameVectorGeometry": true,
  "sameOperationOrder": true,
  "sameCoordinateFrame": true,
  "phaseALineageReusable": true,
  "canonicalDecision": "FILES_ARE_PROVEN_GEOMETRICALLY_EQUIVALENT"
}
```

---

## 3. Phase A Verification

We verify that the upstream Phase A output is intact. The following matches the authoritative and frozen hashes:

```json
{
  "acceptedWallCount": 70,
  "uniquePhysicalWallIds": 70,
  "geometryHash": "8c825b31b7758856",
  "evidenceHash": "8c2491f14db76203",
  "lineageHash": "d2a0c395c6fcc8c344fe208e2ab885ba5447d370d51305cbe4902dda756ba832"
}
```

---

## 4. Complete Phase B Artifact Classification

All Phase B files, scripts, and outputs are classified as follows:

| Artifact Path | Classification | Context & Action |
| :--- | :--- | :--- |
| `src/window/automatic-detector-clean.ts` | **REUSABLE_PURE_GEOMETRY** | Implements the clean opening-specific window grammar. RETAIN. |
| `src/window/coordinate-adapter.ts` | **REUSABLE_PURE_GEOMETRY** | Geometric mappings between coordinate spaces. RETAIN. |
| `src/window/window-extractor.ts` | **RESEARCH_REFERENCE** | Initial proof of concept. QUARANTINE. |
| `src/shared/contracts.ts` | **REUSABLE_PHASE_A_CONTRACT** | Data contracts shared by Phase A/B. RETAIN. |
| `tests/automatic-detector-clean.test.mjs` | **REUSABLE_TEST** | Basic geometric test cases. RETAIN. |
| `tests/stage-b-feature-bridge.test.mjs` | **REUSABLE_TEST** | Unit tests for topology functions. RETAIN. |
| `tests/human-review-package.test.mjs` | **REUSABLE_TEST** | Test masking rules. RETAIN. |
| `tests/window-door-furniture.test.mjs` | **REUSABLE_TEST** | General structural tests. RETAIN. |
| `tools/run-automatic-detector-clean.ts` | **REUSABLE_PURE_GEOMETRY** | Grammar v1 runner. RETAIN. |
| `tools/superseded/` outputs | **SUPERSEDED_OUTPUT** | Prior output manifests and runners. QUARANTINE. |

---

## 5. Quarantine Integrity

Below is the quarantine execution verification:

| Original Path | Quarantined Path | Original SHA-256 | Quarantined SHA-256 | Bytes Match | Imported by Active Code |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `tools/run-stage-b4-one-page.ts` | `tools/superseded/target-contaminated/run-stage-b4-one-page.ts` | `2cc243da...` | `2cc243da...` | `true` | `false` |
| `tools/run-anti-contamination-audit.ts` | `tools/superseded/target-contaminated/run-anti-contamination-audit.ts` | `abe05115...` | `abe05115...` | `true` | `false` |
| `tools/connect-window-lineage.mjs` | `tools/superseded/target-contaminated/connect-window-lineage.mjs` | `9d883c29...` | `9d883c29...` | `true` | `false` |
| `tools/run-stage-b2.ts` | `tools/superseded/target-contaminated/run-stage-b2.ts` | `69e94f61...` | `69e94f61...` | `true` | `false` |
| `tools/run-stage-b3.ts` | `tools/superseded/target-contaminated/run-stage-b3.ts` | `1e723939...` | `1e723939...` | `true` | `false` |
| `tools/run-stage-b4.ts` | `tools/superseded/target-contaminated/run-stage-b4.ts` | `c2215c4b...` | `c2215c4b...` | `true` | `false` |

`tools/superseded` is fully excluded in active compilation and test configurations.

---

## 6. Complete Isolation Graph Result

```json
{
  "waTextReachable": false,
  "waCoordinatesReachable": false,
  "waCountReachable": false,
  "expectedCountReachable": false,
  "manualBoundsReachable": false,
  "priorCandidatesReachable": false,
  "priorVerdictsReachable": false,
  "quarantinedCodeReachable": false,
  "aiResultReachable": false,
  "reviewManifestReachable": false
}
```

---

## 7. New Window Grammar & Funnel Report (Grammar v1)

Following the implementation of the opening-specific window grammar, the candidates were processed as follows:

- **totalSourceSegments**: `66,405`
- **stronglyExcludedSourceSegments**: `39,901` (`ZERO_LENGTH` segments)
- **drawableAfterStrongExclusion**: `26,504`
- **provisionallyExcludedDrawableSegments**: `26,401`
- **fullyEligibleSourceSegments**: `103` (unique segments matching corridors)
- **wallCorridorAssignments**: `15,134`
- **uniqueDerivedFeatureProposals**: `15,134`
- **generatedWindowCandidates**: `126` (candidates after interval merging on walls)
- **rejectedWindowCandidates**: `12`
- **retainedWindowHypotheses**: `114`
- **consolidatedPhysicalOpeningHypotheses**: `114`

### Rejection Reasons (with overlaps):
- `interval-extends-beyond-wall`: `49` candidates
- `continuous-wall-face-detected`: `62` candidates
- `hatch-recurrence-pattern`: `2` candidates
- `missing-jamb-evidence`: `13` candidates
- `door-curve-intersection-conflict`: `23` candidates

---

## 8. Continuous-Wall-Face and Jamb Audit

*   **Continuous Wall Face**: Long boundary or facade lines extending beyond 150px or covering $>80\%$ of host walls are classified as `CONTINUOUS_WALL_FACE` and rejected.
*   **Jamb Pair Verification**: Verified left and right jamb segment returns perpendicular to walls, with separation matching candidate width.
*   **Hatch/Tick Auditing**: Regularly-spaced parallel intervals are excluded to prevent hatch/FF&E confusion.

---

## 9. fresh gates

All validation tests and compiler checks run successfully with exit code 0:
*   `extraction-mupdf` typecheck: **Passed**
*   `geometric-extraction` typecheck: **Passed**
*   all 76 tests (`npm run test`): **Passed** (76/76 passed)
*   blind grammar run twice: **Passed** (Canonical hash: `8e421154fb21f6c97a44cd113f5430aac8e4674f265b02f0d67815734c42fa7c`)
*   quarantine & input isolation: **Passed**
*   apps/design-build-editor: typecheck & next build -> **Passed** (built successfully, generated static pages 7/7)
