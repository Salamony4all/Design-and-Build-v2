# Design & Build Editor — Complete Architectural & File-by-File Analysis

> **Handoff Document for Engineering Agents**  
> *Generated from an exhaustive file-by-file source inspection across the entire codebase.*

---

## 1. Executive Summary & Core Invariants

The `design-build-editor` application is an enterprise architectural CAD and generative AI editor built on Next.js (App Router), React 19, Three.js / React Three Fiber, and the `@pascal-app` 3D building modeling engine (v0.9.2).

### Fundamental Invariants
1. **Single Canvas Invariant (`activeCanvasCount === 1`)**:
   - The application mounts exactly one Three.js Canvas via `PascalViewerShell`.
   - The Canvas is **never unmounted, destroyed, or recreated** during mode switches (Standard $\leftrightarrow$ PRO Mode) or progressive stage rebuilds.
2. **Singleton Pascal Stores (`getPascalStores()`)**:
   - `useScene`, `useViewer`, and `sceneRegistry` are accessed through `getPascalStores()` from `design-build-simplified-viewer-shell` to ensure single-instance store sharing across webpack chunks.
3. **Dual Extraction Pipelines**:
   - **Geometric Mode (Pure MuPDF)**: Direct single-pass vector capture from architectural PDFs $\rightarrow$ wall extraction $\rightarrow$ wall completion $\rightarrow$ structural columns $\rightarrow$ door/window intervals $\rightarrow$ staged progressive commit.
   - **AI Mode (Gemini Multipass)**: Raster image/PDF $\rightarrow$ server-side Gemini vision API $\rightarrow$ `ExtractionResult` $\rightarrow$ `ProgressiveInstaller` $\rightarrow$ staged Level, Guide, Slab, Walls, Wall Map, Windows, Doors, Furniture installation $\rightarrow$ structural validation.
4. **Unified Coordinate Calibration (`BuildingFrameContract`)**:
   - Derived from the active architectural ROI (Region of Interest) of the plan, not the raw PDF sheet border/title block.
   - Guide planes, slab boundary polygons, wall centrelines, and structural columns share this exact world origin and scale.
5. **Wall-Local Opening Hierarchy**:
   - `WindowNode` and `DoorNode` elements are structural children of their host `WallNode` meshes and use wall-local coordinates (offset from Endpoint A along +X). They never inherit world coordinates directly to avoid double-transform drift.
6. **Credential & Data Isolation**:
   - API keys are typed in password fields, POSTed to `/api/providers`, stored server-side, and masked as `hasApiKey: boolean` on client GET requests.
   - Large file attachments are stored in an in-memory repository (`attachmentRepository`), keeping raw Base64 payloads out of React state trees.

---

## 2. Monorepo Configuration & Dependencies

### [`package.json`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/package.json)
- **Framework**: Next.js `15.5.22`, React `19.0.0`, React DOM `19.0.0`.
- **3D Engine**: Three.js `0.185.1`, `@react-three/fiber` `9.1.2`.
- **Pascal v0.9.2 Stack**: `@pascal-app/core`, `@pascal-app/viewer`, `@pascal-app/editor`, `@pascal-app/nodes`.
- **PDF & WASM**: `mupdf` `1.28.0`, `pdfjs-dist` `5.4.530`.
- **AI SDK**: `@google/genai` `1.0.0`.
- **Internal Workspace Packages**:
  - `design-build-conversation-core`: Chat commands, event contracts, attachment metadata.
  - `design-build-coordinate-frame`: PDF point $\leftrightarrow$ Pascal 3D meter coordinate transformations.
  - `design-build-pascal-adapter`: Scene tree validation, child/parent array manipulation (`replaceChildren`).
  - `design-build-extraction-contracts`: Type contracts for walls, slabs, windows, doors, furniture.
  - `design-build-extraction-ai`: Multipass Gemini extraction orchestration and furniture resolution.
  - `design-build-extraction-mupdf`: Pure MuPDF vector extraction and column/wall detection.
  - `design-build-geometric-extraction`: Window hypothesis detector (`AutomaticDetectorClean`).
  - `design-build-simplified-viewer-shell`: Shared Pascal stores export and Viewer wrapper.

