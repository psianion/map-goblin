// S3 P1 — token vision as the server tells it: the sweep, what a move or a door swing
// auto-explores, what an explore lock refuses to give away, and which tokens survive
// redaction once sight is measured at the point rather than the room.
//
// The fixture is two rooms either side of one long wall with a door in it (and a secret
// door further down): every assertion below is about a party that can see through the gap
// or cannot, so the geometry has to be something a reader can hold in their head.
//
// Rooms mode is the control in almost every row — it must come out byte-identical.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Viewer } from '@dnd/mechanics/contract'
import { doorsModule } from '@dnd/mechanics/doors'
import { fogModule, getCell, type FogState, type SceneFog } from '@dnd/mechanics/fog'
import { tokensModule, type Token, type TokensState } from '@dnd/mechanics/tokens'
import type { ServerMessage } from '@dnd/core/src/shared/protocol'
import type { AnyChild, ZoneShape } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ModuleRegistry } from '../modules/registry'
import { buildRedactor, type OutboundMessage } from '../ws/Broadcaster'
import { autoExplore } from './autoExplore'
import { createVision } from './vision'

const MAP = readFileSync(join(import.meta.dirname, '../../../testdata/vision-two-rooms.mapbuilder'), 'utf8')

const SCENE = 'two-rooms'
const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const P1: Viewer = { role: 'player', identityId: 'p-1' }

/**
 * The map frame is (-1, -1)–(23, 11), so cell (col, row) centres on (col - .5, row - .5) —
 * the token at (5.5, 5.5) stands on cell (6, 6) and the east room's doorway is cell (13, 6).
 */
const WEST_CELL: [number, number] = [6, 6]
const EAST_CELL: [number, number] = [13, 6]

const lock = (shape: ZoneShape): AnyChild =>
  ({
    id: 'zone-lock',
    name: 'Sealed vault',
    childType: 'zone',
    visible: true,
    shape,
    blocksAutoExplore: true,
  }) as AnyChild

/** Everything east of the wall, so a sweep through the doorway earns exactly nothing. */
const EAST_LOCK = lock({ kind: 'rect', x: 11.5, y: -2, width: 14, height: 14 })

function wired(zones: AnyChild[] = []) {
  const data = JSON.parse(MAP) as SerializedMapData
  const layer = data.layers[0] as DungeonLayer
  layer.children = [...layer.children, ...zones]

  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Two Rooms')
  stores.maps.insert(SCENE, campaign.id, 'Two Rooms', JSON.stringify(data))
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Two Rooms')

  const vision = createVision(stores)
  const registry = new ModuleRegistry(stores.moduleState, autoExplore(vision))
  registry.register(tokensModule(vision.visionOf))
  registry.register(fogModule(vision.roomsOf, vision.frameOf))
  registry.register(doorsModule(vision.doorsOf, vision.playerDoors))
  const redact = buildRedactor(registry, vision)

  const sent: ServerMessage[] = []
  const toPlayer: OutboundMessage[] = []
  const run = (sender: Viewer, module: string, action: string, payload: object) =>
    registry.dispatch(
      module,
      action,
      { sceneId: SCENE, ...payload },
      {
        campaignId: campaign.id,
        sessionId: 's-1',
        activeSceneId: SCENE,
        sender,
        players: [],
        broadcast: (msg) => {
          sent.push(msg)
          toPlayer.push(redact(msg, P1))
        },
      },
    )

  const stateOf = <S>(module: string) => stores.moduleState.get(campaign.id, module) as S | undefined
  const fogOf = (): SceneFog =>
    stateOf<FogState>('fog')?.byScene[SCENE] ?? { rooms: {}, concealBehindDoors: true }
  const tokensOf = (): Record<string, Token> => stateOf<TokensState>('tokens')?.byScene[SCENE] ?? {}

  return {
    vision,
    registry,
    run,
    sent,
    toPlayer,
    fogOf,
    tokensOf,
    /** What a player's socket would be handed for the tokens slice right now. */
    tokensFor: (viewer: Viewer) =>
      Object.keys(
        (registry.redactModule('tokens', stateOf('tokens') ?? { library: {}, byScene: {} }, viewer) as TokensState)
          .byScene[SCENE] ?? {},
      ).sort(),
    modules: () => sent.flatMap((msg) => (msg.type === 'state-update' ? [msg.module] : [])),
  }
}

