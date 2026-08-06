// M4 end to end: a real server, a real DM socket and a real player socket, over a scene
// whose map carries a DM-authored zone and a trap trigger in its prep. What this file pins
// that unit tests cannot: the protocol bump actually gates the handshake, the cascade wired
// into `ModuleRegistry` actually reaches the triggers module from a real `tokens.move` and a
// real `fog.reveal`/`fog.reset`, and the redaction a player receives over the wire really
// never carries a trigger definition or another seat's prompt.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { ServerMessage } from '@dnd/core/src/shared/protocol'
import type { ScenePrep, TriggerDef } from '@dnd/core/src/shared/prep'
import type { AnyChild, DungeonLayer, Room, SerializedMapData } from '@dnd/core/src/store/types'
import type { TriggersState } from '@dnd/mechanics/triggers'
import type { TokensState } from '@dnd/mechanics/tokens'
import { issueToken } from './auth'
import { startServer, type RunningServer } from './index'

beforeAll(() => {
  process.env.GAME_SERVER_DATA = mkdtempSync(join(tmpdir(), 'game-server-triggers-'))
})

async function withServer(body: (server: RunningServer) => Promise<void>): Promise<void> {
  const server = await startServer({ port: 0, heartbeatMs: 60_000, dbPath: ':memory:' })
  try {
    await body(server)
  } finally {
    await server.close()
  }
}

// ── one room, one point zone (room-revealed) and one rect zone (a trap) ────────

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]

const ROOM: Room = {
  id: 'room1',
  name: 'Room 1',
  boundary: rect(0, 0, 20, 20),
  centroid: [10, 10],
  area: 400,
  isPathway: false,
}

const zoneRoom: AnyChild = {
  id: 'zone-room',
  name: 'zone-room',
  childType: 'zone',
  visible: true,
  shape: { kind: 'point', position: { x: 2, y: 2 } },
} as AnyChild

const zoneTrap: AnyChild = {
  id: 'zone-trap',
  name: 'zone-trap',
  childType: 'zone',
  visible: true,
  shape: { kind: 'rect', x: 10, y: 10, width: 4, height: 4 },
} as AnyChild

const TRG_ROOM: TriggerDef = {
  id: 'trg-room',
  name: 'Room lit',
  when: { kind: 'room-revealed', zoneId: 'zone-room' },
  actions: [{ kind: 'show-text', text: 'Room lit', toPlayers: true }],
  once: false,
  enabled: true,
}

const TRG_TRAP: TriggerDef = {
  id: 'trg-trap',
  name: 'Dart trap',
  when: { kind: 'enter-region', zoneId: 'zone-trap' },
  actions: [{ kind: 'trap', text: 'A dart trap fires!', save: { ability: 'dex', dc: 12 }, damage: '1d6' }],
  once: false,
  enabled: true,
}

function mapFile(): SerializedMapData {
  const layer: DungeonLayer = {
    id: 'layer-1',
    name: 'Dungeon',
    type: 'dungeon',
    visible: true,
    locked: false,
    opacity: 1,
    children: [zoneRoom, zoneTrap],
    standaloneWalls: [],
    mergedFloor: [rect(0, 0, 20, 20)],
    style: {} as DungeonLayer['style'],
    sublayerVisibility: { floor: true, grid: true, walls: true },
    rooms: [ROOM],
    roomNameOverrides: { room1: ROOM.name },
  }
  return {
    version: '3.0',
    mapSettings: { name: 'Dungeon' } as SerializedMapData['mapSettings'],
    grid: { visible: true, snapDivision: 1, style: 'clean' } as SerializedMapData['grid'],
    layers: [layer],
    customImages: {},
  }
}

const SCENE = 'scene-1'
const prep: ScenePrep = { version: 1, triggers: [TRG_ROOM, TRG_TRAP] }

