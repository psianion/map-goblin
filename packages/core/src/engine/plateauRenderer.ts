// Plateaus, drawn (plan §4.3), band by band, lowest first, in two of the layer's sublayers.
// The tops (`plateauTops`, over the floor, under the paths) are a translucent lift over
// whatever lies beneath (7 % a cell), so floor texture, terrain paint and floor borders show
// through. The edges (`plateauEdges`, over the paths, under the shadows) are its slopes' side
// faces and its cliffs, laid by the cave walk with the ledge kit, one ledge ring at any drop
// (void side = low side, so a pit's rock faces in).
//
// A slope shows a side face on one side only, the side pointing the way the DM set (the
// plateau's own direction, else the map's; never the sun's), as deep as its drop says
// (`slopeFace`). Its texture, when it has one, is a floor of its own drawn among the ground
// pieces at the plateau's place in their order (floorWallRenderer.ts), so ground painted later
// covers it; here, above every ground piece, the face is darkened in ledge bands, lined at its
// foot and between the bands, and the rim lined heavier on the face side with a pale highlight
// just inside it on the far side (`drawSlopeFaces`).
//
// Under all of it, every edge lays a drop shade on its low side (`drawShade`): a soft dark band
// hugging the edge, wider for a taller drop, so a raised edge reads raised whatever its kind.
// A slope's is kept off its own face.
//
// A cliff whose art is a painted border lays no ledge: a band of its texture on the high side
// of the edge, its inner edge ragged, into the tops under the band's lift (`drawPaintedBorder`),
// and a thin ink edge line along the outline unless switched off.
//
// The drop shade is a faint contact shade only; the shadow pass's one directional shadow per
// plateau is what reads as the drop.
//
// The cliff shadows are the shadow pass's (shadowPass.ts); it also re-lights the cliff rock
// here when the sun moves (`shadeCliffs`).

import { BlurFilter, Container, Graphics, Sprite } from 'pixi.js';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import {
  BORDER_FADE,
  BORDER_WOBBLE,
  DROP_SHADE_ALPHA,
  DROP_SHADE_STEPS,
  FACE_DEPTH_MAX,
  FACE_DEPTH_WANDER,
  FACE_FOOT_ALPHA,
  FACE_FOOT_WIDTH,
  FACE_HIGHLIGHT_ALPHA,
  FACE_HIGHLIGHT_COLOR,
  FACE_HIGHLIGHT_INSET,
  FACE_HIGHLIGHT_WIDTH,
  FACE_INK,
  FACE_LEDGE_ALPHA,
  FACE_LEDGE_WIDTH,
  FACE_RIM_ALPHA,
  FACE_RIM_FAR_ALPHA,
  FACE_RIM_FAR_WIDTH,
  FACE_RIM_STEPS,
  FACE_RIM_WIDTH,
  borderWidthOf,
  blurStrengthFor,
  dropShadeWidth,
  faceBandShades,
  faceDirectionOf,
  faceVector,
  highlightWeight,
  linesOff,
  lowSegments,
  nestedAlphas,
  offsetPath,
  rimWeight,
  slopeFace,
  TOP_SEAM,
  wobbleNoise,
  wobbleRings,
  wobbleSeed,
  type FaceEnds,
  type SlopeFace,
} from '../shared/plateauShade';
import { useStore } from '../store/store';
import type { DungeonLayer } from '../store/types';
import type { Polygon } from '../types/geometry';
import {
  byPrecedence,
  edgeRuns,
  hasPlateaus,
  layerPlateaus,
  precedenceOf,
  plateausOf,
  pointInPoly,
  splitAtCrossings,
  tierLift,
  unionShapes,
  type EdgeRun,
  type PlateauBand,
} from '../shared/plateaus';
import type { PlateauChild } from '../shared/types';
import { isGroundPiece, pieceRings } from '../shared/pieces';
import type { WorldBounds } from '../shared/mapBounds';
import { baseGroundFrame } from './mapFrame';
import { isColoredSet, type CatalogEntry } from '../assets/packCatalog';
import { resolveTexture } from '../assets/textureLoader';
import type { ShadowLook } from '../shared/shadows';
import { layBandChain, layBandRing, placeBand } from './caveBandRenderer';
import { cliffArt, cliffChoice, cliffPieces, isPaintedBorder, ledgeEndPieces, paintedBorderTexture } from './plateauKit';
import { paintSoftTiled, SOFT_EDGE_STEPS, softEdgeLayers, type SoftLayer } from './softEdge';
import { kitOverlap, type WalkPlacement } from './caveWalk';
import { jointsOf, mirrorPiece, placeOnChord, type CaveKitPiece } from '../assets/caveWallKit';

type Vec = [number, number];

export interface PlateauRenderOptions {
  /** Ask for a re-bake when a pack texture this draw needed lands later. */
  waitFor?: (textureId: string) => void;
}

const INK = 0x2b2420;
/** The cliff's top-edge line, cells wide. */
const LINE = 0.04;
const TOP_LINE_ALPHA = 0.5;
/** A cliff with no ledge art to lay draws this ink edge instead, so it never reads as missing. */
const FALLBACK_EDGE = 0.12;
/**
 * Lit/shaded faces under a sun: a face turned away from the light keeps SHADE_FLOOR of its
 * brightness, one side-on to it SHADE_SIDE, one square to it all of it. The ledge is a thin ink
 * line with no rock face, so it takes no wash of light: with no sun (Indoor) it is drawn as is.
 */
export const SHADE_FLOOR = 0.4;
export const SHADE_SIDE = 0.72;

// ─── Lighting the rock ─────────────────────────────────────

