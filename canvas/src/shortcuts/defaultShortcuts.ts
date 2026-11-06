// src/shortcuts/defaultShortcuts.ts
// The one shortcut table: every key the map answers, with its label and help group. The
// dispatch map, the shortcuts sheet and the chrome's key captions all read it.

import { saveMap } from '@/io/saveLoad';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { notify, notifyCoalesce } from '@/lib/toast';
import {
  CompositeCommand,
  createSelectionRemovalCommand,
  UpdateChildCommand,
  UpdateWallCommand,
} from '@/store/commands';
import {
  createDuplicateCommand,
  createMoveToLayerCommand,
  createZOrderCommand,
  type AlignEdge,
  type ZOrderOp,
} from '@dnd/core/src/store/propEdits';
import type { AnyChild, ChildClipboard, Command, DungeonLayer, ToolType } from '@/store/types';
import { TERRAIN_PANEL_ID } from '@/store/types';
import { conditionZoneId } from '@dnd/core/src/shared/prep';
import { isLayerShown, selectLayerForChild, selectLayerForSelected } from '@/store/selectors';
import { noEditableLayerMessage } from '@dnd/core/src/engine/tools/layerGuard';
import { kindCounts, resolveSelection, selectionNoun, type SelectionKind } from '@dnd/core/src/store/selectionResolve';
import {
  clipboardWalls,
  createDuplicateSelectionCommand,
  DOOR_COPY_MESSAGE,
  wallCopyCommands,
} from '@dnd/core/src/store/duplicateSelection';
import {
  alignTargetsCommand,
  buildTargets,
  createNudgeCommand,
  distributeTargetsCommand,
  flipCommand,
  rotate90Command,
} from '@dnd/core/src/engine/transformTargets';
import { openNewMapRef, priorActiveLayerRef, togglePopoverRef } from '@/editor/toolConstants';
import { zoomToFitRef } from '@/editor/zoomToFitRef';
import { groupSelection, selectionGroup, ungroupSelection } from '@/canvas/groupActions';
import { nextFocusMode, toggleLitPreview } from '@/v2/viewPrefs';
import { acceptAllSuggestions, dismissSuggestions } from '@/v2/editor/roomActions';
import { editSessionActive, editSessionOwnsKey } from '@/canvas/editSessionKeys';
import { exitNodeEdit, handleNodeKey } from '@/canvas/wallNodeEdit';
import { applyOutlineEdit, exitShapeNodeEdit } from '@/engine/shapeNodeEdit';
import { removeHoveredPlateauPoint } from '@dnd/core/src/engine/ringNodeEdit';

/** Set by EditorHost so the shortcut system can trigger the file picker */
export const importImageRef: { current: (() => void) | null } = { current: null };

/** Set by EditorHost: opens the export dialog (it lives in React state). */
export const openExportRef: { current: (() => void) | null } = { current: null };

/**
 * Set by the canvas input hook: hands a key to the tool in hand, true when the tool had a
 * gesture live (a chain, a drag) that the key went to.
 */
export const activeToolKeyRef: { current: ((e: KeyboardEvent) => boolean) | null } = { current: null };

/** What the editor shell lends the table. Registered by EditorShell; null while it is not mounted. */
export interface EditorShellKeys {
  /** The dock tab up now. */
  tab: () => string;
  toggleDock: () => void;
  stepLevel: (step: -1 | 1) => void;
  openShortcuts: () => void;
}
export const editorShellKeysRef: { current: EditorShellKeys | null } = { current: null };

/** Something is selected and every selected child is a prop (pack art or an imported image). */
function selectionIsAllProps(): boolean {
  const store = useStore.getState();
  const ids = store.selection.selectedIds;
  return (
    ids.length > 0 &&
    ids.every((id) => selectLayerForChild(store, id)?.children.find((c) => c.id === id)?.childType === 'asset')
  );
}

/** Said when a verb finds nothing but locked members to act on. */
const LOCKED_MESSAGE = 'Locked: unlock to edit';

/** Said when a copy finds nothing it can carry. */
const NOTHING_TO_COPY = 'Nothing to copy: rooms stay where they are';

/**
 * What Copy and Cut put on the clipboard for `ids` (the selection by default): the
 * children, and drawn walls with the doors on them. A door copied without its wall is left
 * out (it lives on its wall), as is a room. Null, with the reason said, when nothing is left.
 */
function copyableSelection(
  store: ReturnType<typeof useStore.getState>,
  ids: readonly string[] = store.selection.selectedIds,
): { clipboard: ChildClipboard; count: number } | null {
  const sel = resolveSelection(store, ids);
  const wallIds = new Set(sel.walls.map((w) => w.wall.id));
  const loneDoors = sel.children.filter(({ child }) => child.childType === 'door' && !wallIds.has(child.wallId));
  const children = sel.children
    .filter(({ child }) => child.childType !== 'door')
    .map(({ child }) => structuredClone(child) as AnyChild);
  const walls = clipboardWalls(store, sel.walls.map((w) => w.wall.id));
  const count = children.length + walls.length;
  if (count === 0) {
    notify.warning(loneDoors.length > 0 ? DOOR_COPY_MESSAGE : NOTHING_TO_COPY);
    return null;
  }
  return { clipboard: walls.length > 0 ? { children, walls } : { children }, count };
}

/**
 * Delete/cut via the layers panel selection go through `selectLayerForChild`
 * rather than a canvas pointer that already sat on a resolved, editable
 * layer — so nothing had checked the OWNING layer's lock/visible state before
 * this. Blocks the whole batch on the first offender rather than filtering:
 * a delete that silently drops some of what was selected is more surprising
 * than one that refuses outright.
 */
function blockedChildrenLayerReason(store: ReturnType<typeof useStore.getState>, ids: string[]): string | null {
  for (const id of ids) {
    // A drawn wall, or a room, answers to its layer's lock the same way a child does.
    const layer =
      selectLayerForSelected(store, id) ??
      store.layers.find(
        (l): l is DungeonLayer => l.type === 'dungeon' && (l.rooms ?? []).some((r) => r.id === id),
      );
    if (!layer) continue;
    if (layer.locked) return 'Layer is locked';
    if (!layer.visible) return 'Layer is hidden';
  }
  return null;
}

