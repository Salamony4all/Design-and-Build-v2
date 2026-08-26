# AI Legacy Call Graph — Change Set 3

Date: 2026-07-28 · Legacy source: `apps/editor` (READ-ONLY) · All SHA-256 recorded in
`docs/AI-LEGACY-FREEZE-MANIFEST.json`. Env-var **names only** — never values.

## 0. Executive summary of runtime reachability

The legacy app exposes **one active AI extraction pipeline** and **one dead one**:

1. **ACTIVE — Gemini Multipass ("AI" / "precision" extract mode)**
   `ChatBox.sendMessage` → `runBimPipeline(images, prompt)` → 4 × `POST /api/extract`
   (phases `shell` ‖ `core`, then `fitout` ‖ `ffe` with `wallsContext`) →
   `gemini-pipeline.ts` (`getShellPrompt/getCorePrompt/getFitoutPrompt/getFFEPrompt`
   + `executePass` (Google GenAI SDK) or `executePassOpenAI` (OpenAI-compatible
   vision) + `parseAIResponse` (JSON extraction/repair/Zod validation)) →
   per-phase `mergePartialScene(data, phase, guideUrl, cumulativeWalls)`
   (legacy scene bridge — FORBIDDEN in clean production).
   - Input: first checked **image** attachment (base64 + mimeType). PDFs are first
     rendered to PNG via `renderPdfToPngDataUrl` in other paths; `runBimPipeline`
     itself is routed only when `checkedImageFiles.length > 0`.
   - Model routing: `GOOGLE_MODEL_MAP` friendly-name mapping; Google if no/googleapis
     baseUrl, else OpenAI-compatible `/chat/completions` with `image_url` data URL.
   - Key fallback: user key from ModelSelector → `process.env.GEMINI_API_KEY`.

2. **DEAD — Fusion T1→T2→T3 ("test" extract mode)**
   `runFusionImport` → `POST /api/fusion` without `geometryOnly` → **HTTP 501**
   ("Full-AI extraction requires pdf2json (removed)"). The only living branch of
   `/api/fusion` is `geometryOnly` = Pure MuPDF (already migrated in CS2).
   → `verify-t2.ts`, `verify-t3.ts`, `vision-discriminator.ts`,
   `use-fusion-progressive-import.ts`, `fusion-commit.ts`, `fused-topology.ts`
   (AI portions), `geometric-filter.ts` are **HISTORICAL_EXPERIMENT** at runtime.

3. **ACTIVE — Freeform chat** — `runFreeformChat` → `POST /api/chat` →
   Google GenAI (`SYSTEM_PROMPT` "You are Pascal…") or OpenAI-compatible.

4. **ACTIVE — Render orchestrator (NOT migrated in CS3)** — `runOrchestrator` →
   `ChatOrchestrator.orchestrateMessage` (intent classify → PromptCompiler → capture
   viewport → `/api/render` Nano Banana). Inventoried for §23 only.

5. **ACTIVE — Provider/model management** — `ModelSelector.tsx` (extraction/chat
   selection, localStorage `pascal_ai_providers_v2`/`pascal_ai_active_v2`,
   `POST /api/models` discovery) and `RenderConfigSelector.tsx` (render selection —
   separate, per legacy design). Plus a second, chat-dock-only store
   `integrations/ai/providers.ts` (`db14.providers.v1`, client-side `listModels`).

## 1. Entry points

| Entry point | File | Trigger | Pipeline |
|---|---|---|---|
| ChatBox Send | `apps/editor/src/components/ChatBox.tsx` (`sendMessage`, L309) | user presses send | routes by `extractMode` + attachment kind |
| AI extract (multipass) | same (`runBimPipeline`, L1225) | `extractMode==='ai'|'precision'` + checked images | Gemini Multipass |
| Fusion AI | same (`runFusionImport`, L793) | `extractMode==='test'` | DEAD (501) |
| Freeform chat | same (`runFreeformChat`, L1301) | no files | /api/chat |
| Render mode | same (`runOrchestrator`, L1180) | `renderModeActive` | ChatOrchestrator → /api/render |
| Attachment upload | same (`addFiles`, L246; `handleFileChange`; `handleDrop`; hidden `<input accept="image/*,application/pdf" multiple>`, L1756) | click 📎 / drag-drop | ReferenceImage[] (Base64 in React state) |
| Provider selector | `ModelSelector.tsx` | header UI | localStorage CRUD + /api/models |
| Render provider selector | `RenderConfigSelector.tsx` | header UI | localStorage CRUD |
| Legacy standalone panel | `UploadPanel.tsx` | separate demo page | 4-phase multipass duplicate (image-only) |

