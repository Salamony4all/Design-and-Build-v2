import { useMemo } from 'react'
import * as THREE from 'three'
import { float, mix, positionWorld, smoothstep } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import useViewer from '../../store/use-viewer'

export const Grid = () => {
  const theme = useViewer((state) => state.theme)
  const showGrid = useViewer((state) => state.showGrid)

  const material = useMemo(() => {
    const m = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    // Major grid every 1m
    const gridScaleMajor = 1.0
    const gridXMajor = positionWorld.x.mul(gridScaleMajor).fract()
    const gridZMajor = positionWorld.z.mul(gridScaleMajor).fract()
    
    // Minor grid every 0.5m (matching spatial grid)
    const gridScaleMinor = 2.0
    const gridXMinor = positionWorld.x.mul(gridScaleMinor).fract()
    const gridZMinor = positionWorld.z.mul(gridScaleMinor).fract()

    const lineWidthMajor = 0.01
    const lineWidthMinor = 0.005
    
    const lineXMajor = smoothstep(lineWidthMajor, 0, gridXMajor).add(smoothstep(1.0 - lineWidthMajor, 1.0, gridXMajor))
    const lineZMajor = smoothstep(lineWidthMajor, 0, gridZMajor).add(smoothstep(1.0 - lineWidthMajor, 1.0, gridZMajor))
    const patternMajor = lineXMajor.max(lineZMajor)

    const lineXMinor = smoothstep(lineWidthMinor, 0, gridXMinor).add(smoothstep(1.0 - lineWidthMinor, 1.0, gridXMinor))
    const lineZMinor = smoothstep(lineWidthMinor, 0, gridZMinor).add(smoothstep(1.0 - lineWidthMinor, 1.0, gridZMinor))
    const patternMinor = lineXMinor.max(lineZMinor)
    
    // Theme colors
    const colorHex = theme === 'dark' ? '#3b4252' : '#d8dee9'
    m.color.set(colorHex)
    
    // Combine patterns: Major lines are stronger
    const finalPattern = mix(patternMinor.mul(0.3), patternMajor.mul(0.8), patternMajor)
    
    m.opacityNode = mix(float(0), float(1), finalPattern)
    
    return m
  }, [theme])

  if (!showGrid) return null

  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-0.045}>
      <planeGeometry args={[1000, 1000]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}