interface CliffSprite {
  /** A piece of the ledge, tinted by how its face turns to the light. */
  sprite: Sprite;
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


/** Re-light one layer's cliff rock for the sky's current look. Called by the shadow pass. A slope's face is never re-lit. */
export function shadeCliffs(layerId: string, look: ShadowLook | null): void {
  lastLook.set(layerId, look);
  for (const { sprite, normal } of cliffSprites.get(layerId) ?? []) {
    if (!sprite.destroyed) sprite.tint = mulColour(0xffffff, faceShade(normal, look));
  }
}

/** `colour` darkened to `k` of itself. */
function mulColour(colour: number, k: number): number {
  const c = (shift: number) => Math.round(((colour >> shift) & 255) * Math.max(0, Math.min(1, k)));
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

// ─── Geometry helpers ──────────────────────────────────────

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
  const slopes = layerSlopes(layer);
  const sprites: CliffSprite[] = [];
  for (const band of plateaus.bands) {
    const runs = edgeRuns(band);
    const painted = (run: EdgeRun) => run.edge === 'cliff' && isPaintedBorder(run.owner?.edgeArt);
    for (const run of runs) if (painted(run)) drawPaintedBorder(tops, run, options);
    drawBandTop(tops, band);
    const holder = new Container();
    holder.label = `plateau-band-${band.height}`;
    const faces = slopes.faces.filter((f) => f.run.band === band);
    // The faces of bands drawn over this one show over its edges: its shade stays off them.
    const over = slopes.faces.filter((f) => byPrecedence(f.run.band, band) > 0).flatMap((f) => f.region);
    drawShade(holder, band, runs, faces, slopes.land, over);
    drawSlopeFaces(holder, band, faces, slopes.land);
    for (const run of runs) if (run.edge === 'cliff' && !painted(run)) sprites.push(...drawCliff(holder, run, options));
    // A painted border's Edge line rides on the card's Contour lines switch: on unless set off.
    for (const run of runs) if (painted(run) && run.owner?.contourLines !== false) drawEdgeLine(holder, run);
    edges.addChild(holder);
  }
  cliffSprites.set(layer.id, sprites);
  shadeCliffs(layer.id, lastLook.get(layer.id) ?? null);
}

/**
 * The band's top: a translucent lift tint over whatever is beneath it, nothing else. Only where
 * the surface stands at its level, so each level shows its own tint, never two stacked.
 */
function drawBandTop(parent: Container, band: PlateauBand): void {
  const lift = tierLift(band.height);
  if (lift === 0 || band.surface.length === 0) return;
  const tier = new Graphics();
  tier.label = `plateau-top-${band.height}`;
  fillRings(tier, band.surface, { color: lift > 0 ? 0xffffff : 0x000000, alpha: Math.abs(lift) });
  parent.addChild(tier);
}

/**
 * The steps of a painted border along `run`: the region within `width` of the edge on its high
 * side (on a raised band's surface, outside a pit or a dip), solid on the edge and fading over
 * its inner BORDER_FADE of the width (softEdge.ts).
 */
export function paintedBorderLayers(run: EdgeRun, width: number): SoftLayer[] {
  const line = run.closed ? [...run.points, run.points[0]] : run.points;
  const fade = width * BORDER_FADE;
  // The inner edge wanders (grass creeping over the dirt unevenly), the same way every redraw.
  const noise = wobbleNoise(wobbleSeed(run.owner?.id));
  return softEdgeLayers((d) => {
    const reach = width - fade + d;
    const strip = wobbleRings(clipper2Engine.inflateOpen([line], reach), line, reach, width * BORDER_WOBBLE, noise);
    return run.drop > 0 ? clipper2Engine.intersection(strip, run.band.surface) : clipper2Engine.difference(strip, run.band.rings);
  }, fade);
}

/** A painted border's edge line, cells wide, and how dark its ink is. */
export const EDGE_LINE_WIDTH = 0.05;
export const EDGE_LINE_ALPHA = 0.85;

/** The thin ink line along a painted border's outline (the card's Edge line). */
function drawEdgeLine(parent: Container, run: EdgeRun): void {
  const path = run.closed ? [...run.points, run.points[0]] : run.points;
  const line = new Graphics();
  line.label = 'plateau-edge-line';
  line.poly(path.flat(), false).stroke({ color: INK, width: EDGE_LINE_WIDTH, alpha: EDGE_LINE_ALPHA });
  parent.addChild(line);
}

/** A painted border: its texture tiled in a band on the high side of the edge, crisp on the edge, soft inside. */
function drawPaintedBorder(parent: Container, run: EdgeRun, options: PlateauRenderOptions): void {
  const id = paintedBorderTexture(run.owner?.edgeArt);
  if (!id) return;
  const tex = resolveTexture(id);
  if (tex.width <= 1) {
    options.waitFor?.(id);
    return;
  }
  const border = new Container();
  border.label = 'plateau-border';
  paintSoftTiled(border, paintedBorderLayers(run, borderWidthOf(run.owner?.borderWidth)), tex);
  parent.addChild(border);
}

const boxRing = (b: { minX: number; minY: number; maxX: number; maxY: number }): Polygon => [
  [b.minX, b.minY],
  [b.maxX, b.minY],
  [b.maxX, b.maxY],
  [b.minX, b.maxY],
];

/**
 * The ground a layer's shade and slope faces may land on, as plateauGround.ts reasons about
 * what a plateau may stand on: its walled floors' union, its ground pieces, the base ground
 * over the map's frame, and any painted terrain. Empty = nothing known: everywhere.
 */
function groundOf(layer: DungeonLayer, base: WorldBounds | null): Polygon[] {
  const ground: Polygon[] = [];
  for (const ring of layer.mergedFloor ?? []) if (ring.length >= 3) ground.push(ring);
  for (const c of layer.children) {
    // A patch kept to the floors shows only on them, which are ground already.
    if (!isGroundPiece(c) || c.keptToFloors || c.visible === false) continue;
    const [outer, ...holes] = pieceRings(c);
    if (!outer || outer.length < 3) continue;
    // Outer wound positive and holes negative, so a hole stays out under the non-zero rule.
    ground.push(signedArea(outer) >= 0 ? outer : [...outer].reverse());
    for (const h of holes) if (h.length >= 3) ground.push(signedArea(h) < 0 ? h : [...h].reverse());
  }
  if (base) ground.push(boxRing(base));
  const t = useStore.getState().mapSettings.terrain?.bounds;
  if (t) ground.push(boxRing(t));
  return ground;
}

// ─── Slope faces ───────────────────────────────────────────

/** One slope run's face, as it lands. */
export interface SlopeFaceRun {
  run: EdgeRun;
  /** The unit vector its face points along. */
  v: Vec;
  /** Its face before it is cut to where it may land: the lines are drawn off this. */
  face: SlopeFace;
  /**
   * The face and its ledge bands, rim to foot, cut to where they may land (`land`) and off the
   * faces of higher bands (`over`).
   */
  region: Polygon[];
  bands: Polygon[][];
  /** The faces of the bands drawn over this one's: what shows over it, so nothing of it is drawn there. */
  over: Polygon[];
}

/** Where what an edge throws may land, per band and the side it drops to: outside it (`outward`) or inside a pit. */
export type LandOf = (band: PlateauBand, outward: boolean) => Polygon[];

/** A layer's slope faces, and where an edge's shade and face may land. */
export interface LayerSlopes {
  faces: SlopeFaceRun[];
  land: LandOf;
}

const slopeMemo = new WeakMap<readonly unknown[], { floor: unknown; terrain: unknown; base: string; dir: unknown; value: LayerSlopes }>();

/**
 * Every slope run's face on the layer, with its direction (its plateau's, else the map's), cut
 * to where the drop shade may land: the run's low side, on ground, never on a band as high or
 * higher. Kept while the layer's children, its ground and the map's direction stay the same:
 * the floors, the edges, the shadows and the brush all ask.
 */
export function layerSlopes(layer: DungeonLayer): LayerSlopes {
  const map = useStore.getState().mapSettings;
  const terrain = map.terrain?.bounds ?? null;
  const base = hasPlateaus(layer) ? baseGroundFrame(layer) : null;
  const baseKey = base ? `${base.minX},${base.minY},${base.maxX},${base.maxY}` : '';
  const hit = slopeMemo.get(layer.children);
  if (hit && hit.floor === layer.mergedFloor && hit.terrain === terrain && hit.base === baseKey && hit.dir === map.faceDirection) return hit.value;

  const { bands } = layerPlateaus(layer);
  const ground = groundOf(layer, base);
  let groundUnion: Polygon[] | null = null;
  const lands = new Map<PlateauBand, Map<boolean, Polygon[]>>();
  const land: LandOf = (band, outward) => {
    let sides = lands.get(band);
    if (!sides) lands.set(band, (sides = new Map()));
    const known = sides.get(outward);
    if (known) return known;
    const low = lowRegion(band, bands, outward, SHADE_REACH + FACE_DEPTH_MAX * (1 + FACE_DEPTH_WANDER));
    groundUnion ??= ground.length > 0 ? clipper2Engine.union(ground, []) : null;
    const region = groundUnion ? clipper2Engine.intersection(low, groundUnion) : low;
    sides.set(outward, region);
    return region;
  };

  const faces: SlopeFaceRun[] = [];
  for (const band of bands) {
    for (const run of edgeRuns(band)) {
      if (run.edge !== 'slope' || run.drop === 0) continue;
      const deg = faceDirectionOf(run.owner, map.faceDirection);
      // Wandering and stepped by its plateau's id, so it is the same rock on every redraw; each
      // stretch as deep as its own drop, eased into the rim at the ends where the face stops.
      const ends = run.closed ? undefined : faceEnds(band, run, map.faceDirection);
      const face = slopeFace(run.points, run.closed, run.drop > 0, band.rings, deg, run.drops, wobbleSeed(run.owner?.id), ends);
      if (face.region.length === 0) continue;
      const where = land(band, run.drop > 0);
      const cut = (rings: Polygon[]) => (rings.length === 0 ? [] : clipper2Engine.intersection(rings, where));
      faces.push({ run, v: faceVector(deg), face, region: cut(face.region), bands: face.bands.map(cut), over: [] });
    }
  }
  // One order for every face, the bands' own: where a later band's face lies over an earlier
  // one's, the later shows whole, tile, bands and lines, and nothing of the earlier shows through it.
  const landed = faces.map((f) => f.region);
  for (const f of faces) {
    const over = faces.flatMap((g, i) => (byPrecedence(g.run.band, f.run.band) > 0 ? landed[i] : []));
    if (over.length === 0) continue;
    const off = (rings: Polygon[]) => (rings.length === 0 ? [] : clipper2Engine.difference(rings, over));
    f.over = over;
    f.region = off(f.region);
    f.bands = f.bands.map(off);
  }
  const value: LayerSlopes = { faces, land };
  slopeMemo.set(layer.children, { floor: layer.mergedFloor, terrain, base: baseKey, dir: map.faceDirection, value });
  return value;
}

/**
 * Which ends of an open slope run its face eases into the rim at. Not where the ring goes on
 * under or against a higher plateau (the next edge has no drop: the face runs on under it), nor
 * where it goes on as another slope whose edge there faces its own direction too (two plateaus
 * of one height with different settings: no notch between them).
 */
function faceEnds(band: PlateauBand, run: EdgeRun, mapDirection: number | undefined): FaceEnds {
  const ring = band.rings[run.ring];
  const edges = band.edges[run.ring];
  const n = ring.length;
  const goesOn = (index: number): boolean => {
    const i = ((index % n) + n) % n;
    const e = edges[i];
    if (e.drop === 0) return true;
    if (e.edge !== 'slope' || !e.owner) return false;
    const seg = lowSegments([ring[i], ring[(i + 1) % n]], false, e.drop > 0)[0];
    if (!seg) return false;
    const v = faceVector(faceDirectionOf(e.owner, mapDirection));
    return seg.n[0] * v[0] + seg.n[1] * v[1] > 1e-6;
  };
  return { start: !goesOn(run.start - 1), end: !goesOn(run.start + run.points.length - 1) };
}

interface TopMemo {
  slopes: LayerSlopes;
  value: Map<PlateauChild, Polygon[]>;
  /** Per plateau, what of higher bands shows over its top. */
  above: Map<PlateauChild, Polygon[]>;
  /** Worked out on the first ask (`plateauTopFills`). */
  fills?: Map<PlateauChild, TopFill>;
}

const topMemo = new WeakMap<readonly unknown[], TopMemo>();

/**
 * The order the tops and faces of a layer's plateaus are drawn in, by plateau: precedence
 * (`byPrecedence`: the more deeply nested, then the higher), then the layer's own order. The
 * later of two overlapping tops wins.
 */
export function plateauDrawOrder(layer: DungeonLayer): Map<PlateauChild, number> {
  const { infos } = layerPlateaus(layer);
  const rank = (p: PlateauChild) => precedenceOf(infos.get(p.id) ?? { chain: [], height: 0 });
  const listed = plateausOf(layer);
  const sorted = listed.map((p, i) => ({ p, i })).sort((a, b) => byPrecedence(rank(a.p), rank(b.p)) || a.i - b.i);
  return new Map(sorted.map(({ p }, k) => [p, k]));
}

/**
 * The tops of every plateau with a top texture, by plateau, in draw order: its own outline
 * (holes kept) less the outlines of textured plateaus of another level that win over it
 * (`byPrecedence`) and the faces of plateaus that win over it, which show over it. What the
 * grid and the Material brush take as its top; the floors draw its texture over
 * `plateauTopFills`, which grows and fades it at seams with tops of its own level. A plateau
 * with a Ground top draws none, so a textured top under it shows through.
 */
export function plateauTopTiles(layer: DungeonLayer): Map<PlateauChild, Polygon[]> {
  const out = new Map<PlateauChild, Polygon[]>();
  if (!hasPlateaus(layer)) return out;
  const { infos } = layerPlateaus(layer);
  const order = plateauDrawOrder(layer);
  const textured = plateausOf(layer)
    .filter((p) => p.topArt && (infos.get(p.id)?.chain.length ?? 0) > 0)
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  if (textured.length === 0) return out;
  const slopes = layerSlopes(layer);
  const hit = topMemo.get(layer.children);
  if (hit && hit.slopes === slopes) return hit.value;
  const rankOf = (p: PlateauChild) => precedenceOf(infos.get(p.id)!);
  const aboveOf = new Map<PlateauChild, Polygon[]>();
  for (const p of textured) {
    const mine = rankOf(p);
    // Tops of its own level are its band's: they meet in a seam (`plateauTopFills`), not a cut.
    const above = [
      ...textured.filter((q) => rankOf(q).height !== mine.height && byPrecedence(rankOf(q), mine) > 0).flatMap((q) => unionShapes([q])),
      ...slopes.faces
        .filter((f) => byPrecedence(f.run.owner && infos.has(f.run.owner.id) ? rankOf(f.run.owner) : f.run.band, mine) > 0)
        .flatMap((f) => f.region),
    ];
    const own = unionShapes([p]);
    const rings = above.length > 0 && own.length > 0 ? clipper2Engine.difference(own, above) : own;
    if (rings.length > 0) out.set(p, rings);
    aboveOf.set(p, above);
  }
  topMemo.set(layer.children, { slopes, value: out, above: aboveOf });
  return out;
}

// ─── Seams between tops of one height ──────────────────────

/** A textured top as the floors draw it. */
export interface TopFill {
  /** Its top (`plateauTopTiles`), grown TOP_SEAM under each later textured top of its band across a seam. */
  rings: Polygon[];
  /** The steps it is painted in when it fades in from a seam; null paints `rings` crisp. */
  soft: SoftLayer[] | null;
  /** The stretches of its outline it fades in from: open lines, in its own outline's order. */
  fades: Polygon[];
  /** The stretches of its outline it grows across, under a later textured top. */
  grows: Polygon[];
}

/** A point this near a line lies on it, cells: Clipper keeps two decimals. */
const SEAM_ON = 0.02;
/** How far across a seam is looked at to tell what lies there, cells. */
const SEAM_PROBE = 0.05;

/** Inside a set of rings by even-odd: holes count as outside. */
function inRegion(rings: readonly Polygon[], p: Vec): boolean {
  let n = 0;
  for (const r of rings) if (r.length >= 3 && pointInPoly(p[0], p[1], r)) n++;
  return n % 2 === 1;
}

/** How near `p` comes to the closed `rings`. */
function ringsDistance(rings: readonly Polygon[], p: Vec): number {
  let best = Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i++) best = Math.min(best, segDist(p, r[i] as Vec, r[(i + 1) % r.length] as Vec));
  return best;
}

