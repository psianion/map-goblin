import type { StateCreator } from 'zustand';
import type { ChildClipboard, MapBuilderStore } from '../types';

export interface SelectionActions {
  setSelectedIds: (ids: string[]) => void;
  setHoveredId: (id: string | null) => void;
  /** How many objects stand under the pointer for the Select hint (`selection.hoverCount`). */
  setHoverCount: (n: number) => void;
  /** The rock of the edge the Door tool's Opening last hovered, where it lays a mouth piece (`selection.hoverMouthKit`). */
  setHoverMouthKit: (kit: string | undefined) => void;
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
  setHoverMouthKit: (kit) =>
    set((state) => {
      state.selection.hoverMouthKit = kit;
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
