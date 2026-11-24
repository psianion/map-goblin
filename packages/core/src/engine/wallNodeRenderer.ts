// Node-based wall renderer — GitHub #19. Replaces the TilingSprite strip path.
//
// Geometry decisions live in wallLayout.ts (pure, unit-tested). This file only
// turns nodes into sprites: resolve the texture, anchor it, rotate it, scale it.

import { Sprite, Container, Graphics } from 'pixi.js';
import type { DungeonStyle, WallSegment } from '../store/types';
import type { CornerStyle, WallEdits } from '../shared/types';
import type { Polygon } from '../types/geometry';
import { standaloneWallLook, styleWallLook, wallTypeGroup, type WallTypeGroup } from '../shared/wallLook';
import * as textureLoader from '../assets/textureLoader';
import { resolveTexture } from '../assets/textureLoader';
import {
  bandSetArt,
  bandSize,
  getBandSet,
  getWallPieces,
  isBandSet,
  isColoredSet,
  isMeasuredBandSet,
  type CatalogEntry,
} from '../assets/packCatalog';
import { bandPiecesFor } from '../assets/caveWallKit';
import { ringOpeningGaps } from '../shared/caveFloor';
import type { WalkPlacement } from './caveWalk';
import { findWallJoints, type JointSpine } from './wallJoints';
import { doorKitFor } from '../assets/doorKits';
import {
  bandFillColor,
  layBandChain,
  layBandRing,
  mouthEnds,
  orientRings,
  placeBand,
  planDrawnBand,
  withConnectors,
  type BandFloor,
  type BandRingRef,
  type DrawnBandPlan,
} from './caveBandRenderer';
import {
  layoutWall,
  applyWallEdits,
  withoutNodeOffsets,
  fillRun,
  nodeSpriteScale,
  pieceWorldLength,
  isClosedSpine,
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
  /** An erased mouth, not a door: a run stopping at it ends in a taper rather than a jamb. */
  mouth?: boolean;
}

/**
 * Band thickness of a set, in px — the straights' content height. Pieces that
 * carry no contentRect (corners, endings) are scaled against this so their arms
 * match the straights they join.
 */
export function referenceBandPx(setId: string): number {
  const straights = getWallPieces(setId, 'straight');
  const longest = [...straights].sort(
    (a, b) => (b.contentRect?.w ?? b.naturalWidth) - (a.contentRect?.w ?? a.naturalWidth),
  )[0];
  return longest?.contentRect?.h ?? longest?.naturalHeight ?? 200;
}

/**
 * Whether a corner piece turns rounded or sharp. A pack's own 'rounded' or 'sharp' tag
 * wins; the GG sets declare neither, so their letters answer: Corner_A and Corner_C are
 * square, B, D and E (the wide arc) round. A corner neither names is sharp.
 */
export function cornerShapeOf(entry: Pick<CatalogEntry, 'tags' | 'material'>): CornerStyle {
  if (entry.tags.includes('rounded')) return 'rounded';
  if (entry.tags.includes('sharp')) return 'sharp';
  return /_Corner_[BDE](_|$)/.test(entry.material) ? 'rounded' : 'sharp';
}