/** `ring` with every one of `points` that lies inside one of its edges added there, in order along it. */
function splitAtPoints(ring: Polygon, points: readonly [number, number][]): Polygon {
  const out: Polygon = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Vec;
    const b = ring[(i + 1) % ring.length] as Vec;
    out.push(a);
    const ab = vsub(b, a);
    const l2 = ab[0] * ab[0] + ab[1] * ab[1];
    if (l2 < 1e-12) continue;
    const len = Math.sqrt(l2);
    const ts: number[] = [];
    for (const p of points) {
      const t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2;
      if (t * len <= SEAM_ON || (1 - t) * len <= SEAM_ON) continue;
      if (segDist(p as Vec, a, b) <= SEAM_ON / 4) ts.push(t);
    }
    ts.sort((p, q) => p - q);
    for (const t of ts) out.push(vadd(a, vmul(ab, t)));
  }
  return out;
}

/**
 * The seams of plateau `p`'s top: the parts of its own outline inside its band's union, off the
 * band's rings, where another plateau of its level meets it. Each stretch is told by what lies
 * just across it: a plateau later in the draw order (`plateauDrawOrder`) with a top texture of
 * its own (`grows`: `p` runs on under it), else anything (`fades`: `p` fades in from it).
 */
function topSeams(p: PlateauChild, band: PlateauBand, placeOf: Map<unknown, number>): { fades: Polygon[]; grows: Polygon[] } {
  const fades: Polygon[] = [];
  const grows: Polygon[] = [];
  const own = unionShapes([p]);
  const others = band.shapes.filter((q) => q !== p).map((q) => ({ q, rings: unionShapes([q]) }));
  const otherRings = others.flatMap((o) => o.rings);
  const corners = otherRings.flat() as [number, number][];
  const at = placeOf.get(p) ?? -1;
  for (const outline of own) {
    if (outline.length < 3) continue;
    const ring = splitAtPoints(splitAtCrossings(outline, otherRings), corners);
    const n = ring.length;
    const kinds = ring.map((pt, i): 'rim' | 'fade' | 'grow' => {
      const a = pt as Vec;
      const b = ring[(i + 1) % n] as Vec;
      const len = vdist(a, b);
      if (len < 1e-9) return 'rim';
      const mid = vmul(vadd(a, b), 0.5);
      if (ringsDistance(band.rings, mid) <= SEAM_ON) return 'rim';
      const nrm: Vec = [(-(b[1] - a[1]) / len) * SEAM_PROBE, ((b[0] - a[0]) / len) * SEAM_PROBE];
      const left = vadd(mid, nrm);
      const right = vsub(mid, nrm);
      const inLeft = inRegion(own, left);
      if (inLeft === inRegion(own, right)) return 'rim';
      const across = inLeft ? right : left;
      const later = others.some((o) => (placeOf.get(o.q) ?? -1) > at && !!o.q.topArt && inRegion(o.rings, across));
      return later ? 'grow' : 'fade';
    });
    // Consecutive edges of one kind as one open line, so a wobble runs on along the stretch.
    let start = kinds.findIndex((k, i) => k !== kinds[(i - 1 + n) % n]);
    const closed = start < 0;
    if (closed) start = 0;
    let line: Polygon | null = null;
    let kind: 'rim' | 'fade' | 'grow' = 'rim';
    const flush = () => {
      if (line && kind !== 'rim') (kind === 'grow' ? grows : fades).push(line);
      line = null;
    };
    for (let k = start; k < start + n; k++) {
      const i = k % n;
      if (line && kinds[i] !== kind) flush();
      if (!line) {
        line = [ring[i]];
        kind = kinds[i];
      }
      line.push(ring[(i + 1) % n]);
    }
    flush();
  }
  return { fades, grows };
}

