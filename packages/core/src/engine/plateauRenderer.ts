// Raised and sunken floors, drawn (plan §4.3). One container per band, lowest first, in the
// layer's `plateaus` sublayer: over the ground, under the shadows that fall on it. Each band
// is its floor (painted like any floor, lifted 3 % a cell), its slopes as a ribbon running
// downhill with a contour line per cell, its cliffs laid by the cave walk with the ledge kit
// (void side = low side, so a pit's rock faces in), and its openings across the gaps they cut.
//
// The cliff shadows are the shadow pass's (shadowPass.ts); it also re-lights the cliff rock
// here when the sun moves (`shadeCliffs`).

import { BufferImageSource, Container, Graphics, MeshSimple, Sprite, Texture } from 'pixi.js';
import type { DungeonLayer, ShapeChild } from '../store/types';
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
  type FallSpan,
  type PlateauBand,
  type RingGap,
} from '../shared/plateaus';
import { buildEdgeStrips, sampleCentreline, type RibbonMesh } from '../geometry/ribbon';
import { getCatalogEntry, getEntriesByType, type CatalogEntry } from '../assets/packCatalog';
import { resolveTexture } from '../assets/textureLoader';
import type { ShadowLook } from '../shared/shadows';
import { layBandChain, layBandRing, placeBand } from './caveBandRenderer';
import { cliffArt, cliffPieces } from './plateauKit';
import { dashSpine, type DoorGap } from './wallNodeRenderer';
import type { WalkPlacement } from './caveWalk';

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
/** Contour and top-edge lines, cells wide. */
const LINE = 0.04;
const CONTOUR_ALPHA = 0.35;
const TOP_LINE_ALPHA = 0.5;
/** A cliff with no ledge art to lay draws this ink edge instead, so it never reads as missing. */
const FALLBACK_EDGE = 0.12;
/** Lit/shaded faces: a face turned away from the light keeps this much brightness. */
export const SHADE_FLOOR = 0.75;

// ─── Lighting the rock ─────────────────────────────────────

interface CliffSprite {
  sprite: Sprite;
  /** Unit normal pointing to the low side. */
  normal: Vec;
}

const cliffSprites = new Map<string, CliffSprite[]>();
const lastLook = new Map<string, ShadowLook | null>();

/** How bright a face turned to `normal` is under `look`: 0.75 away from the light, 1 facing it. */
export function faceShade(normal: Vec, look: ShadowLook | null): number {
  if (!look) return 1;
  // The shadow runs along (dx, dy), away from the light; the light is the other way.
  const facing = -(normal[0] * look.dx + normal[1] * look.dy);
  return SHADE_FLOOR + (1 - SHADE_FLOOR) * Math.max(0, facing);
}

const grey = (k: number): number => {
  const c = Math.round(Math.max(0, Math.min(1, k)) * 255);
  return (c << 16) | (c << 8) | c;
};

/** Re-light one layer's cliff rock for the sky's current look. Called by the shadow pass. */
export function shadeCliffs(layerId: string, look: ShadowLook | null): void {
  lastLook.set(layerId, look);
  for (const { sprite, normal } of cliffSprites.get(layerId) ?? []) {
    if (!sprite.destroyed) sprite.tint = grey(faceShade(normal, look));
  }
}

// ─── Placeholder strips ────────────────────────────────────

/**
 * A strip texture painted in code: `rgba(v)` gives the colour at V (0 at the ring, 1 at the
 * far edge). Placeholders until the forge's cliff kit ships its `slope_2x1` and waterfall art.
 */
function stripTexture(rgba: (v: number) => [number, number, number, number]): Texture {
  const W = 4;
  const H = 64;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const [r, g, b, a] = rgba(y / (H - 1));
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Premultiplied, as the source declares.
      data[i] = Math.round(r * a);
      data[i + 1] = Math.round(g * a);
      data[i + 2] = Math.round(b * a);
      data[i + 3] = Math.round(a * 255);
    }
  }
  return new Texture({ source: new BufferImageSource({ resource: data, width: W, height: H, alphaMode: 'premultiplied-alpha' }) });
}

