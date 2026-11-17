// D3 layer 2 — concealment. Line of sight at room resolution: no raycasting, just a BFS
// over the rooms-and-doors graph. Pure on purpose; the caller recomputes on fog/door/
// token-room mutations and caches the result, so this never runs per frame or per message.

import { seedDoor, type AuthoredDoor, type BlockedEdge, type DoorLiveState } from '../doors/types'
import type { RoomFog, SceneFog } from './types'

/**
 * Just what picking the default room needs — a core `Room` satisfies it as-is, so nothing
 * here has to know about boundaries or centroids (and mechanics keeps its type-only reach
 * into @dnd/core, D3).
 */
export interface FogRoom {
  id: string
  area: number
  isPathway: boolean
}

/**
 * The room a scene falls back to when the DM has revealed nothing: the largest room that is
 * not a corridor, lowest id breaking a tie, and the largest room of any kind on a map that
 * is all corridor. Deterministic on purpose — the server and the client each compute it and
 * they have to land on the same room without a round trip. Null only for an unzoned map.
 */
export function defaultRoom<R extends FogRoom>(rooms: readonly R[]): R | null {
  const pool = rooms.filter((room) => !room.isPathway)
  let best: R | null = null
  for (const room of pool.length ? pool : rooms) {
    if (!best || room.area > best.area || (room.area === best.area && room.id < best.id)) {
      best = room
    }
  }
  return best
}

const EFFECTIVELY_REVEALED: RoomFog = { status: 'revealed', wasEverRevealed: true }

/**
 * The fog the *rules* run on, as opposed to the fog the DM has stored (amendment
 * 2026-07-28). Two read-time corrections, both of which exist so a player is never handed a
 * scene with nothing in it — nothing is written back, and no latch is set:
 *
 *  - Nothing stored as `revealed` (a fresh scene, a `reset`, a Hide All) ⇒ the default room
 *    is revealed, and concealment is off for it. Off, because the fallback's whole job is
 *    that the screen is not black: routing it through the reachability BFS would put it
 *    straight back there whenever the party is somewhere else. The DM revealing any real
 *    room switches the effective set back to stored state and the fallback disappears.
 *  - No party token on the map ⇒ concealment has nothing to measure (there is nobody to be
 *    shut behind a door *from*), so the revealed set is the answer.
 *
 * Every consumer of `visibleRooms` and of the room-geometry cut runs its fog through this
 * first; there are two of them (the server's vision cache and the player's fog renderer)
 * and they must not disagree about which rooms exist.
 */
export function effectiveFog(
  fog: SceneFog,
  rooms: readonly FogRoom[],
  playerRoomIds: readonly string[],
): SceneFog {
  const concealBehindDoors = fog.concealBehindDoors && playerRoomIds.length > 0
  const lit = Object.values(fog.rooms).some((room) => room.status === 'revealed')
  const fallback = lit ? null : defaultRoom(rooms)
  if (!fallback) return { ...fog, concealBehindDoors }
  // Spread, never rebuilt from two fields: the scene's mode, share, auto-explore and region
  // memory are the fog too, and a branch that drops them hands its caller a scene that
  // silently reverted to rooms mode.
  return {
    ...fog,
    rooms: { ...fog.rooms, [fallback.id]: EFFECTIVELY_REVEALED },
    concealBehindDoors: false,
  }
}

/**
 * The rooms the player role may currently see — one set for the whole party, not per
 * player. `roomGraph` is the scene's authored doors: `roomA`/`roomB` are the edge it
 * connects (null = exterior). `doors` is the live overlay; doors missing from it fall
 * back to their authored state, the same seeding the doors module does.
 */
export function visibleRooms(
  sceneFog: SceneFog,
  doors: Record<string, DoorLiveState>,
  roomGraph: readonly AuthoredDoor[],
  playerRoomIds: readonly string[],
): Set<string> {
  const revealed = new Set<string>()
  for (const [roomId, fog] of Object.entries(sceneFog.rooms)) {
    if (fog.status === 'revealed') revealed.add(roomId)
  }
  if (!sceneFog.concealBehindDoors) return revealed

  const links = new Map<string, string[]>()
  for (const door of roomGraph) {
    const live = doors[door.id] ?? seedDoor(door)
    // A door you do not know exists is a wall, even if the map authored it open.
    if (!live.open || (door.isSecret && !live.revealed)) continue
    const a = door.roomA
    const b = door.roomB
    if (!a || !b) continue
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const neighbours = links.get(from)
      if (neighbours) neighbours.push(to)
      else links.set(from, [to])
    }
  }

  const reached = new Set(playerRoomIds)
  const queue = [...reached]
  for (let i = 0; i < queue.length; i++) {
    for (const next of links.get(queue[i]) ?? []) {
      if (reached.has(next)) continue
      reached.add(next)
      queue.push(next)
    }
  }

  // Reachable *and* revealed: the party standing in a re-hidden room still sees nothing
  // there (D7 keeps their own token visible — that is the token redactor's job, not this).
  const visible = new Set<string>()
  for (const roomId of reached) if (revealed.has(roomId)) visible.add(roomId)
  return visible
}