/**
 * The steps a top fades in from its seams in: nothing on the seam, full TOP_SEAM inside it, the
 * full edge wandering as a painted border's inner edge does, the same way every time for `seed`.
 * The rest of the top's outline stays crisp.
 */
function seamFadeLayers(region: Polygon[], seams: Polygon[], seed: number): SoftLayer[] {
  const noise = wobbleNoise(seed);
  return softEdgeLayers((d) => {
    // The k-th step stops (steps - k - 1)/steps of the seam's width short of it: the last starts one step in.
    const reach = TOP_SEAM - d + TOP_SEAM / SOFT_EDGE_STEPS;
    const strips = seams.flatMap((line) => wobbleRings(clipper2Engine.inflateOpen([line], reach), line, reach, reach * BORDER_WOBBLE, noise));
    return strips.length > 0 ? clipper2Engine.difference(region, strips) : region;
  }, TOP_SEAM);
}

/**
 * Every textured top as the floors draw it, by plateau: where it meets another plateau of its
 * height the two feather into each other instead of meeting in a hard edge (`topSeams`): the
 * later one in the order fades in over TOP_SEAM, the earlier runs on TOP_SEAM under it so it has
 * that texture to fade onto, and a top against a Ground top fades in from nothing. The band's
 * outer rim and the cut by higher bands stay crisp. A top that meets none is its tile as is.
 * Kept with the tops.
 */
