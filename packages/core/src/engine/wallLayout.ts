// Node-based wall layout — GitHub #19.
//
// Walks a wall spine and decides which sprite goes where. Pure geometry: no
// Pixi, no store, no texture loading, so the hard part (hex/octagon vertices)
// is provable in a unit test instead of by squinting at a screenshot.
//
// The old TilingSprite renderer tiled one strip per edge and overlaid an
// authored elbow only when the vertex was within 60-100°. Every Corner_* piece
// in the pack is a 90° turn, so a hexagon (120°) or octagon (135°) vertex got
// nothing at all and the two rotated strips just butt-joined. Here, a vertex
// that no authored piece fits is carried by a fan of small pieces laid along a
// fillet arc, each rotated to the local tangent.

import type { Point } from '../types/geometry';
import type { WallNodeEdit, WallSpanEdit, WallEdits } from '../shared/types';

/** Grid unit: 200px = 1 cell (FA standard at 200ppi). */
export const PX_PER_CELL = 200;

/**
 * How far along the spine an edit may drift and still find its node, as a
 * fraction of the total. Generous enough to survive a small vertex nudge
 * relaying the run; tight enough not to hijack an unrelated stone.
 */
export const EDIT_REATTACH_TOLERANCE = 0.02;

export type PieceRole = 'straight' | 'rock' | 'corner' | 'joint' | 'ending' | 'diag';

export interface WallPieceSpec {
  id: string;
  role: PieceRole;
  /** Usable length along the spine, px. contentRect.w ?? naturalWidth. */
  lengthPx: number;
  /** Band thickness, px. contentRect.h ?? naturalHeight. */
  thicknessPx: number;
  /** Turn this piece is drawn for, radians. Junction pieces only. */
  authoredTurn?: number;
  /** Manual-swap only: never auto-placed. Free-standing corners whose chipped
   *  arms stop short of the tile edge would leave gaps against the straights
   *  the layout pulls back to make room for them. */
  swapOnly?: boolean;
}

export type NodeKind = 'straight' | 'fan' | 'corner' | 'ending' | 'inserted';

export interface WallNode {
  /** Parametric position along the whole spine, 0..1. Stable edit anchor. */
  t: number;
  x: number;
  y: number;
  /** Radians, along the spine. */
  angle: number;
  pieceId: string;
  /**
   * Auto-fit length multiplier along the spine; 1 = natural. This is how a run
   * absorbs its remainder (see fillRun), so it must stay on the spine axis
   * only — applying it across the band too would make the wall's thickness
   * ripple with whatever length each run happened to need.
   */
  scale: number;
  /**
   * The DM's manual resize; 1 = untouched. Applies to BOTH axes, so a stone
   * grown by hand reads as a bigger stone instead of a smeared one. Kept
   * separate from `scale` precisely because that one is length-only.
   */
  sizeScale: number;
  kind: NodeKind;
  /** Marked by a node edit, then filtered out. Never set by auto-layout. */
  removed?: boolean;
}

export interface LayoutOptions {
  /** Band thickness in world units (grid cells). */
  wallWidth: number;
  /** Deterministic variant selection — same seed, same wall, same result. */
  seed?: number;
  /** How far from 90° an authored elbow is still allowed, radians. */
  elbowTolerance?: number;
  /**
   * Fraction of its own length each piece is advanced short by, so neighbours
   * interlock. Stones are irregular blobs: pack them so their content rects
   * merely touch and you get hairline seams at play zoom, because the drawn
   * rock is narrower than its bounding box almost everywhere.
   */
  overlap?: number;
}

/**
 * How far a piece tucks under its successor, as a fraction of its own length.
 * Exported so a run refilled after the fact — `withoutDoorGaps` — lays its
 * stones with the same grain as the run the layout pass drew.
 */
export const DEFAULT_WALL_OVERLAP = 0.12;

const DEFAULTS = {
  elbowTolerance: 15 * (Math.PI / 180),
  // ponytail: tuned by eye against dungeon-classic at play zoom. Per-set values
  // belong in WALL_SET_DEFAULTS if a pack's stones ever sit differently.
  overlap: DEFAULT_WALL_OVERLAP,
};

/**
 * Below this turn the vertex is treated as straight-through: no junction, and
 * the run simply bends through it.
 *
 * Set well above a tessellation step on purpose. Curve-mode walls arrive as
 * dozens of Catmull-Rom samples a third of a cell apart, each turning 5-20°.
 * At the old 4° every one of those earned its own cover stone AND cut the
 * spine into micro-edges that each force-fitted a stone of their own — two
 * strands of masonry tracing one wave. Anything gentler than this is inside
 * what a run of stones can follow; anything sharper is a real corner.
 */
const STRAIGHT_EPS = 20 * (Math.PI / 180);

/**
 * How far a rigid piece may bow off a curving spine before the run has to use
 * shorter pieces, as a fraction of the band's own thickness.
 */
const MAX_CHORD_SAG = 0.25;

/**
 * Below this turn a vertex is carried by the cover stone alone; at or above it
 * the cover stone also gets an angled stone along each arm.
 *
 * The arms exist to bridge the wedge a sharp turn opens between the cover stone
 * and the straights. A shallow turn barely opens one, and placing arms anyway
 * is not merely redundant — each arm pushes the straight run back by its own
 * length, so a 45° octagon vertex reserved ~1.3 units on each side of a
 * 3.4-unit edge. Nothing but the shortest straight could fit in what was left
 * and the wall read as loose rubble instead of masonry.
 *
 * Set clear of a hexagon's exact 60° so hexagons and octagons stay cap-only.
 */
const ARM_TURN_MIN = 65 * (Math.PI / 180);

