'use client'

import { useEffect, useRef } from 'react'
import { useScene, generateId } from '@pascal-app/core'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { CATALOG_ITEMS } from '../components/ui/item-catalog/catalog-items'
import type { AssetInput } from '@pascal-app/core'

// ─── Types ────────────────────────────────────────────────────
// These match the StructuralSchema from DBV2/src/lib/ai.js

interface AiWall {
  id?: string
  start: [number, number]
  end: [number, number]
  thickness?: number
  height?: number
  material?: string
}

interface AiOpening {
  id?: string
  type: string        // 'door' | 'window-simple' | etc.
  pos: [number, number]
  width: number
  height: number
  elevation?: number
}

interface AiFurniture {
  id?: string
  type: string        // catalog slug like 'office-chair', 'sofa', etc.
  pos: [number, number]
  rotation?: number
  width?: number
  depth?: number
}

interface AiFloor {
  id?: string
  boundary: [number, number][]
  level?: number
  material?: string
}

interface AiCeiling {
  id?: string
  boundary: [number, number][]
  level?: number
  height?: number
}

interface AiZone {
  name: string
  boundary: [number, number][]
  color?: string
}

interface AiPayload {
  projectInfo?: { name?: string; estimatedArea?: string }
  walls?: AiWall[]
  openings?: AiOpening[]
  furniture?: AiFurniture[]
  floors?: AiFloor[]
  ceilings?: AiCeiling[]
  zones?: AiZone[]
}

interface BimMessage {
  type: 'BIM_UPDATE' | 'BIM_COMPLETE' | 'BIM_ERROR'
  phase?: string
  payload?: AiPayload
  message?: string
}

// ─── Catalog Lookup ───────────────────────────────────────────

const CATALOG_MAP = new Map<string, AssetInput>()
for (const item of CATALOG_ITEMS) {
  CATALOG_MAP.set(item.id, item)
}

function findCatalogAsset(slug: string): AssetInput | null {
  // Direct match
  if (CATALOG_MAP.has(slug)) return CATALOG_MAP.get(slug)!
  // Normalized match (e.g. "office_chair" → "office-chair")
  const normalized = slug.replace(/_/g, '-').toLowerCase()
  if (CATALOG_MAP.has(normalized)) return CATALOG_MAP.get(normalized)!
  // Partial match
  for (const [id, item] of CATALOG_MAP) {
    if (id.includes(normalized) || normalized.includes(id)) return item
  }
  return null
}

// ─── Helpers ──────────────────────────────────────────────────

function getWallAngle(start: [number, number], end: [number, number]) {
  return Math.atan2(end[1] - start[1], end[0] - start[0])
}

/**
 * Generates a stable, predictable ID for AI nodes based on their type and geometric properties.
 * This ensures that nodes maintain their identity across phased BIM updates, preventing flicker.
 */
function getAiNodeId(type: string, data: any): string {
  let key = type
  if (type === 'wall' && data.start && data.end) {
    // Round coordinates to handle minor floating point drift from AI
    key += `-${data.start[0].toFixed(2)},${data.start[1].toFixed(2)}|${data.end[0].toFixed(2)},${data.end[1].toFixed(2)}`
  } else if (data.pos) {
    key += `-${data.pos[0].toFixed(2)},${data.pos[1].toFixed(2)}`
  } else if (data.boundary && data.boundary[0]) {
    key += `-${data.boundary[0][0].toFixed(2)},${data.boundary[0][1].toFixed(2)}`
  } else if (data.id) {
    key += `-${data.id}`
  }
  return `ai-${key}`
}

interface WallAttachment {
  aiId: string
  sceneId: string
  localX: number
  dist: number
  side: 'front' | 'back'
  angle: number
  normal: [number, number]
}

function findNearestWall(
  pos: [number, number],
  aiWalls: AiWall[],
  wallIdMap: Map<string, string>,
): WallAttachment | null {
  let bestDist = Infinity
  let bestResult: WallAttachment | null = null

  for (const wall of aiWalls) {
    if (!wall.id) continue
    const sceneId = wallIdMap.get(wall.id)
    if (!sceneId) continue

    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const lenSq = dx * dx + dz * dz
    if (lenSq === 0) continue

    // Project point to segment
    let t = ((pos[0] - wall.start[0]) * dx + (pos[1] - wall.start[1]) * dz) / lenSq
    t = Math.max(0, Math.min(1, t))

    const projX = wall.start[0] + t * dx
    const projZ = wall.start[1] + t * dz
    const dist = Math.hypot(pos[0] - projX, pos[1] - projZ)

    if (dist < bestDist) {
      bestDist = dist
      
      // Calculate side
      const wallAngle = Math.atan2(dz, dx)
      const nx = -Math.sin(wallAngle)
      const nz = Math.cos(wallAngle)
      const toPointX = pos[0] - projX
      const toPointZ = pos[1] - projZ
      const dot = toPointX * nx + toPointZ * nz
      const side = dot >= 0 ? 'front' : 'back'

      bestResult = {
        aiId: wall.id,
        sceneId,
        localX: t * Math.sqrt(lenSq),
        dist,
        side,
        angle: wallAngle,
        normal: [nx, nz],
      }
    }
  }

  // Only attach if within 1.5m of a wall
  return bestDist < 1.5 ? bestResult : null
}

