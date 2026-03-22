import type { StateCreator } from 'zustand';
import type { AnyChild, Layer, MapBuilderStore, SublayerVisibility, WallSegment } from '../types.ts';

export interface LayerActions {
  addLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  addChild: (layerId: string, child: AnyChild) => void;
  removeChild: (layerId: string, childId: string) => void;
  reorderChild: (layerId: string, fromIndex: number, toIndex: number) => void;
  updateChild: (layerId: string, childId: string, patch: Partial<AnyChild>) => void;
  recomputeMergedFloor: (layerId: string) => void;
  addWall: (layerId: string, wall: WallSegment) => void;
  removeWall: (layerId: string, wallId: string) => void;
  updateWall: (layerId: string, wallId: string, updates: Partial<WallSegment>) => void;
  closeAllDoors: (layerId: string) => void;
  setSublayerVisibility: (layerId: string, sublayer: keyof SublayerVisibility, visible: boolean) => void;
  setBackgroundTexture: (layerId: string, url: string | null) => void;
  setBackgroundLocked: (layerId: string, locked: boolean) => void;
}

export const createLayersSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  LayerActions
> = (set, _get) => ({
  addLayer: (layer) =>
    set((state) => {
      state.layers.push(layer);
    }),
  removeLayer: (id) =>
    set((state) => {
      const idx = state.layers.findIndex((l) => l.id === id);
      if (idx <= 0) return;
      state.layers.splice(idx, 1);
      if (state.ui.activeLayerId === id) {
        const nextIdx = Math.min(idx, state.layers.length - 1);
        state.ui.activeLayerId = state.layers[nextIdx]?.id ?? '';
      }
    }),
  reorderLayers: (fromIndex, toIndex) =>
    set((state) => {
      if (fromIndex <= 0 || toIndex <= 0) return;
      if (fromIndex >= state.layers.length) return;
      const [layer] = state.layers.splice(fromIndex, 1);
      if (layer) state.layers.splice(toIndex, 0, layer);
    }),
  updateLayer: (id, patch) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === id);
      if (layer) Object.assign(layer, patch);
    }),

  // ─── Child CRUD ─────────────────────────────────────────
  addChild: (layerId, child) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        // L2: Guard against duplicate IDs — silently ignore if already present
        if (layer.children.some((c) => c.id === child.id)) return;
        layer.children.push(child);
      }
    }),
  removeChild: (layerId, childId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        const idx = layer.children.findIndex((c) => c.id === childId);
        if (idx >= 0) layer.children.splice(idx, 1);
      }
    }),
  reorderChild: (layerId, fromIndex, toIndex) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        const [child] = layer.children.splice(fromIndex, 1);
        if (child) layer.children.splice(toIndex, 0, child);
      }
    }),
  updateChild: (layerId, childId, patch) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        const child = layer.children.find((c) => c.id === childId);
        if (child) {
          // L8: Archway cannot be locked — the UI already filters this option,
          // but coerce here as a safety net in case the store is updated directly.
          if (
            child.childType === 'door' &&
            'style' in child &&
            (patch as Record<string, unknown>).state === 'locked'
          ) {
            const doorChild = child as import('@/shared/types').DoorChild;
            const newStyle = (patch as Record<string, unknown>).style ?? doorChild.style;
            if (newStyle === 'archway') {
              (patch as Record<string, unknown>).state = 'closed';
            }
          }
          Object.assign(child, patch);
        }
      }
    }),
  recomputeMergedFloor: (layerId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        layer.mergedFloor = null;
      }
    }),

  // ─── Wall actions (sublayer detail) ─────────────────────
  addWall: (layerId, wall) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        layer.standaloneWalls.push(wall);
      }
    }),
  removeWall: (layerId, wallId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        const idx = layer.standaloneWalls.findIndex((w) => w.id === wallId);
        if (idx >= 0) layer.standaloneWalls.splice(idx, 1);
      }
    }),
  updateWall: (layerId, wallId, updates) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        const wall = layer.standaloneWalls.find((w) => w.id === wallId);
        if (wall) Object.assign(wall, updates);
      }
    }),
  closeAllDoors: (layerId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        for (const child of layer.children) {
          if (child.childType === 'door') {
            const door = child as import('@/shared/types').DoorChild;
            if (door.style !== 'archway') {
              door.state = 'closed';
            }
          }
        }
      }
    }),

  // ─── Sublayer / background ─────────────────────────────
  setSublayerVisibility: (layerId, sublayer, visible) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'dungeon') {
        layer.sublayerVisibility[sublayer] = visible;
      }
    }),
  setBackgroundTexture: (layerId, url) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'background') {
        layer.backgroundTexture = url;
      }
    }),
  setBackgroundLocked: (layerId, locked) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer && layer.type === 'background') {
        layer.presetLock = locked;
      }
    }),

});
