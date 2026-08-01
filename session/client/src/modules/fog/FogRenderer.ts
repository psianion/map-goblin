// §2.4.1 / D10 — the *player's* fog. One mask over the whole map, rebuilt only when the
// fog, the doors or the party's rooms move.
//
// Three states, and the art guide decides what each looks like. A room nobody has entered
// — and every scrap of unzoned map (D6) — is pure black: the guide's dungeon negative
// space, not a grey wash, and black is also the only colour that survives the lighting
// pass unchanged, so a never-revealed room cannot be teased out by turning a monitor up.
// A room the party has seen but cannot see now is a memory: the same room, desaturated and
// dimmed to well under what it reads at live, so the state carries on brightness rather
// than on colour and survives a bad panel in a dim room. A room they can see is simply not
// drawn on.
//
// Where this sits is load-bearing. The engine composites lighting as a screen-space
// multiply *after* the world container (LightingRenderer adds its sprite to
// `engine.overlay()`), and this map's ambient is #0d0e12 — multiplying by that erases any
// world-space wash short of black. So the fog mounts above that composite and mirrors the
// camera instead, which is what D12 asks for in the first place: the lighting is composited
// *beneath* the fog, never recomputed for it. A revealed room fades from black to a
// finished torchlit room, never to a flat one that lights up a beat later.
//
// The brightness order is the whole point, and it is what the third browser gate found
// inverted: explored rooms read *brighter* than lit ones. The cause was that a memory was
// held out of the multiply entirely and then washed to ~35% of the raw art, while a live
// room with no torch in it kept the full multiply and landed at the map's 5% ambient. A
// fixed wash cannot sit below a floor that low without being black, so the floor is what
// moves: `LIGHTING_STRENGTH` dials the composite back, which lifts *unlit* map to somewhere
// legible while leaving anything a torch actually reaches at full strength. The memory wash
// then composites over the lit result like any other overlay, so explored is a strict
// dimming of exactly the pixels the room shows when live — the order holds by construction
// rather than by two constants agreeing, which is what let it invert in the first place.
//
// The DM is not in that hierarchy at all. PRODUCT principle 3 — the DM never loses
// visibility — makes darkness a thing the DM *stages*, never a thing imposed on them, so
// their composite is dialled to nothing and the fog state reaches them as the overlay's
// tints (FogOverlay) instead of as an unreadable stage.
//
// ponytail: pixi through @dnd/core, the same reach-through TokenRenderer documents.
import { Container, Graphics } from 'pixi.js';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import type { Room } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { useStore } from '@dnd/core/src/store/store';
import { computeMapWorldBounds } from '@dnd/core/src/engine/export/exportPipeline';
import type { AuthoredDoor, DoorLiveState, DoorsState } from '@dnd/mechanics/doors';
import {
  effectiveFog,
  visibleRooms,
  type FogRoom,
  type FogState,
  type SceneFog,
} from '@dnd/mechanics/fog';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { addScreenOverlay, mountWhenEngineReady } from '../../renderer/overlayLayer';
import { prefersReducedMotion } from '../../session/motion';
import { useSessionStore } from '../../session/store';
import type { LiveDoor } from '../doors/doors';
import { tokensOf } from '../tokens/TokenRenderer';
import {
  fogPad,
  fogRegion,
  ringsWithHoles,
  roomAt,
  roomFog,
  sceneFog,
  serverDoors,
  serverLayers,
  serverRooms,
} from './fog';

/** What the player's canvas does with one room. */
export type RoomView = 'visible' | 'explored' | 'dark';

/** D10 — the one deliberately slow beat in the product. A play beat, not decoration. */
export const REVEAL_MS = 300;

/** Art guide §5: dungeon negative space is pure black, never a grey wash. */
export const FOG_BLACK = 0x000000;
/**
 * Cold near-black: the desaturating half of the explored look, pulling warm torchlight out.
 *
 * Darker than the dimmest thing a *visible* room can be, and that is a requirement rather
 * than a preference. The wash leaves `alpha` of this colour standing wherever the art under
 * it is black, so a tint brighter than the live floor would put a memory above a lit room
 * again — the inversion, back through the other door.
 */
