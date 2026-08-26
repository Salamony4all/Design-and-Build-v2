# Codebase Brief — Design And Build (Clean Rebuild)

> Audience: next agent / engineer. Read first; verify paths with `ls`. This brief
> is a map, not a substitute for reading the code.
> Last updated: 2026-08-05 after the FINAL REPOSITORY CLEANUP (committed in `fb76a1f`,
> `54ba6bd`, `4ad969b`). This brief is a map, not a substitute for reading the code.

## 0. What this project is
A **PDF → Pascal Studio BIM** extraction app. Upload an architectural PDF; a
**geometric (pure-MuPDF) extractor** recovers walls / windows / doors as vector
geometry; an optional **AI (Gemini) extractor** cross-checks structure; results
are **adapted into neutral Pascal nodes** and **committed into a live Pascal
scene** (the `@pascal-app/core` runtime) via the active Pascal editor app.

Monorepo: **pnpm workspaces + turbo**. Node 24, Next.js 15.5 (App Router),
React 19, three 0.185. Pascal stack pinned (see memory `pascal-design-and-build`).

## 1. Repository layout (post-cleanup)
```
apps/
  design-build-editor/     # ACTIVE application (port 3003) — the only app
packages/
  extraction-mupdf/        # geometric wall/window/door extractor (THE core)
  extraction-ai/           # Gemini multipass structural extraction + V3 progressive
  extraction-annotations/  # programmatic PDF_TEXT sidecar (no annotation-only DoorNodes);
                          # supports door extraction via extractDoorTagsFromText
  extraction-contracts/    # shared types (ExtractionResult, Wall/Window/Door)
  pascal-adapter/          # neutral node model + scene-tree mutations
  coordinate-frame/        # PDF-point -> metre transform (authoritative)
  extraction-furniture/    # furniture detection (TOP priority category; Vision Quality
                          # development, NOT production-integrated)
  extraction-columns/      # column evidence extraction
  extraction-curved-walls/ # curved-wall NEGATIVE gate (Pascal WallNode curveOffset
                          # supported; CODE_06 has zero accepted curved structural walls)
  design-build-geometric-extraction/ # older/parallel geometric work + evidence
  core/ editor/ viewer/ simplified-viewer-shell/  # Pascal runtime + shells
  (others: attachment-service, conversation-core, evidence, export-services,
   layout-intelligence, provider-registry, render-orchestrator, shared-ui,
   deterministic-engine)
test drawings and png/     # CODE_06 1 page.pdf is the canonical fixture
```
**`apps/editor` (legacy pre-clean-rebuild app, 319 tracked files) was REMOVED
on 2026-08-05 via `git rm`** — it was excluded from the workspace
(`pnpm-workspace.yaml` `- "!apps/editor"`), had zero inbound source imports, and
is fully superseded by `apps/design-build-editor`. All legacy references in docs
are now historical only.

## 2. The geometric extraction pipeline (`packages/extraction-mupdf`)
Single-pass: PDF opened once, vectors captured once, then walls → windows →
doors recovered from the same vectors. Hard invariant (perf + memory).

- `mupdf-pure.ts` (FROZEN) → `extractPureWallResult` → **70 accepted walls** on
  CODE_06. Baseline hashes: `wallGeometryHash=8c825b31b7758856`,
  `wallEvidenceHash=8c2491f14db76203`.
- `mupdf-pure-windows.ts` (FROZEN) → **24 accepted windows**.
- `mupdf-pure-doors.ts` (MODIFIABLE) → hinge-primary door-to-wall host
  competition; **25 accepted / 202 review**, `NO_HOST=0`, `AMBIGUOUS_HOST=0`;
  of the accepted, **24 are automatically installable** and **1 door audit
  reference remains under review** (no annotation-only DoorNodes are created).
- `wall-completion/` (MODIFIABLE) → `wall-completion.test.ts` (synthetic,
  deterministic, **`node:test` runner**, run via `pnpm run test:wall-completion`,
  9/9 PASS). The package `vitest.config.ts` `include: ['tests/**/*.test.ts']`
  does NOT cover `src/`, so `vitest run` reports "No test files found" for it —
  that is a config scope quirk, not a failure. Final **live browser room-closure
  validation is still pending** (implemented + unit-tested only).

## 3. The AI pipeline (`packages/extraction-ai`)
`multipass-controller.ts` (multi-pass Gemini), `parser.ts`, `result-adapter.ts`,
`structural-adapter.ts` (V3 progressive), `furniture-spatial.ts` (V3 furniture
policy). AI is a **secondary validator**; geometric extractor is authoritative.
V3 progressive installer lives in `apps/design-build-editor/src/harness/`
(`install-progressive-stage.ts`, `ai-scene-install/*`). V2 route stays rollback,
unchanged (`multipass-controller.ts`/`result-adapter.ts` restored to baseline).

## 4. Contracts & neutral model
`extraction-contracts` (shared wire type) + `pascal-adapter` (`createNeutralAdapter`,
`scene-tree.ts` mutations). Door/wall/window install uses these primitives.

