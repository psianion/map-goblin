// Plateaus, drawn (plan §4.3), band by band, lowest first, in two of the layer's sublayers.
// The tops (`plateauTops`, over the floor, under the paths) are a translucent lift over
// whatever lies beneath (7 % a cell), so floor texture, terrain paint and floor borders show
// through. The edges (`plateauEdges`, over the paths, under the shadows) are its slopes as a
// smooth ramp of shade, dark at the foot, with a thin ink contour per cell of drop, its
// cliffs laid by the cave walk with the ledge kit, one ledge ring at any drop (void side = low
// side, so a pit's rock faces in), and its openings across the gaps they cut: a road
// runs under the ledge except where a landing or an opening opens it.
//
// Under all of it, every edge lays a drop shade on its low side (`drawShade`): a soft dark band
// hugging the edge, wider for a taller drop, so a raised edge reads raised whatever its kind.
//
// The cliff shadows are the shadow pass's (shadowPass.ts); it also re-lights the cliff rock
// here when the sun moves (`shadeCliffs`).

import { BlurFilter, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import {
  DROP_SHADE_ALPHA,
  DROP_SHADE_STEPS,
  SLOPE_CONTOUR_ALPHA,
  SLOPE_CONTOUR_WIDTH,
  SLOPE_STEPS,
  blurStrengthFor,
  contourOffsets,
  dropShadeWidth,
  nestedAlphas,
  slopeBandAlpha,
  slopeSunFactor,
} from '../shared/plateauShade';
import { STAIRS_CONTENT } from '../assets/stairsArt';
import type { DungeonLayer } from '../store/types';
import type { OpeningChild } from '../shared/types';
import type { Polygon } from '../types/geometry';
import {
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
import { buildEdgeStrips, sampleCentreline } from '../geometry/edgeStrips';
import { getCatalogEntry, getEntriesByType, type CatalogEntry } from '../assets/packCatalog';
import { resolveTexture } from '../assets/textureLoader';
import type { ShadowLook } from '../shared/shadows';
import { layBandChain, layBandRing, placeBand } from './caveBandRenderer';
import { cliffArt, cliffPieces } from './plateauKit';
import type { DoorGap } from './wallNodeRenderer';
import type { WalkPlacement } from './caveWalk';

type Vec = [number, number];

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
/** How far past the cliff edge the ledge rock reaches on the low side, cells. */
export const LEDGE_DEPTH = 0.475;
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
  /** A piece of rock, tinted by how its face turns to the light… */
  sprite?: Sprite;
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

/** Re-light one layer's cliff rock and slopes for the sky's current look. Called by the shadow pass. */
export function shadeCliffs(layerId: string, look: ShadowLook | null): void {
  lastLook.set(layerId, look);
  for (const { sprite, light, shade, normal } of cliffSprites.get(layerId) ?? []) {
    if (sprite && !sprite.destroyed) sprite.tint = mulColour(0xffffff, faceShade(normal, look));
    if (light && !light.destroyed) light.alpha = faceLight(normal, look);
    if (shade && !shade.destroyed) shade.alpha = slopeSunFactor(normal, look);
  }
}

/** `colour` darkened to `k` of itself. */
function mulColour(colour: number, k: number): number {
  const c = (shift: number) => Math.round(((colour >> shift) & 255) * Math.max(0, Math.min(1, k)));
  return (c(16) << 16) | (c(8) << 8) | c(0);
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

/** Which of the edge strips lies on the low side: outside (its right) for a plateau, inside for a pit. */
const lowSide = (drop: number): 'left' | 'right' => (drop > 0 ? 'right' : 'left');

// ─── The pass ──────────────────────────────────────────────

/**
 * Draw every band of a layer, its top into `tops` and its edges into `edges`, replacing what
 * was there. A flat layer draws nothing and costs one scan of its children.
 */
export function renderPlateaus(
  layer: DungeonLayer,
  tops: Container,
  edges: Container,
  options: PlateauRenderOptions = {},
): void {
  for (const child of tops.removeChildren()) child.destroy({ children: true });
  for (const child of edges.removeChildren()) child.destroy({ children: true });
  cliffSprites.delete(layer.id);
  if (!hasPlateaus(layer)) return;

  const plateaus = layerPlateaus(layer);
  const gaps: DoorGap[] = ringGaps(layer, options.gaps).map((g) => ({ wallId: g.id, position: g.position, width: g.width }));
  const sprites: CliffSprite[] = [];
  for (const band of plateaus.bands) {
    drawBandTop(tops, band);
    const holder = new Container();
    holder.label = `plateau-band-${band.height}`;
    const runs = edgeRuns(band);
    const soft = drawShade(holder, band, runs, plateaus.bands);
    for (const run of runs) if (run.edge === 'slope') sprites.push(...drawSlope(soft.get(run.drop > 0) ?? holder, holder, run));
    for (const run of runs) if (run.edge === 'cliff') sprites.push(...drawCliff(holder, run, gaps, options));
    drawOpenings(holder, layer, band, options);
    edges.addChild(holder);
  }
  cliffSprites.set(layer.id, sprites);
  shadeCliffs(layer.id, lastLook.get(layer.id) ?? null);
}

/** The band's top: a translucent lift tint over whatever is beneath it, nothing else. */
function drawBandTop(parent: Container, band: PlateauBand): void {
  const lift = tierLift(band.height);
  if (lift === 0) return;
  const tier = new Graphics();
  tier.label = `plateau-top-${band.height}`;
  fillRings(tier, band.rings, { color: lift > 0 ? 0xffffff : 0x000000, alpha: Math.abs(lift) });
  parent.addChild(tier);
}

/**
 * A slope, `slopeWidth × |drop|` wide on its low side: a graded shade from none at its top to
 * SLOPE_FOOT_SHADE black at its foot, laid in SLOPE_STEPS bands into `shade` (the band's
 * blurred shade holder), each face of it lighter as it turns to the sun (`shadeCliffs`); and
 * over it in `parent` one thin ink contour a cell of drop, evenly spaced, the last at the foot.
 */
function drawSlope(shade: Container, parent: Container, run: EdgeRun): CliffSprite[] {
  const per = run.owner?.slopeWidth ?? 1;
  const width = per * Math.abs(run.drop);
  const side = lowSide(run.drop);
  const strip = buildEdgeStrips(sampleCentreline(sharp(run.points), run.closed, 0), width)[side];
  const ramp = new Container();
  ramp.label = 'plateau-slope';
  const faces: CliffSprite[] = [];
  // Each sample is its inner and outer point; per stretch between two samples, one face of
  // SLOPE_STEPS quads across, each shaded a step deeper toward the foot.
  const p = strip.positions;
  const across = (k: number, t: number): [number, number] => [p[k] + (p[k + 2] - p[k]) * t, p[k + 1] + (p[k + 3] - p[k + 1]) * t];
  for (let k = 0; k + 7 < p.length; k += 4) {
    const nx = (p[k + 2] + p[k + 6] - p[k] - p[k + 4]) / 2;
    const ny = (p[k + 3] + p[k + 7] - p[k + 1] - p[k + 5]) / 2;
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) continue;
    const g = new Graphics();
    for (let r = 0; r < SLOPE_STEPS; r++) {
      const t0 = r / SLOPE_STEPS;
      const t1 = (r + 1) / SLOPE_STEPS;
      g.poly([...across(k, t0), ...across(k + 4, t0), ...across(k + 4, t1), ...across(k, t1)]).fill({
        color: 0x000000,
        alpha: slopeBandAlpha(r),
      });
    }
    ramp.addChild(g);
    faces.push({ shade: g, normal: [nx / len, ny / len] });
  }
  shade.addChild(ramp);
  if (run.owner?.contourLines === false) return faces;
  const rings = new Container();
  rings.label = 'plateau-contours';
  for (const d of contourOffsets(run.drop, width)) {
    const line = offsetLine(run, d, side);
    rings.addChild(new Graphics().poly(line.flat(), false).stroke({ color: INK, width: SLOPE_CONTOUR_WIDTH, alpha: SLOPE_CONTOUR_ALPHA }));
  }
  parent.addChild(rings);
  return faces;
}

// ─── The shade below an edge ───────────────────────────────

/** How far the shade's blur fades an edge, cells: from 90 % to 10 % of its darkness. */
export const SHADE_FADE = 0.2;
/** How far past a band's outline the outside it shades on is looked for, cells. */
const SHADE_REACH = 2;

/** The rings of the side of `band` its edges drop to: outside it (`outward`) or, for a pit's rim, inside it. */
function lowRegion(band: PlateauBand, bands: readonly PlateauBand[], outward: boolean, reach: number): Polygon[] {
  if (!outward) {
    const above = bands.filter((b) => b.height > band.height).flatMap((b) => b.rings);
    return above.length > 0 ? clipper2Engine.difference(band.rings, above) : band.rings;
  }
  const xs = band.rings.flatMap((r) => r.map((p) => p[0]));
  const ys = band.rings.flatMap((r) => r.map((p) => p[1]));
  const [x0, y0, x1, y1] = [Math.min(...xs) - reach, Math.min(...ys) - reach, Math.max(...xs) + reach, Math.max(...ys) + reach];
  const high = bands.filter((b) => b.height >= band.height).flatMap((b) => b.rings);
  return clipper2Engine.difference([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], high);
}

/**
 * The drop shade below one run: DROP_SHADE_STEPS nested bands of distance from its line,
 * `from` cells out (a slope's foot) to `dropShadeWidth` past that, stacking to
 * DROP_SHADE_ALPHA black at the line and fading out in even steps.
 */
function dropShade(g: Graphics, run: EdgeRun, from: number): void {
  const line = run.closed ? [...run.points, run.points[0]] : run.points;
  const width = dropShadeWidth(run.drop);
  const near = from > 0 ? clipper2Engine.inflateOpen([line], from) : [];
  nestedAlphas(DROP_SHADE_ALPHA, DROP_SHADE_STEPS).forEach((alpha, i) => {
    const out = clipper2Engine.inflateOpen([line], from + (width * (i + 1)) / DROP_SHADE_STEPS);
    fillRings(g, near.length > 0 ? clipper2Engine.difference(out, near) : out, { color: 0x000000, alpha });
  });
}

/**
 * The shade a band lays under its rock, per side it drops to: the drop shade along each edge
 * (from a slope's foot), blurred, then cut by a mask of that side, so it is as dark at the edge
 * as the shade says and never spills up onto the band. Returns the blurred holder of each side.
 */
function drawShade(parent: Container, band: PlateauBand, runs: EdgeRun[], bands: readonly PlateauBand[]): Map<boolean, Container> {
  const soft = new Map<boolean, Container>();
  for (const outward of [true, false]) {
    // A run dropping to a band below shades it from above; one rising to a band above is that
    // band's to shade, so only a run rising to the ground (a pit's rim) shades its own band.
    const mine = runs.filter((r) => r.drop !== 0 && r.drop > 0 === outward && (r.drop > 0 || Math.abs(band.height - r.drop) < 1e-9));
    if (mine.length === 0) continue;
    const slopeOf = (r: EdgeRun) => (r.edge === 'slope' ? (r.owner?.slopeWidth ?? 1) * Math.abs(r.drop) : 0);
    const reach = SHADE_REACH + Math.max(...mine.map((r) => slopeOf(r) + dropShadeWidth(r.drop)));
    const region = lowRegion(band, bands, outward, reach);
    if (region.length === 0) continue;
    const g = new Graphics();
    g.label = 'plateau-drop-shade';
    for (const run of mine) dropShade(g, run, slopeOf(run));
    const blur = new BlurFilter({ strength: 1, quality: 3, kernelSize: 5 });
    blur.resolution = 1;
    const held = new Container();
    held.label = 'plateau-shade-soft';
    held.filters = [blur];
    held.addChild(g);
    const mask = new Graphics();
    mask.label = 'plateau-shade-mask';
    fillRings(mask, region, { color: 0xffffff });
    const clip = new Container();
    clip.label = 'plateau-shade';
    clip.addChild(held, mask);
    clip.mask = mask;
    // The blur is in screen pixels: kept at SHADE_FADE cells at whatever the zoom is.
    clip.onRender = () => {
      const m = held.worldTransform;
      blur.strength = blurStrengthFor(SHADE_FADE, Math.hypot(m.a, m.b) || 1);
    };
    parent.addChild(clip);
    soft.set(outward, held);
  }
  return soft;
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
  const sprites: CliffSprite[] = [];

  // The whole run, straights and corners alike, is walked with the measured ledge pieces:
  // every stone at its own size, none stretched to fit an edge. One ring of it at any drop.
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
    if (c.childType !== 'opening' || !c.visible || !ids.has(c.hostId)) continue;
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
