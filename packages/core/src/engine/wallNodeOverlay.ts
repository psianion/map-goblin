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
import {
  layoutWall,
  applyWallEdits,
  withoutNodeOffsets,
  isClosedSpine,
  type WallNode,
  type WallPieceSpec,
} from './wallLayout';
import { buildPieceSpecs, seedForPoints } from './wallNodeRenderer';
import { blockedLayerReason } from './tools/layerGuard';
import { notify } from '../shared/notify';
import { strokeRopeDash, drawNodeHandle, drawEditDim } from './overlayDraw';
import { bandJointPoint } from './bandSolver';
import { detectBands, type CaveBand } from './caveBand';
import { projectPointOntoLineSegment } from '../shared/wallSnap';

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

/**
 * Ids of the form `band:<index>` address a cave band: a run of placed rock
 * children that nothing in the map records as belonging together, recovered by
 * `detectBands`. Positional for the same reason a ring index is — it only means
 * anything against the layer's children as they stand right now.
 */
export const BAND_WALL_PREFIX = 'band:';

function suffixIndex(id: string, prefix: string): number | null {
  if (!id.startsWith(prefix)) return null;
  const suffix = id.slice(prefix.length);
  // Number('') is 0 and Number(' 1 ') is 1, so a bare Number() would let a
  // malformed id address a real run. Only plain digits.
  if (!/^\d+$/.test(suffix)) return null;
  return Number(suffix);
}

export function floorRingIndex(wallId: string): number | null {
  return suffixIndex(wallId, FLOOR_WALL_PREFIX);
}

export function bandRunIndex(wallId: string): number | null {
  return suffixIndex(wallId, BAND_WALL_PREFIX);
}

interface RunBase {
  layer: DungeonLayer;
  id: string;
  /** The spine the handles ride: a wall or ring outline, or a band's joints. */
  points: [number, number][];
  /** Closed rings never get end caps; a drawn chain does. */
  closed: boolean;
  width: number;
}

/**
 * A run being edited. Two sources, which compose their walls differently enough
 * that one shape cannot honestly cover both:
 *
 * - `stones` — a WallSegment or a floor ring. Its wall is composed out of a wall
 *   texture set's pieces along the spine, and hand edits are a `WallEdits` patch
 *   keyed by `t`.
 * - `band` — a cave wall: a run of placed asset children with no texture set
 *   behind it (see caveBand.ts). Handles ride the joints between pieces, and
 *   there is no patch to write — the pieces themselves are what moves.
 */
export type EditableRun =
  | (RunBase & { kind: 'stones'; edits: WallEdits | undefined })
  | (RunBase & { kind: 'band'; band: CaveBand; edits?: undefined });

