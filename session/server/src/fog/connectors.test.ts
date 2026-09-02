// Authored rooms and connectors as the runner plays them (contract rows C1, C3, C4, S1–S4,
// W1–W3, A4).
//
// The whole point of the design is that almost nothing here is new code: a connector joins
// the door graph as a door twin, so the rows below are the *existing* door rows re-run on a
// graph nobody authored a door into. Where a row is a mirror of one that already exists, it
// says which one.

import { describe, expect, it } from 'vitest'
import { blockedEdge, visibleRooms, type SceneFog } from '@dnd/mechanics/fog'
import { seedDoor, type DoorLiveState, type DoorsState } from '@dnd/mechanics/doors'
import type { Token, TokensState } from '@dnd/mechanics/tokens'
import type { FogState } from '@dnd/mechanics/fog'
import type { AnyChild, ConnectorChild, Room, RoomChild } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores, type Stores } from '../db/stores'
import { redactMapForViewer } from './redactMap'
import { createSceneMaps } from './sceneMap'
import { createVision } from './vision'

// ── A two-chamber warren, drawn rather than detected ────────────────────────
//
//   hall  0..10          crypt 12..22        (both 0..10 in y)
//        └── connector blob 9..13 x 4..6 straddling the gap ──┘
//
// The room ids are the RoomChildren's own uuids, which is what makes A4 hold; the blob is
// the only ground between the two chambers, which is what makes S3 matter.

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]

const roomChild = (id: string, x0: number, y0: number, x1: number, y1: number): RoomChild => ({
  id,
  name: `${id} chamber`,
  childType: 'room',
  visible: true,
  contours: [rect(x0, y0, x1, y1)],
})

const room = (child: RoomChild, x0: number, y0: number, x1: number, y1: number): Room => ({
  id: child.id,
  name: child.name,
  boundary: rect(x0, y0, x1, y1),
  centroid: [(x0 + x1) / 2, (y0 + y1) / 2],
  area: (x1 - x0) * (y1 - y0),
  isPathway: false,
})

const HALL = roomChild('hall', 0, 0, 10, 10)
const CRYPT = roomChild('crypt', 12, 0, 22, 10)
const ROOMS = [room(HALL, 0, 0, 10, 10), room(CRYPT, 12, 0, 22, 10)]

const connector = (over: Partial<ConnectorChild> = {}): ConnectorChild => ({
  id: 'joint',
  name: 'the neck',
  childType: 'connector',
  visible: true,
  contours: [rect(9, 4, 13, 6)],
  kind: 'door',
  state: 'closed',
  isSecret: false,
  roomA: 'hall',
  roomB: 'crypt',
  ...over,
})

const SCENE = 'scene-1'

function mapFile(joint: ConnectorChild, extra: readonly AnyChild[] = []): SerializedMapData {
  const layer: DungeonLayer = {
    id: 'layer-1',
    name: 'Warren',
    type: 'dungeon',
    visible: true,
    locked: false,
    opacity: 1,
    children: [HALL, CRYPT, joint, ...extra],
    standaloneWalls: [],
    mergedFloor: [rect(0, 0, 22, 10)],
    style: {} as DungeonLayer['style'],
    sublayerVisibility: { floor: true, grid: true, walls: true },
    rooms: ROOMS,
    roomNameOverrides: {},
  }
  return {
    version: '3.0',
    mapSettings: { name: 'Warren' } as SerializedMapData['mapSettings'],
    grid: { visible: true, snapDivision: 1, style: 'clean' } as SerializedMapData['grid'],
    layers: [layer],
    customImages: {},
  }
}

function table(joint: ConnectorChild = connector(), extra: readonly AnyChild[] = []) {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Warren')
  stores.maps.insert(SCENE, campaign.id, 'Warren', JSON.stringify(mapFile(joint, extra)))
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Warren')
  return { stores, campaignId: campaign.id, vision: createVision(stores) }
}

