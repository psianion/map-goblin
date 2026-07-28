// D3 layer 2 — concealment. Line of sight at room resolution: no raycasting, just a BFS
// over the rooms-and-doors graph. Pure on purpose; the caller recomputes on fog/door/
// token-room mutations and caches the result, so this never runs per frame or per message.

import { seedDoor, type AuthoredDoor, type DoorLiveState } from '../doors/types'
import type { SceneFog } from './types'

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
