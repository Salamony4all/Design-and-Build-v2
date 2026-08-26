// apps/design-build-editor/src/harness/v3-feature-flag.test.ts
// Pure AI Progressive V3 — feature-flag + provider-isolation tests (spec §17, §19).
// Tests BOTH the pure dispatch decision (resolveAiExtractionPlan) AND the JSX render
// condition. The page wires <ProgressiveBuildV3 active={progActive && PROGRESSIVE_ENABLED} />
// and the component returns null when !active, so the render condition is exactly
// resolveAiExtractionPlan(...).progressiveV3Rendered && progActive — asserted below.
import { describe, it, expect } from 'vitest';
import { resolveAiExtractionPlan } from './pascal-progressive-builder';

describe('§17/§19 feature-flag + provider isolation — dispatch decision', () => {
  it('A. Pure AI + progressive flag ON → V3 route + V3 panel, V2 not used', () => {
    const plan = resolveAiExtractionPlan('gemini', true);
    expect(plan.progressiveRouteCalled).toBe(true);
    expect(plan.progressiveV3Rendered).toBe(true);
    expect(plan.v2RouteCalled).toBe(false);
    expect(plan.aiSceneInstallerCalled).toBe(true);
    expect(plan.isPureMupdf).toBe(false);
  });

  it('B. Pure AI + progressive flag OFF → V2 workflow, no V3', () => {
    const plan = resolveAiExtractionPlan('gemini', false);
    expect(plan.progressiveRouteCalled).toBe(false);
    expect(plan.progressiveV3Rendered).toBe(false);
    expect(plan.v2RouteCalled).toBe(true);
    expect(plan.aiSceneInstallerCalled).toBe(true);
    expect(plan.isPureMupdf).toBe(false);
  });

  it('C. Pure MuPDF selected → no AI route/installer/panel', () => {
    const plan = resolveAiExtractionPlan('mupdf', true);
    expect(plan.progressiveRouteCalled).toBe(false);
    expect(plan.v2RouteCalled).toBe(false);
    expect(plan.aiSceneInstallerCalled).toBe(false);
    expect(plan.progressiveV3Rendered).toBe(false);
    expect(plan.isPureMupdf).toBe(true);
    // No dual installation: mupdf route and AI installer are mutually exclusive.
    expect(plan.aiSceneInstallerCalled && plan.isPureMupdf).toBe(false);
  });
});

describe('§19 ProgressiveBuildV3 render condition (active && flag)', () => {
  // Mirrors the page wiring: <ProgressiveBuildV3 active={progActive && PROGRESSIVE_ENABLED} />
  // and the component returning null when !active.
  const renders = (progActive: boolean, flag: boolean) => progActive && resolveAiExtractionPlan('gemini', flag).progressiveV3Rendered;

  it('renders when progActive && flag ON', () => {
    expect(renders(true, true)).toBe(true);
  });
  it('does NOT render when progActive false (even if flag ON)', () => {
    expect(renders(false, true)).toBe(false);
  });
  it('does NOT render when flag OFF (even if progActive)', () => {
    expect(renders(true, false)).toBe(false);
  });
  it('does NOT render under Pure MuPDF regardless of flag', () => {
    expect(resolveAiExtractionPlan('mupdf', true).progressiveV3Rendered).toBe(false);
    expect(resolveAiExtractionPlan('mupdf', false).progressiveV3Rendered).toBe(false);
  });
});