/**
 * Which way the cover stone lies.
 *
 * A band turning a corner mitres: its outer edges cross further from the vertex
 * than half the band width, so a stone lying *across* the corner leaves the tip
 * of a sharp point open. Scaling the stone up to cover it was the wrong answer —
 * the straights are rows of small pebbles, so an inflated rock reads as a
 * boulder dropped on the wall and half of it hangs outside the band.
 *
 * Turning it instead costs nothing: at a sharp point the stone lies along the
 * outward bisector with its *length* plugging the point, which is how a real
 * cornerstone sits. At a gentle turn it lies along the wall like every other
 * stone. Natural size either way.
 */
function capAngleFor(through: number, turn: number): number {
  return Math.abs(turn) >= ARM_TURN_MIN ? through + Math.PI / 2 : through;
}

/**
 * World length of a piece at a given band width. Pieces scale uniformly so the
 * stone detail keeps its proportions — the same rule the strip renderer used.
 */
export function pieceWorldLength(p: WallPieceSpec, wallWidth: number): number {
  return p.lengthPx * (wallWidth / p.thicknessPx);
}

/**
 * Sprite scale factors for one node, `[alongSpine, acrossBand]`.
 *
 * Lives here rather than inline in the renderer so the two-scale rule is
 * unit-testable without standing up Pixi: the auto-fit stretch acts on the
 * spine axis alone, the DM's resize acts on both. Both start from the same base
 * `k`, which fits the piece's authored band to the wall's width.
 */
export function nodeSpriteScale(
  node: Pick<WallNode, 'scale' | 'sizeScale'>,
  spec: WallPieceSpec,
  wallWidth: number,
): [number, number] {
  const k = wallWidth / spec.thicknessPx;
  return [k * node.scale * node.sizeScale, k * node.sizeScale];
}

/**
 * Deterministic, position-seeded. Same index always picks the same variant, and
 * no Math.random, so a wall re-renders identically forever.
 *
 * fmix32 (murmur3's finalizer), not a plain xorshift: the selection is `h % n`
 * with n as small as 2, so only the bottom bits are read and weak avalanche
 * there is fatal. A naive xorshift here mapped seeds 1 and 999 to the identical
 * sequence. fmix32 gives 2000 distinct sequences over 2000 seeds.
 */
/**
 * The authored elbow for a turn, chosen among every variant that fits the
 * angle. Position-seeded so the layout pass and the drag-time corner pass
 * agree on the variant for the same vertex — a seed-and-index pick here would
 * swap the cornerstone the moment a drag ended.
 */
function elbowFor(
  elbows: WallPieceSpec[],
  turn: number,
  elbowTol: number,
  x: number,
  y: number,
): WallPieceSpec | null {
  const matches = elbows.filter(
    (p) => Math.abs(Math.abs(turn) - (p.authoredTurn ?? Math.PI / 2)) <= elbowTol,
  );
  if (matches.length === 0) return null;
  const seed = (Math.round(x * 16) ^ Math.imul(Math.round(y * 16), 0x9e3779b1)) >>> 0;
  return pick(matches, seed, 0);
}