function toSpec(entry: CatalogEntry, role: WallPieceSpec['role'], bandPx: number): WallPieceSpec {
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
    // 'standalone' marks pieces drawn with chipped free ends (they don't reach
    // their tile edge) — offered for manual swap, never auto-placed.
    swapOnly: entry.tags.includes('standalone') || undefined,
    cornerShape: role === 'corner' ? cornerShapeOf(entry) : undefined,
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
export function buildPieceSpecs(setId: string): WallPieceSpec[] {
  const bandPx = referenceBandPx(setId);
  const specs: WallPieceSpec[] = [];

  for (const e of getWallPieces(setId, 'straight')) {
    specs.push(toSpec(e, 'straight', bandPx));
  }
  for (const e of getWallPieces(setId, 'connector')) {
    if (/diag/i.test(e.id)) continue;
    specs.push(toSpec(e, 'rock', bandPx));
  }
  for (const e of getWallPieces(setId, 'corner')) {
    if (e.gridSize !== '1x1') continue;
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
  waitFor?: (textureId: string) => void,
): number {
  let at = from;
  for (const node of nodes) {
    const spec = specById.get(node.pieceId);
    if (!spec) continue;
    const tex = resolveTexture(node.pieceId);
    // Pack art decodes on first use: a piece still on its fallback redraws when it lands.
    if (tex.width <= 1) waitFor?.(node.pieceId);
    if (tex.width === 0) continue;

    // A cave band's ground strip shares this pool (placeBand); a slot holding
    // one is pushed along rather than dressed up as a stone. So is a slot of the
    // other kind of stone: a mitred one is a sprite under a mask, held together.
    const slot = parent.children[at];
    let sprite: Sprite;
    let mask: Graphics | null = null;
    if (node.clips?.length) {
      let held: Container;
      if (slot && slot.label === CLIPPED_STONE) {
        held = slot as Container;
      } else {
        held = new Container();
        held.label = CLIPPED_STONE;
        const g = new Graphics();
        held.addChild(new Sprite(tex), g);
        held.mask = g;
        if (slot) parent.addChildAt(held, at);
        else parent.addChild(held);
      }
      sprite = held.children[0] as Sprite;
      sprite.texture = tex;
      mask = held.children[1] as Graphics;
    } else if (slot instanceof Sprite) {
      sprite = slot;
      sprite.texture = tex;
    } else {
      sprite = new Sprite(tex);
      if (slot) parent.addChildAt(sprite, at);
      else parent.addChild(sprite);
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
    if (mask) drawStoneClip(mask, node, (spec.lengthPx * sx) / 2, (spec.thicknessPx * sy) / 2);
    at++;
  }
  return at;
}

/** The label of a mitred stone's holder: its sprite, and the mask that cuts it. */
const CLIPPED_STONE = 'clipped-stone';

/**
 * A mitred stone's mask: a box well round the stone, cut by each of its half-planes,
 * so the art is cut along the bisector and never sheared.
 */
function drawStoneClip(g: Graphics, node: WallNode, halfLen: number, halfThick: number): void {
  const ux = Math.cos(node.angle);
  const uy = Math.sin(node.angle);
  const a = halfLen + halfThick;
  const b = 2 * halfThick;
  let poly: [number, number][] = [[a, b], [-a, b], [-a, -b], [a, -b]].map(([p, q]): [number, number] => [
    node.x + ux * p - uy * q,
    node.y + uy * p + ux * q,
  ]);
  for (const c of node.clips ?? []) {
    const side = ([x, y]: [number, number]) => (x - c.x) * c.nx + (y - c.y) * c.ny;
    const out: [number, number][] = [];
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k];
      const q = poly[(k + 1) % poly.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const f = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
      }
    }
    poly = out;
  }
  g.clear();
  if (poly.length >= 3) g.poly(poly.flat()).fill({ color: 0xffffff });
}

/** Drop the tail of the pool a shorter layout no longer needs. */
function trimTo(parent: Container, count: number): void {
  while (parent.children.length > count) {
    // A mitred stone takes its sprite and mask with it.
    parent.removeChildAt(parent.children.length - 1).destroy({ children: true });
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
   * opening is held inside the wall it belongs to. On a closed ring, the ends of
   * the side each stone stands on (see {@link ringSideEnds}), so a stone pushed
   * clear of a door stays between that side's corners.
   */
  wallEnds?: [[number, number], [number, number]] | ((node: WallNode) => [[number, number], [number, number]] | undefined),
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
    const ends = typeof wallEnds === 'function' ? wallEnds(node) : wallEnds;
    if (ends) {
      const p0 = (ends[0][0] - node.x) * cos + (ends[0][1] - node.y) * sin;
      const p1 = (ends[1][0] - node.x) * cos + (ends[1][1] - node.y) * sin;
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
 * The end caps either side of each opening (`gaps`) in a wall of a continuous set (`set`) whose
 * doors have no jambs of their own (no door kit for `setId`): the set's own end piece, as a wall
 * wears at a free end, on each side of the opening that still has wall, facing into it. None for
 * a set with no end piece, or one whose doors bring their jambs.
 */
export function gapEndings(gaps: readonly DoorGap[], spine: readonly [number, number][], closed: boolean, set: ResolvedSet, setId: string | undefined, wallWidth: number): WallNode[] {
  if (gaps.length === 0 || !set.continuous || doorKitFor(setId)) return [];
  const ending = set.specs.find((p) => p.role === 'ending');
  if (!ending) return [];
  const n = spine.length;
  const segs = closed ? n : n - 1;
  const out: WallNode[] = [];
  for (const g of gaps) {
    // The wall's way at the opening, off the stretch of spine it lies on.
    let best = { d: Infinity, k: -1, t: 0 };
    for (let k = 0; k < segs; k++) {
      const [a, b] = [spine[k], spine[(k + 1) % n]];
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const L2 = dx * dx + dy * dy;
      if (L2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((g.position[0] - a[0]) * dx + (g.position[1] - a[1]) * dy) / L2));
      const d = Math.hypot(g.position[0] - a[0] - dx * t, g.position[1] - a[1] - dy * t);
      if (d < best.d) best = { d, k, t };
    }
    if (best.k < 0 || best.d > wallWidth) continue;
    const [a, b] = [spine[best.k], spine[(best.k + 1) % n]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [ux, uy] = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const angle = Math.atan2(uy, ux);
    const half = g.width / 2;
    const along = best.t * L;
    // Wall left before the opening, and after it, on this stretch or past its corner.
    const before = along - half > 1e-6 || best.k > 0 || closed;
    const after = along + half < L - 1e-6 || best.k < segs - 1 || closed;
    if (before) out.push({ t: 0, x: g.position[0] - ux * half, y: g.position[1] - uy * half, angle, pieceId: ending.id, scale: 1, sizeScale: 1, kind: 'ending' });
    if (after) out.push({ t: 0, x: g.position[0] + ux * half, y: g.position[1] + uy * half, angle: angle + Math.PI, pieceId: ending.id, scale: 1, sizeScale: 1, kind: 'ending' });
  }
  return out;
}

/** A stone this far off a side, or turned this far from it (sine), does not stand on it. */
const ON_SIDE = 0.5;
const SIDE_SIN = 0.17;

/**
 * For a closed ring: the two corners of the side a stone stands on (its axis along the side,
 * its middle near it), for `withoutDoorGaps` to hold the stone between. A stone on no side (a
 * corner piece turned across one) has none, and slides as it always did.
 */
export function ringSideEnds(poly: Polygon): (node: WallNode) => [[number, number], [number, number]] | undefined {
  return (node) => {
    let best: { d: number; ends: [[number, number], [number, number]] } | undefined;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k];
      const b = poly[(k + 1) % poly.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-9) continue;
      const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      if (Math.abs(t[0] * Math.sin(node.angle) - t[1] * Math.cos(node.angle)) > SIDE_SIN) continue;
      const s = Math.max(0, Math.min(L, (node.x - a[0]) * t[0] + (node.y - a[1]) * t[1]));
      const d = Math.hypot(node.x - a[0] - t[0] * s, node.y - a[1] - t[1] * s);
      if (d <= ON_SIDE && (!best || d < best.d)) best = { d, ends: [[a[0], a[1]], [b[0], b[1]]] };
    }
    return best?.ends;
  };
}

interface ResolvedSet {
  specs: WallPieceSpec[];
  specById: Map<string, WallPieceSpec>;
  /** The art carries its own colour: drawn untinted (see `wallSetHasTag`). */
  colored: boolean;
  /** The wall is one outlined band: odd turns are capped, not fanned (LayoutOptions.continuous). */
  continuous: boolean;
  /** A continuous set's joint pieces for where walls meet, scaled like a corner. */
  joints: Map<'tee' | 'cross', WallPieceSpec>;
}

/**
 * A wall set has a trait (`colored`, `continuous`) when any of its straights carries
 * the tag. Read off the straights the specs are built from, the same rule
 * `isColoredSet` applies to a wall set's art.
 */
function wallSetHasTag(setId: string, tag: string): boolean {
  return getWallPieces(setId, 'straight').some((e) => e.tags.includes(tag));
}

/** Whether a wall set is one outlined band (`LayoutOptions.continuous`): what the node handles lay it with. */
export function isContinuousSet(setId: string | undefined): boolean {
  return !!setId && wallSetHasTag(setId, 'continuous');
}

/** A continuous set's tee and cross pieces, scaled against the set's band like a corner. */
function jointSpecs(setId: string): Map<'tee' | 'cross', WallPieceSpec> {
  const out = new Map<'tee' | 'cross', WallPieceSpec>();
  const bandPx = referenceBandPx(setId);
  for (const e of getWallPieces(setId, 'joint')) {
    for (const kind of ['tee', 'cross'] as const) {
      if (!out.has(kind) && e.tags.includes(kind)) out.set(kind, toSpec({ ...e, contentRect: undefined }, 'joint', bandPx));
    }
  }
  return out;
}

/** A joint piece to lay where two walls meet, in the look of the wall it is found from. */
interface LaidJoint {
  spec: WallPieceSpec;
  set: ResolvedSet;
  x: number;
  y: number;
  angle: number;
  width: number;
  tint: string;
}

/**
 * A continuous set's cover stones drawn after the rest, so each covers the join of
 * the straights beneath it. Only the draw order: the node list keeps its spine order.
 */
function capsLast(nodes: WallNode[]): WallNode[] {
  return [...nodes.filter((n) => n.kind !== 'fan'), ...nodes.filter((n) => n.kind === 'fan')];
}

/** How light a wall's stones draw in the editor when light passes through it. */
export const WALL_MARK_ALPHA: Record<Exclude<WallTypeGroup, 'solid'>, number> = { window: 0.5, open: 0.22 };
/** The dashed spine an open wall gets in the editor: neutral ink, readable on light and dark floors. */
const MARK_INK = 0x7a7a7a;
const MARK_DASH = 0.3;
const MARK_GAP = 0.2;
const MARK_STROKE = 0.07;

interface MarkParts {
  window: Container;
  open: Container;
  lines: Graphics;
}

/**
 * The editor-only look of walls that let light through, in its own container above the
 * stones: their stones drawn lighter (a window a little, an open wall a lot) and an open
 * wall's spine dashed. Built on first use; `authoredWallMarks` holds it at the authored
 * look for an export.
 */
function markParts(marks: Container): MarkParts {
  if (marks.children.length !== 3) {
    for (const c of marks.removeChildren()) c.destroy({ children: true });
    const window = new Container();
    window.label = 'wall-marks-window';
    const open = new Container();
    open.label = 'wall-marks-open';
    const lines = new Graphics();
    lines.label = 'wall-marks-lines';
    marks.addChild(window, open, lines);
  }
  const [window, open, lines] = marks.children as [Container, Container, Graphics];
  return { window, open, lines };
}

function applyMarkAlpha(parts: MarkParts): void {
  parts.window.alpha = WALL_MARK_ALPHA.window;
  parts.open.alpha = WALL_MARK_ALPHA.open;
  parts.lines.visible = true;
}

/** Puts a layer's wall marks at the authored look (full stones, no dashes) until the undo is called. */
export function authoredWallMarks(marks: Container): () => void {
  if (marks.children.length !== 3) return () => {};
  const parts = markParts(marks);
  parts.window.alpha = 1;
  parts.open.alpha = 1;
  parts.lines.visible = false;
  return () => applyMarkAlpha(parts);
}

/** Dashes along a polyline, the pattern carried across its corners. */
export function dashSpine(g: Graphics, points: [number, number][], dash = MARK_DASH, gap = MARK_GAP): void {
  let on = true;
  let left = dash;
  for (let i = 0; i + 1 < points.length; i++) {
    let [x, y] = points[i];
    const [bx, by] = points[i + 1];
    let seg = Math.hypot(bx - x, by - y);
    if (seg < 1e-9) continue;
    const ux = (bx - x) / seg;
    const uy = (by - y) / seg;
    while (seg > 1e-9) {
      const step = Math.min(left, seg);
      if (on) {
        g.moveTo(x, y);
        g.lineTo(x + ux * step, y + uy * step);
      }
      x += ux * step;
      y += uy * step;
      seg -= step;
      left -= step;
      if (left <= 1e-9) {
        on = !on;
        left = on ? dash : gap;
      }
    }
  }
}

export interface RenderNodeWallsOptions {
  /**
   * The style each floor ring draws with, by ring index (see `ringStyles`): a floor a
   * preset pinned keeps its outline's set, tint and width. The layer style when absent.
   */
  ringStyles?: readonly DungeonStyle[];
  /**
   * The style of each edge of each ring (see `edgeStyles`): null for a ring whose edges
   * all take its ring style, which then lays out exactly as without this option. Set
   * where a room or area pins a wall look on part of the ring.
   */
  edgeStyles?: readonly (readonly DungeonStyle[] | null)[];
  /**
   * The editor's wall-mark container. When given, walls that let light through draw their
   * stones lighter into it, and open walls get a dashed spine. Without it (the table, a
   * host with no editor desk) every wall draws as authored.
   */
  marks?: Container;
  /**
   * The layer's opening regions (`DungeonLayer.caveOpenings`): a band ring's rock stops along
   * the stretches of it inside one (`ringOpeningGaps`), as it does at a door.
   */
  openings?: readonly Polygon[];
  /**
   * The floor a cave band stands on, by ring index (-1 for a drawn wall), for the
   * ground strip behind its rock (see `ringFloorOf`). The ring's floor colour when absent.
   */
  floorOf?: (ring: number) => BandFloor;
  /** Called with each stone's texture id that is not decoded yet, so the host can redraw once it is. */
  waitFor?: (textureId: string) => void;
  /**
   * Called for each floor ring a measured band kit was laid round whole: the ring as the
   * walk took it (void on the left), what it laid, the ring's door gaps and the size. The
   * host fits the floor's paint to that rock (`bandFloorFit`) without walking it again.
   */
  onBandLaid?: (laid: { ring: Polygon; placed: WalkPlacement[]; gaps: DoorGap[]; size: number }) => void;
  /**
   * Called for every ring and run a measured band kit was laid along, floor rings, stretches of
   * a ring's edge and drawn walls alike: what it laid, whether it closes and the size. The host
   * lays the wall's floor shadow along it (wallShadow.ts).
   */
  onRockLaid?: (laid: { placed: WalkPlacement[]; closed: boolean; size: number }) => void;
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
  options: RenderNodeWallsOptions = {},
): void {
  // A standalone wall may pin its own set — see `WallSegment.textureSetId`. It only
  // ever does so to hold the look it already had when a preset moved the layer on,
  // so in practice every run shares one set and this cache is hit every time.
  const specCache = new Map<string, ResolvedSet | null>();
  const specsFor = (id: string | undefined): ResolvedSet | null => {
    if (!id) return null;
    const hit = specCache.get(id);
    if (hit !== undefined) return hit;
    const specs = buildPieceSpecs(id);
    const continuous = specs.length > 0 && wallSetHasTag(id, 'continuous');
    const resolved = specs.length
      ? {
          specs,
          specById: new Map(specs.map((s) => [s.id, s])),
          colored: wallSetHasTag(id, 'colored'),
          continuous,
          joints: continuous ? jointSpecs(id) : new Map<'tee' | 'cross', WallPieceSpec>(),
        }
      : null;
    specCache.set(id, resolved);
    return resolved;
  };
  const tintOf = (hex: string): number => parseInt(hex.replace('#', ''), 16) || 0xffffff;
  // Art that carries its own colour is drawn as it is: a tint would multiply it dark.
  const stoneTint = (set: ResolvedSet, hex: string): number => (set.colored ? 0xffffff : tintOf(hex));
  const bandTint = (setId: string | undefined, hex: string): number => (isColoredSet(setId) ? 0xffffff : tintOf(hex));
  // A cave band kit is a wall family the walk lays rather than one the layout
  // composes: its rock rides the ring as placed pieces, so stone edits mean
  // nothing to it and it takes the ring, the gaps, the tint and the width as
  // the size its rock is laid at (bandSize).
  // Keyed on the set each run resolves to (a ring's pin, a wall's pin, else the
  // layer's), the same resolution the stones use.
  const bandCache = new Map<string, Map<string, CatalogEntry> | null>();
  const bandFor = (id: string | undefined): Map<string, CatalogEntry> | null => {
    if (!id || !isBandSet(id)) return null;
    let art = bandCache.get(id);
    if (art === undefined) {
      art = bandSetArt(id);
      bandCache.set(id, art);
    }
    return art;
  };
  const floorOf =
    options.floorOf ??
    ((ring: number): BandFloor => ({ floorColor: (options.ringStyles?.[Math.max(0, ring)] ?? style).floorColor }));
  // The walk needs every ring wound floor-right; winding a ring reads the others
  // (a hole winds opposite its outer ring), so it is done once for all of them.
  let oriented: Polygon[] | null = null;

  // Drawn cave walls are planned before the rings (planDrawnBand): which side
  // of each is void, and which stretches a banded ring's edge already carries.
  // A door on such a stretch goes to the ring, so it is known before the rings
  // are laid. Only a band layer pays for this; stone walls skip it entirely.
  const drawnPlans = new Map<string, DrawnBandPlan>();
  const ringGaps: DoorGap[] = [];
  if (standaloneWalls.some((w) => bandFor(standaloneWallLook(w, style).setId))) {
    const bandRings: BandRingRef[] = [];
    polygons.forEach((poly, i) => {
      if (poly.length < 3 || !bandFor(styleWallLook(options.ringStyles?.[i] ?? style).setId)) return;
      oriented ??= orientRings(polygons);
      bandRings.push({ ring: i, poly: oriented[i] });
    });
    for (const wall of standaloneWalls) {
      if (wall.points.length < 2 || !bandFor(standaloneWallLook(wall, style).setId)) continue;
      // Only a solid wall gives way to the ring's rock; a window or open wall
      // drawn on a ring edge keeps its own lighter band.
      const carriers = wallTypeGroup(wall.wallType) === 'solid' ? bandRings : [];
      const plan = planDrawnBand(wall.points, polygons, carriers, doorGaps.filter((g) => g.wallId === wall.id));
      drawnPlans.set(wall.id, plan);
      ringGaps.push(...plan.ringGaps);
    }
  }

  const parts = options.marks ? markParts(options.marks) : null;
  if (parts) {
    parts.lines.clear();
    applyMarkAlpha(parts);
  }
  const pools = new Map<Container, number>([[wallsContainer, 0]]);
  if (parts) {
    pools.set(parts.window, 0);
    pools.set(parts.open, 0);
  }
  const place = (
    target: Container,
    nodes: WallNode[],
    specById: Map<string, WallPieceSpec>,
    width: number,
    tint: number,
    set?: ResolvedSet,
  ) => {
    const drawn = set?.continuous ? capsLast(nodes) : nodes;
    pools.set(target, placeNodes(target, drawn, specById, width, tint, pools.get(target) ?? 0, options.waitFor));
  };

  /**
   * A ring whose edges do not all draw alike (a room or area pins a wall look on part
   * of it). Edges that differ only in tint keep the ring's own layout, hand edits and
   * all, and only the stones' tint follows the edge each stands on. Edges that differ
   * in set or width (or a cave band ring) are laid as open runs, one per stretch of
   * like edges, each in its own look; hand edits on such a ring are not applied, since
   * they are keyed on the whole ring's layout.
   */
  const renderRingEdges = (i: number, poly: Polygon, edges: readonly DungeonStyle[]): void => {
    const n = poly.length;
    const looks = edges.map((s) => styleWallLook(s));
    const sameShape = looks.every((l) => l.setId === looks[0].setId && l.width === looks[0].width);
    const ringDoorGaps = doorGaps.filter((g) => g.ring === i);

    if (sameShape && !bandFor(looks[0].setId)) {
      const set = specsFor(looks[0].setId);
      if (!set) return;
      const wallWidth = looks[0].width;
      const cornerStyle = looks[0].corner;
      const auto = layoutWall(poly, true, set.specs, {
        wallWidth,
        seed: seedForPoints(poly),
        cornerStyle,
        continuous: set.continuous,
      });
      const nodes = withoutDoorGaps(
        applyWallEdits(auto, withoutNodeOffsets(floorEdits[String(i)]), undefined, {
          pieces: set.specs,
          wallWidth,
          cornerStyle,
        }),
        ringDoorGaps,
        set.specById,
        wallWidth,
        ringSideEnds(poly),
      );
      const byTint = new Map<string, WallNode[]>();
      for (const node of nodes) {
        const tint = looks[nearestEdge(poly, node.x, node.y)].tint;
        const group = byTint.get(tint);
        if (group) group.push(node);
        else byTint.set(tint, [node]);
      }
      for (const [tint, group] of byTint) place(wallsContainer, group, set.specById, wallWidth, stoneTint(set, tint), set);
      return;
    }

    // Runs of like edges. Start the walk at an edge whose look differs from the one
    // before it, so no run straddles the seam.
    const key = (e: number): string => `${looks[e].setId ?? ''}|${looks[e].width}|${looks[e].tint}`;
    let start = 0;
    while (start < n && key(start) === key((start + n - 1) % n)) start++;
    if (start === n) start = 0;
    const isOriented = (() => {
      if (!looks.some((l) => bandFor(l.setId))) return true;
      oriented ??= orientRings(polygons);
      return oriented[i] === poly;
    })();
    const gaps = [...ringDoorGaps, ...ringGaps.filter((g) => g.ring === i), ...ringOpeningGaps(poly, i, options.openings)];
    for (let k = 0; k < n; ) {
      const e0 = (start + k) % n;
      let len = 1;
      while (k + len < n && key((start + k + len) % n) === key(e0)) len++;
      const points: [number, number][] = [];
      for (let j = 0; j <= len; j++) {
        const [x, y] = poly[(e0 + j) % n];
        points.push([x, y]);
      }
      k += len;
      const look = looks[e0];
      const band = bandFor(look.setId);
      if (band) {
        // The walk wants the floor on the ring's side: a reversed ring reverses its runs.
        const run = isOriented ? points : [...points].reverse();
        const size = bandSize(look.setId, look.width);
        // A measured kit's rock is drawn to its own floor line: no strip behind it.
        const fill = isMeasuredBandSet(look.setId) ? undefined : { edge: run, closed: false, gaps, color: bandFillColor(floorOf(i)), size };
        const placed = layBandChain(run, gaps, bandPiecesFor(look.setId), size);
        if (!fill) options.onRockLaid?.({ placed, closed: false, size });
        pools.set(
          wallsContainer,
          placeBand(
            wallsContainer,
            withConnectors(placed, bandPiecesFor(look.setId), size, mouthEnds(gaps, size)),
            band,
            bandTint(look.setId, look.tint),
            pools.get(wallsContainer) ?? 0,
            fill,
          ),
        );
        continue;
      }
      const set = specsFor(look.setId);
      if (!set) continue;
      const w = look.width;
      const auto = layoutWall(points, false, set.specs, {
        wallWidth: w,
        seed: seedForPoints(points),
        cornerStyle: look.corner,
        continuous: set.continuous,
      });
      place(
        wallsContainer,
        withoutDoorGaps(auto, ringDoorGaps, set.specById, w, [points[0], points[points.length - 1]]),
        set.specById,
        w,
        stoneTint(set, look.tint),
        set,
      );
    }
  };

  for (let i = 0; i < polygons.length; i++) {
    const poly = polygons[i];
    if (poly.length < 3) continue;
    const edges = options.edgeStyles?.[i];
    if (edges && edges.length === poly.length) {
      renderRingEdges(i, poly, edges);
      continue;
    }
    const look = styleWallLook(options.ringStyles?.[i] ?? style);
    const band = bandFor(look.setId);
    if (band) {
      oriented ??= orientRings(polygons);
      const gaps = [...[...doorGaps, ...ringGaps].filter((g) => g.ring === i), ...ringOpeningGaps(poly, i, options.openings)];
      const size = bandSize(look.setId, look.width);
      const measured = isMeasuredBandSet(look.setId);
      const fill = measured ? undefined : { edge: oriented[i], closed: true, gaps, color: bandFillColor(floorOf(i)), size };
      const placed = layBandRing(oriented[i], gaps, bandPiecesFor(look.setId), size);
      if (measured) options.onBandLaid?.({ ring: oriented[i], placed, gaps, size });
      if (measured) options.onRockLaid?.({ placed, closed: true, size });
      pools.set(
        wallsContainer,
        placeBand(wallsContainer, withConnectors(placed, bandPiecesFor(look.setId), size, mouthEnds(gaps, size)), band, bandTint(look.setId, look.tint), pools.get(wallsContainer) ?? 0, fill),
      );
      continue;
    }
    const set = specsFor(look.setId);
    if (!set) continue;
    const wallWidth = look.width;
    const cornerStyle = look.corner;
    const auto = layoutWall(poly, true, set.specs, {
      wallWidth,
      seed: seedForPoints(poly),
      cornerStyle,
      continuous: set.continuous,
    });
    // A floor ring's stones are hand-editable too; its edits live on the layer
    // because the ring itself is recomputed from the shapes every time. Only
    // the cosmetic ones: a ring stone is moved by moving the outline it
    // stands on, so an offset here could only be a leftover.
    const nodes = applyWallEdits(auto, withoutNodeOffsets(floorEdits[String(i)]), undefined, {
      pieces: set.specs,
      wallWidth,
      cornerStyle,
    });
    const gaps = doorGaps.filter((g) => g.ring === i);
    place(
      wallsContainer,
      [...withoutDoorGaps(nodes, gaps, set.specById, wallWidth, ringSideEnds(poly)), ...gapEndings(gaps, poly, true, set, look.setId, wallWidth)],
      set.specById,
      wallWidth,
      stoneTint(set, look.tint),
      set,
    );
  }

  const joints = planJoints();

  for (const wall of standaloneWalls) {
    if (wall.points.length < 2) continue;
    const group = wallTypeGroup(wall.wallType);
    // The dash shows an open wall even on a layer with no stones to lighten.
    if (parts && group === 'open') dashSpine(parts.lines, wall.points);
    const look = standaloneWallLook(wall, style);
    // A drawn wall that loops back onto itself is a ring, not a chain: laid out
    // open it dropped two end caps at the seam and skipped the junction there.
    const closed = isClosedSpine(wall.points);
    const band = bandFor(look.setId);
    if (band) {
      // Laid as planned: the stretches no ring carries, each turned so the
      // floor's side gets the floor side of the rock (planDrawnBand).
      const gaps = doorGaps.filter((g) => g.wallId === wall.id);
      const target = parts && group !== 'solid' ? parts[group] : wallsContainer;
      const color = bandFillColor(floorOf(-1));
      const size = bandSize(look.setId, look.width);
      const strip = !isMeasuredBandSet(look.setId);
      let at = pools.get(target) ?? 0;
      const pieces = bandPiecesFor(look.setId);
      for (const run of drawnPlans.get(wall.id)?.runs ?? []) {
        const laid = run.closed ? layBandRing(run.points, gaps, pieces, size) : layBandChain(run.points, gaps, pieces, size);
        const fill = strip ? { edge: run.points, closed: run.closed, gaps, color, size } : undefined;
        if (!strip) options.onRockLaid?.({ placed: laid, closed: run.closed, size });
        at = placeBand(target, withConnectors(laid, pieces, size), band, bandTint(look.setId, look.tint), at, fill);
      }
      pools.set(target, at);
      continue;
    }
    const set = specsFor(look.setId);
    if (!set) continue;
    const w = look.width;
    const auto = layoutWall(wall.points, closed, set.specs, {
      wallWidth: w,
      seed: seedForPoints(wall.points),
      cornerStyle: look.corner,
      continuous: set.continuous,
    });
    // Auto-layout first, then the DM's manual adjustments on top. Walls with no
    // edits — the common case — pass straight through.
    const edited = applyWallEdits(auto, wall, undefined, { pieces: set.specs, wallWidth: w, cornerStyle: look.corner });
    // A wall that ends on another under a tee piece draws no cap at that end.
    const capless = joints.capless.get(wall.id);
    const nodes = capless
      ? edited.filter((n) => !(n.kind === 'ending' && ((capless.has(0) && n.t === 0) || (capless.has(1) && n.t === 1))))
      : edited;
    const gaps = doorGaps.filter((g) => g.wallId === wall.id);
    place(
      parts && group !== 'solid' ? parts[group] : wallsContainer,
      // A ring has no ends to hold a nudged stone inside — both "ends" are the
      // same seam point, so clamping to them would drag it there.
      [
        ...withoutDoorGaps(
          nodes,
          gaps,
          set.specById,
          w,
          closed ? undefined : [wall.points[0], wall.points[wall.points.length - 1]],
        ),
        ...gapEndings(gaps, wall.points, closed, set, look.setId, w),
      ],
      set.specById,
      w,
      stoneTint(set, look.tint),
      set,
    );
  }

  // Joint pieces go on last, above both walls they join. They are not nodes: nothing
  // edits, drags or swaps them, and neither wall is cut beneath them.
  for (const joint of joints.laid) {
    const node: WallNode = {
      t: 0,
      x: joint.x,
      y: joint.y,
      angle: joint.angle,
      pieceId: joint.spec.id,
      scale: 1,
      sizeScale: 1,
      kind: 'corner',
    };
    place(wallsContainer, [node], new Map([[joint.spec.id, joint.spec]]), joint.width, stoneTint(joint.set, joint.tint));
  }

  if (parts) parts.lines.stroke({ color: MARK_INK, width: MARK_STROKE, alpha: 0.9 });
  for (const [target, count] of pools) trimTo(target, count);

  /**
   * Where solid drawn walls of a continuous set that ships joint pieces meet each other
   * or a floor ring's outline (findWallJoints), and which wall ends lose their cap to a
   * tee. Nothing to do, and nothing searched, on a layer without such a wall.
   */
  function planJoints(): { laid: LaidJoint[]; capless: Map<string, Set<0 | 1>> } {
    const none = { laid: [], capless: new Map<string, Set<0 | 1>>() };
    const spines: JointSpine[] = [];
    const owners: { wallId?: string; tint: string }[] = [];
    for (const wall of standaloneWalls) {
      if (wall.points.length < 2 || wallTypeGroup(wall.wallType) !== 'solid') continue;
      const look = standaloneWallLook(wall, style);
      if (!look.setId || bandFor(look.setId)) continue;
      const set = specsFor(look.setId);
      if (!set?.continuous || set.joints.size === 0) continue;
      spines.push({ points: wall.points, setId: look.setId, width: look.width, closed: isClosedSpine(wall.points) });
      owners.push({ wallId: wall.id, tint: look.tint });
    }
    if (spines.length === 0) return none;
    polygons.forEach((poly, i) => {
      if (poly.length < 3) return;
      const edges = options.edgeStyles?.[i];
      const looks =
        edges && edges.length === poly.length
          ? edges.map((s) => styleWallLook(s))
          : [styleWallLook(options.ringStyles?.[i] ?? style)];
      // A ring whose edges differ in set or width is laid as separate runs: no one spine.
      if (!looks.every((l) => l.setId === looks[0].setId && l.width === looks[0].width)) return;
      const { setId, width, tint } = looks[0];
      if (!setId || bandFor(setId)) return;
      spines.push({ points: poly, setId, width, closed: true, ring: true });
      owners.push({ tint });
    });

    const laid: LaidJoint[] = [];
    const capless = new Map<string, Set<0 | 1>>();
    for (const joint of findWallJoints(spines, doorGaps)) {
      const { setId, width } = spines[joint.spine];
      const set = specsFor(setId);
      const spec = set?.joints.get(joint.kind);
      if (!set || !spec) continue;
      laid.push({ spec, set, x: joint.x, y: joint.y, angle: joint.angle, width, tint: owners[joint.spine].tint });
      const wallId = owners[joint.spine].wallId;
      if (joint.kind === 'tee' && joint.end !== undefined && wallId) {
        const ends = capless.get(wallId) ?? new Set<0 | 1>();
        ends.add(joint.end);
        capless.set(wallId, ends);
      }
    }
    return { laid, capless };
  }
}

/** The index of the ring edge (vertex `e` to `e + 1`) nearest the point. */
function nearestEdge(poly: Polygon, x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let e = 0; e < poly.length; e++) {
    const [ax, ay] = poly[e];
    const [bx, by] = poly[(e + 1) % poly.length];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Preload every piece the layout engine can place. */
export function preloadWallTextures(style: DungeonStyle): Promise<boolean> {
  if (!style.wallTextureSetId) return Promise.resolve(false);
  if (isBandSet(style.wallTextureSetId)) {
    return Promise.all(getBandSet(style.wallTextureSetId).map((e) => textureLoader.load(e.id)))
      .then(() => true)
      .catch(() => false);
  }
  const specs = buildPieceSpecs(style.wallTextureSetId);
  if (specs.length === 0) return Promise.resolve(false);
  return Promise.all(specs.map((s) => textureLoader.load(s.id)))
    .then(() => true)
    .catch(() => false);
}
