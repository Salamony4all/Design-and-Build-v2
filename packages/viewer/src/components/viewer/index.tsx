'use client'

import {
  CeilingSystem,
  DoorSystem,
  FenceSystem,
  ItemSystem,
  RoofSystem,
  SlabSystem,
  StairSystem,
  WallSystem,
  WindowSystem,
  useScene,
  sceneRegistry,
} from '@pascal-app/core'
import { Bvh, OrbitControls, TransformControls } from '@react-three/drei'
import { Canvas, extend, type ThreeToJSXElements, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three/webgpu'
import '../../lib/suppress-three-clock-warning'
import useViewer from '../../store/use-viewer'
import { GuideSystem } from '../../systems/guide/guide-system'
import { ItemLightSystem } from '../../systems/item-light/item-light-system'
import { LevelSystem } from '../../systems/level/level-system'
import { ScanSystem } from '../../systems/scan/scan-system'
import { WallCutout } from '../../systems/wall/wall-cutout'
import { ZoneSystem } from '../../systems/zone/zone-system'
import { SceneRenderer } from '../renderers/scene-renderer'
import FrameLimiter from './frame-limiter'
import { Lights } from './lights'
import { PerfMonitor } from './perf-monitor'
import PostProcessing, { DEFAULT_HOVER_STYLES, type HoverStyles } from './post-processing'
import { SelectionManager } from './selection-manager'
import { ViewerCamera } from './viewer-camera'
import { WalkthroughControls } from './walkthrough-controls'
import { Grid } from './grid'

function AnimatedBackground({ isDark }: { isDark: boolean }) {
  const targetColor = useMemo(() => new THREE.Color(), [])
  const initialized = useRef(false)

  useFrame(({ scene }, delta) => {
    const dt = Math.min(delta, 0.1) * 4
    const targetHex = isDark ? '#1f2433' : '#ffffff'

    if (!(scene.background && scene.background instanceof THREE.Color)) {
      scene.background = new THREE.Color(targetHex)
      initialized.current = true
      return
    }

    if (!initialized.current) {
      scene.background.set(targetHex)
      initialized.current = true
      return
    }

    targetColor.set(targetHex)
    scene.background.lerp(targetColor, dt)
  })

  return null
}

declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as any)

/**
 * Monitors the WebGPU device for loss events and logs them.
 * WebGPU device loss can happen when:
 *  - Tab is backgrounded and OS reclaims GPU
 *  - Driver crash or GPU reset
 *  - Browser security policy kills the context
 */
type WebGPUDeviceLossInfo = {
  reason?: string
  message?: string
}

type WebGPUDeviceLike = {
  lost: Promise<WebGPUDeviceLossInfo>
}

function GPUDeviceWatcher() {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const backend = (gl as any).backend
    const device = backend?.device as WebGPUDeviceLike | undefined

    if (!device) return

    device.lost.then((info: WebGPUDeviceLossInfo) => {
      console.error(
        `[viewer] WebGPU device lost: reason="${info.reason ?? 'unknown'}", message="${info.message ?? ''}". ` +
          'The page must be reloaded to recover the GPU context.',
      )
    })
  }, [gl])

  return null
}

function ViewerNavigationControls() {
  const invalidate = useThree((s) => s.invalidate)
  return (
    <OrbitControls
      makeDefault
      enableDamping={false}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.PAN,
      }}
      onChange={() => invalidate()}
    />
  )
}

interface ViewerProps {
  children?: React.ReactNode
  hoverStyles?: HoverStyles
  selectionManager?: 'default' | 'custom'
  perf?: boolean
}