export function plateauTopFills(layer: DungeonLayer): Map<PlateauChild, TopFill> {
  const tops = plateauTopTiles(layer);
  const memo = topMemo.get(layer.children);
  if (tops.size === 0 || !memo || memo.value !== tops) return new Map([...tops].map(([p, rings]) => [p, { rings, soft: null, fades: [], grows: [] }]));
  if (memo.fills) return memo.fills;
  const { bands } = layerPlateaus(layer);
  const placeOf: Map<unknown, number> = plateauDrawOrder(layer);
  const fills = new Map<PlateauChild, TopFill>();
  for (const [p, rings] of tops) {
    const band = bands.find((b) => b.shapes.includes(p));
    const seams = band && band.shapes.length > 1 ? topSeams(p, band, placeOf) : { fades: [], grows: [] };
    let drawn = rings;
    if (band && seams.grows.length > 0) {
      const under = clipper2Engine.intersection(clipper2Engine.inflateOpen(seams.grows, TOP_SEAM), band.rings);
      const above = memo.above.get(p) ?? [];
      const grown = clipper2Engine.union(rings, under);
      drawn = above.length > 0 ? clipper2Engine.difference(grown, above) : grown;
    }
    const soft = seams.fades.length > 0 ? seamFadeLayers(drawn, seams.fades, wobbleSeed(p.id)) : null;
    fills.set(p, { rings: drawn, soft, ...seams });
  }
  memo.fills = fills;
  return fills;
}