export const EXPLORED_TINT = 0x0b0e14;
/**
 * How much of the room's live render the wash replaces. `1 - alpha` of what the room looks
 * like *right now* survives, so a memory is always a strict dimming of the same pixels.
 *
 * Set against a browser measurement rather than against arithmetic, which is the whole
 * lesson of the fourth gate: at 0.62 over the old `#0e1118` this pair put explored at 56% of
 * the same pixels live (34.0 against 60.3, masked to the pixels the lit map draws), and the
 * product line is half. Dropping the tint a shade and lifting the alpha lands ~46% while
 * *keeping* more of the room's own texture than raising the alpha alone would: the tint does
 * more of the work and the art does less of the disappearing.
 *
 * The other two states bracket it — never-revealed measures a true 0.0 and a lit crypt runs
 * 60+ on the same mask — so the three states are three brightnesses as well as three
 * treatments, which is PRODUCT's "stale at a glance on a bad panel" without leaning on hue.
 * Chroma comes down with it (24.7 → 7.2 measured), so the warm torchlight leaves too.
 *
 * ponytail: tuned on the crypt's #0d0e12 ambient, which is the darkest map in the repo. The
 * knob to turn on a map that reads flat is this pair and `LIGHTING_STRENGTH` together — they
 * trade against each other and neither is meaningful alone.
 */
export const EXPLORED_TINT_ALPHA = 0.7;
/**
 * How hard the engine's lighting multiply is allowed to bite, per seat.
 *
 * `LightingRenderer` composites its full-screen sprite at `alpha` 0.95 and never writes that
 * field again (it only toggles `visible`), so this is a stable dial and not a fight with the
 * render loop. On a multiply the alpha is a strength: the result is `dst · lerp(1, src, a)`,
 * so a=0 is no darkening at all and a=1 is the raw ambient. Dialling it back raises the
 * floor under *unlit* map without touching what a torch reaches, which is exactly the knob
 * this needs — the art guide wants grey floors and warm glows, not black floors.
 *
 * The DM gets 0: principle 3, and the reason their stage came back from the gate ~90%
 * near-black with everything revealed.
 */
export const LIGHTING_STRENGTH = { dm: 0, player: 0.7 };
/** Black extends this far past the map so the edge of the world is not a tell. */
const BOUNDS_PAD = 20;

/**
 * How wide the mask's edge falls off, in world units (= grid cells).
 *
 * The boundary is meant to read as the room running out of light, and light does not stop on
 * a line. A cut does, which is the other half of what came back from the player seat: even
 * once the mask clears the wall band (`fogPad`), a one-pixel step from finished art to solid
 * black reads as the picture having been trimmed rather than as the dark beginning.
 *
 * Held under the pad on purpose. The falloff starts where the room's own claim ends, so
 * everything the room owns — floor, wall band, margin — is already at full strength before
 * any of this is drawn, and the ramp spends itself on map the room does not own.
 */
export const FOG_FEATHER = 0.4;

/**
 * How many steps that falloff is cut into.
 *
 * A blur would be the obvious answer and is the wrong one here: a filter re-runs every frame
 * the stage draws, and the whole discipline of this layer is that the mask is built on a fog
 * change and then only drawn (the fps bar is 25-30 on integrated graphics). Six nested
 * strokes are geometry — they cost what any other shape costs, once, at rebuild.
 *
 * ponytail: six bands over 0.4 of a cell is ~2-4 screen pixels each at play zoom, which is
 * under what banding needs to be visible against art this dark. The upgrade, if the animated
 * fog ever wants a true gradient, is a cached texture — not more bands.
 */
const FEATHER_STEPS = 6;

/** LightingRenderer's label for its full-screen multiply sprite (overlayLayer knows it too). */
const LIGHTING_COMPOSITE = 'lightingComposite';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface FogScene {
  rooms: Room[];
  views: Map<string, RoomView>;
  /** null when there is no geometry yet — the layer draws nothing rather than guessing. */
  bounds: Bounds | null;
  /** How far past a room's floor the mask reaches, in world units — see `fogPad`. */
  pad: number;
  sceneId: string | null;
  /** The DM keeps full lighting and no mask (PRODUCT principle 3). Unknown role ⇒ masked. */
  isPlayer: boolean;
}

