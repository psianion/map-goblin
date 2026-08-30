// D8's occupancy matrix. module.test.ts mocks `canOccupy` to pin the call site, so the
// rule itself is exercised here, where nothing is mocked.

import { describe, expect, it } from 'vitest'
import { canOccupy, occupyRefusal, snap } from './validate'
import { DOOR_CLOSED, DOOR_LOCKED, refusalSubject } from '../doors/types'
import { MOVE_BLOCKED, OUTSIDE_MAP, ROOM_UNEXPLORED, type SceneVision, type Token } from './types'

/**
 * Three rooms in a row plus open map past them: `seen` is lit and reachable, `dark` was
 * revealed once but the party cannot reach it now, `unseen` is a room nobody has entered.
 * Past x=30 the map is unzoned (D6).
 */
const scene: SceneVision = {
  roomAt: (x) => (x < 10 ? 'seen' : x < 20 ? 'dark' : x < 30 ? 'unseen' : null),
  visible: new Set(['seen']),
  occupiable: new Set(['seen', 'dark']),
}

const token = { id: 't1', size: 'medium' } as Token
const at = (x: number) => canOccupy(token, { x, y: 1.5 }, scene, 'player')

describe('canOccupy (D8)', () => {
  it('lets a player into a room the party can see', () => {
    expect(at(1.5)).toBe(true)
  })

  it('lets a player into a re-hidden room they can still reach (D7)', () => {
    expect(at(15.5)).toBe(true)
  })

  it('refuses a room nobody has ever seen', () => {
    expect(at(25.5)).toBe(false)
  })

  it('refuses unzoned map, which no command can reveal (D6)', () => {
    expect(at(35.5)).toBe(false)
  })

  it.each([1.5, 15.5, 25.5, 35.5])('lets the DM stand at %f regardless', (x) => {
    expect(canOccupy(token, { x, y: 1.5 }, scene, 'dm')).toBe(true)
  })

  it('fences nobody on a map with no authored rooms', () => {
    expect(canOccupy(token, { x: 35.5, y: 1.5 }, null, 'player')).toBe(true)
  })

  it('judges the snapped destination, so the rule and the grid agree', () => {
    // 9.9 snaps to 9.5 — still the lit room; 10.1 snaps to 10.5 and is not.
    expect(at(snap(9.9, 'medium'))).toBe(true)
    expect(scene.visible.has(scene.roomAt(snap(10.1, 'medium'), 1.5)!)).toBe(false)
  })
})

/**
 * The same matrix, read for its cause instead of its verdict. Every case asserts the typed
 * prefix, because that is the part the client matches on — the sentence after it is for a
 * human and may be reworded.
 */
describe('occupyRefusal — why a space refused', () => {
  const why = (x: number, vision: SceneVision = scene) =>
    occupyRefusal(token, { x, y: 1.5 }, vision, 'player')

  it('says nothing at all when the space is fine', () => {
    expect(why(1.5)).toBeNull()
    expect(why(15.5)).toBeNull()
  })

  it('names an unexplored room as unexplored, not as blocked', () => {
    expect(why(25.5)).toContain(ROOM_UNEXPLORED)
  })

  it('names unzoned map separately from a room they cannot enter (D6)', () => {
    expect(why(35.5)).toContain(OUTSIDE_MAP)
  })

  it('names a locked door when one shut the room off, and which door it was', () => {
    const withDoor: SceneVision = {
      ...scene,
      blockedEdge: () => ({ kind: 'locked-door', doorId: 'door-vault' }),
    }
    // Reuses the doors module's own constant, so the shipped client already has words.
    expect(why(25.5, withDoor)).toContain(DOOR_LOCKED)
    // The id, never the name: what a player may read of a door's name is the map
    // redactor's call, and the client resolves it against the doors it was handed.
    expect(refusalSubject(why(25.5, withDoor)!)).toBe('door-vault')
  })

  it('names a closed door as a closed door, not as a bare block', () => {
    const withDoor: SceneVision = {
      ...scene,
      blockedEdge: () => ({ kind: 'closed-door', doorId: 'door-gallery' }),
    }
    expect(why(25.5, withDoor)).toContain(DOOR_CLOSED)
    expect(refusalSubject(why(25.5, withDoor)!)).toBe('door-gallery')
  })

  it('names no subject when no door explains the refusal', () => {
    expect(refusalSubject(why(25.5)!)).toBeNull()
  })

  it('calls a seen-but-unreachable room blocked even with no door to name', () => {
    const seenButShut: SceneVision = {
      roomAt: () => 'hall',
      visible: new Set(['hall']),
      occupiable: new Set(),
    }
    expect(why(1.5, seenButShut)).toContain(MOVE_BLOCKED)
  })

  it('keeps the sentence the shipped client gates on', () => {
    // `tokenRefusal` decides a refusal is a move refusal by this substring. Dropping it
    // would silently stop every move refusal reaching the player.
    for (const x of [25.5, 35.5]) expect(why(x)).toContain('cannot be occupied')
  })

  it('tells the DM nothing, because nothing refuses them', () => {
    expect(occupyRefusal(token, { x: 35.5, y: 1.5 }, scene, 'dm')).toBeNull()
  })
})

/**
 * Vision mode's cell record, at the occupancy seam. The live Goblin Warren is the case:
 * a forest clearing and a cave whose floors do not touch, with unzoned yards between them
 * that no room covers — so the room graph has no edge to walk and the DM's reveal has no
 * room to land in. `openGround` is the only thing that can let the party cross, and it must
 * not become a way past a room rule the fog already decided.
 */
describe('occupyRefusal — open ground in vision mode', () => {
  const revealed = new Set(['35,1', '36,1'])
  const withGround = (): SceneVision => ({
    ...scene,
    openGround: (x, y) => revealed.has(`${Math.floor(x)},${Math.floor(y)}`),
  })
  const why = (x: number, vision: SceneVision) =>
    occupyRefusal(token, { x, y: 1.5 }, vision, 'player')

  it('lets a player onto unzoned ground the party has been shown', () => {
    expect(why(35.5, withGround())).toBeNull()
    expect(canOccupy(token, { x: 35.5, y: 1.5 }, withGround(), 'player')).toBe(true)
  })

  it('still refuses unzoned ground nobody has revealed', () => {
    expect(why(45.5, withGround())).toContain(OUTSIDE_MAP)
  })

  it('never overrides a room rule: an unseen room stays unseen even if its cells are on', () => {
    // The whole map remembered, room record untouched. A room is still judged as a room —
    // otherwise a DM brush over a boss chamber would hand the party the floor of it.
    const everywhere: SceneVision = { ...scene, openGround: () => true }
    expect(why(25.5, everywhere)).toContain(ROOM_UNEXPLORED)
    expect(why(1.5, everywhere)).toBeNull()
  })

  it('leaves rooms mode alone — no openGround, D6 as it was', () => {
    expect(why(35.5, scene)).toContain(OUTSIDE_MAP)
  })
})
