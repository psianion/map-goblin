// Node-based wall renderer — GitHub #19. Replaces the TilingSprite strip path.
//
// Geometry decisions live in wallLayout.ts (pure, unit-tested). This file only
// turns nodes into sprites: resolve the texture, anchor it, rotate it, scale it.

import { Sprite, Container } from 'pixi.js';
import type { DungeonStyle, WallSegment } from '../store/types';
import type { WallEdits } from '../shared/types';
import type { Polygon } from '../types/geometry';
import * as textureLoader from '../assets/textureLoader';
import { resolveTexture } from '../assets/textureLoader';
import {
  getWallPieces,
  type WallCategory,
  type TextureEntry,
} from '../assets/textureManifest';
import {
  layoutWall,
  applyWallEdits,
  fillRun,
  nodeSpriteScale,
  pieceWorldLength,
  DEFAULT_WALL_OVERLAP,
  type WallPieceSpec,
  type WallNode,
} from './wallLayout';

export interface DoorGap {
  /** Resolved wall id. Floor-ring edges are `floor:{ring}:{edge}`. */
  wallId: string;
  position: [number, number];
  width: number;
  /**
   * Ring index for a gap on a floor-ring edge, absent for a standalone wall.
   * A ring is laid out as one polygon, so gaps are collected per ring, not per
   * edge — matching is by ring plus the distance test `withoutDoorGaps` already
   * does, which is what keeps a gap off the neighbouring ring's stones.
   */
  ring?: number;
}

/**
 * Band thickness of a set, in px — the straights' content height. Pieces that
 * carry no contentRect (corners, endings) are scaled against this so their arms
 * match the straights they join.
 */
function referenceBandPx(setId: WallCategory): number {
  const straights = getWallPieces(setId, 'straight');
  const longest = [...straights].sort(
    (a, b) => (b.contentRect?.w ?? b.naturalWidth) - (a.contentRect?.w ?? a.naturalWidth),
  )[0];
  return longest?.contentRect?.h ?? longest?.naturalHeight ?? 200;
}

function toSpec(entry: TextureEntry, role: WallPieceSpec['role'], bandPx: number): WallPieceSpec {
  // resolveTexture trims to contentRect when one exists, so a piece that has one
  // is measured by its own content. One that does not arrives as a full padded
  // tile and is scaled against the set's band instead.
  const cr = entry.contentRect;
  return {
    id: entry.id,
    role,
    lengthPx: cr?.w ?? entry.naturalWidth,
    thicknessPx: cr?.h ?? bandPx,
    authoredTurn: role === 'corner' ? Math.PI / 2 : undefined,
  };
}

/**
 * Every piece the layout engine may place, for one wall set.
 *
 * Deliberately excluded (see spec §3.3):
 * - `Corner_D/E/F` (2x2, 3x3) — inconsistent authoring origins inside their
 *   tiles, so they cannot be placed by tile centre. Manual swaps only.
 * - `Connector_DIAG` — a diagonal run, not a rock; wrong shape for a fan.
 * - `Joint_A/B` — cross and tee, for wall intersections, which this pass does
 *   not detect.
 * - `path` — the 8x1 seamless strip the old renderer tiled.
 */
export function buildPieceSpecs(setId: WallCategory): WallPieceSpec[] {
  const bandPx = referenceBandPx(setId);
  const specs: WallPieceSpec[] = [];

  for (const e of getWallPieces(setId, 'straight')) {
    specs.push(toSpec(e, 'straight', bandPx));
  }
  for (const e of getWallPieces(setId, 'connector')) {
    if (e.id.includes('diag')) continue;
    specs.push(toSpec(e, 'rock', bandPx));
  }
  for (const e of getWallPieces(setId, 'corner')) {
    if ((e.gridSize ?? '1x1') !== '1x1') continue;
    specs.push(toSpec(e, 'corner', bandPx));
  }
  for (const e of getWallPieces(setId, 'ending')) {
    specs.push(toSpec(e, 'ending', bandPx));
  }
  return specs;
}

/**
 * Stable per-wall seed so a wall re-renders identically across sessions.
 * Exported because the node overlay must reproduce the exact same layout the
 * renderer drew — a different seed would put the handles on different stones.
 */
