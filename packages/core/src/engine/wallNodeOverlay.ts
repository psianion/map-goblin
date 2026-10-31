// Node handles for hand-editing a composed wall (GitHub #19).
//
// Same shape as roomHighlight: a world-space Graphics wired in from sceneGraph,
// redrawn from the render loop, guarded so it only rebuilds when something it
// draws actually changed.

import { Text, TextStyle, type Graphics } from 'pixi.js';
import { useStore } from '../store/store';
import type { DungeonLayer } from '../store/types';
import type { WallEdits, WallSegment } from '../shared/types';
import type { Point } from '../types/geometry';
import {
  layoutWall,
  applyWallEdits,
  withoutNodeOffsets,
  isClosedSpine,
  type WallNode,
  type WallPieceSpec,
} from './wallLayout';
import { buildPieceSpecs, seedForPoints } from './wallNodeRenderer';
import { isBandSet } from '../assets/packCatalog';
import { blockedLayerReason } from './tools/layerGuard';
import { notify } from '../shared/notify';
import { strokeRopeDash, drawNodeHandle, drawEditDim } from './overlayDraw';
import { ringLook, standaloneWallLook } from '../shared/wallLook';
import { layerDrawStyle, layerLevelLook } from './levelLook';

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

function suffixIndex(id: string, prefix: string): number | null {
  if (!id.startsWith(prefix)) return null;
  const suffix = id.slice(prefix.length);
  // Number('') is 0 and Number(' 1 ') is 1, so a bare Number() would let a
  // malformed id address a real run. Only plain digits.
  if (!/^\d+$/.test(suffix)) return null;
  return Number(suffix);
}

/**
 * Ids of the form `spine:<wallId>` address a DRAWN wall laid with a cave band
 * kit. Its rock is walked live along the wall's own polyline (see
 * caveBandRenderer.ts) and has no stones and no placed pieces, so the thing to
 * edit is that polyline: the handles are its corners, and moving one re-lays
 * the band. Prefixed rather than the bare wall id so everything that reads the
 * mode (the status bars, the key table) can tell it from stone editing on the
 * same wall without resolving the layer.
 */
export const SPINE_WALL_PREFIX = 'spine:';

/** The drawn wall a `spine:` id names, or null for any other id. */
export function spineWallId(wallId: string): string | null {
  return wallId.startsWith(SPINE_WALL_PREFIX) && wallId.length > SPINE_WALL_PREFIX.length
    ? wallId.slice(SPINE_WALL_PREFIX.length)
    : null;
}

export function floorRingIndex(wallId: string): number | null {
  return suffixIndex(wallId, FLOOR_WALL_PREFIX);
}

interface RunBase {
  layer: DungeonLayer;
  id: string;
  /** The spine the handles ride: a wall or ring outline. */
  points: [number, number][];
  /** Closed rings never get end caps; a drawn chain does. */
  closed: boolean;
  width: number;
  /**
   * The texture set the run's stones are composed from: its own pin, or the floor's
   * pin for a ring, else the layer's. The same one `renderNodeWalls` lays it with.
   */
  setId?: string;
}

/**
 * A run being edited. Two sources, which compose their walls differently enough
 * that one shape cannot honestly cover both:
 *
 * - `stones` — a WallSegment or a floor ring. Its wall is composed out of a wall
 *   texture set's pieces along the spine, and hand edits are a `WallEdits` patch
 *   keyed by `t`.
 * - `spine` — a drawn wall on a cave band kit (see SPINE_WALL_PREFIX). Handles
 *   are the polyline's own corners; moving one moves the wall, and the live
 *   band re-lays along it.
 */
export type EditableRun =
  | (RunBase & { kind: 'stones'; edits: WallEdits | undefined })
  | (RunBase & { kind: 'spine'; wall: WallSegment; edits?: undefined });

