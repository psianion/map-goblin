// src/shortcuts/defaultShortcuts.ts
// Default keyboard shortcut bindings — file.save and file.load wired to save/load pipeline.

import { saveMap } from '@/io/saveLoad';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { PasteCommand, CutCommand } from '@/store/commands';
import type { DungeonLayer } from '@/store/types';
import { togglePopoverRef } from '@/components/toolbar/toolConstants';

// Keyed by key-combo string (e.g. 'ctrl+s') to match what onKeyDown builds.
const toolKeyMap: Record<string, () => void | false> = {
  // Tool selection
  v: () => { useStore.getState().setActiveTool('select'); },
  g: () => { useStore.getState().setActiveTool('pan'); },
  r: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'rectangle') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('rectangle');
    }
  },
  p: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'polygon') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('polygon');
    }
  },
  h: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'regularPolygon') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('regularPolygon');
    }
  },
  d: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'path') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('path');
    }
  },
  w: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'wall') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('wall');
    }
  },
  l: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'light') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('light');
    }
  },
  // Mode toggles
  e: () => { const s = useStore.getState(); s.setEraseMode(!s.tools.eraseMode); },
  x: () => { const s = useStore.getState(); s.setRoughMode(!s.tools.roughMode); },
  // Undo / redo
  'ctrl+z': () => { undoManager.undo(); },
  'ctrl+shift+z': () => { undoManager.redo(); },
  'ctrl+y': () => { undoManager.redo(); },
  'ctrl+s': () => {
    saveMap().catch((err: unknown) => {
      console.error('[save] failed:', err);
      useStore.getState().pushToast({
        id: `save-error-${Date.now()}`,
        message: 'Save failed — see console for details.',
        type: 'error',
        duration: 4000,
        createdAt: Date.now(),
      });
    });
  },
  'ctrl+o': () => {
    import('@/io/saveLoad')
      .then(({ loadMap }) => {
        loadMap().catch((err: unknown) => {
          console.error('[load] failed:', err);
          useStore.getState().pushToast({
            id: `load-error-${Date.now()}`,
            message: 'Open failed — see console for details.',
            type: 'error',
            duration: 4000,
            createdAt: Date.now(),
          });
        });
      })
      .catch(() => {
        console.error('[load] could not import saveLoad module');
      });
  },
  'ctrl+c': (): void | false => {
    const store = useStore.getState();
    if (store.tools.activeTool !== 'select' || !store.selection.selectedRegion) return false;
    const region = store.selection.selectedRegion;
    const layer = store.layers.find(
      (l): l is DungeonLayer => l.id === store.ui.activeLayerId && l.type === 'dungeon',
    );
    if (layer) store.setClipboard({ region, style: { ...layer.style } });
  },
  'ctrl+v': (): void | false => {
    const store = useStore.getState();
    const clipboard = store.selection.clipboard;
    if (!clipboard) return false;
    const activeLayerId = store.ui.activeLayerId;
    const layer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!layer) return;
    undoManager.execute(new PasteCommand(activeLayerId, layer.mergedFloor, clipboard.region));
    store.setSelectedRegion(null);
  },
  'ctrl+x': (): void | false => {
    const store = useStore.getState();
    if (store.tools.activeTool !== 'select' || !store.selection.selectedRegion) return false;
    const region = store.selection.selectedRegion;
    const activeLayerId = store.ui.activeLayerId;
    const layer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!layer) return;
    store.setClipboard({ region, style: { ...layer.style } });
    undoManager.execute(new CutCommand(activeLayerId, layer.mergedFloor, region));
    store.setSelectedRegion(null);
  },
};

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
    { id: 'tool.path',           keys: 'd',           category: 'Tools', label: 'Path' },
    { id: 'tool.wall',           keys: 'w',           category: 'Tools', label: 'Wall' },
    { id: 'tool.light',          keys: 'l',           category: 'Tools', label: 'Light' },
    { id: 'mode.erase',          keys: 'e',           category: 'Tools', label: 'Toggle Erase' },
    { id: 'mode.rough',          keys: 'x',           category: 'Tools', label: 'Toggle Rough' },
    { id: 'edit.undo',           keys: 'ctrl+z',      category: 'Edit',  label: 'Undo' },
    { id: 'edit.redo',           keys: 'ctrl+y',      category: 'Edit',  label: 'Redo' },
    { id: 'file.save',           keys: 'ctrl+s',      category: 'File',  label: 'Save' },
    { id: 'file.load',           keys: 'ctrl+o',      category: 'File',  label: 'Open' },
    { id: 'file.export',         keys: 'ctrl+e',      category: 'File',  label: 'Export' },
    { id: 'edit.copy',           keys: 'ctrl+c',      category: 'Edit',  label: 'Copy' },
    { id: 'edit.paste',          keys: 'ctrl+v',      category: 'Edit',  label: 'Paste' },
    { id: 'edit.cut',            keys: 'ctrl+x',      category: 'Edit',  label: 'Cut' },
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
