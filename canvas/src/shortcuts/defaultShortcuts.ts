// src/shortcuts/defaultShortcuts.ts
// Default keyboard shortcut bindings — file.save and file.load wired to save/load pipeline.

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
import type { AnyChild, ChildClipboard, Command, DungeonLayer } from '@/store/types';
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
import { openNewMapRef, togglePopoverRef } from '@/components/toolbar/toolConstants';
import { zoomToFitRef } from '@/components/toolbar/zoomToFitRef';
import { groupSelection, selectionGroup, ungroupSelection } from '@/canvas/groupActions';
import { getEditorDesk } from '@dnd/core/src/engine/editorDesk';
import { nextFocusMode, toggleLitPreview } from '@/v2/viewPrefs';

/** Set by App.tsx so the shortcut system can trigger the file picker */
export const importImageRef: { current: (() => void) | null } = { current: null };

/** The v2 editor (`/v2`): the only place the Props verbs (z-order, lock, replace) are offered. */
export const isV2Route = (): boolean => /^\/v2(\/|$)/.test(window.location.pathname);

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
 * floors, water and drawn walls their outline. Labels, lights and zones have nothing to
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

/** Restack the selected children (array order is draw order), one undo entry. v2 only. */
function orderSelection(op: ZOrderOp): void | false {
  if (!isV2Route()) return false;
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
      toolKeyMap['delete']?.();
      return;
  }
}

