// Rooms made in the editor arrive at the table and work (rooms plan §5): the server cuts the same
// faces the editor does (ground closed in by walls, divided caves, outlined rooms), every room the
// start list offers has a shape, and outlined rooms on a picture never stop a token walking.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TokensState, Token } from '@dnd/mechanics/tokens'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the editor's own sync, to compare faces with
import { syncRooms } from '@dnd/core/src/store/roomSync'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the frame and base ground rooms are cut with
import { roomContextOf } from '@dnd/core/src/shared/roomFloor'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: Suggest, as the editor runs it
import { suggestDivides, suggestRooms } from '@dnd/core/src/shared/suggestRooms'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the editor's own room migration, pure data
import { migrateRooms } from '@dnd/core/src/store/roomMigration'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ensureClipperReady } from './clipperBoot'
import { createVision } from './vision'
import { isDungeon } from './sceneMap'

beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
}, 30_000)

const SCENE = 's'
const PLAYER = { role: 'player' as const, identityId: 'p-1' }
const CAVE = readFileSync(join(import.meta.dirname, '../../../testdata/cave-chambers.ggvtt'), 'utf8')

/** A table on `map` with fog off and one player's token at `at`. */
function table(map: string, at: { x: number; y: number }) {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Rooms')
  stores.maps.insert(SCENE, campaign.id, 'Rooms', map)
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Rooms')
  const pc = { id: 'pc', name: 'Bram', size: 'medium', ...at, ownerId: 'p-1', hidden: false } as Token
  stores.moduleState.put(campaign.id, 'tokens', { library: {}, byScene: { [SCENE]: { pc } } } satisfies TokensState)
  const vision = createVision(stores)
  const scene = vision.sceneMapOf(SCENE)!
  const walk = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    vision.visionOf(SCENE, PLAYER)!.walkRefusal!({ ...pc, ...from }, to, from)
  return { scene, walk }
}

/** Every room's face as the editor's own sync gives it. */
function editorFaces(data: SerializedMapData): Map<string, [number, number][] | undefined> {
  const out = new Map<string, [number, number][] | undefined>()
  for (const layer of data.layers) {
    if (!isDungeon(layer)) continue
    const live = { ...layer, children: layer.children ?? [], standaloneWalls: layer.standaloneWalls ?? [] }
    for (const room of syncRooms(live, 1, roomContextOf(data, live)).rooms) out.set(room.id, room.face)
  }
  return out
}

describe('the cave with two chambers and a passage', () => {
  it('reaches the table with the editor’s faces, every room shaped', () => {
    const { scene } = table(CAVE, { x: 8, y: 10 })
    const faces = editorFaces(migrateRooms(JSON.parse(CAVE) as SerializedMapData))
    expect(scene.rooms.map((r) => r.name)).toEqual(['West chamber', 'Narrow way', 'East chamber', 'Camp'])
    for (const room of scene.rooms) {
      expect(room.boundary.length).toBeGreaterThanOrEqual(3)
      expect(room.boundary).toEqual(faces.get(room.id))
    }
  })

  it('answers each room at its own pin, the outlined camp included', () => {
    const { scene } = table(CAVE, { x: 8, y: 10 })
    for (const room of scene.rooms) expect(scene.roomAt(room.anchor[0], room.anchor[1])).toBe(room.id)
  })

  it('lets a token walk through every room: west chamber, passage, east chamber and out to the camp', () => {
    const { scene, walk } = table(CAVE, { x: 8, y: 10 })
    const at = (name: string) => {
      const [x, y] = scene.rooms.find((r) => r.name === name)!.anchor
      return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 }
    }
    expect(walk(at('West chamber'), at('Narrow way'))).toBeNull()
    expect(walk(at('Narrow way'), at('East chamber'))).toBeNull()
    expect(walk(at('East chamber'), at('West chamber'))).toBeNull()
    // The camp is on base ground outside the cave, reached round it.
    expect(walk({ x: 15.5, y: 20.5 }, { x: 2.5, y: 2.5 })).toBeNull()
  })
})

