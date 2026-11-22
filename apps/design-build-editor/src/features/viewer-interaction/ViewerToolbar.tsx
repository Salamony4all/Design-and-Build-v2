// features/viewer-interaction/ViewerToolbar.tsx
// Floating viewer toolbar over the official Pascal viewer: camera views, the
// plan overlay, history and the PRO editor. In PRO it also carries Pascal's
// drawing tools. Mouse navigation stays with the official OrbitControls.

'use client';
import React from 'react';
import { useViewer } from '@pascal-app/viewer';
import { useScene } from '@pascal-app/core';
import { useEditor } from '@pascal-app/editor';
import {
  AppWindow,
  Box,
  BrickWall,
  DoorOpen,
  Layers,
  MousePointer2,
  PenLine,
  Redo2,
  Scan,
  Square,
  SquareDashed,
  Undo2,
  View,
} from 'lucide-react';

interface Props {
  onFitProject: () => void;
  onFitSelection: () => void;
  onTopView: () => void;
  onResetView?: () => void;
  proEnabled?: boolean;
  mode?: 'standard' | 'pro';
  onToggleMode?: () => void;
  orientation?: 'vertical' | 'horizontal';
}

function ToolButton(p: { label: string; onClick: () => void; on?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={p.label} aria-label={p.label} aria-pressed={p.on} className={p.on ? 'on' : ''} onClick={p.onClick}>
      {p.children}
    </button>
  );
}

export function ViewerToolbar({
  onFitProject,
  onFitSelection,
  onTopView,
  proEnabled,
  mode,
  onToggleMode,
  orientation = 'vertical',
}: Props) {
  const cameraMode = useViewer((s) => s.cameraMode);
  const setCameraMode = useViewer((s) => s.setCameraMode);
  const showGuides = useViewer((s) => s.showGuides);
  const setShowGuides = useViewer((s) => s.setShowGuides);
  const selectedCount = useViewer((s) => s.selection?.selectedIds?.length ?? 0);

  const activeMode = useEditor((s) => s.mode);
  const activeTool = useEditor((s) => s.tool);

  const pickTool = (tool: 'wall' | 'slab' | 'door' | 'window') => {
    useEditor.getState().setPhase('structure');
    useEditor.getState().setMode('build');
    useEditor.getState().setTool(tool);
  };
  const activateSelect = () => {
    useEditor.getState().setMode('select');
    useEditor.getState().setTool(null);
    useEditor.getState().setMovingNode(null);
  };
  const history = () => (useScene.getState() as unknown as { temporal?: { undo: () => void; redo: () => void } }).temporal;
  const undo = () => { try { history()?.undo(); } catch { /* nothing to undo */ } };
  const redo = () => { try { history()?.redo(); } catch { /* nothing to redo */ } };
  const isPro = mode === 'pro';

  return (
    <div
      className={`db-toolbar glass ${orientation === 'horizontal' ? 'is-horizontal' : ''}`}
      role="toolbar"
      aria-label="Viewer controls"
    >
      {isPro && (
        <>
          <ToolButton label="Select (Esc)" on={activeMode === 'select'} onClick={activateSelect}><MousePointer2 size={17} /></ToolButton>
          <ToolButton label="Draw walls" on={activeMode === 'build' && activeTool === 'wall'} onClick={() => pickTool('wall')}><BrickWall size={17} /></ToolButton>
          <ToolButton label="Draw a floor slab" on={activeMode === 'build' && activeTool === 'slab'} onClick={() => pickTool('slab')}><SquareDashed size={17} /></ToolButton>
          <ToolButton label="Place a door" on={activeMode === 'build' && activeTool === 'door'} onClick={() => pickTool('door')}><DoorOpen size={17} /></ToolButton>
          <ToolButton label="Place a window" on={activeMode === 'build' && activeTool === 'window'} onClick={() => pickTool('window')}><AppWindow size={17} /></ToolButton>
          <div className="sep" />
        </>
      )}

      <ToolButton label="3D view of the whole model" onClick={onFitProject}><Box size={17} /></ToolButton>
      <ToolButton label="Top view" onClick={onTopView}><Square size={17} /></ToolButton>
      {selectedCount > 0 && (
        <ToolButton label="Zoom to selection" onClick={onFitSelection}><Scan size={17} /></ToolButton>
      )}
      {isPro && (
        <ToolButton
          label={cameraMode === 'orthographic' ? 'Switch to perspective' : 'Switch to orthographic'}
          on={cameraMode === 'orthographic'}
          onClick={() => setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')}
        ><View size={17} /></ToolButton>
      )}

      <div className="sep" />
      <ToolButton label={showGuides ? 'Hide the plan drawing' : 'Show the plan drawing'} on={showGuides} onClick={() => setShowGuides(!showGuides)}>
        <Layers size={17} />
      </ToolButton>

      <div className="sep" />
      <ToolButton label="Undo" onClick={undo}><Undo2 size={17} /></ToolButton>
      <ToolButton label="Redo" onClick={redo}><Redo2 size={17} /></ToolButton>

      {proEnabled && (
        <>
          <div className="sep" />
          <button
            type="button"
            className={`db-toolbar__text ${isPro ? 'on' : ''}`}
            title={isPro ? 'Leave the PRO editor' : 'Edit the model in the PRO editor'}
            onClick={onToggleMode}
          >
            <PenLine size={15} />
            <span>{isPro ? 'Done' : 'Edit'}</span>
          </button>
        </>
      )}
    </div>
  );
}
