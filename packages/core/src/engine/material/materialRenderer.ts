// Draws the rock round a layer's painted caves into its materials sublayer: the material's
// border units laid by the cave band walk along the union of the floors marked with it
// (`edgeMaterial`), wherever that outline runs. The rock is a wall, so it stands above every
// floor piece. The PNG export and the table render the same sublayer.
//
// The water's edge is worked out here too, for the piece renderer (pieceRenderer.ts) to draw
// at a water piece's own place in the stack (`waterEdgeOf`): a band of a ground texture on
// the land side, its outer edge soft, the water crisp against it with a thin darker
// waterline; deep water a dark shade along the bank on the water; and, switched on, a pale
// shallow line. Where it crosses a plateau's cliff, a pale fall across it along the cliff
// line (`fallRamp`).

import { Container, Graphics } from 'pixi.js';
import type { DungeonLayer, RockLine } from '../../store/types';
import type { Polygon } from '../../types/geometry';
import { getLayerEntry } from '../sceneGraph';
import { bandFillColor, drawOutlineBand, layOutlineBand, orientRings } from '../caveBandRenderer';
import { bandSize, isBandSet, isMeasuredBandSet } from '../../assets/packCatalog';
import { bandPiecesFor } from '../../assets/caveWallKit';
import { rockLineOf, storeRockLines } from '../rockLines';
import type { WalkPlacement } from '../caveWalk';
import { layerDrawStyle } from '../levelLook';
import { isDeepWater, isWaterMaterial, materialFillId, shoreTextureOf } from '../../assets/materialKit';
import { load, resolveTexture } from '../../assets/textureLoader';
import { outsideBandRamp } from '../softEdge';
import { paintRamp } from '../softPiece';
import { distanceIn, distanceToLines, fallOff, fieldOf, keptRamp, rampGrid, type Ramp } from '../rampMask';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import { useStore } from '../../store/store';
import { shoreWidthOf } from '../../shared/materialPatch';
import { edgeRuns, groundHeightOf, hasPlateaus, layerPlateaus } from '../../shared/plateaus';
import { caveEdges, caveOpeningGaps, type CaveEdge } from '../../shared/caveFloor';
import { resolveDoors, resolveWalls, type ResolvedDoor } from '../../shared/wallResolve';
import { stairOpenings } from '../../shared/stairOpenings';
import type { DoorGap } from '../wallNodeRenderer';
import { rockGaps } from '../doorGaps';
import { getAssetPackManager } from '../assetPackInstance';
import { afterArtSettles } from '../lateArt';

/** Layers waiting on art to load, so one redraw follows however many textures land. */
const waiting = new Set<string>();
/** Art asked for once already: an id no pack delivers is not asked for again. */
const asked = new Set<string>();
/** The art each layer's rock was last drawn without, by layer id. */
const bare = new Map<string, string[]>();

/** Draws the layer `id`'s caves again once the art landing now has settled (lateArt.ts). */
function redrawOnceSettled(id: string): void {
  afterArtSettles(`materials:${id}`, () => {
    const now = useStore.getState().layers.find((l): l is DungeonLayer => l.id === id && l.type === 'dungeon');
    if (now) drawLayerMaterials(now);
  });
}

/**
 * Art can land later than one wait: a decode clears `asked` so the next draw asks again,
 * and redraws the rock of a layer drawn without art that has now landed.
 */
let watching = false;
function watchTextures(): void {
  if (watching) return;
  watching = true;
  getAssetPackManager().subscribeTextures(() => {
    asked.clear();
    for (const [id, art] of [...bare]) {
      if (!art.some((t) => resolveTexture(t).width > 1)) continue;
      bare.delete(id);
      redrawOnceSettled(id);
    }
  });
}

/**
 * Each art id the caves' fill needs that has not loaded (the ink kit's strip takes its tone
 * from it); loads them and redraws the layer once they have. The rock's own pieces take their
 * art in place when it lands (`placeBand`), with nothing drawn again.
 */
function awaitArt(layer: DungeonLayer, materials: readonly string[]): void {
  watchTextures();
  const ids = new Set<string>();
  for (const material of materials) {
    const fill = materialFillId(material);
    if (fill) ids.add(fill);
  }
  const unloaded = [...ids].filter((id) => resolveTexture(id).width <= 1);
  if (unloaded.length > 0) bare.set(layer.id, [...(bare.get(layer.id) ?? []), ...unloaded]);
  const missing = unloaded.filter((id) => !asked.has(id));
  if (missing.length === 0 || waiting.has(layer.id)) return;
  waiting.add(layer.id);
  for (const id of missing) asked.add(id);
  void Promise.all(missing.map((id) => load(id))).then(() => {
    waiting.delete(layer.id);
    redrawOnceSettled(layer.id);
  });
}

