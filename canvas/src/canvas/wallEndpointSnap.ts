import type { Point } from '@/types/geometry';
import { useStore } from '@/store/store';
import type { DungeonLayer } from '@/store/types';
import { resolveWalls } from '@dnd/core/src/shared/wallResolve';
import { snapToNearestWall } from '@/shared/wallSnap';

/**
 * Snap radius in world units (grid cells). Wide enough to catch a deliberate
 * join, tight enough not to fight the grid snap that runs before this.
 */
const SNAP_RADIUS = 0.35;

/**
 * How far the floor ring reaches for an endpoint that stopped short of it.
 *
 * One grid subdivision, because that is exactly how far short the grid snap
 * running before this can park a click aimed at the visible floor edge — and a
 * hair more, because the compare inside `snapToNearestWall` is strict and a
 * click lands *on* a subdivision far more often than between two.
 *
 * That gap is invisible: at any working zoom the endpoint looks joined. What it
 * is not is joined — `detectRooms` cuts the floor with a rectangle grown by
 * half a wall width, so a wall ending a subdivision inside the room leaves a
 * bridge of floor at each end, the boolean difference returns one polygon, and
 * a divider drawn corner to corner silently fails to make a second room.
 */
const ringReach = (): number => {
  const { snapEnabled, snapDivision } = useStore.getState().grid;
  return snapEnabled ? (1 / snapDivision) * 1.0001 : SNAP_RADIUS;
};

/**
 * Snap to an existing wall endpoint when within threshold, so consecutive
 * chains actually join instead of leaving a hairline gap the renderer then has
 * to disguise — and failing that, onto the floor ring, which is what a divider
 * drawn across a room is aiming at.
 *
 * Registered as input middleware after gridSnap (see CanvasHost), and scoped to
 * the wall tool — every tool shares the middleware chain, so an unscoped snap
 * would yank the cursor for lights, doors and everything else.
 */
export function wallEndpointSnap(point: Point): Point {
  const state = useStore.getState();
  if (state.tools.activeTool !== 'wall') return point;

  const layer = state.layers.find(
    (l): l is DungeonLayer => l.id === state.ui.activeLayerId && l.type === 'dungeon',
  );
  if (!layer) return point;

  let best: Point | null = null;
  let bestDist = SNAP_RADIUS;

  for (const wall of layer.standaloneWalls) {
    for (const [x, y] of wall.points) {
      const d = Math.hypot(point.x - x, point.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = { x, y };
      }
    }
  }
  if (best) return best;

  // Most of a finished map's walls are the floor outline rather than hand-drawn runs, and
  // `resolveWalls` already promotes every ring edge to a wall — it is how doors have snapped
  // to floor edges since DoorTool. The wall tool was the one consumer that skipped it.
  // Anywhere along the edge, not just its corners: a divider meets a run in the middle of it
  // far more often than at one of its ends.
  const ring = snapToNearestWall(
    [point.x, point.y],
    resolveWalls(layer).filter((w) => w.kind === 'floor'),
    ringReach(),
  );
  return ring ? { x: ring.position[0], y: ring.position[1] } : point;
}
