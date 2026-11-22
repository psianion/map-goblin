// Test support: a scene's fog turned on with whole rooms cleared, which is how the fog rework
// says what the old room reveal said — "the players have this room".
import { cellsCoveredByPolygon, rebaseRegion, setCells, type RegionMask, type SceneFog } from '@dnd/mechanics/fog'
import type { SceneMap } from './sceneMap'

/** Fog on, with every cell of each of `roomIds` (see {@link roomCells}) cleared on that room's level. */
export function fogOnWith(map: SceneMap, roomIds: readonly string[], extra: Partial<SceneFog> = {}): SceneFog {
  const frame = map.frame
  if (!frame) throw new Error('fogOnWith needs a map with a frame')
  const cleared: Record<string, RegionMask> = {}
  for (const id of roomIds) {
    const levelId = map.roomLevels.get(id)!
    cleared[levelId] = setCells(cleared[levelId] ?? rebaseRegion(undefined, frame)!, roomCells(map, id))
  }
  return { rooms: {}, concealBehindDoors: true, on: true, ...(Object.keys(cleared).length ? { cleared } : {}), ...extra }
}

/**
 * The cells of the frame whose centres the room itself holds, as `[col, row]`: a brush stroke over
 * it. A face's outline can enclose another room (a pillar, a nested chamber), whose cells are not
 * this room's, so each centre is asked which room it is in.
 */
export function roomCells(map: SceneMap, roomId: string): [number, number][] {
  const room = map.rooms.find((r) => r.id === roomId)
  const frame = map.frame
  if (!room || !frame) throw new Error(`no room '${roomId}' on the map`)
  const levelId = map.roomLevels.get(roomId)!
  return cellsCoveredByPolygon(room.boundary, frame).filter(
    ([col, row]) => map.roomAtOn(levelId, frame.minX + col + 0.5, frame.minY + row + 0.5) === roomId,
  )
}