// ─── Water's edge ──────────────────────────────────────────

/** How much of a shore's width its outer edge fades over, where it meets the ground. */
export const SHORE_FADE = 0.4;
/** The thin darker line where the shore meets the water: cells wide, ink, opacity. */
export const WATERLINE_WIDTH = 0.05;
const WATERLINE = 0x3b2f22;
const WATERLINE_ALPHA = 0.35;
/** The Shallow line: pale, centred this far inside the water, this wide, at this opacity (a wider faint pass under it). */
export const SHALLOW_IN = 0.2;
const SHALLOW_WIDTH = 0.12;
const SHALLOW = 0xeaf6f2;
const SHALLOW_ALPHA = 0.35;
/** Deep water's bank shade: black this dark at the bank, fading out over this far onto the water. */
export const BANK_SHADE_ALPHA = 0.35;
export const BANK_SHADE_WIDTH = 0.5;

/** What a water piece draws round its edge. */
export interface WaterEdge {
  /** The band on the land side; none for a shore of None or one whose texture is not known. */
  shore?: { textureId: string; width: number };
  /** The dark shade along the bank on the water: its darkness at the bank (0 = none) and how far it reaches. */
  bankShade: number;
  bankWidth: number;
  /** The pale line just inside the water. */
  shallow: boolean;
}

/** Sunk water's shore is this much wider than its set width. */
export const SUNK_SHORE_SCALE = 1.5;
/** Sunk water's bank shade: this dark a cell of depth, never darker than BANK_SHADE_MAX. */
export const BANK_SHADE_PER_CELL = 0.2;
export const BANK_SHADE_MAX = 0.6;

/** The fields of a water piece its edge is read from; `material` is its fill texture. */
export interface WaterEdgeSource {
  material: string;
  shore?: string;
  shoreWidth?: number;
  shallowLine?: boolean;
  height?: number;
}

/**
 * The edge a piece's water takes; null for a piece that is not water (cave floor, ground). At
 * height 0 (or raised) its shore is as set and only deep water shades its bank; sunk below 0
 * its shore is half as wide again and any water shades its bank, darker the deeper it lies,
 * up to BANK_SHADE_MAX.
 */
export function waterEdgeOf(piece: WaterEdgeSource): WaterEdge | null {
  if (!isWaterMaterial(piece.material)) return null;
  const textureId = shoreTextureOf(piece.shore);
  const depth = Math.max(0, -groundHeightOf(piece.height));
  const deep = isDeepWater(piece.material) ? BANK_SHADE_ALPHA : 0;
  return {
    shore: textureId ? { textureId, width: shoreWidthOf(piece.shoreWidth) * (depth > 0 ? SUNK_SHORE_SCALE : 1) } : undefined,
    bankShade: depth > 0 ? Math.min(BANK_SHADE_MAX, Math.max(deep, BANK_SHADE_PER_CELL * depth)) : deep,
    bankWidth: BANK_SHADE_WIDTH,
    shallow: piece.shallowLine === true,
  };
}

/** The dark shade along a bank, on the water: `peak` at the outline, easing out to nothing `width` in. Null for no water. */
export function bankShadeRamp(outline: Polygon[], peak: number, width: number): Ramp | null {
  return keptRamp('bank', [outline, peak, width], () => {
    const grid = rampGrid(outline, 0.1);
    if (!grid) return null;
    const d = distanceIn(outline, grid);
    // Outside the water, as dark as at the bank: the clip cuts it crisp there, with no texel's blur.
    return { field: fieldOf(grid, (_x, _y, k) => peak * fallOff(d[k], 0, width)), clip: outline };
  });
}

/** A fall: pale water this far either side of a cliff line, at this opacity on the line. */
export const FALL_HALF = 0.3;
const FALL = 0xf4fbfa;
const FALL_ALPHA = 0.7;

/**
 * Where water falls: the layer's plateau cliff lines that cross the water (`outline`), a pale
 * band FALL_HALF either side easing out from the line, cut to the water, so the fall is as wide
 * as the water there. Null on a layer with no cliff, or none across the water.
 */
