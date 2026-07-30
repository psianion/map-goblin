import { useStore } from '@/store/store';
import { UpdateWallCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { mergeNodeEdit, mergeSpanEdit } from '@/engine/wallLayout';
import { buildPieceSpecs } from '@/engine/wallNodeRenderer';
import { currentWallNodes } from '@/engine/wallNodeOverlay';
import type { WallCategory } from '@/assets/textureManifest';
import { snapToNearestWall } from '@/shared/wallSnap';
import type { DungeonLayer } from '@/store/types';
import type { WallNodeEdit } from '@/shared/types';
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
  const next = hit && hit.wallId !== state.tools.nodeEditWallId ? hit.wallId : null;
  state.setNodeEditWall(next);
  return next !== null;
}

export function exitNodeEdit(): void {
  if (useStore.getState().tools.nodeEditWallId) {
    useStore.getState().setNodeEditWall(null);
  }
}

function activeWall() {
  const state = useStore.getState();
  const wallId = state.tools.nodeEditWallId;
  if (!wallId) return null;
  const layer = state.layers.find(
    (l): l is DungeonLayer => l.type === 'dungeon' && l.id === state.ui.activeLayerId,
  );
  const wall = layer?.standaloneWalls.find((w) => w.id === wallId);
  return layer && wall ? { layerId: layer.id, wall } : null;
}

/**
 * Apply one manual adjustment to a node of the wall in edit mode.
 *
 * Rides UpdateWallCommand, so node editing inherits undo for free — an edit is
 * only ever a patch to the wall's own `nodeEdits` array.
 */
export function editWallNode(edit: WallNodeEdit): void {
  const found = activeWall();
  if (!found) return;
  const { layerId, wall } = found;
  undoManager.execute(
    new UpdateWallCommand(
      layerId,
      wall.id,
      { nodeEdits: wall.nodeEdits },
      { nodeEdits: mergeNodeEdit(wall.nodeEdits, edit) },
    ),
  );
}

/** Per keypress. Small enough to nudge, large enough to be worth a press. */
const ROTATE_STEP = (5 * Math.PI) / 180;
const SCALE_STEP = 1.1;
/** Seam adjustment per keypress, in world units. */
const GAP_STEP = 0.05;

/** Widen or tighten the seam after the selected node. */
function adjustSpan(t: number, gap: number): void {
  const found = activeWall();
  if (!found) return;
  const { layerId, wall } = found;
  undoManager.execute(
    new UpdateWallCommand(
      layerId,
      wall.id,
      { spanEdits: wall.spanEdits },
      { spanEdits: mergeSpanEdit(wall.spanEdits, { t, gap }) },
    ),
  );
}

/**
 * Swap the piece under the selected node for the next one the set offers.
 *
 * Cycles the wall set's own straights and rocks — the pieces that can stand in
 * for one another along a run. Corners and end caps are excluded: they are
 * placed for a specific role and swapping one in mid-run reads as a mistake.
 */
function cyclePiece(t: number, direction: number): void {
  const found = activeWall();
  if (!found) return;
  const { layerId, wall } = found;

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

  undoManager.execute(
    new UpdateWallCommand(
      layerId,
      wall.id,
      { nodeEdits: wall.nodeEdits },
      { nodeEdits: mergeNodeEdit(wall.nodeEdits, { t, pieceId: next.id }) },
    ),
  );
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
  const found = activeWall();
  if (!found) return;
  dragWallId = found.wall.id;
  // Snapshot, not a reference — the store's copy is about to change underneath.
  dragBefore = found.wall.nodeEdits?.map((e) => ({ ...e }));
}

/** Live nudge during a drag. Deliberately bypasses the undo stack. */
export function nudgeWallNode(t: number, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const found = activeWall();
  if (!found) return;
  const { layerId, wall } = found;
  useStore.getState().updateWall(layerId, wall.id, {
    nodeEdits: mergeNodeEdit(wall.nodeEdits, { t, dx, dy }),
  });
}

/** Record the whole gesture as one undoable step. */
export function endNodeDrag(): void {
  const found = activeWall();
  const wallId = dragWallId;
  dragWallId = null;
  const before = dragBefore;
  dragBefore = undefined;
  if (!found || found.wall.id !== wallId) return;

  const after = found.wall.nodeEdits;
  if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return;

  // State already equals `after`; execute() re-applying it is a harmless no-op
  // and keeps the command's own contract intact.
  undoManager.execute(
    new UpdateWallCommand(found.layerId, found.wall.id, { nodeEdits: before }, { nodeEdits: after }),
  );
}
