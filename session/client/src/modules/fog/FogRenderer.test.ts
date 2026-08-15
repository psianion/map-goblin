// D10's classification, its one animation and its rebuild discipline, pinned without a GPU.
//
// The Pixi mount itself needs WebGL, so the browser gate (I2) owns "does it look right".
// What is checkable here is everything that decides *what* gets drawn: which room is black,
// dim or clear under each fog/door/reachability combination, which reveal earns a fade, and
// that an unrelated store write does not rebuild the mask.

import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Ticker } from 'pixi.js';
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
import {
  FOG_MARGIN,
  cellsIn,
  fogPad,
  fogRegion,
  regionRects,
  sightPad,
  visionRegion,
  type FogRing,
  ringsWithHoles,
} from './fog';
import {
  AMBIENT_BITE,
  GRADE_STRENGTH,
  biteStrength,
  DARKVISION_TINT,
  DARKVISION_TINT_ALPHA,
  EXPLORED_TINT,
  EXPLORED_TINT_ALPHA,
  FOG_FEATHER,
  LIGHTING_STRENGTH,
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
import { tokenLightId } from '../triggers/lightSync';

/** A fixed void look for fixtures — drawFog paints hidden map with `fill`, not black. */
const VOID: VoidStyle = {
  fill: 0x131316,
  memory: EXPLORED_TINT,
  drained: DARKVISION_TINT,
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
      bite: LIGHTING_STRENGTH.player,
      void: VOID,
    });

    const fills = fillsOf(scrim);
    expect(fills).toHaveLength(1);
    expect(fills[0].style.color).toBe(VOID.fill);
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
      bite: LIGHTING_STRENGTH.player,
      void: VOID,
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
 * LightingRenderer's composite, at the bite the player's seat dials it to. The blend is
 * `multiply` and the sprite's alpha is a *strength* — `dst · lerp(1, m, a)` — where `m` is the
 * FBO's unlit base: the grade, plus the bite's second pass of it. `#0d0e12` is the gate map's
 * grade, and all four of its torches are in one room: every other room is composited against
 * exactly this. The red channel, the grade's dimmest and so the strictest of the three.
 *
 * P1 made the grade universal, which moved every absolute number in this section: a player's
 * unlit floor on the darkest map in the repo now lands where the *editor* has always drawn it
 * and then a little under. What the rows below assert is therefore the ordering and the
 * texture — which is what the two lost gates were actually about — and they are stated as
 * shares of the live room rather than as levels of 255.
 */
const AMBIENT = 0x0d * (1 - LIGHTING_STRENGTH.player * (1 - 0x0d / 255));
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
    // Desaturating, not merely darkening: most of the room's own colour is replaced.
    expect(EXPLORED_TINT_ALPHA).toBeGreaterThan(0.5);
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

describe('the lighting strength each seat composites at', () => {
  it('leaves the DM out of the *bite* entirely (PRODUCT principle 3)', () => {
    // The gate found the DM's stage ~90% near-black with everything revealed. Darkness is
    // something a DM stages, never something staged at them.
    expect(LIGHTING_STRENGTH.dm).toBe(0);
    for (const level of ['daylight', 'dusk', 'darkness-soft', 'darkness'] as const) {
      expect(biteStrength(level, 'dm')).toBe(0);
    }
    expect(biteStrength(undefined, 'dm')).toBe(0);
  });

  it('keeps the grade for every seat — the half that is presentation, not vision (W2)', () => {
    // P1's split. The DM used to lose the whole multiply to that zero above, and with it every
    // brazier on the map: the light pools live in the same composite the mood does.
    expect(GRADE_STRENGTH).toBeGreaterThan(0);
    // A DM at the darkest level still composites the grade as authored — and only the grade,
    // their bite being 0, so the map is the mood and never the vision-darkness on top of it.
    const dmVoid = voidStyle(biteStrength('darkness', 'dm'));
    expect(dmVoid).toEqual(voidStyle(0));
    // …and a player's seat lands strictly under it on the same background.
    expect(voidStyle(biteStrength('darkness', 'player')).fill).toBeLessThan(dmVoid.fill);
  });

  it('keeps drama for the player without a floor of pure black', () => {
    // Above 0, so the dial means something; below 1, so a player's unlit ground is a step
    // under the map as authored rather than a second full pass of the grade on top of it.
    expect(LIGHTING_STRENGTH.player).toBeGreaterThan(0);
    expect(LIGHTING_STRENGTH.player).toBeLessThan(1);
    // P1 handed the absolute level to the *grade* — a map authored at #0d0e12 is a map the
    // author asked to be near-black, and the DM now sees that too. What stays this side's
    // business is the step: strictly darker than the DM's, and strictly above nothing.
    const dm = 160 * (1 - GRADE_STRENGTH + GRADE_STRENGTH * (0x0d / 255));
    expect(unlit(160)).toBeLessThan(dm);
    expect(unlit(160)).toBeGreaterThan(0);
  });
});

