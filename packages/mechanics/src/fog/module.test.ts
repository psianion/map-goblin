import { describe, expect, it } from 'vitest'

import type { Viewer } from '../contract'
import type { AuthoredDoor, DoorLiveState } from '../doors/types'
import { fogModule } from './module'
import type { FogState, SceneFog } from './types'
import { visibleRooms } from './visibility'

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const P1: Viewer = { role: 'player', identityId: 'p-1' }
const SCENE = 'map-1'
const ROOMS = ['hall', 'corridor-1', 'crypt', 'treasury']

/** Records what the module asked for, so the scene it looks rooms up in is pinned too. */
const lookups: Array<[string, string]> = []
const fog = fogModule((campaignId, sceneId) => {
  lookups.push([campaignId, sceneId])
  return ROOMS
})

const empty: FogState = { byScene: {} }

const stateWith = (rooms: SceneFog['rooms'], concealBehindDoors = true): FogState => ({
  byScene: { [SCENE]: { rooms, concealBehindDoors } },
})

/** Mirrors ModuleRegistry.dispatch: `commands` gates the role before the handler runs. */
function run(
  state: FogState,
  sender: Viewer,
  action: string,
  payload: unknown,
  activeSceneId: string | null = SCENE,
) {
  const roles = fog.commands[action]
  if (!roles) return { error: { code: 'invalid-command', message: '' }, next: state }
  if (!roles.includes(sender.role)) return { error: { code: 'unauthorized', message: '' }, next: state }
  let next = state
  const error = fog.handler(action, payload, {
    campaignId: 'c-1',
    sessionId: 's-1',
    activeSceneId,
    sender,
    players: [],
    state,
    setState: (s) => {
      next = s
    },
    broadcast: () => {},
  })
  return { error: error ?? null, next }
}

const roomsOf = (state: FogState) => state.byScene[SCENE].rooms

describe('authz matrix', () => {
  const dmOnly = [
    ['reveal', { roomId: 'hall' }],
    ['hide', { roomId: 'hall' }],
    ['reset', {}],
    ['set-bulk', { rooms: {} }],
    ['set-conceal', { concealBehindDoors: false }],
  ] as const

  it.each(dmOnly)('%s is dm-only', (action, payload) => {
    expect(run(empty, P1, action, payload).error).toMatchObject({ code: 'unauthorized' })
    // …and reaches the handler for a DM (may still fail validation, never authz)
    expect(run(empty, DM, action, payload).error?.code).not.toBe('unauthorized')
  })

  it('has no player-runnable command at all', () => {
    expect(Object.values(fog.commands).flat()).not.toContain('player')
  })

  it('rejects an unknown action and a non-object payload', () => {
    const ctx = {
      campaignId: 'c-1',
      sessionId: 's-1',
      activeSceneId: SCENE,
      sender: DM,
      players: [],
      state: empty,
      setState: () => {},
      broadcast: () => {},
    }
    expect(fog.handler('nope', {}, ctx)).toMatchObject({ code: 'invalid-command' })
    expect(fog.handler('reveal', 'not-an-object', ctx)).toMatchObject({ code: 'invalid-command' })
  })
})

describe('reveal and hide', () => {
  it('reveals a room and latches wasEverRevealed', () => {
    const { next, error } = run(empty, DM, 'reveal', { roomId: 'crypt' })
    expect(error).toBeNull()
    expect(roomsOf(next).crypt).toEqual({ status: 'revealed', wasEverRevealed: true })
    expect(next.byScene[SCENE].concealBehindDoors).toBe(true)
  })

  it('treats a corridor as an ordinary room (D6)', () => {
    const { error, next } = run(empty, DM, 'reveal', { roomId: 'corridor-1' })
    expect(error).toBeNull()
    expect(roomsOf(next)['corridor-1'].status).toBe('revealed')
  })

  it('refuses a room the map does not have, and looks it up in the right scene', () => {
    lookups.length = 0
    expect(run(empty, DM, 'reveal', { roomId: 'nowhere' }).error?.code).toBe('invalid-command')
    expect(run(empty, DM, 'reveal', { roomId: 42 }).error?.code).toBe('invalid-command')
    expect(lookups[0]).toEqual(['c-1', SCENE])
  })

  it('hides only a room somebody has already seen', () => {
    expect(run(empty, DM, 'hide', { roomId: 'hall' }).error?.code).toBe('invalid-command')
    const seen = stateWith({ hall: { status: 'revealed', wasEverRevealed: true } })
    const { next, error } = run(seen, DM, 'hide', { roomId: 'hall' })
    expect(error).toBeNull()
    expect(roomsOf(next).hall).toEqual({ status: 're_hidden', wasEverRevealed: true })
  })

  it('will not hide a room whose record exists but was never revealed', () => {
    const never = stateWith({ hall: { status: 'never_revealed', wasEverRevealed: false } })
    expect(run(never, DM, 'hide', { roomId: 'hall' }).error?.code).toBe('invalid-command')
  })

  it('re-reveals a re-hidden room', () => {
    const hidden = stateWith({ hall: { status: 're_hidden', wasEverRevealed: true } })
    expect(roomsOf(run(hidden, DM, 'reveal', { roomId: 'hall' }).next).hall.status).toBe('revealed')
  })

  it('falls back to the active scene, and refuses when there is neither', () => {
    expect(run(empty, DM, 'reveal', { roomId: 'hall', sceneId: 'map-2' }).next.byScene['map-2']).toBeDefined()
    expect(run(empty, DM, 'reveal', { roomId: 'hall' }, null).error?.code).toBe('invalid-command')
  })
})

