import { describe, expect, it } from 'vitest'
import { createSessionStats } from './session-stats'
import { PROTOCOL_VERSION, type DoorsState, type GoblinEvent, type SessionState } from './observer'

const SCENES = [
  { id: 'scene-1', name: 'Cragmaw Hideout', mapId: 'map-1' },
  { id: 'scene-2', name: 'The Vault', mapId: 'map-2' },
]

const state = (over: Partial<SessionState> = {}): SessionState => ({
  protocolVersion: PROTOCOL_VERSION,
  sessionId: 'sess-1',
  campaignId: 'camp-1',
  activeSceneId: 'scene-1',
  scenes: SCENES,
  players: [],
  ...over,
})

const player = (name: string, connected = true) =>
  ({ identityId: `id-${name}`, name, role: 'player' as const, connected })

const doors = (byScene: DoorsState['byScene']): GoblinEvent => ({ type: 'doors', state: { byScene } })
const door = (open: boolean) => ({ open, locked: false, revealed: true })

function feed(events: GoblinEvent[], startedAt = 0) {
  const stats = createSessionStats(startedAt)
  events.forEach((event) => stats.apply(event))
  return stats
}

describe('session stats', () => {
  it('names the scenes the table visited, in order, once each', () => {
    const stats = feed([
      { type: 'session-state', state: state() },
      { type: 'scene-changed', sceneId: 'scene-2' },
      { type: 'scene-changed', sceneId: 'scene-1' },
    ])
    expect(stats.recap(0).scenes).toEqual(['Cragmaw Hideout', 'The Vault'])
    expect(stats.live().sceneName).toBe('Cragmaw Hideout')
  })

  it('tracks who is here now and everyone who was, with the peak', () => {
    const stats = feed([
      { type: 'session-state', state: state({ players: [player('Zed')] }) },
      { type: 'player-joined', player: player('Mira') },
      { type: 'player-joined', player: player('Bolt') },
      { type: 'player-left', player: player('Mira', false) },
    ])
    expect(stats.live().players).toEqual(['Zed', 'Bolt'])
    const recap = stats.recap(0)
    expect(recap.players).toEqual(['Zed', 'Mira', 'Bolt'])
    expect(recap.peakPlayers).toBe(3)
  })

  it('keeps the DM out of the player list and off to the side', () => {
    const dm = { identityId: 'dm', name: 'The DM', role: 'dm' as const, connected: true }
    const stats = feed([{ type: 'session-state', state: state({ players: [dm, player('Zed')] }) }])
    expect(stats.live().players).toEqual(['Zed'])
    expect(stats.live().dmConnected).toBe(true)
    stats.apply({ type: 'dm-disconnected' })
    expect(stats.live().dmConnected).toBe(false)
    stats.apply({ type: 'dm-reconnected' })
    expect(stats.live().dmConnected).toBe(true)
  })

  it('counts a door only on a closed → open transition it actually watched', () => {
    const stats = feed([
      { type: 'session-state', state: state() },
      // First state is a baseline: `d2` is already open and was not opened on our watch.
      doors({ 'scene-1': { d1: door(false), d2: door(true) } }),
      doors({ 'scene-1': { d1: door(true), d2: door(true) } }),
      // Closing and re-opening the same door is two visits through the same doorway.
      doors({ 'scene-1': { d1: door(false), d2: door(true) } }),
      doors({ 'scene-1': { d1: door(true), d2: door(true) } }),
    ])
    expect(stats.recap(0).doorsOpened).toBe(2)
  })

  it('counts doors per scene, not per door id', () => {
    const stats = feed([
      { type: 'session-state', state: state() },
      doors({ 'scene-1': { d1: door(false) }, 'scene-2': { d1: door(false) } }),
      doors({ 'scene-1': { d1: door(true) }, 'scene-2': { d1: door(true) } }),
    ])
    expect(stats.recap(0).doorsOpened).toBe(2)
  })

  it('re-baselines doors across a reconnect rather than counting the gap', () => {
    const stats = feed([
      { type: 'session-state', state: state() },
      doors({ 'scene-1': { d1: door(false), d2: door(false) } }),
      doors({ 'scene-1': { d1: door(true), d2: door(false) } }),
      // The socket dropped. What happened while it was gone is unknowable, so the snapshot
      // resets the baseline and the doors that opened meanwhile are not counted.
      { type: 'session-state', state: state() },
      doors({ 'scene-1': { d1: door(true), d2: door(true) } }),
    ])
    expect(stats.recap(0).doorsOpened).toBe(1)
  })

  it('lets a reconnect snapshot replace the live view without erasing the recap', () => {
    const stats = feed([
      { type: 'session-state', state: state({ players: [player('Zed'), player('Mira')] }) },
      { type: 'scene-changed', sceneId: 'scene-2' },
      // Comes back with a different roster on a different scene — the live view is the
      // snapshot's, the recap is still the whole evening's.
      { type: 'session-state', state: state({ activeSceneId: 'scene-1', players: [player('Bolt')] }) },
    ])
    expect(stats.live().players).toEqual(['Bolt'])
    expect(stats.live().sceneName).toBe('Cragmaw Hideout')
    const recap = stats.recap(0)
    expect(recap.players).toEqual(['Zed', 'Mira', 'Bolt'])
    expect(recap.scenes).toEqual(['Cragmaw Hideout', 'The Vault'])
    expect(recap.peakPlayers).toBe(2)
  })

  it('takes the doors baseline from a snapshot that carries one', () => {
    const stats = feed([
      {
        type: 'session-state',
        state: state({ modules: { doors: { byScene: { 'scene-1': { d1: door(false) } } } } }),
      },
      doors({ 'scene-1': { d1: door(true) } }),
    ])
    // No blind first update: the snapshot said the door was shut, so opening it counts.
    expect(stats.recap(0).doorsOpened).toBe(1)
  })

  it('measures the table from start to end and never goes negative', () => {
    const stats = feed([], 1_000)
    expect(stats.recap(1_000 + 90 * 60_000).durationMs).toBe(90 * 60_000)
    expect(stats.recap(0).durationMs).toBe(0)
  })
})
