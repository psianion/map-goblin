// src/hooks/useSaveLoad.ts
// React hook for triggering save/load from toolbar or menu components.
import { useCallback } from 'react';
import { saveMap, loadMap } from '@/io/saveLoad';
import { notify } from '@/lib/toast';

export function useSaveLoad() {
  const save = useCallback(async (forceNewFile = false) => {
    try {
      const saved = await saveMap(forceNewFile);
      if (saved) {
        notify.success('Map saved');
      }
    } catch (err) {
      console.error('[useSaveLoad] save failed:', err);
      notify.error('Save failed');
    }
  }, []);

  const load = useCallback(async () => {
    try {
      await loadMap();
    } catch (err) {
      console.error('[useSaveLoad] load failed:', err);
      notify.error('Load failed — file may be corrupt');
    }
  }, []);

  return { save, load };
}
