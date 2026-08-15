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
import { triggersModule, type TriggersState } from '@dnd/mechanics/triggers'
import type { ServerMessage } from '@dnd/core/src/shared/protocol'
import type { ScenePrep } from '@dnd/core/src/shared/prep'
import type { AnyChild, WallSegment, ZoneShape } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ModuleRegistry } from '../modules/registry'
import { createTriggerDeps } from '../triggers/prepResolver'
import { buildRedactor, type OutboundMessage } from '../ws/Broadcaster'
import { autoExplore } from './autoExplore'
import { createVision } from './vision'

const MAP = readFileSync(join(import.meta.dirname, '../../../testdata/vision-two-rooms.mapbuilder'), 'utf8')

const SCENE = 'two-rooms'
const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const P1: Viewer = { role: 'player', identityId: 'p-1' }
/** The second seat P5 exists for — every row before it is a table of one player. */
const P2: Viewer = { role: 'player', identityId: 'p-2' }

/** The roster the table is dispatching against — what `tokens assign` validates against. */
const ROSTER = [
  { identityId: 'dm-1', name: 'Ayla', role: 'dm' as const, connected: true },
  { identityId: 'p-1', name: 'Borin', role: 'player' as const, connected: true },
  { identityId: 'p-2', name: 'Cass', role: 'player' as const, connected: true },
]

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