/**
 * The faces of every slope plateau with a face texture, by plateau, as they land, in the bands'
 * draw order: what the floors draw its tile over.
 */
export function slopeFaceTiles(layer: DungeonLayer): Map<PlateauChild, Polygon[]> {
  const out = new Map<PlateauChild, Polygon[]>();
  if (!hasPlateaus(layer)) return out;
  const faces = [...layerSlopes(layer).faces].sort((a, b) => byPrecedence(a.run.band, b.run.band));
  for (const { run, region } of faces) {
    const owner = run.owner;
    if (!owner?.faceArt || region.length === 0) continue;
    out.set(owner, [...(out.get(owner) ?? []), ...region]);
  }
  return out;
}

/**
 * The faces of one band, above every ground piece: each ledge band shaded by its step
 * (`faceBandShades`: over a face tile its upper band lifted and its lowest darkened, over
 * plain ground darkening only), the foot lined and, with the plateau's Ledge lines on, a finer
 * line between the bands, both kept to where the face may land; then the rim along the outline,
 * heavier where the edge faces the face direction, and a pale highlight just inside it on the
 * far side.
 */
function drawSlopeFaces(parent: Container, band: PlateauBand, faces: SlopeFaceRun[], land: LandOf): void {
  if (faces.length === 0) return;
  const shade = new Graphics();
  shade.label = 'plateau-slope-face';
  // The lift is added over what is there, so the tile's own streaks stay as they are, lighter.
  const lift = new Graphics();
  lift.label = 'plateau-slope-lift';
  lift.blendMode = 'add';
  for (const { run, bands } of faces) {
    const shades = faceBandShades(bands.length, !!run.owner?.faceArt);
    bands.forEach((rings, k) => {
      const s = shades[k];
      if (s) fillRings(s.add ? lift : shade, rings, { color: s.color, alpha: s.alpha });
    });
  }
  parent.addChild(shade);
  if (lift.context.instructions.length > 0) parent.addChild(lift);
  else lift.destroy();

  for (const outward of [true, false]) {
    const mine = faces.filter((f) => f.run.drop > 0 === outward);
    if (mine.length === 0) continue;
    const lines = new Graphics();
    lines.label = 'plateau-slope-lines';
    for (const { run, face } of mine) {
      for (const foot of linesOff(face.region, band.rings)) lines.poly(foot.flat(), false).stroke({ color: FACE_INK, width: FACE_FOOT_WIDTH, alpha: FACE_FOOT_ALPHA, join: 'round', cap: 'round' });
      if (run.owner?.contourLines === false) continue;
      for (const step of face.steps.slice(0, -1)) {
        for (const ledge of linesOff(step, [...band.rings, ...face.region])) {
          lines.poly(ledge.flat(), false).stroke({ color: FACE_INK, width: FACE_LEDGE_WIDTH, alpha: FACE_LEDGE_ALPHA, join: 'round', cap: 'round' });
        }
      }
    }
    // Kept to where the face may land, and off the faces of higher bands.
    const over = faces[0].over;
    const mask = new Graphics();
    mask.label = 'plateau-slope-mask';
    fillRings(mask, over.length > 0 ? clipper2Engine.difference(land(band, outward), over) : land(band, outward), { color: 0xffffff });
    const clip = new Container();
    clip.label = 'plateau-slope-foot';
    clip.addChild(lines, mask);
    clip.mask = mask;
    parent.addChild(clip);
  }

  const rim = new Graphics();
  rim.label = 'plateau-slope-rim';
  for (const { run, v } of faces) drawRim(rim, run, v);
  const over = faces[0].over;
  if (over.length === 0) {
    parent.addChild(rim);
    return;
  }
  // The rim stays off a higher band's face too.
  const mask = new Graphics();
  mask.label = 'plateau-slope-rim-mask';
  fillRings(mask, clipper2Engine.difference(lowRegion(band, [], true, 1), over), { color: 0xffffff });
  const clip = new Container();
  clip.label = 'plateau-slope-rim-clip';
  clip.addChild(rim, mask);
  clip.mask = mask;
  parent.addChild(clip);
}

/** A run's segments in stretches of one level (0 to FACE_RIM_STEPS - 1), as open polylines; a closed run's first and last stretch join. */
function stretchesByLevel(run: EdgeRun, lowLeft: boolean, levelOf: (n: Vec) => number): { level: number; line: Polygon }[] {
  const segs = lowSegments(run.points, run.closed, lowLeft);
  const out: { level: number; line: Polygon }[] = [];
  for (const { a, b, n } of segs) {
    const level = levelOf(n);
    const last = out[out.length - 1];
    if (last && last.level === level && last.line[last.line.length - 1] === a) last.line.push(b);
    else out.push({ level, line: [a, b] });
  }
  if (run.closed && out.length > 1 && out[0].level === out[out.length - 1].level) {
    const tail = out.pop()!;
    out[0].line = [...tail.line, ...out[0].line.slice(1)];
  }
  return out;
}

