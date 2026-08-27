// Landing a solved stretch of cave band on the map.
//
// The solver answers with an outline and a list of placements (bandSolver.ts);
// turning those into children is this module's whole job. One gesture becomes
// one CompositeCommand: the floor shape's contour, the span's pieces re-laid
// onto the child ids that were already there, and add/remove only for the
// difference in count.
//
// Reusing the ids is not an optimisation. Minting fresh ones for every piece
// would break selection stability and make undo read as a delete-and-recreate
// of a fifth of the cave.

import { getEntriesByType, GRID_CELL_PX, type CatalogEntry } from '../assets/packCatalog';
import { ringHasCurves } from '../shared/bezier';
import {
  AddChildCommand,
  CompositeCommand,
  RemoveChildCommand,
  UpdateChildCommand,
} from '../store/commands';
import type { AnyChild, AssetChild, Command, DungeonLayer, ShapeChild } from '../store/types';
import type { BandSolution, BandSpanPiece } from './bandSolver';
import type { CaveBand, Vec } from './caveBand';

/** The floor outline a band was walked over, and which of its rings. */
export interface BandFloor {
  child: ShapeChild;
  ring: number;
}

/**
 * How far a joint may sit from its own floor ring, in cells.
 *
 * The band rides `BAND_OUT` (0.18) outside the outline and a joint is a
 * midpoint between two overlapping pieces, so a real match is a fraction of a
 * cell out. Two cells is loose enough for a hand-nudged wall and still refuses
 * a ring on the other side of the map.
 */
const MAX_FLOOR_GAP = 2;

