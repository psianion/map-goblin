import { describe, expect, it } from 'vitest'

import type { Viewer } from '../contract'
import type { AuthoredDoor, DoorLiveState } from '../doors/types'
import { fogModule } from './module'
import type { FogState, SceneFog } from './types'
import { blockedEdge, defaultRoom, effectiveFog, visibleRooms, type FogRoom } from './visibility'

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

// ── the default room (amendment 2026-07-28) ─────────────────────────────────
// The two read-time corrections that stand between `visibleRooms` and a black screen. Pure
// and shared: the server's vision cache and the player's fog renderer both run their fog
// through this, and a player-facing scene is never left with nothing in it.

describe('defaultRoom / effectiveFog (amendment 2026-07-28)', () => {
  const area = (id: string, size: number, isPathway = false): FogRoom => ({ id, area: size, isPathway })
  const HALL = area('hall', 100)
  const CRYPT = area('crypt', 100)
  const VAULT = area('vault', 180)
  const CORRIDOR = area('corridor-1', 400, true)
  const nothing: SceneFog = { rooms: {}, concealBehindDoors: true }
  const idsOf = (scene: SceneFog) =>
    Object.entries(scene.rooms)
      .filter(([, room]) => room.status === 'revealed')
      .map(([id]) => id)
      .sort()

  it('picks the largest room that is not a corridor, however big the corridor', () => {
    expect(defaultRoom([HALL, CORRIDOR, VAULT])?.id).toBe('vault')
  })

  it('breaks a tie on the lowest id, so two machines pick the same room', () => {
    expect(defaultRoom([HALL, CRYPT])?.id).toBe('crypt')
    expect(defaultRoom([CRYPT, HALL])?.id).toBe('crypt')
  })

  it('falls back to the largest room of any kind when the map is all corridor', () => {
    expect(defaultRoom([CORRIDOR, area('corridor-2', 10, true)])?.id).toBe('corridor-1')
  })

  it('has nothing to pick on a map nobody zoned', () => {
    expect(defaultRoom([])).toBeNull()
    expect(effectiveFog(nothing, [], ['nowhere'])).toEqual(nothing)
  })

  it('reveals the default room while the DM has revealed nothing', () => {
    const scene = effectiveFog(nothing, [HALL, CORRIDOR, VAULT], [])
    expect(idsOf(scene)).toEqual(['vault'])
    // Concealment off with it: routing the fallback through the reachability BFS would put
    // a party standing somewhere else straight back into the dark.
    expect(scene.concealBehindDoors).toBe(false)
  })

  it('reveals it again after a Hide All leaves everything re-hidden', () => {
    const hidden: SceneFog = {
      rooms: {
        hall: { status: 're_hidden', wasEverRevealed: true },
        vault: { status: 're_hidden', wasEverRevealed: true },
      },
      concealBehindDoors: true,
    }
    expect(idsOf(effectiveFog(hidden, [HALL, VAULT], ['hall']))).toEqual(['vault'])
  })

  it('gives it up the moment one real room is revealed, and writes nothing back', () => {
    const lit: SceneFog = {
      rooms: { hall: { status: 'revealed', wasEverRevealed: true } },
      concealBehindDoors: true,
    }
    const scene = effectiveFog(lit, [HALL, VAULT], ['hall'])
    expect(idsOf(scene)).toEqual(['hall'])
    // The fallback leaves no trace at all — no record, and no latch on the room it lent.
    expect(scene.rooms.vault).toBeUndefined()
    expect(lit.rooms.vault).toBeUndefined()
  })

  it('turns concealment off when no party token is on the map', () => {
    const lit: SceneFog = {
      rooms: {
        hall: { status: 'revealed', wasEverRevealed: true },
        vault: { status: 'revealed', wasEverRevealed: true },
      },
      concealBehindDoors: true,
    }
    expect(effectiveFog(lit, [HALL, VAULT], []).concealBehindDoors).toBe(false)
    expect(effectiveFog(lit, [HALL, VAULT], ['hall']).concealBehindDoors).toBe(true)
  })

  it('leaves a fresh scene exactly one visible room, however shut the doors are', () => {
    const scene = effectiveFog(nothing, [HALL, VAULT], [])
    const shut = [{ id: 'd1', state: 'closed', isSecret: false, roomA: 'hall', roomB: 'vault' } as AuthoredDoor]
    expect([...visibleRooms(scene, {}, shut, [])]).toEqual(['vault'])
  })
})

/**
 * The edge fact the reachability BFS discards. `visibleRooms` answers "can the party get
 * there"; this answers "what stopped them", which is what a move refusal needs to say
 * something more useful than "you can't go there".
 */
describe('blockedEdge', () => {
  const d = (over: Partial<AuthoredDoor> = {}): AuthoredDoor => ({
    id: 'd1',
    state: 'closed',
    isSecret: false,
    roomA: 'hall',
    roomB: 'vault',
    ...over,
  })

  it('names a locked door between the party and the room', () => {
    expect(blockedEdge({}, [d({ state: 'locked' })], ['hall'], 'vault')).toBe('locked-door')
  })

  it('names a merely closed door as closed', () => {
    expect(blockedEdge({}, [d()], ['hall'], 'vault')).toBe('closed-door')
  })

  it('prefers locked over closed when two doors join the same room', () => {
    const graph = [d(), d({ id: 'd2', state: 'locked' })]
    expect(blockedEdge({}, graph, ['hall'], 'vault')).toBe('locked-door')
  })

  it('reads the live overlay over the authored state', () => {
    const live: Record<string, DoorLiveState> = {
      d1: { open: false, locked: true, revealed: true },
    }
    expect(blockedEdge(live, [d()], ['hall'], 'vault')).toBe('locked-door')
  })

  it('explains nothing when the door is open — that room is reachable', () => {
    expect(blockedEdge({}, [d({ state: 'open' })], ['hall'], 'vault')).toBeNull()
  })

  it('never names a secret door the party has not found', () => {
    // A player probing a blank wall must not learn a door is there from the refusal.
    expect(blockedEdge({}, [d({ isSecret: true, state: 'locked' })], ['hall'], 'vault')).toBeNull()
  })

  it('names a secret door once it has been revealed', () => {
    const live: Record<string, DoorLiveState> = {
      d1: { open: false, locked: true, revealed: true },
    }
    expect(blockedEdge(live, [d({ isSecret: true })], ['hall'], 'vault')).toBe('locked-door')
  })

  it('explains nothing for a room no door joins to the party', () => {
    expect(blockedEdge({}, [d()], ['hall'], 'elsewhere')).toBeNull()
  })

  it('ignores a door with an unbound side', () => {
    expect(blockedEdge({}, [d({ roomB: null })], ['hall'], 'vault')).toBeNull()
  })
})
