import type { StateCreator } from 'zustand';
import type { Light, MapBuilderStore } from '../types.ts';

export interface LightActions {
  addLight: (light: Light) => void;
  removeLight: (id: string) => void;
  updateLight: (id: string, patch: Partial<Light>) => void;
}

export const createLightsSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  LightActions
> = (set) => ({
  addLight: (light) =>
    set((state) => {
      state.lights.push(light);
    }),
  removeLight: (id) =>
    set((state) => {
      const idx = state.lights.findIndex((l) => l.id === id);
      if (idx >= 0) state.lights.splice(idx, 1);
    }),
  updateLight: (id, patch) =>
    set((state) => {
      const light = state.lights.find((l) => l.id === id);
      if (light) Object.assign(light, patch);
    }),
});
