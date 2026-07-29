// §2.3.1–2 — the geometry half of the fog: what a player's copy of the map contains, what
// a reveal hands over, and what the visibility cache answers underneath both.
//
// The wire-level pins (map GET, snapshots, broadcasts, retraction) live in
// integration.test.ts, against a running server; these are the rules themselves.

import { describe, expect, it } from 'vitest'
import { fogModule, type FogState, type SceneFog } from '@dnd/mechanics/fog'
import { doorsModule, type DoorsState } from '@dnd/mechanics/doors'
import type { Viewer } from '@dnd/mechanics/contract'
import type { Token, TokensState } from '@dnd/mechanics/tokens'
import type { AnyChild, DoorChild, Room, WallSegment } from '@dnd/core/src/shared/types'
import type { ServerMessage } from '@dnd/core/src/shared/protocol'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores, type Stores } from '../db/stores'
import { ModuleRegistry } from '../modules/registry'
import { buildRedactor, type OutboundMessage } from '../ws/Broadcaster'
import { mapDeltaFor, redactMapForViewer } from './redactMap'
import { createSceneMaps } from './sceneMap'
import { createVision } from './vision'

// ── A four-room crypt ───────────────────────────────────────────────────────
// hall ──[open]── corr ──[shut]── inner ══[secret]══ vault
// `hall` is lit, `inner` was seen and re-hidden, `corr` and `vault` never were, and there
// is a prop stranded on unzoned map past x=100.

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]

const room = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id,
  name: `${id} of secrets`,
  boundary: rect(x0, y0, x1, y1),
  centroid: [(x0 + x1) / 2, (y0 + y1) / 2],
  area: (x1 - x0) * (y1 - y0),
  isPathway: id === 'corr',
})

const ROOMS = [
  room('hall', 0, 0, 10, 10),
  room('corr', 10, 4, 14, 6),
  room('inner', 14, 0, 24, 10),
  room('vault', 30, 0, 40, 10),
]

const floor = (id: string, x0: number, y0: number, x1: number, y1: number): AnyChild =>
  ({
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [rect(x0, y0, x1, y1)],
    roughnessEnabled: false,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#fff',
  }) as AnyChild

const prop = (id: string, x: number, y: number): AnyChild =>
  ({
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'a1',
    position: { x, y },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#fff',
    flipX: false,
    flipY: false,
  }) as AnyChild

const door = (id: string, x: number, y: number, roomA: string, roomB: string, isSecret = false): DoorChild =>
  ({
    id,
    name: id,
    childType: 'door',
    visible: true,
    wallId: `w-${id}`,
    position: [x, y],
    angle: 0,
    width: 1,
    style: 'single',
    state: id === 'door-hall-corr' ? 'open' : 'closed',
    isSecret,
    roomA,
    roomB,
  }) as DoorChild

const wall = (id: string, x0: number, y0: number, x1: number, y1: number): WallSegment => ({
  id,
  points: [
    [x0, y0],
    [x1, y1],
  ],
  wallType: 'normal',
  direction: 'both',
  color: '#000',
  width: 0.5,
  roughness: 0,
})

const DOORS = [
  door('door-hall-corr', 10, 5, 'hall', 'corr'),
  door('door-corr-inner', 14, 5, 'corr', 'inner'),
  door('door-secret', 24, 5, 'inner', 'vault', true),
]

function mapFile(): SerializedMapData {
  const layer: DungeonLayer = {
    id: 'layer-1',
    name: 'Crypt',
    type: 'dungeon',
    visible: true,
    locked: false,
    opacity: 1,
    children: [
      floor('floor-hall', 0, 0, 10, 10),
      floor('floor-inner', 14, 0, 24, 10),
      floor('floor-vault', 30, 0, 40, 10),
      prop('prop-inner', 19, 5),
      prop('prop-vault', 35, 5),
      prop('prop-stranded', 100, 100),
      ...DOORS,
    ],
    standaloneWalls: [wall('wall-hall', 0, 0, 10, 0), wall('wall-vault', 30, 0, 40, 0)],
    mergedFloor: [rect(0, 0, 40, 10)],
    style: {} as DungeonLayer['style'],
    sublayerVisibility: { floor: true, grid: true, hatching: true, walls: true },
    rooms: ROOMS,
    roomNameOverrides: Object.fromEntries(ROOMS.map((r) => [r.id, r.name])),
  }
  return {
    version: '3.0',
    mapSettings: { name: 'Crypt' } as SerializedMapData['mapSettings'],
    grid: { visible: true, snapDivision: 1, style: 'clean' } as SerializedMapData['grid'],
    layers: [layer],
    customImages: {},
  }
}

