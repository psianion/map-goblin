import type { StateCreator } from 'zustand';
import type { MapBuilderStore, ToolSettings, ToolType, LightDefaults, ScatterBrushSettings } from '../types.ts';

export interface ToolActions {
  setActiveTool: (tool: ToolType) => void;
  setEraseMode: (enabled: boolean) => void;
  setRoughMode: (enabled: boolean) => void;
  updateToolSettings: (patch: Partial<ToolSettings>) => void;
  addRecentAsset: (assetId: string) => void;
  updateLightDefaults: (patch: Partial<LightDefaults>) => void;
  updateScatterBrushSettings: (patch: Partial<ScatterBrushSettings>) => void;
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
  updateLightDefaults: (patch) =>
    set((state) => {
      Object.assign(state.tools.settings.lightDefaults, patch);
    }),
  updateScatterBrushSettings: (patch) =>
    set((state) => {
      Object.assign(state.tools.settings.scatterBrush, patch);
      // Clamp to valid ranges to prevent infinite loops and rendering bugs
      const s = state.tools.settings.scatterBrush;
      s.brushRadius = Math.max(0.5, s.brushRadius);
      s.count = Math.min(Math.max(1, Math.round(s.count)), 30);
      s.minSpacing = Math.max(0.1, s.minSpacing);
      s.scaleRange[0] = Math.max(0.1, s.scaleRange[0]);
      s.scaleRange[1] = Math.max(s.scaleRange[0], s.scaleRange[1]);
      s.rotationRange[1] = Math.max(s.rotationRange[0], s.rotationRange[1]);
    }),
});