function activeWall(): EditableRun | null {
  const state = useStore.getState();
  const wallId = state.tools.nodeEditWallId;
  if (!wallId) return null;
  const layer = state.layers.find(
    (l): l is DungeonLayer => l.type === 'dungeon' && l.id === state.ui.activeLayerId,
  );
  if (!layer) return null;

  const bandAt = bandRunIndex(wallId);
  if (bandAt !== null) {
    // Re-detected rather than cached: the band is derived from the children, so
    // a cache would go stale exactly when a piece moves. Only ever runs while
    // band edit mode is open, over the layer's asset children (127 on the
    // Warren), which is well under a frame.
    const band = detectBands(layer)[bandAt];
    if (!band || band.joints.length < 2) return null;
    return {
      kind: 'band',
      layer,
      id: wallId,
      points: band.joints.map(([x, y]): [number, number] => [x, y]),
      closed: band.closed,
      width: layer.style.wallWidth,
      band,
    };
  }

  const ring = floorRingIndex(wallId);
  if (ring !== null) {
    const poly = layer.mergedFloor?.[ring];
    if (!poly || poly.length < 3) return null;
    return {
      kind: 'stones',
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
    kind: 'stones',
    layer,
    id: wall.id,
    points: wall.points,
    // A drawn wall can be a loop — a cave's outer ring is one — and the
    // renderer reads its closedness the same way, so the handles keep sitting
    // on the stones that are actually drawn.
    closed: isClosedSpine(wall.points),
    width: wall.width || layer.style.wallWidth,
    edits: wall,
  };
}

/** Pieces the layer's wall set offers; empty when it has no set at all. */
function wallSetSpecs(layer: DungeonLayer): WallPieceSpec[] {
  const setId = layer.style.wallTextureSetId;
  return setId ? buildPieceSpecs(setId) : [];
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
 */
export function noWallStonesReason(layer: DungeonLayer): string | null {
  if (!layer.style.wallTextureSetId) {
    return 'Layer has no wall texture set — pick one to edit its stones';
  }
  if (wallSetSpecs(layer).length === 0) {
    return 'Wall texture set is still loading — try again in a moment';
  }
  return null;
}

/**
 * The band under a world point, as a `band:<index>` id, or null.
 *
 * Tested against the whole spine rather than the joints alone: the double-click
 * lands wherever the rock is, and on a six-cell straight the nearest joint can
 * be three cells away. Which joint gets the handle is `wallNodeAt`'s problem,
 * later and at a much tighter radius.
 */
export function bandRunAt(layer: DungeonLayer, world: Point, radius: number): string | null {
  let best: string | null = null;
  let bestDist = radius;
  for (const [i, band] of detectBands(layer).entries()) {
    // A closed band's joints do not repeat the first, so the seam between the
    // last piece and the first would be a gap in the pick otherwise.
    const spine = band.closed ? [...band.joints, band.joints[0]] : band.joints;
    for (let k = 0; k < spine.length - 1; k++) {
      const { distance } = projectPointOntoLineSegment([world.x, world.y], spine[k], spine[k + 1]);
      if (distance < bestDist) {
        bestDist = distance;
        best = `${BAND_WALL_PREFIX}${i}`;
      }
    }
  }
  return best;
}

/**
 * A joint's synthetic position along the band.
 *
 * A joint has an index, not a `t`. Widening `selectedNodeT` / `selectedNodeTs`
 * to carry either would touch every selection call site; `index / count` keys a
 * joint into the plumbing that is already there — toggleNodeSelection,
 * shift-click, group drag and the status bar all keep working untouched.
 */
export function bandJointT(index: number, count: number): number {
  return count > 0 ? index / count : 0;
}

/**
 * The `t` of the transient insert handle, or null when there is none.
 *
 * Transience used to be read off the `t` being fractional, and that inference is
 * what broke: an undo or a redo puts a band with a different joint count back
 * under a selection that kept its old `t`, which then decodes against the new
 * count to a fraction and reads as a handle nobody inserted — Delete right after
 * an undo silently deselected instead of straightening. Only the insert gesture
 * puts a handle between two joints, so only it says so.
 *
 * Module state rather than a store field on purpose: nothing about the handle
 * survives a deselect, a mode exit or a reload, which is the whole lifetime it
 * asks for. Compared by value, so a `t` left behind by a gesture that has since
 * ended cannot claim a later selection that happens to be keyed elsewhere.
 */
let transientT: number | null = null;

/** Mark — or, with null, take back — the handle the insert gesture dropped. */
export function setBandTransientT(t: number | null): void {
  transientT = t;
}

/**
 * The joint a synthetic `t` came from — whole for a real joint, fractional for
 * the transient insert handle sitting between two of them.
 *
 * Exact inverse of {@link bandJointT} for a real joint: `index / count * count`
 * lands within a rounding error of the integer for any band a map can hold, and
 * that error is snapped away.
 *
 * The insert handle's fraction is kept: rounding it to the nearest joint would
 * hand the solver the wrong span and the DM a handle that jumped half a stone
 * the moment it was dragged. Every other `t` names a real joint — a fraction
 * there is a `t` keyed to a joint count that has since moved (an undo, a redo, a
 * re-lay, another window), and the joint it lands nearest is the honest reading
 * of it. Clamped, because a count that shrank can put the nearest one past the
 * end of the band.
 */
export function bandJointIndex(t: number, count: number): number {
  const raw = t * count;
  const near = Math.round(raw);
  if (t !== transientT) return Math.min(Math.max(near, 0), Math.max(count - 1, 0));
  return Math.abs(raw - near) < 1e-6 ? near : raw;
}

/**
 * One handle per joint of a band, in walk order, plus the transient insert
 * handle if one is selected.
 *
 * That handle is nothing but a selection: a fractional `t` and the mark beside
 * it (see {@link setBandTransientT}) are the whole of it, so there is no store
 * write to make and none to undo. Deselect it, or leave the mode, and it is gone
 * — which is the whole lifetime the insert gesture asks for. It becomes a real
 * joint only where a drag's re-walk lands a seam.
 */
function bandNodes(band: CaveBand, selectedT: number | null): WallNode[] {
  const n = band.joints.length;
  const nodes = band.joints.map(([x, y], i): WallNode => {
    // Direction of travel through the joint, wrapping only when the band does —
    // a free end has one neighbour, and borrowing the other end's would point
    // the handle back across the cave.
    const a = band.joints[i - 1] ?? (band.closed ? band.joints[n - 1] : [x, y]);
    const b = band.joints[i + 1] ?? (band.closed ? band.joints[0] : [x, y]);
    // The piece that STARTS here: on a closed band joint i follows piece i, on
    // an open one it follows piece i-1. The trailing free end has no such piece,
    // so it names the one that ends there.
    const piece = band.closed
      ? band.pieces[(i + 1) % band.pieces.length]
      : band.pieces[Math.min(i, band.pieces.length - 1)];
    return {
      t: bandJointT(i, n),
      x,
      y,
      angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
      pieceId: piece?.piece.key ?? '',
      scale: 1,
      sizeScale: 1,
      // A joint is where the band turns over, which is what a corner node means
      // everywhere else. Nothing draws off it — band handles are circles like
      // the rest — but a straight would be a lie.
      kind: 'corner',
    };
  });

  const at = selectedT === null ? null : bandJointIndex(selectedT, n);
  // Strictly between two joints: a closed band's last span wraps back to its
  // first, an open run has nothing past its free ends.
  if (at !== null && !Number.isInteger(at) && at > 0 && at < (band.closed ? n : n - 1)) {
    const lo = Math.floor(at);
    const a = band.joints[lo];
    const b = band.joints[(lo + 1) % n];
    const [x, y] = bandJointPoint(band, at);
    nodes.push({
      t: selectedT!,
      x,
      y,
      angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
      // The piece the handle stands on, named the same way a joint names the
      // one that starts there.
      pieceId:
        (band.closed ? band.pieces[(lo + 1) % band.pieces.length] : band.pieces[lo])?.piece.key ??
        '',
      scale: 1,
      sizeScale: 1,
      kind: 'corner',
    });
  }
  return nodes;
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
  if (run.kind === 'band') return bandNodes(run.band, useStore.getState().tools.selectedNodeT);
  const specs = wallSetSpecs(run.layer);
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
    // A band's table is much shorter — the kit chooses the pieces, so all the
    // DM decides is where the wall goes and how many corners it keeps.
    const keys =
      found.kind === 'band'
        ? 'drag joint · { } insert · Del straighten · Tab re-lay wall'
        : '[ ] rotate · - + size · , . gap';
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