### [`next.config.mjs`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/next.config.mjs)
- `serverExternalPackages: ['mupdf']`: Prevents Next.js bundler from attempting to compile top-level WASM await in client chunks.
- **Webpack Aliasing**: Forces `@pascal-app/core`, `@pascal-app/viewer`, `@pascal-app/editor`, `@pascal-app/nodes`, and `three` to resolve to exact localized paths in `node_modules` to prevent dual singleton instances caused by npm workspace hoisting.

### [`tsconfig.json`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/tsconfig.json)
- Configures path alias `@/*` $\rightarrow$ `./src/*`.

---

## 3. Application Routing & App Shell (`src/app/`)

### [`src/app/page.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/app/page.tsx)
- **Primary Orchestrator (2,967 lines)**:
  - **Canvas Mounting**: Mounts `PascalViewerShell` with `frameloop="never"`. State mutations trigger `invalidate()` / increment `sceneReadyTick` to run `useFrame` systems, drain `dirtyNodes`, and populate `sceneRegistry`.
  - **Framing Calculation (`computeFraming`, `collectBuildingBoxes`)**: Traverses `sceneRegistry` for structural meshes (slabs, walls, columns, items), computes cumulative AABB, and computes camera distance and orbit target.
  - **Polling & Readiness Guard (`pollImportCompletion`)**: Polls node counts and settlement criteria before marking builds ready.
  - **Import Execution**:
    - `startLiveImport`: Runs Pure MuPDF staged imports (`runStagedCode06Import`).
    - `runPascalSnapshotBuild`: Progressive staged installer for AI extraction.
  - **Overlay Management**: Injects `ProOverlay` over the running Canvas when PRO mode is active.

### [`src/app/globals.css`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/app/globals.css)
- Central design system: aurora blur effects, glassmorphic floating panels (`.glass`, `.db-dockbar`), landing cards (`.db-landing-card--upload`, `.db-landing-card--pro`), method pills, status chips, responsive toolbars.

### Specialized Routes
- [`src/app/harness/page.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/app/harness/page.tsx): Validates full capability scene rendering across all Pascal Zod schemas.
- [`src/app/harness/guide-free/page.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/app/harness/guide-free/page.tsx): Tests local image texture loading onto Guide planes without external network requests.
- [`src/app/harness/window-hypothesis-review/page.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/app/harness/window-hypothesis-review/page.tsx): Empirical Gate C window hypothesis evaluation tool.
- [`src/app/window-review/page.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/app/window-review/page.tsx) & [`src/app/window-review-r132/page.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/app/window-review-r132/page.tsx): Human blind validation and evidence inspection consoles.

---

## 4. API Endpoints (`src/app/api/`)

### [`src/app/api/extraction/ai/route.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/app/api/extraction/ai/route.ts)
- Resolves AI provider from registry (`loadRegistry`).
- Resolves credentials server-side (`__SERVER_RESOLVED_FROM_ENV__` / environment fallback).
- Rasterizes PDF pages via MuPDF when required.
- Orchestrates Gemini multimodal multipass vision calls.
- Emits structured `ExtractionResult` containing walls, slab, windows, doors, and furniture.

### [`src/app/api/extraction/mupdf/route.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/app/api/extraction/mupdf/route.ts)
- Executes single-pass vector capture (`extractPureWallResult`).
- Detects walls and completes missing junctions (`completeWalls`).
- Detects rectangular columns (`detectColumnsPure`).
- Maps opening intervals for doors and windows.

### [`src/app/api/providers/*`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/app/api/providers)
- `GET /api/providers`: Returns masked provider summaries (`hasApiKey: boolean`).
- `POST /api/providers`: Creates provider record with encrypted/server-stored key.
- `PUT /api/providers/[id]`: Updates provider metadata or key (omitting key retains existing).
- `DELETE /api/providers/[id]`: Removes provider.
- `POST /api/providers/select`: Selects active provider and model for `chat`, `extraction`, or `render`.
- `POST /api/providers/test`: Tests connection and dynamically fetches available models.

