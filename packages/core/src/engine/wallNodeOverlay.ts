// Node handles for hand-editing a composed wall (GitHub #19).
//
// Same shape as roomHighlight: a world-space Graphics wired in from sceneGraph,
// redrawn from the render loop, guarded so it only rebuilds when something it
// draws actually changed.

import { Text, TextStyle, type Graphics } from 'pixi.js';
import { useStore } from '../store/store';
import type { DungeonLayer } from '../store/types';
import type { WallEdits } from '../shared/types';
import type { Point } from '../types/geometry';
import { layoutWall, applyWallEdits, withoutNodeOffsets, type WallNode } from './wallLayout';
import { buildPieceSpecs, seedForPoints } from './wallNodeRenderer';
import type { WallCategory } from '../assets/textureManifest';
import { blockedLayerReason } from './tools/layerGuard';
import { notify } from '../shared/notify';
import { strokeRopeDash, drawNodeHandle, drawEditDim } from './overlayDraw';

/**
 * Pick radius in SCREEN pixels, converted to world units per pick.
 *
 * Sizing these in world units instead makes them shrink with the map: at 30%
 * zoom the pick radius came out around 4px and grabbing a node became a
 * coin flip. Visual sizes live in overlayDraw.ts, shared with the shape
 * outline handles.
 */
const PICK_RADIUS_PX = 10;

let overlay: Graphics | null = null;
let lastSignature = '';
/** Key-hint chip riding next to the selected stone. Created lazily: Text
 *  construction touches canvas text metrics the node test env lacks. */
let chip: Text | null = null;

/** Wire the world-space Graphics the handles are drawn into (see sceneGraph). */
export function initWallNodeOverlay(graphics: Graphics): void {
  overlay = graphics;
  overlay.label = 'wallNodeOverlay';
  lastSignature = '';
  chip?.destroy();
  chip = null;
}

function ensureChip(): Text | null {
  if (!overlay?.parent) return null;
  if (!chip) {
    chip = new Text({
      text: '[ ] rotate · - + size · , . gap',
      style: new TextStyle({
        fontFamily: 'IBM Plex Mono, Consolas, monospace',
        fontSize: 10,
        fill: 0xffffff,
      }),
      resolution: 2,
    });
    chip.label = 'wallNodeChip';
    overlay.parent.addChild(chip);
  }
  return chip;
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

/**
 * The run currently in edit mode, guarded for writing: null (with a warning)
 * once the layer has gone locked or hidden, even if that happened after node
 * edit mode was entered. Every edit — drag begin/nudge/commit, keyboard
 * edits, span/insert — routes through this one function, so guarding it here
 * closes the hole for all of them at once. Restoring a cancelled drag does
 * NOT go through this: it must succeed even on a blocked layer, so it reads
 * the layer straight off the store instead (see wallNodeEdit.ts).
 */
export function activeEditableRun(): EditableRun | null {
  const run = activeWall();
  if (!run) return null;
  const reason = blockedLayerReason(run.layer);
  if (reason) {
    notify.warning(reason);
    return null;
  }
  return run;
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
 * @param view Camera world rect for the edit-mode dim; omitted (tests, old
 *   callers) means no dim quad.
 */
export function renderWallNodeHandles(
  zoom: number,
  view?: { x: number; y: number; width: number; height: number },
): void {
  if (!overlay) return;
  const state = useStore.getState();
  // Draw-time read, not activeEditableRun(): that warns on every call, and a
  // locked layer showing handles that refuse to drag is bad UX but doesn't
  // need a toast every frame — clearing the drawing is enough.
  const run = activeWall();
  const found = run && !blockedLayerReason(run.layer) ? run : null;

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
        // The dim quad covers the camera rect, so panning must redraw it.
        view ? `${view.x.toFixed(2)},${view.y.toFixed(2)}` : '',
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
  const selectedT = state.tools.selectedNodeT;
  const group = state.tools.selectedNodeTs;

  // Everything else steps back 15% so the run being edited carries the light.
  if (view) drawEditDim(overlay, view);

  // The spine as a rope dash: provisional, being worked on — not geometry yet.
  strokeRopeDash(overlay, found.points, found.closed, zoom);

  let primaryNode: WallNode | null = null;
  for (const node of nodes) {
    const primary = selectedT !== null && Math.abs(node.t - selectedT) < 1e-9;
    const inGroup = !primary && group.some((t) => Math.abs(node.t - t) < 1e-9);
    if (primary) primaryNode = node;
    // Stones are circles (they have no corner semantics); the primary — the
    // one the keys act on — gets the double ring, group members ride hollow.
    drawNodeHandle(overlay, node.x, node.y, zoom, {
      circle: true,
      selected: primary,
      hollow: inGroup,
    });
  }

  // The top keys ride next to the selected stone — the status bar carries the
  // full map, this is the glanceable reminder at the point of action.
  const hint = ensureChip();
  if (hint) {
    hint.visible = primaryNode !== null;
    if (primaryNode) {
      const z = zoom > 0 ? zoom : 1;
      hint.scale.set(1 / z);
      hint.position.set(primaryNode.x + 14 / z, primaryNode.y - 22 / z);
      const pad = 4 / z;
      // Text.width already includes the 1/z scale, so these are world units.
      const w = hint.width;
      const h = hint.height;
      overlay.roundRect(
        primaryNode.x + 14 / z - pad,
        primaryNode.y - 22 / z - pad / 2,
        w + pad * 2,
        h + pad,
        3 / z,
      );
      overlay.fill({ color: 0x100d09, alpha: 0.78 });
    }
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
