import { describe, expect, it } from 'vitest'
import { build, parse } from './custom-id'

describe('custom-id', () => {
  it('roundtrips namespace, action, owner and extras', () => {
    const id = build('map', 'refresh', '123456789012345678', 'scene-a', '2')
    expect(id).toBe('map:refresh:123456789012345678:scene-a:2')
    expect(parse(id)).toEqual({
      namespace: 'map',
      action: 'refresh',
      userId: '123456789012345678',
      extra: ['scene-a', '2'],
    })
  })

  it('throws over the 100-char cap instead of letting Discord reject it', () => {
    expect(() => build('map', 'refresh', '123456789012345678', 'x'.repeat(80))).toThrowError(/max 100/)
  })

  it('rejects separators and empties in parts', () => {
    expect(() => build('map', 'ref:resh', '1')).toThrowError(/separator/)
    expect(() => build('map', '', '1')).toThrowError(/non-empty/)
  })

  it('returns undefined for ids it did not build', () => {
    expect(parse('legacy-button')).toBeUndefined()
    expect(parse('map:refresh')).toBeUndefined()
  })

  it('detects a foreign owner', () => {
    const parsed = parse(build('map', 'refresh', 'owner-1'))
    expect(parsed?.userId).not.toBe('someone-else')
  })
})
