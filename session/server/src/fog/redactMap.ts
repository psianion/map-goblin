// §2.3.1 — the map a player is allowed to hold, and the slice of it a reveal hands over.
//
// The two-tier geometry policy of D4 in one sentence: a room the party has *ever* seen
// keeps its geometry forever (without it, a reload renders explored rooms black), and a
// room nobody has entered has none of it — no floor, no walls, no props, not even the id.
// Unzoned map is the DM's alone (D6) and an unrevealed secret door does not exist.

import { createHmac, randomBytes } from 'node:crypto'
import { seedDoor, type AuthoredDoor, type DoorLiveState } from '@dnd/mechanics/doors'
import {
  DEFAULT_WALL_WIDTH,
  FOG_MARGIN,
  fogModeOf,
  regionOf,
  setCells,
  tableRegion,
  toBytes,
  type Cell,
  type RegionMask,
  type SceneFog,
} from '@dnd/mechanics/fog'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the engine's own door resolve, run on the full map
import { resolveDoors, resolveWalls } from '@dnd/core/src/shared/wallResolve'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the wall looks the door renderer reads
import { doorWallLook, edgeStyles, levelStyle, ringStyles } from '@dnd/core/src/shared/wallLook'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the look chain
import { levelOf } from '@dnd/core/src/shared/lookScope'
import type {
  AnyChild,
  DoorChild,
  Room,
  RoomArea,
  ShapeChild,
  WallSegment,
} from '@dnd/core/src/shared/types'
import type { MapDelta } from '@dnd/core/src/shared/protocol'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
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
import { exploreLocks, inAnyLock } from './sweep'
import { enclosedOn, hasHiddenGround } from './outdoorGround'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the Lighting pass's level rules
import { firstLevelId, levelIdOf } from '@dnd/core/src/shared/visionGate'

type Doors = Record<string, DoorLiveState>

/** Rooms the party has ever seen — the geometry a player keeps (D4). */
export function exploredRooms(fog: SceneFog): Set<string> {
  const explored = new Set<string>()
  for (const [roomId, room] of Object.entries(fog.rooms)) {
    if (room.wasEverRevealed) explored.add(roomId)
  }
  return explored
}

