'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  emitter,
  type LevelNode,
  type NodeEvent,
  sceneRegistry,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import useViewer from '../../store/use-viewer'

type SelectableNodeType =
  | 'building'
  | 'level'
  | 'zone'
  | 'wall'
  | 'fence'
  | 'window'
  | 'door'
  | 'item'
  | 'slab'
  | 'ceiling'
  | 'roof'
  | 'roof-segment'
  | 'guide'

interface SelectionStrategy {
  types: SelectableNodeType[]
  handleClick: (node: AnyNode, nativeEvent?: MouseEvent) => void
  handleDeselect: () => void
  isValid: (node: AnyNode) => boolean
}


// Walk up the parentId chain to resolve buildingId, levelId, and optional zoneId
// for any node — so leaf nodes can be selected without pre-selecting the hierarchy.
const resolveHierarchy = (
  node: AnyNode,
): {
  buildingId: BuildingNode['id'] | null
  levelId: LevelNode['id'] | null
  zoneId: ZoneNode['id'] | null
} => {
  const nodes = useScene.getState().nodes
  let buildingId: BuildingNode['id'] | null = null
  let levelId: LevelNode['id'] | null = null
  let zoneId: ZoneNode['id'] | null = null

  let currentId: string | null = node.parentId ?? null
  while (currentId) {
    const parent = (nodes as any)[currentId]
    if (!parent) break
    if (parent.type === 'building') {
      buildingId = parent.id as BuildingNode['id']
      break
    }
    if (parent.type === 'level') levelId = parent.id as LevelNode['id']
    if (parent.type === 'zone') zoneId = parent.id as ZoneNode['id']
    currentId = parent.parentId ?? null
  }
  return { buildingId, levelId, zoneId }
}

const ALL_SELECTABLE: SelectableNodeType[] = [
  'building',
  'level',
  'zone',
  'wall',
  'fence',
  'item',
  'slab',
  'ceiling',
  'roof',
  'roof-segment',
  'window',
  'door',
  'guide',
]

const getStrategy = (): SelectionStrategy => {
  const computeNextIds = (node: AnyNode, selectedIds: string[], event?: any): string[] => {
    const isMeta = event?.metaKey || event?.nativeEvent?.metaKey
    const isCtrl = event?.ctrlKey || event?.nativeEvent?.ctrlKey
    if (isMeta || isCtrl) {
      return selectedIds.includes(node.id)
        ? selectedIds.filter((id) => id !== node.id)
        : [...selectedIds, node.id]
    }
    return [node.id]
  }

  return {
    types: ALL_SELECTABLE,

    // Any of our selectable types is valid — no pre-selection of parent required
    isValid: (node) => ALL_SELECTABLE.includes(node.type as SelectableNodeType),

    handleClick: (node, nativeEvent) => {
      const { selectedIds } = useViewer.getState().selection

      // Building: top-level select only
      if (node.type === 'building') {
        useViewer.getState().setSelection({ buildingId: (node as BuildingNode).id })
        return
      }

      // Level: resolve its building parent and select
      if (node.type === 'level') {
        const { buildingId } = resolveHierarchy(node)
        useViewer.getState().setSelection({
          buildingId: (buildingId ?? ((node as any).parentId ?? null)) as BuildingNode['id'] | null,
          levelId: (node as LevelNode).id,
        })
        return
      }

      // roof-segment → promote to parent roof node
      let nodeToSelect = node
      if (node.type === 'roof-segment' && node.parentId) {
        const parentNode = useScene.getState().nodes[node.parentId as AnyNodeId]
        if (parentNode?.type === 'roof') nodeToSelect = parentNode
      }

      // If clicking on slab without modifier, treat as floor background click to deselect
      if (nodeToSelect.type === 'slab') {
        const isModifier = nativeEvent?.metaKey || nativeEvent?.ctrlKey || nativeEvent?.shiftKey
        if (!isModifier) {
          useViewer.getState().setSelection({ selectedIds: [] })
          return
        }
      }

      // All other leaf nodes (zone, wall, item, door, window, ceiling, roof, fence, stair):
      // auto-resolve full hierarchy from the parentId chain and select in one call.
      const { buildingId, levelId, zoneId } = resolveHierarchy(nodeToSelect)
      useViewer.getState().setSelection({
        buildingId,
        levelId,
        zoneId,
        selectedIds: computeNextIds(nodeToSelect, selectedIds, nativeEvent),
      })
    },

    handleDeselect: () => {
      const { selectedIds } = useViewer.getState().selection
      // Clear item selection first; if nothing is selected, reset everything
      if (selectedIds.length > 0) {
        useViewer.getState().setSelection({ selectedIds: [] })
      } else {
        useViewer.getState().resetSelection()
      }
    },
  }
}

