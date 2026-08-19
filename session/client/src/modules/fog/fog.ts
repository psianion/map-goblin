// The fog tool's arithmetic and vocabulary, kept away from Pixi and React so both can be
// checked without a GPU or a DOM. Rooms come off the loaded map (they are authored data,
// D1); their fog status comes off the session's `fog` module slice.

import { pointInPolygon } from '@dnd/core/src/engine/hitTest';
import { clipper2Engine } from '@dnd/core/src/geometry/Clipper2Engine';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { computeMapFrame } from '@dnd/core/src/shared/mapBounds';
import type { Room, ZoneChild } from '@dnd/core/src/shared/types';
import type { Layer, SerializedMapData } from '@dnd/core/src/store/types';
import type { DoorsState } from '@dnd/mechanics/doors';
import {
  cellsCoveredByPolygon,
  sceneFogOf,
  toBytes,
  type Cell,
  type FogState,
  type Frame,
  type RegionMask,
  type RoomFog,
  type RoomFogStatus,
  type SceneFog,
} from '@dnd/mechanics/fog';
import { liveDoors, type LiveDoor } from '../doors/doors';
import { maskField, maskRings, regionCells } from './memoryMask';

/** What a DM reads for each status. The word is the state; colour never carries it alone. */
export const FOG_STATUS_LABEL: Record<RoomFogStatus, string> = {
  never_revealed: 'Unrevealed',
  revealed: 'Revealed',
  re_hidden: 'Explored',
};

/** What clicking the room will do next — reveal anything dark, re-hide anything lit. */
export const fogActionFor = (status: RoomFogStatus): 'reveal' | 'hide' =>
  status === 'revealed' ? 'hide' : 'reveal';

/**
 * D11's DM grammar, restrained: unrevealed carries the heaviest tint, explored a lighter
 * one, revealed nothing at all. Three weights of one near-black, so the state reads as
 * brightness rather than as hue and survives a bad panel in a dim room.
 *
 * No mark is stamped on the room to second that. One used to be — a check at the centroid,
 * on both seats — and two art reviews read it as a glyph printed on the painting rather
 * than as map state (PRODUCT principle 1: the map is the stage, chrome stays out of it).
 * The word carries it where a mark would have to: `FOG_STATUS_LABEL` in the fog tool, and
 * the hover, which names the state the click is about to change.
 */
export interface FogLook {
  /** 0 = draw nothing over the room. */
  tintAlpha: number;
  /**
   * The hover highlight, which says the room's state too (D11: "with its current state").
   * One warm-to-cold axis, the map's own: torchlight where the party is standing in the
   * light, drained parchment for a memory, cold slate for a
   * room no one has ever lit. Full-strength stroke on all three; the DM's cursor is never
   * ghosted to say something is hidden (PRODUCT principle 3).
   */
  hoverColor: number;
  /**
   * …and how heavy its fill is. This is a legibility correction, not a second reading of the
   * state: the highlight sits above a room already carrying `tintAlpha` of near-black, so the
   * fill climbs with that tint to land the same lift on all three. What actually seconds the
   * colour is underneath it — the hover draws *over* the tint, never instead of it, so a DM
   * who cannot separate the three hues still reads three rooms.
   */
  hoverAlpha: number;
}

export const DM_FOG_LOOK: Record<RoomFogStatus, FogLook> = {
  never_revealed: { tintAlpha: 0.62, hoverColor: 0x9fb2cc, hoverAlpha: 0.18 },
  revealed: { tintAlpha: 0, hoverColor: 0xf0a252, hoverAlpha: 0.1 },
  re_hidden: { tintAlpha: 0.32, hoverColor: 0xd8cfc0, hoverAlpha: 0.14 },
};

/** Every zoned area of the loaded map. Corridors are rooms (D6) — nothing filters them. */
export function roomsOfLayers(layers: readonly Layer[]): Room[] {
  return layers.flatMap((layer) => (layer.type === 'dungeon' ? (layer.rooms ?? []) : []));
}

