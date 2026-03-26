// src/shortcuts/defaultShortcuts.ts
// Default keyboard shortcut bindings — file.save and file.load wired to save/load pipeline.

import { saveMap } from '@/io/saveLoad';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { notify, notifyCoalesce } from '@/lib/toast';
import { AddChildCommand, RemoveChildCommand, CompositeCommand } from '@/store/commands';
import type { AnyChild, DungeonLayer } from '@/store/types';
import { selectLayerForChild } from '@/store/selectors';
import { togglePopoverRef } from '@/components/toolbar/toolConstants';
import { zoomToFitRef } from '@/components/toolbar/zoomToFitRef';

/** Set by App.tsx so the shortcut system can trigger the file picker */
export const importImageRef: { current: (() => void) | null } = { current: null };

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
  // Mode toggles
  e: () => {
    const s = useStore.getState();
    const next = !s.tools.eraseMode;
    s.setEraseMode(next);
    notify.subtle(next ? 'Erase mode' : 'Draw mode', { icon: 'tool' });
  },
  x: () => {
    const s = useStore.getState();
    const next = !s.tools.roughMode;
    s.setRoughMode(next);
    notify.subtle(next ? 'Rough mode' : 'Smooth mode', { icon: 'tool' });
  },
  // Undo / redo
  'ctrl+z': () => {
    if (!undoManager.canUndo()) {
      notify.subtle('Nothing to undo', { icon: 'undo' });
      return;
    }
    undoManager.undo();
    notifyCoalesce('undo', 'Undo', { duration: 1500, icon: 'undo' });
  },
  'ctrl+shift+z': () => {
    if (!undoManager.canRedo()) {
      notify.subtle('Nothing to redo', { icon: 'redo' });
      return;
    }
    undoManager.redo();
    notifyCoalesce('redo', 'Redo', { duration: 1500, icon: 'redo' });
  },
  'ctrl+y': () => {
    if (!undoManager.canRedo()) {
      notify.subtle('Nothing to redo', { icon: 'redo' });
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
        notify.subtle(children.length === 1 ? 'Copied' : `Copied ${children.length} items`, { icon: 'copy' });
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
      const count = store.selection.clipboard.children.length;
      notify.action(count === 1 ? 'Pasted 1 shape' : `Pasted ${count} shapes`, {
        label: 'Undo',
        onClick: () => undoManager.undo(),
        icon: 'paste',
      });
      return;
    }

    // Region-based paste not implemented in v2.0
    return false;
  },
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
    const modes: Array<'auto' | 'manual' | 'fullscreen'> = ['auto', 'manual', 'fullscreen'];
    const idx = modes.indexOf(state.ui.focusMode);
    const next = modes[(idx + 1) % 3];
    state.setFocusMode(next);
    const labels = { auto: 'Focus: Auto', manual: 'Focus: Manual', fullscreen: 'Focus: Fullscreen' };
    notify.subtle(labels[next], { icon: 'focus' });
  },
  'ctrl+shift+m': () => {
    const state = useStore.getState();
    state.togglePanel('left');
    notify.subtle(state.ui.leftPanelOpen ? 'Maps panel closed' : 'Maps panel opened', { icon: 'map' });
  },
  'ctrl+shift+n': () => {
    // TODO: Replace with store.createMap() when MapsSlice lands
    // For now, just toggle the panel open so the user sees the "+ New Map" button
    const state = useStore.getState();
    if (!state.ui.leftPanelOpen) {
      state.togglePanel('left');
    }
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
      const cutCount = store.selection.selectedIds.length;
      undoManager.execute(new CompositeCommand('Cut', commands));
      notify.action(cutCount === 1 ? 'Cut 1 shape' : `Cut ${cutCount} shapes`, {
        label: 'Undo',
        onClick: () => undoManager.undo(),
        icon: 'scissors',
      });
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
  'delete': (): void | false => {
    const store = useStore.getState();
    if (store.selection.selectedIds.length === 0) return false;

    const delCount = store.selection.selectedIds.length;
    const delCmds = store.selection.selectedIds.map((id) => {
      const layer = selectLayerForChild(store, id);
      return new RemoveChildCommand('Delete', layer?.id ?? '', id);
    });
    undoManager.execute(new CompositeCommand('Delete selected', delCmds));
    notify.action(delCount === 1 ? 'Deleted 1 shape' : `Deleted ${delCount} shapes`, {
      label: 'Undo',
      onClick: () => undoManager.undo(),
      icon: 'trash',
    });
    store.setSelectedIds([]);
  },
  'backspace': (): void | false => {
    return toolKeyMap['delete']?.() ?? false;
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
    { id: 'tool.path',           keys: 'a',           category: 'Tools', label: 'Path' },
    { id: 'tool.wall',           keys: 'w',           category: 'Tools', label: 'Wall' },
    { id: 'tool.door',           keys: 'd',           category: 'Tools', label: 'Door' },
    { id: 'tool.light',          keys: 'l',           category: 'Tools', label: 'Light' },
    { id: 'mode.erase',          keys: 'e',           category: 'Tools', label: 'Toggle Erase' },
    { id: 'mode.rough',          keys: 'x',           category: 'Tools', label: 'Toggle Rough' },
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
    { id: 'view.fitToContent',   keys: 'ctrl+0',      category: 'View',  label: 'Fit to Content' },
    { id: 'view.focusMode',      keys: '`',           category: 'View',  label: 'Cycle Focus Mode' },
    { id: 'view.toggleMaps',     keys: 'ctrl+shift+m', category: 'View', label: 'Toggle Maps Panel' },
    { id: 'file.newMap',         keys: 'ctrl+shift+n', category: 'File', label: 'New Map' },
    { id: 'view.shortcuts',      keys: '?',           category: 'View',  label: 'Shortcut Reference' },
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