export function fallRamp(layer: Pick<DungeonLayer, 'children'>, outline: Polygon[]): Ramp | null {
  if (!hasPlateaus(layer)) return null;
  const lines = layerPlateaus(layer)
    .bands.flatMap((b) => edgeRuns(b))
    .filter((r) => r.edge === 'cliff' && r.drop !== 0)
    .map((r) => (r.closed ? [...r.points, r.points[0]] : r.points));
  if (lines.length === 0) return null;
  return keptRamp('fall', [lines, outline], () => {
    const clip = clipper2Engine.intersection(clipper2Engine.inflateOpen(lines, FALL_HALF), outline);
    const grid = rampGrid(clip, 0.1);
    if (!grid) return null;
    const { d } = distanceToLines(
      lines.map((pts) => ({ pts, closed: false })),
      grid,
      FALL_HALF,
    );
    return { field: fieldOf(grid, (_x, _y, k) => FALL_ALPHA * fallOff(d[k], 0, FALL_HALF)), clip };
  });
}

/** Each ring of `rings` stroked closed. */
function strokeRings(g: Graphics, rings: Polygon[], style: { color: number; width: number; alpha: number }): void {
  for (const r of rings) if (r.length >= 3) g.poly(r.flat(), true).stroke(style);
}

/**
 * The ramp of a shore `width` wide round `outline`, less `water` (every water piece on the
 * layer): water meeting water has no bank between the two, whatever each is.
 */
export function shoreRamp(outline: Polygon[], width: number, water: Polygon[]): Ramp | null {
  return outsideBandRamp(outline, width, width * SHORE_FADE, water);
}

/** A water piece's shore band, outside its outline, under its fill. Art not loaded yet draws none; true when it drew. */
export function drawShore(piece: Container, outline: Polygon[], edge: WaterEdge, water: Polygon[]): boolean {
  if (!edge.shore) return false;
  const tex = resolveTexture(edge.shore.textureId);
  if (tex.width <= 1) return false;
  const ramp = shoreRamp(outline, edge.shore.width, water);
  if (!ramp) return false;
  const band = new Container();
  band.label = 'material-shore';
  paintRamp(band, ramp, { texture: tex, look: { scale: 1 } });
  piece.addChild(band);
  return true;
}

/** Over a water piece's fill: the bank shade, the shallow line, and with a shore the waterline. */
export function drawWaterEdge(piece: Container, outline: Polygon[], edge: WaterEdge, shored: boolean): void {
  const bank = edge.bankShade > 0 ? bankShadeRamp(outline, edge.bankShade, edge.bankWidth) : null;
  if (bank) {
    const shade = new Container();
    shade.label = 'material-bank-shade';
    paintRamp(shade, bank, { color: 0x000000 });
    piece.addChild(shade);
  }
  if (edge.shallow) {
    const g = new Graphics();
    g.label = 'material-shallow-line';
    const line = clipper2Engine.inflate(outline, -SHALLOW_IN);
    strokeRings(g, line, { color: SHALLOW, width: SHALLOW_WIDTH * 2, alpha: SHALLOW_ALPHA / 2 });
    strokeRings(g, line, { color: SHALLOW, width: SHALLOW_WIDTH, alpha: SHALLOW_ALPHA });
    piece.addChild(g);
  }
  if (shored) {
    const g = new Graphics();
    g.label = 'material-waterline';
    strokeRings(g, outline, { color: WATERLINE, width: WATERLINE_WIDTH, alpha: WATERLINE_ALPHA });
    piece.addChild(g);
  }
}

/** A water piece's falls, where it crosses the layer's cliffs. */
export function drawFalls(piece: Container, layer: Pick<DungeonLayer, 'children'>, outline: Polygon[]): void {
  const falls = fallRamp(layer, outline);
  if (!falls) return;
  const fall = new Container();
  fall.label = 'material-fall';
  paintRamp(fall, falls, { color: FALL });
  piece.addChild(fall);
}

// ─── A painted cave's rock ─────────────────────────────────

/** One painted cave's rock as the walk laid it. */
export interface LaidCave {
  cave: CaveEdge;
  /** The cave's outline rings, wound void-left (`orientRings`), as the walk took them. */
  rings: Polygon[];
  /** Where its rock stops: the doors on it, and wherever it was erased open. */
  gaps: DoorGap[];
  /** The size its rock was laid at. */
  size: number;
  /** What the walk laid round each ring. */
  placed: WalkPlacement[][];
}

