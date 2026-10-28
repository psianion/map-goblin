import { useStore } from '@/store/store';
import { switchMap } from '@/store/mapSwitcher';
import { undoManager } from '@/store/undoManager';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { getAssetPackManager } from '@/engine/assetPackInstance';
import { notify } from '@/lib/toast';

/**
 * Open a map from the home page. Same save, fog, load, texture-install sequence the
 * v1 maps panel runs, so a map opened from a card is in exactly the state it would be
 * in after a click in the sidebar. Resolves to whether that map is the open one now.
 */
export async function openMap(id: string): Promise<boolean> {
  const state = useStore.getState();
  if (state.activeMapId === id) return true;

  const singleton = getEngineSingleton();
  const fog = singleton?.sceneGraph.fogTransition;

  try {
    await switchMap(id, {
      getActiveMapId: () => useStore.getState().activeMapId,
      getIsMapSwitching: () => useStore.getState().isMapSwitching,
      setIsMapSwitching: (val) => useStore.setState({ isMapSwitching: val }),
      saveCurrentMap: () => useStore.getState().saveCurrentMap(),
      loadMap: async (targetId) => {
        await useStore.getState().loadMap(targetId);
        try {
          await getAssetPackManager().ensureTexturesForMap(useStore.getState());
        } catch (err) {
          console.warn('[v2/openMap] ensureTexturesForMap failed:', err);
        }
      },
      clearUndo: () => undoManager.clear(),
      fogIn: fog ? () => fog.fogIn() : () => Promise.resolve(),
      fogOut: fog ? () => fog.fogOut() : () => Promise.resolve(),
      addToast: (msg, type) => {
        if (type === 'error') notify.error(msg);
        else notify.info(msg);
      },
    });
  } catch (err) {
    console.error('[v2/openMap] switch failed:', err);
  }
  return useStore.getState().activeMapId === id;
}
