import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { DungeonLayer, Layer, MapBuilderStore, Room, SerializedMapData } from './types';
import { ROOM_RUNTIME_KEYS } from '../shared/types';
import { migrateRooms } from './roomMigration';
import { getNotify } from './notify';
import { createDefaultState } from './factories';
import { CURRENT_VERSION, isSupportedVersion, migrateToLatest } from './migration';
import { normalizePrep } from '../shared/prep';
import { dataUrlToBlob } from '../assets/dataUrl';
import { getCatalogEntry, isBandSet, nextAssetName } from '../assets/packCatalog';
import { isCaveBandAsset } from '../assets/caveWallKit';
import { SPLAT_IMAGE_KEYS } from '../engine/terrain/terrainShared';
import { createMapSettingsSlice } from './slices/mapSettings';
import { createGridSlice } from './slices/grid';
import { createLayersSlice } from './slices/layers';
import { createLevelsSlice } from './slices/levels';
import { createToolsSlice } from './slices/tools';
import { createUISlice } from './slices/ui';
import { createAssetsSlice } from './slices/assets';
import { createSelectionSlice } from './slices/selection';
import { createMapsSlice } from './slices/maps';
import { createPacksSlice } from './slices/packs';
import { createPrepSlice } from './slices/prep';
import { undoManager } from './undoManager';

/** A room as a file holds it: the authored fields only (see `ROOM_RUNTIME_KEYS`). */
export function serializableRoom(room: Room): Room {
  const out = { ...room };
  for (const key of ROOM_RUNTIME_KEYS) delete out[key];
  return out;
}

/** A layer as a file holds it: no union cache, no derived room fields. */
function serializableLayer(layer: Layer): Layer {
  if (layer.type !== 'dungeon') return layer;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { mergedFloor, ...rest } = layer as DungeonLayer;
  const out: DungeonLayer = { ...rest, mergedFloor: null };
  if (layer.rooms) out.rooms = layer.rooms.map(serializableRoom);
  return out;
}

