// §2.3.1 — the map a player is allowed to hold, and the slice of it a reveal hands over.
//
// The geometry policy of D4, narrowed by T10: a room the party holds *now* keeps its geometry
// (`heldRooms`), and any other room has none of it — no floor, no walls, no props, not even the
// id. A room the DM hid again is fogged fully, so it goes back to being withheld; where its floor
// must still be drawn it travels as a stand-in. Unzoned map is the DM's alone (D6) and an
// unrevealed secret door does not exist.

import { createHmac, randomBytes } from 'node:crypto'
import { seedDoor, type AuthoredDoor, type DoorLiveState } from '@dnd/mechanics/doors'
import {
  DEFAULT_WALL_WIDTH,
  FOG_MARGIN,
  fogOn,
  rebaseRegion,
  toBytes,
  type RegionMask,
  type SceneFog,
} from '@dnd/mechanics/fog'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the engine's own door resolve, run on the full map
import { resolveDoors, resolveWalls } from '@dnd/core/src/shared/wallResolve'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the wall looks the door renderer reads
import { doorWallLook, edgeStyles, levelStyle, ringStyles } from '@dnd/core/src/shared/wallLook'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the look chain
import { levelOf } from '@dnd/core/src/shared/lookScope'
import type { Environment } from '@dnd/core/src/shared/world'
import type {
  AnyChild,
  DoorChild,
  Room,
  RoomArea,
  ShapeChild,
  WallSegment,
} from '@dnd/core/src/shared/types'
import type { MapDelta } from '@dnd/core/src/shared/protocol'
import type { DungeonLayer, RockLine, SerializedMapData } from '@dnd/core/src/store/types'
import {
  centreOf,
  childrenOf,
  distanceToPoly,
  isDungeon,
  pointInPoly,
  roomRing,
  wallsOf,
  type SceneMap,
} from './sceneMap'
import { enclosedOn, hasHiddenGround } from './outdoorGround'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the Lighting pass's level rules
import { firstLevelId, levelIdOf } from '@dnd/core/src/shared/visionGate'

type Doors = Record<string, DoorLiveState>

/**
 * Fog rework — the rooms a player holds right now, which is the geometry they are sent (D4):
 * every room with fog off, and with fog on the rooms with any cleared cell on their own level.
 * A room whose last cleared cell is fogged again stops shipping (the seat refetches).
 */
export function heldRooms(scene: SceneMap, fog: SceneFog): Set<string> {
  return fogOn(fog) ? clearedRooms(scene, fog) : new Set(scene.rooms.map((room) => room.id))
}

const clearedCache = new WeakMap<SceneMap, { key: string; rooms: Set<string> }>()

/**
 * The rooms with a cleared cell centre inside them, each judged on its own level, whether fog is
 * on or not — what a "When a room is revealed" trigger reads. Cached on the parsed map and the
 * record's bits, since a cascade asks it on every token step.
 */
export function clearedRooms(scene: SceneMap, fog: SceneFog): Set<string> {
  const frame = scene.frame
  const levels = Object.entries(fog.cleared ?? {})
  if (!frame || levels.length === 0) return new Set()
  const key = levels.map(([id, mask]) => `${id}:${mask.minX},${mask.minY},${mask.cols}:${mask.bits}`).join('|')
  const hit = clearedCache.get(scene)
  if (hit && hit.key === key) return hit.rooms
  const rooms = new Set<string>()
  for (const [levelId, stored] of levels) {
    const region = rebaseRegion(stored, frame)
    if (!region) continue
    const bytes = toBytes(region.bits)
    for (let bit = 0; bit < region.cols * region.rows; bit++) {
      if ((bytes[bit >>> 3] & (1 << (bit & 7))) === 0) continue
      const col = bit % region.cols
      const row = (bit - col) / region.cols
      const room = scene.roomAtOn(levelId, region.minX + col + 0.5, region.minY + row + 0.5)
      if (room !== null) rooms.add(room)
    }
  }
  clearedCache.set(scene, { key, rooms })
  return rooms
}

