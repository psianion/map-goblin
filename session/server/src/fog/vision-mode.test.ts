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
import { beforeAll, describe, expect, it } from 'vitest'
import type { Viewer } from '@dnd/mechanics/contract'
import { doorsModule } from '@dnd/mechanics/doors'
import { fogModule, getCell, type FogState, type SceneFog } from '@dnd/mechanics/fog'
import { tokensModule, type Token, type TokensState } from '@dnd/mechanics/tokens'
import { triggersModule, type TriggersState } from '@dnd/mechanics/triggers'
import type { ServerMessage } from '@dnd/core/src/shared/protocol'
// v2 prep rows on purpose: a scene published before room keys stores them that way.
import type { StoredScenePrep as ScenePrep } from '@dnd/core/src/shared/prep'
import type { AnyChild, WallSegment, ZoneShape } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ModuleRegistry } from '../modules/registry'
import { createTriggerDeps } from '../triggers/prepResolver'
import { buildRedactor, type OutboundMessage } from '../ws/Broadcaster'
import { autoExplore } from './autoExplore'
import { ensureClipperReady } from './clipperBoot'
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
 * The map frame is (-2, -22)–(24, 22): the fixture's one wall runs y -20..20, far past both
 * floors, and a wall grows the map like anything else drawn. So cell (col, row) centres on
 * (col - 2.5, row - 22.5) — the token at (5.5, 5.5) stands on cell (7, 27) and the east
 * room's doorway is cell (14, 27).
 */
const WEST_CELL: [number, number] = [7, 27]
const EAST_CELL: [number, number] = [14, 27]

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

