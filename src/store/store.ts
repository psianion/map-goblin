import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { MapBuilderStore, SerializedMapData } from './types.ts';
import { createDefaultState } from './factories.ts';
import { createMapSettingsSlice } from './slices/mapSettings.ts';
import { createGridSlice } from './slices/grid.ts';
import { createLayersSlice } from './slices/layers.ts';
import { createLightsSlice } from './slices/lights.ts';
import { createToolsSlice } from './slices/tools.ts';
import { createUISlice } from './slices/ui.ts';
import { createAssetsSlice } from './slices/assets.ts';
import { createSelectionSlice } from './slices/selection.ts';
import { undoManager } from './undoManager.ts';

export const useStore = create<MapBuilderStore>()(
  subscribeWithSelector(
  devtools(
    immer((set, get, api) => ({
      ...createDefaultState(),

      // Slice actions
      ...createMapSettingsSlice(set, get, api),
      ...createGridSlice(set, get, api),
      ...createLayersSlice(set, get, api),
      ...createLightsSlice(set, get, api),
      ...createToolsSlice(set, get, api),
      ...createUISlice(set, get, api),
      ...createAssetsSlice(set, get, api),
      ...createSelectionSlice(set, get, api),

      // Bulk / serialization actions
      loadFromFile: (data: SerializedMapData) => {
        if (!data.version) {
          console.warn('loadFromFile: missing version field, aborting load');
          return;
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
          state.lights = data.lights;

          state.ui.activeLayerId =
            data.layers.find((l) => l.type === 'dungeon')?.id ?? '';
          state.ui.selectedObjectIds = [];
          state.ui.expandedLayerIds = [];
          state.ui.canUndo = false;
          state.ui.canRedo = false;
          state.ui.modalState = null;
          state.ui.toastQueue = [];
          state.tools.activeTool = 'rectangle';
          state.tools.eraseMode = false;
          state.tools.roughMode = false;
          state.selection.selectedRegion = null;
          state.selection.clipboard = null;
        });
      },

      getSerializableState: (): SerializedMapData => {
        const s = get();
        return {
          version: '1.0',
          mapSettings: s.mapSettings,
          grid: {
            visible: s.grid.visible,
            snapDivision: s.grid.snapDivision,
            style: s.grid.style,
          },
          layers: s.layers,
          lights: s.lights,
          placedObjects: s.layers
            .filter((l) => l.type === 'images')
            .flatMap((l) => (l.type === 'images' ? l.objects : [])),
          customImages: {},
        };
      },

      resetToDefault: () =>
        set((state) => {
          const defaults = createDefaultState();
          state.mapSettings = defaults.mapSettings;
          state.grid = defaults.grid;
          state.layers = defaults.layers;
          state.lights = defaults.lights;
          state.tools = defaults.tools;
          state.ui = defaults.ui;
          state.assets = defaults.assets;
          state.selection = defaults.selection;
        }),
    })),
    { name: 'MapBuilderStore' }
  ))
);

// Wire UndoManager → Zustand canUndo/canRedo reactive state
undoManager.onChange = (canUndo, canRedo) => {
  useStore.setState((state) => {
    state.ui.canUndo = canUndo;
    state.ui.canRedo = canRedo;
  });
};
