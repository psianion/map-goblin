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
import { PROTOCOL_VERSION } from './config'
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

function mapFile(customImages: Record<string, string> = {}): SerializedMapData {
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
    customImages,
  }
}

const SCENE = 'scene-1'
const prep: ScenePrep = { version: 2, triggers: [TRG_ROOM, TRG_TRAP], notes: [] }

/** A campaign with one scene/map (as above), a DM identity/token, and a fresh player identity. */
function seed(
  server: RunningServer,
  seedPrep: ScenePrep = prep,
  customImages: Record<string, string> = {},
): { campaignId: string; dmToken: string; mintPlayer: (name: string) => string } {
  const campaign = server.stores.campaigns.create('Crypt')
  server.stores.identities.mint('dm-1', campaign.id, 'Ann', 'dm')
  server.stores.maps.insert(SCENE, campaign.id, 'Dungeon', JSON.stringify(mapFile(customImages)))
  server.stores.scenes.create(SCENE, campaign.id, SCENE, 'Dungeon', JSON.stringify(seedPrep))
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

function sendJoin(socket: WebSocket, protocolVersion: number = PROTOCOL_VERSION): void {
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

// Stated against `PROTOCOL_VERSION` rather than the literals it was born with (v3/v4): the
// gate is "one behind is refused, current is let in", and pinning that to two hard-coded
// numbers means every future bump lands as a spurious failure in a file about triggers.
describe('protocol bump', () => {
  it('hard-closes a join one version behind and accepts the current one', async () => {
    await withServer(async (server) => {
      const { campaignId, dmToken } = seed(server)
      await openSession(server, dmToken, campaignId)

      const old = await connect(server, dmToken)
      sendJoin(old, PROTOCOL_VERSION - 1)
      expect((await next(old, 'error')).code).toBe('protocol-mismatch')
      await once(old, 'close')

      const current = await connect(server, dmToken)
      sendJoin(current, PROTOCOL_VERSION)
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

// ── prep v2: a fired encounter materializes tokens + initiative, notes pop DM-only ────────

describe('a fired encounter (prep v2)', () => {
  const TRG_ENC: TriggerDef = {
    id: 'trg-enc',
    name: 'Goblin ambush',
    when: { kind: 'enter-region', zoneId: 'zone-trap' },
    actions: [
      {
        kind: 'encounter',
        name: 'Goblin ambush',
        spawn: true,
        seedInitiative: true,
        monsters: [
          { id: 'm1', name: 'Goblin', count: 2, hp: '2d6' },
          { id: 'm2', name: 'Warg', count: 1, size: 'large' },
        ],
      },
    ],
    once: true,
    enabled: true,
  }

  it('spawns hostile tokens at the zone and seeds the tracker, HP behind the screen', async () => {
    await withServer(async (server) => {
      const { campaignId, dmToken, mintPlayer } = seed(server, {
        version: 2,
        triggers: [TRG_ENC],
        notes: [],
      })
      await openSession(server, dmToken, campaignId)

      const dm = await connect(server, dmToken)
      sendJoin(dm)
      await next(dm, 'session-state')
      const player = await connect(server, mintPlayer('Pia'))
      sendJoin(player)
      await next(player, 'session-state')
      await next(dm, 'player-joined')

      // Manual fire — the same path a walk-in takes, minus the token choreography.
      const frames = await runDrained([dm, player], ['tokens', 'initiative', 'triggers'], () =>
        sendCommand(dm, 'triggers', 'fire', { triggerId: 'trg-enc' }),
      )

      const dmTokens = (frames.get(dm)!.get('tokens')!.state as TokensState).byScene[SCENE]
      const spawned = Object.values(dmTokens)
      expect(spawned.map((t) => t.name).sort()).toEqual(['Goblin 1', 'Goblin 2', 'Warg'])
      for (const t of spawned) {
        expect(t.disposition).toBe('hostile')
        expect(t.ownerId).toBeNull()
        expect(t.hidden).toBe(false)
        // Inside/around the trap zone (anchor 12,12 with a 2-ring fan and grid snap).
        expect(Math.abs(t.x - 12)).toBeLessThanOrEqual(3)
        expect(Math.abs(t.y - 12)).toBeLessThanOrEqual(3)
      }
      expect(spawned.find((t) => t.name === 'Warg')!.size).toBe('large')

      // The room is unrevealed, so a player's copy holds none of the ambush.
      const playerTokens = (frames.get(player)!.get('tokens')!.state as TokensState).byScene[SCENE] ?? {}
      expect(Object.keys(playerTokens)).toHaveLength(0)

      type Initiative = {
        status: string
        entries: { name: string; kind: string; tokenId?: string; hp?: { current: number; max: number } }[]
      }
      const dmInit = frames.get(dm)!.get('initiative')!.state as Initiative
      expect(dmInit.status).toBe('gathering')
      expect(dmInit.entries.map((e) => e.name).sort()).toEqual(['Goblin 1', 'Goblin 2', 'Warg'])
      const goblin = dmInit.entries.find((e) => e.name === 'Goblin 1')!
      expect(goblin.kind).toBe('npc')
      expect(goblin.hp!.max).toBeGreaterThanOrEqual(2)
      expect(goblin.hp!.max).toBeLessThanOrEqual(12)
      // Each seeded row names the token it spawned with.
      expect(dmInit.entries.every((e) => e.tokenId && dmTokens[e.tokenId])).toBe(true)

      // A player's copy of the tracker never carries an NPC pool.
      const playerInit = frames.get(player)!.get('initiative')!.state as Initiative
      expect(playerInit.entries.every((e) => e.hp === undefined)).toBe(true)

      // The DM's log line; nothing about the encounter reaches the player's log.
      const dmLog = triggersOf(frames.get(dm)!.get('triggers')!).byScene[SCENE]!.log
      expect(dmLog.some((l) => l.kind === 'encounter' && l.text.includes('Goblin ambush'))).toBe(true)
      const playerLog = triggersOf(frames.get(player)!.get('triggers')!).byScene[SCENE]?.log ?? []
      expect(playerLog.some((l) => l.kind === 'encounter')).toBe(false)

      dm.close()
      player.close()
    })
  })
})

describe('a reveal note (prep v2)', () => {
  it('pops once to the DM when the room reveals, and never to a player', async () => {
    await withServer(async (server) => {
      const { campaignId, dmToken, mintPlayer } = seed(server, {
        version: 2,
        triggers: [],
        notes: [
          {
            id: 'n1',
            zoneId: 'zone-room',
            title: 'Kitchens',
            body: 'The cook is a spy.',
            imageKeys: [],
            showOnReveal: true,
          },
        ],
      })
      await openSession(server, dmToken, campaignId)

      const dm = await connect(server, dmToken)
      sendJoin(dm)
      await next(dm, 'session-state')
      const player = await connect(server, mintPlayer('Pia'))
      sendJoin(player)
      await next(player, 'session-state')
      await next(dm, 'player-joined')

      const frames = await runDrained([dm, player], ['fog', 'triggers'], () =>
        sendCommand(dm, 'fog', 'reveal', { sceneId: SCENE, roomId: ROOM.id }),
      )

      const dmLog = triggersOf(frames.get(dm)!.get('triggers')!).byScene[SCENE]!.log
      const noteLine = dmLog.find((l) => l.kind === 'note')
      expect(noteLine).toBeDefined()
      expect(noteLine!.text).toBe('Kitchens — The cook is a spy.')
      expect(noteLine!.toPlayers).toBe(false)

      const playerLog = triggersOf(frames.get(player)!.get('triggers')!).byScene[SCENE]?.log ?? []
      expect(playerLog.some((l) => l.kind === 'note')).toBe(false)

      // A second reveal-shaped write changes nothing — the note is spent, and a no-op
      // cascade skips its setState entirely, so no triggers frame arrives at all. The
      // persisted row is the assertion surface instead.
      await runDrained([dm], ['fog'], () =>
        sendCommand(dm, 'fog', 'reveal', { sceneId: SCENE, roomId: ROOM.id }),
      )
      const stored = server.stores.moduleState.get(campaignId, 'triggers') as TriggersState
      expect(stored.byScene[SCENE]!.log.filter((l) => l.kind === 'note')).toHaveLength(1)
    })
  })
})

// ── Journal v1: share-note / share-card, and the image route's note-image gate ────────────

describe('the Journal (share-note / share-card, and note-image access gating)', () => {
  const NOTE_WITH_IMAGE = {
    id: 'note-1',
    zoneId: 'zone-room',
    title: 'Old Bridge',
    body: 'Half-collapsed; the far rope is frayed.',
    imageKeys: ['img-1'],
    showOnReveal: false,
  }
  const IMAGE = 'data:image/png;base64,aGVsbG8='

  async function fetchImage(server: RunningServer, sceneId: string, key: string, token: string) {
    return fetch(`http://127.0.0.1:${server.port}/api/maps/${sceneId}/images/${key}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  }

  it('share-note snapshots the note into the journal, receipts DM-only, and opens the note image only to players — after the share', async () => {
    await withServer(async (server) => {
      // `terrain-0` rides alongside the note's own key, unshared and un-noted — standing in
      // for a terrain splat / imported picture, which must keep loading for players over
      // this same route no matter what the note-image gate below does.
      const { campaignId, dmToken, mintPlayer } = seed(
        server,
        { version: 2, triggers: [], notes: [NOTE_WITH_IMAGE] },
        { 'img-1': IMAGE, 'terrain-0': IMAGE },
      )
      await openSession(server, dmToken, campaignId)

      const dm = await connect(server, dmToken)
      sendJoin(dm)
      await next(dm, 'session-state')
      const playerToken = mintPlayer('Pia')
      const player = await connect(server, playerToken)
      sendJoin(player)
      await next(player, 'session-state')
      await next(dm, 'player-joined')

      // Before any share: the DM can always fetch a note's own picture, a player cannot —
      // the note has never been published. A key nothing has ever noted (a terrain splat, an
      // imported picture) is untouched by the gate and stays open to a player throughout.
      expect((await fetchImage(server, SCENE, 'img-1', dmToken)).status).toBe(200)
      expect((await fetchImage(server, SCENE, 'img-1', playerToken)).status).toBe(404)
      expect((await fetchImage(server, SCENE, 'terrain-0', playerToken)).status).toBe(200)

      const frames = await runDrained([dm, player], ['triggers'], () =>
        sendCommand(dm, 'triggers', 'share-note', { sceneId: SCENE, noteId: 'note-1', kicker: 'place' }),
      )

      // Both roles receive the published card — it is shared by definition.
      const dmState = triggersOf(frames.get(dm)!.get('triggers')!)
      const playerState = triggersOf(frames.get(player)!.get('triggers')!)
      expect(dmState.journal).toHaveLength(1)
      expect(playerState.journal).toEqual(dmState.journal)
      expect(playerState.journal![0]).toMatchObject({
        kicker: 'place',
        title: 'Old Bridge',
        body: 'Half-collapsed; the far rope is frayed.',
        imageKeys: ['img-1'],
        sourceNoteId: 'note-1',
      })

      // The receipt is DM-only bookkeeping — a player's copy never carries it, so a player
      // cannot infer which (or how many) notes exist unshared.
      expect((dmState as { shareReceipts?: unknown }).shareReceipts).toBeDefined()
      expect((playerState as { shareReceipts?: unknown }).shareReceipts).toBeUndefined()

      // The toast-picker kind ('show-text', toPlayers) rides the ordinary trigger log too —
      // no new client plumbing needed for the card to announce itself at the table.
      const playerLog = dmState.byScene[SCENE]!.log
      expect(playerLog.some((l) => l.kind === 'show-text' && l.text.includes('Old Bridge'))).toBe(true)

      // After the share: the same key now opens for the player.
      expect((await fetchImage(server, SCENE, 'img-1', playerToken)).status).toBe(200)

      dm.close()
      player.close()
    })
  })

  it('keeps an unshared note picture out of the map document itself, in both of its shapes', async () => {
    await withServer(async (server) => {
      const { campaignId, dmToken, mintPlayer } = seed(
        server,
        { version: 2, triggers: [], notes: [NOTE_WITH_IMAGE] },
        { 'img-1': IMAGE, 'terrain-0': IMAGE },
      )
      await openSession(server, dmToken, campaignId)
      const dm = await connect(server, dmToken)
      sendJoin(dm)
      await next(dm, 'session-state')
      const playerToken = mintPlayer('Pia')

      const doc = async (token: string, external: boolean) =>
        (await (
          await fetch(
            `http://127.0.0.1:${server.port}/api/maps/${SCENE}${external ? '?images=external' : ''}`,
            { headers: { authorization: `Bearer ${token}` } },
          )
        ).json()) as { customImages?: Record<string, string>; imageKeys?: string[] }

      // `?images=external` is the client's own request shape, so gating only the binary image
      // route would leave the inline form — one query param away — handing the bytes straight
      // over. Neither shape may carry an unshared note's picture.
      const inline = await doc(playerToken, false)
      expect(Object.keys(inline.customImages ?? {})).toEqual(['terrain-0'])
      const external = await doc(playerToken, true)
      expect(external.imageKeys).toEqual(['terrain-0'])
      // The DM's copy is the file as uploaded, untouched.
      expect(Object.keys((await doc(dmToken, false)).customImages ?? {}).sort()).toEqual(['img-1', 'terrain-0'])

      const onTriggers = nextModule(dm, 'triggers')
      sendCommand(dm, 'triggers', 'share-note', { sceneId: SCENE, noteId: 'note-1' })
      await onTriggers

      // Published: the key rejoins the player's document, so a re-load renders the handout.
      expect(Object.keys((await doc(playerToken, false)).customImages ?? {}).sort()).toEqual([
        'img-1',
        'terrain-0',
      ])
      dm.close()
    })
  })

  it('share-card publishes a fresh text card with no source note', async () => {
    await withServer(async (server) => {
      const { campaignId, dmToken } = seed(server, { version: 2, triggers: [], notes: [] })
      await openSession(server, dmToken, campaignId)
      const dm = await connect(server, dmToken)
      sendJoin(dm)
      await next(dm, 'session-state')

      const onTriggers = nextModule(dm, 'triggers')
      sendCommand(dm, 'triggers', 'share-card', {
        sceneId: SCENE,
        kicker: 'missive',
        title: 'A Warning',
        body: 'The bridge is out.',
      })
      const state = triggersOf(await onTriggers)
      expect(state.journal).toHaveLength(1)
      expect(state.journal![0]).toMatchObject({ kicker: 'missive', title: 'A Warning', body: 'The bridge is out.' })
      expect(state.journal![0]!.sourceNoteId).toBeUndefined()
      dm.close()
    })
  })
})
