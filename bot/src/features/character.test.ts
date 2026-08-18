import { describe, expect, it } from 'vitest'
import { filterAutocomplete, leveledUp, myCharactersList } from './character'
import type { Character } from '../db/stores'

const char = (over: Partial<Character> = {}): Character => ({
  id: 1,
  discordId: 'user-1',
  campaignId: 'camp-1',
  name: 'Thalor',
  className: 'Ranger',
  level: 1,
  portraitUrl: null,
  lastPlayed: null,
  ...over,
})

describe('leveledUp', () => {
  it('is true only when the new level is higher', () => {
    expect(leveledUp(1, 2)).toBe(true)
    expect(leveledUp(2, 2)).toBe(false)
    expect(leveledUp(3, 2)).toBe(false)
  })
})

describe('myCharactersList', () => {
  it('lists every character with class and level', () => {
    const spec = myCharactersList('The Sunken Keep', [char({ name: 'Anna', level: 3 })])
    expect(spec.blocks?.[0]).toContain('Anna')
    expect(spec.blocks?.[0]).toContain('Ranger 3')
  })

  it('says so when there are none yet', () => {
    const spec = myCharactersList('The Sunken Keep', [])
    expect(spec.blocks?.[0]).toMatch(/haven't created/)
  })
})

describe('filterAutocomplete', () => {
  it('matches case-insensitively, empty query returns everything', () => {
    expect(filterAutocomplete(['Thalor', 'Bryn'], '')).toEqual(['Thalor', 'Bryn'])
    expect(filterAutocomplete(['Thalor', 'Bryn'], 'tha')).toEqual(['Thalor'])
  })

  it('caps at 25 choices', () => {
    const names = Array.from({ length: 30 }, (_, i) => `Char${i}`)
    expect(filterAutocomplete(names, '')).toHaveLength(25)
  })
})
