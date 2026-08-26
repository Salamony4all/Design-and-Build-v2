// features/pro/useEditorMode.ts
//
// Editor mode state for the optional official Pascal PRO editing mode.
//
// STRATEGY (PRO OVERLAY MODE — current production path):
//   PRO is an OVERLAY over the permanently-mounted Standard PascalViewerShell.
//   The Standard Viewer (single R3F Canvas), scene store (useScene), viewer
//   store (useViewer) and camera are NEVER unmounted or re-created. PRO panels
//   (hierarchy, official Inspector, toolbars) slide in over the working model
//   and bind to the SAME shared stores, so selection / commands / history flow
//   through one system. CanvasCount is invariant at 1.
//
// The previous "atomic shell swap" (unmount Standard -> mount monolithic
// Editor with its own Canvas) is RETIRED from production and kept only behind
// NEXT_PUBLIC_PASCAL_FULL_EDITOR_EXPERIMENTAL (default false) as a standalone
// development / upstream-reference path.
//
// State ownership:
//   - effectiveMode: what is currently RENDERED. 'standard' until PRO_OVERLAY_READY.
//   - requestedMode: what the user asked for ('pro' only via explicit click).
//   - transitionState: the live handoff machine.
//   - proStage: visible stage ledger.
//
// PRO is gated by NEXT_PUBLIC_PASCAL_PRO_EDITOR and degrades to STANDARD on any
// failure. Startup is ALWAYS STANDARD; a stored 'pro' is a non-authoritative
// hint only (never auto-applied after hydration).
//
// The transition logic is a PURE reducer (editorModeReducer) so it is unit-tested
// without a DOM. This module holds ONLY UI mode/transition state — never scene
// nodes, never a second Editor store, never project ownership.

'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';

export type EditorMode = 'standard' | 'pro';
export type ProStatus = 'idle' | 'requested' | 'loading' | 'ready' | 'failed';

export type TransitionState =
  | 'IDLE'
  | 'PREPARING_PRO'
  | 'PRO_PREPARED'
  | 'OVERLAY_MOUNTING'
  | 'OVERLAY_READY'
  | 'RETURNING_TO_STANDARD'
  | 'FAILED';

export const PRO_STAGES = [
  'PRO_REQUESTED',
  'PRO_IMPORTING',
  'PRO_IMPORT_READY',
  'PRO_ICONS_REGISTERING',
  'PRO_ICONS_READY',
  'PRO_PLUGIN_LOADING',
  'PRO_PLUGIN_READY',
  'PRO_SCENE_CAPTURING',
  'PRO_SCENE_CAPTURED',
  'PRO_PROJECT_ADAPTING',
  'PRO_PROJECT_READY',
  'PRO_OVERLAY_MOUNTED',
  'PRO_OVERLAY_READY',
  'PRO_FAILED',
  'PRO_TIMEOUT',
] as const;
export type ProStage = (typeof PRO_STAGES)[number];

const SESSION_KEY = 'db:editorMode';
const FLAG_ON = process.env.NEXT_PUBLIC_PASCAL_PRO_EDITOR === 'true';
// Monolithic full-Editor swap is retired from production. Kept only as a
// development / upstream-reference path behind this flag (default off).
export const FULL_EDITOR_EXPERIMENTAL =
  process.env.NEXT_PUBLIC_PASCAL_FULL_EDITOR_EXPERIMENTAL === 'true';

export interface EditorModeState {
  effectiveMode: EditorMode;
  requestedMode: EditorMode;
  transitionState: TransitionState;
  proStatus: ProStatus;
  proStage: ProStage;
}

export type EditorModeAction =
  | { type: 'REQUEST' }
  | { type: 'RETURN' }
  | { type: 'CANCEL_PREPARE' }
  | { type: 'OVERLAY_READY' }
  | { type: 'FAILED'; stage?: ProStage }
  | { type: 'SET_STAGE'; stage: ProStage }
  | { type: 'SET_TRANSITION'; state: TransitionState };