const counted = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The delete toast: what was deleted named by its kind ("Deleted 1 wall", "Deleted 4
 * props", "Deleted 3 objects" for a mix), and the doors that went with the walls.
 */
export function deletedMessage(kinds: Partial<Record<SelectionKind, number>>, doorsWithWalls = 0): string {
  const what = selectionNoun(kinds) || '0 objects';
  return doorsWithWalls > 0 ? `Deleted ${what} and ${counted(doorsWithWalls, 'door', 'doors')}` : `Deleted ${what}`;
}

/** The kinds of what a removal of `ids` takes on purpose: the doors riding on its walls left out. */
function removedKinds(state: Parameters<typeof resolveSelection>[0], ids: readonly string[]): Partial<Record<SelectionKind, number>> {
  const sel = resolveSelection(state, ids);
  const walls = new Set(sel.walls.map((w) => w.wall.id));
  const kept = sel.children.filter(({ child }) => !(child.childType === 'door' && walls.has(child.wallId)));
  const kinds = kindCounts(kept.map((c) => c.child), sel.walls.length);
  if (sel.rooms.length > 0) kinds.room = sel.rooms.length;
  return kinds;
}

/**
 * Selection-scoped shortcuts (duplicate, flip, nudge) only make sense with the
 * select tool active, something selected, and no node-edit session claiming
 * the keyboard — arrows while editing a wall's nodes must not shove the whole
 * shape around.
 */
function selectionShortcutsApply(store: ReturnType<typeof useStore.getState>): boolean {
  return (
    store.tools.activeTool === 'select' &&
    store.selection.selectedIds.length > 0 &&
    !store.tools.nodeEditWallId &&
    !store.tools.shapeNodeEditId
  );
}

/** Selected children paired with their owning layer, in selection order. Locked members sit out. */
function selectedChildEntries(
  store: ReturnType<typeof useStore.getState>,
): { layer: DungeonLayer; child: AnyChild }[] {
  return resolveSelection(store, store.selection.selectedIds).children.filter(({ child }) => !child.locked);
}

/** Said when a batch leaves locked members where they are: "3 locked objects skipped". */
function lockedSkipped(n: number): void {
  if (n > 0) notify.warning(`${n} locked object${n === 1 ? '' : 's'} skipped`);
}

/**
 * The gate every selection verb passes: the Select tool (or, for the card's buttons, any
 * tool), a selection, no node edit. False when it does not apply at all (the key falls
 * through); null when it applies but a member's layer is locked or hidden (said, consumed).
 */
function verbGate(anyTool: boolean): boolean | null {
  const store = useStore.getState();
  const ok = anyTool
    ? store.selection.selectedIds.length > 0 && !store.tools.nodeEditWallId && !store.tools.shapeNodeEditId
    : selectionShortcutsApply(store);
  if (!ok) return false;
  const reason = blockedChildrenLayerReason(store, store.selection.selectedIds);
  if (reason) {
    notify.warning(reason);
    return null;
  }
  return true;
}

/**
 * Move the selection by (dx, dy) world squares: every kind through its transform target
 * (walls with their doors, doors along their wall), locked members left where they are.
 * A run of presses on one selection folds into one undo entry (NudgeCommand). Returns
 * false when nothing could move, so the key falls through to whoever wants arrows next.
 */
function nudgeSelection(dx: number, dy: number): void | false {
  const gate = verbGate(false);
  if (gate !== true) return gate === false ? false : undefined;
  const store = useStore.getState();
  const { command, locked } = createNudgeCommand(store, store.selection.selectedIds, dx, dy);
  if (!command) {
    if (locked > 0) {
      notify.warning(LOCKED_MESSAGE);
      return;
    }
    return false;
  }
  undoManager.execute(command);
}

/**
 * Flip the selection in place, each member about its own centre: props mirror their art,
 * floors and drawn walls their outline. Labels, lights and zones have nothing to
 * mirror and pass through unchanged.
 */
export function flipSelection(axis: 'h' | 'v', anyTool = false): void | false {
  const gate = verbGate(anyTool);
  if (gate !== true) return gate === false ? false : undefined;
  const store = useStore.getState();
  const { targets, locked } = buildTargets(store, store.selection.selectedIds);
  const cmd = flipCommand(targets, axis);
  lockedSkipped(locked.length);
  if (!cmd) return locked.length > 0 ? undefined : false;
  undoManager.execute(cmd);
  notify.subtle(cmd.label, { icon: 'tool' });
}

/**
 * Rotate the selection a quarter turn clockwise, each member about its own centre
 * (Shift+R, the card and the menus). Lights have no turn.
 */
export function rotateSelection90(anyTool = false): void | false {
  const gate = verbGate(anyTool);
  if (gate !== true) return gate === false ? false : undefined;
  const store = useStore.getState();
  const { targets, locked } = buildTargets(store, store.selection.selectedIds);
  const cmd = rotate90Command(targets);
  lockedSkipped(locked.length);
  if (!cmd) return locked.length > 0 ? undefined : false;
  undoManager.execute(cmd);
}

/** Restack the selected children (array order is draw order), one undo entry. */
function orderSelection(op: ZOrderOp): void | false {
  const store = useStore.getState();
  if (!selectionShortcutsApply(store)) return false;
  orderSelectionNow(op);
}

/** The restack itself, from any tool (the mixed card's Order row). */
export function orderSelectionNow(op: ZOrderOp): void {
  const store = useStore.getState();
  const reason = blockedChildrenLayerReason(store, store.selection.selectedIds);
  if (reason) {
    notify.warning(reason);
    return;
  }
  const ids = selectedChildEntries(store).map(({ child }) => child.id);
  const cmd = ids.length > 0 ? createZOrderCommand(ids, op) : null;
  if (!cmd) return;
  undoManager.execute(cmd);
}

/** Align the selection's members with a box to an edge of their union (2+), one step. */
export function alignSelection(edge: AlignEdge): void {
  if (verbGate(true) !== true) return;
  const store = useStore.getState();
  const { targets, locked } = buildTargets(store, store.selection.selectedIds);
  const cmd = alignTargetsCommand(targets, edge);
  lockedSkipped(locked.length);
  if (cmd) undoManager.execute(cmd);
}

/** Space three or more members evenly along an axis, one step. */
export function distributeSelection(axis: 'h' | 'v'): void {
  if (verbGate(true) !== true) return;
  const store = useStore.getState();
  const { targets, locked } = buildTargets(store, store.selection.selectedIds);
  const cmd = distributeTargetsCommand(targets, axis);
  lockedSkipped(locked.length);
  if (cmd) undoManager.execute(cmd);
}

/** Move the selection to another layer, walls with their doors; locked members stay. */
export function moveSelectionToLayer(targetLayerId: string): void {
  const store = useStore.getState();
  const sel = resolveSelection(store, store.selection.selectedIds);
  const ids = store.selection.selectedIds.filter((id) => !sel.locked.includes(id));
  lockedSkipped(sel.locked.length);
  const cmd = ids.length > 0 ? createMoveToLayerCommand(ids, targetLayerId) : null;
  if (cmd) undoManager.execute(cmd);
}

/** Duplicate the selection one square right and down; the selection follows the copies. */
function duplicateSelection(anyTool: boolean): void | false {
  const gate = verbGate(anyTool);
  if (gate !== true) return gate === false ? false : undefined;
  const store = useStore.getState();
  // Children in their own layers, drawn walls with their doors; a door alone stays on its
  // wall, a room stays where it is. Locked members are copied unlocked.
  const { command, newIds, doorsSkipped } = createDuplicateSelectionCommand(store.layers, store.selection.selectedIds);
  if (doorsSkipped > 0) notify.warning(DOOR_COPY_MESSAGE);
  if (!command) return;
  undoManager.execute(command);
  // Selection follows the copies, so Ctrl+D, drag, Ctrl+D chains work.
  useStore.getState().setSelectedIds(newIds);
  notify.subtle(`Duplicated ${selectionNoun(resolveSelection(useStore.getState(), newIds).kinds)}`, { icon: 'copy' });
}

/**
 * Lock the selection, every kind (rooms have no lock): one step. When everything that can
 * lock already is, unlock it instead, so the key toggles; `lock` forces one way.
 */
export function toggleLockSelection(lock?: boolean): void {
  const store = useStore.getState();
  const sel = resolveSelection(store, store.selection.selectedIds);
  const members = sel.children.length + sel.walls.length;
  if (members === 0) return;
  const reason = blockedChildrenLayerReason(store, store.selection.selectedIds);
  if (reason) {
    notify.warning(reason);
    return;
  }
  const next = lock ?? sel.locked.length < members;
  const label = next ? 'Lock' : 'Unlock';
  const cmds: Command[] = [];
  for (const { child, layer } of sel.children) {
    if (!!child.locked === next) continue;
    cmds.push(new UpdateChildCommand(label, layer.id, child.id, { locked: child.locked }, { locked: next }));
  }
  for (const { wall, layer } of sel.walls) {
    if (!!wall.locked === next) continue;
    cmds.push(new UpdateWallCommand(layer.id, wall.id, { locked: wall.locked }, { locked: next }));
  }
  if (cmds.length === 0) return;
  undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand(label, cmds));
  const changed = kindCounts(
    sel.children.filter(({ child }) => !!child.locked !== next).map((c) => c.child),
    sel.walls.filter(({ wall }) => !!wall.locked !== next).length,
  );
  notify.subtle(`${label}ed ${selectionNoun(changed)}`, { icon: 'tool' });
}

