// src/shortcuts/defaultShortcuts.ts
// Default keyboard shortcut bindings — file.save and file.load wired to save/load pipeline.

import { saveMap } from '@/io/saveLoad';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { AddChildCommand, RemoveChildCommand, CompositeCommand } from '@/store/commands';
import type { AnyChild, DungeonLayer } from '@/store/types';
import { selectLayerForChild } from '@/store/selectors';
import { togglePopoverRef } from '@/components/toolbar/toolConstants';

/** Set by App.tsx so the shortcut system can trigger the file picker */
export const importImageRef: { current: (() => void) | null } = { current: null };

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
    if (store.tools.activeTool !== 'select') return false;

    // Object-based copy: copy selected children
    if (store.selection.selectedIds.length > 0) {
      const children = store.selection.selectedIds
        .map((id) => {
          for (const layer of store.layers) {
            if (layer.type !== 'dungeon') continue;
            const child = layer.children.find((c) => c.id === id);
            if (child) return structuredClone(child);
          }
          return undefined;
        })
        .filter(Boolean);
      if (children.length > 0) {
        store.setClipboard({ children: children as AnyChild[] });
      }
      return;
    }

    // Region-based copy (Alt+drag legacy)
    if (store.selection.selectedRegion) {
      const region = store.selection.selectedRegion;
      const layer = store.layers.find(
        (l): l is DungeonLayer => l.id === store.ui.activeLayerId && l.type === 'dungeon',
      );
      if (layer) store.setRegionClipboard({ region, style: { ...layer.style } });
    }
  },
  'ctrl+v': (): void | false => {
    const store = useStore.getState();

    // Object-based paste: duplicate children with new IDs
    if (store.selection.clipboard && store.selection.clipboard.children.length > 0) {
      const activeLayerId = store.ui.activeLayerId;
      const cmds = store.selection.clipboard.children.map((child) => {
        const newChild = structuredClone(child);
        newChild.id = crypto.randomUUID();
        newChild.name = `${child.name} (copy)`;
        if ('position' in newChild) {
          (newChild as AnyChild & { position: { x: number; y: number } }).position = {
            x: (newChild as AnyChild & { position: { x: number; y: number } }).position.x + 1,
            y: (newChild as AnyChild & { position: { x: number; y: number } }).position.y + 1,
          };
        } else if ('transform' in newChild && newChild.transform) {
          newChild.transform.translate = [
            newChild.transform.translate[0] + 1,
            newChild.transform.translate[1] + 1,
          ];
        }
        return new AddChildCommand('Paste child', activeLayerId, newChild);
      });
      undoManager.execute(new CompositeCommand('Paste', cmds));
      return;
    }

    // Region-based paste not implemented in v2.0
    return false;
  },
  'ctrl+i': () => {
    importImageRef.current?.();
  },
  '`': () => {
    const state = useStore.getState();
    const modes: Array<'auto' | 'manual' | 'fullscreen'> = ['auto', 'manual', 'fullscreen'];
    const idx = modes.indexOf(state.ui.focusMode);
    state.setFocusMode(modes[(idx + 1) % 3]);
  },
  'ctrl+x': (): void | false => {
    const store = useStore.getState();
    if (store.tools.activeTool !== 'select') return false;

    // Object-based cut: copy then delete
    if (store.selection.selectedIds.length > 0) {
      // Copy first
      const children = store.selection.selectedIds
        .map((id) => {
          for (const layer of store.layers) {
            if (layer.type !== 'dungeon') continue;
            const child = layer.children.find((c) => c.id === id);
            if (child) return structuredClone(child);
          }
          return undefined;
        })
        .filter(Boolean);
      if (children.length > 0) {
        store.setClipboard({ children: children as AnyChild[] });
      }

      // Delete selected
      const commands = store.selection.selectedIds.map((id) => {
        const layer = selectLayerForChild(store, id);
        return new RemoveChildCommand('Cut', layer?.id ?? '', id);
      });
      undoManager.execute(new CompositeCommand('Cut', commands));
      store.setSelectedIds([]);
      return;
    }

    // Region-based cut (Alt+drag legacy)
    if (store.selection.selectedRegion) {
      const region = store.selection.selectedRegion;
      const activeLayerId = store.ui.activeLayerId;
      const layer = store.layers.find(
        (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
      );
      if (layer) {
        store.setRegionClipboard({ region, style: { ...layer.style } });
      }
      store.setSelectedRegion(null);
    }
  },
  Delete: (): void | false => {
    const store = useStore.getState();
    if (store.selection.selectedIds.length === 0) return false;

    const delCmds = store.selection.selectedIds.map((id) => {
      const layer = selectLayerForChild(store, id);
      return new RemoveChildCommand('Delete', layer?.id ?? '', id);
    });
    undoManager.execute(new CompositeCommand('Delete selected', delCmds));
    store.setSelectedIds([]);
  },
  Backspace: (): void | false => {
    return toolKeyMap['Delete']?.() ?? false;
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
    { id: 'file.import',         keys: 'ctrl+i',      category: 'File',  label: 'Import Image' },
    { id: 'edit.copy',           keys: 'ctrl+c',      category: 'Edit',  label: 'Copy' },
    { id: 'edit.paste',          keys: 'ctrl+v',      category: 'Edit',  label: 'Paste' },
    { id: 'edit.cut',            keys: 'ctrl+x',      category: 'Edit',  label: 'Cut' },
    { id: 'edit.delete',         keys: 'Delete',      category: 'Edit',  label: 'Delete' },
    { id: 'view.focusMode',      keys: '`',           category: 'View',  label: 'Cycle Focus Mode' },
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
