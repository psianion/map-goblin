import { useStore } from '@/store/store';
import { switchMap } from '@/store/mapSwitcher';
import { undoManager } from '@/store/undoManager';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { notify } from '@dnd/ui/toast';

/**
 * Open a map from the home page. Same save, fog and load sequence the v1 maps panel runs,
 * so a map opened from a card is in exactly the state it would be in after a click in the
 * sidebar; its textures download once the editor is up. Resolves to whether that map is
 * the open one now.
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
      // The map's sets download once the editor is up (EditorHost), not from the home page.
      loadMap: (targetId) => useStore.getState().loadMap(targetId),
      clearUndo: () => undoManager.clear(),
      fogIn: fog ? () => fog.fogIn() : () => Promise.resolve(),
      fogOut: fog ? () => fog.fogOut() : () => Promise.resolve(),
      addToast: (msg, type) => {
        if (type === 'error') notify.error(msg);
        else notify.info(msg);
      },
    });
  } catch (err) {
    console.error('[openMap] switch failed:', err);
  }
  return useStore.getState().activeMapId === id;
}