const SCENE = 'scene-1'

/** hall lit, inner seen then re-hidden, corr and vault never entered. */
const fog = (over: Partial<SceneFog> = {}): SceneFog => ({
  rooms: {
    hall: { status: 'revealed', wasEverRevealed: true },
    inner: { status: 're_hidden', wasEverRevealed: true },
  },
  concealBehindDoors: true,
  ...over,
})

function table(): { stores: Stores; campaignId: string; vision: ReturnType<typeof createVision> } {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Crypt')
  stores.maps.insert(SCENE, campaign.id, 'Crypt', JSON.stringify(mapFile()))
  return { stores, campaignId: campaign.id, vision: createVision(stores) }
}

const sceneMap = () => createSceneMaps(table().stores)(SCENE)!

// ── redactMapForViewer ──────────────────────────────────────────────────────

describe('redactMapForViewer (§2.3.1, D4)', () => {
  const redacted = () => redactMapForViewer(sceneMap(), fog(), {})
  const layerOf = (map: SerializedMapData) => map.layers[0] as DungeonLayer

  it('carries no trace of a room nobody has entered', () => {
    const wire = JSON.stringify(redacted())
    for (const gone of ['vault', 'floor-vault', 'prop-vault', 'wall-vault', 'door-secret']) {
      expect(wire, `${gone} survived redaction`).not.toContain(gone)
    }
  })

  it('keeps the geometry of a room that was seen and re-hidden (D4)', () => {
    const layer = layerOf(redacted())
    expect(layer.rooms?.map((r) => r.id).sort()).toEqual(['hall', 'inner'])
    expect(layer.children.map((c) => c.id)).toContain('floor-inner')
    expect(layer.children.map((c) => c.id)).toContain('prop-inner')
  })

  it('drops props on unzoned map, which no command can reveal (D6)', () => {
    expect(layerOf(redacted()).children.map((c) => c.id)).not.toContain('prop-stranded')
  })

  it('keeps a wall an explored room borders and drops the rest', () => {
    expect(layerOf(redacted()).standaloneWalls.map((w) => w.id)).toEqual(['wall-hall'])
  })

  it('drops the merged floor, which is one union across every room', () => {
    expect(layerOf(redacted()).mergedFloor).toBeNull()
  })

  it('names only the rooms the player has been in', () => {
    expect(Object.keys(layerOf(redacted()).roomNameOverrides ?? {}).sort()).toEqual(['hall', 'inner'])
  })

  it('keeps a door into the unknown but not the id of what is behind it', () => {
    const doors = layerOf(redacted()).children.filter((c): c is DoorChild => c.childType === 'door')
    expect(doors.map((d) => d.id)).toEqual(['door-hall-corr', 'door-corr-inner'])
    expect(doors[0]).toMatchObject({ roomA: 'hall', roomB: null })
    expect(doors[1]).toMatchObject({ roomA: null, roomB: 'inner' })
    // …nor its name, which on a real map is the room's own ("Reliquary Door" in the wall of
    // the only room a party has entered). The client labels an unnamed door `Door N`.
    expect(doors.map((d) => d.name)).toEqual(['', ''])
  })

  it('shows a secret door once the DM reveals it', () => {
    const seen = redactMapForViewer(sceneMap(), fog({ rooms: { ...fog().rooms, vault: { status: 'revealed', wasEverRevealed: true } } }), {
      'door-secret': { open: false, locked: false, revealed: true },
    })
    const ids = (seen.layers[0] as DungeonLayer).children.map((c) => c.id)
    expect(ids).toContain('door-secret')
    expect(ids).toContain('floor-vault')
  })

  it('leaves a layer nobody zoned exactly as it was', () => {
    const plain = mapFile()
    const layer = plain.layers[0] as DungeonLayer
    delete layer.rooms
    const stores = createStores(openDb(':memory:'))
    const campaign = stores.campaigns.create('Flat')
    stores.maps.insert('flat', campaign.id, 'Flat', JSON.stringify(plain))
    expect(createVision(stores).playerMap('flat')).toEqual(plain)
  })
})

