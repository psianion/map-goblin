import type { DoorChild } from '@dnd/core/src/shared/types';
import type { SerializedMapData } from '@dnd/core/src/store/types';
import { endpoints } from '../endpoints';
import { useSessionStore } from './store';

/**
 * Secret doors are the DM's authoring state, and the session client renders scenes with the
 * *editor's* doorRenderer — so an `isSecret` door arriving in the payload does not merely sit
 * in devtools, it draws its ghosted sprite / secret glyph onto a player's screen. Dropping
 * those children before the store ever sees them is the visual half of the fix.
 *
 * The payload still carries them: server-side redaction lands with the S3 fog work, which is
 * where per-player visibility gets computed anyway. Until then this is a render-path filter
 * and nothing more.
 */
export function withoutSecretDoors(data: SerializedMapData): SerializedMapData {
  return {
    ...data,
    layers: data.layers.map((layer) =>
      'children' in layer
        ? {
            ...layer,
            children: layer.children.filter(
              (child) => !(child.childType === 'door' && (child as DoorChild).isSecret),
            ),
          }
        : layer,
    ),
  };
}

/**
 * §2.3 — `GET /api/maps/:id` with the session token, straight into the store.
 * The server returns the `.mapbuilder` document verbatim in S1 (it redacts from S3), so the
 * DM's secrets are stripped here for anyone who is not the DM.
 */
export async function loadSceneMap(sceneId: string, token: string): Promise<void> {
  const res = await fetch(`${endpoints.httpBase}/api/maps/${encodeURIComponent(sceneId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Map fetch failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as SerializedMapData;
  const store = useSessionStore.getState();
  store.setMapData(store.you?.role === 'dm' ? data : withoutSecretDoors(data));
}