const sceneMap = (joint: ConnectorChild = connector(), extra: readonly AnyChild[] = []) =>
  createSceneMaps(table(joint, extra).stores).sceneMapOf(SCENE)!

const twin = (joint: ConnectorChild = connector()) =>
  sceneMap(joint).doors.find((door) => door.id === joint.id)!

/** Both chambers revealed — the fog half of "the party has earned this room". */
const bothSeen: SceneFog = {
  rooms: {
    hall: { status: 'revealed', wasEverRevealed: true },
    crypt: { status: 'revealed', wasEverRevealed: true },
  },
  concealBehindDoors: true,
}

const set = (stores: Stores, campaignId: string, module: string, state: unknown): void => {
  stores.moduleState.put(campaignId, module, state)
}

const party = (x: number): TokensState => ({
  library: {},
  byScene: { [SCENE]: { pc: { id: 'pc', x, y: 5, ownerId: 'p-1', hidden: false } as Token } },
})

// ── C1 — the connector is a door-graph edge ─────────────────────────────────

describe('C1 — a connector joins the door graph', () => {
  it('indexes one door edge per connector, keyed by the connector child id', () => {
    expect(sceneMap().doors.map((door) => door.id)).toEqual(['joint'])
  })

  it('carries the AuthoredDoor fields the runner reads, from the child itself', () => {
    const door = twin(connector({ state: 'locked', isSecret: true, style: 'portcullis' }))
    expect(door).toMatchObject({
      id: 'joint',
      state: 'locked',
      isSecret: true,
      style: 'portcullis',
      roomA: 'hall',
      roomB: 'crypt',
    })
  })

  // Mirrors `seedDoor`'s own archway rows: a hole in a wall stands open whatever the map
  // authored on it, and the door-kind connector beside it does not.
  it('maps kind:arch to archway semantics and kind:door to the state machine', () => {
    expect(twin(connector({ kind: 'arch', state: 'closed' })).style).toBe('archway')
    expect(seedDoor(twin(connector({ kind: 'arch', state: 'closed' })))).toEqual({
      open: true,
      locked: false,
      revealed: true,
    })
    expect(seedDoor(twin(connector({ kind: 'door', state: 'closed' })))).toMatchObject({
      open: false,
    })
  })

  it('leaves a connector bound to fewer than two rooms inert but present', () => {
    const door = twin(connector({ roomA: null, roomB: null }))
    expect(door.roomA).toBeNull()
    expect(door.roomB).toBeNull()
  })
})

// ── C3 — what a player is shipped ───────────────────────────────────────────

describe('C3 — the glyph anchor a connector has no wall to give', () => {
  it('anchors the mark on the blob centroid, along its principal axis', () => {
    const door = twin()
    expect(door.position[0]).toBeCloseTo(11)
    expect(door.position[1]).toBeCloseTo(5)
    // The blob is four wide and two tall, so the long axis is horizontal.
    expect(Math.abs(Math.sin(door.angle))).toBeLessThan(1e-6)
    expect(door.width).toBeCloseTo(4)
    expect(door.wallId).toBe('')
  })

  it('turns with the blob it was measured from', () => {
    const tall = twin(connector({ contours: [rect(10, 0, 12, 8)] }))
    expect(Math.abs(Math.cos(tall.angle))).toBeLessThan(1e-6)
    expect(tall.width).toBeCloseTo(8)
  })

  it('bakes the child transform in before measuring', () => {
    const moved = twin(
      connector({ transform: { translate: [100, 0], rotate: 0, scale: [1, 1] } }),
    )
    expect(moved.position[0]).toBeCloseTo(111)
  })

  it('ships the connector to a player as a door child, so the table draws it unchanged', () => {
    const cut = redactMapForViewer(sceneMap(), bothSeen, {})
    const kids = (cut.layers[0] as DungeonLayer).children
    const shipped = kids.find((child) => child.id === 'joint')!
    expect(shipped.childType).toBe('door')
    expect(shipped).toMatchObject({ state: 'closed', style: 'single', width: 4 })
  })
})