/**
 * `effectiveFog`'s default-room fallback, switched off: the argument it picks the fallback
 * from, with nothing in it to pick.
 *
 * The fallback revealed the largest non-pathway room whenever nothing was stored as revealed,
 * so that a fresh table was never a black screen (amendment 2026-07-28). It bought that at a
 * price the fourth browser gate measured on both sides. On emberhold-crypt the largest room
 * is the Torchlit Chamber, so a player joining a session with no reveals in it read the map's
 * brightest room at full strength while the DM's own panel said "Unrevealed" — and the rule
 * fired a second time whenever the DM re-hid the last lit room, handing that room back as
 * *visible* and skipping the explored wash entirely, which is why a memory and a live room
 * measured within 0.35% of each other.
 *
 * A room the DM never revealed is black, and a room they took back is a memory. Neither is a
 * room the map lights for free (PRODUCT principle 2 — the player sees what the referee sent,
 * never what the styling let through).
 *
 * The empty-party concealment correction is the other half of `effectiveFog` and stays on,
 * which is why this still goes *through* the shared helper rather than around it: the server
 * runs the same one over the same inputs (`vision.ts`), and the two must not answer "what can
 * they see" differently.
 */
const NO_FALLBACK_ROOM: readonly FogRoom[] = [];

/**
 * D3's two layers, resolved per room. `visibleRooms` is the mechanics module's — the same
 * pure function the server redacts with, so the canvas and the referee cannot disagree.
 * Everything else the party has ever seen is explored; everything left is black.
 */
export function roomViews(
  rooms: readonly Room[],
  storedFog: SceneFog,
  doors: readonly LiveDoor[],
  partyRooms: readonly string[],
): Map<string, RoomView> {
  const live: Record<string, DoorLiveState> = {};
  const graph: AuthoredDoor[] = [];
  for (const entry of doors) {
    live[entry.door.id] = entry.live;
    graph.push(entry.door);
  }

  const fog = effectiveFog(storedFog, NO_FALLBACK_ROOM, partyRooms);
  const visible = visibleRooms(fog, live, graph, partyRooms);
  const views = new Map<string, RoomView>();
  for (const room of rooms) {
    views.set(
      room.id,
      visible.has(room.id)
        ? 'visible'
        : roomFog(fog, room.id).wasEverRevealed
          ? 'explored'
          : 'dark',
    );
  }
  return views;
}

/**
 * A room this tab cannot name, which is not the same thing as no room at all.
 *
 * A player keeps their own claimed token wherever the DM puts the dark (D7), so it can be
 * standing in a room whose geometry this tab does not hold — most ordinarily after a reload,
 * because the default-room fallback stops handing that room over the instant the DM reveals
 * a real one (amendment 2026-07-28), and a fresh map GET is cut without it. Reading that as
 * "the party is nowhere" would flip concealment off and light up every revealed room, while
 * the server — which has the whole map and can place the token — goes on concealing them and
 * withholding what is inside. The amendment's whole point is that those two do not drift, so
 * an unplaceable party token names a room instead: one no door leads to, so the BFS reaches
 * nothing and every explored room stays a memory, which is exactly the server's answer.
 *
 * ponytail: a token on genuinely unzoned map (D6) is indistinguishable from this and lands
 * here too, where the server would have skipped it. That errs dark rather than bright and
 * needs a claimed token parked outside every room to happen at all; the day it matters, the
 * fix is the server naming the party's rooms on the wire, not a guess on this side.
 */
export const PARTY_ROOM_UNKNOWN = '\0party-elsewhere';

/**
 * Where the party is standing, for D3's reachability BFS. A claimed token is a player at
 * the table; an unclaimed one is scenery the DM moves. D7 needs no special case here — a
 * player's own claimed token is always in their tokens slice, so it always counts.
 */
export function partyRoomIds(tokens: readonly Token[], rooms: readonly Room[]): string[] {
  const ids = new Set<string>();
  for (const token of tokens) {
    if (!token.ownerId || token.hidden) continue;
    const room = roomAt(rooms, token.x, token.y);
    ids.add(room ? room.id : PARTY_ROOM_UNKNOWN);
  }
  return [...ids];
}