// Keyed by key-combo string (e.g. 'ctrl+s') to match what onKeyDown builds.
const toolKeyMap: Record<string, () => void | false> = {
  // Tool selection
  v: () => { useStore.getState().setActiveTool('select'); notify.subtle('Select', { icon: 'tool' }); },
  g: () => { useStore.getState().setActiveTool('pan'); notify.subtle('Pan', { icon: 'tool' }); },
  r: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'rectangle') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('rectangle');
      notify.subtle('Rectangle', { icon: 'tool' });
    }
  },
  p: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'polygon') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('polygon');
      notify.subtle('Polygon', { icon: 'tool' });
    }
  },
  h: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'regularPolygon') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('regularPolygon');
      notify.subtle('Regular Polygon', { icon: 'tool' });
    }
  },
  a: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'path') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('path');
      notify.subtle('Path', { icon: 'tool' });
    }
  },
  d: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'door') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('door');
      notify.subtle('Door', { icon: 'tool' });
    }
  },
  w: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'wall') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('wall');
      notify.subtle('Wall', { icon: 'tool' });
    }
  },
  l: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'light') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('light');
      notify.subtle('Light', { icon: 'tool' });
    }
  },
  b: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'scatterBrush') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('scatterBrush');
      notify.subtle('Props', { icon: 'tool' });
    }
  },
  t: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'terrain') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('terrain');
      notify.subtle('Terrain Brush', { icon: 'tool' });
    }
  },
  u: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'water') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('water');
      notify.subtle('Water', { icon: 'tool' });
    }
  },
  m: () => {
    // No popover: the ruler has nothing to configure.
    useStore.getState().setActiveTool('ruler');
    notify.subtle('Measure', { icon: 'tool' });
  },
  // N for note — T is terrain.
  n: () => {
    useStore.getState().setActiveTool('text');
    notify.subtle('Label', { icon: 'tool' });
  },
  z: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'zone') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('zone');
      notify.subtle('Zone', { icon: 'tool' });
    }
  },
  // Mode toggles
  e: () => {
    const s = useStore.getState();
    const next = !s.tools.eraseMode;
    s.setEraseMode(next);
    notify.subtle(next ? 'Erase mode' : 'Draw mode', { icon: 'tool' });
  },
  c: () => {
    const s = useStore.getState();
    const next = !s.tools.curveMode;
    s.setCurveMode(next);
    notify.subtle(next ? 'Curve mode' : 'Straight mode', { icon: 'tool' });
  },
  // Undo / redo
  'ctrl+z': () => {
    if (!undoManager.canUndo()) {
      // Full-weight toast, not subtle: a quiet "nothing happened" here reads
      // as undo being broken, not as an empty history.
      notifyCoalesce('undo', 'Nothing to undo', { duration: 1500, icon: 'undo' });
      return;
    }
    undoManager.undo();
    notifyCoalesce('undo', 'Undo', { duration: 1500, icon: 'undo' });
  },
  'ctrl+shift+z': () => {
    if (!undoManager.canRedo()) {
      notifyCoalesce('redo', 'Nothing to redo', { duration: 1500, icon: 'redo' });
      return;
    }
    undoManager.redo();
    notifyCoalesce('redo', 'Redo', { duration: 1500, icon: 'redo' });
  },
  'ctrl+y': () => {
    if (!undoManager.canRedo()) {
      notifyCoalesce('redo', 'Nothing to redo', { duration: 1500, icon: 'redo' });
      return;
    }
    undoManager.redo();
    notifyCoalesce('redo', 'Redo', { duration: 1500, icon: 'redo' });
  },
  'ctrl+s': () => {
    saveMap().then((saved) => {
      if (saved) notify.success('Map saved');
    }).catch((err: unknown) => {
      console.error('[save] failed:', err);
      notify.error('Save failed — see console for details.');
    });
  },
  'ctrl+o': () => {
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
  },
  'ctrl+c': (): void | false => {
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
  },
  'ctrl+v': (): void | false => {
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
  },
  // Duplicate into each member's own layer — unlike paste, which targets the active
  // layer — offset one square like paste so the copy is visible.
  'ctrl+d': (): void | false => duplicateSelection(false),
  // Select everything on the active layer; again within a second, every shown layer.
  'ctrl+a': (): void | false => selectAll(),
  'shift+r': (): void | false => rotateSelection90(),
  'ctrl+shift+l': (): void | false => {
    if (!selectionShortcutsApply(useStore.getState())) return false;
    toggleLockSelection();
  },
  'ctrl+shift+h': (): void | false => {
    if (!selectionShortcutsApply(useStore.getState())) return false;
    hideSelection();
  },
  // No canGroupSelection() gate: groupSelection warns with the specific reason
  // when it refuses, and a silently swallowed Ctrl+G is the bug.
  'ctrl+g': (): void => {
    // On v2 a group of props clicks as one by default (Group board); v1 keeps plain groups.
    groupSelection(isV2Route() && selectionIsAllProps());
  },
  'ctrl+shift+g': (): void | false => {
    if (!selectionGroup()) return false;
    ungroupSelection();
  },
  'shift+h': () => flipSelection('h'),
  'shift+v': () => flipSelection('v'),
  // Draw order. With Shift held the bracket keys arrive as braces on most layouts.
  'ctrl+]': () => orderSelection('forward'),
  'ctrl+[': () => orderSelection('backward'),
  'ctrl+shift+]': () => orderSelection('front'),
  'ctrl+shift+}': () => orderSelection('front'),
  'ctrl+shift+[': () => orderSelection('back'),
  'ctrl+shift+{': () => orderSelection('back'),
  'arrowleft': () => nudgeSelection(-1, 0),
  'arrowright': () => nudgeSelection(1, 0),
  'arrowup': () => nudgeSelection(0, -1),
  'arrowdown': () => nudgeSelection(0, 1),
  'shift+arrowleft': () => nudgeSelection(-0.25, 0),
  'shift+arrowright': () => nudgeSelection(0.25, 0),
  'shift+arrowup': () => nudgeSelection(0, -0.25),
  'shift+arrowdown': () => nudgeSelection(0, 0.25),
  'ctrl+i': () => {
    importImageRef.current?.();
  },
  'shift+?': () => {
    useStore.getState().showModal({ type: 'shortcutReference', props: {} });
  },
  '?': () => {
    // Fallback: some keyboards/layouts produce '?' as e.key without shift flag
    useStore.getState().showModal({ type: 'shortcutReference', props: {} });
  },
  'ctrl+0': () => {
    zoomToFitRef.current?.();
    notify.subtle('Zoom to fit', { icon: 'focus' });
  },
  '`': () => {
    const state = useStore.getState();
    const next = nextFocusMode(state.ui.focusMode);
    state.setFocusMode(next);
    const labels = { auto: 'Focus: Auto', manual: 'Focus: Manual', fullscreen: 'Focus: Fullscreen' };
    notify.subtle(labels[next], { icon: 'focus' });
  },
  // Only where the editor lies on a desk (v2): without one the view is always lit.
  i: (): void | false => {
    if (!getEditorDesk()) return false;
    notify.subtle(toggleLitPreview() ? 'Lit preview on' : 'Lit preview off', { icon: 'eye' });
  },
  // v1 only: the v2 editor has no maps side panel to toggle.
  'ctrl+shift+m': (): void | false => {
    if (getEditorDesk()) return false;
    const state = useStore.getState();
    state.togglePanel('left');
    notify.subtle(state.ui.leftPanelOpen ? 'Maps panel closed' : 'Maps panel opened', { icon: 'map' });
  },
  'ctrl+shift+n': () => {
    // On /v2 the route registers its own New map dialog here.
    if (openNewMapRef.current) {
      openNewMapRef.current();
      return;
    }
    // Opens the New map dialog — the same one the maps panel's "New Map" button opens,
    // mounted once in App.tsx off this modal state so the shortcut works with the panel
    // closed. Enter commits, so the fast path is still two keystrokes.
    useStore.getState().showModal({ type: 'newMap', props: { mode: 'create' } });
  },
  'ctrl+x': (): void | false => {
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
  },
  'delete': (): void | false => {
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
  },
  'backspace': (): void | false => {
    return toolKeyMap['delete']?.() ?? false;
  },
};

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