// ── P1 §4 — which bite a seat gets, level by level ─────────────────────────
describe('biteStrength', () => {
  it('multiplies the scene’s level by the seat’s own strength', () => {
    for (const level of ['daylight', 'dusk', 'darkness-soft', 'darkness'] as const) {
      expect(biteStrength(level, 'player')).toBeCloseTo(
        LIGHTING_STRENGTH.player * AMBIENT_BITE[level],
      );
    }
    // No dial is the map as authored — full level, which is what the pass has always drawn.
    expect(biteStrength(undefined, 'player')).toBe(LIGHTING_STRENGTH.player);
  });

  it('lands the crescent’s soft bite between dusk and a moonless night', () => {
    // The sky's own level: mechanically a `darkness` scene (`needsLight` is untouched by it),
    // presented a shade softer because there is a little light out there. Nothing sets it
    // until the world clock and the sky do.
    expect(AMBIENT_BITE.dusk).toBeLessThan(AMBIENT_BITE['darkness-soft']);
    expect(AMBIENT_BITE['darkness-soft']).toBeLessThan(AMBIENT_BITE.darkness);
    expect(biteStrength('dusk', 'player')).toBeLessThan(biteStrength('darkness-soft', 'player'));
    expect(biteStrength('darkness-soft', 'player')).toBeLessThan(
      biteStrength('darkness', 'player'),
    );
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
    bite: LIGHTING_STRENGTH.player,
    void: VOID,
  });

  const strokesOf = (g: Graphics) =>
    g.context.instructions
      .filter((i) => i.action === 'stroke')
      .map(
        (i) => (i.data as { style: { alpha: number; width: number; alignment: number } }).style,
      );

  it('cuts one merged hole and ramps the fog back in over it', () => {
    const scrim = new Graphics();
    drawFog(scrim, scene({ [WEST.id]: 'visible', [EAST.id]: 'dark' }));

    // One void-coloured fill for the map, with the earned region taken out of it.
    const fills = fillsOf(scrim);
    expect(fills[0].style.color).toBe(VOID.fill);
    expect(fills[0].hole).toBeDefined();

    // The falloff: nested strokes laid inside the reach, thickening towards its rim. Alpha
    // 1/k is what makes them composite to an even ramp — see `featherEdge`.
    const strokes = strokesOf(scrim);
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.every((s) => s.alignment === 1)).toBe(true);
    expect(strokes[0].alpha).toBe(1); // solid at the outer rim…
    expect(strokes[strokes.length - 1].alpha).toBeLessThan(0.2); // …and barely there at the lip
    // No stroke reaches further in than the falloff is wide.
    expect(Math.max(...strokes.map((s) => s.width))).toBeCloseTo(FOG_FEATHER);
  });

  it('gives a memory the same padded footprint at its own darkness', () => {
    const scrim = new Graphics();
    drawFog(scrim, scene({ [WEST.id]: 'explored', [EAST.id]: 'dark' }));

    const wash = fillsOf(scrim).find((f) => f.style.color === EXPLORED_TINT);
    expect(wash).toBeDefined();
    expect(wash!.style.alpha).toBe(EXPLORED_TINT_ALPHA);
    // Padded and feathered like a lit room — the wash runs out to the reach so the ramp has
    // something to thicken over rather than a gap between the two to fall through.
    expect(strokesOf(scrim).length).toBeGreaterThan(0);
  });

  it('leaves an all-dark map one unbroken fill, padded or not', () => {
    const scrim = new Graphics();
    drawFog(scrim, scene({ [WEST.id]: 'dark', [EAST.id]: 'dark' }));
    expect(fillsOf(scrim)).toHaveLength(1);
    expect(fillsOf(scrim)[0].hole).toBeUndefined();
    expect(strokesOf(scrim)).toHaveLength(0);
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

describe('visionRegion — sweep, memory, void', () => {
  const PAD = fogPad([]);
  /** West is a room nobody revealed, east one the DM lit by hand; the party swept both. */
  const swept = setCells(regionOf(VISION_FRAME)!, [
    [5, 4],
    [6, 4],
    [7, 4],
    // Unzoned map, well east of both halls — the party can sweep it, nothing holds it.
    [20, 2],
  ]);
  const built = () =>
    visionRegion([LOOKING], swept, [EAST.boundary], [WEST.boundary, EAST.boundary], PAD, FOG_FEATHER);

  it('clears what the party is looking at, out past the stones of the wall', () => {
    const { clear } = built();
    expect(inRegion(clear, [7, 1])).toBe(true);
    // A sweep stops on the wall's *centreline*, so without `sightPad` the outer half of every
    // stone in front of the party reads as black — the report the room mask's `fogPad` fixed.
    expect(sightPad(PAD)).toBeCloseTo(WALL_WIDTH / 2 + FOG_MARGIN);
    expect(inRegion(clear, [8 + sightPad(PAD) - 0.05, 1])).toBe(true);
    expect(inRegion(clear, [8 + sightPad(PAD) + FOG_FEATHER + 0.1, 1])).toBe(false);
    // …and nothing they are not looking at, however well they remember it.
    expect(inRegion(clear, [6.5, 4.5])).toBe(false);
    expect(inRegion(clear, [13, 3])).toBe(false);
  });

  it('remembers the cells it swept, and only the cells, in a room nobody revealed', () => {
    const { memory } = built();
    expect(inRegion(memory, [6.5, 4.5])).toBe(true);
    // One row down is map the party has never had their eyes on. In rooms mode the whole
    // hall would be one wash or one hole; here the record is the cells and nothing else.
    expect(inRegion(memory, [6.5, 5.5])).toBe(false);
  });

  it('washes a DM-revealed room whole — told is not the same as looked at', () => {
    const { memory, clear } = built();
    expect(inRegion(memory, [13, 3])).toBe(true);
    // Memory, never live: the party knows the layout because they were told, and their own
    // sight is the only thing that makes anything current.
    expect(inRegion(clear, [13, 3])).toBe(false);
  });

  it('never lets a memory stand where the party is looking right now', () => {
    const { memory } = built();
    expect(inRegion(memory, [7, 1])).toBe(false);
  });

  it('clips the wash to the geometry the player was actually handed', () => {
    const { memory, cells } = built();
    // The cell at (20, 2) is on map nobody zoned — swept, recorded, and with nothing under
    // it to remember. A wash there would be a tint floating on the void.
    expect(inRegion(memory, [20.5, 2.5])).toBe(false);
    // It is still in the record, which is what the probe counts.
    expect(cells).toBe(4);
  });

  it('cuts one hole for both tiers, so the falloff runs round the outside of everything', () => {
    const { shown } = built();
    expect(inRegion(shown, [7, 1])).toBe(true);
    expect(inRegion(shown, [6.5, 4.5])).toBe(true);
    expect(inRegion(shown, [6.5, 5.5])).toBe(false);
  });

  it('clips the sweep to that geometry too — a sightline off the map cuts nothing', () => {
    // A sweep that escapes the rooms the player holds is the louder half of the same bug: the
    // scrim is grown to cover any sight polygon (`drawFog`), so an unclipped clear tier cuts a
    // real hole in it — bare background, dots and all missing, in the shape of the party's own
    // sightline over map they were never sent.
    const OFF_THE_MAP: Polygon = [
      [19, 1],
      [22, 1],
      [22, 4],
      [19, 4],
    ];
    const { clear, shown, memory } = visionRegion(
      [OFF_THE_MAP],
      undefined,
      [],
      [WEST.boundary],
      PAD,
      FOG_FEATHER,
    );
    expect(inRegion(clear, [20.5, 2.5])).toBe(false);
    expect(inRegion(shown, [20.5, 2.5])).toBe(false);
    expect(memory).toEqual([]);

    // …while a sweep that stays inside what they hold is untouched by the clip.
    const held = visionRegion([LOOKING], undefined, [], [WEST.boundary], PAD, FOG_FEATHER);
    expect(inRegion(held.clear, [7, 1])).toBe(true);
  });

  it('follows a delta that grows the map instead of answering from the last one', () => {
    // P6 §1 memoizes the held and revealed reaches — the two halves of the mask a moving token
    // never changes — on the room set they are measured from. A reveal delta is exactly the
    // write that has to miss that memo: it arrives as new geometry with the party standing
    // still, and a stale answer would leave the room the DM just lit as void.
    const wash = (rooms: Polygon[], revealed: Polygon[]) =>
      visionRegion([LOOKING], swept, revealed, rooms, PAD, FOG_FEATHER).memory;
    /** A yard the party swept a cell of (20, 2) long before its geometry was sent. */
    const YARD: Polygon = [
      [19, 1],
      [23, 1],
      [23, 4],
      [19, 4],
    ];

    // The revealed reach: a room the DM lights while nobody moves.
    expect(inRegion(wash([WEST.boundary], []), [13, 3])).toBe(false);
    expect(inRegion(wash([WEST.boundary, EAST.boundary], [EAST.boundary]), [13, 3])).toBe(true);
    // …and the DM taking it back again, which is the only write that moves `revealed` while
    // `shipped` stands still: the room stays latched — the player keeps the geometry they were
    // handed — so every other term of the memo's key is identity-stable across this call, and a
    // key that dropped the revealed reach would answer it out of the line above and leave a
    // re-hidden room washed as though the DM never closed it.
    expect(inRegion(wash([WEST.boundary, EAST.boundary], []), [13, 3])).toBe(false);
    // …and the held reach, which is the clip: the cell was in the record all along and had
    // nothing under it to remember until the delta carried the yard over.
    expect(inRegion(wash([WEST.boundary, EAST.boundary], []), [20.5, 2.5])).toBe(false);
    expect(inRegion(wash([WEST.boundary, EAST.boundary, YARD], []), [20.5, 2.5])).toBe(true);
    // …and back, because the memo answers the arguments it was handed and not the newest ones.
    expect(inRegion(wash([WEST.boundary], []), [13, 3])).toBe(false);
  });

  it('is void everywhere for a party with no sight and no memory', () => {
    const empty = visionRegion([], undefined, [], [WEST.boundary], PAD, FOG_FEATHER);
    expect(empty).toMatchObject({ clear: [], memory: [], shown: [], cells: 0 });
  });
});

describe('drawFog in vision mode', () => {
  const visionScene = (over: Partial<FogScene> = {}): FogScene => ({
    rooms: [WEST, EAST],
    views: new Map(),
    bounds: fogBounds([], [WEST, EAST]),
    pad: fogPad([]),
    sceneId: 's1',
    isPlayer: true,
    bite: LIGHTING_STRENGTH.player,
    void: VOID,
    mode: 'vision',
    sight: [],
    fog: { rooms: {}, concealBehindDoors: true },
    ...over,
  });

  it('cuts the sweep out of the void and ramps the fog back in over it', () => {
    const scrim = new Graphics();
    const drawn = drawFog(scrim, visionScene({ sight: [LOOKING] }));

    const fills = fillsOf(scrim);
    expect(fills[0].style.color).toBe(VOID.fill);
    expect(fills[0].hole).toBeDefined();
    // No memory: nothing has been swept into the record and no room was revealed.
    expect(fills.some((f) => f.style.color === EXPLORED_TINT)).toBe(false);
    expect(drawn.cells).toBe(0);
    expect(
      scrim.context.instructions.filter((i) => i.action === 'stroke').length,
    ).toBeGreaterThan(0);
  });

  it('washes the memory tier at the explored look, over the cells and the reveals', () => {
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

    const wash = fillsOf(scrim).find((f) => f.style.color === EXPLORED_TINT);
    expect(wash).toBeDefined();
    expect(wash!.style.alpha).toBe(EXPLORED_TINT_ALPHA);
    expect(drawn.cells).toBe(2);
  });

  it('leaves a party with no eyes and no memory one unbroken fill', () => {
    // The mask fails dark, which is the only direction a fog bug may fail in: no sweep and
    // no record is a player who has earned nothing, not a player who is owed everything.
    const scrim = new Graphics();
    drawFog(scrim, visionScene());
    expect(fillsOf(scrim)).toHaveLength(1);
    expect(fillsOf(scrim)[0].hole).toBeUndefined();
    expect(scrim.context.instructions.filter((i) => i.action === 'stroke')).toHaveLength(0);
  });

  it('draws the DM nothing at all, as in every other mode (principle 3)', () => {
    const scrim = new Graphics();
    drawFog(scrim, visionScene({ sight: [LOOKING], isPlayer: false }));
    expect(scrim.context.instructions).toHaveLength(0);
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

  /** A vision scene with a lamp on the map, three tokens, and the DM's dial at `ambient`. */
  const nightTable = (ambient?: string, overrides: Record<string, boolean> = {}) => {
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
          byScene: {
            'scene-1': {
              fired: {},
              armed: {},
              disabled: {},
              lightOverrides: overrides,
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
    // …and the darkvision half is one of the sweeps already taken, not a second sweep.
    expect(scene.night?.darkvision).toHaveLength(1);
    expect(scene.night?.darkvision[0]).toBe(scene.sight?.[1]);
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

  it('dials the ambient composite per level, and leaves an untouched scene alone', () => {
    // Untouched is the seat's full bite: the map as authored, which is what the renderer has
    // always drawn, so nothing moves on a table nobody has turned the dial at.
    expect(nightTable(undefined).bite).toBe(biteStrength(undefined, 'player'));
    expect(nightTable('darkness').bite).toBe(biteStrength('darkness', 'player'));
    expect(nightTable('dusk').bite).toBe(biteStrength('dusk', 'player'));
    expect(nightTable('daylight').bite).toBe(biteStrength('daylight', 'player'));
    // Monotone, and the untouched scene is the darkest.
    expect(AMBIENT_BITE.daylight).toBeLessThan(AMBIENT_BITE.dusk);
    expect(AMBIENT_BITE.dusk).toBeLessThan(AMBIENT_BITE.darkness);
  });

  it('imitates the void at the dial’s own bite, not always at full strength', () => {
    // The fogged sheet is drawn *above* the same composite the real void renders through, so
    // the two only land on the same pixels while they agree about how hard it bites. Left at
    // full strength (D1), a daylight scene fogs darker than the map beside it.
    for (const level of ['daylight', 'dusk', 'darkness'] as const) {
      expect(nightTable(level).void).toEqual(voidStyle(biteStrength(level, 'player')));
    }
    // Lifting the composite lifts the imitation with it…
    expect(nightTable('daylight').void.fill).toBeGreaterThan(nightTable('darkness').void.fill);
    expect(nightTable('daylight').void.dot).toBeGreaterThan(nightTable('darkness').void.dot);
    // …and an untouched scene is still exactly what the layer has always drawn.
    expect(nightTable(undefined).void).toEqual(voidStyle());
    expect(nightTable('darkness').void).toEqual(voidStyle());
  });
});

// ── The composite each seat actually gets (D12 / principle 3) ───────────────
// `LIGHTING_STRENGTH` is only a pair of numbers until something applies it, and the seat it
// matters most for is the one with no fog layer drawn at all — the DM, whose stage came back
// from the browser gate ~90% near-black. So this mounts the layer for real and reads the
// sprite, which is the only place the two halves meet.

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

  function mounted(role: 'dm' | 'player'): { lighting: Container; unmount: () => void } {
    const { sceneGraph, lighting } = fakeSceneGraph();
    const ticker = new Ticker();
    useSessionStore.setState({
      session: session(),
      you: seat(role),
      mapData: sent([dungeon(ROOMS)]),
    });
    useStore.setState({ layers: [dungeon(ROOMS)] });
    setEngineSingleton(
      {
        ticker: () => ticker,
        canvas: () => document.createElement('canvas'),
        // The dot pass measures the visible cell range off these on every rebuild.
        viewport: () => ({ width: 800, height: 600 }),
        screenToWorld: (x: number, y: number) => ({ x: x / 20, y: y / 20 }),
      } as unknown as RenderEngine,
      sceneGraph,
    );
    const stop = mountPlayerFogWhenReady();
    return {
      lighting,
      unmount: () => {
        stop();
        clearEngineSingleton();
        ticker.destroy();
      },
    };
  }

  // P1 — the sprite is the *grade* now, so every seat is mounted with it. What the DM is left
  // out of is the bite, which reaches the pass separately (`setAmbientLevel`), and the two
  // rows below are the split at the only place the halves meet.
  it('mounts the DM with the grade — their darkness is staged, never imposed', () => {
    const { lighting, unmount } = mounted('dm');
    expect(lighting.alpha).toBe(GRADE_STRENGTH);
    expect(fogScene().bite).toBe(0);
    unmount();
  });

  it('mounts the player with the same grade and their own bite', () => {
    const { lighting, unmount } = mounted('player');
    expect(lighting.alpha).toBe(GRADE_STRENGTH);
    expect(fogScene().bite).toBe(LIGHTING_STRENGTH.player);
    unmount();
  });

  it('hands the composite back at full strength when the table goes away', () => {
    const { lighting, unmount } = mounted('dm');
    unmount();
    expect(lighting.alpha).toBe(0.95);
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

// ── S3 P3 §3/§4 — the light gate on the mask, and the drained grade ─────────
// The clear tier stops being "what the sweep reaches" and becomes "what the sweep reaches AND
// the party can see by". Every row is written so the P2 answer would differ: the same sweep,
// the same rooms, and only the light moving.

describe('visionRegion in the dark', () => {
  const PAD = fogPad([]);
  /** A torch pool at the near end of what the party is looking at. */
  const TORCH_POOL: Polygon = [
    [6, 0.5],
    [7, 0.5],
    [7, 1.5],
    [6, 1.5],
  ];
  /** …and a darkvision eye's own reach at the far end of it, past the pool. */
  const OWL_REACH: Polygon = [
    [8, 0.5],
    [8.4, 0.5],
    [8.4, 2],
    [8, 2],
  ];
  /** Inside the torch pool, and inside the sweep but well past it. */
  const LIT_SPOT: [number, number] = [6.5, 1];
  const DARK_SPOT: [number, number] = [8.5, 1];

  const at = (night?: { lit: Polygon[]; darkvision: Polygon[] }) =>
    visionRegion([LOOKING], undefined, [], [WEST.boundary], PAD, FOG_FEATHER, night);

  it('is the P2 mask with no night at all — the ambient dial untouched changes nothing', () => {
    const day = at();
    expect(inRegion(day.clear, LIT_SPOT)).toBe(true);
    expect(inRegion(day.clear, DARK_SPOT)).toBe(true);
    expect(day.drained).toEqual([]);
  });

  it('leaves a party with no light at all looking at nothing', () => {
    const blind = at({ lit: [], darkvision: [] });
    expect(blind.clear).toEqual([]);
    expect(blind.drained).toEqual([]);
    // The sweep is still taken and the memory tier is still whatever they earned — what the
    // dark takes away is the live tier, not the record.
    expect(blind.shown).toEqual([]);
  });

  it('clears the torch pool and nothing else the sweep crossed', () => {
    const night = at({ lit: [TORCH_POOL], darkvision: [] });
    expect(inRegion(night.clear, LIT_SPOT)).toBe(true);
    // Two cells further along the same sightline, unlit: the sweep reaches it and the party
    // cannot see it. In P2 this was clear.
    expect(inRegion(night.clear, DARK_SPOT)).toBe(false);
    // The pool is clipped to the sweep too — a torch lighting a room nobody is looking at
    // does not open the mask.
    expect(inRegion(night.clear, [6.5, 4])).toBe(false);
    // The pool itself is lit ground and takes no grade…
    expect(inRegion(night.drained, LIT_SPOT)).toBe(false);
    // …but the band the pad opens past its edge, so a torch lights the room's wall stones, is
    // past where the light itself has fallen to zero. Cleared and unlit is drained, not raw —
    // otherwise every pool wears a thin ungraded ring (D8).
    const RING_SPOT: [number, number] = [7 + sightPad(PAD) / 2, 1];
    expect(inRegion(night.clear, RING_SPOT)).toBe(true);
    expect(inRegion(night.drained, RING_SPOT)).toBe(true);
  });

  it('gives darkvision its own ground, graded apart from the lit pool', () => {
    const night = at({ lit: [TORCH_POOL], darkvision: [OWL_REACH] });
    // Both are clear — the party is looking at both.
    expect(inRegion(night.clear, LIT_SPOT)).toBe(true);
    expect(inRegion(night.clear, DARK_SPOT)).toBe(true);
    // …but only the unlit half takes the drained grade: a darkvision eye standing in
    // torchlight sees the pool in colour like anybody else.
    expect(inRegion(night.drained, DARK_SPOT)).toBe(true);
    expect(inRegion(night.drained, LIT_SPOT)).toBe(false);
  });

  it('drains the whole clear area when nothing is burning at all', () => {
    const night = at({ lit: [], darkvision: [OWL_REACH] });
    expect(inRegion(night.clear, DARK_SPOT)).toBe(true);
    expect(inRegion(night.drained, DARK_SPOT)).toBe(true);
    // And a normal eye's ground is still dark: the ring is the darkvision token's, not the
    // party's (the referee draws the same line — `seen` in fog/sweep.ts).
    expect(inRegion(night.clear, LIT_SPOT)).toBe(false);
  });

  it('keeps the unlit ground the party remembers as memory rather than void', () => {
    const swept = setCells(regionOf(VISION_FRAME)!, [[8, 1]]);
    const night = visionRegion(
      [LOOKING],
      swept,
      [],
      [WEST.boundary],
      PAD,
      FOG_FEATHER,
      { lit: [TORCH_POOL], darkvision: [] },
    );
    // The cell they swept before the light went out: not live, still theirs.
    expect(inRegion(night.memory, [8.5, 1.5])).toBe(true);
    expect(inRegion(night.clear, [8.5, 1.5])).toBe(false);
  });
});

describe('drawFog — the drained grade (§4)', () => {
  const nightScene = (night: { lit: Polygon[]; darkvision: Polygon[] }): FogScene => ({
    rooms: [WEST, EAST],
    views: new Map(),
    bounds: fogBounds([], [WEST, EAST]),
    pad: fogPad([]),
    sceneId: 's1',
    isPlayer: true,
    bite: LIGHTING_STRENGTH.player,
    void: VOID,
    mode: 'vision',
    sight: [LOOKING],
    fog: { rooms: {}, concealBehindDoors: true },
    night,
  });

  it('washes the darkvision area at its own look, and only there', () => {
    const scrim = new Graphics();
    drawFog(
      scrim,
      nightScene({
        lit: [],
        darkvision: [
          [
            [6, 0.5],
            [8, 0.5],
            [8, 2],
            [6, 2],
          ],
        ],
      }),
    );
    const wash = fillsOf(scrim).filter((f) => f.style.color === DARKVISION_TINT);
    expect(wash).toHaveLength(1);
    expect(wash[0].style.alpha).toBe(DARKVISION_TINT_ALPHA);
    // Above the void's own floor and below the lit map: three states, three brightnesses.
    expect(DARKVISION_TINT_ALPHA).toBeLessThan(EXPLORED_TINT_ALPHA);
    expect(DARKVISION_TINT).toBeGreaterThan(EXPLORED_TINT);
  });

  it('grades the band past a pool’s edge, and leaves the pool itself alone', () => {
    const scrim = new Graphics();
    drawFog(
      scrim,
      nightScene({
        lit: [
          [
            [6, 0.5],
            [8, 0.5],
            [8, 2],
            [6, 2],
          ],
        ],
        darkvision: [],
      }),
    );
    // The mask opens the wall band around a torch (`sightPad`) and the light's own gradient
    // has fallen to zero by `radius`, so that band is cleared ground no light reaches — the
    // drained grade covers it rather than leaving a thin ungraded ring (D8). One wash: the
    // ring, drawn as a fill with the pool cut out of it.
    const wash = fillsOf(scrim).filter((f) => f.style.color === DARKVISION_TINT);
    expect(wash).toHaveLength(1);
    // …and the pool itself is a hole in the scrim, like any other clear ground.
    expect(fillsOf(scrim)[0].hole).toBeDefined();
  });
});