/** The player's copy of a scene's map. The DM's copy is the file, untouched. */
export function redactMapForViewer(
  scene: SceneMap,
  fog: SceneFog,
  doors: Doors,
  ground: Ground = groundOf(fog, scene.frame),
  openGround?: SerializedMapData['openGround'],
): SerializedMapData {
  const kept = exploredRooms(fog)
  // The confining rectangle of the *full* document, measured with the index and so before
  // any cut (`SceneMap.frame`): the player's
  // fog covers the whole frame, and their redacted layers can no longer measure it. A rect
  // leaks only the map's overall size — never where inside it anything is. Only stamped
  // when the map has fog to enforce (rooms); an unzoned map goes over whole and untouched.
  const zoned = scene.data.layers.some((l) => isDungeon(l) && (l.rooms?.length ?? 0) > 0)
  // R3: a map with ground pieces or base ground has ground to hide with no room at all, so it is
  // framed and cut like a zoned one; only an imported picture goes over whole.
  const hidden = hasHiddenGround(scene.data)
  // …and a vision-mode scene needs the rectangle whether or not anyone zoned the map. The
  // player's mask is drawn over exactly this, and a roomless map that shipped without one
  // left the mask no finite territory to cover — the very case the brush exists for.
  const framed = zoned || hidden || fogModeOf(fog) === 'vision'
  // Scene prep is the DM's notes — trigger definitions, trap DCs, the lot. It never
  // reaches a player in any form, revealed or not.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured away on purpose
  const { prep: _prep, ...docSansPrep } = scene.data
  // Built once for the whole document, not once per layer: the ground lookup decodes the
  // region record, and the room boxes are a walk over every kept boundary.
  const cut = cutFor(scene, kept, ground, insideGroundOf(scene, fog))
  const lockMask = lockMaskFor(scene, fog, kept)
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
    ...(lockMask ? { lockMask } : {}),
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
        ...slice(layer, scene, kept, doors, kept, cut),
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
): MapDelta {
  const kept = new Set(rooms)
  return {
    sceneId,
    layers: scene.data.layers
      .filter(isDungeon)
      .map((layer) => ({ id: layer.id, ...slice(layer, scene, kept, doors, explored) }))
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
): { rooms: Room[]; children: AnyChild[]; standaloneWalls: WallSegment[] } {
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
    ),
    // A wall belongs to the rooms on either side of it, so one shared with a room the
    // player has seen survives — it is that room's own outline either way.
    standaloneWalls: wallsOf(layer).filter((wall) =>
      scene.roomsAlong(wall).some((room) => kept.has(room)),
    ),
  }
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
  // With no room on the layer there is nothing to earn and nothing for a contour to fence.
  //
  // A door with no room to be bound to can never be earned, and the player's door marks are
  // drawn *above* the fog mask on the strength of a player only ever holding doors they
  // earned. Handing them over anyway put three marks at full brightness on a canvas that was
  // otherwise black, which is the door positions disclosed by exactly the styling PRODUCT
  // principle 2 says must never carry it.
  if (!layer.rooms?.length && !hasHiddenGround(scene.data)) return child.childType !== 'door'
  return child.childType === 'door'
    ? doorKept(child, kept, doors, cut.ground, outsideFace(scene, child))
    : childKept(child, scene, cut, enclosedOn(scene, levelIdOf(scene.data, layer)))
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
function childKept(child: AnyChild, scene: SceneMap, cut: Cut, enclosed: (x: number, y: number) => boolean): boolean {
  const [x, y] = centreOf(child)
  const room = scene.roomAt(x, y)
  if (room !== null && cut.kept.has(room)) return true
  // Cheapest first, and by a wide margin: the ground lookup is nine bit tests against the
  // child's own cell neighbourhood, where the band test can walk a room outline per room.
  //
  // R2: a child inside a walled floor or cave is earned only by ground known inside it. Ground
  // outside the outline, a pad away across the rock, does not show what stands behind it.
  if ((enclosed(x, y) ? cut.inside : cut.ground)(x, y, cut.pad)) return true
  if (nearKeptRoom(cut, x, y)) return true
  return child.childType === 'shape' && (coversKeptRoom(child, cut) || outlineNearGround(child, cut))
}

/**
 * Table fix pass §2.7 — a walled floor or cave ships when known ground lies within the band pad
 * of its outline: the cave seen from outside (F10). Its rock is drawn along that outline, so
 * that is where a seat standing outside sees it.
 */
function outlineNearGround(shape: ShapeChild, cut: Cut): boolean {
  if (cut.ground === NO_GROUND) return false
  const [dx, dy] = shape.transform?.translate ?? [0, 0]
  return (shape.contours ?? []).some((ring) => ring.some(([x, y]) => cut.ground(x + dx, y + dy, cut.pad)))
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
  kept: ReadonlySet<string>
  pad: number
  ground: Ground
  /** The known ground inside walled floors and caves: recorded cells whose centre is inside one. */
  inside: Ground
  rooms: readonly KeptRoom[]
}

interface KeptRoom {
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
    rooms.push({ boundary: room.boundary, minX, minY, maxX, maxY })
  }
  return { kept, pad, ground, inside, rooms }
}

/** "Is there revealed ground within `pad` of this point?" — see {@link groundOf}. */
export type Ground = (x: number, y: number, pad: number) => boolean

/** A scene with no cell record at all: rooms are the only reveal there ever was. */
export const NO_GROUND: Ground = () => false

