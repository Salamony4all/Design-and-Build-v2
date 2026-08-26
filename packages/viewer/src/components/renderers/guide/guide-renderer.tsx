import { type GuideNode, useRegistry, emitter, sceneRegistry } from '@pascal-app/core'
import { useLoader } from '@react-three/fiber'
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { DoubleSide, PlaneGeometry, RepeatWrapping, type Group, type Texture, TextureLoader } from 'three'
import { float, texture } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { useAssetUrl } from '../../../hooks/use-asset-url'
import { useNodeEvents } from '../../../hooks/use-node-events'
import useViewer from '../../../store/use-viewer'

/** Non-sensitive identity carried on the Guide event (filename only — never bytes/URL/path). */
function guideSourceIdentity(node: GuideNode): string {
  const meta = (node.metadata ?? {}) as Record<string, unknown>
  return (typeof meta.sourceFileName === 'string' && meta.sourceFileName) || node.name || ''
}

/**
 * Error boundary that reports a Guide texture failure without crashing the Viewer.
 * Emits a provider-neutral, run-scoped 'guide:texture-failed' signal. No image
 * bytes, data URL, or filesystem path leave the Viewer.
 */
class GuideTextureBoundary extends Component<
  { guideId: string; runId?: string; sourceIdentity: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) {
    emitter.emit('guide:texture-failed' as never, {
      runId: this.props.runId,
      guideId: this.props.guideId,
      sourceIdentity: this.props.sourceIdentity,
      error: error.message,
    } as never)
  }
  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}

export const GuideRenderer = ({ node }: { node: GuideNode }) => {
  const showGuides = useViewer((s) => s.showGuides)
  const ref = useRef<Group>(null!)
  useRegistry(node.id, 'guide', ref)

  const resolvedUrl = useAssetUrl(node.url)
  const isPdf = resolvedUrl?.startsWith('data:application/pdf') || resolvedUrl?.toLowerCase().endsWith('.pdf')

  const invertY: boolean = (node.metadata as any)?.invertY === true
  const runId: string | undefined = (node.metadata as any)?.runId
  const sourceIdentity = guideSourceIdentity(node)

  useEffect(() => {
    if (ref.current) {
      sceneRegistry.nodes.set(node.id as any, ref.current)
      return () => {
        sceneRegistry.nodes.delete(node.id as any)
      }
    }
  }, [node.id])

  const handlers = useNodeEvents(node, 'guide')

  const safeRotationY = Array.isArray(node.rotation)
    ? (node.rotation[1] ?? 0)
    : (typeof node.rotation === 'number' ? node.rotation : 0)

  const scaleVal = typeof node.scale === 'number' && node.scale > 0 ? node.scale : 1

  return (
    <group
      position={node.position}
      ref={ref}
      rotation={[0, safeRotationY, 0]}
      visible={showGuides && node.visible !== false}
      {...handlers}
    >
      {resolvedUrl && !isPdf && (
        <GuideTextureBoundary guideId={node.id} runId={runId} sourceIdentity={sourceIdentity}>
          <Suspense>
            <GuidePlane
              guideId={node.id}
              runId={runId}
              sourceIdentity={sourceIdentity}
              opacity={node.opacity}
              scale={scaleVal}
              url={resolvedUrl}
              invertY={invertY}
              handlers={handlers}
            />
          </Suspense>
        </GuideTextureBoundary>
      )}
    </group>
  )
}

const GuidePlane = ({
  guideId,
  runId,
  sourceIdentity,
  url,
  scale,
  opacity,
  invertY = false,
  handlers,
}: {
  guideId: string
  runId?: string
  sourceIdentity: string
  url: string
  scale: number
  opacity: number
  invertY?: boolean
  handlers?: Record<string, any>
}) => {
  const tex = useLoader(TextureLoader, url) as Texture

  const emittedRef = useRef(false)
  useEffect(() => {
    if (emittedRef.current) return
    emittedRef.current = true
    emitter.emit('guide:texture-ready' as never, { runId, guideId, sourceIdentity } as never)
  }, [runId, guideId, sourceIdentity])

  const { geometry, material } = useMemo(() => {
    const img = tex.image as HTMLImageElement | ImageBitmap
    const w = img.width || 1
    const h = img.height || 1
    const aspect = w / h

    tex.wrapS = RepeatWrapping
    tex.wrapT = RepeatWrapping
    tex.center.set(0, 0)
    tex.rotation = 0
    tex.repeat.set(1, 1)
    tex.offset.set(0, 0)
    tex.needsUpdate = true

    const rawScale = typeof scale === 'number' && scale > 0 ? scale : 1
    const planeWidth = 10 * rawScale
    const planeHeight = (10 / aspect) * rawScale

    const rawOp = opacity ?? 100
    const normalizedOpacity = rawOp > 1 ? rawOp / 100 : rawOp

    const mat = new MeshBasicNodeMaterial({
      transparent: true,
      colorNode: texture(tex),
      opacityNode: float(normalizedOpacity),
      side: DoubleSide,
      depthWrite: false,
    })
    mat.opacity = normalizedOpacity
    mat.transparent = true
    mat.needsUpdate = true

    const geom = new PlaneGeometry(planeWidth, planeHeight)
    if (invertY) {
      const uvAttr = geom.attributes.uv
      const uvArray = uvAttr.array as Float32Array
      for (let i = 1; i < uvArray.length; i += 2) {
        uvArray[i] = 1 - uvArray[i]
      }
      uvAttr.needsUpdate = true
    }
    geom.boundingBox = null
    geom.boundingSphere = null

    return { geometry: geom, material: mat }
  }, [tex, scale, opacity, invertY])

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  return (
    <mesh
      frustumCulled={false}
      geometry={geometry}
      material={material}
      rotation={[-Math.PI / 2, 0, 0]}
      {...handlers}
    />
  )
}

export default GuideRenderer
