/**
 * 2.5D Stamping Pipeline orchestrator — ties the phases together.
 *
 *   DrawingExposure (Phase 1/2)
 *     -> Camera Focus Test (Phase 3)  [hard gate; stop if it fails]
 *     -> Direct Signature Stamping (Phase 4)
 *     -> Match States (Phase 5)
 *     -> Pascal Semantic JSON (Phase 6)
 *     -> Progressive Build + overlay (Phase 7)
 */
import { buildDrawingExposure, type DrawingExposure, type ParserResultLike } from './drawing-exposure';
import { runCameraFocus, type FocusResult, type CameraFocusOptions } from './camera-focus';
import { stampScene, renderSceneOverlay, type PascalScene, type StampInput } from './pascal-stamping';
import type { GuideTraceGraph } from './guide-trace-types';

export interface StampingPipelineInput {
  sourceFileUrl: string;
  parser: ParserResultLike;
  graph: GuideTraceGraph;
  imageWidthPx?: number;
  imageHeightPx?: number;
  pageIndex?: number;
  minWallConfidence?: number;
  focusOptions?: CameraFocusOptions;
  /**
   * Sampled PDF vector points (MediaBox pts) for the camera focus test. These come from
   * the parser's wall `sourcePdf` coordinates — the single source of truth, never recomputed.
   */
  focusSamplePoints?: Array<[number, number]>;
}

export interface StampingPipelineResult {
  exposure: DrawingExposure;
  focus: FocusResult;
  focusPassed: boolean;
  scene: PascalScene | null; // null when focus gate fails (no signature translation)
  overlaySvg: string | null;
}

export function runStampingPipeline(input: StampingPipelineInput): StampingPipelineResult {
  const exposure = buildDrawingExposure({
    sourceFileUrl: input.sourceFileUrl,
    parser: input.parser,
    imageWidthPx: input.imageWidthPx,
    imageHeightPx: input.imageHeightPx,
    pageIndex: input.pageIndex,
  });

  const focus = runCameraFocus(
    exposure,
    input.focusSamplePoints && input.focusSamplePoints.length ? input.focusSamplePoints : [],
    input.focusOptions,
  );

  if (!focus.passed) {
    // Hard focus gate: stop signature translation.
    return { exposure, focus, focusPassed: false, scene: null, overlaySvg: null };
  }

  const stamp: StampInput = {
    exposure,
    graph: input.graph,
    sourceFileUrl: input.sourceFileUrl,
    minWallConfidence: input.minWallConfidence,
  };
  const scene = stampScene(stamp);
  const overlaySvg = renderSceneOverlay(scene, exposure);
  return { exposure, focus, focusPassed: true, scene, overlaySvg };
}