/**
 * The rooms that just became visible, and the look they are fading *from*.
 *
 * `prev === null` is a first paint — joining mid-session, or a scene change — and fades
 * nothing: the drama belongs to the reveal the DM just performed, not to arriving at a
 * table that is already lit. A room absent from `prev` fades from black, because that is
 * what it was: its geometry only arrived with the reveal delta (D5).
 */
export function revealsBetween(
  prev: ReadonlyMap<string, RoomView> | null,
  next: ReadonlyMap<string, RoomView>,
): Map<string, RoomView> {
  const reveals = new Map<string, RoomView>();
  if (!prev) return reveals;
  for (const [id, view] of next) {
    if (view !== 'visible') continue;
    const before = prev.get(id) ?? 'dark';
    if (before !== 'visible') reveals.set(id, before);
  }
  return reveals;
}

/** How long a reveal takes on this machine. Reduced motion ⇒ a cut, per PRODUCT §A11y. */
export const revealDurationMs = (): number => (prefersReducedMotion() ? 0 : REVEAL_MS);

/** Ease-out quart. No bounce, no elastic — the room settles, it does not spring. */
export const easeOutQuart = (t: number): number => 1 - (1 - t) ** 4;

/**
 * The whole plane, for a player who has earned no part of the map.
 *
 * There is no footprint to take: the rooms are the footprint and they hold none. The layer
 * this is drawn into mirrors the camera, so the cover has to be wide enough to outlast any
 * pan or zoom rather than any particular map — a million grid squares out is past every
 * limit the camera has, and a solid rect costs two triangles whatever its size.
 */
const EVERYTHING: Bounds = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };

/**
 * A map nobody zoned, as against a map this player has been shown no part of yet.
 *
 * Both reach the mask as "no rooms" and the two want opposite answers — the first is D6 and
 * carries no fog at all, the second is a player who must see black. The server's own cut
 * tells them apart: it leaves an unzoned layer exactly as it was (`redactMapForViewer`) and
 * cuts a zoned one down to the rooms the party has explored, which for a party that has
 * explored nothing is an empty layer. So dungeon content without rooms is the unzoned map,
 * and no content at all is a player holding nothing.
 *
 * ponytail: an authored map with rooms but no props and no walls would read as "holding
 * nothing" and go black — which is what it should look like anyway, there being nothing on
 * it to see. The day that is wrong, the fix is the server naming the scene room-fogged on
 * the wire rather than a better guess on this side.
 */
const holdsUnzonedMap = (layers: readonly Layer[]): boolean =>
  layers.some(
    (layer) =>
      layer.type === 'dungeon' &&
      (layer.children.length > 0 || layer.standaloneWalls.length > 0),
  );

/**
 * The map's footprint plus a margin, or null when there is nothing to cover.
 *
 * No rooms *and* a map in hand means no fog: room-granular fog needs rooms, so the server
 * leaves an unzoned layer whole for players (D6, `redactMapForViewer`) and there is nothing
 * here to hide. No rooms and nothing in hand is the opposite case and the fourth browser
 * gate's second finding: a player at a table where the DM has revealed nothing used to fall
 * through this guard, take no mask at all, and get the grid and the background at full
 * strength — 39.3% of the frame drawn, on a seat that had been shown nothing. It is also
 * still the guard against blacking out a 10x10 square of empty canvas while the map is in
 * flight, because core's bounds fall back to one rather than reporting nothing.
 */
export function fogBounds(layers: readonly Layer[], rooms: readonly Room[]): Bounds | null {
  if (rooms.length === 0) return holdsUnzonedMap(layers) ? null : EVERYTHING;

  // A player's copy has no mergedFloor until core rebuilds it (redactMap ships it null), so
  // the room polygons are the only bounds that exist on the first frame after a reveal.
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const room of rooms) {
    for (const [x, y] of room.boundary) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;

  const map = computeMapWorldBounds(layers as Layer[]);
  return {
    minX: Math.min(minX, map.minX) - BOUNDS_PAD,
    minY: Math.min(minY, map.minY) - BOUNDS_PAD,
    maxX: Math.max(maxX, map.maxX) + BOUNDS_PAD,
    maxY: Math.max(maxY, map.maxY) + BOUNDS_PAD,
  };
}

