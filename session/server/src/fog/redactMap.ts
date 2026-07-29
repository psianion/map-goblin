// §2.3.1 — the map a player is allowed to hold, and the slice of it a reveal hands over.
//
// The two-tier geometry policy of D4 in one sentence: a room the party has *ever* seen
// keeps its geometry forever (without it, a reload renders explored rooms black), and a
// room nobody has entered has none of it — no floor, no walls, no props, not even the id.
// Unzoned map is the DM's alone (D6) and an unrevealed secret door does not exist.

import { seedDoor, type AuthoredDoor, type DoorLiveState } from '@dnd/mechanics/doors'
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

/**
 * The geometry a `reveal-secret` owes a player (D2/D5).
 *
 * A room reveal pays this debt through `mapDeltaFor`: the state that says "revealed" and the
 * shapes to draw it travel in one frame. Letting the party in on a secret door incurs exactly
 * the same debt — the door child was cut from their map while it was still a secret — and it
 * is the only door write that can, because every other door in the scene came with the room
 * it belongs to. `kept` is the *explored* set, not the newly-revealed one: the rooms either
 * side of this door are ones the party has already earned, so the door keeps both bindings.
 */
export function doorDeltaFor(
  scene: SceneMap,
  sceneId: string,
  doorIds: ReadonlySet<string>,
  kept: ReadonlySet<string>,
): MapDelta {
  return {
    sceneId,
    layers: scene.data.layers
      .filter(isDungeon)
      .map((layer) => ({
        id: layer.id,
        rooms: [] as Room[],
        children: childrenOf(layer)
          .filter((child): child is DoorChild => child.childType === 'door' && doorIds.has(child.id))
          .map((door) => facing(door, kept)) as AnyChild[],
        standaloneWalls: [] as WallSegment[],
      }))
      .filter((layer) => layer.children.length > 0),
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
 * A door is the property of the rooms it joins: one the player has seen keeps it, and a
 * door bound to neither (the map never zoned it) is unzoned map, which is DM-only. The one
 * rule behind both the geometry cut and the live doors slice a player is sent.
 */
function doorBound(door: AuthoredDoor, kept: ReadonlySet<string>): boolean {
  return (!!door.roomA && kept.has(door.roomA)) || (!!door.roomB && kept.has(door.roomB))
}

/** …and a secret door does not exist at all until the DM says so. */
export function doorKept(door: DoorChild, kept: ReadonlySet<string>, doors: Doors): boolean {
  const live = doors[door.id] ?? seedDoor(door)
  if (door.isSecret && !live.revealed) return false
  return doorBound(door, kept)
}

/**
 * A door on the edge of the known world keeps only the side the player has been. Room ids
 * are a hash of the room's centroid, so the far side's id is a coordinate nobody has
 * earned yet; `null` is the shape the map already uses for "leads outside".
 *
 * The authored name goes with the binding, and for the same reason: "Reliquary Door" in the
 * wall of the one room a party has entered names what is behind it as plainly as the id
 * does, and the editor names doors after their rooms because that is what a DM would call
 * them. Blank, not renamed — the client's own `doorLabel` already falls back to "Door N",
 * which is exactly what a player standing in front of it knows.
 */
function facing(door: DoorChild, kept: ReadonlySet<string>): DoorChild {
  const unearned = (room: string | null | undefined) => !!room && !kept.has(room)
  return {
    ...door,
    name: unearned(door.roomA) || unearned(door.roomB) ? '' : door.name,
    roomA: door.roomA && kept.has(door.roomA) ? door.roomA : null,
    roomB: door.roomB && kept.has(door.roomB) ? door.roomB : null,
  }
}

function pick(names: Record<string, string>, kept: ReadonlySet<string>): Record<string, string> {
  const seen: Record<string, string> = {}
  for (const [roomId, name] of Object.entries(names)) if (kept.has(roomId)) seen[roomId] = name
  return seen
}