/**
 * The rooms the *server* is fogging by — off the document it sent, not off core's store.
 *
 * Core re-detects rooms from wall and floor geometry after any load (`roomSync`, the
 * backfill for files saved before rooms existed) and overwrites `layer.rooms` with the
 * result. On a map nobody zoned that invents rooms the referee does not have: the server
 * reads `layer.rooms` off the file, finds none and fogs nothing, while anything built on
 * core's store tints or masks rooms no fog command can even name. Measured on
 * `demo-dungeon.mapbuilder`: 0 rooms on disk, 4 in the store.
 *
 * The redacted document is the honest source for both seats. A player's copy carries exactly
 * the rooms they are allowed to know about, which is the set their mask is a statement about;
 * the DM's is the file.
 */
export function serverLayers(mapData: unknown): Layer[] {
  return (mapData as { layers?: Layer[] } | null)?.layers ?? [];
}

export function serverRooms(mapData: unknown): Room[] {
  return roomsOfLayers(serverLayers(mapData));
}

/**
 * The doors the *server* is fogging by, at the state the table is playing them — the room
 * graph half of the same rule as {@link serverRooms}.
 *
 * `roomA`/`roomB` are what the concealment BFS walks (D3), and they are exactly the field
 * core does not preserve: `roomSync` re-detects rooms after every load and rewrites both on
 * every door from whatever geometry *this tab* holds. A player's copy is a partial map with
 * no merged floor at all (the server ships `mergedFloor: null`, `redactMapForViewer`), so the
 * ids it derives are its own — and a BFS run over them can reach a room the referee sealed,
 * or seal one the referee opened. Room ids only happen to line up when the whole map is
 * present, which is the DM's case and no player's.
 *
 * The document's own door records carry the ids the server redacted and reachability-tested
 * with, so both seats answer "what does this door join" the same way. Live state still comes
 * off the session's `doors` slice — that half never drifted.
 */
export function serverDoors(
  mapData: unknown,
  doorsState: DoorsState | undefined,
  sceneId: string | null | undefined,
): LiveDoor[] {
  return liveDoors(serverLayers(mapData), doorsState, sceneId);
}

// ── What the mask's hole is shaped like ─────────────────────────────────────
// `room.boundary` is the room's *floor*, not the room. Detection subtracts the wall band from
// the merged floor (`roomDetection.wallToRects`), so every stone a room's walls are drawn from
// lies outside its polygon — and a mask cut to the polygon slices those walls down the middle.
// That is the defect the player seat sent back: half the stones of a lit room in black, and a
// door opening reduced to a rectangular notch with the mark floating in it, because the cutter
// runs straight through the gap the door sits in.
//
// So the mask is cut to a room's floor *grown outward*, and the growth is not decoration: it
// is the wall the room already owns, plus a little of the dark past it.

/**
 * Breathing room past the far face of a room's wall band, in world units (= grid cells).
 *
 * The band itself is paid for separately and exactly — see {@link fogPad}. This is only the
 * margin on top, and it is what stops the mask ending *on* the last stone: a boundary that
 * lands precisely on a hard edge reads as a crop even when it is arithmetically right.
 */
export const FOG_MARGIN = 0.3;

/** `DEFAULT_DUNGEON_STYLE`'s, for a document whose layers have not landed yet. */
const DEFAULT_WALL_WIDTH = 0.5;

/**
 * How far past its floor polygon a room's mask reaches.
 *
 * The wall costs a full `wallWidth`, not half of it: detection's cutter takes `width / 2` off
 * the floor, and the stones then straddle that centreline by another `width / 2`, so the far
 * face of the band sits one whole `wallWidth` outside the polygon. The widest band on the map
 * sets the pad for all of it — a per-room pad would need per-room walls, and the difference
 * between presets is a fraction of a cell.
 */
export function fogPad(layers: readonly Layer[]): number {
  let wallWidth = 0;
  for (const layer of layers) {
    if (layer.type === 'dungeon') wallWidth = Math.max(wallWidth, layer.style?.wallWidth ?? 0);
  }
  return (wallWidth || DEFAULT_WALL_WIDTH) + FOG_MARGIN;
}