// ── mapDeltaFor ─────────────────────────────────────────────────────────────

describe('mapDeltaFor (D5)', () => {
  it('carries the named rooms and nothing around them', () => {
    const delta = mapDeltaFor(sceneMap(), SCENE, ['vault'], {})
    expect(delta.sceneId).toBe(SCENE)
    expect(delta.layers).toHaveLength(1)
    expect(delta.layers[0].id).toBe('layer-1')
    expect(delta.layers[0].rooms.map((r) => r.id)).toEqual(['vault'])
    expect(delta.layers[0].children.map((c) => c.id)).toEqual(['floor-vault', 'prop-vault'])
    expect(delta.layers[0].standaloneWalls.map((w) => w.id)).toEqual(['wall-vault'])
  })

  it('still withholds an unrevealed secret door on the room it opens onto', () => {
    expect(JSON.stringify(mapDeltaFor(sceneMap(), SCENE, ['vault'], {}))).not.toContain('door-secret')
  })
})

// ── vision ──────────────────────────────────────────────────────────────────

describe('vision (D3/D8)', () => {
  const party = (roomX: number): TokensState => ({
    library: {},
    byScene: {
      [SCENE]: {
        pc: { id: 'pc', x: roomX, y: 5, ownerId: 'p-1', hidden: false } as Token,
      },
    },
  })

  function set(stores: Stores, campaignId: string, module: string, state: unknown): void {
    stores.moduleState.put(campaignId, module, state)
  }

  it('backs the fog and doors modules with the map file', () => {
    const { vision, campaignId } = table()
    expect(vision.roomsOf(campaignId, SCENE)).toEqual(['hall', 'corr', 'inner', 'vault'])
    expect(vision.doorsOf(campaignId, SCENE).map((d) => d.id)).toEqual(DOORS.map((d) => d.id))
  })

  it('sees a revealed room the party can walk to, and not one behind a shut door', () => {
    const { vision, stores, campaignId } = table()
    set(stores, campaignId, 'tokens', party(5))
    set(stores, campaignId, 'fog', {
      byScene: { [SCENE]: fog({ rooms: { hall: { status: 'revealed', wasEverRevealed: true }, corr: { status: 'revealed', wasEverRevealed: true }, inner: { status: 'revealed', wasEverRevealed: true } } }) },
    } satisfies FogState)
    // hall→corr is open; corr→inner is shut, so `inner` is revealed but out of sight.
    expect([...vision.visionOf(SCENE)!.visible].sort()).toEqual(['corr', 'hall'])
  })

  it('opens the shut door and the room behind it comes into view', () => {
    const { vision, stores, campaignId } = table()
    set(stores, campaignId, 'tokens', party(5))
    set(stores, campaignId, 'fog', {
      byScene: { [SCENE]: fog({ rooms: { hall: { status: 'revealed', wasEverRevealed: true }, corr: { status: 'revealed', wasEverRevealed: true }, inner: { status: 'revealed', wasEverRevealed: true } } }) },
    } satisfies FogState)
    set(stores, campaignId, 'doors', {
      byScene: { [SCENE]: { 'door-corr-inner': { open: true, locked: false, revealed: true } } },
    } satisfies DoorsState)
    expect([...vision.visionOf(SCENE)!.visible].sort()).toEqual(['corr', 'hall', 'inner'])
  })

  it('lets a player stand in a re-hidden room they can reach, but never in the unseen (D8)', () => {
    const { vision, stores, campaignId } = table()
    set(stores, campaignId, 'tokens', party(5))
    set(stores, campaignId, 'fog', { byScene: { [SCENE]: fog() } } satisfies FogState)
    const scene = vision.visionOf(SCENE)!
    expect(scene.occupiable.has('hall')).toBe(true)
    // `inner` is re-hidden: dark, still somewhere to walk (D7) once the door is open…
    expect(scene.visible.has('inner')).toBe(false)
    expect(scene.roomAt(19, 5)).toBe('inner')
    expect(scene.occupiable.has('vault')).toBe(false)
    expect(scene.roomAt(100, 100)).toBeNull()
  })

  it('does not conceal from a table with no claimed token on the map', () => {
    const { vision, stores, campaignId } = table()
    set(stores, campaignId, 'fog', {
      byScene: { [SCENE]: fog({ rooms: { vault: { status: 'revealed', wasEverRevealed: true } } }) },
    } satisfies FogState)
    // Nothing to be shut behind a door *from*, so a reveal reaches the table.
    expect([...vision.visionOf(SCENE)!.visible]).toEqual(['vault'])
  })

  it('answers nothing for a map nobody zoned', () => {
    const plain = mapFile()
    delete (plain.layers[0] as DungeonLayer).rooms
    const stores = createStores(openDb(':memory:'))
    const campaign = stores.campaigns.create('Flat')
    stores.maps.insert('flat', campaign.id, 'Flat', JSON.stringify(plain))
    expect(createVision(stores).visionOf('flat')).toBeNull()
  })

  it('recomputes only when module state is written', () => {
    const { vision, stores, campaignId } = table()
    // The BFS result itself, not the wrapper around it: the same Set means it did not run.
    const first = vision.visionOf(SCENE)!.visible
    expect(vision.visionOf(SCENE)!.visible).toBe(first)
    set(stores, campaignId, 'fog', { byScene: { [SCENE]: fog() } } satisfies FogState)
    expect(vision.visionOf(SCENE)!.visible).not.toBe(first)
  })

  it('hands over everything explored on a cold cache, then only what a reveal adds', () => {
    const { vision, stores, campaignId } = table()
    set(stores, campaignId, 'fog', { byScene: { [SCENE]: fog() } } satisfies FogState)
    // Nothing computed yet, so the answer is the whole explored set — never nothing.
    expect(vision.revealDelta(SCENE)?.layers[0].rooms.map((r) => r.id).sort()).toEqual([
      'hall',
      'inner',
    ])

    set(stores, campaignId, 'fog', {
      byScene: { [SCENE]: fog({ rooms: { ...fog().rooms, vault: { status: 'revealed', wasEverRevealed: true } } }) },
    } satisfies FogState)
    expect(vision.revealDelta(SCENE)?.layers[0].rooms.map((r) => r.id)).toEqual(['vault'])
    // Same mutation, every viewer: the delta is the cache's, not the caller's.
    expect(vision.revealDelta(SCENE)?.layers[0].rooms.map((r) => r.id)).toEqual(['vault'])

    // Re-hiding hands nothing over — the geometry is already theirs (D4).
    set(stores, campaignId, 'fog', {
      byScene: { [SCENE]: fog({ rooms: { ...fog().rooms, vault: { status: 're_hidden', wasEverRevealed: true } } }) },
    } satisfies FogState)
    expect(vision.revealDelta(SCENE)).toBeNull()
  })
})

