import type { StateCreator } from 'zustand';
import type { MapBuilderStore, MapSettings } from '../types.ts';

export interface MapSettingsActions {
  setMapName: (name: string) => void;
  setGridType: (type: MapSettings['gridType']) => void;
  setAmbientLight: (color: string) => void;
}

export const createMapSettingsSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  MapSettingsActions
> = (set) => ({
  setMapName: (name) =>
    set((state) => {
      state.mapSettings.name = name;
    }),
  setGridType: (type) =>
    set((state) => {
      state.mapSettings.gridType = type;
    }),
  setAmbientLight: (color) =>
    set((state) => {
      state.mapSettings.ambientLight = color;
    }),
});