/** Where the mask is clear, and where its falloff has finished. */
export interface FogRegion {
  /** Nothing at all is drawn over this: the floors, the wall bands, and the margin. */
  clear: Polygon[];
  /** The falloff's outer limit. Past this the fog is solid. */
  reach: Polygon[];
}

/**
 * The hole in the mask, as geometry.
 *
 * One outward offset buys the wall band and the margin. The union after it is not tidiness —
 * two rooms one wall apart grow *into* each other, and Pixi's `cut` takes a set of holes on
 * the promise that they do not overlap, so the merge has to happen before the draw or the
 * triangulator makes a mess of the whole mask.
 *
 * `blocked` then comes back out, and that is the half that keeps this honest. The offset does
 * not know what it is growing into: a wall shared with an unrevealed room is only `wallWidth`
 * thick, so the margin alone would hand over the first fraction of a cell of that room's
 * floor. Walls are a legitimate occluder to spend the pad on; floors are the tell. Taking the
 * unearned rooms out by construction means the region *is* the statement — there is no
 * separate repaint to forget, and the test can ask the region directly.
 *
 * `reach` is `clear` grown again by the falloff, so the two are one boundary and its shadow
 * rather than two offsets that have to be kept agreeing.
 *
 * Without Clipper2 loaded every call here is the identity, which lands back on the old tight
 * mask: dark rather than open, which is the direction a fog bug should fail in.
 */
export function fogRegion(
  rooms: readonly Polygon[],
  blocked: readonly Polygon[],
  pad: number,
  feather: number,
): FogRegion {
  if (rooms.length === 0) return { clear: [], reach: [] };
  const withhold = (polys: Polygon[]): Polygon[] =>
    blocked.length > 0 ? clipper2Engine.difference(polys, [...blocked]) : polys;

  const clear = withhold(clipper2Engine.union(clipper2Engine.inflate([...rooms], pad), []));
  return { clear, reach: withhold(clipper2Engine.inflate(clear, feather)) };
}

/**
 * One region's rings, as a tree: land, the water inside it, the islands inside that.
 *
 * Clipper hands a region back flat — an outline and the rings punched out of it are told
 * apart only by containment — while Pixi wants a fill and then the holes belonging to *that*
 * fill, because `cut` attaches to the instruction before it. Building the tree once here is
 * what lets every draw site stay a walk over shapes.
 *
 * Every node's `holes` are its *direct* children, so a revealed room enclosed by an
 * unrevealed courtyard enclosed by revealed rooms is an island two levels down — drawn
 * clear, not dropped. Rings out of Clipper never cross, so a ring's containers nest, and
 * the most-contained container is the immediate parent.
 */
export interface FogRing {
  outline: Polygon;
  holes: FogRing[];
}

export function ringsWithHoles(rings: readonly Polygon[]): FogRing[] {
  const clean = rings.filter((ring) => ring.length >= 3);
  const containers = clean.map((ring) =>
    clean.filter((other) => other !== ring && pointInPolygon(ring[0], other)),
  );
  const depth = new Map(clean.map((ring, i) => [ring, containers[i].length]));
  const nodes = new Map(clean.map((ring) => [ring, { outline: ring, holes: [] as FogRing[] }]));
  const roots: FogRing[] = [];
  clean.forEach((ring, i) => {
    const node = nodes.get(ring) as FogRing;
    if (containers[i].length === 0) {
      roots.push(node);
      return;
    }
    const parent = containers[i].reduce((deepest, c) =>
      (depth.get(c) as number) > (depth.get(deepest) as number) ? c : deepest,
    );
    (nodes.get(parent) as FogRing).holes.push(node);
  });
  return roots;
}

// ── Vision mode's mask (S3 P2 §1) ───────────────────────────────────────────
// Three tiers again, but the party's own eyes draw the top one instead of the room record:
// what a sweep reaches is clear, what they have swept or the DM has revealed is a memory,
// and the rest is the same void. Built here, on mutation, for the reason the room mask is —
// `tick()` draws, it never computes.

