import type { Command } from './types';
import { refreshRooms } from './roomRefresh';
import { useStore } from './store';
import { liveSelectionIds } from './selectionResolve';

/**
 * Room faces and door→room bindings are derived from geometry (and from the
 * anchors and thresholds rooms are placed by), so a command that moved any of
 * those re-derives them here — in the same undo entry, which is what keeps the
 * table's vision from reading a stale roomA/B (DD7). Undo needs no saved
 * binding: it is a pure function of the state undo just restored. Commands
 * without `affectsRooms` (a rename, a look pin) skip the refresh entirely.
 */
function rederiveRooms(cmd: Command): void {
  if (cmd.affectsRooms) refreshRooms();
}

/** How close together two commands with the same `coalesceKey` must land to fold into one entry, ms. */
export const COALESCE_MS = 600;

/**
 * One undo step: the command, and the selection on either side of it. Undo puts back the
 * selection the step started from, redo the one it was undone from, so undoing a delete
 * hands the objects back selected.
 */
interface Entry {
  cmd: Command;
  selectionBefore: string[];
  selectionAfter: string[];
  /** When the step last took a command in, ms. */
  time: number;
  coalesceKey?: string;
  /** For a `restoresUi` command: the active layer and level on show either side of it. */
  uiBefore?: UiPlace;
  uiAfter?: UiPlace;
}

/** Where the DM is drawing: the active layer and the level on show. */
interface UiPlace {
  activeLayerId: string;
  activeLevelId: string;
}

const currentPlace = (): UiPlace => {
  const { activeLayerId, activeLevelId } = useStore.getState().ui;
  return { activeLayerId, activeLevelId };
};

/** Back to `place`, through the setters, so the level and layer rules still hold. */
function restorePlace(place: UiPlace | undefined): void {
  if (!place) return;
  const state = useStore.getState();
  if (state.levels.some((l) => l.id === place.activeLevelId) && state.ui.activeLevelId !== place.activeLevelId) {
    state.setActiveLevelId(place.activeLevelId);
  }
  const layerLives = useStore.getState().layers.some((l) => l.id === place.activeLayerId);
  if (layerLives && useStore.getState().ui.activeLayerId !== place.activeLayerId) {
    useStore.getState().setActiveLayerId(place.activeLayerId);
  }
}

export interface ExecuteOptions {
  /** The selection the step started from, when the caller changed it before executing. */
  selectionBefore?: string[];
}

const currentSelection = (): string[] => [...useStore.getState().selection.selectedIds];

function restoreSelection(ids: string[]): void {
  const state = useStore.getState();
  const live = liveSelectionIds(state, ids);
  const now = state.selection.selectedIds;
  if (live.length === now.length && live.every((id, i) => id === now[i])) return;
  state.setSelectedIds(live);
}

class UndoManager {
  private history: Entry[] = [];
  private future: Entry[] = [];
  readonly MAX_SIZE = 100;
  onChange: ((canUndo: boolean, canRedo: boolean) => void) | null = null;

  execute(cmd: Command, opts: ExecuteOptions = {}): void {
    const selectionBefore = opts.selectionBefore ? [...opts.selectionBefore] : currentSelection();
    const uiBefore = cmd.restoresUi ? currentPlace() : undefined;
    cmd.execute();
    rederiveRooms(cmd);
    const now = Date.now();
    const top = this.history[this.history.length - 1];
    if (
      top &&
      cmd.coalesceKey !== undefined &&
      top.coalesceKey === cmd.coalesceKey &&
      now - top.time <= COALESCE_MS &&
      top.cmd.merge?.(cmd)
    ) {
      top.time = now;
      top.selectionAfter = currentSelection();
      this.future = [];
      this.notify();
      return;
    }
    this.history.push({
      cmd,
      selectionBefore,
      selectionAfter: currentSelection(),
      time: now,
      coalesceKey: cmd.coalesceKey,
      ...(uiBefore ? { uiBefore, uiAfter: currentPlace() } : {}),
    });
    while (this.history.length > this.MAX_SIZE) {
      const evicted = this.history.shift()?.cmd;
      if (evicted && 'cleanup' in evicted && typeof evicted.cleanup === 'function') {
        evicted.cleanup();
      }
    }
    this.future = [];
    this.notify();
  }

  undo(): void {
    const entry = this.history.pop();
    if (!entry) return;
    // What the DM held when they undid: that is what redo hands back.
    entry.selectionAfter = currentSelection();
    // Likewise the layer and level the DM had moved on to.
    if (entry.uiBefore) entry.uiAfter = currentPlace();
    entry.cmd.undo();
    rederiveRooms(entry.cmd);
    restorePlace(entry.uiBefore);
    restoreSelection(entry.selectionBefore);
    this.future.push(entry);
    this.notify();
  }

  redo(): void {
    const entry = this.future.pop();
    if (!entry) return;
    entry.cmd.execute();
    rederiveRooms(entry.cmd);
    restorePlace(entry.uiAfter);
    restoreSelection(entry.selectionAfter);
    // A redone step never folds into what follows it.
    entry.time = 0;
    this.history.push(entry);
    this.notify();
  }

  clear(): void {
    this.history = [];
    this.future = [];
    this.notify();
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** How many steps undo can take. */
  size(): number {
    return this.history.length;
  }

  private notify(): void {
    this.onChange?.(this.canUndo(), this.canRedo());
  }
}

export const undoManager = new UndoManager();
