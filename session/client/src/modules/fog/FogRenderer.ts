// §2.4.1 / D10 — the *player's* fog. One mask over the whole map, rebuilt only when the
// fog, the doors or the party's rooms move.
//
// Three states. A room nobody has entered — and every scrap of unzoned map (D6) — is
// painted as the *void*: the background's own colour and dot grid, pre-multiplied by the
// player's lighting strength (`VoidStyle`), so hidden map and empty background are one
// indistinguishable surface and the map's edge is not a tell. A room the party has seen
// but cannot see now is a memory: the same room, desaturated and dimmed to well under what
// it reads at live, so the state carries on brightness rather than on colour and survives
// a bad panel in a dim room. A room they can see is simply not drawn on.
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
import type { BackgroundLayer, Layer, SerializedMapData } from '@dnd/core/src/store/types';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import type { LightingRenderer } from '@dnd/core/src/engine/lighting/LightingRenderer';
import { useStore } from '@dnd/core/src/store/store';
import { computeMapWorldBounds } from '@dnd/core/src/engine/export/exportPipeline';
import type { AuthoredDoor, DoorLiveState, DoorsState } from '@dnd/mechanics/doors';
import {
  effectiveFog,
  fogModeOf,
  lightSources,
  visibleRooms,
  type FogMode,
  type FogRoom,
  type FogState,
  type SceneFog,
} from '@dnd/mechanics/fog';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import {
  ambientOf,
  needsLight,
  sceneTriggersOf,
  type AmbientLevel,
  type TriggersState,
} from '@dnd/mechanics/triggers';
import { addScreenOverlay, mountWhenEngineReady } from '../../renderer/overlayLayer';
import { prefersReducedMotion } from '../../session/motion';
import { useSessionStore } from '../../session/store';
import type { LiveDoor } from '../doors/doors';
import { tokensOf } from '../tokens/TokenRenderer';
import {
  fogPad,
  fogRegion,
  type FogRing,
  type NightSight,
  ringsWithHoles,
  roomAt,
  roomFog,
  sceneFog,
  serverDoors,
  serverLayers,
  serverRooms,
  visionRegion,
} from './fog';
import { placedLights, sightCache, sighted } from './visionSight';

/** What the player's canvas does with one room. */
export type RoomView = 'visible' | 'explored' | 'dark';

/** D10 — the one deliberately slow beat in the product. A play beat, not decoration. */
export const REVEAL_MS = 300;

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

/**
 * S3 P3 §4 — the drained grade a darkvision eye reads unlit ground through.
 *
 * A wash, not a filter. The art guide's dungeon is "near-black surround, grey floors, 1-2
 * strong warm glows doing all the color work" and its night is "desaturated, low contrast" —
 * which is a statement about *chroma*, and a near-neutral wash is the cheapest thing that
 * makes one: EXPLORED_TINT's own pair already measures 24.7 → 7.2 chroma on this canvas
 * (see EXPLORED_TINT_ALPHA), so the primitive is known to drain colour rather than merely dim.
 * A `ColorMatrixFilter` would grade the pixels properly and re-run every frame the stage draws
 * — the one thing this layer is built never to do (`FEATHER_STEPS`) — and it has no precedent
 * in core outside water's displacement.
 *
 * Cooler and lighter than the memory tint on purpose: the three states have to stay three
 * brightnesses (void < memory < drained < lit), because the party IS looking at this ground.
 * Tuned against the screenshot the darkvision e2e row takes, not against arithmetic.
 */
export const DARKVISION_TINT = 0x151b24;
export const DARKVISION_TINT_ALPHA = 0.55;

/**
 * How hard the lighting composite's ambient fill bites, per ambient level (§4).
 *
 * `LightingRenderer` clears its FBO to the map's ambient colour and the lights add on top, so
 * the fill's alpha is a strength on the *unlit* base alone — a torch pool's own alpha comes
 * from the additive draw and is untouched. Dialling the fill back therefore lifts the surround
 * without touching the glows, which is the knob the art guide's "ambient is underused for
 * scene mood" is asking for.
 *
 * An untouched scene reads 1 — the value the renderer has always used — so every scene played
 * before the dial existed, and every rooms-mode table, composites byte-identically. The three
 * levels then land monotonically under it: darkness is the map as authored, daylight lifts the
 * unlit map most, dusk sits between.
 */