const Viewer: React.FC<ViewerProps> = ({
  children,
  hoverStyles = DEFAULT_HOVER_STYLES,
  selectionManager = 'default',
  perf = false,
}) => {
  const theme = useViewer((state) => state.theme)
  const walkthroughMode = useViewer((state) => state.walkthroughMode)
  const proMode = useViewer((state) => state.proMode)
  return (
    <Canvas
      camera={{ position: [50, 50, 50], fov: 50 }}
      className={`transition-colors duration-700 ${theme === 'dark' ? 'bg-[#1f2433]' : 'bg-[#fafafa]'}`}
      dpr={[1, 1.5]}
      frameloop="never"
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer(props as any)
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 0.9
        // Awaiting init() is required when the browser falls back to the
        // WebGL2 backend (Safari without the WebGPU flag, older Chrome on
        // machines without a WebGPU device). In native WebGPU mode the
        // init resolves almost instantly. Without this await, the first
        // render throws "Renderer: .render() called before the backend is
        // initialized" from the post-processing fallback path.
        await renderer.init()
        return renderer
      }}
      resize={{
        debounce: 100,
      }}
      shadows={{
        type: THREE.PCFShadowMap,
        enabled: true,
      }}
    >
      <FrameLimiter fps={50} />
      <ViewerCamera />
      <WalkthroughControls />
      {!walkthroughMode && <ViewerNavigationControls />}
      <TransformControlsOverlay />
      <Lights />
      
      <Grid />
      <ambientLight intensity={0.5} />
      
      <SceneRenderer />

      {/* Default Systems */}
      <LevelSystem />
      <GuideSystem />
      <ScanSystem />
      <WallCutout />
      {/* Core systems */}
      <CeilingSystem />
      <DoorSystem />
      <FenceSystem />
      <ItemSystem />
      <RoofSystem />
      <SlabSystem />
      <StairSystem />
      <WallSystem />
      <WindowSystem />
      <ZoneSystem />
      <PostProcessing hoverStyles={hoverStyles} />
      {/* <DebugRenderer /> */}
      <GPUDeviceWatcher />

      <ItemLightSystem />
      {selectionManager === 'default' && <SelectionManager />}
      {perf && <PerfMonitor />}
      {children}
    </Canvas>
  )
}

export const TransformControlsOverlay = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedId = selectedIds[0]

  if (!selectedId) return null

  const node = useScene((s) => (s.nodes as any)[selectedId])
  const selectedObject = sceneRegistry.nodes.get(selectedId as any)

  const updateNode = useScene((s) => s.updateNode)
  const markDirty = useScene((s) => s.markDirty)

  const orbitControlsRef = useRef<any>(null)
  const transformControlsRef = useRef<any>(null)

  const [mode, setMode] = useState<'translate' | 'rotate'>('translate')

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'w') {
        setMode('translate')
      } else if (e.key.toLowerCase() === 'e') {
        setMode('rotate')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const controls = transformControlsRef.current
    if (controls) {
      const callback = (event: any) => {
        if (orbitControlsRef.current) {
          orbitControlsRef.current.enabled = !event.value
        }
      }
      controls.addEventListener('dragging-changed', callback)
      return () => controls.removeEventListener('dragging-changed', callback)
    }
  }, [selectedObject])

  useEffect(() => {
    const controls = transformControlsRef.current
    if (!controls || !selectedObject || !node) return

    const handleChange = () => {
      // Sync position/rotation from 3D object to Pascal core Zustand store
      if (node.type === 'item') {
        updateNode(selectedId as any, {
          position: [selectedObject.position.x, selectedObject.position.y, selectedObject.position.z],
          rotation: [selectedObject.rotation.x, selectedObject.rotation.y, selectedObject.rotation.z]
        })
        markDirty(selectedId as any)
      } else if (node.type === 'wall') {
        const deltaX = selectedObject.position.x - node.start[0]
        const deltaZ = selectedObject.position.z - node.start[1]
        
        const newStart: [number, number] = [selectedObject.position.x, selectedObject.position.z]
        const newEnd: [number, number] = [node.end[0] + deltaX, node.end[1] + deltaZ]
        
        const angle = -selectedObject.rotation.y
        const L = Math.hypot(node.end[0] - node.start[0], node.end[1] - node.start[1])
        const rotatedEnd: [number, number] = [
          newStart[0] + L * Math.cos(angle),
          newStart[1] + L * Math.sin(angle)
        ]
        
        updateNode(selectedId as any, {
          start: newStart,
          end: rotatedEnd
        })
        markDirty(selectedId as any)
      } else if (node.type === 'door' || node.type === 'window') {
        updateNode(selectedId as any, {
          position: [selectedObject.position.x, selectedObject.position.y, selectedObject.position.z]
        })
        markDirty(selectedId as any)
      } else if (node.type === 'guide') {
        updateNode(selectedId as any, {
          position: [selectedObject.position.x, selectedObject.position.y, selectedObject.position.z],
          rotation: [selectedObject.rotation.x, selectedObject.rotation.y, selectedObject.rotation.z],
          scale: selectedObject.scale.x
        })
        markDirty(selectedId as any)
      }
    }

    controls.addEventListener('change', handleChange)
    return () => controls.removeEventListener('change', handleChange)
  }, [selectedObject, node, selectedId, updateNode, markDirty])

  return (
    <>
      <OrbitControls makeDefault ref={orbitControlsRef} />
      {selectedObject && (
        <TransformControls
          ref={transformControlsRef}
          object={selectedObject}
          mode={mode}
          size={0.7}
          showY={node?.type !== 'window' && node?.type !== 'door'}
          showZ={node?.type !== 'window' && node?.type !== 'door'}
        />
      )}
    </>
  )
}

const DebugRenderer = () => {
  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera)
  })
  return null
}

export default Viewer
