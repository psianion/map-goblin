import type { DungeonLayer, RockLine } from '../../store/types'
import type { DoorChild, WallDirection } from '../../shared/types'
import { buildOcclusionSegments, WALL_TYPE_OCCLUSION, type OcclusionSegment } from '../../shared/occlusion'
import { connectorChildren } from '../../shared/authoredRooms'
import { propSegments, roundPropSegments } from '../../shared/propOcclusion'
import { cliffOccluders } from '../../shared/plateaus'
import { stairOpenings } from '../../shared/stairOpenings'
import { caveEdges } from '../../shared/caveFloor'
import { laidFor, onRockEdge, wallLines } from '../../shared/rockLines'
import {
  connectorApertures,
  openingApertures,
  resolveWalls,
  resolveDoors,
  toOcclusionDoors,
  type ResolvedDoor,
  type ResolvedWall,
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

export interface OccluderOptions {
  /** Blocking props' footprints. False for the sun's wall-shadow pass (props cast their own sprite shadow). */
  props?: boolean
  /** Raised edges that hide their tops from below. False for the wall-shadow pass (cliffs cast by drop). */
  cliffs?: boolean
  /** The map's `sightDropCells`: the drop at which a cliff starts hiding from an eye. Absent = the default, 2. */
  sightDropCells?: number
}

/**
 * Every occluding segment on `dungeonLayers` for one kind of sweep: walls split at their doors,
 * blocking props, and the cliffs that hide their tops, which block one way only (from the low
 * side: an eye or a light on top sees and lights down over the edge). Light and sight are both
 * stopped by those of the map's `sightDropCells` and up: a lamp lights the tops an eye beside it sees.
 */
export function extractWallSegments(
  dungeonLayers: DungeonLayer[],
  kind: OcclusionKind = 'light',
  options: OccluderOptions = {},
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

    // A floor ring through a region erased open is open there (`openingApertures`).
    // Where a measured kit's rock was laid, its line blocks instead of the drawn edge.
    const occlusionSegs = layerOcclusion(layer, walls, doors)
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
    // Cliffs: one-way, from the map's threshold, light as sight: a lamp below lights the top it can see.
    if (options.cliffs !== false) {
      for (const c of cliffOccluders(layer, options.sightDropCells)) {
        segments.push({ ...c, blocksLight: true, blocksSight: true })
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

/** A span that stops walking (table fix pass §2.1). */
export interface MoveSegment {
  x1: number
  y1: number
  x2: number
  y2: number
  /** A shut door's span: its id. Absent on a wall span. */
  doorId?: string
  /** Wall spans: what the wall is (a cave's rock reaches further out than in). */
  wallKind?: 'standalone' | 'floor' | 'cave'
  /** Wall spans: the drawn width, cells. */
  width?: number
}

/**
 * Every span on `dungeonLayers` that stops walking: walls that block movement (normal, terrain,
 * invisible and window), a cave's rock between its openings, and closed or locked doors with
 * their ids. Open doors, archways and cave mouths are gaps. One-way walls block both ways. The
 * door state is read off the children, so the caller lays the live state over them first (an
 * unfound secret door hidden, which leaves its wall whole), exactly as for the sight sweep.
 */
export function extractMoveSegments(dungeonLayers: DungeonLayer[]): MoveSegment[] {
  const out: MoveSegment[] = []
  for (const layer of dungeonLayers) {
    const walls = resolveWalls(layer)
    const byId = new Map(walls.map((w) => [w.id, w]))
    const jointIds = new Set(connectorChildren(layer.children ?? []).map((c) => c.id))
    const doors = resolveDoors(layer, walls).filter((d) => d.door.visible && !jointIds.has(d.door.id))
    const segs = layerOcclusion(layer, walls, doors)
    const layerWidth = layer.style?.wallWidth ?? 0.5
    for (const seg of segs) {
      if (!seg.blocksMovement) continue
      const wall = seg.sourceType === 'wall' ? byId.get(seg.sourceId) : undefined
      const extra: Partial<MoveSegment> =
        seg.sourceType === 'door'
          ? { doorId: seg.sourceId }
          : {
              wallKind: wall?.kind ?? 'standalone',
              width:
                wall?.kind === 'cave'
                  ? (wall.bandWidth ?? layerWidth)
                  : wall?.kind === 'standalone'
                    ? (wall.width ?? layerWidth)
                    : layerWidth,
            }
      const pts = seg.points
      for (let i = 0; i < pts.length - 1; i++) {
        out.push({ x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1], ...extra })
      }
    }
    // A blocking prop with a round footprint (a rock pillar) stops walking round its ring.
    for (const e of roundPropSegments(layer.children ?? [])) out.push({ ...e })
  }
  return out
}

/**
 * A layer's walls split at its doors, its connectors' doorways and its erased openings, with its
 * rock lines (`DungeonLayer.rockLines`) standing in for the drawn walls they carry. A layer with
 * no rock line, or none that carries a wall, is split exactly as it always was.
 */
function layerOcclusion(layer: DungeonLayer, walls: ResolvedWall[], doors: ResolvedDoor[]): OcclusionSegment[] {
  const openings = openingApertures(layer, walls)
  // Stairs along a cave wall open its rock as an Opening does.
  const apertures = [...toOcclusionDoors([...doors, ...stairOpenings(layer, walls)], walls), ...connectorApertures(layer, walls), ...openings]
  // A plateau cliff's own line never carries a wall: only the walls' lines are read here.
  const lines = wallLines(layer.rockLines)
  const carrier = lines?.length ? carriersOf(layer, lines, walls) : null
  if (!lines || !carrier || carrier.size === 0) return buildOcclusionSegments(walls, apertures)
  return withRockLines(walls, apertures, lines, carrier, new Set(openings.map((o) => o.id)))
}

const carrierMemo = new WeakMap<RockLine[], { walls: ResolvedWall[]; carrier: Map<string, number> }>()

/**
 * Which rock line carries each floor or cave wall (by index into `lines`): the first live one
 * with both the wall's ends on its edge. A line is live while its edge is still one of the
 * layer's floor rings or painted cave rings; one whose outline has since changed carries
 * nothing, so the drawn edge blocks as before. Memoised on the lines and the walls.
 */
function carriersOf(layer: DungeonLayer, lines: RockLine[], walls: ResolvedWall[]): Map<string, number> {
  const hit = carrierMemo.get(lines)
  if (hit && hit.walls === walls) return hit.carrier
  const rings = [...(layer.mergedFloor ?? []), ...caveEdges(layer).flatMap((c) => c.rings)]
  const boxes = lines.map((line) => (rings.some((r) => laidFor(line, r)) ? boxOf(line.edge) : null))
  const carrier = new Map<string, number>()
  for (const wall of walls) {
    if (wall.kind !== 'floor' && wall.kind !== 'cave') continue
    const a = wall.points[0]
    const b = wall.points[wall.points.length - 1]
    const k = lines.findIndex((line, i) => {
      const box = boxes[i]
      return !!box && inBox(box, a) && inBox(box, b) && onRockEdge(a, line) && onRockEdge(b, line)
    })
    if (k >= 0) carrier.set(wall.id, k)
  }
  carrierMemo.set(lines, { walls, carrier })
  return carrier
}

type Box = [number, number, number, number]

function boxOf(pts: [number, number][]): Box {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of pts) {
    box[0] = Math.min(box[0], x)
    box[1] = Math.min(box[1], y)
    box[2] = Math.max(box[2], x)
    box[3] = Math.max(box[3], y)
  }
  return box
}

const inBox = (box: Box, [x, y]: [number, number]): boolean =>
  x >= box[0] - 0.05 && x <= box[2] + 0.05 && y >= box[1] - 0.05 && y <= box[3] + 0.05

/** How far from a door's end the end of its rock may lie and still be joined to it, cells. */
const JAMB_REACH = 1
/** Two points closer than this are one, cells (occlusion's shortest segment). */
const JAMB_MIN = 0.01

/**
 * The walls no line carries, split as ever; each carrying line's runs, solid both ways; the
 * doors on the carried walls, worked out on the drawn walls as ever (a shut one blocks between
 * its ends, an open one does not); and from each end of such a door a short solid jamb to the
 * nearest run end within JAMB_REACH, so nothing slips between the door and its rock. An erased
 * opening's ends are not joined. A run or a jamb is named after a wall its line carries, so the
 * walk grid reads that wall's kind and width off it.
 */
function withRockLines(
  walls: ResolvedWall[],
  apertures: DoorChild[],
  lines: RockLine[],
  carrier: Map<string, number>,
  openings: Set<string>,
): OcclusionSegment[] {
  const out = buildOcclusionSegments(walls.filter((w) => !carrier.has(w.id)), apertures)
  const solid = (points: [number, number][], sourceId: string): OcclusionSegment => ({
    points,
    ...WALL_TYPE_OCCLUSION.normal,
    direction: 'both',
    sourceType: 'wall',
    sourceId,
  })
  const named = new Map<number, string>()
  for (const [id, k] of carrier) if (!named.has(k)) named.set(k, id)
  for (const [k, id] of named) for (const run of lines[k].runs) if (run.length >= 2) out.push(solid(run, id))

  const byWall = new Map<string, DoorChild[]>()
  for (const door of apertures) {
    if (!carrier.has(door.wallId)) continue
    const list = byWall.get(door.wallId)
    if (list) list.push(door)
    else byWall.set(door.wallId, [door])
  }
  // Each door's span ends, by door: a door cut across several walls (or a polyline's runs) has
  // spans that meet, and where two meet is the doorway's middle, not its end.
  const ends = new Map<string, { at: [number, number]; wall: string }[]>()
  for (const wall of walls) {
    const own = byWall.get(wall.id)
    if (!own) continue
    for (const seg of buildOcclusionSegments([wall], own)) {
      if (seg.sourceType !== 'door') continue
      out.push(seg)
      if (openings.has(seg.sourceId)) continue
      const list = ends.get(seg.sourceId) ?? []
      ends.set(seg.sourceId, list)
      list.push({ at: seg.points[0], wall: wall.id }, { at: seg.points[seg.points.length - 1], wall: wall.id })
    }
  }
  for (const list of ends.values()) {
    for (const end of list) {
      if (list.some((o) => o !== end && dist(o.at, end.at) < JAMB_MIN)) continue
      const to = nearestRunEnd(lines[carrier.get(end.wall)!], end.at)
      if (to) out.push(solid([end.at, to], end.wall))
    }
  }
  return out
}

const dist = (a: [number, number], b: [number, number]): number => Math.hypot(b[0] - a[0], b[1] - a[1])

/** The end of one of `line`'s open runs nearest `p` within JAMB_REACH; null when none, or when one already meets it. */
function nearestRunEnd(line: RockLine, p: [number, number]): [number, number] | null {
  let best: [number, number] | null = null
  let bestD = JAMB_REACH
  for (const run of line.runs) {
    if (run.length < 2 || dist(run[0], run[run.length - 1]) < JAMB_MIN) continue
    for (const q of [run[0], run[run.length - 1]]) {
      const d = dist(p, q)
      if (d <= bestD) {
        best = q
        bestD = d
      }
    }
  }
  return best && bestD >= JAMB_MIN ? best : null
}