## 5. App wiring (`apps/design-build-editor`)
- `app/api/extraction/mupdf/route.ts` — live production endpoint (open PDF once,
  wall→window→door from same vectors).
- `app/api/extraction/ai/route.ts` + `progressive/route.ts` — AI V2 (rollback) +
  V3 progressive (feature-flagged `PURE_AI_PROGRESSIVE_V3`).
- `features/door-pilot/install-live-doors.ts`, `features/window-pilot/`,
  `features/viewer-interaction/`, `features/progressive-build/`.
- `src/components/dynamic-project-label.ts` — used by production (keep).
- `public/items/<familyId>/model.glb` — **REQUIRED furniture GLBs** (Pascal loads
  local assets; confirmed via tracing the real `@pascal-app/core` asset loader —
  `loadAssetUrl` returns local `/items/...` paths as-is). Do NOT delete.

## 6. Shared captured-vector fixture (IMPORTANT)
`packages/extraction-mupdf/extraction-results/secondary-fixture.json` is the
**immutable shared fixture** for `extraction-columns/src/fixture.ts` and
`extraction-furniture/src/fixture.ts` real-fixture tests. It is **GENERATED**,
not committed (gitignored). Regenerate deterministically:
```
cd packages/extraction-mupdf && npx tsx scripts/gen-secondary-fixture.mts
```
Generator: `packages/extraction-mupdf/scripts/gen-secondary-fixture.mts`
(mirrors the live route's single-pass open→capture→run; deterministic from
CODE_06 PDF). After regeneration: columns 13/13 + furniture 7/7 real-fixture
tests PASS. `oracle.mts` (one-to-one oracle scoring) also reads this fixture.

## 7. Calibration / evidence / vision-quality harnesses (KEEP)
- `packages/extraction-mupdf/scripts/`: `score-doors.mts`, `test-host-competition.mts`,
  `gen-evidence.mts`, `run-tests.mts`, `route-column-pipeline.test.mts`,
  `gen-secondary-fixture.mts`, `evidence/` (ledger.json, evidence.html).
- `packages/extraction-furniture/scripts/`: `a1-stats.mjs` … `a8-sweep.mjs`,
  `raster.mjs`, `render.mjs` (Vision Quality + evidence generators).
- `packages/design-build-geometric-extraction/evidence/` — permanent regression
  artifacts (KEEP). The bulk of `tools/*.mjs` are one-off dev scripts
  (UNKNOWN_REVIEW_REQUIRED — left in place; not deleted).
- Repo-root `extraction-results/` (pascal_scene_*, v10/v8/v87) — tracked
  accepted manifests (KEEP).

## 8. Verification commands (the truth)
- **Server-safe gates (run while `next dev` is live):**
  - `pnpm --filter design-build-extraction-ai typecheck` (AI_TC=0)
  - `pnpm --filter design-build-editor typecheck` (APP_TC=0)
  - `pnpm --filter design-build-extraction-ai exec vitest run` (38/38 — `sanitizer.fixtures.test.ts`
    removed during cleanup because it imported the deleted `apps/editor`)
  - `pnpm --filter design-build-editor exec vitest run src/harness/v3-pipeline.test.ts src/harness/ai-scene-install/v3.test.ts src/harness/v3-feature-flag.test.ts` (43/43)
  - `npx tsx apps/design-build-editor/src/harness/ai-scene-install/schema-contract.runner.mts` (6/6 real Pascal schema)
  - `pnpm --filter design-build-extraction-mupdf run test:wall-completion` (9/9)
  - (regenerate fixture first) `cd packages/extraction-columns && npx tsx --test test/extractors.test.mts` (13/13); `cd packages/extraction-furniture && npx tsx --test $(find . -name '*.test.ts')` (7/7)
- **Production build (verified exit 0 at closeout):**
  stop `next dev` first (do **not** run `next build` concurrently against the same
  `.next` directory — it kills the dev server on port 3003, ~400s), then:
  `cd apps/design-build-editor && pnpm run build`.
- Live smoke: `curl -F "file=@test drawings and png/CODE_06 1 page.pdf" http://localhost:3003/api/extraction/mupdf`
  → 70 walls / 24 windows / 24 doors installable (+1 under audit; 25 accepted).

## 9. Current status (2026-08-05 cleanup)
- **Cleanup commits:** `9e3feb1` (fixture generator), `b012a60` (remove apps/editor + obsolete legacy refs), `abb9da4` (dead tracked files), `fb76a1f` (brief+handover), `a57956b` (gitignore). Precedes `80e1fac` (V3 checkpoint).
- **Legacy `apps/editor` REMOVED** (319 tracked files, `git rm`). Workspace already
  excluded it; zero inbound imports; safe.
- **Dead tracked files removed (19):** `public/ping.txt` (×2), `api/debug/log/route.ts`,
  `docs/PHASE-B-RESTART-AUDIT.txt`, geometric `src/window/*.txt` (×2) + `window-extractor.ts.bak`,
  `tools/superseded/` (6 files), `packages/evidence/code06/overlays/test.txt`,
  `extraction-columns/scripts/probe-*.mts` (×4).