let slopeTex: Texture | null = null;
/** Placeholder slope: dark at the top of the slope, gone by its foot. */
function slopeTexture(): Texture {
  if (!slopeTex || slopeTex.destroyed) slopeTex = stripTexture((v) => [42, 36, 31, 0.5 * (1 - v) ** 1.4]);
  return slopeTex;
}

let fallTex: Texture | null = null;
/** Placeholder waterfall: white foam at the lip, blue below, fading at the foot. */
function fallTexture(): Texture {
  if (!fallTex || fallTex.destroyed) {
    fallTex = stripTexture((v) => [235 - 120 * v, 245 - 80 * v, 255, 0.9 * (1 - v ** 3)]);
  }
  return fallTex;
}

function meshOf(mesh: RibbonMesh, texture: Texture): MeshSimple | null {
  if (mesh.positions.length === 0 || mesh.indices.length === 0) return null;
  return new MeshSimple({ texture, vertices: mesh.positions, uvs: mesh.uvs, indices: Uint32Array.from(mesh.indices) });
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
    for (const run of runs) if (run.edge === 'slope') drawSlope(holder, run);
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

/** A slope: a ribbon `slopeWidth × |drop|` wide on the low side, and its contour lines. */
function drawSlope(parent: Container, run: EdgeRun): void {
  const per = run.owner?.slopeWidth ?? 1;
  const cells = Math.abs(run.drop);
  const width = per * cells;
  const side = lowSide(run.drop);
  const line = sampleCentreline(sharp(run.points), run.closed, 0);
  const mesh = meshOf(buildEdgeStrips(line, width)[side], slopeTexture());
  if (mesh) {
    mesh.label = 'plateau-slope';
    parent.addChild(mesh);
  }
  if (run.owner?.contourLines === false) return;
  const g = new Graphics();
  g.label = 'plateau-contours';
  for (let k = 0; k < cells; k++) dashSpine(g, offsetLine(run, k * per, side), 0.25, 0.15);
  g.stroke({ color: INK, width: LINE, alpha: CONTOUR_ALPHA });
  parent.addChild(g);
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
  const placed = pieces.length === 0 ? [] : run.closed ? layBandRing(pts, gaps, pieces) : layBandChain(pts, gaps, pieces);
  const drawn = drawnPlacements(placed, art);
  if (drawn.length === 0) {
    const ink = new Graphics();
    ink.label = 'plateau-cliff-ink';
    ink.poly(path.flat(), false).stroke({ color: INK, width: FALLBACK_EDGE, alpha: 0.85 });
    parent.addChild(ink);
    return [];
  }
  const rock = new Container();
  rock.label = 'plateau-cliff';
  placeBand(rock, drawn, art, 0xffffff, 0);
  parent.addChild(rock);
  return drawn.map((pl, i) => {
    const dx = pl.Q[0] - pl.P[0];
    const dy = pl.Q[1] - pl.P[1];
    const len = Math.hypot(dx, dy) || 1;
    return { sprite: rock.children[i] as Sprite, normal: [dy / len, -dx / len] as Vec };
  });
}

// ─── Openings ──────────────────────────────────────────────

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
      const sprite = new Sprite(tex);
      sprite.label = `opening-${opening.id}`;
      sprite.anchor.set(0.5, 0);
      const length = opening.width * (entry.naturalHeight / entry.naturalWidth);
      sprite.scale.set(opening.width / tex.width, length / tex.height);
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

/**
 * A waterfall over a raised edge: a strip from the lip `a`→`b` down `downhill`, as long as the
 * drop (at least a cell). Water paths call this at `cliffCrossings`, raised pools at
 * `cliffSpansNear` (shared/plateaus.ts). Placeholder art: a white-to-blue gradient.
 */
export function drawWaterfall(parent: Container, span: FallSpan): MeshSimple | null {
  const reach = reachOf(span.drop);
  const [ax, ay] = span.a;
  const [bx, by] = span.b;
  const [dx, dy] = span.downhill;
  const vertices = new Float32Array([ax, ay, bx, by, ax + dx * reach, ay + dy * reach, bx + dx * reach, by + dy * reach]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const mesh = new MeshSimple({ texture: fallTexture(), vertices, uvs, indices: new Uint32Array([0, 1, 2, 1, 3, 2]) });
  mesh.label = 'waterfall';
  parent.addChild(mesh);
  return mesh;
}