export interface ShortcutDefinition {
  id: string;
  keys: string;
  category: string;
  label: string;
}

export function createDefaultShortcuts(): ShortcutDefinition[] {
  return [
    { id: 'tool.select',         keys: 'v',           category: 'Tools', label: 'Select' },
    { id: 'tool.pan',            keys: 'g',           category: 'Tools', label: 'Pan' },
    { id: 'tool.rectangle',      keys: 'r',           category: 'Tools', label: 'Rectangle' },
    { id: 'tool.polygon',        keys: 'p',           category: 'Tools', label: 'Polygon' },
    { id: 'tool.regularPolygon', keys: 'h',           category: 'Tools', label: 'Regular Polygon' },
    { id: 'tool.path',           keys: 'a',           category: 'Tools', label: 'Path' },
    { id: 'tool.terrain',        keys: 't',           category: 'Tools', label: 'Terrain' },
    { id: 'tool.water',          keys: 'u',           category: 'Tools', label: 'Water' },
    { id: 'tool.wall',           keys: 'w',           category: 'Tools', label: 'Wall' },
    { id: 'tool.ruler',          keys: 'm',           category: 'Tools', label: 'Measure' },
    { id: 'tool.text',           keys: 'n',           category: 'Tools', label: 'Label' },
    { id: 'tool.door',           keys: 'd',           category: 'Tools', label: 'Door' },
    { id: 'tool.light',          keys: 'l',           category: 'Tools', label: 'Light' },
    { id: 'tool.scatterBrush',   keys: 'b',           category: 'Tools', label: 'Props' },
    { id: 'tool.propsMirror',    keys: 'f',           category: 'Tools', label: 'Mirror prop (Props tool)' },
    { id: 'tool.zone',           keys: 'z',           category: 'Tools', label: 'Zone' },
    { id: 'tool.room',           keys: 'o',           category: 'Tools', label: 'Room' },
    { id: 'mode.erase',          keys: 'e',           category: 'Tools', label: 'Toggle Erase' },
    { id: 'mode.curve',          keys: 'c',           category: 'Tools', label: 'Toggle Curve' },
    { id: 'edit.undo',           keys: 'ctrl+z',      category: 'Edit',  label: 'Undo' },
    { id: 'edit.redo',           keys: 'ctrl+y',      category: 'Edit',  label: 'Redo' },
    { id: 'edit.redoAlt',        keys: 'ctrl+shift+z', category: 'Edit', label: 'Redo (Alt)' },
    { id: 'edit.deleteAlt',      keys: 'Backspace',   category: 'Edit',  label: 'Delete (Alt)' },
    { id: 'file.save',           keys: 'ctrl+s',      category: 'File',  label: 'Save' },
    { id: 'file.load',           keys: 'ctrl+o',      category: 'File',  label: 'Open' },
    { id: 'file.export',         keys: 'ctrl+e',      category: 'File',  label: 'Export' }, // handler is in App.tsx (needs React state)
    { id: 'file.import',         keys: 'ctrl+i',      category: 'File',  label: 'Import Image' },
    { id: 'edit.copy',           keys: 'ctrl+c',      category: 'Edit',  label: 'Copy' },
    { id: 'edit.paste',          keys: 'ctrl+v',      category: 'Edit',  label: 'Paste' },
    { id: 'edit.cut',            keys: 'ctrl+x',      category: 'Edit',  label: 'Cut' },
    { id: 'edit.delete',         keys: 'Delete',      category: 'Edit',  label: 'Delete' },
    { id: 'edit.duplicate',      keys: 'ctrl+d',      category: 'Edit',  label: 'Duplicate' },
    { id: 'edit.group',          keys: 'ctrl+g',      category: 'Edit',  label: 'Group Selection' },
    { id: 'edit.ungroup',        keys: 'ctrl+shift+g', category: 'Edit', label: 'Ungroup' },
    { id: 'edit.flipH',          keys: 'shift+h',     category: 'Edit',  label: 'Flip Horizontal' },
    { id: 'edit.flipV',          keys: 'shift+v',     category: 'Edit',  label: 'Flip Vertical' },
    { id: 'edit.forward',        keys: 'ctrl+]',      category: 'Edit',  label: 'Bring Forward' },
    { id: 'edit.backward',       keys: 'ctrl+[',      category: 'Edit',  label: 'Send Backward' },
    { id: 'edit.front',          keys: 'ctrl+shift+]', category: 'Edit', label: 'Bring to Front' },
    { id: 'edit.back',           keys: 'ctrl+shift+[', category: 'Edit', label: 'Send to Back' },
    { id: 'edit.nudge',          keys: 'ArrowLeft',   category: 'Edit',  label: 'Nudge 1 square (arrows)' },
    { id: 'edit.nudgeFine',      keys: 'shift+ArrowLeft', category: 'Edit', label: 'Nudge ¼ square' },
    { id: 'edit.selectAll',      keys: 'ctrl+a',      category: 'Edit',  label: 'Select All in Layer (twice: every shown layer)' },
    { id: 'edit.rotate90',       keys: 'shift+r',     category: 'Edit',  label: 'Rotate 90°' },
    { id: 'edit.lock',           keys: 'ctrl+shift+l', category: 'Edit', label: 'Lock / Unlock Selection' },
    { id: 'edit.hide',           keys: 'ctrl+shift+h', category: 'Edit', label: 'Hide Selection' },
    { id: 'edit.selectBehind',   keys: 'alt+click',   category: 'Edit',  label: 'Select the Next Object Below' },
    { id: 'edit.dupDrag',        keys: 'alt+drag',    category: 'Edit',  label: 'Duplicate and Move' },
    { id: 'view.fitToContent',   keys: 'ctrl+0',      category: 'View',  label: 'Fit to Content' },
    { id: 'view.focusMode',      keys: '`',           category: 'View',  label: 'Cycle Focus Mode' },
    { id: 'view.litPreview',     keys: 'i',           category: 'View',  label: 'Toggle Lit Preview' },
    { id: 'view.toggleMaps',     keys: 'ctrl+shift+m', category: 'View', label: 'Toggle Maps Panel' },
    { id: 'file.newMap',         keys: 'ctrl+shift+n', category: 'File', label: 'New Map' },
    { id: 'view.shortcuts',      keys: '?',           category: 'View',  label: 'Shortcut Reference' },
    // Layers panel — documentation-only, like file.export above: these live
    // as row-level keydown handling / dnd-kit sensors in the panel
    // components, not in toolKeyMap, so they're listed here purely for the
    // reference dialog.
    // L2: 'ArrowUp+ArrowDown' and 'enter+space' below used to be single
    // entries — formatKeyCombo only knows how to split on '+' and render a
    // chord ("press both at once"), which is wrong for keys that are
    // alternatives. Split into one entry per key instead.
    { id: 'layers.navigateDown', keys: 'ArrowDown',   category: 'Layers', label: 'Navigate Panel' },
    { id: 'layers.navigateUp',   keys: 'ArrowUp',      category: 'Layers', label: 'Navigate Panel' },
    { id: 'layers.select',       keys: 'enter',       category: 'Layers', label: 'Select' },
    { id: 'layers.rename',       keys: 'f2',           category: 'Layers', label: 'Rename (or double-click)' },
    { id: 'layers.toggleVisible', keys: 'space',       category: 'Layers', label: 'Show/Hide' },
    { id: 'layers.delete',       keys: 'Delete',       category: 'Layers', label: 'Delete' },
    { id: 'layers.solo',         keys: 'alt+click',    category: 'Layers', label: 'Solo Layer' },
    { id: 'layers.exitSolo',     keys: 'escape',       category: 'Layers', label: 'Exit Solo' },
    { id: 'layers.selectChildren', keys: 'ctrl+click', category: 'Layers', label: 'Select All Children' },
    { id: 'layers.rowMenu',      keys: 'shift+f10',    category: 'Layers', label: 'Row Menu' },
    { id: 'layers.reorderEnter', keys: 'enter',       category: 'Layers', label: 'Grab/Drop Reorder (on grip)' },
    { id: 'layers.reorderSpace', keys: 'space',       category: 'Layers', label: 'Grab/Drop Reorder (on grip)' },
  ];
}

/** Pass a key-combo string (e.g. 'ctrl+s'). Returns true if handled. */
export function handleShortcut(keyCombo: string): boolean {
  const handler = toolKeyMap[keyCombo];
  if (handler) {
    const result = handler();
    return result !== false;
  }
  return false;
}
