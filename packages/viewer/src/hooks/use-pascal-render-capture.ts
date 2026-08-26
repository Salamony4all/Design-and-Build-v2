'use client'

import { sceneRegistry } from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three/webgpu'
import { type CameraState, type RenderCaptureApi, useRenderCaptureContext } from './render-capture-context'

/**
 * Must be rendered **inside** the R3F `<Canvas>` tree (pass as a child to
 * `<Viewer>`). Reads the WebGPU/WebGL context and registers a `RenderCaptureApi`
 * into the nearest `<RenderCaptureProvider>`.
 *
 * @example
 * // In ViewportCanvas.tsx:
 * <R3FViewer perf={false}>
 *   <PascalRenderCaptureRegistrar />
 * </R3FViewer>
 */
export function PascalRenderCaptureRegistrar() {
  const { gl, camera, scene, controls, advance } = useThree()
  const { register } = useRenderCaptureContext()

  useEffect(() => {
    // ── Helpers ──────────────────────────────────────────────────────────

    /** Force the FrameLimiter-managed renderer to process one frame, then resolve. */
    const renderFrame = (): Promise<void> =>
      new Promise((resolve) => {
        // advance() triggers a manual render tick (used by FrameLimiter)
        advance(performance.now() / 1000)
        // Wait two animation frames so the GPU has flushed the draw call
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })

    // ── API ───────────────────────────────────────────────────────────────

    const captureSnapshot: RenderCaptureApi['captureSnapshot'] = async () => {
      await renderFrame()
      return gl.domElement.toDataURL('image/png')
    }

    const captureDepthMask: RenderCaptureApi['captureDepthMask'] = async () => {
      const origMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
      // MeshNormalMaterial gives a coloured normal map — useful as a structural
      // skeleton that encodes surface orientation (great structural template).
      const normalMat = new THREE.MeshNormalMaterial()

      // Override only Pascal-registered meshes (not lights / helpers / etc.)
      sceneRegistry.nodes.forEach((obj) => {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            origMaterials.set(child, child.material)
            child.material = normalMat
          }
        })
      })

      await renderFrame()
      const dataUrl = gl.domElement.toDataURL('image/png')

      // Restore original materials
      sceneRegistry.nodes.forEach((obj) => {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && origMaterials.has(child)) {
            child.material = origMaterials.get(child)!
          }
        })
      })
      origMaterials.clear()
      normalMat.dispose()

      // Trigger a clean re-render so the viewport is restored visually
      advance(performance.now() / 1000)

      return dataUrl
    }

    const getCameraState: RenderCaptureApi['getCameraState'] = () => {
      const pos  = camera.position
      const quat = camera.quaternion
      const orbitTarget = (controls as any)?.target as THREE.Vector3 | undefined
      const target: [number, number, number] = orbitTarget
        ? [orbitTarget.x, orbitTarget.y, orbitTarget.z]
        : [0, 0, 0]

      return {
        position:   [pos.x,  pos.y,  pos.z],
        target,
        quaternion: [quat.x, quat.y, quat.z, quat.w],
        fov:        (camera as THREE.PerspectiveCamera).fov ?? 50,
        zoom:       camera.zoom,
      }
    }

    const restoreCameraState: RenderCaptureApi['restoreCameraState'] = (state: CameraState) => {
      camera.position.set(...state.position)
      camera.quaternion.set(...state.quaternion)
      camera.zoom = state.zoom
      camera.updateProjectionMatrix()

      const orbitTarget = (controls as any)?.target as THREE.Vector3 | undefined
      if (orbitTarget) {
        orbitTarget.set(...state.target)
        ;(controls as any).update?.()
      }

      advance(performance.now() / 1000)
    }

    register({ captureSnapshot, captureDepthMask, getCameraState, restoreCameraState })

    // Unregister on unmount
    return () => register(null)
  }, [gl, camera, scene, controls, advance, register])

  return null
}