export function seedForPoints(points: [number, number][]): number {
  let h = 0x811c9dc5;
  for (const [x, y] of points) {
    h ^= Math.round(x * 16) | 0; h = Math.imul(h, 0x01000193);
    h ^= Math.round(y * 16) | 0; h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Fill `parent` from index `from` onward, reusing the sprites already there.
 *
 * A drag rebuilds this container every frame and every stone was a `destroy()`
 * plus a fresh `new Sprite` — for a wall whose piece count barely changes
 * between frames. Reassigning texture and transform in place keeps the same
 * objects, so only a wall that grew allocates. Returns the next free index.
 */
function placeNodes(
  parent: Container,
  nodes: WallNode[],
  specById: Map<string, WallPieceSpec>,
  wallWidth: number,
  tint: number,
  from: number,
): number {
  let at = from;
  for (const node of nodes) {
    const spec = specById.get(node.pieceId);
    if (!spec) continue;
    const tex = resolveTexture(node.pieceId);
    if (tex.width === 0) continue;

    let sprite = parent.children[at] as Sprite | undefined;
    if (sprite) {
      sprite.texture = tex;
    } else {
      sprite = new Sprite(tex);
      parent.addChild(sprite);
    }
    // 0.5 lands on the visible stone for straights and rocks: resolveTexture
    // hands those back already trimmed to contentRect, so the anchor is the
    // stone's own centre and a resize grows it evenly in every direction rather
    // than off one end. Corners and endings carry no contentRect and arrive as
    // full padded tiles, where 0.5 is the authored attachment point — the vertex
    // for an elbow, the wall end for a cap — which is the point they should grow
    // about anyway, so it stays correct for them too.
    sprite.anchor.set(0.5);
    sprite.position.set(node.x, node.y);
    sprite.rotation = node.angle;
    const [sx, sy] = nodeSpriteScale(node, spec, wallWidth);
    sprite.scale.set(sx, sy);
    sprite.tint = tint;
    at++;
  }
  return at;
}

/** Drop the tail of the pool a shorter layout no longer needs. */
function trimTo(parent: Container, count: number): void {
  while (parent.children.length > count) {
    parent.removeChildAt(parent.children.length - 1).destroy();
  }
}

/**
 * Shortest stretch of wall still worth a stone, as a fraction of the band
 * thickness. Below this a fragment reads as a smear rather than masonry — the
 * judgement `fillRun`'s MIN_PIECE_SCALE makes about a piece, made here about the
 * run it would have to fill.
 */
const MIN_RUN_FRAC = 0.5;

/**
 * How far below its natural length a stone may be squeezed to fit a run before
 * the run is refilled with smaller stones instead.
 *
 * The squeeze exists so a door never leaves bare floor beside it, but it was
 * unbounded: on stone-slate at the default wall width the longest straight is
 * nearly five cells, so a one-and-a-half-cell residual run drew it at 0.30 of
 * its natural length and a 0.4-cell run at 0.08 — hairline slivers whose ink
 * outlines pile onto each other instead of the continuous clean segments the
 * art guide asks for. Above this fraction a squeezed stone still reads as
 * masonry; below it the run wants different stones, not a thinner one.
 */
const MIN_FIT_FRAC = 0.65;

/** Quantised world point, so the same run found from two stones keys alike. */
function runKey(x0: number, y0: number, x1: number, y1: number): string {
  const q = (v: number): number => Math.round(v * 1e4);
  // Normalised end-for-end: two stones facing opposite ways along one wall walk
  // the same run from opposite directions.
  const [ax, ay, bx, by] =
    q(x0) < q(x1) || (q(x0) === q(x1) && q(y0) <= q(y1))
      ? [x0, y0, x1, y1]
      : [x1, y1, x0, y0];
  return `${q(ax)}:${q(ay)}:${q(bx)}:${q(by)}`;
}

/** One stone's claim on one run, in that stone's own axis coordinates. */
interface RunClaim {
  node: WallNode;
  cos: number;
  sin: number;
  halfLength: number;
  a: number;
  b: number;
  /** Index of the claiming stone in the input, to keep the draw order. */
  order: number;
}

/**
 * Cut the stones a door opening passes through.
 *
 * The hard part is that a stone can be much longer than a door. stone-slate's
 * longest straight is 600px of content on a 61px band, so at the default wall
 * width it is nearly five CELLS long — more than half a nine-cell wall. A
 * one-cell door on that wall does not land between two stones, it lands inside
 * one, with cells of that same stone still covering wall on either side.
 *
 * So a stone is not treated as a unit that must end up wholly outside the
 * opening. The wall is cut into the runs the openings leave, and each stone is
 * placed into every run its own body reaches: kept whole and slid flush to the
 * run's edge where the run can take it, squeezed along the spine to fit where it
 * cannot, and emitted twice when a door splits it and both sides still hold
 * enough of it to be worth drawing. The runs are bounded by the wall's own ends,
 * so nothing can be pushed off the end of the wall it belongs to.
 *
 * Squeezing lands on `scale`, the run-fit axis, so a fitted stone keeps the
 * band's thickness instead of being smeared across it.
 *
 * Copies, never mutates — the node arrays are shared with the overlay — and
 * carries `t` across unchanged, because that is the anchor every hand edit on
 * the wall is keyed to.
 *
 * Exported for the unit test; the renderer is its only real caller.
 */
export function withoutDoorGaps(
  nodes: WallNode[],
  gaps: DoorGap[],
  specById: Map<string, WallPieceSpec>,
  wallWidth: number,
  /**
   * The two ends of an open wall, world units, so a stone pushed clear of an
   * opening is held inside the wall it belongs to. Omitted for a closed ring,
   * which has no ends to fall off.
   */
  wallEnds?: [[number, number], [number, number]],
): WallNode[] {
  if (gaps.length === 0) return nodes;

  const minRun = wallWidth * MIN_RUN_FRAC;
  const straights = [...specById.values()].filter((s) => s.role === 'straight');
  // Runs are found stone by stone, on each stone's own axis, so one stretch of
  // wall is found once per stone that reaches it. Collected under a world-space
  // key so the run is decided once, for all of them together.
  const byRun = new Map<string, RunClaim[]>();
  // Stones lap over their neighbours by design, so which one is drawn last is
  // visible. Every batch keeps the index of the earliest stone it came from and
  // the batches are laid out in that order, so the shingling still runs the way
  // the wall does.
  const batches: { order: number; made: WallNode[] }[] = [];

  for (const [index, node] of nodes.entries()) {
    const spec = specById.get(node.pieceId);
    // Same length the sprite will be drawn at — nodeSpriteScale's along-spine
    // factor times the piece's own length is exactly this.
    const halfLength = spec
      ? (pieceWorldLength(spec, wallWidth) * node.scale * node.sizeScale) / 2
      : 0;

    const cos = Math.cos(node.angle);
    const sin = Math.sin(node.angle);

    // Every opening on this wall, as an interval on the stone's own axis with
    // the stone's centre at zero.
    const cuts: [number, number][] = [];
    // Whether any of them actually passes through this stone's body, which is a
    // different question from which of them bound its runs. Openings that reach
    // the stone decide whether it is rearranged at all; every opening on the
    // wall bounds the runs it may be rearranged into, because a stone slides
    // along its run to sit flush against the opening that cut it and a run
    // bounded only by the openings already touching the stone runs straight
    // through the next door along — which is what put a full-size stone across
    // a second doorway.
    let touched = false;
    for (const gap of gaps) {
      const dx = gap.position[0] - node.x;
      const dy = gap.position[1] - node.y;
      const along = dx * cos + dy * sin;
      const across = -dx * sin + dy * cos;
      // A door on the far side of a room projects onto this stone's axis just as
      // happily as one on its own edge. The perpendicular distance is what says
      // which edge the gap belongs to, so it is checked first.
      if (Math.abs(across) > wallWidth) continue;
      const half = gap.width / 2;
      if (Math.abs(along) < halfLength + half) touched = true;
      cuts.push([along - half, along + half]);
    }
    // Untouched by every opening, so it comes out as the very same object it
    // went in as. End caps and cornerstones live here: they are placed on an
    // authored anchor — the wall's own endpoint, the vertex — and straddle it on
    // purpose, so a door elsewhere on the wall must not slide them inboard.
    if (!touched) { batches.push({ order: index, made: [node] }); continue; }
    cuts.sort((a, b) => a[0] - b[0]);

    // The wall's own ends, projected onto this stone's axis. Projection rather
    // than arc length because a stone is not always laid facing along the spine
    // — an opening cap is turned to face out of the wall, a cornerstone on a
    // sharp turn lies square across it — and an arc-length bound would then hold
    // the stone inside a wall running the other way.
    let lo = -Infinity;
    let hi = Infinity;
    if (wallEnds) {
      const p0 = (wallEnds[0][0] - node.x) * cos + (wallEnds[0][1] - node.y) * sin;
      const p1 = (wallEnds[1][0] - node.x) * cos + (wallEnds[1][1] - node.y) * sin;
      lo = Math.min(p0, p1);
      hi = Math.max(p0, p1);
    }

    // What is left of the wall once every opening is taken out of it.
    const runs: [number, number][] = [];
    let cursor = lo;
    for (const [a, b] of cuts) {
      const end = Math.min(a, hi);
      if (end > cursor) runs.push([cursor, end]);
      if (b > cursor) cursor = b;
    }
    if (cursor < hi) runs.push([cursor, hi]);

    for (const [a, b] of runs) {
      // How much of this stone's own body the run holds. A run the stone barely
      // reaches into is its neighbour's to fill, not its.
      if (Math.min(b, halfLength) - Math.max(a, -halfLength) < minRun) continue;
      claim(runKey(node.x + cos * a, node.y + sin * a, node.x + cos * b, node.y + sin * b), {
        node, cos, sin, halfLength, a, b, order: index,
      });
    }
  }

  for (const claims of byRun.values()) {
    const order = claims[0].order;

    // A run at least as long as one of its stones is tiled by whole stones, the
    // way the layout pass drew it — nothing to reconsider.
    if (claims.some((c) => c.b - c.a >= 2 * c.halfLength)) {
      batches.push({ order, made: claims.map(place) });
      continue;
    }

    // Every stone here is longer than the run, and a squeezed stone spans the
    // whole run on its own — so emitting one per claim stacks identical slabs of
    // ink on one patch of wall. One stone covers it; the rest are redundant.
    // Take the one that has to give up least.
    const best = claims.reduce((a, c) =>
      (c.b - c.a) / (2 * c.halfLength) > (a.b - a.a) / (2 * a.halfLength) ? c : a,
    );
    batches.push({
      order,
      made:
        (best.b - best.a) / (2 * best.halfLength) >= MIN_FIT_FRAC
          ? [place(best)]
          : // Too short for even the smallest stone that reaches it. Squeezing
            // anyway is what drew the sliver comb, so the run gets stones chosen
            // to suit it instead — fewer of them, each near its natural length.
            refill(best),
    });
  }

  batches.sort((p, q) => p.order - q.order);
  return batches.flatMap((b) => b.made);

  function claim(key: string, c: RunClaim): void {
    const at = byRun.get(key);
    if (at) at.push(c);
    else byRun.set(key, [c]);
  }

  /** Today's placement: whole and slid flush where it fits, squeezed where not. */
  function place(c: RunClaim): WallNode {
    const { node, cos, sin, halfLength, a, b } = c;
    const room = b - a;
    const fits = room >= 2 * halfLength;
    // Whole stone, as near home as the run allows — which is what keeps a long
    // run exact and its stones full size. Squeezed onto the run when the run is
    // shorter than the stone, because the alternative is the bug this replaced:
    // a cell and a half of bare floor beside every door.
    const shift = fits
      ? Math.min(Math.max(0, a + halfLength), b - halfLength)
      : (a + b) / 2;
    const squeeze = fits ? 1 : room / (2 * halfLength);

    return shift === 0 && squeeze === 1
      ? node
      : {
          ...node,
          x: node.x + cos * shift,
          y: node.y + sin * shift,
          // ponytail: a door through the middle of a long stone still emits it
          // once per side. Overlapping masonry is what this pack draws anyway;
          // dedupe if the sprite count ever shows up in a profile.
          scale: node.scale * squeeze,
        };
  }

  /** Re-lay one short run out of whatever straights the set actually has. */
  function refill(c: RunClaim): WallNode[] {
    const { node, cos, sin, a, b } = c;
    const room = b - a;
    const sx = node.x + cos * a;
    const sy = node.y + sin * a;
    // Stable in the wall's own frame, so the run redraws identically every time.
    const seed = (Math.round(sx * 1e3) * 73856093) ^ (Math.round(sy * 1e3) * 19349663);
    const filled = fillRun(room, straights, wallWidth, DEFAULT_WALL_OVERLAP, seed >>> 0, 0);
    if (filled.length === 0) return [place(c)];

    const made: WallNode[] = [];
    let along = 0;
    for (const { piece, scale } of filled) {
      const wl = pieceWorldLength(piece, wallWidth) * scale;
      made.push({
        ...node,
        x: sx + cos * (along + wl / 2),
        y: sy + sin * (along + wl / 2),
        pieceId: piece.id,
        scale,
        // A refilled fragment is a fresh piece, not the donor resized, so the
        // donor's own hand-resize does not carry onto it.
        sizeScale: 1,
        kind: 'straight',
        // ponytail: the whole run inherits the donor's t. Nothing downstream
        // reads t off this function's output — placeNodes ignores it and the
        // node overlay recomputes its own layout — so distinct values would buy
        // nothing today. Interpolate if an edit handle ever keys off these.
      });
      along += wl * (1 - DEFAULT_WALL_OVERLAP);
    }
    return made;
  }
}

/**
 * Render walls as composed sprite nodes.
 * No wallTextureSetId means invisible walls, same as before.
 */
export function renderNodeWalls(
  wallsContainer: Container,
  polygons: Polygon[],
  standaloneWalls: WallSegment[],
  style: DungeonStyle,
  doorGaps: DoorGap[] = [],
  /** Hand edits for floor rings, keyed by ring index. */
  floorEdits: Record<string, WallEdits> = {},
): void {
  if (!style.wallTextureSetId) {
    trimTo(wallsContainer, 0);
    return;
  }

  const setId = style.wallTextureSetId as WallCategory;
  const specs = buildPieceSpecs(setId);
  if (specs.length === 0) {
    trimTo(wallsContainer, 0);
    return;
  }

  const specById = new Map(specs.map((s) => [s.id, s]));
  const tint = parseInt(style.wallTextureTint.replace('#', ''), 16) || 0xffffff;
  const wallWidth = style.wallWidth;

  let placed = 0;

  for (let i = 0; i < polygons.length; i++) {
    const poly = polygons[i];
    if (poly.length < 3) continue;
    const auto = layoutWall(poly, true, specs, { wallWidth, seed: seedForPoints(poly) });
    // A floor ring's stones are hand-editable too; its edits live on the layer
    // because the ring itself is recomputed from the shapes every time.
    const nodes = applyWallEdits(auto, floorEdits[String(i)]);
    const gaps = doorGaps.filter((g) => g.ring === i);
    placed = placeNodes(
      wallsContainer,
      withoutDoorGaps(nodes, gaps, specById, wallWidth),
      specById, wallWidth, tint, placed,
    );
  }

  for (const wall of standaloneWalls) {
    if (wall.points.length < 2) continue;
    const w = wall.width || wallWidth;
    const auto = layoutWall(wall.points, false, specs, {
      wallWidth: w,
      seed: seedForPoints(wall.points),
    });
    // Auto-layout first, then the DM's manual adjustments on top. Walls with no
    // edits — the common case — pass straight through.
    const nodes = applyWallEdits(auto, wall);
    const gaps = doorGaps.filter((g) => g.wallId === wall.id);
    placed = placeNodes(
      wallsContainer,
      withoutDoorGaps(nodes, gaps, specById, w, [
        wall.points[0],
        wall.points[wall.points.length - 1],
      ]),
      specById, w, tint, placed,
    );
  }

  trimTo(wallsContainer, placed);
}

/** Preload every piece the layout engine can place. */
export function preloadWallTextures(style: DungeonStyle): Promise<boolean> {
  if (!style.wallTextureSetId) return Promise.resolve(false);
  const specs = buildPieceSpecs(style.wallTextureSetId as WallCategory);
  if (specs.length === 0) return Promise.resolve(false);
  return Promise.all(specs.map((s) => textureLoader.load(s.id)))
    .then(() => true)
    .catch(() => false);
}