describe('reset', () => {
  const played = stateWith(
    {
      hall: { status: 'revealed', wasEverRevealed: true },
      crypt: { status: 're_hidden', wasEverRevealed: true },
    },
    false,
  )

  it('clears the latch, so a reset scene cannot be hidden again', () => {
    const { next } = run(played, DM, 'reset', {})
    expect(roomsOf(next)).toEqual({})
    expect(run(next, DM, 'hide', { roomId: 'hall' }).error?.code).toBe('invalid-command')
  })

  it('leaves the scene conceal toggle alone', () => {
    expect(run(played, DM, 'reset', {}).next.byScene[SCENE].concealBehindDoors).toBe(false)
  })
})

describe('set-bulk (D9)', () => {
  it('replaces the whole record', () => {
    const before = stateWith({ hall: { status: 'revealed', wasEverRevealed: true } })
    const { next, error } = run(before, DM, 'set-bulk', {
      rooms: { crypt: { status: 're_hidden', wasEverRevealed: true } },
    })
    expect(error).toBeNull()
    expect(roomsOf(next)).toEqual({ crypt: { status: 're_hidden', wasEverRevealed: true } })
  })

  it('parses every entry off the wire', () => {
    const cases: unknown[] = [
      { rooms: { nowhere: { status: 'revealed', wasEverRevealed: true } } },
      { rooms: { hall: { status: 'lit', wasEverRevealed: true } } },
      { rooms: { hall: { status: 'revealed' } } },
      // a seen room cannot arrive claiming it never was
      { rooms: { hall: { status: 're_hidden', wasEverRevealed: false } } },
      { rooms: 'all' },
      {},
    ]
    for (const payload of cases) {
      expect(run(empty, DM, 'set-bulk', payload).error?.code).toBe('invalid-command')
    }
  })
})

describe('set-conceal (D3)', () => {
  it('toggles the scene flag and rejects anything but a boolean', () => {
    const { next } = run(empty, DM, 'set-conceal', { concealBehindDoors: false })
    expect(next.byScene[SCENE].concealBehindDoors).toBe(false)
    expect(run(empty, DM, 'set-conceal', { concealBehindDoors: 'off' }).error?.code).toBe(
      'invalid-command',
    )
  })
})

describe('redact (D4)', () => {
  const state: FogState = {
    byScene: {
      [SCENE]: {
        rooms: {
          hall: { status: 'revealed', wasEverRevealed: true },
          crypt: { status: 're_hidden', wasEverRevealed: true },
          treasury: { status: 'never_revealed', wasEverRevealed: false },
        },
        concealBehindDoors: true,
      },
      'map-2': {
        rooms: { treasury: { status: 'never_revealed', wasEverRevealed: false } },
        concealBehindDoors: true,
      },
    },
  }
  const redact = fog.redact!

  it('leaves the DM view untouched, object identity included', () => {
    expect(redact(state, DM)).toBe(state)
  })

  it('gives a player their explored rooms and nothing else', () => {
    const seen = redact(state, P1)
    expect(seen.byScene[SCENE].rooms).toEqual({
      hall: { status: 'revealed', wasEverRevealed: true },
      crypt: { status: 're_hidden', wasEverRevealed: true },
    })
    expect(seen.byScene[SCENE].concealBehindDoors).toBe(true)
    expect(Object.keys(seen.byScene['map-2'].rooms)).toEqual([])
  })

  it('leaks neither the id nor the count of an unrevealed room, in any scene', () => {
    expect(JSON.stringify(redact(state, P1))).not.toContain('treasury')
  })

  it('is idempotent and does not mutate the source', () => {
    const once = redact(state, P1)
    expect(redact(once, P1)).toEqual(once)
    expect(Object.keys(state.byScene[SCENE].rooms)).toEqual(['hall', 'crypt', 'treasury'])
  })
})

