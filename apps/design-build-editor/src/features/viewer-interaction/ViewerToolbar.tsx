// features/viewer-interaction/ViewerToolbar.tsx
// Floating view toolbar over the official Pascal viewer: 3D / Top views,
// zoom, turning around the model, the plan drawing, history and the PRO
// editor. In PRO it also carries Pascal's drawing tools. Mouse and touch
// navigation stay with the official OrbitControls.

'use client';
import React from 'react';
import { useViewer } from '@pascal-app/viewer';
import { useScene } from '@pascal-app/core';
import { useEditor } from '@pascal-app/editor';
import {
  AppWindow,
  BrickWall,
  DoorOpen,
  Footprints,
  Layers,
  MousePointer2,
  PenLine,
  Redo2,
  RotateCcwSquare,
  RotateCwSquare,
  Scan,
  SquareDashed,
  Undo2,
  View,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface Props {
  /** 3D view of the whole model (pressing it again re-centres). */
  onFitProject: () => void;
  onFitSelection: () => void;
  /** Top view of the whole plan. */
  onTopView: () => void;
  onResetView?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onTurnLeft?: () => void;
  onTurnRight?: () => void;
  /** Walk inside the model at eye height (shown when given). */
  onWalk?: () => void;
  /** Walk mode: step through the lens presets. */
  onLensStep?: () => void;
  /** Walk mode: current lens, 35 mm-equivalent. */
  lensMm?: number;
  viewMode?: '3d' | 'top' | 'walk';
  proEnabled?: boolean;
  mode?: 'standard' | 'pro';
  onToggleMode?: () => void;
  orientation?: 'vertical' | 'horizontal';
}

function ToolButton(p: { label: string; onClick?: () => void; on?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={p.label}
      aria-label={p.label}
      aria-pressed={p.on}
      className={[p.on ? 'on' : '', p.className ?? ''].join(' ').trim()}
      onClick={p.onClick}
    >
      {p.children}
    </button>
  );
}

export function ViewerToolbar({
  onFitProject,
  onFitSelection,
  onTopView,
  onZoomIn,
  onZoomOut,
  onTurnLeft,
  onTurnRight,
  onWalk,
  onLensStep,
  lensMm,
  viewMode = '3d',
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
      className={`db-toolbar glass ${orientation === 'horizontal' ? 'is-horizontal' : ''} ${isPro ? '' : 'db-toolbar--main'}`}
      role="toolbar"
      aria-label="View controls"
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

      <div className="db-seg" role="radiogroup" aria-label="View">
        <button
          type="button"
          role="radio"
          aria-checked={viewMode === '3d'}
          className={viewMode === '3d' ? 'on' : ''}
          onClick={onFitProject}
          title={viewMode === '3d' ? 'Show the whole model again (H)' : '3D view of the whole model (H)'}
        >
          3D
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={viewMode === 'top'}
          className={viewMode === 'top' ? 'on' : ''}
          onClick={onTopView}
          title="Top view of the whole plan (T)"
        >
          Top
        </button>
        {onWalk && (
          <button
            type="button"
            role="radio"
            aria-checked={viewMode === 'walk'}
            className={`db-seg__walk ${viewMode === 'walk' ? 'on' : ''}`}
            onClick={onWalk}
            title={viewMode === 'walk' ? 'Stand here again, level (V)' : 'Walk inside at eye height, with a wide lens (V)'}
          >
            <Footprints size={14} aria-hidden />
            <span>Walk</span>
          </button>
        )}
      </div>

      {onZoomOut && onZoomIn && viewMode !== 'walk' && (
        <>
          <div className="sep" />
          <ToolButton label="Zoom out (−)" onClick={onZoomOut}><ZoomOut size={18} /></ToolButton>
          <ToolButton label="Zoom in (+)" onClick={onZoomIn}><ZoomIn size={18} /></ToolButton>
        </>
      )}

      {onZoomOut && onZoomIn && viewMode === 'walk' && (
        <>
          <div className="sep" />
          <ToolButton label="Wider lens (−)" onClick={onZoomOut}><ZoomOut size={18} /></ToolButton>
          <button
            type="button"
            className="db-lens-chip"
            onClick={onLensStep}
            title="Lens (35 mm equivalent). Tap for 14 / 18 / 24 / 35 mm, or pinch the view."
            aria-label={`Lens ${Math.round(lensMm ?? 18)} millimetres`}
          >
            {Math.round(lensMm ?? 18)}<small>mm</small>
          </button>
          <ToolButton label="Narrower lens (+)" onClick={onZoomIn}><ZoomIn size={18} /></ToolButton>
        </>
      )}

      {onTurnLeft && onTurnRight && viewMode !== 'walk' && (
        <>
          <div className="sep" />
          <ToolButton label="Turn left (Q)" onClick={onTurnLeft}><RotateCcwSquare size={18} /></ToolButton>
          <ToolButton label="Turn right (E)" onClick={onTurnRight}><RotateCwSquare size={18} /></ToolButton>
        </>
      )}

      {selectedCount > 0 && (
        <ToolButton label="Zoom to the selection (F)" onClick={onFitSelection} className="db-tb-scan"><Scan size={18} /></ToolButton>
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

      <div className="db-tb-group db-tb-desk">
        <div className="sep" />
        <ToolButton label="Undo" onClick={undo}><Undo2 size={17} /></ToolButton>
        <ToolButton label="Redo" onClick={redo}><Redo2 size={17} /></ToolButton>
      </div>

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
