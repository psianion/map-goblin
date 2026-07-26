import type { SerializedMapData } from '@dnd/core/src/store/types';
import { endpoints } from '../endpoints';
import { useSessionStore } from './store';

/**
 * §2.3 — `GET /api/maps/:id` with the session token, straight into the store.
 * The server returns the `.mapbuilder` document verbatim in S1 (it redacts from S3).
 */
export async function loadSceneMap(sceneId: string, token: string): Promise<void> {
  const res = await fetch(`${endpoints.httpBase}/api/maps/${encodeURIComponent(sceneId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Map fetch failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as SerializedMapData;
  useSessionStore.getState().setMapData(data);
}
