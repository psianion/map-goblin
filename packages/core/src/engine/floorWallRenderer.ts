import { Container, Graphics, Texture, TilingSprite } from 'pixi.js';
import type { DungeonLayer, PlateauChild, RockLine, ShapeChild } from '../store/types';
import type { LayerEntry } from './sceneGraph';
import type { Polygon } from '../types/geometry';
import { useStore } from '../store/store';
import { getAssetPackManager } from './assetPackInstance';
import * as textureLoader from '../assets/textureLoader';
import { unitTexture } from '../assets/textureLoader';
import { getWallSet, hasLiveTexture, isBandSet, isMeasuredBandSet } from '../assets/packCatalog';
import { renderEdgeTransitions } from './edgeTransitions';
import { renderNodeWalls } from './wallNodeRenderer';
import { bandFloorFit, fittedFloor, ringFloorOf, type FloorFit } from './caveBandRenderer';
import { renderDoors } from './doorRenderer';
import { resolveStyle } from './styleResolver';
import type { DungeonStyle } from '../store/types';
import { resolveDoors, resolveWalls, type ResolvedDoor } from '../shared/wallResolve';
import { doorGaps, openingLines, openingRegions } from './doorGaps';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { computeMergedFloor } from './mergedFloor';
import { layerSlopes, plateauAlongWalls, plateauDrawOrder, plateauTopFills, plateauTopTiles, renderPlateaus, slopeFaceTiles, type TopFill } from './plateauRenderer';
import { hasPlateaus } from '../shared/plateaus';
import { DEFAULT_TEXTURE_SCALE } from '../shared/types';
import { FACE_TILE_CELLS, faceDirectionOf, wobbleSeed } from '../shared/plateauShade';
import { getTerrainRenderer } from './terrain/TerrainRenderer';
import { deskSubdividesGrid, getEditorDesk } from './editorDesk';
import { gridDivision, gridLineSet, gridStrokes } from './imageGridRenderer';
import { edgeStyles, ringStyles, styleWallLook } from '../shared/wallLook';
import { cliffRockLines, rockLineOf, storeRockLines } from './rockLines';
import { layerDrawStyle, layerFloorFallback, layerLevelLook } from './levelLook';
import { detachRoomFills, drawRoomFills } from './roomFillRenderer';
import { healLegacyPaint } from './legacyPaint';
import { drawPiece, drawPieceBorder, isWaterPiece, pieceOutline, type PieceCtx } from './pieceRenderer';
import { paintRamp, pruneSoftMasks, rampMaskSprite } from './softPiece';
import { mouthLines, mouthRamp } from './softEdge';
import type { Ramp } from './rampMask';
import { wallShadowRamp, type LaidRock } from './wallShadow';
import { laidCaves } from './material/materialRenderer';
import { afterArtSettles } from './lateArt';

/** A '#rrggbb' as a number; NaN for anything else, missing included. */
function parseColor(hex: string | undefined): number {
  return typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : NaN;
}

/** The floor colour a style paints with, or the new-layer default when it names none. */
const DEFAULT_FLOOR_COLOR = 0xf1ecdf;
function floorColorOf(style: Partial<DungeonStyle> | undefined): number {
  const n = parseColor(style?.floorColor);
  return Number.isFinite(n) ? n : DEFAULT_FLOOR_COLOR;
}

/**
 * A floor bake is one-shot, but its pack textures can land after it ran: a file
 * import resolves textures only after `loadFromFile` has already rendered
 * (saveLoad.ts), and CDN install-by-need is slower still. Every such bake used
 * to freeze on its fallback until the user happened to touch the shape's
 * texture. Arm one wait per (layer, texture); when the texture lands, bump the
 * layer's epoch — subscribeToStore folds it into the render key and re-bakes.
 */
/** Each layer's floor fit from its last rebuild, with the union it was fitted for: the grid redraws on its own. */
const floorFits = new Map<string, { floor: Polygon[]; fit: FloorFit }>();

// The wait is the manager's texture signal, not a timed `waitForTexture`: on a slow first
// download the art can land long after any timeout, and a bake that gave up on it would
// stay bare for the rest of the session.
const lateTextures = new Map<string, Set<string>>();
let lateTexturesWatched: unknown = null;
export function armLateTextureRebuild(layerId: string, textureId: string): void {
  if (!textureId.includes(':') || textureId.startsWith('data:') || textureId.startsWith('blob:')) return;
  const manager = getAssetPackManager();
  if (lateTexturesWatched !== manager) {
    lateTexturesWatched = manager;
    lateTextures.clear();
    manager.subscribeTextures(() => {
      for (const [id, waiting] of [...lateTextures]) {
        // Asking again also starts a decode the first ask could not (its pack not read yet).
        if (![...waiting].some((t) => manager.getTextureOrNull(t))) continue;
        // The bake that follows arms again whatever is still missing. One bake once the art
        // landing now has settled, not one per batch (lateArt.ts).
        lateTextures.delete(id);
        afterArtSettles(`floor:${id}`, () => useStore.getState().bumpFloorTextureEpoch(id));
      }
    });
  }
  const waiting = lateTextures.get(layerId);
  if (waiting) waiting.add(textureId);
  else lateTextures.set(layerId, new Set([textureId]));
}

/**
 * A texture the catalogue does not list paints flat, as retired art. While the packs are
 * still being read that judgement is early: a pack read after the bake lists it. So once a
 * floor paints flat for it, the catalogue is watched, and every change to it bakes every
 * dungeon layer's floors again, once.
 */
let catalogWatched: unknown = null;
function watchCatalog(): void {
  const manager = getAssetPackManager();
  if (catalogWatched === manager) return;
  catalogWatched = manager;
  manager.subscribeCatalog(() => {
    // Once the packs being read now have settled, as late art is (lateArt.ts).
    afterArtSettles('catalog', () => {
      const store = useStore.getState();
      for (const layer of store.layers) if (layer.type === 'dungeon') store.bumpFloorTextureEpoch(layer.id);
    });
  });
}

