import { useStore } from '@/store/store';
import { UpdateWallCommand, UpdateFloorWallEditsCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import {
  mergeNodeEdit,
  mergeSpanEdit,
  layoutWall,
  applyWallEdits,
  type WallNode,
} from '@/engine/wallLayout';
import { buildPieceSpecs, seedForPoints } from '@/engine/wallNodeRenderer';
import {
  currentWallNodes,
  activeEditableRun,
  floorRingIndex,
  FLOOR_WALL_PREFIX,
  type EditableRun,
} from '@/engine/wallNodeOverlay';
import {
  beginRingStoneDrag,
  updateRingStoneDrag,
  endRingStoneDrag,
  cancelRingStoneDrag,
  isDraggingRingStone,
} from '@/engine/ringStoneDrag';
import type { WallCategory } from '@/assets/textureManifest';
import { snapToNearestWall } from '@/shared/wallSnap';
import { isLayerEffectivelyVisible } from '@/store/selectors';
import type { DungeonLayer } from '@/store/types';
import type { WallNodeEdit, WallNodeInsert, WallEdits } from '@/shared/types';
import type { Point } from '@/types/geometry';

/** Max distance, in world units, for a double-click to claim a wall. */
const PICK_RADIUS = 0.6;

/**
 * Enter node-edit mode on the wall under the pointer, or leave it if that wall
 * is already being edited. Double-click on the wall itself rather than a panel
 * toggle: the thing being edited is the thing you point at.
 */
export function toggleNodeEditAt(world: Point): boolean {
  const state = useStore.getState();
  const layer = state.layers.find(
    (l): l is DungeonLayer =>
      l.type === 'dungeon' &&
      l.id === state.ui.activeLayerId &&
      isLayerEffectivelyVisible(state, l) &&
      !l.locked,
  );
  if (!layer) return false;

  const hit = snapToNearestWall([world.x, world.y], layer.standaloneWalls, PICK_RADIUS);
  let id = hit?.wallId ?? null;

  // Most walls on a finished map are derived from the floor outline rather than
  // drawn by hand. Their stones are composed the same way and are just as worth
  // adjusting, so fall through to the nearest ring.
  if (!id && layer.mergedFloor) {
    const rings = layer.mergedFloor.map((points, i) => ({
      id: `${FLOOR_WALL_PREFIX}${i}`,
      points,
      // Rings are closed; snapToNearestWall walks a polyline, so repeat the
      // first point to include the closing edge.
      closed: [...points, points[0]],
    }));
    const ringHit = snapToNearestWall(
      [world.x, world.y],
      rings.map((r) => ({
        id: r.id,
        points: r.closed,
        wallType: 'normal' as const,
        direction: 'both' as const,
        color: '#000000',
        width: 1,
        roughness: 0,
      })),
      Math.max(PICK_RADIUS, layer.style.wallWidth),
    );
    id = ringHit?.wallId ?? null;
  }

  const next = id && id !== state.tools.nodeEditWallId ? id : null;
  state.setNodeEditWall(next);
  return next !== null;
}

export function exitNodeEdit(): void {
  if (useStore.getState().tools.nodeEditWallId) {
    useStore.getState().setNodeEditWall(null);
  }
}

/**
 * Write a patch to whichever kind of run is in edit mode.
 *
 * A standalone wall stores its edits on its own WallSegment; a floor-derived
 * ring has no such object — it is recomputed from the shapes on every change —
 * so its edits sit on the layer, keyed by ring index. Both go through one
 * command each, so undo works the same either way.
 */
function writeEdits(patch: Partial<WallEdits>): void {
  const run = activeEditableRun();
  if (!run) return;
  const before: WallEdits = {
    nodeEdits: run.edits?.nodeEdits,
    spanEdits: run.edits?.spanEdits,
    nodeInserts: run.edits?.nodeInserts,
  };
  commitEdits(run, before, { ...before, ...patch });
}

/**
 * Write one before/after pair of edit lists as a single undoable step, giving
 * any stone the change derives a record of its own first.
 */
function commitEdits(run: EditableRun, before: WallEdits, after: WallEdits): void {
  const settled = { ...after, nodeInserts: materialisedInserts(run, after) };
  const ring = floorRingIndex(run.id);
  if (ring !== null) {
    // `run.edits`, not the spelled-out `before`: a ring with no edits at all
    // must undo back to having none rather than to an empty husk of a record.
    undoManager.execute(
      new UpdateFloorWallEditsCommand(run.layer.id, String(ring), run.edits, settled),
    );
    return;
  }
  undoManager.execute(new UpdateWallCommand(run.layer.id, run.id, before, settled));
}

/**
 * Persist the stones an edit derived, so each one becomes a node in its own
 * right.
 *
 * `fillNodeGaps` bridges a seam an edit tore open by cloning the leading stone.
 * Those clones are recomputed every frame and have no record behind them, so
 * every hand edit aimed at one fell through to the stone it was cloned from —
 * Tab on any of them swapped the donor, and the whole run of bridge stones
 * changed together. Writing them out as ordinary inserts gives each its own `t`,
 * which is the anchor every edit is keyed to.
 *
 * Rotation is measured rather than derived: an insert's angle is interpolated
 * from its neighbours, so the correction is whatever closes the gap between that
 * and the angle the bridge was actually drawn at. Re-running the layout to read
 * it back keeps this honest if the interpolation rule ever changes.
 */
function materialisedInserts(run: EditableRun, edits: WallEdits): WallNodeInsert[] | undefined {
  const setId = run.layer.style.wallTextureSetId as WallCategory | undefined;
  if (!setId) return edits.nodeInserts;
  const pieces = buildPieceSpecs(setId);
  if (pieces.length === 0) return edits.nodeInserts;

  const fill = { pieces, wallWidth: run.width };
  const lay = (e: WallEdits): WallNode[] =>
    applyWallEdits(
      layoutWall(run.points, run.closed, pieces, {
        wallWidth: run.width,
        seed: seedForPoints(run.points),
      }),
      e,
      undefined,
      fill,
    );

  const known = edits.nodeInserts ?? [];
  const derived = lay(edits).filter(
    (n) => n.kind === 'inserted' && !known.some((i) => Math.abs(i.t - n.t) < 1e-9),
  );
  if (derived.length === 0) return edits.nodeInserts;

  const withNew: WallEdits = {
    ...edits,
    nodeInserts: [
      ...known,
      ...derived.map((n) => ({ t: n.t, pieceId: n.pieceId, scale: n.sizeScale })),
    ],
  };
  // Second pass: the inserts are in place now, so any angle they came out at
  // that differs from the bridge's own is exactly the rotation to store.
  const placed = lay(withNew);
  return withNew.nodeInserts!.map((ins) => {
    const want = derived.find((n) => Math.abs(n.t - ins.t) < 1e-9);
    if (!want) return ins;
    const got = placed.find((n) => n.kind === 'inserted' && Math.abs(n.t - ins.t) < 1e-9);
    if (!got) return ins;
    const rotate = Math.atan2(Math.sin(want.angle - got.angle), Math.cos(want.angle - got.angle));
    return Math.abs(rotate) < 1e-6 ? ins : { ...ins, rotate };
  });
}

/**
 * Apply one manual adjustment to a node of the run in edit mode.
 *
 * An edit is only ever a patch to the run's `nodeEdits` array, so node editing
 * inherits undo for free.
 */
export function editWallNode(edit: WallNodeEdit): void {
  const run = activeEditableRun();
  if (!run) return;
  writeEdits({ nodeEdits: mergeNodeEdit(run.edits?.nodeEdits, edit) });
  reselectNear(edit.t);
}

/**
 * Keep the selection glued to the stone it was on.
 *
 * Editing relays the run, which shifts every `t` slightly. Leaving the stored
 * `selectedNodeT` behind meant a second keypress landed on a *neighbouring*
 * stone — and once it drifted past the last one, handleNodeKey stopped claiming
 * the key and it fell through to the global shortcuts, so holding `=` zoomed
 * the canvas instead of growing the stone.
 */
function reselectNear(t: number): void {
  const nodes = currentWallNodes();
  if (nodes.length === 0) return;
  let best = nodes[0];
  for (const n of nodes) {
    if (Math.abs(n.t - t) < Math.abs(best.t - t)) best = n;
  }
  useStore.getState().selectNode(best.t);
}

/** Per keypress. Small enough to nudge, large enough to be worth a press. */
const ROTATE_STEP = (5 * Math.PI) / 180;
const SCALE_STEP = 1.1;
/** Seam adjustment per keypress, in world units. */
const GAP_STEP = 0.05;

/** Widen or tighten the seam after the selected node. */
function adjustSpan(t: number, gap: number): void {
  const run = activeEditableRun();
  if (!run) return;
  writeEdits({ spanEdits: mergeSpanEdit(run.edits?.spanEdits, { t, gap }) });
  reselectNear(t);
}

/**
 * Drop an extra stone just before or after the selected one.
 *
 * Offset by a hair of the spine rather than exactly on the neighbour's `t`, so
 * the new stone gets its own edit anchor instead of colliding with one that is
 * already there.
 */
function insertStone(t: number, direction: -1 | 1): void {
  const run = activeEditableRun();
  if (!run) return;
  const nodes = currentWallNodes();
  const node = nodes.find((n) => Math.abs(n.t - t) < 1e-9);
  if (!node) return;

  // Halfway to the neighbour on that side, so it lands in the seam rather than
  // on top of a stone.
  const sorted = [...nodes].sort((a, b) => a.t - b.t);
  const i = sorted.findIndex((n) => Math.abs(n.t - t) < 1e-9);
  const neighbour = sorted[i + direction];
  const at = neighbour ? (node.t + neighbour.t) / 2 : node.t + direction * 0.005;
  const clamped = Math.min(Math.max(at, 0), 1);

  writeEdits({
    nodeInserts: [...(run.edits?.nodeInserts ?? []), { t: clamped, pieceId: node.pieceId }],
  });
  // Select the stone just added, so it can be rotated or resized straight away.
  reselectNear(clamped);
}

/**
 * Swap the piece under the selected node for the next one the set offers.
 *
 * Cycles the wall set's own straights and rocks — the pieces that can stand in
 * for one another along a run. Corners and end caps are excluded: they are
 * placed for a specific role and swapping one in mid-run reads as a mistake.
 */
function cyclePiece(t: number, direction: number): void {
  const run = activeEditableRun();
  if (!run) return;

  const state = useStore.getState();
  const layer = state.layers.find(
    (l): l is DungeonLayer =>
      l.type === 'dungeon' &&
      l.id === state.ui.activeLayerId &&
      isLayerEffectivelyVisible(state, l) &&
      !l.locked,
  );
  const setId = layer?.style.wallTextureSetId as WallCategory | undefined;
  if (!setId) return;

  const swappable = buildPieceSpecs(setId).filter(
    (p) => p.role === 'straight' || p.role === 'rock',
  );
  if (swappable.length === 0) return;

  const node = currentWallNodes().find((n) => Math.abs(n.t - t) < 1e-9);
  if (!node) return;

  const at = swappable.findIndex((p) => p.id === node.pieceId);
  const next = swappable[(at + direction + swappable.length) % swappable.length];

  writeEdits({ nodeEdits: mergeNodeEdit(run.edits?.nodeEdits, { t, pieceId: next.id }) });
}

/**
 * Keyboard adjustments for the selected node.
 *
 * Returns true when the key was consumed, so the caller can stop it reaching
 * the global shortcut table — Delete is already bound there to removing the
 * shape selection, and with a node selected it must mean this node.
 */
export function handleNodeKey(key: string, t: number): boolean {
  switch (key) {
    case '[':
      editWallNode({ t, rotate: -ROTATE_STEP });
      return true;
    case ']':
      editWallNode({ t, rotate: ROTATE_STEP });
      return true;
    case '-':
    case '_':
      editWallNode({ t, scale: 1 / SCALE_STEP });
      return true;
    case '=':
    case '+':
      editWallNode({ t, scale: SCALE_STEP });
      return true;
    case ',':
    case '<':
      adjustSpan(t, -GAP_STEP);
      return true;
    case '.':
    case '>':
      adjustSpan(t, GAP_STEP);
      return true;
    case 'Tab':
      cyclePiece(t, 1);
      return true;
    // Add a stone on one side of this one. Bracket keys already rotate, so the
    // shifted pair sits next to them for "same axis, bigger effect".
    case '{':
      insertStone(t, -1);
      return true;
    case '}':
      insertStone(t, 1);
      return true;
    case 'Delete':
    case 'Backspace':
      editWallNode({ t, removed: true });
      // The node it pointed at no longer exists.
      useStore.getState().selectNode(null);
      return true;
    default:
      return false;
  }
}

// ─── Drag: one undo entry per gesture, not per frame ──────────────────
//
// A drag emits a pointermove every few pixels. Pushing a command per move made
// undo walk the gesture back a fraction at a time — five presses to reverse one
// small drag. So the drag writes straight to the store and a single command is
// recorded on release, from the state captured on press.

let dragBefore: WallNodeEdit[] | undefined;
let dragWallId: string | null = null;
/** The layer the drag began on — rewindDrag resolves against this, not
 *  whatever the active layer happens to be at cancel/release time. */
let dragLayerId: string | null = null;

/**
 * @param ts Stones the gesture will move. On a floor ring the drag is not a
 *   cosmetic offset at all — the stones stand on the outline, so it becomes an
 *   edit of the outline itself and these say which stretch of it moves.
 */
export function beginNodeDrag(ts: number[] = []): void {
  const run = activeEditableRun();
  if (!run) return;
  dragWallId = run.id;
  dragLayerId = run.layer.id;
  const ring = floorRingIndex(run.id);
  if (ring !== null) {
    beginRingStoneDrag(run.layer, ring, ts);
    return;
  }
  // Snapshot, not a reference — the store's copy is about to change underneath.
  dragBefore = run.edits?.nodeEdits?.map((e) => ({ ...e }));
}

/**
 * Live nudge during a drag. Deliberately bypasses the undo stack.
 *
 * Takes the whole selection rather than one node so a group move is one write:
 * merging them one at a time would read `run.edits` back from a store that the
 * previous merge in the same frame had already moved on from.
 */
export function nudgeWallNode(ts: number[], dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  if (isDraggingRingStone()) {
    updateRingStoneDrag(dx, dy);
    return;
  }
  if (ts.length === 0) return;
  const run = activeEditableRun();
  if (!run || floorRingIndex(run.id) !== null) return;
  let nodeEdits = run.edits?.nodeEdits;
  for (const t of ts) nodeEdits = mergeNodeEdit(nodeEdits, { t, dx, dy });
  useStore.getState().updateWall(run.layer.id, run.id, { nodeEdits });
}

/** True while a handle drag is in flight. */
export function isDraggingNode(): boolean {
  return dragWallId !== null;
}

/**
 * Put a standalone wall's live-written nodeEdits back to `before`.
 *
 * A rewind, not an edit: this has to succeed even if the layer went locked
 * or hidden mid-drag, or an edit made just before locking becomes stuck
 * with no way to undo it. So no lock/visible check here — only that the
 * layer still exists to write the rewind into.
 *
 * Resolves against the layer id the drag actually began on, not
 * `ui.activeLayerId`: switching the active layer mid-drag must not make the
 * rewind silently miss the layer the live nudge was written into.
 */
function rewindDrag(layerId: string, wallId: string, before: WallNodeEdit[] | undefined): void {
  const state = useStore.getState();
  const layer = state.layers.find(
    (l): l is DungeonLayer => l.type === 'dungeon' && l.id === layerId,
  );
  if (!layer) return;
  state.updateWall(layer.id, wallId, { nodeEdits: before });
}

/**
 * Abandon the gesture and put the run back the way it was.
 *
 * Needed because the drag writes straight to the store: leaving edit mode
 * mid-drag used to make endNodeDrag's `activeEditableRun()` return null, so it
 * recorded nothing and the half-finished move stuck with no undo entry for it.
 */
export function cancelNodeDrag(): void {
  const wallId = dragWallId;
  const layerId = dragLayerId;
  const before = dragBefore;
  dragWallId = null;
  dragLayerId = null;
  dragBefore = undefined;
  if (isDraggingRingStone()) {
    cancelRingStoneDrag();
    return;
  }
  if (!wallId || !layerId) return;
  rewindDrag(layerId, wallId, before);
}

/** Record the whole gesture as one undoable step. */
export function endNodeDrag(): void {
  const wallId = dragWallId;
  const layerId = dragLayerId;
  dragWallId = null;
  dragLayerId = null;
  const before = dragBefore;
  dragBefore = undefined;
  if (isDraggingRingStone()) {
    // Re-check here too: beginNodeDrag gated entry, but the layer can have
    // locked or hidden in the time between the last nudge and release. Ring
    // stones have no dx/dy of their own to rewind — the drag lives entirely
    // in the outline editor's own before/after — so blocked here means
    // cancelling that session instead of landing it.
    if (!activeEditableRun()) {
      cancelRingStoneDrag();
      return;
    }
    // The outline editor owns this gesture and lands it as one command of its
    // own — geometry and relaid stones together.
    endRingStoneDrag();
    return;
  }

  const run = activeEditableRun();
  if (!run || run.id !== wallId) {
    // Blocked mid-drag (the layer locked or hid, or the active layer switched
    // away, between the last nudge and pointer-up): the live nudge already
    // landed in the store with no undo entry behind it. Put it back rather
    // than leave it stuck.
    if (wallId && layerId) rewindDrag(layerId, wallId, before);
    return;
  }
  const after = run.edits?.nodeEdits;
  if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return;

  // State already equals `after` bar the stones the drag derived; execute()
  // re-applying it is what writes those out.
  commitEdits(
    run,
    { nodeEdits: before, spanEdits: run.edits?.spanEdits, nodeInserts: run.edits?.nodeInserts },
    { nodeEdits: after, spanEdits: run.edits?.spanEdits, nodeInserts: run.edits?.nodeInserts },
  );
}
