// src/shortcuts/defaultShortcuts.ts
// Default keyboard shortcut bindings — file.save and file.load wired to save/load pipeline.

import { saveMap } from '@/io/saveLoad';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';

// Keyed by key-combo string (e.g. 'ctrl+s') to match what onKeyDown builds.
const toolKeyMap: Record<string, () => void> = {
  // Tool selection
  v: () => { useStore.getState().setActiveTool('select'); },
  r: () => { useStore.getState().setActiveTool('rectangle'); },
  p: () => { useStore.getState().setActiveTool('polygon'); },
  h: () => { useStore.getState().setActiveTool('regularPolygon'); },
  d: () => { useStore.getState().setActiveTool('path'); },
  w: () => { useStore.getState().setActiveTool('wall'); },
  l: () => { useStore.getState().setActiveTool('light'); },
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
  ];
}

/** Pass a key-combo string (e.g. 'ctrl+s'). Returns true if handled. */
export function handleShortcut(keyCombo: string): boolean {
  const handler = toolKeyMap[keyCombo];
  if (handler) {
    handler();
    return true;
  }
  return false;
}
