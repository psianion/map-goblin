import { describe, expect, it } from 'vitest'
import type { PlayerInfo } from '@dnd/core/src/shared/protocol'
import type { ModuleContext } from '../contract'
import { STORY_INITIAL, carryDismissals, storyModule, type StoryState } from './module'

const ALICE: PlayerInfo = { identityId: 'alice', name: 'Alice', role: 'player', connected: true }
const BOB: PlayerInfo = { identityId: 'bob', name: 'Bob', role: 'player', connected: true }
const DM: PlayerInfo = { identityId: 'dm', name: 'Deb', role: 'dm', connected: true }

function table(shareReadAloud?: (roomId: string) => string | null) {
  const module = storyModule({ shareReadAloud: shareReadAloud && ((roomId) => shareReadAloud(roomId)) })
  let current: StoryState = STORY_INITIAL
  const run = (who: PlayerInfo, action: string, payload: unknown) => {
    if (!module.commands[action]?.includes(who.role)) return { code: 'unauthorized' }
    const ctx: ModuleContext<StoryState> = {
      campaignId: 'c1',
      sessionId: 's1',
      activeSceneId: 'scene-1',
      sender: { role: who.role, identityId: who.identityId },
      players: [ALICE, BOB, DM],
      state: current,
      setState: (next) => {
        current = next
      },
      broadcast: () => {},
    }
    return module.handler(action, payload, ctx)
  }
  const view = (who: PlayerInfo) => module.redact!(current, { role: who.role, identityId: who.identityId })
  return { run, state: () => current, view }
}

describe('story', () => {
  it('handouts are the DM’s; a player is sent none until one is shown to them', () => {
    const t = table()
    expect(t.run(DM, 'handout-upsert', { id: 'h1', caption: 'The letter', text: 'Meet me at dawn.' })).toBeUndefined()
    expect(t.run(ALICE, 'handout-upsert', { caption: 'x', text: 'y' })).toMatchObject({ code: 'unauthorized' })
    expect(t.view(ALICE).handouts).toEqual([])
  })

  it('refuses a handout with neither image nor text', () => {
    const t = table()
    expect(t.run(DM, 'handout-upsert', { caption: 'Empty' })).toMatchObject({ code: 'invalid-command' })
  })

  it('show to some reaches only them, journals it, and hide takes it off screen', () => {
    const t = table()
    t.run(DM, 'handout-upsert', { id: 'h1', caption: 'Map', assetId: 'a1' })
    t.run(DM, 'show', { handoutId: 'h1', audience: ['alice'], mode: 'full' })
    expect(t.view(ALICE).shown).toMatchObject({ handoutId: 'h1', audience: ['alice'], mode: 'full' })
    expect(t.view(ALICE).handouts.map((h) => h.id)).toEqual(['h1'])
    expect(t.view(BOB).shown).toBeNull()
    expect(t.view(BOB).handouts).toEqual([])
    expect(t.view(BOB).journal).toEqual([])
    t.run(DM, 'hide', {})
    expect(t.state().shown).toBeNull()
    // Still in Alice's journal after it is hidden.
    expect(t.view(ALICE).handouts).toHaveLength(1)
  })

  it('an image-only handout keeps its image and reaches the seat it was shown to', () => {
    const t = table()
    expect(t.run(DM, 'handout-upsert', { id: 'h1', caption: 'Map', assetId: 'a1' })).toBeUndefined()
    expect(t.state().handouts).toEqual([{ id: 'h1', caption: 'Map', assetId: 'a1' }])
    t.run(DM, 'show', { handoutId: 'h1', audience: ['alice'] })
    expect(t.view(ALICE).handouts).toEqual([{ id: 'h1', caption: 'Map', assetId: 'a1' }])
  })

  it('refuses deleting an unknown handout', () => {
    expect(table().run(DM, 'handout-delete', { id: 'nope' })).toMatchObject({ code: 'invalid-command' })
  })

  it('refuses showing an unknown handout or to an unknown player', () => {
    const t = table()
    t.run(DM, 'handout-upsert', { id: 'h1', caption: 'Map', assetId: 'a1' })
    expect(t.run(DM, 'show', { handoutId: 'nope' })).toMatchObject({ code: 'invalid-command' })
    expect(t.run(DM, 'show', { handoutId: 'h1', audience: ['zed'] })).toMatchObject({ code: 'invalid-command' })
  })

  it('deleting a handout takes it off screen and out of the journal', () => {
    const t = table()
    t.run(DM, 'handout-upsert', { id: 'h1', caption: 'Map', assetId: 'a1' })
    t.run(DM, 'show', { handoutId: 'h1' })
    t.run(DM, 'handout-delete', { id: 'h1' })
    expect(t.state()).toMatchObject({ shown: null, journal: [], handouts: [] })
  })

  it('a title card shows to everyone and is journaled', () => {
    const t = table()
    t.run(DM, 'title-show', { text: 'Chapter 2: The Warren', mode: 'full' })
    expect(t.view(BOB).titleCard).toMatchObject({ text: 'Chapter 2: The Warren', mode: 'full' })
    expect(t.view(BOB).journal.map((j) => j.kind)).toEqual(['title'])
    t.run(DM, 'title-hide', {})
    expect(t.state().titleCard).toBeNull()
  })

  it('share-readaloud runs the existing share path and journals the room', () => {
    const shared: string[] = []
    const t = table((roomId) => {
      shared.push(roomId)
      return null
    })
    expect(t.run(DM, 'share-readaloud', { roomId: 'r1' })).toBeUndefined()
    expect(shared).toEqual(['r1'])
    expect(t.state().journal[0]).toMatchObject({ kind: 'readaloud', ref: 'r1', sceneId: 'scene-1' })
  })

  it('a refused share journals nothing', () => {
    const t = table(() => "room 'r1' has no read-aloud to share")
    expect(t.run(DM, 'share-readaloud', { roomId: 'r1' })).toMatchObject({ code: 'invalid-command' })
    expect(t.state().journal).toEqual([])
  })
})