export const useStore = create<MapBuilderStore>()(
  subscribeWithSelector(
  devtools(
    immer((set, get, api) => ({
      ...createDefaultState(),

      // Slice actions
      ...createMapSettingsSlice(set, get, api),
      ...createGridSlice(set, get, api),
      ...createLayersSlice(set, get, api),
      ...createLevelsSlice(set, get, api),
      ...createToolsSlice(set, get, api),
      ...createUISlice(set, get, api),
      ...createAssetsSlice(set, get, api),
      ...createSelectionSlice(set, get, api),
      ...createMapsSlice(set, get, api),
      ...createPacksSlice(set, get, api),
      ...createPrepSlice(set, get, api),

      // Bulk / serialization actions
      loadFromFile: (data: SerializedMapData, splatPngs?: [Blob | null, Blob | null, Blob | null]) => {
        if (!data.version) {
          console.warn('loadFromFile: missing version field, aborting load');
          return;
        }

        if (!isSupportedVersion(data.version)) {
          console.warn('loadFromFile: incompatible version', data.version);
          getNotify().error('This file was created with an incompatible version and cannot be opened.');
          return;
        }

        // Every supported version goes through the migration: 2.0 is upgraded, and all of
        // them lose the fields the format no longer carries (retired fields have no bump),
        // and a band-kit layer loses its placed cave band (see dropPlacedCaveBand).
        data = migrateToLatest(data, { isBandSet, isCaveBandAsset });
        // Rooms became anchored places and maps gained levels: every path that opens
        // a map (v1 sidebar, v2 home page, file import, the table) comes through here,
        // so this is the one place the room migration runs.
        data = migrateRooms(data);
        const levels = data.levels ?? [];

        // Splat bitmaps ride inside customImages in the file format; hold them
        // as binary Blobs in terrainSplats so no splat base64 lives in the
        // store (autosave/serialize would re-stringify it on every pass).
        // A caller that already fetched them as binary (session client) passes
        // Blobs directly and wins over any inline entries.
        const images = { ...(data.customImages ?? {}) };
        const pngs: [Blob | null, Blob | null, Blob | null] = splatPngs ?? [null, null, null];
        for (const [i, key] of SPLAT_IMAGE_KEYS.entries()) {
          const url = images[key];
          if (url) {
            if (!splatPngs) pngs[i as 0 | 1 | 2] = dataUrlToBlob(url);
            delete images[key];
          }
        }

        set((state) => {
          state.mapSettings = data.mapSettings;
          state.grid = {
            ...state.grid,
            visible: data.grid.visible,
            snapDivision: data.grid.snapDivision,
            // Snap on/off is the DM's view preference, not the map's: it stays as set.
            snapEnabled: state.grid.snapEnabled,
          };
          state.layers = data.layers;
          state.levels = levels;
          // Older files stored prep v1 — upgrade here so the rest of the app
          // only ever sees v2 (normalizePrep is the one read-boundary shim).
          state.prep = data.prep ? normalizePrep(data.prep) : null;
          state.assets.customImages = images;
          // Always write (even [null, null]) — loading a terrain-less map over
          // a painted one must clear the renderer's splats.
          state.terrainSplats.pngs = pngs;
          state.terrainSplats.rev++;

          const firstDungeon = data.layers.find((l) => l.type === 'dungeon');
          state.ui.activeLayerId = firstDungeon?.id ?? '';
          state.ui.activeLevelId = firstDungeon?.levelId ?? levels[0]?.id ?? '';
          state.ui.roomSuggestions = null;
          state.ui.pendingSplit = null;
          state.ui.roomsSheetRoomId = null;
          state.ui.highlightedRoomId = null;
          state.ui.expandedLayerIds = [];
          state.ui.canUndo = false;
          state.ui.canRedo = false;
          state.ui.modalState = null;
          state.ui.solo = null;
          state.tools.activeTool = 'rectangle';
          state.tools.eraseMode = false;
          state.tools.curveMode = false;
          // Node-edit targets are ids into the map that was open. A floor ring
          // id in particular is just `floor:<n>`, so left alone it rebinds to
          // whatever ring n happens to be in the map being loaded.
          state.tools.nodeEditWallId = null;
          state.tools.selectedNodeT = null;
          state.tools.selectedNodeTs = [];
          state.tools.shapeNodeEditId = null;
          state.tools.selectedVertex = null;
          state.selection.selectedIds = [];
          state.selection.hoveredId = null;
          state.selection.selectedRegion = null;
          state.selection.clipboard = null;
        });
        // Resolve pre-naming-era "Asset" names now that the doc is in. If
        // the catalog isn't rehydrated yet (boot race), CanvasHost calls the
        // shim again once packs land.
        get().applyAssetNameShim();
        get().normalizeChildGroups();
      },

      // Group metadata and membership are two halves of the same record in two
      // places, so a hand-edited or partially-redacted document can arrive with
      // one half missing. Drop both kinds of orphan at the read boundary —
      // idempotent, not an undoable edit (same contract as applyAssetNameShim).
      normalizeChildGroups: () => {
        set((state) => {
          for (const layer of state.layers) {
            if (layer.type !== 'dungeon') continue;
            const known = new Set((layer.groups ?? []).map((g) => g.id));
            for (const child of layer.children) {
              if (child.groupId && !known.has(child.groupId)) delete child.groupId;
            }
            if (!layer.groups) continue;
            const used = new Set(layer.children.map((c) => c.groupId));
            layer.groups = layer.groups.filter((g) => used.has(g.id));
            if (layer.groups.length === 0) delete layer.groups;
          }
        });
      },

      // Pre-naming-era files stamped every placed asset "Asset". Resolve
      // real names from the catalog — idempotent (a renamed child never
      // matches again), skips entries the catalog can't resolve, and runs
      // both after a load and after asset packs finish rehydrating (either
      // can happen first at boot). Like normalizePrep, this is a
      // read-boundary shim, not an undoable edit.
      applyAssetNameShim: () => {
        set((state) => {
          for (const layer of state.layers) {
            if (layer.type !== 'dungeon') continue;
            const taken = layer.children.map((c) => c.name);
            layer.children.forEach((c, i) => {
              if (c.childType === 'asset' && c.name === 'Asset' && getCatalogEntry(c.assetId)) {
                taken[i] = c.name = nextAssetName(c.assetId, taken);
              }
            });
          }
        });
      },

      getSerializableState: (): SerializedMapData => {
        const s = get();
        return {
          version: CURRENT_VERSION,
          // Whatever the store holds is in the anchored-rooms format: every load ran the
          // migration, and a new map was born in it. Stamped on the way out so a map that
          // never went through a loader (a new one) is not migrated again when reopened,
          // which would rebuild its rooms from id, name and anchor alone and drop their
          // looks, areas and split lineage.
          mapSettings: { ...s.mapSettings, roomsVersion: 2 },
          grid: {
            visible: s.grid.visible,
            snapDivision: s.grid.snapDivision,
          },
          // Strip the derived caches: mergedFloor (recomputed on load) and each room's
          // face, centroid, doors… (refreshed by syncRooms on load).
          layers: s.layers.map(serializableLayer),
          levels: s.levels,
          customImages: s.assets.customImages,
          // undefined (not null) when unauthored: JSON.stringify drops the key,
          // and an absent prep leaves the server's stored prep alone on republish.
          prep: s.prep ?? undefined,
        };
      },

      resetToDefault: () =>
        set((state) => {
          const defaults = createDefaultState();
          const manifest = state.assets.manifest;
          // Recents belong to the DM, not the map: a new or opened map keeps them.
          const { recentlyUsed, favourites } = state.assets;
          state.mapSettings = defaults.mapSettings;
          // Snap on/off is a view preference too (canvas/src/io/snapPref.ts), so it carries over.
          state.grid = { ...defaults.grid, snapEnabled: state.grid.snapEnabled };
          state.layers = defaults.layers;
          state.levels = defaults.levels;
          state.prep = defaults.prep;
          state.tools = defaults.tools;
          // The room view preferences are the DM's, not the map's (persisted per
          // browser in the v2 view prefs), so a new or opened map keeps them.
          const { roomLabels, dividerMode, roomWalls, roomsSheetOpen, seeUnderOverhead } = state.ui;
          state.ui = { ...defaults.ui, roomLabels, dividerMode, roomWalls, roomsSheetOpen, seeUnderOverhead };
          state.assets = defaults.assets;
          state.assets.manifest = manifest;
          state.assets.recentlyUsed = recentlyUsed;
          state.assets.favourites = favourites;
          state.selection = defaults.selection;
          // packs is session state populated once at boot; nothing repopulates
          // it after a reset, so leave it alone here.
          state.terrainSplats.pngs = [null, null, null];
          state.terrainSplats.rev++;
        }),
    })),
    { name: 'MapBuilderStore' }
  ))
);

// Expose store on window for e2e tests
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__STORE__ = useStore;
}

// Wire UndoManager → Zustand canUndo/canRedo reactive state
undoManager.onChange = (canUndo, canRedo) => {
  useStore.setState((state) => {
    state.ui.canUndo = canUndo;
    state.ui.canRedo = canRedo;
  });
};
