import type { DungeonLayer } from '../../store/types'
import { buildOcclusionSegments } from '../../shared/occlusion'
import { connectorChildren } from '../../shared/authoredRooms'
import {
  connectorApertures,
  resolveWalls,
  resolveDoors,
  toOcclusionDoors,
} from '../../shared/wallResolve'

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
    //
    // `walls` is handed on so a door splits every wall inside its aperture and not
    // only the one it resolved onto: a floor ring that stops a cell short of the
    // wall a door sits in is part of that doorway, and left whole it holds sight
    // back with the door wide open.
    const walls = resolveWalls(layer)
    // A connector cuts its own doorway from its blob (`connectorApertures`), which is
    // exact on both boundaries it crosses. A player's copy also carries the door twin
    // the joint ships as, and letting that re-anchor and cut a second, differently
    // clipped hole in the same edge is how a wall span ends up re-closed behind an
    // already-opened one — so wherever the blob is here, the twin defers to it.
    const jointIds = new Set(connectorChildren(layer.children ?? []).map((c) => c.id))
    const doors = resolveDoors(layer, walls).filter(
      (d) => d.door.visible && !jointIds.has(d.door.id),
    )

    const occlusionSegs = buildOcclusionSegments(walls, [
      ...toOcclusionDoors(doors, walls),
      ...connectorApertures(layer, walls),
    ])
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