// ── C4 — the graph consumers need no changes ────────────────────────────────
//
// Every row here is one of `fog/module.test.ts`'s own door rows, re-run against a graph
// built entirely from connectors. If any of them needed a connector-shaped branch to pass,
// the design would be wrong.

describe('C4 — visibleRooms and blockedEdge over a connector-built graph', () => {
  const graph = (over: Partial<ConnectorChild> = {}) => sceneMap(connector(over)).doors
  const live = (over: Partial<DoorLiveState> = {}): Record<string, DoorLiveState> => ({
    joint: { open: true, locked: false, revealed: true, ...over },
  })
  const see = (doors: Record<string, DoorLiveState>, over: Partial<ConnectorChild> = {}) =>
    [...visibleRooms(bothSeen, doors, graph(over), ['hall'])].sort()

  it('an open connector connects the rooms it joins', () => {
    expect(see(live())).toEqual(['crypt', 'hall'])
  })

  it('a closed one blocks', () => {
    expect(see(live({ open: false }))).toEqual(['hall'])
  })

  it('an arch is open however the map authored it', () => {
    expect(see({}, { kind: 'arch', state: 'closed' })).toEqual(['crypt', 'hall'])
  })

  it('an unrevealed secret connector blocks', () => {
    expect(see({}, { isSecret: true, state: 'open' })).toEqual(['hall'])
  })

  it('names the shut connector in the blocked edge, by its own child id', () => {
    expect(blockedEdge({}, graph(), ['hall'], 'crypt')).toEqual({
      kind: 'closed-door',
      doorId: 'joint',
    })
    expect(blockedEdge({}, graph({ state: 'locked' }), ['hall'], 'crypt')).toEqual({
      kind: 'locked-door',
      doorId: 'joint',
    })
  })
})

// ── S1–S4 — standability ────────────────────────────────────────────────────

describe('S1–S4 — where a token may stand on an authored map', () => {
  const scene = (joint = connector(), doorState: DoorsState | null = null) => {
    const { vision, stores, campaignId } = table(joint)
    set(stores, campaignId, 'tokens', party(5))
    set(stores, campaignId, 'fog', { byScene: { [SCENE]: bothSeen } } satisfies FogState)
    if (doorState) set(stores, campaignId, 'doors', doorState)
    return vision.visionOf(SCENE)!
  }
  const open: DoorsState = {
    byScene: { [SCENE]: { joint: { open: true, locked: false, revealed: true } } },
  } as DoorsState

  // S1 — an authored room is a room: `roomAt` hits it and the credited set lets them stand.
  it('resolves a point inside an authored room to that room', () => {
    expect(scene().roomAt(5, 5)).toBe('hall')
    expect(scene().occupiable.has('hall')).toBe(true)
  })

  // S2 — off every room and every connector is void, whatever the merged floor says.
  it('resolves a point off every room and joint to nothing', () => {
    expect(scene().roomAt(11, 9)).toBeNull()
  })

  // S3 — the joint itself is walkable ground when it is passable and a side is earned.
  it('resolves a passable joint to the credited room beside it', () => {
    expect(scene(connector(), open).roomAt(11, 5)).toBe('hall')
    expect(scene(connector({ kind: 'arch' })).roomAt(11, 5)).toBe('hall')
  })

  it('answers a shut joint with the side the party has not earned, so it refuses', () => {
    const shut = scene()
    // Only `hall` is credited here: the party stands in it, and `crypt` is behind the shut
    // joint, so the BFS never reaches it.
    expect(shut.occupiable.has('crypt')).toBe(false)
    expect(shut.roomAt(11, 5)).toBe('crypt')
    expect(shut.blockedEdge!('crypt')).toEqual({ kind: 'closed-door', doorId: 'joint' })
  })

  it('leaves a joint onto nothing the party has earned as void', () => {
    const { vision, stores, campaignId } = table()
    set(stores, campaignId, 'tokens', party(5))
    set(stores, campaignId, 'fog', {
      byScene: { [SCENE]: { rooms: {}, concealBehindDoors: true } },
    } satisfies FogState)
    expect(vision.visionOf(SCENE)?.roomAt(11, 5) ?? null).toBeNull()
  })

  // S4 — `onAuthoredFloor`/`nearAuthoredFloor` read roomCount and roomAt, so an authored map
  // is a floored map to them exactly as a detected one is.
  it('counts an authored map as floored', () => {
    expect(sceneMap().rooms.map((room) => room.id)).toEqual(['hall', 'crypt'])
  })
})