/** A claimed scout with 8 cells of sight, standing in the west room, and the room lit. */
function scouted(table: ReturnType<typeof wired>, mode: 'rooms' | 'vision' = 'vision'): string {
  table.run(DM, 'fog', 'set-mode', { mode })
  table.run(DM, 'tokens', 'place', {
    name: 'Scout',
    x: 2.5,
    y: 5.5,
    sight: { range: 8, angle: 360, visionMode: 'normal' },
  })
  const id = Object.keys(table.tokensOf())[0]
  expect(table.run(P1, 'tokens', 'claim', { id })).toBeNull()
  return id
}

describe('the party sweep the server keeps (S3 P1 §3)', () => {
  it('sees across its own room and not through the wall, until the door opens', () => {
    const table = wired()
    const id = scouted(table)
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })

    const closed = table.vision.visionOf(SCENE)!
    expect(closed.canSee).toBeDefined()
    expect(closed.canSee!(9.5, 5.5)).toBe(true)
    expect(closed.canSee!(12.5, 5.5)).toBe(false)

    expect(table.run(DM, 'doors', 'toggle', { id: 'door-mid' })).toBeNull()
    const open = table.vision.visionOf(SCENE)!
    expect(open.canSee!(12.5, 5.5)).toBe(true)
    // The doorway is a two-cell gap, not a hole in the whole wall.
    expect(open.canSee!(12.5, 1.5)).toBe(false)
  })

  it('treats an unfound secret door as the wall it is disguised as', () => {
    const table = wired()
    const id = scouted(table)
    // Level with the secret door, which the map authored open.
    table.run(DM, 'tokens', 'move', { id, x: 9.5, y: 8.5 })
    expect(table.vision.visionOf(SCENE)!.canSee!(12.5, 8.5)).toBe(false)

    expect(table.run(DM, 'doors', 'reveal-secret', { id: 'door-secret-east' })).toBeNull()
    expect(table.vision.visionOf(SCENE)!.canSee!(12.5, 8.5)).toBe(true)
  })

  it('sweeps for nobody in rooms mode, and answers rooms the old way', () => {
    const table = wired()
    const id = scouted(table, 'rooms')
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    expect(table.vision.visionOf(SCENE)!.canSee).toBeUndefined()
  })

  it('ignores an unclaimed, a hidden and a sightless token', () => {
    const table = wired()
    table.run(DM, 'fog', 'set-mode', { mode: 'vision' })
    // Placed but never claimed, and one with no sight at all: nobody is looking.
    table.run(DM, 'tokens', 'place', { name: 'Statue', x: 5.5, y: 5.5, sight: null })
    table.run(DM, 'tokens', 'place', {
      name: 'Unclaimed',
      x: 5.5,
      y: 5.5,
      sight: { range: 8, angle: 360, visionMode: 'normal' },
    })
    expect(table.vision.visionOf(SCENE)!.canSee!(5.5, 5.5)).toBe(false)

    // Claimed, so it looks — then hidden by the DM, so it stops.
    const claimable = Object.entries(table.tokensOf()).find(([, t]) => t.sight !== null)![0]
    table.run(P1, 'tokens', 'claim', { id: claimable })
    expect(table.vision.visionOf(SCENE)!.canSee!(5.5, 5.5)).toBe(true)
    table.run(DM, 'tokens', 'hide', { id: claimable, hidden: true })
    expect(table.vision.visionOf(SCENE)!.canSee!(5.5, 5.5)).toBe(false)
  })
})