// ── the default room (amendment 2026-07-28) ─────────────────────────────────
// A player-facing scene always has one room in it. `hall`, `inner` and `vault` are all
// area 100 and none is a pathway, so the tie-break picks `hall` — and picking it is a
// read-time rule, so nothing below ever writes a fog record.

describe('the default room, on the server (amendment 2026-07-28)', () => {
  const roomsOfMap = (map: SerializedMapData | null) =>
    (map?.layers[0] as DungeonLayer).rooms?.map((r) => r.id).sort()

  it('gives a fresh scene its largest non-pathway room and nothing else', () => {
    const { vision, stores, campaignId } = table()
    expect([...vision.visionOf(SCENE)!.visible]).toEqual(['hall'])
    expect(roomsOfMap(vision.playerMap(SCENE))).toEqual(['hall'])
    // Read-time, not a seed: the module's own state is still untouched.
    expect(stores.moduleState.get(campaignId, 'fog')).toBeUndefined()
  })

  it('lets a player stand in it, so a fresh table is not a fenced-off map (D8)', () => {
    const { vision } = table()
    expect(vision.visionOf(SCENE)!.occupiable.has('hall')).toBe(true)
    expect(vision.visionOf(SCENE)!.occupiable.has('vault')).toBe(false)
  })

  it('gives it up the moment the DM reveals a real room, and retracts its geometry', () => {
    const { vision, stores, campaignId } = table()
    stores.moduleState.put(campaignId, 'fog', seen('inner'))
    expect([...vision.visionOf(SCENE)!.visible]).toEqual(['inner'])
    expect(roomsOfMap(vision.playerMap(SCENE))).toEqual(['inner'])
    expect(JSON.stringify(vision.playerMap(SCENE))).not.toContain('floor-hall')
  })

  it('falls back again when a Hide All leaves nothing revealed', () => {
    const { vision, stores, campaignId } = table()
    // What `set-bulk` writes for D9's Hide All: everything seen, nothing lit.
    stores.moduleState.put(campaignId, 'fog', {
      byScene: {
        [SCENE]: {
          concealBehindDoors: true,
          rooms: {
            hall: { status: 're_hidden', wasEverRevealed: true },
            inner: { status: 're_hidden', wasEverRevealed: true },
          },
        },
      },
    } satisfies FogState)
    expect([...vision.visionOf(SCENE)!.visible]).toEqual(['hall'])
    // …and the room they explored keeps its geometry either way (D4).
    expect(roomsOfMap(vision.playerMap(SCENE))).toEqual(['hall', 'inner'])
  })

  it('hands a map nobody zoned over whole, doors and all', () => {
    const plain = mapFile()
    delete (plain.layers[0] as DungeonLayer).rooms
    const stores = createStores(openDb(':memory:'))
    const campaign = stores.campaigns.create('Flat')
    stores.maps.insert('flat', campaign.id, 'Flat', JSON.stringify(plain))
    const vision = createVision(stores)
    // No rooms to bind a door to, so the explored-rooms cut would take every one of them.
    expect([...vision.playerDoors('flat')].sort()).toEqual(DOORS.map((d) => d.id).sort())
    expect(vision.playerMap('flat')).toEqual(plain)
  })
})