/**
 * Hide the selection, every kind but rooms: hidden objects draw nowhere and are never
 * picked, so they leave the selection too. Undo brings them back, selected.
 */
export function hideSelection(): void {
  const store = useStore.getState();
  const sel = resolveSelection(store, store.selection.selectedIds);
  if (sel.children.length + sel.walls.length === 0) return;
  const reason = blockedChildrenLayerReason(store, store.selection.selectedIds);
  if (reason) {
    notify.warning(reason);
    return;
  }
  const cmds: Command[] = [];
  for (const { child, layer } of sel.children) {
    if (!child.visible) continue;
    cmds.push(new UpdateChildCommand('Hide', layer.id, child.id, { visible: true }, { visible: false }));
  }
  for (const { wall, layer } of sel.walls) {
    if (wall.visible === false) continue;
    cmds.push(new UpdateWallCommand(layer.id, wall.id, { visible: wall.visible }, { visible: false }));
  }
  if (cmds.length === 0) return;
  undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand('Hide', cmds));
  const hidden = new Set([...sel.children.map((c) => c.child.id), ...sel.walls.map((w) => w.wall.id)]);
  useStore.getState().setSelectedIds(useStore.getState().selection.selectedIds.filter((id) => !hidden.has(id)));
  notify.action(`Hid ${selectionNoun(kindCounts(sel.children.map((c) => c.child), sel.walls.length))}`, {
    label: 'Undo',
    onClick: () => undoManager.undo(),
    icon: 'eye',
  });
}

/** Ctrl+A: a second press within this long reaches every shown layer, ms. */
const SELECT_ALL_AGAIN_MS = 1000;
let lastSelectAll = -Infinity;

/** Every shown child and drawn wall on `layer`: what Ctrl+A takes. */
function selectableOn(layer: DungeonLayer): string[] {
  const walls = layer.sublayerVisibility?.walls === false ? [] : layer.standaloneWalls.filter((w) => w.visible !== false);
  return [...layer.children.filter((c) => c.visible).map((c) => c.id), ...walls.map((w) => w.id)];
}

/** Select everything on the active layer; pressed again within a second, on every shown layer. */
function selectAll(): void | false {
  const store = useStore.getState();
  if (store.tools.activeTool !== 'select' || store.tools.nodeEditWallId || store.tools.shapeNodeEditId) return false;
  const now = Date.now();
  const again = now - lastSelectAll <= SELECT_ALL_AGAIN_MS;
  lastSelectAll = now;
  const layers = store.layers.filter((l): l is DungeonLayer => l.type === 'dungeon');
  if (again) {
    const shown = layers.filter((l) => isLayerShown(store, l) && !l.locked);
    store.setSelectedIds(shown.flatMap(selectableOn));
    notify.subtle('Selected every shown layer', { icon: 'tool' });
    return;
  }
  const active = layers.find((l) => l.id === store.ui.activeLayerId);
  if (!active) {
    notify.warning(noEditableLayerMessage());
    return;
  }
  if (active.locked) {
    notify.warning('Layer is locked');
    return;
  }
  store.setSelectedIds(selectableOn(active));
}

/** The verbs the selection card's header buttons run (from any tool). */
export type SelectionVerb = 'flipH' | 'flipV' | 'rotate' | 'duplicate' | 'lock' | 'unlock' | 'hide' | 'delete';

export function runSelectionVerb(verb: SelectionVerb): void {
  switch (verb) {
    case 'flipH':
      flipSelection('h', true);
      return;
    case 'flipV':
      flipSelection('v', true);
      return;
    case 'rotate':
      rotateSelection90(true);
      return;
    case 'duplicate':
      duplicateSelection(true);
      return;
    case 'lock':
      toggleLockSelection(true);
      return;
    case 'unlock':
      toggleLockSelection(false);
      return;
    case 'hide':
      hideSelection();
      return;
    case 'delete':
      deleteSelection();
      return;
  }
}

/** Undo, with the coalesced toast. */
function undo(): void {
  if (!undoManager.canUndo()) {
    // Full-weight toast, not subtle: a quiet "nothing happened" here reads
    // as undo being broken, not as an empty history.
    notifyCoalesce('undo', 'Nothing to undo', { duration: 1500, icon: 'undo' });
    return;
  }
  undoManager.undo();
  notifyCoalesce('undo', 'Undo', { duration: 1500, icon: 'undo' });
}