/**
 * How far past a sweep's own boundary the clear area reaches, from the room mask's `pad`.
 *
 * A sight polygon stops on the wall *segments*, which are the band's centreline, so the outer
 * half of every stone the party is looking at falls outside it — the half-swallowed wall
 * {@link fogPad} exists to buy back for room-granular fog. `fogPad` is `wallWidth +
 * FOG_MARGIN` measured off a floor polygon, which stops half a band *inside* the centreline;
 * measured off the centreline itself the same buy-back is `wallWidth / 2 + FOG_MARGIN`.
 */
export const sightPad = (pad: number): number => (pad + FOG_MARGIN) / 2;

/**
 * The party's swept cells as world rectangles, row runs merged.
 *
 * One rectangle per *run* rather than per cell, and that is not tidiness: a single 8-cell
 * sight radius covers ~150 cells, and Clipper unioning 150 unit squares costs an order more
 * than unioning the dozen runs they collapse into. The region is the same either way — a run
 * is a row of cells that already share their edges.
 *
 * Exact, and cell-shaped — which is what the DM's own brush wash wants (`FogOverlay`: the
 * referee is being shown which cells they painted) and what the player's tier does not. W3
 * moved that half onto a painted outline (`memoryOutline`); this stays the DM's, and the
 * fallback for a record too large to paint.
 */
export function regionRects(region: RegionMask | undefined): Polygon[] {
  if (!region) return [];
  const bytes = toBytes(region.bits);
  const rects: Polygon[] = [];
  for (let row = 0; row < region.rows; row++) {
    let start = -1;
    // One past the last column so a run that reaches the edge is closed like any other.
    for (let col = 0; col <= region.cols; col++) {
      const bit = row * region.cols + col;
      if (col < region.cols && (bytes[bit >>> 3] & (1 << (bit & 7))) !== 0) {
        if (start < 0) start = col;
        continue;
      }
      if (start < 0) continue;
      const [x0, x1] = [region.minX + start, region.minX + col];
      const [y0, y1] = [region.minY + row, region.minY + row + 1];
      rects.push([
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]);
      start = -1;
    }
  }
  return rects;
}

/** How many cells those runs are made of. The mask counts the record's bits directly. */
export const cellsIn = (rects: readonly Polygon[]): number =>
  rects.reduce((n, rect) => n + (rect[1][0] - rect[0][0]), 0);

/**
 * A region's falloff limit in one Clipper call, where {@link fogRegion} takes three (P6 §1).
 *
 * Two identities do the work. Offsetting distributes over union — `(A ∪ B) ⊕ D` is
 * `(A ⊕ D) ∪ (B ⊕ D)` for a disc `D` — so the union `fogRegion` runs between its two offsets
 * buys nothing that the *callers* of this do not already get: every consumer below hands the
 * result straight to a Clipper boolean, and those fill NonZero, where overlapping rings of one
 * orientation are one region. And offsetting composes — `(A ⊕ D_p) ⊕ D_f` is `A ⊕ D_{p+f}` —
 * so `clear` and its feather are one offset rather than two, which matters because the second
 * one ran over the *offset* geometry: round joins at `ARC_TOLERANCE` had already tripled the
 * vertex count by then.
 *
 * Measured on the gate map with eight sighted tokens (13 rooms, 206 walls, jsdom + the same
 * WASM): the party's reach 8.45ms → 2.75ms, the held reach 6.30ms → 1.54ms, and the whole
 * `visionRegion` 34.7ms → 17.7ms before any memo. The regions agree to arc-discretisation
 * noise — 0.48 of 823 square cells symmetric difference on the sweep union, a sliver a fifth
 * of a pixel wide along the rim.
 *
 * `fogRegion` keeps the three calls because it keeps `clear` *and* withholds `blocked` from
 * both tiers, and the order of those two matters (a blocked strip the feather would otherwise
 * step over). Nothing in vision mode blocks anything, which is why this is its own function
 * rather than a flag on that one.
 */
const reachOf = (polys: readonly Polygon[], grow: number): Polygon[] =>
  polys.length > 0 ? clipper2Engine.inflate([...polys], grow) : [];

