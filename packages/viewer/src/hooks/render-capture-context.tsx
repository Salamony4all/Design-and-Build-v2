'use client'

import React, { createContext, useContext, useMemo, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CameraState {
  position: [number, number, number]
  target: [number, number, number]
  quaternion: [number, number, number, number]
  fov: number
  zoom: number
}

export interface RenderCaptureApi {
  /** Renders one frame and returns the canvas as a base64 PNG data-URL. */
  captureSnapshot: () => Promise<string>
  /**
   * Temporarily replaces all registered Pascal meshes with a normal-map
   * material, captures the canvas, restores originals, then resolves with
   * the depth/structure mask as a base64 PNG data-URL.
   */
  captureDepthMask: () => Promise<string>
  /** Returns current camera position, orientation, and target. */
  getCameraState: () => CameraState | null
  /** Repositions the camera to a previously recorded state. */
  restoreCameraState: (state: CameraState) => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface RenderCaptureContextValue {
  /** Called by the inner Canvas registrar to publish its API. */
  register: (api: RenderCaptureApi | null) => void
  /** Called by external consumers (e.g. ChatBox) to read the API. */
  getApi: () => RenderCaptureApi | null
}

const RenderCaptureContext = createContext<RenderCaptureContextValue | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * Wrap your editor shell with this provider so that both the in-Canvas
 * registrar and out-of-Canvas consumers share the same API reference.
 *
 * @example
 * <RenderCaptureProvider>
 *   <ViewportCanvas />   {/* contains PascalRenderCaptureRegistrar inside R3FViewer *\/}
 *   <ChatBox />          {/* uses useRenderCapture() *\/}
 * </RenderCaptureProvider>
 */
export function RenderCaptureProvider({ children }: { children: React.ReactNode }) {
  const apiRef = useRef<RenderCaptureApi | null>(null)

  const value = useMemo<RenderCaptureContextValue>(
    () => ({
      register: (api) => { apiRef.current = api },
      getApi:   ()    => apiRef.current,
    }),
    [],
  )

  return (
    <RenderCaptureContext.Provider value={value}>
      {children}
    </RenderCaptureContext.Provider>
  )
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Used internally by `PascalRenderCaptureRegistrar` to register the API.
 * @internal
 */
export function useRenderCaptureContext(): RenderCaptureContextValue {
  const ctx = useContext(RenderCaptureContext)
  if (!ctx) {
    throw new Error(
      '[RenderCapture] useRenderCaptureContext must be called inside <RenderCaptureProvider>',
    )
  }
  return ctx
}

/**
 * Used by external components (ChatBox, orchestrator) to access the
 * capture API populated by the in-Canvas registrar.
 *
 * @returns a getter `() => RenderCaptureApi | null`
 */
export function useRenderCapture(): () => RenderCaptureApi | null {
  const ctx = useContext(RenderCaptureContext)
  if (!ctx) {
    throw new Error(
      '[RenderCapture] useRenderCapture must be called inside <RenderCaptureProvider>',
    )
  }
  return ctx.getApi
}
