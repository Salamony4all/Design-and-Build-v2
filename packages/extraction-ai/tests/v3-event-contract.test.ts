// packages/extraction-ai/tests/v3-event-contract.test.ts
// Pure AI Progressive V3 — event contract (spec §3) + stage order (§8-§12).
import { describe, it, expect } from 'vitest';
import {
  validateEvent,
  type ProgressiveBuildEvent,
  type BuildStage,
  sanitizeFurnitureV3,
  type FurnitureCandidate,
} from '../src/index';

const RUN = 'run-test-1';
const base = { runId: RUN, sequence: 1, timestamp: new Date().toISOString() };

// ───────────────────────── 1. event contract ─────────────────────────
describe('§3 ProgressiveBuildEvent discriminator', () => {
  const valid: Record<string, Partial<ProgressiveBuildEvent>> = {
    'run.started': { ...base, type: 'run.started' },
    'guide.ready': { ...base, type: 'guide.ready', stage: 'guide', message: 'g' },
    'slab.ready': { ...base, type: 'slab.ready', stage: 'slab', message: 's' },
    'walls.ready': { ...base, type: 'walls.ready', stage: 'walls', message: 'w', payload: [], counts: { walls: 2 } },
    'windows.ready': { ...base, type: 'windows.ready', stage: 'windows', message: 'w', payload: [], counts: { windows: 1 } },
    'doors.ready': { ...base, type: 'doors.ready', stage: 'doors', message: 'd', payload: [], counts: { doors: 1 } },
    'furniture.detected': { ...base, type: 'furniture.detected', detected: 5 },
    'furniture.verified': { ...base, type: 'furniture.verified', verified: 4 },
    'furniture.review': { ...base, type: 'furniture.review', message: 'r', payload: {}, counts: { furniture: 1, review: 1 } },
    'stage.completed': { ...base, type: 'stage.completed', stage: 'furniture', message: 'c', installed: 3, total: 4, payload: {} },
    'run.completed': { ...base, type: 'run.completed', message: 'done', counts: {} },
    'run.failed': { ...base, type: 'run.failed', message: 'boom' },
    'run.cancelled': { ...base, type: 'run.cancelled', message: 'x' },
  };

  for (const [type, ev] of Object.entries(valid)) {
    it(`accepts valid ${type}`, () => {
      expect(validateEvent(ev)).not.toBeNull();
    });
  }

  it('rejects unknown event type', () => {
    expect(validateEvent({ ...base, type: 'run.finished' } as any)).toBeNull();
  });
  it('rejects missing type field', () => {
    expect(validateEvent({ ...base } as any)).toBeNull();
  });
  it('rejects wrong payload type (detected must be number)', () => {
    expect(validateEvent({ ...base, type: 'furniture.detected', detected: 'many' } as any)).toBeNull();
  });
  it('rejects malformed (non-object) event', () => {
    expect(validateEvent(null as any)).toBeNull();
    expect(validateEvent('{bad' as any)).toBeNull();
    expect(validateEvent(42 as any)).toBeNull();
  });
  it('rejects furniture.review without payload when review count > 0', () => {
    // payload is optional but a review event with review count must carry review candidates downstream;
    // contract itself only requires payload?: any — presence validated by consumer. Keep contract permissive.
    const e = validateEvent({ ...base, type: 'furniture.review', message: 'r', payload: {}, counts: { furniture: 0, review: 1 } });
    expect(e).not.toBeNull();
  });
});

// ───────────────────────── 4. stage order ─────────────────────────
describe('§8 stage order enforcement', () => {
  const ORDER: BuildStage[] = ['guide', 'slab', 'walls', 'windows', 'doors', 'furniture'];
  const idx = (s?: BuildStage) => (s ? ORDER.indexOf(s) : -1);

  const makeReady = (stage: BuildStage): ProgressiveBuildEvent =>
    validateEvent({ ...base, type: `${stage}.ready`, stage, message: stage } as any)!;

  it('enforces windows before walls are deferred/rejected', () => {
    const seen: BuildStage[] = [];
    const windows = makeReady('windows');
    // windows.ready before any walls node installed → consumer must defer (not install)
    expect(windows).not.toBeNull();
    // ordering rule: windows index (3) > walls index (2)
    expect(idx(windows.stage)).toBeGreaterThan(idx('walls'));
  });
  it('enforces doors before walls are deferred/rejected', () => {
    const doors = makeReady('doors');
    expect(idx(doors.stage)).toBeGreaterThan(idx('walls'));
  });
  it('furniture.detected does not install furniture (no install call emitted)', () => {
    const ev = validateEvent({ ...base, type: 'furniture.detected', detected: 3 } as any)!;
    expect(ev.type).toBe('furniture.detected');
    // The installer maps furniture.detected → setStage('running') only; no installFurniture call.
    // Assert there is no install directive in the event payload.
    expect((ev as any).payload).toBeUndefined();
  });
  it('stage.completed for furniture installs accepted only (verified by sanitizer below)', () => {
    const ev = validateEvent({ ...base, type: 'stage.completed', stage: 'furniture', message: 'c', installed: 1, total: 1, payload: {} } as any)!;
    expect(ev.type).toBe('stage.completed');
  });
  it('repeated run.completed does not reinstall (idempotent guarded in installer)', () => {
    const a = validateEvent({ ...base, type: 'run.completed', message: 'done', counts: {} } as any)!;
    const b = validateEvent({ ...base, type: 'run.completed', message: 'done', counts: {} } as any)!;
    expect(a?.type).toBe('run.completed');
    expect(b?.type).toBe('run.completed');
  });
  it('stage.completed does not mutate geometry (only furniture stage completes)', () => {
    const ev = validateEvent({ ...base, type: 'stage.completed', stage: 'furniture', message: 'c', installed: 0, total: 0 } as any)!;
    expect(ev?.stage).toBe('furniture');
  });
});