/** Everything the fog draws from, read once per mutation. */
export function fogScene(): FogScene {
  const { session, you, mapData } = useSessionStore.getState();
  const sceneId = session?.activeSceneId ?? null;
  const layers = useStore.getState().layers;
  const rooms = serverRooms(mapData);
  const fog = sceneFog(session?.modules?.fog as FogState | undefined, sceneId);
  const tokens = tokensOf(session?.modules?.tokens as TokensState | undefined, sceneId);

  return {
    rooms,
    // Rooms and the door graph off the *same* document, so the BFS this runs is the BFS the
    // server ran. Reading the graph off core's store instead lets the two disagree: core
    // re-binds every door to rooms it re-detected from the partial geometry a player holds
    // (`serverDoors`). Live door state still comes off the session slice the door marks are
    // drawn from, so the mask cannot drift from what those marks say either.
    views: roomViews(
      rooms,
      fog,
      serverDoors(mapData, session?.modules?.doors as DoorsState | undefined, sceneId),
      partyRoomIds(tokens, rooms),
    ),
    // No document, no statement: until the referee has sent one there is nothing to be
    // right or wrong about, and covering the canvas on the strength of an empty store would
    // black out the DM's own first frame of a map that is merely still in flight.
    bounds: mapData ? fogBounds(layers, rooms) : null,
    // Off the referee's document, like the rooms it pads: the wall band a player's mask has
    // to clear is the one the referee sent them, not whatever core relaid underneath.
    pad: fogPad(serverLayers(mapData)),
    sceneId,
    isPlayer: you?.role !== 'dm',
  };
}

/**
 * Fires when anything the mask is built from changes, and once on subscribe. The session
 * store fires on every ping and the core store on every camera nudge; slice identity is
 * enough to tell those apart, because both stores replace slices wholesale (§2.5).
 *
 * Coalesced to the frame. One reveal is not one write: the delta replaces the fog slice,
 * the door slice and the map document, and core re-lays the layers under it — four
 * notifications for one beat, and the mask was rebuilt from scratch on each. Waiting for
 * the frame costs the fade nothing (it starts inside the same frame the delta lands in)
 * and there is no draw to miss without one — the fog is only ever seen through a frame.
 * The first paint stays synchronous: the mask has to exist before the map under it is
 * drawn, or the player sees one unmasked frame of the whole dungeon.
 */
export function subscribeFogScene(onChange: () => void): () => void {
  let last: unknown[] = [];
  let queued: number | null = null;

  const changed = (): boolean => {
    const { session, you, mapData } = useSessionStore.getState();
    const next = [
      you?.role,
      session?.activeSceneId,
      session?.modules?.fog,
      session?.modules?.doors,
      session?.modules?.tokens,
      // The document the mask's rooms come from: replaced wholesale on a load and on every
      // merged reveal delta, so identity is the whole test here too.
      mapData,
      useStore.getState().layers,
    ];
    if (next.length === last.length && next.every((v, i) => v === last[i])) return false;
    last = next;
    return true;
  };

  const flush = (): void => {
    queued = null;
    onChange();
  };
  const check = (): void => {
    if (changed() && queued === null) queued = requestAnimationFrame(flush);
  };

  if (changed()) onChange();
  const unsubSession = useSessionStore.subscribe(check);
  const unsubMap = useStore.subscribe(check);
  return () => {
    if (queued !== null) cancelAnimationFrame(queued);
    unsubSession();
    unsubMap();
  };
}

/**
 * The soft edge, cut into geometry rather than blurred.
 *
 * `alignment: 1` puts a stroke wholly *inside* a closed path, so these all sit within the
 * region's reach and thicken the fog back up as they approach its rim. Each step is wider
 * than the last, so a point one band deep is covered by every stroke but the narrowest, and a
 * point at the inner lip only by the widest — the overlap is the ramp.
 *
 * `1 / step` is the alpha that makes those overlaps land on an even one: source-over of the
 * strokes covering a band composites to `1 - Π(1 - 1/k)`, which telescopes to exactly that
 * band's share of the way to solid. Colour is uniform, so the order they are drawn in does
 * not matter.
 */
