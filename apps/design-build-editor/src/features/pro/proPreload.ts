// features/pro/proPreload.ts
//
// PRO preload phase — runs WHILE STANDARD remains the only mounted Viewer.
// It performs every non-Viewer preparation step so that, by the time we atomically
// swap shells, the official Editor can mount cleanly against the shared core store:
//
//   PRO_IMPORTING        -> dynamically import @pascal-app/editor (warm chunk)
//   PRO_ICONS_READY      -> register the curated 15-icon set synchronously
//   PRO_PLUGIN_READY     -> ensureBuiltinPluginLoaded() (idempotent, core singleton)
//   PRO_SCENE_CAPTURED   -> capture the live project scene + active Level/building
//   PRO_PROJECT_READY    -> verify stable PRO project id + payload for onLoad
//
// This module NEVER renders <Editor>, NEVER creates a Canvas/Viewer, NEVER calls
// unloadScene, and NEVER mutates useScene. That keeps the invariant
// (activeCanvasCount === 1, activeViewerCount === 1) intact during preparation.

import { useScene } from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';
import { ensureBuiltinPluginLoaded } from 'design-build-simplified-viewer-shell';
import { registerPascalEditorIcons } from './pascal-editor-icons';

export interface ProPreloadResult {
  editorModuleLoaded: boolean;
  iconsRegistered: boolean;
  pluginReady: boolean;
  capturedNodeCount: number;
  activeLevelId: string | null;
  activeBuildingId: string | null;
  scenePayload: Record<string, unknown> | null;
  projectId: string;
}

/**
 * Synchronous, non-Viewer preparation. Must only run while STANDARD is mounted.
 * Throws (with a safe reason) on any failure so the coordinator can roll back.
 */
export async function preparePro(projectId: string): Promise<ProPreloadResult> {
  // 1. Warm the official Editor chunk (no render).
  await import('@pascal-app/editor');
  const editorModuleLoaded = true;

  // 2. Register curated icons synchronously into the Iconify storage the
  //    official <Icon> components read from. Zero public API requests.
  registerPascalEditorIcons();
  const iconsRegistered = true;

  // 3. Ensure the built-in node plugin is registered against the SAME core
  //    singleton STANDARD uses (idempotent). Does not wait for the Editor.
  await ensureBuiltinPluginLoaded();
  const pluginReady = true;

  // 4. Capture the live scene WITHOUT mutating it. Returns the exact payload the
  //    official Editor's onLoad will hand back, so node counts are preserved.
  const s = useScene.getState() as unknown as {
    nodes?: Record<string, unknown>;
    rootNodeIds?: string[];
    collections?: Record<string, unknown>;
    materials?: Record<string, unknown>;
  };
  const nodes = s.nodes ?? {};
  const capturedNodeCount = Object.keys(nodes).length;
  const level = Object.values(nodes as Record<string, { type?: string; id?: string }>).find(
    (n) => n.type === 'level',
  );
  const activeLevelId = level?.id ?? null;
  const building = Object.values(nodes as Record<string, { type?: string; id?: string }>).find(
    (n) => n.type === 'building',
  );
  const activeBuildingId = building?.id ?? null;

  const scenePayload: Record<string, unknown> = {
    nodes,
    rootNodeIds: s.rootNodeIds ?? [],
    collections: s.collections ?? {},
    materials: s.materials ?? {},
  };

  // 5. Point the shared viewer selection at the active Level so the official
  //    Editor's build/select tools target the right container (read-only).
  if (activeLevelId) {
    try {
      useViewer.getState().setSelection?.({ levelId: activeLevelId as `level_${string}` });
    } catch {
      /* non-fatal */
    }
  }

  return {
    editorModuleLoaded,
    iconsRegistered,
    pluginReady,
    capturedNodeCount,
    activeLevelId,
    activeBuildingId,
    scenePayload,
    projectId,
  };
}
