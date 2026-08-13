import type { AnyChild, DoorChild, Room, WallSegment } from '@dnd/core/src/shared/types';
import type { Role } from '@dnd/core/src/shared/protocol';
import type { SerializedMapData } from '@dnd/core/src/store/types';
import type { DoorsState } from '@dnd/mechanics/doors';
import { restoreCustomImages, registerImageBlob } from '@dnd/core/src/assets/textureLoader';
import { preloadLayerTextures } from '@dnd/core/src/engine/floorWallRenderer';
import { SPLAT_IMAGE_KEYS } from '@dnd/core/src/engine/terrain/terrainShared';
import { getAssetPackManager } from '@dnd/core/src/engine/assetPackInstance';
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
function upsertById<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
  merge: (existing: T, next: T) => T = (_existing, next) => next,
): T[] {
  if (incoming.length === 0) return current as T[];
  const byId = new Map(incoming.map((item) => [item.id, item]));
  const merged = current.map((item) => {
    const next = byId.get(item.id);
    return next ? merge(item, next) : item;
  });
  for (const item of incoming) {
    if (!current.some((existing) => existing.id === item.id)) merged.push(item);
  }
  return merged;
}

/**
 * A door that was open stays open across a reveal.
 *
 * Live door state travels on the `doors` module slice, and the lighting lane writes it back
 * onto the map's own door children so ClockwiseSweep can treat a shut door as a wall (D12,
 * `doorLighting`). The server's delta carries the *authored* child — `redactMap` never
 * stamps the live state onto it — so replacing the child wholesale reset `state` to whatever
 * the map was saved with. A fog reveal whose delta happened to carry an already-open door
 * therefore swung it shut, occlusion and all, with nobody touching it: the portcullis the
 * gate walk saw close on its own. `syncDoorsToLighting` repairs the drift on the next store
 * pass, which is why it normally reads as a flash and only sometimes sticks.
 */
function keepLiveDoorState(existing: AnyChild, next: AnyChild): AnyChild {
  if (existing.childType !== 'door' || next.childType !== 'door') return next;
  return { ...next, state: (existing as DoorChild).state };
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
  loadedSceneId: string | null | undefined,
): SerializedMapData | null {
  if (!current || !delta?.layers?.length) return current;
  if (loadedSceneId && delta.sceneId !== loadedSceneId) return current;

  const byId = new Map(delta.layers.map((layer) => [layer.id, layer]));
  const merged: SerializedMapData = {
    ...current,
    layers: current.layers.map((layer) => {
      const patch = byId.get(layer.id);
      if (!patch || layer.type !== 'dungeon') return layer;
      return {
        ...layer,
        rooms: upsertById(layer.rooms ?? [], patch.rooms ?? []),
        children: upsertById(layer.children, patch.children ?? [], keepLiveDoorState),
        standaloneWalls: upsertById(layer.standaloneWalls, patch.standaloneWalls ?? []),
      };
    }),
  };
  return forViewer(merged, role, loadedSceneId ?? delta.sceneId);
}

interface SceneDoc {
  data: SerializedMapData;
  splatPngs: [Blob | null, Blob | null];
}

/**
 * §2.3 — `GET /api/maps/:id` with the session token. The server redacts the document for
 * players from S3; `withoutSecretDoors` (applied at commit time) is the second lock.
 */
