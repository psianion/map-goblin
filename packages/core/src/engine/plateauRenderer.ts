// Raised and sunken floors, drawn (plan §4.3). One container per band, lowest first, in the
// layer's `plateaus` sublayer: over the ground, under the shadows that fall on it. Each band
// is its floor (painted like any floor, lifted 3 % a cell), its slopes as an ink contour ring
// per cell of drop over a flat shade on the faces turned from the sun, its cliffs laid by the
// cave walk with the ledge kit over a foot of rubble walked the same way (void side = low
// side, so a pit's rock faces in), and its openings across the gaps they cut.
//
// The cliff shadows are the shadow pass's (shadowPass.ts); it also re-lights the cliff rock
// here when the sun moves (`shadeCliffs`).

import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { STAIRS_CONTENT } from '../assets/stairsArt';
import type { DungeonLayer, ShapeChild } from '../store/types';
import type { OpeningChild, PathChild } from '../shared/types';
import { pathCentreline } from '../geometry/pathGeometry';
import { setCliffCrossings, type CliffCrossing } from './path/waterfalls';
import type { Polygon } from '../types/geometry';
import {
  cliffCrossings,
  cliffSpansNear,
  pointInPoly,
  edgeRuns,
  hasPlateaus,
  layerPlateaus,
  openingFrame,
  ringGaps,
  tierLift,
  type EdgeRun,
  type PlateauBand,
  type RingGap,
} from '../shared/plateaus';
import { buildEdgeStrips, sampleCentreline } from '../geometry/ribbon';
import { getCatalogEntry, getEntriesByType, type CatalogEntry } from '../assets/packCatalog';
import { resolveTexture } from '../assets/textureLoader';
import type { ShadowLook } from '../shared/shadows';
import { CURVE_STEP, layBandChain, layBandRing, placeBand, textureTone } from './caveBandRenderer';
import { cliffArt, cliffPieces, footUnits } from './plateauKit';
import type { DoorGap } from './wallNodeRenderer';
import { offsetCurve, resampleClosed, type Curve, type WalkPlacement } from './caveWalk';
import { edgeWalk, type EdgeUnit, type UnitPlacement } from './path/pathKitLayout';
import { placePieces, type Piece } from './path/kitUnits';

type Vec = [number, number];

/** Paints one floor shape into a container: the floor renderer's own per-shape fill. */
export type ShapePainter = (parent: Container, shape: ShapeChild) => void;

export interface PlateauRenderOptions {
  /** Ask for a re-bake when a pack texture this draw needed lands later. */
  waitFor?: (textureId: string) => void;
  /** Extra ring gaps beyond the layer's openings and landings. */
  gaps?: readonly RingGap[];
}

const INK = 0x2b2420;
/** The cliff's top-edge line, cells wide. */
const LINE = 0.04;
const TOP_LINE_ALPHA = 0.5;
/**
 * A slope's contour rings: ink lines one per cell of drop, 2 px wide at 1x (PixiRenderEngine
 * INITIAL_ZOOM, 20 px a cell).
 */
export const CONTOUR_LINE = 2 / 20;
const CONTOUR_ALPHA = 0.85;
/**
 * How dark a slope face turned square from the sun is shaded at its foot; the shade steps up
 * ring by ring from the top, so the hill reads light at the top and dark at the foot. A face
 * turned to the sun is not shaded at all.
 */
const SLOPE_SHADE = 0.45;
/** How far past the cliff edge the ledge rock reaches on the low side, cells. */
export const LEDGE_DEPTH = 0.475;
/** How far past the cliff edge the foot's rubble rides, cells, and how far each piece strays either way. */
export const FOOT_OUT = 0.7;
export const FOOT_SPREAD = 0.1;
/** A cliff with no ledge art to lay draws this ink edge instead, so it never reads as missing. */
const FALLBACK_EDGE = 0.12;
/** How far the light on a cliff face reaches across the rock from the edge, cells: the ledge rock's depth. */
const LIGHT_REACH = LEDGE_DEPTH;
/**
 * Lit/shaded faces under a sun: a face turned away from the light keeps SHADE_FLOOR of its
 * brightness, one side-on to it SHADE_SIDE, one square to it all of it. The rock art is dark
 * ink, so the spread is wide enough to read; with no sun (Indoor) every face is drawn as is.
 */