/**
 * One slot, keyed on an argument list compared by identity — `FogOverlay`'s `rectsOf` pattern,
 * lifted because P6 needs it four times over.
 *
 * One slot rather than an LRU for the reason that pattern has one: every input here is
 * replaced wholesale on a write (§2.5), so the answer that can be asked for again is the
 * previous one. Module-level for the reason `sightCache` is — there is one mask per tab, and a
 * second instance would be a second cache over the same answers.
 */
function memoOnce<T>(): (key: readonly unknown[], build: () => T) => T {
  let seen: readonly unknown[] | null = null;
  let value: T;
  return (key, build) => {
    const last = seen;
    if (!last || key.length !== last.length || key.some((v, i) => v !== last[i])) {
      seen = key;
      value = build();
    }
    return value;
  };
}

/**
 * The four halves of the vision mask that do *not* move when the party does (P6 §1).
 *
 * The rooms a player holds change on a reveal delta, the rooms the DM has lit change on a
 * reveal, and the region record changes when the referee writes cells — none of which is what
 * a drag does. Everything downstream of the party's own sweep is rebuilt every frame the mask
 * is; everything upstream of it is these.
 *
 * The keys are what each answer is a statement about, by identity: room boundaries come off
 * the loaded document and are stable while it is, and the region record is keyed on its own
 * bytes rather than on the fog slice — a fog `state-update` is fresh JSON for a mode flip or a
 * share change that touches no cell at all (`FogOverlay`, same reason).
 */
const heldReach = memoOnce<Polygon[]>();
const revealedReach = memoOnce<Polygon[]>();
const memoryMask = memoOnce<MemoryMask>();
const rememberedHeld = memoOnce<Polygon[]>();

/** The explored tier's silhouette, and the cell count the probe reports beside it. */
interface MemoryMask {
  rings: Polygon[];
  cells: number;
}

/**
 * W3 — the swept cells as one soft outline, painted once per region delta (`memoryMask.ts`).
 *
 * The row runs stay the fallback rather than the path: they are exact, and on a record too
 * large to paint (`MASK_MAX_CELLS`) a stair-stepped tier beats no tier. Everything downstream
 * takes these rings exactly as it took the rects — same orientation, same non-zero union.
 */
function memoryOutline(region: RegionMask | undefined): MemoryMask {
  const field = maskField(region);
  return { rings: field ? maskRings(field) : regionRects(region), cells: regionCells(region) };
}

/**
 * S3 P3 §3 — the light half of the clear tier, present only when the scene's ambient is
 * `darkness`. Absent is the daylight/dusk answer: the whole sweep counts as lit, which is
 * exactly the P2 mask.
 */
export interface NightSight {
  /** Every light source's own sweep — what a normal eye can see by in the dark. */
  lit: readonly Polygon[];
  /** The sweeps of the party's darkvision eyes — unlit ground they alone reach. */
  darkvision: readonly Polygon[];
}

/** What the vision mask draws. Void is everything neither tier covers, as it always was. */
export interface VisionRegion {
  /** Live sight: the party's sweep union, out to the falloff's limit. Nothing is drawn here. */
  clear: Polygon[];
  /**
   * The part of `clear` no light actually reaches (§4) — a subset of it, never a tier of its
   * own: the party is looking at that ground, they just have no colour to see it in. That is
   * mostly what a darkvision eye buys unlit, plus the wall band the pad opens around a pool
   * past where the light itself has fallen to nothing. Empty outside darkness.
   */
  drained: Polygon[];
  /** The explored wash — swept cells and DM-revealed rooms, minus whatever is live. */
  memory: Polygon[];
  /**
   * Everything remembered regardless of live sight — `memory` before the clear subtraction.
   * The living fog's base tier: what the cover would be if no eye were open, which is what
   * a sight pool's falloff has to land on.
   */
  remembered: Polygon[];
  /** Both of them as one region, which is the hole the scrim cuts and the dots clip to. */
  shown: Polygon[];
  /**
   * How many cells the region record holds — §4's `memoryCells`.
   *
   * ponytail: the record's own bit count, not the area that survived the clip. It answers
   * "has the party's memory grown", which is what the probe is for; measuring the drawn
   * area would mean walking the clipped rings and is worth writing the day a row asks.
   */
  cells: number;
}

