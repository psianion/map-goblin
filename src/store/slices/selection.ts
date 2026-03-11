import type { StateCreator } from 'zustand';
import type { MapBuilderStore, SelectionClipboard } from '../types.ts';

export interface SelectionActions {
  setSelectedRegion: (region: [number, number][][] | null) => void;
  setClipboard: (clipboard: SelectionClipboard | null) => void;
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
});
