// Draws a layer's Material brush patches into its materials sublayer: each patch's fill
// (the material's floor texture, tiled to the world like a floor) masked to its outline,
// then, with Border on, the material's border units laid round that outline by the cave
// band walk; and the same rock round the layer's painted caves (floors marked with an edge
// material), along their own outline wherever it runs. The PNG export and the table render
// the same sublayer.
//
// A plain floor texture material has no border units: its patch is the texture alone, its
// edge fading out over SOFT_EDGE cells inside the outline (softEdge.ts), so it blends into
// whatever lies under it the way a dirt trail runs into grass. On a layer with floors it is
// trimmed to their union (`patchTrim`), so it never shows past a wall. A ground patch (its
// stroke started off every floor) is drawn whole in the ground sublayer, under the floors.
//
// A water texture's patch has a shore (`waterEdgeOf`): a band of a ground texture on the land
// side, its outer edge soft, the water crisp against it with a thin darker waterline; deep
// water a dark shade along the bank on the water; and, switched on, a pale shallow line.
// Where it crosses a plateau's cliff, a pale fall across it along the cliff line (`fallLayers`).
//
// A floor with a painted border (`edgePaint`) has its band drawn here too, under the rest:
// a ground texture just inside its own outline, paint only.

import { Container, Graphics } from 'pixi.js';
import type { DungeonLayer } from '../../store/types';
import type { Polygon } from '../../types/geometry';
import { getLayerEntry } from '../sceneGraph';
import { bandFillColor, drawOutlineBand } from '../caveBandRenderer';
import { bandSetArt } from '../../assets/packCatalog';
import { isDeepWater, isTextureMaterial, isWaterMaterial, materialFillId, shoreTextureOf } from '../../assets/materialKit';
import { load, resolveTexture } from '../../assets/textureLoader';
import { fillPolygonsWithHoles, paintTiled } from '../floorWallRenderer';
import { innerBandLayers, outsideBandLayers, paintSoftTiled, softEdgeLayers, type SoftLayer } from '../softEdge';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import { useStore } from '../../store/store';
import { keptToFloors, patchOutline, shoreWidthOf, type MaterialPatch } from '../../shared/materialPatch';
import { borderWidthOf, nestedAlphas, wobbleSeed } from '../../shared/plateauShade';
import type { ShapeChild } from '../../shared/types';
import { edgeRuns, groundHeightOf, hasPlateaus, layerPlateaus } from '../../shared/plateaus';
import { caveEdges, caveOpeningGaps, drawnShapeRings, type CaveEdge } from '../../shared/caveFloor';
import { resolveDoors, resolveWalls, type ResolvedDoor } from '../../shared/wallResolve';
import type { DoorGap } from '../wallNodeRenderer';
import { getAssetPackManager } from '../assetPackInstance';

/** Layers waiting on art to load, so one redraw follows however many textures land. */
const waiting = new Set<string>();
/** Art asked for once already: an id no pack delivers is not asked for again. */
const asked = new Set<string>();

/** Art can land later than one wait: a decode clears `asked` so the next draw asks again. */
let watching = false;
function watchTextures(): void {
  if (watching) return;
  watching = true;
  getAssetPackManager().subscribeTextures(() => asked.clear());
}

function parseColor(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(n) ? 0x808080 : n;
}

/** Each art id the patches (and caves, as bordered patches) need that has not loaded; loads them and redraws the layer once they have. */
function awaitArt(layer: DungeonLayer, patches: readonly (Pick<MaterialPatch, 'material' | 'border'> & Partial<Pick<MaterialPatch, 'shore'>>)[]): void {
  watchTextures();
  const ids = new Set<string>();
  for (const p of patches) {
    const fill = materialFillId(p.material);
    if (fill) ids.add(fill);
    if (p.border && !isTextureMaterial(p.material)) for (const e of bandSetArt(p.material).values()) ids.add(e.id);
    const shore = isWaterMaterial(p.material) ? shoreTextureOf(p.shore) : undefined;
    if (shore) ids.add(shore);
  }
  const missing = [...ids].filter((id) => !asked.has(id) && resolveTexture(id).width <= 1);
  if (missing.length === 0 || waiting.has(layer.id)) return;
  waiting.add(layer.id);
  for (const id of missing) asked.add(id);
  void Promise.all(missing.map((id) => load(id))).then(() => {
    waiting.delete(layer.id);
    const now = useStore.getState().layers.find((l): l is DungeonLayer => l.id === layer.id && l.type === 'dungeon');
    if (now) drawLayerMaterials(now);
  });
}