- **Total tracked files removed: 342** (319 apps/editor + 4 obsolete legacy tests/scripts + 19 dead files).
- **Untracked junk removed earlier:** `.hermes/`, `archive/`, `.next/`, root
  `scripts/`, `apps/design-build-editor/scripts/`, `api/ai-debug/`,
  `install-ai-extract.txt`, `vitest.schema.config.ts`, `*mupdf-pure.txt`.
- **Restored (must not destroy):** all tracked files my first `rm -rf` hit —
  calibration harnesses, the legacy tests, `apps/editor` (then deliberately `git rm`'d).
- **Shared fixture regenerated** (secondary-fixture.json) — columns/furniture green.
- Walls 70 / windows 24 / doors 25 baselines UNCHANGED.
- **Production build passed at closeout** — `pnpm --filter design-build-editor run build`
  exited **0** (all routes compiled; `import.meta` Pascal warning is pre-existing, non-fatal).
- **Working tree was clean at closeout** (no staged/unstaged/untracked source or assets).
- **Pure AI Progressive V3 (commit `80e1fac`):** compile-and-test checkpoint passed;
  **87/87 reported tests passed**; **V2 rollback passed**; **MuPDF isolation passed**;
  **live AI validation still pending** (gated behind `PURE_AI_PROGRESSIVE_V3`).
- **Wall completion:** implemented + unit-tested (9/9 node:test via
  `pnpm run test:wall-completion`); **final live browser room-closure validation
  still pending**.
- **Columns safe policy:** automatic column installation **disabled**; former column
  candidates **held for structural review**; missing room boundaries handled through
  **wall completion**, not `ColumnNodes`. Columns are NOT described as production-accepted.
- **Active feature flags / provider selection:** `PURE_AI_PROGRESSIVE_V3` gates the V3
  progressive installer (V2 route stays rollback). Provider selection is **dropdown-only**,
  populated by dynamic key discovery — **no manual model-id text input**.
- **Runtime GLB assets** under `public/items/` are **tracked and required** (292 GLB files
  committed; Pascal loads local `/items/<slug>/model.glb`).
- **Calibration + Vision Quality scripts** (`extraction-mupdf/scripts/*`,
  `extraction-furniture/scripts/*`) are **intentionally retained**.

### Feature status matrix (closeout)
Legend: ✅ done · ⏳ pending. Distinctions: implemented / typechecked / unit-tested /
real-PDF tested / browser-validated / production-build validated.
| Feature | impl | typecheck | unit | real-PDF | browser | prod-build |
|---|---|---|---|---|---|---|
| Pure MuPDF (walls/windows/doors) | ✅ | ✅ | ✅ | ✅ (70/24/25) | ⏳ | ✅ |
| Pure AI V2 (rollback) | ✅ | ✅ | ✅ (38/38) | — | ⏳ | ✅ |
| Pure AI V3 progressive | ✅ | ✅ | ✅ (43/43) | — | ⏳ | ✅ |
| Wall completion | ✅ | ✅ | ✅ (9/9) | ⏳(not gated) | ⏳ room-closure | ✅ |
| Windows (24) | ✅ | ✅ | ✅ | ✅ route | ⏳ | ✅ |
| Doors (25; 24 installable) | ✅ | ✅ | ✅ | ✅ route (NO_HOST=0) | ⏳ | ✅ |
| Furniture (TOP priority) | ✅ | ✅ | ✅ (7/7) | ✅ real-fixture | ⏳ VQ | ✅ |
| Columns | ✅ extract | ✅ | ✅ (13/13) | ✅ real-fixture | ⏳ | ✅ |
| Curved walls (negative gate) | ✅ gate | ✅ | ✅ | ✅ (0 accepted CODE_06) | ⏳ | ✅ |
| Pascal schema contract | ✅ | ✅ | ✅ (6/6) | ✅ real `@pascal-app/core` | ⏳ | ✅ |
| Feature flags | ✅ | ✅ | ✅ (7/7) | — | ⏳ | ✅ |

## 10. Gotchas for the next agent
1. **FROZEN:** `mupdf-pure.ts`, `mupdf-pure-windows.ts`, root `package.json`, wall/window baselines.
2. Single-pass invariant (open PDF once).
3. **Never `pnpm run build` while `next dev` runs** (port 3003).
4. Door count 25 accepted (FP=0, NO_HOST=0, AMBIGUOUS_HOST=0); 24 automatically
   installable, 1 door audit reference under review; hinge is host witness;
   annotations assist, never select (no annotation-only DoorNodes).
5. **Regenerate `secondary-fixture.json` before columns/furniture real-fixture tests** (it is gitignored).
6. `wall-completion.test.ts` runs under `node:test`/`tsx --test`, NOT vitest (config scope).
7. Furniture GLBs in `public/items/` are REQUIRED (local assets).
8. `apps/editor` is GONE — do not re-add; its docs are historical only.
9. Dev server port 3003; kill stale `next dev` by port before starting.