export const SHADE_FLOOR = 0.4;
export const SHADE_SIDE = 0.72;
/**
 * Darkening alone barely moves near-black rock, so a face turned to the sun also takes a warm
 * wash of light added over it, up to this strength square on.
 */
export const LIGHT_WASH = 0.32;
const WASH_COLOR = 0xfff0d0;

// ─── Lighting the rock ─────────────────────────────────────

interface CliffSprite {
  /** A piece of rock, tinted by how its face turns to the light (over its own `base` tint)… */
  sprite?: Sprite;
  base?: number;
  /** A slope face's share of its full shade: deeper toward the foot. */
  weight?: number;
  /** …or the light added over one face of it… */
  light?: Graphics;
  /** …or one face of a slope, shaded as it turns from the light. */
  shade?: Graphics;
  /** Unit normal pointing to the low side. */
  normal: Vec;
}

const cliffSprites = new Map<string, CliffSprite[]>();
const lastLook = new Map<string, ShadowLook | null>();

/** How bright a face turned to `normal` is under `look`: SHADE_FLOOR away from the light, 1 facing it. */
export function faceShade(normal: Vec, look: ShadowLook | null): number {
  if (!look) return 1;
  // The shadow runs along (dx, dy), away from the light; the light is the other way.
  const facing = Math.max(-1, Math.min(1, -(normal[0] * look.dx + normal[1] * look.dy)));
  return facing >= 0 ? SHADE_SIDE + (1 - SHADE_SIDE) * facing : SHADE_SIDE + (SHADE_SIDE - SHADE_FLOOR) * facing;
}

/** How much light is added over a face turned to `normal`: none away from the light or without one. */
export function faceLight(normal: Vec, look: ShadowLook | null): number {
  if (!look) return 0;
  return LIGHT_WASH * Math.max(0, Math.min(1, -(normal[0] * look.dx + normal[1] * look.dy)));
}

const grey = (k: number): number => {
  const c = Math.round(Math.max(0, Math.min(1, k)) * 255);
  return (c << 16) | (c << 8) | c;
};

/** How dark a slope face turned to `normal` is shaded: none facing the light or without one. */
export function slopeShade(normal: Vec, look: ShadowLook | null): number {
  return (SLOPE_SHADE * (1 - faceShade(normal, look))) / (1 - SHADE_FLOOR);
}

/** Re-light one layer's cliff rock and slopes for the sky's current look. Called by the shadow pass. */
export function shadeCliffs(layerId: string, look: ShadowLook | null): void {
  lastLook.set(layerId, look);
  for (const { sprite, base, weight, light, shade, normal } of cliffSprites.get(layerId) ?? []) {
    if (sprite && !sprite.destroyed) sprite.tint = mulColour(base ?? 0xffffff, faceShade(normal, look));
    if (light && !light.destroyed) light.alpha = faceLight(normal, look);
    if (shade && !shade.destroyed) shade.alpha = slopeShade(normal, look) * (weight ?? 1);
  }
}