// ─── Converter: AI Payload → Scene Graph Nodes ────────────────

function convertAiToSceneNodes(
  payload: AiPayload,
  levelId: string,
): { nodes: AnyNode[]; wallIdMap: Map<string, string> } {
  const nodes: AnyNode[] = []
  const wallIdMap = new Map<string, string>() // AI wall id → scene wall id

  // Helper to ensure all nodes have _aiInjected metadata
  const withAiTag = (node: any) => ({
    ...node,
    metadata: { ...node.metadata, _aiInjected: true },
  })

  // 1. Walls (First pass)
  for (const wall of payload.walls ?? []) {
    const wallId = getAiNodeId('wall', wall)
    if (wall.id) wallIdMap.set(wall.id, wallId)

    const wallNode = withAiTag({
      object: 'node' as const,
      id: wallId,
      type: 'wall' as const,
      parentId: levelId,
      visible: true,
      metadata: {},
      start: wall.start,
      end: wall.end,
      thickness: wall.thickness ?? 0.2,
      height: wall.height ?? 2.8,
      children: [],
      frontSide: 'unknown' as const,
      backSide: 'unknown' as const,
      ...(wall.material ? { materialPreset: wall.material } : {}),
    })
    nodes.push(wallNode as unknown as AnyNode)
  }

  // 2. Openings (doors and windows)
  for (const opening of payload.openings ?? []) {
    const isDoor = opening.type.toLowerCase().includes('door')
    const attachment = findNearestWall(opening.pos, payload.walls ?? [], wallIdMap)
    
    if (isDoor) {
      const doorId = getAiNodeId('door', opening)
      const width = opening.width ?? 0.9
      const height = opening.height ?? 2.1
      const elevation = opening.elevation ?? 0
      
      // Coordinate System: Y is center-based for parametric openings
      const centerY = elevation + height / 2

      const doorNode = withAiTag({
        object: 'node' as const,
        id: doorId,
        type: 'door' as const,
        parentId: attachment?.sceneId ?? levelId,
        visible: true,
        metadata: {},
        position: attachment 
          ? [attachment.localX, centerY, 0] 
          : [opening.pos[0], centerY, opening.pos[1]],
        rotation: [0, 0, 0],
        width,
        height,
        wallId: attachment?.sceneId,
        side: attachment?.side,
      })
      nodes.push(doorNode as unknown as AnyNode)

      if (attachment) {
        const wallNode = nodes.find(n => n.id === attachment.sceneId) as any
        if (wallNode?.children) wallNode.children.push(doorId)
      }
    } else {
      const windowId = getAiNodeId('window', opening)
      const width = opening.width ?? 1.5
      const height = opening.height ?? 1.2
      const elevation = opening.elevation ?? 0.9
      
      // Coordinate System: Y is center-based
      const centerY = elevation + height / 2

      const windowNode = withAiTag({
        object: 'node' as const,
        id: windowId,
        type: 'window' as const,
        parentId: attachment?.sceneId ?? levelId,
        visible: true,
        metadata: {},
        position: attachment
          ? [attachment.localX, centerY, 0]
          : [opening.pos[0], centerY, opening.pos[1]],
        rotation: [0, 0, 0],
        width,
        height,
        wallId: attachment?.sceneId,
        side: attachment?.side,
      })
      nodes.push(windowNode as unknown as AnyNode)

      if (attachment) {
        const wallNode = nodes.find(n => n.id === attachment.sceneId) as any
        if (wallNode?.children) wallNode.children.push(windowId)
      }
    }
  }

  // 3. Furniture → ItemNode
  for (const furniture of payload.furniture ?? []) {
    const catalogAsset = findCatalogAsset(furniture.type)
    if (!catalogAsset) continue

    const itemId = getAiNodeId('item', furniture)
    const attachment = findNearestWall(furniture.pos, payload.walls ?? [], wallIdMap)
    
    let scale: [number, number, number] = [1, 1, 1]
    if (furniture.width && furniture.depth) {
      const [aw, ah, ad] = catalogAsset.dimensions ?? [1, 1, 1]
      scale = [furniture.width / aw, 1, furniture.depth / ad]
    }

    const attachType = catalogAsset.attachTo
    const isWallAttached = attachType === 'wall' || attachType === 'wall-side'
    
    let parentId = levelId
    let position: [number, number, number] = [furniture.pos[0], 0, furniture.pos[1]]
    let rotation: [number, number, number] = [0, (furniture.rotation ?? 0) * Math.PI / 180, 0]
    let wallId: string | undefined

    if (isWallAttached && attachment) {
      parentId = attachment.sceneId
      wallId = attachment.sceneId
      const zOffset = attachment.side === 'front' ? 0.1 : -0.1
      position = [attachment.localX, 0, zOffset]
      const baseRotation = attachment.side === 'front' ? 0 : Math.PI
      rotation = [0, baseRotation, 0]
    } else if (attachType === 'ceiling') {
      const h = payload.ceilings?.[0]?.height ?? 2.8
      position = [furniture.pos[0], h, furniture.pos[1]]
      rotation = [Math.PI, 0, 0]
    }

    const itemNode = withAiTag({
      object: 'node' as const,
      id: itemId,
      type: 'item' as const,
      parentId,
      visible: true,
      metadata: {},
      position,
      rotation,
      scale,
      children: [],
      asset: catalogAsset,
      wallId,
    })
    nodes.push(itemNode as unknown as AnyNode)

    if (wallId) {
      const wallNode = nodes.find(n => n.id === wallId) as any
      if (wallNode?.children) wallNode.children.push(itemId)
    }
  }

  // 4. Floors → SlabNode
  for (const floor of payload.floors ?? []) {
    if (!floor.boundary || floor.boundary.length < 3) continue
    const slabId = getAiNodeId('slab', floor)

    const slabNode = withAiTag({
      object: 'node' as const,
      id: slabId,
      type: 'slab' as const,
      parentId: levelId,
      visible: true,
      metadata: {},
      polygon: floor.boundary,
      holes: [],
      holeMetadata: [],
      elevation: 0.05,
      autoFromWalls: false,
      ...(floor.material ? { materialPreset: floor.material } : {}),
    })
    nodes.push(slabNode as unknown as AnyNode)
  }

  // 5. Ceilings → CeilingNode
  for (const ceiling of payload.ceilings ?? []) {
    if (!ceiling.boundary || ceiling.boundary.length < 3) continue
    const ceilingId = getAiNodeId('ceiling', ceiling)

    const ceilingNode = withAiTag({
      object: 'node' as const,
      id: ceilingId,
      type: 'ceiling' as const,
      parentId: levelId,
      visible: true,
      metadata: {},
      polygon: ceiling.boundary,
      holes: [],
      holeMetadata: [],
      height: ceiling.height ?? 2.5,
      children: [],
      autoFromWalls: false,
    })
    nodes.push(ceilingNode as unknown as AnyNode)
  }

  // 6. Zones → ZoneNode
  for (const zone of payload.zones ?? []) {
    if (!zone.boundary || zone.boundary.length < 3) continue
    const zoneId = getAiNodeId('zone', zone)

    const zoneNode = withAiTag({
      object: 'node' as const,
      id: zoneId,
      type: 'zone' as const,
      parentId: levelId,
      visible: true,
      metadata: {},
      name: zone.name,
      polygon: zone.boundary,
      color: zone.color ?? '#3b82f6',
    })
    nodes.push(zoneNode as unknown as AnyNode)
  }

  return { nodes, wallIdMap }
}