describe('walls over ground pieces', () => {
  /** A ground piece with two walled squares on it, rooms accepted from Suggest, as the editor saves it. */
  function yards(): SerializedMapData {
    const cave = JSON.parse(CAVE) as SerializedMapData
    const layer = cave.layers.find(isDungeon)!
    const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    const wall = (id: string, points: [number, number][]) => ({ id, points, wallType: 'normal', direction: 'both', color: '#000000', roughness: 0 })
    const ground = {
      id: 'ground-1', name: 'Grass', childType: 'shape', visible: true, shapeType: 'polygon', ground: true,
      contours: [[[1, 1], [29, 1], [29, 14], [1, 14]]], textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    }
    const next: DungeonLayer = {
      ...layer,
      children: [ground] as unknown as DungeonLayer['children'],
      standaloneWalls: [wall('a', square(3, 3, 11, 11)), wall('b', square(17, 3, 27, 11))] as DungeonLayer['standaloneWalls'],
      thresholds: [],
      rooms: [],
      mergedFloor: null,
    }
    const data: SerializedMapData = { ...cave, mapSettings: { ...cave.mapSettings, ground: null }, layers: cave.layers.map((l) => (isDungeon(l) ? next : l)) }
    next.rooms = suggestRooms(next, roomContextOf(data, next)).map(({ face: _face, ...room }) => room)
    return data
  }

  it('Suggest finds both walled squares, and the server places both with the editor’s faces', () => {
    const data = yards()
    expect(data.layers.find(isDungeon)!.rooms).toHaveLength(2)
    const faces = editorFaces(data)
    const { scene } = table(JSON.stringify(data), { x: 7, y: 7 })
    expect(scene.rooms).toHaveLength(2)
    for (const room of scene.rooms) {
      expect(room.boundary.length).toBeGreaterThanOrEqual(3)
      expect(room.boundary).toEqual(faces.get(room.id))
    }
  })
})

describe('painted floors with no walls', () => {
  /** Two painted chambers and the passage between them, rooms and lines accepted from Suggest, as the editor saves it. */
  function painted(): SerializedMapData {
    const cave = JSON.parse(CAVE) as SerializedMapData
    const layer = cave.layers.find(isDungeon)!
    const piece = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
      id, name: id, childType: 'shape', visible: true, shapeType: 'polygon', ground: true, textureId: 'stone',
      contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    })
    const next: DungeonLayer = {
      ...layer,
      children: [piece('west', 2, 2, 10, 10), piece('way', 9, 5, 17, 7), piece('east', 16, 2, 24, 10)] as unknown as DungeonLayer['children'],
      standaloneWalls: [],
      thresholds: [],
      rooms: [],
      mergedFloor: null,
    }
    const data: SerializedMapData = { ...cave, layers: cave.layers.map((l) => (isDungeon(l) ? next : l)) }
    const ctx = roomContextOf(data, next)
    const divides = suggestDivides(next, ctx)
    next.rooms = suggestRooms(next, ctx, divides).map(({ face: _face, ...room }) => room)
    next.thresholds = divides
    return data
  }

  it('Suggest makes pinned rooms, and the server places each on its painted part with the editor’s faces', () => {
    const data = painted()
    const rooms = data.layers.find(isDungeon)!.rooms!
    expect(rooms).toHaveLength(3)
    expect(rooms.every((r) => !r.boundary)).toBe(true)
    const faces = editorFaces(data)
    const { scene } = table(JSON.stringify(data), { x: 6, y: 6 })
    expect(scene.rooms).toHaveLength(3)
    for (const room of scene.rooms) {
      expect(room.boundary.length).toBeGreaterThanOrEqual(3)
      expect(room.boundary).toEqual(faces.get(room.id))
      expect(scene.roomAt(room.anchor[0], room.anchor[1])).toBe(room.id)
    }
  })
})

