import type { StateCreator } from 'zustand';
import type { Layer, MapBuilderStore, MapMeta, MapSettings, MapsSlice, TerrainData } from '../types';
import type { MapDB, MapRecord } from '../mapIO';
import { getMapDBFactory, getMapSerializer } from '../mapIO';
import { computeMapFrame } from '../../shared/mapBounds';

// Module-level singleton — opened once on first use.
// Store the opening promise to prevent race conditions (React Strict Mode double-mount).
let mapDB: MapDB | null = null;
let openingPromise: Promise<MapDB> | null = null;

export async function getMapDB(): Promise<MapDB> {
  if (mapDB) return mapDB;
  if (openingPromise) return openingPromise;

  openingPromise = (async () => {
    const db = getMapDBFactory()();
    await db.open();
    mapDB = db;
    return db;
  })();

  return openingPromise;
}

// For testing — allows injecting a mock/reset
export function resetMapDB(): void {
  mapDB = null;
  openingPromise = null;
  lastDeleted = null;
  autoCreatedBlank = null;
}

/**
 * The map's size in whole cells. Every card used to print a hardcoded 40×40 that meant
 * nothing. A pinned map reports the size it was pinned to; otherwise this measures off
 * what is actually drawn, and a map with nothing on it has no frame at all and measures
 * 0×0 — the card renders that as "Empty" rather than inventing a number.
 *
 * Pass `fixedSize` wherever the answer stands for the map itself. Omit it where the
 * question is genuinely "how big is the content" — settings mode asks that, so switching
 * a pinned map back to Expanding can offer the measured size.
 */
export function measureGridSize(
  layers: readonly Layer[],
  terrainBounds: TerrainData['bounds'] = null,
  fixedSize: MapSettings['fixedSize'] = null,
): { width: number; height: number } {
  const frame = computeMapFrame(layers, terrainBounds, fixedSize);
  if (!frame) return { width: 0, height: 0 };
  return { width: frame.maxX - frame.minX, height: frame.maxY - frame.minY };
}

// The record deleteMap just removed, kept so the delete toast's Undo can put it back.
// ponytail: one in-memory slot, dropped on reload — this is undo-the-last-delete, not a
// trash bin. A real archive would need its own store and a retention rule.
let lastDeleted: MapRecord | null = null;

// The blank map `deleteMap` had to auto-create because the delete took the last one. Kept
// as its just-created meta so Undo can tell "still that untouched blank" from "the user
// has drawn in it since" and only take the former back out.
let autoCreatedBlank: MapMeta | null = null;

/**
 * Re-inserts the most recently deleted map under its original id, or null when there is
 * nothing stashed. The caller puts `meta` back in `mapIndex` — the alternative, reloading
 * the whole index, would also reload the active map from disk and throw away whatever was
 * drawn since the delete — and drops `removedBlankId` from it when it is set.
 *
 * Save the open map before calling this: the blank's stored record is the only evidence of
 * whether anything was drawn in it.
 */
export async function restoreLastDeletedMap(): Promise<
  { meta: MapMeta; removedBlankId: string | null } | null
> {
  const record = lastDeleted;
  const blank = autoCreatedBlank;
  lastDeleted = null;
  autoCreatedBlank = null;
  if (!record) return null;
  const db = await getMapDB();
  await db.restoreMap(record);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: _, ...meta } = record;

  // Remove the auto-created blank, but only while it still measures 0×0 under the name and
  // layer count it was created with. gridSize is rewritten from the geometry on every save,
  // so it separates drawn-in from untouched; timestamps cannot — a save bumps updatedAt
  // whether or not anything changed. Anything else and the blank stays: litter is cheaper
  // than deleting a map with work in it.
  let removedBlankId: string | null = null;
  if (blank) {
    const now = await db.getMapRecord(blank.id);
    if (
      now &&
      now.name === blank.name &&
      now.layerCount === blank.layerCount &&
      now.gridSize.width === 0 &&
      now.gridSize.height === 0
    ) {
      await db.deleteMap(blank.id);
      removedBlankId = blank.id;
    }
  }
  return { meta, removedBlankId };
}