/**
 * The vision mask's geometry, in one pass of Clipper — the same engine and the same
 * `clear`/`reach` relationship {@link fogRegion} builds the room mask from.
 *
 * `revealed` is the rooms the DM has lit by hand, and they land in the *memory* tier rather
 * than the clear one on purpose: the party knows that layout because they were told, and
 * their own eyes are the only thing that makes anything live. A re-hidden room contributes
 * nothing extra — the cells they earned still show, and taking those back is a region-hide.
 *
 * `shipped` is every room the player actually holds geometry for, and *both* earned tiers are
 * clipped to it: a cell swept on unzoned map would otherwise put a wash over void that has
 * nothing under it to remember, and a sweep running past the last room they hold would cut a
 * bare-background wedge out of the scrim.
 *
 * Without Clipper2 loaded the intersections are empty, so the mask degrades to solid void —
 * dark rather than open, the direction a fog bug should fail in.
 *
 * P6 §1 took the eleven Clipper calls this used to cost down to four on a drag: `reachOf`
 * folds each of the three-call reaches into one offset, and the four answers a moving token
 * does not change are memoized above. What is left is the party's own reach and the three
 * booleans that shape it against everything they have already earned — measured 34.7ms →
 * 13.0ms on the gate map with eight sighted tokens (jsdom; the browser number and the pinned
 * budget are the gate spec's). Nothing here is a second geometry pipeline, which is what the
 * remaining floor would cost: those four calls are Clipper's own work on ~1600 vertices of
 * offset sweep, and the only lever left is fewer vertices going in.
 */
export function visionRegion(
  sight: readonly Polygon[],
  region: RegionMask | undefined,
  revealed: readonly Polygon[],
  shipped: readonly Polygon[],
  pad: number,
  feather: number,
  night?: NightSight,
): VisionRegion {
  const mask = memoryMask(
    [region?.bits, region?.minX, region?.minY, region?.cols, region?.rows],
    () => memoryOutline(region),
  );
  const held = heldReach([pad, feather, ...shipped], () => reachOf(shipped, pad + feather));
  const swept = reachOf(sight, sightPad(pad) + feather);
  // Clipped to `held` for the reason the memory tier is, and it is the louder of the two: the
  // scrim is grown to cover the sweep (`drawFog`), so a sight polygon escaping the geometry
  // the player holds cuts a real hole in it — bare background, no dots, in the shape of the
  // party's own sightline over map they were never sent. Unheld space stays void.
  const sweptHeld =
    swept.length > 0 && held.length > 0 ? clipper2Engine.intersection(swept, held) : [];
  // §3.3 — the light gate, as one more intersection on the same pipeline. A light's pool is
  // padded exactly as a sweep is (`sightPad`), so a torch in a room lights the room's wall band
  // rather than stopping on the segments' centreline and leaving the stones dark.
  //
  // ponytail: these two are not memoized where the four above are. A torch is carried, so its
  // reach moves with the party rather than with the map — but only the *mover's* does, and a
  // seven-eighths hit is there for a slot each on the polygon identities. Worth writing the day
  // a table plays a whole session in the dark; the gate's night median is 20.5ms against the
  // day's 13.2, and the fps guard covers both.
  const litReach = night ? reachOf(night.lit, sightPad(pad) + feather) : [];
  const darkReach = night ? reachOf(night.darkvision, sightPad(pad) + feather) : [];
  const seeable = night ? clipper2Engine.union([...litReach, ...darkReach], []) : [];
  const clear = !night
    ? sweptHeld
    : sweptHeld.length > 0 && seeable.length > 0
      ? clipper2Engine.intersection(sweptHeld, seeable)
      : [];
  // …and §4 grades everything that gate let through which no light actually reaches — which is
  // the *unpadded* pools' complement, not `litReach`'s (D8). The pad above deliberately opens
  // the wall band around a torch, and the renderer's own gradient has fallen to zero by
  // `radius`, so subtracting the padded reach would leave a thin ring of clear-but-unlit,
  // ungraded ground around every pool. Subtracting the pools as swept folds that band into the
  // drained treatment, where it belongs, and it keeps the darkvision rule intact for free: a
  // darkvision eye standing in torchlight still sees the pool in colour like anybody else.
  const drained = !night
    ? []
    : clear.length > 0 && night.lit.length > 0
      ? clipper2Engine.difference(clear, [...night.lit])
      : clear;
  // Everything the party has *already* earned, which is the half a moving token never touches:
  // one union and one intersection, memoized on the three answers they are built from.
  const revealedGrown = revealedReach([pad, feather, ...revealed], () =>
    reachOf(revealed, pad + feather),
  );
  const inside = rememberedHeld([mask, revealedGrown, held], () => {
    const remembered = clipper2Engine.union([...mask.rings, ...revealedGrown], []);
    return remembered.length > 0 && held.length > 0
      ? clipper2Engine.intersection(remembered, held)
      : [];
  });
  const memory = clear.length > 0 ? clipper2Engine.difference(inside, clear) : inside;
  return {
    clear,
    drained,
    memory,
    remembered: inside,
    // Unioned rather than drawn as two holes: `cut` takes a set of holes on the promise that
    // they do not overlap, and the feather runs round the outside of everything the party
    // holds — a rim between a lit sweep and its own memory would be a line drawn where the
    // light is still on.
    shown: clipper2Engine.union([...clear, ...memory], []),
    cells: mask.cells,
  };
}