## 2. Module inventory

Classification is by **runtime reachability**. `cleanDestination` = where the behavior
lands in the clean app (CS3 scope) or `N/A (CSx)` when deferred.

### CORE_AI / PROMPT / PASS_ORCHESTRATION / RESPONSE_PARSER / JSON_REPAIR / VALIDATOR

| Module | sha256 (16) | LOC | Purpose | Classification | Clean destination |
|---|---|---|---|---|---|
| `lib/orchestration/gemini-pipeline.ts` | `c588b7969eeaa702` | 289 | 4 prompts (shell/core/fitout/ffe), `BASE_RULES` + `CATALOG_SLUGS` (139) + `MATERIALS` (10), `StructuralSchema` (Zod), `parseAIResponse` (control-char strip → brace extraction → bullet/key repair → block scan → JSON.parse → trailing-comma repair → `new Function` eval fallback → Zod), `executePass` (Google GenAI `generateContent`, default `gemini-2.0-flash`), `executePassOpenAI` (`/chat/completions`, `image_url` data URL, `max_tokens: 4096`) | CORE_AI + PROMPT + RESPONSE_PARSER + JSON_REPAIR + VALIDATOR | `packages/design-build-extraction-ai/src/{prompts,parsers,validation,providers}` |
| `app/api/extract/route.ts` | `d63b7c3b3eea6a0a` | 89 | Phase-routed API: `GOOGLE_MODEL_MAP`, user key precedence over `GEMINI_API_KEY`, google-vs-openai base URL detection | REQUEST_BUILDER + PASS_ORCHESTRATION (server half) | `apps/design-build-editor/src/app/api/extraction/ai/route.ts` |
| ChatBox `runBimPipeline` (L1225–1297) | (in ChatBox hash) | ~72 | Client orchestration: 4 passes, shell‖core then fitout‖ffe with `wallsContext` accumulation, per-phase status chips, per-phase immediate `mergePartialScene` | PASS_ORCHESTRATION (client half) + PROGRESS | `packages/design-build-extraction-ai/src/orchestration/multipass-controller.ts` (server-side) |

Pass sequence (authoritative):
```
Promise.all([ shell (failure tolerated), core (required) ])
→ cumulativeWalls += core.walls
→ Promise.allSettled([ fitout(wallsContext), ffe(wallsContext) ])
```
Model params: **no temperature set** for Google path (SDK default); OpenAI path:
`max_tokens: 4096`, no temperature. Response format: raw text → `parseAIResponse`.

### PROVIDER_CONFIG / MODEL_SELECTION

| Module | sha256 (16) | LOC | Purpose | Classification | Clean destination |
|---|---|---|---|---|---|
| `components/ModelSelector.tsx` | `1015f8a48f92222b` | 493 | Provider CRUD UI (name/apiKey/baseUrl), model discovery via `POST /api/models`, active model persist (`pascal_ai_providers_v2`, `pascal_ai_active_v2`), google/openai type detection | PROVIDER_CONFIG + MODEL_SELECTION | `packages/design-build-provider-registry` + clean UI |
| `app/api/models/route.ts` | `4551507c5f7292aa` | 70 | Model discovery: Google `?key=` list w/ `generateContent` filter; OpenAI `/models` Bearer | PROVIDER_CONFIG | `/api/providers/models` (clean) |
| `integrations/ai/providers.ts` | `31474a584c10194505` | 55 | Chat-dock provider store (`db14.providers.v1`), 5-min in-memory model cache | PROVIDER_CONFIG (secondary store) | consolidated into provider-registry |
| `integrations/ai/llm-client.ts` | `6deadd11ae7b8f63` | 109 | OpenAI-compatible client: `authHeader` (x-goog-api-key for Gemini, Bearer otherwise), `listModels`, `streamChat` (SSE), `complete` | PROVIDER_CONFIG + CONVERSATION | provider-registry transport + conversation service |
| `components/RenderConfigSelector.tsx` | `2f8243dd38b5410101` | 302 | SEPARATE render provider/model selection (strength/guidance) | MODEL_SELECTION (render) | inventoried; migration in CS4 |

