import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, type GoblinEvent } from './observer'
import { chunkLines, createSessionLog, mapNames } from './session-log'

const noNames = (): undefined => undefined

const snapshot = (modules: Record<string, unknown> = {}): GoblinEvent => ({
  type: 'session-state',
  state: {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 'sess-1',
    campaignId: 'camp-1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Cragmaw Hideout', mapId: 'map-1' }],
    players: [],
    modules,
  },
})

const roll = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  at: 1_000,
  playerName: 'Willow',
  visibility: 'public',
  ...over,
})

describe('createSessionLog', () => {
  it('seeds from the first snapshot without speaking — the campaign tail is history', () => {
    const log = createSessionLog(noNames)
    expect(log.apply(snapshot({ rolls: { log: [roll('r1')] } }))).toEqual([])
    // The same entry on a later frame stays seen.
    expect(log.apply({ type: 'rolls', state: { log: [roll('r1')] } })).toEqual([])
  })

  it('speaks a new entry exactly once across repeated frames', () => {
    const log = createSessionLog(noNames)
    log.apply(snapshot())
    const first = log.apply({ type: 'rolls', state: { log: [roll('r1', { total: 17 })] } })
    expect(first).toHaveLength(1)
    expect(first[0].text).toContain('**Willow**')
    expect(first[0].text).toContain('**17**')
    // The module state is cumulative — the next update carries r1 again, plus r2.
    const second = log.apply({
      type: 'rolls',
      state: { log: [roll('r1', { total: 17 }), roll('r2', { at: 2_000, total: 3 })] },
    })
    expect(second).toHaveLength(1)
    expect(second[0].text).toContain('**3**')
  })

  it('speaks the unseen tail of a resync snapshot — a brief disconnect eats nothing', () => {
    const log = createSessionLog(noNames)
    log.apply(snapshot({ rolls: { log: [roll('r1')] } }))
    const resync = log.apply(snapshot({ rolls: { log: [roll('r1'), roll('r2', { at: 2_000 })] } }))
    expect(resync).toHaveLength(1)
  })

  it('formats a roll with character, title, math and the private mark', () => {
    const log = createSessionLog(noNames)
    log.apply(snapshot())
    const [line] = log.apply({
      type: 'rolls',
      state: {
        log: [
          roll('r1', {
            characterName: 'Karlach',
            title: 'Stealth',
            total: 14,
            formula: '1d20+3',
            breakdown: '11+3',
            visibility: 'private',
          }),
        ],
      },
    })
    expect(line.text).toContain('**Willow (Karlach)**')
    expect(line.text).toContain('Stealth')
    expect(line.text).toContain('`1d20+3 = 11+3`')
    expect(line.text).toContain('🔒')
    expect(line.text).toContain('<t:1:t>')
  })

  it('renders door and fog lines with the name when it has one, degraded when not', () => {
    const names = new Map([['door-1', 'the Oak Door']])
    const log = createSessionLog((id) => names.get(id))
    log.apply(snapshot())
    const entry = (id: string, action: string, targetId?: string) => ({
      id,
      at: 1_000,
      actor: 'Willow',
      action,
      sceneId: 'scene-1',
      targetId,
    })
    const [named] = log.apply({ type: 'doors', state: { byScene: {}, log: [entry('d1', 'opened', 'door-1')] } })
    expect(named.text).toContain('Willow opened the Oak Door')
    const [unnamed] = log.apply({ type: 'fog', state: { log: [entry('f1', 'revealed-room', 'room-9')] } })
    expect(unnamed.text).toContain('Willow revealed a room')
    // An action this build has no words for is dropped, not half-printed.
    expect(log.apply({ type: 'doors', state: { byScene: {}, log: [entry('d2', 'levitated')] } })).toEqual([])
  })

  it('prints trigger lines as written and presence and scene lines in the quiet register', () => {
    const log = createSessionLog(noNames)
    log.apply(snapshot())
    const [trigger] = log.apply({
      type: 'triggers',
      state: { byScene: { 'scene-1': { log: [{ id: 't1', at: 1_000, text: 'A dart flies from the wall!' }] } } },
    })
    expect(trigger.text).toContain('*A dart flies from the wall!*')
    const [joined] = log.apply({
      type: 'player-joined',
      player: { identityId: 'p1', name: 'Zed', role: 'player', connected: true },
    })
    expect(joined.text).toContain('*Zed joined the table*')
    const [scene] = log.apply({ type: 'scene-changed', sceneId: 'scene-1' })
    expect(scene.text).toContain('*Scene: Cragmaw Hideout*')
    // A scene the snapshot never named still prints, by id.
    expect(log.apply({ type: 'scene-changed', sceneId: 'scene-9' })[0].text).toContain('scene-9')
  })
})

describe('mapNames', () => {
  it('indexes room names (override winning) and door names off dungeon layers', () => {
    const doc = {
      layers: [
        {
          type: 'dungeon',
          rooms: [
            { id: 'room-1', name: 'Room 1' },
            { id: 'room-2', name: 'Room 2' },
          ],
          roomNameOverrides: { 'room-1': 'Chapel of the Pale Flame' },
          children: [
            { childType: 'door', id: 'door-1', name: 'the Oak Door' },
            { childType: 'shape', id: 'shape-1', name: 'nope' },
          ],
        },
        { type: 'assets', rooms: [{ id: 'x', name: 'never' }] },
      ],
    }
    const names = mapNames(doc)
    expect(names.get('room-1')).toBe('Chapel of the Pale Flame')
    expect(names.get('room-2')).toBe('Room 2')
    expect(names.get('door-1')).toBe('the Oak Door')
    expect(names.has('shape-1')).toBe(false)
    expect(names.has('x')).toBe(false)
  })

  it('shrugs at garbage', () => {
    expect(mapNames(null).size).toBe(0)
    expect(mapNames({ layers: [{ type: 'dungeon', rooms: [{ id: 1, name: '' }] }] }).size).toBe(0)
  })
})

describe('chunkLines', () => {
  it('keeps everything in one chunk when it fits', () => {
    expect(chunkLines(['a', 'b'])).toEqual(['a\nb'])
  })

  it('breaks between lines, never inside one', () => {
    const chunks = chunkLines(['aaaa', 'bbbb', 'cccc'], 9)
    expect(chunks).toEqual(['aaaa\nbbbb', 'cccc'])
  })

  it('returns nothing for nothing', () => {
    expect(chunkLines([])).toEqual([])
  })
})
