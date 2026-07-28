// §2.3.1–2 — the geometry half of the fog: what a player's copy of the map contains, what
// a reveal hands over, and what the visibility cache answers underneath both.
//
// The wire-level pins (map GET, snapshots, broadcasts, retraction) live in
// integration.test.ts, against a running server; these are the rules themselves.

import { describe, expect, it } from 'vitest'
import type { FogState, SceneFog } from '@dnd/mechanics/fog'
import type { DoorsState } from '@dnd/mechanics/doors'
import type { Token, TokensState } from '@dnd/mechanics/tokens'
import type { AnyChild, DoorChild, Room, WallSegment } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores, type Stores } from '../db/stores'
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
