import type { Command } from './types.ts';

class UndoManager {
  private history: Command[] = [];
  private future: Command[] = [];
  readonly MAX_SIZE = 100;
  onChange: ((canUndo: boolean, canRedo: boolean) => void) | null = null;

  execute(cmd: Command): void {
    cmd.execute();
    this.history.push(cmd);
    if (this.history.length > this.MAX_SIZE) {
      this.history.shift();
    }
    this.future = [];
    this.notify();
  }

  undo(): void {
    const cmd = this.history.pop();
    if (!cmd) return;
    cmd.undo();
    this.future.push(cmd);
    this.notify();
  }

  redo(): void {
    const cmd = this.future.pop();
    if (!cmd) return;
    cmd.execute();
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
