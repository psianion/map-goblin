// D8's occupancy matrix. module.test.ts mocks `canOccupy` to pin the call site, so the
// rule itself is exercised here, where nothing is mocked.

import { describe, expect, it } from 'vitest'
import { canOccupy, snap } from './validate'
import type { SceneVision, Token } from './types'

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