function wired(
  children: AnyChild[] = [],
  extra: {
    walls?: WallSegment[]
    prep?: ScenePrep
    floorRingsOnly?: boolean
    /** The imported-battlemap shape: the same floors, zoned by nobody (R9). */
    roomless?: boolean
  } = {},
) {
  const data = JSON.parse(MAP) as SerializedMapData
  const layer = data.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
  // FIX §1's regression: drop the map's own wall and its two doors, so `floor-west`/
  // `floor-east` (already on this fixture, otherwise unused as occluders) are the only thing
  // that can possibly stop a sweep at the two-cell gap between them.
  if (extra.floorRingsOnly) {
    layer.standaloneWalls = []
    layer.children = layer.children.filter((c) => c.childType !== 'door')
  }
  if (extra.roomless) layer.rooms = []
  layer.children = [...layer.children, ...children]
  layer.standaloneWalls = [...layer.standaloneWalls, ...(extra.walls ?? [])]

  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Two Rooms')
  stores.maps.insert(SCENE, campaign.id, 'Two Rooms', JSON.stringify(data))
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Two Rooms', extra.prep ? JSON.stringify(extra.prep) : null)

  const vision = createVision(stores)
  const registry = new ModuleRegistry(stores.moduleState, autoExplore(vision))
  registry.register(tokensModule(vision.visionOf))
  registry.register(fogModule(vision.roomsOf, vision.frameOf, vision.roomAtOf, undefined, undefined, (id) => vision.keptRoomsOf(id)))
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
    /** Writes the scene's fog straight into module state — how a *stored* record is staged. */
    setFog: (scene: SceneFog) => {
      const state = stateOf<FogState>('fog') ?? { byScene: {} }
      stores.moduleState.put(campaign.id, 'fog', {
        ...state,
        byScene: { ...state.byScene, [SCENE]: scene },
      })
    },
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
/**
 * Sight reaches the whole map by line of sight (`SIGHT_REACH`); a token's `range` bounds
 * only what it sees *unlit*. So a row that needs an eye with a short reach — ground in the
 * same room it cannot see — turns the lights off and gives it darkvision of that radius,
 * which is the one ring `range` still draws.
 */
const DARKVISION = (range: number) => ({ range, angle: 360, visionMode: 'darkvision' as const })

function inTheDark(table: ReturnType<typeof wired>) {
  table.run(DM, 'triggers', 'set-darkness', { value: 1 })
}

function scouted(
  table: ReturnType<typeof wired>,
  mode: 'rooms' | 'vision' = 'vision',
  sight: { range: number; angle: number; visionMode: 'normal' | 'darkvision' } = {
    range: 8,
    angle: 360,
    visionMode: 'normal',
  },
): string {
  table.run(DM, 'fog', 'set-mode', { mode })
  table.run(DM, 'tokens', 'place', { name: 'Scout', x: 2.5, y: 5.5, sight })
  const id = Object.keys(table.tokensOf())[0]
  expect(table.run(P1, 'tokens', 'claim', { id })).toBeNull()
  return id
}

// Every row in this file runs against the occluders a *running* server has, not a subset of
// them: `startServer` loads Clipper before it accepts a connection, so `sceneMap.ts`'s
// `healMergedFloor` always fires there and this fixture's two floor rings are always walls.
// Awaiting it in one describe block and nowhere else is what let the door rows below pass for
// months against a map with no floor edges in it while the same door did nothing at a real
// table (`sprint3-vision.spec.ts`, "opening the door grows the clear area").
beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
})

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

  it('lets a plain-sighted torch-bearer see and claim the ground their own light reaches', () => {
    const table = wired()
    table.run(DM, 'fog', 'set-mode', { mode: 'vision' })
    // The DM's bound for a map with no walls to do it: each eye swept at its own reach.
    expect(table.run(DM, 'fog', 'set-range-limit', { sightRangeLimit: true })).toBeNull()
    // Human eyes, no darkvision: range 0. Such a token used to be no eye at all, so a player
    // holding a torch on a roomless battlemap opened nothing. Its reach is the torch.
    expect(
      table.run(DM, 'tokens', 'place', {
        name: 'Torch',
        x: 5.5,
        y: 5.5,
        sight: { range: 0, angle: 360, visionMode: 'normal' },
        light: { dim: 3, bright: 1.5, color: '#ffdd88', angle: 360 },
      }),
    ).toBeNull()
    const id = Object.entries(table.tokensOf()).find(([, t]) => t.name === 'Torch')![0]
    expect(table.run(P1, 'tokens', 'claim', { id })).toBeNull()

    const sight = table.vision.visionOf(SCENE)!
    // Under the torch, and two cells out inside its glow…
    expect(sight.canSee!(5.5, 5.5)).toBe(true)
    expect(sight.canSee!(7.5, 5.5)).toBe(true)
    // …not four cells out past it, and never through the wall.
    expect(sight.canSee!(9.5, 5.5)).toBe(false)
    expect(sight.canSee!(12.5, 5.5)).toBe(false)
  })
})

describe('party-mode auto-explore (§4)', () => {

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
    version: 2,
    notes: [],
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

  it('still fires it for a DM reveal, which is the path that always worked', () => {
    const table = wired([VAULT_EYE], { prep: PREP })
    expect(table.run(DM, 'fog', 'reveal', { roomId: 'east' })).toBeNull()
    expect(table.fired()).toEqual(['trg-vault'])
  })
})