function redo(): void {
  if (!undoManager.canRedo()) {
    notifyCoalesce('redo', 'Nothing to redo', { duration: 1500, icon: 'redo' });
    return;
  }
  undoManager.redo();
  notifyCoalesce('redo', 'Redo', { duration: 1500, icon: 'redo' });
}

function copySelection(): void | false {
  const store = useStore.getState();
  if (store.tools.activeTool !== 'select') return false;

  // Object-based copy: the selected children, and drawn walls with the doors on them.
  if (store.selection.selectedIds.length > 0) {
    const copied = copyableSelection(store);
    if (!copied) return;
    store.setClipboard(copied.clipboard);
    notify.subtle(copied.count === 1 ? 'Copied' : `Copied ${copied.count} items`, { icon: 'copy' });
    return;
  }
}

function pasteClipboard(): void | false {
  const store = useStore.getState();

  // Object-based paste: duplicate children (and drawn walls) with new IDs
  const clip = store.selection.clipboard;
  if (clip && (clip.children.length > 0 || (clip.walls?.length ?? 0) > 0)) {
    const activeLayerId = store.ui.activeLayerId;
    // Same exists/dungeon/unlocked/visible check the canvas guards
    // pointerDown with — paste is a canvas-triggered mutation too, and had
    // none of it. Duplicated here rather than imported: the core helper's
    // notify channel and this file's @/lib/toast are wired separately.
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) {
      notify.warning(noEditableLayerMessage());
      return;
    }
    if (activeLayer.locked) {
      notify.warning('Layer is locked');
      return;
    }
    if (!activeLayer.visible) {
      notify.warning('Layer is hidden');
      return;
    }
    // The one duplicate path: copies offset one square, attached lights glued to the
    // copies, no copy left pointing at a group the layer does not have. Walls land on
    // the active layer too, their doors re-bound to the copies.
    const cmds: Command[] = [];
    const pasted: string[] = [];
    if (clip.children.length > 0) {
      const { command, newIds } = createDuplicateCommand(store.layers, [], {
        children: clip.children,
        targetLayerId: activeLayerId,
        label: 'Paste',
      });
      if (command) {
        cmds.push(command);
        pasted.push(...newIds);
      }
    }
    if (clip.walls?.length) {
      const walls = wallCopyCommands('Paste', clip.walls, activeLayerId, 1, 1);
      cmds.push(...walls.commands);
      pasted.push(...walls.newIds);
    }
    if (cmds.length === 0) return;
    undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand('Paste', cmds));
    // What was pasted is the selection, so it can be moved straight away; undo then
    // redo hands it back (the entry records the selection held when it is undone).
    useStore.getState().setSelectedIds(pasted);
    notify.action(`Pasted ${selectionNoun(kindCounts(clip.children, clip.walls?.length ?? 0))}`, {
      label: 'Undo',
      onClick: () => undoManager.undo(),
      icon: 'paste',
    });
    return;
  }

  // Region-based paste not implemented in v2.0
  return false;
}

function cutSelection(): void | false {
  const store = useStore.getState();
  if (store.tools.activeTool !== 'select') return false;

  // Object-based cut: copy then delete, walls with their doors. Locked members and rooms
  // stay where they are.
  const sel = resolveSelection(store, store.selection.selectedIds);
  const cutIds = store.selection.selectedIds.filter(
    (id) => !sel.locked.includes(id) && !sel.rooms.some((r) => r.room.id === id),
  );
  if (cutIds.length === 0 && store.selection.selectedIds.length > 0) {
    notify.warning(sel.locked.length > 0 ? LOCKED_MESSAGE : NOTHING_TO_COPY);
    return;
  }
  if (cutIds.length > 0) {
    const reason = blockedChildrenLayerReason(store, cutIds);
    if (reason) {
      notify.warning(reason);
      return;
    }
    lockedSkipped(sel.locked.length);

    // Copy first
    const copied = copyableSelection(store, cutIds);
    if (copied) store.setClipboard(copied.clipboard);

    // Delete selected
    warnOrphanedTriggers(store, cutIds);
    const cutKinds = removedKinds(store, cutIds);
    const removal = createSelectionRemovalCommand(cutIds, 'Cut');
    if (!removal.command) return;
    undoManager.execute(removal.command);
    notify.action(`Cut ${selectionNoun(cutKinds)}`, {
      label: 'Undo',
      onClick: () => undoManager.undo(),
      icon: 'scissors',
    });
    store.setSelectedIds([]);
    return;
  }

  // Region selection (Alt+drag legacy): cutting it just clears it
  if (store.selection.selectedRegion) {
    store.setSelectedRegion(null);
  }
}

function deleteSelection(): void | false {
  const store = useStore.getState();
  if (store.selection.selectedIds.length === 0) return false;

  const reason = blockedChildrenLayerReason(store, store.selection.selectedIds);
  if (reason) {
    notify.warning(reason);
    return;
  }

  // Anything locked on its own stays; the rest of the selection goes.
  const locked = resolveSelection(store, store.selection.selectedIds).locked;
  const ids = store.selection.selectedIds.filter((id) => !locked.includes(id));
  if (ids.length === 0) {
    notify.warning(LOCKED_MESSAGE);
    return;
  }
  lockedSkipped(locked.length);
  warnOrphanedTriggers(store, ids);
  // Drawn walls ride in the same selection; their doors go with them, in this one step.
  const kinds = removedKinds(store, ids);
  const removal = createSelectionRemovalCommand(ids, 'Delete', 'Delete selected');
  if (removal.command) {
    undoManager.execute(removal.command);
    notify.action(deletedMessage(kinds, removal.doors), {
      label: 'Undo',
      onClick: () => undoManager.undo(),
      icon: 'trash',
    });
  }
  store.setSelectedIds([]);
}

/**
 * Pick `tool`. Pressed again with the tool in hand, a tool with settings opens them in the
 * dock (brought forward if folded).
 */
function pickTool(tool: ToolType, label: string, settings = true): void {
  const s = useStore.getState();
  if (settings && s.tools.activeTool === tool) {
    togglePopoverRef.current?.();
    return;
  }
  s.setActiveTool(tool);
  notify.subtle(label, { icon: 'tool' });
}

/** The room tools: pressed again with the tool in hand, nothing more happens. */
function pickRoomTool(tool: ToolType, label: string): void {
  const s = useStore.getState();
  if (s.tools.activeTool === tool) return;
  s.setActiveTool(tool);
  notify.subtle(label, { icon: 'tool' });
}

/** The key, to the tool in hand: Enter ends a chain, Escape drops it, F mirrors the stamp. */
export function toTool(e?: KeyboardEvent): void | false {
  if (!e || !activeToolKeyRef.current) return false;
  activeToolKeyRef.current(e);
}

