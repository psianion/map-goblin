// The player-view parity guard (rca-live.md, fix plan 1): wherever a player is allowed to see
// something, it must resolve exactly as it does for the DM, and wherever they are not, nothing
// of it reaches them.
//
// Every earlier test checked what data is sent. This one checks what it draws as: each door's
// pose and look, each wall band, each floor fill and each room's place are resolved with the
// engine's own pure functions twice, once from the full document (the DM's copy) and once from
// the player's redacted copy, with the floor union rebuilt the way the client rebuilds it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Viewer } from '@dnd/mechanics/contract'
import { crossingsModule } from '@dnd/mechanics/crossings'
import { doorsModule } from '@dnd/mechanics/doors'
import { fogModule, regionFor, setCells, tableRegion, toBytes, type FogState, type SceneFog } from '@dnd/mechanics/fog'
import { createInitiativeModule } from '@dnd/mechanics/initiative'
import { pinsModule } from '@dnd/mechanics/pins'
import { storyModule } from '@dnd/mechanics/story'
import { tokensModule, type Token, type TokensState } from '@dnd/mechanics/tokens'
import { triggersModule, type TriggersState } from '@dnd/mechanics/triggers'
import type { Environment } from '@dnd/core/src/shared/world'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the floor union the client rebuilds
import { computeMergedFloor } from '@dnd/core/src/engine/mergedFloor'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the engine's own door and wall resolve
import { resolveDoors, resolveWalls, type ResolvedWall } from '@dnd/core/src/shared/wallResolve'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the looks the renderers draw with
import { doorWallLook, edgeStyles, levelStyle, ringStyles, standaloneWallLook } from '@dnd/core/src/shared/wallLook'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the look chain
import { levelOf, lookSource, resolveRoomLook, roomChain, roomHasLook } from '@dnd/core/src/shared/lookScope'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: a room's place
import { levelPlace, roomPlace } from '@dnd/core/src/shared/regionGrade'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the room lookup the renderers use
import { roomIndexOf } from '@dnd/core/src/shared/roomIndex'
import type { AnyChild, DoorChild, Room, WallSegment } from '@dnd/core/src/shared/types'
import type { DungeonLayer, DungeonStyle, SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ModuleRegistry } from '../modules/registry'
import { createTriggerDeps } from '../triggers/prepResolver'
import { ensureClipperReady } from './clipperBoot'
import { heldRooms } from './redactMap'
import { centreOf, distanceToPoly, isDungeon, pointInPoly } from './sceneMap'
import { createVision } from './vision'

beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
}, 30_000)

const read = (name: string): string => readFileSync(join(import.meta.dirname, '../../../testdata', name), 'utf8')
const SCENE = 'scene-parity'
const lit = { status: 'revealed' as const, wasEverRevealed: true }
type Ring = [number, number][]
type Doc = SerializedMapData

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CAVE_ENT = '5e1f64a8-4fdc-417a-b7a9-d0e00d196974'
const BLOO = 'd52adfc6-153b-4bf7-9a25-622d02d49d52'
const YELLO = '9d001e8a-71c5-4acd-9b6b-fb55d6473a61'

const dungeonOf = (map: Doc): DungeonLayer => map.layers.find(isDungeon)!

const door = (over: Partial<DoorChild> & Pick<DoorChild, 'id' | 'position' | 'angle'>): DoorChild =>
  ({
    name: over.id,
    childType: 'door',
    visible: true,
    wallId: '',
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
    ...over,
  }) as DoorChild

const piece = (id: string, at: [number, number], angle: number, width: number): WallSegment => {
  const [hx, hy] = [(Math.cos(angle) * width) / 2, (Math.sin(angle) * width) / 2]
  return {
    id,
    points: [
      [at[0] - hx, at[1] - hy],
      [at[0] + hx, at[1] + hy],
    ],
    wallType: 'normal',
    direction: 'both',
    color: '#000000',
    roughness: 0,
  }
}

/**
 * "Testing" with what the live map held and what the rooms could pin: "Single 1" as it stood on
 * the cave's outer outline (since removed by the user), a truly interior door on its own piece
 * across the Cave Ent./BLOO threshold, and floor, wall and place pins through a room and an area.
 */
