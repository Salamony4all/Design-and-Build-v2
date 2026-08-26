# Pascal Workspace Integration — Findings & Dependency Report

Status: Checkpoint 1 accepted (clean reconstruction scaffold builds; harness scene
parses through real Pascal schemas). This document records every workspace and
dependency finding from the integration so the setup is reproducible and its
pitfalls are not rediscovered.

Repo: `Design And Build` monorepo (npm workspaces, `apps/*` + `packages/*`).
The FROZEN preservation app (`apps/editor`, Pascal 0.6.0 local packages) and the
NEW clean app (`apps/design-build-editor`, published Pascal 0.9.2 stack) coexist
in one npm workspace root. Nothing in the preservation app was modified.

---

## 1. Pinned Pascal stack (single release set)

| Package | Version | Where it resolves |
|---|---|---|
| `@pascal-app/core` | **0.9.2** | `apps/design-build-editor/node_modules/@pascal-app/core` (nested) |
| `@pascal-app/viewer` | **0.9.2** | nested under the app |
| `@pascal-app/editor` | **0.9.2** | nested under the app (source-only package — see §5) |
| `@pascal-app/nodes` | **0.1.1** | hoisted to root `node_modules/@pascal-app/nodes` (only one version exists) |

The old app keeps its local workspace packages `packages/core|viewer|editor`
at **0.6.0** — npm treats those as the workspace-linked versions, which is why
the new app's 0.9.2 set installs NESTED under `apps/design-build-editor/`.

Supporting stack (new app): react/react-dom **19.2.7** (hoisted), three
**0.185.1** (nested — root hoists 0.184.0 for the old app), zustand **5.0.14**
(nested), @react-three/fiber **9.6.1**, @react-three/drei **10.7.7** (hoisted).

### @pascal-app/nodes@0.1.1 dependency surface
- direct dependencies: **none** (`{}`)
- peerDependencies: `@pascal-app/core ^0.9.2` ✓, `@pascal-app/editor ^0.9.2` ✓,
  `@pascal-app/viewer ^0.9.2` ✓, `@react-three/drei ^10` ✓ (10.7.7),
  `@react-three/fiber ^9` ✓ (9.6.1), `react ^18 || ^19` ✓ (19.2.7),
  `three ^0.185` ✓ (0.185.1 via alias), `zustand ^5` ✓ (5.0.14),
  `lucide-react ^1` ⚠ (app has 0.460.x — pre-1.0 naming; loaded via
  `--legacy-peer-deps`, no runtime failure observed so far; revisit if icon
  imports break).

### Capability delta vs the frozen checkout
`@pascal-app/core 0.6.0` (old) has NO column schema and no `packages/nodes`.
`@pascal-app/nodes 0.1.1` + `core 0.9.2` (new) ship `columnDefinition` +
`ColumnNode` (~80 zod fields incl. style/crossSection/base/capital) and a
registry bootstrap: `loadPlugin(builtinPlugin)` (from `@pascal-app/core` /
`@pascal-app/nodes`) must run BEFORE the Viewer mounts.

---

## 2. npm workspace pitfalls hit (and exact fixes)

### 2.1 EINVALIDPACKAGENAME — scope doubling
Scoped names (`@design-build/extraction-contracts`) at one-level dirs
(`packages/extraction-contracts`) made npm construct
`@design-build/@design-build/extraction-contracts` and abort.
**Fix:** UNSCOPED package names `design-build-<name>` at the spec'd
`packages/<name>` layout. Root `package.json` workspaces globs (`packages/*`)
pick them up without any root modification.

### 2.2 EUNSUPPORTEDPROTOCOL — `workspace:*`
`"design-build-x": "workspace:*"` is a pnpm/yarn protocol; npm rejects it.
**Fix:** plain semver range `"^0.1.0"` matching the workspace package's version;
npm workspaces auto-links local folders when the range matches.

### 2.3 ERESOLVE — React 19 requirement
`@pascal-app/core@0.9.2 → @react-three/fiber@9` requires `react >=19 <19.3`.
**Fix:** the new app pins react/react-dom `^19`, and installs run with
`--legacy-peer-deps` (needed for transitive expo/react-native-web peers that
the Pascal stack references but the web app never imports).