describe('a cave with short walls and doors in its passages', () => {
  /** Seven floors on base ground, a short wall and its door inside each end of every passage, rooms accepted from Suggest. */
  function doored(): SerializedMapData {
    const cave = JSON.parse(CAVE) as SerializedMapData
    const layer = cave.layers.find(isDungeon)!
    const floors: [number, number][][] = [
      [[2, 3], [11, 3], [11, 12], [2, 12]], [[10, 6], [16, 6], [16, 8], [10, 8]], [[15, 2], [27, 2], [27, 13], [15, 13]],
      [[5, 11], [7, 11], [7, 19], [5, 19]], [[3, 18], [13, 18], [13, 27], [3, 27]], [[12, 21], [18, 21], [18, 23], [12, 23]],
      [[17, 17], [26, 17], [26, 26], [17, 26]],
    ]
    const walls: [number, number][][] = [
      [[5.12, 17.54], [6.5, 17.54]], [[13.28, 21.56], [13.28, 22.45]], [[16.91, 22.5], [16.91, 21.49]],
      [[5.52, 12.38], [6.46, 12.38]], [[11.15, 7.48], [11.15, 6.53]], [[14.66, 7.45], [14.66, 6.53]],
    ]
    const doors: [number, number, number, number][] = [
      [5.81, 17.54, 0, 1.38], [13.28, 22.01, 1.57, 0.88], [16.91, 22, -1.57, 1.01],
      [5.99, 12.38, 0, 0.94], [11.15, 7.005, -Math.PI / 2, 0.95], [14.66, 6.99, -Math.PI / 2, 0.92],
    ]
    const next: DungeonLayer = {
      ...layer,
      children: [
        ...floors.map((ring, i) => ({ id: `f${i}`, name: `Floor ${i}`, childType: 'shape', visible: true, shapeType: 'polygon', contours: [ring] })),
        ...doors.map(([x, y, angle, width], i) => ({
          id: `d${i}`, name: `Door ${i}`, childType: 'door', visible: true, wallId: `w${i}`, position: [x, y], angle, width,
          style: 'single', state: 'closed', isSecret: false, freestanding: true,
        })),
      ] as unknown as DungeonLayer['children'],
      standaloneWalls: walls.map((points, i) => ({ id: `w${i}`, points, wallType: 'normal', direction: 'both', color: '#000000', roughness: 0 })) as DungeonLayer['standaloneWalls'],
      style: { ...layer.style, wallWidth: 0.5 },
      thresholds: [],
      rooms: [],
      mergedFloor: null,
    }
    const data: SerializedMapData = {
      ...cave,
      mapSettings: { ...cave.mapSettings, ground: { color: '#556b2f' }, fixedSize: { width: 30, height: 30, locked: true } },
      layers: cave.layers.map((l) => (isDungeon(l) ? next : l)),
    }
    const ctx = roomContextOf(data, next)
    const divides = suggestDivides(next, ctx)
    next.rooms = suggestRooms(next, ctx, divides).map(({ face: _face, ...room }) => room)
    next.thresholds = divides
    return data
  }

  it('the server places every room Suggest made with the editor’s faces, each its own', () => {
    const data = doored()
    expect(data.layers.find(isDungeon)!.rooms!.length).toBeGreaterThanOrEqual(4)
    const faces = editorFaces(data)
    const { scene } = table(JSON.stringify(data), { x: 6, y: 7 })
    expect(scene.rooms).toHaveLength(data.layers.find(isDungeon)!.rooms!.length)
    expect(new Set(scene.rooms.map((r) => JSON.stringify(r.boundary))).size).toBe(scene.rooms.length)
    for (const room of scene.rooms) {
      expect(room.boundary.length).toBeGreaterThanOrEqual(3)
      expect(room.boundary).toEqual(faces.get(room.id))
    }
  })
})

describe('a picture with outlined rooms', () => {
  function picture(): string {
    const cave = JSON.parse(CAVE) as SerializedMapData
    const layer = cave.layers.find(isDungeon)!
    const next: DungeonLayer = {
      ...layer,
      children: [],
      thresholds: [],
      mergedFloor: null,
      rooms: [
        { id: 'hall', name: 'Hall', number: 1, anchor: [5, 5], boundary: [[2, 2], [9, 2], [9, 9], [2, 9]] },
        { id: 'lost', name: 'Lost', number: 2, anchor: [20, 20] },
      ],
    }
    return JSON.stringify({ ...cave, mapSettings: { ...cave.mapSettings, ground: null }, layers: cave.layers.map((l) => (isDungeon(l) ? next : l)) })
  }

  it('keeps the outline as drawn and lets a token walk anywhere on the frame', () => {
    const { scene, walk } = table(picture(), { x: 5.5, y: 5.5 })
    expect(scene.rooms.find((r) => r.id === 'hall')!.boundary).toEqual([[2, 2], [9, 2], [9, 9], [2, 9]])
    expect(walk({ x: 5.5, y: 5.5 }, { x: 25.5, y: 20.5 })).toBeNull()
    expect(walk({ x: 25.5, y: 20.5 }, { x: 0.5, y: 23.5 })).toBeNull()
  })
})
