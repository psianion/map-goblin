import type { DungeonLayer } from '../../store/types'
import { buildOcclusionSegments } from '../../shared/occlusion'
import { resolveWalls, resolveDoors, toOcclusionDoors } from '../../shared/wallResolve'

export interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
}

export function extractWallSegments(dungeonLayers: DungeonLayer[]): Segment[] {
  const segments: Segment[] = []

  for (const layer of dungeonLayers) {
    // Every wall — standalone and floor-ring alike — split at its doors in one
    // place. Only segments with blocksLight=true become light-blocking segments,
    // so an open door on a floor edge passes light like any other open door.
    const walls = resolveWalls(layer)
    const doors = resolveDoors(layer, walls).filter((d) => d.door.visible)

    const occlusionSegs = buildOcclusionSegments(walls, toOcclusionDoors(doors))
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
  }

  return segments
}