const dist = (a: Vec, b: readonly [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * The floor ring this band belongs to.
 *
 * By proximity rather than by any recorded link, for the same reason
 * `detectBands` recovers the run itself that way: nothing in a saved map says
 * which shape a run of rock was laid against. Scored over a spread of joints,
 * not one — a single joint near a doorway can sit as close to the room next
 * door as to its own.
 */
export function floorRingForBand(layer: DungeonLayer, band: CaveBand): BandFloor | null {
  const step = Math.max(1, Math.floor(band.joints.length / 8));
  const probes = band.joints.filter((_, i) => i % step === 0);
  if (!probes.length) return null;

  let best: BandFloor | null = null;
  let bestScore = Infinity;
  for (const child of layer.children) {
    if (child.childType !== 'shape') continue;
    for (const [ring, points] of child.contours.entries()) {
      if (points.length < 4) continue;
      let score = 0;
      for (const p of probes) {
        let near = Infinity;
        for (const q of points) near = Math.min(near, dist(p, q));
        score += near;
      }
      score /= probes.length;
      if (score < bestScore) {
        bestScore = score;
        best = { child, ring };
      }
    }
  }
  return bestScore <= MAX_FLOOR_GAP ? best : null;
}

/**
 * Why this band's outline cannot be edited, or null when it can.
 *
 * The solver deforms the ring's raw points, which is only the truth when the
 * ring IS its points. A curved ring is flattened before anything downstream
 * reads it, so moving the raw points there would commit an outline that does
 * not match what the map draws — a refusal beats a mismatch. Same for a shape
 * carrying a transform: its contours are in its own space and the band's joints
 * are in the world's.
 */
export function bandFloorRefusal(floor: BandFloor | null): string | null {
  if (!floor) return 'this cave wall has no floor outline under it to move';
  if (floor.child.transform) return 'that floor has been moved or scaled — the wall cannot follow it';
  if (ringHasCurves(floor.child.tangents?.[floor.ring]))
    return 'that floor edge is curved — straighten it before re-laying the wall';
  return null;
}

/**
 * The pack entry a kit piece's art lives in.
 *
 * Joined through `material` + `gridSize`, never by parsing the id — that is how
 * the gg-demo squash bug happened. Sorted-first among the variants, which is the
 * same rule `pick` follows in scripts/gen-goblin-warren.mjs, so an edited stretch
 * carries the same art as the stretch the generator laid beside it.
 */
export function bandPieceArt(key: string): CatalogEntry | undefined {
  let best: CatalogEntry | undefined;
  for (const e of getEntriesByType('object')) {
    if (`${e.material}_${e.gridSize}` !== key) continue;
    if (!best || e.id < best.id) best = e;
  }
  return best;
}

/**
 * Every field a re-laid piece overwrites.
 *
 * The store's `updateChild` is a shallow `Object.assign`, so a field left out of
 * the patch silently keeps its old value — which on undo would mean a stone
 * half-rewound. Both halves of every pair are built here, over this one key set,
 * so they cannot drift apart.
 *
 * `visible` is deliberately absent: whether a DM has hidden a stone is not part
 * of where it sits, and re-laying the wall must not un-hide it.
 */
type PlacementPatch = Pick<
  AssetChild,
  | 'name'
  | 'assetId'
  | 'position'
  | 'rotation'
  | 'scale'
  | 'width'
  | 'height'
  | 'tint'
  | 'flipX'
  | 'flipY'
>;

const patchOf = (c: AssetChild): PlacementPatch => ({
  name: c.name,
  assetId: c.assetId,
  position: { x: c.position.x, y: c.position.y },
  rotation: c.rotation,
  scale: c.scale,
  width: c.width,
  height: c.height,
  tint: c.tint,
  flipX: c.flipX,
  flipY: c.flipY,
});

/**
 * A placement as child fields, mapped exactly the way the generator's `emit`
 * does — `width`/`height` are the art's own cell footprint and `scale` is what
 * the fit came out at, never the two folded together.
 */
function placedPatch(p: BandSpanPiece, art: CatalogEntry, tint: string): PlacementPatch {
  return {
    name: p.piece.key.replace(/_/g, ' '),
    assetId: art.id,
    position: { x: p.at.position.x, y: p.at.position.y },
    rotation: p.at.rotation,
    scale: p.at.scale,
    width: art.naturalWidth / GRID_CELL_PX,
    height: art.naturalHeight / GRID_CELL_PX,
    // Carried from the child being reused rather than reset: a DM who tinted a
    // stretch of wall did not ask for that to come undone by a nudge.
    tint,
    // Mirroring lives in the piece, and only ever along its length — a kit
    // piece is never flipped across it (see caveWallKit).
    flipX: false,
    flipY: p.at.flipY ?? false,
  };
}

export interface BandCommitInput {
  layerId: string;
  /** The layer's children as they stand — the `before` half comes from these. */
  children: readonly AnyChild[];
  floor: { id: string; contours: [number, number][][]; ring: number };
  /** The band the solution was solved against. */
  band: CaveBand;
  solution: BandSolution;
  label: string;
}

/**
 * One gesture, one undo entry.
 *
 * Null when the map has moved out from under the solution — a child that was in
 * the span has gone, or its art cannot be resolved. Committing a partial answer
 * would leave a torn band with an undo entry behind it, which is the one outcome
 * worth refusing over.
 */
export function buildBandCommit(input: BandCommitInput): CompositeCommand | null {
  const { band, solution, label, layerId } = input;
  const byId = new Map(input.children.map((c) => [c.id, c]));
  const n = band.pieces.length;
  const spanIds = Array.from(
    { length: solution.count },
    (_, m) => band.pieces[(solution.from + m) % n].childId,
  );

  const art = new Map<string, CatalogEntry>();
  for (const p of solution.pieces) {
    if (art.has(p.piece.key)) continue;
    const found = bandPieceArt(p.piece.key);
    if (!found) return null;
    art.set(p.piece.key, found);
  }

  const commands: Command[] = [];

  // The outline first: the pieces are laid ON it, and a reader stepping through
  // the undo entry sees the floor move before the rock does. Skipped outright
  // when the edit did not touch it (a whole-wall re-walk), so nothing re-unions
  // the map for a contour that did not change.
  const ring = input.floor.contours[input.floor.ring];
  const next = solution.contour.map((p): [number, number] => [p[0], p[1]]);
  if (!sameRing(ring, next)) {
    const after = input.floor.contours.map((r, i) => (i === input.floor.ring ? next : r));
    commands.push(
      new UpdateChildCommand(label, layerId, input.floor.id, { contours: input.floor.contours } as Partial<AnyChild>, {
        contours: after,
      } as Partial<AnyChild>),
    );
  }

  // Reused ids, in walk order. A span that wraps index 0 is still one run of
  // consecutive pieces — spanIds already carries it that way.
  const reused = Math.min(spanIds.length, solution.pieces.length);
  let template: AssetChild | null = null;
  for (let m = 0; m < reused; m++) {
    const child = byId.get(spanIds[m]);
    if (!child || child.childType !== 'asset') return null;
    template ??= child;
    const p = solution.pieces[m];
    commands.push(
      new UpdateChildCommand(
        label,
        layerId,
        child.id,
        patchOf(child) as Partial<AnyChild>,
        placedPatch(p, art.get(p.piece.key)!, child.tint) as Partial<AnyChild>,
      ),
    );
  }

  // Only the difference in count moves: the walk decides how many pieces a
  // stretch takes, and asking for a number is what would put the band back in
  // charge of the outline instead of the other way round.
  for (let m = reused; m < spanIds.length; m++) {
    if (!byId.has(spanIds[m])) return null;
    commands.push(new RemoveChildCommand(label, layerId, spanIds[m]));
  }
  for (let m = reused; m < solution.pieces.length; m++) {
    const p = solution.pieces[m];
    commands.push(
      new AddChildCommand(label, layerId, {
        id: crypto.randomUUID(),
        childType: 'asset',
        objectType: 'asset',
        visible: template?.visible ?? true,
        ...placedPatch(p, art.get(p.piece.key)!, template?.tint ?? '#ffffff'),
      } as AssetChild),
    );
  }

  return commands.length ? new CompositeCommand(label, commands) : null;
}

/** Two rings, point for point. Used to tell a real outline edit from a re-walk. */
export function sameRing(
  a: readonly (readonly [number, number])[] | undefined,
  b: readonly (readonly [number, number])[],
): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-9 && Math.abs(p[1] - b[i][1]) < 1e-9);
}

/**
 * Is this still the band that was solved?
 *
 * `band:<i>` is positional and the run is re-derived from the children, so a
 * child added, removed or moved between press and release can hand back a
 * different band under the same id. Compared by the ids in walk order, which is
 * exactly what the commit addresses.
 */
export function sameBand(a: CaveBand, b: CaveBand): boolean {
  return (
    a.closed === b.closed &&
    a.pieces.length === b.pieces.length &&
    a.pieces.every((p, i) => p.childId === b.pieces[i].childId)
  );
}