function testingFull(): string {
  const map = JSON.parse(read('testing-cave.ggvtt')) as Doc
  const layer = dungeonOf(map)
  const [a, b] = [
    [19.78398452365659, 9.214678678712243],
    [19.669279973900622, 6.729413433999651],
  ]
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
  layer.standaloneWalls = [...layer.standaloneWalls, piece('inner-piece', mid, angle, 1)]
  layer.children = [
    ...layer.children,
    door({ id: 'single-1', name: 'Single 1', position: [13.66, 18.58], angle: -2.84, roomA: CAVE_ENT, roomB: null }),
    door({ id: 'inner', name: 'Inner', wallId: 'inner-piece', position: mid, angle, freestanding: true, roomA: CAVE_ENT, roomB: BLOO }),
  ]
  layer.areas = [{ id: 'area-deep', name: 'The Deep', look: { place: 'underground', floorTint: '#c0ffc0' } }]
  layer.rooms = layer.rooms!.map((room) =>
    room.id === CAVE_ENT
      ? { ...room, look: { ...room.look, floorTint: '#ffb0b0' } }
      : room.id === BLOO
        ? { ...room, look: { floorTextureId: 'gg-forge:wild_sand_8x8_floor_A', wallTextureTint: '#8080ff' } }
        : room.id === YELLO
          ? { ...room, areaId: 'area-deep' }
          : room,
  )
  return JSON.stringify(map)
}

/** The outdoor-cave fixture with a room in its cave, both cave doors bound to it, and pins on the hall. */
function outdoorCaveFull(): string {
  const map = JSON.parse(read('outdoor-cave.ggvtt')) as Doc
  const layer = dungeonOf(map)
  layer.areas = [{ id: 'area-west', name: 'West wing', look: { floorTint: '#ffd0d0', wallWidth: 0.8 } }]
  layer.rooms = [
    { ...layer.rooms![0], areaId: 'area-west', look: { wallTextureTint: '#a0a0ff', place: 'underground' } },
    { id: 'room-cave', name: 'Cave', anchor: [22, 9] },
  ]
  layer.children = layer.children.map((child) =>
    child.id === 'door-mouth' ? { ...child, roomB: 'room-cave' } : child.id === 'door-inner' ? { ...child, roomA: 'room-cave' } : child,
  ) as AnyChild[]
  return JSON.stringify(map)
}

interface State {
  name: string
  fog: Partial<SceneFog>
  token?: [number, number]
  /** Fill the cell record from the token's own sweep first (By sight). */
  sweep?: boolean
  /** The DM's live room places (the triggers module's room edits), by room id. */
  live?: Record<string, Environment>
  /** T10 — a row the DM reveals and then hides again through the fog module, after any sweep. */
  hide?: string
}

interface Fixture {
  name: string
  map: () => string
  outside: [number, number]
  mouthRoom: string
}

const FIXTURES: Fixture[] = [
  { name: 'testing-cave as exported', map: () => read('testing-cave.ggvtt'), outside: [15.5, 25.5], mouthRoom: CAVE_ENT },
  { name: 'testing-cave with its doors and pins', map: testingFull, outside: [15.5, 25.5], mouthRoom: CAVE_ENT },
  { name: 'outdoor-cave', map: () => read('outdoor-cave.ggvtt'), outside: [15.5, 9.5], mouthRoom: 'room-hall' },
  { name: 'outdoor-cave with a cave room and pins', map: outdoorCaveFull, outside: [15.5, 9.5], mouthRoom: 'room-cave' },
]

const statesOf = (f: Fixture): State[] => [
  { name: 'by hand, start dark', fog: { rooms: {} } },
  { name: 'by hand, a token outside, Outdoors revealed', fog: { rooms: { '@outdoors': lit } }, token: f.outside },
  { name: 'by hand, the mouth room revealed', fog: { rooms: { '@outdoors': lit, [f.mouthRoom]: lit } }, token: f.outside },
  {
    name: 'by hand, a token outside, the unexplored mouth room made Outdoor live',
    fog: { rooms: { '@outdoors': lit } },
    token: f.outside,
    live: { [f.mouthRoom]: 'outdoor' },
  },
  { name: 'by sight, start dark', fog: { mode: 'vision', containedSight: false, rooms: {} } },
  { name: 'by sight, a token outside', fog: { mode: 'vision', containedSight: false, rooms: {} }, token: f.outside, sweep: true },
  {
    name: 'by sight, the mouth room revealed',
    fog: { mode: 'vision', containedSight: false, rooms: { [f.mouthRoom]: lit } },
    token: f.outside,
    sweep: true,
  },
  // T10 — revealed, then hidden again: the room is withheld as if nobody had entered it.
  { name: 'by hand, the mouth room revealed then hidden', fog: { rooms: { '@outdoors': lit } }, token: f.outside, hide: f.mouthRoom },
  {
    name: 'by sight, the mouth room revealed then hidden',
    fog: { mode: 'vision', containedSight: false, rooms: {} },
    token: f.outside,
    sweep: true,
    hide: f.mouthRoom,
  },
]

