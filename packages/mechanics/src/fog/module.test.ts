import { describe, expect, it } from 'vitest'

import type { PlayerInfo } from '@dnd/core/src/shared/protocol'
import type { Viewer } from '../contract'
import type { AuthoredDoor, DoorLiveState } from '../doors/types'
import { fogModule } from './module'
import { getCell, regionOf, setCells } from './region'
import { autoExploreOn, fogModeOf, sceneFogOf } from './types'
import type { FogState, RoomFogStatus, SceneFog } from './types'
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

  // The fallback branch rebuilds the scene object, and everything it does not carry over is
  // silently lost — a vision-mode scene coming back out of here in rooms mode would strip
  // token vision from the two places that read this (the server's cache, the fog renderer).
  it('carries the vision-mode settings through the fallback rebuild', () => {
    const region = setCells(regionOf({ minX: 0, minY: 0, maxX: 10, maxY: 10 })!, [[3, 4]])
    const vision: SceneFog = {
      ...nothing,
      mode: 'vision',
      visionShare: 'individual',
      autoExplore: false,
      region,
    }
    const scene = effectiveFog(vision, [HALL, VAULT], [])
    expect(idsOf(scene)).toEqual(['vault'])
    expect(scene).toMatchObject({
      mode: 'vision',
      visionShare: 'individual',
      autoExplore: false,
      region,
    })
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
    expect(blockedEdge({}, [d({ state: 'locked' })], ['hall'], 'vault')).toEqual({
      kind: 'locked-door',
      doorId: 'd1',
    })
  })

  it('names a merely closed door as closed', () => {
    expect(blockedEdge({}, [d()], ['hall'], 'vault')).toEqual({
      kind: 'closed-door',
      doorId: 'd1',
    })
  })

  it('prefers locked over closed when two doors join the same room', () => {
    const graph = [d(), d({ id: 'd2', state: 'locked' })]
    expect(blockedEdge({}, graph, ['hall'], 'vault')).toEqual({
      kind: 'locked-door',
      doorId: 'd2',
    })
  })

  // The refusal names a door out loud, so two shut doors onto the same room must not have
  // it alternate between them — the first is the answer every time.
  it('names the same shut door every time two of them join the room', () => {
    const graph = [d(), d({ id: 'd2' })]
    expect(blockedEdge({}, graph, ['hall'], 'vault')).toEqual({
      kind: 'closed-door',
      doorId: 'd1',
    })
  })

  it('reads the live overlay over the authored state', () => {
    const live: Record<string, DoorLiveState> = {
      d1: { open: false, locked: true, revealed: true },
    }
    expect(blockedEdge(live, [d()], ['hall'], 'vault')).toEqual({
      kind: 'locked-door',
      doorId: 'd1',
    })
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
    expect(blockedEdge(live, [d({ isSecret: true })], ['hall'], 'vault')).toEqual({
      kind: 'locked-door',
      doorId: 'd1',
    })
  })

  it('explains nothing for a room no door joins to the party', () => {
    expect(blockedEdge({}, [d()], ['hall'], 'elsewhere')).toBeNull()
  })

  it('ignores a door with an unbound side', () => {
    expect(blockedEdge({}, [d({ roomB: null })], ['hall'], 'vault')).toBeNull()
  })

  /**
   * The same shut door, asked about from further off. A player two rooms away used to get
   * the generic refusal for the door that named itself the moment they stepped up to it.
   */
  describe('a room further off than the door that shuts it', () => {
    // hall —(open d1)— gallery —(shut d2)— vault —(open d3)— annexe
    const chain = (over: Partial<AuthoredDoor> = {}): AuthoredDoor[] => [
      d({ id: 'd1', state: 'open', roomA: 'hall', roomB: 'gallery' }),
      d({ id: 'd2', roomA: 'gallery', roomB: 'vault', ...over }),
      d({ id: 'd3', state: 'open', roomA: 'vault', roomB: 'annexe' }),
    ]

    it('names the shut door on the way, not the room it stopped short of', () => {
      expect(blockedEdge({}, chain(), ['hall'], 'vault')).toEqual({
        kind: 'closed-door',
        doorId: 'd2',
      })
    })

    it('still names it for a room another open door beyond that', () => {
      expect(blockedEdge({}, chain(), ['hall'], 'annexe')).toEqual({
        kind: 'closed-door',
        doorId: 'd2',
      })
    })

    it('keeps locked and closed apart at a distance', () => {
      expect(blockedEdge({}, chain({ state: 'locked' }), ['hall'], 'annexe')).toEqual({
        kind: 'locked-door',
        doorId: 'd2',
      })
    })

    it('names the first door shut against them, not the last', () => {
      // gallery —(shut d2)— vault —(shut d4)— annexe: the one they would meet first.
      const graph = [...chain(), d({ id: 'd4', roomA: 'vault', roomB: 'annexe' })]
      expect(blockedEdge({}, graph.filter((door) => door.id !== 'd3'), ['hall'], 'annexe')).toEqual({
        kind: 'closed-door',
        doorId: 'd2',
      })
    })

    it('says nothing when the way round is open after all', () => {
      // The long way is open, so nothing is shutting `vault` off and no door is to blame.
      const graph = [...chain(), d({ id: 'd5', state: 'open', roomA: 'hall', roomB: 'vault' })]
      expect(blockedEdge({}, graph, ['hall'], 'vault')).toBeNull()
    })

    it('never routes the path through a secret door they have not found', () => {
      const graph = [
        d({ id: 'd1', state: 'open', roomA: 'hall', roomB: 'gallery' }),
        d({ id: 'd2', isSecret: true, roomA: 'gallery', roomB: 'vault' }),
      ]
      expect(blockedEdge({}, graph, ['hall'], 'vault')).toBeNull()
    })
  })
})

