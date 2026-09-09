import type { StateCreator } from 'zustand';
import type { FogLook } from '../../shared/fogLook';
import type { MapBuilderStore, MapEnvironment, MapSettings, TerrainData } from '../types';

export interface MapSettingsActions {
  setMapName: (name: string) => void;
  setFixedSize: (size: MapSettings['fixedSize']) => void;
  setGridType: (type: MapSettings['gridType']) => void;
  setAmbientLight: (color: string) => void;
  setEnvironmentSettings: (patch: Partial<MapEnvironment>) => void;
  setTerrainData: (patch: Partial<TerrainData>) => void;
  setTerrainSplats: (pngs: [Blob | null, Blob | null, Blob | null]) => void;
  /** `undefined` takes the map back to the shipped default (`DEFAULT_FOG_LOOK`) — same
   * "never authored" convention `setEnvironmentSettings` uses per-field, here for the one
   * cohesive object a map either has authored or hasn't. */
  setFogLook: (look: FogLook | undefined) => void;
}

/**
 * The largest frame a DM can pin, in cells. 1000 cells is 5000 ft on the default scale —
 * far past any battlemap, and small enough that the fog and export code sizing itself off
 * this number can't be talked into an absurd allocation.
 */
export const MAX_FIXED_CELLS = 1000;

/**
 * A pinned map frame, or null when there isn't one. `fixedSize` is read by export, by the
 * fog on the client and by the session server, so it is validated here — at the one door
 * into the document — rather than trusted from whichever form last wrote it. Anything that
 * is not a pair of whole cell counts inside the bound is not a size, and the map goes back
 * to measuring itself.
 */
export function normalizeFixedSize(
  size: MapSettings['fixedSize'],
): { width: number; height: number } | null {
  if (!size) return null;
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_FIXED_CELLS;
  return ok(size.width) && ok(size.height)
    ? { width: size.width, height: size.height }
    : null;
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
  setFixedSize: (size) =>
    set((state) => {
      state.mapSettings.fixedSize = normalizeFixedSize(size);
    }),
  setGridType: (type) =>
    set((state) => {
      state.mapSettings.gridType = type;
    }),
  setAmbientLight: (color) =>
    set((state) => {
      state.mapSettings.ambientLight = color;
    }),
  setFogLook: (look) =>
    set((state) => {
      if (look === undefined) delete state.mapSettings.fogLook;
      else state.mapSettings.fogLook = look;
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

/**
 * Default splat-slot palette. Empty until gg-demo ships floor textures — the
 * terrain brush UI renders unassigned slots as blanks the user fills from the
 * picker.
 */
export const DEFAULT_TERRAIN_PALETTE: (string | null)[] = [null, null, null, null, null, null];
