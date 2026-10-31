import type { StateCreator } from 'zustand';
import type { Level, MapBuilderStore, RoomLook } from '../types';

export interface LevelActions {
  addLevel: (level: Level, index?: number) => void;
  removeLevel: (levelId: string) => void;
  updateLevel: (levelId: string, patch: { name?: string; look?: RoomLook }) => void;
  setLayerLevel: (layerId: string, levelId: string) => void;
  reorderLevel: (from: number, to: number) => void;
}

/**
 * Raw level writes. Edits go through the level commands (store/commands.ts),
 * which own the rules a DM sees — the last level cannot go, a removed level's
 * layers move to the first one left — and their undo.
 */
export const createLevelsSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  LevelActions
> = (set) => ({
  addLevel: (level, index) =>
    set((state) => {
      if (state.levels.some((l) => l.id === level.id)) return;
      if (index !== undefined && index >= 0 && index < state.levels.length) state.levels.splice(index, 0, level);
      else state.levels.push(level);
    }),
  removeLevel: (levelId) =>
    set((state) => {
      // The store never holds zero levels: every layer has to belong to one.
      if (state.levels.length <= 1) return;
      const idx = state.levels.findIndex((l) => l.id === levelId);
      if (idx < 0) return;
      state.levels.splice(idx, 1);
      const fallback = state.levels[0].id;
      for (const layer of state.layers) if (layer.levelId === levelId) layer.levelId = fallback;
      if (state.ui.activeLevelId === levelId) {
        state.ui.activeLevelId = fallback;
        const active = state.layers.find((l) => l.id === state.ui.activeLayerId);
        if (active && active.levelId !== fallback) {
          state.ui.activeLayerId = state.layers.find((l) => l.levelId === fallback)?.id ?? state.ui.activeLayerId;
        }
      }
    }),
  updateLevel: (levelId, patch) =>
    set((state) => {
      const level = state.levels.find((l) => l.id === levelId);
      if (!level) return;
      if ('name' in patch && patch.name !== undefined) level.name = patch.name;
      if ('look' in patch) {
        if (patch.look && Object.keys(patch.look).length > 0) level.look = patch.look;
        else delete level.look;
      }
    }),
  setLayerLevel: (layerId, levelId) =>
    set((state) => {
      if (!state.levels.some((l) => l.id === levelId)) return;
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer) layer.levelId = levelId;
    }),
  reorderLevel: (from, to) =>
    set((state) => {
      const n = state.levels.length;
      if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
      const [level] = state.levels.splice(from, 1);
      state.levels.splice(to, 0, level);
    }),
});
