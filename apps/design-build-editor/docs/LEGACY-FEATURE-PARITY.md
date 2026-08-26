# Legacy Feature-Parity Ledger — Change Set 2

**App:** `apps/design-build-editor` (clean rebuild) · **Legacy:** `apps/editor` (FROZEN)
**Change Set:** 2 — Live Pure MuPDF Migration with Exact Parity
**Date:** 2026-07-28
**Status of this file:** documentation only during Change Set 2. Nothing may become
`LEGACY_RETIRED` until parity passes and rollback evidence exists.

## Status vocabulary

`NOT_INVENTORIED` · `PRESERVED` · `GOLDEN_CAPTURED` · `WRAPPED` · `MIGRATED` ·
`PARITY_PASSED` · `ACTIVATED` · `LEGACY_RETIRED`

Legend per row:
- `migrationStatus`: where the code lives now
- `parityStatus`: whether the clean equivalent reproduces the legacy behavior

---

## Ledger

### F-01 · Pure MuPDF wall extraction
- featureName: Pure MuPDF (authoritative physical-wall network)
- legacyEntryPoint: `apps/editor/src/lib/fusion/mupdf-wall/mupdf-pure.ts` → `extractPureWallResult`
- sourceFiles: `mupdf-pure.ts`, `vector-device.ts`, `geometry.ts`
- activeCallers: `apps/editor/src/lib/fusion/route.ts` (geometryOnly), verification scripts
- API routes: `apps/editor/app/api/fusion/route.ts` (legacy — NOT reused)
- dependencies: `mupdf`, node crypto
- environmentVariables: none
- inputs: PDF `Uint8Array`, pageNumber
- outputs: `MuPdfPureResult` (accepted/review/rejected walls, ROI, scale, provenance, hashes)
- sideEffects: none (pure function)
- goldenFixture: `apps/design-build-editor/tests/fixtures/code06-pure-mupdf-golden.json`
- cleanDestination: `packages/extraction-mupdf`
- migrationStatus: MIGRATED → WRAPPED → PARITY_PASSED → ACTIVATED
- parityStatus: ACTIVATED (2026-07-28)
- rollbackPath: legacy source untouched at `apps/editor/.../mupdf-wall/`; frozen fixture `frozen-code06-walls.json` remains as dev-only rollback (`GEOMETRIC_EXTRACTION_PROVIDER='frozen-code06'`, gated to NODE_ENV!=='production')
- verifiedEvidence:
  - PDF sha256 identical in golden + live: `4559ff86…`; extractor/vector-device/geometry sha256 byte-identical (geometry relocated only import path).
  - Field-by-field diff: `total diffs = 0` (70 walls, identical centerline/thickness/confidence).
  - Canonical geometry hash (canonical-hash.ts, fixed serializer): live `8c825b31b7758856` == frozen `8c825b31b7758856`.
  - Canonical evidence hash: live `8c2491f14db76203` == frozen `8c2491f14db76203` (distinct from geometry hash; payloads archived in `code06-canonical-payloads.json`).
  - Pre-Pascal parity: accepted 70/70, missing 0, unexpected 0, scale 17.5036 (both), ROI identical.
  - Live draft integrity (`prepareLiveDrafts`): 75 scene nodes, 70 wall nodes, 70 distinct physical IDs, 0 parent/child errors, 0 dup children, scene-tree validation OK.
  - API boundary `/api/extraction/mupdf` returns 70 walls / 1 slab / 200 review (total 749, truncated) / 277 rejectedItems from real CODE_06.pdf (HTTP 200, prod).
  - `npm run verify:mupdf-pure`: 20/20 tests pass; pkg tsc + app tsc + `next build` all exit 0.
  - ACTIVATION EVIDENCE (2026-07-28, prod build `17-BYS9tu9KHUm6POalcD`, port 3003, visible UI only — no console-hook start):
    - Attach via real `<input type=file>` → chip `CODE_06.pdf · application/pdf · 3.48 MB · primary drawing` → Extract enabled → clicked visible Extract button.
    - Provider `live-mupdf`; API status 200; progressive Pascal build committed.
    - Final in-browser diagnostic: sceneNodes 75, wallNodes 70, distinctPhysicalWallIds 70, duplicateWallIds 0, dirtyNodes 0, sceneTreeIssues 0, unreachableNodes [], completion card "Extracted with Pure MuPDF", dockbar "Project ready".
    - Vision-audited screenshots: `docs/evidence/activation/landing-chatbox.png`, `attach-chip-extract-enabled.png`, `live-mupdf-build-complete-framed.png` (framed 70-wall building + BUILD COMPLETE card + LIVE PROJECT BUILD rail 70/70 validated).

