import { prefetchSceneMap } from './loadSceneMap';
import { waitForSessionSnapshot } from './store';

const SNAPSHOT_TIMEOUT_MS = 5000;
const PREFETCH_CAP_MS = 10000;

/**
 * Warm the table's active scene before `/table` ever mounts `GameRenderer` — the WS
 * `session-state` snapshot (`activeSceneId` + `scenes[].mapId`) only exists once
 * `connect()`'s socket has round-tripped, so this is the earliest point a prefetch can
 * start. An optimization only: no active scene, a snapshot that never arrives, or a
 * prefetch that fails or overruns the cap all fall through to the same place — nothing
 * to await, `join()` navigates regardless. Timeouts are parameters so tests don't pay
 * the production ones.
 */
export async function prepareTableForJoin(
  token: string,
  { snapshotTimeoutMs = SNAPSHOT_TIMEOUT_MS, capMs = PREFETCH_CAP_MS } = {},
): Promise<void> {
  const attempt = async () => {
    try {
      const session = await waitForSessionSnapshot(snapshotTimeoutMs);
      const sceneId = session?.activeSceneId;
      if (!sceneId) return;
      const mapId = session.scenes.find((s) => s.id === sceneId)?.mapId;
      if (!mapId) return;
      await prefetchSceneMap(sceneId, mapId, token);
    } catch (err) {
      console.warn('[JoinSession] table prefetch failed:', err);
    }
  };
  await Promise.race([attempt(), new Promise<void>((resolve) => setTimeout(resolve, capMs))]);
}