export const SelectionManager = () => {
  const selection = useViewer((s) => s.selection)
  const clickHandledRef = useRef(false)

  useEffect(() => {
    const onEnter = (event: NodeEvent) => {
      const strategy = getStrategy()
      if (!strategy) return
      if (strategy.isValid(event.node)) {
        event.stopPropagation()
        if (event.node.type === 'slab') {
          useViewer.setState({ hoveredId: null })
          return
        }
        useViewer.setState({ hoveredId: event.node.id })
      }
    }

    const onLeave = (event: NodeEvent) => {
      const strategy = getStrategy()
      if (!strategy) return
      if (strategy.isValid(event.node)) {
        event.stopPropagation()
        useViewer.setState({ hoveredId: null })
      }
    }

    const onClick = (event: NodeEvent) => {
      const strategy = getStrategy()
      if (!strategy) return
      if (!strategy.isValid(event.node)) return

      event.stopPropagation()
      clickHandledRef.current = true
      strategy.handleClick(event.node, event.nativeEvent as unknown as MouseEvent)
      setTimeout(() => {
        clickHandledRef.current = false
      }, 150)
      useViewer.setState({ hoveredId: null })
    }

    // Subscribe to all node types
    const allTypes: SelectableNodeType[] = [
      'building',
      'level',
      'zone',
      'wall',
      'fence',
      'item',
      'slab',
      'ceiling',
      'roof',
      'roof-segment',
      'window',
      'door',
      'guide',
    ]
    for (const type of allTypes) {
      emitter.on(`${type}:enter`, onEnter)
      emitter.on(`${type}:leave`, onLeave)
      emitter.on(`${type}:click`, onClick)
    }

    return () => {
      for (const type of allTypes) {
        emitter.off(`${type}:enter`, onEnter)
        emitter.off(`${type}:leave`, onLeave)
        emitter.off(`${type}:click`, onClick)
      }
    }
  }, [])

  return (
    <>
      <PointerMissedHandler clickHandledRef={clickHandledRef} />
      <OutlinerSync />
    </>
  )
}

const PointerMissedHandler = ({
  clickHandledRef,
}: {
  clickHandledRef: React.MutableRefObject<boolean>
}) => {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      // Only handle left clicks
      if (useViewer.getState().cameraDragging) return
      if (event.button !== 0) return

      // Use requestAnimationFrame to check after R3F event handlers
      requestAnimationFrame(() => {
        if (clickHandledRef.current) {
          return
        }

        // Click was not handled by any 3D object -> deselect
        const strategy = getStrategy()
        if (strategy) {
          strategy.handleDeselect()
          useViewer.setState({ hoveredId: null })
        }
      })
    }

    const canvas = gl.domElement
    canvas.addEventListener('click', handleClick)

    return () => {
      canvas.removeEventListener('click', handleClick)
    }
  }, [gl, clickHandledRef])

  return null
}

const OutlinerSync = () => {
  const selection = useViewer((s) => s.selection)
  const hoveredId = useViewer((s) => s.hoveredId)
  const outliner = useViewer((s) => s.outliner)
  const nodes = useScene((s) => s.nodes)

  useEffect(() => {
    // Sync selected objects
    outliner.selectedObjects.length = 0
    for (const id of selection.selectedIds) {
      const node = nodes[id as AnyNodeId]
      if (node?.type === 'slab') continue
      const obj = sceneRegistry.nodes.get(id)
      if (obj) outliner.selectedObjects.push(obj)
    }

    // Sync hovered objects
    outliner.hoveredObjects.length = 0
    if (hoveredId) {
      const hoveredNode = nodes[hoveredId as AnyNodeId]
      if (hoveredNode?.type === 'slab') return
      const obj = sceneRegistry.nodes.get(hoveredId)
      if (obj) outliner.hoveredObjects.push(obj)
    }
  }, [selection, hoveredId, outliner, nodes])

  return null
}
