// src/hooks/useSaveLoad.ts
// React hook for triggering save/load from toolbar or menu components.
import { useCallback } from 'react';
import { saveMap, loadMap } from '@/io/saveLoad';
import { useStore } from '@/store/store';

export function useSaveLoad() {
  const pushToast = useStore((s) => s.pushToast);

  const save = useCallback(
    async (forceNewFile = false) => {
      try {
        const saved = await saveMap(forceNewFile);
        if (saved) {
          pushToast({
            id: `saved-${Date.now()}`,
            message: 'Map saved.',
            type: 'info',
            duration: 2000,
            createdAt: Date.now(),
          });
        }
      } catch (err) {
        console.error('[useSaveLoad] save failed:', err);
        pushToast({
          id: `save-error-${Date.now()}`,
          message: 'Save failed.',
          type: 'error',
          duration: 4000,
          createdAt: Date.now(),
        });
      }
    },
    [pushToast],
  );

  const load = useCallback(async () => {
    try {
      await loadMap();
    } catch (err) {
      console.error('[useSaveLoad] load failed:', err);
      pushToast({
        id: `load-error-${Date.now()}`,
        message: 'Load failed — file may be corrupt.',
        type: 'error',
        duration: 4000,
        createdAt: Date.now(),
      });
    }
  }, [pushToast]);

  return { save, load };
}
