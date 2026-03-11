// src/shortcuts/defaultShortcuts.ts
// Default keyboard shortcut bindings — file.save and file.load wired to save/load pipeline.

import { saveMap } from '@/io/saveLoad';
import { useStore } from '@/store/store';

const toolKeyMap: Record<string, () => void> = {
  'file.save': () => {
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
  'file.load': () => {
    import('@/io/saveLoad')
      .then(({ loadMap }) => {
        loadMap().catch((err: unknown) => {
          console.error('[load] failed:', err);
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

export function handleShortcut(id: string): boolean {
  const handler = toolKeyMap[id];
  if (handler) {
    handler();
    return true;
  }
  return false;
}