const PLAYER: Viewer = { role: 'player', identityId: 'p-1' }
const DM: Viewer = { role: 'dm', identityId: 'dm-1' }

/** The DM's copy and the player's copy of a fixture at one fog state, and the player's join snapshot of every module. */
function cut(
  map: string,
  state: State,
): { dm: Doc; player: Doc; fog: SceneFog; kept: Set<string>; snapshot: Record<string, unknown> } {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Parity')
  stores.maps.insert(SCENE, campaign.id, 'Parity', map)
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Parity')
  const vision = createVision(stores)
  const setFog = (scene: Partial<SceneFog>) =>
    stores.moduleState.put(campaign.id, 'fog', {
      byScene: { [SCENE]: { rooms: {}, concealBehindDoors: true, ...scene } },
    } satisfies FogState)
  if (state.token) {
    const token = { id: 'pc', name: 'Bram', size: 'medium', x: state.token[0], y: state.token[1], ownerId: 'p-1', hidden: false, sight: null } as Token
    stores.moduleState.put(campaign.id, 'tokens', { library: {}, byScene: { [SCENE]: { pc: token } } } satisfies TokensState)
  }
  setFog(state.fog)
  if (state.live) {
    const roomEdits = Object.fromEntries(Object.entries(state.live).map(([id, place]) => [id, { place }]))
    stores.moduleState.put(campaign.id, 'triggers', {
      byScene: { [SCENE]: { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, lightEdits: {}, prompts: [], log: [], roomEdits } },
    } as unknown as TriggersState)
  }
  if (state.sweep) {
    const patch = vision.autoExplorePatch(SCENE)
    const frame = vision.frameOf(campaign.id, SCENE)!
    setFog({ ...state.fog, region: setCells(regionFor(undefined, frame)!, patch?.cells ?? []) })
  }
  // P9 — every module the server runs, wired to the same vision, as a joining player's seat gets them.
  const registry = new ModuleRegistry(stores.moduleState)
  registry.register(tokensModule(vision.visionOf, vision.levelFilterOf))
  registry.register(createInitiativeModule({ tokenOwnerOf: () => null }))
  registry.register(pinsModule)
  registry.register(storyModule({ shareReadAloud: () => null }))
  registry.register(crossingsModule)
  registry.register(
    fogModule(vision.roomsOf, vision.frameOf, vision.roomAtOf, (id) => vision.visibleOf(id), vision.groundAtOf, (id) =>
      vision.keptRoomsOf(id),
    ),
  )
  registry.register(doorsModule(vision.doorsOf, vision.playerDoors))
  registry.register(
    triggersModule({
      ...createTriggerDeps(stores, vision.sceneMapOf),
      keptLightsOf: (id) => vision.keptLightsOf(id),
      keptRoomsOf: (id) => vision.keptRoomsOf(id),
    }),
  )
  if (state.hide) {
    const dm = { campaignId: campaign.id, sessionId: 's-1', activeSceneId: SCENE, sender: DM, players: [], broadcast: () => {} }
    for (const action of ['reveal', 'hide']) {
      expect(registry.dispatch('fog', action, { sceneId: SCENE, roomId: state.hide }, dm)).toBeNull()
    }
  }
  const fog = (stores.moduleState.get(campaign.id, 'fog') as FogState).byScene[SCENE]
  const kept = heldRooms(vision.sceneMapOf(SCENE)!, fog)
  const snapshot = registry.snapshotModules(campaign.id, PLAYER)
  return { dm: vision.sceneMapOf(SCENE)!.data, player: vision.playerMap(SCENE)!, fog, kept, snapshot }
}

