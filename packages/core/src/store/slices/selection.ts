import type { StateCreator } from 'zustand';
import type { ChildClipboard, MapBuilderStore } from '../types';

export interface SelectionActions {
  setSelectedIds: (ids: string[]) => void;
  setHoveredId: (id: string | null) => void;
  /** How many objects stand under the pointer for the Select hint (`selection.hoverCount`). */
  setHoverCount: (n: number) => void;
  setSelectedRegion: (region: [number, number][][] | null) => void;
  setClipboard: (clipboard: ChildClipboard | null) => void;
}

export const createSelectionSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  SelectionActions
> = (set) => ({
  setSelectedIds: (ids) =>
    set((state) => {
      state.selection.selectedIds = ids;
    }),
  setHoveredId: (id) =>
    set((state) => {
      state.selection.hoveredId = id;
    }),
  setHoverCount: (n) =>
    set((state) => {
      state.selection.hoverCount = n;
    }),
  setSelectedRegion: (region) =>
    set((state) => {
      state.selection.selectedRegion = region;
    }),
  setClipboard: (clipboard) =>
    set((state) => {
      state.selection.clipboard = clipboard;
    }),
});