describe('party-mode auto-explore (§4)', () => {
  it('writes region bits and reveals the room a move swept, through the fog module', () => {
    const table = wired()
    const id = scouted(table)
    expect(table.fogOf().rooms.west).toBeUndefined()

    const before = table.sent.length
    expect(table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })).toBeNull()

    const fog = table.fogOf()
    expect(fog.rooms.west).toEqual({ status: 'revealed', wasEverRevealed: true })
    expect(fog.rooms.east).toBeUndefined()
    expect(getCell(fog.region, ...WEST_CELL)).toBe(true)
    expect(getCell(fog.region, ...EAST_CELL)).toBe(false)

    // One fog write, on the existing path: the move's own frame, then fog, then the two
    // slices fog retracts. No second reveal route.
    expect(table.modules().slice(before)).toEqual(['tokens', 'fog', 'tokens', 'doors'])
  })

  it('rides D5 — the geometry of the room it just opened travels in the same frame', () => {
    const table = wired()
    const id = scouted(table)
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })

    const deltas = table.toPlayer.flatMap((msg) => ('mapDelta' in msg ? [msg.mapDelta] : []))
    expect(deltas).toHaveLength(1)
    expect(deltas[0].sceneId).toBe(SCENE)
    expect(deltas[0].layers.flatMap((l) => l.rooms.map((r) => r.id))).toEqual(['west'])
  })

  it('extends through a door the moment it opens, and reveals what is behind it', () => {
    const table = wired()
    const id = scouted(table)
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    expect(table.fogOf().rooms.east).toBeUndefined()

    expect(table.run(DM, 'doors', 'toggle', { id: 'door-mid' })).toBeNull()
    expect(table.fogOf().rooms.east).toEqual({ status: 'revealed', wasEverRevealed: true })
    expect(getCell(table.fogOf().region, ...EAST_CELL)).toBe(true)
  })

  it('writes nothing at all when the sweep has found nothing new', () => {
    const table = wired()
    const id = scouted(table)
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    const settled = table.sent.length
    const bits = table.fogOf().region!.bits

    // Two more moves onto the cell it already stands on: the same sweep, twice over.
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    expect(table.fogOf().region!.bits).toBe(bits)
    expect(table.modules().slice(settled)).toEqual(['tokens', 'tokens'])
  })

  it('leaves the record alone with auto-explore off, while sight still redacts', () => {
    const table = wired()
    const id = scouted(table)
    expect(table.run(DM, 'fog', 'set-auto-explore', { autoExplore: false })).toBeNull()

    const before = table.sent.length
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    expect(table.fogOf().rooms.west).toBeUndefined()
    expect(table.fogOf().region).toBeUndefined()
    expect(table.modules().slice(before)).toEqual(['tokens'])
    // …and the sweep is still there, doing the half of the job §4 keeps.
    expect(table.vision.visionOf(SCENE)!.canSee!(5.5, 5.5)).toBe(true)
  })

  it('writes nothing in rooms mode, however far the tokens walk', () => {
    const table = wired()
    const id = scouted(table, 'rooms')
    const before = table.sent.length
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    table.run(DM, 'doors', 'toggle', { id: 'door-mid' })
    expect(table.fogOf().rooms).toEqual({})
    expect(table.fogOf().region).toBeUndefined()
    expect(table.modules().slice(before)).toEqual(['tokens', 'doors', 'tokens', 'fog'])
  })
})

describe('explore locks (§5)', () => {
  it('refuses a locked zone both its cells and its room reveal', () => {
    const table = wired([EAST_LOCK])
    const id = scouted(table)
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    table.run(DM, 'doors', 'toggle', { id: 'door-mid' })

    const fog = table.fogOf()
    expect(fog.rooms.west).toMatchObject({ status: 'revealed' })
    expect(fog.rooms.east).toBeUndefined()
    expect(getCell(fog.region, ...EAST_CELL)).toBe(false)
    // The lock stops the *record*, never the sight: the party can still see in there.
    expect(table.vision.visionOf(SCENE)!.canSee!(12.5, 5.5)).toBe(true)
  })

  it('still lets the DM reveal a locked room by hand', () => {
    const table = wired([EAST_LOCK])
    const id = scouted(table)
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    expect(table.run(DM, 'fog', 'reveal', { roomId: 'east' })).toBeNull()
    expect(table.fogOf().rooms.east).toMatchObject({ status: 'revealed' })
  })

  it('cannot be locked by a point zone, which has no area to lock', () => {
    const table = wired([
      { ...(lock({ kind: 'point', position: { x: 12.5, y: 5.5 } }) as object) } as AnyChild,
    ])
    const id = scouted(table)
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    table.run(DM, 'doors', 'toggle', { id: 'door-mid' })
    expect(table.fogOf().rooms.east).toMatchObject({ status: 'revealed' })
  })

  it('ignores a zone that is not flagged', () => {
    const open = { ...(EAST_LOCK as object), blocksAutoExplore: false } as AnyChild
    const table = wired([open])
    const id = scouted(table)
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    table.run(DM, 'doors', 'toggle', { id: 'door-mid' })
    expect(table.fogOf().rooms.east).toMatchObject({ status: 'revealed' })
  })
})

