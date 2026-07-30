// Node handles for hand-editing a composed wall (GitHub #19).
//
// Same shape as roomHighlight: a world-space Graphics wired in from sceneGraph,
// redrawn from the render loop, guarded so it only rebuilds when something it
// draws actually changed.

import type { Graphics } from 'pixi.js';
import { useStore } from '../store/store';
import type { DungeonLayer } from '../store/types';
import type { WallSegment } from '../shared/types';
import type { Point } from '../types/geometry';
import { layoutWall, applyWallEdits, type WallNode } from './wallLayout';
import { buildPieceSpecs, seedForPoints } from './wallNodeRenderer';
import type { WallCategory } from '../assets/textureManifest';

const HANDLE_COLOR = 0x38bdf8;
const SELECTED_COLOR = 0xfbbf24;

/**
 * Handle sizes in SCREEN pixels, converted to world units per draw.
 *
 * Sizing these in world units instead makes them shrink with the map: at 30%
 * zoom the pick radius came out around 4px and grabbing a node became a
 * coin flip.
 */
const HANDLE_RADIUS_PX = 5;
const PICK_RADIUS_PX = 10;

let overlay: Graphics | null = null;
let lastSignature = '';

/** Wire the world-space Graphics the handles are drawn into (see sceneGraph). */
export function initWallNodeOverlay(graphics: Graphics): void {
  overlay = graphics;
  overlay.label = 'wallNodeOverlay';
  lastSignature = '';
}

function activeWall(): { layer: DungeonLayer; wall: WallSegment } | null {
  const state = useStore.getState();
  const wallId = state.tools.nodeEditWallId;
  if (!wallId) return null;
  const layer = state.layers.find(
    (l): l is DungeonLayer => l.type === 'dungeon' && l.id === state.ui.activeLayerId,
  );
  const wall = layer?.standaloneWalls.find((w) => w.id === wallId);
  return layer && wall ? { layer, wall } : null;
}

/** Nodes of the wall currently in edit mode, auto-layout plus manual edits. */
export function currentWallNodes(): WallNode[] {
  const found = activeWall();
  if (!found) return [];
  const { layer, wall } = found;
  const setId = layer.style.wallTextureSetId as WallCategory | undefined;
  if (!setId) return [];
  const specs = buildPieceSpecs(setId);
  if (specs.length === 0) return [];
  const width = wall.width || layer.style.wallWidth;
  const auto = layoutWall(wall.points, false, specs, {
    wallWidth: width,
    seed: seedForPoints(wall.points),
  });
  return applyWallEdits(auto, wall);
}

/**
 * Draw a handle per node. Called every frame, redraws only on change.
 *
 * @param zoom Screen pixels per world unit, so handles keep a constant size.
 */
export function renderWallNodeHandles(zoom: number): void {
  if (!overlay) return;
  const state = useStore.getState();
  const found = activeWall();

  const signature = found
    ? [
        found.wall.id,
        state.tools.selectedNodeT ?? '',
        found.wall.points.length,
        // Zoom is part of the signature because handle size depends on it.
        zoom.toFixed(3),
        JSON.stringify(found.wall.nodeEdits ?? []),
        JSON.stringify(found.wall.spanEdits ?? []),
        JSON.stringify(found.wall.nodeInserts ?? []),
      ].join('|')
    : '';
  if (signature === lastSignature) return;
  lastSignature = signature;

  overlay.clear();
  if (!found) return;

  const nodes = currentWallNodes();
  const safeZoom = zoom > 0 ? zoom : 1;
  const r = HANDLE_RADIUS_PX / safeZoom;
  const selectedT = state.tools.selectedNodeT;

  // The spine itself, so the run reads as one object while being picked apart.
  overlay.poly(found.wall.points.flat(), false);
  overlay.stroke({ color: HANDLE_COLOR, width: r * 0.25, alpha: 0.5 });

  for (const node of nodes) {
    const selected = selectedT !== null && Math.abs(node.t - selectedT) < 1e-9;
    overlay.circle(node.x, node.y, selected ? r * 1.35 : r);
    overlay.fill({ color: selected ? SELECTED_COLOR : HANDLE_COLOR, alpha: selected ? 0.9 : 0.55 });
    overlay.stroke({ color: 0x0b1220, width: r * 0.18, alpha: 0.8 });
  }
}

/**
 * Nearest node handle to a world point, or null.
 *
 * Recomputes the layout rather than reading a cache the renderer fills. The
 * cached version silently returned nothing and cost real time to chase; the
 * draw is signature-guarded, so anything that reads its leftovers depends on
 * when the last redraw happened. One wall's layout is cheap — cheaper than a
 * picker whose correctness depends on render timing.
 *
 * @param zoom Screen pixels per world unit, so the pick radius is in screen px.
 */
export function wallNodeAt(world: Point, zoom: number): WallNode | null {
  const nodes = currentWallNodes();
  if (nodes.length === 0) return null;
  const radius = PICK_RADIUS_PX / (zoom > 0 ? zoom : 1);
  let best: WallNode | null = null;
  let bestDist = radius;
  for (const node of nodes) {
    const d = Math.hypot(world.x - node.x, world.y - node.y);
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  return best;
}
