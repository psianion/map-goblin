// D10's classification, its one animation and its rebuild discipline, pinned without a GPU.
//
// The Pixi mount itself needs WebGL, so the browser gate (I2) owns "does it look right".
// What is checkable here is everything that decides *what* gets drawn: which room is black,
// dim or clear under each fog/door/reachability combination, which reveal earns a fade, and
// that an unrelated store write does not rebuild the mask.

import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Mesh, Sprite, Ticker } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '@dnd/core/src/geometry/Clipper2Engine';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { pointInPolygon } from '@dnd/core/src/engine/hitTest';
import type { DoorChild, Room } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { clearEngineSingleton, setEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { useStore } from '@dnd/core/src/store/store';
import type { PlayerInfo, ServerMessage, SessionState } from '@dnd/core/src/shared/protocol';
import { regionOf, setCells, type RoomFog, type SceneFog } from '@dnd/mechanics/fog';
import type { Token } from '@dnd/mechanics/tokens';
import type { LiveDoor } from '../doors/doors';
import { useSessionStore } from '../../session/store';
import { useTokenInteraction } from '../tokens/drag';
import { shownMaskOf, sightMaskOf } from '../../renderer/overlayLayer';
import {
  FOG_MARGIN,
  fogPad,
  fogRegion,
  paintedGround,
  regionRects,
  type FogRing,
  type NightSight,
  ringsWithHoles,
} from './fog';
import {
  SCENE_DARKNESS,
  GRADE_STRENGTH,
  memoryAlpha,
  EXPLORED_TINT,
  EXPLORED_TINT_ALPHA,
  FOG_FEATHER,
  PARTY_ROOM_UNKNOWN,
  REBUILD_FLOOR_MS,
  REVEAL_MS,
  drawFog,
  easeOutQuart,
  fogBounds,
  fogScene,
  partyRoomIds,
  revealDurationMs,
  revealsBetween,
  roomViews,
  mountPlayerFogWhenReady,
  subscribeFogScene,
  voidStyle,
  type FogScene,
  type RoomView,
  type VoidStyle,
} from './FogRenderer';
import { DEFAULT_FOG_LOOK, MASK_MEMORY } from './livingFog';
import { tokenLightId } from '../triggers/lightSync';

/** A fixed void look for fixtures — drawFog paints hidden map with `fill`, not black. */
const VOID: VoidStyle = {
  fill: 0x131316,
  memory: EXPLORED_TINT,
  dot: 0x3a3a3a,
  dotAlpha: 0.45,
  dotsVisible: true,
};

/**
 * The mask's padding is Clipper2 offsets, so the geometry half of this file needs the real
 * WASM. jsdom sends emscripten down the browser path, where it tries to `fetch` the .wasm over
 * HTTP and fails under vitest — so hand it the bytes directly, as `roomDetection.test.ts` does.
 *
 * Every Clipper call degrades to the identity without this, which is the unpadded mask, so a
 * missing module here would quietly pass the rest of the file rather than fail it.
 */
beforeAll(async () => {
  // `as string` keeps these untyped — the package has no @types/node.
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(
    createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'),
  );
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule((await mod.default({ wasmBinary })) as MainModule);
}, 30_000);

// ── Fixtures ────────────────────────────────────────────────────────────────
// A three-room crypt in a line: vestibule — gallery — vault, one door between each.

const room = (id: string, x: number): Room => ({
  id,
  name: id,
  boundary: [
    [x, 0],
    [x + 4, 0],
    [x + 4, 4],
    [x, 4],
  ],
  centroid: [x + 2, 2],
  area: 16,
  isPathway: false,
});

const VESTIBULE = room('r-vestibule', 0);
const GALLERY = room('r-gallery', 10);
const VAULT = room('r-vault', 20);
const ROOMS = [VESTIBULE, GALLERY, VAULT];

const door = (id: string, a: string, b: string, over: Partial<DoorChild> = {}): DoorChild =>
  ({
    id,
    childType: 'door',
    visible: true,
    wallId: `w-${id}`,
    position: [0, 0],
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
    roomA: a,
    roomB: b,
    ...over,
  }) as DoorChild;

const live = (over: Partial<LiveDoor['live']> = {}): LiveDoor['live'] => ({
  open: false,
  locked: false,
  revealed: true,
  ...over,
});

const liveDoor = (d: DoorChild, state = live()): LiveDoor => ({ door: d, live: state });

const fogOf = (rooms: Record<string, RoomFog>, concealBehindDoors = true): SceneFog => ({
  rooms,
  concealBehindDoors,
});

const seen: RoomFog = { status: 'revealed', wasEverRevealed: true };
const stale: RoomFog = { status: 're_hidden', wasEverRevealed: true };

const token = (over: Partial<Token> = {}): Token => ({
  id: 't1',
  name: 'Ayla',
  imageAssetId: null,
  size: 'medium',
  disposition: 'friendly',
  sight: null,
  light: null,
  defId: null,
  x: 2,
  y: 2,
  elevation: 0,
  z: 0,
  hidden: false,
  ownerId: 'p1',
  ...over,
});

/**
 * The fills a `drawFog` scrim is made of, and the hole each one carries.
 *
 * Pixi's instruction union covers textures and strokes as well, none of which the scrim ever
 * emits — the cast is what lets a row read `style.color` without narrowing past three shapes
 * that cannot occur here.
 */
const fillsOf = (g: Graphics) =>
  g.context.instructions
    .filter((i) => i.action === 'fill')
    .map((i) => i.data as { style: { color: number; alpha: number }; hole?: unknown });

// ── Classification (D3 + D10) ───────────────────────────────────────────────

describe('roomViews — what each room is doing', () => {
  it('is black for every room nobody has entered', () => {
    const views = roomViews(ROOMS, fogOf({}), [], []);
    expect([...views.values()]).toEqual<RoomView[]>(['dark', 'dark', 'dark']);
  });

  it('is clear where the party stands and dim where they have been', () => {
    const views = roomViews(
      ROOMS,
      fogOf({ [VESTIBULE.id]: seen, [GALLERY.id]: stale }),
      [],
      [VESTIBULE.id],
    );
    expect(views.get(VESTIBULE.id)).toBe('visible');
    expect(views.get(GALLERY.id)).toBe('explored');
    expect(views.get(VAULT.id)).toBe('dark');
  });

  it('dims a revealed room the party cannot reach through a shut door', () => {
    const doors = [liveDoor(door('d-vg', VESTIBULE.id, GALLERY.id))];
    const views = roomViews(
      ROOMS,
      fogOf({ [VESTIBULE.id]: seen, [GALLERY.id]: seen }),
      doors,
      [VESTIBULE.id],
    );
    expect(views.get(VESTIBULE.id)).toBe('visible');
    // Revealed but sealed off: explored, not live — and never black, they have been there.
    expect(views.get(GALLERY.id)).toBe('explored');
  });

  it('clears that same room the moment the door opens', () => {
    const doors = [liveDoor(door('d-vg', VESTIBULE.id, GALLERY.id), live({ open: true }))];
    const views = roomViews(
      ROOMS,
      fogOf({ [VESTIBULE.id]: seen, [GALLERY.id]: seen }),
      doors,
      [VESTIBULE.id],
    );
    expect(views.get(GALLERY.id)).toBe('visible');
  });

  it('never routes sight through a secret door the party has not found', () => {
    const doors = [
      liveDoor(
        door('d-secret', VESTIBULE.id, GALLERY.id, { isSecret: true }),
        live({ open: true, revealed: false }),
      ),
    ];
    const views = roomViews(
      ROOMS,
      fogOf({ [VESTIBULE.id]: seen, [GALLERY.id]: seen }),
      doors,
      [VESTIBULE.id],
    );
    expect(views.get(GALLERY.id)).toBe('explored');
  });

  it('with concealment off, revealed is visible however shut the doors are', () => {
    const doors = [liveDoor(door('d-vg', VESTIBULE.id, GALLERY.id))];
    const views = roomViews(
      ROOMS,
      fogOf({ [VESTIBULE.id]: seen, [GALLERY.id]: seen }, false),
      doors,
      [VESTIBULE.id],
    );
    expect(views.get(GALLERY.id)).toBe('visible');
    expect(views.get(VAULT.id)).toBe('dark');
  });

  it('leaves a re-hidden room the party is standing in dim, not black (D7)', () => {
    const views = roomViews(ROOMS, fogOf({ [VESTIBULE.id]: stale }), [], [VESTIBULE.id]);
    expect(views.get(VESTIBULE.id)).toBe('explored');
  });

  // ── no room is lit for free ────────────────────────────────────────────────
  // The default-room fallback used to reveal the largest non-pathway room whenever nothing
  // was stored as revealed (amendment 2026-07-28). The fourth browser gate read it as the
  // map's brightest room shown to a player the DM had told nothing, so it is off on both
  // sides of the wire — see `NO_FALLBACK_ROOM`, and `vision.ts` for the referee's half.

  it('stays black on a fresh scene, however big the room and whoever is on the map', () => {
    const shut = [
      liveDoor(door('d-vg', VESTIBULE.id, GALLERY.id)),
      liveDoor(door('d-gv', GALLERY.id, VAULT.id)),
    ];
    expect(roomViews(ROOMS, fogOf({}), shut, []).get(GALLERY.id)).toBe('dark');
    expect(roomViews(ROOMS, fogOf({}), shut, [VESTIBULE.id]).get(GALLERY.id)).toBe('dark');
  });

  it('stays black for a room the DM has never named, next to one they have', () => {
    const views = roomViews(ROOMS, fogOf({ [VAULT.id]: seen }), [], [VAULT.id]);
    expect(views.get(VAULT.id)).toBe('visible');
    expect(views.get(GALLERY.id)).toBe('dark');
  });

  it('leaves a Hide All a map of memories, with nothing lit', () => {
    const views = roomViews(
      ROOMS,
      fogOf({ [VESTIBULE.id]: stale, [VAULT.id]: stale }),
      [],
      [VESTIBULE.id],
    );
    // The wash's own regression: the last room going under used to hand the biggest one
    // back as `visible`, which is why a memory measured within 0.35% of the same room live.
    expect(views.get(VESTIBULE.id)).toBe('explored');
    expect(views.get(VAULT.id)).toBe('explored');
    expect(views.get(GALLERY.id)).toBe('dark');
  });

  it('covers an unrevealed room with unbroken black, whatever is lit underneath it', () => {
    // The half a classification cannot show: the room's torch is baked into the map art and
    // composited *below* this layer (D12), so the only thing standing between a player and a
    // lit room they were never shown is whether the scrim has a hole in it. On a fresh scene
    // it must have none at all — one opaque rect, no cut, nothing for the light to come
    // through. This is the fourth gate's 83.1-luminance Torchlit Chamber, as an assertion.
    const scrim = new Graphics();
    drawFog(scrim, {
      rooms: ROOMS,
      views: roomViews(ROOMS, fogOf({}), [], []),
      bounds: fogBounds([], ROOMS),
      pad: fogPad([]),
      sceneId: 's1',
      isPlayer: true,
      darkness: 1,
      grade: '#ffffff',
      timeBucket: 0,
      void: VOID,
      look: DEFAULT_FOG_LOOK,
    });

    const fills = fillsOf(scrim);
    expect(fills).toHaveLength(1);
    expect(fills[0].style.color).toBe(0x000000);
    expect(fills[0].style.alpha).toBe(1);
    expect(fills[0].hole).toBeUndefined();
  });

  it('cuts a hole for a room the DM did reveal, so the mask is not simply always black', () => {
    const scrim = new Graphics();
    const views = roomViews(ROOMS, fogOf({ [GALLERY.id]: seen }), [], [GALLERY.id]);
    drawFog(scrim, {
      rooms: ROOMS,
      views,
      bounds: fogBounds([], ROOMS),
      pad: fogPad([]),
      sceneId: 's1',
      isPlayer: true,
      darkness: 1,
      grade: '#ffffff',
      timeBucket: 0,
      void: VOID,
      look: DEFAULT_FOG_LOOK,
    });

    expect(fillsOf(scrim)[0].hole).toBeDefined();
  });

  it('classifies nothing on a map nobody zoned — there is no fog to enforce (D6)', () => {
    expect(roomViews([], fogOf({}), [], []).size).toBe(0);
  });
});

describe('partyRoomIds', () => {
  it('counts claimed, unhidden tokens by the room they stand in', () => {
    const tokens = [
      token({ id: 't1', x: 2, y: 2 }),
      token({ id: 't2', x: 12, y: 2 }),
      token({ id: 't3', x: 22, y: 2, ownerId: null }), // DM scenery
      token({ id: 't4', x: 22, y: 2, hidden: true }),
    ];
    expect(partyRoomIds(tokens, ROOMS).sort()).toEqual([GALLERY.id, VESTIBULE.id].sort());
  });

  it('counts a linked token the party never claimed — the referee’s party is the closure', () => {
    // P4 §4: the DM hands the party a hawk and links it to the scout. The server assembles
    // its rooms-mode party with `sightParty`, so a client filtering on `ownerId` alone would
    // paint the hawk's room as memory while the referee ships it lit.
    const scout = token({ id: 't1', x: 2, y: 2, sharesSightWith: ['hawk'] });
    const hawk = token({ id: 'hawk', x: 12, y: 2, ownerId: null, sharesSightWith: ['t1'] });
    expect(partyRoomIds([scout, hawk], ROOMS).sort()).toEqual([GALLERY.id, VESTIBULE.id].sort());

    // Hidden still trumps the link — the DM taking the hawk off the board closes it.
    expect(partyRoomIds([scout, { ...hawk, hidden: true }], ROOMS)).toEqual([VESTIBULE.id]);
  });

  it('names a room it cannot place a claimed token in, rather than reporting no party', () => {
    // The reload case: the party's own token is somewhere this tab has no geometry for,
    // because the default-room fallback stopped handing that room over (amendment
    // 2026-07-28). Concealment has to stay on — the server, which *can* place the token,
    // keeps concealing — so the id has to be a real element that no door leads to.
    expect(partyRoomIds([token({ x: 100, y: 100 })], ROOMS)).toEqual([PARTY_ROOM_UNKNOWN]);
    expect(ROOMS.some((r) => r.id === PARTY_ROOM_UNKNOWN)).toBe(false);
  });

  it('keeps a revealed room a memory when the party is standing somewhere unknown', () => {
    // Without the line above this reads as "no party", `effectiveFog` drops concealment and
    // the gallery lights up — while the server goes on withholding everything inside it.
    const views = roomViews(
      [GALLERY],
      fogOf({ [GALLERY.id]: seen }),
      [liveDoor(door('d1', VESTIBULE.id, GALLERY.id))],
      partyRoomIds([token({ x: 100, y: 100 })], [GALLERY]),
    );
    expect(views.get(GALLERY.id)).toBe<RoomView>('explored');
  });
});

// ── The reveal fade (D10) ───────────────────────────────────────────────────

describe('revealsBetween — one fade per reveal, and only per reveal', () => {
  const views = (entries: Record<string, RoomView>): Map<string, RoomView> =>
    new Map(Object.entries(entries));

  it('fades nothing on the first paint — arriving at a lit table is not a reveal', () => {
    expect(revealsBetween(null, views({ [VESTIBULE.id]: 'visible' })).size).toBe(0);
  });

  it('fades a newly visible room from what it was', () => {
    const reveals = revealsBetween(
      views({ [VESTIBULE.id]: 'dark', [GALLERY.id]: 'explored' }),
      views({ [VESTIBULE.id]: 'visible', [GALLERY.id]: 'visible' }),
    );
    expect(reveals.get(VESTIBULE.id)).toBe('dark');
    expect(reveals.get(GALLERY.id)).toBe('explored');
  });

  it('fades from black a room whose geometry only just arrived with the delta', () => {
    const reveals = revealsBetween(views({}), views({ [VAULT.id]: 'visible' }));
    expect(reveals.get(VAULT.id)).toBe('dark');
  });

  it('does not fade again on a re-render of the same state', () => {
    const next = views({ [VESTIBULE.id]: 'visible' });
    expect(revealsBetween(next, next).size).toBe(0);
  });

  it('does not fade a room that went the other way', () => {
    const reveals = revealsBetween(
      views({ [VESTIBULE.id]: 'visible' }),
      views({ [VESTIBULE.id]: 'explored' }),
    );
    expect(reveals.size).toBe(0);
  });
});

describe('reveal timing', () => {
  it('runs 300ms of ease-out by default', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(revealDurationMs()).toBe(REVEAL_MS);
    expect(easeOutQuart(0)).toBe(0);
    expect(easeOutQuart(1)).toBe(1);
    // Ease-out: most of the distance is covered early.
    expect(easeOutQuart(0.5)).toBeGreaterThan(0.9);
    vi.unstubAllGlobals();
  });

  it('cuts instantly under prefers-reduced-motion — no tween at all', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion') }));
    expect(revealDurationMs()).toBe(0);
    vi.unstubAllGlobals();
  });
});

