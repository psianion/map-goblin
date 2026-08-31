// §2.4.1 / D10 — the *player's* fog. One mask over the whole map, rebuilt only when the
// fog, the doors or the party's rooms move.
//
// Three states. A room nobody has entered — and every scrap of unzoned map (D6) — is
// covered by the *living fog*: the animated cloud `livingFog.ts` paints over one flat black
// scrim, opaque and identical over hidden map and empty background alike, so the map's edge
// is not a tell. The scrim is the fail-dark backstop, nothing more — if the shader never
// draws, unearned map is still black. (It once imitated the background's own colour and dot
// grid so fogged map could pass for empty void; an opaque cloud hides both the same, so the
// imitation retired with the grey halo it left at the cloud's rim.) A room the party has
// seen but cannot see now is a memory: the same room, desaturated and dimmed to well under
// what it reads at live, thin mist breathing over it, so the state carries on brightness
// rather than on colour and survives a bad panel in a dim room. A room they can see is
// simply not drawn on.
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
// no tier of this layer is drawn on their seat and the fog state reaches them as the
// overlay's tints (FogOverlay) instead of as an unreadable stage. Their grade is not: dialling
// the whole composite off used to take every brazier on the map with it, and mood is presentation
// rather than information — `GRADE_STRENGTH` against `LIGHTING_STRENGTH` is that split.
//
// ponytail: pixi through @dnd/core, the same reach-through TokenRenderer documents.
import { Container, Graphics, Sprite } from 'pixi.js';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import type { Room } from '@dnd/core/src/shared/types';
import type { BackgroundLayer, Layer, SerializedMapData } from '@dnd/core/src/store/types';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { useStore } from '@dnd/core/src/store/store';
import { RIM_START } from '@dnd/core/src/engine/lighting/LightingRenderer';
import { computeMapWorldBounds } from '@dnd/core/src/engine/export/exportPipeline';
import type { AuthoredDoor, DoorLiveState, DoorsState } from '@dnd/mechanics/doors';
import {
  effectiveFog,
  fogModeOf,
  identityRegion,
  lightSources,
  sightRangeLimitOn,
  type LightSource,
  visibleRooms,
  visionShareOf,
  type FogMode,
  type FogRoom,
  type FogState,
  type SceneFog,
} from '@dnd/mechanics/fog';
import { sightParty, type Token, type TokensState } from '@dnd/mechanics/tokens';
import {
  sceneTriggersOf,
  worldLightOf,
  type TriggersState,
} from '@dnd/mechanics/triggers';
import {
  NOON,
  composeGrade,
  timeBucket,
  type BiteLevel,
  type WorldLight,
} from '@dnd/core/src/shared/world';
import { SIGHT_MASK, addScreenOverlay, mountWhenEngineReady } from '../../renderer/overlayLayer';
import { prefersReducedMotion } from '../../session/motion';
import { useSessionStore } from '../../session/store';
import type { LiveDoor } from '../doors/doors';
import { useTokenInteraction } from '../tokens/drag';
import { tokensOf } from '../tokens/TokenRenderer';
import {
  fogPad,
  fogRegion,
  type FogRing,
  type NightSight,
  paintedGround,
  ringsWithHoles,
  roomAt,
  roomFog,
  sceneFog,
  serverDoors,
  serverLayers,
  serverRooms,
  sightPad,
} from './fog';
import { placedLights, sightCache, sighted } from './visionSight';
import { MASK_MEMORY, createLivingFog, fogPalette } from './livingFog';
import { tierPlan, type DrawPlan, type TierScene } from './tierPlan';
import { createTierCompositor } from './tierCompositor';

/** What the player's canvas does with one room. */
export type RoomView = 'visible' | 'explored' | 'dark';

/** D10 — the one deliberately slow beat in the product. A play beat, not decoration. */
export const REVEAL_MS = 300;

/**
 * The floor under `subscribeFogScene`'s frame coalescing — long enough that a tab actually
 * being painted always beats it to the rebuild, so nothing about the visible path moves.
 *
 * ponytail: a hidden tab's timers are throttled by the browser to ~1s, so this is a *wider*
 * coalescing window there than the frame ever was, not a narrower one — a backgrounded seat
 * rebuilds less than a foregrounded one, it just stops rebuilding never.
 */
export const REBUILD_FLOOR_MS = 100;

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
export const EXPLORED_TINT_ALPHA = 0.3;
/**
 * How much of that alpha a memory keeps on the brightest scene, 0..1 — the wash follows the
 * light level (`memoryAlpha`). The pair above was tuned for a dark crypt; on a noon map it
 * put explored rooms at a third of live, which reads as night in daylight. At daylight the
 * wash lands near half strength (memories ~60% of live), and a `darkness` scene keeps the
 * full 0.7 — the brightness order (void < memory < lit) holds at every level because the live
 * room brightens with the level faster than the wash eases.
 */
export const MEMORY_WASH_FLOOR = 0.45;
/** The living fog's mist over the memory tier on the darkest scene; it eases by the same floor. */
export const MEMORY_MIST = 0.25;
/** The explored wash for one scene, by how dark it is (`FogScene.darkness`). */
export const memoryAlpha = (darkness: number): number =>
  EXPLORED_TINT_ALPHA * (MEMORY_WASH_FLOOR + (1 - MEMORY_WASH_FLOOR) * darkness);
/**
 * How hard the grade composites — the same for every seat. The world is cold tonight for
 * everyone at the table, referee included; what a player cannot see is this layer's tiers,
 * never a darker multiply. The editor's own value: the sprite is created at 0.95 and this hands
 * it back there on unmount.
 */