---

## 5. Feature Architecture Breakdown

### A. Conversation (`src/features/conversation/`)
- [`attachment-repository.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/conversation/attachment-repository.ts): Module-level `Map<string, File>` storage. Exposes `.put()`, `.get()`, `.remove()`, `.clear()`.
- [`Composer.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/conversation/Composer.tsx):
  - Landing UI: Two prominent cards ("Upload Plan" and "PRO Mode").
  - Docked UI: Compact prompt bar with attachment chips and send button.
- [`ChatPanel.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/conversation/ChatPanel.tsx): Chat coordinator rendering events, progress, error notices, and action dispatchers.
- [`ProviderSelector.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/conversation/ProviderSelector.tsx): Modal settings panel with CRUD operations, connection testing, and slot selection.
- [`MessageBubble.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/conversation/MessageBubble.tsx), [`MessageList.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/conversation/MessageList.tsx), [`AttachmentGallery.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/conversation/AttachmentGallery.tsx): Chat list, bubble rendering, and attachment chips.

### B. AI Extraction Controls (`src/features/ai-extraction/`)
- [`index.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/ai-extraction/index.ts): Feature entry point.
- [`components/AiExtractionControls.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/ai-extraction/components/AiExtractionControls.tsx): Compact composer control with provider glyph, dynamic model `<select>`, and status dot.
- [`provider-runtime/api.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/ai-extraction/provider-runtime/api.ts): Thin HTTP client calling `/api/providers`.
- [`provider-runtime/types.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/ai-extraction/provider-runtime/types.ts): Data types for provider views and selection requests.
- [`provider-runtime/use-ai-provider-registry.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/ai-extraction/provider-runtime/use-ai-provider-registry.ts): Hook managing provider fetch, selection persistence, and pure readiness evaluation (`deriveAiExtractionReadiness`).

### C. Progressive Build (`src/features/progressive-build/`)
- [`ProgressiveBuildV3.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/progressive-build/ProgressiveBuildV3.tsx): Side rail displaying live stage progress across `guide`, `slab`, `walls`, `windows`, `doors`, `furniture`, `wallMap`, and `structural`. Contains pure state reducers `applyGuideReadiness` and `guideSignalApplicable`.
- [`BuildProgressRail.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/progressive-build/BuildProgressRail.tsx): Live progress rail detailing committed Pascal nodes, wall breakdowns (original vs completion vs finalized), and eligible door/window counts.
- [`BuildCompletionCard.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/progressive-build/BuildCompletionCard.tsx): Post-build summary card presenting finalized metrics and actions (Review, Render, Export).
- [`GuideControls.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/progressive-build/GuideControls.tsx): Editor-owned floating toolbar for guide visibility toggle, normalized opacity slider (0–100%), 90° rotation, position nudging, scaling, and 3D gizmo activation.
- [`DiagnosticPanel.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/progressive-build/DiagnosticPanel.tsx): Floating acceptance checklist reading live telemetry from `window.__pascalDiag` and `useScene`.
- [`ChunkLoadRecovery.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/progressive-build/ChunkLoadRecovery.tsx): Graceful recovery dialog when dynamic chunks fail to load.

### D. Pascal PRO Mode (`src/features/pro/`)
- [`useEditorMode.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/pro/useEditorMode.ts): Mode transition state machine managing `standard` $\leftrightarrow$ `pro` overlay states via pure reducer `editorModeReducer`.
- [`ProOverlay.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/pro/ProOverlay.tsx): Full PRO editor interface layered over the active 3D canvas:
  - **Outliner Hierarchy**: Category-grouped, searchable, with auto-scroll and double-click 3D focus.
  - **Item Catalog**: Official Pascal item panel for 3D furniture placement.
  - **Floating Controls**: `FloatingLevelSelector` and top action toolbar.
  - **Keyboard Handling**: Escape (clear selection), Delete/Backspace (safe delete).