/** The room polygon under a world point, or undefined for unzoned map (D6). */
export function roomAt(rooms: readonly Room[], x: number, y: number): Room | undefined {
  return rooms.find((room) => room.boundary.length >= 3 && pointInPolygon([x, y], room.boundary));
}

/** D9 Reveal All: every room in the scene, latch set. */
export function revealAllRooms(rooms: readonly Room[]): Record<string, RoomFog> {
  const next: Record<string, RoomFog> = {};
  for (const room of rooms) next[room.id] = { status: 'revealed', wasEverRevealed: true };
  return next;
}

/**
 * D9 Hide All: everything the party has seen goes back under. Rooms nobody has seen are
 * left out of the record entirely — absent *is* `never_revealed` (D1), and writing them in
 * would be the same state at more bytes.
 */
export function hideAllRooms(current: Record<string, RoomFog>): Record<string, RoomFog> {
  const next: Record<string, RoomFog> = {};
  for (const [id, fog] of Object.entries(current)) {
    if (fog.wasEverRevealed) next[id] = { status: 're_hidden', wasEverRevealed: true };
  }
  return next;
}

/**
 * The scene's fog. `sceneFogOf` already answers "untouched scene ⇒ nothing revealed,
 * concealment on"; this only adds the two states the wire has that the module never does —
 * no slice yet, and no active scene yet.
 */
export function sceneFog(state: FogState | undefined, sceneId: string | null | undefined): SceneFog {
  const scene = sceneId ? state?.byScene?.[sceneId] : undefined;
  return scene?.rooms ? scene : sceneFogOf({ byScene: {} }, '');
}

export { roomFogOf as roomFog } from '@dnd/mechanics/fog';

// ── P4 §1/§2 — what the brush paints on, and what the room list has to say ──

/**
 * The rectangle a region cell is counted from, exactly as the server counts it.
 *
 * A player's copy arrives with the referee's own `frame` stamped on it; the DM's copy is the
 * authored file, which carries none — so the DM's is measured here with the very function the
 * server measured it with (`sceneMap.frame`). Same inputs, same arithmetic, so a cell the DM's
 * brush names is the cell the server writes.
 */
export function fogFrame(mapData: unknown): Frame | null {
  const doc = mapData as SerializedMapData | null;
  if (!doc) return null;
  return doc.frame ?? computeMapFrame(doc.layers ?? [], doc.mapSettings?.terrain?.bounds ?? null);
}