### F-02 · Gemini Multipass
- featureName: Gemini multimodal multipass extraction
- legacyEntryPoint: `apps/editor/src/lib/orchestration/gemini-pipeline.ts` + `apps/editor/src/app/api/extract/route.ts` + ChatBox `runBimPipeline`
- cleanDestination: `packages/design-build-extraction-ai` + `/api/extraction/ai`
- migrationStatus: see CS3 AI feature table below
- parityStatus: per-feature (below)
- rollbackPath: legacy untouched; clean flag `AI_EXTRACTION_PROVIDER='disabled'|'clean-gemini'` (default `disabled` until parity)

### F-03 · AI provider/model management
- featureName: Provider registry + model selection
- legacyEntryPoint: `packages/provider-registry`, `apps/editor/src/components/ChatBox.tsx`
- migrationStatus: NOT_INVENTORIED (deferred)
- parityStatus: N/A

### F-04 · PNG/JPEG AI extraction
- featureName: Raster image → AI extraction (future Gemini path)
- legacyEntryPoint: `apps/editor/src/lib/orchestration/gemini-pipeline.ts`
- migrationStatus: NOT_INVENTORIED (future; PNG/JPEG assignment stays with Gemini)
- parityStatus: N/A
- Note: Pure MuPDF supports PDF only. Selecting Geometric with PNG/JPEG shows a validation message (§8).

### F-05 · Nano Banana rendering
- featureName: Photorealistic render generation
- migrationStatus: NOT_INVENTORIED (deferred)
- parityStatus: N/A

### F-06 · Viewport capture
- featureName: Screenshot / viewport context
- legacyEntryPoint: `apps/editor/src/lib/.../viewport-capture*`
- migrationStatus: NOT_INVENTORIED (deferred)
- parityStatus: N/A