- [`EditorSelectionManager.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/pro/EditorSelectionManager.tsx): Bridges 3D R3F pointer clicks into Pascal `useViewer` selection without bubbling or selecting building root groups.
- [`SelectionActionAnchor3D.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/pro/SelectionActionAnchor3D.tsx): R3F anchor computing screen projection of selected nodes with camera-depth culling and viewport boundary clamping.
- [`SelectionActionBarDOM.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/pro/SelectionActionBarDOM.tsx): Floating contextual action bar rendered in pure DOM with actions for Move, Duplicate, Rotate (90° CCW/CW), Visibility, and Safe Delete.
- [`action-matrix.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/pro/action-matrix.ts) & [`safeDelete.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/pro/safeDelete.ts): Contextual action rules and safe deletion capability matrix preventing orphan openings and broken junctions.
- [`SafeInspector.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/pro/SafeInspector.tsx): Floating properties card displaying type-specific geometry and metadata for selected elements.
- [`pascal-editor-icons.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/pro/pascal-editor-icons.ts), [`pascal-editor-icon-manifest.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/pro/pascal-editor-icon-manifest.ts): Bundles 15 curated Iconify icons offline so the editor never makes runtime requests to public icon APIs.

---

## 6. Harness & Scene Installers (`src/harness/`)

### A. Core Coordinate & Image Processing
- [`building-frame.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/building-frame.ts): Implements `computeBuildingFrame()` and `guideWorldPlacement()`. Ensures Guide textures, slabs, and walls align 1:1 in metric world space.
- [`crop-guide.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/crop-guide.ts): In-browser PDF rasterization via PDF.js with bounding-box cropping to the architectural ROI.
- [`verified-image.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/verified-image.ts): Inspects leading magic bytes to ensure only valid PNG/JPEG/WebP data reaches texture loaders; includes `autoCropDrawing`.

### B. Scene Building & Progressive Pipeline
- [`pascal-progressive-builder.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/pascal-progressive-builder.ts): Factory creating `ProgressiveInstaller` to stage-install validated AI extraction snapshots (`guide` $\rightarrow$ `slab` $\rightarrow$ `walls` $\rightarrow$ `wallMap` $\rightarrow$ `windows` $\rightarrow$ `doors` $\rightarrow$ `furniture`).
- [`build-live-import.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/build-live-import.ts): Converts live Pure MuPDF `ExtractionResult` into initial Pascal node drafts (Site, Building, Level, Guide, Slab, WallNodes).
- [`code06-staged-import.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/code06-staged-import.ts): Staged progressive committer committing walls in batches of 5–8 with live scene validation and building the `physicalWallId` $\rightarrow$ runtime ID map.
- [`finalized-wall-map.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/finalized-wall-map.ts): Verifies wall topology (zero duplicate IDs, zero missing runtime nodes, zero non-wall targets) and builds `FinalizedWallEntry[]`.
- [`extract-live-windows.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/extract-live-windows.ts): Integrates `AutomaticDetectorClean` with MuPDF draw operations to detect window intervals along physical walls.
- [`build-capability-scene.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/build-capability-scene.ts): Builds static capability test scenes using real Pascal Zod schemas.

### C. Modular Scene Installers (`src/harness/ai-scene-install/`)
- [`install-walls.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/ai-scene-install/install-walls.ts): Instantiates Pascal `WallNode` instances and records semantic $\rightarrow$ runtime wall mappings.
- [`install-opening.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/ai-scene-install/install-opening.ts): Installs `WindowNode` and `DoorNode` elements as children of host walls using wall-local coordinates (`worldOpeningToWallLocal`).
- [`install-slab.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/ai-scene-install/install-slab.ts): Instantiates `SlabNode` from polygon points or convex hull of wall endpoints.
- [`install-guide.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/ai-scene-install/install-guide.ts): Instantiates `GuideNode` aligned with the authoritative building frame.
- [`install-furniture.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/ai-scene-install/install-furniture.ts): Normalizes furniture items and instantiates `ItemNode` elements against catalog definitions.
- [`runtime-wall-map.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/ai-scene-install/runtime-wall-map.ts): Tracks runtime mapping between semantic contract wall IDs and live Pascal wall node IDs.
- [`structural-validation.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/ai-scene-install/structural-validation.ts): Validates structural integrity post-settlement (detecting orphan openings, schema mismatches, duplicate IDs, or missing nodes).
- [`stage-cleanup.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/ai-scene-install/stage-cleanup.ts): Idempotent stage and run cleanup helpers.
- [`catalogue.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/ai-scene-install/catalogue.ts): Resolves furniture family IDs to verified 3D assets (`.glb` / `.webp`).
- [`helpers.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/harness/ai-scene-install/helpers.ts): Geometry transforms, material preset normalization, and convex hull calculations.

---

## 7. Structural Pilots, Interaction & Export

### A. Columns & Opening Pilots
- [`src/features/columns/install-live-columns.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/columns/install-live-columns.ts): Installs structural `ColumnNode` instances as top-level children of the Level.
- [`src/features/door-pilot/door-boundary.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/door-pilot/door-boundary.ts) & [`install-live-doors.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/door-pilot/install-live-doors.ts): Selects eligible door candidates and installs `DoorNode` instances in host-wall local coordinates.
- [`src/features/window-pilot/install-pilot-windows.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/window-pilot/install-pilot-windows.ts): Geometric host resolution and installation of confirmed window instances (`WindowNode`).

### B. Viewer Interaction
- [`src/features/viewer-interaction/camera-framing-service.ts`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/viewer-interaction/camera-framing-service.ts): Pure framing solver (`computeFraming`, `frameSelectionBoxes`) calculating camera position, FOV extents, and target centers.
- [`src/features/viewer-interaction/ViewerToolbar.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/viewer-interaction/ViewerToolbar.tsx): Toolbar for camera modes, navigation tools, view resets, undo/redo, and PRO mode toggle.
- [`src/features/viewer-interaction/SelectionPropertiesPanel.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/viewer-interaction/SelectionPropertiesPanel.tsx): Read-only inspector displaying dimensional and semantic metadata for selected elements.
- [`src/features/viewer-interaction/KeyboardElementControls.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/viewer-interaction/KeyboardElementControls.tsx): Keyboard event listener for element translation (arrow keys), rotation (`R`), and deletion (`Delete`/`Backspace`).