// ── The explored look, at the pixel (D10) ───────────────────────────────────
// Two browser gates have been lost in here, in opposite directions: the second read every
// explored room as a flat dark-grey box, and the third read them *brighter* than the lit
// rooms next to them. Neither is something the wash constants can be checked for alone —
// what a memory looks like is the multiply composite and the fog's fill together. So the
// arithmetic below models both halves over a strip of floor and asks both questions: is
// there still texture in there, and is it below the same floor when the room is live.

/** One flat fill over a base channel value, source-over. Channels are 0..255. */
const over = (base: number, color: number, alpha: number): number =>
  base * (1 - alpha) + color * alpha;

/**
 * LightingRenderer's composite, the same on every seat. The blend is `multiply` and the
 * sprite's alpha is a *strength* — `dst · lerp(1, m, a)` — where `m` is the FBO's unlit
 * base: the grade. `#0d0e12` is the gate map's
 * grade, and all four of its torches are in one room: every other room is composited against
 * exactly this. The red channel, the grade's dimmest and so the strictest of the three.
 *
 * P1 made the grade universal, which moved every absolute number in this section: a player's
 * unlit floor on the darkest map in the repo now lands where the *editor* has always drawn it
 * and then a little under. What the rows below assert is therefore the ordering and the
 * texture — which is what the two lost gates were actually about — and they are stated as
 * shares of the live room rather than as levels of 255.
 */
const AMBIENT = 0x0d;
const unlit = (base: number): number =>
  base * (1 - GRADE_STRENGTH + GRADE_STRENGTH * (AMBIENT / 255));

/** A stretch of dungeon floor, as one channel. Texture is the spread between these. */
const FLOOR = [140, 168, 120, 190, 152];
const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);

/**
 * What the wash does to whatever it is given — through the composite, as it is now drawn
 * (`VoidStyle.memory`). A fixed constant here was the inversion's whole mechanism: it left a
 * floor standing that the graded room below it could fall through.
 */
const washedTint = (EXPLORED_TINT & 0xff) * (1 - GRADE_STRENGTH + GRADE_STRENGTH * (AMBIENT / 255));
const washed = (base: number): number => over(base, washedTint, EXPLORED_TINT_ALPHA);

describe('the explored look', () => {
  it('keeps the floor texture readable — a memory, not a placeholder', () => {
    // Composed the way it actually is: the wash over the room's *lit* render, which is what
    // collapsed to under three levels of 255 and read as the second gate's flat box. As a
    // share of the room's own texture, because the grade owns the absolute level now.
    const drawn = FLOOR.map((v) => washed(unlit(v)));
    expect(spread(drawn) / spread(FLOOR.map(unlit))).toBeGreaterThan(0.25);
    // …and nowhere near the void, which is what `never_revealed` is reserved for.
    expect(Math.min(...drawn)).toBeGreaterThan(washed(0));
  });

  it('is a strict dimming of the same room live — the third gate’s inversion', () => {
    // Unlit floor: the case that inverted, because a memory used to skip the multiply
    // entirely and land ten times brighter than the ambient-lit room beside it.
    for (const v of FLOOR) expect(washed(unlit(v))).toBeLessThan(unlit(v));
    // And under a torch at full strength, where the wash has the most to give back.
    for (const v of FLOOR) expect(washed(v)).toBeLessThan(v);
    // A dimming the map reads through — the user's call on the live table: a memory is the
    // room, a step darker under a thin haze, never a wash that replaces it.
    expect(EXPLORED_TINT_ALPHA).toBeGreaterThan(0);
    expect(EXPLORED_TINT_ALPHA).toBeLessThan(0.5);
  });

  it('never pedestals a memory above the dimmest thing a live room can be', () => {
    // The invariant behind both rows above, stated once: what the wash leaves standing over
    // pure black is the floor of "explored", and it has to sit under the floor of "visible"
    // or the order inverts again on the next map with a darker ambient — or, since P1, on any
    // map at all, the grade having become universal and the live floor having come down with
    // it. Composited, the pedestal comes down by exactly the same factor, so this now holds
    // for every grade rather than for the one it was tuned against.
    const pedestal = washedTint * EXPLORED_TINT_ALPHA;
    expect(pedestal).toBeLessThan(Math.min(...FLOOR.map(unlit)));
  });
});

describe('the grade each seat composites at', () => {
  it('keeps the grade for every seat — the half that is presentation, not vision (W2)', () => {
    // P1's split. The DM used to lose the whole multiply to that zero above, and with it every
    // brazier on the map: the light pools live in the same composite the mood does.
    expect(GRADE_STRENGTH).toBeGreaterThan(0);
    // …and the imitation void is drawn through that grade alone, on every seat: the lighting
    // pass has no per-seat fill any more, so the map under a player's clear tier is the DM's
    // map to the pixel. The old "player lands strictly under the DM" was a second fill of the
    // same colour that never changed a pixel — the seats were measured identical at the base.
    expect(voidStyle()).toEqual(voidStyle(true));
    expect(unlit(160)).toBe(160 * (1 - GRADE_STRENGTH + GRADE_STRENGTH * (0x0d / 255)));
  });

  it('keeps the memory tier a step under live at every light level (F)', () => {
    // The wash eases with the level so a noon memory is not a night one — but it never
    // reaches zero, and it is the full pair on the darkest scene the pair was tuned against.
    expect(memoryAlpha(1)).toBe(EXPLORED_TINT_ALPHA);
    expect(memoryAlpha(SCENE_DARKNESS.daylight)).toBeLessThan(memoryAlpha(SCENE_DARKNESS.dusk));
    expect(memoryAlpha(SCENE_DARKNESS.dusk)).toBeLessThan(memoryAlpha(1));
    expect(memoryAlpha(0)).toBeGreaterThan(0.1);
    for (const v of FLOOR) expect(over(v, washedTint, memoryAlpha(0))).toBeLessThan(v);
  });
});

// ── P1 §4 — the scene's darkness, level by level ────────────────────────────
describe('SCENE_DARKNESS', () => {
  it('lands the crescent’s soft night between dusk and a moonless one', () => {
    // The sky's own level: mechanically a `darkness` scene (`needsLight` is untouched by it),
    // presented a shade softer because there is a little light out there. Nothing sets it
    // until the world clock and the sky do.
    expect(SCENE_DARKNESS.daylight).toBeLessThan(SCENE_DARKNESS.dusk);
    expect(SCENE_DARKNESS.dusk).toBeLessThan(SCENE_DARKNESS['darkness-soft']);
    expect(SCENE_DARKNESS['darkness-soft']).toBeLessThan(SCENE_DARKNESS.darkness);
    expect(SCENE_DARKNESS.darkness).toBe(1);
  });
});

// ── The padded, feathered edge (the player seat's report) ───────────────────
// What came back from the table: the mask cut straight through the wall band, so a lit room
// showed roughly half the stones of its own walls and a door opening sat in a black
// rectangular notch with the mark floating in it. The cause is that `room.boundary` is the
// *floor* — detection subtracts the wall band from the merged floor and does not put the door
// gap back — so anything cut to the polygon crops the room at the inside face of its walls.
//
// The fixture is that geometry rather than a convenient rectangle: two 6-cell rooms either
// side of one 0.5-wide wall, floors cut back 0.25 from its centreline exactly as
// `wallToRects` cuts them, and a door filling the gap between them.

const WALL_WIDTH = 0.5;
/** The shared wall's centreline; each floor stops `WALL_WIDTH / 2` short of it. */
const SPINE = 10;

const hall = (id: string, x0: number, x1: number): Room => ({
  id,
  name: id,
  boundary: [
    [x0, 0],
    [x1, 0],
    [x1, 6],
    [x0, 6],
  ],
  centroid: [(x0 + x1) / 2, 3],
  area: (x1 - x0) * 6,
  isPathway: false,
});

