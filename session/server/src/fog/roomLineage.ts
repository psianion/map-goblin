// Room lineage at publish (§10). The editor records where a new room id came from on the room
// itself — `derivedFrom` (the half a split cut off) and `mergedFrom` (rooms folded into a
// keeper). Publish strips both from the stored map: lineage is an instruction to this route,
// not map data.

import type { SerializedMapData } from '@dnd/core/src/store/types'
import { isDungeon } from './sceneMap'

/** What the stored map said about where its rooms came from. */
export interface RoomLineage {
  /** [new room id, the room it was split from]. */
  derived: [string, string][]
  /** [keeper id, the ids folded into it]. */
  merged: [string, string[]][]
}

/**
 * Reads every room's lineage and strips it from `data` in place (the caller's own parse).
 * Returns null when no room carried any, so the caller can keep the uploaded bytes verbatim.
 */
export function takeLineage(data: SerializedMapData): RoomLineage | null {
  const lineage: RoomLineage = { derived: [], merged: [] }
  let stripped = false
  for (const layer of data.layers) {
    if (!isDungeon(layer) || !layer.rooms?.length) continue
    if (!layer.rooms.some((r) => r.derivedFrom !== undefined || r.mergedFrom !== undefined)) continue
    stripped = true
    layer.rooms = layer.rooms.map((room) => {
      if (room.derivedFrom === undefined && room.mergedFrom === undefined) return room
      const { derivedFrom, mergedFrom, ...rest } = room
      if (derivedFrom) lineage.derived.push([room.id, derivedFrom])
      if (mergedFrom?.length) lineage.merged.push([room.id, [...mergedFrom]])
      return rest
    })
  }
  // A room that carried an empty `mergedFrom` or a blank `derivedFrom` is stripped all the
  // same; there is just nothing to carry for it.
  return stripped ? lineage : null
}