// Table fix pass F27: showing a handout again replaced nothing and added a second journal row.
describe('a handout shown twice (F27)', () => {
  it('keeps one journal row, shared with everyone it was ever shown to', () => {
    const t = table()
    t.run(DM, 'handout-upsert', { id: 'h1', caption: 'The letter', text: 'Meet me at dawn.' })
    t.run(DM, 'show', { handoutId: 'h1', audience: ['alice'] })
    t.run(DM, 'show', { handoutId: 'h1', audience: ['bob'] })
    const rows = t.state().journal.filter((j) => j.kind === 'handout' && j.ref === 'h1')
    expect(rows).toHaveLength(1)
    expect(rows[0].audience).toEqual(['alice', 'bob'])
    t.run(DM, 'show', { handoutId: 'h1' })
    expect(t.state().journal.filter((j) => j.ref === 'h1').map((j) => j.audience)).toEqual(['all'])
  })
})

describe('"Hide for me" (table lobby pass §4)', () => {
  const handout = { id: 'h1', caption: 'A letter', text: 'Dear all' }

  it('hides it from that seat for good, a fresh snapshot included, and leaves it in the journal', () => {
    const t = table()
    t.run(DM, 'handout-upsert', handout)
    t.run(DM, 'show', { handoutId: 'h1' })
    const shownAt = t.state().shown!.shownAt
    expect(t.run(ALICE, 'dismiss', { what: 'handout', shownAt })).toBeUndefined()
    // A redact of the stored state is exactly what a reload's snapshot is.
    expect(t.view(ALICE).shown).toBeNull()
    expect(t.view(ALICE).handouts.map((h) => h.id)).toEqual(['h1'])
    expect(t.view(BOB).shown).toMatchObject({ handoutId: 'h1' })
    expect(t.state().shown!.dismissed).toEqual([{ id: 'alice', name: 'Alice' }])
    // Twice is once.
    t.run(ALICE, 'dismiss', { what: 'handout', shownAt })
    expect(t.state().shown!.dismissed).toHaveLength(1)
  })

  it('a second showing reaches a seat that hid the first, and a stale dismissal does nothing', () => {
    const t = table()
    t.run(DM, 'handout-upsert', handout)
    t.run(DM, 'show', { handoutId: 'h1' })
    const first = t.state().shown!.shownAt
    t.run(ALICE, 'dismiss', { what: 'handout', shownAt: first })
    t.run(DM, 'hide', {})
    t.run(DM, 'show', { handoutId: 'h1' })
    // Same millisecond or not, the second showing is a new one with nobody on its list.
    expect(t.state().shown!.shownAt).toBeGreaterThan(first)
    expect(t.state().shown!.dismissed).toEqual([])
    expect(t.view(ALICE).shown).toMatchObject({ handoutId: 'h1' })
    t.run(ALICE, 'dismiss', { what: 'handout', shownAt: first })
    expect(t.state().shown!.dismissed).toEqual([])
  })

  it('works on the title card the same way, and never sends a player the list', () => {
    const t = table()
    t.run(DM, 'title-show', { text: 'Chapter One' })
    t.run(BOB, 'dismiss', { what: 'title', shownAt: t.state().titleCard!.shownAt })
    expect(t.view(BOB).titleCard).toBeNull()
    expect(t.view(ALICE).titleCard).toMatchObject({ text: 'Chapter One', dismissed: [] })
    expect(t.view(DM).titleCard!.dismissed).toEqual([{ id: 'bob', name: 'Bob' }])
    t.run(DM, 'handout-upsert', handout)
    t.run(DM, 'show', { handoutId: 'h1' })
    t.run(BOB, 'dismiss', { what: 'handout', shownAt: t.state().shown!.shownAt })
    expect(t.view(ALICE).shown!.dismissed).toEqual([])
    expect(t.run(DM, 'dismiss', { what: 'title', shownAt: 0 })).toMatchObject({ code: 'unauthorized' })
    expect(t.run(BOB, 'dismiss', { what: 'map', shownAt: 0 })).toMatchObject({ code: 'invalid-command' })
  })

  it('a returning name keeps its dismissal; another name does not get it', () => {
    const t = table()
    t.run(DM, 'title-show', { text: 'Chapter One' })
    t.run(ALICE, 'dismiss', { what: 'title', shownAt: t.state().titleCard!.shownAt })
    const carried = carryDismissals(t.state(), 'alice-2', '  ALICE ')
    expect(storyModule().redact!(carried, { role: 'player', identityId: 'alice-2' }).titleCard).toBeNull()
    expect(carryDismissals(t.state(), 'carl', 'Carl')).toBe(t.state())
  })

  it('reads a row stored before it: what is on show has no dismissals yet', () => {
    const old = { ...STORY_INITIAL, titleCard: { text: 'Old', mode: 'over', shownAt: 5 } } as unknown as StoryState
    expect(storyModule().redact!(old, { role: 'player', identityId: 'alice' }).titleCard).toMatchObject({ text: 'Old', dismissed: [] })
  })
})
