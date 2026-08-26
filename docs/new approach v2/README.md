# Deterministic CAD Vector Extractor Core

TypeScript reference implementation for vector-only structural and FF&E extraction. No OCR, rasterization, CV, or inference.

## Pipeline
1. Parse native CAD entities upstream and tessellate curves with a declared geometric tolerance.
2. Reject annotation layers/entities; build `rbush`; retain the dominant endpoint-connected structural component.
3. Select primary orthogonal grid anchors, derive a rigid local-plane transform, and transform all coordinates.
4. **Node all intersections before loop tracing.** `traceBoundedLoops` expects a planar straight-line graph.
5. Hash each bounded loop using internal angles and perimeter-normalized edge lengths, normalized over cyclic shifts and reversed traversal.
6. Resolve hashes through a procurement catalog and construct Pascal-oriented scene/catalog JSON.
7. Push item matrices into `FlatRenderRegistry`; update Three.js/WebGL objects from the render loop without React state.

## Determinism contract
- Input units, curve tessellation tolerance, endpoint snap tolerance, and decimal quantization are explicit configuration inputs.
- Sort parsed entities by `(layer, handle)` before segmentation.
- Split every crossing/T-junction before face walking.
- Do not use raw binary floating-point strings as IDs.
- The included FNV-1a 64 hash is deterministic but not collision-proof; production catalogs should store and compare the full canonical signature alongside the compact hash.

## Important schema note
The emitted hierarchy is a strict adapter DTO matching the requested `Site -> Building -> Level -> Walls/Slabs/Items` contract. Pascal Editor's internal persisted schema can evolve; isolate any official Pascal import/export conversion in a separate adapter.

## CAD parser boundary
DWG generally requires a licensed/native converter or SDK. Convert DWG to DXF without rasterization, then use the same entity adapter. Ignore TEXT/MTEXT/DIMENSION/LEADER/MLEADER/HATCH and paper-space/title-block INSERTs before segmentation.

## Run
```bash
npm install
npm test
npm run typecheck
```

## Phased extraction architecture (v0.2)

1. **Slabs** - closed native CAD loops on slab/floor layers become Pascal `SlabNode.polygon` plus holes.
2. **Walls** - authoritative centerlines become `WallNode.start/end`; paired wall-face inference should occur in the CAD adapter before this phase.
3. **Openings** - native door/window blocks are classified, sized from footprint geometry, attached to the nearest valid wall, and emitted as hosted `DoorNode`/`WindowNode` objects.
4. **FF&E** - only non-structural blocks enter catalog matching. The matcher combines cyclic/mirror-normalized topology, real dimensions, area, compactness, hole count, and radial shape profile. Low-confidence matches remain unresolved.
5. **Pascal schema validation** - `pascalAdapter.ts` uses the published `@pascal-app/core/schema` Zod nodes. Keep this adapter behind an application boundary because package 0.9.1 currently has a runtime ESM packaging issue when imported by Vitest, although its declarations type-check correctly.

Catalog prototypes must be generated from authoritative Pascal GLB footprints or saved Pascal catalog metadata, never from thumbnails. Preserve `catalogId`, asset URL, category, dimensions, attachment mode, footprint descriptor, and catalog/version provenance.