/** The rim line and the far side's highlight along one slope run. */
function drawRim(g: Graphics, run: EdgeRun, v: Vec): void {
  const lowLeft = run.drop > 0;
  const top = FACE_RIM_STEPS - 1;
  const facing = (n: Vec) => n[0] * v[0] + n[1] * v[1];
  for (const { level, line } of stretchesByLevel(run, lowLeft, (n) => Math.round(rimWeight(facing(n)) * top))) {
    const w = level / top;
    g.poly(line.flat(), false).stroke({
      color: FACE_INK,
      width: FACE_RIM_FAR_WIDTH + (FACE_RIM_WIDTH - FACE_RIM_FAR_WIDTH) * w,
      alpha: FACE_RIM_FAR_ALPHA + (FACE_RIM_ALPHA - FACE_RIM_FAR_ALPHA) * w,
      join: 'round',
      cap: 'round',
    });
  }
  for (const { level, line } of stretchesByLevel(run, lowLeft, (n) => Math.round(highlightWeight(facing(n)) * top))) {
    if (level === 0) continue;
    // Pushed up onto the top, its own width clear of the rim line.
    const lifted = offsetPath(line, false, !lowLeft, FACE_HIGHLIGHT_INSET + FACE_HIGHLIGHT_WIDTH / 2);
    g.poly(lifted.flat(), false).stroke({ color: FACE_HIGHLIGHT_COLOR, width: FACE_HIGHLIGHT_WIDTH, alpha: (FACE_HIGHLIGHT_ALPHA * level) / top, cap: 'round', join: 'round' });
  }
}

// ─── The shade below an edge ───────────────────────────────

/** How far the shade's blur fades an edge, cells: from 90 % to 10 % of its darkness. */
export const SHADE_FADE = 0.2;
/** How far past a band's outline the outside it shades on is looked for, beyond the deepest face, cells. */
const SHADE_REACH = 2;

/**
 * The rings of the side of `band` its edges drop to: outside it (`outward`) or, for the rim of a
 * pit or a dip, inside it; either way only where the surface stands lower than the band (each
 * band's `surface`), so a pit or a dip dug into a higher plateau keeps its own floor.
 */
function lowRegion(band: PlateauBand, bands: readonly PlateauBand[], outward: boolean, reach: number): Polygon[] {
  if (!outward) {
    const above = bands.filter((b) => b.height > band.height).flatMap((b) => b.surface);
    return above.length > 0 ? clipper2Engine.difference(band.rings, above) : band.rings;
  }
  const xs = band.rings.flatMap((r) => r.map((p) => p[0]));
  const ys = band.rings.flatMap((r) => r.map((p) => p[1]));
  const [x0, y0, x1, y1] = [Math.min(...xs) - reach, Math.min(...ys) - reach, Math.max(...xs) + reach, Math.max(...ys) + reach];
  const high = bands.filter((b) => b.height >= band.height).flatMap((b) => b.surface);
  return clipper2Engine.difference([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], high);
}

/**
 * The drop shade below one run: DROP_SHADE_STEPS nested bands of distance from its line, out
 * to `dropShadeWidth`, stacking to DROP_SHADE_ALPHA black at the line and fading out in even
 * steps.
 */
function dropShade(g: Graphics, run: EdgeRun): void {
  const line = run.closed ? [...run.points, run.points[0]] : run.points;
  const width = dropShadeWidth(run.drop);
  nestedAlphas(DROP_SHADE_ALPHA, DROP_SHADE_STEPS).forEach((alpha, i) => {
    fillRings(g, clipper2Engine.inflateOpen([line], (width * (i + 1)) / DROP_SHADE_STEPS), { color: 0x000000, alpha });
  });
}

/**
 * The shade a band lays under its edges, per side it drops to: the drop shade along each
 * edge, blurred, then cut by a mask of that side and of the ground there is (`land`), less the
 * band's slope faces there and the faces of higher bands (`over`), so it is as dark at the edge
 * as the shade says, never spills up onto the band, never lands on void and stays off a face.
 */
function drawShade(parent: Container, band: PlateauBand, runs: EdgeRun[], faces: SlopeFaceRun[], land: LandOf, over: Polygon[]): void {
  for (const outward of [true, false]) {
    // A run dropping to a band below shades it from above; one rising to a band it merely meets
    // is that band's to shade, so only the rim of a pit or a dip (rising to the ground or to the
    // plateau it is dug into, `dug`) shades its own band.
    const mine = runs.filter((r) => r.drop !== 0 && r.drop > 0 === outward && (r.drop > 0 || r.dug));
    if (mine.length === 0) continue;
    const onFaces = [...faces.filter((f) => f.run.drop > 0 === outward).flatMap((f) => f.region), ...over];
    const region = onFaces.length > 0 ? clipper2Engine.difference(land(band, outward), onFaces) : land(band, outward);
    if (region.length === 0) continue;
    const g = new Graphics();
    g.label = 'plateau-drop-shade';
    for (const run of mine) dropShade(g, run);
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
  }
}

/** Which placements `placeBand` will turn into sprites, in the order it adds them. */
function drawnPlacements(placed: WalkPlacement[], art: Map<string, CatalogEntry>): WalkPlacement[] {
  return placed.filter((pl) => {
    const entry = art.get(pl.piece.key);
    return !!entry && resolveTexture(entry.id).width > 1;
  });
}

// ─── Ledge ends ────────────────────────────────────────────

/** A piece whose end lies further than this from the chord of the one before it starts a new run, cells. */
const RUN_BREAK = 0.5;
/** Two pieces in a row turning more than this at their joint meet at a sharp tip, degrees. */
const TIP_TURN_DEG = 100;

/** A small random stream seeded from a point, so a redraw lays the same art. */
function rng(seed: Vec): () => number {
  let h = (Math.imul(Math.round(seed[0] * 100), 73856093) ^ Math.imul(Math.round(seed[1] * 100), 19349663)) >>> 0 || 1;
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 4294967296;
  };
}

const vsub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const vadd = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const vmul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
const vdist = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Distance from `p` to the segment a–b. */
const segDist = (p: Vec, a: Vec, b: Vec): number => {
  const ab = vsub(b, a);
  const l2 = ab[0] * ab[0] + ab[1] * ab[1];
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
  return vdist(p, vadd(a, vmul(ab, t)));
};

/**
 * A laid piece's two joints in world units, and its direction of travel at each: its chord
 * turned back by half its turn at the first joint and on by half at the second, as an arc does.
 */