function activeWall(): EditableRun | null {
  const state = useStore.getState();
  const wallId = state.tools.nodeEditWallId;
  if (!wallId) return null;
  const layer = state.layers.find(
    (l): l is DungeonLayer => l.type === 'dungeon' && l.id === state.ui.activeLayerId,
  );
  if (!layer) return null;

  const spineOf = spineWallId(wallId);
  if (spineOf !== null) {
    const wall = layer.standaloneWalls.find((w) => w.id === spineOf);
    if (!wall || wall.points.length < 2) return null;
    const look = standaloneWallLook(wall, layerDrawStyle(layer));
    return {
      kind: 'spine',
      layer,
      id: wallId,
      points: wall.points,
      closed: isClosedSpine(wall.points),
      width: look.width,
      setId: look.setId,
      wall,
    };
  }

  const ring = floorRingIndex(wallId);
  if (ring !== null) {
    const poly = layer.mergedFloor?.[ring];
    if (!poly || poly.length < 3) return null;
    const look = ringLook(layer, ring, layerLevelLook(layer));
    return {
      kind: 'stones',
      layer,
      id: wallId,
      points: poly.map(([x, y]): [number, number] => [x, y]),
      closed: true,
      width: look.width,
      setId: look.setId,
      // Same view the renderer takes: a ring stone's position comes from the
      // outline, so any offset stored against one is dead weight from before
      // that was true, and the handles must not honour it either.
      edits: withoutNodeOffsets(layer.floorWallEdits?.[String(ring)]),
    };
  }

  const wall = layer.standaloneWalls.find((w) => w.id === wallId);
  if (!wall) return null;
  const look = standaloneWallLook(wall, layerDrawStyle(layer));
  return {
    kind: 'stones',
    layer,
    id: wall.id,
    points: wall.points,
    // A drawn wall can be a loop — a cave's outer ring is one — and the
    // renderer reads its closedness the same way, so the handles keep sitting
    // on the stones that are actually drawn.
    closed: isClosedSpine(wall.points),
    width: look.width,
    setId: look.setId,
    edits: wall,
  };
}

/** Pieces a wall set offers; empty when there is no set at all. */
function wallSetSpecs(setId: string | undefined): WallPieceSpec[] {
  return setId ? buildPieceSpecs(setId) : [];
}

/**
 * The texture set the run `wallId` is drawn with — a drawn wall's own pin, the
 * floor's pin for a ring, else the layer's — the same resolution `activeWall`
 * and `renderNodeWalls` use. Undefined for no set.
 */
export function wallRunSetId(layer: DungeonLayer, wallId: string): string | undefined {
  const ring = floorRingIndex(wallId);
  if (ring !== null) return ringLook(layer, ring, layerLevelLook(layer)).setId;
  const style = layerDrawStyle(layer);
  const wall = layer.standaloneWalls.find((w) => w.id === wallId);
  if (wall) return standaloneWallLook(wall, style).setId;
  return style.wallTextureSetId || undefined;
}

/**
 * How many stones a drawn wall shows: its kit's layout plus its hand edits, as the
 * renderer lays them. Null for a cave band (its rock is a walk, not stones), a wall with
 * no set, or a set still loading.
 */
export function wallStoneCount(layer: DungeonLayer, wall: WallSegment): number | null {
  const look = standaloneWallLook(wall, layerDrawStyle(layer));
  if (!look.setId || isBandSet(look.setId)) return null;
  const specs = wallSetSpecs(look.setId);
  if (specs.length === 0 || wall.points.length < 2) return null;
  const auto = layoutWall(wall.points, isClosedSpine(wall.points), specs, {
    wallWidth: look.width,
    seed: seedForPoints(wall.points),
  });
  return applyWallEdits(auto, wall, undefined, { pieces: specs, wallWidth: look.width }).length;
}

/** Pieces a run's stones come from: its own set, see `RunBase.setId`. */
export function runSetSpecs(run: EditableRun): WallPieceSpec[] {
  return run.setId ? buildPieceSpecs(run.setId) : [];
}

