import { create } from 'zustand';
import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import {
  deleteScene,
  listScenes,
  patchScene,
  publishScene,
  reorderScenes,
  uploadMapFile,
  type SceneMeta,
} from '../../session/auth';
import { readMapFile } from '../../session/mapFile';
import { useSessionStore } from '../../session/store';

/**
 * #47 — the wire snapshot's `scenes` (`session.scenes`) is deliberately thin (`{id, name}`,
 * filtered to what players may see — D5). The DM's own management view needs the full
 * library — sort order, visibility, which map backs each scene — so this store keeps its
 * own copy fetched over REST (`listScenes`) and refetches after anything that changes it.
 * D6's activation itself is still the `scenes:activate` command over the wire, unchanged.
 *
 * A zustand store rather than component state: `ScenePanel` (body) and `SceneFooter` are
 * siblings under `Popover`, not parent/child (M3 shell), so the busy/error/upload state the
 * footer needs has nowhere else to live — the same reason `useDoorSelection` and
 * `useInitiativeSelection` exist.
 */
interface SceneLibrary {
  scenes: SceneMeta[];
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upload: (file: File) => Promise<void>;
  republish: (sceneId: string, file: File) => Promise<void>;
  rename: (sceneId: string, name: string) => Promise<void>;
  toggleVisible: (scene: SceneMeta) => Promise<void>;
  move: (index: number, by: -1 | 1) => Promise<void>;
  remove: (sceneId: string) => Promise<void>;
}

export const useSceneLibrary = create<SceneLibrary>()((set, get) => ({
  scenes: [],
  busy: false,
  error: null,

  refresh: async () => {
    const { session, token } = useSessionStore.getState();
    if (!session || !token) return;
    try {
      set({ scenes: (await listScenes(session.campaignId, token)).scenes });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  upload: (file) =>
    run(async () => {
      const { session, token, client } = useSessionStore.getState();
      if (!token || !session) return;
      // The editor's own save is gzipped (`readMapFile`); a testdata fixture is plain JSON.
      await uploadMapFile(session.campaignId, token, await readMapFile(file));
      // D6: the wire's own scene list only travels inside a snapshot, and `join` is what
      // asks for one — re-sending it is the refetch for the WS-driven parts of the table
      // (fog's map picker, the player-facing list). `refresh()` is the matching refetch for
      // this store's own REST-backed copy.
      client?.send({ type: 'join', protocolVersion: PROTOCOL_VERSION });
    }),

  republish: (sceneId, file) =>
    run(async () => {
      const { token, client } = useSessionStore.getState();
      if (!token) return;
      await publishScene(sceneId, token, await readMapFile(file));
      client?.send({ type: 'join', protocolVersion: PROTOCOL_VERSION });
    }),

  rename: (sceneId, name) =>
    run(async () => {
      const { token } = useSessionStore.getState();
      const trimmed = name.trim();
      if (!token || !trimmed) return;
      await patchScene(sceneId, token, { name: trimmed });
    }),

  toggleVisible: (scene) =>
    run(async () => {
      const { token } = useSessionStore.getState();
      if (!token) return;
      await patchScene(scene.id, token, { visibleToPlayers: !scene.visibleToPlayers });
    }),

  move: (index, by) =>
    run(async () => {
      const { session, token } = useSessionStore.getState();
      if (!token || !session) return;
      const order = get().scenes.map((s) => s.id);
      const target = index + by;
      if (target < 0 || target >= order.length) return;
      [order[index], order[target]] = [order[target]!, order[index]!];
      await reorderScenes(session.campaignId, token, order);
    }),

  remove: (sceneId) =>
    run(async () => {
      const { token } = useSessionStore.getState();
      if (!token) return;
      // No `window.confirm` here — the row's own `⋯` menu is the confirm gate now
      // (M3 §Scene): by the time this fires, the menu has already flipped to "Delete
      // <name>?" and been clicked a second time.
      await deleteScene(sceneId, token);
    }),
}));

/** Every mutating call is the same three lines around the request that differs. */
function run(action: () => Promise<void>): Promise<void> {
  useSceneLibrary.setState({ busy: true, error: null });
  return action()
    .then(() => useSceneLibrary.getState().refresh())
    .catch((e: unknown) => {
      useSceneLibrary.setState({ error: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => useSceneLibrary.setState({ busy: false }));
}
