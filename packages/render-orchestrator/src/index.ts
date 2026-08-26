// design-build-render-orchestrator
// Nano Banana rendering orchestration, behind a neutral service interface.
// Preserves (do NOT rewrite during scaffold): intent classification, design
// change interpretation, camera snapshot, viewport capture, cached conversational
// context, depth-mask generation, scene-description compilation, provider
// configuration, photorealistic render request, render-response parsing,
// conversational iteration, PNG preview and download.
// In the checkpoint this exposes the interface + neutral types only.

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
  message?: string;
  providerId: string;
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