describe('the table log (§2.4.3)', () => {
  const ROSTER: PlayerInfo[] = [{ identityId: 'dm-1', name: 'Ilsa', role: 'dm', connected: true }]

  /** `run`, but with a roster — the actor is stamped from it and never from the payload. */
  function fire(state: FogState, action: string, payload: unknown): FogState {
    let next = state
    fog.handler(action, payload, {
      campaignId: 'c-1',
      sessionId: 's-1',
      activeSceneId: SCENE,
      sender: DM,
      players: ROSTER,
      state,
      setState: (s) => {
        next = s
      },
      broadcast: () => {},
    })
    return next
  }

  const line = (state: FogState) => state.log?.[state.log.length - 1]
  const all = (status: RoomFogStatus) =>
    Object.fromEntries(ROOMS.map((id) => [id, { status, wasEverRevealed: status !== 'never_revealed' }]))

  it('records a room reveal and re-hide against the room id', () => {
    const shown = fire(empty, 'reveal', { roomId: 'crypt' })
    expect(line(shown)).toMatchObject({
      actor: 'Ilsa',
      action: 'revealed-room',
      sceneId: SCENE,
      targetId: 'crypt',
    })
    expect(line(fire(shown, 'hide', { roomId: 'crypt' }))).toMatchObject({
      action: 'hid-room',
      targetId: 'crypt',
    })
  })

  // D9's two buttons and the undo behind them arrive as the same command; only the result
  // tells them apart.
  it('tells Reveal All, Hide All and a partial restore apart', () => {
    expect(line(fire(empty, 'set-bulk', { rooms: all('revealed') }))?.action).toBe('revealed-all')
    expect(line(fire(empty, 'set-bulk', { rooms: all('never_revealed') }))?.action).toBe('hid-all')
    const mixed = { hall: { status: 'revealed', wasEverRevealed: true } }
    expect(line(fire(empty, 'set-bulk', { rooms: mixed }))?.action).toBe('changed-fog')
    expect(line(fire(empty, 'reset', {}))?.action).toBe('reset-fog')
  })

  it('says nothing about a setting the table cannot see', () => {
    expect(fire(empty, 'set-conceal', { concealBehindDoors: false }).log ?? []).toEqual([])
  })

  describe('per-seat cut', () => {
    const redact = fog.redact!

    it('keeps a room line only for a seat that has seen the room', () => {
      const state = fire(fire(empty, 'reveal', { roomId: 'crypt' }), 'hide', { roomId: 'crypt' })
      expect(redact(state, P1).log?.map((e) => e.action)).toEqual(['revealed-room', 'hid-room'])
      // A wing nobody walked into: the line, the room id and the count all stay behind.
      const secret = fire(empty, 'reveal', { roomId: 'treasury' })
      const reset = fire(secret, 'reset', {})
      expect(redact(reset, P1).log?.filter((e) => e.targetId)).toEqual([])
      expect(JSON.stringify(redact(reset, P1).log)).not.toContain('treasury')
    })

    it('keeps the whole-map lines, which every seat watched happen', () => {
      const state = fire(empty, 'set-bulk', { rooms: all('never_revealed') })
      expect(redact(state, P1).log?.map((e) => e.action)).toEqual(['hid-all'])
    })

    it('stays idempotent', () => {
      const state = fire(empty, 'reveal', { roomId: 'hall' })
      const once = redact(state, P1)
      expect(redact(once, P1)).toEqual(once)
    })
  })
})