**SECURITY NOTE (legacy reality, to be corrected per §11):** legacy stores raw API
keys in `localStorage` and passes them browser→server per request (`apiKey` in POST
body). Clean design keeps credentials server-side (documented intentional change:
`EXPECTED_SECURITY_CHANGE`).

### ATTACHMENT

| Module | sha256 (16) | LOC | Purpose | Classification | Clean destination |
|---|---|---|---|---|---|
| ChatBox attachment block (L146–298, 1756) | (in ChatBox hash) | ~150 | `ReferenceImage {id,name,dataUrl,base64,mimeType,checked,kind,file}`; `addFiles` filter (image/* or PDF); FileReader → Base64 **duplicated in React state**; checked toggle = reference enable/disable; first checked = primary; drag-drop; hidden multi input | ATTACHMENT | clean `attachment-repository.ts` (CS2) + extensions: multi-reference, enable/disable, image support for AI |
| `lib/parse/pdf-to-image.ts` | `dc6a01031f4e4ba1` | 33 | pdfjs render page→PNG data URL (used to feed PDFs to image-only AI paths) | ATTACHMENT (PDF page preparation) | `packages/design-build-extraction-ai/src/requests/pdf-page-image.ts` (server-side MuPDF render instead of pdfjs — documented adapter change) |
| `components/UploadPanel.tsx` | `188d78a57deb65a3` | 382 | Standalone image-only upload + 4-phase runner (duplicate of runBimPipeline) | HISTORICAL_EXPERIMENT (not the ChatBox flow) | not migrated; behavior covered by multipass controller |

### LEGACY_SCENE_BRIDGE / GEOMETRY_ADAPTER (FORBIDDEN in clean runtime)

| Module | sha256 (16) | LOC | Purpose | Classification |
|---|---|---|---|---|
| `lib/scene/ai-to-scene-bridge.ts` | `3a46238ad9f8ad0e` | 843 | `convertAiToSceneGraph` + `mergePartialScene`: site/building/level scaffold, guide plane, meters-domain `transformPoints`, per-phase merge into legacy `useScene` | LEGACY_SCENE_BRIDGE — replaced by neutral `BuildingExtractionResult` → CS2 `prepareLiveDrafts`-style clean adapter |
| `integrations/pascal/scene-builder.ts` | `75c97bcc1d711b14` | 276 | legacy progressive scene builder | LEGACY_SCENE_BRIDGE |
| `hooks/use-pascal-progressive-import.ts` | `02570f6cfab38ab3` | 86 | legacy progressive import hook | LEGACY_VIEWER_COUPLING |
| `hooks/use-fusion-progressive-import.ts` | `df69afd2c3791ea9` | 334 | fusion staged import hook | LEGACY_VIEWER_COUPLING (dead path) |

**Coordinate frame emitted by legacy AI result (§15):** prompts demand
`(0,0) = bottom-left, absolute meters` → same axis convention as the neutral document
frame used by Pure MuPDF (Pascal Z grows with plan "up"). The legacy bridge applied
`transformPoints` (identity in meters domain + optional guide alignment). Clean
adapter converts **once**: AI meters `[x, z]` → neutral frame; NO ai-specific mirror/
crop/offset (the AI result is already in world meters, unlike PDF points in MuPDF).

### CONVERSATION / PROJECT_CONTEXT

| Module | sha256 (16) | LOC | Purpose | Classification | Clean destination |
|---|---|---|---|---|---|
| `app/api/chat/route.ts` | `e96dd274d64dc48a` | 76 | Freeform chat: `SYSTEM_PROMPT` ("You are Pascal…"), Google GenAI or OpenAI-compat, `max_tokens: 1024` | CONVERSATION | clean conversation service (typed commands; ChatPanel stays event-subscriber) |
| `lib/orchestration/ChatOrchestrator.ts` | `32353ebf2ea8d06d` | 528 | Intent classify (aesthetic/structural/freeform), scene mutation via render_spec, snapshot capture, Nano Banana proxy | CONVERSATION + NANO_BANANA_DEPENDENCY | context builder migrates; render pathways deferred to CS4 |
| `lib/orchestration/PromptCompiler.ts` | `1736bd582c1b7f35` | 153 | Scene → photoreal prompt (render_spec fields: material_finish, surface_treatment, color_palette, cladding_system, shading_device, floor_finish, spec_brand, ceiling_finish, trim_profile, lighting_type; zone names) | NANO_BANANA_DEPENDENCY | inventoried in NANO-BANANA doc; CS4 |

### EXPORT_DEPENDENCY / NANO_BANANA_DEPENDENCY (inventoried only)

| Module | sha256 (16) | LOC | Classification |
|---|---|---|---|
| `integrations/export/export-suite.ts` | `d84f9d6d828d382f` | 59 | EXPORT_DEPENDENCY (consumes scene JSON; CS5+) |
| `integrations/ai/image-gen.ts` | `3bcefd3ecd35562e` | 69 | NANO_BANANA_DEPENDENCY (`generateImage` /images/generations, `buildPhotorealPrompt`, `captureViewport`) |
| `app/api/render/route.ts` | `17c92ee97abf8749` | 226 | NANO_BANANA_DEPENDENCY (render proxy; CS4) |

### HISTORICAL_EXPERIMENT / SAFE_TO_ARCHIVE (dead at runtime)

| Module | sha256 (16) | LOC | Why dead |
|---|---|---|---|
| `app/api/fusion/route.ts` (non-geometryOnly branch) | `09a17746c124c1a7` | 185 | returns 501 (pdf2json removed); geometryOnly half already migrated in CS2 |
| `lib/fusion/verify-t2.ts` | `d9c096dd60c3525d` | 90 | T2 harness for dead fusion path |
| `lib/fusion/verify-t3.ts` | `1c40260a08fcd59f` | 69 | T3 harness for dead fusion path |
| `lib/fusion/vision-discriminator.ts` | `2f8ba5dad2f8173d` | 218 | fusion-only VLM discriminator |
| `lib/fusion/json-repair.ts` | `d4675be9e4092e1f` | 92 | fusion-only repair (multipass uses `parseAIResponse` internal repair, NOT this) |
| `lib/fusion/fusion-commit.ts` | `e69e6ae22e2a8cd5` | 212 | dead-path commit |
| `lib/fusion/fusion-types.ts` | `7af4a71411363acf` | 113 | dead-path types (T2 evidence schema) |

## 3. API endpoints (legacy)

| Route | Status | Purpose |
|---|---|---|
| `POST /api/extract` | ACTIVE | multipass phase execution (this CS) |
| `POST /api/chat` | ACTIVE | freeform chat (this CS, conversation service) |
| `POST /api/models` | ACTIVE | provider model discovery (this CS, provider registry) |
| `POST /api/render` | ACTIVE | Nano Banana proxy (CS4) |
| `POST /api/fusion` | geometryOnly ACTIVE (migrated CS2); AI branch DEAD 501 | — |
| `POST /api/pdf2json`, `/api/track2/*` | dead/aux experiments | not migrated |

## 4. Environment variable NAMES (values never recorded)

`GEMINI_API_KEY` (extract/chat key fallback), `FUSION_MODEL`, `FUSION_MODEL_FALLBACK`
(dead fusion path), `COMFYUI_API_URL` (render experiments), `BED_DEBUG`,
`NEXT_PUBLIC_GUIDE_TRACE` (non-AI). No `.env*` files exist under `apps/editor/`.

## 5. State flags (per module record)

- `writesSceneState`: ai-to-scene-bridge, scene-builder, hooks, ChatBox (via bridge) — all LEGACY, excluded from clean runtime.
- `readsViewerState/readsCameraState`: ChatOrchestrator (snapshot/camera), image-gen `captureViewport`.
- `readsSelection`: ChatOrchestrator (Pathway B).
- `readsAttachments`: ChatBox, UploadPanel, pdf-to-image.
- `readsProviderSecrets`: ModelSelector, providers.ts, llm-client, api/extract, api/chat, api/models, api/render (all via user-supplied key or `GEMINI_API_KEY`).

## 6. Independent model selections (legacy §3B)

- Conversation + extraction: `ModelSelector` `ActiveModel` (SHARED in legacy — both /api/chat and /api/extract use the same `activeModel`).
- Render: `RenderConfigSelector` `ActiveRenderProvider` (separate storage keys).
→ Clean registry keeps **three** independent selections (chat, extraction, render);
legacy's chat/extract sharing is preserved as identical *defaults* but the registry
stores them separately (documented EXPECTED_ADAPTER_CHANGE, no behavior loss).
