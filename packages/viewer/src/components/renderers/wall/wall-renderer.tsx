import { useRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { getVisibleWallMaterials } from '../../../systems/wall/wall-materials'
import { NodeRenderer } from '../node-renderer'

export const WallRenderer = ({ node }: { node: WallNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'wall', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'wall')
  const material = getVisibleWallMaterials(node)

  const hitProxyProps = useMemo(() => {
    const dx = (node.end?.[0] ?? 0) - (node.start?.[0] ?? 0)
    const dy = (node.end?.[1] ?? 0) - (node.start?.[1] ?? 0)
    const length = Math.max(0.01, Math.hypot(dx, dy))
    const height = Math.max(0.1, node.height ?? 3)
    const thickness = Math.max(0.2, (node.thickness ?? 0.2) * 1.2)
    const endPadding = 0.05
    const verticalPadding = 0.08
    return {
      args: [length + endPadding * 2, height + verticalPadding, thickness] as [number, number, number],
      position: [length / 2, (height + verticalPadding) / 2, 0] as [number, number, number],
    }
  }, [node.start, node.end, node.height, node.thickness])

  return (
    <mesh
      castShadow
      material={material}
      receiveShadow
      ref={ref}
      visible={node.visible}
      {...handlers}
    >
      <boxGeometry args={[0, 0, 0]} />

      {/* Semantic Wall Hit Proxy — covers entire visible wall face without edge precision requirement */}
      <mesh
        name="wall-hit-proxy"
        position={hitProxyProps.position}
        visible={true}
        {...handlers}
      >
        <boxGeometry args={hitProxyProps.args} />
        <meshBasicMaterial depthWrite={false} opacity={0} transparent />
      </mesh>

      {(node.children || []).map((childId) => (
        <NodeRenderer key={`${node.id}:${childId}`} nodeId={childId} />
      ))}
    </mesh>
  )
}
