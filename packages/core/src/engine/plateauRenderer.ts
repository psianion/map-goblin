// Plateaus, drawn (plan §4.3), band by band, lowest first, in two of the layer's sublayers.
// The tops (`plateauTops`, over the floor, under the paths) are a translucent lift over
// whatever lies beneath (7 % a cell), so floor texture, terrain paint and floor borders show
// through. The edges (`plateauEdges`, over the paths, under the shadows) are its slopes as a
// band outside the outline, a smooth ramp of shade dark at its outer edge with a thin ink
// contour per cell of drop inside it, its
// cliffs laid by the cave walk with the ledge kit, one ledge ring at any drop (void side = low
// side, so a pit's rock faces in).
//
// Under all of it, every edge lays a drop shade on its low side (`drawShade`): a soft dark band
// hugging the edge, wider for a taller drop, so a raised edge reads raised whatever its kind.
//
// The cliff shadows are the shadow pass's (shadowPass.ts); it also re-lights the cliff rock
// here when the sun moves (`shadeCliffs`).

import { BlurFilter, Container, Graphics, Sprite } from 'pixi.js';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import {
  DROP_SHADE_ALPHA,
  DROP_SHADE_STEPS,
  SLOPE_CONTOUR_ALPHA,
  SLOPE_CONTOUR_WIDTH,
  blurStrengthFor,
  contourOffsets,
  dropShadeWidth,
  nestedAlphas,
  offsetPath,
  slopeBandAlpha,
  slopeRamp,
  slopeSunFactor,
  slopeWidthOf,
} from '../shared/plateauShade';
import { useStore } from '../store/store';
import type { DungeonLayer } from '../store/types';
import type { Polygon } from '../types/geometry';
import {
  edgeRuns,
  hasPlateaus,
  layerPlateaus,
  tierLift,
  type EdgeRun,
  type PlateauBand,
} from '../shared/plateaus';
import type { CatalogEntry } from '../assets/packCatalog';
import { resolveTexture } from '../assets/textureLoader';
import type { ShadowLook } from '../shared/shadows';
import { layBandChain, layBandRing, placeBand } from './caveBandRenderer';
import {
  cliffArt,
  cliffPieces,
  contourArt,
  contourPieces,
  ledgeEndPieces,
} from './plateauKit';
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
  /** A piece of the ledge, tinted by how its face turns to the light… */
  sprite?: Sprite;
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