/** Floors stop at 9.75 and 10.25; the stones between them are the wall nobody's polygon owns. */
const WEST = hall('r-west', 4, SPINE - WALL_WIDTH / 2);
const EAST = hall('r-east', SPINE + WALL_WIDTH / 2, 16);

/** A room far enough away that its padded footprint never merges with West's. */
const FAR = hall('r-far', 30, 36);

/** West's outer (exterior) wall: centreline 3.75, so its far face is a full wallWidth out. */
const WEST_OUTER_FACE = 4 - WALL_WIDTH;

// Land at even depth, water at odd — a point is in the region when the deepest ring over
// it is land, which is what the recursive "inside this ring but not covered by its
// children" asks at every level of the tree.
const covered = (nodes: readonly FogRing[], point: [number, number]): boolean =>
  nodes.some(({ outline, holes }) => pointInPolygon(point, outline) && !covered(holes, point));

const inRegion = (rings: Polygon[], point: [number, number]): boolean =>
  covered(ringsWithHoles(rings), point);

describe('fogPad — how far past its floor a room reaches', () => {
  it('buys the whole wall band, not half of it, plus the margin', () => {
    // Detection's cutter takes width/2 off the floor and the stones straddle the centreline by
    // another width/2, so the far face is a full wallWidth out. Paying half leaves the outer
    // row of stones in the dark, which is the report.
    expect(fogPad([])).toBeCloseTo(WALL_WIDTH + FOG_MARGIN);
    expect(fogPad([dungeon([])])).toBeCloseTo(WALL_WIDTH + FOG_MARGIN);
  });

  it('follows the map’s own wall width rather than a constant', () => {
    const thick = { ...dungeon([]), style: { wallWidth: 1.2 } } as unknown as Layer;
    expect(fogPad([thick])).toBeCloseTo(1.2 + FOG_MARGIN);
  });
});

describe('fogRegion — the hole the mask cuts', () => {
  const PAD = fogPad([]);
  const region = (lit: Room[], blocked: Room[]) =>
    fogRegion(
      lit.map((r) => r.boundary),
      blocked.map((r) => r.boundary),
      PAD,
      FOG_FEATHER,
    );

  it('reaches past the outer face of the wall band, with margin to spare', () => {
    const { clear } = region([WEST], []);
    // The stones themselves, inside and out — never half-swallowed.
    expect(inRegion(clear, [4 - 0.01, 3])).toBe(true);
    expect(inRegion(clear, [WEST_OUTER_FACE, 3])).toBe(true);
    // …and the margin past them, so the boundary is not sitting on the last stone's edge.
    expect(inRegion(clear, [WEST_OUTER_FACE - FOG_MARGIN + 0.05, 3])).toBe(true);
    // The claim is bounded, though: it is the wall plus a margin, not an open-ended halo.
    expect(inRegion(clear, [WEST_OUTER_FACE - FOG_MARGIN - 0.1, 3])).toBe(false);
  });

  it('takes in the door opening next to a revealed room — no notch, no floating mark', () => {
    // The gap runs the full thickness of the wall, 9.75 to 10.25, and the floor polygon owns
    // none of it. Both jambs and the leaf between them have to be inside the hole or the door
    // the player is looking at is a black rectangle with a marker in it.
    const { clear } = region([WEST], []);
    for (const y of [2.5, 3, 3.5]) {
      expect(inRegion(clear, [SPINE - WALL_WIDTH / 2 + 0.01, y])).toBe(true);
      expect(inRegion(clear, [SPINE, y])).toBe(true);
      expect(inRegion(clear, [SPINE + WALL_WIDTH / 2 - 0.01, y])).toBe(true);
    }
  });

  it('stops dead at an unrevealed neighbour’s floor, however close the wall is', () => {
    // The wall is only 0.5 thick, so the margin alone would hand over the first fraction of a
    // cell of the room next door. Walls are a fair thing to spend the pad on; floors are the
    // tell, and the region is where that is enforced rather than in a repaint afterwards.
    const { clear, reach } = region([WEST], [EAST]);
    expect(inRegion(clear, [SPINE, 3])).toBe(true); // the wall between them: still West's
    expect(inRegion(clear, [SPINE + WALL_WIDTH / 2 + 0.01, 3])).toBe(false);
    expect(inRegion(clear, [13, 3])).toBe(false); // deep inside the unrevealed room
    // …and the falloff does not smuggle it back in either.
    expect(inRegion(reach, [SPINE + WALL_WIDTH / 2 + 0.01, 3])).toBe(false);
    expect(inRegion(reach, [13, 3])).toBe(false);
  });

  it('merges two rooms a wall apart into one hole rather than two overlapping ones', () => {
    // Padded footprints of adjacent rooms overlap, and Pixi's `cut` takes a set of holes on
    // the promise that they do not. Unmerged, the shared wall is triangulated twice.
    const { clear } = region([WEST, EAST], []);
    expect(ringsWithHoles(clear)).toHaveLength(1);
    expect(inRegion(clear, [SPINE, 3])).toBe(true);
  });

  it('keeps an island clear inside a fogged courtyard inside revealed rooms', () => {
    // Three concentric rings: revealed land, unrevealed water walled inside it, and a
    // revealed island inside *that*. The old one-level pairing dropped the island — three
    // rings deep it went dark. The tree keeps every level: land at even depth, water at odd.
    const sq = (r: number): Polygon => [
      [-r, -r],
      [r, -r],
      [r, r],
      [-r, r],
    ];
    const rings = [sq(3), sq(10), sq(6), sq(1.5)]; // deliberately out of order
    const tree = ringsWithHoles(rings);

    expect(tree).toHaveLength(1);
    expect(tree[0].outline).toBe(rings[1]); // sq(10) is the land
    expect(tree[0].holes).toHaveLength(1); // sq(6) is its water…
    expect(tree[0].holes[0].holes).toHaveLength(1); // …sq(3) the island in it…
    expect(tree[0].holes[0].holes[0].holes).toHaveLength(1); // …sq(1.5) water again

    expect(inRegion(rings, [0, 8])).toBe(true); // land
    expect(inRegion(rings, [0, 4.5])).toBe(false); // courtyard stays fogged
    expect(inRegion(rings, [0, 2])).toBe(true); // the island is clear, not dropped
    expect(inRegion(rings, [0, 0])).toBe(false); // pocket inside the island errs dark
    expect(inRegion(rings, [0, 20])).toBe(false); // outside everything
  });

  it('runs the falloff outside the room’s claim, never into it', () => {
    const { clear, reach } = region([WEST], []);
    const edge = 4 - PAD;
    // Everything the room owns is at full strength before the ramp starts.
    expect(inRegion(clear, [edge + 0.05, 3])).toBe(true);
    // The ramp lives beyond it…
    expect(inRegion(reach, [edge - FOG_FEATHER + 0.05, 3])).toBe(true);
    expect(inRegion(clear, [edge - FOG_FEATHER + 0.05, 3])).toBe(false);
    // …and finishes. Past the reach the fog is solid, which is where an unrevealed room's own
    // geometry would otherwise start becoming readable.
    expect(inRegion(reach, [edge - FOG_FEATHER - 0.1, 3])).toBe(false);
  });

  it('has nothing to say about a map with no revealed rooms', () => {
    expect(fogRegion([], [WEST.boundary], PAD, FOG_FEATHER)).toEqual({ clear: [], reach: [] });
  });
});

describe('drawFog — the padded hole and its falloff, as instructions', () => {
  const scene = (views: Record<string, RoomView>): FogScene => ({
    rooms: [WEST, EAST],
    views: new Map(Object.entries(views)),
    bounds: fogBounds([], [WEST, EAST]),
    pad: fogPad([]),
    sceneId: 's1',
    isPlayer: true,
    darkness: 1,
      grade: '#ffffff',
      timeBucket: 0,
    void: VOID,
    look: DEFAULT_FOG_LOOK,
  });

  const strokesOf = (g: Graphics) =>
    g.context.instructions
      .filter((i) => i.action === 'stroke')
      .map(
        (i) => (i.data as { style: { alpha: number; width: number; alignment: number } }).style,
      );

  it('cuts one merged hole and ramps the cloud mask back in over it', () => {
    const scrim = new Graphics();
    const mask = new Graphics();
    drawFog(scrim, scene({ [WEST.id]: 'visible', [EAST.id]: 'dark' }), mask);

    // One black backstop fill for the map, with the earned region taken out of it — and no
    // falloff of its own: a stepped ramp on a fill the cloud hides was paint nobody saw.
    const fills = fillsOf(scrim);
    expect(fills[0].style.color).toBe(0x000000);
    expect(fills[0].hole).toBeDefined();
    expect(strokesOf(scrim)).toHaveLength(0);

    // The tiers live in the mask the cloud reads: black over the cover, white over the
    // earned region — hard-edged, because the living fog softens the *texture* (inward only,
    // `LivingFogLook.fade`). A stroke ladder used to draw the ramp here; at the width the
    // fade wants now it combed every sweep's rim, so nothing is stroked any more.
    const tiers = fillsOf(mask);
    expect(tiers[0].style.color).toBe(0x000000);
    expect(tiers.some((f) => f.style.color === 0xffffff)).toBe(true);
    expect(strokesOf(mask)).toHaveLength(0);
  });

  it('gives a memory the same padded footprint at its own darkness', () => {
    const scrim = new Graphics();
    const mask = new Graphics();
    drawFog(scrim, scene({ [WEST.id]: 'explored', [EAST.id]: 'dark' }), mask);

    // The memory's footprint lands in the cloud's mask at the memory tier's grey — which is
    // where both the mist and the wash over a memory come from now (`LivingFog.setWash`).
    // The scrim draws no wash of its own: a flat fill there stepped on the sight line.
    expect(fillsOf(mask).some((f) => f.style.color === MASK_MEMORY)).toBe(true);
    expect(fillsOf(scrim).find((f) => f.style.color === EXPLORED_TINT)).toBeUndefined();
  });

  it('leaves an all-dark map one unbroken fill, padded or not', () => {
    const scrim = new Graphics();
    drawFog(scrim, scene({ [WEST.id]: 'dark', [EAST.id]: 'dark' }));
    expect(fillsOf(scrim)).toHaveLength(1);
    expect(fillsOf(scrim)[0].hole).toBeUndefined();
    expect(strokesOf(scrim)).toHaveLength(0);
  });

  it('keeps a remembered room IN the chip stencil — rooms mode lets you stand in one', () => {
    const scrim = new Graphics();
    const mask = new Graphics();
    const sightMask = new Graphics();
    // FAR rather than EAST: two rooms one wall apart have padded footprints that merge into
    // a single ring, so counting the stencil's fills there proves nothing whichever tier it
    // was drawn from. Well clear of each other, the coverage question is answerable.
    const twoRooms: FogScene = {
      ...scene({ [WEST.id]: 'visible', [FAR.id]: 'explored' }),
      rooms: [WEST, FAR],
      bounds: fogBounds([], [WEST, FAR]),
    };
    drawFog(scrim, twoRooms, mask, sightMask);

    // The cloud mask knows both tiers apart…
    expect(fillsOf(mask).some((f) => f.style.color === MASK_MEMORY)).toBe(true);
    expect(fillCovers(mask, FAR.centroid)).toBe(true);
    // …and the stencil the chips and the turn ring wear covers BOTH, at one strength. Rooms
    // mode's live tier is the DM's revealed set rather than a sweep, and D7 lets the party
    // walk into a room they remember but the DM has not lit — a seat's own token there is on
    // the wire by design (`inSight` exempts `mine`), so a live-only stencil would rub the
    // player's own chip off their own canvas. Somebody ELSE's token in that room never
    // reaches the wire at all: `tokens.redact` gates a foreign token on `scene.visible`.
    // Vision mode is the live-only one, and it draws no vectors here at all.
    const stencilFills = fillsOf(sightMask);
    expect(stencilFills.every((f) => f.style.color === 0xffffff)).toBe(true);
    expect(fillCovers(sightMask, WEST.centroid)).toBe(true);
    expect(fillCovers(sightMask, FAR.centroid)).toBe(true);
    // Never-seen ground stays out of it — the stencil is not a licence to draw anywhere.
    expect(fillCovers(sightMask, [23, 3])).toBe(false);
  });

  /** Is a world point inside any polygon this graphic fills? */
  const fillCovers = (g: Graphics, point: [number, number]): boolean =>
    g.context.instructions
      .filter((i) => i.action === 'fill')
      .some((i) => {
        const path = (i.data as { path?: { instructions?: { action: string; data: unknown[] }[] } })
          .path;
        return (path?.instructions ?? [])
          .filter((step) => step.action === 'poly')
          .some((step) => {
            const flat = step.data[0] as number[];
            const poly: Polygon = [];
            for (let k = 0; k + 1 < flat.length; k += 2) poly.push([flat[k], flat[k + 1]]);
            return pointInPolygon(point, poly);
          });
      });

  it('keeps a memory IN the door stencil — a remembered room still shows its doors', () => {
    // The other half of the row above, and the whole of the door leak. A door is map
    // information: once the room around it has been seen, where the door is has stopped being
    // a secret, and a remembered room that drew its walls but not its doors would be lying
    // about its own layout. A live position is not like that, which is why the chips wear the
    // narrower stencil and the marks wear this one.
    const scrim = new Graphics();
    const shownMask = new Graphics();
    drawFog(
      scrim,
      scene({ [WEST.id]: 'visible', [EAST.id]: 'explored' }),
      undefined,
      undefined,
      shownMask,
    );

    expect(fillsOf(shownMask).every((f) => f.style.color === 0xffffff)).toBe(true);
    expect(fillCovers(shownMask, [6, 3]), 'the room the party can see').toBe(true);
    expect(fillCovers(shownMask, [13, 3]), 'the room it only remembers').toBe(true);
  });

  it('cuts never-seen ground out of the door stencil', () => {
    // The direction that leaks is fail-visible: a door standing where this seat has never been
    // shown anything has to be cut away, whatever the referee let them hold. In vision mode a
    // room ships whole the moment any of it is swept, so "they hold it" is not "they see it".
    const scrim = new Graphics();
    const shownMask = new Graphics();
    drawFog(scrim, scene({ [WEST.id]: 'visible', [EAST.id]: 'dark' }), undefined, undefined, shownMask);
    expect(fillCovers(shownMask, [6, 3])).toBe(true);
    expect(fillCovers(shownMask, [13, 3]), 'a room nobody has entered').toBe(false);

    const allDark = new Graphics();
    drawFog(scrim, scene({ [WEST.id]: 'dark', [EAST.id]: 'dark' }), undefined, undefined, allDark);
    expect(fillsOf(allDark)).toHaveLength(0);
  });
});