function pick<T>(items: T[], seed: number, index: number): T {
  let h = (Math.imul(index, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return items[(h >>> 0) % items.length];
}

function norm(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Shortest a piece may be squeezed, as a fraction of its natural length. Below
 * this a stone stops reading as a stone and becomes a smear — a 4%-length
 * sliver stretched to full band thickness is worse than the hairline it was
 * inserted to avoid. Overrun past the run's end is harmless: neighbouring
 * pieces overlap by design, and a junction's cover stone sits on top.
 */
const MIN_PIECE_SCALE = 0.45;

/**
 * Fill a straight run with the largest pieces that fit, then absorb the
 * remainder by scaling every chosen piece uniformly. Uniform scaling is why
 * runs never show a gap: the error is spread, not dumped at one end.
 *
 * Exported because a door leaves residual runs that this same rule has to fill —
 * see `withoutDoorGaps`. Picking pieces to suit the run is the whole reason a
 * short run does not have to squeeze a long stone down to a sliver.
 */
export function fillRun(
  runLength: number,
  straights: WallPieceSpec[],
  wallWidth: number,
  overlap: number,
  seed: number,
  seedOffset: number,
): { piece: WallPieceSpec; scale: number }[] {
  if (runLength <= 0 || straights.length === 0) return [];

  // How much spine a piece actually claims once it tucks under its neighbour.
  const advance = (p: WallPieceSpec) => pieceWorldLength(p, wallWidth) * (1 - overlap);

  // Longest first; group same-length variants so `pick` can vary them.
  const byLen = [...straights].sort((a, b) => advance(b) - advance(a));
  const shortest = advance(byLen[byLen.length - 1]);
  if (shortest <= 0) return [];

  const chosen: WallPieceSpec[] = [];
  let remaining = runLength;
  let i = 0;

  while (remaining >= shortest * 0.5 && chosen.length < 4096) {
    const fits = byLen.filter((p) => advance(p) <= remaining);
    const candidates = fits.length > 0 ? fits : [byLen[byLen.length - 1]];
    // Vary only among pieces sharing the winning length, so we stay largest-first.
    const bestLen = advance(candidates[0]);
    const sameLen = candidates.filter((p) => Math.abs(advance(p) - bestLen) < 1e-9);
    const piece = pick(sameLen, seed, seedOffset + i);
    chosen.push(piece);
    remaining -= advance(piece);
    i++;
  }

  if (chosen.length === 0) {
    // Run shorter than half the smallest piece: squeeze one in rather than gap,
    // but never past the point where it reads as a smear.
    const piece = byLen[byLen.length - 1];
    const fit = runLength / pieceWorldLength(piece, wallWidth);
    return [{ piece, scale: Math.max(fit, MIN_PIECE_SCALE) }];
  }

  // What the row actually paints, which is not what it advances. Every piece
  // but the last is tucked under its successor and so only shows `advance`; the
  // last one has no successor and shows its whole length. Scaling against the
  // advance sum alone therefore let that untucked tail hang past the run's end —
  // on stone-slate's longest straight, two thirds of a cell past the wall's own
  // endpoint, while the run's head stayed flush. That asymmetry was the wall
  // end-cap overhang.
  const last = chosen[chosen.length - 1];
  const painted =
    chosen.reduce((s, p) => s + advance(p), 0) -
    advance(last) +
    pieceWorldLength(last, wallWidth);
  const scale = painted > 0 ? runLength / painted : 1;
  return chosen.map((piece) => ({ piece, scale: Math.max(scale, MIN_PIECE_SCALE) }));
}

// Defined in shared/types so the store can hold floor-ring edits without
// reaching into the engine. Re-exported here, where every consumer expects it.
export type { WallEdits } from '../shared/types';

/** Index of the node nearest `t`, or -1 if none is within tolerance. */
function nearestNode(nodes: WallNode[], t: number, tolerance: number): number {
  let best = -1;
  let bestDist = tolerance;
  for (let i = 0; i < nodes.length; i++) {
    const d = Math.abs(nodes[i].t - t);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Widest seam left alone, as a fraction of the band's thickness. Stones are
 * irregular, so a hairline between two of them reads as mortar rather than a
 * hole; anything wider than this is floor showing through a wall.
 */
const GAP_TOLERANCE = 0.1;

/** How far a node's painted stone reaches from its centre toward `dir`. */
function nodeReach(node: WallNode, spec: WallPieceSpec, wallWidth: number, dir: number): number {
  const [sx, sy] = nodeSpriteScale(node, spec, wallWidth);
  return extentToward((spec.lengthPx * sx) / 2, (spec.thicknessPx * sy) / 2, node.angle, dir);
}

/**
 * Close any seam an edit has torn open, by laying more of the same stone.
 *
 * Dragging a node stretches its two seams; nothing downstream re-runs the fit,
 * so the wall used to end up with floor showing through it. Rather than plumb
 * an insert into the drag, the seams are simply measured here and filled — so
 * a stone dragged, nudged, resized, removed or seam-adjusted all close the same
 * way, and none of it is stored, so the drag stays one undo step.
 *
 * The filler is the leading stone's own piece, which is what makes a Tab swap
 * on either neighbour carry into the stones that bridge to it.
 */
function fillNodeGaps(
  nodes: WallNode[],
  /**
   * Nodes the DM dragged. Only their seams are filled: a stone deleted, or a
   * seam widened with the gap keys, was opened on purpose and must stay open.
   */
  dragged: Set<WallNode>,
  /**
   * Spine positions of stones the DM deleted. A seam straddling one of them is
   * a hole that was asked for, so it is left alone even when a dragged stone
   * flanks it — otherwise Delete on a bridged stone bridged it straight back.
   */
  removedTs: number[],
  specs: Map<string, WallPieceSpec>,
  wallWidth: number,
  overlap: number,
): WallNode[] {
  const out: WallNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    out.push(a);
    const b = nodes[i + 1];
    if (!b) continue;
    if (!dragged.has(a) && !dragged.has(b)) continue;
    if (removedTs.some((t) => t >= Math.min(a.t, b.t) && t <= Math.max(a.t, b.t))) continue;
    const specA = specs.get(a.pieceId);
    const specB = specs.get(b.pieceId);
    if (!specA || !specB) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) continue;
    const dir = Math.atan2(dy, dx);
    const gap =
      d - nodeReach(a, specA, wallWidth, dir) - nodeReach(b, specB, wallWidth, dir + Math.PI);
    if (gap <= wallWidth * GAP_TOLERANCE) continue;

    // Bridge with the leading stone's piece, at its size. End caps and corners
    // are placed for a role, so a seam next to one borrows the other side.
    const donor = a.kind === 'ending' || a.kind === 'corner' ? b : a;
    const spec = donor === a ? specA : specB;
    const len = pieceWorldLength(spec, wallWidth) * donor.sizeScale;
    if (len <= 0) continue;
    const step = len * (1 - overlap);
    const count = Math.min(Math.ceil(gap / step), 64);
    const start = d - nodeReach(b, specB, wallWidth, dir + Math.PI) - gap;
    for (let k = 0; k < count; k++) {
      const along = start + ((k + 0.5) * gap) / count;
      out.push({
        t: a.t + ((b.t - a.t) * along) / d,
        x: a.x + Math.cos(dir) * along,
        y: a.y + Math.sin(dir) * along,
        angle: dir,
        pieceId: donor.pieceId,
        scale: 1,
        sizeScale: donor.sizeScale,
        kind: 'inserted',
      });
    }
  }
  return out;
}

/**
 * Re-piece the stones a drag has bent into a real corner.
 *
 * Auto-layout decides cornerstones from the spine's own vertices, which a hand
 * drag never touches — so a stone pulled out of line left two straights meeting
 * at an angle with nothing sitting in the elbow. This asks the same question of
 * the *resolved* run: what turn does the band actually make at this stone now?
 * The answer is fed through the very rules the layout pass uses — an authored
 * elbow when the turn is close to what one was drawn for, otherwise the layout's
 * own cornerstone rotation from `capAngleFor`.
 *
 * The dragged stones and their immediate neighbours are all asked, because a
 * drag bends the band at the stones either side of it just as much as at the one
 * under the pointer.
 *
 * Precedence: at a stone that now sits in a corner the corner piece wins over a
 * hand-picked one. Anywhere else the run is left exactly as edited, so a Tab
 * swap on a stone that is merely near the bend survives.
 */
function applyCornerPieces(
  nodes: WallNode[],
  dragged: Set<WallNode>,
  pieces: WallPieceSpec[],
  elbowTol: number,
): void {
  const elbows = pieces.filter((p) => p.role === 'corner' && !p.swapOnly);
  const affected = new Set<number>();
  for (let i = 0; i < nodes.length; i++) {
    if (dragged.has(nodes[i])) {
      affected.add(i - 1);
      affected.add(i);
      affected.add(i + 1);
    }
  }

  for (const i of affected) {
    const node = nodes[i];
    const prev = nodes[i - 1];
    const next = nodes[i + 1];
    if (!node || !prev || !next) continue;

    const inAng = Math.atan2(node.y - prev.y, node.x - prev.x);
    const outAng = Math.atan2(next.y - node.y, next.x - node.x);
    const turn = norm(outAng - inAng);
    // Below this the band simply bends through the stone — the same judgement
    // capAngleFor makes about a drawn vertex, so a gentle drag reads as a curve
    // rather than sprouting cornerstones along it.
    if (Math.abs(turn) < ARM_TURN_MIN) continue;

    const elbow = elbowFor(elbows, turn, elbowTol, node.x, node.y);
    if (elbow) {
      // Same arm-picking rule as the layout pass: rotating by the incoming angle
      // puts an arm on the wrong side half the time.
      const back = norm(inAng + Math.PI);
      node.pieceId = elbow.id;
      node.angle = norm(outAng - back) > 0 ? back : outAng;
    } else {
      const bx = Math.cos(inAng) + Math.cos(outAng);
      const by = Math.sin(inAng) + Math.sin(outAng);
      const through = Math.hypot(bx, by) < 1e-9 ? inAng : Math.atan2(by, bx);
      node.angle = capAngleFor(through, turn);
    }
    // Kind, not just the piece: fillNodeGaps refuses to bridge with a corner's
    // stone, which is what keeps the seams either side using the straights.
    node.kind = 'corner';
  }
}

/**
 * Overlay the DM's manual adjustments on an auto-generated node run.
 *
 * Pure, and separate from layoutWall on purpose: auto-layout stays the same
 * function whether or not a wall has been hand-edited, so a wall can always be
 * reset by dropping its edits.
 *
 * A span edit nudges only the two stones flanking that seam, rather than
 * shifting everything downstream. Cascading would need the spine geometry here
 * and would make one drag silently move the whole rest of the wall.
 */
export function applyWallEdits(
  nodes: WallNode[],
  edits: WallEdits | undefined,
  tolerance = EDIT_REATTACH_TOLERANCE,
  /**
   * Pieces of the wall's set. Given them, an edit that opens a seam wider than
   * the stones can cover is bridged with more of the same — see fillNodeGaps.
   * Omitted, the nodes come back exactly as edited.
   */
  fill?: {
    pieces: WallPieceSpec[];
    wallWidth: number;
    overlap?: number;
    elbowTolerance?: number;
  },
): WallNode[] {
  if (!edits) return nodes;
  const { nodeEdits, spanEdits, nodeInserts } = edits;
  if (!nodeEdits?.length && !spanEdits?.length && !nodeInserts?.length) return nodes;

  let out = nodes.map((n) => ({ ...n }));
  const dragged = new Set<WallNode>();

  const apply = (node: WallNode, edit: WallNodeEdit): void => {
    if (edit.removed) { node.removed = true; return; }
    if (edit.pieceId !== undefined) node.pieceId = edit.pieceId;
    if (edit.rotate !== undefined) node.angle += edit.rotate;
    // Onto sizeScale, not scale: a resize must not be mistaken for the run's
    // auto-fit stretch, and it grows the stone on both axes.
    if (edit.scale !== undefined) node.sizeScale *= edit.scale;
    if (edit.dx !== undefined) node.x += edit.dx;
    if (edit.dy !== undefined) node.y += edit.dy;
    if (edit.dx || edit.dy) dragged.add(node);
  };

  /**
   * An edit anchored exactly on an insert belongs to that inserted stone, not
   * to whichever auto stone happens to be nearest. Inserts do not exist yet in
   * this pass, so those edits are held back and applied once they do — without
   * that, a Tab on an inserted stone landed on its neighbour and every stone
   * derived from that neighbour changed with it.
   */
  const ownedByInsert = (t: number): boolean =>
    (nodeInserts ?? []).some((ins) => Math.abs(ins.t - t) < 1e-9);

  for (const edit of nodeEdits ?? []) {
    if (ownedByInsert(edit.t)) continue;
    const i = nearestNode(out, edit.t, tolerance);
    if (i < 0) continue;
    apply(out[i], edit);
  }

  for (const span of spanEdits ?? []) {
    const i = nearestNode(out, span.t, tolerance);
    if (i < 0 || i + 1 >= out.length) continue;
    const a = out[i];
    const b = out[i + 1];
    const half = span.gap / 2;
    a.x -= Math.cos(a.angle) * half;
    a.y -= Math.sin(a.angle) * half;
    b.x += Math.cos(b.angle) * half;
    b.y += Math.sin(b.angle) * half;
  }

  out = out.filter((n) => !n.removed);

  for (const ins of nodeInserts ?? []) {
    // Position and angle are interpolated from whichever nodes bracket t, so an
    // inserted stone lands on the spine rather than at the origin.
    //
    // Chosen by t rather than by position in the array: each insert is appended
    // to the end, so the obvious `[...out].reverse().find(t <= ins.t)` picked
    // the previous insert whatever its t, and a second stone inserted anywhere
    // downstream was then interpolated from the wrong pair and landed off the
    // wall.
    let before: WallNode | undefined;
    let after: WallNode | undefined;
    for (const n of out) {
      if (n.t <= ins.t && (!before || n.t > before.t)) before = n;
      if (n.t >= ins.t && (!after || n.t < after.t)) after = n;
    }
    before ??= out[0];
    after ??= out[out.length - 1];
    if (!before || !after) continue;
    const span = after.t - before.t;
    const f = span > 1e-9 ? (ins.t - before.t) / span : 0;
    out.push({
      t: ins.t,
      x: before.x + (after.x - before.x) * f,
      y: before.y + (after.y - before.y) * f,
      angle: before.angle + norm(after.angle - before.angle) * f + (ins.rotate ?? 0),
      pieceId: ins.pieceId,
      // A hand-placed stone has no run to fit, so its only scale is the DM's.
      scale: 1,
      sizeScale: ins.scale ?? 1,
      kind: 'inserted',
    });
  }

  // Now that the inserted stones exist, the edits keyed to them can land.
  for (const edit of nodeEdits ?? []) {
    if (!ownedByInsert(edit.t)) continue;
    const node = out.find((n) => n.kind === 'inserted' && Math.abs(n.t - edit.t) < 1e-9);
    if (node) apply(node, edit);
  }
  out = out.filter((n) => !n.removed);

  out.sort((a, b) => a.t - b.t);
  if (!fill || dragged.size === 0) return out;
  // Before the bridging pass, so a seam next to a freshly-made corner is filled
  // from the straight beside it rather than from the cornerstone.
  applyCornerPieces(out, dragged, fill.pieces, fill.elbowTolerance ?? DEFAULTS.elbowTolerance);
  return fillNodeGaps(
    out,
    dragged,
    (nodeEdits ?? []).filter((e) => e.removed).map((e) => e.t),
    new Map(fill.pieces.map((p) => [p.id, p])),
    fill.wallWidth,
    fill.overlap ?? DEFAULT_WALL_OVERLAP,
  );
}

/**
 * A floor ring's edits as the engine should read them: cosmetic only.
 *
 * A stone on a floor-derived ring stands ON the outline, so moving it is a
 * change to the floor's own geometry and is written as one — see
 * `ringStoneDrag`. A dx/dy on a ring can therefore only be left over from
 * before that rework, where it slid the stone off the boundary it edges while
 * the boundary stayed put. Rotation, resize, piece choice and removal are
 * genuinely cosmetic and survive untouched.
 */
export function withoutNodeOffsets(edits: WallEdits | undefined): WallEdits | undefined {
  const nodeEdits = edits?.nodeEdits;
  if (!nodeEdits?.some((e) => e.dx || e.dy)) return edits;
  const kept: WallNodeEdit[] = [];
  for (const e of nodeEdits) {
    const rest: WallNodeEdit = { ...e };
    delete rest.dx;
    delete rest.dy;
    if (
      rest.pieceId !== undefined ||
      rest.removed ||
      (rest.rotate ?? 0) !== 0 ||
      (rest.scale ?? 1) !== 1
    ) {
      kept.push(rest);
    }
  }
  return { ...edits, nodeEdits: kept };
}

/**
 * Merge one node edit into a wall's existing edit list, keyed on `t`.
 *
 * Pure, and returns a fresh array, so it drops straight into
 * `UpdateWallCommand`'s before/after pair and inherits undo. Offsets and
 * rotations accumulate — dragging a handle twice moves it twice — while a swap
 * replaces. An edit that ends up doing nothing is dropped rather than stored,
 * so a node returned to its default costs nothing in the save file.
 */
export function mergeNodeEdit(
  existing: WallNodeEdit[] | undefined,
  edit: WallNodeEdit,
  // Exact match, NOT the re-attach tolerance. The caller passes the node's own t
  // straight from the current layout, and adjacent nodes — the three stones at a
  // vertex especially — sit far closer together than the re-attach window. Using
  // that window here folds two neighbours' edits into one.
  tolerance = 1e-9,
): WallNodeEdit[] {
  const out = (existing ?? []).map((e) => ({ ...e }));
  const i = out.findIndex((e) => Math.abs(e.t - edit.t) <= tolerance);
  const merged: WallNodeEdit = i >= 0 ? out[i] : { t: edit.t };

  if (edit.pieceId !== undefined) merged.pieceId = edit.pieceId;
  if (edit.removed !== undefined) merged.removed = edit.removed;
  if (edit.rotate !== undefined) merged.rotate = (merged.rotate ?? 0) + edit.rotate;
  if (edit.dx !== undefined) merged.dx = (merged.dx ?? 0) + edit.dx;
  if (edit.dy !== undefined) merged.dy = (merged.dy ?? 0) + edit.dy;
  if (edit.scale !== undefined) merged.scale = (merged.scale ?? 1) * edit.scale;

  const isNoop =
    merged.pieceId === undefined &&
    !merged.removed &&
    (merged.rotate ?? 0) === 0 &&
    (merged.dx ?? 0) === 0 &&
    (merged.dy ?? 0) === 0 &&
    (merged.scale ?? 1) === 1;

  if (i >= 0) {
    if (isNoop) out.splice(i, 1);
    else out[i] = merged;
  } else if (!isNoop) {
    out.push(merged);
  }
  return out;
}

/**
 * Merge a seam adjustment into a wall's span-edit list, keyed on the leading
 * node's `t`. Same contract as mergeNodeEdit: accumulates, and drops the entry
 * when the gap returns to zero.
 */
export function mergeSpanEdit(
  existing: WallSpanEdit[] | undefined,
  edit: WallSpanEdit,
  tolerance = 1e-9,
): WallSpanEdit[] {
  const out = (existing ?? []).map((e) => ({ ...e }));
  const i = out.findIndex((e) => Math.abs(e.t - edit.t) <= tolerance);
  const gap = (i >= 0 ? out[i].gap : 0) + edit.gap;

  if (i >= 0) {
    if (gap === 0) out.splice(i, 1);
    else out[i] = { t: out[i].t, gap };
  } else if (gap !== 0) {
    out.push({ t: edit.t, gap });
  }
  return out;
}

/**
 * How far a rotated piece's *painted stone* reaches from its own centre in
 * world direction `dir`.
 *
 * Modelled as an ellipse inscribed in the piece's box, not as the box itself.
 * A rock is a blob: along its own axes it fills the box, but toward a diagonal
 * the box corner is almost entirely transparent. Using the rectangle's support
 * function overstated the reach by ~40% on the diagonal, which is precisely the
 * direction the arms approach a rotated cover stone from — so the arms were
 * parked against empty pixels and the turn showed a hole even though the
 * bounding boxes overlapped.
 *
 * Exact at 0° and 90°, so straight runs are unaffected.
 */
function extentToward(
  halfLength: number,
  halfThickness: number,
  pieceAngle: number,
  dir: number,
): number {
  const d = pieceAngle - dir;
  const c = halfThickness * Math.cos(d);
  const s = halfLength * Math.sin(d);
  const denom = Math.hypot(c, s);
  return denom < 1e-9 ? Math.min(halfLength, halfThickness) : (halfLength * halfThickness) / denom;
}

/**
 * The three pieces that carry one oblique vertex: a cover stone sitting on the
 * vertex itself, and one stone angled along each arm. Offsets are solved once
 * here so the reserve and the placement cannot drift apart.
 */
interface Fan {
  cap: WallPieceSpec;
  /** Null on a shallow turn, where the cover stone carries the vertex alone. */
  armIn: WallPieceSpec | null;
  armOut: WallPieceSpec | null;
  /**
   * Cover stone rotation. Along the wall at a gentle turn; square to it, so its
   * length plugs the point, at a sharp one. See capAngleFor.
   */
  capAngle: number;
  /** Vertex to arm-centre distance, back along the incoming edge. */
  dIn: number;
  /** Vertex to arm-centre distance, forward along the outgoing edge. */
  dOut: number;
}

interface Junction {
  /** Turn applied at this vertex, radians. Signed; 0 = straight through. */
  turn: number;
  /**
   * Spine length reserved on the incoming edge, and on the outgoing edge.
   *
   * These are separate because the two arms of a fan are independently picked
   * and rarely the same length. Reserving the larger of the two on both sides —
   * one scalar for the whole vertex — left the shorter arm ending well before
   * the straight run began, opening a hole on that side of every sharp turn.
   */
  reachIn: number;
  reachOut: number;
  elbow: WallPieceSpec | null;
  fan: Fan | null;
}

/**
 * Shortest edge the wall band can actually express, as a fraction of its own
 * thickness. Detail finer than this is below the resolution of the masonry.
 */
const MIN_EDGE_FRAC = 0.5;

/**
 * Drop vertices that sit closer together than the band can resolve.
 *
 * Boolean unions of floor shapes routinely emit slivers — a 0.07-unit edge
 * where a corridor grazes a room's diagonal is typical. Every vertex earns a
 * junction, so a sliver stacked three cover stones inside a fraction of the
 * wall's thickness and the join came out as a heap of boulders.
 *
 * Bails out rather than degenerate: a shape that simplifies away entirely is
 * returned untouched, so a genuinely tiny room still gets walls.
 */
function simplifySpine(pts: Point[], minEdge: number, closed: boolean): Point[] {
  if (minEdge <= 0) return pts;
  const kept: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const last = kept[kept.length - 1];
    if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) >= minEdge) kept.push(pts[i]);
  }
  // On a closed ring the last point also has to clear the first.
  if (closed && kept.length > 2) {
    const first = kept[0];
    const last = kept[kept.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) < minEdge) kept.pop();
  }
  return kept.length >= (closed ? 3 : 2) ? kept : pts;
}