function wired(children: AnyChild[] = [], extra: { walls?: WallSegment[]; prep?: ScenePrep } = {}) {
  const data = JSON.parse(MAP) as SerializedMapData
  const layer = data.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
  layer.children = [...layer.children, ...children]
  layer.standaloneWalls = [...layer.standaloneWalls, ...(extra.walls ?? [])]

  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Two Rooms')
  stores.maps.insert(SCENE, campaign.id, 'Two Rooms', JSON.stringify(data))
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Two Rooms', extra.prep ? JSON.stringify(extra.prep) : null)

  const vision = createVision(stores)
  const registry = new ModuleRegistry(stores.moduleState, autoExplore(vision))
  registry.register(tokensModule(vision.visionOf))
  registry.register(fogModule(vision.roomsOf, vision.frameOf, vision.roomAtOf))
  registry.register(doorsModule(vision.doorsOf, vision.playerDoors))
  registry.register(triggersModule(createTriggerDeps(stores, vision.sceneMapOf)))
  const redact = buildRedactor(registry, vision)

  const sent: ServerMessage[] = []
  const toPlayer: OutboundMessage[] = []
  /** P5 — the same frames as the second seat receives them, so a divergence has two sides. */
  const toPlayer2: OutboundMessage[] = []
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
        players: ROSTER,
        broadcast: (msg) => {
          sent.push(msg)
          toPlayer.push(redact(msg, P1))
          toPlayer2.push(redact(msg, P2))
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
    toPlayer2,
    fogOf,
    tokensOf,
    /** Which triggers have fired, by id. */
    fired: () => Object.keys(stateOf<TriggersState>('triggers')?.byScene[SCENE]?.fired ?? {}),
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

  /**
   * The segment cache is keyed on one char per door, and a closed secret door has to be a
   * *third* state rather than a second "does not let sight through": unfound, its wall is
   * never split and occludes end to end; found and shut, the wall is split and the door span
   * is what occludes. On a window wall — which blocks no light of its own — that is the
   * difference between seeing through and not, and the two used to share a cache key.
   */
  it('recomputes when a closed secret door is revealed on a wall that passes light', () => {
    const table = wired(
      [
        {
          id: 'door-shutter',
          name: 'Shutter',
          childType: 'door',
          visible: true,
          wallId: 'wall-window',
          position: [7, 5],
          angle: 0,
          width: 2,
          style: 'single',
          state: 'closed',
          isSecret: true,
          roomA: null,
          roomB: null,
        } as AnyChild,
      ],
      {
        walls: [
          {
            id: 'wall-window',
            points: [
              [7, 0],
              [7, 10],
            ],
            wallType: 'window',
            direction: 'both',
            color: '#000000',
            width: 0.5,
            roughness: 0,
          } as WallSegment,
        ],
      },
    )
    const id = scouted(table)
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    // Unfound: the shutter is not even split out of the window wall, and a window passes
    // light, so the scout sees straight across it.
    expect(table.vision.visionOf(SCENE)!.canSee!(8.5, 5.5)).toBe(true)

    expect(table.run(DM, 'doors', 'reveal-secret', { id: 'door-shutter' })).toBeNull()
    // Found and still shut: the door span is the occluder the window never was.
    expect(table.vision.visionOf(SCENE)!.canSee!(8.5, 5.5)).toBe(false)
    // …and above it the window still passes light, so this is the door, not the whole wall.
    expect(table.vision.visionOf(SCENE)!.canSee!(8.5, 1.5)).toBe(true)
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
  it('writes region bits and latches the room a move swept, through the fog module', () => {
    const table = wired()
    const id = scouted(table)
    // The claim already swept from where the scout was standing (§4's trigger table), so
    // what this move has to earn is the ground the far corner of the room hid.
    expect(table.fogOf().rooms.east).toBeUndefined()
    expect(getCell(table.fogOf().region, 10, 1)).toBe(false)

    const before = table.sent.length
    expect(table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })).toBeNull()
    expect(getCell(table.fogOf().region, 10, 1)).toBe(true)

    const fog = table.fogOf()
    // The latch, not a reveal: the sweep ships the room's geometry and the cells the party
    // actually swept say what they can see of it. `revealed` — which washes a room whole on
    // the player's canvas — is reserved for the DM's own button.
    expect(fog.rooms.west).toEqual({ status: 're_hidden', wasEverRevealed: true })
    expect(fog.rooms.east).toBeUndefined()
    expect(getCell(fog.region, ...WEST_CELL)).toBe(true)
    expect(getCell(fog.region, ...EAST_CELL)).toBe(false)

    // One fog write, on the existing path: the move's own frame, then fog, then the two
    // slices fog retracts. No second reveal route.
    expect(table.modules().slice(before)).toEqual(['tokens', 'fog', 'tokens', 'doors'])
  })

  it('never overwrites the DM’s own word — a reveal and a re-hide both survive the sweep', () => {
    const table = wired()
    const id = scouted(table)
    expect(table.run(DM, 'fog', 'reveal', { roomId: 'west' })).toBeNull()

    // Swept, and still `revealed`: the latch only ever fills in a room nobody has seen.
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    expect(table.fogOf().rooms.west).toMatchObject({ status: 'revealed' })
    expect(getCell(table.fogOf().region, ...WEST_CELL)).toBe(true)

    // …and a room the DM took back does not come back on its own the next time the party
    // looks at it. Their cells still show — taking those is a region-hide (P4's brush).
    expect(table.run(DM, 'fog', 'hide', { roomId: 'west' })).toBeNull()
    table.run(DM, 'tokens', 'move', { id, x: 4.5, y: 4.5 })
    expect(table.fogOf().rooms.west).toMatchObject({ status: 're_hidden' })
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
    expect(table.fogOf().rooms.east).toEqual({ status: 're_hidden', wasEverRevealed: true })
    expect(getCell(table.fogOf().region, ...EAST_CELL)).toBe(true)
  })

  // Everything that changes *who* is sweeping moves the party's sight as surely as a step
  // does. Off the trigger table, each of these lit nothing until somebody happened to walk.
  it('writes on a claim and on a resize, not only on a step', () => {
    const table = wired()
    table.run(DM, 'fog', 'set-mode', { mode: 'vision' })
    // Short sight on purpose: a two-cell circle is small enough that half a cell of
    // re-snapping visibly moves it, which a room-filling radius would hide.
    table.run(DM, 'tokens', 'place', {
      name: 'Scout',
      x: 5.5,
      y: 5.5,
      sight: { range: 2, angle: 360, visionMode: 'normal' },
    })
    const id = Object.keys(table.tokensOf())[0]
    // Unclaimed, so nobody is looking yet and the place earned nothing.
    expect(table.fogOf().region).toBeUndefined()

    // The claim alone — no move follows it.
    expect(table.run(P1, 'tokens', 'claim', { id })).toBeNull()
    expect(getCell(table.fogOf().region, ...WEST_CELL)).toBe(true)
    expect(table.fogOf().rooms.west).toMatchObject({ status: 're_hidden' })
    // Just out of reach from where it stands.
    expect(getCell(table.fogOf().region, 8, 7)).toBe(false)

    // A size change re-snaps a medium onto the intersection a large sits on, which carries
    // the sweep origin half a cell with it — and that is a write, not a wait.
    expect(table.run(DM, 'tokens', 'update', { id, size: 'large' })).toBeNull()
    expect(table.tokensOf()[id]).toMatchObject({ x: 6, y: 6 })
    expect(getCell(table.fogOf().region, 8, 7)).toBe(true)

    // Hide and delete are on the table for the same reason and write nothing on their own:
    // region memory only ever ORs, so eyes leaving the scene take no ground back.
    const before = table.sent.length
    table.run(DM, 'tokens', 'hide', { id, hidden: true })
    expect(table.vision.visionOf(SCENE)!.canSee!(5.5, 5.5)).toBe(false)
    table.run(DM, 'tokens', 'delete', { id })
    expect(table.modules().slice(before)).toEqual(['tokens', 'tokens'])
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
    // Off before anybody claims anything: the claim sweeps too, and this row is about a
    // record that never gets written at all.
    table.run(DM, 'fog', 'set-mode', { mode: 'vision' })
    expect(table.run(DM, 'fog', 'set-auto-explore', { autoExplore: false })).toBeNull()
    table.run(DM, 'tokens', 'place', {
      name: 'Scout',
      x: 2.5,
      y: 5.5,
      sight: { range: 8, angle: 360, visionMode: 'normal' },
    })
    const id = Object.keys(table.tokensOf())[0]
    expect(table.run(P1, 'tokens', 'claim', { id })).toBeNull()

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

// A room the party walked into is revealed, and a room-revealed trigger cannot tell that
// apart from the DM pressing the button. The causing command's own cascade is no substitute:
// it runs before the after-write hook, so it reads the explored set from before the sweep.
describe('auto-explored rooms and the triggers hanging off them (M4 × §4)', () => {
  const VAULT_EYE: AnyChild = {
    id: 'zone-vault',
    name: 'Vault',
    childType: 'zone',
    visible: true,
    shape: { kind: 'point', position: { x: 17, y: 5 } },
  } as AnyChild

  const PREP: ScenePrep = {
    version: 1,
    triggers: [
      {
        id: 'trg-vault',
        name: 'Something stirs',
        when: { kind: 'room-revealed', zoneId: 'zone-vault' },
        actions: [{ kind: 'show-text', text: 'Something stirs in the vault.', toPlayers: true }],
        once: true,
        enabled: true,
      },
    ],
  }

  it('fires a room-revealed trigger on the room a sweep opened, with no further move', () => {
    const table = wired([VAULT_EYE], { prep: PREP })
    const id = scouted(table)
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    // The west room is open, the east one is not, and the trigger is still asleep.
    expect(table.fogOf().rooms.east).toBeUndefined()
    expect(table.fired()).toEqual([])

    // One door swing. Nothing moves after it.
    expect(table.run(DM, 'doors', 'toggle', { id: 'door-mid' })).toBeNull()
    // Latched, not revealed — and a room-revealed trigger reads the *explored* set, which the
    // latch is what puts a room into, so the sweep still springs it.
    expect(table.fogOf().rooms.east).toMatchObject({ status: 're_hidden' })
    expect(table.fired()).toEqual(['trg-vault'])
  })

  it('still fires it for a DM reveal, which is the path that always worked', () => {
    const table = wired([VAULT_EYE], { prep: PREP })
    expect(table.run(DM, 'fog', 'reveal', { roomId: 'east' })).toBeNull()
    expect(table.fired()).toEqual(['trg-vault'])
  })
})

// A cell brush is presentation memory, and presentation needs something to sit on: a player
// holds no geometry at all for a room nobody has revealed, so bits painted into one used to
// reach a client that could never draw them. The latch is what ships the room — and only the
// room the stroke landed in.
describe('the region brush ships the room it paints (P2 §5)', () => {
  it('hands over that room’s geometry and its bits, and no other room', () => {
    const table = wired()
    table.run(DM, 'fog', 'set-mode', { mode: 'vision' })
    const before = table.toPlayer.length

    // Two cells inside the east room, which nobody has been anywhere near.
    expect(table.run(DM, 'fog', 'region-set', { op: 'reveal', cells: [EAST_CELL, [14, 6]] })).toBeNull()

    const fog = table.fogOf()
    expect(fog.rooms.east).toEqual({ status: 're_hidden', wasEverRevealed: true })
    expect(fog.rooms.west).toBeUndefined()
    expect(getCell(fog.region, ...EAST_CELL)).toBe(true)

    // D5: the geometry rode the stroke's own frame, sliced to the one room.
    const deltas = table.toPlayer.slice(before).flatMap((msg) => ('mapDelta' in msg ? [msg.mapDelta] : []))
    expect(deltas).toHaveLength(1)
    expect(deltas[0].layers.flatMap((l) => l.rooms.map((r) => r.id))).toEqual(['east'])

    // …and what the player's own fog slice says: the bits, the east room, never the west one.
    const sent = table.toPlayer.slice(before).find((msg) => msg.type === 'state-update' && msg.module === 'fog')
    const scene = (sent as { state: FogState }).state.byScene[SCENE]
    expect(Object.keys(scene.rooms)).toEqual(['east'])
    expect(getCell(scene.region, ...EAST_CELL)).toBe(true)
    expect(getCell(scene.region, ...WEST_CELL)).toBe(false)
  })
})

describe('explore locks (§5)', () => {
  it('refuses a locked zone both its cells and its room reveal', () => {
    const table = wired([EAST_LOCK])
    const id = scouted(table)
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    table.run(DM, 'doors', 'toggle', { id: 'door-mid' })

    const fog = table.fogOf()
    expect(fog.rooms.west).toMatchObject({ status: 're_hidden' })
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
    expect(table.fogOf().rooms.east).toMatchObject({ status: 're_hidden' })
  })

  it('ignores a zone that is not flagged', () => {
    const open = { ...(EAST_LOCK as object), blocksAutoExplore: false } as AnyChild
    const table = wired([open])
    const id = scouted(table)
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    table.run(DM, 'doors', 'toggle', { id: 'door-mid' })
    expect(table.fogOf().rooms.east).toMatchObject({ status: 're_hidden' })
  })
})

// Every row here is written so the *room* rule would answer the other way — the ambusher
// always stands somewhere the party has explored and can currently see. Otherwise the room
// rule alone would produce the same answer and the test would prove nothing about sight.
// ── P4 §4 — sight links ────────────────────────────────────────────────────
// The familiar is the whole case: an *unclaimed* token, in a room nobody has been near, whose
// sweep the party owns only because the DM said so. Everything below is a fact the scout alone
// could not have produced — region bits in the east room, a room latched, a token on the wire.

describe('a sight link widens the party (P4 §4)', () => {
  /** The scout in the west room, plus an unclaimed hawk deep in the east one, with sight. */
  function familiar(table: ReturnType<typeof wired>) {
    const scout = scouted(table)
    table.run(DM, 'tokens', 'place', {
      name: 'Hawk',
      x: 17.5,
      y: 5.5,
      sight: { range: 6, angle: 360, visionMode: 'normal' },
    })
    const by = (name: string) => Object.entries(table.tokensOf()).find(([, t]) => t.name === name)![0]
    return { scout, hawk: by('Hawk') }
  }

  const link = (table: ReturnType<typeof wired>, id: string, otherId: string, linked: boolean) =>
    table.run(DM, 'tokens', 'set-sight-link', { id, otherId, linked })

  it('lends an unclaimed familiar’s sweep to the party — sight, cells and the room latch', () => {
    const table = wired()
    const { scout, hawk } = familiar(table)

    // The shut door is between them: the scout's own sweep reaches none of this.
    expect(table.vision.visionOf(SCENE)!.canSee!(17.5, 5.5)).toBe(false)
    expect(table.fogOf().rooms.east).toBeUndefined()
    expect(getCell(table.fogOf().region, ...EAST_CELL)).toBe(false)

    expect(link(table, scout, hawk, true)).toBeNull()

    expect(table.vision.visionOf(SCENE)!.canSee!(17.5, 5.5)).toBe(true)
    // …and the write rode the same auto-explore hook a step does: the east room latched and
    // its cells landed, with nothing on the board having moved.
    expect(table.fogOf().rooms.east).toEqual({ status: 're_hidden', wasEverRevealed: true })
    expect(getCell(table.fogOf().region, ...EAST_CELL)).toBe(true)
  })

  it('ships a token only the familiar can see, and stops shipping it on unlink', () => {
    const table = wired()
    const { scout, hawk } = familiar(table)
    table.run(DM, 'tokens', 'place', { name: 'Cultist', x: 16.5, y: 5.5, sight: null })
    const cultist = Object.entries(table.tokensOf()).find(([, t]) => t.name === 'Cultist')![0]

    // Neither the hawk (unclaimed, out of sight) nor what it is looking at.
    expect(table.tokensFor(P1)).toEqual([scout])

    link(table, scout, hawk, true)
    // The hawk is the viewer's own now (the closure), and the cultist is in its sweep.
    expect(table.tokensFor(P1)).toEqual([cultist, hawk, scout].sort())

    link(table, scout, hawk, false)
    expect(table.tokensFor(P1)).toEqual([scout])
  })

  it('is transitive, and hidden beats the link', () => {
    const table = wired()
    const { scout, hawk } = familiar(table)
    table.run(DM, 'tokens', 'place', {
      name: 'Rat',
      x: 20.5,
      y: 8.5,
      sight: { range: 4, angle: 360, visionMode: 'normal' },
    })
    const rat = Object.entries(table.tokensOf()).find(([, t]) => t.name === 'Rat')![0]
    link(table, scout, hawk, true)
    link(table, hawk, rat, true)
    expect(table.vision.visionOf(SCENE)!.canSee!(20.5, 8.5)).toBe(true)

    // The hawk goes off the board, and the chain to the rat goes with it.
    table.run(DM, 'tokens', 'hide', { id: hawk, hidden: true })
    expect(table.vision.visionOf(SCENE)!.canSee!(20.5, 8.5)).toBe(false)
    expect(table.vision.visionOf(SCENE)!.canSee!(17.5, 5.5)).toBe(false)
  })

  it('anchors the rooms-mode party too — the familiar’s room is one of theirs', () => {
    const table = wired()
    const scout = scouted(table, 'rooms')
    table.run(DM, 'tokens', 'place', { name: 'Hawk', x: 17.5, y: 5.5, sight: null })
    const hawk = Object.entries(table.tokensOf()).find(([, t]) => t.name === 'Hawk')![0]
    table.run(DM, 'fog', 'reveal', { roomId: 'east' })

    // Concealment is on and the door is shut, so the east room is unreachable from the west.
    expect(table.vision.visionOf(SCENE)!.visible.has('east')).toBe(false)
    link(table, scout, hawk, true)
    // The party now stands in both rooms, so the BFS starts in the east one as well.
    expect(table.vision.visionOf(SCENE)!.visible.has('east')).toBe(true)
  })
})

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
    // A sweep only *latches* the room it opened (`re_hidden`); `revealed` stays a DM act. So
    // both modes get the hand reveal as well — this row is about sight withholding a token in
    // a room the room rule hands over whole, and the room rule is given every chance to agree.
    if (mode === 'vision') table.run(DM, 'tokens', 'move', { id: scout, x: 5.5, y: 5.5 })
    table.run(DM, 'fog', 'reveal', { roomId: 'west' })
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

// ── S3 P3 — the light model ─────────────────────────────────────────────────
// Every row below turns on one thing: `seen()` is `inSweep AND (not dark OR lit OR
// darkvision-in-range)`. The geometry is the same two halls, so what a reading proves is the
// light clause and never the shadowcast — the P1 rows above already pin that half.

/** An authored light on the map, at a spot and a reach the rows below can reason about. */
const light = (id: string, x: number, y: number, radius: number, visible = true): AnyChild =>
  ({
    id,
    name: id,
    childType: 'light',
    visible,
    color: '#ffbb66',
    radius,
    featherRadius: radius / 2,
    intensity: 1,
    falloff: 'quadratic',
    position: { x, y },
  }) as AnyChild

/** A claimed scout in the west hall, in a scene the DM has turned to `darkness`. */
function nightWatch(
  table: ReturnType<typeof wired>,
  at: { x: number; y: number } = { x: 5.5, y: 5.5 },
  sight = { range: 8, angle: 360, visionMode: 'normal' },
): string {
  table.run(DM, 'fog', 'set-mode', { mode: 'vision' })
  table.run(DM, 'triggers', 'set-environment', { ambient: 'darkness' })
  table.run(DM, 'tokens', 'place', { name: 'Scout', ...at, sight })
  const id = Object.keys(table.tokensOf()).find((t) => table.tokensOf()[t].name === 'Scout')!
  expect(table.run(P1, 'tokens', 'claim', { id })).toBeNull()
  return id
}

describe('the light gate (S3 P3 §3)', () => {
  it('leaves a normal eye blind in the dark, and daylight untouched', () => {
    const table = wired()
    const id = nightWatch(table)
    // Its own feet, well inside its own sweep — and unlit, so it sees nothing at all.
    expect(table.vision.visionOf(SCENE)!.canSee!(5.5, 5.5)).toBe(false)
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(false)

    // The dial back to daylight, with nothing else touched: the P2 answer, exactly.
    table.run(DM, 'triggers', 'set-environment', { ambient: 'daylight' })
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(true)
    expect(table.vision.visionOf(SCENE)!.canSee!(12.5, 5.5)).toBe(false) // the wall, still
    expect(table.tokensOf()[id].x).toBe(5.5) // and nothing moved to earn it
  })

  it('reads dusk as daylight — the difference between the two is presentation', () => {
    const table = wired()
    nightWatch(table)
    table.run(DM, 'triggers', 'set-environment', { ambient: 'dusk' })
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(true)
  })

  it('sees by a placed light, and not through the wall that shadows one', () => {
    // Two lights three cells apart, one either side of the wall. Both are within reach of the
    // spot being asked about; only one of them can actually get there.
    const table = wired([light('west-lamp', 9.5, 5.5, 6), light('east-lamp', 12.5, 5.5, 6, false)])
    nightWatch(table)
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(true)

    // …and with the near lamp doused, the far one is 3 cells away through a wall: unlit.
    const dark = wired([light('west-lamp', 9.5, 5.5, 6, false), light('east-lamp', 12.5, 5.5, 6)])
    nightWatch(dark)
    expect(dark.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(false)
  })

  it('relights the doorway’s edge when the door opens, with nobody moving', () => {
    const table = wired([light('east-lamp', 12.5, 5.5, 6)])
    const id = nightWatch(table, { x: 9.5, y: 5.5 })
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(false)

    expect(table.run(DM, 'doors', 'toggle', { id: 'door-mid' })).toBeNull()
    // The lamp's own sweep now reaches through the two-cell gap, and the scout is standing in
    // what it reaches. Nothing about the scout changed.
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(true)
    expect(table.tokensOf()[id]).toMatchObject({ x: 9.5, y: 5.5 })
    // Above the doorway the wall still shadows it — this is a gap, not a hole in the wall.
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 1.5)).toBe(false)
  })

  it('lights the dark from a carried torch, and puts it out when the token is hidden', () => {
    const table = wired()
    const id = nightWatch(table)
    table.run(DM, 'tokens', 'place', {
      name: 'Torchbearer',
      x: 8.5,
      y: 5.5,
      sight: null,
      light: { dim: 4, bright: 2, color: '#ffbb66', angle: 360 },
    })
    const torch = Object.keys(table.tokensOf()).find(
      (t) => table.tokensOf()[t].name === 'Torchbearer',
    )!
    // Unclaimed and sightless — it is not looking at anything, it is only burning.
    expect(table.vision.visionOf(SCENE)!.canSee!(8.5, 5.5)).toBe(true)
    // The outer of the two radii is the reach: 4 cells, not 2.
    expect(table.vision.visionOf(SCENE)!.canSee!(5.5, 5.5)).toBe(true)
    expect(table.vision.visionOf(SCENE)!.canSee!(2.5, 5.5)).toBe(false)

    // Taken off the board: a lit torch on a token nobody may see is a position leak.
    expect(table.run(DM, 'tokens', 'hide', { id: torch, hidden: true })).toBeNull()
    expect(table.vision.visionOf(SCENE)!.canSee!(8.5, 5.5)).toBe(false)
    expect(table.tokensOf()[id].sight).not.toBeNull()
  })

  it('gives darkvision its own ring, and lends it to nobody else', () => {
    const table = wired()
    // Two claimed eyes on the same spot: a far-seeing normal one and a short darkvision one.
    nightWatch(table, { x: 5.5, y: 5.5 }, { range: 8, angle: 360, visionMode: 'normal' })
    table.run(DM, 'tokens', 'place', {
      name: 'Owl',
      x: 5.5,
      y: 5.5,
      sight: { range: 3, angle: 360, visionMode: 'darkvision' },
    })
    const owl = Object.keys(table.tokensOf()).find((t) => table.tokensOf()[t].name === 'Owl')!
    table.run(P1, 'tokens', 'claim', { id: owl })

    // Inside the owl's range: unlit ground, seen anyway.
    expect(table.vision.visionOf(SCENE)!.canSee!(7.5, 5.5)).toBe(true)
    // Past it — inside the *other* eye's sweep, which has no darkvision to lend it.
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(false)

    // In daylight the darkvision eye is an ordinary one: its range still binds.
    table.run(DM, 'triggers', 'set-environment', { ambient: 'daylight' })
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(true)
  })

  it('follows a trigger’s relight without anything else happening at the table', () => {
    const LAMP_PREP: ScenePrep = {
      version: 1,
      triggers: [
        {
          id: 'trg-lamp',
          name: 'The lamp',
          when: { kind: 'room-revealed', zoneId: 'zone-lamp' },
          actions: [{ kind: 'light', lightId: 'west-lamp', on: true }],
          once: false,
          enabled: true,
        },
      ],
    }
    const anchor: AnyChild = {
      id: 'zone-lamp',
      name: 'The lamp',
      childType: 'zone',
      visible: true,
      shape: { kind: 'point', position: { x: 5, y: 5 } },
    } as AnyChild
    const table = wired([anchor, light('west-lamp', 9.5, 5.5, 6, false)], { prep: LAMP_PREP })
    nightWatch(table)
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(false)

    expect(table.run(DM, 'triggers', 'fire', { triggerId: 'trg-lamp' })).toBeNull()
    // The override beats the map's authored `visible: false`, and the vision cache re-derived
    // off the triggers write on its own — no token moved, no door swung.
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(true)
  })
})

describe('auto-explore and redaction in the dark (S3 P3 §3.2, §3.1)', () => {
  it('records the cells the party could see, not the ones their sweep crossed', () => {
    const table = wired([light('west-lamp', 5.5, 5.5, 3)])
    const id = nightWatch(table)
    const fog = table.fogOf()
    // Standing in the lamp's pool: the cell under the party is theirs.
    expect(getCell(fog.region, ...WEST_CELL)).toBe(true)
    // Four cells out — inside a sweep that reaches eight, and pitch dark.
    expect(getCell(fog.region, 10, 6)).toBe(false)
    // The room still latches: they saw part of it, so its geometry is theirs to hold.
    expect(fog.rooms.west).toMatchObject({ status: 're_hidden', wasEverRevealed: true })

    // Daylight over the same sweep, nothing else touched: the cell they could not see is
    // theirs now, which is the whole difference the gate makes.
    table.run(DM, 'triggers', 'set-environment', { ambient: 'daylight' })
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    expect(getCell(table.fogOf().region, 10, 6)).toBe(true)
  })

  it('leaves a locked zone locked however brightly it is lit', () => {
    const table = wired([EAST_LOCK, light('east-lamp', 12.5, 5.5, 6)])
    const id = nightWatch(table)
    table.run(DM, 'doors', 'toggle', { id: 'door-mid' })
    table.run(DM, 'tokens', 'move', { id, x: 9.5, y: 5.5 })
    // Lit, swept, and still the DM's to give: locks beat the sweep by construction (§5).
    expect(table.vision.visionOf(SCENE)!.canSee!(12.5, 5.5)).toBe(true)
    expect(getCell(table.fogOf().region, ...EAST_CELL)).toBe(false)
    expect(table.fogOf().rooms.east).toBeUndefined()
  })

  it('keeps an unlit token off the wire, and hands it over the moment the light does', () => {
    const table = wired()
    const scout = nightWatch(table)
    table.run(DM, 'tokens', 'place', { name: 'Ambusher', x: 8.5, y: 5.5, sight: null })
    const ambusher = Object.entries(table.tokensOf()).find(([, t]) => t.name === 'Ambusher')![0]
    // Every room rule's escape hatch open: the room is revealed by hand and concealment off.
    table.run(DM, 'fog', 'reveal', { roomId: 'west' })
    table.run(DM, 'fog', 'set-conceal', { concealBehindDoors: false })

    // Three cells away in a straight, unobstructed line — and pitch dark.
    expect(table.tokensFor(P1)).toEqual([scout])
    const before = table.toPlayer.length

    // A torch carried into the room, and the ambusher is standing in the pool it throws.
    // (Placed rather than handed to the scout: `tokens.update` takes no light — see the
    // deferred note in this phase's report; the wire claim is about the light, not the hand.)
    expect(
      table.run(DM, 'tokens', 'place', {
        name: 'Torchbearer',
        x: 7.5,
        y: 5.5,
        sight: null,
        light: { dim: 4, bright: 2, color: '#ffbb66', angle: 360 },
      }),
    ).toBeNull()
    const torch = Object.entries(table.tokensOf()).find(([, t]) => t.name === 'Torchbearer')![0]
    expect(table.tokensFor(P1)).toEqual([ambusher, scout, torch].sort())

    // The wire itself, byte for byte: the frames after the torch was lit name the ambusher,
    // and the ones before it never did.
    const said = (msgs: unknown[]) => msgs.map((m) => JSON.stringify(m)).join('')
    expect(said(table.toPlayer.slice(0, before))).not.toContain(ambusher)
    expect(said(table.toPlayer.slice(before))).toContain(ambusher)
  })

  it('changes its answer on the dial alone, with nothing on the board moving', () => {
    const table = wired()
    const scout = nightWatch(table)
    table.run(DM, 'tokens', 'place', { name: 'Ambusher', x: 8.5, y: 5.5, sight: null })
    const ambusher = Object.entries(table.tokensOf()).find(([, t]) => t.name === 'Ambusher')![0]
    table.run(DM, 'fog', 'reveal', { roomId: 'west' })
    expect(table.tokensFor(P1)).toEqual([scout])

    expect(table.run(DM, 'triggers', 'set-environment', { ambient: 'daylight' })).toBeNull()
    expect(table.tokensFor(P1)).toEqual([ambusher, scout].sort())
    expect(table.tokensOf()[ambusher]).toMatchObject({ x: 8.5, y: 5.5 })

    // …and back into the dark, which takes it away again (D4c).
    expect(table.run(DM, 'triggers', 'set-environment', { ambient: 'darkness' })).toBeNull()
    expect(table.tokensFor(P1)).toEqual([scout])
  })

  it('hands a darkvision viewer what a normal one may not have', () => {
    const table = wired()
    const scout = nightWatch(
      table,
      { x: 5.5, y: 5.5 },
      { range: 8, angle: 360, visionMode: 'darkvision' },
    )
    table.run(DM, 'tokens', 'place', { name: 'Ambusher', x: 8.5, y: 5.5, sight: null })
    const ambusher = Object.entries(table.tokensOf()).find(([, t]) => t.name === 'Ambusher')![0]
    table.run(DM, 'fog', 'reveal', { roomId: 'west' })
    expect(table.tokensFor(P1)).toEqual([ambusher, scout].sort())

    // …and out past the ring it is nobody's licence: the same eyes, the same dark, a token
    // eight cells away rather than three.
    const far = wired()
    const near = nightWatch(
      far,
      { x: 9.5, y: 5.5 },
      { range: 3, angle: 360, visionMode: 'darkvision' },
    )
    far.run(DM, 'tokens', 'place', { name: 'Ambusher', x: 2.5, y: 5.5, sight: null })
    far.run(DM, 'fog', 'reveal', { roomId: 'west' })
    expect(far.tokensFor(P1)).toEqual([near])
  })
})

// ── S3 P5 — individual vision ───────────────────────────────────────────────
// Two seats at one table, each looking through its own eyes. The geometry is deliberate: both
// seats' tokens stand in the *same* revealed hall, so the room rule would hand every one of
// the tokens below to both of them and only a per-seat sweep can produce these answers. Party
// share is the control on every row that has one — it must come out as P1..P4 left it.

/** The fog scene as the last frame in `msgs` said it — one seat's own copy of the record. */
function fogSlice(msgs: OutboundMessage[]): SceneFog {
  const last = [...msgs].reverse().find((m) => m.type === 'state-update' && m.module === 'fog')
  return ((last as { state: FogState }).state.byScene[SCENE] ?? {}) as SceneFog
}

/** Every frame a seat was sent, as one string — the byte search the wire rows do. */
const said = (msgs: readonly OutboundMessage[]): string =>
  msgs.map((m) => JSON.stringify(m)).join('')

describe('individual vision (S3 P5)', () => {
  /** p-1's scout, west; p-2's guard, further into the same hall. Neither sees the other. */
  const SCOUT = { x: 2.5, y: 5.5 }
  const GUARD = { x: 8.5, y: 8.5 }
  /** Where those two stand, in the region record's own cells (the frame starts at -1, -1). */
  const SCOUT_CELL: [number, number] = [3, 6]
  const GUARD_CELL: [number, number] = [9, 9]
  const SHORT = { range: 3, angle: 360, visionMode: 'normal' }

  const idOf = (table: ReturnType<typeof wired>, name: string) =>
    Object.entries(table.tokensOf()).find(([, t]) => t.name === name)![0]

  /**
   * The two-seat table: one claimed token each, and something standing in each one's sight
   * that the other cannot possibly see. The hall is revealed by hand so the room rule is
   * given every chance to hand all four tokens to both seats.
   */
  function twoSeats(share: 'party' | 'individual' = 'individual') {
    const table = wired()
    table.run(DM, 'fog', 'set-mode', { mode: 'vision' })
    table.run(DM, 'fog', 'set-share', { visionShare: share })
    table.run(DM, 'tokens', 'place', { name: 'Scout', ...SCOUT, sight: SHORT })
    table.run(DM, 'tokens', 'place', { name: 'Guard', ...GUARD, sight: SHORT })
    // One cell from the scout and seven from the guard — and the mirror image of it.
    table.run(DM, 'tokens', 'place', { name: 'Rat', x: 1.5, y: 5.5, sight: null })
    table.run(DM, 'tokens', 'place', { name: 'Spider', x: 8.5, y: 6.5, sight: null })
    const ids = {
      scout: idOf(table, 'Scout'),
      guard: idOf(table, 'Guard'),
      rat: idOf(table, 'Rat'),
      spider: idOf(table, 'Spider'),
    }
    expect(table.run(P1, 'tokens', 'claim', { id: ids.scout })).toBeNull()
    expect(table.run(P2, 'tokens', 'claim', { id: ids.guard })).toBeNull()
    table.run(DM, 'fog', 'reveal', { roomId: 'west' })
    return { table, ...ids }
  }

  /** An unclaimed familiar deep in the far hall, behind the shut door. */
  function hawk(table: ReturnType<typeof wired>): string {
    table.run(DM, 'tokens', 'place', {
      name: 'Hawk',
      x: 17.5,
      y: 5.5,
      sight: { range: 6, angle: 360, visionMode: 'normal' },
    })
    return idOf(table, 'Hawk')
  }

  describe('the record each seat accrues', () => {
    it('holds what that seat’s own eyes saw, and nothing the other’s did', () => {
      const { table } = twoSeats()
      const fog = table.fogOf()
      expect(getCell(fog.regions!['p-1'], ...SCOUT_CELL)).toBe(true)
      expect(getCell(fog.regions!['p-1'], ...GUARD_CELL)).toBe(false)
      expect(getCell(fog.regions!['p-2'], ...GUARD_CELL)).toBe(true)
      expect(getCell(fog.regions!['p-2'], ...SCOUT_CELL)).toBe(false)
      // The room record stays shared — geometry ships per scene, never per seat (§1).
      expect(fog.rooms.west).toMatchObject({ wasEverRevealed: true })
    })

    it('leaves the party record as the seed rather than as the running total', () => {
      const { table } = twoSeats()
      expect(getCell(table.fogOf().region, ...SCOUT_CELL)).toBe(false)
      expect(getCell(table.fogOf().region, ...GUARD_CELL)).toBe(false)
    })

    it('writes one shared record in party share, exactly as P1 did', () => {
      const { table } = twoSeats('party')
      expect(table.fogOf().regions).toBeUndefined()
      expect(getCell(table.fogOf().region, ...SCOUT_CELL)).toBe(true)
      expect(getCell(table.fogOf().region, ...GUARD_CELL)).toBe(true)
    })

    it('feeds both linkees when the DM links one familiar to both seats', () => {
      const { table, scout, guard } = twoSeats()
      const familiar = hawk(table)
      // Behind a shut door in the far hall: neither seat's own eyes reach any of it.
      expect(getCell(table.fogOf().regions!['p-1'], ...EAST_CELL)).toBe(false)
      expect(getCell(table.fogOf().regions!['p-2'], ...EAST_CELL)).toBe(false)

      table.run(DM, 'tokens', 'set-sight-link', { id: scout, otherId: familiar, linked: true })
      table.run(DM, 'tokens', 'set-sight-link', { id: guard, otherId: familiar, linked: true })
      // One pair of borrowed eyes, two records: a link crosses the share by construction,
      // because the closure runs from whichever seed it was started with.
      expect(getCell(table.fogOf().regions!['p-1'], ...EAST_CELL)).toBe(true)
      expect(getCell(table.fogOf().regions!['p-2'], ...EAST_CELL)).toBe(true)
    })

    it('lends a familiar to the seat linked to it and to no other', () => {
      const { table, scout } = twoSeats()
      table.run(DM, 'tokens', 'set-sight-link', { id: scout, otherId: hawk(table), linked: true })
      expect(getCell(table.fogOf().regions!['p-1'], ...EAST_CELL)).toBe(true)
      expect(getCell(table.fogOf().regions!['p-2'], ...EAST_CELL)).toBe(false)
      // …and the far hall shipped for the table anyway: the room record is not per seat.
      expect(table.fogOf().rooms.east).toMatchObject({ wasEverRevealed: true })
    })
  })

  describe('what reaches each seat', () => {
    it('sends each seat its own record and never the other’s — raw bytes, both ways', () => {
      const { table } = twoSeats()
      const bitsOf = (id: string) => table.fogOf().regions![id].bits
      const mine = fogSlice(table.toPlayer)
      const theirs = fogSlice(table.toPlayer2)

      // The mapping: each seat's own record arrives as the `region` the mask already reads.
      expect(getCell(mine.region, ...SCOUT_CELL)).toBe(true)
      expect(getCell(mine.region, ...GUARD_CELL)).toBe(false)
      expect(getCell(theirs.region, ...GUARD_CELL)).toBe(true)
      expect(getCell(theirs.region, ...SCOUT_CELL)).toBe(false)
      expect(mine.regions).toBeUndefined()
      expect(theirs.regions).toBeUndefined()

      // …and no frame of the whole session carried the other seat's memory, or the fact that
      // there is another seat: the bytes are the memory, the quoted id is the fact.
      expect(said(table.toPlayer)).not.toContain(bitsOf('p-2'))
      expect(said(table.toPlayer)).not.toContain('"p-2"')
      expect(said(table.toPlayer2)).not.toContain(bitsOf('p-1'))
      expect(said(table.toPlayer2)).not.toContain('"p-1"')
    })

    it('withholds the tokens only the other seat is entitled to, both ways', () => {
      const { table, scout, guard, rat, spider } = twoSeats()
      expect(table.tokensFor(P1)).toEqual([rat, scout].sort())
      expect(table.tokensFor(P2)).toEqual([guard, spider].sort())
      // The DM is fenced by none of it (principle 3).
      expect(table.tokensFor(DM)).toEqual([guard, rat, scout, spider].sort())
    })

    it('never puts them on the wire at all — raw bytes, both ways', () => {
      const { table, guard, rat, spider, scout } = twoSeats()
      expect(said(table.toPlayer)).not.toContain(spider)
      expect(said(table.toPlayer)).not.toContain(guard)
      expect(said(table.toPlayer)).toContain(scout)
      expect(said(table.toPlayer2)).not.toContain(rat)
      expect(said(table.toPlayer2)).not.toContain(scout)
      expect(said(table.toPlayer2)).toContain(guard)
    })

    it('lets a linked familiar carry its own seat’s entitlement and no more', () => {
      const { table, scout, guard, spider, rat } = twoSeats()
      const familiar = hawk(table)
      table.run(DM, 'tokens', 'place', { name: 'Cultist', x: 16.5, y: 5.5, sight: null })
      const cultist = idOf(table, 'Cultist')
      table.run(DM, 'tokens', 'set-sight-link', { id: scout, otherId: familiar, linked: true })

      // p-1 holds the familiar (its own closure now) and what it is looking at; p-2 holds
      // neither, in the same scene, at the same moment.
      expect(table.tokensFor(P1)).toEqual([cultist, familiar, rat, scout].sort())
      expect(table.tokensFor(P2)).toEqual([guard, spider].sort())
    })

    it('hands both seats everything in party share, which is the rule it narrows', () => {
      const { table, scout, guard, rat, spider } = twoSeats('party')
      const all = [guard, rat, scout, spider].sort()
      expect(table.tokensFor(P1)).toEqual(all)
      expect(table.tokensFor(P2)).toEqual(all)
    })

    it('asks the party question of a caller with no viewer, so a move stays party-global', () => {
      const { table } = twoSeats()
      const anyone = table.vision.visionOf(SCENE)!
      expect(anyone.canSee!(SCOUT.x, SCOUT.y)).toBe(true)
      expect(anyone.canSee!(GUARD.x, GUARD.y)).toBe(true)
      // …while per seat it is one or the other, never both.
      expect(table.vision.visionOf(SCENE, P1)!.canSee!(GUARD.x, GUARD.y)).toBe(false)
      expect(table.vision.visionOf(SCENE, P2)!.canSee!(SCOUT.x, SCOUT.y)).toBe(false)
      // The DM's redaction is identity, so their answer is the party's.
      expect(table.vision.visionOf(SCENE, DM)!.canSee!(GUARD.x, GUARD.y)).toBe(true)
    })
  })

  describe('a share flip mid-session', () => {
    it('merges both records into the table’s and hands both seats everything', () => {
      const { table, scout, guard, rat, spider } = twoSeats()
      expect(table.run(DM, 'fog', 'set-share', { visionShare: 'party' })).toBeNull()

      const fog = table.fogOf()
      expect(getCell(fog.region, ...SCOUT_CELL)).toBe(true)
      expect(getCell(fog.region, ...GUARD_CELL)).toBe(true)
      // Nothing destroyed: each seat still holds its own record underneath.
      expect(getCell(fog.regions!['p-1'], ...SCOUT_CELL)).toBe(true)
      expect(getCell(fog.regions!['p-2'], ...GUARD_CELL)).toBe(true)
      // …and the redaction went with it, in the same beat: one party, one view.
      const all = [guard, rat, scout, spider].sort()
      expect(table.tokensFor(P1)).toEqual(all)
      expect(table.tokensFor(P2)).toEqual(all)
      // Both seats were *sent* the merged record, not just left holding their own.
      expect(getCell(fogSlice(table.toPlayer).region, ...GUARD_CELL)).toBe(true)
      expect(getCell(fogSlice(table.toPlayer2).region, ...SCOUT_CELL)).toBe(true)
    })

    it('gives each seat its own eyes back on the way in, with the table’s memory seeded', () => {
      const { table, scout, rat } = twoSeats('party')
      expect(table.run(DM, 'fog', 'set-share', { visionShare: 'individual' })).toBeNull()
      expect(table.tokensFor(P1)).toEqual([rat, scout].sort())
      // Neither seat wakes up blind: the party record is what a seat with none reads (§1).
      const seen = fogSlice(table.toPlayer)
      expect(getCell(seen.region, ...SCOUT_CELL)).toBe(true)
      expect(getCell(seen.region, ...GUARD_CELL)).toBe(true)
    })
  })
})

// ── The join deadlock ───────────────────────────────────────────────────────

/**
 * The defect the browser gate found, pinned from the wire down.
 *
 * Claiming is done by clicking a token on your own list. In vision mode a seat with no
 * claimed token has no eyes, so `canSee` is false everywhere and redaction hands it *zero*
 * token instances — its panel reads "No tokens on this scene", and there is nothing to click.
 * A player who joins after the tokens are placed can never claim their way in.
 *
 * The redaction is right and stays exactly as it is (the first half of the row asserts it,
 * byte for byte). What was missing is the DM's way of handing a token over, which this row
 * drives end to end: revert `tokens assign` and it fails on the dispatch.
 */
describe('a seat that joined with nothing (the DM assignment)', () => {
  it('is sent no tokens at all, until the DM assigns one — which is then an eye', () => {
    const table = wired()
    table.run(DM, 'fog', 'set-mode', { mode: 'vision' })
    table.run(DM, 'tokens', 'place', {
      name: 'Scout',
      x: 5.5,
      y: 5.5,
      sight: { range: 8, angle: 360, visionMode: 'normal' },
    })
    const scout = Object.keys(table.tokensOf())[0]

    // No eyes: the token is on the board, on the DM's wire, and on nobody else's.
    expect(table.tokensFor(DM)).toEqual([scout])
    expect(table.tokensFor(P1)).toEqual([])
    expect(said(table.toPlayer)).not.toContain(scout)
    // …and nothing has been swept, so there is no memory standing in for the sight either.
    expect(table.fogOf().rooms.west).toBeUndefined()
    const before = table.toPlayer.length

    expect(table.run(DM, 'tokens', 'assign', { id: scout, identityId: 'p-1' })).toBeNull()

    // The token reaches the seat it was handed to…
    expect(table.tokensFor(P1)).toEqual([scout])
    expect(said(table.toPlayer.slice(before))).toContain(scout)
    // …and, on the default party share, the seat that now sees through it — which is the
    // existing share rule, not a second thing the assignment does.
    expect(table.tokensFor(P2)).toEqual([scout])
    expect(said(table.toPlayer2.slice(before))).toContain(scout)
    // …and it is a pair of eyes: the assignment ran the same sweep a claim does, so the hall
    // it is standing in auto-explored without anybody taking a step.
    expect(table.fogOf().rooms.west).toBeDefined()
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(true)

    // Taking it back is the same command, and puts the seat back where it started.
    expect(table.run(DM, 'tokens', 'assign', { id: scout, identityId: null })).toBeNull()
    expect(table.tokensFor(P1)).toEqual([])
  })
})