/** `colour` darkened to `k` of itself. */
function mulColour(colour: number, k: number): number {
  const c = (shift: number) => Math.round(((colour >> shift) & 255) * Math.max(0, Math.min(1, k)));
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

/**
 * The tint that turns art whose mean colour is `unit` the ledge's grey: every channel brought
 * down to one neutral level, the ledge's brightness (`ledge`'s mean) or the art's darkest
 * channel if that is darker (a tint only darkens), so no blue or purple cast of the art's own
 * survives. White (no tint) when either colour is unknown.
 */
export function greyMatch(ledge: number | null, unit: number | null): number {
  if (ledge === null || unit === null) return 0xffffff;
  const ch = (c: number, shift: number) => (c >> shift) & 255;
  const level = 0.299 * ch(ledge, 16) + 0.587 * ch(ledge, 8) + 0.114 * ch(ledge, 0);
  const own = [ch(unit, 16), ch(unit, 8), ch(unit, 0)];
  const target = Math.min(level, ...own);
  const [r, g, b] = own.map((c) => (c <= 0 ? 255 : Math.round(255 * Math.min(1, target / c))));
  return (r << 16) | (g << 8) | b;
}

// ─── Geometry helpers ──────────────────────────────────────

const sharp = (pts: Polygon) => pts.map(([x, y]) => ({ x, y, handles: null }));

function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Fill rings with their holes cut: outers positive, holes negative (the band's winding). */
function fillRings(g: Graphics, rings: Polygon[], style: { color: number; alpha?: number }): void {
  for (const r of rings) {
    if (r.length < 3 || signedArea(r) <= 0) continue;
    g.poly(r.flat()).fill(style);
    const holes = rings.filter((h) => h.length >= 3 && signedArea(h) < 0 && inside(h[0], r));
    if (holes.length === 0) continue;
    for (const h of holes) g.poly(h.flat());
    g.cut();
  }
}

function inside([x, y]: [number, number], poly: Polygon): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The outer edge of an edge strip `width` cells out on `side` of a run, as a polyline. */
function offsetLine(run: EdgeRun, width: number, side: 'left' | 'right'): Polygon {
  if (width <= 0) return run.closed ? [...run.points, run.points[0]] : run.points;
  const strip = buildEdgeStrips(sampleCentreline(sharp(run.points), run.closed, 0), width)[side];
  const out: Polygon = [];
  for (let k = 2; k < strip.positions.length; k += 4) out.push([strip.positions[k], strip.positions[k + 1]]);
  return out;
}

/** Which of the ribbon's strips lies on the low side: outside (its right) for a plateau, inside for a pit. */
const lowSide = (drop: number): 'left' | 'right' => (drop > 0 ? 'right' : 'left');

// ─── The pass ──────────────────────────────────────────────

/**
 * Draw every band of a layer into `parent`, replacing what was there. A flat layer draws
 * nothing and costs one scan of its children.
 */
export function renderPlateaus(
  layer: DungeonLayer,
  parent: Container,
  paint: ShapePainter,
  options: PlateauRenderOptions = {},
): void {
  for (const child of parent.removeChildren()) child.destroy({ children: true });
  cliffSprites.delete(layer.id);
  if (!hasPlateaus(layer)) return;

  const plateaus = layerPlateaus(layer);
  const gaps: DoorGap[] = ringGaps(layer, options.gaps).map((g) => ({ wallId: g.id, position: g.position, width: g.width }));
  const sprites: CliffSprite[] = [];
  for (const band of plateaus.bands) {
    const holder = new Container();
    holder.label = `plateau-band-${band.height}`;
    drawBandFloor(holder, band, paint);
    const runs = edgeRuns(band);
    for (const run of runs) if (run.edge === 'slope') sprites.push(...drawSlope(holder, run));
    for (const run of runs) if (run.edge === 'cliff') sprites.push(...drawCliff(holder, run, gaps, options));
    drawOpenings(holder, layer, band, options);
    parent.addChild(holder);
  }
  cliffSprites.set(layer.id, sprites);
  shadeCliffs(layer.id, lastLook.get(layer.id) ?? null);
}

/** The band's floors, each painted as the ground paints it, lifted by height and clipped to the band. */
function drawBandFloor(parent: Container, band: PlateauBand, paint: ShapePainter): void {
  const floor = new Container();
  floor.label = 'plateau-floor';
  for (const shape of band.shapes) paint(floor, shape);
  const lift = tierLift(band.height);
  if (lift !== 0) {
    const tier = new Graphics();
    fillRings(tier, band.rings, { color: lift > 0 ? 0xffffff : 0x000000, alpha: Math.abs(lift) });
    floor.addChild(tier);
  }
  const mask = new Graphics();
  fillRings(mask, band.rings, { color: 0xffffff });
  floor.addChild(mask);
  floor.mask = mask;
  parent.addChild(floor);
}

/**
 * A slope, `slopeWidth × |drop|` wide on its low side: a flat shade on each face of it, dark
 * as the face turns from the sun (`shadeCliffs`), and an ink contour ring for each cell of
 * drop, the last at the slope's foot.
 */
function drawSlope(parent: Container, run: EdgeRun): CliffSprite[] {
  const per = run.owner?.slopeWidth ?? 1;
  const drop = Math.abs(run.drop);
  const width = per * drop;
  const side = lowSide(run.drop);
  const strip = buildEdgeStrips(sampleCentreline(sharp(run.points), run.closed, 0), width)[side];
  const shade = new Container();
  shade.label = 'plateau-slope';
  const faces: CliffSprite[] = [];
  const cells = Math.max(1, Math.round(drop));
  // Each sample is its inner and outer point; per stretch between two samples, one quad for
  // each ring step across, shaded deeper the further down the slope it lies.
  const p = strip.positions;
  const across = (k: number, t: number): [number, number] => [p[k] + (p[k + 2] - p[k]) * t, p[k + 1] + (p[k + 3] - p[k + 1]) * t];
  for (let k = 0; k + 7 < p.length; k += 4) {
    const nx = (p[k + 2] + p[k + 6] - p[k] - p[k + 4]) / 2;
    const ny = (p[k + 3] + p[k + 7] - p[k + 1] - p[k + 5]) / 2;
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) continue;
    for (let r = 0; r < cells; r++) {
      const t0 = r / cells;
      const t1 = (r + 1) / cells;
      const quad = [...across(k, t0), ...across(k + 4, t0), ...across(k + 4, t1), ...across(k, t1)];
      const g = new Graphics().poly(quad).fill({ color: INK });
      g.alpha = 0;
      shade.addChild(g);
      faces.push({ shade: g, normal: [nx / len, ny / len], weight: (r + 1) / cells });
    }
  }
  parent.addChild(shade);
  if (run.owner?.contourLines === false) return faces;
  const rings = new Container();
  rings.label = 'plateau-contours';
  for (let k = 1; k <= cells; k++) {
    const line = offsetLine(run, (k * width) / cells, side);
    rings.addChild(new Graphics().poly(line.flat(), false).stroke({ color: INK, width: CONTOUR_LINE, alpha: CONTOUR_ALPHA }));
  }
  parent.addChild(rings);
  return faces;
}

/** `pts` pushed `d` cells to the left of travel, each point along its neighbours' normal. */
function offsetOpen(pts: Polygon, d: number): Polygon {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t: Vec = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    return [p[0] + t[1] * d, p[1] - t[0] * d];
  });
}