### F-07 · Camera context
- featureName: Camera framing context bridge
- legacyEntryPoint: `apps/editor/src/lib/fusion/...` viewer bridge (superseded by clean app's `camera-framing-service.ts`)
- cleanDestination: `apps/design-build-editor/src/features/viewer-interaction/camera-framing-service.ts` (already ACTIVATED in CS1)
- migrationStatus: PRESERVED (clean equivalent exists, accepted)
- parityStatus: PARITY_PASSED (camera framing verified applied in CS1/prod)

### F-08 · Attachment/reference management
- featureName: Attachment gallery + reference management
- legacyEntryPoint: `apps/editor/src/components/...` AttachmentGallery
- cleanDestination: `design-build-attachment-service` + `apps/design-build-editor/src/features/conversation/AttachmentGallery`
- migrationStatus: WRAPPED (clean package exists)
- parityStatus: PENDING audit (not in CS2 acceptance gate)

### F-09 · BOQ export
- featureName: Bill-of-Quantities export
- migrationStatus: NOT_INVENTORIED (deferred — exports not in CS2)
- parityStatus: N/A

### F-10 · Mood-board export
- migrationStatus: NOT_INVENTORIED (deferred)
- parityStatus: N/A

### F-11 · Presentation export
- migrationStatus: NOT_INVENTORIED (deferred)
- parityStatus: N/A

### F-12 · Drawings export
- migrationStatus: NOT_INVENTORIED (deferred)
- parityStatus: N/A

### F-13 · Scene JSON
- migrationStatus: NOT_INVENTORIED (deferred — presentation only)
- parityStatus: N/A

### F-14 · Complete-project package
- migrationStatus: NOT_INVENTORIED (deferred)
- parityStatus: N/A

### F-15 · Guide renderer
- featureName: Full-page PDF guide underlay
- legacyEntryPoint: `apps/editor/src/lib/.../guide-renderer`
- cleanDestination: `design-build-coordinate-frame` (`guidePlaneTransform`) + clean app guide node
- migrationStatus: WRAPPED (clean coordinate frame provides the guide transform)
- parityStatus: PARITY_PASSED (guide alignment verified in CS1; reused unchanged in CS2)

### F-16 · Progressive construction
- featureName: Staged progressive import (slab → walls → checks)
- legacyEntryPoint: `apps/editor/src/lib/fusion/fusion-commit.ts` staged commit
- cleanDestination: `apps/design-build-editor/src/harness/code06-staged-import.ts` (reused for live result)
- migrationStatus: WRAPPED (clean staged runner reused)
- parityStatus: PARITY_PASSED (same runner, same 75/70/70/0/0/0 gate)

### F-17 · Windows
- migrationStatus: NOT_INVENTORIED (deferred — not in CS2)
- parityStatus: N/A

### F-18 · Doors
- migrationStatus: NOT_INVENTORIED (deferred — not in CS2)
- parityStatus: N/A

### F-19 · Furniture and FF&E
- migrationStatus: NOT_INVENTORIED (deferred — not in CS2)
- parityStatus: N/A

---

## Migration gate summary (this change set)

| Feature | In CS2 scope | Migration status |
|---------|--------------|------------------|
| Pure MuPDF (F-01) | YES | WRAPPED → PARITY_PASSED (target) |
| Guide renderer (F-15) | reused | PARITY_PASSED |
| Progressive construction (F-16) | reused | PARITY_PASSED |
| Camera context (F-07) | reused | PARITY_PASSED |
| Gemini / Nano Banana / exports / windows / doors / FF&E | NO | NOT_INVENTORIED (deferred) |

No legacy source is modified during CS2. The frozen import (`frozen-code06-walls.json`)
remains available as a development/regression fallback behind the
`GEOMETRIC_EXTRACTION_PROVIDER` flag (`frozen-code06` | `live-mupdf`).

---

## CS3 — AI pipeline feature ledger

Call graph: `docs/AI-LEGACY-CALL-GRAPH.md` · Freeze: `docs/AI-LEGACY-FREEZE-MANIFEST.json` (27 files, SHA-256).
Statuses: NOT_INVENTORIED · PRESERVED · GOLDEN_CAPTURED · WRAPPED · MIGRATED · PARITY_PASSED · ACTIVATED · BLOCKED · LEGACY_RETIRED.
Rule: nothing is ACTIVATED until the visible clean browser workflow passes; nothing LEGACY_RETIRED until parity + activation + rollback evidence.

| Feature | Legacy source | Migration | Clean status | Notes |
|---|---|---|---|---|
| AI_PROVIDER_ADD | ModelSelector.tsx | WRAPPED | MIGRATED | API `POST /api/providers` + visible Add Provider dialog built; backend CRUD live-verified; visible submit PENDING_VISIBLE |
| AI_PROVIDER_EDIT | ModelSelector.tsx | WRAPPED | MIGRATED | `PUT /api/providers/[id]`; metadata edit without re-keying verified (API + test) |
| AI_PROVIDER_REMOVE | ModelSelector.tsx | WRAPPED | MIGRATED | `DELETE /api/providers/[id]`; dangling active selection cleared (verified) |
| AI_PROVIDER_TEST | /api/models POST | WRAPPED | MIGRATED | `POST /api/providers/test` server-side; key never returned (verified) |
| AI_PROVIDER_PERSIST | localStorage `pascal_ai_providers_v2` | WRAPPED | MIGRATED (security change) | Secrets server-side only; LOCAL_DEVELOPMENT_FILE_STORE; legacy localStorage raw-key pattern removed (EXPECTED_SECURITY_CHANGE) |
| AI_CHAT_MODEL_SELECTION | ModelSelector `ActiveModel` | WRAPPED | MIGRATED | Independent chat slot; isolation verified |
| AI_EXTRACTION_MODEL_SELECTION | ModelSelector `ActiveModel` | WRAPPED | MIGRATED | Independent extraction slot; restore-after-reload verified |
| AI_RENDER_MODEL_SELECTION | RenderConfigSelector | WRAPPED | MIGRATED | Render slot reserved; CS4 wiring |
| AI_PDF_UPLOAD | ChatBox addFiles + pdf-to-image.ts | WRAPPED | ACTIVATED | Visible PDF attach → real Gemini multipass → 17 walls (verified live) |
| AI_PNG_UPLOAD | ChatBox addFiles | WRAPPED | MIGRATED | API accepts PNG; server passes bytes to model; visible end-to-end run not exercised |
| AI_JPEG_UPLOAD | ChatBox addFiles | WRAPPED | MIGRATED | API accepts JPEG; visible end-to-end run not exercised |
| AI_MULTI_ATTACHMENT | ChatBox referenceImages[] | WRAPPED | MIGRATED | attachment-service supports multiple refs |
| AI_PRIMARY_DRAWING | first checked attachment | WRAPPED | ACTIVATED | images[0] is extraction subject (verified via live run) |
| AI_REFERENCE_SELECTION | checked flags | WRAPPED | MIGRATED | only primary sent to multipass (matches legacy) |
| AI_REFERENCE_ENABLE_DISABLE | toggleImage | WRAPPED | MIGRATED | attachment enable/disable wired |
| AI_REFERENCE_ORDER | array order | WRAPPED | MIGRATED | attachment order preserved |
| AI_PDF_PAGE_PREPARATION | pdf-to-image.ts (pdfjs) | WRAPPED | ACTIVATED | server-side MuPDF page-1 render replaces pdfjs (EXPECTED_ADAPTER_CHANGE; payload equivalent) |
| GEMINI_MULTIPASS_PDF | runBimPipeline (via PDF→PNG) | WRAPPED | ACTIVATED | real 4-pass Gemini run produced neutral result (verified live) |
| GEMINI_MULTIPASS_IMAGE | runBimPipeline + /api/extract | WRAPPED | MIGRATED | 4-pass shell‖core→fitout‖ffe; PNG/JPEG path code-built, PDF path verified |
| AI_PASS_PROGRESS | INITIAL_PHASES chips | WRAPPED | ACTIVATED | BuildProgressRail committed/total driven by frozen event log (17/17) |
| AI_PROVIDER_RETRY | — | PRESERVED | MIGRATED | legacy no-auto-retry preserved; retry-policy module defaults to legacy behavior |
| AI_RATE_LIMIT_RECOVERY | — | PRESERVED | MIGRATED | surfaced as error only (preserved) |
| AI_TIMEOUT_RECOVERY | — | WRAPPED | MIGRATED | typed timeout error added (EXPECTED_ADAPTER_CHANGE) |
| AI_CANCELLATION | — | WRAPPED | MIGRATED | AbortController added (EXPECTED_ADAPTER_CHANGE) |
| AI_PARTIAL_RECOVERY | Promise.allSettled fitout/ffe | WRAPPED | MIGRATED | shell/fitout/ffe failures tolerated; core required |
| AI_RESPONSE_PARSING | parseAIResponse | WRAPPED | PARITY_PASSED | control-char strip → brace extraction → block scan (8 parity tests) |
| AI_JSON_REPAIR | parseAIResponse | WRAPPED | PARITY_PASSED | trailing-comma/key-quoting; legacy fusion json-repair is dead path |
| AI_RESULT_VALIDATION | Zod StructuralSchema | WRAPPED | PARITY_PASSED | neutral result validates |
| AI_RESULT_RECONCILIATION | cumulativeWallsRef wallsContext | WRAPPED | MIGRATED | walls context feeds fitout/ffe prompts |
| AI_RESULT_MERGE | per-phase mergePartialScene | WRAPPED | PARITY_PASSED | replaced with neutral-result staging (legacy bridge forbidden; dependency-boundary test enforces) |
| AI_TO_NEUTRAL_RESULT | — (new) | WRAPPED | ACTIVATED | StructuralSchema → BuildingExtractionResult adapter in extraction-ai |
| AI_TO_PASCAL_BUILD | ai-to-scene-bridge (legacy) | WRAPPED | ACTIVATED | clean CS2 progressive adapter reused; 17 walls committed |
| AI_STAGE_ROLLBACK | — | WRAPPED | MIGRATED | stage rollback per §17 (EXPECTED_ADAPTER_CHANGE) |
| AI_PROJECT_CONTEXT | ChatOrchestrator context | WRAPPED | MIGRATED | context fields inventoried |
| AI_SELECTED_NODE_CONTEXT | ChatOrchestrator Pathway B | WRAPPED | MIGRATED | CS4-facing; inventoried |
| AI_CAMERA_CONTEXT | ChatOrchestrator snapshot | WRAPPED | MIGRATED | camera context inventoried |
| AI_CONVERSATION | /api/chat + SYSTEM_PROMPT | WRAPPED | MIGRATED | chat command/event bridge wired (event-subscriber pattern) |
| AI_RESULT_PERSISTENCE | — | WRAPPED | MIGRATED | last result stored in run record (server-side) |
| AI_BOQ_METADATA | export-suite.ts | PRESERVED | NOT_STARTED | CS5+ (exports out of scope) |
| AI_FFE_METADATA | ffe pass output | WRAPPED | DEFERRED_FOR_FFE_RESOLUTION | 16 furniture records preserved in neutral result; NOT mapped to Pascal ItemNodes |
| AI_MATERIAL_METADATA | MATERIALS + wall/floor | WRAPPED | MIGRATED | material fields preserved in neutral result |
| AI_EXPORT_METADATA | projectInfo | PRESERVED | NOT_STARTED | CS5+ (exports out of scope) |
| AI_RENDER_DESCRIPTION_DATA | PromptCompiler render_spec | PRESERVED | NOT_STARTED | Nano Banana deferred |

> **Status vocabulary reused:** PRESERVED (legacy inventory only) · WRAPPED (clean equivalent exists) · MIGRATED (backend/logic verified; visible submission pending where noted) · PARITY_PASSED · ACTIVATED (visible clean browser workflow verified) · DEFERRED_FOR_FFE_RESOLUTION · NOT_STARTED.
>
> **Pending visible verification:** Provider ADD/EDIT/REMOVE/TEST and the chat/extraction/render selection UI were built and the API + selection-isolation/persistence were verified by executable tests and live API calls, but the **visible browser submit flow** could not be exercised in this environment (headless attach flakiness). Per the closeout rule, these are marked MIGRATED, not ACTIVATED, until the visible UI flow passes (see §6 / §9). Change Set 3 overall = `IMPLEMENTATION_COMPLETE_PENDING_VISIBLE_PROVIDER_UI_VERIFICATION`.
