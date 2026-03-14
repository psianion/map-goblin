import type { StateCreator } from 'zustand';
import type { MapBuilderStore, SelectionClipboard, SelectionSlice } from '../types.ts';

export interface SelectionActions {
  setSelectedRegion: (region: [number, number][][] | null) => void;
  setClipboard: (clipboard: SelectionClipboard | null) => void;
  setSelectionTransform: (transform: SelectionSlice['selectionTransform']) => void;
  bakeSelectionTransform: () => void;
}

export const createSelectionSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  SelectionActions
> = (set) => ({
  setSelectedRegion: (region) =>
    set((state) => {
      state.selection.selectedRegion = region;
    }),
  setClipboard: (clipboard) =>
    set((state) => {
      state.selection.clipboard = clipboard;
    }),
  setSelectionTransform: (transform) =>
    set((state) => {
      state.selection.selectionTransform = transform;
    }),
  bakeSelectionTransform: () =>
    set((state) => {
      const t = state.selection.selectionTransform;
      const region = state.selection.selectedRegion;
      if (!t) return;
      if (!region) {
        state.selection.selectionTransform = null;
        return;
      }
      state.selection.selectedRegion = region.map((polygon) =>
        polygon.map(([x, y]) => {
          // Scale
          const sx = x * t.scale[0];
          const sy = y * t.scale[1];
          // Rotate around origin
          const cos = Math.cos(t.rotate);
          const sin = Math.sin(t.rotate);
          const rx = sx * cos - sy * sin;
          const ry = sx * sin + sy * cos;
          // Translate
          return [rx + t.translate[0], ry + t.translate[1]] as [number, number];
        }),
      );
      state.selection.selectionTransform = null;
    }),
});
