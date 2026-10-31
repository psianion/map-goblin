import { useSyncExternalStore } from 'react';
import { useStore } from '@/store/store';
import type { DungeonLayer } from '@/store/types';
import { undoManager } from '@/store/undoManager';
import { createMoveToLayerCommand } from '@dnd/core/src/store/propEdits';
import { notify } from '@/lib/toast';

/*
 * Drop to layer (board L2): a canvas drag released over a filmstrip tile moves the
 * selection to that tile's layer instead of moving it on the map. The Select tool asks
 * on every move (hover) and at the release; a tile is found by `data-layer-tile`.
 */

type Point = { x: number; y: number };

export interface MoveHooks {
  setMoveReleaseHook(fn: ((screen: Point, ids: string[]) => boolean) | null): void;
  setMoveHoverHook(fn: ((screen: Point | null, ids: string[]) => boolean | void) | null): void;
}

/* ── The tile under a drag, for the drop ring and the status line ─ */

export interface DropTarget {
  layerId: string;
  name: string;
}

let target: DropTarget | null = null;
const listeners = new Set<() => void>();

function setTarget(next: DropTarget | null): void {
  if (target?.layerId === next?.layerId) return;
  target = next;
  for (const fn of listeners) fn();
}

export function currentDropTarget(): DropTarget | null {
  return target;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The tile a canvas drag would drop on right now, or null. */
export function useDropTarget(): DropTarget | null {
  return useSyncExternalStore(subscribe, currentDropTarget, () => null);
}

/** The layer id of the filmstrip tile at a viewport point, or null. */
export function tileLayerAt(clientX: number, clientY: number): string | null {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return null;
  const el = document.elementFromPoint(clientX, clientY);
  const tile = el?.closest?.('[data-layer-tile]') as HTMLElement | null | undefined;
  return tile?.dataset.layerTile ?? null;
}

/**
 * The layer `ids` may be dropped on: a map layer, unlocked, holding at least one of them
 * not already. Null when the drop would do nothing.
 */
export function dropLayerFor(layerId: string | null, ids: readonly string[]): DungeonLayer | null {
  if (!layerId || ids.length === 0) return null;
  const s = useStore.getState();
  const layer = s.layers.find((l) => l.id === layerId);
  if (!layer || layer.type !== 'dungeon' || layer.locked) return null;
  const here = new Set([
    ...layer.children.map((c) => c.id),
    ...layer.standaloneWalls.map((w) => w.id),
    ...(layer.rooms ?? []).map((r) => r.id),
  ]);
  return ids.some((id) => !here.has(id)) ? layer : null;
}

const plural = (n: number) => `${n} object${n === 1 ? '' : 's'}`;

/** Move the selection to `layer` now, one undo step, and say so. */
export function dropSelectionOn(layer: DungeonLayer): boolean {
  const ids = useStore.getState().selection.selectedIds;
  const cmd = createMoveToLayerCommand(ids, layer.id);
  if (!cmd) return false;
  undoManager.execute(cmd);
  notify.action(`Moved ${plural(ids.length)} to ${layer.name || 'layer'}`, {
    label: 'Undo',
    onClick: () => undoManager.undo(),
    icon: 'layers',
  });
  return true;
}

/**
 * Wire the Select tool's move hooks to the tiles. `canvas` turns the tool's canvas px
 * into viewport px. Returns the unwiring.
 */
export function mountDropToLayer(tools: MoveHooks, canvas: HTMLElement): () => void {
  const client = (p: Point) => {
    const r = canvas.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  };
  tools.setMoveHoverHook((screen, ids) => {
    if (!screen) {
      setTarget(null);
      return false;
    }
    const c = client(screen);
    const layer = dropLayerFor(tileLayerAt(c.x, c.y), ids);
    setTarget(layer ? { layerId: layer.id, name: layer.name || 'layer' } : null);
    // Over a tile that takes the drop, the tool holds its live move off the strip.
    return !!layer;
  });
  tools.setMoveReleaseHook((screen, ids) => {
    setTarget(null);
    const c = client(screen);
    const layer = dropLayerFor(tileLayerAt(c.x, c.y), ids);
    if (!layer) return false;
    // The tool puts its live move back once this returns; the move lands after that.
    queueMicrotask(() => {
      dropSelectionOn(layer);
    });
    return true;
  });
  return () => {
    tools.setMoveHoverHook(null);
    tools.setMoveReleaseHook(null);
    setTarget(null);
  };
}
