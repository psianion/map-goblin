import type { StateCreator } from 'zustand';
import type { BandDragStatus, MapBuilderStore, ToolSettings, ToolType, LightDefaults, ScatterBrushSettings, TerrainBrushSettings, WaterToolSettings } from '../types';

/** Single source of truth for the clamps below — UI sliders read these too. */
export const TERRAIN_BRUSH_RANGES = {
  radius: { min: 0.5, max: 12, step: 0.5 },
  strength: { min: 0.1, max: 1, step: 0.05 },
  tintOpacity: { min: 0, max: 1, step: 0.05 },
} as const;

/** Props tool clamps — the dock's sliders read these too. */
export const PROPS_RANGES = {
  brushRadius: { min: 0.5, max: 10, step: 0.5 },
  density: { min: 0.05, max: 1.5, step: 0.05 },
  stampScale: { min: 0.25, max: 4, step: 0.05 },
} as const;

/** How many tints the scatter pool holds. */
export const MAX_SCATTER_TINTS = 4;

export const WATER_RANGES = {
  width: { min: 0.5, max: 10, step: 0.5 },
} as const;

function clamp(v: number, { min, max }: { min: number; max: number }): number {
  return Math.min(Math.max(min, v), max);
}

export interface ToolActions {
  setActiveTool: (tool: ToolType) => void;
  setEraseMode: (enabled: boolean) => void;
  setCurveMode: (enabled: boolean) => void;
  updateToolSettings: (patch: Partial<ToolSettings>) => void;
  updateLightDefaults: (patch: Partial<LightDefaults>) => void;
  updateScatterBrushSettings: (patch: Partial<ScatterBrushSettings>) => void;
  updateTerrainBrushSettings: (patch: Partial<TerrainBrushSettings>) => void;
  updateWaterSettings: (patch: Partial<WaterToolSettings>) => void;
  /** Expose a wall's sprite nodes for hand-editing, or null to hide them. */
  setNodeEditWall: (wallId: string | null) => void;
  selectNode: (t: number | null) => void;
  /** Shift-click: add a node to the selection, or drop it if already in. */
  toggleNodeSelection: (t: number) => void;
  /** Expose a floor outline's vertices for editing, or null to hide them. */
  setShapeNodeEdit: (shapeId: string | null) => void;
  selectVertex: (index: number | null) => void;
  /**
   * What the cave-band solver just answered, for the status bar. Written per
   * pointermove during a joint drag and cleared on release — nothing else in
   * the store moves while a band drag is in flight (see bandJointDrag).
   */
  setBandDragStatus: (status: BandDragStatus | null) => void;
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
      // Node handles belong to the wall being finished, not to whatever tool
      // the DM reaches for next — switching tools drops out of edit mode.
      state.tools.nodeEditWallId = null;
      state.tools.selectedNodeT = null;
      state.tools.selectedNodeTs = [];
      state.tools.shapeNodeEditId = null;
      state.tools.selectedVertex = null;
      state.tools.bandDragStatus = null;
    }),
  setNodeEditWall: (wallId) =>
    set((state) => {
      state.tools.nodeEditWallId = wallId;
      state.tools.selectedNodeT = null;
      state.tools.selectedNodeTs = [];
      state.tools.bandDragStatus = null;
      // Node editing replaces the selection UI. The gizmo adopts any live
      // selection, so leaving one behind stacks it over the node overlay.
      if (wallId) state.selection.selectedIds = [];
    }),
  selectNode: (t) =>
    set((state) => {
      // A plain click replaces the selection, so the two stay in step: the
      // primary is always a member, and an empty set always means nothing
      // selected. Everything that reads selectedNodeT keeps working unchanged.
      state.tools.selectedNodeT = t;
      state.tools.selectedNodeTs = t === null ? [] : [t];
    }),
  toggleNodeSelection: (t) =>
    set((state) => {
      const at = state.tools.selectedNodeTs.findIndex((v) => Math.abs(v - t) < 1e-9);
      if (at >= 0) {
        state.tools.selectedNodeTs.splice(at, 1);
        // Dropping the primary hands the role to whatever is left, so the
        // keyboard adjustments never point at a stone that is no longer picked.
        if (Math.abs((state.tools.selectedNodeT ?? NaN) - t) < 1e-9) {
          state.tools.selectedNodeT = state.tools.selectedNodeTs.at(-1) ?? null;
        }
        return;
      }
      state.tools.selectedNodeTs.push(t);
      state.tools.selectedNodeT = t;
    }),
  setShapeNodeEdit: (shapeId) =>
    set((state) => {
      // Only drop the vertex selection when the outline actually changes.
      // Clearing unconditionally meant a click that selected a vertex lost it
      // again on pointer-up — the drag session re-asserts the same id — so
      // Delete fell through to the global binding and removed the whole shape.
      if (state.tools.shapeNodeEditId !== shapeId) state.tools.selectedVertex = null;
      state.tools.shapeNodeEditId = shapeId;
      // Same as setNodeEditWall: the mode owns the screen, the gizmo must not
      // stay drawn around whatever the entry double-click selected.
      if (shapeId) state.selection.selectedIds = [];
    }),
  selectVertex: (index) =>
    set((state) => {
      state.tools.selectedVertex = index;
    }),
  setBandDragStatus: (status) =>
    set((state) => {
      state.tools.bandDragStatus = status;
    }),
  setEraseMode: (enabled) =>
    set((state) => {
      state.tools.eraseMode = enabled;
    }),
  setCurveMode: (enabled) =>
    set((state) => {
      state.tools.curveMode = enabled;
    }),
  updateToolSettings: (patch) =>
    set((state) => {
      Object.assign(state.tools.settings, patch);
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
      s.brushRadius = clamp(s.brushRadius, PROPS_RANGES.brushRadius);
      s.density = clamp(s.density, PROPS_RANGES.density);
      s.stampScale = clamp(s.stampScale, PROPS_RANGES.stampScale);
      const turn = Math.PI * 2;
      s.stampRotation = ((s.stampRotation % turn) + turn) % turn;
      if (s.tints.length > MAX_SCATTER_TINTS) s.tints = s.tints.slice(0, MAX_SCATTER_TINTS);
      s.minSpacing = Math.max(0.1, s.minSpacing);
      s.scaleRange[0] = Math.max(0.1, s.scaleRange[0]);
      s.scaleRange[1] = Math.max(s.scaleRange[0], s.scaleRange[1]);
      s.rotationRange[1] = Math.max(s.rotationRange[0], s.rotationRange[1]);
    }),
  updateTerrainBrushSettings: (patch) =>
    set((state) => {
      const was = state.tools.settings.terrainBrush;
      // Tint opacity starts at zero so the brush paints untinted until asked,
      // which means a colour picked on its own would never show. Picking a
      // real colour IS the ask: lift a zero opacity to full with it. White
      // stays a no-op, and an opacity sent alongside the colour wins.
      const tintAsk =
        patch.tintColor !== undefined &&
        patch.tintOpacity === undefined &&
        was.tintOpacity === 0 &&
        patch.tintColor.toLowerCase() !== '#ffffff';
      Object.assign(was, patch);
      if (tintAsk) was.tintOpacity = 1;
      const t = state.tools.settings.terrainBrush;
      t.slot = Math.min(Math.max(0, Math.round(t.slot)), 5);
      t.radius = clamp(t.radius, TERRAIN_BRUSH_RANGES.radius);
      t.strength = clamp(t.strength, TERRAIN_BRUSH_RANGES.strength);
      t.tintOpacity = clamp(t.tintOpacity, TERRAIN_BRUSH_RANGES.tintOpacity);
    }),
  updateWaterSettings: (patch) =>
    set((state) => {
      Object.assign(state.tools.settings.water, patch);
      const w = state.tools.settings.water;
      w.width = clamp(w.width, WATER_RANGES.width);
    }),
});