/**
 * Why this layer's walls have no stones to hand-edit, or null when they do.
 *
 * Node handles ARE the wall texture's stones. A cave layer ships no wall
 * texture set on purpose — its walls are invisible sight geometry under
 * painted scatter — so there is nothing to grab there, and entering the mode
 * anyway dimmed the map and invited a click on a stone that cannot exist.
 * Entry points ask this before entering. It reads the same two facts
 * `currentWallNodes` does, through the same `wallSetSpecs`, so a refusal and
 * an empty run can never disagree.
 *
 * `setId` is the set the wall in question resolves to (see `wallRunSetId`);
 * the layer's own set when left out.
 */
export function noWallStonesReason(
  layer: DungeonLayer,
  setId: string | undefined = layerDrawStyle(layer).wallTextureSetId,
): string | null {
  if (!setId) {
    return 'Layer has no wall texture set — pick one to edit its stones';
  }
  // A cave kit's rock is laid by the walk on every redraw, straight from the
  // ring: move the outline and the band follows. There are no stones to nudge.
  if (isBandSet(setId)) {
    return 'Cave rock follows the floor edge — move the outline to move the wall';
  }
  if (wallSetSpecs(setId).length === 0) {
    return 'Wall texture set is still loading — try again in a moment';
  }
  return null;
}

/**
 * The corners of a drawn wall, one handle each, keyed `t = index / count`. A
 * corner has an index, not a `t`; keying it this way lets selection, shift-click
 * and group drag work through the plumbing stones already use. A loop repeats
 * its first point as its last; that copy is the same corner and gets no handle
 * of its own.
 */
export function spineNodes(points: [number, number][]): WallNode[] {
  const closed = isClosedSpine(points);
  const corners = closed ? points.slice(0, -1) : points;
  const n = corners.length;
  return corners.map(([x, y], i): WallNode => {
    const a = corners[i - 1] ?? (closed ? corners[n - 1] : [x, y]);
    const b = corners[i + 1] ?? (closed ? corners[0] : [x, y]);
    return {
      t: i / n,
      x,
      y,
      angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
      pieceId: '',
      scale: 1,
      sizeScale: 1,
      kind: 'corner',
    };
  });
}

/** The corner index a spine handle's `t` names (see {@link spineNodes}). */
export function spineCornerIndex(t: number, points: [number, number][]): number {
  const n = isClosedSpine(points) ? points.length - 1 : points.length;
  return Math.min(Math.max(Math.round(t * n), 0), Math.max(n - 1, 0));
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
  if (run.kind === 'spine') return spineNodes(run.points);
  const specs = runSetSpecs(run);
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
        found.setId ?? layerDrawStyle(found.layer).wallTextureSetId ?? '',
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
  if (!found) {
    // The chip lives beside the overlay, not in it, so clear() leaves it up:
    // leaving the mode with a stone picked stranded it over the map.
    if (chip) chip.visible = false;
    return;
  }

  const nodes = currentWallNodes();
  const selectedT = state.tools.selectedNodeT;
  const group = state.tools.selectedNodeTs;

  // Everything else steps back 15% so the run being edited carries the light.
  // A closed ring spares its own floor; an open chain has no interior.
  if (view) drawEditDim(overlay, view, found.closed ? found.points : undefined);

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
    // A cave wall's table is much shorter — the kit chooses the pieces, so all
    // the DM decides is where the wall goes and how many corners it keeps.
    const keys = found.kind === 'spine' ? 'drag corner · Del remove' : '[ ] rotate · - + size · , . gap';
    if (hint.text !== keys) hint.text = keys;
    const on = primaryNode;
    hint.visible = on !== null;
    if (on) {
      const z = zoom > 0 ? zoom : 1;
      hint.scale.set(1 / z);
      hint.position.set(on.x + 14 / z, on.y - 22 / z);
      const pad = 4 / z;
      // Text.width already includes the 1/z scale, so these are world units.
      const w = hint.width;
      const h = hint.height;
      overlay.roundRect(
        on.x + 14 / z - pad,
        on.y - 22 / z - pad / 2,
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
