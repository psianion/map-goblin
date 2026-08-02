// Node handles for hand-editing a composed wall (GitHub #19).
//
// Same shape as roomHighlight: a world-space Graphics wired in from sceneGraph,
// redrawn from the render loop, guarded so it only rebuilds when something it
// draws actually changed.

import type { Graphics } from 'pixi.js';
import { useStore } from '../store/store';
import type { DungeonLayer } from '../store/types';
import type { WallEdits } from '../shared/types';
import type { Point } from '../types/geometry';
import { layoutWall, applyWallEdits, withoutNodeOffsets, type WallNode } from './wallLayout';
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

/**
 * Ids of the form `floor:<ringIndex>` address a wall derived from the floor
 * outline rather than a standalone WallSegment. Those rings are recomputed from
 * the shapes on every change, so they have no object of their own to hang edits
 * on — the layer holds them instead, keyed by ring index.
 */
export const FLOOR_WALL_PREFIX = 'floor:';

export function floorRingIndex(wallId: string): number | null {
  if (!wallId.startsWith(FLOOR_WALL_PREFIX)) return null;
  const suffix = wallId.slice(FLOOR_WALL_PREFIX.length);
  // Number('') is 0 and Number(' 1 ') is 1, so a bare Number() would let a
  // malformed id address a real ring. Only plain digits.
  if (!/^\d+$/.test(suffix)) return null;
  return Number(suffix);
}

/** A run being edited, whether it came from a WallSegment or a floor ring. */
export interface EditableRun {
  layer: DungeonLayer;
  id: string;
  points: [number, number][];
  /** Closed rings never get end caps; a drawn chain does. */
  closed: boolean;
  width: number;
  edits: WallEdits | undefined;
}

function activeWall(): EditableRun | null {
  const state = useStore.getState();
  const wallId = state.tools.nodeEditWallId;
  if (!wallId) return null;
  const layer = state.layers.find(
    (l): l is DungeonLayer => l.type === 'dungeon' && l.id === state.ui.activeLayerId,
  );
  if (!layer) return null;

  const ring = floorRingIndex(wallId);
  if (ring !== null) {
    const poly = layer.mergedFloor?.[ring];
    if (!poly || poly.length < 3) return null;
    return {
      layer,
      id: wallId,
      points: poly.map(([x, y]): [number, number] => [x, y]),
      closed: true,
      width: layer.style.wallWidth,
      // Same view the renderer takes: a ring stone's position comes from the
      // outline, so any offset stored against one is dead weight from before
      // that was true, and the handles must not honour it either.
      edits: withoutNodeOffsets(layer.floorWallEdits?.[String(ring)]),
    };
  }

  const wall = layer.standaloneWalls.find((w) => w.id === wallId);
  if (!wall) return null;
  return {
    layer,
    id: wall.id,
    points: wall.points,
    closed: false,
    width: wall.width || layer.style.wallWidth,
    edits: wall,
  };
}

/** The run currently in edit mode, or null. Exported for the edit operations. */
export function activeEditableRun(): EditableRun | null {
  return activeWall();
}

/** Nodes of the wall currently in edit mode, auto-layout plus manual edits. */
export function currentWallNodes(): WallNode[] {
  const run = activeWall();
  if (!run) return [];
  const setId = run.layer.style.wallTextureSetId as WallCategory | undefined;
  if (!setId) return [];
  const specs = buildPieceSpecs(setId);
  if (specs.length === 0) return [];
  const auto = layoutWall(run.points, run.closed, specs, {
    wallWidth: run.width,
    seed: seedForPoints(run.points),
  });
  // The same fill the renderer applies, or the handles would not sit on the
  // stones the wall actually shows.
  return applyWallEdits(auto, run.edits, undefined, { pieces: specs, wallWidth: run.width });
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
        found.id,
        state.tools.selectedNodeT ?? '',
        state.tools.selectedNodeTs.join(','),
        // Coordinates, not just the count: a floor ring is relaid whenever a
        // vertex moves, and the handles have to follow it.
        found.points.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(';'),
        // Both feed layoutWall, so changing either moves every stone. Left out,
        // a width change redrew the wall but not the handles, and picking —
        // which relays from scratch — stopped agreeing with what was drawn.
        found.width,
        found.layer.style.wallTextureSetId ?? '',
        // Zoom is part of the signature because handle size depends on it.
        zoom.toFixed(3),
        JSON.stringify(found.edits?.nodeEdits ?? []),
        JSON.stringify(found.edits?.spanEdits ?? []),
        JSON.stringify(found.edits?.nodeInserts ?? []),
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
  const group = state.tools.selectedNodeTs;

  // The spine itself, so the run reads as one object while being picked apart.
  overlay.poly(found.points.flat(), found.closed);
  overlay.stroke({ color: HANDLE_COLOR, width: r * 0.25, alpha: 0.5 });

  for (const node of nodes) {
    const primary = selectedT !== null && Math.abs(node.t - selectedT) < 1e-9;
    // Three states, one hue ramp rather than a third colour: unpicked is a small
    // translucent dot, a group member is the same amber but hollow, and the
    // primary — the one the keys act on — is filled and largest.
    const inGroup = !primary && group.some((t) => Math.abs(node.t - t) < 1e-9);
    overlay.circle(node.x, node.y, primary ? r * 1.35 : inGroup ? r * 1.2 : r);
    overlay.fill({
      color: primary || inGroup ? SELECTED_COLOR : HANDLE_COLOR,
      alpha: primary ? 0.9 : inGroup ? 0.25 : 0.55,
    });
    overlay.stroke(
      inGroup
        ? { color: SELECTED_COLOR, width: r * 0.3, alpha: 0.95 }
        : { color: 0x0b1220, width: r * 0.18, alpha: 0.8 },
    );
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
