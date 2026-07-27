import type { StateCreator } from 'zustand';
import type { MapBuilderStore, ToolSettings, ToolType, LightDefaults, ScatterBrushSettings, TerrainBrushSettings, WaterToolSettings } from '../types';

/** Single source of truth for the clamps below — UI sliders read these too. */
export const TERRAIN_BRUSH_RANGES = {
  radius: { min: 0.5, max: 12, step: 0.5 },
  strength: { min: 0.1, max: 1, step: 0.05 },
} as const;

export const WATER_RANGES = {
  width: { min: 0.5, max: 10, step: 0.5 },
  flowSpeed: { min: 0, max: 1, step: 0.05 },
} as const;

function clamp(v: number, { min, max }: { min: number; max: number }): number {
  return Math.min(Math.max(min, v), max);
}

export interface ToolActions {
  setActiveTool: (tool: ToolType) => void;
  setEraseMode: (enabled: boolean) => void;
  setRoughMode: (enabled: boolean) => void;
  updateToolSettings: (patch: Partial<ToolSettings>) => void;
  addRecentAsset: (assetId: string) => void;
  updateLightDefaults: (patch: Partial<LightDefaults>) => void;
  updateScatterBrushSettings: (patch: Partial<ScatterBrushSettings>) => void;
  updateTerrainBrushSettings: (patch: Partial<TerrainBrushSettings>) => void;
  updateWaterSettings: (patch: Partial<WaterToolSettings>) => void;
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
  updateTerrainBrushSettings: (patch) =>
    set((state) => {
      Object.assign(state.tools.settings.terrainBrush, patch);
      const t = state.tools.settings.terrainBrush;
      t.slot = Math.min(Math.max(0, Math.round(t.slot)), 5);
      t.radius = clamp(t.radius, TERRAIN_BRUSH_RANGES.radius);
      t.strength = clamp(t.strength, TERRAIN_BRUSH_RANGES.strength);
    }),
  updateWaterSettings: (patch) =>
    set((state) => {
      Object.assign(state.tools.settings.water, patch);
      const w = state.tools.settings.water;
      w.width = clamp(w.width, WATER_RANGES.width);
      w.flowSpeed = clamp(w.flowSpeed, WATER_RANGES.flowSpeed);
    }),
});