/**
 * Escape, once nothing above the map claims it: the tool in hand cancels its gesture, and
 * only if it had none does the view let go of solo (D1) and of the Terrain row (D5b),
 * restoring the dungeon layer that was active before it. Solo and the terrain row are
 * view-level state with no claim to pre-empt a gesture's own Escape, and cancelling a
 * chain and clearing solo must not both fire off one press.
 */
function cancelOrLeaveSolo(e?: KeyboardEvent): void | false {
  if (!e) return false;
  if (activeToolKeyRef.current?.(e)) return;
  const state = useStore.getState();
  if (state.ui.solo) state.clearSolo();
  if (state.ui.activeLayerId === TERRAIN_PANEL_ID) {
    const prior = priorActiveLayerRef.current;
    if (prior && state.layers.some((l) => l.id === prior)) {
      state.setActiveLayerId(prior);
    }
    priorActiveLayerRef.current = null;
  }
}

/**
 * A node edit's key: the picked outline vertex goes on Delete, the picked wall stone turns,
 * sizes, moves its gap, swaps its piece, gains a neighbour or goes. With nothing picked the
 * key is still the session's (editSessionKeys.ts): swallowed, so Tab does not fold the dock
 * and Delete does not take the whole shape.
 */
function nodeKey(e?: KeyboardEvent): void {
  if (!e) return;
  const tools = useStore.getState().tools;
  if (tools.shapeNodeEditId && tools.selectedVertex !== null && (e.key === 'Delete' || e.key === 'Backspace')) {
    applyOutlineEdit({ kind: 'delete', index: tools.selectedVertex }, 'Delete vertex');
    useStore.getState().selectVertex(null);
    return;
  }
  if (tools.nodeEditWallId && tools.selectedNodeT !== null) handleNodeKey(e.key, tools.selectedNodeT);
}

/** Keys typed into a field, or Tab moving focus between controls, are not dock toggles. */
function isTypingOrNavigating(target: EventTarget | null | undefined): boolean {
  const el = target as HTMLElement | null | undefined;
  if (!el || el === document.body) return false;
  return !!el.closest?.(
    'input, textarea, select, button, a, [contenteditable="true"], [role="dialog"], [role="menu"], [tabindex]',
  );
}

const sessionKey = (e?: KeyboardEvent): boolean => !!e && editSessionOwnsKey(useStore.getState().tools, e);
const noEditSession = (): boolean => !editSessionActive(useStore.getState().tools);
/** The editor shell is up, and no node edit holds the keys. */
const shellFree = (): boolean => editorShellKeysRef.current !== null && noEditSession();
const suggesting = (): boolean => (useStore.getState().ui.roomSuggestions?.rooms.length ?? 0) > 0 && noEditSession();

/** Where a binding answers: anywhere, only with one tool in hand, or only with the Rooms tab up. */
export type ShortcutScope = 'canvas' | `tool:${ToolType}` | 'tab:rooms';

/** The help groups, in the order the shortcuts sheet lists them. */
export const SHORTCUT_GROUPS = ['Tools', 'Selection', 'Edit', 'View', 'Levels and dock', 'File', 'Node editing'] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export interface Shortcut {
  /** The help row. Bindings sharing an id are one action on several keys. */
  id: string;
  /** What onKeyDown builds (comboOf): ctrl, shift, alt, then the key, lower case. */
  combo: string;
  label: string;
  group: ShortcutGroup;
  scope: ShortcutScope;
  /** Bound, but not shown in the help: another spelling of a key its row already shows. */
  alias?: true;
  /**
   * The old editor's tool, mode and dock keys. The new shell installs the registry's keys in
   * their place (setRegistryShortcuts); these go when the old editor does.
   */
  legacy?: true;
  /** Whether it applies right now; false hands the key to the next binding on the combo. */
  when?: (e?: KeyboardEvent) => boolean;
  /** The action. False: it did not apply after all, and the key falls through. */
  run: (e?: KeyboardEvent) => void | false;
}

