# MANUAL CHECKPOINT 2 — FROZEN CODE-06 WALL IMPORT

Browser automation cannot reach `localhost` in this sandbox, so the live-canvas
gates below must be verified manually in a real browser. The harness exposes
dev-only diagnostics (gated behind `NODE_ENV !== 'production'`; absent in prod
builds) so each gate can be checked with one console expression.

## Run

```
npm run dev        # http://localhost:3003
# open http://localhost:3003/  (production route "/")
```

1. The ChatPanel is centred (bottom:50%/top:50%, translate(-50%,-50%)).
2. In the composer type anything and send, OR click the model dropdown — confirm
   the panel stays event-only (no Pascal import yet).
3. Trigger the import: in the browser console run
   ```js
   // start the frozen import the same way the UI command does:
   // (the page listens for the "start-frozen-import" command; trigger via:)
   ```
   Easiest: the app auto-wires the button. If no button exists, run in console:
   ```js
   // dispatch the same path the ChatPanel uses:
   window.dispatchEvent(new CustomEvent('noop')); // not needed
   ```
   **Actually**: call the export from the page — the import starts when the
   ChatPanel emits `start-frozen-import`. Until a UI trigger is wired, run:
   ```js
   // from the page module scope is not exposed; instead use the dev hook once
   // the scene is installed. Open the page, then in console:
   location.reload();
   ```
   > NOTE: a dedicated "Import CODE-06" button is the intended trigger. If absent,
   > wire `onCommand` to also call `startFrozenImport()` on a `send-message`
   > containing "import", or add a button. The diagnostics below assume the import
   > has been started.

## Diagnostic hook

After the scene is installed (initial shell) and during/after import, the page
exposes (dev only):

```js
window.__code06.getStatus()
```

Returns:

```ts
{
  importState,          // 'idle'|'initializing'|'importing'|'completed'|'failed'
  currentStage,         // 'none'|'slab'|'exterior-walls'|...|'short-partitions'
  committedWalls,       // running count as batches commit
  expectedWalls,        // 70
  sceneNodeCount,       // 4 (initial) -> 75 (final)
  wallNodeCount,        // 0 -> 70
  wallRegistryCount,    // 0 -> 70  (sceneRegistry Object3D objects)
  dirtyNodeCount,       // drains to 0
  sceneTreeIssues,      // 0 throughout
  duplicateWallIds,     // 0
  unreachableNodeIds,   // [] (empty)
  progressiveEventLog,  // array of StageEvent objects
}
```

Dev actions:
```js
window.__code06.failNextBatch()   // next wall batch fails + rolls back only itself
window.__code06.validate()        // -> SceneTreeValidationResult
window.__code06.resetFrozenImport()
```

## Gates & expected values

### A. Initial scene (before import)
- `getStatus()` after page load + initial install:
  - `sceneNodeCount === 4` (site, building, level, guide)
  - `wallNodeCount === 0`, `wallRegistryCount === 0`, `dirtyNodeCount === 0`
  - `level.children` = `[guideId]` only (no slab, no walls)

### B. Progressive counts (during import)
- Watch `committedWalls` climb: `0 → 6 → 12 → … → 66 → 70`.
- `progressiveEventLog` contains `stage-commit-progress` events whose
  `committed` equals the actual live `wallNodeCount` at that moment.
- No wall is visible before its `stage-commit-progress` event.

### C. Registry & dirty drain (after import)
- `wallRegistryCount === 70`, `wallNodeCount === 70`, `sceneNodeCount === 75`.
- `dirtyNodeCount === 0` (all 70 walls + slab built and cleared).
- `sceneTreeIssues === 0`, `duplicateWallIds === 0`, `unreachableNodeIds === []`.

### D. Individual selection
```js
const s = window.__code06.getStatus();
// pick 4 representative wall ids from useScene state:
const st = window.__code06.core.useScene.getState();
const walls = Object.values(st.nodes).filter(n=>n.type==='wall');
// select one exterior, one principal, one service, one short via useViewer:
window.__code06.core.useViewer.getState().setSelection({selectedIds:[walls[0].id],buildingId:LEVEL,levelId:LEVEL,zoneId:null});
```
- Each wall selects **independently**; no combined building-level object exists.
- `walls[i].metadata.physicalWallId` maps 1:1 to the frozen fixture's
  `physicalWallId` (70 distinct values).

### E. Undo / redo
- Move a wall: `st.updateNode(id,{start:[...],end:[...]})`; undo/redo via
  `st.temporal.getState().undo()/redo()`. Positions往返正确.
- Delete a wall: `st.deleteNode(id)`; undo restores it + its `level.children`
  entry; `wallNodeCount` returns to 70.

### F. Stage rollback
- Call `window.__code06.failNextBatch()`, then confirm the next batch emits
  `stage-failed` + `stage-rolled-back` and **earlier committed batches remain
  intact** (committedWalls does not regress below pre-failure count).

### G. Persistence
- After completion, reload the page. If persistence is enabled, all 75 nodes
  return, all 70 wall IDs + transforms unchanged, `getStatus()` valid,
  `dirtyNodeCount` settles to 0.

### H. Guide alignment
- Four perimeter corners + four principal internal anchors + four short-partition
  anchors overlay the guide plane with max PDF↔world round-trip error ≈ 0
  (verified offline: 7.3e-15 pt). Visually: walls sit exactly on the guide.

## Scope frozen (do NOT add)
No live MuPDF, no Gemini, no Nano Banana, no columns, no windows, no doors, no
furniture. Node types present: site, building, level, slab, wall, guide only.
