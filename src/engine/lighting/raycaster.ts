import type { DungeonLayer } from '@/store/types'
import type { DoorChild } from '@/shared/types'
import { buildOcclusionSegments } from '@/shared/occlusion'

export interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
}

export function extractWallSegments(dungeonLayers: DungeonLayer[]): Segment[] {
  const segments: Segment[] = []

  for (const layer of dungeonLayers) {
    // Use the occlusion engine to split standalone walls at door positions.
    // Only segments with blocksLight=true become light-blocking segments.
    const doorChildren = layer.children.filter(
      (c): c is DoorChild => c.childType === 'door' && c.visible,
    )

    const occlusionSegs = buildOcclusionSegments(layer.standaloneWalls, doorChildren)
    for (const seg of occlusionSegs) {
      if (!seg.blocksLight) continue
      const pts = seg.points
      for (let i = 0; i < pts.length - 1; i++) {
        segments.push({
          x1: pts[i][0],
          y1: pts[i][1],
          x2: pts[i + 1][0],
          y2: pts[i + 1][1],
        })
      }
    }

    // Auto-walls from floor polygon edges (always block light)
    if (layer.mergedFloor) {
      for (const polygon of layer.mergedFloor) {
        const pts = polygon
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i]
          const b = pts[(i + 1) % pts.length]
          segments.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] })
        }
      }
    }
  }

  return segments
}
