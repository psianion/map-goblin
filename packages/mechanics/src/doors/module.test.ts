import { describe, expect, it } from 'vitest'

import type { DoorChild } from '@dnd/core/src/shared/types'
import type { Viewer } from '../contract'
import { doorsModule } from './module'
import { DOOR_LOCKED, UNKNOWN_DOOR, type AuthoredDoor, type DoorsState } from './types'

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const P1: Viewer = { role: 'player', identityId: 'p-1' }
const SCENE = 'map-1'

// §4 risk 1: a map's door child *is* the authored input, read as-is. Typing the fixture as
// the editor's DoorChild and feeding it in as an AuthoredDoor stops compiling if the map
// schema drifts.
const MAP_DOOR: DoorChild = {
  id: 'oak',
  name: 'Oak Door',
  childType: 'door',
  visible: true,
  wallId: 'w-1',
  position: [4, 7],
  angle: 0,
  width: 1,
  style: 'single',
  state: 'closed',
  isSecret: false,
  roomA: 'hall',
  roomB: 'crypt',
}

const AUTHORED: AuthoredDoor[] = [
  MAP_DOOR,
  { id: 'iron', state: 'locked', isSecret: false, roomA: 'hall', roomB: 'vault' },
  { id: 'bookcase', state: 'open', isSecret: true, roomA: 'crypt', roomB: 'vault' },
  // Authored shut on purpose — an archway has no leaf, so the map's state means nothing.
  { id: 'arch', state: 'closed', isSecret: false, style: 'archway', roomA: 'hall', roomB: 'crypt' },
]

const doors = doorsModule(() => AUTHORED)
const empty: DoorsState = { byScene: {} }

