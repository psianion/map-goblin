import type { Command } from './types';
import { syncRooms } from './roomSync';

/**
 * Rooms and door→room bindings are derived from geometry, so a command that
 * moved geometry re-derives them here — in the same undo entry, which is what
 * keeps the table's vision from reading a stale roomA/B (DD7). Undo needs no
 * saved binding: it is a pure function of the geometry undo just restored.
 */
function rederiveRooms(cmd: Command): void {
  if (cmd.affectsRooms) syncRooms();
}

class UndoManager {
  private history: Command[] = [];
  private future: Command[] = [];
  readonly MAX_SIZE = 100;
  onChange: ((canUndo: boolean, canRedo: boolean) => void) | null = null;

  execute(cmd: Command): void {
    cmd.execute();
    rederiveRooms(cmd);
    this.history.push(cmd);
    while (this.history.length > this.MAX_SIZE) {
      const evicted = this.history.shift();
      if (evicted && 'cleanup' in evicted && typeof evicted.cleanup === 'function') {
        evicted.cleanup();
      }
    }
    this.future = [];
    this.notify();
  }

  undo(): void {
    const cmd = this.history.pop();
    if (!cmd) return;
    cmd.undo();
    rederiveRooms(cmd);
    this.future.push(cmd);
    this.notify();
  }

  redo(): void {
    const cmd = this.future.pop();
    if (!cmd) return;
    cmd.execute();
    rederiveRooms(cmd);
    this.history.push(cmd);
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

  private notify(): void {
    this.onChange?.(this.canUndo(), this.canRedo());
  }
}

export const undoManager = new UndoManager();
