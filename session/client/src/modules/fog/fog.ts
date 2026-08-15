// The fog tool's arithmetic and vocabulary, kept away from Pixi and React so both can be
// checked without a GPU or a DOM. Rooms come off the loaded map (they are authored data,
// D1); their fog status comes off the session's `fog` module slice.

import { pointInPolygon } from '@dnd/core/src/engine/hitTest';
import { clipper2Engine } from '@dnd/core/src/geometry/Clipper2Engine';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import type { Room } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import type { DoorsState } from '@dnd/mechanics/doors';
import {
  sceneFogOf,
  toBytes,
  type FogState,
  type RegionMask,
  type RoomFog,
  type RoomFogStatus,
  type SceneFog,
} from '@dnd/mechanics/fog';
import { liveDoors, type LiveDoor } from '../doors/doors';

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

/** How many cells those runs are made of — what `__fogProbe.memoryCells` reports. */
export const cellsIn = (rects: readonly Polygon[]): number =>
  rects.reduce((n, rect) => n + (rect[1][0] - rect[0][0]), 0);

/** What the vision mask draws. Void is everything neither tier covers, as it always was. */
export interface VisionRegion {
  /** Live sight: the party's sweep union, out to the falloff's limit. Nothing is drawn here. */
  clear: Polygon[];
  /** The explored wash — swept cells and DM-revealed rooms, minus whatever is live. */
  memory: Polygon[];
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
 * `shipped` is every room the player actually holds geometry for, and the memory is clipped
 * to it: a cell swept on unzoned map, or one the DM brushed past the map's edge, would
 * otherwise put a wash over void that has nothing under it to remember.
 *
 * Without Clipper2 loaded the intersection is empty and the difference is the identity, so
 * the mask degrades to sweep-and-void — dark rather than open, the direction a fog bug
 * should fail in.
 *
 * ponytail: eleven Clipper calls a rebuild, measured at 7.8ms on the two-room fixture, and
 * four of them re-offset room polygons that only move when the map or the room record does.
 * That is comfortably inside a frame and comfortably outside P6's 2ms budget; the upgrade,
 * when that budget is what is being chased, is to memo `held` and the revealed reach on the
 * identity of `scene.rooms` and the fog slice — not a second geometry pipeline.
 */
export function visionRegion(
  sight: readonly Polygon[],
  region: RegionMask | undefined,
  revealed: readonly Polygon[],
  shipped: readonly Polygon[],
  pad: number,
  feather: number,
): VisionRegion {
  const clear = fogRegion(sight, [], sightPad(pad), feather).reach;
  const rects = regionRects(region);
  const held = fogRegion(shipped, [], pad, feather).reach;
  const remembered = clipper2Engine.union(
    [...rects, ...fogRegion(revealed, [], pad, feather).reach],
    [],
  );
  const inside =
    remembered.length > 0 && held.length > 0
      ? clipper2Engine.intersection(remembered, held)
      : [];
  const memory = clear.length > 0 ? clipper2Engine.difference(inside, clear) : inside;
  return {
    clear,
    memory,
    // Unioned rather than drawn as two holes: `cut` takes a set of holes on the promise that
    // they do not overlap, and the feather runs round the outside of everything the party
    // holds — a rim between a lit sweep and its own memory would be a line drawn where the
    // light is still on.
    shown: clipper2Engine.union([...clear, ...memory], []),
    cells: cellsIn(rects),
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