describe('visibleRooms (D3)', () => {
  const door = (over: Partial<AuthoredDoor> = {}): AuthoredDoor => ({
    id: 'd1',
    state: 'open',
    isSecret: false,
    roomA: 'hall',
    roomB: 'crypt',
    ...over,
  })
  const allRevealed: SceneFog = {
    rooms: {
      hall: { status: 'revealed', wasEverRevealed: true },
      crypt: { status: 'revealed', wasEverRevealed: true },
      treasury: { status: 'revealed', wasEverRevealed: true },
    },
    concealBehindDoors: true,
  }
  const live = (over: Partial<DoorLiveState> = {}): Record<string, DoorLiveState> => ({
    d1: { open: true, locked: false, revealed: true, ...over },
  })
  const see = (
    scene: SceneFog,
    doors: Record<string, DoorLiveState>,
    graph: readonly AuthoredDoor[] = [door()],
    at: readonly string[] = ['hall'],
  ) => [...visibleRooms(scene, doors, graph, at)].sort()

  it('an open door connects the rooms it joins', () => {
    expect(see(allRevealed, live())).toEqual(['crypt', 'hall'])
  })

  it('a closed door blocks', () => {
    expect(see(allRevealed, live({ open: false }))).toEqual(['hall'])
  })

  it('a locked-but-open door still lets sight through', () => {
    expect(see(allRevealed, live({ locked: true }))).toEqual(['crypt', 'hall'])
  })

  it('an unrevealed secret door blocks even when the map authored it open', () => {
    const secret = [door({ isSecret: true, state: 'open' })]
    expect(see(allRevealed, {}, secret)).toEqual(['hall'])
    expect(see(allRevealed, live({ revealed: false }), secret)).toEqual(['hall'])
  })

  it('a revealed secret door connects like any other', () => {
    expect(see(allRevealed, live(), [door({ isSecret: true })])).toEqual(['crypt', 'hall'])
  })

  it('falls back to the authored state when the live overlay has no entry yet', () => {
    expect(see(allRevealed, {}, [door({ state: 'closed' })])).toEqual(['hall'])
    expect(see(allRevealed, {}, [door({ state: 'locked' })])).toEqual(['hall'])
    expect(see(allRevealed, {}, [door({ state: 'open' })])).toEqual(['crypt', 'hall'])
  })

  it('walks the graph, so an open chain reaches further than one room', () => {
    const graph = [door(), door({ id: 'd2', roomA: 'crypt', roomB: 'treasury' })]
    expect(see(allRevealed, { ...live(), d2: { open: true, locked: false, revealed: true } }, graph)).toEqual([
      'crypt',
      'hall',
      'treasury',
    ])
    // …and one closed door in the chain stops it dead
    expect(see(allRevealed, { ...live(), d2: { open: false, locked: false, revealed: true } }, graph)).toEqual([
      'crypt',
      'hall',
    ])
  })

  it('never shows an unrevealed or re-hidden room, however reachable', () => {
    const scene: SceneFog = {
      rooms: {
        hall: { status: 'revealed', wasEverRevealed: true },
        crypt: { status: 're_hidden', wasEverRevealed: true },
      },
      concealBehindDoors: true,
    }
    expect(see(scene, live())).toEqual(['hall'])
  })

  it('shows the whole revealed set when concealment is off', () => {
    const off = { ...allRevealed, concealBehindDoors: false }
    expect(see(off, live({ open: false }))).toEqual(['crypt', 'hall', 'treasury'])
  })

  it('shows nothing when the party has no token on the map', () => {
    expect(see(allRevealed, live(), [door()], [])).toEqual([])
  })

  it('does not see out of a room the party stands in but has not revealed', () => {
    const scene: SceneFog = {
      rooms: { crypt: { status: 'revealed', wasEverRevealed: true } },
      concealBehindDoors: true,
    }
    expect(see(scene, live())).toEqual(['crypt'])
  })

  it('ignores a door onto the exterior or one that was never bound', () => {
    expect(see(allRevealed, live(), [door({ roomB: null })])).toEqual(['hall'])
    expect(see(allRevealed, live(), [door({ roomA: undefined, roomB: undefined })])).toEqual(['hall'])
  })
})
