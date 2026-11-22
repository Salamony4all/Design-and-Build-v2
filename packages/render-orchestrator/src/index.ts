// design-build-render-orchestrator
// Nano Banana rendering orchestration, behind a neutral service interface.
// Preserves: intent classification, design change interpretation, camera snapshot,
// viewport capture, cached conversational context, depth-mask generation, scene-description compilation,
// provider configuration, photorealistic render request, render-response parsing,
// conversational iteration, PNG preview and download.

import type { ProviderRegistryState } from 'design-build-provider-registry';

export interface CameraSnapshot {
  position: [number, number, number];
  target: [number, number, number];
  fovDeg: number;
  projection: 'perspective' | 'orthographic';
}

export interface RenderRequest {
  prompt: string;
  viewportCapture?: string; // data URL (PNG) of current viewport
  camera?: CameraSnapshot;
  context?: string;
  renderProviderId: string;
  quality?: 'draft' | 'standard' | 'photoreal';
  seed?: number;
}

export interface RenderIterationRequest {
  prompt: string;
  viewportCapture?: string;
  camera?: CameraSnapshot;
  context?: string;
}

export interface RenderResult {
  renderId: string;
  status: 'queued' | 'rendering' | 'done' | 'error';
  progress: number; // 0..1
  previewUrl?: string;
  downloadUrl?: string;
  snapshotUrl?: string;
  planUrl?: string;
  message?: string;
  providerId: string;
  /** Human model name, e.g. "Nano Banana 2 Lite". */
  modelLabel?: string;
  /** Style preset id used for the render. */
  styleId?: string;
  /** 0..1 share of the model's edges found in the render (geometry check). */
  fidelity?: number;
  /** MIME type of previewUrl when it is a data URL. */
  mimeType?: string;
  /** Transparent PNG of the model's edges, aligned with snapshot and render. */
  overlayUrl?: string;
}

export interface RenderService {
  render(request: RenderRequest): Promise<RenderResult>;
  iterate(renderId: string, request: RenderIterationRequest): Promise<RenderResult>;
}

export interface RenderOrchestratorHooks {
  classifyIntent(prompt: string): 'new-render' | 'design-change' | 'follow-up';
  compileSceneDescription(context: string): string;
  generateDepthMask(viewport: string): Promise<string>;
}

export function createNeutralRenderService(_state: ProviderRegistryState): RenderService {
  return {
    async render(): Promise<RenderResult> {
      throw new Error('RenderService not connected in scaffold checkpoint');
    },
    async iterate(): Promise<RenderResult> {
      throw new Error('RenderService not connected in scaffold checkpoint');
    },
  };
}