### 2.4 Version bifurcation between the two apps
Root hoists three **0.184** + Pascal **0.6.0** (old app); the new app needs
three **0.185** + Pascal **0.9.2**. npm nests the new versions under
`apps/design-build-editor/node_modules`, but webpack still resolved hoisted
copies through `@pascal-app/nodes` (hoisted) → wrong core → build errors like
`'useLiveNodeOverrides' is not exported from '@pascal-app/core'`.
**Fix:** exact-match webpack aliases in `apps/design-build-editor/next.config.mjs`
(see §4). DO NOT remove these aliases while both apps share the repo root.

---

## 3. @pascal-app packaging quirks found

1. **`@pascal-app/nodes/dist/index.js` is not Node-ESM-runnable**: it uses
   extensionless directory imports (`./box-vent`), so `node`/`tsx` importing the
   package ROOT throws `ERR_UNSUPPORTED_DIR_IMPORT`. Bundlers (Next/webpack)
   resolve it fine. Consequence: headless scripts must import Pascal SCHEMAS
   from `@pascal-app/core` (clean ESM) and avoid the nodes root entry.
2. **`@pascal-app/editor@0.9.2` is a source-only package**: no `main`, exports
   map points at `./src/index.tsx`. A webpack DIRECTORY alias to the package
   bypasses the exports map and fails; alias must target the exact file.
3. **`import.meta` warning**: `core/dist/registry/registry.js` triggers Next
   "Critical dependency: Accessing import.meta directly is unsupported" —
   non-fatal, build completes; tracked as upstream noise.
4. **three subpath exports**: aliasing bare `three` to a directory breaks
   `three/webgpu` / `three/tsl` / `three/addons/*`; each subpath needs its own
   exact-match alias to the nested three build files.

---

## 4. Canonical alias block (do not change during runtime checkpoint)

`apps/design-build-editor/next.config.mjs` — webpack aliases:

```js
'@pascal-app/core$':   <app>/node_modules/@pascal-app/core/dist/index.js
'@pascal-app/viewer$': <app>/node_modules/@pascal-app/viewer/dist/index.js
'@pascal-app/editor$': <app>/node_modules/@pascal-app/editor/src/index.tsx
'@pascal-app/editor/catalog$': <app>/.../item-catalog/catalog-items.tsx
'three$':        <app>/node_modules/three/build/three.module.js
'three/webgpu$': <app>/node_modules/three/build/three.webgpu.js
'three/tsl$':    <app>/node_modules/three/build/three.tsl.js
'three/addons':  <app>/node_modules/three/examples/jsm
```

Plus `transpilePackages`: all four `@pascal-app/*` + every `design-build-*`
workspace package. tsconfig `paths` mirror the same mapping for `tsc --noEmit`.

---

## 5. Verified build/test evidence (Checkpoint 1)

- `npm install --legacy-peer-deps` → 259 packages added, exit 0.
- Harness scene via real schemas (`npx tsx`): 13 nodes —
  site/building/level/slab ×1, wall ×4, window/door/column/item/guide ×1;
  `ColumnNode.parse` yields 80 fields (`style: plain`, `crossSection: round`).
- `coordinate-frame` tests: 12/12 PASS (round-trip < 1e-9 pt over 121-pt grid).
- `tsc --noEmit`: exit 0. `next build`: exit 0 —
  `/` 3.66 kB (93.9 kB first load), `/harness` 391 kB (481 kB first load).

## 6. Schema facts needed by future adapters (measured, not assumed)

- `WallNode`: `start`/`end` are **2-tuples** `[x, z]` (not 3-tuples), plus
  `height`, `thickness` optional-with-defaults.
- `SlabNode.polygon`: array of `[x, z]` pairs.
- `ItemNode` REQUIRES an `asset` object: `{ id, category, name, thumbnail, src,
  dimensions:[w,h,d], source:'library' }`; URL fields validate against
  `asset://`, `blob:`, `data:image/`, `/path`, or `https://` (http://localhost
  allowed in dev) — `about:blank` is rejected.
- `GuideNode`: takes `url` (same URL validation) — no start/end required.
- `ColumnNode`: `position` **3-tuple**, `rotation` number; `id` must match
  template `column_<string>` (all node ids follow `<type>_<string>`).
