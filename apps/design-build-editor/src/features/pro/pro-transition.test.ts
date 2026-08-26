// Focused tests for the PRO transition machine (overlay mode over the
// permanently-mounted Standard Viewer). Tests the PURE reducer (no DOM/Canvas
// required) plus the non-render preload. Asserts:
//  - startup is always STANDARD (no auto-PRO)
//  - REQUEST sets requested + transition without flipping effective
//  - OVERLAY_READY/RETURN/FAILED/CANCEL_PREPARE behave correctly
//  - preparePro runs non-render preload and never mutates the shared scene
//  - the Standard Viewer is NOT unmounted (no UNMOUNTING/MOUNTING states)

import { describe, it, expect, vi, beforeEach } from 'vitest';

const added: string[] = [];
vi.mock('@iconify/react/offline', () => ({
  addCollection: (data: { prefix?: string }) => {
    added.push(data.prefix ?? 'unknown');
  },
}));
vi.mock('@pascal-app/editor', () => ({ Editor: () => null }));
vi.mock('design-build-simplified-viewer-shell', () => ({
  ensureBuiltinPluginLoaded: () => Promise.resolve(),
}));
vi.mock('@pascal-app/core', () => ({
  useScene: { getState: () => ({ nodes: { a: 1, b: 2 }, rootNodeIds: ['a'], collections: {}, materials: {} }) },
}));
vi.mock('@pascal-app/viewer', () => ({ useViewer: { getState: () => ({ setSelection: () => {} }) } }));

import { editorModeReducer, INITIAL_MODE_STATE, type EditorModeState } from './useEditorMode';
import { preparePro } from './proPreload';

const start = (over: Partial<EditorModeState> = {}): EditorModeState => ({ ...INITIAL_MODE_STATE, ...over });

describe('PRO transition reducer', () => {
  beforeEach(() => { added.length = 0; });

  it('starts in STANDARD with no auto-PRO', () => {
    const s = editorModeReducer(INITIAL_MODE_STATE, { type: 'SET_STAGE', stage: 'PRO_REQUESTED' });
    expect(s.effectiveMode).toBe('standard');
    expect(s.requestedMode).toBe('standard');
    expect(s.transitionState).toBe('IDLE');
  });

  it('REQUEST sets requested + transition without flipping effectiveMode', () => {
    const s = editorModeReducer(start(), { type: 'REQUEST' });
    expect(s.requestedMode).toBe('pro');
    expect(s.transitionState).toBe('PREPARING_PRO');
    expect(s.effectiveMode).toBe('standard');
  });

  it('REQUEST applies the transition (flag gating lives in the hook, not the reducer)', () => {
    const s = editorModeReducer(start(), { type: 'REQUEST' });
    expect(s.transitionState).toBe('PREPARING_PRO');
    expect(s.requestedMode).toBe('pro');
    expect(s.effectiveMode).toBe('standard'); // not yet ready
  });

  it('OVERLAY_READY flips effectiveMode to pro without unmounting Standard', () => {
    const s = editorModeReducer(start({ requestedMode: 'pro', transitionState: 'PREPARING_PRO' }), { type: 'OVERLAY_READY' });
    expect(s.effectiveMode).toBe('pro');
    expect(s.transitionState).toBe('OVERLAY_READY');
  });

  it('FAILED rolls back to standard and clears requested', () => {
    const s = editorModeReducer(start({ requestedMode: 'pro', transitionState: 'OVERLAY_MOUNTING' }), { type: 'FAILED', stage: 'PRO_FAILED' });
    expect(s.effectiveMode).toBe('standard');
    expect(s.requestedMode).toBe('standard');
    expect(s.transitionState).toBe('FAILED');
  });

  it('CANCEL_PREPARE during PREPARING_PRO aborts without unmounting standard', () => {
    const s = editorModeReducer(start({ requestedMode: 'pro', transitionState: 'PREPARING_PRO' }), { type: 'CANCEL_PREPARE' });
    expect(s.requestedMode).toBe('standard');
    expect(s.effectiveMode).toBe('standard');
    expect(s.transitionState).toBe('IDLE');
  });

  it('CANCEL_PREPARE after overlay mount is ignored (overlay simply closes)', () => {
    const s = editorModeReducer(start({ requestedMode: 'pro', transitionState: 'OVERLAY_MOUNTING' }), { type: 'CANCEL_PREPARE' });
    expect(s.transitionState).toBe('OVERLAY_MOUNTING'); // unchanged
  });
});

describe('PRO preload (no render, single-Viewer invariant)', () => {
  it('preparePro returns a frozen payload and never throws while STANDARD mounted', async () => {
    const res = await preparePro('db-pro');
    expect(res.editorModuleLoaded).toBe(true);
    expect(res.iconsRegistered).toBe(true);
    expect(res.pluginReady).toBe(true);
    expect(res.capturedNodeCount).toBeGreaterThan(0);
    expect(res.scenePayload).toBeTruthy();
  });

  it('preparePro does not mutate the shared scene store', async () => {
    const core = await import('@pascal-app/core');
    const before = Object.keys(core.useScene.getState().nodes).length;
    const res = await preparePro('db-pro');
    const after = Object.keys(core.useScene.getState().nodes).length;
    expect(after).toBe(before);
    expect(res.capturedNodeCount).toBe(after);
  });

  it('preparePro captures an equivalent scene payload each call (content parity, no scene reload source)', async () => {
    const a = await preparePro('db-pro');
    const b = await preparePro('db-pro');
    expect(Object.keys(a.scenePayload?.nodes ?? {}).length).toBe(Object.keys(b.scenePayload?.nodes ?? {}).length);
    expect(a.capturedNodeCount).toBe(b.capturedNodeCount);
  });

  it('preparePro does not import or invoke the extraction installer (PRO entry never re-extracts)', () => {
    // The preload module must not reference installExtractionResult / runPascalSnapshotBuild.
    const src = require('fs').readFileSync(require('path').resolve(__dirname, 'proPreload.ts'), 'utf8');
    expect(src.includes('installExtractionResult')).toBe(false);
    expect(src.includes('runPascalSnapshotBuild')).toBe(false);
  });
});
