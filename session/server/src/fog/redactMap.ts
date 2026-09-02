// §2.3.1 — the map a player is allowed to hold, and the slice of it a reveal hands over.
//
// The two-tier geometry policy of D4 in one sentence: a room the party has *ever* seen
// keeps its geometry forever (without it, a reload renders explored rooms black), and a
// room nobody has entered has none of it — no floor, no walls, no props, not even the id.
// Unzoned map is the DM's alone (D6) and an unrevealed secret door does not exist.

import { seedDoor, type AuthoredDoor, type DoorLiveState } from '@dnd/mechanics/doors'
import {
  fogModeOf,
  regionOf,
  setCells,
  tableRegion,
  toBytes,
  type Cell,
  type RegionMask,
  type SceneFog,
} from '@dnd/mechanics/fog'
import type {
  AnyChild,
  ConnectorChild,
  DoorChild,
  Room,
  ShapeChild,
  WallSegment,
} from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design, same waiver sceneMap.ts takes (see its header)
import { connectorToDoor } from '@dnd/core/src/shared/authoredRooms'
import {
  centreOf,
  shippableChildren,
  distanceToPoly,
  isDungeon,
  pointInPoly,
  wallsOf,
  type SceneMap,
} from './sceneMap'
import { exploreLocks, inAnyLock } from './sweep'

/** One layer's worth of newly available geometry, shaped to be merged by layer id. */
export interface MapDeltaLayer {
  id: string
  rooms: Room[]
  children: AnyChild[]
  standaloneWalls: WallSegment[]
}

/**
 * §2.1/D5 — rides on the `fog` state-update that reveals the rooms it carries, so a client
 * never knows a room is revealed before it has the geometry to draw. Placement JSON only:
 * textures shipped with the asset packs at join.
 */
