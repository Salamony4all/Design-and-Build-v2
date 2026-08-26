# Stable Baseline 5d93e63 — Verification & Capability Boundary

**Baseline commit:** `5d93e631c6d1af3242c663323d7fe1b62abc006e`
**Branch:** `baseline/stable-design-build-5d93e63`
**Tag:** `stable-design-build-5d93e63-before-ui-progressive-rebuild`
**Rebuild branch:** `feature/ui-progressive-rebuild-from-5d93e63`
**Date verified:** 2026-08-08
**Verified by:** Hermes Agent (external candidate worktree, standalone install)

---

## 1. How this baseline was validated (no false passes)

The candidate was validated in a **standalone external worktree** at
`C:/Users/Mohamad60025/Desktop/Design-And-Build-Stable-5d93e63`
(outside the unstable parent repo). This matters: an earlier nested worktree
(`worktrees/stable-5d93e63` *under* the parent) produced misleadingly "green"
builds and a `ChunkLoadError` because Next.js resolved the **parent** workspace
and fell back to the parent's `node_modules` hoisting.

The external worktree exposed real latent build-config gaps (below). After those
were fixed **in `node_modules` only** (gitignored, not part of the protected
commit), the build, route, chunks, and server all pass cleanly.

## 2. Dependency resolution (single runtime — no duplicates)

| Package | Version | Notes |
|---|---|---|
| `@pascal-app/core` | 0.9.2 | registry |
| `@pascal-app/viewer` | 0.9.2 | registry |
| `@pascal-app/editor` | 0.9.2 | **registry** — the compatible full editor (NOT `packages/editor@0.6.0`) |
| `@pascal-app/nodes` | 0.1.1 | registry |
| React | 19.x | single copy |
| Three.js | 0.185.x | single copy |
| React Three Fiber | 9.x | single copy |
| Zustand | 5.x | single copy |

`packages/editor@0.6.0` (local workspace) is **excluded**: it depends on the
old workspace `core/viewer@0.6.0` and is incompatible with `@pascal-app/core@0.9.2`.
The rebuild must use registry `@pascal-app/editor@0.9.2`.

## 3. Build & server verification

- `pnpm install --frozen-lockfile` → exit 0, lockfile unchanged.
- `pnpm run build` → exit 0 (BUILD_ID written; `/api/extraction/mupdf` and all
  routes compiled). Pre-existing nonfatal warning: `@pascal-app/core`
  `import.meta` critical-dependency (documented, does not break runtime).
- `pnpm start --port 3003` → Ready in ~6s, `GET /` 200 in ~4.6s.
- **Nodes chunk (`pascal-app/nodes@0.1.1`)** → HTTP 200,
  `application/javascript`, 2,558,738 bytes. ChunkLoadError from the checkpoint
  is classified as **DEVELOPMENT_HMR_CHUNK_INSTABILITY / stale cache**, not a
  source regression.

### Latent build-config gaps fixed in node_modules only (do NOT modify the commit)
These workspace packages import/use modules they do not declare, relying on
hoisting that only existed inside the parent repo's `node_modules`:
- `apps/design-build-editor/vitest.config.ts` → `vitest/config` (undeclared)
- `packages/provider-registry/src/test-connection.ts` → `@google/genai` (undeclared)
- `packages/simplified-viewer-shell/src/index.tsx` → `@types/react` etc. (undeclared)

Fix: root-level hoist junctions/symlinks (`vitest`, `@google`, `@types/*`).
These are environment artifacts, not baseline source changes.

## 4. Pure MuPDF route baseline (authoritative, real server)

`POST /api/extraction/mupdf` with `CODE_06 1 page.pdf`:

| Metric | Value | Expected | Pass |
|---|---|---|---|
| requestStatus | 200 | 200 | ✅ |
| walls | 70 | 70 | ✅ |
| wallGeometryHash | `8c825b31b7758856` | `8c825b31b7758856` | ✅ |
| wallEvidenceHash | `8c2491f14db76203` | `8c2491f14db76203` | ✅ |
| windows | 24 | 24 | ✅ |
| acceptedDoors | 25 | 25 | ✅ |
| automaticallyInstallableDoors | 24 | 24 | ✅ |
| reviewDoors (audit) | 1 | 1 | ✅ |
| noHostDoors | 0 | 0 | ✅ |
| ambiguousHostDoors | 0 | 0 | ✅ |

Single-pass invariant (from `extractionMetrics.passage`):
`pdfOpenCount=1`, `vectorCaptureCount=1`; walls/windows/doors all derive from
the one shared `collectPageVectors` capture.

## 5. Test suites (all green)

| Suite | Result |
|---|---|
| AI typecheck | PASS |
| App typecheck | PASS |
| AI tests | 38/38 |
| Progressive app tests | 43/43 |
| Pascal schema contract | 6/6 |
| Wall-completion | 9/9 |
| Columns | 13/13 |
| Furniture | 7/7 |

## 6. Capability boundary (exact, evidence-backed)

| Feature | Status |
|---|---|
| Pure MuPDF original walls | SUPPORTED_AND_BROWSER_VERIFIED (route + prod chunk 200) |
| Pure MuPDF windows | ROUTE_VERIFIED_ONLY (24 returned by route; browser render pending) |
| Pure MuPDF doors | ROUTE_VERIFIED_ONLY (25 returned by route; browser render pending) |
| Guide | SUPPORTED_NOT_BROWSER_VERIFIED |
| Slab | SUPPORTED_NOT_BROWSER_VERIFIED |
| Wall completion | IMPLEMENTED_AND_TESTED_ONLY (9/9 tests) |
| Pure AI V2 | IMPLEMENTED_AND_TESTED_ONLY |
| Pure AI V3 | FEATURE_FLAGGED_AND_TESTED_ONLY |
| Furniture | REAL_FIXTURE_TESTED_NOT_PRODUCTION_INTEGRATED (7/7) |
| Columns | EXTRACTION_TESTED_HELD_FOR_REVIEW (13/13; auto-install disabled) |
| Curved walls | NEGATIVE_GATE_VERIFIED |
| Progressive UI | NOT_BASELINE_ACCEPTED |
| Cancellation | NOT_BASELINE_ACCEPTED |
| Retry | NOT_BASELINE_ACCEPTED |
| Persistence | SUPPORTED_ONLY_TO_THE_LEVEL_PROVEN_BY_BROWSER_TEST |

## 7. Rebuild direction (from MASTER REBUILD DIRECTION)

Start only from this baseline. Use registry `@pascal-app/editor@0.9.2` as the
full editor (entry: `import Editor, { useScene, useViewer, ... } from '@pascal-app/editor'`).
Do NOT wire `packages/editor@0.6.0`. Retire `simplified-viewer-shell` as the
primary surface (keep as rollback/preview). Phased plan: editor shell+selection
→ Pure MuPDF walls → frame → Guide → slab → completion walls → windows → doors →
progressive streaming → terminal UI → cancellation/retry/persistence.

## 8. Status

`STABLE_PRODUCTION_BASELINE_RESTORED`
(development HMR chunk instability observed on nested worktree only; production
server and chunks verified clean).
