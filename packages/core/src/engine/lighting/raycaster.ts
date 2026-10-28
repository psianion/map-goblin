import type { DungeonLayer } from '../../store/types'
import type { WallDirection } from '../../shared/types'
import { buildOcclusionSegments } from '../../shared/occlusion'
import { connectorChildren } from '../../shared/authoredRooms'
import { propSegments } from '../../shared/propOcclusion'
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
  /**
   * One-way walls: 'left' blocks only an origin on the segment's left (walking from (x1,y1)
   * to (x2,y2) in screen space, y down), 'right' only one on its right. Absent = both.
   */
  direction?: WallDirection
  /** What the segment stops. Absent reads as true: a plain segment blocks everything. */
  blocksLight?: boolean
  blocksSight?: boolean
}

/** Which occlusion a sweep is for: light sources, or eyes. */
export type OcclusionKind = 'light' | 'sight'

/**
 * Whether `seg` blocks a sweep from (ox, oy). A one-way wall lets everything through from its
 * open side; on the line itself it blocks.
 */
export function blocksFrom(seg: Segment, ox: number, oy: number): boolean {
  const dir = seg.direction
  if (!dir || dir === 'both') return true
  const cross = (seg.x2 - seg.x1) * (oy - seg.y1) - (seg.y2 - seg.y1) * (ox - seg.x1)
  // Screen space (y down): an origin on the left of the walk has a negative cross.
  return dir === 'left' ? cross <= 0 : cross >= 0
}

/**
 * Every occluding segment on `dungeonLayers` for one kind of sweep. `props: false` leaves out
 * the blocking props' footprints, for the sun's wall-shadow pass (props cast their own sprite
 * shadow there).
 */
export function extractWallSegments(
  dungeonLayers: DungeonLayer[],
  kind: OcclusionKind = 'light',
  options: { props?: boolean } = {},
): Segment[] {
  const segments: Segment[] = []

  for (const layer of dungeonLayers) {
    // Every wall — standalone and floor-ring alike — split at its doors in one
    // place. Only segments that block this kind (light, or sight) are kept, so an
    // open door on a floor edge passes light like any other open door.
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
      if (kind === 'light' ? !seg.blocksLight : !seg.blocksVision) continue
      const pts = seg.points
      for (let i = 0; i < pts.length - 1; i++) {
        segments.push({
          x1: pts[i][0],
          y1: pts[i][1],
          x2: pts[i + 1][0],
          y2: pts[i + 1][1],
          direction: seg.direction,
          blocksLight: seg.blocksLight,
          blocksSight: seg.blocksVision,
        })
      }
    }
    // Props with "Blocks light and sight": four edges of the footprint, both ways, both kinds.
    if (options.props === false) continue
    for (const e of propSegments(layer.children ?? [])) {
      segments.push({ ...e, direction: 'both', blocksLight: true, blocksSight: true })
    }
  }

  return segments
}