/**
 * Ground the table has earned by the cell brush and by its own sight, as a cheap lookup.
 *
 * A room is not the only way ground becomes a player's. The referee's brush paints cells, and
 * since c2bc9ff a player can *stand* on the ones it paints — but redaction went on treating
 * rooms as the only reveal, so art stamped along brushed ground shipped to nobody. On the
 * Goblin Warren that was the corridor's whole east side and the shrubs at the palisade's foot:
 * the west side rendered only because it happens to fall inside Cave Mouth's own band. Third
 * time this blind spot has been found (sight, then walkability, now art), so the rule is
 * spelled the same way for all three: brushed cells are a reveal.
 *
 * `tableRegion` rather than `fog.region`: geometry ships per scene, not per seat — "any seat's
 * sweep latches a room for the table" (`autoExplorePatch`) — so the union of the seats is the
 * honest input, and it is the same record the referee's own wash is drawn from. Not latched,
 * on purpose: a `region-hide` takes the ground back, and the next document build stops
 * carrying its art, which is redaction shrinking the way it should.
 *
 * ponytail: bucketed, not distance-over-every-cell. The record runs to thousands of cells and
 * this is asked once per child, so it walks only the `ceil(pad)` neighbourhood of the child's
 * own cell — nine lookups at today's pad — and measures to the cell *square*, not its centre.
 */
export function groundOf(
  fog: SceneFog,
  frame: SceneMap['frame'],
  keep: (x: number, y: number) => boolean = () => true,
): Ground {
  const region = tableRegion(fog, frame ?? undefined)
  if (!region) return NO_GROUND
  const bytes = toBytes(region.bits)
  const on = (col: number, row: number): boolean => {
    if (col < 0 || row < 0 || col >= region.cols || row >= region.rows) return false
    const bit = row * region.cols + col
    return (bytes[bit >>> 3] & (1 << (bit & 7))) !== 0
  }
  return (x, y, pad) => {
    const reach = Math.ceil(pad)
    const col0 = Math.floor(x - region.minX)
    const row0 = Math.floor(y - region.minY)
    for (let col = col0 - reach; col <= col0 + reach; col++) {
      for (let row = row0 - reach; row <= row0 + reach; row++) {
        if (!on(col, row)) continue
        const [cx, cy] = [region.minX + col, region.minY + row]
        if (!keep(cx + 0.5, cy + 0.5)) continue
        const dx = Math.max(cx - x, 0, x - (cx + 1))
        const dy = Math.max(cy - y, 0, y - (cy + 1))
        if (Math.hypot(dx, dy) <= pad) return true
      }
    }
    return false
  }
}

/**
 * The auto-explore locks a player's own mask has to fence its near pass with, as cells.
 *
 * Zones are prep and never travel (`slice`, "prep never travels"), so a seat has no way to
 * derive them — and without them a contained near pass clears fog over ground the referee
 * refuses to write (`sweep.ts`'s `seen`, `vision.ts`'s `swept`), permanently, because the
 * server never sends a correction for a cell it declined to grant. So the zones' *cells* ride
 * the document instead: the same `inAnyLock` test the referee applies, evaluated on the cell
 * centres `cellsCoveredByPolygon` counts by, so the fence and the refusal are the same shape.
 *
 * Intersected with the ground this seat actually holds art for, and that is the privacy half:
 * a lock in a room nobody has earned would put its position on the wire. On a zoned map that
 * is the kept rooms and their band (`nearKeptRoom` — the client's own `shippedGround` grows
 * the room polygons by the very same pad), and nothing outside it needs a fence anyway, since
 * `inverseShipped` already refuses to open ground with no art under it. A roomless map ships
 * its image whole (#114), so every lock cell on it is one the near pass could otherwise open.
 *
 * Vision mode only — containment is a vision-mode feature and rooms mode reads none of this —
 * and absent entirely when the map locks nothing, which is nearly every map.
 *
 * ponytail: scanned over the locks' own bounding box rather than the frame, because a frame
 * runs to `REGION_CELL_MAX` (262144 cells) and the zones on it are a few dozen cells across.
 */
