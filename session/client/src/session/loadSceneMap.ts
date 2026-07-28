import type { AnyChild, DoorChild, Room, WallSegment } from '@dnd/core/src/shared/types';
import type { Role } from '@dnd/core/src/shared/protocol';
import type { SerializedMapData } from '@dnd/core/src/store/types';
import type { DoorsState } from '@dnd/mechanics/doors';
import { endpoints } from '../endpoints';
import { useSessionStore } from './store';

/**
 * The geometry a reveal hands over, riding on the `fog` state-update that reveals it (D5).
 *
 * Structural, not imported: `protocol.ts` does not name it and belongs to another lane. The
 * authority is the server's own `MapDelta` / `MapDeltaLayer` in
 * `session/server/src/fog/redactMap.ts` — keep these in step with it.
 */
export interface MapDeltaLayer {
  id: string;
  rooms: Room[];
  children: AnyChild[];
  standaloneWalls: WallSegment[];
}

export interface MapDelta {
  sceneId: string;
  layers: MapDeltaLayer[];
}

/**
 * Secret doors are the DM's authoring state, and the session client renders scenes with the
 * *editor's* doorRenderer — so an `isSecret` door arriving in the payload does not merely sit
 * in devtools, it draws its ghosted sprite / secret glyph onto a player's screen. Dropping
 * those children before the store ever sees them is the visual half of the fix.
 *
 * S3's server-side redaction now strips them before the wire, so this is defence in depth
 * rather than the fix: a payload that ever regains one is caught one layer before the canvas.
 * Both the initial load and every reveal delta go through it.
 *
 * `revealed` is the door D2 has to leave open. Once the DM lets the party in on a secret
 * door the server sends its child *deliberately*, and an unconditional filter on the
 * authored `isSecret` flag throws it away again — which is why a revealed secret door used
 * to reach the player's door state and never their map, on a broadcast, a reload or a
 * restart alike. The set is read off this seat's own `doors` slice, which the server has
 * already cut to `revealed && explored`, so this stays a second lock rather than a hole: a
 * door the server never admitted is not in the set and is still dropped here.
 */
export function withoutSecretDoors(
  data: SerializedMapData,
  revealed: ReadonlySet<string> = new Set(),
): SerializedMapData {
  return {
    ...data,
    layers: data.layers.map((layer) =>
      'children' in layer
        ? {
            ...layer,
            children: layer.children.filter(
              (child) =>
                !(
                  child.childType === 'door' &&
                  (child as DoorChild).isSecret &&
                  !revealed.has(child.id)
                ),
            ),
          }
        : layer,
    ),
  };
}

/** The secret doors this seat has been let in on, off its own (already redacted) slice. */
function revealedDoors(sceneId: string | null | undefined): Set<string> {
  const doors = useSessionStore.getState().session?.modules?.doors as DoorsState | undefined;
  const scene = (sceneId && doors?.byScene?.[sceneId]) || {};
  const ids = new Set<string>();
  for (const [id, live] of Object.entries(scene)) if (live.revealed) ids.add(id);
  return ids;
}

/** The map as this seat is allowed to hold it. Unknown role is treated as a player. */
const forViewer = (
  data: SerializedMapData,
  role: Role | undefined,
  sceneId: string | null | undefined,
): SerializedMapData => (role === 'dm' ? data : withoutSecretDoors(data, revealedDoors(sceneId)));

/**
 * Merge by id, keeping the order the map already had. Upsert rather than append: a door or
 * a wall on the boundary between two rooms arrives with *both* of them, so a reveal that
 * opens the second one re-sends geometry the client already holds (§2.3.3).
 */
function upsertById<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  if (incoming.length === 0) return current as T[];
  const byId = new Map(incoming.map((item) => [item.id, item]));
  const merged = current.map((item) => byId.get(item.id) ?? item);
  for (const item of incoming) {
    if (!current.some((existing) => existing.id === item.id)) merged.push(item);
  }
  return merged;
}

/**
 * §2.4.5 / D5 — fold a reveal's geometry into the loaded map.
 *
 * The result goes back through `setMapData`, so it lands in the engine down the same
 * `loadFromFile` path the initial load takes: the delta decides *what* is added, never
 * *how* it is drawn. `mergedFloor` is deliberately left as the server sent it (null for
 * players) — core recomputes it from the shape children on the next store pass, which is
 * also what invalidates the lighting, so a revealed room is torchlit before it is shown.
 *
 * A delta for a scene that is no longer active is dropped; a layer the client does not hold
 * is dropped too, rather than synthesised from a shape that has no style to draw with.
 */
export function mergeMapDelta(
  current: SerializedMapData | null,
  delta: MapDelta,
  role: Role | undefined,
  activeSceneId: string | null | undefined,
): SerializedMapData | null {
  if (!current || !delta?.layers?.length) return current;
  if (activeSceneId && delta.sceneId !== activeSceneId) return current;

  const byId = new Map(delta.layers.map((layer) => [layer.id, layer]));
  const merged: SerializedMapData = {
    ...current,
    layers: current.layers.map((layer) => {
      const patch = byId.get(layer.id);
      if (!patch || layer.type !== 'dungeon') return layer;
      return {
        ...layer,
        rooms: upsertById(layer.rooms ?? [], patch.rooms ?? []),
        children: upsertById(layer.children, patch.children ?? []),
        standaloneWalls: upsertById(layer.standaloneWalls, patch.standaloneWalls ?? []),
      };
    }),
  };
  return forViewer(merged, role, activeSceneId ?? delta.sceneId);
}

/**
 * §2.3 — `GET /api/maps/:id` with the session token, straight into the store.
 * The server redacts the document for players from S3; `withoutSecretDoors` is the second
 * lock on the same door.
 */
export async function loadSceneMap(sceneId: string, token: string): Promise<void> {
  const res = await fetch(`${endpoints.httpBase}/api/maps/${encodeURIComponent(sceneId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Map fetch failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as SerializedMapData;
  const store = useSessionStore.getState();
  store.setMapData(forViewer(data, store.you?.role, sceneId));
}