// ── Vision mode's three tiers (S3 P2 §1) ────────────────────────────────────
// The party's own eyes draw the top tier instead of the room record: a sweep is clear, what
// they have swept or the DM has revealed is a memory, and the rest is the same void. Every
// row below is written so the *room* rule would answer differently — a room the DM never
// revealed showing only the cells the party swept is the whole point of the phase.

/** A 24×8 frame over both halls, with unzoned map east of them. Cell (c, r) is [c, c+1]. */
const VISION_FRAME = { minX: 0, minY: 0, maxX: 24, maxY: 8 };

/** A stretch of the west hall's upper half, as a sight polygon would come off the sweep. */
const LOOKING: Polygon = [
  [6, 0.5],
  [8, 0.5],
  [8, 2],
  [6, 2],
];

describe('regionRects — the swept cells as geometry', () => {
  /** How many cells those runs are made of — the merge has to be lossless, not just tidy. */
  const cellsIn = (rects: readonly Polygon[]): number =>
    rects.reduce((n, rect) => n + (rect[1][0] - rect[0][0]), 0);
  const region = (cells: [number, number][]) =>
    setCells(regionOf({ minX: 0, minY: 0, maxX: 6, maxY: 6 })!, cells);

  it('merges a row of cells into one rectangle and leaves the gaps alone', () => {
    const rects = regionRects(
      region([
        [1, 0],
        [2, 0],
        [3, 0],
        [5, 0],
        [1, 1],
      ]),
    );
    // Three runs, not five squares: Clipper unioning 150 unit cells for one 8-cell sight
    // radius costs an order more than unioning the dozen runs they collapse into.
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual([
      [1, 0],
      [4, 0],
      [4, 1],
      [1, 1],
    ]);
    // A run that reaches the last column is closed like any other.
    expect(rects[1]).toEqual([
      [5, 0],
      [6, 0],
      [6, 1],
      [5, 1],
    ]);
    expect(rects[2][0]).toEqual([1, 1]);
    // …and the runs still add up to the cells that were set.
    expect(cellsIn(rects)).toBe(5);
  });

  it('is nothing at all for a scene that keeps no region record', () => {
    expect(regionRects(undefined)).toEqual([]);
    expect(cellsIn(regionRects(regionOf(VISION_FRAME)))).toBe(0);
  });
});

describe('paintedGround — the terrain the referee sent', () => {
  const doc = (terrain: unknown) => ({ mapSettings: { terrain } }) as never;
  const BOUNDS = { minX: -5, minY: 40, maxX: 58, maxY: 64 };
  const on = doc({ palette: ['gg:grass', null], bounds: BOUNDS });
  /** What `decodePaintedArea` read off the splats: two strips, not the box around them. */
  const DECODED: Polygon[] = [
    [
      [24, 45],
      [31, 45],
      [31, 61],
      [24, 61],
    ],
    [
      [40, 50],
      [44, 50],
      [44, 54],
      [40, 54],
    ],
  ];

  it('is the paint the splats carry, not the box around it', () => {
    // The box is `BOUNDS` — 63 × 24 cells. What is painted inside it is these two strips, and
    // the void between them is the dome the fire ring used to clear on the player's seat.
    expect(paintedGround(on, DECODED)).toEqual(DECODED);
  });

  it('is nothing at all until the decode lands', () => {
    // A mask drawn before the splats are read has not been told where the ground is, and a fog
    // that does not know fails dark rather than open.
    expect(paintedGround(on, null)).toEqual([]);
  });

  it('is nothing at all when there is no paint to reveal', () => {
    expect(paintedGround(null, DECODED)).toEqual([]);
    expect(paintedGround(doc(undefined), DECODED)).toEqual([]);
    // Nothing painted yet, the whole layer switched off, and a palette with no texture in it —
    // three ways of having no art out there, and the clip stays exactly what it was for all of
    // them, whatever the decode came back with.
    expect(paintedGround(doc({ palette: ['gg:grass'], bounds: null }), DECODED)).toEqual([]);
    expect(
      paintedGround(doc({ palette: ['gg:grass'], bounds: BOUNDS, visible: false }), DECODED),
    ).toEqual([]);
    expect(paintedGround(doc({ palette: [null, null], bounds: BOUNDS }), DECODED)).toEqual([]);
  });
});

// The vision mask's own contracts — the held clip, the cover, which tier a revealed room lands
// in, the night gate, the record as texels — moved to `tierPlan.test.ts` with the pipeline that
// answers them (docs/2026-09-01-raster-fog-mask-plan.md, P2). What stays here is the seam: what
// `drawFog` hands that pipeline, and what it no longer paints itself.

describe('drawFog in vision mode', () => {
  const visionScene = (over: Partial<FogScene> = {}): FogScene => ({
    rooms: [WEST, EAST],
    views: new Map(),
    bounds: fogBounds([], [WEST, EAST]),
    pad: fogPad([]),
    sceneId: 's1',
    isPlayer: true,
    darkness: 1,
      grade: '#ffffff',
      timeBucket: 0,
    void: VOID,
    mode: 'vision',
    sight: [],
    fog: { rooms: {}, concealBehindDoors: true },
    look: DEFAULT_FOG_LOOK,
    ...over,
  });

  // P1b — vision mode composites its mask, its scrim and its sight stencil on the GPU from a
  // `DrawPlan` (docs/2026-09-01-raster-fog-mask-plan.md), so what these rows pin is the seam:
  // which pipeline `drawFog` chose, and what it handed it. *What the plan means* is pinned
  // without a GPU in `tierPlan.test.ts` and with one in `compositor-check`.

  it('hands vision mode to the compositor and paints no vector geometry at all', () => {
    const scrim = new Graphics();
    const mask = new Graphics();
    const stencil = new Graphics();
    const drawn = drawFog(scrim, visionScene({ sight: [LOOKING] }), mask, stencil);

    // Not one instruction on any of the three: a vector cut left standing here would be a
    // second opinion about where the holes are, drawn under the composited one.
    expect(scrim.context.instructions).toHaveLength(0);
    expect(mask.context.instructions).toHaveLength(0);
    expect(stencil.context.instructions).toHaveLength(0);

    // …and the plan says the same three things the vectors used to. The sweep is the live
    // tier, the clip is the last word on the mask, and the scrim is one erase of it.
    const plan = drawn.plan!;
    expect(plan.cover).toEqual(drawn.cover);
    expect(plan.ops.filter((op) => op.target === 'live' && op.kind === 'polys')).toMatchObject([
      { polys: [LOOKING], color: 0xffffff },
    ]);
    // Contained sight defaults on, so a scene that says nothing is fenced and the clip that
    // gets the last word is the shipping one. The claim the row is making — that *a* clip is
    // always last — is the same either way, so the switch's other position is pinned here too
    // rather than in a row of its own.
    const maskOps = plan.ops.filter((op) => op.target === 'mask');
    expect(maskOps.at(-1)).toMatchObject({ source: 'inverseShipped', blend: 'erase' });
    const uncontained = drawFog(
      new Graphics(),
      visionScene({ sight: [LOOKING], fog: { rooms: {}, concealBehindDoors: true, containedSight: false } }),
      new Graphics(),
      new Graphics(),
    );
    expect(uncontained.plan!.ops.filter((op) => op.target === 'mask').at(-1)).toMatchObject({
      source: 'inverseHeld',
      blend: 'erase',
    });
    expect(plan.ops.filter((op) => op.target === 'scrim')).toMatchObject([
      { kind: 'rect', color: 0x000000 },
      { kind: 'sprite', source: 'mask', blend: 'erase' },
    ]);
    expect(drawn.cells).toBe(0);
  });

  // The stencil the chip and ring layers wear above the mask is the compositor's `live`
  // target — live sight, night-gated and clipped to held ground, memory deliberately left
  // out. The vector stencil is cleared and stays cleared: in vision mode the fog layer hands
  // the wearers a Sprite of that target instead (`SIGHT_MASK`).
  it('leaves the vector stencil empty and puts live sight on its own target', () => {
    const stencil = new Graphics();
    const drawn = drawFog(new Graphics(), visionScene({ sight: [LOOKING] }), undefined, stencil);
    expect(fillsOf(stencil)).toEqual([]);
    const live = drawn.plan!.ops.filter((op) => op.target === 'live');
    expect(live).toMatchObject([
      { kind: 'polys', polys: [LOOKING] },
      // The clip is on this target too, because it is the stencil as well as a tier — and on
      // a contained scene (the default) it is the wider `inverseOpen`, which is the held fence
      // with the range-earned term added to it. One clip either way, and it is the last word.
      { kind: 'sprite', source: 'inverseOpen', blend: 'erase' },
    ]);
    // Memory never reaches it: a remembered room shows what it looked like, never who is
    // standing in it now — with memory in the stencil a hostile walking through an explored
    // room broadcast its live position, which a two-seat walk caught.
    expect(live.some((op) => op.kind === 'cells' || op.kind === 'rect')).toBe(false);

    // Nothing seen: no live draw at all, so the target composites to nothing and hides every
    // chip. The clip still runs on the mask — a stale hole may not survive a rebuild.
    const blind = drawFog(new Graphics(), visionScene({ sight: [] }), undefined, stencil);
    expect(blind.plan!.ops.filter((op) => op.target === 'live')).toEqual([]);
    expect(blind.plan!.ops.filter((op) => op.target === 'mask')).toMatchObject([
      { kind: 'sprite', source: 'inverseShipped', blend: 'erase' },
    ]);

    // A seat that draws no mask gets no plan either — the DM wears no stencil.
    const dm = drawFog(new Graphics(), visionScene({ sight: [LOOKING], isPlayer: false }), undefined, stencil);
    expect(dm).toMatchObject({ plan: null, cover: null, cells: 0 });
    expect(fillsOf(stencil)).toEqual([]);
  });

  // …and the marks' stencil is the *other* target. `live` is the sweep alone; the tier mask is
  // transparent where the seat holds nothing and painted over everything it is shown, so its
  // alpha is shown-ness and a Sprite of it is the door layer's mask (`SHOWN_MASK`).
  it('leaves the shown stencil to the tier mask, not to live sight', () => {
    const shown = new Graphics();
    const drawn = drawFog(
      new Graphics(),
      visionScene({
        sight: [LOOKING],
        fog: {
          rooms: { [EAST.id]: { status: 'revealed', wasEverRevealed: true } },
          concealBehindDoors: true,
          region: setCells(regionOf(VISION_FRAME)!, [
            [5, 4],
            [6, 4],
          ]),
        },
      }),
      undefined,
      undefined,
      shown,
    );
    // The vector carrier is cleared here exactly like the sight one — the sprite carries it.
    expect(fillsOf(shown)).toEqual([]);

    // The memory tier — the cell record and the DM's revealed room — is painted into `mask`
    // and never into `live`. That is the whole of the difference between what a chip may say
    // and what a door mark may say, and it is why the marks take a Sprite of `mask`.
    const kindsOn = (target: string) =>
      drawn
        .plan!.ops.filter((op) => op.target === target && op.kind !== 'sprite')
        .map((op) => op.kind);
    expect(kindsOn('mask')).toEqual(['cells', 'polys']);
    expect(kindsOn('live')).toEqual(['polys']);
  });

  it('counts the record into the memory tier, and washes nothing itself', () => {
    const scrim = new Graphics();
    const drawn = drawFog(
      scrim,
      visionScene({
        sight: [LOOKING],
        fog: {
          rooms: { [EAST.id]: { status: 'revealed', wasEverRevealed: true } },
          concealBehindDoors: true,
          region: setCells(regionOf(VISION_FRAME)!, [
            [5, 4],
            [6, 4],
          ]),
        },
      }),
    );

    // The wash is the cloud's (`setWash`), read off the mask — the scrim carries no paint of
    // its own in either mode, and in this one it carries no instructions either.
    expect(fillsOf(scrim).find((f) => f.style.color === EXPLORED_TINT)).toBeUndefined();
    expect(scrim.context.instructions).toHaveLength(0);
    expect(drawn.cells).toBe(2);
    // The record as texels and the DM's revealed room, both grey, both under live sight.
    const greys = drawn.plan!.ops.filter((op) => op.target === 'mask' && op.kind !== 'sprite');
    expect(greys.map((op) => op.kind)).toEqual(['cells', 'polys']);
  });

  it('leaves a party with no eyes and no memory an unbroken cover', () => {
    // The mask fails dark, which is the only direction a fog bug may fail in: no sweep and
    // no record is a player who has earned nothing, not a player who is owed everything. On
    // this path that is the scrim target filled opaque with an empty mask erased out of it.
    const drawn = drawFog(new Graphics(), visionScene());
    const plan = drawn.plan!;
    expect(plan.ops.some((op) => op.target === 'live')).toBe(false);
    // Contained by default, so the clip that runs is the shipping one — and it fails in the
    // same direction: a target nothing erased into is a full white cover, which takes the
    // whole mask rather than leaving a hole in it.
    expect(plan.ops.filter((op) => op.target === 'mask')).toMatchObject([
      { kind: 'sprite', source: 'inverseShipped', blend: 'erase' },
    ]);
    expect(plan.ops.filter((op) => op.target === 'scrim')).toHaveLength(2);
  });

  it('draws the DM nothing at all, as in every other mode (principle 3)', () => {
    const scrim = new Graphics();
    const drawn = drawFog(scrim, visionScene({ sight: [LOOKING], isPlayer: false }));
    expect(scrim.context.instructions).toHaveLength(0);
    expect(drawn.plan).toBeNull();
  });
});

