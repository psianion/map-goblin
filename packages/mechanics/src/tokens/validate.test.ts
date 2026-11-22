// D8's occupancy rule. module.test.ts mocks `canOccupy` to pin the call site, so the
// rule itself is exercised here, where nothing is mocked.

import { describe, expect, it } from 'vitest'
import { canOccupy, occupyRefusal, snap } from './validate'
import { refusalSubject } from '../doors/types'
import { ROOM_UNEXPLORED, type SceneVision, type Token } from './types'

/** Ground the players have west of x = 10 on the first level, and everywhere on 'loft'. */
const scene: SceneVision = {
  roomAt: () => null,
  known: (levelId, x) => levelId === 'loft' || x < 10,
}

const token = { id: 't1', size: 'medium' } as Token
const at = (x: number) => canOccupy(token, { x, y: 1.5 }, scene, 'player')

describe('canOccupy (D8)', () => {
  it('lets a player onto ground the party has', () => {
    expect(at(1.5)).toBe(true)
  })

  it('refuses ground the party does not have', () => {
    expect(at(15.5)).toBe(false)
  })

  it.each([1.5, 15.5, 35.5])('lets the DM stand at %f regardless', (x) => {
    expect(canOccupy(token, { x, y: 1.5 }, scene, 'dm')).toBe(true)
  })

  it('fences nobody on a scene with no map', () => {
    expect(canOccupy(token, { x: 35.5, y: 1.5 }, null, 'player')).toBe(true)
  })

  it('judges the snapped destination, so the rule and the grid agree', () => {
    // 9.9 snaps to 9.5 — still known ground; 10.1 snaps to 10.5 and is not.
    expect(at(snap(9.9, 'medium'))).toBe(true)
    expect(at(snap(10.1, 'medium'))).toBe(false)
  })
})

/**
 * The same rule, read for its cause instead of its verdict. Every case asserts the typed
 * prefix, because that is the part the client matches on — the sentence after it is for a
 * human and may be reworded.
 */
describe('occupyRefusal — why a space refused', () => {
  const why = (x: number, vision: SceneVision = scene) =>
    occupyRefusal(token, { x, y: 1.5 }, vision, 'player')

  it('lets a player stand on known ground and refuses the rest as unexplored, where no walk grid answers', () => {
    expect(why(5.5)).toBeNull()
    expect(why(15.5)).toMatch(new RegExp(`^${ROOM_UNEXPLORED}`))
    expect(occupyRefusal({ ...token, levelId: 'loft' }, { x: 15.5, y: 1.5 }, scene, 'player')).toBeNull()
  })

  it('names no subject for ground the party does not have', () => {
    expect(refusalSubject(why(15.5)!)).toBeNull()
  })

  it('keeps the sentence the shipped client gates on', () => {
    // `tokenRefusal` decides a refusal is a move refusal by this substring. Dropping it
    // would silently stop every move refusal reaching the player.
    expect(why(15.5)).toContain('cannot be occupied')
  })

  it('leaves the walk grid the whole answer where there is one', () => {
    const walked: SceneVision = { ...scene, walkRefusal: () => null }
    expect(why(15.5, walked)).toBeNull()
  })

  it('tells the DM nothing, because nothing refuses them', () => {
    expect(occupyRefusal(token, { x: 35.5, y: 1.5 }, scene, 'dm')).toBeNull()
  })
})