export const GRADE_STRENGTH = 0.95;

/*
 * S3 P3 §4 used to grade unlit ground a darkvision eye reaches through a navy wash, ramped in
 * from every pool's radius. Gone: that ground is the map's own floor under the night grade,
 * exactly as the referee sees it — the grade already leaves it near-grey, which is all the art
 * guide's "shape without colour" asks — and the wash's ramp drew the pool's radius as a tint
 * boundary where the DM only ever sees light running out. How a pool or a darkvision ring runs
 * out on the player's seat is the cloud's now, on the lighting pass's own rim curve
 * (`LivingFog.setPools`).
 */

/**
 * How dark a scene is at each light level, 0..1 — the same on every seat. The memory wash and
 * the mist ease with it (`memoryAlpha`) and the cloud's palette settles a step darker on it.
 * Nobody having stated a level reads as full dark: the map as authored, which is what every
 * table played before the dial existed. The three dial levels land monotonically under it, and
 * a crescent night (`darkness-soft`, the sky's own) sits between dusk and a moonless one.
 *
 * `BiteLevel` is the world's name for the level (`shared/world.ts`), re-exported here because
 * this is where its strengths live.
 */
export type { BiteLevel };

export const SCENE_DARKNESS: Record<BiteLevel, number> = {
  daylight: 0.45,
  dusk: 0.75,
  'darkness-soft': 0.9,
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
 *
 * This is the *geometry* — how far past its claim a region's reach runs — and it stays small
 * because every offset in `visionRegion` grows with it (round joins on a sweep's hundreds of
 * corners: 0.4 → 1.2 here measured the mask rebuild 12ms → 30ms on the gate map). The look
 * of the edge is `FOG_FADE`, which costs nothing.
 */
export const FOG_FEATHER = 0.4;

/**
 * How wide the edge *reads*, in cells — the blur the living fog takes of its own mask, which
 * is what the cloud's coastline and the memory wash ramp over (`LivingFogLook.fade`).
 *
 * Wider than the reach on purpose: the fade runs inward from the rim, over the feather band
 * and the wall band and a little of the floor, the way sight dims at the end of its range. At
 * 0.4 it was ~6 screen pixels at play zoom from finished art to cloud, and the player's sight
 * read as a stencil where the DM's torches faded. Drawn inward it leaks nothing — the rim is
 * still solid, the reach is unchanged — and it costs one blur per rebuild, not per frame.
 */
export const FOG_FADE = 1.2;

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
  /**
   * The memory and darkvision washes, through that same multiply.
   *
   * They are drawn *above* the composite like everything else here, so a fixed constant is a
   * floor the room underneath can fall through: a wash leaves `alpha` of its own colour
   * standing whatever the map is doing, and once the grade multiplies the live room below
   * that, a memory reads *brighter* than the room it remembers — the third gate's inversion,
   * back through the door P1 opened by making the grade universal. Composited, the wash is
   * always a strict share of what the room shows live, at any grade, which is
   * the order holding by construction rather than by two constants agreeing.
   */
  memory: number;
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
  /**
   * The DM's sight preview is on and aimed at a token with eyes: the mask is drawn on the
   * DM's own canvas through that one token, as the seat holding it would draw it. Never true
   * on a player's seat. Local to the DM's tab — nothing here reaches the wire. Absent ⇒ off.
   */
  preview?: boolean;
  void: VoidStyle;
  /**
   * S3 P2 — which presentation the mask draws. Absent ⇒ `'rooms'`, exactly as the wire field
   * reads, and every field below goes unread there: the room path is untouched by any of it.
   */
  mode?: FogMode;
  /** Vision only (§1): one sweep polygon per sighted party token — the clear tier. */
  sight?: Polygon[];
  /**
   * Vision only (§1): the ground the map carries terrain paint on (`paintedGround`).
   *
   * Ground with art on it that no room covers — a painted path between two floors — is map a
   * reveal has to be able to open, and since brushed cells became walkable it is map a player
   * can be standing on. It opens the tiers; the sweep and the region record still say what is
   * actually shown there.
   */
  painted?: Polygon[];
  /** Vision only (§1): the scene's fog as *stored*, for the memory tier's cells and reveals. */
  fog?: SceneFog;
  /**
   * S3 P3 §3 — the light gate, present only in a vision scene the DM has turned to
   * `darkness`. Absent is daylight/dusk, where the whole sweep counts as lit: the P2 mask,
   * unchanged, which is what every scene keeps until the dial is touched.
   */
  night?: NightSight;
  /**
   * How dark the scene is, by its light level alone (`SCENE_DARKNESS`; 1 when nobody stated
   * one) — the same on every seat, so the DM's sight preview draws the tiers exactly as the
   * player's seat does. The memory wash, the mist and the cloud's palette follow it.
   */
  darkness: number;
  /** P2 — the one composed colour the lighting pass fills its base with (`composeGrade`). */
  grade: string;
  /** …and the coarsened clock it was composed at, which is what the pass memoizes on. */
  timeBucket: number;
  /**
   * P2 — the whole resolved world for this scene: effective gate, provenance, sun vector.
   * Absent only before the join snapshot lands. The badge reads `effectiveLevel`/`source`/
   * `wouldBe` off it; nothing this file draws needs the rest.
   */
  light?: WorldLight;
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
 *
 * P4 §4 — "the party" is the sight-link closure, not the claimed tokens alone: the referee
 * assembles its rooms-mode party with `sightParty`, and a client reading only `ownerId` would
 * render a linked hawk's room as memory while the server ships it lit. One function, both
 * sides. (Hidden and unclaimed-unlinked tokens are excluded inside it.)
 */
export function partyRoomIds(tokens: readonly Token[], rooms: readonly Room[]): string[] {
  const ids = new Set<string>();
  for (const token of sightParty(tokens)) {
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
  mode: FogMode = 'rooms',
): Bounds | null {
  // Unzoned map carries no fog at all in rooms mode (D6) — frame or no frame.
  //
  // Vision mode is the exception, and it is the whole of what makes an imported battlemap
  // playable: its unit is the cell rather than the room, so a map nobody traced still has
  // fog for the DM's brush to cut into. It needs the referee's own frame to be finite
  // (`redactMapForViewer` stamps one on a vision scene for exactly this), and a seat holding
  // no frame keeps the old answer rather than blacking the void out to the horizon.
  if (rooms.length === 0 && holdsUnzonedMap(layers) && !(mode === 'vision' && frame)) return null;

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
 * A colour as it lands after the lighting multiply: `c · lerp(1, m, s)` per channel — the
 * same arithmetic LightingRenderer's composite performs on the real void, where `m` is the
 * FBO's unlit base (`graded`) and `s` is the sprite's alpha.
 */
const lit = (hex: string, ambient: [number, number, number], s: number): number => {
  const [r, g, b] = channels(hex);
  const mul = (c: number, a: number): number => Math.round(c * (1 - s * (1 - a / 255)));
  return (mul(r, ambient[0]) << 16) | (mul(g, ambient[1]) << 8) | mul(b, ambient[2]);
};

/** Multiplied by nothing: what a seat with no lighting pass at all renders the void at. */
const UNCOMPOSITED: [number, number, number] = [255, 255, 255];

/**
 * The void's look, off the same store the real background renders from. The imitation is
 * drawn *above* the lighting composite and has to land on the same pixels the real void does,
 * so every colour here is pre-multiplied by the composite's unlit base — the grade, the same
 * on every seat (`LightingRenderer`, step 1). `composited` is: a table with no lighting
 * engine has no multiply to imitate, and the mount checks which is true.
 *
 * `grade` is the colour the composite is actually filled with — the mood carrying the hour
 * (`composeGrade`). Omitted, it falls back to the mood alone, which is what the composite
 * shows on a surface with no clock behind it.
 */
export function voidStyle(composited = true, grade?: string): VoidStyle {
  const { layers, mapSettings, grid } = useStore.getState();
  const bg = layers.find((l): l is BackgroundLayer => l.type === 'background');
  const ambient = composited ? channels(grade ?? mapSettings.ambientLight) : UNCOMPOSITED;
  const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
  return {
    fill: lit(bg?.backgroundColor ?? '#2d2d2d', ambient, GRADE_STRENGTH),
    memory: lit(hex(EXPLORED_TINT), ambient, GRADE_STRENGTH),
    dot: lit('#888888', ambient, GRADE_STRENGTH),
    dotAlpha: 0.45,
    dotsVisible: grid.visible,
  };
}

/** Everything the fog draws from, read once per mutation. */
export function fogScene(): FogScene {
  const { session, you, mapData, paintedArea } = useSessionStore.getState();
  const sceneId = session?.activeSceneId ?? null;
  const layers = useStore.getState().layers;
  const rooms = serverRooms(mapData);
  const fog = sceneFog(session?.modules?.fog as FogState | undefined, sceneId);
  const tokens = tokensOf(session?.modules?.tokens as TokensState | undefined, sceneId);
  const mode = fogModeOf(fog);
  const isPlayer = you?.role !== 'dm';
  const isVision = mode === 'vision';
  // The DM's sight preview: the selected token, if it has eyes and the preview is on. The
  // flag and the selection are this tab's own (`useTokenInteraction`), so a player's seat
  // never takes this branch and the referee never hears of it — what the DM previews is
  // computed here from the document the DM already holds, and changes nothing anyone is sent.
  const { previewSight, selectedId } = useTokenInteraction.getState();
  const previewed =
    !isPlayer && isVision && previewSight && selectedId
      ? tokens.find((t) => t.id === selectedId && (t.sight?.range ?? 0) > 0)
      : undefined;
  const preview = previewed !== undefined;
  /** Drawn through somebody's eyes: a player, or the DM looking through one token's. */
  const masked = isPlayer || preview;
  // The table's light state, both halves of it: the scene's ambient dial and every light the
  // triggers have relit. The same slice the referee reads (`vision.ts`), so the mask and the
  // redaction cannot disagree about what is burning.
  const triggers = session?.modules?.triggers as TriggersState | undefined;
  const scene = sceneId && triggers ? sceneTriggersOf(triggers, sceneId) : undefined;
  // P2 — and the world the scene is played in: the map's authored environment against the
  // campaign's clock and sky, with the DM's dial as the override that beats them. The referee
  // resolves the same thing from the same two slices (`vision.ts`), which is the whole point
  // of the rule being one function.
  const mapSettings = useStore.getState().mapSettings;
  const light =
    sceneId && triggers ? worldLightOf(mapSettings, triggers, sceneId) : undefined;
  // How dark the scene is. `null` from the resolver is still "nobody has stated a level",
  // which is full dark: an indoor map nobody has dialled draws exactly as it did before the
  // clock existed.
  const darkness = light?.biteLevel ? SCENE_DARKNESS[light.biteLevel] : 1;
  // The composed grade — mood × hour × how much sky this map has — and the bucket the lighting
  // pass memoizes it on. One colour, every seat.
  // Midday until the join snapshot lands: an unknown clock must not paint the first frame of
  // a map at midnight.
  const grade = composeGrade(mapSettings, light?.minutes ?? NOON);
  // Not taken for the DM, whose seat draws no mask at all, nor in rooms mode, which has no
  // use for it — the sweep is the expensive half of this read, and leaving it untaken is also
  // what keeps that path byte-identical.
  //
  // P5 — and taken through this seat's own eyes when the DM has set individual share: the same
  // closure the referee runs for the same identity, seeded on the tokens *you* claimed rather
  // than on every claimed token at the table. Party share passes no seed and is unchanged.
  const mine =
    visionShareOf(fog) === 'individual' && you
      ? (token: Token) => token.ownerId === you.identityId
      : undefined;
  // A preview seeds on the one token and carries its linked familiars, the way the referee's
  // own per-seat sweep does — and un-hides it for its own sweep: a hidden ambusher's sight
  // is exactly the question a DM previews.
  const eyes = previewed
    ? sighted(
        tokens.map((t) => (t.id === previewed.id ? { ...t, hidden: false } : t)),
        (t) => t.id === previewed.id,
      )
    : isVision && isPlayer
      ? sighted(tokens, mine)
      : [];
  //
  // Off *core's* layers rather than the document's, which is the one place this file reads
  // core on purpose: the table's live door state is stamped onto them for the lighting pass
  // (`syncDoorsToLighting`), and a sweep through a door the map file still calls shut is a
  // sweep the referee never took. Rooms and the door graph stay the document's for the
  // reason `serverRooms` gives — those are what core re-detects, and walls are not.
  const sight =
    isVision && masked
      ? sightCache.partySight(layers, eyes, sightRangeLimitOn(fog))
      : undefined;

  // S3 P3 §2 — the light gate, when the scene is turned to `darkness`. Every light source's
  // own sweep (placed lights the table has left on, plus token-carried ones), and separately
  // the party's darkvision eyes swept at their own `range` — the one radius that still means
  // anything, now that line of sight itself reaches the whole map. A darkvision eye is the
  // same sweep from the same spot at a shorter reach, so it shares the memo a torch there
  // would. Both go to the cloud as pools too, for the rim fade (`NightSight.pools`).
  const pad = fogPad(serverLayers(mapData));
  const nightSight = (): NightSight => {
    // The table's own switch is `lightEdits` since M2 — `lightOverrides` is a pre-M2 row that
    // `sceneTriggersOf` has already folded in, and reading it directly would let a stale `false`
    // outvote a light the DM has since turned back on. `lightSync` writes the same answer onto
    // the children this reads, but this pass can run before that write lands.
    const switches: Record<string, boolean> = {};
    for (const [id, edit] of Object.entries(scene!.lightEdits)) {
      if (edit.visible !== undefined) switches[id] = edit.visible;
    }
    const sources = lightSources(placedLights(layers), tokens, switches);
    const dark: LightSource[] = eyes
      .filter((t) => t.sight!.visionMode === 'darkvision')
      .map((t) => ({ x: t.x, y: t.y, radius: t.sight!.range }));
    const reach = sightPad(pad) + FOG_FEATHER;
    return {
      lit: sightCache.litArea(layers, sources),
      darkvision: sightCache.litArea(layers, dark),
      pools: [
        ...sources.map((s) => ({ x: s.x, y: s.y, inner: s.radius, outer: s.radius + reach })),
        ...dark.map((d) => ({ x: d.x, y: d.y, inner: d.radius * RIM_START, outer: d.radius })),
      ],
    };
  };

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
      ? fogBounds(layers, rooms, (mapData as SerializedMapData).frame ?? null, mode)
      : null,
    // Off the referee's document, like the rooms it pads: the wall band a player's mask has
    // to clear is the one the referee sent them, not whatever core relaid underneath.
    pad,
    sceneId,
    isPlayer,
    preview,
    // The imitation is drawn through the same grade the real composite multiplies by.
    void: voidStyle(true, grade),
    mode,
    // The memory tier the preview draws is the record the token's own seat reads through
    // (`identityRegion`: its owner's in individual share, the party's otherwise) — the DM's
    // copy carries every record, a player's wire only ever their own. A token nobody holds
    // has no seat and no memory: the DM's own goblin previews what it can see right now, not
    // the party's explored rooms washed in around it.
    fog:
      preview && fog
        ? previewed.ownerId
          ? {
              ...fog,
              region:
                visionShareOf(fog) === 'individual'
                  ? identityRegion(fog, previewed.ownerId)
                  : fog.region,
            }
          : { ...fog, region: undefined, rooms: {} }
        : fog,
    sight,
    // The painted ground the tiers may open onto, beside the rooms — read off the referee's
    // document like the rooms are, and only in vision mode, where the tiers are cut from a
    // sweep rather than from the room record. Rooms mode has no cell to put there.
    painted: isVision && masked ? paintedGround(mapData, paintedArea) : undefined,
    // §3 — the light gate, taken only where it is the answer: a vision scene the DM has turned
    // to `darkness`. Every light source's own sweep (placed lights the table has left on, plus
    // token-carried ones), and separately the sweeps of the party's darkvision eyes, which are
    // the polygons already computed above — a darkvision eye is not swept twice.
    night: sight && scene && light?.effectiveLevel === 'darkness' ? nightSight() : undefined,
    // …and the presentation half, which is not gated on vision mode at all: a rooms-mode scene
    // the DM calls dark should read dark too. Deliberate (D6): the dial is world state, not a
    // vision-mode feature, so it reaches every scene the DM turns it on.
    darkness,
    grade,
    timeBucket: timeBucket(light?.minutes ?? NOON),
    light,
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
 *
 * …with a floor under the frame, because a hidden tab never gets one: Chrome suspends rAF
 * while a tab is backgrounded, so a rebuild queued there stays queued for as long as the
 * seat is not being looked at, and the mask — and every number taken off it — holds its
 * pre-mutation value. The gate walk read exactly that on the second player's tab: a share
 * flip the store had already applied, still drawn through the pre-flip eyes. A backgrounded
 * seat is still a seat being sent state, so the rebuild cannot be conditional on a frame.
 * `REBUILD_FLOOR_MS` is the same coalescing, taken off a timer the browser does run.
 */
export function subscribeFogScene(onChange: () => void): () => void {
  let last: unknown[] = [];
  let queued = false;

  const changed = (): boolean => {
    const { session, you, mapData, paintedArea } = useSessionStore.getState();
    const next = [
      you?.role,
      // P5 — whose eyes the mask is drawn through in individual share, so a seat rebind is a
      // mask input like the role is. Atomic with `session` today (`session-state` sets both in
      // one `set`), which is precisely why leaving it out would be invisible until it wasn't.
      you?.identityId,
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
      // …and where that document's splats carry paint, which lands one decode after the
      // document does. Without it the first mask of a map is drawn with no painted ground and
      // nothing ever asks again — the strip between two floors stays black for the session.
      paintedArea,
      useStore.getState().layers,
      // The void look the fog imitates — background colour, ambient, grid toggle. The whole
      // settings object rather than the tint alone now: the environment type, the palette and
      // the time mode all compose into the grade the imitation is drawn through.
      useStore.getState().mapSettings,
      useStore.getState().grid.visible,
      // The DM's sight preview and the token it is aimed at. A player's selection is not a
      // mask input — their mask is never drawn through a selection — so it is left out of the
      // comparison there rather than rebuilding a sweep on every click.
      useTokenInteraction.getState().previewSight,
      you?.role === 'dm' ? useTokenInteraction.getState().selectedId : null,
    ];
    if (next.length === last.length && next.every((v, i) => v === last[i])) return false;
    last = next;
    return true;
  };

  // Whichever of the two arrives first rebuilds; the other finds the flag down and does
  // nothing, which is also what unsubscribing does to a rebuild still in flight. Cheaper
  // than holding two cancellation handles for a callback whose whole body is one `if`.
  const flush = (): void => {
    if (!queued) return;
    queued = false;
    onChange();
  };
  const check = (): void => {
    if (!changed() || queued) return;
    queued = true;
    requestAnimationFrame(flush);
    setTimeout(flush, REBUILD_FLOOR_MS);
  };

  if (changed()) onChange();
  const unsubSession = useSessionStore.subscribe(check);
  const unsubMap = useStore.subscribe(check);
  const unsubInteraction = useTokenInteraction.subscribe(check);
  return () => {
    queued = false;
    unsubSession();
    unsubMap();
    unsubInteraction();
  };
}

/**
 * One room's covering, for the fade out of a reveal — drawn into the living fog's *mask*,
 * so the reveal is the cloud dissolving over the room rather than a flat cover lifting.
 *
 * Drawn on the padded footprint the mask cuts, not on the floor polygon: fading the floor
 * alone would clear the wall band on the first frame and then dissolve the room out from
 * inside a ring that was already lit. The colours are mask tiers, not paint: black holds
 * the room hidden, `MASK_MEMORY` holds it at the mist, and the graphic's alpha easing to
 * nothing is what hands the ground to whatever the rebuilt mask says underneath.
 */
function fadeCover(g: Graphics, room: Room, view: RoomView, pad: number): void {
  if (room.boundary.length < 3 || view === 'visible') return;
  const color = view === 'dark' ? 0x000000 : MASK_MEMORY;
  for (const ring of fogRegion([room.boundary], [], pad, FOG_FEATHER).reach) {
    g.poly(ring.flat()).fill({ color, alpha: 1 });
  }
}

/**
 * Cut these land rings out of the fill just drawn — the caller's previous instruction must
 * be that fill — then paint each pocket of water inside them back solid, and recurse, so an
 * island inside the pocket is cut clear again at any depth.
 *
 * ponytail: pockets and islands are hard-edged in the geometry; the living fog's blur
 * softens every tier's edge the same way once the mask is a texture.
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
 * The animated fog this fill was always the placeholder for has landed (`livingFog.ts`): the
 * cloud reads the same tiers out of `maskPaint`, and the fill is now exactly what it claims —
 * a flat black backstop the player only ever sees if the shader fails. Every decision about
 * *where* the fog is still lives in the region geometry, shared by both.
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
 * §1's three tiers, drawn through this seat's own eyes: the sweep union is clear, everything
 * swept or DM-revealed is a memory, and the rest is the same void.
 *
 * Nothing here knows about `visionShare`, and that is P5's point: `fogScene` narrows the eyes
 * (`sighted`) and the referee narrows the memory record (`fog.region` is already *this*
 * viewer's, mapped at redaction), so the two tiers diverge per seat without this pass having a
 * second shape.
 */
/**
 * A `FogScene` as the tier compositor's pure planner wants it (`tierPlan`).
 *
 * The one judgement left in here is which rooms are *held* — every room the player was handed
 * at all, which on a map nobody zoned is no rooms and the record's own cell runs instead. That
 * rule now lives in `tierPlan.heldSources`, where a test with no GL can read it back; this
 * only decides what counts as a room polygon and which of them the DM lit by hand.
 */
function tierSceneOf(scene: FogScene): TierScene {
  const stored = scene.fog?.rooms ?? {};
  const floors = scene.rooms.filter((room) => room.boundary.length >= 3);
  return {
    sight: scene.sight ?? [],
    region: scene.fog?.region,
    rooms: floors.map((room) => room.boundary),
    revealed: floors
      .filter((room) => stored[room.id]?.status === 'revealed')
      .map((room) => room.boundary),
    painted: scene.painted,
    pad: scene.pad,
    feather: FOG_FEATHER,
    night: scene.night,
    frame: scene.bounds,
  };
}

/**
 * What one rebuild handed the layer.
 *
 * `plan` is the fork: in vision mode the mask, the scrim and the sight stencil are all
 * composited on the GPU from this description (`tierCompositor`) and *no* vector geometry is
 * drawn at all — the three Graphics come back cleared. Rooms mode leaves it null and paints
 * them exactly as it always did.
 */
export interface FogDraw {
  cells: number;
  cover: Bounds | null;
  plan: DrawPlan | null;
}

export function drawFog(
  scrim: Graphics,
  scene: FogScene,
  maskPaint?: Graphics,
  sightMask?: Graphics,
): FogDraw {
  scrim.clear();
  maskPaint?.clear();
  sightMask?.clear();
  if (!(scene.isPlayer || scene.preview) || !scene.bounds) return { cells: 0, cover: null, plan: null };
  // The one fork in this file, and after P1b it is a fork between two whole pipelines rather
  // than between two sets of rings: vision mode answers with a draw plan and paints nothing
  // here, rooms mode paints the vectors below and answers with no plan.
  if (scene.mode === 'vision') {
    const plan = tierPlan(tierSceneOf(scene));
    return { cells: plan.cells, cover: plan.cover, plan };
  }
  // Drawn one pad + feather wider than the frame: a hole that crosses the filled rect's
  // outer contour is dropped whole by the triangulator, and the frame is content-tight
  // (one square of air) while a room's padded reach can poke past it. The overhang is
  // invisible — the fill imitates the void it overpaints.
  const grow = scene.pad + FOG_FEATHER;
  let minX = scene.bounds.minX - grow;
  let minY = scene.bounds.minY - grow;
  let maxX = scene.bounds.maxX + grow;
  let maxY = scene.bounds.maxY + grow;
  const { earned, memory } = roomTiers(scene);

  // …and further still for whatever is actually cut out of it: a hole that crosses the filled
  // rect's outer contour is dropped whole by the triangulator, and the mask came back as
  // unbroken black with the hole computed and discarded. Measured off the *drawn* rings, not
  // the raw sweep — a sweep reaches the whole map by line of sight (`SIGHT_REACH`) and its
  // rays run a thousand cells out before the region clips them to what the player holds;
  // growing the cover to those put the map in a corner of a mask the size of a county.
  for (const ring of earned) {
    for (const [x, y] of ring.outline) {
      minX = Math.min(minX, x - grow);
      minY = Math.min(minY, y - grow);
      maxX = Math.max(maxX, x + grow);
      maxY = Math.max(maxY, y + grow);
    }
  }
  const [w, h] = [maxX - minX, maxY - minY];
  // Flat black: the backstop under the cloud, never a look of its own. The living fog above
  // is opaque over everything hidden, so the one job left down here is failing dark.
  scrim.rect(minX, minY, w, h).fill({ color: 0x000000, alpha: 1 });

  cutLand(scrim, earned, { color: 0x000000, alpha: 1 });

  // The memory wash is the cloud's (`LivingFog.setWash`), read off the same mask as the
  // mist, so it ramps in along live sight's rim with the tiers instead of stepping on it. The
  // scrim keeps the backstop alone: everything the party can see shows the map as rendered.

  // The living fog's tier mask: the same rings, as texel values the cloud shader reads —
  // black is hidden, `MASK_MEMORY` grey the memory tier, white everything the player has
  // earned. Hard-edged here on
  // purpose: the living fog softens the texture itself, inward only (`LivingFogLook.fade`),
  // so every tier's rim — hidden, memory, live — fades over the same distance without a
  // stroke in sight. The scrim above stays the authority on cover — if the shader never
  // draws, hidden map is still hidden.
  if (maskPaint) {
    maskPaint.rect(minX, minY, w, h).fill({ color: 0x000000, alpha: 1 });
    fillLand(maskPaint, earned, { color: 0xffffff, alpha: 1 });
    fillLand(maskPaint, memory, { color: MASK_MEMORY, alpha: 1 });
  }
  // LIVE sight only, as a stencil for the overlays that draw above the mask
  // (`SIGHT_MASK`): the token chips and the turn ring. Memory deliberately NOT
  // included: a remembered room shows what the room looked like, never what is
  // in it right now — with memory in this stencil, a hostile walking through a
  // room the party had merely explored broadcast its live position (chip and
  // turn ring both), which a two-seat walk caught on the player's canvas.
  if (sightMask) fillLand(sightMask, earned, { color: 0xffffff, alpha: 1 });
  return { cells: 0, cover: { minX, minY, maxX, maxY }, plan: null };
}

interface Fade {
  graphic: Graphics;
  startedAt: number;
}

function mountPlayerFog(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  const layer = new Container();
  const scrim = new Graphics();
  // The animated cover, above the scrim: the scrim stays the authority on what is hidden
  // (flat black, fail-dark), the mesh is the weather drawn over it.
  // The rim is the darker band the cloud draws right at its cut. At 0.75 it underlined every
  // sight line as a stroke; a third of that keeps the edge reading as weather.
  const fog = createLivingFog(engine, { dense: 1, mist: MEMORY_MIST, rim: 0.25, fade: FOG_FADE / 2 });
  // Vision mode's whole mask, composited on the GPU (docs/2026-09-01-raster-fog-mask-plan.md).
  // It paints straight into the *same* two textures the cloud shader is bound to, which is
  // the one hard constraint here — a fresh RenderTexture is a source the bind never follows.
  // Rooms mode never runs it and its four private targets stay at 4×4.
  const tiers = createTierCompositor(engine, fog.maskTextures);
  // Vision mode's scrim: the same flat black backstop, but with its holes erased on the GPU
  // instead of cut by Clipper, drawn as a plain sprite under the cloud. Fail-dark is where it
  // was — the target is filled opaque and then the finished mask is erased out of it, so any
  // pass that does not run leaves it covering everything.
  const scrimSprite = new Sprite(tiers.scrim);
  scrimSprite.visible = false;
  // The stencil the chip and ring layers wear (`sightMaskOf`). A child here so it shares this
  // layer's camera mirror; Pixi keeps a mask out of the normal draw, so it paints nothing.
  const sightMask = new Graphics();
  sightMask.label = SIGHT_MASK;
  // …and kept out of the build from the first frame, not from the frame a wearer turns up:
  // Pixi clears this flag itself when a mask is assigned, and a white fill drawn as content
  // in between would be one frame of the whole map.
  sightMask.includeInBuild = false;
  // …and vision mode's version of it: live sight as a texture. Pixi takes a Sprite as an
  // *alpha* mask (P0 proved the path), and the compositor's `live` target is exactly what the
  // vector fill used to be — the sweep, night-gated, clipped to held ground, memory left out.
  // Whichever of the two carries the `SIGHT_MASK` label is the stencil the wearers find; the
  // other is inert (the Graphics because it is cleared, the sprite because Pixi leaves a
  // released alpha mask un-renderable).
  const sightSprite = new Sprite(tiers.live);
  sightSprite.includeInBuild = false;
  layer.addChild(scrim, scrimSprite, fog.mesh, sightMask, sightSprite);
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
    /**
     * The tier mask's own texel at a world point, RGBA as the cloud shader samples it
     * (premultiplied: hidden [0,0,0,0], a memory ~[128,128,128,255], live [255,255,255,255]).
     * Null outside the mask, and on a seat that has no mask at all.
     *
     * Dev only, and the one instrument that tells the two halves of a fog bug apart — every
     * one so far has been "is the geometry wrong or is the texture wrong". It reads the whole
     * texture back off the GPU and indexes it, which stalls the pipeline: fine for a hand
     * probe or an e2e row, never for anything per-frame.
     */
    maskAt: (x: number, y: number): number[] | null => {
      if (!import.meta.env.DEV) return null;
      const fit = fog.maskFit();
      const rt = fog.maskTextures.mask;
      const read = engine.renderer?.()?.extract;
      if (!fit || !read) return null;
      const { minX, minY, maxX, maxY } = fit.bounds;
      const tx = Math.floor(((x - minX) / (maxX - minX)) * rt.width);
      const ty = Math.floor(((y - minY) / (maxY - minY)) * rt.height);
      if (tx < 0 || ty < 0 || tx >= rt.width || ty >= rt.height) return null;
      const { pixels } = read.pixels(rt);
      const i = (ty * rt.width + tx) * 4;
      return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    },
  };
  (window as Window & { __fogProbe?: typeof fogProbe }).__fogProbe = fogProbe;

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

    // …or the DM looking through one token's eyes (`scene.preview`): the same layer, the same
    // tiers, drawn on the DM's canvas for as long as the preview is on.
    layer.visible = scene.isPlayer || scene.preview === true;

    // Set every rebuild rather than once at mount: the seat is not known until the join
    // snapshot lands, and the composite itself is created asynchronously with the engine.
    const lit = composite();
    // The grade at full strength for everyone; what a seat cannot see is this layer's tiers.
    // Dialling the whole sprite off for the DM was one number doing both jobs, and what it
    // cost them was every brazier on the map (W2) — the multiply is where the light pools live.
    if (lit) lit.alpha = GRADE_STRENGTH;
    // §4 — the ambient dial, reaching the lighting pass the same way: this layer already owns
    // The grade is not set here. It is composed once a frame by core's render loop, at the
    // clock this seat installed (`modules/world/worldSync`) — one writer, because a per-frame
    // one always beats an on-mutation one and this call was being stomped back to midday.
    // `scene.grade` is still the colour the imitation void is drawn through, below.

    // The imitation has to match the void as it actually renders — including a table with no
    // lighting pass at all, where there is no multiply for the void to have gone through.
    const drawn = lit?.visible ? scene : { ...scene, void: voidStyle(false, scene.grade) };
    const built = drawFog(scrim, drawn, fog.maskPaint, sightMask);
    cells = built.cells;
    // …and the living fog over it: the same tiers as a texture, the palette pulled toward
    // the scene's grade (a torchlit scene fogs warm, a night forest cold), the mist over the
    // memory tier easing with the light level the way the wash under it does, and one render
    // of the mask — per mutation, exactly like the geometry it rasterises.
    fog.setMaskBounds(built.cover);
    // Which pipeline actually painted the mask this rebuild. A vision plan wants the
    // compositor; anything else — rooms mode, and a vision cover too big for a mask texture
    // (the `EVERYTHING` seat, which holds nothing anywhere) — wants the vector path.
    const fit = fog.maskFit();
    const raster = built.plan !== null && fit !== null;
    if (built.plan) {
      // Cleared even when nothing can be composited, so a target left holding the previous
      // rebuild cannot survive as a hole — or, on `live`, as a chip standing in the dark.
      tiers.run(raster ? built.plan : { cover: null, ops: [], cells: built.cells }, {
        scale: fit?.scale ?? 1,
        fade: FOG_FADE / 2,
      });
    }
    if (!raster) {
      // The rooms path paints `maskPaint`; so does a vision seat with no coverable mask, and
      // there the vector scrim is the only cover left — flat black over the whole plan, no
      // holes, which is the fail-dark answer that seat is owed. (In the composited case the
      // vector scrim deliberately draws nothing: a black rect *under* the scrim sprite would
      // fill the very holes the sprite carries, and the cloud already covers everything past
      // the plan's cover at `dense: 1`.)
      if (built.plan && built.cover) {
        const { minX, minY, maxX, maxY } = built.cover;
        scrim.rect(minX, minY, maxX - minX, maxY - minY).fill({ color: 0x000000, alpha: 1 });
      }
    }
    const cover = raster ? (built.cover as Bounds) : null;
    scrimSprite.visible = raster;
    if (cover) {
      scrimSprite.position.set(cover.minX, cover.minY);
      scrimSprite.width = cover.maxX - cover.minX;
      scrimSprite.height = cover.maxY - cover.minY;
      sightSprite.position.set(cover.minX, cover.minY);
      sightSprite.width = cover.maxX - cover.minX;
      sightSprite.height = cover.maxY - cover.minY;
    }
    // One of the two carries the label, never both and never neither: a wearer that finds no
    // stencil at all wears no mask, and a chip in the dark is the one failure direction fog
    // may not have. The cleared Graphics is that fallback — it hides everything.
    sightMask.label = raster ? '' : SIGHT_MASK;
    sightSprite.label = raster ? SIGHT_MASK : '';
    fog.setPalette(fogPalette(scene.grade, scene.darkness));
    fog.setMist(MEMORY_MIST * (MEMORY_WASH_FLOOR + (1 - MEMORY_WASH_FLOOR) * scene.darkness));
    fog.setWash(drawn.void.memory, memoryAlpha(scene.darkness));
    // …and in the dark, the pools the clear tier runs out over, so the cloud closes in on the
    // lighting pass's own rim curve rather than on a cut at a radius. Outside darkness the
    // geometry is the whole statement.
    fog.setPools(scene.night?.pools ?? []);
    // The vector path's own rasterisation. Skipped when the compositor painted the mask —
    // this would render `maskPaint` (empty in vision mode) straight over it — and *not*
    // skipped on a mode flip, which is what re-renders the mask through the now-active path
    // rather than leaving the other one's texture standing.
    if (!raster) fog.renderMask();
    // Stamped before the dots and the fades: those are draws, and what §4 budgets is what one
    // mutation costs to *build* — the sweeps inside `fogScene` and the Clipper pass above.
    fogProbe.mode = scene.mode ?? 'rooms';
    fogProbe.rebuilds += 1;
    fogProbe.lastRebuildMs = performance.now() - startedAt;
    sources = scene.sight?.length ?? 0;

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
        fadeCover(graphic, room, before, scene.pad);
        fog.fadePaint.addChild(graphic);
        fades.push({ graphic, startedAt: performance.now() });
        fogProbe.fadesStarted += 1;
      }
      if (fades.length > 0) fog.renderMask();
    } else if (scene.mode === 'vision') {
      // A vision scene never has fades — they are only ever started above — so one still in
      // flight here means the DM flipped the mode mid-reveal. Dropped rather than left to run
      // out, because a live fade is what drives `tick`'s own `renderMask`, and that call is the
      // vector pipeline rasterising `maskPaint` (empty in vision mode) straight over the
      // compositor's composite, every frame, for the rest of the 300ms. The two rebuild-time
      // `renderMask` calls are gated on `raster` for exactly this reason; this is how the
      // per-frame one stays gated without a second flag to keep in step.
      clearFades();
    }
    views = scene.views;
  };

  // Per frame: mirror the camera (the layer lives in screen space, above the lighting
  // composite) and advance any fade. No geometry is touched — the mask is rebuilt on
  // mutation and then simply drawn, which is what keeps the 60fps gate comfortable.
  const tick = (): void => {
    layer.position.copyFrom(world.position);
    layer.scale.copyFrom(world.scale);
    if (layer.visible) {
      // The cover quad tracks the viewport — in world coordinates, since the layer mirrors
      // the camera — so the fog lies over map and void alike and the map's extent is not a
      // tell. Reduced motion freezes the clock, never the cover.
      const vp = engine.viewport();
      const tl = engine.screenToWorld(0, 0);
      const br = engine.screenToWorld(vp.width, vp.height);
      fog.cover({ minX: tl.x - 2, minY: tl.y - 2, maxX: br.x + 2, maxY: br.y + 2 });
      if (!prefersReducedMotion()) fog.advance(ticker.deltaMS / 1000);
    }
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
    // A fade is mask animation now: re-rasterise while one runs (and once more on the frame
    // the last one ends), so the reveal is the cloud thinning rather than a cover lifting.
    fog.renderMask();
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
      if (lit) lit.alpha = GRADE_STRENGTH;
      // The grade needs no handing back — this file no longer sets it. The clock goes back with
      // `syncWorldToScene`'s own cleanup, and the render loop recomposes from there.
      // Before the fog, which owns the two textures the compositor borrows.
      tiers.destroy();
      fog.destroy();
      if (!layer.destroyed) layer.destroy({ children: true });
    } catch {
      /* engine torn down first */
    }
  };
}

/** Call from an effect; the returned function is the effect's cleanup. */
export const mountPlayerFogWhenReady = (pollMs?: number): (() => void) =>
  mountWhenEngineReady(mountPlayerFog, pollMs);