/** P9 — withheld room ids anywhere in a player's join snapshot, module by module. */
function snapshotLeaks(dmDoc: Doc, kept: ReadonlySet<string>, snapshot: Record<string, unknown>): string[] {
  const withheld = dmDoc.layers.filter(isDungeon).flatMap((l) => l.rooms ?? []).filter((room) => !kept.has(room.id))
  return Object.entries(snapshot).flatMap(([name, slice]) => {
    const wire = JSON.stringify(slice ?? null)
    return withheld.filter((room) => wire.includes(room.id)).map((room) => `withheld room id ${room.id} in the ${name} slice`)
  })
}

// ── Resolving a document the way the engine draws it ──────────────────────────

/** A dungeon layer as the client's store holds it: the floor union rebuilt from its own shapes. */
function asLoaded(layer: DungeonLayer): DungeonLayer {
  const base = { ...layer, children: layer.children ?? [], standaloneWalls: layer.standaloneWalls ?? [] }
  return { ...base, mergedFloor: computeMergedFloor(base) }
}

const round = (v: number): number => Math.round(v * 1e4) / 1e4
const angleKey = (a: number): number => round(((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))
const wallKeys = (s: DungeonStyle) => ({ set: s.wallTextureSetId || '', tint: s.wallTextureTint ?? '', width: s.wallWidth })

interface Resolved {
  doors: Map<string, unknown>
  standalone: Map<string, unknown>
  caves: { points: Ring; key: unknown }[]
  edges: { a: [number, number]; b: [number, number]; key: unknown }[]
  rooms: Map<string, unknown>
  /** The place a point is drawn with: its room's, else its level's. */
  placeAt: (x: number, y: number) => string
  floors: Ring[]
}

function resolve(doc: Doc, live: Record<string, Environment>): Resolved {
  const out: Resolved = { doors: new Map(), standalone: new Map(), caves: [], edges: [], rooms: new Map(), placeAt: () => '', floors: [] }
  const places: ((x: number, y: number) => string | null)[] = []
  let levelFallback = ''
  for (const raw of doc.layers.filter(isDungeon)) {
    const layer = asLoaded(raw)
    const level = levelOf(doc.levels ?? [], layer)
    const style = levelStyle(layer.style, level.look)
    const rings = ringStyles(layer, level.look)
    const edges = edgeStyles(layer, level.look)
    const walls = resolveWalls(layer)
    for (const r of resolveDoors(layer, walls)) {
      if (!r.door.visible) continue
      const look = doorWallLook(r, style, rings, edges)
      out.doors.set(r.door.id, {
        detached: r.detached,
        position: r.position.map(round),
        angle: angleKey(r.angle),
        style: r.door.style,
        kit: r.door.kit ?? null,
        look: { set: look.setId ?? '', tint: look.tint, width: round(look.width) },
      })
    }
    for (const wall of walls) {
      if (wall.kind === 'standalone') out.standalone.set(wall.id, standaloneWallLook(wall, style))
      if (wall.kind === 'cave') out.caves.push({ points: wall.points, key: caveKey(wall) })
    }
    ;(layer.mergedFloor ?? []).forEach((ring, i) => {
      for (let e = 0; e < ring.length; e++) {
        const s = edges[i]?.[e] ?? rings[i] ?? style
        out.edges.push({ a: ring[e], b: ring[(e + 1) % ring.length], key: wallKeys(s) })
      }
    })
    out.floors.push(...(layer.mergedFloor ?? []))
    for (const room of layer.rooms ?? []) out.rooms.set(room.id, roomKey(doc, layer, room, live))
    const index = roomIndexOf(layer.rooms)
    places.push((x, y) => {
      const room = index.roomAt(x, y)
      // The table's live place wins, keyed by the room's id (`renderLoop`'s `tableRoomPlaces`).
      return room ? (live[room.id] ?? roomPlace(doc, layer, room)) : null
    })
    levelFallback = levelPlace(doc.mapSettings, level)
  }
  out.placeAt = (x, y) => {
    for (const at of places) {
      const place = at(x, y)
      if (place) return place
    }
    return levelFallback
  }
  return out
}

const caveKey = (wall: ResolvedWall) => ({ set: wall.textureSetId ?? '', width: wall.bandWidth ?? null })

/** A room as the renderers read it: its face, its floor fill and its place. */
function roomKey(doc: Doc, layer: DungeonLayer, room: Room, live: Record<string, Environment>) {
  const chain = roomChain(doc, layer, room)
  const pinned = (key: 'floorTextureId' | 'floorTint') => ['room', 'area'].includes(lookSource(chain, key))
  const look = resolveRoomLook(chain)
  return {
    face: (room.boundary ?? room.face ?? []).map(([x, y]) => [round(x), round(y)]),
    // As `roomFloorFills` reads it: a room pinning neither floor key paints no fill.
    fill:
      roomHasLook(layer, room) && (pinned('floorTextureId') || pinned('floorTint'))
        ? { tex: pinned('floorTextureId') ? look.floorTextureId : null, tint: pinned('floorTint') ? look.floorTint : null }
        : null,
    place: live[room.id] ?? look.place,
  }
}

/** The DM edge that carries the player's edge `a`→`b`: same line, covering its midpoint. */
function dmEdgeOf(dm: Resolved, a: [number, number], b: [number, number]) {
  const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
  return dm.edges.find((e) => {
    if (Math.abs(Math.sin(Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) - ang)) > 1e-3) return false
    return distanceToPoly([e.a, e.b], mx, my) < 1e-3
  })
}

