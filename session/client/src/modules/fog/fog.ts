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
import type { FogPool } from './livingFog';

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
 *
 * DUPLICATED, BY HAND, at `session/server/src/fog/redactMap.ts:191` (`FOG_MARGIN`), where the
 * same distance is measured from the other side to decide which geometry a player document is
 * allowed to carry. Nothing enforces the equality. If the two drift, the server ships map by
 * one pad while the client masks by another: either the mask stops short of geometry the seat
 * already has (art in the dark, or worse, visible past the fog edge), or it opens onto map the
 * seat was never sent (a hole in the world). Change one, change the other, in the same commit.
 */
export const FOG_MARGIN = 0.5;

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

// ── Vision mode's vocabulary (S3 P2 §1) ─────────────────────────────────────
// Three tiers again, but the party's own eyes draw the top one instead of the room record:
// what a sweep reaches is clear, what they have swept or the DM has revealed is a memory, and
// the rest is the same void.
//
// The *mask* itself is no longer built here. It is composited on the GPU from a pure draw plan
// (`tierPlan.ts` + `tierCompositor.ts`, docs/2026-09-01-raster-fog-mask-plan.md), so the Clipper
// booleans that used to run per drag are gone along with the marching-squares memory outline
// they consumed. What is left below is the measurements and the record decoding both pipelines
// share — and the DM's own overlay still reads.

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
 * referee is being shown which cells they painted). The player's memory tier stopped wanting
 * that shape twice over: W3 painted it as an outline, and the raster compositor now uploads the
 * record itself as one texel per cell. What still reads these is the DM's wash and `tierPlan`'s
 * held clip on a map nobody zoned, where the record's runs *are* the ground the player holds.
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

/**
 * How many cells the record actually holds — what `__fogProbe.memoryCells` reports.
 *
 * The record's own bit count, not the area that survived the clip: it answers "has the party's
 * memory grown", which is what the probe is for. `tierPlan` carries it into the plan.
 */
export function regionCells(region: RegionMask | undefined): number {
  if (!region) return 0;
  const bytes = toBytes(region.bits);
  let n = 0;
  for (let bit = 0; bit < region.cols * region.rows; bit++) {
    if ((bytes[bit >>> 3] & (1 << (bit & 7))) !== 0) n++;
  }
  return n;
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
  /**
   * Both of the above as pools, for the cloud to fade the clear tier out over
   * (`LivingFog.setPools`). The polygons say *where* the party can see; these say how each
   * source runs out. A light is whole to its radius and gone a pad past it, where its own
   * gradient already is — the edge the geometry alone drew, kept. A darkvision eye eases out
   * over the last quarter of its range on the lighting pass's rim curve (`RIM_START`), so the
   * ring reads like a dim pool the token carries rather than a circle with a blurred edge.
   */
  pools: readonly FogPool[];
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
  return (
    doc.frame ??
    computeMapFrame(
      doc.layers ?? [],
      doc.mapSettings?.terrain?.bounds ?? null,
      doc.mapSettings?.fixedSize ?? null,
    )
  );
}

/**
 * The ground the map carries terrain paint on: the document's own switches, and the paint
 * itself as `decodePaintedArea` read it off the splat bitmaps (`paintedArea` on the session
 * store). Off the referee's document for the reason `serverRooms` reads that document — it is
 * the same statement both seats are drawn from, and a player's copy carries it unredacted (the
 * whole-map splat going to players is a documented decision — `http.ts`'s `getMapImage`).
 *
 * This is a *clip* on what the party's own sight and the referee's own region record are
 * allowed to open (`tierPlan`'s held clip), never a reveal of its own. Nothing painted, nothing
 * switched on, or an empty palette ⇒ no painted ground at all, and the clip is what it was.
 *
 * It used to answer with the splat's bounding box, and a box is a claim about a rectangle
 * rather than about paint: on the Goblin Warren it covered 1536 cells over 521 painted ones,
 * and the cave mouth's fire ring — radius 15, through a doorless mouth — cleared a lit dome of
 * bare void inside it on every player seat. `decoded` is the paint, cell by cell. Null while
 * the decode is in flight, which reads here as no paint at all: a mask that has not been told
 * where the ground is fails dark.
 */
export function paintedGround(mapData: unknown, decoded: Polygon[] | null): Polygon[] {
  const terrain = (mapData as SerializedMapData | null)?.mapSettings?.terrain;
  if (!terrain?.bounds || terrain.visible === false) return [];
  if (!(terrain.palette ?? []).some(Boolean)) return [];
  const { minX, minY, maxX, maxY } = terrain.bounds;
  if (!(maxX > minX && maxY > minY)) return [];
  return decoded ?? [];
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
 * Every authored explore lock in the layers handed over, as a rectangle each.
 *
 * Only ever non-empty on the DM's copy: a zone is prep and the redaction strips zones from a
 * player's document unconditionally ("prep never travels", server `redactMap.ts`). So this is
 * the DM's sight preview's answer, and a player's near pass is fenced by the shipping clip
 * instead — on a walled map that already excludes a locked room, which is never credited and
 * so never ships.
 *
 * ponytail: a circle lock becomes its bounding box, which over-fences rather than under —
 * the mask shows *less* than the referee granted, never more, and the referee still tests the
 * real geometry per cell (`inAnyLock`). The precise answer is the circle as a polygon, worth
 * writing the day a table measures a corner it should have been able to see.
 */
export function exploreLocks(layers: readonly Layer[]): Polygon[] {
  return layers
    .flatMap((layer) => (layer.type === 'dungeon' ? layer.children : []))
    .filter((child): child is ZoneChild => child.childType === 'zone' && !!child.blocksAutoExplore)
    .flatMap((zone) => {
      const s = zone.shape;
      const box =
        s.kind === 'circle'
          ? [s.position.x - s.radius, s.position.y - s.radius, s.position.x + s.radius, s.position.y + s.radius]
          : // A point zone has no area to lock, and the server refuses it too (`exploreLocks`).
            s.kind === 'rect'
            ? [s.x, s.y, s.x + s.width, s.y + s.height]
            : null;
      if (!box) return [];
      const [x0, y0, x1, y1] = box;
      return [
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ] as Polygon,
      ];
    });
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
  const locks = exploreLocks(layers).map((poly) => [poly[0][0], poly[0][1], poly[2][0], poly[2][1]]);

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
