import { create } from 'zustand';
import { prefetchSceneMap } from '../../session/loadSceneMap';
import { useSessionStore } from '../../session/store';

/**
 * Prepare (board 19): fetch a scene's map ahead of switching to it, so Switch now is
 * instant. "Ready" is keyed on the scene and the map it was fetched for; a republish since
 * makes it unready again.
 */
interface Prepared {
  ready: Record<string, string>;
  pending: Record<string, true>;
}

export const usePreparedScenes = create<Prepared>()(() => ({ ready: {}, pending: {} }));

export async function prepareScene(sceneId: string, mapId: string): Promise<void> {
  const token = useSessionStore.getState().token;
  if (!token) return;
  usePreparedScenes.setState((s) => ({ pending: { ...s.pending, [sceneId]: true } }));
  try {
    await prefetchSceneMap(sceneId, mapId, token);
    usePreparedScenes.setState((s) => ({ ready: { ...s.ready, [sceneId]: mapId } }));
  } finally {
    usePreparedScenes.setState((s) => {
      const pending = { ...s.pending };
      delete pending[sceneId];
      return { pending };
    });
  }
}

/** Make a scene the live one for everyone (D6: the `scenes:activate` command). */
export function switchScene(sceneId: string): void {
  useSessionStore.getState().sendCommand('scenes', 'activate', { sceneId });
}
