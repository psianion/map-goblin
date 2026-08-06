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
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { RoomFog, SceneFog } from '@dnd/mechanics/fog';
import type { Token } from '@dnd/mechanics/tokens';
import type { LiveDoor } from '../doors/doors';
import { useSessionStore } from '../../session/store';
import { FOG_MARGIN, fogPad, fogRegion, ringsWithHoles } from './fog';
import {
  EXPLORED_TINT,
  EXPLORED_TINT_ALPHA,
  FOG_FEATHER,
  LIGHTING_STRENGTH,
  PARTY_ROOM_UNKNOWN,
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
  type FogScene,
  type RoomView,
  type VoidStyle,
} from './FogRenderer';

/** A fixed void look for fixtures — drawFog paints hidden map with `fill`, not black. */
const VOID: VoidStyle = { fill: 0x131316, dot: 0x3a3a3a, dotAlpha: 0.45, dotsVisible: true };

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
 * LightingRenderer's composite, at the strength the player's seat dials it to. The blend is
 * `multiply` and the sprite's alpha is a *strength* — `dst · lerp(1, src, a)` — so this is
 * the map's ambient wherever no light reaches. `#0d0e12` is the gate map's, and all four of
 * its torches are in one room: every other room is composited against exactly this.
 */
const AMBIENT = 0x0d;
const unlit = (base: number): number =>
  base * (1 - LIGHTING_STRENGTH.player + LIGHTING_STRENGTH.player * (AMBIENT / 255));

/** A stretch of dungeon floor, as one channel. Texture is the spread between these. */
const FLOOR = [140, 168, 120, 190, 152];
const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);

/** What the wash does to whatever it is given. */
const washed = (base: number): number => over(base, EXPLORED_TINT & 0xff, EXPLORED_TINT_ALPHA);

describe('the explored look', () => {
  it('keeps the floor texture readable — a memory, not a placeholder', () => {
    // Composed the way it actually is: the wash over the room's *lit* render, which is what
    // collapsed to under three levels of 255 and read as the second gate's flat box.
    const drawn = FLOOR.map((v) => washed(unlit(v)));
    expect(spread(drawn)).toBeGreaterThan(5);
    // …and nowhere near black, which is what `never_revealed` is reserved for.
    expect(Math.min(...drawn)).toBeGreaterThan(24);
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
    // or the order inverts again on the next map with a darker ambient.
    const pedestal = (EXPLORED_TINT & 0xff) * EXPLORED_TINT_ALPHA;
    expect(pedestal).toBeLessThan(Math.min(...FLOOR.map(unlit)));
  });
});

describe('the lighting strength each seat composites at', () => {
  it('leaves the DM out of the multiply entirely (PRODUCT principle 3)', () => {
    // The gate found the DM's stage ~90% near-black with everything revealed. Darkness is
    // something a DM stages, never something staged at them.
    expect(LIGHTING_STRENGTH.dm).toBe(0);
  });

  it('keeps drama for the player without floors that read as unlit', () => {
    // Below 1, so unlit-but-visible map lands somewhere legible rather than at the ambient's
    // ~5%; above 0, so a torch still means something.
    expect(LIGHTING_STRENGTH.player).toBeGreaterThan(0);
    expect(LIGHTING_STRENGTH.player).toBeLessThan(1);
    // The art guide's grey floors, not black ones: a mid-grey floor keeps a quarter of
    // itself with no light on it at all.
    expect(unlit(160)).toBeGreaterThan(160 * 0.25);
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

const inRegion = (rings: Polygon[], point: [number, number]): boolean =>
  ringsWithHoles(rings).some(
    ({ outline, holes }) =>
      pointInPolygon(point, outline) && !holes.some((hole) => pointInPolygon(point, hole)),
  );

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

  it('dials the multiply off for the DM — darkness is staged, never imposed', () => {
    const { lighting, unmount } = mounted('dm');
    expect(lighting.alpha).toBe(LIGHTING_STRENGTH.dm);
    expect(lighting.alpha).toBe(0);
    unmount();
  });

  it('leaves the player theirs, dialled back rather than off', () => {
    const { lighting, unmount } = mounted('player');
    expect(lighting.alpha).toBe(LIGHTING_STRENGTH.player);
    unmount();
  });

  it('hands the composite back at full strength when the table goes away', () => {
    const { lighting, unmount } = mounted('dm');
    unmount();
    expect(lighting.alpha).toBe(0.95);
  });
});