export const INITIAL_MODE_STATE: EditorModeState = {
  effectiveMode: 'standard',
  requestedMode: 'standard',
  transitionState: 'IDLE',
  proStatus: 'idle',
  proStage: 'PRO_REQUESTED',
};

export function editorModeReducer(state: EditorModeState, action: EditorModeAction): EditorModeState {
  switch (action.type) {
    case 'REQUEST':
      return {
        ...state,
        requestedMode: 'pro',
        transitionState: 'PREPARING_PRO',
        proStatus: 'requested',
        proStage: 'PRO_REQUESTED',
      };
    case 'OVERLAY_READY':
      // PRO overlay mounted over the still-live Standard Viewer.
      return {
        ...state,
        effectiveMode: 'pro',
        proStatus: 'ready',
        transitionState: 'OVERLAY_READY',
        proStage: 'PRO_OVERLAY_READY',
      };
    case 'FAILED':
      return {
        ...state,
        effectiveMode: 'standard',
        requestedMode: 'standard',
        proStatus: 'failed',
        transitionState: 'FAILED',
        proStage: action.stage ?? 'PRO_FAILED',
      };
    case 'RETURN':
      // Keep the Standard Viewer mounted; just stop overlaying PRO panels.
      return {
        ...state,
        effectiveMode: 'standard',
        requestedMode: 'standard',
        proStatus: 'idle',
        transitionState: 'IDLE',
        proStage: 'PRO_REQUESTED',
      };
    case 'CANCEL_PREPARE':
      if (state.transitionState === 'PREPARING_PRO' || state.transitionState === 'PRO_PREPARED') {
        return { ...state, requestedMode: 'standard', proStatus: 'idle', transitionState: 'IDLE', proStage: 'PRO_REQUESTED' };
      }
      return state;
    case 'SET_STAGE':
      return { ...state, proStage: action.stage };
    case 'SET_TRANSITION':
      return { ...state, transitionState: action.state };
    default:
      return state;
  }
}

export interface EditorModeApi extends EditorModeState {
  proEnabled: boolean;
  fullEditorExperimental: boolean;
  recentlyUsedPro: boolean;
  requestPro: () => void;
  returnToStandard: () => void;
  cancelProPrepare: () => void;
  markProOverlayReady: () => void;
  markProFailed: (stage?: ProStage) => void;
  setProStage: (stage: ProStage) => void;
  setTransitionState: (s: TransitionState) => void;
}

export function useEditorMode(): EditorModeApi {
  const [state, dispatch] = useReducer(editorModeReducer, INITIAL_MODE_STATE);
  const [recentlyUsedPro, setRecentlyUsedPro] = useState(false);

  useEffect(() => {
    if (!FLAG_ON) return;
    try {
      if (window.sessionStorage.getItem(SESSION_KEY) === 'pro') setRecentlyUsedPro(true);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPro = useCallback(() => {
    if (!FLAG_ON) return;
    try {
      window.sessionStorage.setItem(SESSION_KEY, 'pro');
      setRecentlyUsedPro(true);
    } catch {
      /* ignore */
    }
    dispatch({ type: 'REQUEST' });
  }, []);

  const returnToStandard = useCallback(() => {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    dispatch({ type: 'RETURN' });
  }, []);

  const cancelProPrepare = useCallback(() => {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    dispatch({ type: 'CANCEL_PREPARE' });
  }, []);

  const markProOverlayReady = useCallback(() => dispatch({ type: 'OVERLAY_READY' }), []);
  const markProFailed = useCallback((stage?: ProStage) => dispatch({ type: 'FAILED', stage }), []);
  const setProStage = useCallback((stage: ProStage) => dispatch({ type: 'SET_STAGE', stage }), []);
  const setTransitionState = useCallback(
    (s: TransitionState) => dispatch({ type: 'SET_TRANSITION', state: s }),
    [],
  );

  return {
    ...state,
    proEnabled: FLAG_ON,
    fullEditorExperimental: FULL_EDITOR_EXPERIMENTAL,
    recentlyUsedPro,
    requestPro,
    returnToStandard,
    cancelProPrepare,
    markProOverlayReady,
    markProFailed,
    setProStage,
    setTransitionState,
  };
}