/** Every way the player's copy draws differently from the DM's, as readable lines. */
function differences(
  dmDoc: Doc,
  playerDoc: Doc,
  frame: { minX: number; minY: number; maxX: number; maxY: number },
  live: Record<string, Environment> = {},
): string[] {
  const dm = resolve(dmDoc, live)
  const player = resolve(playerDoc, live)
  const out: string[] = []
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  for (const [id, mine] of player.doors) {
    if (!same(mine, dm.doors.get(id))) out.push(`door ${id}: player ${JSON.stringify(mine)} dm ${JSON.stringify(dm.doors.get(id))}`)
  }
  for (const [id, mine] of player.standalone) {
    if (!same(mine, dm.standalone.get(id))) out.push(`wall ${id}: player ${JSON.stringify(mine)} dm ${JSON.stringify(dm.standalone.get(id))}`)
  }
  for (const cave of player.caves) {
    const twin = dm.caves.find((c) => same(c.points, cave.points))
    if (!twin || !same(twin.key, cave.key)) out.push(`cave wall at ${JSON.stringify(cave.points[0])}: player ${JSON.stringify(cave.key)} dm ${JSON.stringify(twin?.key)}`)
  }
  let edgeMisses = 0
  for (const edge of player.edges) {
    const twin = dmEdgeOf(dm, edge.a, edge.b)
    if (twin && same(twin.key, edge.key)) continue
    if (edgeMisses++ < 5) out.push(`edge ${JSON.stringify(edge.a)}→${JSON.stringify(edge.b)}: player ${JSON.stringify(edge.key)} dm ${JSON.stringify(twin?.key)}`)
  }
  if (edgeMisses > 5) out.push(`…and ${edgeMisses - 5} more edges`)
  // A stand-in travels under an opaque id, so a room is matched to the DM's by its face.
  const dmByFace = new Map([...dm.rooms.values()].map((key) => [JSON.stringify((key as { face: unknown }).face), key]))
  for (const [id, mine] of player.rooms) {
    const theirs = dmByFace.get(JSON.stringify((mine as { face: unknown }).face))
    if (!same(mine, theirs)) out.push(`room ${id}: player ${JSON.stringify(mine)} dm ${JSON.stringify(theirs)}`)
  }
  // Every cell centre on a floor the player holds is lit and shadowed by the place it is in.
  let placeMisses = 0
  for (let y = frame.minY + 0.5; y < frame.maxY; y++) {
    for (let x = frame.minX + 0.5; x < frame.maxX; x++) {
      if (!player.floors.some((ring) => pointInPoly(ring, x, y))) continue
      const [mine, theirs] = [player.placeAt(x, y), dm.placeAt(x, y)]
      if (mine !== theirs && placeMisses++ < 5) out.push(`place at ${x},${y}: player ${mine} dm ${theirs}`)
    }
  }
  if (placeMisses > 5) out.push(`…and ${placeMisses - 5} more places`)
  return out
}

