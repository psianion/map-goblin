import { useStore } from '@/store/store';
import type { Command, Layer } from '@/store/types';
import { createDungeonLayer } from '@/store/factories';
import {
  AddLayerCommand,
  CompositeCommand,
  MoveLayerToLevelCommand,
  PropertyCommand,
  RemoveLayerCommand,
  ReorderLayerCommand,
} from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { notify } from '@/lib/toast';
import {
  DuplicateLayerCommand,
  RemoveLevelCascadeCommand,
  ReorderLevelCommand,
  layerContentBounds,
  layerDeleteBlock,
  layerMoveBlock,
} from '@dnd/core/src/store/layerCommands';
import { fitToBounds, fitToContent } from '@/components/toolbar/zoomControl';
import { nextLayerName } from './roomActions';

/*
 * The layer and level verbs every Layers surface shares: the filmstrip tiles and their
 * menu, the Layers sheet rows, the gear sheet's Actions, the level picker. Each is one
 * undo step (and the layer and level ones put the active layer back on undo).
 */

const nameOf = (layer: Pick<Layer, 'name' | 'type'>) => layer.name || (layer.type === 'background' ? 'Background' : 'Unnamed layer');

export function toggleLayerVisible(layer: Layer): void {
  // An eye click is the DM taking visibility back: solo ends first.
  if (useStore.getState().ui.solo) useStore.getState().clearSolo();
  const was = layer.visible;
  undoManager.execute(
    new PropertyCommand(was ? 'Hide layer' : 'Show layer', { type: 'layer', layerId: layer.id }, { visible: was }, { visible: !was }),
  );
}

export function toggleLayerLocked(layer: Layer): void {
  const was = layer.locked;
  undoManager.execute(
    new PropertyCommand(was ? 'Unlock layer' : 'Lock layer', { type: 'layer', layerId: layer.id }, { locked: was }, { locked: !was }),
  );
  notify.subtle(was ? `${nameOf(layer)} unlocked` : `${nameOf(layer)} locked`, { icon: was ? 'unlock' : 'lock' });
}

export function renameLayer(layer: Layer, name: string): void {
  const next = name.trim();
  if (!next || next === layer.name) return;
  undoManager.execute(new PropertyCommand('Rename layer', { type: 'layer', layerId: layer.id }, { name: layer.name }, { name: next }));
}

export function toggleSolo(layerId: string): void {
  useStore.getState().toggleSoloLayer(layerId);
}

/** A copy of the layer above it, drawn on next. */
export function duplicateLayer(layerId: string): string | null {
  const source = useStore.getState().layers.find((l) => l.id === layerId);
  if (!source || source.type !== 'dungeon') return null;
  const cmd = new DuplicateLayerCommand(layerId);
  undoManager.execute(cmd);
  useStore.getState().setActiveLayerId(cmd.newId);
  const rooms = (source.rooms?.length ?? 0) > 0;
  notify.subtle(rooms ? `${nameOf(source)} copied. Rooms copied without their key` : `${nameOf(source)} copied`, { icon: 'copy' });
  return cmd.newId;
}

/** Delete a layer, unless it is locked, the background or the last one on its level. */
export function deleteLayer(layerId: string): boolean {
  const state = useStore.getState();
  const block = layerDeleteBlock(state, layerId);
  if (block) {
    notify.warning(block);
    return false;
  }
  const layer = state.layers.find((l) => l.id === layerId)!;
  undoManager.execute(new RemoveLayerCommand('Delete layer', layerId));
  notify.action(`Deleted “${nameOf(layer)}”`, { label: 'Undo', onClick: () => undoManager.undo(), icon: 'trash' });
  return true;
}

/** Move a layer to another level; the level on show stays, and picks its next layer. */
export function moveLayerToLevel(layerId: string, levelId: string): boolean {
  const state = useStore.getState();
  const layer = state.layers.find((l) => l.id === layerId);
  const level = state.levels.find((l) => l.id === levelId);
  if (!layer || !level || layer.levelId === levelId) return false;
  const block = layerMoveBlock(state, layerId);
  if (block) {
    notify.warning(block);
    return false;
  }
  const shown = state.ui.activeLevelId;
  undoManager.execute(new MoveLayerToLevelCommand(layerId, levelId));
  useStore.getState().setActiveLevelId(shown);
  notify.subtle(`${nameOf(layer)} moved to ${level.name}`, { icon: 'tool' });
  return true;
}

/** Frame the camera on what a layer holds; the whole map for an empty one. */
export function zoomToLayer(layer: Layer): void {
  const b = layerContentBounds(layer);
  if (b) fitToBounds(b);
  else fitToContent();
}

/** A new layer on the level on show, made active; its id. */
export function addLayerOnShownLevel(): string {
  const s = useStore.getState();
  const layer = createDungeonLayer(nextLayerName(s.layers), s.ui.activeLevelId);
  undoManager.execute(new AddLayerCommand('Add layer', layer));
  useStore.getState().setActiveLayerId(layer.id);
  return layer.id;
}