/** How far a plain texture's edge fades, cells, inside its outline. */
export const SOFT_EDGE = 1 / 3;

/** The steps a plain texture patch with `outline` fades out in: the outline shrunk less and less, out to itself. */
export function softPatchLayers(outline: Polygon[]): SoftLayer[] {
  return softEdgeLayers((d) => (d >= SOFT_EDGE ? outline : clipper2Engine.inflate(outline, d - SOFT_EDGE)), SOFT_EDGE);
}

/**
 * What a layer's plain-texture patches are trimmed to: the union of its floors, so paint
 * laid up to a floor's edge stops at the wall; null on a layer with no floor (untrimmed).
 */
export function patchTrim(layer: Pick<DungeonLayer, 'mergedFloor'>): Polygon[] | null {
  return layer.mergedFloor && layer.mergedFloor.length > 0 ? layer.mergedFloor : null;
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
/** Deep water's bank shade: black this dark at the bank, fading out over this far onto the water, in steps. */
export const BANK_SHADE_ALPHA = 0.35;
export const BANK_SHADE_WIDTH = 0.5;
const BANK_SHADE_STEPS = 6;

/** What a water patch draws round its edge. */
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

/**
 * The edge a patch's water takes; null for a patch that is not water (cave ink, ground). At
 * height 0 (or raised) its shore is as set and only deep water shades its bank; sunk below 0
 * its shore is half as wide again and any water shades its bank, darker the deeper it lies,
 * up to BANK_SHADE_MAX.
 */
export function waterEdgeOf(patch: Pick<MaterialPatch, 'material' | 'shore' | 'shoreWidth' | 'shallowLine' | 'height'>): WaterEdge | null {
  if (!isWaterMaterial(patch.material)) return null;
  const textureId = shoreTextureOf(patch.shore);
  const depth = Math.max(0, -groundHeightOf(patch.height));
  const deep = isDeepWater(patch.material) ? BANK_SHADE_ALPHA : 0;
  return {
    shore: textureId ? { textureId, width: shoreWidthOf(patch.shoreWidth) * (depth > 0 ? SUNK_SHORE_SCALE : 1) } : undefined,
    bankShade: depth > 0 ? Math.min(BANK_SHADE_MAX, Math.max(deep, BANK_SHADE_PER_CELL * depth)) : deep,
    bankWidth: BANK_SHADE_WIDTH,
    shallow: patch.shallowLine === true,
  };
}

/** The steps of the dark shade along a bank, on the water: nested bands in from the outline, darkest at it. */
export function bankShadeLayers(outline: Polygon[], peak: number, width: number): SoftLayer[] {
  return nestedAlphas(peak, BANK_SHADE_STEPS)
    .map((alpha, k) => ({ rings: clipper2Engine.difference(outline, clipper2Engine.inflate(outline, (-width * (k + 1)) / BANK_SHADE_STEPS)), alpha }))
    .filter((l) => l.rings.length > 0);
}

/** A fall: pale water this far either side of a cliff line, at this opacity on the line, in soft steps. */
export const FALL_HALF = 0.3;
const FALL_STEPS = 4;
const FALL = 0xf4fbfa;
const FALL_ALPHA = 0.7;

/**
 * Where water falls: the layer's plateau cliff lines that cross the water (`outline`), grown
 * into a pale band FALL_HALF either side and cut to the water, so the fall is as wide as the
 * water there. Nested steps, palest at the line. None on a layer with no cliff.
 */
export function fallLayers(layer: Pick<DungeonLayer, 'children'>, outline: Polygon[]): SoftLayer[] {
  if (!hasPlateaus(layer)) return [];
  const lines = layerPlateaus(layer)
    .bands.flatMap((b) => edgeRuns(b))
    .filter((r) => r.edge === 'cliff' && r.drop !== 0)
    .map((r) => (r.closed ? [...r.points, r.points[0]] : r.points));
  if (lines.length === 0) return [];
  return nestedAlphas(FALL_ALPHA, FALL_STEPS)
    .map((alpha, k) => ({ rings: clipper2Engine.intersection(clipper2Engine.inflateOpen(lines, (FALL_HALF * (k + 1)) / FALL_STEPS), outline), alpha }))
    .filter((l) => l.rings.length > 0);
}

/** Each ring of `rings` stroked closed. */
function strokeRings(g: Graphics, rings: Polygon[], style: { color: number; width: number; alpha: number }): void {
  for (const r of rings) if (r.length >= 3) g.poly(r.flat(), true).stroke(style);
}

/**
 * The steps of a shore `width` wide round `outline`, less `water` (every water patch on the
 * layer): water meeting water has no bank between the two, whatever each is.
 */
export function shoreLayers(outline: Polygon[], width: number, water: Polygon[]): SoftLayer[] {
  return outsideBandLayers(outline, width, width * SHORE_FADE)
    .map((l) => ({ ...l, rings: clipper2Engine.difference(l.rings, water) }))
    .filter((l) => l.rings.length > 0);
}

/** A water patch's shore band, outside its outline, under its fill. Art not loaded yet draws none (`awaitArt` redraws). */
function drawShore(piece: Container, outline: Polygon[], edge: WaterEdge, water: Polygon[]): boolean {
  if (!edge.shore) return false;
  const tex = resolveTexture(edge.shore.textureId);
  if (tex.width <= 1) return false;
  const band = new Container();
  band.label = 'material-shore';
  paintSoftTiled(band, shoreLayers(outline, edge.shore.width, water), tex);
  piece.addChild(band);
  return true;
}

/** Over a water patch's fill: the bank shade, the shallow line, and with a shore the waterline. */
function drawWaterEdge(piece: Container, outline: Polygon[], edge: WaterEdge, shored: boolean): void {
  if (edge.bankShade > 0) {
    const shade = new Container();
    shade.label = 'material-bank-shade';
    for (const l of bankShadeLayers(outline, edge.bankShade, edge.bankWidth)) {
      const g = new Graphics();
      fillPolygonsWithHoles(g, l.rings, { color: 0x000000 });
      g.alpha = l.alpha;
      shade.addChild(g);
    }
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

/** Draws one patch into `host`. `water` is every water patch's outline on the layer. */
function drawPatch(host: Container, layer: DungeonLayer, patch: MaterialPatch, water: Polygon[]): void {
  const outline = patchOutline(patch);
  if (outline.length === 0) return;
  const piece = new Container();
  piece.label = `material-${patch.id}`;
  const plain = isTextureMaterial(patch.material);
  // Trimmed to the floors, shore and all: it never shows past a wall. Ground is drawn whole,
  // under the floors.
  const trim = keptToFloors(patch) ? patchTrim(layer) : null;
  if (trim) {
    const mask = new Graphics();
    fillPolygonsWithHoles(mask, trim, { color: 0xffffff });
    piece.addChild(mask);
    piece.mask = mask;
  }
  const edge = plain ? waterEdgeOf(patch) : null;
  const shored = edge ? drawShore(piece, outline, edge, water) : false;
  const fillId = materialFillId(patch.material);
  const tex = fillId ? resolveTexture(fillId) : null;
  if (tex && tex.width > 1 && plain && !shored) {
    paintSoftTiled(piece, softPatchLayers(outline), tex);
  } else if (tex && tex.width > 1) {
    // A band set's fill, or water with a shore: crisp against the shore band.
    paintTiled(piece, outline, tex, { scale: 1, holes: true });
  } else {
    // No fill art yet: the floor colour, so the patch still reads as one solid piece.
    const g = new Graphics();
    fillPolygonsWithHoles(g, outline, { color: parseColor(layer.style.floorColor) });
    piece.addChild(g);
  }
  if (edge) drawWaterEdge(piece, outline, edge, shored);
  if (edge) {
    const falls = fallLayers(layer, outline);
    if (falls.length > 0) {
      const fall = new Container();
      fall.label = 'material-fall';
      for (const l of falls) {
        const g = new Graphics();
        fillPolygonsWithHoles(g, l.rings, { color: FALL });
        g.alpha = l.alpha;
        fall.addChild(g);
      }
      piece.addChild(fall);
    }
  }
  if (patch.border && !plain) {
    drawOutlineBand(piece, outline, patch.material, bandFillColor({ floorColor: layer.style.floorColor, textureId: fillId }));
  }
  host.addChild(piece);
}

/**
 * The rock round a layer's painted caves of one material: the same walk a bordered patch
 * gets, laid along the union of the floors marked with it, stopped at the doors on it.
 * The floors' own fill is drawn with the other floors.
 */
function drawCave(host: Container, layer: DungeonLayer, cave: CaveEdge, doors: readonly ResolvedDoor[]): void {
  const piece = new Container();
  piece.label = `cave-${cave.material}`;
  // The rock stops at the doors on it, and wherever it was erased open.
  const gaps = [...caveDoorGaps(cave, doors), ...caveOpeningGaps(cave, layer.caveOpenings)];
  drawOutlineBand(piece, cave.rings, cave.material, bandFillColor({ floorColor: layer.style.floorColor, textureId: materialFillId(cave.material) }), gaps);
  host.addChild(piece);
}

/**
 * Where a cave's rock stops: one gap per door on its wall, a plain opening's among them.
 * Its wall is the walls of kind `cave` in its material (a ring erased open stands as several).
 */
export function caveDoorGaps(cave: CaveEdge, doors: readonly ResolvedDoor[]): DoorGap[] {
  return doors
    .filter((d) => d.wall?.kind === 'cave' && d.wall.textureSetId === cave.material)
    .map((d) => ({ wallId: d.wall!.id, position: d.position, width: d.door.width }));
}

/** The visible floors on a layer with a painted border. */
function paintedFloors(layer: DungeonLayer): ShapeChild[] {
  return layer.children.filter((c): c is ShapeChild => c.childType === 'shape' && c.visible !== false && !!c.edgePaint);
}

/** A floor's painted border: its texture in a band just inside its own outline, ragged and soft on its inner side. Paint only. */
function drawFloorBorder(host: Container, shape: ShapeChild): void {
  const tex = resolveTexture(shape.edgePaint!);
  if (tex.width <= 1) return;
  const piece = new Container();
  piece.label = `floor-border-${shape.id}`;
  paintSoftTiled(piece, innerBandLayers(drawnShapeRings(shape), borderWidthOf(shape.edgePaintWidth), wobbleSeed(shape.id)), tex);
  host.addChild(piece);
}

/** Draws a layer's floors' painted borders, its patches and its painted caves' rock, replacing what was drawn; none clears the sublayer. */
export function drawLayerMaterials(layer: DungeonLayer): void {
  const sublayers = getLayerEntry(layer.id)?.sublayers;
  const host = sublayers?.materials;
  if (!host) return;
  // Ground patches go under the floors, in a sublayer of their own.
  const ground = sublayers.ground;
  for (const child of [...host.removeChildren(), ...ground.removeChildren()]) child.destroy({ children: true });
  const patches = layer.materials ?? [];
  const caves = caveEdges(layer);
  const bordered = paintedFloors(layer);
  if (patches.length === 0 && caves.length === 0 && bordered.length === 0) return;
  awaitArt(layer, [
    ...patches,
    ...caves.map((c) => ({ material: c.material, border: true })),
    // A texture id is its own material: its fill is the border's art.
    ...bordered.map((s) => ({ material: s.edgePaint!, border: false })),
  ]);
  for (const shape of bordered) drawFloorBorder(host, shape);
  if (caves.length > 0) {
    const doors = resolveDoors(layer, resolveWalls(layer)).filter((d) => d.door.visible && !d.detached);
    for (const cave of caves) drawCave(host, layer, cave, doors);
  }
  const waters = patches.filter((p) => isWaterMaterial(p.material));
  const water = waters.length > 1 ? clipper2Engine.union(waters.flatMap((p) => patchOutline(p)), []) : waters.flatMap((p) => patchOutline(p));
  for (const patch of patches) drawPatch(patch.ground ? ground : host, layer, patch, water);
}