/**
 * The rubble at a cliff's foot: the foot kit's units walked as edge units (pathKitLayout
 * `edgeWalk`, seeded by `seed`) along the cliff's run pushed FOOT_OUT toward its void (the low
 * side), each straying up to FOOT_SPREAD across it, so the rubble lies scattered just out past
 * the ledge rock. A unit within an opening's or landing's reach is left out, so the foot parts
 * where the rock does.
 */
export function layCliffFoot(
  pts: Polygon,
  closed: boolean,
  gaps: readonly DoorGap[],
  units: readonly EdgeUnit[],
  seed: string,
): UnitPlacement[] {
  if (units.length === 0 || pts.length < 2) return [];
  const line = closed ? (offsetCurve(resampleClosed(pts as Curve, CURVE_STEP), FOOT_OUT) as Polygon) : offsetOpen(pts, FOOT_OUT);
  const laid = edgeWalk([line], units, seed, [], { open: !closed, spread: FOOT_SPREAD });
  return laid.filter((u) => gaps.every((g) => Math.hypot(u.x - g.position[0], u.y - g.position[1]) >= g.width / 2 + FOOT_OUT));
}

/** What a cliff run's foot is seeded by: its floor and where the run starts. */
const footSeed = (run: EdgeRun): string => `foot|${run.owner?.id ?? ''}|${run.points[0]}`;