export interface MapDelta {
  sceneId: string
  layers: MapDeltaLayer[]
  /**
   * The re-cut `lockMask` (see {@link lockMaskFor}), when this delta credits rooms — the same
   * debt D5 makes a reveal pay for geometry, for the same reason. The mask is cut against the
   * rooms a seat holds, a reveal is what grows that set, and nothing else re-cuts a connected
   * seat's document: `mergeMapDelta` patches layers and the client re-fetches only on a join,
   * a scene swap, a republish or a mode flip. Without this the newly shipped room's locked
   * ground would have art, no fence, and no correction ever coming.
   */
  lockMask?: RegionMask
}

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
): SerializedMapData {
  const kept = exploredRooms(fog)
  // The confining rectangle of the *full* document, measured with the index and so before
  // any cut (`SceneMap.frame`): the player's
  // fog covers the whole frame, and their redacted layers can no longer measure it. A rect
  // leaks only the map's overall size — never where inside it anything is. Only stamped
  // when the map has fog to enforce (rooms); an unzoned map goes over whole and untouched.
  const zoned = scene.data.layers.some((l) => isDungeon(l) && (l.rooms?.length ?? 0) > 0)
  // …and a vision-mode scene needs the rectangle whether or not anyone zoned the map. The
  // player's mask is drawn over exactly this, and a roomless map that shipped without one
  // left the mask no finite territory to cover — the very case the brush exists for.
  const framed = zoned || fogModeOf(fog) === 'vision'
  // Scene prep is the DM's notes — trigger definitions, trap DCs, the lot. It never
  // reaches a player in any form, revealed or not.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured away on purpose
  const { prep: _prep, ...docSansPrep } = scene.data
  // Built once for the whole document, not once per layer: the ground lookup decodes the
  // region record, and the room boxes are a walk over every kept boundary.
  const cut = cutFor(scene, kept, groundOf(fog, scene.frame))
  const lockMask = lockMaskFor(scene, fog, kept)
  return {
    ...docSansPrep,
    ...(framed ? { frame: scene.frame } : {}),
    ...(lockMask ? { lockMask } : {}),
    layers: scene.data.layers.map((layer) => {
      if (!isDungeon(layer)) return layer
      // A layer nobody zoned has no fog to enforce — room-granular fog needs rooms (D6) — so
      // its geometry goes over whole, less what `childShips` withholds on that branch.
      if (!layer.rooms?.length) {
        const kids = shippableChildren(layer)
        const shipped = kids.filter((child) => childShips(child, layer, scene, kept, doors, cut))
        // Untouched when there was nothing to take, so a layer with no doors stays the very
        // object it arrived as rather than growing an empty `children` it never had.
        return shipped.length === kids.length ? layer : { ...layer, children: shipped }
      }
      return {
        ...layer,
        ...slice(layer, scene, kept, doors, kept, cut),
        // The merged floor is one union across the whole layer, so it cannot be cut per
        // room — and handing it over would outline every room in the dungeon. The client
        // rebuilds it from the children it has; the editor already ships it null.
        mergedFloor: null,
        roomNameOverrides: pick(layer.roomNameOverrides ?? {}, kept),
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
 * party has already earned, so it keeps both bindings. Doors and joints are faced — a blob
 * carries the same bindings its twin does and would otherwise name the room behind it.
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
        rooms: [] as Room[],
        children: shippableChildren(layer)
          .filter((child) => childIds.has(child.id))
          .map((child) =>
            child.childType === 'door' || child.childType === 'connector'
              ? facing(child, kept)
              : child,
          ) as AnyChild[],
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
 * FOG_MARGIN and the default wall width, from the client's `fogPad` — the *same* two numbers,
 * because this is the same distance measured from the other side. See `nearKeptRoom`.
 *
 * These are HAND-COPIES of `session/client/src/modules/fog/fog.ts:152` (`FOG_MARGIN`) and
 * `:155` (`DEFAULT_WALL_WIDTH`). Nothing enforces the equality — no shared module, no test. If
 * they drift, this file ships geometry by one pad while the client's mask cuts by another: too
 * small here and the seat is missing art the mask has already opened (a hole in the world);
 * too large and the seat holds map its mask never covers. Change one, change the other, in the
 * same commit.
 */
const FOG_MARGIN = 0.5
const DEFAULT_WALL_WIDTH = 0.5

/** The widest wall band on the map plus its margin — `fogPad`, computed off the same styles. */
function bandPad(scene: SceneMap): number {
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
    rooms: (layer.rooms ?? []).filter((room) => kept.has(room.id)),
    children: shippableChildren(layer)
      .filter((child) => childShips(child, layer, scene, kept, doors, cut))
      // A joint on the edge of the known world keeps only the side the party has been,
      // exactly as the door twin it also ships as does — the blob carries the same
      // bindings and would otherwise name the room behind it.
      .map((child) =>
        child.childType === 'door' || child.childType === 'connector'
          ? facing(child, facingSet)
          : child,
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
 * It is one function rather than two agreeing copies because the copies did not agree. W2's
 * room and connector rules landed in `slice` only, so the comment over `keptChildIds`
 * promising the two "cannot drift" was a promise with no mechanism behind it: every reveal
 * delta shipped the contour of every drawn room on the layer, earned or not, and every blob
 * on the map, while a fresh fetch of the same scene stripped exactly those.
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
  // With no room on the layer there is nothing to earn and nothing for a contour to fence.
  //
  // A door with no room to be bound to can never be earned, and the player's door marks are
  // drawn *above* the fog mask on the strength of a player only ever holding doors they
  // earned. Handing them over anyway put three marks at full brightness on a canvas that was
  // otherwise black, which is the door positions disclosed by exactly the styling PRODUCT
  // principle 2 says must never carry it. Rooms and joints go with them: their outlines
  // would be pure disclosure.
  if (!layer.rooms?.length) {
    return (
      child.childType !== 'door' && child.childType !== 'room' && child.childType !== 'connector'
    )
  }
  // A drawn room's contour and the blob that opens it are occluders (O1/O2), and the table
  // sweeps its own copy — so they travel, fenced by exactly the credit that already fences
  // the `Room` this contour is a duplicate of. An unearned room's outline never leaves the DM.
  if (child.childType === 'room') return kept.has(child.id)
  // A joint ships on its twin's rule and no second one. Testing the bindings alone read the
  // same on an ordinary joint and wrongly on a secret one: the blob of a secret passage went
  // over the wire while the door child that names it was withheld, leaving a state-frozen
  // hole in the player's compositor that no drift entry would ever close.
  if (child.childType === 'connector') return doorKept(connectorToDoor(child), kept, doors)
  return child.childType === 'door' ? doorKept(child, kept, doors) : childKept(child, scene, cut)
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
function childKept(child: AnyChild, scene: SceneMap, cut: Cut): boolean {
  const [x, y] = centreOf(child)
  const room = scene.roomAt(x, y)
  if (room !== null && cut.kept.has(room)) return true
  // Cheapest first, and by a wide margin: the ground lookup is nine bit tests against the
  // child's own cell neighbourhood, where the band test can walk a room outline per room.
  if (cut.ground(x, y, cut.pad)) return true
  if (nearKeptRoom(cut, x, y)) return true
  return child.childType === 'shape' && coversKeptRoom(child, cut)
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
  return { kept, pad, ground, rooms }
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
export function groundOf(fog: SceneFog, frame: SceneMap['frame']): Ground {
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
export function keptChildIds(scene: SceneMap, fog: SceneFog, doors: Doors): Set<string> {
  const kept = exploredRooms(fog)
  const cut = cutFor(scene, kept, groundOf(fog, scene.frame))
  const ids = new Set<string>()
  for (const layer of scene.data.layers) {
    if (!isDungeon(layer)) continue
    for (const child of shippableChildren(layer)) {
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
  const outline = shape.contours?.[0]
  if (!outline || outline.length < 3) return false
  // `centreOf` adds the translate to the shape; here the room's world vertices come back to
  // the untransformed contour instead, which is the same comparison from the other end.
  const [dx, dy] = shape.transform?.translate ?? [0, 0]
  return cut.rooms.some((room) =>
    room.boundary.some(([x, y]) => pointInPoly(outline, x - dx, y - dy)),
  )
}

/**
 * A door is the property of the rooms it joins: one the player has seen keeps it, and a
 * door bound to neither (the map never zoned it) is unzoned map, which is DM-only. The one
 * rule behind both the geometry cut and the live doors slice a player is sent.
 */
function doorBound(door: AuthoredDoor, kept: ReadonlySet<string>): boolean {
  return (!!door.roomA && kept.has(door.roomA)) || (!!door.roomB && kept.has(door.roomB))
}

/** …and a secret door does not exist at all until the DM says so. */
export function doorKept(door: DoorChild, kept: ReadonlySet<string>, doors: Doors): boolean {
  const live = doors[door.id] ?? seedDoor(door)
  if (door.isSecret && !live.revealed) return false
  return doorBound(door, kept)
}

/**
 * A door on the edge of the known world keeps only the side the player has been. Room ids
 * are a hash of the room's centroid, so the far side's id is a coordinate nobody has
 * earned yet; `null` is the shape the map already uses for "leads outside".
 *
 * The authored name goes with the binding, and for the same reason: "Reliquary Door" in the
 * wall of the one room a party has entered names what is behind it as plainly as the id
 * does, and the editor names doors after their rooms because that is what a DM would call
 * them. Blank, not renamed — the client's own `doorLabel` already falls back to "Door N",
 * which is exactly what a player standing in front of it knows.
 */
function facing<T extends DoorChild | ConnectorChild>(door: T, kept: ReadonlySet<string>): T {
  const unearned = (room: string | null | undefined) => !!room && !kept.has(room)
  return {
    ...door,
    name: unearned(door.roomA) || unearned(door.roomB) ? '' : door.name,
    roomA: door.roomA && kept.has(door.roomA) ? door.roomA : null,
    roomB: door.roomB && kept.has(door.roomB) ? door.roomB : null,
  }
}

function pick(names: Record<string, string>, kept: ReadonlySet<string>): Record<string, string> {
  const seen: Record<string, string> = {}
  for (const [roomId, name] of Object.entries(names)) if (kept.has(roomId)) seen[roomId] = name
  return seen
}