// ─── The Hook ─────────────────────────────────────────────────

/**
 * useAiReceiver
 *
 * Listens for `BIM_UPDATE` and `BIM_COMPLETE` postMessage events from
 * the DBV2 AI pipeline, converts the raw structural JSON into scene
 * graph nodes, and injects them into the editor's useScene store.
 *
 * Each phase does a full replace (clear → re-inject) so intermediate
 * updates don't accumulate duplicate geometry.
 */
export function useAiReceiver() {
  const lastPhaseRef = useRef<string | null>(null)
  const throttleRef = useRef<number | null>(null)
  const pendingPayloadRef = useRef<AiPayload | null>(null)
  const lastProcessedPayloadRef = useRef<string | null>(null)

  useEffect(() => {
    function handleMessage(event: MessageEvent<BimMessage>) {
      const data = event.data
      if (!data || typeof data !== 'object') return

      const { type, phase, payload } = data
      if (type !== 'BIM_UPDATE' && type !== 'BIM_COMPLETE') return
      if (!payload) return

      pendingPayloadRef.current = payload

      if (throttleRef.current) return

      // Throttle to ~150ms to allow UI breathing room
      throttleRef.current = window.setTimeout(() => {
        throttleRef.current = null
        const currentPayload = pendingPayloadRef.current
        if (!currentPayload) return

        // Avoid redundant processing if payload hasn't changed
        const payloadCheck = JSON.stringify(currentPayload)
        if (payloadCheck === lastProcessedPayloadRef.current) return
        lastProcessedPayloadRef.current = payloadCheck

        console.log(`[AI Receiver] Processing ${type} | phase: "${phase}"`)

        const state = useScene.getState()
        const levelId = findActiveLevelId(state.nodes)
        if (!levelId) return

        const { nodes: incomingNodes } = convertAiToSceneNodes(currentPayload, levelId)
        const incomingIds = new Set(incomingNodes.map(n => n.id))

        // 1. Cleanup: Remove AI nodes that are no longer in the payload
        const nodesToDelete = Object.values(state.nodes)
          .filter(n => typeof n.metadata === 'object' && n.metadata !== null && !Array.isArray(n.metadata) && (n.metadata as Record<string, unknown>)._aiInjected && !incomingIds.has(n.id))
          .map(n => n.id)

        if (nodesToDelete.length > 0) {
          console.log(`[AI Receiver] Cleaning up ${nodesToDelete.length} stale AI nodes`)
          state.deleteNodes(nodesToDelete)
        }

        // 2. Diff & Prepare Updates
        const nodesToUpdate: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
        const nodesToCreate: { node: AnyNode; parentId?: AnyNodeId }[] = []

        for (const node of incomingNodes) {
          const existing = (state.nodes as Record<string, AnyNode | undefined>)[node.id]
          if (existing) {
            // Simple diffing to avoid unnecessary state/UI updates
            // We compare essential properties that affect 3D rendering
            const hasChanged = 
              JSON.stringify((existing as any).start) !== JSON.stringify((node as any).start) ||
              JSON.stringify((existing as any).end) !== JSON.stringify((node as any).end) ||
              (existing as any).type !== node.type ||
              (existing as any).parentId !== node.parentId

            if (hasChanged) {
              nodesToUpdate.push({ id: node.id as AnyNodeId, data: node })
            }
          } else {
            nodesToCreate.push({ node, parentId: node.parentId as AnyNodeId })
          }
        }

        // 3. Apply changes to store
        if (nodesToUpdate.length > 0) state.updateNodes(nodesToUpdate)
        if (nodesToCreate.length > 0) state.createNodes(nodesToCreate)

        // 4. Mark dirty for 3D regeneration
        const needsDirty = [...nodesToUpdate.map(n => n.id), ...nodesToCreate.map(n => n.node.id)]
        
        if (needsDirty.length > 0) {
          if (needsDirty.length > 30) {
            requestAnimationFrame(() => {
              const currentState = useScene.getState()
              for (const id of needsDirty) {
                const node = (currentState.nodes as Record<string, AnyNode | undefined>)[id]
                if (node && (node.type === 'wall' || node.type === 'slab' || node.type === 'ceiling')) {
                  currentState.markDirty(id as AnyNodeId)
                }
              }
              currentState.markDirty(levelId as AnyNodeId)
            })
          } else {
            for (const id of needsDirty) {
              const node = (state.nodes as Record<string, AnyNode | undefined>)[id]
              if (node && (node.type === 'wall' || node.type === 'slab' || node.type === 'ceiling')) {
                state.markDirty(id as AnyNodeId)
              }
            }
            state.markDirty(levelId as AnyNodeId)
          }
        }

        lastPhaseRef.current = phase ?? null
        if (type === 'BIM_COMPLETE') {
          console.log(`[AI Receiver] ✓ BIM_COMPLETE — ${incomingNodes.length} nodes active`)
        }
      }, 150)
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
      if (throttleRef.current) clearTimeout(throttleRef.current)
    }
  }, [])
}

// ─── Scene Traversal ──────────────────────────────────────────

function findActiveLevelId(nodes: Record<string, AnyNode>): string | null {
  // Walk the hierarchy: Site → Building → Level (level=0)
  for (const node of Object.values(nodes)) {
    if (node.type === 'level' && (node as any).level === 0) {
      return node.id
    }
  }
  // Fallback: any level node
  for (const node of Object.values(nodes)) {
    if (node.type === 'level') {
      return node.id
    }
  }
  return null
}