// ── Bounds ──────────────────────────────────────────────────────────────────

describe('fogBounds', () => {
  it('is null on a map nobody zoned — there is no fog to enforce (D6)', () => {
    // Content but no rooms is the unzoned map, which the server hands over whole.
    const unzoned = dungeon([], [door('d1', 'a', 'b')]);
    expect(fogBounds([unzoned], [])).toBeNull();
  });

  it('covers everything for a player holding nothing at all', () => {
    // Not the same case, and the opposite answer: an empty layer is a party that has been
    // shown nothing, and the fourth gate caught that seat rendering the grid and the
    // background at full strength because this returned null and the mask was never drawn.
    const bounds = fogBounds([dungeon([], [])], [])!;
    expect(bounds).not.toBeNull();
    expect(bounds.minX).toBeLessThan(-1000);
    expect(bounds.maxX).toBeGreaterThan(1000);
  });

  it('covers every room and then some, so the edge of the map is not a tell', () => {
    const bounds = fogBounds([], ROOMS)!;
    expect(bounds.minX).toBeLessThan(0);
    expect(bounds.maxX).toBeGreaterThan(24);
  });
});

// ── Rebuild discipline (D10: on mutation, never per frame) ──────────────────

const player: PlayerInfo = { identityId: 'p1', name: 'Ayla', role: 'player', connected: true };

const session = (modules: Record<string, unknown> = {}): SessionState => ({
  protocolVersion: PROTOCOL_VERSION,
  sessionId: 's1',
  campaignId: 'c1',
  activeSceneId: 'scene-1',
  scenes: [{ id: 'scene-1', name: 'Crypt', mapId: 'scene-1' }],
  players: [player],
  modules,
});

const dungeon = (rooms: Room[], children: DoorChild[] = []): Layer =>
  ({ id: 'l1', type: 'dungeon', visible: true, children, standaloneWalls: [], rooms }) as unknown as Layer;

/** The document the server sent — where the mask's rooms come from (never core's store). */
const sent = (layers: Layer[]) => ({ version: '3.0', layers });