export const createMapsSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  MapsSlice
> = (set, get) => ({
  mapIndex: [],
  activeMapId: null,
  isMapSwitching: false,

  async loadMapIndex() {
    const db = await getMapDB();
    const metas = await db.getAllMapMeta();
    set((s) => {
      s.mapIndex = metas;
      if (metas.length > 0 && !s.activeMapId) {
        s.activeMapId = metas[0].id; // most recent (sorted desc)
      }
    });

    // Load the active map's content from IDB (restores canvas on reload)
    const activeId = get().activeMapId;
    if (activeId) {
      try {
        await get().loadMap(activeId);
      } catch (err) {
        console.warn('Failed to load active map on startup:', err);
      }
    }
  },

  async saveCurrentMap() {
    const { activeMapId } = get();
    if (!activeMapId) return;

    const db = await getMapDB();
    const state = get();
    const serializable = state.getSerializableState();
    const bytes = await getMapSerializer().serializeToBytes(serializable);
    const layerCount = state.layers.length;

    const gridSize = measureGridSize(
      state.layers,
      state.mapSettings.terrain?.bounds ?? null,
      state.mapSettings.fixedSize ?? null,
    );

    await db.saveMapBlob(activeMapId, bytes, gridSize, layerCount);

    // Update mapIndex entry in store
    set((s) => {
      const entry = s.mapIndex.find((m) => m.id === activeMapId);
      if (entry) {
        entry.updatedAt = Date.now();
        entry.gridSize = gridSize;
        entry.layerCount = layerCount;
      }
    });
  },

  async loadMap(id: string) {
    const db = await getMapDB();
    const blob = await db.getMapBlob(id);
    if (!blob) throw new Error(`Map ${id} not found in IndexedDB`);

    const parsed = await getMapSerializer().deserializeFromBytes(blob);
    get().loadFromFile(parsed);
    // The card list is the name of record. `renameMap` used to write only there, so any map
    // renamed before that was fixed still has the old name inside its document — and that is
    // the one exports use for the filename. Reconcile on the way in, which heals those.
    const indexName = get().mapIndex.find((m) => m.id === id)?.name;
    if (indexName && indexName !== get().mapSettings.name) get().setMapName(indexName);
    set((s) => {
      s.activeMapId = id;
    });
  },

  async createNewMap(name = 'Untitled Map') {
    const { activeMapId } = get();

    // Save current map content before switching away
    if (activeMapId) {
      await get().saveCurrentMap();
    }

    // Reset canvas to blank state (preserves mapIndex/activeMapId), then put the chosen
    // name on the document too — the index entry below is not the only place it lives.
    get().resetToDefault();
    get().setMapName(name);

    // Serialize the now-blank state as the new map's blob
    const serializable = get().getSerializableState();
    const blankBytes = await getMapSerializer().serializeToBytes(serializable);
    // A blank map has nothing drawn on it, so it measures 0×0 and says "Empty" until it
    // does — unless it was pinned to a fixed size, which is a size from the moment it exists.
    const gridSize = measureGridSize(
      get().layers,
      get().mapSettings.terrain?.bounds ?? null,
      get().mapSettings.fixedSize ?? null,
    );

    const db = await getMapDB();
    const id = await db.createMap(name, blankBytes, gridSize, get().layers.length);
    const meta = await db.getMapMeta(id);
    if (meta) {
      set((s) => {
        s.mapIndex.unshift(meta);
        s.activeMapId = id;
      });
    }
    return id;
  },

  async deleteMap(id: string) {
    const db = await getMapDB();
    // Stash the whole record first — after the delete there is nothing left to read, and
    // the toast's Undo (restoreLastDeletedMap) puts exactly this back.
    lastDeleted = await db.getMapRecord(id);
    await db.deleteMap(id);
    set((s) => {
      s.mapIndex = s.mapIndex.filter((m) => m.id !== id);
    });

    // Deleting the map you were editing used to leave `activeMapId` pointing at a
    // row that no longer exists: no card carried the editing badge, and the next
    // autosave wrote the open canvas back under a deleted id. Move to the next
    // most recent instead, and if that was the last map, start a fresh one —
    // there is no screen in this app that means anything with zero maps.
    if (get().activeMapId !== id) return;

    const next = get().mapIndex[0];
    if (next) {
      await get().loadMap(next.id);
      return;
    }
    // Clear first: createNewMap saves the active map before switching away, and
    // the active map here is the one just deleted.
    set((s) => {
      s.activeMapId = null;
    });
    const blankId = await get().createNewMap();
    autoCreatedBlank = get().mapIndex.find((m) => m.id === blankId) ?? null;
  },

  async renameMap(id: string, name: string) {
    const db = await getMapDB();
    await db.updateMapMeta(id, { name });
    set((s) => {
      const entry = s.mapIndex.find((m) => m.id === id);
      if (entry) entry.name = name;
    });
    // The open document carries its own copy of the name, and that copy is what an export
    // names the file. Renaming only the index left the two disagreeing.
    // ponytail: an unloaded map's document is reconciled by `loadMap` when it next opens —
    // rewriting its blob here would mean deserialize/reserialize on every rename.
    if (get().activeMapId === id) get().setMapName(name);
  },

  async duplicateMap(id: string) {
    const db = await getMapDB();
    const newId = await db.duplicateMap(id);
    const meta = await db.getMapMeta(newId);
    if (meta) {
      set((s) => {
        s.mapIndex.unshift(meta);
      });
    }
    return newId;
  },
});