/** The run's points as the walk takes them: a pit's walked backwards, so its void is on the left. */
const walkPoints = (run: EdgeRun): Polygon => (run.drop > 0 ? run.points : [...run.points].reverse());

/** Every cliff foot unit a layer lays, as drawn: what attached objects keep clear of. */
export function layerFootUnits(layer: DungeonLayer): UnitPlacement[] {
  if (!hasPlateaus(layer)) return [];
  const { units } = footUnits();
  if (units.length === 0) return [];
  const gaps: DoorGap[] = ringGaps(layer).map((g) => ({ wallId: g.id, position: g.position, width: g.width }));
  const out: UnitPlacement[] = [];
  for (const band of layerPlateaus(layer).bands) {
    for (const run of edgeRuns(band)) {
      if (run.edge === 'cliff') out.push(...layCliffFoot(walkPoints(run), run.closed, gaps, units, footSeed(run)));
    }
  }
  return out;
}

/** The unit direction from the nearest point of polyline `line` to (x, y). */
function awayFrom(line: Polygon, x: number, y: number): Vec {
  let best: Vec = [0, 1];
  let bestD = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i];
    const dx = line[i + 1][0] - ax;
    const dy = line[i + 1][1] - ay;
    const len2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const ox = x - ax - dx * u;
    const oy = y - ay - dy * u;
    const d = Math.hypot(ox, oy);
    if (d < bestD && d > 1e-9) {
      bestD = d;
      best = [ox / d, oy / d];
    }
  }
  return best;
}

/** The mean colour of a cliff set's first ledge straight, once its art is in hand. */
function ledgeToneOf(art: Map<string, CatalogEntry>): number | null {
  for (const e of art.values()) if (e.material === 'ledge') return textureTone(e.id);
  return null;
}

/** Which placements `placeBand` will turn into sprites, in the order it adds them. */
function drawnPlacements(placed: WalkPlacement[], art: Map<string, CatalogEntry>): WalkPlacement[] {
  return placed.filter((pl) => {
    const entry = art.get(pl.piece.key);
    return !!entry && resolveTexture(entry.id).width > 1;
  });
}

