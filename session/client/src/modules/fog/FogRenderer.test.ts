// D10's classification, its one animation and its rebuild discipline, pinned without a GPU.
//
// The Pixi mount itself needs WebGL, so the browser gate (I2) owns "does it look right".
// What is checkable here is everything that decides *what* gets drawn: which room is black,
// dim or clear under each fog/door/reachability combination, which reveal earns a fade, and
// that an unrelated store write does not rebuild the mask.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Graphics, Point } from 'pixi.js';
import type { DoorChild, Room } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { RoomFog, SceneFog } from '@dnd/mechanics/fog';
import type { Token } from '@dnd/mechanics/tokens';
import type { LiveDoor } from '../doors/doors';
import { useSessionStore } from '../../session/store';
import {
  EXPLORED_TINT,
  EXPLORED_TINT_ALPHA,
  PARTY_ROOM_UNKNOWN,
  REVEAL_MS,
  drawLightMask,
  easeOutQuart,
  fogBounds,
  fogScene,
  partyRoomIds,
  revealDurationMs,
  revealsBetween,
  roomViews,
  subscribeFogScene,
  type FogScene,
  type RoomView,
} from './FogRenderer';

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

// ── Classification (D3 + D10) ───────────────────────────────────────────────

describe('roomViews — what each room is doing', () => {
  it('is black for a room nobody has entered — except the default one', () => {
    // All three are area 16 and none is a corridor, so the tie-break picks the lowest id:
    // `r-gallery`. A player-facing scene always has one room in it (amendment 2026-07-28).
    const views = roomViews(ROOMS, fogOf({}), [], []);
    expect([...views.values()]).toEqual<RoomView[]>(['dark', 'visible', 'dark']);
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

  // ── the default room (amendment 2026-07-28) ───────────────────────────────
  // The same helper the server redacts with, so the room the canvas lights is the room the
  // player was actually sent.

  it('lights the default room even with every door shut and nobody on the map', () => {
    const shut = [
      liveDoor(door('d-vg', VESTIBULE.id, GALLERY.id)),
      liveDoor(door('d-gv', GALLERY.id, VAULT.id)),
    ];
    expect(roomViews(ROOMS, fogOf({}), shut, []).get(GALLERY.id)).toBe('visible');
  });

  it('takes it back to black the moment the DM reveals a real room', () => {
    // The player holds the default room's geometry by then and no fog record for it — the
    // absent record *is* never_revealed (D1), so it simply goes dark again.
    const views = roomViews(ROOMS, fogOf({ [VAULT.id]: seen }), [], [VAULT.id]);
    expect(views.get(VAULT.id)).toBe('visible');
    expect(views.get(GALLERY.id)).toBe('dark');
  });

  it('lights it again when a Hide All leaves nothing revealed', () => {
    const views = roomViews(
      ROOMS,
      fogOf({ [VESTIBULE.id]: stale, [VAULT.id]: stale }),
      [],
      [VESTIBULE.id],
    );
    expect(views.get(GALLERY.id)).toBe('visible');
    expect(views.get(VESTIBULE.id)).toBe('explored');
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
// The second browser gate read every explored room as a flat dark-grey box with a tick on
// it, and a flat box is not something the two constants alone can be checked for: what made
// it flat was the *lighting* underneath, not the wash. So the arithmetic below models both
// halves — the engine's multiply composite and the fog's fill — over a strip of floor, and
// asks the only question the gate was really asking: is there still any texture in there.

/** One flat fill over a base channel value, source-over. Channels are 0..255. */
const over = (base: number, color: number, alpha: number): number =>
  base * (1 - alpha) + color * alpha;

/**
 * LightingRenderer's composite: a full-screen sprite at alpha 0.95, blend `multiply`, filled
 * with the map's ambient where no light reaches. `#0d0e12` is the gate map's, and all four
 * of its torches are in one room — every other room is composited against exactly this.
 */
const AMBIENT = 0x0d;
const unlit = (base: number): number => base * (0.05 + 0.95 * (AMBIENT / 255));

/** A stretch of dungeon floor, as one channel. Texture is the spread between these. */
const FLOOR = [140, 168, 120, 190, 152];
const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);

/** What the wash does to whatever it is given. */
const washed = (base: number): number => over(base, EXPLORED_TINT & 0xff, EXPLORED_TINT_ALPHA);

describe('the explored look', () => {
  it('keeps the floor texture readable — a memory, not a placeholder', () => {
    const drawn = FLOOR.map(washed);
    // Spatial detail survives: the gate's "flat box" is a spread of ~1, this is tens.
    expect(spread(drawn)).toBeGreaterThan(15);
    // …and it is nowhere near black, which is what `never_revealed` is reserved for.
    expect(Math.min(...drawn)).toBeGreaterThan(24);
  });

  it('reads darker and deader than the same floor lit', () => {
    // A torch at strength: the wash has to leave the explored room below it (task #14's
    // brightness inversion), while still sitting clear of the dark it is next to.
    const litFloor = FLOOR.map((v) => v * 0.9);
    expect(Math.max(...FLOOR.map(washed))).toBeLessThan(Math.min(...litFloor));
    // Desaturating, not merely darkening: most of the room's own colour is replaced.
    expect(EXPLORED_TINT_ALPHA).toBeGreaterThan(0.5);
  });

  it('is the lighting multiply that flattened it, which is why the mask exists', () => {
    // The regression, stated: compose the wash over an ambient-lit room and the floor's
    // whole 70-level range collapses to under three levels of 255 — the flat box.
    expect(spread(FLOOR.map((v) => washed(unlit(v))))).toBeLessThan(3);
  });
});

describe('drawLightMask — the lighting is held off a memory', () => {
  const scene = (views: Record<string, RoomView>, isPlayer = true): FogScene => ({
    rooms: ROOMS,
    views: new Map(Object.entries(views)),
    bounds: fogBounds([], ROOMS),
    sceneId: 'scene-1',
    isPlayer,
  });
  const drawn = (g: { context: { instructions: unknown[] } }): number =>
    g.context.instructions.length;

  it('asks for no mask at all when nothing is explored — most of a session', () => {
    const mask = new Graphics();
    expect(drawLightMask(mask, scene({ [VESTIBULE.id]: 'visible', [GALLERY.id]: 'dark' }))).toBe(
      false,
    );
    expect(drawn(mask as unknown as { context: { instructions: unknown[] } })).toBe(0);
  });

  it('cuts a hole for every explored room and covers everything else', () => {
    const mask = new Graphics();
    expect(
      drawLightMask(mask, scene({ [VESTIBULE.id]: 'explored', [GALLERY.id]: 'explored' })),
    ).toBe(true);

    // Inside a memory, the mask is absent — that is the room the multiply cannot reach.
    expect(mask.context.containsPoint(new Point(...VESTIBULE.centroid))).toBe(false);
    expect(mask.context.containsPoint(new Point(...GALLERY.centroid))).toBe(false);
    // The vault is not a memory, so the lighting lands on it as usual.
    expect(mask.context.containsPoint(new Point(...VAULT.centroid))).toBe(true);
    // And far outside the map: still covered, so a zoomed-out camera finds no bright ring.
    expect(mask.context.containsPoint(new Point(-5000, -5000))).toBe(true);
  });

  it('never holds the lighting off the DM, who is never masked at all', () => {
    const mask = new Graphics();
    expect(drawLightMask(mask, scene({ [VESTIBULE.id]: 'explored' }, false))).toBe(false);
  });
});

// ── Bounds ──────────────────────────────────────────────────────────────────

describe('fogBounds', () => {
  it('is null with no rooms — an unzoned map has no fog to enforce (D6)', () => {
    // And it is what keeps a black square off an empty canvas while the map is in flight:
    // core's own bounds fall back to a 10x10 grid rather than reporting nothing.
    expect(fogBounds([], [])).toBeNull();
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
  protocolVersion: 3,
  sessionId: 's1',
  campaignId: 'c1',
  activeSceneId: 'scene-1',
  scenes: [{ id: 'scene-1', name: 'Crypt' }],
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

  it('rebuilds when the fog slice changes', () => {
    const onChange = vi.fn();
    const stop = subscribeFogScene(onChange);
    expect(onChange).toHaveBeenCalledTimes(1); // once on subscribe, like the other layers

    useSessionStore.setState({
      session: session({ fog: { byScene: { 'scene-1': fogOf({ [VESTIBULE.id]: seen }) } } }),
    });
    expect(onChange).toHaveBeenCalledTimes(2);

    stop();
  });

  it('rebuilds when a door or a token moves, and when the map grows', () => {
    const onChange = vi.fn();
    const stop = subscribeFogScene(onChange);

    useSessionStore.setState({ session: session({ doors: { byScene: {} } }) });
    useSessionStore.setState({ session: session({ doors: { byScene: {} }, tokens: {} }) });
    useStore.setState({ layers: [dungeon([...ROOMS, room('r-new', 30)])] });
    // …and when a reveal delta lands, which is the map growing where the mask reads it.
    useSessionStore.setState({ mapData: sent([dungeon([...ROOMS, room('r-new', 30)])]) });

    expect(onChange).toHaveBeenCalledTimes(5); // subscribe + four mutations
    stop();
  });

  it('does not rebuild on an unrelated store write', () => {
    const onChange = vi.fn();
    const stop = subscribeFogScene(onChange);
    onChange.mockClear();

    // A ping lands ~every few seconds; a mask rebuild on each would be a per-frame cost in
    // all but name.
    useSessionStore.setState({ latencyMs: 42 });
    useSessionStore.setState({ presence: [] });
    useStore.setState({ grid: { ...useStore.getState().grid } });

    expect(onChange).not.toHaveBeenCalled();
    stop();
  });

  it('stops rebuilding once unsubscribed', () => {
    const onChange = vi.fn();
    subscribeFogScene(onChange)();
    onChange.mockClear();
    useSessionStore.setState({ session: session({ fog: { byScene: {} } }) });
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
    expect(scene.bounds).toBeNull();
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