/**
 * A world point as a region cell, or null off the frame — the `cellsCoveredByPolygon`
 * convention (cell `[col, row]` is the square whose centre is `minX + col + 0.5`), which is
 * what makes a brushed cell and a swept cell the same cell.
 */
export function cellAt(frame: Frame, x: number, y: number): Cell | null {
  const [col, row] = [Math.floor(x - frame.minX), Math.floor(y - frame.minY)];
  const [cols, rows] = [Math.round(frame.maxX - frame.minX), Math.round(frame.maxY - frame.minY)];
  return col < 0 || row < 0 || col >= cols || row >= rows ? null : [col, row];
}

/** …and back: the world square that cell covers, for the brush's own hover highlight. */
export const cellRect = (frame: Frame, [col, row]: Cell): Polygon => [
  [frame.minX + col, frame.minY + row],
  [frame.minX + col + 1, frame.minY + row],
  [frame.minX + col + 1, frame.minY + row + 1],
  [frame.minX + col, frame.minY + row + 1],
];

/**
 * Rooms the region record has bits inside — the brush and the party's own sweep showing
 * through the room list as "Partly seen" (§1). Only interesting on a room the DM has not lit:
 * a `revealed` room is washed whole whatever the cells say.
 *
 * The mask is decoded once for all the rooms rather than per cell (`getCell` decodes the whole
 * record every call, which is fine for a probe and not for a list), and each room stops at its
 * first set bit.
 */
export function partlySeenRooms(rooms: readonly Room[], region: RegionMask | undefined): Set<string> {
  const seen = new Set<string>();
  if (!region) return seen;
  const bytes = toBytes(region.bits);
  const frame = {
    minX: region.minX,
    minY: region.minY,
    maxX: region.minX + region.cols,
    maxY: region.minY + region.rows,
  };
  for (const room of rooms) {
    if (room.boundary.length < 3) continue;
    for (const [col, row] of cellsCoveredByPolygon(room.boundary, frame)) {
      const bit = row * region.cols + col;
      if ((bytes[bit >>> 3] & (1 << (bit & 7))) !== 0) {
        seen.add(room.id);
        break;
      }
    }
  }
  return seen;
}

/**
 * Rooms an authored explore lock covers (§5) — the DM's badge for "the party's own sight will
 * never open this one; it is yours to reveal".
 *
 * ponytail: box against box, not shape against polygon. A lock is authored to cover a room, so
 * the two boxes overlapping is the case; a huge lock that clips a neighbouring room's corner
 * would badge that neighbour too. The precise answer is the zone shape intersected with the
 * room polygon, and it is worth writing the day a DM is misled by the coarse one — the server
 * already tests the real geometry per cell (`inAnyLock`), so nothing but this label is coarse.
 */
export function lockedRooms(rooms: readonly Room[], layers: readonly Layer[]): Set<string> {
  const locks = layers
    .flatMap((layer) => (layer.type === 'dungeon' ? layer.children : []))
    .filter((child): child is ZoneChild => child.childType === 'zone' && !!child.blocksAutoExplore)
    .flatMap((zone) => {
      const s = zone.shape;
      if (s.kind === 'circle') {
        return [[s.position.x - s.radius, s.position.y - s.radius, s.position.x + s.radius, s.position.y + s.radius]];
      }
      // A point zone has no area to lock, and the server refuses it too (`exploreLocks`).
      return s.kind === 'rect' ? [[s.x, s.y, s.x + s.width, s.y + s.height]] : [];
    });

  const locked = new Set<string>();
  if (locks.length === 0) return locked;
  for (const room of rooms) {
    if (room.boundary.length < 3) continue;
    const xs = room.boundary.map((p) => p[0]);
    const ys = room.boundary.map((p) => p[1]);
    const [rx0, rx1, ry0, ry1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (locks.some(([x0, y0, x1, y1]) => x0 < rx1 && x1 > rx0 && y0 < ry1 && y1 > ry0)) {
      locked.add(room.id);
    }
  }
  return locked;
}
