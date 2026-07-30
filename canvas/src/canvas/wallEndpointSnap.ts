import type { Point } from '@/types/geometry';
import { useStore } from '@/store/store';
import type { DungeonLayer } from '@/store/types';

/**
 * Snap radius in world units (grid cells). Wide enough to catch a deliberate
 * join, tight enough not to fight the grid snap that runs before this.
 */
const SNAP_RADIUS = 0.35;

/**
 * Snap to an existing wall endpoint when within threshold, so consecutive
 * chains actually join instead of leaving a hairline gap the renderer then has
 * to disguise.
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

  return best ?? point;
}