// ── the doors a player is told about ────────────────────────────────────────

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const P1: Viewer = { role: 'player', identityId: 'p-1' }

const seen = (...rooms: string[]): FogState => ({
  byScene: {
    [SCENE]: {
      concealBehindDoors: true,
      rooms: Object.fromEntries(
        rooms.map((id) => [id, { status: 'revealed' as const, wasEverRevealed: true }]),
      ),
    },
  },
})

describe('vision.playerDoors (D4)', () => {
  it('is the default room’s doors before the party has explored anything, and empty for a scene with no map', () => {
    const { vision } = table()
    // `hall` is the fallback (amendment 2026-07-28), so the door out of it is the one door
    // a player holds at join — never none at all.
    expect([...vision.playerDoors(SCENE)]).toEqual(['door-hall-corr'])
    expect([...vision.playerDoors('no-such-scene')]).toEqual([])
  })

  it('names the doors of the explored rooms and nothing past them', () => {
    const { vision, stores, campaignId } = table()
    stores.moduleState.put(campaignId, 'fog', seen('hall'))
    expect([...vision.playerDoors(SCENE)]).toEqual(['door-hall-corr'])
  })

  it('answers the same cut redactMapForViewer makes on the door children', () => {
    const { vision, stores, campaignId } = table()
    stores.moduleState.put(campaignId, 'fog', { byScene: { [SCENE]: fog() } } satisfies FogState)
    const onTheMap = (redactMapForViewer(sceneMap(), fog(), {}).layers[0] as DungeonLayer).children
      .filter((child) => child.childType === 'door')
      .map((child) => child.id)
    // One set, not two. An unrevealed secret door is in neither: the live slice would have
    // been stripped by the doors module anyway, but a set that names a door the player's map
    // does not have is a set the geometry delta cannot be derived from (D2).
    expect([...vision.playerDoors(SCENE)].sort()).toEqual(onTheMap.sort())
    expect(onTheMap).toEqual(['door-corr-inner', 'door-hall-corr'])
  })

  it('admits a secret door once the DM reveals it, and hands over its geometry (D2)', () => {
    const { vision, stores, campaignId } = table()
    stores.moduleState.put(campaignId, 'fog', { byScene: { [SCENE]: fog() } } satisfies FogState)
    expect([...vision.playerDoors(SCENE)]).not.toContain('door-secret')
    // The map the player holds is the other half of the same answer.
    expect(JSON.stringify(vision.playerMap(SCENE))).not.toContain('door-secret')

    stores.moduleState.put(campaignId, 'doors', {
      byScene: { [SCENE]: { 'door-secret': { open: false, locked: false, revealed: true } } },
    })
    expect([...vision.playerDoors(SCENE)]).toContain('door-secret')
    expect(JSON.stringify(vision.playerMap(SCENE))).toContain('door-secret')

    // …and the door child rides a delta, so a player already at the table gets it without
    // reloading — cut the same way the map is: the explored side keeps its binding, the
    // side nobody has been to is `null`, because a room id is a coordinate (D4).
    const delta = vision.revealDelta(SCENE)
    const doors = (delta?.layers ?? []).flatMap((layer) => layer.children)
    expect(doors.map((child) => child.id)).toEqual(['door-secret'])
    expect(doors[0]).toMatchObject({ roomA: 'inner', roomB: null })
  })
})