function featherEdge(g: Graphics, ring: Polygon): void {
  const path = ring.flat();
  for (let step = 1; step <= FEATHER_STEPS; step++) {
    g.poly(path).stroke({
      color: FOG_BLACK,
      alpha: 1 / step,
      width: (FOG_FEATHER * step) / FEATHER_STEPS,
      alignment: 1,
    });
  }
}

/**
 * One room's covering, for the fade out of a reveal.
 *
 * Drawn on the padded footprint the mask cuts, not on the floor polygon: fading the floor
 * alone would clear the wall band on the first frame and then dissolve the room out from
 * inside a ring that was already lit.
 *
 * ponytail: hard-edged where the mask is feathered. It is a 300ms transient dissolving to
 * nothing over the shape it is covering, and a rim that never sits still is not one anybody
 * can read.
 */
function paintRoom(g: Graphics, room: Room, view: RoomView, pad: number): void {
  if (room.boundary.length < 3 || view === 'visible') return;
  const style =
    view === 'dark'
      ? { color: FOG_BLACK, alpha: 1 }
      : { color: EXPLORED_TINT, alpha: EXPLORED_TINT_ALPHA };
  for (const ring of fogRegion([room.boundary], [], pad, FOG_FEATHER).reach) {
    g.poly(ring.flat()).fill(style);
  }
}

/**
 * The mask itself: one fill over the map, a hole for everything the player has earned, the
 * explored wash inside the holes that are only memories, and the falloff last so it thickens
 * over both.
 *
 * The hole is one merged region rather than one shape per room (`fogRegion`), which is what
 * lets it be padded at all — rooms a wall apart overlap once they are grown, and `cut` cannot
 * take overlapping holes. Each ring's holes go in as a single `cut`, because Pixi attaches a
 * cut to the fill instruction before it and a second one on the same fill reaches back a
 * further instruction as well.
 *
 * ponytail: the fill is flat black, which is the placeholder the animated fog replaces. Every
 * decision about *where* the fog is lives in the region above and the falloff below; the fill
 * and the wash are two colours passed to `fill`, and swapping them for an animated treatment
 * touches neither.
 */
export function drawFog(scrim: Graphics, scene: FogScene): void {
  scrim.clear();
  if (!scene.isPlayer || !scene.bounds) return;

  const { minX, minY, maxX, maxY } = scene.bounds;
  scrim.rect(minX, minY, maxX - minX, maxY - minY).fill({ color: FOG_BLACK, alpha: 1 });

  const floorsOf = (view: RoomView): Polygon[] =>
    scene.rooms
      .filter((room) => room.boundary.length >= 3 && scene.views.get(room.id) === view)
      .map((room) => room.boundary);

  const dark = floorsOf('dark');
  const visible = floorsOf('visible');
  const explored = floorsOf('explored');

  const seen = fogRegion([...visible, ...explored], dark, scene.pad, FOG_FEATHER);
  const earned = ringsWithHoles(seen.reach);
  for (const { outline } of earned) scrim.poly(outline.flat());
  if (earned.length > 0) scrim.cut();

  // Fog the region has closed all the way around — an unrevealed pocket walled in by revealed
  // rooms. Put back as solid black: it is inside the hole, so nothing else is covering it.
  // ponytail: hard-edged. `featherEdge` thickens fog towards a rim from the inside, and a
  // pocket wants the opposite; it takes a closed ring of revealed rooms to make one.
  for (const { holes } of earned) {
    for (const hole of holes) scrim.poly(hole.flat()).fill({ color: FOG_BLACK, alpha: 1 });
  }

  // D10's memory tier, on the same padded footprint at its own darkness. It stops at a live
  // room's floor rather than at its own wall, so a wall between a memory and a lit room reads
  // as the memory's — and it runs out to `reach` rather than to `clear`, so the falloff below
  // has a wash to thicken over instead of a gap between the two to fall through.
  const memory = fogRegion(explored, [...dark, ...visible], scene.pad, FOG_FEATHER);
  for (const { outline, holes } of ringsWithHoles(memory.reach)) {
    scrim.poly(outline.flat()).fill({ color: EXPLORED_TINT, alpha: EXPLORED_TINT_ALPHA });
    for (const hole of holes) scrim.poly(hole.flat());
    if (holes.length > 0) scrim.cut();
  }

  for (const { outline } of earned) featherEdge(scrim, outline);
}