/** Re-light one layer's cliff rock and slopes for the sky's current look. Called by the shadow pass. */
export function shadeCliffs(layerId: string, look: ShadowLook | null): void {
  lastLook.set(layerId, look);
  for (const { sprite, shade, normal } of cliffSprites.get(layerId) ?? []) {
    if (sprite && !sprite.destroyed) sprite.tint = mulColour(0xffffff, faceShade(normal, look));
    if (shade && !shade.destroyed) shade.alpha = slopeSunFactor(normal, look);
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
  const sprites: CliffSprite[] = [];
  const ground = groundOf(layer);
  for (const band of plateaus.bands) {
    drawBandTop(tops, band);
    const holder = new Container();
    holder.label = `plateau-band-${band.height}`;
    const runs = edgeRuns(band);
    const soft = drawShade(holder, band, runs, plateaus.bands, ground);
    for (const run of runs) if (run.edge === 'slope') sprites.push(...drawSlope(soft.get(run.drop > 0) ?? holder, holder, run, options));
    for (const run of runs) if (run.edge === 'cliff') sprites.push(...drawCliff(holder, run, options));
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
 * A slope: a band `slopeWidthOf` the card's slope width wide on its low side, outside the
 * outline only. Its shade runs from none at the outline to SLOPE_FOOT_SHADE black at the band's
 * outer edge in SLOPE_STEPS steps, laid into `shade` (the band's blurred, masked holder), each
 * face lighter as it turns to the sun (`shadeCliffs`); over it in `parent`, one ink contour a
 * cell of drop, evenly spaced inside the band, rounded where the outline turns out. Each contour
 * is the set's contour pieces walked round its ring like the ledge (low side on the left, where
 * the pieces carry their ticks), or a thin stroke while there is no contour art.
 */
function drawSlope(shade: Container, parent: Container, run: EdgeRun, options: PlateauRenderOptions): CliffSprite[] {
  const width = slopeWidthOf(run.owner?.slopeWidth);
  const lowLeft = run.drop > 0;
  const ramp = new Container();
  ramp.label = 'plateau-slope';
  const faces: CliffSprite[] = [];
  for (const face of slopeRamp(run.points, run.closed, lowLeft, width)) {
    const g = new Graphics();
    face.bands.forEach((band, k) => g.poly(band.flat()).fill({ color: 0x000000, alpha: slopeBandAlpha(k) }));
    ramp.addChild(g);
    faces.push({ shade: g, normal: face.normal });
  }
  shade.addChild(ramp);
  if (run.owner?.contourLines === false) return faces;
  const art = contourArt(run.owner?.edgeArt);
  for (const e of art.values()) if (resolveTexture(e.id).width <= 1) options.waitFor?.(e.id);
  const pieces = contourPieces(art);
  const rings = new Container();
  rings.label = 'plateau-contours';
  for (const d of contourOffsets(run.drop, width)) {
    const line = offsetPath(run.points, run.closed, lowLeft, d);
    if (run.closed && line.length > 1 && vdist(line[0] as Vec, line[line.length - 1] as Vec) < 1e-6) line.pop();
    // The walk lays the low side on its left; a pit's low side is inside, so walk it backwards.
    const pts = lowLeft ? line : [...line].reverse();
    const placed = pieces.length === 0 ? [] : run.closed ? layBandRing(pts, [], pieces) : layBandChain(pts, [], pieces);
    const drawn = drawnPlacements(placed, art);
    if (drawn.length === 0) {
      rings.addChild(new Graphics().poly(line.flat(), false).stroke({ color: INK, width: SLOPE_CONTOUR_WIDTH, alpha: SLOPE_CONTOUR_ALPHA }));
      continue;
    }
    const ring = new Container();
    ring.label = 'plateau-contour';
    placeBand(ring, drawn, art, 0xffffff, 0);
    rings.addChild(ring);
  }
  parent.addChild(rings);
  return faces;
}

/** The ground a layer's shade may land on: its floor union and any painted terrain. Empty = not known yet. */
function groundOf(layer: DungeonLayer): Polygon[] {
  const ground: Polygon[] = [];
  for (const ring of layer.mergedFloor ?? []) if (ring.length >= 3) ground.push(ring);
  const t = useStore.getState().mapSettings.terrain?.bounds;
  if (t) ground.push([[t.minX, t.minY], [t.maxX, t.minY], [t.maxX, t.maxY], [t.minX, t.maxY]]);
  return ground;
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
 * The shade a band lays under its rock, per side it drops to: the drop shade along each edge
 * but a slope (whose band is its own shade), blurred, then cut by a mask of that side and of
 * the ground there is, so it is as dark at the edge as the shade says, never spills up onto
 * the band and never lands on void. Returns the blurred holder of each side.
 */
function drawShade(
  parent: Container,
  band: PlateauBand,
  runs: EdgeRun[],
  bands: readonly PlateauBand[],
  ground: Polygon[],
): Map<boolean, Container> {
  const soft = new Map<boolean, Container>();
  for (const outward of [true, false]) {
    // A run dropping to a band below shades it from above; one rising to a band above is that
    // band's to shade, so only a run rising to the ground (a pit's rim) shades its own band.
    const mine = runs.filter((r) => r.drop !== 0 && r.drop > 0 === outward && (r.drop > 0 || Math.abs(band.height - r.drop) < 1e-9));
    if (mine.length === 0) continue;
    const reach = SHADE_REACH + Math.max(...mine.map((r) => (r.edge === 'slope' ? slopeWidthOf(r.owner?.slopeWidth) : dropShadeWidth(r.drop))));
    const low = lowRegion(band, bands, outward, reach);
    const region = ground.length > 0 ? clipper2Engine.intersection(low, clipper2Engine.union(ground, [])) : low;
    if (region.length === 0) continue;
    const g = new Graphics();
    g.label = 'plateau-drop-shade';
    for (const run of mine) if (run.edge !== 'slope') dropShade(g, run);
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
  drawn.forEach((pl, i) => sprites.push({ sprite: rock.children[i] as Sprite, normal: lowNormal(pl) }));

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