/**
 * The leak side: no door, prop, light or label inside a walled floor or cave the party has not
 * earned. A floor with no room in it has nothing to earn: it is Outdoors (`outdoorGround.ts`). Earned ground inside an outline is a kept room (with the band its art is drawn in),
 * or a recorded cell whose centre is inside the outline. A door is interior when both its sides
 * are inside an outline; it travels only with a room the party holds.
 */
function leaks(
  dmDoc: Doc,
  playerDoc: Doc,
  fog: SceneFog,
  kept: ReadonlySet<string>,
  frame: { minX: number; minY: number; maxX: number; maxY: number },
): string[] {
  const dmLayers = dmDoc.layers.filter(isDungeon).map(asLoaded)
  const outlines = dmLayers.flatMap((l) => l.mergedFloor ?? [])
  const rooms = dmLayers.flatMap((l) => (l.rooms ?? []) as (Room & { boundary: Ring })[])
  const zoned = outlines.filter((ring) => rooms.some((room) => pointInPoly(ring, room.anchor[0], room.anchor[1])))
  const enclosed = (x: number, y: number) =>
    outlines.filter((ring) => pointInPoly(ring, x, y)).length % 2 === 1 && zoned.some((ring) => pointInPoly(ring, x, y))
  const index = roomIndexOf(rooms)
  const region = tableRegion(fog, frame)
  const bytes = region ? toBytes(region.bits) : null
  const recordedInside = (x: number, y: number): boolean => {
    if (!region || !bytes) return false
    // Cells whose square lies within a cell of the point, the reach a band piece is judged by.
    for (let row = Math.floor(y - region.minY) - 2; row <= Math.floor(y - region.minY) + 2; row++) {
      for (let col = Math.floor(x - region.minX) - 2; col <= Math.floor(x - region.minX) + 2; col++) {
        if (col < 0 || row < 0 || col >= region.cols || row >= region.rows) continue
        const [cx, cy] = [region.minX + col, region.minY + row]
        if (Math.hypot(Math.max(cx - x, 0, x - cx - 1), Math.max(cy - y, 0, y - cy - 1)) > 1) continue
        const bit = row * region.cols + col
        if ((bytes[bit >>> 3] & (1 << (bit & 7))) === 0) continue
        if (enclosed(region.minX + col + 0.5, region.minY + row + 0.5)) return true
      }
    }
    return false
  }
  const nearKept = (x: number, y: number) =>
    rooms.some((room) => kept.has(room.id) && (pointInPoly(room.boundary, x, y) || distanceToPoly(room.boundary, x, y) <= 1))
  const out: string[] = []
  // No withheld room's id travels at all: an imported map's ids are readable (`room-chief`).
  const wire = JSON.stringify(playerDoc)
  for (const room of rooms) if (!kept.has(room.id) && wire.includes(room.id)) out.push(`withheld room id ${room.id} on the wire`)
  for (const layer of playerDoc.layers.filter(isDungeon)) {
    for (const child of layer.children ?? []) {
      if (!['door', 'asset', 'light', 'text'].includes(child.childType)) continue
      if (child.childType === 'door') {
        const dmDoor = dmLayers.flatMap((l) => l.children).find((c) => c.id === child.id) as DoorChild
        if ([dmDoor.roomA, dmDoor.roomB].some((r) => r && kept.has(r))) continue
        const dmLayer = dmLayers.find((l) => l.children.some((c) => c.id === child.id))!
        const resolved = resolveDoors(dmLayer, resolveWalls(dmLayer)).find((r) => r.door.id === child.id)!
        const [nx, ny] = [-Math.sin(resolved.angle) * 0.5, Math.cos(resolved.angle) * 0.5]
        const [px, py] = resolved.position
        if (enclosed(px + nx, py + ny) && enclosed(px - nx, py - ny)) out.push(`interior door ${child.id} of an unearned room`)
        continue
      }
      const [x, y] = centreOf(child)
      if (!enclosed(x, y)) continue
      const room = index.roomAt(x, y)?.id ?? null
      if ((room && kept.has(room)) || nearKept(x, y) || recordedInside(x, y)) continue
      out.push(`${child.childType} ${child.id} inside unearned ground at ${round(x)},${round(y)}`)
    }
  }
  return out
}

