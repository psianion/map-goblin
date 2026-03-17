import type { StateCreator } from 'zustand';
import type { ChildClipboard, MapBuilderStore, RegionClipboard, SelectionSlice } from '../types.ts';

export interface SelectionActions {
  setSelectedIds: (ids: string[]) => void;
  setHoveredId: (id: string | null) => void;
  setSelectedRegion: (region: [number, number][][] | null) => void;
  setClipboard: (clipboard: ChildClipboard | null) => void;
  setRegionClipboard: (clipboard: RegionClipboard | null) => void;
  setSelectionTransform: (transform: SelectionSlice['selectionTransform']) => void;
  bakeSelectionTransform: () => void;
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
  setSelectedRegion: (region) =>
    set((state) => {
      state.selection.selectedRegion = region;
    }),
  setClipboard: (clipboard) =>
    set((state) => {
      state.selection.clipboard = clipboard;
    }),
  setRegionClipboard: (clipboard) =>
    set((state) => {
      state.selection.regionClipboard = clipboard;
    }),
  setSelectionTransform: (transform) =>
    set((state) => {
      state.selection.selectionTransform = transform;
    }),
  bakeSelectionTransform: () =>
    set((state) => {
      const t = state.selection.selectionTransform;
      if (!t) return;

      // Object-based bake: apply transform to each selected child
      if (state.selection.selectedIds.length > 0) {
        const ids = new Set(state.selection.selectedIds);
        for (const layer of state.layers) {
          if (layer.type !== 'dungeon') continue;
          for (const child of layer.children) {
            if (!ids.has(child.id)) continue;
            if (child.childType === 'shape') {
              const prev = child.transform ?? { translate: [0, 0] as [number, number], rotate: 0, scale: [1, 1] as [number, number] };
              child.transform = {
                translate: [prev.translate[0] + t.translate[0], prev.translate[1] + t.translate[1]],
                rotate: prev.rotate + t.rotate,
                scale: [prev.scale[0] * t.scale[0], prev.scale[1] * t.scale[1]],
              };
            } else if (child.childType === 'asset' || child.childType === 'light') {
              child.position = {
                x: child.position.x + t.translate[0],
                y: child.position.y + t.translate[1],
              };
              if (child.childType === 'asset') {
                child.rotation += t.rotate;
                child.scale *= Math.sqrt(t.scale[0] * t.scale[1]);
              }
            }
          }
        }
        state.selection.selectionTransform = null;
        return;
      }

      // Region-based bake (Alt+drag legacy): apply transform to selected region polygons
      const region = state.selection.selectedRegion;
      if (!region) {
        state.selection.selectionTransform = null;
        return;
      }
      state.selection.selectedRegion = region.map((polygon) =>
        polygon.map(([x, y]) => {
          const sx = x * t.scale[0];
          const sy = y * t.scale[1];
          const cos = Math.cos(t.rotate);
          const sin = Math.sin(t.rotate);
          const rx = sx * cos - sy * sin;
          const ry = sx * sin + sy * cos;
          return [rx + t.translate[0], ry + t.translate[1]] as [number, number];
        }),
      );
      state.selection.selectionTransform = null;
    }),
});