/**
 * Every key the map answers. Bindings on one combo are tried in the order listed here, so
 * the node-edit keys come first (Delete with a stone picked means that stone), then the
 * room tools on R and P, then the tool-owned keys, then the rest.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  // Node editing, ahead of everything else on the same keys.
  { id: 'node.exit', combo: 'escape', group: 'Node editing', scope: 'canvas', label: 'Leave node editing',
    when: () => !noEditSession(),
    run: () => (useStore.getState().tools.nodeEditWallId ? exitNodeEdit() : exitShapeNodeEdit()) },
  { id: 'node.turn', combo: '[', group: 'Node editing', scope: 'canvas', label: 'Turn the stone', when: sessionKey, run: nodeKey },
  { id: 'node.turn', combo: ']', group: 'Node editing', scope: 'canvas', label: 'Turn the stone', when: sessionKey, run: nodeKey },
  { id: 'node.size', combo: '-', group: 'Node editing', scope: 'canvas', label: 'Size the stone', when: sessionKey, run: nodeKey },
  { id: 'node.size', combo: '_', group: 'Node editing', scope: 'canvas', label: 'Size the stone', when: sessionKey, run: nodeKey, alias: true },
  { id: 'node.size', combo: '=', group: 'Node editing', scope: 'canvas', label: 'Size the stone', when: sessionKey, run: nodeKey },
  { id: 'node.size', combo: '+', group: 'Node editing', scope: 'canvas', label: 'Size the stone', when: sessionKey, run: nodeKey, alias: true },
  { id: 'node.gap', combo: ',', group: 'Node editing', scope: 'canvas', label: 'Narrow or widen the gap', when: sessionKey, run: nodeKey },
  { id: 'node.gap', combo: '<', group: 'Node editing', scope: 'canvas', label: 'Narrow or widen the gap', when: sessionKey, run: nodeKey, alias: true },
  { id: 'node.gap', combo: '.', group: 'Node editing', scope: 'canvas', label: 'Narrow or widen the gap', when: sessionKey, run: nodeKey },
  { id: 'node.gap', combo: '>', group: 'Node editing', scope: 'canvas', label: 'Narrow or widen the gap', when: sessionKey, run: nodeKey, alias: true },
  { id: 'node.insert', combo: '{', group: 'Node editing', scope: 'canvas', label: 'Add a stone before or after', when: sessionKey, run: nodeKey },
  { id: 'node.insert', combo: '}', group: 'Node editing', scope: 'canvas', label: 'Add a stone before or after', when: sessionKey, run: nodeKey },
  { id: 'node.piece', combo: 'tab', group: 'Node editing', scope: 'canvas', label: 'Next piece', when: sessionKey, run: nodeKey },
  { id: 'node.remove', combo: 'delete', group: 'Node editing', scope: 'canvas', label: 'Remove the picked stone or corner', when: sessionKey, run: nodeKey },
  { id: 'node.remove', combo: 'backspace', group: 'Node editing', scope: 'canvas', label: 'Remove the picked stone or corner', when: sessionKey, run: nodeKey },

  // Tools: the rail.
  { id: 'tool.select', combo: 'v', group: 'Tools', legacy: true, scope: 'canvas', label: 'Select', run: () => pickTool('select', 'Select', false) },
  { id: 'tool.pan', combo: 'g', group: 'Tools', legacy: true, scope: 'canvas', label: 'Pan', run: () => pickTool('pan', 'Pan', false) },
  // No settings: the ruler has nothing to configure.
  { id: 'tool.ruler', combo: 'm', group: 'Tools', legacy: true, scope: 'canvas', label: 'Measure', run: () => pickTool('ruler', 'Measure', false) },
  // Shift+E: E is the Plateau tool.
  { id: 'mode.erase', combo: 'shift+e', group: 'Tools', legacy: true, scope: 'canvas', label: 'Erase mode',
    run: () => {
      const s = useStore.getState();
      const next = !s.tools.eraseMode;
      s.setEraseMode(next);
      notify.subtle(next ? 'Erase mode' : 'Draw mode', { icon: 'tool' });
    } },
  { id: 'mode.curve', combo: 'c', group: 'Tools', legacy: true, scope: 'canvas', label: 'Curve mode',
    run: () => {
      const s = useStore.getState();
      const next = !s.tools.curveMode;
      s.setCurveMode(next);
      notify.subtle(next ? 'Curve mode' : 'Straight mode', { icon: 'tool' });
    } },
  // Rooms: R and P while the Rooms tab is up (plain floors from every other tab), X from
  // anywhere, where it is free.
  { id: 'tool.roomRect', combo: 'r', group: 'Tools', legacy: true, scope: 'tab:rooms', label: 'Rectangle room', when: noEditSession,
    run: () => pickRoomTool('roomRect', 'Rectangle room') },
  { id: 'tool.roomPolygon', combo: 'p', group: 'Tools', legacy: true, scope: 'tab:rooms', label: 'Polygon room', when: noEditSession,
    run: () => pickRoomTool('roomPolygon', 'Polygon room') },
  { id: 'tool.divide', combo: 'x', group: 'Tools', legacy: true, scope: 'canvas', label: 'Divide', when: shellFree,
    run: () => pickRoomTool('divide', 'Divide') },
  // Props: F is the tool's own (mirror the next stamp).
  { id: 'tool.scatterBrush', combo: 'b', group: 'Tools', legacy: true, scope: 'canvas', label: 'Props', run: () => pickTool('scatterBrush', 'Props') },
  { id: 'tool.propsMirror', combo: 'f', group: 'Tools', legacy: true, scope: 'tool:scatterBrush', label: 'Mirror the stamp', run: toTool },
  // Lights: R is the tool's (turn the next light's cone; Shift+R the other way), not Rectangle.
  { id: 'tool.light', combo: 'l', group: 'Tools', legacy: true, scope: 'canvas', label: 'Light', run: () => pickTool('light', 'Light') },
  { id: 'tool.lightTurn', combo: 'r', group: 'Tools', legacy: true, scope: 'tool:light', label: 'Turn the cone', run: toTool },
  { id: 'tool.lightTurn', combo: 'shift+r', group: 'Tools', legacy: true, scope: 'tool:light', label: 'Turn the cone', run: toTool },
  // Floors.
  { id: 'tool.rectangle', combo: 'r', group: 'Tools', legacy: true, scope: 'canvas', label: 'Rectangle', run: () => pickTool('rectangle', 'Rectangle') },
  { id: 'tool.polygon', combo: 'p', group: 'Tools', legacy: true, scope: 'canvas', label: 'Polygon', run: () => pickTool('polygon', 'Polygon') },
  { id: 'tool.regularPolygon', combo: 'h', group: 'Tools', legacy: true, scope: 'canvas', label: 'Regular polygon',
    run: () => pickTool('regularPolygon', 'Regular Polygon') },
  { id: 'tool.plateau', combo: 'e', group: 'Tools', legacy: true, scope: 'canvas', label: 'Plateau', run: () => pickTool('plateau', 'Plateau') },
  { id: 'tool.terrain', combo: 't', group: 'Tools', legacy: true, scope: 'canvas', label: 'Terrain', run: () => pickTool('terrain', 'Terrain Brush') },
  // The terrain brush's size, as the wheel steps it: [ smaller, ] larger.
  { id: 'tool.terrainSize', combo: '[', group: 'Tools', legacy: true, scope: 'tool:terrain', label: 'Brush size', run: toTool },
  { id: 'tool.terrainSize', combo: ']', group: 'Tools', legacy: true, scope: 'tool:terrain', label: 'Brush size', run: toTool },
  // Walls.
  { id: 'tool.wall', combo: 'w', group: 'Tools', legacy: true, scope: 'canvas', label: 'Wall', run: () => pickTool('wall', 'Wall') },
  { id: 'tool.door', combo: 'd', group: 'Tools', legacy: true, scope: 'canvas', label: 'Door', run: () => pickTool('door', 'Door') },
  // Labels. N for note: T is terrain.
  { id: 'tool.text', combo: 'n', group: 'Tools', legacy: true, scope: 'canvas', label: 'Label', run: () => pickTool('text', 'Label', false) },
  { id: 'tool.zone', combo: 'z', group: 'Tools', legacy: true, scope: 'canvas', label: 'Zone', run: () => pickTool('zone', 'Zone') },

  // Selection.
  { id: 'edit.nudge', combo: 'arrowleft', group: 'Selection', scope: 'canvas', label: 'Nudge 1 square', run: () => nudgeSelection(-1, 0) },
  { id: 'edit.nudge', combo: 'arrowright', group: 'Selection', scope: 'canvas', label: 'Nudge 1 square', run: () => nudgeSelection(1, 0) },
  { id: 'edit.nudge', combo: 'arrowup', group: 'Selection', scope: 'canvas', label: 'Nudge 1 square', run: () => nudgeSelection(0, -1) },
  { id: 'edit.nudge', combo: 'arrowdown', group: 'Selection', scope: 'canvas', label: 'Nudge 1 square', run: () => nudgeSelection(0, 1) },
  { id: 'edit.nudgeFine', combo: 'shift+arrowleft', group: 'Selection', scope: 'canvas', label: 'Nudge ¼ square', run: () => nudgeSelection(-0.25, 0) },
  { id: 'edit.nudgeFine', combo: 'shift+arrowright', group: 'Selection', scope: 'canvas', label: 'Nudge ¼ square', run: () => nudgeSelection(0.25, 0) },
  { id: 'edit.nudgeFine', combo: 'shift+arrowup', group: 'Selection', scope: 'canvas', label: 'Nudge ¼ square', run: () => nudgeSelection(0, -0.25) },
  { id: 'edit.nudgeFine', combo: 'shift+arrowdown', group: 'Selection', scope: 'canvas', label: 'Nudge ¼ square', run: () => nudgeSelection(0, 0.25) },
  // Duplicate into each member's own layer (unlike paste, which targets the active
  // layer), offset one square like paste so the copy is visible.
  { id: 'edit.duplicate', combo: 'ctrl+d', group: 'Selection', scope: 'canvas', label: 'Duplicate', run: () => duplicateSelection(false) },
  // Select everything on the active layer; again within a second, every shown layer.
  { id: 'edit.selectAll', combo: 'ctrl+a', group: 'Selection', scope: 'canvas', label: 'Select all in the layer (twice: every shown layer)',
    run: () => selectAll() },
  { id: 'edit.rotate90', combo: 'shift+r', group: 'Selection', scope: 'canvas', label: 'Rotate 90°', run: () => rotateSelection90() },
  { id: 'edit.flipH', combo: 'shift+h', group: 'Selection', scope: 'canvas', label: 'Flip horizontal', run: () => flipSelection('h') },
  { id: 'edit.flipV', combo: 'shift+v', group: 'Selection', scope: 'canvas', label: 'Flip vertical', run: () => flipSelection('v') },
  { id: 'edit.lock', combo: 'ctrl+shift+l', group: 'Selection', scope: 'canvas', label: 'Lock or unlock',
    run: () => {
      if (!selectionShortcutsApply(useStore.getState())) return false;
      toggleLockSelection();
    } },
  { id: 'edit.hide', combo: 'ctrl+shift+h', group: 'Selection', scope: 'canvas', label: 'Hide',
    run: () => {
      if (!selectionShortcutsApply(useStore.getState())) return false;
      hideSelection();
    } },
  // No canGroupSelection() gate: groupSelection warns with the specific reason
  // when it refuses, and a silently swallowed Ctrl+G is the bug.
  // A group of props clicks as one by default (Group board).
  { id: 'edit.group', combo: 'ctrl+g', group: 'Selection', scope: 'canvas', label: 'Group',
    run: () => groupSelection(selectionIsAllProps()) },
  { id: 'edit.ungroup', combo: 'ctrl+shift+g', group: 'Selection', scope: 'canvas', label: 'Ungroup',
    run: () => {
      if (!selectionGroup()) return false;
      ungroupSelection();
    } },
  // Draw order. With Shift held the bracket keys arrive as braces on most layouts.
  { id: 'edit.forward', combo: 'ctrl+]', group: 'Selection', scope: 'canvas', label: 'Bring forward', run: () => orderSelection('forward') },
  { id: 'edit.backward', combo: 'ctrl+[', group: 'Selection', scope: 'canvas', label: 'Send backward', run: () => orderSelection('backward') },
  { id: 'edit.front', combo: 'ctrl+shift+]', group: 'Selection', scope: 'canvas', label: 'Bring to front', run: () => orderSelection('front') },
  { id: 'edit.front', combo: 'ctrl+shift+}', group: 'Selection', scope: 'canvas', label: 'Bring to front', run: () => orderSelection('front'), alias: true },
  { id: 'edit.back', combo: 'ctrl+shift+[', group: 'Selection', scope: 'canvas', label: 'Send to back', run: () => orderSelection('back') },
  { id: 'edit.back', combo: 'ctrl+shift+{', group: 'Selection', scope: 'canvas', label: 'Send to back', run: () => orderSelection('back'), alias: true },
  // With nothing selected the tool in hand has the key (a hovered door, a selected zone).
  // A selected plateau's hovered point goes on its own, not the plateau.
  { id: 'edit.delete', combo: 'delete', group: 'Selection', scope: 'canvas', label: 'Delete',
    run: (e) => (removeHoveredPlateauPoint() ? undefined : deleteSelection() === false ? toTool(e) : undefined) },
  { id: 'edit.delete', combo: 'backspace', group: 'Selection', scope: 'canvas', label: 'Delete',
    run: (e) => (removeHoveredPlateauPoint() ? undefined : deleteSelection() === false ? toTool(e) : undefined) },

  // Edit.
  { id: 'edit.undo', combo: 'ctrl+z', group: 'Edit', scope: 'canvas', label: 'Undo', run: undo },
  { id: 'edit.redo', combo: 'ctrl+y', group: 'Edit', scope: 'canvas', label: 'Redo', run: redo },
  { id: 'edit.redo', combo: 'ctrl+shift+z', group: 'Edit', scope: 'canvas', label: 'Redo', run: redo },
  { id: 'edit.copy', combo: 'ctrl+c', group: 'Edit', scope: 'canvas', label: 'Copy', run: copySelection },
  { id: 'edit.cut', combo: 'ctrl+x', group: 'Edit', scope: 'canvas', label: 'Cut', run: cutSelection },
  { id: 'edit.paste', combo: 'ctrl+v', group: 'Edit', scope: 'canvas', label: 'Paste', run: pasteClipboard },
  // The Suggest bar's keys, while proposals are up.
  { id: 'rooms.accept', combo: 'enter', group: 'Edit', scope: 'canvas', label: 'Accept the suggested rooms', when: suggesting,
    run: () => acceptAllSuggestions() },
  { id: 'rooms.dismiss', combo: 'escape', group: 'Edit', scope: 'canvas', label: 'Dismiss the suggested rooms', when: suggesting,
    run: () => dismissSuggestions() },
  { id: 'edit.finish', combo: 'enter', group: 'Edit', scope: 'canvas', label: 'Finish the line (wall, polygon)', run: toTool },
  { id: 'edit.cancel', combo: 'escape', group: 'Edit', scope: 'canvas', label: 'Cancel the drawing, or leave solo', run: cancelOrLeaveSolo },

  // View.
  { id: 'view.fitToContent', combo: 'ctrl+0', group: 'View', scope: 'canvas', label: 'Fit to content',
    run: () => {
      zoomToFitRef.current?.();
      notify.subtle('Zoom to fit', { icon: 'focus' });
    } },
  { id: 'view.focusMode', combo: '`', group: 'View', scope: 'canvas', label: 'Cycle focus mode',
    run: () => {
      const state = useStore.getState();
      const next = nextFocusMode(state.ui.focusMode);
      state.setFocusMode(next);
      const labels = { auto: 'Focus: Auto', manual: 'Focus: Manual', fullscreen: 'Focus: Fullscreen' };
      notify.subtle(labels[next], { icon: 'focus' });
    } },
  { id: 'view.litPreview', combo: 'i', group: 'View', scope: 'canvas', label: 'Lit preview',
    run: () => {
      notify.subtle(toggleLitPreview() ? 'Lit preview on' : 'Lit preview off', { icon: 'eye' });
    } },
  // Shift+? lands here too: a shifted punctuation key falls back to the plain key.
  { id: 'view.shortcuts', combo: '?', group: 'View', scope: 'canvas', label: 'Keyboard shortcuts',
    run: () => editorShellKeysRef.current?.openShortcuts() },

  // Levels and dock.
  { id: 'level.up', combo: 'pageup', group: 'Levels and dock', scope: 'canvas', label: 'Level above', when: shellFree,
    run: () => editorShellKeysRef.current?.stepLevel(-1) },
  { id: 'level.down', combo: 'pagedown', group: 'Levels and dock', scope: 'canvas', label: 'Level below', when: shellFree,
    run: () => editorShellKeysRef.current?.stepLevel(1) },
  // Not with focus on a control: there Tab moves between them.
  { id: 'dock.toggle', combo: 'tab', group: 'Levels and dock', legacy: true, scope: 'canvas', label: 'Fold or open the dock',
    when: (e) => shellFree() && !isTypingOrNavigating(e?.target),
    run: () => editorShellKeysRef.current?.toggleDock() },

  // File.
  { id: 'file.save', combo: 'ctrl+s', group: 'File', scope: 'canvas', label: 'Save',
    run: () => {
      saveMap().then((saved) => {
        if (saved) notify.success('Map saved');
      }).catch((err: unknown) => {
        console.error('[save] failed:', err);
        notify.error('Save failed — see console for details.');
      });
    } },
  { id: 'file.load', combo: 'ctrl+o', group: 'File', scope: 'canvas', label: 'Open',
    run: () => {
      import('@/io/saveLoad')
        .then(({ loadMap }) => {
          loadMap().catch((err: unknown) => {
            console.error('[load] failed:', err);
            notify.error('Open failed — see console for details.');
          });
        })
        .catch(() => {
          console.error('[load] could not import saveLoad module');
        });
    } },
  { id: 'file.export', combo: 'ctrl+e', group: 'File', scope: 'canvas', label: 'Export', run: () => openExportRef.current?.() },
  { id: 'file.import', combo: 'ctrl+i', group: 'File', scope: 'canvas', label: 'Import image', run: () => importImageRef.current?.() },
  { id: 'file.newMap', combo: 'ctrl+shift+n', group: 'File', scope: 'canvas', label: 'New map',
    // The app registers its New map dialog here. Enter commits, so the fast path is two keystrokes.
    run: () => openNewMapRef.current?.() },
];

/** Mouse gestures the help lists beside the keys. No key binds them: the Select tool reads them. */
export const POINTER_HINTS: readonly { id: string; combo: string; label: string; group: ShortcutGroup }[] = [
  { id: 'edit.selectBehind', combo: 'alt+click', group: 'Selection', label: 'Select the next object below' },
  { id: 'edit.dupDrag', combo: 'alt+drag', group: 'Selection', label: 'Duplicate and move' },
];

