import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { DungeonLayer, MapBuilderStore, SerializedMapData } from './types';
import { getNotify } from './notify';
import { createDefaultState } from './factories';
import { migrateToLatest } from './migration';
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
      loadFromFile: (data: SerializedMapData) => {
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

        set((state) => {
          state.mapSettings = data.mapSettings;
          state.grid = {
            ...state.grid,
            visible: data.grid.visible,
            snapDivision: data.grid.snapDivision,
            style: data.grid.style,
            snapEnabled: true,
          };
          state.layers = data.layers;
          state.assets.customImages = data.customImages ?? {};

          state.ui.activeLayerId =
            data.layers.find((l) => l.type === 'dungeon')?.id ?? '';
          state.ui.expandedLayerIds = [];
          state.ui.canUndo = false;
          state.ui.canRedo = false;
          state.ui.modalState = null;
          state.tools.activeTool = 'rectangle';
          state.tools.eraseMode = false;
          state.tools.roughMode = false;
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
            style: s.grid.style,
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
