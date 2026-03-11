// src/shortcuts/defaultShortcuts.ts
// Default keyboard shortcut bindings — file.save and file.load wired to save/load pipeline.

import { saveMap } from '@/io/saveLoad';
import { useStore } from '@/store/store';

// Keyed by key-combo string (e.g. 'ctrl+s') to match what onKeyDown builds.
const toolKeyMap: Record<string, () => void> = {
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
    { id: 'file.save', keys: 'ctrl+s', category: 'File', label: 'Save' },
    { id: 'file.load', keys: 'ctrl+o', category: 'File', label: 'Open' },
    { id: 'file.export', keys: 'ctrl+e', category: 'File', label: 'Export' },
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