describe.each(FIXTURES)('player view parity: $name', (fixture) => {
  const map = fixture.map()
  it.each(statesOf(fixture))('$name', (state) => {
    const { dm, player, fog, kept, snapshot } = cut(map, state)
    const frame = player.frame ?? { minX: 0, minY: 0, maxX: 30, maxY: 30 }
    // T10 — a room hidden again is held by nobody, so the leak guard below withholds it whole.
    if (state.hide) expect(kept.has(state.hide)).toBe(false)
    expect({
      draws: differences(dm, player, frame, state.live),
      leaks: [...leaks(dm, player, fog, kept, frame), ...snapshotLeaks(dm, kept, snapshot)],
    }).toEqual({ draws: [], leaks: [] })
  })
})

describe('a stand-in room (R1)', () => {
  it('carries face, look and place only, and is replaced by the real room when earned', () => {
    const map = outdoorCaveFull()
    const outside: State = { name: 'outside', fog: { rooms: { '@outdoors': lit } }, token: [13.5, 7.5] }
    const { player } = cut(map, outside)
    // The hall's own face: the stand-in carries no other way to tell it apart.
    const hallFace = JSON.stringify(dungeonOf(cut(map, { ...outside, fog: { rooms: { 'room-hall': lit } } }).player).rooms!.find((r) => r.id === 'room-hall')!.boundary)
    const hall = dungeonOf(player).rooms!.find((room) => room.standIn && JSON.stringify(room.boundary) === hallFace)!
    expect(Object.keys(hall).sort()).toEqual(['anchor', 'boundary', 'id', 'look', 'name', 'standIn'])
    expect(hall.id).toMatch(/^standin-[0-9a-f]{16}$/)
    expect(JSON.stringify(player)).not.toContain('room-hall')
    // S5: areas never travel; their pins ride in each room's look.
    expect(JSON.stringify(player)).not.toContain('West wing')
    expect(hall).toMatchObject({
      name: '',
      standIn: true,
      look: { floorTint: '#ffd0d0', wallWidth: 0.8, wallTextureTint: '#a0a0ff', place: 'underground' },
    })
    expect(hall.anchor).not.toEqual([8, 7])
    const earned = cut(map, { ...outside, fog: { rooms: { '@outdoors': lit, 'room-hall': lit } } })
    expect(dungeonOf(earned.player).rooms!.find((room) => room.id === 'room-hall')).toMatchObject({ name: 'Hall' })
    expect(dungeonOf(earned.player).rooms!.filter((room) => room.standIn && JSON.stringify(room.boundary) === hallFace)).toEqual([])
    expect(dungeonOf(earned.player).areas).toBeUndefined()
    expect(dungeonOf(earned.player).rooms!.find((room) => room.id === 'room-hall')).toMatchObject({
      look: { floorTint: '#ffd0d0', wallWidth: 0.8, wallTextureTint: '#a0a0ff', place: 'underground' },
    })
  })
})

describe('a live place the DM moves (R1)', () => {
  it('re-sends the stand-ins a seat holds, with the new place baked in', () => {
    const stores = createStores(openDb(':memory:'))
    const campaign = stores.campaigns.create('Parity')
    stores.maps.insert(SCENE, campaign.id, 'Parity', read('testing-cave.ggvtt'))
    stores.scenes.create(SCENE, campaign.id, SCENE, 'Parity')
    const vision = createVision(stores)
    stores.moduleState.put(campaign.id, 'fog', {
      byScene: { [SCENE]: { rooms: { '@outdoors': lit }, concealBehindDoors: true } },
    } satisfies FogState)
    const before = vision.playerMap(SCENE)!
    const mouth = dungeonOf(before).rooms!.find((r) => r.standIn && r.look?.place === 'underground')!
    expect(mouth).toBeTruthy()
    vision.revealDelta(SCENE)
    stores.moduleState.put(campaign.id, 'triggers', {
      byScene: {
        [SCENE]: { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, lightEdits: {}, prompts: [], log: [], roomEdits: { [CAVE_ENT]: { place: 'outdoor' } } },
      },
    } as unknown as TriggersState)
    const moved = vision.revealDelta(SCENE)!.layers.flatMap((l) => l.rooms).find((r) => JSON.stringify(r.boundary) === JSON.stringify(mouth.boundary))
    expect(moved).toMatchObject({ standIn: true, look: { place: 'outdoor' } })
  })
})