/**
 * Lay out one wall spine.
 *
 * @param points  Spine vertices in world units.
 * @param closed  True for room polygons, false for standalone chains.
 * @param pieces  Every piece available from the active wall set.
 */
export function layoutWall(
  points: Point[] | [number, number][],
  closed: boolean,
  pieces: WallPieceSpec[],
  opts: LayoutOptions,
): WallNode[] {
  const raw: Point[] = (points as (Point | [number, number])[]).map((p) =>
    Array.isArray(p) ? { x: p[0], y: p[1] } : p,
  );
  if (raw.length < 2) return [];

  const { wallWidth } = opts;
  const pts = simplifySpine(raw, wallWidth * MIN_EDGE_FRAC, closed);
  const seed = opts.seed ?? 1;
  const elbowTol = opts.elbowTolerance ?? DEFAULTS.elbowTolerance;
  const overlap = Math.min(Math.max(opts.overlap ?? DEFAULTS.overlap, 0), 0.5);

  const straights = pieces.filter((p) => p.role === 'straight');
  const rocks = pieces.filter((p) => p.role === 'rock');
  const elbows = pieces.filter((p) => p.role === 'corner' && !p.swapOnly);
  const endings = pieces.filter((p) => p.role === 'ending');
  // Fan material: small pieces from this same set, so the band stays continuous.
  const fanPieces = rocks.length > 0 ? rocks : straights;
  if (straights.length === 0) return [];

  const edges: { a: Point; b: Point; len: number; ang: number }[] = [];
  const n = pts.length;
  const edgeCount = closed ? n : n - 1;
  for (let i = 0; i < edgeCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    edges.push({ a, b, len, ang: Math.atan2(b.y - a.y, b.x - a.x) });
  }
  if (edges.length === 0) return [];

  // Arc-length index of the spine. Runs are laid out against this rather than
  // per edge, so a chain of short edges is one continuous row of stones.
  const edgeStart: number[] = [];
  let acc = 0;
  for (const e of edges) {
    edgeStart.push(acc);
    acc += e.len;
  }
  const total = acc;

  // ── Junction pass ──
  // A vertex joins edge i-1 to edge i. Closed walls have one per edge; open
  // walls have one per interior vertex only.
  const junctions = new Map<number, Junction>();
  const firstJunction = closed ? 0 : 1;
  for (let i = firstJunction; i < edges.length; i++) {
    const prev = edges[(i - 1 + edges.length) % edges.length];
    const curr = edges[i];
    const turn = norm(curr.ang - prev.ang);
    if (Math.abs(turn) < STRAIGHT_EPS) continue;

    // Elbows first: an authored piece is used when the turn is close to what it
    // was drawn for. Every Corner_* in dungeon-classic is 90°, so in practice
    // this catches square rooms and nothing else — by design, not by accident.
    const elbow = elbowFor(elbows, turn, elbowTol, curr.a.x, curr.a.y);

    let reachIn: number;
    let reachOut: number;
    let fan: Fan | null = null;

    if (elbow) {
      reachIn = reachOut = pieceWorldLength(elbow, wallWidth) / 2;
    } else {
      // No authored piece fits this angle. Cover the vertex with one stone and
      // angle one more along each arm. Nothing is compressed, so this holds up
      // at acute and irregular angles where fitting several pieces to a tight
      // arc would scale them down until the stones visibly squash.
      const cap = [...fanPieces].sort(
        (a, b) => pieceWorldLength(b, wallWidth) - pieceWorldLength(a, wallWidth),
      )[0];
      // Opposite travel directions cancel — fall back to the incoming edge.
      const bx = Math.cos(prev.ang) + Math.cos(curr.ang);
      const by = Math.sin(prev.ang) + Math.sin(curr.ang);
      const through = Math.hypot(bx, by) < 1e-9 ? prev.ang : Math.atan2(by, bx);

      const capAngle = capAngleFor(through, turn);
      const capHalfLen = pieceWorldLength(cap, wallWidth) / 2;
      const capHalfThick = wallWidth / 2;
      const dirIn = norm(prev.ang + Math.PI);
      // How far the cover stone actually reaches back along each arm. Measured
      // at the angle it is really drawn at, or the neighbours get parked against
      // empty space.
      const capIn = extentToward(capHalfLen, capHalfThick, capAngle, dirIn);
      const capOut = extentToward(capHalfLen, capHalfThick, capAngle, curr.ang);

      if (Math.abs(turn) >= ARM_TURN_MIN) {
        const armIn = pick(fanPieces, seed, i * 7919);
        const armOut = pick(fanPieces, seed, i * 7919 + 1);
        const inHalf = pieceWorldLength(armIn, wallWidth) / 2;
        const outHalf = pieceWorldLength(armOut, wallWidth) / 2;

        // Each arm sits just clear of however far the cap actually reaches that
        // way, then tucks back under it by the overlap.
        const dIn = (capIn + inHalf) * (1 - overlap);
        const dOut = (capOut + outHalf) * (1 - overlap);

        fan = { cap, armIn, armOut, capAngle, dIn, dOut };
        // Each side reserves exactly as far as its own arm actually reaches.
        reachIn = dIn + inHalf;
        reachOut = dOut + outHalf;
      } else {
        // Shallow turn: the straights butt straight onto the cover stone.
        fan = { cap, armIn: null, armOut: null, capAngle, dIn: 0, dOut: 0 };
        reachIn = capIn * (1 - overlap);
        reachOut = capOut * (1 - overlap);
      }
    }
    reachIn = Math.min(reachIn, prev.len / 2);
    reachOut = Math.min(reachOut, curr.len / 2);
    // The arms are placed from `dIn`/`dOut`, so clamping only the reserve let a
    // sharp turn on a short edge draw its arm past the neighbouring vertex,
    // floating off the band. A no-op whenever the clamp above did nothing.
    if (fan?.armIn) {
      const half = pieceWorldLength(fan.armIn, wallWidth) / 2;
      fan.dIn = Math.max(0, Math.min(fan.dIn, reachIn - half));
    }
    if (fan?.armOut) {
      const half = pieceWorldLength(fan.armOut, wallWidth) / 2;
      fan.dOut = Math.max(0, Math.min(fan.dOut, reachOut - half));
    }

    junctions.set(i, { turn, reachIn, reachOut, elbow, fan });
  }

  const nodes: WallNode[] = [];

  const push = (
    x: number, y: number, angle: number, pieceId: string, scale: number,
    kind: NodeKind, at: number, sizeScale = 1,
  ) => {
    nodes.push({ t: total > 0 ? at / total : 0, x, y, angle, pieceId, scale, sizeScale, kind });
  };

  // ── Opening end cap ──
  if (!closed && endings.length > 0) {
    const e = edges[0];
    push(e.a.x, e.a.y, e.ang + Math.PI, endings[0].id, 1, 'ending', 0);
  }

  // ── Vertex pieces ──
  for (const [i, j] of junctions) {
    const e = edges[i];
    const travelled = edgeStart[i];
    const vx = e.a.x;
    const vy = e.a.y;
    if (j.elbow) {
      // Authored elbows are drawn with arms at 0° and +90°. The two
      // directions the arms must cover are: back along the incoming edge, and
      // forward along the outgoing edge. Rotating by the incoming angle (the
      // obvious guess) puts an arm on the wrong side half the time — which
      // way round depends on the turn's sign, so pick the arm that lands the
      // other one 90° away.
      const prev = edges[(i - 1 + edges.length) % edges.length];
      const back = norm(prev.ang + Math.PI);
      const fwd = e.ang;
      const rot = norm(fwd - back) > 0 ? back : fwd;
      push(vx, vy, rot, j.elbow.id, 1, 'corner', travelled);
    } else if (j.fan) {
      // One cover stone on the vertex, one angled stone along each arm.
      // Everything is placed at natural size: the earlier approach fitted
      // several pieces to a fillet arc and scaled them to fit, which squashed
      // the stones badly once the turn got acute and the arc got short.
      // Pushed in spatial order (in-arm, cap, out-arm) so downstream code can
      // treat the node list as a walk along the wall.
      const { cap, armIn, armOut, capAngle, dIn, dOut } = j.fan;
      const prev = edges[(i - 1 + edges.length) % edges.length];

      // Each stone gets the spine position it actually occupies, so the three
      // carry DISTINCT t values. Giving all three the vertex's t made them
      // indistinguishable to edit lookup, which keys on t — every drag landed
      // on whichever one came first, so two of the three could never be moved.
      // The in-arm sits before the vertex, which is behind the start of this
      // edge; on a closed wall that wraps onto the last edge.
      if (armIn) {
        const atIn = closed
          ? (travelled - dIn + total) % total
          : Math.max(0, travelled - dIn);
        push(
          vx - Math.cos(prev.ang) * dIn, vy - Math.sin(prev.ang) * dIn,
          prev.ang, armIn.id, 1, 'fan', atIn,
        );
      }
      // Natural size, so it matches the grain of the stones either side of it.
      push(vx, vy, capAngle, cap.id, 1, 'fan', travelled);
      if (armOut) {
        push(
          vx + Math.cos(e.ang) * dOut, vy + Math.sin(e.ang) * dOut,
          e.ang, armOut.id, 1, 'fan', travelled + dOut,
        );
      }
    }
  }

  // ── Straight runs ──
  //
  // A run spans everything between two reserved vertex regions, crossing as
  // many edges as it likes. Laying one run per edge instead was what doubled
  // curve-mode walls: every tessellation edge is shorter than the shortest
  // stone, so each one squeezed in a piece of its own on top of its
  // neighbours' — and each piece pointed along its own edge, so the overrun
  // fanned off the curve as a second strand.

  const wrap = (s: number) =>
    closed ? ((s % total) + total) % total : Math.min(Math.max(s, 0), total);

  /** Point on the spine at arc length `s`. */
  const pointAt = (sIn: number): Point => {
    const s = wrap(sIn);
    let i = edges.length - 1;
    while (i > 0 && edgeStart[i] > s) i--;
    const e = edges[i];
    const u = Math.min(Math.max(s - edgeStart[i], 0), e.len);
    return { x: e.a.x + Math.cos(e.ang) * u, y: e.a.y + Math.sin(e.ang) * u };
  };

  const turnAt = (i: number) =>
    Math.abs(norm(edges[i].ang - edges[(i - 1 + edges.length) % edges.length].ang));

  /**
   * Longest piece a run can use without bowing off its own spine.
   *
   * Two estimates, whichever is tighter: the run's average curvature (sagitta
   * of a chord across a circular arc), and its sharpest single kink. A run
   * with no interior vertices is straight and gets no limit at all, so square
   * rooms lay exactly the stones they always did.
   *
   * ponytail: one limit for the whole run, so a long straight stretch that
   * ends in a bend uses the bend's stone size throughout. Split the run at
   * curvature changes if that ever reads as too fussy.
   */
  const pieceLimit = (s0: number, len: number): number => {
    let sum = 0;
    let peak = 0;
    for (let i = closed ? 0 : 1; i < edges.length; i++) {
      const at = closed && edgeStart[i] < s0 ? edgeStart[i] + total : edgeStart[i];
      if (at <= s0 + 1e-9 || at >= s0 + len - 1e-9) continue;
      const t = turnAt(i);
      sum += t;
      peak = Math.max(peak, t);
    }
    const sag = wallWidth * MAX_CHORD_SAG;
    const byArc = sum > 1e-6 ? Math.sqrt((8 * sag * len) / sum) : Infinity;
    const byKink = peak > 1e-6 ? (2 * sag) / Math.sin(peak / 2) : Infinity;
    return Math.min(byArc, byKink);
  };

  const runs: { s0: number; len: number }[] = [];
  const js = [...junctions.entries()].sort((a, b) => a[0] - b[0]);
  if (js.length === 0) {
    runs.push({ s0: 0, len: total });
  } else if (closed) {
    for (let k = 0; k < js.length; k++) {
      const [i, j] = js[k];
      const [ni, nj] = js[(k + 1) % js.length];
      const s0 = edgeStart[i] + j.reachOut;
      const end = (k + 1 < js.length ? edgeStart[ni] : edgeStart[js[0][0]] + total) - nj.reachIn;
      runs.push({ s0, len: end - s0 });
    }
  } else {
    let cursor = 0;
    for (const [i, j] of js) {
      runs.push({ s0: cursor, len: edgeStart[i] - j.reachIn - cursor });
      cursor = edgeStart[i] + j.reachOut;
    }
    runs.push({ s0: cursor, len: total - cursor });
  }

  const shortestStraight = [...straights].sort(
    (a, b) => pieceWorldLength(a, wallWidth) - pieceWorldLength(b, wallWidth),
  )[0];

  for (let r = 0; r < runs.length; r++) {
    const { s0, len } = runs[r];
    if (len <= 0) continue;
    const limit = pieceLimit(s0, len);
    const usable = straights.filter((p) => pieceWorldLength(p, wallWidth) <= limit);
    const filled = fillRun(
      len,
      usable.length > 0 ? usable : [shortestStraight],
      wallWidth, overlap, seed, r * 1013,
    );
    let along = 0;
    for (const { piece, scale } of filled) {
      const wl = pieceWorldLength(piece, wallWidth) * scale;
      // Placed on the chord between the two spine points it spans, so a piece
      // that crosses a gentle bend sits on the wall instead of shooting off it.
      const p0 = pointAt(s0 + along);
      const p1 = pointAt(s0 + along + wl);
      const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const mid = pointAt(s0 + along + wl / 2);
      const angle =
        chord > wl * 0.2
          ? Math.atan2(p1.y - p0.y, p1.x - p0.x)
          : Math.atan2(mid.y - p0.y, mid.x - p0.x);
      push(
        chord > wl * 0.2 ? (p0.x + p1.x) / 2 : mid.x,
        chord > wl * 0.2 ? (p0.y + p1.y) / 2 : mid.y,
        angle, piece.id, scale, 'straight', wrap(s0 + along + wl / 2),
      );
      along += wl * (1 - overlap);
    }
  }

  // ── Closing end cap ──
  if (!closed && endings.length > 0) {
    const e = edges[edges.length - 1];
    push(e.b.x, e.b.y, e.ang, endings[0].id, 1, 'ending', total);
  }

  // Vertex pieces and runs are pushed in separate passes, so put the list back
  // into spine order — downstream treats it as a walk along the wall.
  return nodes.sort((a, b) => a.t - b.t);
}