/** Mirrors ModuleRegistry.dispatch: `commands` gates the role before the handler runs. */
function run(
  state: DoorsState,
  sender: Viewer,
  action: string,
  payload: unknown,
  activeSceneId: string | null = SCENE,
) {
  const roles = doors.commands[action]
  if (!roles) return { error: { code: 'invalid-command', message: '' }, next: state }
  if (!roles.includes(sender.role)) return { error: { code: 'unauthorized', message: '' }, next: state }
  let next = state
  const error = doors.handler(action, payload, {
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

const scene = (state: DoorsState) => state.byScene[SCENE]

describe('authz matrix', () => {
  const dmOnly = [
    ['lock', { id: 'oak' }],
    ['unlock', { id: 'oak' }],
    ['reveal-secret', { id: 'bookcase' }],
  ] as const

  it.each(dmOnly)('%s is dm-only', (action, payload) => {
    expect(run(empty, P1, action, payload).error).toMatchObject({ code: 'unauthorized' })
    expect(run(empty, DM, action, payload).error?.code).not.toBe('unauthorized')
  })

  it('toggle is open to both roles at the table', () => {
    expect(doors.commands.toggle).toEqual(['dm', 'player'])
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
    expect(doors.handler('nope', { id: 'oak' }, ctx)).toMatchObject({ code: 'invalid-command' })
    expect(doors.handler('toggle', 'not-an-object', ctx)).toMatchObject({ code: 'invalid-command' })
  })
})

describe('lazy seeding (D2)', () => {
  it('seeds the whole scene from the map on the first command that touches it', () => {
    const { next } = run(empty, P1, 'toggle', { id: 'oak' })
    expect(scene(next)).toEqual({
      oak: { open: true, locked: false, revealed: true },
      iron: { open: false, locked: true, revealed: true },
      bookcase: { open: true, locked: false, revealed: false },
      // the map says `closed`; an archway is a hole in a wall and seeds open regardless
      arch: { open: true, locked: false, revealed: true },
    })
  })

  it('keeps live state and adds doors the map has grown since', () => {
    const played: DoorsState = { byScene: { [SCENE]: { oak: { open: true, locked: false, revealed: true } } } }
    const { next } = run(played, DM, 'lock', { id: 'iron' })
    expect(scene(next).oak.open).toBe(true)
    expect(scene(next).bookcase).toEqual({ open: true, locked: false, revealed: false })
  })

  it('falls back to the active scene, and refuses when there is neither', () => {
    expect(run(empty, DM, 'lock', { id: 'oak', sceneId: 'map-2' }).next.byScene['map-2']).toBeDefined()
    expect(run(empty, DM, 'lock', { id: 'oak' }, null).error?.code).toBe('invalid-command')
  })
})

describe('toggle', () => {
  it('opens and closes for a player', () => {
    const opened = run(empty, P1, 'toggle', { id: 'oak' }).next
    expect(scene(opened).oak.open).toBe(true)
    expect(scene(run(opened, P1, 'toggle', { id: 'oak' }).next).oak.open).toBe(false)
  })

  it('refuses a locked door and leaves it shut', () => {
    const { error, next } = run(empty, P1, 'toggle', { id: 'iron' })
    expect(error?.code).toBe('invalid-command')
    expect(error?.message).toContain(DOOR_LOCKED)
    expect(next).toBe(empty)
  })

  it('refuses the DM on a locked door too — unlock first', () => {
    expect(run(empty, DM, 'toggle', { id: 'iron' }).error?.message).toContain(DOOR_LOCKED)
  })

  it('answers a player on an unrevealed secret door exactly as it answers a made-up id', () => {
    const secret = run(empty, P1, 'toggle', { id: 'bookcase' })
    const ghost = run(empty, P1, 'toggle', { id: 'no-such-door' })
    expect(secret.error).toEqual(ghost.error)
    expect(secret.error?.message).toContain(UNKNOWN_DOOR)
    // nothing is written either — a probe cannot even be timed off a state change
    expect(secret.next).toBe(empty)
  })

  it('lets the DM work a secret door before anyone knows it is there', () => {
    const { error, next } = run(empty, DM, 'toggle', { id: 'bookcase' })
    expect(error).toBeNull()
    expect(scene(next).bookcase).toEqual({ open: false, locked: false, revealed: false })
  })
})

describe('lock, unlock and reveal-secret', () => {
  it('locks and unlocks without touching whether the door is open', () => {
    const locked = run(empty, DM, 'lock', { id: 'oak' }).next
    expect(scene(locked).oak).toEqual({ open: false, locked: true, revealed: true })
    expect(run(locked, P1, 'toggle', { id: 'oak' }).error?.message).toContain(DOOR_LOCKED)
    const unlocked = run(locked, DM, 'unlock', { id: 'oak' }).next
    expect(scene(unlocked).oak.locked).toBe(false)
    expect(run(unlocked, P1, 'toggle', { id: 'oak' }).error).toBeNull()
  })

  it('reveals a secret door, and only a door the map authored secret', () => {
    expect(run(empty, DM, 'reveal-secret', { id: 'oak' }).error?.code).toBe('invalid-command')
    const revealed = run(empty, DM, 'reveal-secret', { id: 'bookcase' }).next
    expect(scene(revealed).bookcase.revealed).toBe(true)
    // and now the players can work it
    expect(run(revealed, P1, 'toggle', { id: 'bookcase' }).error).toBeNull()
  })

  it('refuses an unknown door on every command', () => {
    for (const action of ['toggle', 'lock', 'unlock', 'reveal-secret']) {
      const { error } = run(empty, DM, action, { id: 'ghost' })
      expect(error?.message).toContain(UNKNOWN_DOOR)
    }
    expect(run(empty, DM, 'lock', {}).error?.code).toBe('invalid-command')
  })
})

describe('archways', () => {
  it('refuses to open or close one, for the DM as well as the table', () => {
    for (const sender of [P1, DM]) {
      const { error, next } = run(empty, sender, 'toggle', { id: 'arch' })
      expect(error?.code).toBe('invalid-command')
      // deliberately none of the prefixes the client toasts — the refusal is silent
      expect(error?.message).not.toContain(DOOR_LOCKED)
      expect(error?.message).not.toContain(UNKNOWN_DOOR)
      expect(next).toBe(empty)
    }
  })

  it('refuses to lock or unlock one — there is no leaf to bar', () => {
    for (const action of ['lock', 'unlock']) {
      const { error, next } = run(empty, DM, action, { id: 'arch' })
      expect(error?.code).toBe('invalid-command')
      expect(next).toBe(empty)
    }
  })

  it('still hides a secret one from a player probing ids', () => {
    const hidden = doorsModule(() => [
      { id: 'veil', state: 'open', isSecret: true, style: 'archway', roomA: 'hall', roomB: 'crypt' },
    ])
    const error = hidden.handler(
      'toggle',
      { id: 'veil' },
      {
        campaignId: 'c-1',
        sessionId: 's-1',
        activeSceneId: SCENE,
        sender: P1,
        players: [],
        state: empty,
        setState: () => {},
        broadcast: () => {},
      },
    )
    // the archway refusal must not fire first and admit the door is there
    expect(error?.message).toContain(UNKNOWN_DOOR)
  })
})

describe('redact (D4)', () => {
  const state: DoorsState = {
    byScene: {
      [SCENE]: {
        oak: { open: true, locked: false, revealed: true },
        bookcase: { open: false, locked: false, revealed: false },
      },
      'map-2': { bookcase: { open: false, locked: false, revealed: false } },
    },
  }
  const redact = doors.redact!

  it('leaves the DM view untouched, object identity included', () => {
    expect(redact(state, DM)).toBe(state)
  })

  it('strips an unrevealed secret door whole, in every scene', () => {
    const seen = redact(state, P1)
    expect(Object.keys(seen.byScene[SCENE])).toEqual(['oak'])
    expect(Object.keys(seen.byScene['map-2'])).toEqual([])
    // the id of a door nobody has found appears nowhere in a player-bound frame
    expect(JSON.stringify(seen)).not.toContain('bookcase')
  })

  it('keeps a secret door once it is revealed', () => {
    const found: DoorsState = {
      byScene: { [SCENE]: { bookcase: { open: false, locked: false, revealed: true } } },
    }
    expect(Object.keys(redact(found, P1).byScene[SCENE])).toEqual(['bookcase'])
  })

  it('is idempotent and does not mutate the source', () => {
    const once = redact(state, P1)
    expect(redact(once, P1)).toEqual(once)
    expect(Object.keys(state.byScene[SCENE])).toEqual(['oak', 'bookcase'])
  })

  describe('and the doors the fog has handed over', () => {
    const played: DoorsState = {
      byScene: {
        [SCENE]: {
          oak: { open: true, locked: false, revealed: true },
          iron: { open: false, locked: true, revealed: true },
          arch: { open: true, locked: false, revealed: true },
        },
      },
    }
    const fogged = (...ids: string[]) => doorsModule(() => AUTHORED, () => new Set(ids)).redact!

    it('sends a player nothing at all before they have explored anything', () => {
      expect(fogged()(played, P1).byScene[SCENE]).toEqual({})
      // not one id of the structure they have not walked into
      expect(JSON.stringify(fogged()(played, P1))).not.toContain('iron')
    })

    it('sends the doors of the rooms they have, and only those', () => {
      expect(Object.keys(fogged('oak', 'arch')(played, P1).byScene[SCENE]).sort()).toEqual([
        'arch',
        'oak',
      ])
    })

    it('still strips a secret door standing in an explored room', () => {
      const secret: DoorsState = {
        byScene: { [SCENE]: { bookcase: { open: true, locked: false, revealed: false } } },
      }
      expect(fogged('bookcase')(secret, P1).byScene[SCENE]).toEqual({})
    })

    it('leaves the DM the whole scene and stays idempotent for a player', () => {
      expect(fogged('oak')(played, DM)).toBe(played)
      const once = fogged('oak')(played, P1)
      expect(fogged('oak')(once, P1)).toEqual(once)
    })
  })
})
