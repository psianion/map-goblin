// S3 P4 §4 — the one predicate four call sites share (`sweep.partyVision`, `vision.compute`'s
// party rooms, `tokens.redact`, and the client's `sighted`). If this drifts, the referee and
// the mask stop agreeing about whose eyes the party is looking through.

import { describe, expect, it } from 'vitest'
import { sightParty, sightPartyIds } from './links'
import type { Token } from './types'

const token = (id: string, over: Partial<Token> = {}): Token => ({
  id,
  name: id,
  imageAssetId: null,
  size: 'medium',
  disposition: 'neutral',
  sight: null,
  light: null,
  defId: null,
  x: 0,
  y: 0,
  elevation: 0,
  z: 0,
  hidden: false,
  ownerId: null,
  ...over,
})

/** Both ends, the way `set-sight-link` stores them. */
function link(a: Token, b: Token): void {
  a.sharesSightWith = [...(a.sharesSightWith ?? []), b.id]
  b.sharesSightWith = [...(b.sharesSightWith ?? []), a.id]
}

const ids = (tokens: Token[]): string[] => sightParty(tokens).map((t) => t.id).sort()

describe('sightParty', () => {
  it('with no links is the claimed tokens and nothing else', () => {
    const scout = token('scout', { ownerId: 'p-1' })
    const orc = token('orc')
    expect(ids([scout, orc])).toEqual(['scout'])
  })

  it('follows a link from a claimed token to an unclaimed one', () => {
    const scout = token('scout', { ownerId: 'p-1' })
    const familiar = token('familiar')
    link(scout, familiar)
    expect(ids([scout, familiar])).toEqual(['familiar', 'scout'])
  })

  it('is transitive — a chain of links is one party', () => {
    const scout = token('scout', { ownerId: 'p-1' })
    const hawk = token('hawk')
    const rat = token('rat')
    link(scout, hawk)
    link(hawk, rat)
    expect(ids([scout, hawk, rat])).toEqual(['hawk', 'rat', 'scout'])
  })

  it('terminates on a cycle rather than walking it forever', () => {
    const a = token('a', { ownerId: 'p-1' })
    const b = token('b')
    const c = token('c')
    link(a, b)
    link(b, c)
    link(c, a)
    expect(ids([a, b, c])).toEqual(['a', 'b', 'c'])
  })

  it('excludes a hidden token AND refuses to pass a link through it', () => {
    const scout = token('scout', { ownerId: 'p-1' })
    const familiar = token('familiar', { hidden: true })
    const far = token('far')
    link(scout, familiar)
    link(familiar, far)
    // Hidden trumps links: the familiar is off the board, so what it was linked to is too.
    expect(ids([scout, familiar, far])).toEqual(['scout'])
  })

  it('ignores a link naming a token that is not in the scene', () => {
    const scout = token('scout', { ownerId: 'p-1', sharesSightWith: ['ghost'] })
    expect(ids([scout])).toEqual(['scout'])
  })

  it('a hidden CLAIMED token is not a seed either', () => {
    const scout = token('scout', { ownerId: 'p-1', hidden: true })
    const familiar = token('familiar')
    link(scout, familiar)
    expect(ids([scout, familiar])).toEqual([])
  })

  it('seeds on the caller’s own predicate — one viewer’s claims, not the whole party', () => {
    const mine = token('mine', { ownerId: 'p-1' })
    const theirs = token('theirs', { ownerId: 'p-2' })
    const familiar = token('familiar')
    link(mine, familiar)
    expect([...sightPartyIds([mine, theirs, familiar], (t) => t.ownerId === 'p-1')].sort()).toEqual(
      ['familiar', 'mine'],
    )
  })
})