// Every row here is written so the *room* rule would answer the other way — the ambusher
// always stands somewhere the party has explored and can currently see. Otherwise the room
// rule alone would produce the same answer and the test would prove nothing about sight.
describe('token redaction by vision (§6)', () => {
  /**
   * A short-sighted scout in the middle of the west room, and an ambusher in the far corner
   * of the *same* room: the room is auto-explored and visible, and only the sweep says no.
   */
  function sameRoom(table: ReturnType<typeof wired>, mode: 'rooms' | 'vision') {
    table.run(DM, 'fog', 'set-mode', { mode })
    table.run(DM, 'tokens', 'place', {
      name: 'Scout',
      x: 5.5,
      y: 5.5,
      sight: { range: 3, angle: 360, visionMode: 'normal' },
    })
    table.run(DM, 'tokens', 'place', { name: 'Ambusher', x: 1.5, y: 1.5, sight: null })
    const by = (name: string) => Object.entries(table.tokensOf()).find(([, t]) => t.name === name)![0]
    const scout = by('Scout')
    table.run(P1, 'tokens', 'claim', { id: scout })
    // Rooms mode explores nothing, so light the room by hand there.
    if (mode === 'rooms') table.run(DM, 'fog', 'reveal', { roomId: 'west' })
    else table.run(DM, 'tokens', 'move', { id: scout, x: 5.5, y: 5.5 })
    return { scout, ambusher: by('Ambusher') }
  }

  it('withholds a token in a room the party can see but is not looking at', () => {
    const table = wired()
    const { scout, ambusher } = sameRoom(table, 'vision')
    // The room really is lit and visible — this is not a test about an unrevealed room.
    expect(table.fogOf().rooms.west).toMatchObject({ status: 'revealed' })
    expect(table.vision.visionOf(SCENE)!.visible.has('west')).toBe(true)

    expect(table.tokensFor(P1)).toEqual([scout])
    // …and the DM was never fenced by any of it.
    expect(table.tokensFor(DM)).toEqual([ambusher, scout].sort())
  })

  it('hands the same token over in rooms mode, which is the rule it replaces', () => {
    const table = wired()
    const { scout, ambusher } = sameRoom(table, 'rooms')
    expect(table.tokensFor(P1)).toEqual([ambusher, scout].sort())
  })

  it('hands it over the moment a step brings it into sight, and takes it back after', () => {
    const table = wired()
    const { scout, ambusher } = sameRoom(table, 'vision')
    table.run(DM, 'tokens', 'move', { id: scout, x: 2.5, y: 2.5 })
    expect(table.tokensFor(P1)).toEqual([ambusher, scout].sort())

    table.run(DM, 'tokens', 'move', { id: scout, x: 8.5, y: 8.5 })
    expect(table.tokensFor(P1)).toEqual([scout])
  })

  it('is not fooled by concealment being off — a shut door still blocks sight', () => {
    const table = wired()
    const scout = scouted(table)
    table.run(DM, 'tokens', 'place', { name: 'Ambusher', x: 12.5, y: 5.5, sight: null })
    const ambusher = Object.entries(table.tokensOf()).find(([, t]) => t.name === 'Ambusher')![0]
    table.run(DM, 'tokens', 'move', { id: scout, x: 5.5, y: 5.5 })
    // The room rule's two escape hatches, both open: the east room is lit by hand and
    // concealment is off, so `visible` holds it even with the door shut.
    table.run(DM, 'fog', 'reveal', { roomId: 'east' })
    table.run(DM, 'fog', 'set-conceal', { concealBehindDoors: false })
    expect(table.vision.visionOf(SCENE)!.visible.has('east')).toBe(true)
    expect(table.tokensFor(P1)).toEqual([scout])

    // Open it and sight reaches through the gap…
    table.run(DM, 'doors', 'toggle', { id: 'door-mid' })
    expect(table.tokensFor(P1)).toEqual([ambusher, scout].sort())
    // …shut it and the slice is retracted (D4c).
    table.run(DM, 'doors', 'toggle', { id: 'door-mid' })
    expect(table.tokensFor(P1)).toEqual([scout])
  })
})
