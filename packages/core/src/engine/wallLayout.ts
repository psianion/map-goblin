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

const DEFAULTS = {
  elbowTolerance: 15 * (Math.PI / 180),
  // ponytail: tuned by eye against dungeon-classic at play zoom. Per-set values
  // belong in WALL_SET_DEFAULTS if a pack's stones ever sit differently.
  overlap: 0.12,
};

/** Below this turn the vertex is treated as straight-through. */
const STRAIGHT_EPS = 4 * (Math.PI / 180);

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
 */
function fillRun(
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
): WallNode[] {
  if (!edits) return nodes;
  const { nodeEdits, spanEdits, nodeInserts } = edits;
  if (!nodeEdits?.length && !spanEdits?.length && !nodeInserts?.length) return nodes;

  let out = nodes.map((n) => ({ ...n }));

  for (const edit of nodeEdits ?? []) {
    const i = nearestNode(out, edit.t, tolerance);
    if (i < 0) continue;
    const node = out[i];
    if (edit.removed) { node.removed = true; continue; }
    if (edit.pieceId !== undefined) node.pieceId = edit.pieceId;
    if (edit.rotate !== undefined) node.angle += edit.rotate;
    // Onto sizeScale, not scale: a resize must not be mistaken for the run's
    // auto-fit stretch, and it grows the stone on both axes.
    if (edit.scale !== undefined) node.sizeScale *= edit.scale;
    if (edit.dx !== undefined) node.x += edit.dx;
    if (edit.dy !== undefined) node.y += edit.dy;
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
    // Position and angle are interpolated from whichever auto nodes bracket t,
    // so an inserted stone lands on the spine rather than at the origin.
    const before = [...out].reverse().find((n) => n.t <= ins.t) ?? out[0];
    const after = out.find((n) => n.t >= ins.t) ?? out[out.length - 1];
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

  return out.sort((a, b) => a.t - b.t);
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
  const elbows = pieces.filter((p) => p.role === 'corner');
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

  const total = edges.reduce((s, e) => s + e.len, 0);

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
    const elbow =
      elbows.find((p) => Math.abs(Math.abs(turn) - (p.authoredTurn ?? Math.PI / 2)) <= elbowTol) ??
      null;

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
  let travelled = 0;

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

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const startJ = junctions.get(i);
    const endJ = junctions.get((i + 1) % edges.length);

    // Reserve the vertex regions at both ends of this edge. This edge leaves
    // the junction at its head and arrives at the junction at its tail, so it
    // takes the outgoing reserve of one and the incoming reserve of the other.
    const headReserve = startJ ? startJ.reachOut : 0;
    const tailReserve =
      endJ && (closed || i + 1 < edges.length) ? endJ.reachIn : 0;

    // ── Vertex at the head of this edge ──
    if (startJ) {
      const vx = e.a.x;
      const vy = e.a.y;
      if (startJ.elbow) {
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
        push(vx, vy, rot, startJ.elbow.id, 1, 'corner', travelled);
      } else if (startJ.fan) {
        // One cover stone on the vertex, one angled stone along each arm.
        // Everything is placed at natural size: the earlier approach fitted
        // several pieces to a fillet arc and scaled them to fit, which squashed
        // the stones badly once the turn got acute and the arc got short.
        // Pushed in spatial order (in-arm, cap, out-arm) so downstream code can
        // treat the node list as a walk along the wall.
        const { cap, armIn, armOut, capAngle, dIn, dOut } = startJ.fan;
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

    // ── Straight run between the two reserved vertex regions ──
    const runLength = e.len - headReserve - tailReserve;
    const filled = fillRun(runLength, straights, wallWidth, overlap, seed, i * 1013);
    let along = headReserve;
    for (const { piece, scale } of filled) {
      const wl = pieceWorldLength(piece, wallWidth) * scale;
      const cx = e.a.x + Math.cos(e.ang) * (along + wl / 2);
      const cy = e.a.y + Math.sin(e.ang) * (along + wl / 2);
      push(cx, cy, e.ang, piece.id, scale, 'straight', travelled + along + wl / 2);
      along += wl * (1 - overlap);
    }

    travelled += e.len;
  }

  // ── Closing end cap ──
  if (!closed && endings.length > 0) {
    const e = edges[edges.length - 1];
    push(e.b.x, e.b.y, e.ang, endings[0].id, 1, 'ending', total);
  }

  return nodes;
}
