import { describe, it, expect } from 'vitest';
import { applyGuideReadiness, guideSignalApplicable, type StageCardState } from './ProgressiveBuildV3';

const base = (): StageCardState => ({
  status: 'pending',
  installed: 0,
  total: 0,
  review: 0,
});

describe('truthful Guide lifecycle (Phase A, Step 10)', () => {
  it('guide.ready (node-created) does NOT mark the stage completed', () => {
    const next = applyGuideReadiness(base(), 'node-created', 1000);
    expect(next.status).toBe('running');
    expect(next.lifecycle).toBe('node-created');
    expect(next.completedAt).toBeUndefined();
  });

  it('texture-ready is the only signal that completes the Guide', () => {
    const created = applyGuideReadiness(base(), 'node-created', 1000);
    const ready = applyGuideReadiness(created, 'texture-ready', 2000);
    expect(ready.status).toBe('completed');
    expect(ready.lifecycle).toBe('texture-ready');
    expect(ready.completedAt).toBe(2000);
    expect(ready.installed).toBe(1);
  });

  it('failed does not retroactively become completed', () => {
    const created = applyGuideReadiness(base(), 'node-created', 1000);
    const failed = applyGuideReadiness(created, 'failed', 1500);
    expect(failed.status).toBe('failed');
    expect(failed.lifecycle).toBe('failed');
    expect(failed.completedAt).toBeUndefined();
  });

  it('texture-ready after failed stays failed (no resurrection)', () => {
    const failed = applyGuideReadiness(base(), 'failed', 1500);
    const ready = applyGuideReadiness(failed, 'texture-ready', 2000);
    expect(ready.status).toBe('failed');
  });

  it('node-created preserves a previously set total count', () => {
    const withTotal = { ...base(), total: 1 };
    const next = applyGuideReadiness(withTotal, 'node-created', 1000);
    expect(next.total).toBe(1);
    expect(next.status).toBe('running');
  });
});

describe('Guide signal run-scoping (Phase A, Step 3 & 4)', () => {
  const ev = (runId?: string, guideId = 'g1') => ({ runId, guideId });
  const ctx = (over: Partial<{ activeRunId: string | null; activeGuideId: string | null; cancelled: boolean; alreadyResolved: boolean }> = {}) => ({
    activeRunId: 'run-A',
    activeGuideId: 'g1',
    cancelled: false,
    alreadyResolved: false,
    ...over,
  });

  it('accepts a matching run/guide that is not cancelled or resolved', () => {
    expect(guideSignalApplicable(ev('run-A', 'g1'), ctx())).toBe(true);
  });

  it('ignores a callback from a different run', () => {
    expect(guideSignalApplicable(ev('run-B', 'g1'), ctx())).toBe(false);
  });

  it('ignores a callback for a different guide id', () => {
    expect(guideSignalApplicable(ev('run-A', 'g2'), ctx())).toBe(false);
  });

  it('ignores a callback after the run was cancelled', () => {
    expect(guideSignalApplicable(ev('run-A', 'g1'), ctx({ cancelled: true }))).toBe(false);
  });

  it('ignores a duplicate (already resolved) callback', () => {
    expect(guideSignalApplicable(ev('run-A', 'g1'), ctx({ alreadyResolved: true }))).toBe(false);
  });

  it('guarantees late ready after failure is not applied (alreadyResolved covers it)', () => {
    // After a failure the stage resolved; a late ready must be rejected.
    expect(guideSignalApplicable(ev('run-A', 'g1'), ctx({ alreadyResolved: true }))).toBe(false);
  });
});