/** The player's copy of a scene's map. The DM's copy is the file, untouched. */
export function redactMapForViewer(
  scene: SceneMap,
  fog: SceneFog,
  doors: Doors,
  ground: Ground = groundOf(fog, scene.frame),
  openGround?: SerializedMapData['openGround'],
  places: Places = NO_PLACES,
): SerializedMapData {
  const kept = heldRooms(scene, fog)
  // The confining rectangle of the *full* document, measured with the index and so before
  // any cut (`SceneMap.frame`): the player's
  // fog covers the whole frame, and their redacted layers can no longer measure it. A rect
  // leaks only the map's overall size — never where inside it anything is. Only stamped
  // when the map has fog to enforce (rooms); an unzoned map goes over whole and untouched.
  const zoned = scene.data.layers.some((l) => isDungeon(l) && (l.rooms?.length ?? 0) > 0)
  // R3: a map with ground pieces or base ground has ground to hide with no room at all, so it is
  // framed and cut like a zoned one; only an imported picture goes over whole.
  const hidden = hasHiddenGround(scene.data)
  // …and a fogged scene needs the rectangle whether or not anyone zoned the map. The player's
  // mask is drawn over exactly this, and a roomless map that shipped without one left the mask
  // no finite territory to cover — the very case the brush exists for.
  const framed = zoned || hidden || fogOn(fog)
  // Scene prep is the DM's notes — trigger definitions, trap DCs, the lot. It never
  // reaches a player in any form, revealed or not.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured away on purpose
  const { prep: _prep, ...docSansPrep } = scene.data
  // Built once for the whole document, not once per layer: the ground lookup decodes the
  // region record, and the room boxes are a walk over every kept boundary.
  const cut = cutFor(scene, kept, ground, insideGroundOf(scene, fog), !fogOn(fog), outsideGroundOf(scene, fog))
  // The table's starting room is the DM's choice of where play opens, and its id names a room:
  // it travels only once that room is the party's.
  const startingRoomId = docSansPrep.mapSettings?.startingRoomId
  const mapSettings =
    startingRoomId && !kept.has(startingRoomId)
      ? (({ startingRoomId: _start, ...rest }) => rest)(docSansPrep.mapSettings)
      : docSansPrep.mapSettings
  return {
    ...docSansPrep,
    mapSettings,
    ...(framed ? { frame: scene.frame } : {}),
    // Table fix pass §2.7: the ground outside the walled floors, once the seat knows any of it.
    ...(openGround ? { openGround } : {}),
    layers: scene.data.layers.map((layer) => {
      if (!isDungeon(layer)) return layer
      // A layer nobody zoned has no fog to enforce — room-granular fog needs rooms (D6) — so
      // its geometry goes over whole, less what `childShips` withholds on that branch.
      if (!layer.rooms?.length && !hidden) {
        const kids = childrenOf(layer)
        const shipped = kids.filter((child) => childShips(child, layer, scene, kept, doors, cut))
        // Untouched when there was nothing to take, so a layer with no doors stays the very
        // object it arrived as rather than growing an empty `children` it never had.
        return shipped.length === kids.length ? layer : { ...layer, children: shipped }
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- S5: areas never travel (`withStandIns`)
      const { areas: _areas, ...rest } = layer
      return {
        ...rest,
        ...slice(layer, scene, kept, doors, kept, cut, places),
        // The merged floor is one union across the whole layer, so it cannot be cut per
        // room — and handing it over would outline every room in the dungeon. The client
        // rebuilds it from the children it has; the editor already ships it null.
        mergedFloor: null,
      }
    }),
  }
}

/**
 * The children a reveal owes a player that the *rooms* did not carry (D2/D5).
 *
 * A room reveal pays its own debt through `mapDeltaFor`: the state that says "revealed" and
 * the shapes to draw it travel in one frame. Two other things earn a player geometry without
 * revealing a room, and both land here.
 *
 * A `reveal-secret` is the older one — the door child was cut from their map while it was
 * still a secret, and it is the only door write that can owe anything, because every other
 * door came with the room it belongs to.
 *
 * The cell brush is the newer one, and it is the reason this took the door's name off it.
 * Brushed ground is a reveal (and since c2bc9ff it is ground a player can stand on), so the
 * art stamped along it — a wall band, the shrubs at its edge — becomes theirs the moment the
 * referee paints the cell, with no room having changed at all. `vision.ts` diffs the child ids
 * a player is entitled to and hands whatever is new to this.
 *
 * `kept` is the *explored* room set, not the newly-revealed one: a door here joins rooms the
 * party has already earned, so it keeps both bindings. Doors are faced — a door carries both
 * bindings and would otherwise name the room behind it.
 */
export function childDeltaFor(
  scene: SceneMap,
  sceneId: string,
  childIds: ReadonlySet<string>,
  kept: ReadonlySet<string>,
  places: Places = NO_PLACES,
): MapDelta {
  return {
    sceneId,
    layers: scene.data.layers
      .filter(isDungeon)
      .map((layer) => ({
        id: layer.id,
        ...withStandIns(
          scene.campaignId,
          layer,
          [],
          childrenOf(layer)
            .filter((child) => childIds.has(child.id))
            .map((child) => (child.childType === 'door' ? facing(placed(scene, child), kept) : child)) as AnyChild[],
          kept,
          places,
        ),
        standaloneWalls: [] as WallSegment[],
      }))
      .filter((layer) => layer.children.length > 0),
  }
}

/**
 * The same cut, restricted to the rooms that just became the player's (D5).
 *
 * `explored` is every room they hold, this reveal included, and it is what the doors are
 * *faced* against — same rule as `doorDeltaFor`, for a sharper reason. A door's child is
 * replaced wholesale by the one this delta carries (`mergeMapDelta` upserts by id), so
 * facing it against the newly-revealed room alone would null the binding to the room the
 * party is standing in, and the client's own reachability BFS would then read the door as
 * leading outside — the room would light up on the referee's side and stay a memory on
 * theirs, forever. Defaulted so the callers that reveal into an empty map need not care.
 */
export function mapDeltaFor(
  scene: SceneMap,
  sceneId: string,
  rooms: readonly string[],
  doors: Doors,
  explored: ReadonlySet<string> = new Set(rooms),
  places: Places = NO_PLACES,
): MapDelta {
  const kept = new Set(rooms)
  return {
    sceneId,
    layers: scene.data.layers
      .filter(isDungeon)
      .map((layer) => ({ id: layer.id, ...slice(layer, scene, kept, doors, explored, cutFor(scene, kept), places) }))
      .filter((layer) => layer.rooms.length > 0),
  }
}

/**
 * The widest wall band on the map plus its margin — `fogPad`, computed off the same styles and the
 * same two numbers (S6: `FOG_MARGIN`, `DEFAULT_WALL_WIDTH`, imported from `@dnd/mechanics/fog`),
 * because this is the same distance measured from the other side. See `nearKeptRoom`.
 */
export function bandPad(scene: SceneMap): number {
  let wallWidth = 0
  for (const layer of scene.data.layers) {
    if (isDungeon(layer)) wallWidth = Math.max(wallWidth, layer.style?.wallWidth ?? 0)
  }
  return (wallWidth || DEFAULT_WALL_WIDTH) + FOG_MARGIN
}

function slice(
  layer: DungeonLayer,
  scene: SceneMap,
  kept: ReadonlySet<string>,
  doors: Doors,
  facingSet: ReadonlySet<string> = kept,
  cut: Cut = cutFor(scene, kept),
  places: Places = NO_PLACES,
): { rooms: Room[]; children: AnyChild[]; standaloneWalls: WallSegment[]; rockLines?: RockLine[] } {
  return {
    ...withStandIns(
      scene.campaignId,
      layer,
      (layer.rooms ?? []).filter((room) => kept.has(room.id)),
      childrenOf(layer)
        .filter((child) => childShips(child, layer, scene, kept, doors, cut))
        // A door on the edge of the known world keeps only the side the party has been, and is
        // drawn where the referee's full map puts it.
        .map((child) => (child.childType === 'door' ? facing(placed(scene, child), facingSet) : child)),
      facingSet,
      places,
    ),
    // A wall belongs to the rooms on either side of it, so one shared with a room the
    // player has seen survives — it is that room's own outline either way.
    standaloneWalls: cut.open
      ? [...wallsOf(layer)]
      : wallsOf(layer).filter((wall) => scene.roomsAlong(wall).some((room) => kept.has(room))),
    // A measured kit's rock line goes with the rooms it edges: those within a cell of its drawn
    // outline. Against every room the player holds, so a reveal's list is the whole of theirs.
    // With fog off the whole map ships, and every line with it.
    ...(layer.rockLines
      ? { rockLines: cut.open ? [...layer.rockLines] : layer.rockLines.filter((line) => rockLineNear(line, scene, facingSet)) }
      : {}),
  }
}

/** How near a rock line's drawn outline must come to a room for the line to be that room's, cells. */
const ROCK_LINE_REACH = 1

function rockLineNear(line: RockLine, scene: SceneMap, rooms: ReadonlySet<string>): boolean {
  return scene.rooms.some((room) => {
    if (!rooms.has(room.id) || room.boundary.length < 3) return false
    return (
      line.edge.some(([x, y]) => distanceToPoly(room.boundary, x, y) <= ROCK_LINE_REACH || pointInPoly(room.boundary, x, y)) ||
      room.boundary.some(([x, y]) => distanceToPoly(line.edge, x, y) <= ROCK_LINE_REACH)
    )
  })
}

/**
 * Whether this child travels to a player at all — the one rule, called by the document cut
 * (`slice`, and the unzoned branch above it) and by the delta lane (`keptChildIds`) alike.
 *
 * It is one function rather than two agreeing copies because the copies once did not agree:
 * a rule that landed in `slice` alone shipped geometry on every reveal delta that a fresh
 * fetch of the same scene stripped.
 */
function childShips(
  child: AnyChild,
  layer: DungeonLayer,
  scene: SceneMap,
  kept: ReadonlySet<string>,
  doors: Doors,
  cut: Cut,
): boolean {
  // Prep never travels: a zone in a revealed room is still the DM's trap marker, and a
  // zone's position IS where the trap is.
  if (child.childType === 'zone') return false
  // A label is the DM's unless it is marked for players: a GM note, a trap's name, a room
  // title the party has not learned. Marked ones then follow the room rule like any child.
  if (child.childType === 'text' && child.players !== true) return false
  // Plateaus are relief, like terrain: they always ship with their layer, so a player reads the
  // same heights the DM does. Ground pieces are terrain too (table fix pass §2.7).
  if (child.childType === 'plateau') return true
  if (child.childType === 'shape' && child.ground === true) return true
  // Fog off: everything else ships, and an unfound secret door still does not exist.
  if (cut.open) return child.childType !== 'door' || doorFound(child, doors)
  // With no room on the layer there is nothing to earn and nothing for a contour to fence.
  //
  // A door with no room to be bound to can never be earned, and the player's door marks are
  // drawn *above* the fog mask on the strength of a player only ever holding doors they
  // earned. Handing them over anyway put three marks at full brightness on a canvas that was
  // otherwise black, which is the door positions disclosed by exactly the styling PRODUCT
  // principle 2 says must never carry it.
  if (!layer.rooms?.length && !hasHiddenGround(scene.data)) return child.childType !== 'door'
  const levelId = levelIdOf(scene.data, layer)
  return child.childType === 'door'
    ? doorKept(child, kept, doors, cut.ground, outsideFace(scene, child), levelId, cut.inside)
    : childKept(child, scene, cut, levelId)
}

/**
 * Which room a child belongs to.
 *
 * A prop, a light or a piece of text is judged by where it stands, and its centre is that.
 * A floor shape is not, and judging one by its centre is what the Goblin Warren caught: a
 * cave floor is one concave contour spanning eight rooms whose bounding-box centre lands on
 * rock inside none of them (`centreOf`'s own ponytail note predicted exactly this), so the
 * whole cave floor was withheld from every player at every reveal — and with it every wall
 * band, which core draws off the merged floor ring the shape children make. Their cave read
 * as bare black inside rooms the referee had lit.
 *
 * So a shape is kept when it *covers* a room the party has earned, tested by the room's own
 * vertices rather than the shape's: rooms are detected out of the floor and inset by half a
 * wall band, so a room's vertices lie inside the floor it came from, while the shape's lie on
 * its rim, outside every room.
 *
 * Whole, not clipped — a shape whose centre happens to land in an explored room already
 * travels whole across every room it spans, so this widens no boundary that was not already
 * there; it only stops the answer turning on where a concave outline's bounding box happens
 * to have its middle. Clipping it to the earned rooms would be worse than the leak: the band
 * renderer draws a wall along every ring it is given, so the cut would print a stone wall
 * across the mouth of a passage that is actually open.
 */
function childKept(child: AnyChild, scene: SceneMap, cut: Cut, levelId: string): boolean {
  const enclosed = enclosedOn(scene, levelId)
  const [x, y] = centreOf(child)
  const room = scene.roomAtOn(levelId, x, y)
  if (room !== null && cut.kept.has(room)) return true
  // Cheapest first, and by a wide margin: the ground lookup is nine bit tests against the
  // child's own cell neighbourhood, where the band test can walk a room outline per room.
  //
  // R2: a child inside a walled floor or cave is earned only by ground known inside it. Ground
  // outside the outline, a pad away across the rock, does not show what stands behind it.
  if ((enclosed(x, y) ? cut.inside : cut.ground)(x, y, cut.pad, levelId)) return true
  if (nearKeptRoom(cut, x, y, levelId)) return true
  return child.childType === 'shape' && (coversKeptRoom(child, cut, levelId) || outlineNearGround(child, cut, levelId))
}

/**
 * Table fix pass §2.7 — a walled floor or cave ships when known ground lies within the band pad
 * of its outline: the cave seen from outside (F10). Its rock is drawn along that outline, so
 * that is where a seat standing outside sees it. Outside is the word: ground cleared inside
 * another walled floor (the room next door) does not ship this one, or a cleared room would hand
 * over the floor, and the name, of every fogged room it shares a wall with.
 */
function outlineNearGround(shape: ShapeChild, cut: Cut, levelId: string): boolean {
  if (cut.outside === NO_GROUND) return false
  const [dx, dy] = shape.transform?.translate ?? [0, 0]
  return (shape.contours ?? []).some((ring) => ring.some(([x, y]) => cut.outside(x + dx, y + dy, cut.pad, levelId)))
}

/**
 * Everything the child predicate is measured against, built once per cut rather than per
 * child: the rooms the party holds with their boxes, the band those rooms reach through, and
 * the ground the brush has opened.
 *
 * The boxes are the whole reason this is a record and not four arguments. Without them the
 * predicate walked every kept room's full outline for every unzoned child — hundreds of
 * vertices times hundreds of props — and on a dressed map that put a reveal at 840ms against a
 * 200ms budget (`integration.test.ts`). A box test rejects all but a couple of rooms in four
 * comparisons.
 */
interface Cut {
  /** Fog off: the whole map ships, less what is always withheld. */
  open: boolean
  kept: ReadonlySet<string>
  pad: number
  ground: Ground
  /** The known ground inside walled floors and caves: recorded cells whose centre is inside one. */
  inside: Ground
  /** …and the rest of it, outside every walled floor and cave. */
  outside: Ground
  rooms: readonly KeptRoom[]
}

interface KeptRoom {
  /** The room's level: a child on another level is never this room's. */
  levelId: string
  boundary: readonly [number, number][]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function cutFor(
  scene: SceneMap,
  kept: ReadonlySet<string>,
  ground: Ground = NO_GROUND,
  inside: Ground = NO_GROUND,
  open = false,
  outside: Ground = NO_GROUND,
): Cut {
  const pad = bandPad(scene)
  const rooms: KeptRoom[] = []
  for (const room of scene.rooms) {
    if (!kept.has(room.id) || room.boundary.length < 3) continue
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const [x, y] of room.boundary) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    rooms.push({ levelId: scene.roomLevels.get(room.id) ?? '', boundary: room.boundary, minX, minY, maxX, maxY })
  }
  return { open, kept, pad, ground, inside, outside, rooms }
}

/**
 * "Is there cleared ground within `pad` of this point?" — see {@link groundOf}. With a level,
 * on that level's record only; without one, on any level's.
 */
export type Ground = (x: number, y: number, pad: number, levelId?: string) => boolean

/** A scene with no cell record at all: rooms are the only reveal there ever was. */
export const NO_GROUND: Ground = () => false

/**
 * Fog rework — the ground the players have, as a cheap lookup: with fog off every point, with
 * fog on the cleared cells, each level's on its own record. Brushed and swept cells are one
 * record now, so the art stamped along cleared ground (a wall band, the shrubs at its edge) is
 * the player's the moment the cell clears, and a fog stroke takes it back.
 *
 * `keep` narrows which cleared cells count (the ones inside an outline, for `insideGroundOf`).
 *
 * ponytail: bucketed, not distance-over-every-cell. The record runs to thousands of cells and
 * this is asked once per child, so it walks only the `ceil(pad)` neighbourhood of the child's
 * own cell — nine lookups at today's pad — and measures to the cell *square*, not its centre.
 */
export function groundOf(
  fog: SceneFog,
  frame: SceneMap['frame'],
  keep: (x: number, y: number, levelId: string) => boolean = () => true,
): Ground {
  if (!fogOn(fog)) return ALL_GROUND
  const records: { levelId: string; region: RegionMask; bytes: Uint8Array }[] = []
  for (const [levelId, stored] of Object.entries(fog.cleared ?? {})) {
    const region = frame ? rebaseRegion(stored, frame) : undefined
    if (region) records.push({ levelId, region, bytes: toBytes(region.bits) })
  }
  if (records.length === 0) return NO_GROUND
  return (x, y, pad, levelId) => {
    const reach = Math.ceil(pad)
    for (const { levelId: own, region, bytes } of records) {
      if (levelId !== undefined && own !== levelId) continue
      const col0 = Math.floor(x - region.minX)
      const row0 = Math.floor(y - region.minY)
      for (let col = col0 - reach; col <= col0 + reach; col++) {
        for (let row = row0 - reach; row <= row0 + reach; row++) {
          if (col < 0 || row < 0 || col >= region.cols || row >= region.rows) continue
          const bit = row * region.cols + col
          if ((bytes[bit >>> 3] & (1 << (bit & 7))) === 0) continue
          const [cx, cy] = [region.minX + col, region.minY + row]
          if (!keep(cx + 0.5, cy + 0.5, own)) continue
          const dx = Math.max(cx - x, 0, x - (cx + 1))
          const dy = Math.max(cy - y, 0, y - (cy + 1))
          if (Math.hypot(dx, dy) <= pad) return true
        }
      }
    }
    return false
  }
}

/** Fog off: every point is ground the players have. */
export const ALL_GROUND: Ground = () => true

/**
 * Every child id a player is entitled to hold right now — literally `childShips`, the function
 * the document cut calls, so what a reveal *delivers* and what a fresh fetch *contains* cannot
 * drift. Keep it that way: the moment this grows a rule of its own the two are two rules again.
 *
 * `vision.ts` diffs this across mutations to find the children a brush stroke just earned; the
 * room slice covers the rest.
 */
export function keptChildIds(
  scene: SceneMap,
  fog: SceneFog,
  doors: Doors,
  ground: Ground = groundOf(fog, scene.frame),
): Set<string> {
  const kept = heldRooms(scene, fog)
  const cut = cutFor(scene, kept, ground, insideGroundOf(scene, fog), !fogOn(fog), outsideGroundOf(scene, fog))
  const ids = new Set<string>()
  for (const layer of scene.data.layers) {
    if (!isDungeon(layer)) continue
    for (const child of childrenOf(layer)) {
      if (childShips(child, layer, scene, kept, doors, cut)) ids.add(child.id)
    }
  }
  return ids
}

/**
 * A child standing in an explored room's *wall band* belongs to that room (D5).
 *
 * The band is where the room's own walls are drawn, and on a dressed map it is not drawn with
 * `standaloneWalls` at all — it is stamped, one asset child per piece, from the wall-variant
 * families (`wall_short_2x4`, `inside_bend_5x3`, `outside_bend_3x3`…). Room detection insets a
 * room's polygon by half a band, so *every one of those pieces* sits on unzoned map by the
 * centre test and went to nobody: the Goblin Warren withheld 188 of them from a player who had
 * explored six of its rooms, and the cave they were standing in drew as a floor with a plain
 * dark edge where the referee sees painted rock.
 *
 * The radius is not a guess and not a taste: it is `fogPad`, the client's own — the mask cuts
 * its hole at the room's floor grown by the widest wall band plus a margin, so everything
 * inside that ring is *drawn to this player*. Shipping less than the mask opens is what leaves
 * a revealed room ringed by nothing. The two numbers have to be the same number, and this file
 * and `fog.ts` now spell it the same way.
 *
 * ponytail: measured centre-to-outline, so a piece is judged by where it is pinned rather than
 * by its footprint. Every band family on the dressed maps pins within half a cell of the floor
 * it edges (measured: 0.03–0.51 on the Warren). A huge sprite anchored a long way from its art
 * would need its own footprint tested; nothing authored today is.
 */
function nearKeptRoom(cut: Cut, x: number, y: number, levelId?: string): boolean {
  const pad = cut.pad
  for (const room of cut.rooms) {
    if (levelId !== undefined && room.levelId !== levelId) continue
    // The box first: a room whose *box* is further than the pad cannot have an outline that
    // is nearer, and skipping the walk is what keeps a reveal inside its budget.
    if (x < room.minX - pad || x > room.maxX + pad) continue
    if (y < room.minY - pad || y > room.maxY + pad) continue
    if (distanceToPoly(room.boundary, x, y) <= pad) return true
  }
  return false
}

/** Does this shape's outline enclose any part of a room the party has earned? */
function coversKeptRoom(shape: ShapeChild, cut: Cut, levelId: string): boolean {
  return cut.rooms.some((room) => room.levelId === levelId && shapeCovers(shape, room.boundary))
}

/** Does this shape's outline enclose any vertex of a room's face? */
function shapeCovers(shape: ShapeChild, boundary: readonly [number, number][]): boolean {
  const outline = shape.contours?.[0]
  if (!outline || outline.length < 3) return false
  // `centreOf` adds the translate to the shape; here the room's world vertices come back to
  // the untransformed contour instead, which is the same comparison from the other end.
  const [dx, dy] = shape.transform?.translate ?? [0, 0]
  return boundary.some(([x, y]) => pointInPoly(outline, x - dx, y - dy))
}

/*
 * R1 (rca-live.md) — the player's copy must draw exactly as the DM's wherever it draws at all.
 *
 * The engine resolves a door's pose, and every door, wall band, floor fill and room place's
 * look, from context a player's copy does not hold: the wall a door hangs on (re-snapped to the
 * nearest one when absent), the merged floor, and the rooms whose looks pin floors, walls and
 * places. Two mechanisms close that, chosen as the smallest pair that makes the parity test
 * (`parity.test.ts`) hold, and both live in this file:
 *
 * 1. Doors are baked. Each door a player is sent is resolved here against the full map and
 *    carries the result: the pose in `position` and `angle`, and the host wall's id and look in
 *    `placed`. Core draws a placed door as given, with no re-snap (`wallResolve.ts`
 *    `placedDoor`, `wallLook.ts` `doorWallLook`).
 * 2. Withheld rooms under a sent floor travel as stand-ins: the room's id, face and look (its
 *    area's pins folded in), with no name, number, anchor, area or notes, marked `standIn`. The
 *    engine reads them for floor fills, wall pins and place exactly as it reads a real room;
 *    the client's fog never counts one (`roomsOfLayers`). A later reveal sends the real room
 *    under the same id, which replaces the stand-in on merge.
 */

const placementCache = new WeakMap<SceneMap, Map<string, Pick<DoorChild, 'position' | 'angle' | 'placed'>>>()

/** Every door on the map, resolved as the DM's renderer resolves it. Once per parsed map. */
function placementsOf(scene: SceneMap): Map<string, Pick<DoorChild, 'position' | 'angle' | 'placed'>> {
  const hit = placementCache.get(scene)
  if (hit) return hit
  const out = new Map<string, Pick<DoorChild, 'position' | 'angle' | 'placed'>>()
  for (const stored of scene.data.layers) {
    if (!isDungeon(stored)) continue
    const layer = { ...stored, children: [...childrenOf(stored)], standaloneWalls: [...wallsOf(stored)] }
    const level = levelOf(scene.data.levels ?? [], layer).look
    const [style, rings, edges] = [levelStyle(layer.style, level), ringStyles(layer, level), edgeStyles(layer, level)]
    for (const resolved of resolveDoors(layer, resolveWalls(layer))) {
      const look = doorWallLook(resolved, style, rings, edges)
      out.set(resolved.door.id, {
        position: resolved.position,
        angle: resolved.angle,
        placed: {
          // A floor-ring edge has no id that survives the client's own union: '' finds it by pose.
          wallId: resolved.wall && resolved.wall.kind !== 'floor' ? resolved.wall.id : '',
          ...(resolved.detached ? { detached: true } : {}),
          look: { ...(look.setId ? { setId: look.setId } : {}), tint: look.tint, width: look.width, corner: look.corner },
        },
      })
    }
  }
  placementCache.set(scene, out)
  return out
}

/** A door as the player is sent it: drawn where, and as, the full map draws it. */
function placed<T extends DoorChild>(scene: SceneMap, door: T): T {
  const placement = placementsOf(scene).get(door.id)
  return placement ? { ...door, ...placement } : door
}

/**
 * The rooms a slice ships: the ones it was given, plus a stand-in for every room the player does
 * not hold whose face lies under a walled floor or cave this slice sends.
 */
function withStandIns(
  campaignId: string,
  layer: DungeonLayer,
  rooms: Room[],
  children: AnyChild[],
  held: ReadonlySet<string>,
  places: Places = NO_PLACES,
): { rooms: Room[]; children: AnyChild[] } {
  const floors = children.filter((c): c is ShapeChild => c.childType === 'shape' && c.ground !== true)
  if (floors.length === 0) return { rooms, children }
  const shipped = new Set(rooms.map((room) => room.id))
  const standIns = (layer.rooms ?? [])
    .filter((room) => !held.has(room.id) && !shipped.has(room.id))
    .filter((room) => roomRing(room).length >= 3 && floors.some((floor) => shapeCovers(floor, roomRing(room))))
    .map((room) => standIn(campaignId, room, layer.areas, places[room.id]))
  // S5: areas never travel. Each shipped room carries its area's pins folded into its own look,
  // so an area's name and the grouping of rooms nobody explored stay the DM's.
  const own = rooms.map((room) => withAreaFolded(room, layer.areas))
  return { rooms: standIns.length ? [...own, ...standIns] : own, children }
}

/** A room's look with its area's pins folded in (room pins win, the chain's own order), and no area. */
function withAreaFolded(room: Room, areas: readonly RoomArea[] | undefined): Room {
  if (!room.areaId) return room
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured away on purpose
  const { areaId: _areaId, ...rest } = room
  const look = foldedLook(room, areas)
  return Object.keys(look).length > 0 ? { ...rest, look } : rest
}

function foldedLook(room: Room, areas: readonly RoomArea[] | undefined): NonNullable<Room['look']> {
  const area = room.areaId ? areas?.find((a) => a.id === room.areaId) : undefined
  return { ...area?.look, ...room.look }
}

/**
 * A stand-in's id: opaque, so no readable room id (`room-chief`) travels with it. Keyed on this
 * process's secret, the campaign and the room, so it is stable for as long as the server runs;
 * the client also drops a stand-in when anything arrives with its face (`mergeMapDelta`).
 */
const STAND_IN_SALT = randomBytes(16)
const standInId = (campaignId: string, roomId: string): string =>
  `standin-${createHmac('sha256', STAND_IN_SALT).update(`${campaignId}:${roomId}`).digest('hex').slice(0, 16)}`

/** The DM's live place overrides, by real room id (`roomEditsOf`). */
export type Places = Readonly<Record<string, Environment>>
const NO_PLACES: Places = {}

/**
 * The stand-ins a seat holds, re-sent whole when the DM moves a live place (the stand-in's baked
 * place moved with it). Null when no stand-in ships.
 */
export function standInDeltaFor(
  scene: SceneMap,
  sceneId: string,
  fog: SceneFog,
  doors: Doors,
  ground: Ground,
  places: Places,
): MapDelta | null {
  const doc = redactMapForViewer(scene, fog, doors, ground, undefined, places)
  const layers = doc.layers
    .filter(isDungeon)
    .map((layer) => ({ id: layer.id, rooms: (layer.rooms ?? []).filter((room) => room.standIn), children: [] as AnyChild[], standaloneWalls: [] as WallSegment[] }))
    .filter((layer) => layer.rooms.length > 0)
  return layers.length ? { sceneId, layers } : null
}

/** A withheld room as the engine needs it to draw the floor around it: face and look, nothing more. */
function standIn(campaignId: string, room: Room, areas: readonly RoomArea[] | undefined, live?: Environment): Room {
  // The DM's live place for the room wins, as it does on the DM's own table (`tableRoomPlaces`,
  // keyed by the real id the stand-in no longer carries).
  const look = { ...foldedLook(room, areas), ...(live ? { place: live } : {}) }
  const boundary = roomRing(room)
  return {
    id: standInId(campaignId, room.id),
    name: '',
    // Not the authored anchor: any point of the face serves, and the face is already sent.
    anchor: boundary[0],
    boundary,
    standIn: true,
    ...(Object.keys(look).length > 0 ? { look } : {}),
  }
}

/**
 * A door is the property of the rooms it joins: one the player has seen keeps it, and a
 * door bound to neither (the map never zoned it) is unzoned map, which is DM-only. The one
 * rule behind both the geometry cut and the live doors slice a player is sent.
 */
function doorBound(door: AuthoredDoor, kept: ReadonlySet<string>): boolean {
  return (!!door.roomA && kept.has(door.roomA)) || (!!door.roomB && kept.has(door.roomB))
}

/**
 * …and a secret door does not exist at all until the DM says so. Table fix pass §2.7: a door
 * with an outside face is also kept when known ground lies within one cell of it, so the door
 * of a room nobody entered is seen from outside. R2: a door has an outside face only when one of
 * its sides is outdoor ground (`outsideFace`); a door between two rooms of a cave, or with the
 * cave's own floor on both sides, has none, whatever its room binding says.
 */
export function doorKept(
  door: DoorChild,
  kept: ReadonlySet<string>,
  doors: Doors,
  ground: Ground = NO_GROUND,
  outside = true,
  levelId?: string,
  inside: Ground = NO_GROUND,
): boolean {
  if (!doorFound(door, doors)) return false
  if (doorBound(door, kept)) return true
  const [x, y] = door.position
  if (outside) return (!door.roomA || !door.roomB) && ground(x, y, 1, levelId)
  // Fog rework: a door bound to no room inside a cave is seen from the cave ground cleared
  // beside it, never from outside the rock.
  return !door.roomA && !door.roomB && inside(x, y, 1, levelId)
}

/** Whether a door exists for a player at all: an unfound secret door does not. */
function doorFound(door: DoorChild, doors: Doors): boolean {
  const live = doors[door.id] ?? seedDoor(door)
  return !(door.isSecret && !live.revealed)
}

/** How far off its wall each side of a door is probed for outdoor ground, cells (`bindDoorToRooms`'s). */
const DOOR_PROBE = 0.5

/**
 * R2 — whether one side of a door is outdoor ground: outside every walled floor and cave outline
 * of the door's level, probed off the door where the full map resolves it.
 */
export function outsideFace(scene: SceneMap, door: DoorChild): boolean {
  const placement = placementsOf(scene).get(door.id)
  const [px, py] = placement?.position ?? door.position
  const angle = placement?.angle ?? door.angle
  const enclosed = enclosedOn(scene, doorLevelsOf(scene).get(door.id) ?? firstLevelId(scene.data))
  const [nx, ny] = [-Math.sin(angle) * DOOR_PROBE, Math.cos(angle) * DOOR_PROBE]
  return !enclosed(px + nx, py + ny) || !enclosed(px - nx, py - ny)
}

const doorLevelCache = new WeakMap<SceneMap, Map<string, string>>()

/** The level of every door's layer, by door id. */
function doorLevelsOf(scene: SceneMap): Map<string, string> {
  let out = doorLevelCache.get(scene)
  if (out) return out
  out = new Map()
  for (const layer of scene.data.layers) {
    if (!isDungeon(layer)) continue
    for (const child of childrenOf(layer)) if (child.childType === 'door') out.set(child.id, levelIdOf(scene.data, layer))
  }
  doorLevelCache.set(scene, out)
  return out
}

/** The cleared ground outside every walled floor and cave of its own level. */
function outsideGroundOf(scene: SceneMap, fog: SceneFog): Ground {
  return groundOf(fog, scene.frame, (x, y, levelId) => !enclosedOn(scene, levelId)(x, y))
}

/** The cleared ground inside walled floors and caves: cleared cells whose centre lies inside one of their own level. */
function insideGroundOf(scene: SceneMap, fog: SceneFog): Ground {
  return groundOf(fog, scene.frame, (x, y, levelId) => enclosedOn(scene, levelId)(x, y))
}

/**
 * A door on the edge of the known world keeps only the side the player has been. The far
 * side's id names a room nobody has earned yet, which is itself a disclosure; `null` is the
 * shape the map already uses for "leads outside".
 *
 * The authored name goes with the binding, and for the same reason: "Reliquary Door" in the
 * wall of the one room a party has entered names what is behind it as plainly as the id
 * does, and the editor names doors after their rooms because that is what a DM would call
 * them. Blank, not renamed — the client's own `doorLabel` already falls back to "Door N",
 * which is exactly what a player standing in front of it knows.
 */
function facing<T extends DoorChild>(door: T, kept: ReadonlySet<string>): T {
  const unearned = (room: string | null | undefined) => !!room && !kept.has(room)
  return {
    ...door,
    name: unearned(door.roomA) || unearned(door.roomB) ? '' : door.name,
    roomA: door.roomA && kept.has(door.roomA) ? door.roomA : null,
    roomB: door.roomB && kept.has(door.roomB) ? door.roomB : null,
  }
}