describe('the doors slice on the wire (D4/D4c)', () => {
  function wired() {
    const { stores, campaignId, vision } = table()
    const registry = new ModuleRegistry(stores.moduleState)
    registry.register(fogModule(vision.roomsOf))
    registry.register(doorsModule(vision.doorsOf, vision.playerDoors))
    const sent: ServerMessage[] = []
    return {
      sent,
      run: (module: string, action: string, payload: unknown) =>
        registry.dispatch(module, action, payload, {
          campaignId,
          sessionId: 's-1',
          activeSceneId: SCENE,
          sender: DM,
          players: [],
          broadcast: (msg) => {
            sent.push(msg)
          },
        }),
      // The join/reconnect path (§2.3.4), which is where a reload gets its doors from.
      doorsFor: (viewer: Viewer) =>
        Object.keys(
          (registry.snapshotModules(campaignId, viewer).doors as DoorsState).byScene[SCENE] ?? {},
        ).sort(),
    }
  }

  it('re-sends the doors slice when the fog moves', () => {
    const { run, sent } = wired()
    expect(run('fog', 'reveal', { sceneId: SCENE, roomId: 'hall' })).toBeNull()
    // Nothing about the doors *state* changed; what changed is how much of it a player is
    // owed, and without this frame the room they just entered has no door state at all.
    expect(sent.map((msg) => (msg.type === 'state-update' ? msg.module : msg.type))).toEqual([
      'fog',
      'doors',
    ])
  })

  it('hands a player the doors of the rooms they have explored and no others', () => {
    const { run, doorsFor } = wired()
    // One touch anywhere seeds every door in the scene — this is the leak, in one command.
    expect(run('doors', 'toggle', { sceneId: SCENE, id: 'door-corr-inner' })).toBeNull()
    expect(doorsFor(DM)).toEqual(['door-corr-inner', 'door-hall-corr', 'door-secret'])
    // Not none: `hall` is the default room until the DM reveals something (amendment
    // 2026-07-28), so its door is a player's from the first frame.
    expect(doorsFor(P1)).toEqual(['door-hall-corr'])

    run('fog', 'reveal', { sceneId: SCENE, roomId: 'hall' })
    expect(doorsFor(P1)).toEqual(['door-hall-corr'])

    run('fog', 'reveal', { sceneId: SCENE, roomId: 'corr' })
    // The corridor's own door into the dark arrives; the secret one behind it still does not.
    expect(doorsFor(P1)).toEqual(['door-corr-inner', 'door-hall-corr'])
  })
})

