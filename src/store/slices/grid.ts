import type { StateCreator } from 'zustand';
import type { GridConfig, MapBuilderStore } from '../types.ts';

export interface GridActions {
  setGridVisible: (visible: boolean) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setSnapDivision: (division: GridConfig['snapDivision']) => void;
  setGridStyle: (style: GridConfig['style']) => void;
}

export const createGridSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  GridActions
> = (set) => ({
  setGridVisible: (visible) =>
    set((state) => {
      state.grid.visible = visible;
    }),
  setSnapEnabled: (enabled) =>
    set((state) => {
      state.grid.snapEnabled = enabled;
    }),
  setSnapDivision: (division) =>
    set((state) => {
      state.grid.snapDivision = division;
    }),
  setGridStyle: (style) =>
    set((state) => {
      state.grid.style = style;
    }),
});
