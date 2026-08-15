import type { StateCreator } from 'zustand';
import type { MapBuilderStore, MapEnvironment, MapSettings, TerrainData } from '../types';

export interface MapSettingsActions {
  setMapName: (name: string) => void;
  setGridType: (type: MapSettings['gridType']) => void;
  setAmbientLight: (color: string) => void;
  setEnvironmentSettings: (patch: Partial<MapEnvironment>) => void;
  setTerrainData: (patch: Partial<TerrainData>) => void;
  setTerrainSplats: (pngs: [Blob | null, Blob | null]) => void;
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
  // One action for the whole world half (environment / palette / natural light / orientation /
  // time mode), because the Editor edits them as one section and a patch is what undo replays.
  // An explicitly `undefined` value takes the field back off the map — how undo returns a
  // setting to "never authored", which is not the same as any of its concrete values.
  setEnvironmentSettings: (patch) =>
    set((state) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete (state.mapSettings as Record<string, unknown>)[key];
        else (state.mapSettings as Record<string, unknown>)[key] = value;
      }
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