/** The dispatch map, derived from the table: each combo's bindings, in table order. */
const toolKeyMap = new Map<string, Shortcut[]>();
for (const s of SHORTCUTS) toolKeyMap.set(s.combo, [...(toolKeyMap.get(s.combo) ?? []), s]);

/** Every combo the map answers. */
export function boundCombos(): string[] {
  return [...toolKeyMap.keys()];
}

/** The combo for a key event: ctrl (or cmd), shift, alt, then the key, lower case. */
export function comboOf(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): string {
  return [e.ctrlKey || e.metaKey ? 'ctrl' : '', e.shiftKey ? 'shift' : '', e.altKey ? 'alt' : '', e.key.toLowerCase()]
    .filter(Boolean)
    .join('+');
}

/**
 * A combo's bindings. A shifted punctuation key with nothing of its own falls back to the
 * plain key: `e.key` already carries the shift ('?', '{', '+'), and whether Shift is needed
 * to type it depends on the layout.
 */
function bindingsFor(combo: string): readonly Shortcut[] {
  const map = registryKeyMap ?? toolKeyMap;
  const exact = map.get(combo);
  if (exact) return exact;
  const shifted = /^shift\+(.)$/.exec(combo)?.[1];
  return shifted && !/[a-z0-9]/.test(shifted) ? (map.get(shifted) ?? []) : [];
}