const laidMemo = new WeakMap<object, { openings: DungeonLayer['caveOpenings']; floor: DungeonLayer['mergedFloor']; width: number; value: LaidCave[] }>();

/**
 * Each painted cave's rock on a layer, laid once for everything drawn from it: the rock itself
 * and the line it is saved as (`drawLayerMaterials`), and the floor a measured kit's rock fits
 * (`rebuildDungeonLayer`). Each is laid along the union of the floors marked with its material,
 * stopped at the doors on it and wherever it was erased open, at the cave's own width, else the
 * layer's, as a banded floor ring's rock is. Memoised on what it is laid from.
 */
export function laidCaves(layer: DungeonLayer): LaidCave[] {
  const width = layerDrawStyle(layer).wallWidth;
  const hit = laidMemo.get(layer.children);
  if (hit && hit.openings === layer.caveOpenings && hit.floor === layer.mergedFloor && hit.width === width) return hit.value;
  const caves = caveEdges(layer);
  const walls = caves.length > 0 ? resolveWalls(layer) : [];
  // Stairs along a cave's wall open its rock as an Opening does.
  const doors = caves.length > 0 ? [...resolveDoors(layer, walls).filter((d) => d.door.visible && !d.detached), ...stairOpenings(layer, walls)] : [];
  const value = caves.map((cave): LaidCave => {
    const gaps = [...caveDoorGaps(cave, doors), ...caveOpeningGaps(cave, layer.caveOpenings)];
    const size = bandSize(cave.material, cave.width ?? width);
    return { cave, rings: orientRings(cave.rings), gaps, size, placed: layOutlineBand(cave.rings, bandPiecesFor(cave.material), gaps, size) };
  });
  laidMemo.set(layer.children, { openings: layer.caveOpenings, floor: layer.mergedFloor, width, value });
  return value;
}

/**
 * The rock round a layer's painted caves of one material, as laid (`laidCaves`). The floors'
 * own fill is drawn with the other pieces.
 */
function drawCave(host: Container, layer: DungeonLayer, laid: LaidCave, lines: RockLine[]): void {
  const { cave } = laid;
  const piece = new Container();
  piece.label = `cave-${cave.material}`;
  // A measured kit's rock is saved as the line it was laid on (rockLines.ts).
  const onLaid = isMeasuredBandSet(cave.material)
    ? (ring: Polygon, placed: WalkPlacement[]) => {
        const line = rockLineOf(ring, placed);
        if (line) lines.push(line);
      }
    : undefined;
  drawOutlineBand(
    piece,
    cave.rings,
    cave.material,
    bandFillColor({ floorColor: layer.style.floorColor, textureId: materialFillId(cave.material) }),
    laid.gaps,
    laid.size,
    onLaid,
    laid.placed,
  );
  host.addChild(piece);
}

/**
 * Where a cave's rock stops: one gap per door on its wall, a plain opening's among them, shaped
 * for its rock (`rockGaps`). Its wall is the walls of kind `cave` in its material (a ring erased
 * open stands as several).
 */
export function caveDoorGaps(cave: CaveEdge, doors: readonly ResolvedDoor[]): DoorGap[] {
  return doors
    .filter((d) => d.wall?.kind === 'cave' && d.wall.textureSetId === cave.material && d.wall.bandWidth === cave.width)
    .flatMap((d) => rockGaps([{ wallId: d.wall!.id, position: d.position, width: d.door.width }], d.door, cave.material));
}

/** Draws a layer's painted caves' rock, replacing what was drawn; none clears the sublayer. */
export function drawLayerMaterials(layer: DungeonLayer): void {
  const host = getLayerEntry(layer.id)?.sublayers?.materials;
  if (!host) return;
  for (const child of host.removeChildren()) child.destroy({ children: true });
  bare.delete(layer.id);
  const caves = caveEdges(layer);
  const lines: RockLine[] = [];
  if (caves.length > 0) {
    awaitArt(layer, caves.map((c) => c.material));
    for (const laid of laidCaves(layer)) drawCave(host, layer, laid, lines);
  }
  // A cave whose kit is not installed laid nothing: the line it was saved with stays.
  const missing = layer.rockLines?.length ? caves.filter((c) => !isBandSet(c.material)).flatMap((c) => c.rings) : [];
  storeRockLines(layer.id, 'cave', lines, missing);
}