/**
 * A layer's cave mouths, where its floor fades out: the stretches of its floor rings erased open
 * (`mouthLines`), and the Openings the Door tool hangs on cave rock (`openingLines`).
 */
function layerMouths(layer: DungeonLayer, polygons: readonly Polygon[], doors: readonly ResolvedDoor[]): Polygon[] {
  const lines = openingLines(layer, doors);
  const carved = mouthLines(polygons, layer.caveOpenings);
  return lines.length > 0 ? [...carved, ...lines] : carved;
}

/** Signed area of a polygon. Positive = CW in screen-space (outer), negative = CCW (hole). */
function signedArea(poly: Polygon): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i][0] * poly[j][1];
    area -= poly[j][0] * poly[i][1];
  }
  return area / 2;
}

function traceSinglePolygon(g: Graphics, polygon: Polygon): void {
  if (polygon.length < 3) return;
  g.moveTo(polygon[0][0], polygon[0][1]);
  for (let i = 1; i < polygon.length; i++) {
    g.lineTo(polygon[i][0], polygon[i][1]);
  }
  g.closePath();
}

function tracePolygons(g: Graphics, polygons: Polygon[]): void {
  for (const polygon of polygons) {
    traceSinglePolygon(g, polygon);
  }
}

/** Check if a point is inside a polygon (ray casting). */
function pointInPolygon(px: number, py: number, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * The holes each outer is cut by, in the outers' order. A hole belongs to the innermost
 * outer holding it: an outer can lie inside another's hole (the border round a hole in a
 * floor, inside the border round the floor), and a hole handed to the outer one lies
 * outside what that outer fills, which the triangulation answers with a wedge of fill.
 */
export function holesByOuter(outers: readonly Polygon[], holes: readonly Polygon[]): Polygon[][] {
  const out: Polygon[][] = outers.map(() => []);
  const areas = outers.map((o) => Math.abs(signedArea(o)));
  for (const hole of holes) {
    // Its first point says which outers hold it.
    const [hx, hy] = hole[0];
    let best = -1;
    for (let i = 0; i < outers.length; i++) {
      if (pointInPolygon(hx, hy, outers[i]) && (best < 0 || areas[i] < areas[best])) best = i;
    }
    if (best >= 0) out[best].push(hole);
  }
  return out;
}

/**
 * Fill polygons with proper hole support for PixiJS v8.
 * Clipper2 returns outer contours (CW in screen-space, positive signed area)
 * and hole contours (CCW, negative signed area).
 *
 * PixiJS v8's cut() only cuts from the most recent fill(). When there are
 * multiple disconnected outers, we must fill+cut each outer with its own
 * holes individually — otherwise cut() can't associate holes with the
 * correct outer.
 */
export function fillPolygonsWithHoles(g: Graphics, polygons: Polygon[], fillStyle: { color: number }): void {
  const outers: Polygon[] = [];
  const holes: Polygon[] = [];
  for (const poly of polygons) {
    if (poly.length < 3) continue;
    if (signedArea(poly) >= 0) {
      outers.push(poly);
    } else {
      holes.push(poly);
    }
  }

  // If no holes, simple fill all outers at once
  if (holes.length === 0) {
    tracePolygons(g, outers);
    g.fill(fillStyle);
    return;
  }

  const outerHoles = holesByOuter(outers, holes);

  // Fill each outer with its holes individually
  for (let i = 0; i < outers.length; i++) {
    const myHoles = outerHoles[i];
    traceSinglePolygon(g, outers[i]);
    g.fill(fillStyle);
    if (myHoles.length > 0) {
      for (const hole of myHoles) {
        traceSinglePolygon(g, hole);
      }
      g.cut();
    }
  }
}

/**
 * Compute axis-aligned bounding box of a polygon.
 */