/** A campaign with one scene/map (as above), a DM identity/token, and a fresh player identity. */
function seed(server: RunningServer): { campaignId: string; dmToken: string; mintPlayer: (name: string) => string } {
  const campaign = server.stores.campaigns.create('Crypt')
  server.stores.identities.mint('dm-1', campaign.id, 'Ann', 'dm')
  server.stores.maps.insert(SCENE, campaign.id, 'Dungeon', JSON.stringify(mapFile()))
  server.stores.scenes.create(SCENE, campaign.id, SCENE, 'Dungeon', JSON.stringify(prep))
  const hmac = server.config.secrets.hmacSecret
  return {
    campaignId: campaign.id,
    // Unbound (no sessionId), same as a DM token minted by /api/campaigns — good for both
    // the HTTP call that opens the session and the socket that joins it afterwards.
    dmToken: issueToken(hmac, 'dm-1', campaign.id, 'dm'),
    mintPlayer: (name) => {
      const id = `player-${name}`
      if (!server.stores.identities.get(id)) server.stores.identities.mint(id, campaign.id, name, 'player')
      return issueToken(hmac, id, campaign.id, 'player')
    },
  }
}

/** POST /api/sessions with an optional startingRoom — the real HTTP path a DM's wizard hits. */
async function openSession(
  server: RunningServer,
  dmToken: string,
  campaignId: string,
  startingRoom?: { sceneId: string; roomId: string },
): Promise<{ sessionId: string }> {
  const res = await fetch(`http://127.0.0.1:${server.port}/api/sessions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${dmToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ campaignId, ...(startingRoom ? { startingRoom } : {}) }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { sessionId: string }
}

async function connect(server: RunningServer, token: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/?token=${token}`)
  await once(socket, 'open')
  return socket
}

function sendJoin(socket: WebSocket, protocolVersion = 4): void {
  socket.send(JSON.stringify({ type: 'join', protocolVersion }))
}

function sendCommand(socket: WebSocket, module: string, action: string, payload: unknown): void {
  socket.send(JSON.stringify({ type: 'command', module, action, payload, seq: 1 }))
}

function next<T extends ServerMessage['type']>(socket: WebSocket, type: T): Promise<Extract<ServerMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error(`timed out waiting for '${type}'`))
    }, 2000)
    const onMessage = (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage
      if (msg.type !== type) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve(msg as Extract<ServerMessage, { type: T }>)
    }
    socket.on('message', onMessage)
  })
}

/** Same wait, narrowed to a `state-update` for one module — several modules can update from
 *  one command (retracts, the triggers cascade), and each test cares about exactly one. */
function nextModule(socket: WebSocket, module: string): Promise<Extract<ServerMessage, { type: 'state-update' }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error(`timed out waiting for a '${module}' state-update`))
    }, 2000)
    const onMessage = (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage
      if (msg.type !== 'state-update' || msg.module !== module) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve(msg)
    }
    socket.on('message', onMessage)
  })
}

const triggersOf = (msg: { state: unknown }): TriggersState => msg.state as TriggersState

/**
 * Runs one `tokens`/`fog` command and waits for every socket's copy of everything it
 * produces — its own `state-update` plus the triggers cascade, on *every* already-joined
 * socket, not just the sender's. A joined-but-otherwise-idle socket (a bystander, or a seat
 * not otherwise touched by this step) still receives both broadcasts; leaving either
 * undrained means it sits on the socket until some *later* `nextModule` wait mistakes it for
 * that later step's message. Draining by module name on every socket up front is what keeps
 * each step's assertions looking at the frame that step actually produced.
 */
async function runDrained(
  sockets: readonly WebSocket[],
  modules: readonly string[],
  send: () => void,
): Promise<Map<WebSocket, Map<string, Extract<ServerMessage, { type: 'state-update' }>>>> {
  const waits = sockets.map((socket) => Promise.all(modules.map((m) => nextModule(socket, m))))
  send()
  const results = await Promise.all(waits)
  const bySocket = new Map<WebSocket, Map<string, Extract<ServerMessage, { type: 'state-update' }>>>()
  sockets.forEach((socket, i) => bySocket.set(socket, new Map(modules.map((m, j) => [m, results[i]![j]!]))))
  return bySocket
}