export type { BlockedEdge } from '../doors/types'

/**
 * The edge fact `visibleRooms` throws away: of the doors joining `room` to somewhere the
 * party already stands, why none of them could be crossed.
 *
 * `visibleRooms` answers a boolean, and a refusal built on that boolean can only say "you
 * can't go there". This says which door said no, so a move refusal can name it.
 *
 * A secret door the party has not found is deliberately NOT a cause. It reports as no
 * explanation at all, so the refusal falls back to the generic line and a player probing a
 * blank wall learns nothing from the wording — the same shrug `doorRefusal` gives an
 * unknown door id.
 *
 * The door named is the nearest one on the way: adjacency answers first, and a room further
 * off falls through to the path search below. A player two rooms from a shut door was told
 * only "you can't move there" while the same door, stepped up to, named itself — the same
 * refusal reading as two different answers depending on where the token happened to stand.
 *
 * Naming it leaks nothing the seat does not already hold: the id alone goes on the wire and
 * the client resolves it against the doors the redactor handed it, so a door this party has
 * not earned still reads as the nameless line (`doorRefusal`).
 */
export function blockedEdge(
  doors: Record<string, DoorLiveState>,
  roomGraph: readonly AuthoredDoor[],
  partyRoomIds: readonly string[],
  room: string,
): BlockedEdge | null {
  const from = new Set(partyRoomIds)
  let closed: BlockedEdge | null = null
  for (const door of roomGraph) {
    const { roomA: a, roomB: b } = door
    if (!a || !b) continue
    if (!((a === room && from.has(b)) || (b === room && from.has(a)))) continue

    const live = doors[door.id] ?? seedDoor(door)
    if (live.open) continue
    // A door they do not know is there explains nothing they are allowed to hear.
    if (door.isSecret && !live.revealed) continue
    // Locked outranks merely closed: it is the one a player cannot fix by pushing.
    if (live.locked) return { kind: 'locked-door', doorId: door.id }
    // First one wins, so two shut doors onto the same room name the same one every time —
    // a refusal that alternates between them reads as two different answers.
    closed ??= { kind: 'closed-door', doorId: door.id }
  }
  return closed ?? alongThePath(doors, roomGraph, partyRoomIds, room)
}

/**
 * The first shut door between the party and a room no door of theirs touches — what the
 * adjacency pass above has nothing to say about.
 *
 * Two hops, because the answer is settled the moment a path leaves the open world: flood
 * the rooms the party can already walk to, then fan out through everything beyond, and the
 * door a room was first reached across is the one standing in the way. Breadth-first, so
 * that is the nearest way in and not merely some way in. A room reachable the long way
 * round is inside the first flood and is never blamed on a shut door on a shorter path.
 *
 * A secret door the party has not found is left out of the graph entirely, for the reason
 * the adjacency pass skips it: it is not a fact they are allowed to hear, and here it must
 * not be a step on the path either.
 */
function alongThePath(
  doors: Record<string, DoorLiveState>,
  roomGraph: readonly AuthoredDoor[],
  partyRoomIds: readonly string[],
  room: string,
): BlockedEdge | null {
  const liveOf = (door: AuthoredDoor): DoorLiveState => doors[door.id] ?? seedDoor(door)
  const edges = new Map<string, AuthoredDoor[]>()
  for (const door of roomGraph) {
    const { roomA: a, roomB: b } = door
    if (!a || !b) continue
    if (door.isSecret && !liveOf(door).revealed) continue
    for (const side of [a, b]) {
      const known = edges.get(side)
      if (known) known.push(door)
      else edges.set(side, [door])
    }
  }
  const across = (door: AuthoredDoor, at: string): string =>
    (door.roomA === at ? door.roomB : door.roomA) as string

  // Everywhere the party can already walk. `room` among them is shut off by nothing.
  const open = new Set(partyRoomIds)
  const queue = [...open]
  for (let i = 0; i < queue.length; i++) {
    for (const door of edges.get(queue[i]) ?? []) {
      const to = across(door, queue[i])
      if (!liveOf(door).open || open.has(to)) continue
      open.add(to)
      queue.push(to)
    }
  }
  if (open.has(room)) return null

  // Beyond it. Every first step out of `open` crosses a shut door — an open one would have
  // been walked already — and once a path is stopped, the door that stopped it is the
  // answer for everything further along, so the blocker is set on the way out and carried.
  const blocker = new Map<string, BlockedEdge>()
  const beyond = [...open]
  for (let i = 0; i < beyond.length; i++) {
    const at = beyond[i]
    const carried = blocker.get(at)
    for (const door of edges.get(at) ?? []) {
      const to = across(door, at)
      if (open.has(to) || blocker.has(to)) continue
      const live = liveOf(door)
      const edge =
        carried ?? ({ kind: live.locked ? 'locked-door' : 'closed-door', doorId: door.id } as const)
      blocker.set(to, edge)
      beyond.push(to)
    }
  }
  return blocker.get(room) ?? null
}
