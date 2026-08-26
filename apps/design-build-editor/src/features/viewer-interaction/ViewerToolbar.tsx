// features/viewer-interaction/ViewerToolbar.tsx
// Floating viewer toolbar wrapping official Pascal capabilities + the host
// camera-framing service. Does not recreate Pascal editor functionality.
// Documented navigation model (works with the official OrbitControls):
//   - left click            → select node (Pascal)
//   - right-drag / Alt+drag → orbit
//   - middle-drag           → pan
//   - wheel                 → zoom
// The Select/Orbit/Pan buttons reflect the documented intent with a visible
// active state; the official controls remain authoritative.

'use client';
import React, { useState } from 'react';
import { useViewer } from '@pascal-app/viewer';
import { useScene } from '@pascal-app/core';

import { useEditor } from '@pascal-app/editor';

type NavMode = 'select' | 'orbit' | 'pan';

interface Props {
  onFitProject: () => void;
  onFitSelection: () => void;
  onTopView: () => void;
  onResetView: () => void;
  proEnabled?: boolean;
  mode?: 'standard' | 'pro';
  onToggleMode?: () => void;
  orientation?: 'vertical' | 'horizontal';
}

export function ViewerToolbar({
  onFitProject,
  onFitSelection,
  onTopView,
  onResetView,
  proEnabled,
  mode,
  onToggleMode,
  orientation = 'vertical',
}: Props) {
  const cameraMode = useViewer((s) => s.cameraMode);
  const setCameraMode = useViewer((s) => s.setCameraMode);
  const showGuides = useViewer((s) => s.showGuides);
  const setShowGuides = useViewer((s) => s.setShowGuides);
  const [navMode, setNavMode] = useState<NavMode>('select');

  // Official Editor tool state
  const activeMode = useEditor((s) => s.mode);
  const activePhase = useEditor((s) => s.phase);
  const activeTool = useEditor((s) => s.tool);

  const activateSelect = () => {
    useEditor.getState().setMode('select');
    useEditor.getState().setTool(null);
    useEditor.getState().setMovingNode(null);
    setNavMode('select');
  };

  const activateWall = () => {
    useEditor.getState().setPhase('structure');
    useEditor.getState().setMode('build');
    useEditor.getState().setTool('wall');
  };

  const activateSlab = () => {
    useEditor.getState().setPhase('structure');
    useEditor.getState().setMode('build');
    useEditor.getState().setTool('slab');
  };

  const activateDoor = () => {
    useEditor.getState().setPhase('structure');
    useEditor.getState().setMode('build');
    useEditor.getState().setTool('door');
  };

  const activateWindow = () => {
    useEditor.getState().setPhase('structure');
    useEditor.getState().setMode('build');
    useEditor.getState().setTool('window');
  };

  const undo = () => { try { (useScene.getState() as unknown as { temporal: { undo: () => void } }).temporal.undo(); } catch { /* noop */ } };
  const redo = () => { try { (useScene.getState() as unknown as { temporal: { redo: () => void } }).temporal.redo(); } catch { /* noop */ } };
  const toggleCam = () => setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective');

  return (
    <div
      className={`db-toolbar glass ${orientation === 'horizontal' ? 'is-horizontal' : ''}`}
      role="toolbar"
      aria-label="Viewer controls"
    >
      {mode === 'pro' ? (
        <>
          {/* Official Pascal PRO Tools */}
          <button
            title="Select Mode — click elements in 3D (Escape to clear)"
            aria-label="Select mode"
            className={activeMode === 'select' ? 'on' : ''}
            onClick={activateSelect}
          >⌖</button>
          <button
            title="Wall Tool — draw parametric walls"
            aria-label="Wall tool"
            className={activeMode === 'build' && activeTool === 'wall' ? 'on' : ''}
            onClick={activateWall}
          >🧱</button>
          <button
            title="Slab Tool — create floor slab boundaries"
            aria-label="Slab tool"
            className={activeMode === 'build' && activeTool === 'slab' ? 'on' : ''}
            onClick={activateSlab}
          >▱</button>
          <button
            title="Door Tool — place hosted doors on walls"
            aria-label="Door tool"
            className={activeMode === 'build' && activeTool === 'door' ? 'on' : ''}
            onClick={activateDoor}
          >🚪</button>
          <button
            title="Window Tool — place hosted windows on walls"
            aria-label="Window tool"
            className={activeMode === 'build' && activeTool === 'window' ? 'on' : ''}
            onClick={activateWindow}
          >🪟</button>
        </>
      ) : (
        <>
          {/* Standard Navigation */}
          <button title="Select — left click selects a node" aria-label="Select" className={navMode === 'select' ? 'on' : ''} onClick={() => setNavMode('select')}>⌖</button>
          <button title="Orbit — right-drag or Alt+drag to orbit" aria-label="Orbit" className={navMode === 'orbit' ? 'on' : ''} onClick={() => setNavMode('orbit')}>⟳</button>
          <button title="Pan — middle-drag to pan" aria-label="Pan" className={navMode === 'pan' ? 'on' : ''} onClick={() => setNavMode('pan')}>✥</button>
        </>
      )}

      <div className="sep" />

      {/* Views */}
      <button title="Top view + Fit" aria-label="Top view" onClick={onTopView}>▦</button>
      <button
        title={cameraMode === 'perspective' ? 'Switch to orthographic' : 'Switch to perspective'}
        aria-label="Toggle camera mode"
        className={cameraMode === 'orthographic' ? 'on' : ''}
        onClick={toggleCam}
      >{cameraMode === 'orthographic' ? '▭' : '◳'}</button>
      <button title="Fit Project — frame the whole building" aria-label="Fit project" onClick={onFitProject}>⤢</button>
      <button title="Fit Selection — frame selected nodes" aria-label="Fit selection" onClick={onFitSelection}>⤡</button>

      <div className="sep" />

      {/* Display */}
      <button
        title="Guide On/Off"
        aria-label="Toggle guide"
        className={showGuides ? 'on' : ''}
        onClick={() => setShowGuides(!showGuides)}
      >▦̶</button>

      <div className="sep" />

      {/* History */}
      <button title="Reset View" aria-label="Reset view" onClick={onResetView}>⌂</button>
      <button title="Undo" aria-label="Undo" onClick={undo}>↶</button>
      <button title="Redo" aria-label="Redo" onClick={redo}>↷</button>

      {proEnabled && (
        <>
          <div className="sep" />
          <button
            title={mode === 'pro' ? 'Return to Standard Viewer' : 'Open Pascal PRO Editor'}
            aria-label={mode === 'pro' ? 'Return to Standard Viewer' : 'Open Pascal PRO Editor'}
            className={mode === 'pro' ? 'on' : ''}
            onClick={onToggleMode}
          >PRO</button>
        </>
      )}
    </div>
  );
}
