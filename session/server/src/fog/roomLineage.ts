// Room lineage at publish (§10): a split or a merge in the editor must not cost the party the
// ground it has already explored. Fog is keyed by room id, and the editor records where a new
// id came from on the room itself — `derivedFrom` (the half a split cut off) and `mergedFrom`
// (rooms folded into a keeper). Publish reads both once, carries the fog across, and strips
// them from the stored map: lineage is an instruction to this route, not map data.
//
// Fog ids stay opaque strings here; nothing below looks inside one.

import type { RoomFog, SceneFog } from '@dnd/mechanics/fog'
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

/** Most-revealed first: a merged room is as lit as the most lit of the rooms it absorbed. */
const STATUS_RANK: Record<RoomFog['status'], number> = { never_revealed: 0, re_hidden: 1, revealed: 2 }

/**
 * The scene's fog with lineage carried across, or null when nothing changed.
 *
 * - Split (`derivedFrom`): the new half gets a copy of the parent's fog, but only when the
 *   half is new to this scene (`previousRoomIds` is the room set of the map being replaced).
 *   The editor keeps lineage on its own document until it next saves, so the same split can
 *   arrive in several publishes; copying again over a half the party has since played in
 *   would overwrite its own fog with its parent's.
 * - Merge (`mergedFrom`): `wasEverRevealed` is OR-ed into the keeper, its status becomes the
 *   most revealed of the group, and the folded ids' fog is dropped — those ids no longer name
 *   a room. Idempotent: a second publish finds nothing left to fold.
 */
export function carryFog(
  fog: SceneFog,
  lineage: RoomLineage,
  previousRoomIds: ReadonlySet<string>,
): SceneFog | null {
  const rooms: Record<string, RoomFog> = { ...fog.rooms }
  let changed = false

  for (const [childId, parentId] of lineage.derived) {
    const parent = fog.rooms[parentId]
    if (!parent || previousRoomIds.has(childId) || rooms[childId]) continue
    rooms[childId] = { ...parent }
    changed = true
  }

  for (const [keeperId, folded] of lineage.merged) {
    const group = [rooms[keeperId], ...folded.map((id) => rooms[id])].filter(
      (r): r is RoomFog => r !== undefined,
    )
    const present = folded.filter((id) => id !== keeperId && rooms[id] !== undefined)
    if (present.length === 0) continue
    let best = group[0]!
    for (const r of group) if (STATUS_RANK[r.status] > STATUS_RANK[best.status]) best = r
    rooms[keeperId] = { status: best.status, wasEverRevealed: group.some((r) => r.wasEverRevealed) }
    for (const id of present) delete rooms[id]
    changed = true
  }

  return changed ? { ...fog, rooms } : null
}