async function fetchSceneDoc(sceneId: string, token: string): Promise<SceneDoc> {
  const headers = { Authorization: `Bearer ${token}` };
  // `images=external` asks the server to leave the images out of the JSON and
  // list their keys instead — megabytes of base64 stop riding the document.
  const res = await fetch(
    `${endpoints.httpBase}/api/maps/${encodeURIComponent(sceneId)}?images=external`,
    { headers },
  );
  if (!res.ok) throw new Error(`Map fetch failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as SerializedMapData;

  const splatPngs: [Blob | null, Blob | null] = [null, null];
  if (data.imageKeys?.length) {
    // Binary, in parallel: splat bitmaps become Blobs for core's terrainSplats;
    // imported pictures register with Pixi so the document resolves them as it
    // builds (deltas reuse the initial document's images — once is enough).
    // Per-image failures cost that image, not the map.
    await Promise.all(
      data.imageKeys.map(async (key) => {
        const r = await fetch(
          `${endpoints.httpBase}/api/maps/${encodeURIComponent(sceneId)}/images/${encodeURIComponent(key)}`,
          { headers },
        );
        if (!r.ok) {
          console.warn('[loadSceneMap] image fetch failed:', key, r.status);
          return;
        }
        const blob = await r.blob();
        const splatIndex = SPLAT_IMAGE_KEYS.indexOf(key as (typeof SPLAT_IMAGE_KEYS)[number]);
        if (splatIndex >= 0) splatPngs[splatIndex as 0 | 1] = blob;
        else await registerImageBlob(key, blob);
      }),
    );
  } else {
    // A server still answering with inline data URLs (or a map with none).
    await restoreCustomImages(data.customImages);
  }

  return { data, splatPngs };
}

// ── Scene document cache ─────────────────────────────────────────────────────
// Switching back to a scene the table already visited should not cost a refetch. Keyed on
// `sceneId:mapId` so a republish is naturally a miss. Small on purpose: documents are
// megabytes, and a table rarely bounces between more than a couple of scenes.
const DOC_CACHE_MAX = 4;
const docCache = new Map<string, SceneDoc>();
const docKey = (sceneId: string, mapId: string): string => `${sceneId}:${mapId}`;

function cachePut(key: string, doc: SceneDoc): void {
  docCache.delete(key);
  docCache.set(key, doc);
  for (const oldest of docCache.keys()) {
    if (docCache.size <= DOC_CACHE_MAX) break;
    docCache.delete(oldest);
  }
}

/**
 * Drop every cached document of a scene. Called when fog state moves under a scene the
 * client is not currently holding (its cached copy no longer matches what a fetch would
 * answer) and when a swap lands a fresh fetch.
 */
export function invalidateSceneDocs(sceneId: string): void {
  for (const key of docCache.keys()) {
    if (key.startsWith(`${sceneId}:`)) docCache.delete(key);
  }
}

/** Cache-hit or fetch-and-cache — the one place either caller decides which. */
async function getOrFetchSceneDoc(sceneId: string, mapId: string, token: string): Promise<SceneDoc> {
  const key = docKey(sceneId, mapId);
  let doc = docCache.get(key);
  if (!doc) {
    doc = await fetchSceneDoc(sceneId, token);
    // A fresh fetch is the newest truth for this scene — older cached copies are stale.
    invalidateSceneDocs(sceneId);
    cachePut(key, doc);
  }
  return doc;
}

/**
 * Warm everything a rebuild will ask for: floor/wall textures already resident in the
 * bundle (fast, per-layer), and any pack asset sets install-by-need has not fetched yet
 * (network, per map). Both failure modes are soft — a missing texture degrades to the
 * magenta fallback exactly as it always has, and this must never be the reason a table
 * fails to load.
 */
async function warmSceneTextures(doc: SceneDoc): Promise<void> {
  try {
    await Promise.all(
      doc.data.layers
        .filter((layer) => layer.type === 'dungeon')
        .map((layer) => preloadLayerTextures(layer)),
    );
  } catch {
    /* textures load lazily during rebuild instead */
  }
  try {
    await getAssetPackManager().ensureTexturesForMap(doc.data);
  } catch (err) {
    console.warn('[loadSceneMap] ensureTexturesForMap failed:', err);
  }
}

// A later swap supersedes an earlier one wholesale — whichever fetch resolves last must
// not clobber the scene the table actually moved to.
let swapGen = 0;

/**
 * Move the table to `sceneId` without ever rendering nothing (F1/F3's client half).
 *
 * The held document stays in the store — and on screen — until the replacement is fully
 * in hand: fetched (or cache-hit), images registered, floor/wall textures preloaded, any
 * missing pack asset sets installed. Only then does one `setMapData` swap it, so the
 * engine rebuilds straight into drawable layers instead of empty containers waiting on
 * textures. The outgoing document is stashed in the cache as-held (merged reveals
 * included), which is what makes switching back instant; re-applying `forViewer` on
 * re-entry is idempotent.
 */
export async function swapSceneMap(sceneId: string, mapId: string, token: string): Promise<void> {
  const gen = ++swapGen;
  const store = useSessionStore.getState();

  // Stash the outgoing document before anything can replace it.
  if (store.loadedScene && store.mapData) {
    cachePut(docKey(store.loadedScene.sceneId, store.loadedScene.mapId), {
      data: store.mapData as SerializedMapData,
      splatPngs: store.splatPngs,
    });
  }

  const doc = await getOrFetchSceneDoc(sceneId, mapId, token);
  await warmSceneTextures(doc);

  if (gen !== swapGen) return; // superseded by a newer switch mid-flight

  const fresh = useSessionStore.getState();
  fresh.setMapData(forViewer(doc.data, fresh.you?.role, sceneId), doc.splatPngs, {
    sceneId,
    mapId,
  });
}

/**
 * The join screen's optimization: warm the doc cache and its textures for the table's
 * active scene before `/table` ever mounts `GameRenderer`, so the `swapSceneMap` it runs
 * on mount is a cache hit with textures already resident instead of a cold fetch. Commits
 * nothing to the store — `swapSceneMap` still does that, once the table is actually up.
 */
export async function prefetchSceneMap(sceneId: string, mapId: string, token: string): Promise<void> {
  const doc = await getOrFetchSceneDoc(sceneId, mapId, token);
  await warmSceneTextures(doc);
}
