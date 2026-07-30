import { useStore } from '@/store/store';
import { UpdateWallCommand, UpdateFloorWallEditsCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { mergeNodeEdit, mergeSpanEdit } from '@/engine/wallLayout';
import { buildPieceSpecs } from '@/engine/wallNodeRenderer';
import {
  currentWallNodes,
  activeEditableRun,
  floorRingIndex,
  FLOOR_WALL_PREFIX,
} from '@/engine/wallNodeOverlay';
import type { WallCategory } from '@/assets/textureManifest';
import { snapToNearestWall } from '@/shared/wallSnap';
import type { DungeonLayer } from '@/store/types';
import type { WallNodeEdit, WallEdits } from '@/shared/types';
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
    (l): l is DungeonLayer => l.type === 'dungeon' && l.id === state.ui.activeLayerId,
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
  const ring = floorRingIndex(run.id);
  const before: WallEdits = {
    nodeEdits: run.edits?.nodeEdits,
    spanEdits: run.edits?.spanEdits,
    nodeInserts: run.edits?.nodeInserts,
  };
  if (ring !== null) {
    undoManager.execute(
      new UpdateFloorWallEditsCommand(run.layer.id, String(ring), run.edits, {
        ...before,
        ...patch,
      }),
    );
    return;
  }
  const key = Object.keys(patch)[0] as keyof WallEdits;
  undoManager.execute(
    new UpdateWallCommand(run.layer.id, run.id, { [key]: before[key] }, patch),
  );
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
    (l): l is DungeonLayer => l.type === 'dungeon' && l.id === state.ui.activeLayerId,
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

export function beginNodeDrag(): void {
  const run = activeEditableRun();
  if (!run) return;
  dragWallId = run.id;
  // Snapshot, not a reference — the store's copy is about to change underneath.
  dragBefore = run.edits?.nodeEdits?.map((e) => ({ ...e }));
}

/** Live nudge during a drag. Deliberately bypasses the undo stack. */
export function nudgeWallNode(t: number, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const run = activeEditableRun();
  if (!run) return;
  const nodeEdits = mergeNodeEdit(run.edits?.nodeEdits, { t, dx, dy });
  const ring = floorRingIndex(run.id);
  if (ring !== null) {
    useStore
      .getState()
      .setFloorWallEdits(run.layer.id, String(ring), { ...run.edits, nodeEdits });
    return;
  }
  useStore.getState().updateWall(run.layer.id, run.id, { nodeEdits });
}

/** True while a handle drag is in flight. */
export function isDraggingNode(): boolean {
  return dragWallId !== null;
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
  const before = dragBefore;
  dragWallId = null;
  dragBefore = undefined;
  if (!wallId) return;

  const state = useStore.getState();
  const layer = state.layers.find(
    (l): l is DungeonLayer => l.type === 'dungeon' && l.id === state.ui.activeLayerId,
  );
  if (!layer) return;
  const ring = floorRingIndex(wallId);
  if (ring !== null) {
    const edits = layer.floorWallEdits?.[String(ring)];
    const restored: WallEdits = { ...edits, nodeEdits: before };
    state.setFloorWallEdits(
      layer.id,
      String(ring),
      before === undefined && !edits?.spanEdits && !edits?.nodeInserts ? undefined : restored,
    );
    return;
  }
  state.updateWall(layer.id, wallId, { nodeEdits: before });
}

/** Record the whole gesture as one undoable step. */
export function endNodeDrag(): void {
  const run = activeEditableRun();
  const wallId = dragWallId;
  dragWallId = null;
  const before = dragBefore;
  dragBefore = undefined;
  if (!run || run.id !== wallId) return;

  const after = run.edits?.nodeEdits;
  if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return;

  // State already equals `after`; execute() re-applying it is a harmless no-op
  // and keeps the command's own contract intact.
  const ring = floorRingIndex(run.id);
  if (ring !== null) {
    undoManager.execute(
      new UpdateFloorWallEditsCommand(
        run.layer.id,
        String(ring),
        { ...run.edits, nodeEdits: before },
        { ...run.edits, nodeEdits: after },
      ),
    );
    return;
  }
  undoManager.execute(
    new UpdateWallCommand(run.layer.id, run.id, { nodeEdits: before }, { nodeEdits: after }),
  );
}
