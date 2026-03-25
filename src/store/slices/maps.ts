import type { StateCreator } from 'zustand';
import type { MapBuilderStore, MapsSlice } from '../types';
import { MapIndexDB } from '@/io/mapIndexDB';

// Module-level singleton — opened once on first use.
// Store the opening promise to prevent race conditions (React Strict Mode double-mount).
let mapDB: MapIndexDB | null = null;
let openingPromise: Promise<MapIndexDB> | null = null;

export async function getMapDB(): Promise<MapIndexDB> {
  if (mapDB) return mapDB;
  if (openingPromise) return openingPromise;

  openingPromise = (async () => {
    const db = new MapIndexDB();
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
    // Dynamically import serializeToBytes to avoid circular deps
    const { serializeToBytes } = await import('@/io/saveLoad');
    const bytes = await serializeToBytes(serializable);
    const layerCount = state.layers.length;

    // Extract grid dimensions from map settings (cells)
    const gridSize = { width: 40, height: 40 }; // default

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

    const { deserializeFromBytes } = await import('@/io/saveLoad');
    const parsed = await deserializeFromBytes(blob);
    get().loadFromFile(parsed);
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

    // Reset canvas to blank state (preserves mapIndex/activeMapId)
    get().resetToDefault();

    // Serialize the now-blank state as the new map's blob
    const serializable = get().getSerializableState();
    const { serializeToBytes } = await import('@/io/saveLoad');
    const blankBytes = await serializeToBytes(serializable);
    const gridSize = { width: 40, height: 40 };

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
    await db.deleteMap(id);
    set((s) => {
      s.mapIndex = s.mapIndex.filter((m) => m.id !== id);
    });
  },

  async renameMap(id: string, name: string) {
    const db = await getMapDB();
    await db.updateMapMeta(id, { name });
    set((s) => {
      const entry = s.mapIndex.find((m) => m.id === id);
      if (entry) entry.name = name;
    });
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
