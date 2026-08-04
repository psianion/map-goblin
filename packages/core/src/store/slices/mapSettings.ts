import type { StateCreator } from 'zustand';
import type { MapBuilderStore, MapSettings, TerrainData } from '../types';

export interface MapSettingsActions {
  setMapName: (name: string) => void;
  setGridType: (type: MapSettings['gridType']) => void;
  setAmbientLight: (color: string) => void;
  setTerrainData: (patch: Partial<TerrainData>) => void;
  setTerrainSplats: (pngs: [Blob | null, Blob | null]) => void;
  setTerrainAppearance: (patch: { visible?: boolean; opacity?: number }) => void;
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
  setTerrainData: (patch) =>
    set((state) => {
      if (!state.mapSettings.terrain) {
        state.mapSettings.terrain = { palette: DEFAULT_TERRAIN_PALETTE.slice(), bounds: null };
      }
      Object.assign(state.mapSettings.terrain, patch);
    }),
  setTerrainSplats: (pngs) =>
    set((state) => {
      state.terrainSplats.pngs = pngs;
      state.terrainSplats.rev++;
    }),
  // Raw write backing TerrainAppearanceCommand — same lazy-create-on-first-use
  // shape as setTerrainData, since visible/opacity can be set before any paint.
  setTerrainAppearance: (patch) =>
    set((state) => {
      if (!state.mapSettings.terrain) {
        state.mapSettings.terrain = { palette: DEFAULT_TERRAIN_PALETTE.slice(), bounds: null };
      }
      Object.assign(state.mapSettings.terrain, patch);
    }),
});

/** Default splat-slot palette — bundled seamless outdoor floor textures. */
export const DEFAULT_TERRAIN_PALETTE: (string | null)[] = [
  'grass-a-01',
  'dirt-b-04',
  'grassy-dirt-a-02',
  'gravel-06-c',
  'rock-ground-c-06',
  'cracked-dirt-a-01',
];