/** A cliff: the top-edge ink line, then the ledge rock laid by the cave walk with the low side as void. */
function drawCliff(parent: Container, run: EdgeRun, gaps: DoorGap[], options: PlateauRenderOptions): CliffSprite[] {
  // The walk lays rock with the void on its left; band rings run with the outside on the
  // left, which is the low side of a plateau. A pit's low side is inside: walk it backwards.
  const pts = run.drop > 0 ? run.points : [...run.points].reverse();
  const path = run.closed ? [...pts, pts[0]] : pts;

  if (run.owner?.contourLines !== false) {
    const top = new Graphics();
    top.label = 'plateau-top-line';
    top.poly(path.flat(), false).stroke({ color: INK, width: LINE, alpha: TOP_LINE_ALPHA });
    parent.addChild(top);
  }

  const art = cliffArt(run.owner?.edgeArt);
  for (const e of art.values()) if (resolveTexture(e.id).width <= 1) options.waitFor?.(e.id);
  const pieces = cliffPieces(art);

  // The foot first, under the rock: rubble walked out past the ledge on the low side, each
  // unit tinted to the ledge's own grey.
  const sprites: CliffSprite[] = [];
  const foot = footUnits();
  for (const e of foot.entries.values()) if (resolveTexture(e.id).width <= 1) options.waitFor?.(e.id);
  const ledgeTone = ledgeToneOf(art);
  const rubble: Piece[] = [];
  for (const u of layCliffFoot(pts, run.closed, gaps, foot.units, footSeed(run))) {
    const entry = foot.entries.get(u.key);
    if (!entry || resolveTexture(entry.id).width <= 1) continue;
    rubble.push({ entry, x: u.x, y: u.y, rotation: u.rotation, scale: u.scale ?? 1, tint: greyMatch(ledgeTone, textureTone(entry.id)) });
  }
  if (rubble.length > 0) {
    const holder = new Container();
    holder.label = 'plateau-foot';
    placePieces(holder, rubble, 0xffffff, 0);
    // Lit like the rock: by the face of the cliff it lies under.
    rubble.forEach((p, i) => sprites.push({ sprite: holder.children[i] as Sprite, base: p.tint, normal: awayFrom(path, p.x, p.y) }));
    parent.addChild(holder);
  }

  // The whole run, straights and corners alike, is walked with the measured ledge pieces:
  // every stone at its own size, none stretched to fit an edge.
  const rock = new Container();
  rock.label = 'plateau-cliff';
  const placed = pieces.length === 0 ? [] : run.closed ? layBandRing(pts, gaps, pieces) : layBandChain(pts, gaps, pieces);
  const drawn = drawnPlacements(placed, art);
  placeBand(rock, drawn, art, 0xffffff, 0);
  drawn.forEach((pl, i) => {
    const dx = pl.Q[0] - pl.P[0];
    const dy = pl.Q[1] - pl.P[1];
    const len = Math.hypot(dx, dy) || 1;
    sprites.push({ sprite: rock.children[i] as Sprite, normal: [dy / len, -dx / len] });
  });

  if (drawn.length === 0) {
    const ink = new Graphics();
    ink.label = 'plateau-cliff-ink';
    ink.poly(path.flat(), false).stroke({ color: INK, width: FALLBACK_EDGE, alpha: 0.85 });
    parent.addChild(ink);
    rock.destroy();
    return sprites;
  }
  parent.addChild(rock);
  // The light on each face, added over the rock: a quad from the edge out across the ledge.
  const lights = new Container();
  lights.label = 'plateau-cliff-light';
  // Across the rock itself, not the whole ledge strip: the ink chunks fill about its first half.
  const reach = LIGHT_REACH;
  const face = (a: Vec, b: Vec): void => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) return;
    const normal: Vec = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
    const [ox, oy] = [normal[0] * reach, normal[1] * reach];
    const g = new Graphics()
      .poly([a[0], a[1], b[0], b[1], b[0] + ox, b[1] + oy, a[0] + ox, a[1] + oy])
      .fill({ color: WASH_COLOR });
    g.blendMode = 'add';
    g.alpha = 0;
    lights.addChild(g);
    sprites.push({ light: g, normal });
  };
  for (let i = 0; i + 1 < path.length; i++) face(path[i] as Vec, path[i + 1] as Vec);
  parent.addChild(lights);
  return sprites;
}

// ─── Openings ──────────────────────────────────────────────

const stairsCache = new Map<Texture, Texture>();

/** The part of a stairs texture the flight is drawn in (`STAIRS_CONTENT`), as its own texture. */
function stairsContent(entry: CatalogEntry, tex: Texture): Texture {
  const rect = STAIRS_CONTENT[`${entry.material}_${entry.gridSize}`];
  if (!rect) return tex;
  const hit = stairsCache.get(tex);
  if (hit && !hit.destroyed) return hit;
  // The rect is in the art's authored pixels; a texture served at another size scales it.
  const k = tex.width / entry.naturalWidth;
  const f = tex.frame;
  const sub = new Texture({
    source: tex.source,
    frame: new Rectangle(f.x + rect.x * k, f.y + rect.y * k, rect.w * k, rect.h * k),
  });
  stairsCache.set(tex, sub);
  return sub;
}

/** The stairs a new opening shows until one is picked: gg-demo's short stone flight. */
export function defaultStairsArt(): CatalogEntry | undefined {
  const stairs = getEntriesByType('object').filter((e) => e.material.startsWith('stairs_'));
  return stairs.find((e) => e.material === 'stairs_stone_short') ?? stairs[0];
}

