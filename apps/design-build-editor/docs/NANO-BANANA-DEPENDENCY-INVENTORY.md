# Nano Banana Dependency Inventory — CS3 (§23)

Nano Banana rendering is NOT migrated in Change Set 3. This inventory records every
AI-pipeline output the legacy render path consumes, so the neutral result / clean
project context preserves them for Change Set 4.

## Legacy render call path (reference only)

`ChatBox.runOrchestrator` → `ChatOrchestrator.orchestrateMessage`
→ intent classify (`aesthetic` | `structural` | `freeform`)
→ Pathway A (aesthetic: mutate `render_spec` on nodes → snapshot → compile → render)
→ Pathway B (structural: selected-node mutation → snapshot → compile → render)
→ `PromptCompiler.compileArchitecturalPrompt(nodes)` → `POST /api/render`
→ `image-gen.generateImage` (`/images/generations`, x-goog-api-key or Bearer)
→ `renderedDataUrl` back into the chat message.

## Fields Nano Banana consumes (must survive the neutral result / clean context)

### From the scene graph (`render_spec` per node — written by ChatOrchestrator)
| Node type | Fields |
|---|---|
| wall | `material_finish`, `surface_treatment`, `color_palette`, `is_exterior`, `cladding_system`, `shading_device` |
| slab | `floor_finish`, `spec_brand` |
| ceiling | `ceiling_finish`, `trim_profile`, `lighting_type` |
| zone | `name` (room names, first 6 used in prompt) |

### From the AI extraction result (via neutral BuildingExtractionResult)
| Legacy AI field | Neutral home | Used for |
|---|---|---|
| `projectInfo.name`, `projectInfo.estimatedArea` | `projectMetadata` | project narrative / render description |
| `zones[].name`, `zones[].boundary`, `zones[].color` | `rooms/spaces` | room names in prompt, spatial relationships |
| `walls[].material` | wall material metadata | material instructions |
| `floors[].material` | slab material metadata | floor finish |
| `furniture[].type` (catalog slugs) | furniture instances | FF&E in scene description |
| `openings[].type` | windows/doors | scene description |
| CATALOG_SLUGS vocabulary (139) | provider evidence / catalog contract | render + FF&E schedule vocabulary |
| MATERIALS vocabulary (10) | material contract | colour/material instructions |

### From the viewer (runtime, not extraction)
- viewport snapshot (`captureViewport` → largest canvas PNG data URL) — image-to-image input
- camera position/target (context)
- selected-node summaries (Pathway B)
- previous rendered image (`context.lastRenderDataUrl` for iteration)

### From render provider config (RenderConfigSelector — separate from extraction)
- provider baseUrl / credential reference / model, `strength`, `guidance_scale`

## Preservation verdict

The clean `BuildingExtractionResult` (extended per §14) retains: projectMetadata,
rooms/spaces (zones incl. color), materials on walls/slabs, furniture families +
instances (catalog slugs), openings, confidence, provenance. Render-only fields
(`render_spec` mutations) are **scene-side** state, not extraction output — they are
produced during CS4 render conversations and stored on Pascal nodes' metadata.
Nothing in CS3 discards any field listed above.

Until CS4, clean UI render requests must show: **"Render provider migration pending."**
