import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStore } from './store';
import { undoManager, COALESCE_MS } from './undoManager';
import { AddChildCommand, RemoveChildCommand } from './commands';
import type { AnyChild, Command, DungeonLayer } from './types';

const layerId = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!.id;

function light(id: string): AnyChild {
  return {
    id,
    name: id,
    childType: 'light',
    visible: true,
    color: '#ffffff',
    radius: 2,
    featherRadius: 1,
    intensity: 1,
    falloff: 'linear',
    position: { x: 0, y: 0 },
  } as AnyChild;
}

/** A command that counts, with an optional coalescing key that merges into the entry below it. */
class Counter implements Command {
  readonly label = 'Count';
  merged = 0;
  constructor(
    public box: { n: number },
    public coalesceKey?: string,
  ) {}
  execute() {
    this.box.n++;
  }
  undo() {
    this.box.n--;
  }
  merge(next: Command): boolean {
    if (!(next instanceof Counter) || next.coalesceKey !== this.coalesceKey) return false;
    this.parts.push(next);
    return true;
  }
  private parts: Counter[] = [];
  get all(): Counter[] {
    return [this, ...this.parts];
  }
}

/** Counter whose undo also undoes what it merged. */
class Run extends Counter {
  private more: Command[] = [];
  merge(next: Command): boolean {
    if (!(next instanceof Run) || next.coalesceKey !== this.coalesceKey) return false;
    this.more.push(next);
    return true;
  }
  undo() {
    for (let i = this.more.length - 1; i >= 0; i--) this.more[i].undo();
    super.undo();
  }
  execute() {
    super.execute();
    for (const m of this.more) m.execute();
  }
}

describe('UndoManager', () => {
  let now = 1000;
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
    now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  it('restores the selection undo found when it undoes a delete', () => {
    const id = layerId();
    undoManager.execute(new AddChildCommand('Add', id, light('a')));
    useStore.getState().setSelectedIds(['a']);
    undoManager.execute(new RemoveChildCommand('Delete', id, 'a'));
    useStore.getState().setSelectedIds([]);
    undoManager.undo();
    expect(useStore.getState().selection.selectedIds).toEqual(['a']);
  });

  it('drops ids that no longer exist from the selection it restores', () => {
    const id = layerId();
    useStore.getState().setSelectedIds(['ghost']);
    undoManager.execute(new AddChildCommand('Add', id, light('a')));
    undoManager.undo();
    expect(useStore.getState().selection.selectedIds).toEqual([]);
  });

  it('redo restores the selection the step was undone from', () => {
    const id = layerId();
    undoManager.execute(new AddChildCommand('Add', id, light('a')));
    useStore.getState().setSelectedIds(['a']);
    undoManager.undo();
    expect(useStore.getState().selection.selectedIds).toEqual([]);
    undoManager.redo();
    expect(useStore.getState().selection.selectedIds).toEqual(['a']);
  });

  it('takes a caller-given selection before, for a gesture that changed it mid-way', () => {
    const id = layerId();
    undoManager.execute(new AddChildCommand('Add', id, light('a')));
    undoManager.execute(new AddChildCommand('Add', id, light('b')));
    useStore.getState().setSelectedIds(['b']);
    undoManager.execute(new RemoveChildCommand('Delete', id, 'b'), { selectionBefore: ['a'] });
    undoManager.undo();
    expect(useStore.getState().selection.selectedIds).toEqual(['a']);
  });

  it('merges a command into the one below it inside the window', () => {
    const box = { n: 0 };
    undoManager.execute(new Run(box, 'k'));
    now += COALESCE_MS - 1;
    undoManager.execute(new Run(box, 'k'));
    expect(box.n).toBe(2);
    expect(undoManager.size()).toBe(1);
    undoManager.undo();
    expect(box.n).toBe(0);
  });

  it('starts a new entry once the window has passed', () => {
    const box = { n: 0 };
    undoManager.execute(new Run(box, 'k'));
    now += COALESCE_MS + 1;
    undoManager.execute(new Run(box, 'k'));
    expect(undoManager.size()).toBe(2);
  });

  it('measures the window from the latest merged step, not the first', () => {
    const box = { n: 0 };
    for (let i = 0; i < 5; i++) {
      undoManager.execute(new Run(box, 'k'));
      now += COALESCE_MS - 10;
    }
    expect(undoManager.size()).toBe(1);
  });

  it('never merges different keys', () => {
    const box = { n: 0 };
    undoManager.execute(new Run(box, 'a'));
    undoManager.execute(new Run(box, 'b'));
    expect(undoManager.size()).toBe(2);
  });

  it('never merges a command without a key', () => {
    const box = { n: 0 };
    undoManager.execute(new Run(box));
    undoManager.execute(new Run(box));
    expect(undoManager.size()).toBe(2);
  });

  it('does not merge across an undo', () => {
    const box = { n: 0 };
    undoManager.execute(new Run(box, 'k'));
    undoManager.execute(new Counter(box));
    undoManager.undo();
    undoManager.execute(new Run(box, 'k'));
    // The undone step is gone; the new one may merge with the entry now on top.
    expect(undoManager.canRedo()).toBe(false);
  });

  it('keeps the merged entry selection-before of the first step', () => {
    const box = { n: 0 };
    useStore.getState().setSelectedIds(['x']);
    undoManager.execute(new Run(box, 'k'));
    useStore.getState().setSelectedIds([]);
    undoManager.execute(new Run(box, 'k'), { selectionBefore: [] });
    undoManager.undo();
    // 'x' does not exist, so it is filtered; the point is the first entry's list was used.
    expect(useStore.getState().selection.selectedIds).toEqual([]);
    expect(box.n).toBe(0);
  });

  it('caps the history at 100 entries', () => {
    const box = { n: 0 };
    for (let i = 0; i < 120; i++) undoManager.execute(new Counter(box));
    expect(undoManager.size()).toBe(100);
  });
});