describe('subscribeFogScene', () => {
  beforeEach(() => {
    useSessionStore.setState({
      session: session(),
      you: player,
      latencyMs: null,
      mapData: sent([dungeon(ROOMS)]),
    });
    useStore.setState({ layers: [dungeon(ROOMS)] });
  });

  /** Rebuilds are coalesced to the frame; this is the frame. */
  const frame = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

  it('rebuilds when the fog slice changes', async () => {
    const onChange = vi.fn();
    const stop = subscribeFogScene(onChange);
    expect(onChange).toHaveBeenCalledTimes(1); // once on subscribe, like the other layers

    useSessionStore.setState({
      session: session({ fog: { byScene: { 'scene-1': fogOf({ [VESTIBULE.id]: seen }) } } }),
    });
    await frame();
    expect(onChange).toHaveBeenCalledTimes(2);

    stop();
  });

  it('rebuilds when a door or a token moves, and when the map grows', async () => {
    const onChange = vi.fn();
    const stop = subscribeFogScene(onChange);
    onChange.mockClear();

    useSessionStore.setState({ session: session({ doors: { byScene: {} } }) });
    await frame();
    useSessionStore.setState({ session: session({ doors: { byScene: {} }, tokens: {} }) });
    await frame();
    useStore.setState({ layers: [dungeon([...ROOMS, room('r-new', 30)])] });
    await frame();
    // …and when a reveal delta lands, which is the map growing where the mask reads it.
    useSessionStore.setState({ mapData: sent([dungeon([...ROOMS, room('r-new', 30)])]) });
    await frame();

    expect(onChange).toHaveBeenCalledTimes(4);
    stop();
  });

  it('builds the mask once for the several writes one reveal lands', async () => {
    // A reveal replaces the fog slice, the door slice and the document, and core
    // re-lays the layers under it. Four notifications, one beat, one mask.
    const onChange = vi.fn();
    const stop = subscribeFogScene(onChange);
    onChange.mockClear();

    const grown = [dungeon([...ROOMS, room('r-new', 30)])];
    useSessionStore.setState({
      session: session({ fog: { byScene: { 'scene-1': fogOf({ [VESTIBULE.id]: seen }) } } }),
    });
    useSessionStore.setState({ session: session({ doors: { byScene: {} } }) });
    useSessionStore.setState({ mapData: sent(grown) });
    useStore.setState({ layers: grown });
    expect(onChange).not.toHaveBeenCalled();

    await frame();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not rebuild on an unrelated store write', async () => {
    const onChange = vi.fn();
    const stop = subscribeFogScene(onChange);
    onChange.mockClear();

    // A ping lands ~every few seconds; a mask rebuild on each would be a per-frame cost in
    // all but name.
    useSessionStore.setState({ latencyMs: 42 });
    useSessionStore.setState({ presence: [] });
    useStore.setState({ grid: { ...useStore.getState().grid } });

    await frame();
    expect(onChange).not.toHaveBeenCalled();
    stop();
  });

  it('stops rebuilding once unsubscribed', async () => {
    const onChange = vi.fn();
    subscribeFogScene(onChange)();
    onChange.mockClear();
    useSessionStore.setState({ session: session({ fog: { byScene: {} } }) });
    await frame();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('fogScene', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: session(), you: player, mapData: sent([dungeon(ROOMS)]) });
    useStore.setState({ layers: [dungeon(ROOMS)] });
  });

  it('takes its rooms from the server’s document, never from core’s re-detection', () => {
    // Core backfills `layer.rooms` from wall geometry 250ms after any load, so a map nobody
    // zoned arrives in the store with rooms the referee has never heard of — and a mask
    // built on those blacks out a map the server is not fogging at all. Measured on
    // `demo-dungeon.mapbuilder`: 0 rooms on disk, 4 in the store.
    useSessionStore.setState({ mapData: sent([dungeon([])]) });
    const scene = fogScene();
    expect(scene.rooms).toEqual([]);
    expect(scene.views.size).toBe(0);
    // The document the referee sent has no rooms *and* nothing in it, which is a player who
    // has been shown nothing rather than an unzoned map — so it is covered, not left open.
    // A real unzoned map arrives with its props and walls and takes the other branch, which
    // is the case `fogBounds` above pins.
    expect(scene.bounds).not.toBeNull();
  });

  it('draws nothing at all before the document has arrived', () => {
    useSessionStore.setState({ mapData: null });
    expect(fogScene().bounds).toBeNull();
  });

  it('masks for a player and not for the DM', () => {
    expect(fogScene().isPlayer).toBe(true);
    useSessionStore.setState({ you: { ...player, role: 'dm' } });
    expect(fogScene().isPlayer).toBe(false);
  });

  it('masks while the role is still unknown — fail closed, like the map loader', () => {
    useSessionStore.setState({ you: null });
    expect(fogScene().isPlayer).toBe(true);
  });

  it('reads fog, doors and tokens together', () => {
    useSessionStore.setState({
      mapData: sent([dungeon(ROOMS, [door('d-vg', VESTIBULE.id, GALLERY.id)])]),
      session: session({
        fog: { byScene: { 'scene-1': fogOf({ [VESTIBULE.id]: seen, [GALLERY.id]: seen }) } },
        tokens: { library: {}, byScene: { 'scene-1': { t1: token() } } },
      }),
    });

    const scene = fogScene();
    expect(scene.views.get(VESTIBULE.id)).toBe('visible');
    // The authored door is shut, so the gallery is sealed off behind it.
    expect(scene.views.get(GALLERY.id)).toBe('explored');
    expect(scene.bounds).not.toBeNull();
  });

  it('walks the server’s door graph, not the room ids core re-bound the doors to', () => {
    // The drift this exists to stop. Core's `roomSync` re-detects rooms after every load and
    // rewrites `roomA`/`roomB` on every door from the geometry *that tab* holds — and a
    // player holds a partial map with no merged floor at all (the server ships it null). So
    // the store's idea of which rooms a door joins is the store's alone, and a reachability
    // BFS run over it can seal a room the referee opened, or open one it sealed. Only the
    // document's own door records carry the ids the server tested with.
    const authored = door('d-vg', VESTIBULE.id, GALLERY.id, { state: 'open' });
    // Same door id, bound to rooms core invented — plus a link to the vault that the server
    // never authored, so a mask reading this would err bright as well as dark.
    const rebound = door('d-vg', 'r-detected-a', VAULT.id, { state: 'open' });

    useSessionStore.setState({
      mapData: sent([dungeon(ROOMS, [authored])]),
      session: session({
        fog: {
          byScene: {
            'scene-1': fogOf({ [VESTIBULE.id]: seen, [GALLERY.id]: seen, [VAULT.id]: seen }),
          },
        },
        tokens: { library: {}, byScene: { 'scene-1': { t1: token() } } },
      }),
    });
    useStore.setState({ layers: [dungeon(ROOMS, [rebound])] });

    const views = fogScene().views;
    expect(views.get(VESTIBULE.id)).toBe('visible');
    // Through the door the *document* authors: the party walks vestibule → gallery.
    expect(views.get(GALLERY.id)).toBe('visible');
    // …and never through the one only core believes in.
    expect(views.get(VAULT.id)).toBe('explored');
  });

  // ── vision mode (S3 P2 §3) ───────────────────────────────────────────────

  const sightedToken = (over: Partial<Token> = {}): Token =>
    token({ sight: { range: 4, angle: 360, visionMode: 'normal' }, ...over });

  it('takes no sweep at all in rooms mode — the mode is the whole fork', () => {
    const scene = fogScene();
    expect(scene.mode).toBe('rooms');
    expect(scene.sight).toBeUndefined();
  });

  it('sweeps through every claimed pair of eyes in vision mode, and no others', () => {
    useSessionStore.setState({
      session: session({
        fog: { byScene: { 'scene-1': { ...fogOf({}), mode: 'vision' } } },
        tokens: {
          library: {},
          byScene: {
            'scene-1': {
              t1: sightedToken({ id: 't1' }),
              t2: sightedToken({ id: 't2', x: 12, y: 2, ownerId: null }),
              t3: sightedToken({ id: 't3', x: 12, y: 2, hidden: true }),
              t4: token({ id: 't4', x: 22, y: 2 }),
            },
          },
        },
      }),
    });

    const scene = fogScene();
    expect(scene.mode).toBe('vision');
    // The DM's scenery, a hidden token and one with no sight at all are not the party.
    expect(scene.sight).toHaveLength(1);
    // …and the room classification is not taken at all: the tiers come off the sweep and the
    // region record, and the fade that was its other reader is rooms-only.
    expect(scene.views.size).toBe(0);
    // The stored record rides along whole — the memory tier reads its cells and its reveals,
    // not the reachability classification `views` carries.
    expect(scene.fog?.mode).toBe('vision');
  });

  // ── the DM's sight preview ─────────────────────────────────────────────
  // Local to the DM's tab: the flag and the selection live in `useTokenInteraction`, and the
  // only thing they change is what the DM's own fog layer draws. A player's seat ignores
  // both, whatever they are set to.

  const previewScene = (tokens: Record<string, Token>, fogOver: Partial<SceneFog> = {}) =>
    useSessionStore.setState({
      session: session({
        fog: { byScene: { 'scene-1': { ...fogOf({}), mode: 'vision', ...fogOver } } },
        tokens: { library: {}, byScene: { 'scene-1': tokens } },
      }),
    });

  afterEach(() => useTokenInteraction.setState({ previewSight: false, selectedId: null }));

  it('draws the DM the selected token’s sight when the preview is on, and nothing otherwise', () => {
    useSessionStore.setState({ you: { ...player, role: 'dm' } });
    previewScene({
      npc: sightedToken({ id: 'npc', ownerId: null }),
      pc: sightedToken({ id: 'pc', x: 12, y: 2 }),
    });

    // Off: the DM's seat draws no mask at all, as ever.
    useTokenInteraction.setState({ selectedId: 'npc', previewSight: false });
    expect(fogScene().preview).toBe(false);
    expect(fogScene().sight).toBeUndefined();

    // On: one sweep, the selected token's — not the party's (the claimed `pc` is left out).
    useTokenInteraction.setState({ previewSight: true });
    const scene = fogScene();
    expect(scene.preview).toBe(true);
    expect(scene.sight).toHaveLength(1);

    // On with nothing selected: nothing to look through.
    useTokenInteraction.setState({ selectedId: null });
    expect(fogScene().preview).toBe(false);
  });

  it('looks through a hidden token too — an ambusher’s sight is the question being asked', () => {
    useSessionStore.setState({ you: { ...player, role: 'dm' } });
    previewScene({ lurker: sightedToken({ id: 'lurker', ownerId: null, hidden: true }) });
    useTokenInteraction.setState({ selectedId: 'lurker', previewSight: true });
    expect(fogScene().sight).toHaveLength(1);
  });

  it('never previews on a player’s seat, and never in rooms mode', () => {
    previewScene({ pc: sightedToken({ id: 'pc' }) });
    useTokenInteraction.setState({ selectedId: 'pc', previewSight: true });
    // A player: their own mask, drawn through the party's eyes as always, preview ignored.
    const theirs = fogScene();
    expect(theirs.preview).toBe(false);
    expect(theirs.isPlayer).toBe(true);

    // The DM in rooms mode: no sweep exists to preview.
    useSessionStore.setState({ you: { ...player, role: 'dm' } });
    previewScene({ pc: sightedToken({ id: 'pc' }) }, { mode: 'rooms' });
    expect(fogScene().preview).toBe(false);
    expect(fogScene().sight).toBeUndefined();
  });

  it('reads the memory tier through the token’s own record in individual share', () => {
    useSessionStore.setState({ you: { ...player, role: 'dm' } });
    const theirs = regionOf({ minX: 0, minY: 0, maxX: 40, maxY: 40 })!;
    previewScene(
      { pc: sightedToken({ id: 'pc', ownerId: 'p2' }) },
      { visionShare: 'individual', regions: { p2: theirs } },
    );
    useTokenInteraction.setState({ selectedId: 'pc', previewSight: true });
    expect(fogScene().fog?.region).toBe(theirs);
  });

  it('previews the fence too, on the previewed seat’s own record', () => {
    // Containment costs the preview nothing to support: the record substitution above runs
    // upstream of `tierSceneOf`, so the fence the DM is shown is drawn round the *previewed*
    // seat's opened ground and not round the party's. What has to be here is the near pass —
    // without a second, range-limited sweep on the scene the preview would fence the token at
    // its record and never show the DM the ground a step would peel back.
    useSessionStore.setState({ you: { ...player, role: 'dm' } });
    const theirs = regionOf({ minX: 0, minY: 0, maxX: 40, maxY: 40 })!;
    previewScene(
      { pc: sightedToken({ id: 'pc', ownerId: 'p2' }) },
      { visionShare: 'individual', regions: { p2: theirs } },
    );
    useTokenInteraction.setState({ selectedId: 'pc', previewSight: true });
    const scene = fogScene();
    expect(scene.fog?.region).toBe(theirs);
    expect(scene.near).toHaveLength(scene.sight!.length);
    // Zones are prep and never travel, so this seat is the one that reads the *real* zones —
    // deliberately, because they are exactly what the referee's own `inAnyLock` tests, so the
    // preview answers with the server's fence and not a cell-snapped copy of it. With no zone
    // authored on the fixture it is still an empty list, not a missing one.
    expect(scene.locks).toEqual([]);

    // Switched off, neither the second sweep nor the lock read is taken at all.
    previewScene(
      { pc: sightedToken({ id: 'pc', ownerId: 'p2' }) },
      { visionShare: 'individual', regions: { p2: theirs }, containedSight: false },
    );
    useTokenInteraction.setState({ selectedId: 'pc', previewSight: true });
    expect(fogScene().near).toBeUndefined();
    expect(fogScene().locks).toBeUndefined();
  });

  it('fences a player seat by the referee’s lock mask, since zones never travel', () => {
    // The seat holds no zones and cannot derive one, so the referee stamps the lock *cells* on
    // its cut instead (`lockMaskFor`) and this decodes them. Without it a player's near pass
    // cleared fog over ground the referee refuses to write — permanently, because it never
    // sends a correction for a cell it declined to grant.
    const lockMask = setCells(regionOf({ minX: 0, minY: 0, maxX: 40, maxY: 40 })!, [
      [5, 5],
      [6, 5],
    ]);
    previewScene({ pc: sightedToken({ id: 'pc' }) });
    useSessionStore.setState({ mapData: { ...sent([dungeon(ROOMS)]), lockMask } });
    expect(fogScene().locks).toEqual(regionRects(lockMask));

    // …and a seat handed no mask has an empty fence rather than a missing one.
    useSessionStore.setState({ mapData: sent([dungeon(ROOMS)]) });
    expect(fogScene().locks).toEqual([]);
  });

  it('gives a token nobody holds no memory at all — live sight is the whole preview', () => {
    useSessionStore.setState({ you: { ...player, role: 'dm' } });
    previewScene(
      { npc: sightedToken({ id: 'npc', ownerId: null }) },
      { region: regionOf({ minX: 0, minY: 0, maxX: 40, maxY: 40 })!, rooms: { [VESTIBULE.id]: seen } },
    );
    useTokenInteraction.setState({ selectedId: 'npc', previewSight: true });
    const scene = fogScene();
    expect(scene.sight).toHaveLength(1);
    expect(scene.fog?.region).toBeUndefined();
    expect(scene.fog?.rooms).toEqual({});
  });

  // ── individual vision (S3 P5) ────────────────────────────────────────────
  // The seat is `player` (identity `p1`). The other seat's token is one this tab legitimately
  // holds — the referee sent it because it walked into this seat's sight — so a mask that
  // swept through every claimed token would hand back exactly the party view the DM turned off.

  const twoSeatTokens = {
    library: {},
    byScene: {
      'scene-1': {
        // Symmetric edges, the way `set-sight-link` writes them on both ends.
        mine: sightedToken({ id: 'mine', sharesSightWith: ['familiar'] }),
        familiar: sightedToken({ id: 'familiar', x: 6, y: 2, ownerId: null, sharesSightWith: ['mine'] }),
        theirs: sightedToken({ id: 'theirs', x: 12, y: 2, ownerId: 'p2' }),
      },
    },
  };

  const shared = (visionShare: 'party' | 'individual') =>
    session({
      fog: { byScene: { 'scene-1': { ...fogOf({}), mode: 'vision' as const, visionShare } } },
      tokens: twoSeatTokens,
    });

  it('sweeps through this seat’s own eyes and its familiars in individual share', () => {
    useSessionStore.setState({ session: shared('individual') });
    // Own claimed token and the familiar the DM linked to it — never the other seat's.
    expect(fogScene().sight).toHaveLength(2);
  });

  it('sweeps through every claimed token in party share, which is the default', () => {
    useSessionStore.setState({ session: shared('party') });
    expect(fogScene().sight).toHaveLength(3);
    // …and an untouched scene reads party, so no table plays the narrow rule by accident.
    useSessionStore.setState({
      session: session({
        fog: { byScene: { 'scene-1': { ...fogOf({}), mode: 'vision' } } },
        tokens: twoSeatTokens,
      }),
    });
    expect(fogScene().sight).toHaveLength(3);
  });

  it('falls back to the party rule while this tab does not know who it is', () => {
    // The seat is not known until the join snapshot lands. Sweeping through nobody would
    // black the canvas out for a beat; the referee is still withholding everything secret.
    useSessionStore.setState({ session: shared('individual'), you: null });
    expect(fogScene().sight).toHaveLength(3);
  });

  // ── the light gate (S3 P3 §3) ────────────────────────────────────────────

  const lamp = (id: string, x: number, y: number, visible = true) =>
    ({
      id,
      name: id,
      childType: 'light',
      visible,
      color: '#ffbb66',
      radius: 4,
      featherRadius: 2,
      intensity: 1,
      falloff: 'quadratic',
      position: { x, y },
    }) as unknown as DoorChild;

  /**
   * A vision scene with a lamp on the map, three tokens, the DM's dial at `ambient` — and,
   * since P2, the campaign's own clock and sky over it (`world`) and whatever environment the
   * map authored.
   */
  const nightTable = (
    ambient?: string,
    switches: Record<string, boolean> = {},
    world?: { clock: number; nightSky: 'full-moon' | 'crescent' | 'moonless'; timeSpeed: 'paused' },
  ) => {
    useStore.setState({
      layers: [{ ...(dungeon(ROOMS) as object), children: [lamp('lamp-a', 3, 3)] } as Layer],
    });
    useSessionStore.setState({
      session: session({
        fog: { byScene: { 'scene-1': { ...fogOf({}), mode: 'vision' } } },
        tokens: {
          library: {},
          byScene: {
            'scene-1': {
              t1: sightedToken({ id: 't1' }),
              t2: sightedToken({
                id: 't2',
                x: 4,
                y: 2,
                sight: { range: 3, angle: 360, visionMode: 'darkvision' },
              }),
              // Carried light on the DM's own unclaimed torchbearer — not an eye, a source.
              t3: token({ id: 't3', x: 6, y: 2, ownerId: null, light: { dim: 4, bright: 2, color: '#fb6', angle: 360 } }),
            },
          },
        },
        triggers: {
          world,
          byScene: {
            'scene-1': {
              fired: {},
              armed: {},
              disabled: {},
              lightOverrides: {},
              // M2 — the table's own switch lives in `lightEdits` now (`FogRenderer.ts`).
              lightEdits: Object.fromEntries(
                Object.entries(switches).map(([id, visible]) => [id, { visible }]),
              ),
              env: ambient ? { ambient } : {},
              prompts: [],
              log: [],
            },
          },
        },
      }),
    });
    return fogScene();
  };

  it('takes no light gate at all until the DM turns the scene dark', () => {
    for (const ambient of [undefined, 'daylight', 'dusk']) {
      const scene = nightTable(ambient);
      expect(scene.sight).toHaveLength(2);
      expect(scene.night).toBeUndefined();
    }
  });

  it('gates on the lit area and the darkvision eyes when it is dark', () => {
    const scene = nightTable('darkness');
    // The map's own lamp and the torch a token is carrying — the shared rule's two halves.
    expect(scene.night?.lit).toHaveLength(2);
    // …and the darkvision half is the darkvision eye swept at its own `range` — a ring
    // inside its line of sight, which reaches the whole map (`SIGHT_REACH`).
    expect(scene.night?.darkvision).toHaveLength(1);
    expect(scene.night?.darkvision[0]).not.toBe(scene.sight?.[1]);
    const far = (poly: readonly (readonly number[])[], x: number, y: number) =>
      Math.max(...poly.map(([px, py]) => Math.hypot(px - x, py - y)));
    expect(far(scene.night!.darkvision[0], 4, 2)).toBeLessThanOrEqual(3.01);
    expect(far(scene.sight![1], 4, 2)).toBeGreaterThan(3.01);
  });

  it('marks light-source pools warm and a darkvision eye’s pool cold (D4 torch glow)', () => {
    const scene = nightTable('darkness');
    // The two light sources (the map's lamp and t3's carried torch — `lit` above) come
    // first, then the one darkvision eye (t2) — the same order `nightSight` builds `pools`
    // in (`FogRenderer.ts`). Only a light should glow the cloud warm; a darkvision eye is
    // sight running out in the dark, not a source of light.
    expect(scene.night?.pools).toHaveLength(3);
    expect(scene.night?.pools.filter((p) => p.warm)).toHaveLength(2);
    expect(scene.night?.pools.filter((p) => !p.warm)).toHaveLength(1);
  });

  it('answers to the table’s own light switch, not only to the map', () => {
    expect(nightTable('darkness', { 'lamp-a': false })?.night?.lit).toHaveLength(1);
  });

  it('counts a carried torch once — the pseudo-light on the map is that same torch', () => {
    expect(nightTable('darkness').night?.lit).toHaveLength(2);
    // What `lightSync` writes onto the map so the renderer draws t3's pool. The token is
    // already a source in its own right, so reading this as a placed light too sweeps one
    // torch twice — and the two radii only agree by coincidence (D4).
    useStore.setState({
      layers: [
        {
          ...(dungeon(ROOMS) as object),
          children: [lamp('lamp-a', 3, 3), lamp(tokenLightId('t3'), 6, 2)],
        } as Layer,
      ],
    });
    expect(fogScene().night?.lit).toHaveLength(2);
  });

  it('reads the scene’s darkness per level, and an untouched scene as full dark', () => {
    // Untouched is the map as authored, which is what the renderer has always drawn, so
    // nothing moves on a table nobody has turned the dial at.
    expect(nightTable(undefined).darkness).toBe(1);
    expect(nightTable('darkness').darkness).toBe(SCENE_DARKNESS.darkness);
    expect(nightTable('dusk').darkness).toBe(SCENE_DARKNESS.dusk);
    expect(nightTable('daylight').darkness).toBe(SCENE_DARKNESS.daylight);
    // Monotone, and the untouched scene is the darkest.
    expect(SCENE_DARKNESS.daylight).toBeLessThan(SCENE_DARKNESS.dusk);
    expect(SCENE_DARKNESS.dusk).toBeLessThan(SCENE_DARKNESS.darkness);
  });

  // P2 — the same rule the referee runs (`worldLightOf`), read through this seat's mask.
  describe('the world clock', () => {
    // The map document is store state like any other — put it back, or the map every test
    // below reads is whichever one this block authored last.
    const authored = { ...useStore.getState().mapSettings };
    afterEach(() => useStore.setState({ mapSettings: { ...authored } }));

    const outdoor = (over: Record<string, unknown> = {}) =>
      useStore.setState({
        mapSettings: { ...useStore.getState().mapSettings, environment: 'outdoor', ...over },
      });
    const night = { clock: 0, timeSpeed: 'paused' } as const;

    it('gates an outdoor map on the clock and the sky, with nobody touching a dial', () => {
      outdoor();
      expect(nightTable(undefined, {}, { ...night, nightSky: 'moonless' }).night).toBeDefined();
      // A full moon is a world you can still see: dusk, and no light gate at all.
      expect(nightTable(undefined, {}, { ...night, nightSky: 'full-moon' }).night).toBeUndefined();
      // …and midday is midday.
      expect(nightTable(undefined, {}, { clock: 720, nightSky: 'moonless', timeSpeed: 'paused' }).night).toBeUndefined();
    });

    it('reads a crescent night one shade softer than a moonless one, mechanics unchanged', () => {
      outdoor();
      const crescent = nightTable(undefined, {}, { ...night, nightSky: 'crescent' });
      const moonless = nightTable(undefined, {}, { ...night, nightSky: 'moonless' });
      expect(crescent.light?.biteLevel).toBe('darkness-soft');
      expect(crescent.darkness).toBe(SCENE_DARKNESS['darkness-soft']);
      expect(crescent.darkness).toBeLessThan(moonless.darkness);
      // Both still clip vision to the torches — the softening is presentation only.
      expect(crescent.night).toBeDefined();
    });

    it('lets the DM dial beat the clock, and says what the clock would have said', () => {
      outdoor();
      const scene = nightTable('daylight', {}, { ...night, nightSky: 'moonless' });
      expect(scene.night).toBeUndefined();
      expect(scene.light).toMatchObject({ source: 'override', wouldBe: 'darkness' });
    });

    it('leaves an indoor map to the DM at every hour, and composites it unchanged', () => {
      useStore.setState({
        mapSettings: { ...useStore.getState().mapSettings, environment: undefined },
      });
      const scene = nightTable(undefined, {}, { ...night, nightSky: 'moonless' });
      expect(scene.night).toBeUndefined();
      expect(scene.light?.biteLevel).toBeNull();
      expect(scene.darkness).toBe(1);
    });

    it('composes a grade that follows the clock, and buckets it for the pass', () => {
      outdoor();
      const noon = nightTable(undefined, {}, { clock: 720, nightSky: 'full-moon', timeSpeed: 'paused' });
      const midnight = nightTable(undefined, {}, { ...night, nightSky: 'full-moon' });
      expect(noon.grade).not.toBe(midnight.grade);
      expect(midnight.timeBucket).toBe(0);
      expect(noon.timeBucket).toBe(144);
      // A fixed map ignores the clock entirely (decision #9).
      outdoor({ timeMode: 'fixed', fixedTime: 720 });
      expect(nightTable(undefined, {}, { ...night, nightSky: 'moonless' }).grade).toBe(noon.grade);
    });
  });

  it('imitates the void through the grade, the same on every seat and at every level', () => {
    // The fogged sheet is drawn *above* the same composite the real void renders through, and
    // that composite is the grade alone — the colour the world clock composes (P2). The dial
    // changes what the *tiers* do, not what the void under them looks like.
    for (const level of ['daylight', 'dusk', 'darkness'] as const) {
      const scene = nightTable(level);
      expect(scene.void).toEqual(voidStyle(true, scene.grade));
      expect(scene.darkness).toBe(SCENE_DARKNESS[level]);
    }
    const untouched = nightTable(undefined);
    expect(untouched.void).toEqual(voidStyle(true, untouched.grade));
    expect(untouched.darkness).toBe(1);
  });
});

