// S3 P3 §2 — the light list both sides run. Every row here is a rule the referee's redaction
// and the player's mask have to answer identically, which is why the rule is one function.

import { describe, expect, it } from 'vitest'
import { lightSources, type LightCarrier, type PlacedLight } from './light'

const BRAZIER: PlacedLight = { id: 'brazier', x: 2, y: 3, radius: 6 }
const DOUSED: PlacedLight = { id: 'doused', x: 8, y: 3, radius: 6, visible: false }

const carrier = (over: Partial<LightCarrier> = {}): LightCarrier => ({
  x: 5,
  y: 5,
  hidden: false,
  light: { dim: 8, bright: 4 },
  ...over,
})

describe('what is burning in a scene', () => {
  it('takes the map’s authored lights as authored while the table has not touched them', () => {
    expect(lightSources([BRAZIER, DOUSED], [], {})).toEqual([{ x: 2, y: 3, radius: 6 }])
  })

  it('lets the table’s own switch beat the map, both ways', () => {
    // A trigger lit the doused one and put the brazier out — the overrides are the truth.
    expect(lightSources([BRAZIER, DOUSED], [], { brazier: false, doused: true })).toEqual([
      { x: 8, y: 3, radius: 6 },
    ])
  })

  it('carries a token’s own light, at the outer of its two radii', () => {
    // dim is the reach, bright is the plateau inside it — the mechanics only ever ask how far.
    expect(lightSources([], [carrier()], {})).toEqual([{ x: 5, y: 5, radius: 8 }])
    expect(lightSources([], [carrier({ light: { dim: 3, bright: 9 } })], {})).toEqual([
      { x: 5, y: 5, radius: 9 },
    ])
  })

  it('never lights a hidden token’s position', () => {
    expect(lightSources([], [carrier({ hidden: true })], {})).toEqual([])
  })

  it('does not care who claims the token — an NPC’s lantern lights the room', () => {
    expect(lightSources([], [carrier(), carrier({ light: null })], {})).toHaveLength(1)
  })

  it('drops a source with no reach at all rather than sweeping a point', () => {
    expect(
      lightSources([{ id: 'spark', x: 0, y: 0, radius: 0 }], [carrier({ light: { dim: 0, bright: 0 } })], {}),
    ).toEqual([])
  })
})