export function lockMaskFor(
  scene: SceneMap,
  fog: SceneFog,
  kept: ReadonlySet<string>,
): RegionMask | undefined {
  if (fogModeOf(fog) !== 'vision' || !scene.frame) return undefined
  const locks = exploreLocks(scene.zones)
  const box = lockBox(locks)
  const mask = box && regionOf(scene.frame)
  if (!box || !mask) return undefined
  // A map with rooms fences by the rooms this seat holds; a roomless one ships whole, so
  // every lock cell counts.
  const cut = scene.rooms.length > 0 ? cutFor(scene, kept) : null
  const cells: Cell[] = []
  const from = (v: number, origin: number) => Math.max(0, Math.floor(v - origin))
  for (let row = from(box.minY, mask.minY); row < Math.min(mask.rows, Math.ceil(box.maxY - mask.minY)); row++) {
    for (let col = from(box.minX, mask.minX); col < Math.min(mask.cols, Math.ceil(box.maxX - mask.minX)); col++) {
      const [x, y] = [mask.minX + col + 0.5, mask.minY + row + 0.5]
      if (!inAnyLock(locks, x, y)) continue
      if (cut) {
        const room = scene.roomAt(x, y)
        if (!(room !== null && cut.kept.has(room)) && !nearKeptRoom(cut, x, y)) continue
      }
      cells.push([col, row])
    }
  }
  return cells.length > 0 ? setCells(mask, cells) : undefined
}

/** The one box every lock zone fits in, or null when the map locks nothing. */
function lockBox(
  locks: ReturnType<typeof exploreLocks>,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const shape of locks) {
    const [x0, y0, x1, y1] =
      shape.kind === 'circle'
        ? [
            shape.position.x - shape.radius,
            shape.position.y - shape.radius,
            shape.position.x + shape.radius,
            shape.position.y + shape.radius,
          ]
        : shape.kind === 'rect'
          ? [shape.x, shape.y, shape.x + shape.width, shape.y + shape.height]
          : [Infinity, Infinity, -Infinity, -Infinity]
    minX = Math.min(minX, x0)
    minY = Math.min(minY, y0)
    maxX = Math.max(maxX, x1)
    maxY = Math.max(maxY, y1)
  }
  return maxX > minX && maxY > minY ? { minX, minY, maxX, maxY } : null
}

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
  const kept = exploredRooms(fog)
  const cut = cutFor(scene, kept, ground, insideGroundOf(scene, fog))
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
function nearKeptRoom(cut: Cut, x: number, y: number): boolean {
  const pad = cut.pad
  for (const room of cut.rooms) {
    // The box first: a room whose *box* is further than the pad cannot have an outline that
    // is nearer, and skipping the walk is what keeps a reveal inside its budget.
    if (x < room.minX - pad || x > room.maxX + pad) continue
    if (y < room.minY - pad || y > room.maxY + pad) continue
    if (distanceToPoly(room.boundary, x, y) <= pad) return true
  }
  return false
}

/** Does this shape's outline enclose any part of a room the party has earned? */
function coversKeptRoom(shape: ShapeChild, cut: Cut): boolean {
  return cut.rooms.some((room) => shapeCovers(shape, room.boundary))
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
): { rooms: Room[]; children: AnyChild[] } {
  const floors = children.filter((c): c is ShapeChild => c.childType === 'shape' && c.ground !== true)
  if (floors.length === 0) return { rooms, children }
  const shipped = new Set(rooms.map((room) => room.id))
  const standIns = (layer.rooms ?? [])
    .filter((room) => !held.has(room.id) && !shipped.has(room.id))
    .filter((room) => roomRing(room).length >= 3 && floors.some((floor) => shapeCovers(floor, roomRing(room))))
    .map((room) => standIn(campaignId, room, layer.areas))
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

/** A withheld room as the engine needs it to draw the floor around it: face and look, nothing more. */
function standIn(campaignId: string, room: Room, areas: readonly RoomArea[] | undefined): Room {
  const look = foldedLook(room, areas)
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
): boolean {
  const live = doors[door.id] ?? seedDoor(door)
  if (door.isSecret && !live.revealed) return false
  if (doorBound(door, kept)) return true
  return outside && (!door.roomA || !door.roomB) && ground(door.position[0], door.position[1], 1)
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

/** The known ground inside walled floors and caves: recorded cells whose centre lies inside one. */
function insideGroundOf(scene: SceneMap, fog: SceneFog): Ground {
  const levels = scene.data.levels?.length ? scene.data.levels.map((l) => l.id) : [firstLevelId(scene.data)]
  const enclosures = levels.map((level) => enclosedOn(scene, level))
  return groundOf(fog, scene.frame, (x, y) => enclosures.some((enclosed) => enclosed(x, y)))
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