/** Every stairs piece the catalogue has, for the opening card's art picker. */
export function stairsArtEntries(): CatalogEntry[] {
  return getEntriesByType('object').filter((e) => e.material.startsWith('stairs_'));
}

function drawOpenings(parent: Container, layer: DungeonLayer, band: PlateauBand, options: PlateauRenderOptions): void {
  const ids = new Set(band.shapes.map((s) => s.id));
  for (const c of layer.children) {
    if (c.childType !== 'opening' || !c.visible || !ids.has(c.shapeId)) continue;
    const frame = openingFrame(layer, c);
    if (!frame) continue;
    const g = drawOpening(c, frame, options);
    if (g) parent.addChild(g);
  }
}

/** How far down an opening reaches, in cells: the drop, at least one cell. */
const reachOf = (drop: number): number => Math.max(1, drop);

/**
 * One opening across its gap, oriented downhill: its top at the ring, its foot on the low
 * side. Stairs show their art (the art's top is the high end); ramps and ladders are drawn
 * placeholders until the forge ships `ramp_*` and `ladder_1x2`.
 */
export function drawOpening(
  opening: Pick<OpeningChild, 'id' | 'kind' | 'width' | 'artId'>,
  frame: { position: Vec; along: Vec; downhill: Vec; drop: number },
  options: PlateauRenderOptions = {},
): Container | null {
  const { position: p, along: a, downhill: d } = frame;
  const half = opening.width / 2;
  const reach = reachOf(frame.drop);
  const lip = 0.15;
  const at = (s: number, t: number): [number, number] => [p[0] + a[0] * s + d[0] * t, p[1] + a[1] * s + d[1] * t];
  const box = (s0: number, s1: number, t0: number, t1: number) => [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)].flat();

  if (opening.kind === 'stairs') {
    const entry = (opening.artId && getCatalogEntry(opening.artId)) || defaultStairsArt();
    const tex = entry ? resolveTexture(entry.id) : null;
    if (entry && tex && tex.width > 1) {
      // Only the flight itself, not the empty frame around it: the frames are untrimmed.
      const art = stairsContent(entry, tex);
      const sprite = new Sprite(art);
      sprite.label = `opening-${opening.id}`;
      sprite.anchor.set(0.5, 0);
      // Across the gap at the opening's width; down the drop at the art's own proportions.
      const length = opening.width * (art.height / art.width);
      sprite.scale.set(opening.width / art.width, length / art.height);
      const top = at(0, -lip);
      sprite.position.set(top[0], top[1]);
      // The art's +y (down the image) runs downhill.
      sprite.rotation = Math.atan2(d[1], d[0]) - Math.PI / 2;
      const holder = new Container();
      holder.label = `opening-${opening.id}`;
      holder.addChild(sprite);
      return holder;
    }
    if (entry) options.waitFor?.(entry.id);
    // No art yet: steps drawn as treads, so the gap still reads as a way down.
    const g = new Graphics();
    g.label = `opening-${opening.id}`;
    g.poly(box(-half, half, -lip, reach)).fill({ color: 0x8a8174 });
    const treads = Math.max(3, Math.round(reach / 0.3));
    for (let k = 1; k < treads; k++) {
      const t = -lip + ((reach + lip) * k) / treads;
      const [x0, y0] = at(-half, t);
      const [x1, y1] = at(half, t);
      g.moveTo(x0, y0).lineTo(x1, y1);
    }
    g.stroke({ color: INK, width: LINE, alpha: 0.7 });
    return g;
  }

  const g = new Graphics();
  g.label = `opening-${opening.id}`;
  if (opening.kind === 'ramp') {
    // A shaded wedge: light at the top, darker toward the foot.
    const bands = 5;
    for (let k = 0; k < bands; k++) {
      const t0 = -lip + ((reach + lip) * k) / bands;
      const t1 = -lip + ((reach + lip) * (k + 1)) / bands;
      g.poly(box(-half, half, t0, t1)).fill({ color: grey(0.72 - 0.08 * k) });
    }
    g.poly(box(-half, half, -lip, reach)).stroke({ color: INK, width: LINE, alpha: 0.7 });
    return g;
  }
  // Ladder: two rails and rungs.
  const rail = Math.min(half - 0.08, 0.35);
  for (const s of [-rail, rail]) {
    const [x0, y0] = at(s, -lip);
    const [x1, y1] = at(s, reach);
    g.moveTo(x0, y0).lineTo(x1, y1);
  }
  for (let t = 0.1; t < reach; t += 0.3) {
    const [x0, y0] = at(-rail, t);
    const [x1, y1] = at(rail, t);
    g.moveTo(x0, y0).lineTo(x1, y1);
  }
  g.stroke({ color: 0x6b4f33, width: 0.07 });
  return g;
}