function jointFrame(pl: WalkPlacement): { joints: [Vec, Vec]; tangents: [Vec, Vec] } {
  const joints = jointsOf(pl.piece, pl.at);
  const a = Math.atan2(joints[1][1] - joints[0][1], joints[1][0] - joints[0][0]);
  const h = (pl.piece.turnDeg * Math.PI) / 360;
  return { joints, tangents: [[Math.cos(a - h), Math.sin(a - h)], [Math.cos(a + h), Math.sin(a + h)]] };
}

/**
 * The laid ledge split into runs where two pieces in a row do not meet (the end of an open
 * edge). A ring with no break is one closed run.
 */
function ledgeRuns(placed: WalkPlacement[], closed: boolean): { run: WalkPlacement[]; open: boolean }[] {
  if (placed.length === 0) return [];
  const frames = new Map(placed.map((pl) => [pl, jointFrame(pl)]));
  const near = (p: Vec, pl: WalkPlacement): boolean => segDist(p, ...frames.get(pl)!.joints) <= RUN_BREAK;
  // Two pieces meet where either one's end lies on (or near) the other's chord: a straight
  // centred on a short side laps the bends either end by far more than its joint.
  // Two pieces turning sharper than any bend at their joint are the two runs a sharp tip is
  // laid as, crossing there (caveBandRenderer's layTipRun): each ends on its own end piece,
  // which carries the line on to the tip.
  const sharp = (a: WalkPlacement, b: WalkPlacement): boolean => {
    const ta = frames.get(a)!.tangents[1];
    const tb = frames.get(b)!.tangents[0];
    return ta[0] * tb[0] + ta[1] * tb[1] < Math.cos((TIP_TURN_DEG * Math.PI) / 180);
  };
  const meets = (a: WalkPlacement, b: WalkPlacement): boolean => !sharp(a, b) && (near(b.P, a) || near(a.Q, b));
  const runs: WalkPlacement[][] = [[placed[0]]];
  for (let k = 1; k < placed.length; k++) {
    if (meets(placed[k - 1], placed[k])) runs[runs.length - 1].push(placed[k]);
    else runs.push([placed[k]]);
  }
  if (closed && meets(placed[placed.length - 1], placed[0])) {
    if (runs.length === 1) return [{ run: runs[0], open: false }];
    runs[0] = [...runs.pop()!, ...runs[0]];
  }
  return runs.map((run) => ({ run, open: true }));
}

const laidAt = (piece: CaveKitPiece, A: Vec, B: Vec, branch: string): WalkPlacement => ({
  piece,
  P: A,
  Q: B,
  i: 0,
  nudge: 0,
  branch,
  at: placeOnChord(piece, A, B),
});

/**
 * An open run's two tips: one end piece (picked per run) lapping each tip's last piece by the
 * kit's overlap and running on along the line's direction there. At the head it is mirrored
 * along its length, so it runs back off the line with the same side to the low side.
 */
function runEnds(run: WalkPlacement[], ends: CaveKitPiece[]): WalkPlacement[] {
  if (ends.length === 0) return [];
  const lap = kitOverlap(ends);
  const end = ends[Math.floor(rng(run[0].P)() * ends.length)];
  const c = end.chordCells;
  const head = jointFrame(run[0]);
  const tail = jointFrame(run[run.length - 1]);
  const [x0, th] = [head.joints[0], head.tangents[0]];
  const [x1, tt] = [tail.joints[1], tail.tangents[1]];
  const a1 = vsub(x1, vmul(tt, lap));
  return [
    laidAt(mirrorPiece(end), vsub(x0, vmul(th, c - lap)), vadd(x0, vmul(th, lap)), 'end'),
    laidAt(end, a1, vadd(a1, vmul(tt, c)), 'end'),
  ];
}

/** The low-side normal of a placement: the left of its chord. */
const lowNormal = (pl: WalkPlacement): Vec => {
  const dx = pl.Q[0] - pl.P[0];
  const dy = pl.Q[1] - pl.P[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dy / len, -dx / len];
};

/**
 * A cliff: the top-edge ink line, then the ledge line laid by the cave walk with the low side as
 * void (straights, bends either way, an end piece at each tip of an open run).
 */
function drawCliff(parent: Container, run: EdgeRun, options: PlateauRenderOptions): CliffSprite[] {
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
  const pieces = cliffPieces(art, run.owner?.edgeArt);
  const sprites: CliffSprite[] = [];

  // The whole run, straights and corners alike, is walked with the measured ledge pieces:
  // every piece at its own size, none stretched to fit an edge. One ring of it at any drop.
  const rock = new Container();
  rock.label = 'plateau-cliff';
  const placed = pieces.length === 0 ? [] : run.closed ? layBandRing(pts, [], pieces) : layBandChain(pts, [], pieces);
  const walked = drawnPlacements(placed, art);
  const runs = ledgeRuns(walked, run.closed);
  const ends = ledgeEndPieces(art, run.owner?.edgeArt);
  const drawn = [...walked, ...drawnPlacements(runs.filter((r) => r.open).flatMap((r) => runEnds(r.run, ends)), art)];
  placeBand(rock, drawn, art, 0xffffff, 0);
  // Art that carries its own light and colour is not shaded: the sun would multiply it dark.
  if (!isColoredSet(cliffChoice(run.owner?.edgeArt).setId)) {
    drawn.forEach((pl, i) => sprites.push({ sprite: rock.children[i] as Sprite, normal: lowNormal(pl) }));
  }

  if (drawn.length === 0) {
    const ink = new Graphics();
    ink.label = 'plateau-cliff-ink';
    ink.poly(path.flat(), false).stroke({ color: INK, width: FALLBACK_EDGE, alpha: 0.85 });
    parent.addChild(ink);
    rock.destroy();
    return sprites;
  }
  parent.addChild(rock);
  return sprites;
}