/**
 * The tool and family keys the new shell generates from the registry (registryShortcuts.ts),
 * or null. While set they stand in for the table's legacy keys: on a combo the hand-written
 * chords come first, then these.
 */
let registryKeyMap: Map<string, Shortcut[]> | null = null;

export function setRegistryShortcuts(keys: readonly Shortcut[] | null): void {
  if (!keys) {
    registryKeyMap = null;
    return;
  }
  const map = new Map<string, Shortcut[]>();
  for (const s of [...SHORTCUTS.filter((x) => !x.legacy), ...keys]) map.set(s.combo, [...(map.get(s.combo) ?? []), s]);
  registryKeyMap = map;
}

function inScope(scope: ShortcutScope): boolean {
  if (scope === 'canvas') return true;
  if (scope === 'tab:rooms') return editorShellKeysRef.current?.tab() === 'rooms';
  return useStore.getState().tools.activeTool === scope.slice('tool:'.length);
}

/**
 * Triggers keyed to a removed zone become unreachable from every screen while
 * still riding along in saves/publishes — say so before the zone goes, since
 * prep edits sit outside the undo stack even though the zone itself comes
 * back on undo. ZoneTool's own delete path carries the same warning; this
 * covers the global Delete/Backspace/Cut shortcuts, which bypass the tool.
 */
function warnOrphanedTriggers(
  store: ReturnType<typeof useStore.getState>,
  removedIds: string[],
): void {
  const removed = new Set(removedIds);
  const orphaned = store.prep?.triggers.filter((t) => removed.has(conditionZoneId(t.when) ?? '')).length ?? 0;
  if (orphaned > 0) {
    notify.warning(
      `Zone deleted — ${orphaned} trigger${orphaned === 1 ? ' now references' : 's now reference'} nothing (undo restores the zone)`,
    );
  }
}

/** The first binding with this id: its combo is what captions show. */
export function shortcutById(id: string): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.id === id);
}

/**
 * Pass a key combo (e.g. 'ctrl+s'), and the key event when there is one. Runs the first
 * binding in scope that applies; true if one handled it.
 */
export function handleShortcut(keyCombo: string, e?: KeyboardEvent): boolean {
  for (const s of bindingsFor(keyCombo)) {
    if (!inScope(s.scope) || (s.when && !s.when(e))) continue;
    if (s.run(e) !== false) return true;
  }
  return false;
}