// ─── Waterfalls ────────────────────────────────────────────

/** The point of a polyline nearest (x, y), as an arc length along it, and its travel direction there. */
function arcOn(xy: readonly Vec[], x: number, y: number): { s: number; dir: Vec } {
  let best = { d: Infinity, s: 0, dir: [1, 0] as Vec };
  let total = 0;
  for (let i = 0; i + 1 < xy.length; i++) {
    const [ax, ay] = xy[i];
    const dx = xy[i + 1][0] - ax;
    const dy = xy[i + 1][1] - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (len * len)));
    const d = Math.hypot(x - ax - dx * u, y - ay - dy * u);
    if (d < best.d) best = { d, s: total + len * u, dir: [dx / len, dy / len] };
    total += len;
  }
  return { s: best.s, dir: best.dir };
}

/**
 * Where a water path meets a drop, as arc-length crossings of its centreline (waterfalls.ts
 * `CliffCrossing`). A river, or any open or unfilled path, falls where its centreline crosses a
 * raised edge (`cliffCrossings`), `down` +1 when it was drawn downhill there and -1 when
 * drawn up it, so the fall always hangs off the low side. A raised pool (a closed, filled
 * path) spills over the stretch of cliff its shore runs along (`cliffSpansNear`), `down` +1
 * when the drop falls out of the pool.
 */
export function plateauCliffCrossings(layer: Pick<DungeonLayer, 'children'>, path: PathChild): CliffCrossing[] {
  if (!hasPlateaus(layer)) return [];
  const line = pathCentreline(path);
  if (line.xy.length < 2) return [];
  const out: CliffCrossing[] = [];
  if (path.closed && path.fill) {
    const ring = line.xy.slice(0, -1) as Polygon;
    const reach = Math.max(...line.width) / 2;
    for (const span of cliffSpansNear(layer, ring, reach)) {
      const mid: Vec = [(span.a[0] + span.b[0]) / 2, (span.a[1] + span.b[1]) / 2];
      const half = Math.hypot(span.b[0] - span.a[0], span.b[1] - span.a[1]) / 2;
      const { s } = arcOn(line.xy, mid[0], mid[1]);
      const outward = !pointInPoly(mid[0] + span.downhill[0] * 0.3, mid[1] + span.downhill[1] * 0.3, ring);
      out.push({ start: s - half, end: s + half, down: outward ? 1 : -1, drop: span.drop });
    }
    return out;
  }
  for (const span of cliffCrossings(layer, line.xy, 1)) {
    const mid: Vec = [(span.a[0] + span.b[0]) / 2, (span.a[1] + span.b[1]) / 2];
    const { s, dir } = arcOn(line.xy, mid[0], mid[1]);
    const down = dir[0] * span.downhill[0] + dir[1] * span.downhill[1] >= 0 ? 1 : -1;
    out.push({ start: s, end: s, down, drop: span.drop });
  }
  return out;
}

// The water paths ask the plateaus where they fall.
setCliffCrossings(plateauCliffCrossings);