/**
 * The array move that puts `activeId` where `overId` is, both layers of the map. Null for
 * a no-op or a move the background or a locked layer blocks.
 */
export function reorderIndexes(layers: readonly Layer[], activeId: string, overId: string): { from: number; to: number } | null {
  if (activeId === overId) return null;
  const from = layers.findIndex((l) => l.id === activeId);
  const to = layers.findIndex((l) => l.id === overId);
  if (from <= 0 || to <= 0) return null;
  return { from, to };
}

/** Drag a layer onto another's place (a tile, a sheet row); across levels it changes level too. */
export function moveLayerOnto(activeId: string, overId: string): boolean {
  const state = useStore.getState();
  const moving = state.layers.find((l) => l.id === activeId);
  const over = state.layers.find((l) => l.id === overId);
  if (!moving || !over || moving.type === 'background' || over.type === 'background') return false;
  if (moving.locked) {
    notify.warning('Layer is locked');
    return false;
  }
  const idx = reorderIndexes(state.layers, activeId, overId);
  const crossLevel = moving.levelId !== over.levelId;
  if (crossLevel) {
    const block = layerMoveBlock(state, activeId);
    if (block) {
      notify.warning(block);
      return false;
    }
  }
  const steps: Command[] = [];
  if (crossLevel) steps.push(new MoveLayerToLevelCommand(activeId, over.levelId));
  if (idx) steps.push(new ReorderLayerCommand('Reorder layer', idx.from, idx.to));
  if (steps.length === 0) return false;
  undoManager.execute(steps.length === 1 ? steps[0] : new CompositeCommand('Move layer', steps));
  return true;
}

/** A move to the far end of a level (a sheet drop on a level row). */
export function moveLayerToLevelTop(activeId: string, levelId: string): boolean {
  const state = useStore.getState();
  const onLevel = state.layers.filter((l) => l.type !== 'background' && l.levelId === levelId && l.id !== activeId);
  const top = onLevel.at(-1);
  if (top) return moveLayerOnto(activeId, top.id);
  return moveLayerToLevel(activeId, levelId);
}

/** Delete a level: its layers move to `moveTo`, or (null) go with it. */
export function deleteLevel(levelId: string, moveTo: string | null): boolean {
  const state = useStore.getState();
  const level = state.levels.find((l) => l.id === levelId);
  if (!level) return false;
  if (state.levels.length <= 1) {
    notify.warning('A map needs one level');
    return false;
  }
  const cmd = new RemoveLevelCascadeCommand(levelId, moveTo);
  undoManager.execute(cmd);
  if (cmd.refused) return false;
  notify.action(`Deleted “${level.name}”`, { label: 'Undo', onClick: () => undoManager.undo(), icon: 'trash' });
  return true;
}

export function reorderLevel(from: number, to: number): void {
  const n = useStore.getState().levels.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
  undoManager.execute(new ReorderLevelCommand(from, to));
}

/** Page Up / Page Down: the level before or after the one on show, clamped. */
export function stepLevel(step: -1 | 1): boolean {
  const s = useStore.getState();
  const i = s.levels.findIndex((l) => l.id === s.ui.activeLevelId);
  const next = s.levels[Math.max(0, Math.min(s.levels.length - 1, (i < 0 ? 0 : i) + step))];
  if (!next || next.id === s.ui.activeLevelId) return false;
  s.setActiveLevelId(next.id);
  s.setSelectedIds([]);
  notify.subtle(next.name || 'Level', { icon: 'layers' });
  return true;
}

/* ── Inline rename on a tile, asked for from elsewhere (the "+", a menu) ─ */

let renaming: string | null = null;
const renameListeners = new Set<() => void>();

/** Open the inline name field on the tile of `layerId` (null closes it). */
export function requestTileRename(layerId: string | null): void {
  if (renaming === layerId) return;
  renaming = layerId;
  for (const fn of renameListeners) fn();
}

export function tileRenameTarget(): string | null {
  return renaming;
}

export function subscribeTileRename(fn: () => void): () => void {
  renameListeners.add(fn);
  return () => {
    renameListeners.delete(fn);
  };
}

/* ── Focus in the strip, for the status bar's key hint ─ */

let stripFocused = false;
const stripListeners = new Set<() => void>();

export function setStripFocused(on: boolean): void {
  if (stripFocused === on) return;
  stripFocused = on;
  for (const fn of stripListeners) fn();
}

export function isStripFocused(): boolean {
  return stripFocused;
}

export function subscribeStripFocus(fn: () => void): () => void {
  stripListeners.add(fn);
  return () => {
    stripListeners.delete(fn);
  };
}

/** Opens the level picker's menu (the title card's level name asks for it). */
export const openLevelMenuRef: { current: (() => void) | null } = { current: null };