// ── W1–W3 — wire hygiene ───────────────────────────────────────────────────

describe('W1–W3 — what leaves the server', () => {
  const cut = (fog: SceneFog) => redactMapForViewer(sceneMap(), fog, {})
  const onlyHall: SceneFog = {
    rooms: { hall: { status: 'revealed', wasEverRevealed: true } },
    concealBehindDoors: true,
  }

  // W1 — mirrors the detected-room cut: only credited rooms ship.
  it('ships only the rooms the party has earned', () => {
    expect((cut(onlyHall).layers[0] as DungeonLayer).rooms?.map((r) => r.id)).toEqual(['hall'])
    expect(JSON.stringify(cut(onlyHall))).not.toContain('crypt')
  })

  // W2 — the drawn geometry itself is authoring, and never a player's.
  it('never ships a RoomChild or a connector blob', () => {
    const kids = (cut(bothSeen).layers[0] as DungeonLayer).children
    expect(kids.map((child) => child.childType)).toEqual(['door'])
    // The blob's own corner: present in the DM's map, absent from the player's.
    expect(JSON.stringify(cut(bothSeen))).not.toContain('"contours"')
  })

  // …and the same facing rule a wall door gets, for the same reason.
  it('blanks a connector-door name and binding toward a room nobody has earned', () => {
    const kids = (cut(onlyHall).layers[0] as DungeonLayer).children
    const shipped = kids.find((child) => child.id === 'joint')!
    expect(shipped.name).toBe('')
    expect(shipped).toMatchObject({ roomA: 'hall', roomB: null })
  })

  it('withholds a connector bound to no room the party has earned', () => {
    const nothing: SceneFog = { rooms: {}, concealBehindDoors: true }
    expect(JSON.stringify(cut(nothing))).not.toContain('joint')
  })

  // W3 — the DM's document is the map file, whole.
  it('leaves the DM document holding the rooms and blobs as drawn', () => {
    const kids = (sceneMap().data.layers[0] as DungeonLayer).children
    expect(kids.map((child) => child.childType)).toEqual(['room', 'room', 'connector'])
  })
})

// ── A4 — republish keeps the ids the fog is keyed by ───────────────────────

describe('A4 — republishing an authored map', () => {
  it('keeps the room ids, so the credited set still applies', () => {
    const { stores, campaignId, vision } = table()
    set(stores, campaignId, 'fog', { byScene: { [SCENE]: bothSeen } } satisfies FogState)
    const before = vision.roomsOf(campaignId, SCENE)

    // Unrelated geometry moves — a prop is added, the rooms and joint are untouched.
    const moved = mapFile(connector(), [
      {
        id: 'prop',
        name: 'prop',
        childType: 'asset',
        visible: true,
        objectType: 'asset',
        assetId: 'a1',
        position: { x: 5, y: 5 },
        rotation: 0,
        scale: 1,
        width: 1,
        height: 1,
        tint: '#fff',
        flipX: false,
        flipY: false,
      } as AnyChild,
    ])
    const republished = 'map-2'
    stores.maps.insert(republished, campaignId, 'Warren', JSON.stringify(moved))
    stores.scenes.republish(SCENE, republished)
    const after = createVision(stores)

    expect(after.roomsOf(campaignId, SCENE)).toEqual(before)
    const cut = after.playerMap(SCENE)!
    expect((cut.layers[0] as DungeonLayer).rooms?.map((r) => r.id)).toEqual(['hall', 'crypt'])
  })
})