describe('protocol bump (M4 v4)', () => {
  it('hard-closes a v3 join and accepts v4', async () => {
    await withServer(async (server) => {
      const { campaignId, dmToken } = seed(server)
      await openSession(server, dmToken, campaignId)

      const old = await connect(server, dmToken)
      sendJoin(old, 3)
      expect((await next(old, 'error')).code).toBe('protocol-mismatch')
      await once(old, 'close')

      const current = await connect(server, dmToken)
      sendJoin(current, 4)
      expect((await next(current, 'session-state')).you.role).toBe('dm')
    })
  })
})

describe('room-revealed at session start, and fog reset re-arming it', () => {
  it('fires the room-revealed trigger before anyone has joined, and again after a reset', async () => {
    await withServer(async (server) => {
      const { campaignId, dmToken } = seed(server)
      // The wizard's starting room covers `zone-room`'s point — this is the exact path M4's
      // cascade has to cover with no extra wiring: `openSession` dispatches `fog.reveal`
      // through the same `ModuleRegistry.dispatch`, so the cascade already fires by the time
      // anyone connects.
      await openSession(server, dmToken, campaignId, { sceneId: SCENE, roomId: 'room1' })

      const dm = await connect(server, dmToken)
      sendJoin(dm)
      const snapshot = await next(dm, 'session-state')
      const before = triggersOf({ state: snapshot.state.modules.triggers }).byScene[SCENE]
      expect(before.log.filter((e) => e.triggerId === 'trg-room')).toHaveLength(1)
      expect(before.log[0]).toMatchObject({ kind: 'show-text', text: 'Room lit', toPlayers: true })

      // A true reset re-arms room-revealed triggers only (module.ts) — reveal it again and
      // it should fire a second time.
      sendCommand(dm, 'fog', 'reset', { sceneId: SCENE })
      await nextModule(dm, 'fog')
      const onTriggers = nextModule(dm, 'triggers')
      sendCommand(dm, 'fog', 'reveal', { sceneId: SCENE, roomId: 'room1' })
      const after = triggersOf(await onTriggers).byScene[SCENE]
      expect(after.log.filter((e) => e.triggerId === 'trg-room')).toHaveLength(2)
    })
  })
})