interface Fade {
  graphic: Graphics;
  startedAt: number;
}

function mountPlayerFog(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  const layer = new Container();
  const scrim = new Graphics();
  const fadeLayer = new Container();
  layer.addChild(scrim, fadeLayer);
  // Nothing here is clickable; the fog tool and the doors read the DOM canvas directly.
  layer.eventMode = 'none';
  addScreenOverlay(sceneGraph, layer, 'playerFog');

  /** Null on a table with no lighting engine — then there is no multiply to hold back. */
  const composite = (): Container | null =>
    (sceneGraph.overlayContainer.children.find((c) => c.label === LIGHTING_COMPOSITE) as
      | Container
      | undefined) ?? null;

  const world = sceneGraph.worldContainer;
  const fades: Fade[] = [];
  let views: Map<string, RoomView> | null = null;
  let sceneId: string | null = null;

  const clearFades = (): void => {
    for (const fade of fades) fade.graphic.destroy();
    fades.length = 0;
  };

  const rebuild = (): void => {
    const scene = fogScene();
    // A different map is a different set of rooms; nothing carries over, and the first
    // paint of a scene is never a reveal.
    if (scene.sceneId !== sceneId) {
      sceneId = scene.sceneId;
      views = null;
      clearFades();
    }

    layer.visible = scene.isPlayer;
    drawFog(scrim, scene);

    // Set every rebuild rather than once at mount: the seat is not known until the join
    // snapshot lands, and the composite itself is created asynchronously with the engine.
    const lit = composite();
    if (lit) lit.alpha = scene.isPlayer ? LIGHTING_STRENGTH.player : LIGHTING_STRENGTH.dm;

    // Reduced motion cuts instead of fading, so it simply never starts one.
    if (scene.isPlayer && revealDurationMs() > 0) {
      const roomById = new Map(scene.rooms.map((room) => [room.id, room]));
      for (const [roomId, before] of revealsBetween(views, scene.views)) {
        const room = roomById.get(roomId);
        if (!room) continue;
        const graphic = new Graphics();
        paintRoom(graphic, room, before, scene.pad);
        fadeLayer.addChild(graphic);
        fades.push({ graphic, startedAt: performance.now() });
      }
    }
    views = scene.views;
  };

  // Per frame: mirror the camera (the layer lives in screen space, above the lighting
  // composite) and advance any fade. No geometry is touched — the mask is rebuilt on
  // mutation and then simply drawn, which is what keeps the 60fps gate comfortable.
  const tick = (): void => {
    layer.position.copyFrom(world.position);
    layer.scale.copyFrom(world.scale);
    if (fades.length === 0) return;
    const now = performance.now();
    for (let i = fades.length - 1; i >= 0; i--) {
      const t = (now - fades[i].startedAt) / REVEAL_MS;
      if (t >= 1) {
        fades[i].graphic.destroy();
        fades.splice(i, 1);
        continue;
      }
      fades[i].graphic.alpha = 1 - easeOutQuart(t);
    }
  };

  const ticker = engine.ticker();
  ticker.add(tick);
  const unsubscribe = subscribeFogScene(rebuild);

  return () => {
    ticker.remove(tick);
    unsubscribe();
    // The engine may already be gone (GameRenderer unmounting first) — its objects are
    // destroyed and touching them throws.
    try {
      // Hand the lighting back at the strength the editor and every other mount expects.
      const lit = composite();
      if (lit) lit.alpha = 0.95;
      if (!layer.destroyed) layer.destroy({ children: true });
    } catch {
      /* engine torn down first */
    }
  };
}

/** Call from an effect; the returned function is the effect's cleanup. */
export const mountPlayerFogWhenReady = (pollMs?: number): (() => void) =>
  mountWhenEngineReady(mountPlayerFog, pollMs);
