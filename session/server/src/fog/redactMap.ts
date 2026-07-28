// §2.3.1 — the map a player is allowed to hold, and the slice of it a reveal hands over.
//
// The two-tier geometry policy of D4 in one sentence: a room the party has *ever* seen
// keeps its geometry forever (without it, a reload renders explored rooms black), and a
// room nobody has entered has none of it — no floor, no walls, no props, not even the id.
// Unzoned map is the DM's alone (D6) and an unrevealed secret door does not exist.

import { seedDoor, type DoorLiveState } from '@dnd/mechanics/doors'
import type { SceneFog } from '@dnd/mechanics/fog'
import type { AnyChild, DoorChild, Room, WallSegment } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { centreOf, childrenOf, isDungeon, wallsOf, type SceneMap } from './sceneMap'

/** One layer's worth of newly available geometry, shaped to be merged by layer id. */
export interface MapDeltaLayer {
  id: string
  rooms: Room[]
  children: AnyChild[]
  standaloneWalls: WallSegment[]
}

/**
 * §2.1/D5 — rides on the `fog` state-update that reveals the rooms it carries, so a client
 * never knows a room is revealed before it has the geometry to draw. Placement JSON only:
 * textures shipped with the asset packs at join.
 */
export interface MapDelta {
  sceneId: string
  layers: MapDeltaLayer[]
}

type Doors = Record<string, DoorLiveState>

/** Rooms the party has ever seen — the geometry a player keeps (D4). */
export function exploredRooms(fog: SceneFog): Set<string> {
  const explored = new Set<string>()
  for (const [roomId, room] of Object.entries(fog.rooms)) {
    if (room.wasEverRevealed) explored.add(roomId)
  }
  return explored
}

/** The player's copy of a scene's map. The DM's copy is the file, untouched. */
export function redactMapForViewer(
  scene: SceneMap,
  fog: SceneFog,
  doors: Doors,
): SerializedMapData {
  const kept = exploredRooms(fog)
  return {
    ...scene.data,
    layers: scene.data.layers.map((layer) => {
      // A layer nobody zoned has no fog to enforce — room-granular fog needs rooms (D6).
      if (!isDungeon(layer) || !layer.rooms?.length) return layer
      return {
        ...layer,
        ...slice(layer, scene, kept, doors),
        // The merged floor is one union across the whole layer, so it cannot be cut per
        // room — and handing it over would outline every room in the dungeon. The client
        // rebuilds it from the children it has; the editor already ships it null.
        mergedFloor: null,
        roomNameOverrides: pick(layer.roomNameOverrides ?? {}, kept),
      }
    }),
  }
}

/** The same cut, restricted to the rooms that just became the player's (D5). */
export function mapDeltaFor(
  scene: SceneMap,
  sceneId: string,
  rooms: readonly string[],
  doors: Doors,
): MapDelta {
  const kept = new Set(rooms)
  return {
    sceneId,
    layers: scene.data.layers
      .filter(isDungeon)
      .map((layer) => ({ id: layer.id, ...slice(layer, scene, kept, doors) }))
      .filter((layer) => layer.rooms.length > 0),
  }
}

function slice(
  layer: DungeonLayer,
  scene: SceneMap,
  kept: ReadonlySet<string>,
  doors: Doors,
): { rooms: Room[]; children: AnyChild[]; standaloneWalls: WallSegment[] } {
  return {
    rooms: (layer.rooms ?? []).filter((room) => kept.has(room.id)),
    children: childrenOf(layer)
      .filter((child) =>
        child.childType === 'door' ? doorKept(child, kept, doors) : childKept(child, scene, kept),
      )
      .map((child) => (child.childType === 'door' ? facing(child, kept) : child)),
    // A wall belongs to the rooms on either side of it, so one shared with a room the
    // player has seen survives — it is that room's own outline either way.
    standaloneWalls: wallsOf(layer).filter((wall) =>
      scene.roomsAlong(wall).some((room) => kept.has(room)),
    ),
  }
}

function childKept(child: AnyChild, scene: SceneMap, kept: ReadonlySet<string>): boolean {
  const [x, y] = centreOf(child)
  const room = scene.roomAt(x, y)
  return room !== null && kept.has(room)
}

/**
 * A secret door does not exist until the DM says so. Otherwise a door is the property of
 * the rooms it joins: one the player has seen keeps it, and a door bound to neither (the
 * map never zoned it) is unzoned map, which is DM-only.
 */
function doorKept(door: DoorChild, kept: ReadonlySet<string>, doors: Doors): boolean {
  const live = doors[door.id] ?? seedDoor(door)
  if (door.isSecret && !live.revealed) return false
  return (!!door.roomA && kept.has(door.roomA)) || (!!door.roomB && kept.has(door.roomB))
}

/**
 * A door on the edge of the known world keeps only the side the player has been. Room ids
 * are a hash of the room's centroid, so the far side's id is a coordinate nobody has
 * earned yet; `null` is the shape the map already uses for "leads outside".
 */
function facing(door: DoorChild, kept: ReadonlySet<string>): DoorChild {
  return {
    ...door,
    roomA: door.roomA && kept.has(door.roomA) ? door.roomA : null,
    roomB: door.roomB && kept.has(door.roomB) ? door.roomB : null,
  }
}

function pick(names: Record<string, string>, kept: ReadonlySet<string>): Record<string, string> {
  const seen: Record<string, string> = {}
  for (const [roomId, name] of Object.entries(names)) if (kept.has(roomId)) seen[roomId] = name
  return seen
}
