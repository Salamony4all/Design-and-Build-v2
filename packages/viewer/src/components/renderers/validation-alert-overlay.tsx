'use client'

import React, { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { AnyNode } from '@pascal-app/core'
import * as THREE from 'three'

interface ValidationAlertOverlayProps {
  node: AnyNode
}

export const ValidationAlertOverlay = ({ node }: ValidationAlertOverlayProps) => {
  const meshRef = useRef<THREE.Mesh>(null)

  // Pulse effect in the render loop
  useFrame(({ clock }) => {
    if (meshRef.current) {
      const elapsed = clock.getElapsedTime()
      const scale = 1 + Math.sin(elapsed * 4) * 0.03
      meshRef.current.scale.set(scale, scale, scale)
      
      const material = meshRef.current.material as THREE.MeshBasicMaterial
      if (material) {
        material.opacity = 0.2 + Math.sin(elapsed * 4) * 0.08
      }
    }
  })

  // Calculate position and dimensions based on node type
  let position: [number, number, number] = [0, 0, 0]
  let args: [number, number, number] = [1, 1, 1]

  if (node.type === 'wall' && 'start' in node && 'end' in node) {
    const start = node.start as [number, number]
    const end = node.end as [number, number]
    const thickness = (node as any).thickness ?? 0.2
    const height = (node as any).height ?? 2.8
    
    // Midpoint of start and end
    position = [(start[0] + end[0]) / 2, height / 2, (start[1] + end[1]) / 2]
    
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const len = Math.sqrt(dx * dx + dz * dz)
    args = [len + 0.1, height + 0.1, thickness + 0.15]
  } else if (node.type === 'item' && 'position' in node) {
    position = node.position as [number, number, number]
    const dim = (node as any).asset?.dimensions ?? [1, 1, 1]
    args = [dim[0] + 0.15, dim[1] + 0.15, dim[2] + 0.15]
  } else if ('position' in node && Array.isArray((node as any).position)) {
    position = (node as any).position as [number, number, number]
  } else if (node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone') {
    const boundary = (node as any).boundary as [number, number][]
    if (boundary && boundary.length > 0) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const [x, z] of boundary) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
      }
      const cx = (minX + maxX) / 2
      const cz = (minZ + maxZ) / 2
      const h = (node as any).height ?? 0.25
      position = [cx, h / 2, cz]
      args = [maxX - minX + 0.2, h + 0.1, maxZ - minZ + 0.2]
    }
  }

  return (
    <group position={position}>
      {/* Pulse warning geometry */}
      <mesh ref={meshRef}>
        <boxGeometry args={args} />
        <meshBasicMaterial color="#f97316" transparent opacity={0.25} depthWrite={false} wireframe />
      </mesh>
      
      {/* Outer warning frame */}
      <mesh>
        <boxGeometry args={args} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.5} depthWrite={false} wireframe />
      </mesh>

      {/* Floating alert tag above the item */}
      <Html distanceFactor={12} position={[0, args[1] / 2 + 0.4, 0]} center>
        <div
          style={{
            background: 'rgba(127, 29, 29, 0.95)',
            color: '#fca5a5',
            border: '1px solid rgba(185, 28, 28, 0.8)',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: 'Inter, system-ui, sans-serif',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            pointerEvents: 'none',
            backdropFilter: 'blur(4px)',
          }}
        >
          <span style={{ fontSize: '12px' }}>⚠️</span>
          <span>Pending Validation</span>
        </div>
      </Html>
    </group>
  )
}