// ── which scene a reveal's geometry is keyed off ────────────────────────────

describe('the scene a mapDelta belongs to, with more than one in play (§2.1, D5)', () => {
  const P2: Viewer = { role: 'player', identityId: 'p-2' }
  /** The second scene, named so it sorts — and is written — ahead of `SCENE`. */
  const OTHER = 'scene-0'

  function twoScenes() {
    const stores = createStores(openDb(':memory:'))
    const campaign = stores.campaigns.create('Crypt')
    stores.maps.insert(OTHER, campaign.id, 'Crypt', JSON.stringify(mapFile()))
    stores.maps.insert(SCENE, campaign.id, 'Crypt', JSON.stringify(mapFile()))
    const vision = createVision(stores)
    const registry = new ModuleRegistry(stores.moduleState)
    registry.register(fogModule(vision.roomsOf))
    registry.register(doorsModule(vision.doorsOf, vision.playerDoors))
    const redact = buildRedactor(registry, vision)
    const held = new Map<string, OutboundMessage[]>([P1, P2].map((v) => [v.identityId, []]))
    return {
      stores,
      vision,
      campaignId: campaign.id,
      /** What each viewer was handed, in the order it went out. */
      deltasFor: (viewer: Viewer) =>
        (held.get(viewer.identityId) ?? []).flatMap((msg) =>
          'mapDelta' in msg ? [msg.mapDelta] : [],
        ),
      run: (sceneId: string, action: string, payload: object) =>
        registry.dispatch(
          'fog',
          action,
          { sceneId, ...payload },
          {
            campaignId: campaign.id,
            sessionId: 's-1',
            activeSceneId: SCENE,
            sender: DM,
            players: [],
            // Redacted as each frame goes out, never afterwards: the delta belongs to the
            // mutation that produced the frame, so a capture redacted later is a capture of
            // a different moment.
            broadcast: (msg) => {
              for (const viewer of [P1, P2]) held.get(viewer.identityId)!.push(redact(msg, viewer))
            },
          },
        ),
    }
  }

  const lit = (...ids: string[]) =>
    Object.fromEntries(
      ids.map((id) => [id, { status: 'revealed' as const, wasEverRevealed: true }]),
    )

  it('hands every viewer the delta for the scene the command wrote, and only that one', () => {
    const { stores, campaignId, vision, run, deltasFor } = twoScenes()
    // Both scenes fogged, `scene-0` written into the record first. Nothing has asked the
    // vision about it — which is what a scene the party explored last session looks like on
    // a freshly started server, or after `CACHE_MAX` evicts it — so the first question put
    // to it answers with the whole of its explored geometry.
    stores.moduleState.put(campaignId, 'fog', {
      byScene: { [OTHER]: fog(), [SCENE]: fog() },
    } satisfies FogState)
    // `scene-1` primed, so what it owes below is the room this command opens, not its history.
    expect(vision.revealDelta(SCENE)).not.toBeNull()

    expect(run(SCENE, 'set-bulk', { rooms: lit('hall', 'inner', 'vault') })).toBeNull()

    for (const viewer of [P1, P2]) {
      const deltas = deltasFor(viewer)
      expect(
        deltas.map((d) => d.sceneId),
        `${viewer.identityId} was sent another scene's geometry`,
      ).toEqual([SCENE])
      expect(deltas[0].layers.flatMap((l) => l.rooms.map((r) => r.id))).toEqual(['vault'])
    }

    // …and again with both scenes in the cache, where a walk over the state would have
    // stumbled onto the right answer anyway. Same result, for a reason this time.
    expect(vision.revealDelta(OTHER)).not.toBeNull()
    expect(run(SCENE, 'reveal', { roomId: 'corr' })).toBeNull()
    for (const viewer of [P1, P2]) {
      expect(deltasFor(viewer).map((d) => d.sceneId)).toEqual([SCENE, SCENE])
    }
  })
})