export const AMBIENT_BITE: Record<AmbientLevel, number> = {
  daylight: 0.45,
  dusk: 0.75,
  darkness: 1,
};
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

/**
 * What the void looks like where the fog has to imitate it.
 *
 * Hidden map is drawn as the background — its colour and its dot grid — rather than as
 * black, so a player cannot tell fogged map from empty void at all. This layer sits *above*
 * the lighting composite, so the colours are pre-multiplied by the same strength the real
 * void renders under; the imitation and the real thing then land on the same pixel values
 * (dot alpha commutes through the multiply, so dots match too).
 */
export interface VoidStyle {
  /** The background layer's colour, through the player lighting multiply. */
  fill: number;
  /** GridRenderer's dot colour (0x888888), through the same multiply. */
  dot: number;
  dotAlpha: number;
  /** Mirrors the map's grid.visible — no dots in the void, no dots in the fog. */
  dotsVisible: boolean;
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
  void: VoidStyle;
  /**
   * S3 P2 — which presentation the mask draws. Absent ⇒ `'rooms'`, exactly as the wire field
   * reads, and every field below goes unread there: the room path is untouched by any of it.
   */
  mode?: FogMode;
  /** Vision only (§1): one sweep polygon per sighted party token — the clear tier. */
  sight?: Polygon[];
  /** Vision only (§1): the scene's fog as *stored*, for the memory tier's cells and reveals. */
  fog?: SceneFog;
  /**
   * S3 P3 §3 — the light gate, present only in a vision scene the DM has turned to
   * `darkness`. Absent is daylight/dusk, where the whole sweep counts as lit: the P2 mask,
   * unchanged, which is what every scene keeps until the dial is touched.
   */
  night?: NightSight;
  /**
   * §4 — how hard the lighting composite's ambient fill bites, from the scene's ambient level.
   * Absent is "the DM has not turned the dial", which leaves the lighting pass exactly as it
   * was before P3 — including its no-lights-no-composite shortcut.
   */
  darkness?: number;
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

/** Vision mode's `views`: nothing classifies rooms there. Shared because nothing writes it. */
const NO_VIEWS: Map<string, RoomView> = new Map();

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
export function fogBounds(
  layers: readonly Layer[],
  rooms: readonly Room[],
  frame: Bounds | null = null,
): Bounds | null {
  // Unzoned map carries no fog at all (D6) — frame or no frame.
  if (rooms.length === 0 && holdsUnzonedMap(layers)) return null;

  // The frame the server measured off the full document at redaction. It is the fog's whole
  // territory: outside it is the dotted void, which is nobody's secret and never fogged —
  // and it is also what makes fog *finite* for a player who has revealed nothing, instead
  // of the EVERYTHING rect blacking the void out to the horizon.
  if (frame) return frame;

  if (rooms.length === 0) return EVERYTHING;

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

/** '#rrggbb' → [r, g, b]; anything unparseable answers as the default surface. */
const channels = (hex: string): [number, number, number] => {
  const n = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  const v = n ? parseInt(n, 16) : 0x2d2d2d;
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
};

/**
 * A colour as it lands after the player's lighting multiply: `c · lerp(1, ambient, s)` per
 * channel — the same arithmetic LightingRenderer's composite performs on the real void
 * (its sprite alpha is set to LIGHTING_STRENGTH.player on every rebuild below).
 */
const lit = (hex: string, ambient: [number, number, number], s: number): number => {
  const [r, g, b] = channels(hex);
  const mul = (c: number, a: number): number => Math.round(c * (1 - s * (1 - a / 255)));
  return (mul(r, ambient[0]) << 16) | (mul(g, ambient[1]) << 8) | mul(b, ambient[2]);
};

/**
 * The void's look, off the same store the real background renders from. `strength` is how
 * hard the lighting composite is actually biting — LIGHTING_STRENGTH.player on a lit map,
 * 0 on a map with no lights (LightingRenderer leaves its sprite invisible there and the
 * real void renders unmultiplied; the mount checks which is true at rebuild).
 */
export function voidStyle(strength: number = LIGHTING_STRENGTH.player): VoidStyle {
  const { layers, mapSettings, grid } = useStore.getState();
  const bg = layers.find((l): l is BackgroundLayer => l.type === 'background');
  const ambient = channels(mapSettings.ambientLight);
  return {
    fill: lit(bg?.backgroundColor ?? '#2d2d2d', ambient, strength),
    dot: lit('#888888', ambient, strength),
    dotAlpha: 0.45,
    dotsVisible: grid.visible,
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
  const mode = fogModeOf(fog);
  const isPlayer = you?.role !== 'dm';
  const isVision = mode === 'vision';
  // The table's light state, both halves of it: the scene's ambient dial and every light the
  // triggers have relit. The same slice the referee reads (`vision.ts`), so the mask and the
  // redaction cannot disagree about what is burning.
  const triggers = session?.modules?.triggers as TriggersState | undefined;
  const scene = sceneId && triggers ? sceneTriggersOf(triggers, sceneId) : undefined;
  // §4 — how hard the lighting composite's ambient fill bites on this scene. Read before the
  // void's look because the imitation is drawn *through* that same composite (`voidStyle`).
  const darkness = scene?.env.ambient ? AMBIENT_BITE[ambientOf(scene)] : undefined;
  // Not taken for the DM, whose seat draws no mask at all, nor in rooms mode, which has no
  // use for it — the sweep is the expensive half of this read, and leaving it untaken is also
  // what keeps that path byte-identical.
  const eyes = isVision && isPlayer ? sighted(tokens) : [];
  //
  // Off *core's* layers rather than the document's, which is the one place this file reads
  // core on purpose: the table's live door state is stamped onto them for the lighting pass
  // (`syncDoorsToLighting`), and a sweep through a door the map file still calls shut is a
  // sweep the referee never took. Rooms and the door graph stay the document's for the
  // reason `serverRooms` gives — those are what core re-detects, and walls are not.
  const sight = isVision && isPlayer ? sightCache.partySight(layers, eyes) : undefined;

  return {
    rooms,
    // Rooms and the door graph off the *same* document, so the BFS this runs is the BFS the
    // server ran. Reading the graph off core's store instead lets the two disagree: core
    // re-binds every door to rooms it re-detected from the partial geometry a player holds
    // (`serverDoors`). Live door state still comes off the session slice the door marks are
    // drawn from, so the mask cannot drift from what those marks say either.
    // …and not taken at all in vision mode, where the room record classifies nothing the mask
    // draws: the tiers come off the sweep and the region record (`visionTiers`), and the one
    // other reader — the reveal fade — is rooms-only for the reason `rebuild` gives.
    views: isVision
      ? NO_VIEWS
      : roomViews(
          rooms,
          fog,
          serverDoors(mapData, session?.modules?.doors as DoorsState | undefined, sceneId),
          partyRoomIds(tokens, rooms),
        ),
    // No document, no statement: until the referee has sent one there is nothing to be
    // right or wrong about, and covering the canvas on the strength of an empty store would
    // black out the DM's own first frame of a map that is merely still in flight.
    bounds: mapData
      ? fogBounds(layers, rooms, (mapData as SerializedMapData).frame ?? null)
      : null,
    // Off the referee's document, like the rooms it pads: the wall band a player's mask has
    // to clear is the one the referee sent them, not whatever core relaid underneath.
    pad: fogPad(serverLayers(mapData)),
    sceneId,
    isPlayer,
    // The imitation bites exactly as hard as the real composite does: the sheet renders above
    // the same multiply, and §4 just made that multiply a dial. Left at full strength the
    // fogged sheet reads as a *darker* patch of the same map at daylight and dusk (D1).
    void: voidStyle(LIGHTING_STRENGTH.player * (darkness ?? 1)),
    mode,
    fog,
    sight,
    // §3 — the light gate, taken only where it is the answer: a vision scene the DM has turned
    // to `darkness`. Every light source's own sweep (placed lights the table has left on, plus
    // token-carried ones), and separately the sweeps of the party's darkvision eyes, which are
    // the polygons already computed above — a darkvision eye is not swept twice.
    night:
      sight && scene && needsLight(scene)
        ? {
            lit: sightCache.litArea(
              layers,
              lightSources(placedLights(layers), tokens, scene.lightOverrides),
            ),
            darkvision: sight.filter((_, i) => eyes[i].sight!.visionMode === 'darkvision'),
          }
        : undefined,
    // …and the presentation half, which is not gated on vision mode at all: a rooms-mode scene
    // the DM calls dark should read dark too. An untouched scene reads 1 — today's value.
    // Deliberate (D6): the dial is world state, not a vision-mode feature, so it reaches every
    // scene the DM turns it on — and a scene nobody has touched carries no `ambient` field at
    // all, so the rooms path composites byte-identically to what it always has.
    darkness,
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
      // S3 P3 — the light state: the scene's ambient dial and every relit light. A DM turning
      // the dial moves what the party can see without a token or a door moving at all.
      session?.modules?.triggers,
      // The document the mask's rooms come from: replaced wholesale on a load and on every
      // merged reveal delta, so identity is the whole test here too.
      mapData,
      useStore.getState().layers,
      // The void look the fog imitates — background colour, ambient, grid toggle.
      useStore.getState().mapSettings.ambientLight,
      useStore.getState().grid.visible,
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
function featherEdge(g: Graphics, ring: Polygon, color: number): void {
  const path = ring.flat();
  for (let step = 1; step <= FEATHER_STEPS; step++) {
    g.poly(path).stroke({
      color,
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
function paintRoom(g: Graphics, room: Room, view: RoomView, pad: number, voidFill: number): void {
  if (room.boundary.length < 3 || view === 'visible') return;
  const style =
    view === 'dark'
      ? { color: voidFill, alpha: 1 }
      : { color: EXPLORED_TINT, alpha: EXPLORED_TINT_ALPHA };
  for (const ring of fogRegion([room.boundary], [], pad, FOG_FEATHER).reach) {
    g.poly(ring.flat()).fill(style);
  }
}

/**
 * Cut these land rings out of the fill just drawn — the caller's previous instruction must
 * be that fill — then paint each pocket of water inside them back solid, and recurse, so an
 * island inside the pocket is cut clear again at any depth.
 *
 * ponytail: pockets and islands are hard-edged. `featherEdge` thickens fog towards a rim
 * from the inside, a pocket wants the opposite, and it takes a closed ring of revealed
 * rooms to make one at all.
 */
function cutLand(
  g: Graphics,
  land: readonly FogRing[],
  water: { color: number; alpha?: number },
): void {
  for (const { outline } of land) g.poly(outline.flat());
  if (land.length > 0) g.cut();
  for (const { holes } of land) {
    for (const pocket of holes) {
      g.poly(pocket.outline.flat()).fill(water);
      cutLand(g, pocket.holes, water);
    }
  }
}

/** Fill each land ring, cut its water out of that fill, and recurse into the islands. */
function fillLand(
  g: Graphics,
  land: readonly FogRing[],
  style: { color: number; alpha?: number },
): void {
  for (const { outline, holes } of land) {
    g.poly(outline.flat()).fill(style);
    for (const pocket of holes) g.poly(pocket.outline.flat());
    if (holes.length > 0) g.cut();
    for (const pocket of holes) fillLand(g, pocket.holes, style);
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
/**
 * D3's three tiers, room by room — the mask this layer has always drawn, lifted out of
 * `drawFog` unchanged so vision mode can sit beside it rather than inside it.
 */
function roomTiers(scene: FogScene): { earned: FogRing[]; memory: FogRing[] } {
  const floorsOf = (view: RoomView): Polygon[] =>
    scene.rooms
      .filter((room) => room.boundary.length >= 3 && scene.views.get(room.id) === view)
      .map((room) => room.boundary);

  const dark = floorsOf('dark');
  const visible = floorsOf('visible');
  const explored = floorsOf('explored');

  const seen = fogRegion([...visible, ...explored], dark, scene.pad, FOG_FEATHER);
  // D10's memory tier, on the same padded footprint at its own darkness. It stops at a live
  // room's floor rather than at its own wall, so a wall between a memory and a lit room reads
  // as the memory's — and it runs out to `reach` rather than to `clear`, so the falloff below
  // has a wash to thicken over instead of a gap between the two to fall through.
  const memory = fogRegion(explored, [...dark, ...visible], scene.pad, FOG_FEATHER);
  return { earned: ringsWithHoles(seen.reach), memory: ringsWithHoles(memory.reach) };
}

/**
 * §1's three tiers, drawn through the party's own eyes: the sweep union is clear, everything
 * they have swept or the DM has revealed is a memory, and the rest is the same void.
 *
 * ponytail: `visionShare: 'individual'` renders as party here — every claimed token's sweep is
 * in the union whoever is looking at the screen. Per-viewer masks are P5, and the server is
 * still the thing withholding anything secret either way.
 */
function visionTiers(scene: FogScene): {
  earned: FogRing[];
  memory: FogRing[];
  drained: FogRing[];
  cells: number;
} {
  const stored = scene.fog?.rooms ?? {};
  const floorsOf = (pick: (roomId: string) => boolean): Polygon[] =>
    scene.rooms
      .filter((room) => room.boundary.length >= 3 && pick(room.id))
      .map((room) => room.boundary);

  const region = visionRegion(
    scene.sight ?? [],
    scene.fog?.region,
    floorsOf((id) => stored[id]?.status === 'revealed'),
    // Every room the player was handed at all — what the wash is allowed to sit on.
    floorsOf(() => true),
    scene.pad,
    FOG_FEATHER,
    scene.night,
  );
  return {
    earned: ringsWithHoles(region.shown),
    memory: ringsWithHoles(region.memory),
    drained: ringsWithHoles(region.drained),
    cells: region.cells,
  };
}

export function drawFog(
  scrim: Graphics,
  scene: FogScene,
  dotsMask?: Graphics,
): { cells: number } {
  scrim.clear();
  dotsMask?.clear();
  if (!scene.isPlayer || !scene.bounds) return { cells: 0 };

  const voidFill = scene.void.fill;
  // Drawn one pad + feather wider than the frame: a hole that crosses the filled rect's
  // outer contour is dropped whole by the triangulator, and the frame is content-tight
  // (one square of air) while a room's padded reach can poke past it. The overhang is
  // invisible — the fill imitates the void it overpaints.
  const grow = scene.pad + FOG_FEATHER;
  let minX = scene.bounds.minX - grow;
  let minY = scene.bounds.minY - grow;
  let maxX = scene.bounds.maxX + grow;
  let maxY = scene.bounds.maxY + grow;
  // …and further still for a sweep, which is the one hole the frame does not bound. A room's
  // reach pokes a pad past a content-tight frame and no more; a token standing a step inside
  // the map's edge sees straight out of it, and that hole crossing the contour takes the
  // whole hole with it — the mask came back as unbroken black with the sweep computed and
  // discarded. Growing the cover is cheaper than clipping the hole, and the overhang costs
  // nothing: the fill imitates the void it overpaints.
  for (const polygon of scene.sight ?? []) {
    for (const [x, y] of polygon) {
      minX = Math.min(minX, x - grow);
      minY = Math.min(minY, y - grow);
      maxX = Math.max(maxX, x + grow);
      maxY = Math.max(maxY, y + grow);
    }
  }
  const [w, h] = [maxX - minX, maxY - minY];
  scrim.rect(minX, minY, w, h).fill({ color: voidFill, alpha: 1 });
  // The dots mask is the never-revealed region — the same shapes the scrim keeps covered.
  // The dot layer above clips to it, so the imitation void gets the background's dot grid
  // and nothing the player has earned does.
  dotsMask?.rect(minX, minY, w, h).fill(0xffffff);

  // The one fork in this file. Everything either side of it — the fill, the cut, the wash and
  // the falloff — is the same four instructions in the same order; the tiers are what differ.
  const { earned, memory, drained, cells } =
    scene.mode === 'vision'
      ? visionTiers(scene)
      : { ...roomTiers(scene), drained: [] as FogRing[], cells: 0 };

  cutLand(scrim, earned, { color: voidFill, alpha: 1 });
  if (dotsMask) cutLand(dotsMask, earned, { color: 0xffffff });

  fillLand(scrim, memory, { color: EXPLORED_TINT, alpha: EXPLORED_TINT_ALPHA });
  // §4 — inside the hole, not instead of it: the party can see this ground, so it keeps the
  // room's own render underneath and takes the grade on top. Drawn after the memory wash and
  // before the falloff, which thickens over both.
  fillLand(scrim, drained, { color: DARKVISION_TINT, alpha: DARKVISION_TINT_ALPHA });

  for (const { outline } of earned) featherEdge(scrim, outline, voidFill);
  return { cells };
}

interface Fade {
  graphic: Graphics;
  startedAt: number;
}

function mountPlayerFog(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  const layer = new Container();
  const scrim = new Graphics();
  // The imitation void's dot grid: its own layer clipped to the never-revealed region
  // (the mask is rebuilt with the scrim), redrawn from the tick when the visible cell
  // range moves — dot radius is ~1.5 *screen* pixels, so zoom changes its world size.
  const dots = new Graphics();
  const dotsMask = new Graphics();
  dots.mask = dotsMask;
  const fadeLayer = new Container();
  layer.addChild(scrim, dots, dotsMask, fadeLayer);
  // Nothing here is clickable; the fog tool and the doors read the DOM canvas directly.
  layer.eventMode = 'none';
  addScreenOverlay(sceneGraph, layer, 'playerFog');

  /** Null on a table with no lighting engine — then there is no multiply to hold back. */
  const composite = (): Container | null =>
    (sceneGraph.overlayContainer.children.find((c) => c.label === LIGHTING_COMPOSITE) as
      | Container
      | undefined) ?? null;

  /** …and the pass behind it, for the ambient dial. Absent on a scene graph with no lighting. */
  const lighting = (): LightingRenderer | null => sceneGraph.lightingRenderer ?? null;

  const world = sceneGraph.worldContainer;
  const fades: Fade[] = [];
  let views: Map<string, RoomView> | null = null;
  let sceneId: string | null = null;
  let voidLook: VoidStyle = { fill: 0, dot: 0, dotAlpha: 0.45, dotsVisible: false };
  /** What the last rebuild drew with, for the vision probe below. */
  let sources = 0;
  let cells = 0;

  // Read-only fade probe for the e2e lanes, on `__testProbe`'s rationale (unguarded:
  // nothing here a script on the page could not already read). Pixels stopped being able
  // to time the reveal when #51 brightened the explored look — the fade's largest
  // per-frame step fell under any gate that still excludes torch flicker — so the
  // reduced-motion row reads the fade layer itself.
  const fogProbe = {
    fadesStarted: 0,
    fadesActive: (): number => fades.length,
    reducedMotion: (): boolean => revealDurationMs() === 0,
    viewOf: (roomId: string): RoomView | null => views?.get(roomId) ?? null,
    // S3 P2 §4 — the vision rows' instruments, added beside the four above rather than over
    // them: sprint3-fog reads those, and it is this phase's regression gate.
    mode: 'rooms' as FogMode,
    /** How many tokens' eyes the clear tier was drawn through. */
    sweepSources: (): number => sources,
    rebuilds: 0,
    /** How long the last mask took to *build* — §4's budget is about mutation, not frames. */
    lastRebuildMs: 0,
    memoryCells: (): number => cells,
    // S3 P4 — where a world point is on this canvas right now. The brush rows drive the real
    // pointer over named cells, and the camera transform is the one thing a Node process
    // cannot work out for itself. Read-only, and it discloses nothing the page does not
    // already draw.
    screenOf: (x: number, y: number): { x: number; y: number } => engine.worldToScreen(x, y),
  };
  (window as Window & { __fogProbe?: typeof fogProbe }).__fogProbe = fogProbe;

  // GridRenderer's redraw discipline, transplanted: only when the visible cell range
  // shifts by a full cell (which any zoom worth redrawing for causes) or a rebuild
  // invalidates the range. Dots are drawn across the visible range and clipped to the
  // never-revealed region by the mask.
  let lastDots = { minX: NaN, maxX: NaN, minY: NaN, maxY: NaN };
  const redrawDots = (force: boolean): void => {
    const vp = engine.viewport();
    const tl = engine.screenToWorld(0, 0);
    const br = engine.screenToWorld(vp.width, vp.height);
    const pad = 2;
    const minX = Math.floor(tl.x) - pad;
    const maxX = Math.ceil(br.x) + pad;
    const minY = Math.floor(tl.y) - pad;
    const maxY = Math.ceil(br.y) + pad;
    if (
      !force &&
      Math.abs(minX - lastDots.minX) < 1 &&
      Math.abs(maxX - lastDots.maxX) < 1 &&
      Math.abs(minY - lastDots.minY) < 1 &&
      Math.abs(maxY - lastDots.maxY) < 1
    ) {
      return;
    }
    lastDots = { minX, maxX, minY, maxY };

    dots.clear();
    if (!voidLook.dotsVisible) return;
    const zoomPx = world.scale.x;
    const dotR = Math.max(0.02, 1.5 / Math.max(1, zoomPx));
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        dots.circle(x, y, dotR);
      }
    }
    dots.fill({ color: voidLook.dot, alpha: voidLook.dotAlpha });
  };

  const clearFades = (): void => {
    for (const fade of fades) fade.graphic.destroy();
    fades.length = 0;
  };

  const rebuild = (): void => {
    const startedAt = performance.now();
    const scene = fogScene();
    // A different map is a different set of rooms; nothing carries over, and the first
    // paint of a scene is never a reveal.
    if (scene.sceneId !== sceneId) {
      sceneId = scene.sceneId;
      views = null;
      clearFades();
    }

    layer.visible = scene.isPlayer;

    // Set every rebuild rather than once at mount: the seat is not known until the join
    // snapshot lands, and the composite itself is created asynchronously with the engine.
    const lit = composite();
    if (lit) lit.alpha = scene.isPlayer ? LIGHTING_STRENGTH.player : LIGHTING_STRENGTH.dm;
    // §4 — the ambient dial, reaching the lighting pass the same way: this layer already owns
    // how hard that composite bites (`LIGHTING_STRENGTH`), and the scene's light level is the
    // other half of the same statement. The DM's composite is dialled to nothing either way,
    // so darkness is something they stage rather than something imposed on them (principle 3).
    lighting()?.setAmbientLevel(scene.darkness ?? null);

    // The imitation has to match the void as it actually renders: an unlit map never
    // composites (the sprite stays invisible), so its void is the raw background colour.
    const drawn = lit?.visible ? scene : { ...scene, void: voidStyle(0) };
    voidLook = drawn.void;
    cells = drawFog(scrim, drawn, dotsMask).cells;
    // Stamped before the dots and the fades: those are draws, and what §4 budgets is what one
    // mutation costs to *build* — the sweeps inside `fogScene` and the Clipper pass above.
    fogProbe.mode = scene.mode ?? 'rooms';
    fogProbe.rebuilds += 1;
    fogProbe.lastRebuildMs = performance.now() - startedAt;
    sources = scene.sight?.length ?? 0;
    redrawDots(true);

    // Rooms mode only. A fade paints a room's whole footprint dark and lifts it — over live
    // sight, in vision mode, on every room transition and every door swing, which is exactly
    // the flicker the mode is specified to have none of. Reduced motion cuts instead of
    // fading, so it never starts one either way.
    // ponytail: a vision-shaped transition (the sweep's own edge easing out) is P6 polish.
    if (scene.isPlayer && scene.mode !== 'vision' && revealDurationMs() > 0) {
      const roomById = new Map(scene.rooms.map((room) => [room.id, room]));
      for (const [roomId, before] of revealsBetween(views, scene.views)) {
        const room = roomById.get(roomId);
        if (!room) continue;
        const graphic = new Graphics();
        paintRoom(graphic, room, before, scene.pad, drawn.void.fill);
        fadeLayer.addChild(graphic);
        fades.push({ graphic, startedAt: performance.now() });
        fogProbe.fadesStarted += 1;
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
    if (layer.visible) redrawDots(false);
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
    delete (window as Window & { __fogProbe?: typeof fogProbe }).__fogProbe;
    // The engine may already be gone (GameRenderer unmounting first) — its objects are
    // destroyed and touching them throws.
    try {
      // Hand the lighting back at the strength the editor and every other mount expects.
      const lit = composite();
      if (lit) lit.alpha = 0.95;
      lighting()?.setAmbientLevel(null);
      if (!layer.destroyed) layer.destroy({ children: true });
    } catch {
      /* engine torn down first */
    }
  };
}

/** Call from an effect; the returned function is the effect's cleanup. */
export const mountPlayerFogWhenReady = (pollMs?: number): (() => void) =>
  mountWhenEngineReady(mountPlayerFog, pollMs);
