import type { StateCreator } from 'zustand';
import type { MapBuilderStore, ToolSettings, ToolType } from '../types.ts';

export interface ToolActions {
  setActiveTool: (tool: ToolType) => void;
  setEraseMode: (enabled: boolean) => void;
  setRoughMode: (enabled: boolean) => void;
  updateToolSettings: (patch: Partial<ToolSettings>) => void;
  addRecentAsset: (assetId: string) => void;
}

export const createToolsSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  ToolActions
> = (set) => ({
  setActiveTool: (tool) =>
    set((state) => {
      state.tools.activeTool = tool;
    }),
  setEraseMode: (enabled) =>
    set((state) => {
      state.tools.eraseMode = enabled;
    }),
  setRoughMode: (enabled) =>
    set((state) => {
      state.tools.roughMode = enabled;
    }),
  updateToolSettings: (patch) =>
    set((state) => {
      Object.assign(state.tools.settings, patch);
    }),
  addRecentAsset: (assetId) =>
    set((state) => {
      state.tools.recentAssets = [
        assetId,
        ...state.tools.recentAssets.filter((id: string) => id !== assetId),
      ].slice(0, 8);
    }),
});