### C. Project Export
- [`src/features/project-export/ExportRail.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/project-export/ExportRail.tsx): Export panel with pilot-node exclusion filter (`isPilotCommercialExcluded`), ensuring unconfirmed pilot geometry is excluded from commercial BOQ and drawing exports.
- [`src/features/project-export/ExportProgress.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/project-export/ExportProgress.tsx) & [`FullSuiteExportCard.tsx`](file:///c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/apps/design-build-editor/src/features/project-export/FullSuiteExportCard.tsx): Presentation components illustrating export package generation.

---

## 8. Guidance & Pitfalls for Future Agents

1. **Do Not Introduce Multiple Three.js Canvases**:
   - Always mount PRO editor components as DOM/SVG overlays on top of the existing `PascalViewerShell`. Never swap in a monolithic Editor that unmounts and remounts its own Canvas.
2. **Always Use `getPascalStores()`**:
   - Access `useScene`, `useViewer`, and `sceneRegistry` via `getPascalStores()` from `design-build-simplified-viewer-shell` to prevent dual-store desynchronization.
3. **Preserve `BuildingFrameContract` Alignment**:
   - When modifying guide textures, slabs, or walls, ensure all transforms derive from `BuildingFrameContract` with metric units and verified ROI boundaries.
4. **Never Write World Coordinates into Openings**:
   - `WindowNode.position` and `DoorNode.position` must remain **wall-local** (`[centreFromA, centreY, 0]`). Writing world coordinates causes openings to double-transform under the host wall's Three.js matrix.
5. **Never Hardcode Secrets**:
   - AI provider keys must remain server-side in `/api/providers`. Only `hasApiKey: boolean` and masked summaries may be exposed to the client.