// ── S3 P1: token-vision fields, commands and region memory ──────────────────
// Everything here is additive and optional: a scene stored before any of it existed has to
// load, and behave, exactly as it did — that is what the whole phase is gated on.

describe('vision-mode settings and region memory (S3 P1)', () => {
  /** A 10×10 scene starting at the origin: cell (col, row) centres on (col + .5, row + .5). */
  const FRAME = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
  /** Two rooms side by side across that frame, with unzoned map east of x = 8 (D6). */
  const ROOM_AT = (x: number): string | null => (x < 5 ? 'hall' : x < 8 ? 'crypt' : null)
  const framed = fogModule(
    () => ROOMS,
    (_campaignId, sceneId) => (sceneId === SCENE ? FRAME : null),
    (_campaignId, _sceneId, x) => ROOM_AT(x),
  )

  /** Same dispatch mirror as `run`, against the module the server wires a frame into. */
  function fire(
    state: FogState,
    sender: Viewer,
    action: string,
    payload: unknown,
    activeSceneId: string | null = SCENE,
  ) {
    const roles = framed.commands[action]
    if (roles && !roles.includes(sender.role)) {
      return { error: { code: 'unauthorized', message: '' }, next: state }
    }
    let next = state
    const error = framed.handler(action, payload, {
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

  const scened = (state: FogState) => state.byScene[SCENE]

  describe('defaults and old state', () => {
    it('reads an untouched scene as rooms mode with auto-explore on and no region', () => {
      const scene = sceneFogOf(empty, SCENE)
      expect(scene).toEqual({ rooms: {}, concealBehindDoors: true })
      expect(fogModeOf(scene)).toBe('rooms')
      expect(autoExploreOn(scene)).toBe(true)
      expect(scene.region).toBeUndefined()
    })

    it('loads a state written before any of these fields existed, unchanged', () => {
      const old = stateWith({ hall: { status: 'revealed', wasEverRevealed: true } })
      const scene = sceneFogOf(old, SCENE)
      expect(fogModeOf(scene)).toBe('rooms')
      expect(autoExploreOn(scene)).toBe(true)
      // …and a command that touches nothing else leaves the old shape intact.
      const { next } = fire(old, DM, 'set-conceal', { concealBehindDoors: false })
      expect(scened(next).rooms).toEqual(old.byScene[SCENE].rooms)
      expect(scened(next).mode).toBeUndefined()
    })
  })

  describe('authorization', () => {
    const dmOnly = [
      ['set-mode', { mode: 'vision' }],
      ['set-share', { visionShare: 'individual' }],
      ['set-auto-explore', { autoExplore: false }],
      ['region-set', { op: 'reveal', cells: [[0, 0]] }],
    ] as const

    it.each(dmOnly)('%s is dm-only', (action, payload) => {
      expect(framed.commands[action]).toEqual(['dm'])
      expect(fire(empty, P1, action, payload).error).toMatchObject({ code: 'unauthorized' })
      expect(fire(empty, DM, action, payload).error?.code).not.toBe('unauthorized')
    })

    it('leaves auto-explore off the command table, so no socket can reach it', () => {
      // The server's own write (`dispatchInternal`), exactly like `triggers.event`.
      expect(framed.commands['auto-explore']).toBeUndefined()
    })
  })

  describe('set-mode / set-share / set-auto-explore', () => {
    it('flips the mode and refuses anything that is not one', () => {
      expect(scened(fire(empty, DM, 'set-mode', { mode: 'vision' }).next).mode).toBe('vision')
      expect(fire(empty, DM, 'set-mode', { mode: 'sight' }).error?.code).toBe('invalid-command')
      expect(fire(empty, DM, 'set-mode', {}).error?.code).toBe('invalid-command')
    })

    it('destroys neither record on a flip, in either direction', () => {
      const played: FogState = {
        byScene: {
          [SCENE]: {
            rooms: { hall: { status: 'revealed', wasEverRevealed: true } },
            concealBehindDoors: true,
            region: setCells(regionOf(FRAME)!, [[3, 4]]),
          },
        },
      }
      const toVision = fire(played, DM, 'set-mode', { mode: 'vision' }).next
      const andBack = fire(toVision, DM, 'set-mode', { mode: 'rooms' }).next
      for (const state of [toVision, andBack]) {
        expect(scened(state).rooms).toEqual(played.byScene[SCENE].rooms)
        expect(getCell(scened(state).region, 3, 4)).toBe(true)
      }
      expect(scened(andBack).mode).toBe('rooms')
    })

    // A roomless map has nothing for `canSee` to be wired against server-side, so vision mode
    // there redacts *nothing*: every token on the scene would ship to every player the moment
    // the DM flipped the switch. Refusing is the whole fix.
    it('refuses vision mode on a scene whose map has no detected rooms', () => {
      const roomless = fogModule(() => [], () => FRAME)
      const attempt = (action: string, payload: unknown) => {
        let next = empty
        const error = roomless.handler(action, payload, {
          campaignId: 'c-1',
          sessionId: 's-1',
          activeSceneId: SCENE,
          sender: DM,
          players: [],
          state: empty,
          setState: (s) => {
            next = s
          },
          broadcast: () => {},
        })
        return { error: error ?? null, next }
      }

      const refused = attempt('set-mode', { mode: 'vision' })
      expect(refused.error?.code).toBe('invalid-command')
      expect(refused.error?.message).toMatch(/rooms/)
      expect(refused.next).toBe(empty)
      // Rooms mode is still reachable there — this refuses one mode, not the command.
      expect(attempt('set-mode', { mode: 'rooms' }).error).toBeNull()
    })

    it('stores either share, and refuses a third', () => {
      expect(
        scened(fire(empty, DM, 'set-share', { visionShare: 'individual' }).next).visionShare,
      ).toBe('individual')
      expect(scened(fire(empty, DM, 'set-share', { visionShare: 'party' }).next).visionShare).toBe(
        'party',
      )
      expect(fire(empty, DM, 'set-share', { visionShare: 'mine' }).error?.code).toBe('invalid-command')
    })

    it('turns auto-explore off explicitly, never by toggle', () => {
      expect(scened(fire(empty, DM, 'set-auto-explore', { autoExplore: false }).next).autoExplore).toBe(
        false,
      )
      expect(fire(empty, DM, 'set-auto-explore', { autoExplore: 'no' }).error?.code).toBe(
        'invalid-command',
      )
    })
  })

  describe('region-set', () => {
    it('lazily creates the region and reveals the cells it names', () => {
      const { next, error } = fire(empty, DM, 'region-set', {
        op: 'reveal',
        cells: [
          [1, 2],
          [9, 9],
        ],
      })
      expect(error).toBeNull()
      const region = scened(next).region!
      expect(region).toMatchObject({ minX: 0, minY: 0, cols: 10, rows: 10 })
      expect(getCell(region, 1, 2)).toBe(true)
      expect(getCell(region, 9, 9)).toBe(true)
      expect(getCell(region, 1, 3)).toBe(false)
    })

    it('hides cells back out again, leaving the rest', () => {
      const painted = fire(empty, DM, 'region-set', {
        op: 'reveal',
        cells: [
          [1, 2],
          [1, 3],
        ],
      }).next
      const rubbed = fire(painted, DM, 'region-set', { op: 'hide', cells: [[1, 2]] }).next
      expect(getCell(scened(rubbed).region, 1, 2)).toBe(false)
      expect(getCell(scened(rubbed).region, 1, 3)).toBe(true)
    })

    it('refuses cells off the map, half cells, and payloads that are not cells', () => {
      const refused = (cells: unknown) =>
        fire(empty, DM, 'region-set', { op: 'reveal', cells }).error?.code
      expect(refused([[10, 0]])).toBe('invalid-command')
      expect(refused([[0, 10]])).toBe('invalid-command')
      expect(refused([[-1, 0]])).toBe('invalid-command')
      expect(refused([[0.5, 0]])).toBe('invalid-command')
      expect(refused([[0]])).toBe('invalid-command')
      expect(refused(['0,0'])).toBe('invalid-command')
      expect(refused('everything')).toBe('invalid-command')
      expect(fire(empty, DM, 'region-set', { op: 'paint', cells: [] }).error?.code).toBe(
        'invalid-command',
      )
    })

    it('refuses a scene the server can measure no frame for', () => {
      expect(
        fire(empty, DM, 'region-set', { sceneId: 'map-2', op: 'reveal', cells: [] }).error?.code,
      ).toBe('invalid-command')
    })

    it('refuses a scene too large to keep region memory for', () => {
      const huge = fogModule(
        () => ROOMS,
        () => ({ minX: 0, minY: 0, maxX: 2000, maxY: 2000 }),
      )
      const error = huge.handler(
        'region-set',
        { sceneId: SCENE, op: 'reveal', cells: [[0, 0]] },
        {
          campaignId: 'c-1',
          sessionId: 's-1',
          activeSceneId: SCENE,
          sender: DM,
          players: [],
          state: empty,
          setState: () => {
            throw new Error('a scene past the cell ceiling must write no region')
          },
          broadcast: () => {},
        },
      )
      expect(error?.code).toBe('invalid-command')
    })

    // A brush stroke reveals ground the same way the room buttons do, so it reads back the
    // same way — the one reveal-shaped fog act that used to happen in silence.
    it('writes a table-log line, the way every other reveal does', () => {
      const seated = (state: FogState, payload: unknown) => {
        let next = state
        framed.handler('region-set', payload, {
          campaignId: 'c-1',
          sessionId: 's-1',
          activeSceneId: SCENE,
          sender: DM,
          players: [{ identityId: 'dm-1', name: 'Ilsa', role: 'dm', connected: true }],
          state,
          setState: (s) => {
            next = s
          },
          broadcast: () => {},
        })
        return next
      }

      const painted = seated(empty, { op: 'reveal', cells: [[1, 2]] })
      const line = painted.log?.[painted.log.length - 1]
      expect(line).toMatchObject({ actor: 'Ilsa', action: 'changed-fog', sceneId: SCENE })
      // Cells, not a room: no targetId, which is what keeps it readable at every seat.
      expect(line?.targetId).toBeUndefined()
      expect(seated(painted, { op: 'hide', cells: [[1, 2]] }).log).toHaveLength(2)
    })

    // ── the latch a brush stroke has to pull (P2 §5) ──────────────────────────
    // Cells are presentation and rooms are what *ships*. A stroke inside a room nobody has
    // revealed used to write bits a player could never see, because their copy of the map
    // carries no geometry for that room at all.

    it('ships the rooms a reveal stroke lands in, without lighting them', () => {
      const { next } = fire(empty, DM, 'region-set', {
        op: 'reveal',
        cells: [
          [1, 2],
          [6, 2],
        ],
      })
      // Latched, so the geometry travels — and `re_hidden`, so the room is a memory the
      // painted cells show through rather than a room washed whole.
      expect(scened(next).rooms).toEqual({
        hall: { status: 're_hidden', wasEverRevealed: true },
        crypt: { status: 're_hidden', wasEverRevealed: true },
      })
    })

    it('leaves a room the party already earned exactly as it stands', () => {
      const lit = stateWith({ hall: { status: 'revealed', wasEverRevealed: true } })
      const { next } = fire(lit, DM, 'region-set', { op: 'reveal', cells: [[1, 2]] })
      expect(scened(next).rooms.hall).toEqual({ status: 'revealed', wasEverRevealed: true })
    })

    it('ships nothing for a stroke on unzoned map, and nothing at all for a hide', () => {
      // No room under the cell (D6): there is no geometry to latch, only the bits.
      const unzoned = fire(empty, DM, 'region-set', { op: 'reveal', cells: [[9, 9]] }).next
      expect(scened(unzoned).rooms).toEqual({})
      expect(getCell(scened(unzoned).region, 9, 9)).toBe(true)

      // A hide never un-ships and never ships: geometry a player holds stays theirs (D4).
      const rubbed = fire(unzoned, DM, 'region-set', { op: 'hide', cells: [[1, 2]] }).next
      expect(scened(rubbed).rooms).toEqual({})
    })
  })

  describe('auto-explore (server-internal)', () => {
    it('ORs cells in and reveals the rooms it names, in one write', () => {
      const { next, error } = fire(empty, DM, 'auto-explore', {
        sceneId: SCENE,
        cells: [
          [2, 2],
          [3, 2],
        ],
        rooms: ['hall'],
      })
      expect(error).toBeNull()
      expect(getCell(scened(next).region, 2, 2)).toBe(true)
      expect(scened(next).rooms.hall).toEqual({ status: 'revealed', wasEverRevealed: true })
      // Not a DM act: the map opening as the party walks writes no log line.
      expect(next.log ?? []).toEqual([])
    })

    it('adds to what is already there rather than replacing it', () => {
      const first = fire(empty, DM, 'auto-explore', {
        sceneId: SCENE,
        cells: [[2, 2]],
        rooms: ['hall'],
      }).next
      const second = fire(first, DM, 'auto-explore', {
        sceneId: SCENE,
        cells: [[4, 4]],
        rooms: ['crypt'],
      }).next
      expect(getCell(scened(second).region, 2, 2)).toBe(true)
      expect(getCell(scened(second).region, 4, 4)).toBe(true)
      expect(Object.keys(scened(second).rooms).sort()).toEqual(['crypt', 'hall'])
    })

    it('refuses a room the map does not have', () => {
      expect(
        fire(empty, DM, 'auto-explore', { sceneId: SCENE, cells: [], rooms: ['nowhere'] }).error?.code,
      ).toBe('invalid-command')
    })
  })

  describe('redact carries the new fields', () => {
    const state: FogState = {
      byScene: {
        [SCENE]: {
          rooms: {
            hall: { status: 'revealed', wasEverRevealed: true },
            treasury: { status: 'never_revealed', wasEverRevealed: false },
          },
          concealBehindDoors: true,
          mode: 'vision',
          visionShare: 'party',
          autoExplore: false,
          region: setCells(regionOf(FRAME)!, [[3, 4]]),
        },
      },
    }

    it('hands a player the settings and the region whole', () => {
      const seen = framed.redact!(state, P1).byScene[SCENE]
      expect(seen.mode).toBe('vision')
      expect(seen.visionShare).toBe('party')
      expect(seen.autoExplore).toBe(false)
      expect(getCell(seen.region, 3, 4)).toBe(true)
    })

    it('still drops the rooms nobody has seen', () => {
      const seen = framed.redact!(state, P1)
      expect(Object.keys(seen.byScene[SCENE].rooms)).toEqual(['hall'])
      expect(JSON.stringify(seen)).not.toContain('treasury')
    })
  })
})