// ── The composite each seat actually gets (D12 / principle 3) ───────────────
// `GRADE_STRENGTH` is only a number until something applies it, and the seat it matters most
// for is the one with no fog layer drawn at all — the DM, whose stage came back from the
// browser gate ~90% near-black. So this mounts the layer for real and reads the sprite.

describe('the lighting composite each seat is mounted with', () => {
  /** The overlay container the engine puts its multiply sprite in. */
  function fakeSceneGraph(): { sceneGraph: SceneGraph; lighting: Container } {
    const worldContainer = new Container();
    const layerContainer = new Container();
    worldContainer.addChild(layerContainer);
    const overlayContainer = new Container();
    const lighting = new Container();
    lighting.label = 'lightingComposite';
    lighting.alpha = 0.95;
    overlayContainer.addChild(lighting);
    return {
      sceneGraph: { worldContainer, layerContainer, overlayContainer } as unknown as SceneGraph,
      lighting,
    };
  }

  const seat = (role: 'dm' | 'player') => ({ ...player, role });

  function mounted(
    role: 'dm' | 'player',
    map: { version: string; layers: Layer[]; frame?: unknown } = sent([dungeon(ROOMS)]),
    modules: Record<string, unknown> = {},
  ): {
    lighting: Container;
    ticker: Ticker;
    sceneGraph: SceneGraph;
    /** How many times the mask has been rasterised — `renderMask`'s two calls per go. */
    renders: () => number;
    unmount: () => void;
  } {
    const { sceneGraph, lighting } = fakeSceneGraph();
    const ticker = new Ticker();
    let renders = 0;
    useSessionStore.setState({
      session: session(modules),
      you: seat(role),
      mapData: map,
    });
    useStore.setState({ layers: map.layers });
    setEngineSingleton(
      {
        ticker: () => ticker,
        canvas: () => document.createElement('canvas'),
        // The dot pass measures the visible cell range off these on every rebuild.
        viewport: () => ({ width: 800, height: 600 }),
        screenToWorld: (x: number, y: number) => ({ x: x / 20, y: y / 20 }),
        // The living fog rasterises its tier mask through this on every rebuild. What lands
        // in the texture is the GPU's business — jsdom asserts the geometry, not the paint.
        renderToTexture: () => {
          renders += 1;
        },
      } as unknown as RenderEngine,
      sceneGraph,
    );
    const stop = mountPlayerFogWhenReady();
    return {
      lighting,
      ticker,
      sceneGraph,
      renders: () => renders,
      unmount: () => {
        stop();
        clearEngineSingleton();
        ticker.destroy();
      },
    };
  }

  // P1 — the sprite is the *grade*, so every seat is mounted with it. What the DM is left out
  // of is this layer's tiers, which their seat never draws (`drawFog`).
  it('mounts the DM with the grade — their darkness is staged, never imposed', () => {
    const { lighting, unmount } = mounted('dm');
    expect(lighting.alpha).toBe(GRADE_STRENGTH);
    expect(fogScene().isPlayer).toBe(false);
    unmount();
  });

  it('mounts the player with the same grade', () => {
    const { lighting, unmount } = mounted('player');
    expect(lighting.alpha).toBe(GRADE_STRENGTH);
    unmount();
  });

  it('hands the composite back at full strength when the table goes away', () => {
    const { lighting, unmount } = mounted('dm');
    unmount();
    expect(lighting.alpha).toBe(0.95);
  });

  // ── A scene that carries no fog at all (D6) ──────────────────────────────
  // An unzoned map in rooms mode has no fog to draw and `drawFog` answers with no cover. The
  // cloud mesh has no geometry to come back empty, though: `setMaskBounds(null)` leaves the
  // shader a degenerate rect, every fragment then samples texel (0,0) of whatever the mask
  // texture still holds, and after a vision session that texel is opaque — the whole viewport
  // read hidden and the player got the full cover over a map with nothing to hide.

  describe('a map that carries no fog', () => {
    const frame = (): Promise<void> =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()));

    /** Content, no rooms — what `redactMapForViewer` hands a player of an unzoned map (D6). */
    const unzoned = { version: '3.0', layers: [dungeon([], [door('d1', 'a', 'b')])] };
    /** …and with the referee's measured frame, which is what makes vision mode fog it at all. */
    const withFrame = { ...unzoned, frame: { minX: 0, minY: 0, maxX: 20, maxY: 20 } };
    const modeOf = (mode: 'rooms' | 'vision') => ({
      fog: { byScene: { 'scene-1': { ...fogOf({}), mode } } },
    });

    const layerOf = (sceneGraph: SceneGraph): Container =>
      sceneGraph.overlayContainer.children.find((c) => c.label === 'playerFog') as Container;
    const cloudShown = (sceneGraph: SceneGraph): boolean =>
      layerOf(sceneGraph).children.find((c) => c instanceof Mesh)!.visible;
    const scrimShown = (sceneGraph: SceneGraph): boolean =>
      layerOf(sceneGraph).children.filter((c) => c instanceof Sprite)[0].visible;

    it('stands the cloud and the scrim down on an unzoned map in rooms mode', () => {
      const { sceneGraph, unmount } = mounted('player', withFrame, modeOf('rooms'));
      expect(fogScene().bounds).toBeNull();
      expect(cloudShown(sceneGraph)).toBe(false);
      expect(scrimShown(sceneGraph)).toBe(false);
      // …and no stencil either: a cleared one wearing the label hides every chip on a map
      // that is hiding nothing.
      expect(sightMaskOf(sceneGraph)).toBeNull();
      // The door marks' stencil goes the same way, and that is what lets them read its
      // absence as "there is no fog here" rather than "draw freely" (`DoorRenderer`).
      expect(shownMaskOf(sceneGraph)).toBeNull();
      unmount();
    });

    it('stands it down on a vision → rooms flip, and rasterises nothing more', async () => {
      const { sceneGraph, renders, unmount } = mounted('player', withFrame, modeOf('vision'));
      expect(cloudShown(sceneGraph)).toBe(true);

      const before = renders();
      useSessionStore.setState({ session: session(modeOf('rooms')) });
      await frame();
      expect(cloudShown(sceneGraph)).toBe(false);
      expect(scrimShown(sceneGraph)).toBe(false);
      expect(renders()).toBe(before);
      unmount();
    });

    it('brings it back — with a fresh mask — when the DM flips to vision again', async () => {
      const { sceneGraph, renders, unmount } = mounted('player', withFrame, modeOf('rooms'));
      expect(cloudShown(sceneGraph)).toBe(false);

      const before = renders();
      useSessionStore.setState({ session: session(modeOf('vision')) });
      await frame();
      expect(cloudShown(sceneGraph)).toBe(true);
      // The compositor repainted the two textures the shader is bound to — no stale mask
      // survives the transition back into visibility.
      expect(renders()).toBeGreaterThan(before);
      unmount();
    });

    // The other bounds-null-ish case, and the opposite answer: a player holding no part of a
    // *zoned* map takes the EVERYTHING rect, which is too big for a mask texture and leaves the
    // same degenerate uniform behind. That seat must stay covered edge to edge — the gate this
    // fix may not over-reach through.
    it('still covers a player who has been shown nothing of a zoned map', () => {
      const { sceneGraph, unmount } = mounted('player', sent([dungeon([], [])]));
      expect(fogScene().bounds).not.toBeNull();
      expect(cloudShown(sceneGraph)).toBe(true);
      // …and the cleared vector stencil is still what the chips wear there, so none of them
      // draws over ground the seat has not earned.
      expect(sightMaskOf(sceneGraph)).not.toBeNull();
      // Same for the marks: a seat shown nothing of a zoned map gets a cleared shown stencil,
      // not a missing one, so every door on it is cut away rather than drawn over the cover.
      expect(shownMaskOf(sceneGraph)).not.toBeNull();
      expect(shownMaskOf(sceneGraph)).not.toBe(sightMaskOf(sceneGraph));
      unmount();
    });
  });

  // ── D10's fade is rooms-only (S3 P2 §1) ──────────────────────────────────
  // The fade paints a room's whole footprint in the void colour and lifts it off. In vision
  // mode that is a room-shaped dark wash dropped over live sight on every room transition and
  // every door swing — the one flicker the mode is specified to have none of.

  describe('the reveal fade across the two modes', () => {
    const frame = (): Promise<void> =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()));

    /** Mount dark, then hand the party the room they are standing in. */
    async function fadesAfterAReveal(mode: 'rooms' | 'vision'): Promise<number> {
      const dark = { ...fogOf({}), mode };
      const lit = { ...fogOf({ [VESTIBULE.id]: seen }), mode };
      const withFog = (scene: SceneFog) =>
        session({
          fog: { byScene: { 'scene-1': scene } },
          tokens: { library: {}, byScene: { 'scene-1': { t1: token() } } },
        });

      const { unmount } = mounted('player');
      useSessionStore.setState({ session: withFog(dark) });
      await frame();
      const probe = (window as Window & { __fogProbe?: { fadesStarted: number } }).__fogProbe!;
      const before = probe.fadesStarted;

      useSessionStore.setState({ session: withFog(lit) });
      await frame();
      const started = probe.fadesStarted - before;
      unmount();
      return started;
    }

    it('still fades a room reveal in rooms mode — D10 is untouched', async () => {
      expect(revealDurationMs()).toBeGreaterThan(0);
      expect(await fadesAfterAReveal('rooms')).toBeGreaterThan(0);
    });

    it('starts none at all in vision mode, where a footprint wash would be the flicker', async () => {
      expect(await fadesAfterAReveal('vision')).toBe(0);
    });

    // …and the same rule the other way round, which is the seam a fade can still reach the
    // raster path through: the DM flips the mode while a rooms-mode reveal is mid-flight. A
    // fade is mask animation — it is what drives `tick`'s own `renderMask` — so one surviving
    // the flip re-rasterises the (empty in vision) vector mask over the compositor's composite
    // on every frame until it runs out.
    it('drops a fade in flight when the DM flips to vision mid-reveal', async () => {
      const withFog = (scene: SceneFog) =>
        session({
          fog: { byScene: { 'scene-1': scene } },
          tokens: { library: {}, byScene: { 'scene-1': { t1: token() } } },
        });
      const lit = { ...fogOf({ [VESTIBULE.id]: seen }), mode: 'rooms' as const };

      const { ticker, renders, unmount } = mounted('player');
      useSessionStore.setState({ session: withFog({ ...fogOf({}), mode: 'rooms' }) });
      await frame();
      useSessionStore.setState({ session: withFog(lit) });
      await frame();
      const probe = (window as Window & {
        __fogProbe?: { fadesActive(): number; mode: string };
      }).__fogProbe!;
      expect(probe.fadesActive()).toBeGreaterThan(0);

      useSessionStore.setState({ session: withFog({ ...lit, mode: 'vision' }) });
      await frame();
      expect(probe.mode).toBe('vision');
      expect(probe.fadesActive()).toBe(0);

      // …so a frame now paints nothing over the mask the compositor just composited.
      const before = renders();
      ticker.update(performance.now() + 16);
      expect(renders()).toBe(before);
      unmount();
    });
  });

  // ── The share flip on a backgrounded seat (gate walk §5.1) ───────────────
  // The walk's finding, at the seam it actually lives on. Two players, the DM flips Vision
  // share, and the seat nobody is looking at holds its pre-flip sweep: `state-update` landed,
  // the store is right, and the rebuild those writes queued is sitting behind a frame Chrome
  // will not run while the tab is hidden. Read on the *second* seat, in both directions,
  // which is exactly the pair of numbers the walk read off Borin's tab.

  describe('a share flip reaching a hidden tab', () => {
    /** Chrome suspends rAF while a tab is backgrounded: queued, never called. */
    function backgrounded(): () => void {
      const real = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = (() => 1) as typeof globalThis.requestAnimationFrame;
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      return () => {
        globalThis.requestAnimationFrame = real;
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      };
    }

    const sweepSources = (): number =>
      (window as Window & { __fogProbe?: { sweepSources(): number } }).__fogProbe!.sweepSources();

    /** Past `REBUILD_FLOOR_MS`, which is the only clock a hidden tab has. */
    const settle = (): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, REBUILD_FLOOR_MS + 50));

    /** This seat is `p2` — the one the walk found stale — and `p1` is the other player. */
    const seatTwo: PlayerInfo = { identityId: 'p2', name: 'Borin', role: 'player', connected: true };
    const eye = (over: Partial<Token>): Token =>
      token({ sight: { range: 4, angle: 360, visionMode: 'normal' }, ...over });
    const mine = eye({ id: 'mine', ownerId: 'p2', x: 9, y: 2 });
    const theirs = eye({ id: 'theirs', ownerId: 'p1', x: 2, y: 2 });

    const shared = (visionShare: 'party' | 'individual', tokens: Token[]) =>
      session({
        fog: { byScene: { 'scene-1': { ...fogOf({}), mode: 'vision' as const, visionShare } } },
        tokens: {
          library: {},
          byScene: { 'scene-1': Object.fromEntries(tokens.map((t) => [t.id, t])) },
        },
      });

    /**
     * The flip as the wire delivers it: the fog slice, then the tokens the DM's write
     * retracted or handed back (`RETRACTS.fog`), each its own `state-update`.
     */
    async function flippedTo(
      from: 'party' | 'individual',
      to: 'party' | 'individual',
    ): Promise<{ before: number; after: number }> {
      const { unmount } = mounted('player');
      // …then the table this seat is actually sitting at, which `mounted` knows nothing of.
      useSessionStore.setState({
        session: shared(from, from === 'party' ? [mine, theirs] : [mine]),
        you: seatTwo,
        mapData: sent([dungeon(ROOMS)]),
      });
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const before = sweepSources();

      const foreground = backgrounded();
      const { applyServerMessage } = useSessionStore.getState();
      const tokens = to === 'party' ? [mine, theirs] : [mine];
      applyServerMessage({
        type: 'state-update',
        module: 'fog',
        state: shared(to, tokens).modules.fog,
      } as ServerMessage);
      applyServerMessage({
        type: 'state-update',
        module: 'tokens',
        state: shared(to, tokens).modules.tokens,
      } as ServerMessage);
      await settle();

      const after = sweepSources();
      foreground();
      unmount();
      return { before, after };
    }

    it('recomputes this seat’s live sweep on individual → party', async () => {
      // The walk's own reading, in miniature: held at the pre-flip 1 instead of the party's 2.
      expect(await flippedTo('individual', 'party')).toEqual({ before: 1, after: 2 });
    });

    it('…and on party → individual, back to this seat’s own eyes alone', async () => {
      expect(await flippedTo('party', 'individual')).toEqual({ before: 2, after: 1 });
    });
  });
});

