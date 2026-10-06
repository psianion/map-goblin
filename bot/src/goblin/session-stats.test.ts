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

  it('leaves its own two seats off the roster entirely', () => {
    // Both of the bot's own seats are named this by the server.
    const botDm = { identityId: 'bot-dm', name: 'Goblin Bot', role: 'dm' as const, connected: true }
    const botPlayer = { identityId: 'bot-p', name: 'Goblin Bot', role: 'player' as const, connected: true }
    const stats = feed([
      { type: 'session-state', state: state({ players: [botDm, botPlayer, player('Zed')] }) },
      { type: 'player-joined', player: botPlayer },
      { type: 'player-left', player: botDm },
    ])
    expect(stats.live().players).toEqual(['Zed'])
    expect(stats.recap(0).players).toEqual(['Zed'])
    expect(stats.recap(0).peakPlayers).toBe(1)
    // And the bot's own DM seat does not get to report the DM as present, nor its departure
    // as the DM leaving — the human DM never connected here.
    expect(stats.live().dmConnected).toBe(false)
  })

  it('ignores a second bot seat coming and going while the human DM is at the table', () => {
    // Any further seat the server mints for the bot is named after the same stem. Its
    // arrival and departure are not the DM's.
    const second = { identityId: 'bot-2', name: 'Goblin Bot 2', role: 'dm' as const, connected: true }
    const stats = feed([
      {
        type: 'session-state',
        state: state({
          players: [{ identityId: 'dm', name: 'The DM', role: 'dm' as const, connected: true }, second, player('Zed')],
        }),
      },
      { type: 'player-joined', player: second },
      { type: 'player-left', player: second },
    ])
    expect(stats.live().players).toEqual(['Zed'])
    expect(stats.live().dmConnected).toBe(true)
  })

  it('resumes from a seed: cumulative counters continue, the live view does not', () => {
    const stats = createSessionStats(0, {
      scenes: ['The Vault'],
      doorsOpened: 4,
      players: ['Zed', 'Mira'],
      peakPlayers: 2,
    })
    stats.apply({ type: 'session-state', state: state({ players: [player('Zed')] }) })
    stats.apply(doors({ 'scene-1': { d1: door(false) } }))
    stats.apply(doors({ 'scene-1': { d1: door(true) } }))

    const recap = stats.recap(0)
    expect(recap.doorsOpened).toBe(5)
    expect(recap.scenes).toEqual(['The Vault', 'Cragmaw Hideout'])
    expect(recap.players).toEqual(['Zed', 'Mira'])
    // Seeded peak survives a smaller present set; who is here now is the snapshot's word.
    expect(recap.peakPlayers).toBe(2)
    expect(stats.live().players).toEqual(['Zed'])
  })

  it('starts at zero with no seed', () => {
    expect(feed([]).recap(0)).toMatchObject({ scenes: [], doorsOpened: 0, players: [], peakPlayers: 0 })
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

describe('session stats — the party\'s swept ground', () => {
  const mask = (bits: string) => ({ minX: 0, minY: 0, cols: 8, rows: 2, bits })

  it('keeps the latest region per scene from a fog event', () => {
    const stats = feed([
      { type: 'fog', state: { byScene: { 'scene-1': { region: mask('AQA=') } } } },
      { type: 'fog', state: { byScene: { 'scene-1': { region: mask('AwA=') }, 'scene-2': { region: mask('/wA=') } } } },
    ])
    expect(stats.region('scene-1')?.bits).toBe('AwA=')
    expect(stats.region('scene-2')?.bits).toBe('/wA=')
    expect(stats.region('scene-3')).toBeUndefined()
  })

  it('seeds the region from a session-state snapshot', () => {
    const stats = feed([
      { type: 'session-state', state: state({ modules: { fog: { byScene: { 'scene-1': { region: mask('AQA=') } } } } }) },
    ])
    expect(stats.region('scene-1')?.bits).toBe('AQA=')
  })

  it('drops a region the fog module has stopped carrying rather than showing a stale one', () => {
    const stats = feed([
      { type: 'fog', state: { byScene: { 'scene-1': { region: mask('AQA=') } } } },
      { type: 'fog', state: { byScene: { 'scene-1': {} } } },
    ])
    expect(stats.region('scene-1')).toBeUndefined()
  })
})