describe('a token walking into a trap zone (redaction, prompts, roll-prompt)', () => {
  it('prompts only the claiming player, logs to the DM, and resolves to DM + that player alone', async () => {
    await withServer(async (server) => {
      const { campaignId, dmToken, mintPlayer } = seed(server)
      await openSession(server, dmToken, campaignId, { sceneId: SCENE, roomId: 'room1' })

      const dm = await connect(server, dmToken)
      sendJoin(dm)
      await next(dm, 'session-state')

      const bob = await connect(server, mintPlayer('Bob'))
      sendJoin(bob)
      await next(bob, 'session-state')
      await next(dm, 'player-joined')

      const carol = await connect(server, mintPlayer('Carol')) // a bystander who should see none of this
      sendJoin(carol)
      await next(carol, 'session-state')
      await next(dm, 'player-joined')
      await next(bob, 'player-joined')

      const sockets = [dm, bob, carol] as const
      // Every one of these commands is `tokens.*`, which cascades into `triggers` — but a
      // cascade that changes nothing skips its setState entirely, so only steps that
      // actually fire/arm something produce a `triggers` frame. Drain exactly what each
      // step really broadcasts (via `runDrained`) so the *next* step's waits never catch a
      // frame this step produced.

      // DM places an unclaimed token well away from the trap, inside the (already revealed)
      // room — a silent no-op for triggers.
      const placeMsgs = await runDrained(sockets, ['tokens'], () =>
        sendCommand(dm, 'tokens', 'place', { sceneId: SCENE, name: 'Hero', x: 1, y: 1 }),
      )
      const placed = placeMsgs.get(dm)!.get('tokens')!.state as TokensState
      const tokenId = Object.values(placed.byScene[SCENE] ?? {})[0]?.id
      expect(tokenId).toBeTruthy()

      // Bob claims it — still nowhere near the trap, so the cascade finds nothing to fire
      // and stays silent too.
      await runDrained(sockets, ['tokens'], () =>
        sendCommand(bob, 'tokens', 'claim', { sceneId: SCENE, id: tokenId }),
      )

      // Bob walks it into `zone-trap`'s rect — this is the one that fires `trg-trap`.
      const moveMsgs = await runDrained(sockets, ['tokens', 'triggers'], () =>
        sendCommand(bob, 'tokens', 'move', { sceneId: SCENE, id: tokenId, x: 11, y: 11 }),
      )

      const bobSide = triggersOf(moveMsgs.get(bob)!.get('triggers')!).byScene[SCENE]
      expect(bobSide.prompts).toHaveLength(1)
      expect(bobSide.prompts[0]).toMatchObject({ kind: 'trap', triggerId: 'trg-trap' })
      // The DM's own bookkeeping never rides to a player — module.ts's redact empties these
      // three unconditionally, which is also the whole of what a "trigger definition" would
      // otherwise leak (the authored zone id, actions, `once`/`enabled`); a player's *own*
      // prompt legitimately carries its flavor text, since they're the one about to roll.
      expect(bobSide.fired).toEqual({})
      expect(bobSide.armed).toEqual({})
      expect(bobSide.disabled).toEqual({})

      const dmSide = triggersOf(moveMsgs.get(dm)!.get('triggers')!).byScene[SCENE]
      expect(dmSide.log.some((e) => e.triggerId === 'trg-trap' && e.kind === 'trap')).toBe(true)
      expect(dmSide.fired['trg-trap']).toBeTypeOf('number')

      // Carol claimed nothing and stands nowhere near the trap: the same cascade reached her
      // too (every joined socket gets the frame — that is what `runDrained` above is for),
      // but her redacted copy carries no prompt of her own and nothing about Bob's trap. The
      // room-lit line is legitimately hers as well (`toPlayers: true` — everyone's), which is
      // exactly the distinction redact draws: world-visible narration rides to every seat,
      // a trap addressed to Bob does not.
      const carolSide = triggersOf(moveMsgs.get(carol)!.get('triggers')!).byScene[SCENE]
      expect(carolSide.prompts).toHaveLength(0)
      expect(carolSide.log.some((e) => e.triggerId === 'trg-trap')).toBe(false)

      const promptId = bobSide.prompts[0]!.id
      const outcomeMsgs = await runDrained(sockets, ['triggers'], () =>
        sendCommand(bob, 'triggers', 'roll-prompt', { sceneId: SCENE, promptId }),
      )

      const bobAfter = triggersOf(outcomeMsgs.get(bob)!.get('triggers')!).byScene[SCENE]
      expect(bobAfter.prompts).toHaveLength(0)
      expect(bobAfter.log.some((e) => e.kind === 'roll-outcome' && e.forIdentityId === 'player-Bob')).toBe(true)

      const dmAfter = triggersOf(outcomeMsgs.get(dm)!.get('triggers')!).byScene[SCENE]
      expect(dmAfter.log.some((e) => e.kind === 'roll-outcome')).toBe(true)

      // The outcome is addressed to Bob alone (`forIdentityId`) — Carol's redacted copy of
      // the very same broadcast carries no roll-outcome line at all.
      const carolAfter = triggersOf(outcomeMsgs.get(carol)!.get('triggers')!).byScene[SCENE]
      expect(carolAfter.log.some((e) => e.kind === 'roll-outcome')).toBe(false)
    })
  })
})
