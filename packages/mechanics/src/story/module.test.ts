import { describe, expect, it } from 'vitest'
import type { PlayerInfo } from '@dnd/core/src/shared/protocol'
import type { ModuleContext } from '../contract'
import { STORY_INITIAL, storyModule, type StoryState } from './module'

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
    expect(t.view(ALICE).shown).toEqual({ handoutId: 'h1', audience: ['alice'], mode: 'full' })
    expect(t.view(ALICE).handouts.map((h) => h.id)).toEqual(['h1'])
    expect(t.view(BOB).shown).toBeNull()
    expect(t.view(BOB).handouts).toEqual([])
    expect(t.view(BOB).journal).toEqual([])
    t.run(DM, 'hide', {})
    expect(t.state().shown).toBeNull()
    // Still in Alice's journal after it is hidden.
    expect(t.view(ALICE).handouts).toHaveLength(1)
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
