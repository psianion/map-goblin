import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { DungeonLayer, MapBuilderStore, SerializedMapData } from './types';
import { getNotify } from './notify';
import { createDefaultState } from './factories';
import { migrateToLatest } from './migration';
import { dataUrlToBlob } from '../assets/dataUrl';
import { SPLAT_IMAGE_KEYS } from '../engine/terrain/terrainShared';
import { createMapSettingsSlice } from './slices/mapSettings';
import { createGridSlice } from './slices/grid';
import { createLayersSlice } from './slices/layers';
import { createToolsSlice } from './slices/tools';
import { createUISlice } from './slices/ui';
import { createAssetsSlice } from './slices/assets';
import { createSelectionSlice } from './slices/selection';
import { createMapsSlice } from './slices/maps';
import { createPacksSlice } from './slices/packs';
import { undoManager } from './undoManager';

export const useStore = create<MapBuilderStore>()(
  subscribeWithSelector(
  devtools(
    immer((set, get, api) => ({
      ...createDefaultState(),

      // Slice actions
      ...createMapSettingsSlice(set, get, api),
      ...createGridSlice(set, get, api),
      ...createLayersSlice(set, get, api),
      ...createToolsSlice(set, get, api),
      ...createUISlice(set, get, api),
      ...createAssetsSlice(set, get, api),
      ...createSelectionSlice(set, get, api),
      ...createMapsSlice(set, get, api),
      ...createPacksSlice(set, get, api),

      // Bulk / serialization actions
      loadFromFile: (data: SerializedMapData, splatPngs?: [Blob | null, Blob | null]) => {
        if (!data.version) {
          console.warn('loadFromFile: missing version field, aborting load');
          return;
        }

        if (data.version !== '2.0' && data.version !== '3.0') {
          console.warn('loadFromFile: incompatible version', data.version);
          getNotify().error('This file was created with an incompatible version and cannot be opened.');
          return;
        }

        // Migrate older formats to current
        if (data.version === '2.0') {
          data = migrateToLatest(data);
        }

        // Splat bitmaps ride inside customImages in the file format; hold them
        // as binary Blobs in terrainSplats so no splat base64 lives in the
        // store (autosave/serialize would re-stringify it on every pass).
        // A caller that already fetched them as binary (session client) passes
        // Blobs directly and wins over any inline entries.
        const images = { ...(data.customImages ?? {}) };
        const pngs: [Blob | null, Blob | null] = splatPngs ?? [null, null];
        for (const [i, key] of SPLAT_IMAGE_KEYS.entries()) {
          const url = images[key];
          if (url) {
            if (!splatPngs) pngs[i as 0 | 1] = dataUrlToBlob(url);
            delete images[key];
          }
        }

        set((state) => {
          state.mapSettings = data.mapSettings;
          state.grid = {
            ...state.grid,
            visible: data.grid.visible,
            snapDivision: data.grid.snapDivision,
            snapEnabled: true,
          };
          state.layers = data.layers;
          state.assets.customImages = images;
          // Always write (even [null, null]) — loading a terrain-less map over
          // a painted one must clear the renderer's splats.
          state.terrainSplats.pngs = pngs;
          state.terrainSplats.rev++;

          state.ui.activeLayerId =
            data.layers.find((l) => l.type === 'dungeon')?.id ?? '';
          state.ui.expandedLayerIds = [];
          state.ui.canUndo = false;
          state.ui.canRedo = false;
          state.ui.modalState = null;
          state.ui.solo = null;
          state.tools.activeTool = 'rectangle';
          state.tools.eraseMode = false;
          state.tools.roughMode = false;
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
          state.selection.regionClipboard = null;
          state.selection.selectionTransform = null;
        });
      },

      getSerializableState: (): SerializedMapData => {
        const s = get();
        return {
          version: '3.0',
          mapSettings: s.mapSettings,
          grid: {
            visible: s.grid.visible,
            snapDivision: s.grid.snapDivision,
          },
          // Strip mergedFloor from dungeon layers (derived cache, recomputed on load)
          layers: s.layers.map((layer) => {
            if (layer.type === 'dungeon') {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { mergedFloor, ...rest } = layer as DungeonLayer;
              return { ...rest, mergedFloor: null };
            }
            return layer;
          }),
          customImages: s.assets.customImages,
        };
      },

      resetToDefault: () =>
        set((state) => {
          const defaults = createDefaultState();
          state.mapSettings = defaults.mapSettings;
          state.grid = defaults.grid;
          state.layers = defaults.layers;
          state.tools = defaults.tools;
          state.ui = defaults.ui;
          state.assets = defaults.assets;
          state.selection = defaults.selection;
          state.packs = defaults.packs;
          state.terrainSplats.pngs = [null, null];
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