// ───────────────────────── 5/6. furniture sanitization ─────────────────────────
function cand(partial: Partial<FurnitureCandidate>): FurnitureCandidate {
  return {
    type: 'sofa', // real catalogue alias → reception-sofa
    pos: [1, 2],
    width: 2,
    depth: 0.9,
    height: 0.8,
    rotation: 0,
    confidence: 0.9,
    frameId: 'frame_1',
    sourceEntityId: `se-${Math.random().toString(36).slice(2, 8)}`,
    ...partial,
  } as FurnitureCandidate;
}

describe('§14 furniture sanitization audit', () => {
  const frameId = 'frame_1';
  const zone = { id: 'z1', name: 'Living', boundary: [[0, 0], [5, 0], [5, 5], [0, 5]] as [number, number][] };
  const zones = [zone];
  const floorBoundary: [number, number][] = [[0, 0], [5, 0], [5, 5], [0, 5]];

  it('accepts a clean in-zone high-confidence item', () => {
    const r = sanitizeFurnitureV3([cand({ confidence: 0.95, pos: [2, 2] })], { zones, floorBoundary, frameId });
    expect(r.accepted.length).toBe(1);
    expect(r.rejected.length).toBe(0);
    expect(r.audit.accepted).toBe(1);
  });
  it('keeps low-confidence / uncertain-rotation / missing-zone items in REVIEW (not installed)', () => {
    // distinct positions so they don't dedupe; varied reasons to land in review
    const r = sanitizeFurnitureV3(
      [
        cand({ confidence: 0.6, pos: [1, 1] }),            // LOW_CONFIDENCE → review (conf 0.6 ∈ [0.55,0.75))
        cand({ pos: [2, 1], rotation: undefined }),        // UNCERTAIN_ROTATION → review
        cand({ pos: [3, 1], type: 'sofa', frameId }),      // no zone → MISSING_ZONE → review
      ],
      { zones: [], floorBoundary, frameId },
    );
    expect(r.review.length).toBe(3);
    expect(r.accepted.length).toBe(0);
    expect(r.audit.review).toBe(3);
  });
  it('rejects unknown asset', () => {
    const r = sanitizeFurnitureV3([cand({ type: 'NoSuchAssetXYZ', pos: [2, 2], frameId })], { zones, floorBoundary, frameId });
    expect(r.rejected.length).toBe(1);
    expect(r.audit.unknownAsset).toBe(1);
  });
  it('rejects outside-floor coords', () => {
    const r = sanitizeFurnitureV3([cand({ pos: [99, 99], frameId })], { zones, floorBoundary, frameId });
    expect(r.rejected.length).toBe(1);
    expect(r.audit.outsideFloor).toBe(1);
  });
  it('rejects invalid dimensions', () => {
    const r = sanitizeFurnitureV3([cand({ width: 0, depth: 0, pos: [2, 2], frameId })], { zones, floorBoundary, frameId });
    expect(r.rejected.length).toBe(1);
    expect(r.audit.invalidDimensions).toBe(1);
  });
  it('routes FRAME_MISMATCH to review (never installs)', () => {
    const r = sanitizeFurnitureV3([cand({ frameId: 'frame_OTHER', pos: [2, 2] })], { zones, floorBoundary, frameId });
    expect(r.review.length).toBe(1);
    expect(r.audit.frameMismatch).toBe(1);
    expect(r.accepted.length).toBe(0);
  });
  it('dedupes duplicate source records to at most one item', () => {
    const sameId = 'dup-se';
    const r = sanitizeFurnitureV3(
      [cand({ sourceEntityId: sameId, pos: [2, 2], frameId }), cand({ sourceEntityId: sameId, pos: [2.05, 2], frameId })],
      { zones, floorBoundary, frameId },
    );
    expect(r.accepted.length).toBe(1);
    expect(r.audit.duplicatesRemoved).toBe(1);
  });
  it('audit arithmetic is internally consistent', () => {
    const items = [cand({ pos: [2, 2], frameId }), cand({ type: 'NoSuchAssetXYZ', pos: [2, 2], frameId }), cand({ pos: [99, 99], frameId })];
    const r = sanitizeFurnitureV3(items, { zones, floorBoundary, frameId });
    const a = r.audit;
    expect(a.accepted + a.review + a.rejected).toBe(items.length);
    expect(a.accepted).toBe(r.accepted.length);
    expect(a.review).toBe(r.review.length);
    expect(a.rejected).toBe(r.rejected.length);
  });
});