// The two-cell gap between `floor-west` and `floor-east` is unzoned map — inside the frame,
// inside no room — which makes this fixture the live Goblin Warren in miniature: a forest
// clearing and a cave whose floors do not touch, with yards of nothing between them. The
// room graph has no edge across a gap like that, so `occupiable` can never open it and the
// DM's room buttons have nothing to land on. In vision mode the cell record is the
// vocabulary that can say it, and this is the seam where saying it has to count.
describe('open ground: unzoned cells the party has been shown (D6 in vision mode)', () => {
  /** The frame starts at (-2, -22), so cell `[col, row]` is centred on `(col - 2.5, row - 22.5)`. */
  const GAP: [number, number] = [13, 27]
  /** The middle of that gap, in world coordinates — cell `GAP`'s own centre. */
  const [GAP_X, GAP_Y] = [11.5, 5.5]
  /** East-room floor, and the cell over it — `EAST_CELL`'s centre by the same rule. */
  const [EAST_X, EAST_Y] = [12.5, 5.5]

  it('refuses the gap, and the brush cannot open it: the map authors no floor there', () => {
    const table = wired()
    const id = scouted(table)
    expect(table.run(P1, 'tokens', 'move', { id, x: GAP_X, y: GAP_Y })).toMatchObject({
      message: expect.stringContaining('cannot be occupied'),
    })
    expect(table.vision.visionOf(SCENE)!.openGround!(GAP_X, GAP_Y)).toBe(false)

    // The stroke is accepted and the cell is written — the gap is two cells wide, so both of
    // them are within a cell of a floor and both are wall band (`nearAuthoredFloor`). What the
    // brush cannot do is make the gap *standable*: `openGround` asks the strict floor test, so
    // the two islands of this fixture are still joined by authoring floor between them and
    // never by painting memory across the seam.
    expect(table.run(DM, 'fog', 'region-set', { op: 'reveal', cells: [GAP] })).toBeNull()
    expect(getCell(table.fogOf().region, ...GAP)).toBe(true)
    expect(table.vision.visionOf(SCENE)!.openGround!(GAP_X, GAP_Y)).toBe(false)
    expect(table.run(P1, 'tokens', 'move', { id, x: GAP_X, y: GAP_Y })).toMatchObject({
      message: expect.stringContaining('cannot be occupied'),
    })
  })

  it('opens no unrevealed ground in rooms mode', () => {
    const table = wired()
    const id = scouted(table, 'rooms')
    // Table fix pass §2.2: open ground is known ground in both modes now; by hand, the gap
    // between the rooms is known only once its Outdoors row is revealed.
    expect(table.vision.visionOf(SCENE)!.openGround!(GAP_X, GAP_Y)).toBe(false)
    expect(table.run(P1, 'tokens', 'move', { id, x: GAP_X, y: GAP_Y })).toMatchObject({
      message: expect.stringContaining('cannot be occupied'),
    })
  })

  it('never opens a room: a brush over the east room still refuses its floor', () => {
    // The safety half. Cells and rooms answer different questions, and the room record is
    // the one that decides a room — otherwise a stroke that clipped a boss chamber would
    // hand the party its floor without ever revealing it.
    const table = wired()
    const id = scouted(table)
    expect(table.run(DM, 'fog', 'region-set', { op: 'reveal', cells: [EAST_CELL] })).toBeNull()
    expect(table.vision.visionOf(SCENE)!.openGround!(EAST_X, EAST_Y)).toBe(true)
    expect(table.run(P1, 'tokens', 'move', { id, x: EAST_X, y: EAST_Y })).toMatchObject({
      message: expect.stringContaining('cannot be occupied'),
    })
  })

  it('leaves sight exactly where it was — ground is memory, not eyes', () => {
    const table = wired()
    scouted(table)
    const before = table.vision.visionOf(SCENE)!.canSee!(GAP_X, GAP_Y)
    table.run(DM, 'fog', 'region-set', { op: 'reveal', cells: [GAP, EAST_CELL] })
    expect(table.vision.visionOf(SCENE)!.canSee!(GAP_X, GAP_Y)).toBe(before)
    expect(table.vision.visionOf(SCENE)!.canSee!(EAST_X, EAST_Y)).toBe(false)
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
    expect(table.run(DM, 'fog', 'region-set', { op: 'reveal', cells: [EAST_CELL, [15, 27]] })).toBeNull()

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

// T10 — Hide fogs a room fully again. Only what is revealed now, or (By sight) recorded or seen
// now, is shown, held and walkable; a hidden token stays hidden throughout.
describe('a room hidden again is fogged fully (T10)', () => {
  const EAST: [number, number] = [12.5, 5.5]
  const lit = { status: 'revealed' as const, wasEverRevealed: true }
  /** The fog rows the player's own slice carries. */
  const slice = (table: ReturnType<typeof wired>) =>
    Object.keys((table.registry.redactModule('fog', { byScene: { [SCENE]: table.fogOf() } }, P1) as FogState).byScene[SCENE].rooms).sort()
  /** The real rooms the player's copy of the map holds. */
  const held = (table: ReturnType<typeof wired>) =>
    ((table.vision.playerMap(SCENE)!.layers.find((l) => l.type === 'dungeon') as DungeonLayer).rooms ?? [])
      .filter((room) => !room.standIn)
      .map((room) => room.id)
      .sort()
  /** Whether the party may stand on the east room's floor (§2.2 known ground). */
  const eastKnown = (table: ReturnType<typeof wired>) => table.vision.visionOf(SCENE, P1)!.openGround!(...EAST)

  it('by hand: Hide takes the room off the screen, the map and the walk', () => {
    const table = wired()
    const id = scouted(table, 'rooms')
    table.run(DM, 'fog', 'reveal', { roomId: 'west' })
    table.run(DM, 'fog', 'reveal', { roomId: 'east' })
    table.run(DM, 'doors', 'toggle', { id: 'door-mid' })
    expect([slice(table), held(table), eastKnown(table)]).toEqual([['east', 'west'], ['east', 'west'], true])

    expect(table.run(DM, 'fog', 'hide', { roomId: 'east' })).toBeNull()
    expect(table.fogOf().rooms.east).toEqual({ status: 're_hidden', wasEverRevealed: true })
    expect([slice(table), held(table), eastKnown(table)]).toEqual([['west'], ['west'], false])
    expect(table.vision.visibleOf(SCENE)).toEqual(['west'])
    expect(JSON.stringify(table.run(P1, 'tokens', 'move', { id, x: EAST[0], y: EAST[1] }))).toContain('room-unexplored')

    // Revealed again, it is all back: the room and its ground.
    table.run(DM, 'fog', 'reveal', { roomId: 'east' })
    expect([slice(table), held(table)]).toEqual([['east', 'west'], ['east', 'west']])
    // (This fixture's floors stand two cells apart, so the step is still refused, as unreached.)
    expect(eastKnown(table)).toBe(true)
    expect(JSON.stringify(table.run(P1, 'tokens', 'move', { id, x: EAST[0], y: EAST[1] }))).not.toContain('room-unexplored')
  })

  it('by hand: Hide all fogs every room, and Reveal all shows them again', () => {
    const table = wired()
    scouted(table, 'rooms')
    table.run(DM, 'fog', 'set-bulk', { rooms: { west: lit, east: lit } })
    const hidden = { status: 're_hidden' as const, wasEverRevealed: true }
    expect(table.run(DM, 'fog', 'set-bulk', { rooms: { west: hidden, east: hidden }, forget: true })).toBeNull()
    expect([slice(table), held(table), table.vision.visibleOf(SCENE)]).toEqual([[], [], []])
    table.run(DM, 'fog', 'set-bulk', { rooms: { west: lit, east: lit } })
    expect([slice(table), held(table)]).toEqual([['east', 'west'], ['east', 'west']])
  })

  it('by hand: conceal behind doors fogs a revealed room the party cannot reach', () => {
    const table = wired()
    scouted(table, 'rooms')
    table.run(DM, 'fog', 'set-bulk', { rooms: { west: lit, east: lit } })
    // East is revealed but out of the party's reach, so it is fogged (no explored tier).
    expect(table.vision.visibleOf(SCENE)).toEqual(['west'])
    table.run(DM, 'fog', 'set-conceal', { concealBehindDoors: false })
    expect([...table.vision.visibleOf(SCENE)!].sort()).toEqual(['east', 'west'])
  })

  it('keeps a hidden token hidden in both modes', () => {
    for (const mode of ['rooms', 'vision'] as const) {
      const table = wired()
      scouted(table, mode)
      table.run(DM, 'fog', 'set-bulk', { rooms: { west: lit, east: lit } })
      table.run(DM, 'fog', 'set-conceal', { concealBehindDoors: false })
      table.run(DM, 'doors', 'toggle', { id: 'door-mid' })
      table.run(DM, 'tokens', 'place', { name: 'Ogre', x: EAST[0], y: EAST[1] })
      const ogre = Object.values(table.tokensOf()).find((t) => t.name === 'Ogre')!.id
      expect(table.tokensFor(P1), mode).toContain(ogre)
      table.run(DM, 'tokens', 'hide', { id: ogre })
      expect(table.tokensFor(P1), mode).not.toContain(ogre)
      table.run(DM, 'fog', 'hide', { roomId: 'east' })
      expect(table.tokensFor(P1), mode).not.toContain(ogre)
    }
  })
})

describe('explore locks (§5)', () => {

  it('still lets the DM reveal a locked room by hand', () => {
    const table = wired([EAST_LOCK])
    const id = scouted(table)
    table.run(DM, 'tokens', 'move', { id, x: 5.5, y: 5.5 })
    expect(table.run(DM, 'fog', 'reveal', { roomId: 'east' })).toBeNull()
    expect(table.fogOf().rooms.east).toMatchObject({ status: 'revealed' })
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
   * Short sight is a darkvision ring in an unlit room — by daylight the scout would see to
   * every wall of it.
   */
  function sameRoom(table: ReturnType<typeof wired>, mode: 'rooms' | 'vision') {
    table.run(DM, 'fog', 'set-mode', { mode })
    inTheDark(table)
    table.run(DM, 'tokens', 'place', { name: 'Scout', x: 5.5, y: 5.5, sight: DARKVISION(3) })
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
  table.run(DM, 'triggers', 'set-darkness', { value: 1 })
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
    table.run(DM, 'triggers', 'set-darkness', { value: 0 })
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(true)
    expect(table.vision.visionOf(SCENE)!.canSee!(12.5, 5.5)).toBe(false) // the wall, still
    expect(table.tokensOf()[id].x).toBe(5.5) // and nothing moved to earn it
  })

  it('reads dusk as daylight — the difference between the two is presentation', () => {
    const table = wired()
    nightWatch(table)
    table.run(DM, 'triggers', 'set-darkness', { value: 0.5 })
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
    table.run(DM, 'triggers', 'set-darkness', { value: 0 })
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(true)
  })

  it('follows a trigger’s relight without anything else happening at the table', () => {
    const LAMP_PREP: ScenePrep = {
      version: 2,
      notes: [],
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

  it('sees further when the DM enlarges a light’s radius with a live edit', () => {
    // 4 cells from the lamp: outside a radius of 3, inside a radius of 6.
    const table = wired([light('west-lamp', 5.5, 5.5, 3)])
    nightWatch(table)
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(false)

    expect(
      table.run(DM, 'triggers', 'set-light', { lightId: 'west-lamp', patch: { radius: 6 } }),
    ).toBeNull()
    // No token moved and no door swung — the sweep re-derives off the edit alone, and the
    // cached `SceneMap` still authors the lamp at radius 3 (`sceneMapOf` is never invalidated).
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(true)
  })

  it('sees nothing from a light the DM has turned off with a live edit', () => {
    const table = wired([light('west-lamp', 9.5, 5.5, 6)])
    nightWatch(table)
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(true)

    expect(
      table.run(DM, 'triggers', 'set-light', { lightId: 'west-lamp', patch: { visible: false } }),
    ).toBeNull()
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(false)
  })

  it('lights a different spot when the DM moves a light with a live edit', () => {
    const table = wired([light('west-lamp', 5.5, 5.5, 3)])
    nightWatch(table)
    // Under the lamp's authored position — the scout's own feet — and dark 4 cells over.
    expect(table.vision.visionOf(SCENE)!.canSee!(5.5, 5.5)).toBe(true)
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(false)

    expect(
      table.run(DM, 'triggers', 'set-light', {
        lightId: 'west-lamp',
        patch: { position: { x: 9.5, y: 5.5 } },
      }),
    ).toBeNull()
    // The pool moved with it: dark where the lamp used to stand, lit where it stands now.
    expect(table.vision.visionOf(SCENE)!.canSee!(5.5, 5.5)).toBe(false)
    expect(table.vision.visionOf(SCENE)!.canSee!(9.5, 5.5)).toBe(true)
  })
})

describe('auto-explore and redaction in the dark (S3 P3 §3.2, §3.1)', () => {

  it('leaves a locked zone locked however brightly it is lit', () => {
    const table = wired([EAST_LOCK, light('east-lamp', 12.5, 5.5, 6)])
    const id = nightWatch(table)
    // Uncontained, for the reason the §5 row above says: the classic rule lets the party
    // *see* into a lit, locked vault and refuses to write it down. R4 pins the other path.
    table.run(DM, 'fog', 'set-containment', { containedSight: false })
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

    expect(table.run(DM, 'triggers', 'set-darkness', { value: 0 })).toBeNull()
    expect(table.tokensFor(P1)).toEqual([ambusher, scout].sort())
    expect(table.tokensOf()[ambusher]).toMatchObject({ x: 8.5, y: 5.5 })

    // …and back into the dark, which takes it away again (D4c).
    expect(table.run(DM, 'triggers', 'set-darkness', { value: 1 })).toBeNull()
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

/** Every frame a seat was sent, as one string — the byte search the wire rows do. */
const said = (msgs: readonly OutboundMessage[]): string =>
  msgs.map((m) => JSON.stringify(m)).join('')

describe('individual vision (S3 P5)', () => {
  /** p-1's scout, west; p-2's guard, further into the same hall. Neither sees the other. */
  const SCOUT = { x: 2.5, y: 5.5 }
  const GUARD = { x: 8.5, y: 8.5 }
  /** Where those two stand, in the region record's own cells (the frame starts at -2, -22). */
  const SCOUT_CELL: [number, number] = [4, 27]
  const GUARD_CELL: [number, number] = [10, 30]
  /** In the dark (`twoSeats`), so three cells is all either eye reaches. */
  const SHORT = DARKVISION(3)

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
    inTheDark(table)
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

  /** An unclaimed familiar deep in the far hall, behind the shut door — eyes for the dark. */
  function hawk(table: ReturnType<typeof wired>): string {
    table.run(DM, 'tokens', 'place', { name: 'Hawk', x: 17.5, y: 5.5, sight: DARKVISION(6) })
    return idOf(table, 'Hawk')
  }

  describe('the record each seat accrues', () => {

    it('leaves the party record as the seed rather than as the running total', () => {
      const { table } = twoSeats()
      expect(getCell(table.fogOf().region, ...SCOUT_CELL)).toBe(false)
      expect(getCell(table.fogOf().region, ...GUARD_CELL)).toBe(false)
    })

  })

  describe('what reaches each seat', () => {

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

})

// ── The join deadlock ───────────────────────────────────────────────────────

// ── Contained sight ─────────────────────────────────────────────────────────
// The house rule, and default on (`containedSightOn`): live sight is fenced by the ground the
// table has already opened — the DM's cell record plus the rooms they revealed — and the only
// thing that pushes the fence outward is a token's own `sight.range`. Walking peels the cloud
// back; what a step earns is written to the record, so the fence only ever grows.
//
//   seen_i = inSweep_i ∧ (held ∨ (dist_i ≤ range_i ∧ ¬lock)), then the light gate, unchanged
//
// "Containment off is exactly today" is not one row here — it is the *rest of this file*. No
// fixture above sets the field, so every row in it now runs on the contained path; the four
// that pin behaviour containment legitimately changes say `containedSight: false` at their own
// call sites, with the reason written there, and the rows below pin the other half.
describe('contained sight (the fence live sight plays inside)', () => {
  const containment = (table: ReturnType<typeof wired>, containedSight: boolean) =>
    expect(table.run(DM, 'fog', 'set-containment', { containedSight })).toBeNull()

  /** A claimed eye of a given reach, in a vision-mode scene the DM has left in daylight. */
  function watcher(
    table: ReturnType<typeof wired>,
    at: { x: number; y: number },
    range: number,
    name = 'Scout',
  ): string {
    table.run(DM, 'fog', 'set-mode', { mode: 'vision' })
    table.run(DM, 'tokens', 'place', {
      name,
      ...at,
      sight: { range, angle: 360, visionMode: 'normal' },
    })
    const id = Object.entries(table.tokensOf()).find(([, t]) => t.name === name)![0]
    expect(table.run(P1, 'tokens', 'claim', { id })).toBeNull()
    return id
  }

  const sight = (table: ReturnType<typeof wired>) => (x: number, y: number) =>
    table.vision.visionOf(SCENE)!.canSee!(x, y)

  it('R3 — is per eye: one eye’s range never opens ground another eye is walled off from', () => {
    const table = wired()
    // A far-sighted scout in the near corner of the west hall, and a guard across the wall
    // from the far one. The corner is in the scout's line of sight and out of its range; it
    // is inside the guard's range and behind a wall from it. A union of discs over a union of
    // sweeps would hand it over; the per-eye composition does not.
    watcher(table, { x: 1.5, y: 1.5 }, 8)
    const guard = watcher(table, { x: 12.5, y: 9.5 }, 4, 'Guard')
    expect(table.tokensOf()[guard]).toMatchObject({ x: 12.5, y: 9.5 })
    const see = sight(table)

    expect(see(9.5, 9.5)).toBe(false)
    containment(table, false)
    expect(see(9.5, 9.5)).toBe(true)
  })

  it('R4 — a lock beats the range term, so its mouth cannot be peeled by standing in it', () => {
    const table = wired([EAST_LOCK])
    watcher(table, { x: 9.5, y: 5.5 }, 8)
    expect(table.run(DM, 'doors', 'toggle', { id: 'door-mid' })).toBeNull()
    const see = sight(table)

    // Three cells away, lit, through an open door — and neither live nor written.
    expect(see(12.5, 5.5)).toBe(false)
    expect(getCell(table.fogOf().region, ...EAST_CELL)).toBe(false)
    expect(table.fogOf().rooms.east).toBeUndefined()

    // Off, §5 is what it always was: the lock stops the record and never the sight.
    containment(table, false)
    expect(see(12.5, 5.5)).toBe(true)
  })

  it('R5 — composes with the light gate: held ground in the dark is still dark', () => {
    const table = wired([light('west-lamp', 5.5, 5.5, 3)])
    const id = nightWatch(table)
    expect(table.run(DM, 'fog', 'reveal', { roomId: 'west' })).toBeNull()
    const see = sight(table)

    // Held (the DM revealed the hall) and lit: the eye sees its own pool.
    expect(see(5.5, 5.5)).toBe(true)
    // Held, four cells out, inside the eye's range — and beyond the lamp, so unlit and unseen.
    // The gate runs after the composition, not instead of it.
    expect(see(9.5, 5.5)).toBe(false)
    expect(table.run(DM, 'triggers', 'set-darkness', { value: 0 })).toBeNull()
    expect(see(9.5, 5.5)).toBe(true)
    expect(table.tokensOf()[id]).toMatchObject({ x: 5.5, y: 5.5 })
  })

})
