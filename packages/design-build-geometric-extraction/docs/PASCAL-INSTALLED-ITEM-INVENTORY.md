# Pascal Installed Item Inventory (Change Set 4 + 4.1, §17)

Verified against the **actually installed** repository + `node_modules` on 2026-07-29.
Findings are conservative — no asset is claimed to exist until verified on disk.

## ItemNode schema (from `node_modules/@pascal-app/core/dist/schema/nodes/item.d.ts`)

| Field | Type | Notes |
|---|---|---|
| `id` | `item_${string}` | template-literal id |
| `type` | `"item"` | node kind |
| `position` / `rotation` / `scale` | `[x,y,z]` | world transform |
| `parentId` | `string \| null` | parent (e.g. room/floor) |
| `wallId` / `wallT` | optional | **wall-hosted** attachment supported |
| `asset.id` / `asset.src` | string | **asset URL** (GLB/GLTF) |
| `asset.category` / `asset.name` | string | product classification |
| `asset.dimensions` | `[x,y,z]` | asset footprint |
| `asset.attachTo` | `wall \| ceiling \| wall-side` | floor/wall/ceiling attachment |
| `asset.tags` / `asset.thumbnail` | optional | metadata |

`ItemSystem` (per `node_modules/@pascal-app/nodes/dist/item/definition.d.ts`) supports
floor / wall / ceiling placement with bespoke `MoveItemContent` handling `attachTo`
transitions. This confirms the platform **supports ItemNode + asset URLs + multi-host
attachment** — the capability exists.

## Installed assets — verification result

| Asset search | Result |
|---|---|
| `node_modules/@pascal-app/nodes/dist/**/*.glb` | **none found** |
| `node_modules/@pascal-app/nodes/dist/**/*.gltf` | **none found** |
| `apps/design-build-editor/public/**/*.{glb,gltf}` | **none found** |
| `apps/editor/public/items/kitchen-shelf/model.glb` | **not present in this install** (public reference package only) |

**Conclusion:** The installed `@pascal-app/nodes` package declares the ItemNode schema and
renderer, but ships **no bundled GLB/GLTF assets** in this workspace. There is **no
verified workplace or residential-kitchen asset catalogue** (no desk, workstation,
base-cabinet, appliance, or bed GLB on disk).

## Corrected CS4.1 AI counts (replacing stale 24-bed/16-furniture legacy interpretation)

Authoritative counts from `ai_post_result.json` (verified 2026-07-29):

| Category | familyId | Count | Scope |
|---|---|---|---|
| single-bed | `catalog:single-bed` | 12 | loose-ffe |
| toilet | `catalog:toilet` | 2 | sanitary |
| bathtub | `catalog:bathtub` | 1 | sanitary |
| shower-square | `catalog:shower-square` | 1 | sanitary |
| **total** | | **16** | |

**Scope split:** 12 loose-ffe + 4 sanitary (NOT all 16 as loose FF&E).
**missingRotation = 0, missingDimensions = 0, dropped = 0.**

## Required-asset matrix (structured)

Per §14, each product type must find a verified asset before production ItemNode creation.
See `evidence/pascal-required-assets.json` for the structured artifact.

## Historical corrections (SUPERSEDED_BY_CORRECTED_RUNNER)

- Iterations 1–3 (pure-geometric bed detection) were superseded on 2026-07-29 by CS4.1 runner with real AI input.
- Determinism hash `4f53cda1…` locked for legacy pure-geometry run only (run1==run2).
- Authoritative CS4.1 hash: `54f82e61dac7c9025422f69a7caa1a25ead180153ac5b49ddcaa3d494a46791e` (run1==run2).

## Next step (Change Set 5, NOT this turn)

AI-guided local descriptor discovery + full-page recurrence search — do **not** multiply the 12 AI bed proposals to 24.