// ── S3 P3 §3 — the light gate on the mask ───────────────────────────────────
// The clear tier stops being "what the sweep reaches" and becomes "what the sweep reaches AND
// the party can see by". Every row is written so the P2 answer would differ: the same sweep,
// the same rooms, and only the light moving.

describe('drawFog in the dark', () => {
  const nightScene = (night: NightSight): FogScene => ({
    rooms: [WEST, EAST],
    views: new Map(),
    bounds: fogBounds([], [WEST, EAST]),
    pad: fogPad([]),
    sceneId: 's1',
    isPlayer: true,
    darkness: 1,
    grade: '#ffffff',
    timeBucket: 0,
    void: VOID,
    mode: 'vision',
    sight: [LOOKING],
    fog: { rooms: {}, concealBehindDoors: true },
    night,
    look: DEFAULT_FOG_LOOK,
  });
  const square = (x0: number, y0: number, x1: number, y1: number): Polygon => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];

  it('gates live sight on torch and darkvision alike, and washes nothing', () => {
    const scrim = new Graphics();
    const drawn = drawFog(
      scrim,
      nightScene({
        lit: [square(6, 0.5, 8, 2)],
        darkvision: [square(8, 0.5, 9, 2)],
        pools: [{ x: 7, y: 1.25, inner: 1, outer: 2, warm: true }],
      }),
    );
    // The backstop and its holes are the compositor's now, so the vector scrim carries
    // nothing at all — and no paint of its own in either mode, which is the half of this row
    // that has always mattered: what the party can see shows the map as rendered.
    expect(fillsOf(scrim)).toEqual([]);
    const plan = drawn.plan!;
    // One gate over both, built from the two sweeps together and erased from live sight
    // alone — unlit ground the party has explored is still remembered, only not current.
    expect(plan.ops.filter((op) => op.target === 'inverseSeeable')).toMatchObject([
      { kind: 'rect' },
      { kind: 'polys', polys: [square(6, 0.5, 8, 2), square(8, 0.5, 9, 2)], blend: 'erase' },
    ]);
    expect(plan.ops.filter((op) => op.target === 'live').at(-1)).toMatchObject({
      source: 'inverseSeeable',
      blend: 'erase',
    });
    expect(plan.ops.some((op) => op.kind === 'sprite' && op.target === 'mask' && op.source === 'inverseSeeable')).toBe(
      false,
    );
  });
});