function polygonBounds(points: [number, number][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Base scale factor: 200 texture pixels = 1 world unit (1 grid cell).
 * This is the FA standard — a 200×200px texture covers exactly 1 grid cell.
 * A 600px texture covers 3 grid cells at default textureScale=1.
 */
const PX_PER_GRID_CELL = 200;

/** A floor's own alpha, fill and texture only. */
const floorAlpha = (shape: ShapeChild): number => Math.min(1, Math.max(0, shape.opacity ?? 1));

/** How a tiled fill lays its texture: cells per 200 px, turn, offset from the world origin, tint. */
export interface TiledLook {
  scale: number;
  rotation?: number;
  offsetX?: number;
  offsetY?: number;
  tint?: number;
  alpha?: number;
  /** The rings are Clipper output whose negative rings are holes, cut out of the fill. */
  holes?: boolean;
  /**
   * Lay the pattern from the map's origin whatever the box, so it stays put on the map as the
   * rings move, and over a square box, so a turned pattern is not sheared (Pixi's batched
   * tiling turns it in the box's unit square). A slope's face tile asks for this.
   */
  mapAnchored?: boolean;
}

/**
 * Tile `texture` over `rings` the way a floor is painted: a TilingSprite over their bounds,
 * the pattern anchored to the world origin so neighbouring fills tile as one, masked to the
 * rings. Floors and path fills both paint through here.
 */
export function paintTiled(parent: Container, rings: Polygon[], texture: Texture, look: TiledLook): void {
  const { minX, minY, maxX, maxY } = polygonBounds(rings.flat());
  const side = Math.max(maxX - minX, maxY - minY);
  const width = look.mapAnchored ? side : maxX - minX;
  const height = look.mapAnchored ? side : maxY - minY;
  if (width <= 0 || height <= 0) return;

  const tileScale = look.scale / PX_PER_GRID_CELL;

  const ts = new TilingSprite({
    texture,
    width,
    height,
    tileScale: { x: tileScale, y: tileScale },
    tileRotation: look.rotation ?? 0,
  });
  ts.position.set(minX, minY);

  // Anchor tile pattern to world origin so adjacent shapes tile seamlessly. Pixi reads the tile
  // position in the sprite's own units, so the map-anchored pattern takes the box corner as is.
  if (look.mapAnchored) ts.tilePosition.set(-minX + (look.offsetX ?? 0), -minY + (look.offsetY ?? 0));
  else
    ts.tilePosition.set(
      (-minX + (look.offsetX ?? 0)) / tileScale,
      (-minY + (look.offsetY ?? 0)) / tileScale,
    );

  if (look.tint !== undefined) ts.tint = look.tint;
  if (look.alpha !== undefined) ts.alpha = look.alpha;

  // Mask to the rings (coordinates in world space, mask relative to parent)
  const mask = new Graphics();
  if (look.holes) {
    fillPolygonsWithHoles(mask, rings, { color: 0xffffff });
  } else {
    for (const r of rings) traceSinglePolygon(mask, r);
    mask.fill({ color: 0xffffff });
  }

  const container = new Container();
  container.addChild(ts);
  container.addChild(mask);
  container.mask = mask;
  parent.addChild(container);
}

/** How one shape's floor is painted: its texture, or a solid colour. */
export type ShapeFloorFill =
  | { kind: 'texture'; texture: Texture }
  /** `waitFor`: the pack texture this fill stands in for until it loads. */
  | { kind: 'solid'; color: number; waitFor?: string };

/**
 * The fill for one shape on a layer with `layerStyle`. Untextured shapes, and
 * shapes whose texture id no installed pack lists, paint the floor colour with
 * the shape's own `styleOverrides` applied. A known texture that has not loaded
 * yet stands in with its tint, or the floor colour when the tint is plain white.
 *
 * `fallbackTextureId` is what a shape with no texture of its own paints with: its
 * level's floor texture, on a layer that names no default (`layerFloorFallback`).
 */
export function shapeFloorFill(
  shape: ShapeChild,
  layerStyle: DungeonStyle,
  fallbackTextureId?: string,
): ShapeFloorFill {
  const resolved = resolveStyle(layerStyle, shape.styleOverrides as Partial<DungeonStyle> | undefined);
  // A layer whose style came through empty (a hand-written map, a republished copy) paints
  // the default floor rather than throwing on the missing colour.
  const floorColor = floorColorOf(resolved);
  const textureId = shape.textureId || fallbackTextureId;
  if (!textureId) return { kind: 'solid', color: floorColor };
  if (!hasLiveTexture(textureId)) {
    watchCatalog();
    return { kind: 'solid', color: floorColor };
  }
  // unitTexture, not resolveTexture: a variant-sheet source file must fill
  // with just its one unit — keeps the fill in scale with the palette/brush.
  const texture = unitTexture(textureId).texture;
  // > 1, not > 0: a pack id that hasn't landed resolves to the 1×1 magenta
  // fallback, which used to slip into the textured branch and tile the
  // whole room magenta instead of taking the not-loaded fill below.
  if (texture.width > 1) return { kind: 'texture', texture };
  const tint =
    shape.textureTint && shape.textureTint.toLowerCase() !== '#ffffff' ? parseColor(shape.textureTint) : NaN;
  return { kind: 'solid', color: isNaN(tint) ? floorColor : tint, waitFor: textureId };
}

/**
 * Preload textures for all textured shapes and paths in a layer.
 * Returns a Promise<boolean> that resolves to true if any NEW textures
 * were loaded (caller should re-rebuild the layer in that case).
 */
export function preloadLayerTextures(layer: DungeonLayer): Promise<boolean> {
  const promises: Promise<unknown>[] = [];
  const wanted: string[] = [];
  for (const child of layer.children) {
    if (child.childType === 'shape' && child.textureId) {
      wanted.push(child.textureId);
    }
  }
  const fallback = layerFloorFallback(layer);
  if (fallback && layer.children.some((c) => c.childType === 'shape' && !c.textureId)) wanted.push(fallback);
  for (const id of wanted) {
    if (id && !id.includes(':') && !textureLoader.getSync(id)) {
      // Only preload bundled textures — pack textures are loaded at boot via rehydrate
      promises.push(
        textureLoader.load(id).catch((err: unknown) => {
          console.error(`[floorWall] texture load failed for "${id}":`, err);
        }),
      );
    }
  }
  if (promises.length === 0) return Promise.resolve(false);
  return Promise.all(promises).then(() => true);
}

/**
 * Redraw only the doors sublayer — for a door STATE flip (open/closed/locked,
 * isSecret, style) that leaves door geometry (position/width/wallId) alone.
 * Skips wall-stone re-layout and the Clipper2 floor union entirely: those
 * only need to run again when `withoutDoorGaps` (wallNodeRenderer.ts) would
 * cut different gaps, which is a geometry change, not a state change.
 */
/** Whether a door hangs on a drawn wall hidden on its own: it goes with the wall. */
function onHiddenWall(layer: DungeonLayer, wallId: string): boolean {
  return !!wallId && layer.standaloneWalls.some((w) => w.id === wallId && w.visible === false);
}

export function redrawDoors(layer: DungeonLayer, entry: LayerEntry): void {
  if (!entry.sublayers) return;
  const { doors: doorsSublayer } = entry.sublayers;
  for (const child of doorsSublayer.removeChildren()) child.destroy();

  const resolvedWalls = resolveWalls(layer);
  const doors = resolveDoors(layer, resolvedWalls).filter((d) => d.door.visible && !onHiddenWall(layer, d.door.wallId));
  if (doors.length === 0) return;
  const gridCellSize = useStore.getState().grid.snapDivision || 1;
  const level = layerLevelLook(layer);
  renderDoors(doorsSublayer, doors, layerDrawStyle(layer), gridCellSize, ringStyles(layer, level), edgeStyles(layer, level));
}

/**
 * Redraw only the room fills — for a room, area, or level look edit that moves no
 * floor. A layer with no floor drawn yet has nowhere to put them; its rebuild does.
 */
export function redrawRoomFills(layer: DungeonLayer, entry: LayerEntry): void {
  if (!entry.sublayers) return;
  const { floor } = entry.sublayers;
  const walled = walledBoxOf(floor);
  if (!layer.mergedFloor || layer.mergedFloor.length === 0 || walled.parent !== floor) return;
  // Above the floor's own fills, below the terrain paint: re-inserted where the rebuild put it.
  drawRoomFills(walled, layer);
}

/**
 * What stays clipped to the walled floors' union, in a container of its own in the stack:
 * the edge transitions, the room fills and the older terrain paint. One per floor sublayer,
 * kept across rebuilds: the room fills live in it and outlive the bake.
 */
const walledBoxes = new WeakMap<Container, Container>();
function walledBoxOf(floor: Container): Container {
  let box = walledBoxes.get(floor);
  if (!box || box.destroyed) {
    box = new Container();
    box.label = 'floor-walled';
    walledBoxes.set(floor, box);
  }
  return box;
}

/** A layer with no union, by one identity, so what is kept per union stays kept. */
const NO_FLOOR: Polygon[] = [];

const groundGridMemo = new Map<string, { pieces: ShapeChild[]; plateaus: Polygon[][]; floor: Polygon[]; rings: Polygon[] }>();

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The plateau textures a layer draws, each as the region it is drawn over (`plateauTopTiles`,
 * `slopeFaceTiles`): they cover the grid under them, so they carry the layer's own. A Ground top
 * draws nothing and an id no installed pack lists draws nothing, so neither adds any.
 */
export function plateauGridRegions(layer: DungeonLayer): Polygon[][] {
  if (!hasPlateaus(layer)) return [];
  const regions: Polygon[][] = [];
  for (const [plateau, rings] of plateauTopTiles(layer)) if (hasLiveTexture(plateau.topArt ?? '')) regions.push(rings);
  // Each face as it landed, by its own identity: kept while the layer's slopes are.
  for (const f of layerSlopes(layer).faces) if (f.region.length > 0 && f.run.owner?.faceArt && hasLiveTexture(f.run.owner.faceArt)) regions.push(f.region);
  return regions;
}

/**
 * Where a layer's ground pieces and plateau textures carry grid lines: all of them as one
 * region, less the walled floors (which line themselves), so no line is drawn twice where they
 * overlap. Kept per layer while neither the pieces, the plateau regions nor the union change:
 * this runs on every step of a drag.
 */
function groundGridRings(layerId: string, pieces: ShapeChild[], plateaus: Polygon[][], floor: Polygon[]): Polygon[] {
  if (pieces.length === 0 && plateaus.length === 0) {
    groundGridMemo.delete(layerId);
    return [];
  }
  const hit = groundGridMemo.get(layerId);
  if (hit && hit.floor === floor && sameItems(hit.pieces, pieces) && sameItems(hit.plateaus, plateaus)) return hit.rings;
  const all = pieces.flatMap((p) => pieceOutline(p));
  let rings: Polygon[];
  if (pieces.length === 1 && plateaus.length === 0 && floor.length === 0) rings = all;
  else {
    const united = plateaus.length > 0 ? clipper2Engine.union(all, plateaus.flat()) : clipper2Engine.union(all, []);
    rings = floor.length > 0 ? clipper2Engine.difference(united, floor) : united;
  }
  groundGridMemo.set(layerId, { pieces, plateaus, floor, rings });
  return rings;
}

/**
 * Redraw only the grid sublayer. Draws geometry unconditionally — visibility
 * is controlled purely by the `grid` sublayer container's `visible` flag
 * (subscribeToStore's grid subscriptions), so a hidden→shown toggle never
 * needs to come back through here to have up-to-date lines.
 */
export function redrawGrid(layer: DungeonLayer, entry: LayerEntry): void {
  if (!entry.sublayers) return;
  const gridSub = entry.sublayers.grid;
  for (const child of gridSub.removeChildren()) child.destroy();

  const polygons = layer.mergedFloor ?? NO_FLOOR;
  // Ground pieces carry the grid too: lines mean "the built map", and ground is built. So do a
  // plateau's top and face textures, which cover the grid of whatever is under them.
  const ground = layer.children.filter((c): c is ShapeChild => c.childType === 'shape' && c.ground === true && c.visible !== false);
  const groundRings = groundGridRings(layer.id, ground, plateauGridRegions(layer), polygons);
  if (polygons.length === 0 && groundRings.length === 0) return;

  // Compute bounding box of all floor polygons
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const polygon of [...polygons, ...groundRings]) {
    for (const [x, y] of polygon) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const gridMinX = Math.floor(minX);
  const gridMaxX = Math.ceil(maxX);
  const gridMinY = Math.floor(minY);
  const gridMaxY = Math.ceil(maxY);

  // One colour per run of rings: a floor a preset pinned keeps its grid line colour
  // (`wallColor`) while the layer moves on. Almost always a single run.
  const styles = ringStyles(layer, layerLevelLook(layer));
  const byColor = new Map<string, Polygon[]>();
  polygons.forEach((poly, i) => {
    const color = (styles[i] ?? layer.style).wallColor;
    const group = byColor.get(color);
    if (group) group.push(poly);
    else byColor.set(color, [poly]);
  });

  // Whole cells, and in the editor the snap step between them (the table's desk turns it off).
  const lines = gridLineSet(gridMinX, gridMaxX, gridMinY, gridMaxY, deskSubdividesGrid(getEditorDesk()) ? gridDivision(useStore.getState().grid) : 1);

  // Ground and plateau textures take the layer's own line colour, over what the floors do not already line.
  // The walled floors' lines keep to their paint where a measured kit's rock fitted it.
  const fitted = floorFits.get(layer.id);
  const fit = fitted && fitted.floor === layer.mergedFloor ? fitted.fit : undefined;
  // They fade out across a cave's mouth as its floor does, by the same ramp.
  const opening = layer.children.some((c) => c.childType === 'door' && c.bare);
  const mouths = layerMouths(layer, polygons, opening ? resolveDoors(layer, resolveWalls(layer)).filter((d) => d.door.visible) : []);
  const groups: [string, Polygon[], Ramp | null][] = [...byColor].map(([color, rings]): [string, Polygon[], Ramp | null] => {
    const region = fittedFloor(rings, fit);
    return [color, region, mouthRamp(region, mouths, wobbleSeed(layer.id))];
  });
  if (groundRings.length > 0) groups.push([layer.style?.wallColor ?? '#000000', groundRings, null]);

  for (const [color, rings, faded] of groups) {
    // Mask to clip grid lines within floor shape
    const maskG = new Graphics();
    fillPolygonsWithHoles(maskG, rings, { color: 0xffffff });

    const gridContainer = new Container();
    gridContainer.addChild(maskG);
    const strokes = gridStrokes(Number.isFinite(parseColor(color)) ? parseColor(color) : 0x000000, lines);
    if (faded) {
      // Through a sprite of the fade, inside the crisp mask of the floor.
      const ramped = new Container();
      const ramp = rampMaskSprite(faded.field);
      ramped.addChild(...strokes, ramp);
      ramped.mask = ramp;
      gridContainer.addChild(ramped);
    } else {
      gridContainer.addChild(...strokes);
    }
    gridContainer.mask = maskG;
    gridSub.addChild(gridContainer);
  }
}

/**
 * Puts what stays on the walled floors into the stack, after what `floor` holds: the edge
 * transitions between differently textured floors, the looks pinned on rooms, areas and the
 * level, and the older terrain paint, all clipped to the floors' union. The union is grown by
 * the fills' bleed, or the clip would crop them straight back to the authored edge; erase
 * holes grow too (Clipper offsets a hole ring inward for a positive delta), so an erased
 * opening keeps its own margin.
 */
function drawWalledExtras(
  floor: Container,
  walled: Container,
  layer: DungeonLayer,
  polygons: Polygon[],
  bleed: number,
  covered: Polygon[],
  fit?: FloorFit,
): void {
  const mask = new Graphics();
  // Fitted to a measured kit's rock, as the floors under it are (bandFloorFit).
  const union = fittedFloor(bleed > 0 ? clipper2Engine.inflate(polygons, bleed) : polygons, fit);
  // Off a ground piece that lies on the floors: it is above them, so above their room look and older paint too.
  fillPolygonsWithHoles(mask, covered.length > 0 ? clipper2Engine.difference(union, covered) : union, { color: 0xffffff });
  walled.addChild(mask);
  walled.mask = mask;

  // ── Edge transitions (between differently-textured shapes) ───
  renderEdgeTransitions(walled, layer);

  // ── Floor looks pinned on rooms, areas and the level ─────────
  drawRoomFills(walled, layer);

  // ── Painted terrain over the floor ──────────────────────────
  // A floor is ground with walls around it, so a stroke runs across the boundary
  // instead of stopping at it. Above the fill and the transitions, below
  // grid/walls/doors; the mask keeps it from double-painting the ground
  // quad that already covers everything outside this floor.
  const terrainMesh = getTerrainRenderer()?.createFloorMesh();
  if (terrainMesh) walled.addChild(terrainMesh);

  floor.addChild(walled);
}

/**
 * A plateau's own texture (its face's or its top's), loaded: null for none, for an id no
 * installed pack lists (it draws nothing) and for one not loaded yet (it bakes again when it lands).
 */
function plateauTexture(layerId: string, id: string | undefined): Texture | null {
  if (!id || !hasLiveTexture(id)) {
    if (id) watchCatalog();
    return null;
  }
  const texture = unitTexture(id).texture;
  if (texture.width <= 1) {
    armLateTextureRebuild(layerId, id);
    return null;
  }
  return texture;
}

/**
 * A plateau's top texture over its top (`fill`): tiled as a ground piece of that texture with
 * its default settings is, so the top matches the same floor painted beside it; through its
 * seams' ramp, laid the same way, where it fades in from a seam with another top of its height.
 */
function drawTopTile(floor: Container, layerId: string, plateau: PlateauChild, fill: TopFill): void {
  const texture = plateauTexture(layerId, plateau.topArt);
  if (!texture) return;
  const look: TiledLook = { scale: DEFAULT_TEXTURE_SCALE, rotation: 0, offsetX: 0, offsetY: 0 };
  if (fill.soft) paintRamp(floor, { field: fill.soft, clip: fill.rings }, { texture, look });
  else paintTiled(floor, fill.rings, texture, { ...look, holes: true });
}

/**
 * A slope's face texture over its face (`rings`): tiled from the map's origin, FACE_TILE_CELLS
 * a tile, turned so the tile's fall line (+y) runs along the face direction. A texture no
 * installed pack lists draws nothing (the face reads as Ground); one not loaded yet bakes again
 * when it lands.
 */
function drawFaceTile(floor: Container, layerId: string, plateau: PlateauChild, rings: Polygon[]): void {
  const texture = plateauTexture(layerId, plateau.faceArt);
  if (!texture) return;
  const deg = faceDirectionOf(plateau, useStore.getState().mapSettings.faceDirection);
  // paintTiled lays `scale` cells per 200 px: the whole tile over FACE_TILE_CELLS.
  paintTiled(floor, rings, texture, {
    scale: (FACE_TILE_CELLS * PX_PER_GRID_CELL) / texture.width,
    rotation: ((deg - 90) * Math.PI) / 180,
    holes: true,
    mapAnchored: true,
  });
}

/**
 * The floor rings drawn whole (no per-edge looks) whose wall set no installed pack lists, so
 * nothing was laid round them.
 */
function uninstalledRings(
  polygons: Polygon[],
  rings: readonly (DungeonStyle | undefined)[],
  edges: readonly (DungeonStyle[] | null)[],
  style: DungeonStyle,
): Polygon[] {
  return polygons.filter((poly, i) => {
    if (poly.length < 3 || (edges[i] && edges[i]!.length === poly.length)) return false;
    const setId = styleWallLook(rings[i] ?? style).setId;
    return !!setId && !isBandSet(setId) && getWallSet(setId).length === 0;
  });
}

/**
 * Rebuild a dungeon layer's sublayers from store state.
 * Called by subscribeToStore whenever shapes or walls change.
 *
 * Sublayer order (floor → shadows → grid → walls → doors → objects → labels) is
 * established in sceneGraph.addLayerToScene — we only populate content.
 */
export function rebuildDungeonLayer(layer: DungeonLayer, entry: LayerEntry): void {
  if (!entry.sublayers) return;

  // Heal a missing union before rendering from it. A map load replaces the
  // layers wholesale with `mergedFloor: null` (files and session payloads both
  // ship it stripped), and the subscriber that normally recomputes it skips a
  // layer whose scene entry isn't rebuilt yet — if no later store write moves
  // its selector, the null union survives and every floor renders as void.
  // Rebuilding IS the moment the entry exists, so compute it here and write it
  // back for rooms, fog and wall resolution to read. The shapes subscriber does
  // not select mergedFloor, so the write cannot loop this rebuild.
  // An older map's patches and water mask become pieces here, once the catalog and Clipper
  // are at hand to convert what the load could not (legacyPaint.ts).
  layer = healLegacyPaint(layer);

  if (layer.mergedFloor == null) {
    const computed = computeMergedFloor(layer);
    if (computed) {
      useStore.setState((s) => {
        const l = s.layers.find((la) => la.id === layer.id);
        if (l && l.type === 'dungeon') l.mergedFloor = computed;
      });
      layer = { ...layer, mergedFloor: computed };
    }
  }

  const { floor, walls, doors: doorsSublayer } = entry.sublayers;

  // Clear all sublayers (reset floor mask from prior textured render). The room fills
  // outlive the bake: they are redrawn on their own key, not on every rebuild.
  floor.mask = null;
  const walled = walledBoxOf(floor);
  detachRoomFills(walled);
  if (walled.parent === floor) floor.removeChild(walled);
  walled.mask = null;
  for (const child of walled.removeChildren()) child.destroy({ children: true });
  for (const child of floor.removeChildren()) child.destroy({ children: true });
  // Not the walls: `renderNodeWalls` pools its stone sprites, reassigning the
  // ones already in the container and trimming the tail itself. Emptying it
  // here would throw the pool away on every rebuild, which is the allocation
  // this drag path exists to avoid.
  for (const child of doorsSublayer.removeChildren()) child.destroy();

  // paths sublayer removed in v2.0 model — spline paths are no longer separate

  // ── Walls and doors ────────────────────────────────────────────
  // Ahead of the no-floor bail-out below: walls do not depend on the floor
  // render, and a layer holding only standalone walls used to draw nothing at
  // all because this ran after that return. Z-order is unaffected — walls live
  // in their own sublayer container.
  // Doors resolve against every wall the engine knows about — standalone
  // segments and floor-ring edges alike — so a door on a floor edge draws and
  // gaps the stones exactly like one on a standalone wall, and both follow node
  // edits because their geometry is derived here rather than read off the child.
  const resolvedWalls = resolveWalls(layer);
  const doors = resolveDoors(layer, resolvedWalls).filter((d) => d.door.visible && !onHiddenWall(layer, d.door.wallId));
  // The marks that tell wall types apart are the editor's: drawn under a desk unless the desk
  // turns them off, which the table's does (players never see them).
  const desk = getEditorDesk();
  const marks = desk && desk.wallMarks !== false ? entry.sublayers.wallMarks : undefined;
  if (!marks) for (const child of entry.sublayers.wallMarks.removeChildren()) child.destroy({ children: true });
  // The style the walls draw with: the layer's, with its level's look folded in
  // (the rule is in wallLook.ts, `levelStyle`).
  const level = layerLevelLook(layer);
  const drawStyle = layerDrawStyle(layer);
  const rings = ringStyles(layer, level);
  const edges = edgeStyles(layer, level);
  // The rings a measured kit's rock was laid round: the floor's paint is fitted to it.
  const fits: FloorFit[] = [];
  // …and the line it was laid on, saved for light, sight and movement (rockLines.ts).
  const rockLines: RockLine[] = [];
  // Every ring and run a measured kit's rock was laid along, for the walls' floor shadow.
  const rock: LaidRock[] = [];
  renderNodeWalls(
    walls,
    layer.mergedFloor ?? [],
    // A wall hidden on its own draws nowhere (the export reads this scene graph too).
    layer.standaloneWalls.filter((w) => w.visible !== false),
    drawStyle,
    doorGaps(layer, doors, resolvedWalls),
    layer.floorWallEdits ?? {},
    {
      ringStyles: rings,
      edgeStyles: edges,
      marks,
      openings: layer.caveOpenings,
      floorOf: ringFloorOf(layer),
      waitFor: (id) => armLateTextureRebuild(layer.id, id),
      onBandLaid: (laid) => {
        fits.push(bandFloorFit(laid.ring, laid.placed, laid.gaps, laid.size));
        const line = rockLineOf(laid.ring, laid.placed);
        if (line) rockLines.push(line);
      },
      onRockLaid: (laid) => rock.push(laid),
    },
  );
  // A painted cave's measured rock fits its floor too, from the one laying its rock is drawn from.
  for (const laid of laidCaves(layer)) {
    if (!isMeasuredBandSet(laid.cave.material)) continue;
    laid.rings.forEach((ring, i) => fits.push(bandFloorFit(ring, laid.placed[i], laid.gaps, laid.size)));
    laid.placed.forEach((placed) => rock.push({ placed, closed: true, size: laid.size }));
  }
  // The walls' floor shadow, along all of that rock, over the floor's paint and under the rock.
  // An Opening on cave rock is kept clear of it as a carved mouth is.
  const opened = openingRegions(openingLines(layer, doors));
  const drawWallShadow = (): void => {
    const shadow = wallShadowRamp(rock, opened.length > 0 ? [...(layer.caveOpenings ?? []), ...opened] : layer.caveOpenings);
    if (!shadow) return;
    const host = new Container();
    host.label = 'wall-shadow';
    paintRamp(host, shadow, { color: 0x000000 });
    floor.addChild(host);
  };
  storeRockLines(layer.id, 'floor', rockLines, layer.rockLines?.length ? uninstalledRings(layer.mergedFloor ?? [], rings, edges, drawStyle) : []);
  // The plateaus below are drawn along the lines just stored: storing them rebuilds nothing.
  const reread = (): void => {
    const stored = useStore.getState().layers.find((l): l is DungeonLayer => l.id === layer.id && l.type === 'dungeon');
    if (stored && stored.rockLines !== layer.rockLines) layer = { ...layer, rockLines: stored.rockLines };
  };
  reread();
  // A plateau cliff laid with a measured kit of its own is walked along the walls' lines, and the
  // line it laid stored before anything is drawn along it.
  const cliffs = cliffRockLines(layer);
  storeRockLines(layer.id, 'cliff', cliffs.lines, layer.rockLines?.length ? cliffs.missing : []);
  reread();
  const fit: FloorFit | undefined = fits.some((f) => f.tips.length + f.gaps.length > 0)
    ? { tips: fits.flatMap((f) => f.tips), gaps: fits.flatMap((f) => f.gaps) }
    : undefined;
  if (fit && layer.mergedFloor) floorFits.set(layer.id, { floor: layer.mergedFloor, fit });
  else floorFits.delete(layer.id);
  if (doors.length > 0) {
    const gridCellSize = useStore.getState().grid.snapDivision || 1;
    renderDoors(doorsSublayer, doors, drawStyle, gridCellSize, rings, edges);
  }

  // Plateaus, band by band, over the ground (plateauRenderer.ts). Ahead of the no-floor
  // bail-out: a plateau over painted terrain has no floor under it.
  renderPlateaus(layer, entry.sublayers.plateauTops, entry.sublayers.plateauEdges, {
    waitFor: (id) => armLateTextureRebuild(layer.id, id),
    fit,
    cliffs: cliffs.walks,
  });

  // The authored boundary itself. A ring's stones stand on it, and dragging one
  // moves it (see ringStoneDrag), so there is nothing here to bend to match.
  const polygons = layer.mergedFloor ?? NO_FLOOR;

  // ── The pieces, in their order ───────────────────────────────
  // Every floor piece, walled or ground, is drawn at its own place in `children`, so the top
  // one wins. Each is painted to its own region (its ring less its own holes) rather than
  // under one mask of the union: a hole in one piece shows the piece under it.
  const pieces = layer.children.filter(
    (c): c is ShapeChild => c.childType === 'shape' && c.visible !== false && (c.contours[0]?.length ?? 0) >= 3,
  );
  // A plateau's top texture and a slope's face texture are floors of their own, at the plateau's
  // place among the pieces: drawn after the piece before it (`after`, -1 before them all), so
  // ground painted later covers them. Those that share a place go in the plateaus' draw order
  // (`plateauDrawOrder`), each top under its face.
  const placeOf = new Map<unknown, number>(layer.children.map((c, i) => [c, i]));
  const afterOf = (plateau: PlateauChild): number => {
    const at = placeOf.get(plateau) ?? -1;
    let after = -1;
    while (after + 1 < pieces.length && (placeOf.get(pieces[after + 1]) ?? 0) < at) after++;
    return after;
  };
  const tops = plateauTopFills(layer);
  const faces = slopeFaceTiles(layer);
  const order = tops.size + faces.size > 0 ? plateauDrawOrder(layer) : new Map<PlateauChild, number>();
  const owners = [...new Set([...tops.keys(), ...faces.keys()])].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const faceTiles = owners.flatMap((plateau) => {
    const after = afterOf(plateau);
    const top = tops.get(plateau);
    const face = faces.get(plateau);
    // Where the plateau's edge runs along a cave wall, its top and face meet the rock as the floor does.
    const along = (rings: Polygon[], isFace: boolean) => plateauAlongWalls(layer, plateau, rings, fit, isFace);
    const fitted: TopFill | null = top ? { ...top, rings: along(top.rings, false) } : null;
    return [
      ...(fitted ? [{ plateau, rings: fitted.rings, top: fitted, after }] : []),
      ...(face ? [{ plateau, rings: along(face, true), top: null, after }] : []),
    ];
  });
  const drawFaces = (after: number): void => {
    for (const f of faceTiles) {
      if (f.after !== after) continue;
      if (f.top) drawTopTile(floor, layer.id, f.plateau, f.top);
      else drawFaceTile(floor, layer.id, f.plateau, f.rings);
    }
  };
  if (polygons.length === 0 && pieces.length === 0) {
    drawFaces(-1);
    drawWallShadow();
    pruneSoftMasks(layer.id, new Set());
    redrawGrid(layer, entry);
    return;
  }

  const s = layer.style ?? ({} as DungeonStyle);
  const floorColorNum = floorColorOf(s);
  // Paint-only overshoot, per floor: a floor a preset pinned carries its own, so the
  // paint of drawn work stays put.
  const bleedOf = (shape: ShapeChild) =>
    Math.max(0, resolveStyle(s, shape.styleOverrides as Partial<DungeonStyle> | undefined).floorBleed ?? 0);

  // The walled floors: what the union, the transitions, the room fills and the older
  // terrain paint are about.
  const shapeChildren = pieces.filter((c) => !c.ground);
  // A texture id no installed pack lists (a retired pack's art) never loads, so
  // such a shape counts as untextured and paints its floor colour.
  // A floor with no texture of its own takes its level's, on a layer that names none.
  const floorFallback = layerFloorFallback(layer);
  const hasTexturedShapes = shapeChildren.some((sh) => hasLiveTexture(sh.textureId || floorFallback));

  // Fast-path detection: check if ANY shape has styleOverrides before
  // enabling per-shape resolution (avoids overhead in the common case).
  const hasStyleOverrides = shapeChildren.some((sh) => sh.styleOverrides && Object.keys(sh.styleOverrides).length > 0);
  // A floor below full opacity, or faded by a soft erase, is painted on its own, so what is under it shows through.
  const perShape = hasTexturedShapes || hasStyleOverrides || shapeChildren.some((sh) => floorAlpha(sh) < 1 || (sh.fades?.length ?? 0) > 0);
  // The widest bleed any walled fill takes: what is clipped to the union below grows by it.
  const bleed = perShape
    ? shapeChildren.reduce((m, sh) => Math.max(m, bleedOf(sh)), 0)
    : Math.max(0, s.floorBleed ?? 0);

  // Plain floors (no texture, no override, full opacity) are filled as one union in one
  // colour, which is faster. Only while no ground piece or face texture lies between them in
  // the order: one fill cannot go both under and over it.
  const firstWalled = pieces.findIndex((c) => !c.ground);
  const lastWalled = pieces.reduce((at, c, i) => (c.ground ? at : i), -1);
  const unionFilled =
    !perShape &&
    polygons.length > 0 &&
    !pieces.some((c, i) => c.ground === true && i > firstWalled && i < lastWalled) &&
    !faceTiles.some((f) => f.after >= firstWalled && f.after < lastWalled);

  // Every water piece's outline, as one: a shore stops where water meets water.
  const waters = pieces.filter((c) => isWaterPiece(c));
  const water = waters.length > 1 ? clipper2Engine.union(waters.flatMap((c) => pieceOutline(c)), []) : waters.flatMap((c) => pieceOutline(c));
  // A cave's floor fades out across each of its mouths.
  const mouths = layerMouths(layer, polygons, doors);
  const mouthSeed = wobbleSeed(layer.id);
  const ctx: PieceCtx = { layer, style: s, floorFallback, water, bleedOf, unionFilled, soft: new Set(), bordersOverExtras: polygons.length > 0, fit, mouths, mouthSeed };

  // A ground piece between two walled floors lies over the floors under it: where it shows
  // (no later walled floor covers it) the walled extras stay off it.
  let covered: Polygon[] = [];
  pieces.forEach((g, i) => {
    if (!g.ground || i < firstWalled || i > lastWalled) return;
    const later = pieces.slice(i + 1).filter((c) => !c.ground).flatMap((c) => pieceOutline(c));
    const own = clipper2Engine.difference(pieceOutline(g), later);
    covered = covered.length > 0 ? clipper2Engine.union(covered, own) : own;
  });
  // So do a plateau's top and face textures there.
  for (const f of faceTiles) {
    if (f.after < firstWalled || f.after >= lastWalled) continue;
    const later = pieces.slice(f.after + 1).filter((c) => !c.ground).flatMap((c) => pieceOutline(c));
    const own = clipper2Engine.difference(f.rings, later);
    covered = covered.length > 0 ? clipper2Engine.union(covered, own) : own;
  }
  const walledExtras = (): void => {
    drawWalledExtras(floor, walled, layer, polygons, bleed, covered, fit);
    // The walled floors' painted borders go over the room looks and the older paint, as they
    // always did. A ground piece drawn after this still covers them.
    for (const sh of shapeChildren) if (sh.edgePaint) drawPieceBorder(floor, layer.id, sh, fit);
  };

  drawFaces(-1);
  pieces.forEach((shape, i) => {
    if (unionFilled && i === firstWalled) {
      const region = fittedFloor(polygons, fit);
      const faded = mouthRamp(region, mouths, mouthSeed);
      if (faded) paintRamp(floor, faded, { color: floorColorNum });
      else {
        const floorG = new Graphics();
        fillPolygonsWithHoles(floorG, region, { color: floorColorNum });
        floor.addChild(floorG);
      }
    }
    drawPiece(floor, shape, ctx);
    if (i === lastWalled && polygons.length > 0) walledExtras();
    drawFaces(i);
  });
  // A union with no drawable floor behind it (rings too short to draw) still carries its extras.
  if (lastWalled < 0 && polygons.length > 0) walledExtras();
  drawWallShadow();
  pruneSoftMasks(layer.id, ctx.soft);

  // ── Grid sublayer (lines inside shapes) ─────────────────
  redrawGrid(layer, entry);

  // Walls and doors already rendered above, before the no-floor bail-out.

}
